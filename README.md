# MR·SLIY 代码优化智能体

基于 Tree-sitter 与 RAG 的多语言代码优化智能体。桌面端采用 Tauri 架构(React 前端 + Node.js Sidecar 服务 + Rust 外壳),同时保留完整的 CLI 交互模式。

## 当前版本

| 产品 | 版本 | 说明 |
|------|------|------|
| CLI | v3.9.0 | 命令行智能体(`package.json` 根) |
| 桌面 GUI | v0.0.8 | Tauri 桌面应用(`gui/package.json`,自 v0.0.1 起独立版本化) |

### 版本号规则

版本号采用三段式 `major.minor.patch`,**三段(含修订号)每一段最大都不超过 10**:任一段达到 10 后继续迭代将自动向上进位(修订号溢出进次版本,次版本溢出进主版本)。

```
0.0.1 -> 0.0.2 -> ... -> 0.0.10 -> 0.1.0 -> ... -> 0.10.10 -> 1.0.0
3.9.2 -> 3.9.10 -> 3.10.0 -> 3.10.10 -> 4.0.0
```

迭代命令(自动同步 gui/package.json、tauri.conf.json、Cargo.toml、安装脚本):

```bash
npm run bump        # CLI 版本 +1
npm run bump:gui    # 桌面 GUI 版本 +1
```

## 特性

- **多语言支持**:支持 JavaScript、TypeScript、Python、Java、Go、C++、C#、Rust、Swift、Kotlin、PHP、Ruby、Scala 等 15+ 种编程语言
- **Tree-sitter 解析**:基于 Tree-sitter 的 WASM 解析器,深度分析代码结构
- **问题检测**:内置 14+ 种检测规则,自动检测代码中的潜在问题
- **智能优化**:结合大语言模型提供专业的代码优化建议,流式输出、可中断
- **离线优化**:无网络时基于本地知识库和规则引擎进行代码优化(50+ 规则、20+ 模式)
- **RAG 知识库**:包含 3000+ 条知识条目和 2100+ 条优化案例,支持云端数据库同步
- **双工作模式**:分析模式(对话 + 检测流水线为主)/ 编辑模式(代码编辑为主,AI 收纳为悬浮助手)
- **分析报告**:一键导出 HTML / Markdown 格式的项目分析报告
- **检查更新**:启动时静默检查新版本,顶部提示条通知;设置页支持手动检查与更新源配置
- **自持引擎**:完整的"监控 → 分析 → 决策 → 执行 → 验证"闭环,支持自更新、自修复与回滚
- **MCP 接入**:外部程序可通过 Model Context Protocol 调用智能体能力
- **沙箱服务架构**:基于 Worker Threads 的服务隔离,单一功能崩溃不影响其他服务
- **双数据库支持**:SQLite(本地)与 MySQL(云端)双向同步,自动回退

## 架构

```
+----------------------------------------------------------+
|  mrsliy-desktop.exe (Tauri / Rust 外壳)                   |
|    +------------------------------------------------+    |
|    |  React GUI (gui/)                              |    |
|    |    主工作区 / 优化对比 / 质量概览 / 设置          |    |
|    +------------------------+-----------------------+    |
|                             | HTTP (127.0.0.1:随机端口)  |
|    +------------------------v-----------------------+    |
|    |  Node.js Sidecar (src/)                        |    |
|    |    Express API + Tree-sitter + RAG + LLM       |    |
|    +------------------------------------------------+    |
+----------------------------------------------------------+
```

- **gui/**:React + TypeScript + Vite 前端,经 Tauri IPC 获取 sidecar 端口
- **src/**:Node.js 后端(Express 路由、检测服务、优化引擎、知识库、自更新)
- **src-tauri/**:Rust 外壳,负责窗口管理、sidecar 拉起与健康检查
- **installer/**:Inno Setup 安装包脚本(部署到 `C:\Program Files\MRSLIY`)

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- Rust 工具链(仅桌面端打包需要)
- Windows 10/64 位(桌面端);CLI 支持 Windows / macOS / Linux

### 开发运行

```bash
# 安装依赖(自动下载 Tree-sitter WASM)
npm install

# 仅启动后端 API(默认 3210 端口)
npm run server

# 启动 GUI 开发服务器
cd gui && npm install && npm run dev

# 打包桌面应用(前端构建 + Rust 编译 + NSIS 安装包)
npx @tauri-apps/cli build
```

### 桌面端使用

安装后启动 `MR·SLIY`:

1. 左侧选择工作区与文件
2. 分析模式下输入"分析"触发检测流水线(解析 → AST → 规则检测 → 知识库比对 → 结论)
3. 对问题卡片点击"修复"生成 AI 优化方案,确认后应用
4. 设置页可配置 LLM 提供商(DeepSeek / 智谱 / 通义 / OpenAI / Ollama / 自定义 OpenAI 兼容接口)

### CLI 模式

```bash
# 全局安装后
npm install -g mr-sliy
mr-sliy

# 或仓库内直接运行
npm start
```

常用命令:

| 命令 | 说明 |
|------|------|
| `/analyze` | 代码分析(分析文件 / 扫描项目) |
| `/optimize` | 交互式代码优化 |
| `/sustain` | AI 自持引擎(仪表盘 / 引擎控制 / 手动更新 / 手动修复) |
| `/config` | 配置管理(提供商 / 知识库 / 模式切换) |
| `/status` | 系统状态与健康检查 |
| `/help` | 帮助文档 |

交互细节:输入 `/` 快速搜索命令,方向键选择,Tab 补全;子菜单中输入 `q` 或 `quit` 返回主菜单。

## 配置

所有运行时数据位于用户主目录 `~/.mr-sliy/`:

```
~/.mr-sliy/
├── database/            # SQLite 数据库
├── reports/             # 导出的分析报告
├── logs/                # 运行日志
├── chat_memory.json     # 对话记忆(用户偏好与项目约定)
├── update_source.json   # 检查更新源地址
└── database_connections.json  # 云端数据库连接配置
```

LLM API Key 推荐在应用"设置"页配置,存储在本地数据库,不落明文。环境变量方式参见 `.env.example`。

### 检查更新

在托管平台(Gitee Pages / GitHub Raw / 自有服务器)放置版本清单 JSON:

```json
{ "version": "0.0.2", "notes": "更新说明", "url": "下载页地址" }
```

在"设置 → 检查更新"中填入清单地址并保存。此后应用启动时会自动检查,发现新版本在顶部显示提示条;同一版本的提示关闭后不再重复出现。

## 测试

```bash
npm test              # 运行 tests/ 下单元测试
npm run test:coverage # 覆盖率报告
```

## 安全

- API Key 存储在本地数据库,不暴露在代码或配置文件中
- 检查更新仅拉取版本清单;打开外部链接仅允许 http/https
- 代码修改类操作经确认门控(按风险分级),支持一键回滚
- 不上传任何代码或数据到第三方服务器

## 更新日志

### 桌面 GUI v0.0.9
> 发布日期: 2026-09-11

- **修复自动更新下载必然失败**(看门狗速度单位错 1000 倍):平均速度阈值想表达 100KB/s,实际写成 `100*1024`,而比较式 `bytes/ms` 数值即 KB/s,等效要求 100MB/s——安装包 ~48MB,45 秒时哪怕全部下完也远低于该阈值,任何网速必被误杀,直连→镜像1→镜像2 三个源全部阵亡
- 实测修复后:直连 16KB/s 龟速 → 45s 正确切镜像 → ghfast.top 高速拉完 → 54s 完成且 sha256 校验通过
- **修复下载后重试报"请求过于频繁"**:下载期前端每 800ms 轮询进度,90s 即耗尽全局限流配额(15min/100 次);`/api/update-download/status` 已加入轮询类接口限流豁免
- ⚠️ v0.0.7/v0.0.8 的下载器含此 bug,自动下载可能失败;失败时请手动下载本版安装包覆盖安装

### 桌面 GUI v0.0.8
> 发布日期: 2026-09-11

- **修复启动动画丢失**(根因:sidecar 健康检查在 Tauri 主线程同步等待 1~3s,冻结消息泵导致 WebView2 首帧无法呈现)——启动动画期被白屏完全吃掉
- sidecar 启动 + 健康检查移入后台线程:窗口立即可交互渲染,splash 动画完整播放;前端按端口 0 轮询直至服务就绪
- 启动加速:实测白屏期从 30s+(阻塞型)缩短到 ~0.9s(WebView2 初始化硬成本),2.4s 进入主界面
- 窗口设置主题底色(`backgroundColor`),消除 WebView2 初始化期的刺眼纯白
- WebView2 追加启动参数:绕过系统代理直连本地资源(`--proxy-server=direct://`),避免代理软件(如 Clash)拦截 `tauri.localhost` 导致资源加载缓慢
- 白屏规避(保留):启动后前 2.7 秒(Rust 侧)与挂载后 0/0.7s/1.5s(前端)做 1px 窗口尺寸抖动,强制合成器出帧,规避部分 AMD 显卡驱动"首帧不呈现"
- ⚠️ v0.0.7 安装包曾混入旧前端产物导致启动动画缺失,本版已重新构建前端并完整打包,请覆盖安装

### 桌面 GUI v0.0.7
> 发布日期: 2026-09-11

- **修复启动卡死在加载动画**(v0.0.6 回归):启动画面的收场接线(最短展示定时器/外观就绪标记/6s 强制收场)在打包中缺失,导致动画永不结束
- 双保险兜底:前端 6s 强制收场 + Rust 侧 8s 线程强制显示窗口——即使前端完全异常,窗口也必然出现,不再"双击没反应"
- 浏览器实测:0.5s 启动画面在场 → 3s 自动收场进入主界面
- ⚠️ 卡死的 v0.0.6 无法自动更新,请手动下载本版安装包覆盖安装

### 桌面 GUI v0.0.6
> 发布日期: 2026-09-11

- **修复"检查更新后下载失败/卡死"**:
  - 下载全程看门狗:连接超时 / 传输停滞(30s 无数据) / 龟速(45s 后平均速度 <100KB/s,直连 GitHub CDN 常见)都会主动中止
  - 自动镜像回退:直连失败后依次尝试 ghfast.top / mirror.ghproxy.com 加速下载
  - **sha256 完整性校验**:摘要取自 GitHub API,镜像下载同样强制校验,不匹配即删除重试,防篡改
  - 错误信息透传:不再显示笼统的"请求失败",直接展示真实原因(校验失败/网络超时等)
  - 下载失败时横幅新增"前往下载"按钮,可用浏览器手动下载兜底
- 更新提示正文自动清理 Markdown 符号,展示更整洁
- 实测(直连 GitHub 仅 ~20KB/s 龟速环境):直连 45s 触发回退 → 镜像 4s 完成 48.5MB 下载 + 校验通过
- ⚠️ v0.0.4 / v0.0.5 的旧下载器无法自动获得本次修复,请手动下载本版安装包一次;之后的版本全自动更新

### 桌面 GUI v0.0.5
> 发布日期: 2026-09-11

- **全新品牌 Logo**:琥珀渐变圆角方块 + AI 双星芒,覆盖任务栏/exe 资源/安装器/快捷方式/顶栏品牌标
- **启动动画**:Logo 弹簧入场 + 主题色扫描环 + 字标聚焦入场 + 渐变进度条与阶段文案(中英文),背景氛围光斑漂移,暗色自动适配
- **启动体验**:主窗口改为动画结束才显示,消除启动白屏闪烁;黑夜模式首帧防白闪(镜像恢复日/夜);6s 兜底强制收场
- **设置页折叠优化**:主题 / 大模型提供商 / 更新记录三区默认收起,收起时保留一行摘要(当前主题色点+名称 / 当前使用的提供商 / 最新一条记录),降低页面长度
- 支持 `prefers-reduced-motion` 减少动态偏好

### 桌面 GUI v0.0.4
> 发布日期: 2026-09-11

- **日 / 夜模式**:新增 白天 / 黑夜 / 自动 三态切换;自动模式按系统时间在 18:00–次日 7:00 启用黑夜,运行中跨越阈值即时自动切换,无需重启
- **主题扩充**:6 → 10 套配色(新增 石墨·冷杉 / 青潮·浅滩 / 黛蓝·星野 / 橄榄·原野),每套主题均带手工调校的黑夜变体
- 全量暗色适配:窗口控制/右键菜单/滚动条/禁用态/打字指示/呼吸光环/代码编辑器语法高亮(GitHub Dark 派生)/Diff 徽章/更新记录徽章等
- **修复设置页外观区显示原始词条 key**(`scale.standard` 等)的回退问题
- 主题预览卡实时跟随日/夜变体取色;关于卡片版本号改为动态读取(v0.0.3 引入的硬编码一并修复)
- 外观读取失败时兜底应用默认配置,保证 auto 日夜模式始终生效

### 桌面 GUI v0.0.3
> 发布日期: 2026-09-11

- **中英文切换全覆盖**:修复此前"切到英文仅部分文字生效"的问题,全量迁移 UI 硬编码文案至 i18n 字典(`gui/src/lib/i18n.ts`,累计 400+ 词条)
- 覆盖范围:顶栏/状态栏/窗口控制/右键菜单/关闭确认/更新横幅、会话导航、AI 助手、主工作区、分析会话、优化对比、质量概览、代码编辑器、设置页全部卡片
- 非 React 层文案同步接入:主题名与缩放档位(外观)、IPC 错误兜底文案、回复中断提示、风险等级标签
- 语言偏好持久化(localStorage),所有组件经 `useLang()` 订阅语言状态,切换即时生效无需重启

### 桌面 GUI v0.0.2
> 发布日期: 2026-09-11

- **检查更新完整闭环**:发现新版本后自动从 GitHub Releases 下载安装包(顶部横幅实时进度条),下载完成一键"安装更新"——启动安装器并自动退出当前应用
- 新增后端下载服务 `updateDownloader.js`:仅 https、跟随 GitHub 302 重定向(CDN)、`.part` 临时文件防半包、版本号白名单防路径穿越、500MB 上限;重启后自动恢复"已下载未安装"状态
- 版本清单支持可选 `download` 字段;缺省时自动调 GitHub Releases API 解析 `MRSLIY-Setup-*.exe` 资产
- Tauri 新增 `install_update` 命令:校验安装包必须位于 `~/.mr-sliy/updates` 内方可启动
- 设置页"检查更新"卡片同步显示下载进度,失败可重试
- 安装器(iss)安装/卸载前等待 sidecar watchdog 退出,避免覆盖 runtime 撞文件锁
- 新增 API:`POST /api/update-download/start`、`GET /api/update-download/status`、`POST /api/update-download/cancel`

### 桌面 GUI v0.0.1
> 发布日期: 2026-09-11

- **首个桌面版本**:桌面 GUI 自本版本起独立版本化(从 v0.0.1 开始,与 CLI 版本号分离)
- Tauri 架构:React 前端 + Node.js Sidecar 服务 + Rust 外壳,Inno Setup 部署至 `C:\Program Files\MRSLIY`
- **主工作区双模式**:分析模式(对话 + 检测流水线可视化)与编辑模式(代码编辑为主,AI 收纳为悬浮助手)
- **检测流水线**:解析 → AST 构建 → 规则检测 → 知识库比对 → 生成结论,分步耗时展示
- **问题卡片**:双列网格布局,超 8 个自动折叠,支持右键修复/复制
- **AI 对话**:流式输出、停止按钮(发送/停止图标切换)、Markdown 渲染、耗时 / tokens / 缓存命中率用量脚注
- **代码修改确认**:统一修改方案卡片,应用/取消/失败状态管理,应用后直接落盘
- **优化对比页**:修改前后代码对比视图
- **质量概览页**:项目级统计
- **设置页**:LLM 提供商管理(含自定义 OpenAI 兼容接口)、MCP 接入信息、跨会话记忆库、外观主题、检查更新、更新记录
- **检查更新**:启动时静默检查 + 顶部可关闭提示条(同版本不再打扰)+ 设置页手动检查与更新源配置
- **跨会话对话记忆**:自动提取用户偏好与项目约定注入系统提示词,设置页可手动管理
- **版本号规则**:三段式每段不超过 10,超限自动向上进位(`npm run bump:gui`)

### CLI v3.9.0
> 发布日期: 2026-09-11

- **版本号对齐**:CLI 版本自 v3.8.6 继续迭代至 v3.9.0;桌面打包期间临时占用的 3.14 ~ 3.16 为安装包版本号,不代表 CLI 版本轨迹。自此 CLI 与桌面 GUI 各自独立版本化,并遵守"三段均不超过 10"的进位规则
- **新增检查更新服务**(`services/bootstrap/versionCheck.js`):拉取远程版本清单 JSON 与本地版本比对,8 秒超时,语义化版本比较(忽略 v 前缀)
- **新增 API 接口**:`POST /api/check-update`(检查更新)、`GET/POST /api/update-source`(更新源读写,持久化于 `~/.mr-sliy/update_source.json`)、`POST /api/open-url`(系统默认浏览器打开下载页,仅允许 http/https)
- **对话上下文压缩**:超出保留上限的早期历史压缩为角色化摘要,长对话不再"失忆",系统提示词稳定前缀命中缓存
- **跨会话记忆库**:启发式提取用户偏好("记住/以后都/别用…"句式),注入聊天系统提示词
- **聊天回复禁止 emoji/颜文字**:系统提示词显式约束
- **明确更新源安全约束**:仅接受 http(s) 地址,打开外部链接仅允许 http(s) 协议
- **版本号规则落地**:每段子版本不超过 10,超限自动向上迭代(`npm run bump`)

### v3.8.6
> 更新日期: 2026-08-13

- **⚡ 全面性能与架构优化（按优先级分阶段执行）**

- **🔒 阶段1：安全加固**
  - 新增 `securityGuard.js` 路径遍历防护、工具白名单校验、命令注入防护、SQL 标识符校验（`validateIdentifier` / `validateIdentifiers`）
  - 修复 `dbAdapter.js` SQLite 占位符 bug：`$N` 占位符改为 `?` 兼容数组参数绑定，修复 "Too many parameter values were provided"
  - 工具白名单（25）与工具定义（25）与 case 分发（25）完全对齐，移除 10 个无 case 的幽灵项，补齐 `get_providers`/`create_backup`/`list_backups`

- **🗄️ 阶段2：数据库性能优化**
  - SQLite 改为 WAL 模式 + `synchronous=NORMAL` + 20MB 缓存 + 256MB 内存映射 + 自动 checkpoint
  - 新增 47 个索引覆盖核心查询路径（code_issue、task、project、file_path、severity 等）
  - 修复 `insert` 占位符 bug

- **🧵 阶段3：Agent 主线程优化**
  - 同步文件操作全部转为异步 `fs.promises`
  - 新增 `taskQueue.js` 并发受限任务队列（`runWithConcurrency` / `runSerial`），支持进度回调与背压保护

- **🔧 阶段4：超长函数拆分 + Agent.js 解耦**
  - `agent.js` 从 1833 行精简至 1032 行
  - 提取 `toolDefinitions.js`（25 个工具元数据）与 `toolHandlers.js`（工具处理逻辑）实现纯数据/逻辑分离
  - 参数归一化：snake_case → camelCase 兼容

- **⚖️ 阶段5：Worker 负载均衡 + 错误处理规范**
  - 新增 `servicePool.js` 服务实例池，支持 `config.instances` 多实例 + 基于最少连接数（least-connections）的负载均衡路由，并列时轮询打散
  - 默认单实例保持低资源占用，可按需横向扩展
  - `ServiceRegistry` 透明切换至 ServicePool，热替换走池级流量切换
  - **错误标准化传播**：`workerBootstrap.js` 序列化完整错误元信息（type/code/name/details/stack）
  - `sandboxService.js` 跨 Worker 边界重建 `AppError`，保留 `errorType`/`errorCode`/`errorDetails` 与 `action`/`service` 上下文，供 AI 修复管道精确分类
  - `ServiceRegistry.execute` 补充 service/action 上下文

- **🚀 阶段6：CLI 冷启动 + 进度反馈 + 测试体系**
  - 沙箱服务启动由串行改为**并行**（`Promise.all`），冷启动从 3231ms 降至 ~1826ms（提升约 44%）
  - `startCLI` 新增启动进度反馈：Banner + 各服务实时状态（就绪/失败/启动中）+ 耗时统计
  - 新增 `jest.config.js`：testMatch 限定 `tests/**/*.test.js`，排除 `backups/`（自更新回滚备份中的过期测试副本）、`test_scan/`、手动脚本
  - 修复 `auth.test.js` API Key 长度断言 off-by-one（67 → 68）
  - 修复 `validator.js` `sanitizeString` 的 `escapeHtml`/`stripHtml` 优先级 bug：转义模式下不再先剥离 HTML 导致内容清空
  - 全部 56 个单元测试通过

### v3.8.5
> 更新日期: 2026-08-12

- **✨ 新增双层混合 AI 自动修复管道**
  - 运行时错误自动触发：`uncaughtException` / `unhandledRejection` 自动接入修复流程
  - **第一层（快策略）**：database / network / file_system / memory 类错误走原有预定义修复策略（重连、重建、重装等），零延迟响应
  - **第二层（AI 管道）**：runtime / dependency / configuration 类错误直接进入 AI 修复，快策略失败时自动降级兜底
  - 新增核心模块:
    - `src/services/bootstrap/aiFixPipeline.js` - 错误上下文采集（堆栈定位 + 源码片段）→ LLM 分析 → 生成 replace/append/overwrite 补丁
    - `src/services/bootstrap/sandboxTrialRunner.js` - 沙箱试运行器：补丁校验 → 临时目录 → 独立 SandboxService 试运行 → 错误复现测试 + AI 冒烟测试
    - `src/services/bootstrap/autoFixCoordinator.js` - 双层混合路由总控，含错误去重（45s 窗口）和修复循环保护（3 分钟内同错最多 3 次）
  - AI 修复最多 5 轮迭代，每轮带上一轮失败原因反馈给 LLM 重新生成
  - 补丁路径白名单：只允许修改 `src/sandbox/services/`、`src/workers/`、`src/services/` 下的文件，核心入口文件不允许动
  - `replace` 补丁唯一性校验：`oldString` 必须精确匹配 1 处，0 处或多处直接拒绝
  - 试运行完全隔离：独立临时目录 + 独立 Worker 线程，失败自动清理，不影响运行中的服务

- **🔒 门控确认机制（Gate Control）**
  - 沙箱试运行通过后，必须经用户显式确认才执行补丁写入和热替换
  - 新增 `hot_reload_fix` 到 `confirmationGate` 高风险操作列表
  - CLI 确认框展示：错误摘要、AI 分析、补丁 diff、试运行测试结果（复现+冒烟）
  - 用户拒绝或超时则放弃修复，不执行任何文件变更

- **🐛 修复云端数据库同步 AUTO_INCREMENT 丢失问题**
  - 修复覆盖同步（overwrite）使用 `CREATE TABLE ... LIKE` 降级路径时，RENAME 后 INT PRIMARY KEY 表的 AUTO_INCREMENT 属性丢失
  - 导致增量同步队列 INSERT（不含 id 列）全部报错 `Field 'id' doesn't have a default value`
  - 修复 `dbAdapter.js` overwrite 路径：RENAME 后自动检查并恢复 INT PK 列的 AUTO_INCREMENT 属性
  - 修复 `mysql.js` `cleanupTempTables()` SQL 语句中 AND/OR 优先级错误（添加括号分组）

- **🔒 安全强化**
  - 修复 `mysql.js` 中 SQL 注入漏洞：表名/列名直接插值到 SQL 语句
    - 新增 `validateIdentifier()` 标识符验证函数
    - SELECT 查询改用参数化查询，DDL 语句添加标识符验证
  - 修复 `serviceRegistry.js` `executeWithTimeout()` 资源泄漏（移除未使用的 AbortController，添加 clearTimeout）
  - 修复 `sandboxService.js` `getPendingRequests()` 丢失请求参数（handler 存储添加 params 字段）
  - 修复 `sandboxService.js` `start()` 超时后轮询继续运行（添加 settled 标志位）
  - 修复 `logDeduplicator.js` `shouldLog()` 逻辑 Bug（TTL 过期后先检查旧 count 再重置）

### v3.8.4
> 更新日期: 2026-07-28

- **✨ 新增沙箱服务架构（Sandbox Service Architecture）**
  - 基于 Node.js Worker Threads 的服务隔离架构
  - 每个功能模块（解析、检测、优化、知识库、LLM）独立运行在独立的 Worker 线程中
  - 支持服务热替换（Hot Reload），运行时更新代码不影响智能体正常运行
  - 单一服务崩溃不影响其他服务和主进程，自动重启恢复
  - 内存隔离：每个服务独立 V8 堆内存，防止内存泄漏扩散
  - 降级机制：沙箱初始化失败时自动切换到传统模式

  - 新增核心框架文件:
    - `src/sandbox/serviceRegistry.js` - 服务注册中心，管理所有沙箱服务的生命周期
    - `src/sandbox/sandboxService.js` - 沙箱服务基类，封装 Worker 线程管理、消息通信
    - `src/sandbox/workerBootstrap.js` - Worker 引导脚本，动态加载服务实现
    - `src/sandbox/bootstrap.js` - 服务启动入口和配置管理
    - `src/sandbox/sandboxManager.js` - 沙箱管理器，提供降级兼容接口
    - `src/sandbox/test.js` - 集成测试脚本

  - 新增服务实现文件:
    - `src/sandbox/services/parserService.js` - 代码解析服务
    - `src/sandbox/services/detectorService.js` - 问题检测服务
    - `src/sandbox/services/optimizerService.js` - 代码优化服务
    - `src/sandbox/services/knowledgeService.js` - 知识库服务
    - `src/sandbox/services/llmService.js` - LLM 调用服务

  - Agent 集成:
    - 修改 `src/agent/agent.js`，默认启用沙箱模式
    - 新增 `sandbox_status`、`sandbox_enable`、`sandbox_disable`、`sandbox_reload_service` 工具
    - 支持在 CLI 中动态切换沙箱模式和热替换服务

- **🐛 修复沙箱服务架构多项关键 Bug**
  - 修复 `new AbortController?.()` 语法错误，改用 `typeof` 安全检查
  - 修复 Worker 线程不支持的 `--max-old-space-size` execArgv 参数
  - 修复 `isReady` 属性与方法名冲突，重命名为 `_isReady`
  - 修复知识库 tags 和 vector_json 字段的 JSON 解析错误处理

- **✨ 新增日志去重机制**
  - 新增 `src/utils/logDeduplicator.js`，基于 TTL 的日志缓存和去重
  - 修复 Worker 线程导致的启动日志重复输出问题（数据库初始化、LLM 提供商注册等）
  - Worker 内部日志级别降级为 `warn`，重要日志通过 parentPort 转发主进程

- **🐛 修复 CLI 命令选择重复显示问题**
  - 修复输入 `/` 后使用上下键选择命令时，匹配命令标题行重复渲染的问题
  - 修正 `updateSelectionHighlight` 中光标移动行数计算（`3 + maxDisplay` → `4 + maxDisplay`）

- **🔒 安全性与健壮性修复**
  - 修复 `mysql.js` 中 SQL 注入漏洞：表名/列名直接插值到 SQL 语句
    - 新增 `validateIdentifier()` 标识符验证函数，校验表名和列名合法性
    - SELECT 查询改用参数化查询（`TABLE_NAME = ?`）
    - DDL 语句（ALTER TABLE / CREATE TABLE / DROP TABLE）添加标识符验证
    - 修复默认值插值的单引号转义问题
  - 修复 `serviceRegistry.js` `executeWithTimeout()` 资源泄漏
    - 移除未使用的 `AbortController` 创建
    - 添加 `clearTimeout` 清理，防止超时定时器泄漏
  - 修复 `sandboxService.js` `getPendingRequests()` 丢失请求参数
    - handler 存储中添加缺失的 `params` 字段，确保热替换时待处理请求参数完整传递
  - 修复 `sandboxService.js` `start()` 超时后轮询继续运行的资源泄漏
    - 添加 `settled` 标志位，超时 reject 后立即停止就绪轮询
  - 修复 `logDeduplicator.js` `shouldLog()` 逻辑 Bug
    - TTL 过期后先重置 count=1 再检查 count>1，导致摘要日志永不触发
    - 调整为先检查旧 count 再重置
  - 修复 `cleanupTempTables()` SQL 语句中 AND/OR 优先级错误（添加括号分组）

### v3.8.3
> 更新日期: 2026-07-28

- **✨ 大幅扩充知识库至 3000+ 条知识条目和 2100+ 条优化案例**
  - 新增 Node.js 深度特性（30条）：事件循环、流处理、Cluster、Worker Threads
  - 新增 TypeScript 高级类型（30条）：条件类型、映射类型、模板字面量类型
  - 新增 数据库深度知识（40条）：索引原理、执行计划、锁机制、事务隔离
  - 新增 前端性能优化（30条）：关键渲染路径、懒加载、预加载、Service Worker
  - 新增 分布式系统设计（30条）：CAP理论、一致性哈希、Raft协议、2PC/3PC
  - 新增 微服务架构（30条）：服务发现、API网关、服务网格、链路追踪
  - 新增 容器与K8s（30条）：Docker最佳实践、K8s核心组件、Helm、Service Mesh
  - 新增 大数据与AI（30条）：Hadoop/Spark/Flink、Kafka、ML Pipeline、MLOps
  - 新增 移动端开发（20条）：iOS/Android/Flutter/React Native
  - 新增 游戏与图形（20条）：OpenGL/Vulkan、游戏引擎、物理引擎、光线追踪
  - 新增 系统设计案例（20条）：短链、秒杀、聊天室、限流、缓存设计
  - 新增 网络协议深度（20条）：HTTP/3、QUIC、TLS、DNS、WebSocket
  - 新增 代码质量与重构（20条）：SOLID、KISS、DRY、重构模式、代码异味
  - 新增 多语言优化案例（200+）：JavaScript/Python/TypeScript/CSS/React/Vue/Go/Java
  - 新增 安全性案例（100+）：XSS、CSRF、SQL注入、加密、JWT、OAuth2
  - 新增 性能优化案例（100+）：CPU缓存、零拷贝、无锁编程、异步优化
  - 新增 数据库优化案例（100+）：查询优化、索引、连接池、缓存策略
  - 新增 React/Vue 优化案例（100+）：渲染优化、状态管理、组件设计
- **✨ 建立重复内容检测机制**：确保知识条目和优化案例的唯一性
- **✨ 优化案例覆盖 15+ 编程语言**：JavaScript、Python、TypeScript、CSS、HTML、SQL、Java、Go、Docker、YAML、HCL 等

### v3.8.2
> 更新日期: 2026-07-28

- **✨ 大幅扩充默认知识库**：从 50 条知识 + 10 个案例 扩充到 350+ 条知识 + 60+ 个案例
  - 新增 TypeScript 最佳实践（10条）：interface、泛型、枚举、严格模式等
  - 新增 Java 最佳实践（12条）：接口、StringBuilder、Stream API、依赖注入等
  - 新增 Python 最佳实践（12条）：PEP8、类型提示、装饰器、上下文管理器等
  - 新增 Go 最佳实践（10条）：goroutine、channel、context、defer 等
  - 新增 C/C++ 最佳实践（10条）：智能指针、RAII、模板、命名空间等
  - 新增框架与生态（15条）：React、Vue、Express、Django、Spring Boot 等
  - 新增数据库优化（12条）：SQL优化、索引设计、Redis、MongoDB 等
  - 新增设计模式（21条）：23种经典设计模式
  - 新增安全编码（12条）：XSS、SQL注入、CSRF、加密等
  - 新增测试最佳实践（10条）：单元测试、集成测试、持续集成等
  - 新增性能优化（12条）：懒加载、缓存、虚拟滚动等
  - 新增代码评审与SOLID原则（10条）：代码规范、反模式识别等
  - 新增常见反模式（10条）：上帝类、过长方法、硬编码等
  - 新增网络与API设计（8条）：RESTful、GraphQL、JWT 等
  - 新增架构设计（8条）：微服务、DDD、CQRS、CAP理论等
  - 新增调试与诊断（6条）：日志分级、性能分析、内存泄漏检测等
- **✨ 新增多语言优化案例**：JavaScript、TypeScript、Python、Java、Go、通用优化、安全案例
  - 数组方法优化（map、filter、find、every、reduce）
  - 异步编程优化（async/await、Promise）
  - 代码简化（可选链、空值合并、解构、模板字符串）
  - 性能优化（字符串拼接、切片预分配、Set去重）
  - 安全编码（SQL注入防护、XSS防护）
- **✨ 新增知识库重置功能**：支持在 CLI 中重置知识库
  - 路径：`/config` → `2) 知识库管理` → `8) 重置知识库`
  - 新增 `resetKnowledgeBase()` 方法
  - 支持增量添加新的默认知识（检查重复内容）

### v3.8.1
> 更新日期: 2026-07-27

- **🐛 修复云端同步只同步部分表的问题**：修复上传到云端时只同步知识库表（kb_entries、kb_cases）的问题，现在会同步全部32张业务表
  - 重构 `uploadToCloud()` 函数，改用 `dbAdapter.syncAllLocalToRemote()` 全量同步
  - 为 `syncLocalToRemote()` 添加三种同步模式支持：
    - `merge`（合并更新）：使用 UPSERT，有则更新，无则添加
    - `overwrite`（覆盖云端）：删除云端数据后重新上传
    - `append`（仅追加）：只添加云端不存在的记录
  - 优化同步结果展示，显示更新数、新增数、空表数、失败表数等详细信息

### v3.8.0
> 更新日期: 2026-07-27

- **✨ 新增高级技能模块**：参考 GitHub 优秀项目，添加6个全新技能
  - `code-generation` - 代码生成技能（基于需求描述生成高质量代码、单元测试、模拟数据）
  - `code-refactoring` - 代码重构技能（提取方法、内联方法、重命名变量、简化条件）
  - `code-debugging` - 代码调试技能（错误分析、问题诊断、潜在bug检测）
  - `documentation` - 文档生成技能（代码文档、API文档、README、架构文档、更新日志）
  - `database` - 数据库开发技能（表结构生成、SQL查询生成、数据库迁移、ER图生成）
  - `security-audit` - 安全审计技能（全面安全审计、深度分析、审计报告生成）
- **✨ 参考优秀开源项目**：
  - superpowers (obra/superpowers)：代码生成、重构、调试、文档
  - agent-skills (supabase/agent-skills)：后端/数据库/全栈开发
  - auditor-skill (solanabr/auditor-skill)：安全审计

### v3.7.2
> 更新日期: 2026-07-27

- **✨ 新增代码分析子技能**：扩展 skills/code-analysis/ 目录，添加三个新技能
  - `complexityAnalysis.js` - 代码复杂度分析（圈复杂度、认知复杂度计算）
  - `securityDetection.js` - 代码安全检测（XSS漏洞、SQL注入、硬编码密钥、路径遍历）
  - `performanceOptimization.js` - 性能优化分析（循环效率、内存问题、低效代码）
- **✨ 增强代码优化技能**：扩展 skills/code-optimization/index.js，新增自动修复策略
  - 新增 `unused_variable` 自动修复：删除未使用的变量声明
  - 新增 `unused_function` 自动修复：删除未使用的函数定义
  - 增强 `unnecessary_else` 自动修复：自动移除 return 后的 else 语句
  - 增强 `magic_number` 自动修复：自动提取为具名常量
  - 新增 `null_check` 自动修复：添加空值检查
- **✨ 优化技能管理器**：注册新子技能，支持独立调用和组合调用

### v3.7.1
> 更新日期: 2026-07-27

- **✨ 修复命令选择界面问题**：修复输入 `/` 后使用上下键选择时出现输入框提示消失和重复标题的问题
  - 修正 `updateSelectionHighlight()` 函数的行数计算逻辑
  - 确保重新绘制分隔线和输入提示行
  - 修复光标位置恢复后显示异常的问题

### v3.7.0
> 更新日期: 2026-07-27

- **✨ 优化命令选择闪烁问题**：输入 `/` 后使用上下键选择命令时不再全屏重绘，只更新选中高亮，解决页面闪烁问题
  - 新增 `updateSelectionHighlight()` 函数，使用 ANSI 光标控制只重绘匹配命令列表区域
  - 保存/恢复光标位置，避免光标跳动
  - 只在命令模式下启用局部更新，普通模式仍使用全屏重绘

### v3.6.9
> 更新日期: 2026-07-27

- **✨ 重构主菜单结构**：整合重复功能，优化用户体验
  - `/analyze` → 代码分析（整合 analyzeFile + scanProject）
  - `/config` → 配置管理（整合 provider + knowledge + mode）
  - `/status` → 系统状态（整合 status + health）
  - `/sustain` → AI自持引擎（整合 update + repair）
  - 主菜单从15个命令减少到9个，操作更聚焦

### v3.6.4
> 更新日期: 2026-07-27

- **✨ 优化自动维护日志显示**：更新或修复日志停留显示1分钟后自动清除，不占用输入框

### v3.6.3
> 更新日期: 2026-07-27

- **✨ 优化自动维护日志显示**：自动更新修复完成后自动清除日志并重新显示输入提示，不占用输入框

### v3.6.2
> 更新日期: 2026-07-27

- **✨ 新增空闲时自动更新修复功能**：AI自持引擎现在支持在系统空闲时自动执行更新和修复操作
  - 默认3分钟无操作后触发自动维护
  - 自动检测系统健康状态并执行修复
  - 自动检查待处理更新并执行
  - 支持配置自动修复和自动更新开关
  - 最小执行间隔30分钟，避免频繁执行

### v3.6.1
> 更新日期: 2026-07-27

- **🐛 修复同步队列时间戳转换错误**：修复 `convertTimestampParams` 函数中 UUID 字符串被错误解析为时间戳的问题
  - 使用正则表达式 `/^-?\d+(\.\d+)?$/` 确保只匹配纯数字字符串
  - 添加上限检查防止超出 JavaScript Date 范围
  - 修复 UUID `"9e4433d2-566d-47d4-9a14-ce9a61b927ae"` 被解析为 `Infinity` 导致 `Invalid time value` 错误

### v3.6.0
> 更新日期: 2026-07-27

- **🐛 修复时间戳格式转换问题**：修复 `convertTimestampParams` 函数无法处理字符串形式毫秒时间戳的问题
  - 添加对字符串形式时间戳（如 `'1785130963019.0'`）的解析和转换逻辑
  - 确保 SQLite 中存储的字符串时间戳能正确转换为 MySQL 的 `datetime` 格式
  - 修复 `confirmation_history` 表同步失败的问题

### v3.5.9
> 更新日期: 2026-07-27

- **🐛 修复 MySQL 表 AUTO_INCREMENT 缺失问题**：修复 `telemetry_events`、`validation_records`、`ai_analysis_records` 表的 `id` 字段缺少 `AUTO_INCREMENT` 属性
  - 为 MySQL 中的表添加 `AUTO_INCREMENT`，确保 INSERT 操作时能自动生成主键
  - 清理同步队列中 481 条失败记录
  - 修复同步队列操作达到最大重试次数后放弃的问题

### v3.5.8
> 更新日期: 2026-07-26

- **🐛 修复同步队列表缺失 `next_retry_at` 列的问题**：修复 `dbAdapter.js` 中 `initSyncQueueTable` 函数的迁移逻辑
  - SQLite 不支持 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 语法，改用 `PRAGMA table_info()` 检查列是否存在
  - 添加兼容旧数据库的迁移逻辑，自动补全缺失的 `next_retry_at` 和 `last_retry_at` 列
  - 修复定时重试任务中更新列导致的 `no such column` 错误

### v3.5.7
> 更新日期: 2026-07-25

- **🔍 修复云端数据库表结构不一致问题**：使用提供的云端数据库连接信息检查并修复表结构
  - 云端数据库共33张表（32张业务表 + sync_metadata），所有业务表都存在
  - 修复了50+个缺失列：scan_project、scan_task、code_issue、ai_optimize_record、code_report、code_standards、user_preferences、kb_metadata、analysis_result、system_monitor、project_analysis_summary 等表
  - 同步了LLM API密钥（deepseek）到云端
  - 修复了SQL语法错误和默认值问题
  - 所有32张业务表结构现在完全一致

- **🛠️ 添加数据库管理工具**：
  - `scripts/checkRemoteDb.js` - 检查云端MySQL数据库表结构和数据统计
  - `scripts/syncLLMKeys.js` - 同步LLM API密钥到云端
  - `scripts/checkTableSchema.js` - 检查并修复本地和云端表结构一致性

### v3.5.0
> 更新日期: 2026-07-25

- **🔧 代码架构优化**：完成6大方案的代码提升
  - **方案一：错误处理与日志规范化**：创建统一错误处理模块（`utils/errorHandler.js`），定义标准化错误类型，实现错误分类、日志记录和处理函数
  - **方案二：数据库同步性能优化**：实现批量同步、指数退避重试、同步队列机制，提升数据同步效率和可靠性
  - **方案三：AST解析性能优化**：实现AST解析结果缓存（5分钟TTL）、并行规则执行，减少重复解析开销
  - **方案四：代码架构模块化**：分离CLI和API服务，抽取公共模块，完善Express中间件和路由体系
  - **方案五：安全性增强**：创建输入验证模块（`utils/validator.js`）、JWT认证模块（`utils/auth.js`），实现参数化查询、密码哈希、API密钥管理
  - **方案六：测试覆盖**：编写单元测试（validator、auth、errorHandler），覆盖核心工具函数

### v3.0.0
> 更新日期: 2026-07-22

- **🔧 重大版本更新**：全面重构数据库同步逻辑，支持本地SQLite与云端MySQL双向同步
- **🔧 新增数据库连接管理**：支持多连接配置、默认连接切换、连接测试等功能
- **🔧 新增云端同步菜单**：支持上传到云端、从云端下载、连接管理等操作

### v2.1.0
> 更新日期: 2026-07-20

- **🔧 新增AI自持引擎**：实现完整的"监控→分析→决策→执行→验证"闭环
- **🔧 新增规则引擎**：支持规则定义、执行、评估和优化

### v2.0.0
> 更新日期: 2026-07-18

- **🔧 重大版本更新**：基于Tree-sitter与RAG的多语言代码优化智能体重构
- **🔧 新增多语言支持**：支持JavaScript、TypeScript、Python、Java、Go等15+种语言
- **🔧 新增离线模式**：无网络时基于本地知识库和规则引擎进行代码优化

### v1.0.0
> 更新日期: 2026-07-01

- **🎉 首次发布**：基于Tree-sitter的代码分析工具
