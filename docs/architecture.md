# MR·SLIY 桌面端技术架构方案 v1.0

> 基于 Tree-sitter 与 RAG 的多语言代码优化智能体 · GUI（Tauri）架构留档
> 定稿日期：2026-09-08
> 设计原则：方案 A 三栏工作台为主框架，融合方案 B 流水线进度条与方案 C 仪表盘 Tab

---

## 一、总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri 主进程 (Rust)                                          │
│  - 窗口/菜单/托盘  - 文件系统访问  - 自更新/回滚             │
│  - sidecar 进程管理: spawn node sidecar.js                  │
└───────────────┬─────────────────────────────────────────────┘
                │ spawn + 监听 127.0.0.1:动态端口
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Node Sidecar 进程 (复用 src/index.js 的 Express server)     │
│  - /api/* REST 路由                                          │
│  - Worker Thread 池 (parser / detector / optimizer /        │
│    knowledge / llm) 独立 V8 Isolate                          │
│  - SQLite + MySQL 同步                                       │
└───────────────┬─────────────────────────────────────────────┘
                │ worker.send / worker.on
                ▼
       5 个独立 Worker Threads

┌─────────────────────────────────────────────────────────────┐
│  Tauri WebView 前端 (React + Vite, SPA)                      │
│  - invoke('analyze_file', {...})  → Tauri Command            │
│  - 或直接 fetch('http://127.0.0.1:port/api/...')           │
│  - UI: 三栏工作台 + 流水线进度条 + 仪表盘 Tab                │
└─────────────────────────────────────────────────────────────┘
```

**关键决策**：Rust 不直接调 Node 服务，而是 spawn 现有的 `src/index.js` HTTP server 作为 sidecar。现有 5 个 Worker / Express 路由 / 数据库同步逻辑零改动复用，Tauri 只负责外壳和原生能力。

**现有代码映射（已核实）**：

| 现有文件 | 职责 | 桌面端角色 |
|---|---|---|
| `src/index.js` | Express HTTP server 入口 | sidecar 主进程（薄壳复用） |
| `src/services/ast/parser.js` | `parseCode` / `initParser` | parser Worker |
| `src/services/detection/detector.js` | `detectIssues(sourceCode, filePath, options)` | detector Worker |
| `src/services/optimization/optimizer.js` | `Optimizer.optimize(code, context)` | optimizer Worker |
| `src/services/vector/knowledgeBase.js` | `KnowledgeBase.init/addEntry/getStats` | knowledge Worker |
| `src/services/llm/providers.js` | `chat(messages, options)` / `optimizeCode(...)` | llm Worker |
| `src/workers/pool.js` | Worker 线程池 `execute()` 分发 | 沿用，主进程侧 |
| `src/cli/index.js` | CLI 菜单（analyze/optimize/sustain） | 保持独立，CLI 与 GUI 共存 |

---

## 二、Tauri 项目目录结构

```
d:\Final\final\
├── src/                      # 现有 Node 服务（保持不动）
├── src-tauri/                # 【新增】Tauri/Rust 外壳
│   ├── Cargo.toml
│   ├── tauri.conf.json       # 窗口、sidecar、bundle 配置
│   ├── build.rs
│   ├── icons/
│   └── src/
│       ├── main.rs           # Tauri 入口
│       ├── commands.rs       # #[tauri::command] IPC 命令实现
│       ├── sidecar.rs        # spawn/health-check node sidecar
│       ├── updater.rs        # 自更新 + 回滚 + 把关门
│       └── fs.rs             # 原生文件对话框、目录树
├── gui/                      # 【新增】前端 SPA
│   ├── package.json          # react, vite, @tauri-apps/api
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx           # 顶层路由
│       ├── routes/
│       │   ├── Workbench.tsx       # 三栏主工作区 (预览图 01)
│       │   ├── DiffReview.tsx      # 优化对比 (预览图 02)
│       │   └── Dashboard.tsx       # 质量概览 (预览图 03)
│       ├── components/
│       │   ├── sidebar/WorkspaceNav.tsx
│       │   ├── editor/EditorStage.tsx
│       │   ├── inspect/InspectPanel.tsx
│       │   ├── chat/AIChat.tsx
│       │   ├── diff/UnifiedDiff.tsx
│       │   ├── dashboard/BentoGrid.tsx
│       │   ├── common/StatusBar.tsx
│       │   ├── common/TopBar.tsx
│       │   └── common/ModeSwitch.tsx   # 🟢本地 / 🔵云端
│       ├── stores/           # Zustand 状态
│       │   ├── projectStore.ts
│       │   ├── issueStore.ts
│       │   └── settingsStore.ts
│       ├── ipc/
│       │   └── client.ts     # invoke 封装 + HTTP fallback
│       └── styles/
│           └── tokens.css    # 琥珀橙主题变量
├── package.json              # 现有
└── scripts/
    └── build-gui.js          # 打包前先 build gui/，再 tauri build
```

---

## 三、Rust ↔ Node Sidecar 桥接

`src-tauri/src/sidecar.rs` 核心逻辑：

```rust
pub fn spawn_sidecar(app: &AppHandle) -> Result<u16> {
    // 1. 找到打包后的 node + sidecar.js（或 dev 时用系统 node）
    let node_bin = resolve_node_binary(app)?;
    let sidecar_script = app.path().resource_dir()?.join("sidecar.js");

    // 2. 抢一个空闲端口
    let port = pick_free_port(0)?;

    // 3. spawn，stdout/stderr 转发到 Rust log
    let _child = Command::new(node_bin)
        .arg(sidecar_script)
        .env("MRSLIY_PORT", port.to_string())
        .env("MRSLIY_DATA_DIR", home_dir().join(".mr-sliy"))
        .spawn()?;

    // 4. 健康轮询 /api/health 直到 200 或超时 15s
    wait_for_health(port, Duration::from_secs(15))?;
    Ok(port)
}
```

`sidecar.js`（新增薄壳，复用现有 server）：

```js
// sidecar.js — 给 Tauri 用的薄壳
process.env.MRSLIY_MODE = 'desktop';
require('./src/index.js');  // 现有 Express server 已读 env.MRSLIY_PORT
```

Tauri Command 通过 `reqwest` 调本地 HTTP：

```rust
#[tauri::command]
async fn analyze_file(state: State<SidecarState>, path: String) -> Result<AnalyzeResp, String> {
    let url = format!("http://127.0.0.1:{}/api/analyze", state.port);
    let resp: AnalyzeResp = reqwest::Client::new()
        .post(&url).json(&serde_json::json!({ "path": path }))
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    Ok(resp)
}
```

---

## 四、IPC 命令清单（Tauri Command）

已核实现有路由（src/routes/*）：scan/file、scan/project、scan/batch、issues、issues/:id/fix、issues/stats、ai/optimize、ai/apply、ai/history、config、users、projects、reports、update。

| 命令名 | 入参 | 返回 | 对应后端 |
|---|---|---|---|
| `sidecar_health` | — | `{status, mode}` | GET `/health` |
| `list_dir` | `path` | `FileNode[]` | Rust 原生（不走 sidecar） |
| `read_file` | `path` | `{content, language}` | Rust 原生 |
| `save_file` | `path, content` | `{ok}` | Rust 原生 |
| `analyze_file` | `path, options?` | `{issues[], ast summary}` | POST `/api/scan/file` |
| `analyze_project` | `root, options?` | `{scanId, results}` | POST `/api/scan/project` |
| `optimize_issue` | `code, language, mode` | `{diff, mode: '本地'\|'大模型'}` | POST `/api/ai/optimize` |
| `apply_diff` | `issueId/优化结果` | `{ok}` | POST `/api/ai/apply` |
| `issue_stats` | — | `{score, issues, ...}` | GET `/api/issues/stats` |
| `issue_fix` | `id, data` | `{ok}` | PUT `/api/issues/:id/fix` |
| `get_config` | — | `config` | GET `/api/config` |
| `update_config` | `config` | `{ok}` | PUT `/api/config` |
| `get_providers` | — | `Provider[]` | GET `/api/ai/history` 等（LLM 管理路由待补） |
| `dashboard_stats` | `projectId?` | `{score, issues, trend, langs}` | GET `/api/issues/stats`（聚合待补） |
| `update_check` | — | `{hasUpdate, version, notes}` | Rust 原生 |
| `update_apply` | `gateId` | `{ok, rollbackId}` | Rust 原生 + 把关 |
| `update_rollback` | `rollbackId` | `{ok}` | Rust 原生 |

**待补路由**（GUI 需要但现有 server 缺失，后续迭代添加）：
- POST `/api/chat`（AI 对话）
- POST `/api/kb/search`、`/api/kb/import`（知识库检索/导入）
- GET `/api/llm/providers`、POST `/api/llm/key`、POST `/api/llm/switch`（LLM 切换与 Key 管理）
- POST `/api/sync/upload`、`/api/sync/download`（双向同步，CLI 已有对应能力）

**前端调用封装** `gui/src/ipc/client.ts`：

```ts
import { invoke } from '@tauri-apps/api/core';
import { getSidecarPort } from './sidecar';

// 优先 invoke (Tauri Command)，fallback 到 HTTP（dev 模式或调试）
export async function analyzeFile(path: string) {
  if (import.meta.env.TAURI) return invoke('analyze_file', { path });
  const port = await getSidecarPort();
  return fetch(`http://127.0.0.1:${port}/api/analyze`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ path })
  }).then(r => r.json());
}
```

---

## 五、前端组件树

```
<App>
  <TopBar>                            # 项目切换 / 模式开关 / LLM 下拉 / 自更新提示
    <ProjectSwitcher/>
    <ModeSwitch mode={local|cloud}/>
    <LLMSelector/>
    <UpdateGate/>                     # 2 分钟静止后弹更新卡，3 分钟超时入队
  </TopBar>

  <TabRouter>
    <Route "workbench">               # 预览图 01
      <Workbench>
        <WorkspaceNav/>               # 左栏：文件树 / 最近 / 收藏 / 回收站
        <EditorStage>                 # 中栏
          <TabBar/>
          <Breadcrumb/>
          <CodeEditor/>               # 带 minimap + 问题标记
          <PipelineStrip/>             # 流程进度条（可选折叠）
        </EditorStage>
        <InspectPanel>                # 右栏
          <Tab "Issues"/>              # 问题卡片列表 + Fix/Details
          <Tab "AI Chat"/>             # 对话式建议 + RAG 引用卡
          <Tab "Knowledge"/>           # 知识库检索
        </InspectPanel>
      </Workbench>
    </Route>

    <Route "diff">                    # 预览图 02
      <DiffReview>
        <AIChatThread/>               # 左 1/3：对话 + RAG 引用
        <UnifiedDiff/>                # 右 2/3：Before/After + Accept/Reject
        <DiffMetrics/>                # 复杂度 / 重复 / 测试影响
      </DiffReview>
    </Route>

    <Route "dashboard">               # 预览图 03
      <Dashboard>
        <BentoGrid>
          <QualityRingCard/>          # 评分环
          <OverviewCard/>             # Issues / Auto-fixable / Files
          <IssuesByTypeCard/>         # 条形图
          <SeverityCard/>             # 堆叠条
          <TrendCard/>                # 30 天折线
          <LanguagesCard/>            # 语言标签云
        </BentoGrid>
        <RecentScansTable/>
      </Dashboard>
    </Route>
  </TabRouter>

  <StatusBar/>                        # Ready / 132 files / 320 rules / 5/5 services
</App>
```

**样式 token** `gui/src/styles/tokens.css`（贴合已确认的预览图风格）：

```css
:root {
  --bg-canvas: #F6F6F4;
  --bg-card: #FFFFFF;
  --border-hairline: #E9E7E2;
  --text-primary: #262523;
  --text-muted: #8B8985;
  --accent: #E8870A;          /* 琥珀橙 */
  --accent-tint: #FEF3E2;
  --radius: 14px;
  --shadow-soft: 0 12px 40px rgba(38,37,35,.08);
}
```

---

## 六、关键数据流

**① 分析（点扫描）**

```
Workbench 点 "Scan"
  → invoke('analyze_project', {root, langs})
  → Rust POST /api/scan
  → Node: pool.execute('parser', {action:'parse', path})
          → pool.execute('detector', {ast})
          → 写 SQLite scan_records + issues
          → SSE 推送进度
  → 前端 PipelineStrip 实时更新（解析中 → 检测中 → 完成）
  → InspectPanel.Issues 渲染
```

**② 优化（点 Fix）**

```
Issues 卡片点 "Fix"
  → invoke('optimize_issue', {issueId, mode:'local'})
  → Node:
      mode=local  → kb.search(issue) → optimizer.optimize(code, ctx)
                     → 标记 [🟢 本地]
      mode=cloud  → kb.search(issue) → llm.optimizeCode(code, ctx)
                     → 标记 [🔵 大模型]
  → 跳转 /diff，渲染 UnifiedDiff
  → 点 "Accept all" → invoke('apply_diff') → 写盘 + 更新 issue 状态
```

**③ 报告（切 Dashboard Tab）**

```
Route "dashboard" 挂载
  → invoke('dashboard_stats', {projectId})
  → Node 读 SQLite: scan_records / issues / language_stats
  → 聚合 score / trend / severity / langs
  → BentoGrid 渲染
```

**④ 自更新（用户静止 2 分钟）**

```
UpdateGate 计时器
  → invoke('update_check')
  → 有更新 → 弹卡（3 分钟倒计时）
      用户确认 → invoke('update_apply', {gateId})
              → Rust 备份当前代码 → 替换 → 版本+1 → 写 update_history
      超时 → 入队 + 保存任务进度
      用户点"入队" → 同上
  → 回滚入口 → invoke('update_rollback', {rollbackId}) → 恢复备份
```

---

## 七、与任务书的对应检查

| 任务书要求 | 本架构落点 |
|---|---|
| 本地+云端双模式 | `ModeSwitch` + `optimize_issue(mode)` 双路径 |
| AST 混合检测 + Tree-sitter | 复用 `services/ast` + `services/detection` Worker |
| RAG 知识增强 | `services/rag` + `services/vector` + `/api/kb/*` |
| 多 LLM 切换 + API Key 管理 | `/api/llm/providers` + `/api/llm/key` + `/api/llm/switch` |
| Worker 隔离热替换 | 沿用 `workers/pool.js`，5 独立 Worker Thread |
| 本地主导双向同步 | `/api/sync/upload` + `/api/sync/download`（32 表） |
| 自更新 + 把关 + 回滚 | `updater.rs` + `UpdateGate` 组件 |
| Windows 平台测试 | Tauri 原生支持 Windows，无 macOS 依赖 |
| 不用 Electron | Tauri/Rust + WebView2 |

---

## 八、落地步骤

1. **脚手架**：在 `d:\Final\final` 下生成 `src-tauri/` 和 `gui/`，React + TS + Vite 模板
2. **Sidecar 桥接**：写 `sidecar.rs` + `sidecar.js`，跑通 `invoke('sidecar_health')` 返回 5/5
3. **三栏骨架**：`Workbench` 静态布局 + `list_dir`/`read_file` 两个 Rust 原生命令，能打开本地文件
4. **接通 analyze**：前端接 `EditorStage` 问题标记 + `InspectPanel.Issues`
5. **Diff + 优化**：接 `/api/optimize` + `UnifiedDiff` 组件
6. **仪表盘**：接 `/api/dashboard`
7. **LLM 管理 + 同步**：设置页接 `/api/llm/*` 和 `/api/sync/*`
8. **自更新门**：`updater.rs` + `UpdateGate`，最后做

---

## 九、UI 设计基准（已确认）

- 风格：Notion / Arc 浅色现代风，冷灰白底（#F6F6F4）+ 白色悬浮卡片 + 柔和阴影
- 主色：琥珀橙 #E8870A，浅琥珀 #FEF3E2
- 禁止：emoji、卡通元素、深色主题、紫色渐变、霓虹
- 参考预览图：`gui-preview/index.html`（01 主工作区 / 02 优化对比 / 03 质量概览）
- 动效：缓慢、平滑过渡（用户偏好）
