# MR·SLIY 代码优化智能体

基于 Tree-sitter 与 RAG 的多语言代码优化智能体。桌面端采用 Tauri 架构（React 前端 + Node.js Sidecar 服务 + Rust 外壳），同时保留完整的 CLI 交互模式。

| 产品 | 当前版本 | 说明 |
|------|---------|------|
| 桌面 GUI | v0.1.6 | Tauri 桌面应用，独立版本化 |
| CLI | v3.9.0 | 命令行智能体，`npm install -g mr-sliy` |

## 功能

**代码分析与优化**

- 15+ 种语言支持：JavaScript / TypeScript / Python / Java / Go / C++ / C# / Rust / Swift / Kotlin / PHP / Ruby / Scala 等
- Tree-sitter WASM 解析器深度分析代码结构，内置 14+ 种检测规则
- 云端大模型优化建议（流式输出、可中断），或离线模式基于本地知识库与规则引擎（50+ 规则、20+ 模式）
- RAG 知识库：3000+ 知识条目、2100+ 优化案例
- 代码修改经风险分级确认门控，支持一键回滚
- 一键导出 HTML / Markdown 分析报告

**桌面体验**

- 双工作模式：分析模式（对话 + 检测流水线）/ 编辑模式（代码编辑为主，AI 收纳为悬浮助手）
- 10 套主题配色 + 日 / 夜 / 自动三态切换，界面缩放可调
- 全自动对话记忆：AI 在每轮对话后自动提取偏好与约定注入后续上下文，支持跨对话共享或按工作区隔离
- 可调工作区布局，状态持久化

**可靠性与集成**

- 自持引擎：监控 → 分析 → 决策 → 执行 → 验证闭环，支持自更新、自修复与回滚
- 应用内检查更新：自动发现新版本、下载校验（sha256）、一键安装
- MCP 接入：外部程序经 Model Context Protocol（HTTP / stdio）调用智能体能力
- 沙箱服务架构：Worker Threads 服务隔离，单一功能崩溃不影响其他服务
- 双数据库：SQLite（本地）与 MySQL（云端）双向同步

## 架构

```
┌─────────────────────────────────────────────┐
│  mrsliy-desktop.exe（Tauri / Rust 外壳）      │
│                                             │
│  React GUI（gui/）                           │
│  主工作区 / 优化对比 / 质量概览 / 设置         │
│                 │ HTTP（127.0.0.1 随机端口）  │
│  Node.js Sidecar（src/）                     │
│  Express API + Tree-sitter + RAG + LLM      │
└─────────────────────────────────────────────┘
```

| 目录 | 说明 |
|------|------|
| `gui/` | React + TypeScript + Vite 前端 |
| `src/` | Node.js 后端（Express 路由、检测服务、优化引擎、知识库、自更新） |
| `src-tauri/` | Rust 外壳（窗口管理、sidecar 拉起与健康检查） |
| `installer/` | Inno Setup 安装包脚本 |
| `docs/` | 架构设计文档（详见 [architecture.md](docs/architecture.md)） |

## 快速开始

### 桌面端

从 [GitHub Releases](https://github.com/whureww/Mr.Sliy--AI_Agent/releases/latest) 下载 `MRSLIY-Setup-*.exe` 安装即可，无需额外环境。

1. 左侧选择工作区与文件
2. 分析模式下输入"分析"触发检测流水线（解析 → AST → 规则检测 → 知识库比对 → 结论）
3. 在问题卡片上点击"修复"生成 AI 优化方案，确认后应用
4. 设置页配置 LLM 提供商（DeepSeek / 智谱 / 通义 / OpenAI / Ollama / 自定义 OpenAI 兼容接口）

### CLI

```bash
npm install -g mr-sliy
mr-sliy          # 或仓库内 npm start
```

| 命令 | 说明 |
|------|------|
| `/analyze` | 代码分析（分析文件 / 扫描项目） |
| `/optimize` | 交互式代码优化 |
| `/sustain` | AI 自持引擎（仪表盘 / 引擎控制 / 手动更新 / 手动修复） |
| `/config` | 配置管理（提供商 / 知识库 / 模式切换） |
| `/status` | 系统状态与健康检查 |
| `/help` | 帮助文档 |

输入 `/` 搜索命令，方向键选择，Tab 补全；子菜单中 `q` 或 `quit` 返回主菜单。

### 开发构建

环境要求：Node.js >= 18、Rust 工具链（桌面端打包需要）、Windows 10/64 位（桌面端）；CLI 支持 Windows / macOS / Linux。

```bash
npm install                     # 安装依赖（自动下载 Tree-sitter WASM）

npm run server                  # 仅启动后端 API（默认 3210 端口）
cd gui && npm install && npm run dev   # 启动 GUI 开发服务器

npx @tauri-apps/cli build       # 打包桌面应用
npm test                        # 运行单元测试
```

版本号三段式（major.minor.patch，每段最大 10，超限自动进位），迭代命令：`npm run bump`（CLI）、`npm run bump:gui`（桌面 GUI，四处文件自动同步）。

## MCP 接入

设置页展示即用配置，外部客户端（如 Claude Desktop）可经两种传输调用：

- **HTTP**：`POST http://localhost:<port>/mcp`，JSON-RPC 2.0 无状态模式
- **stdio**：`node <安装目录>/mcp-server.js`

可用工具：`scan_code`、`scan_project`、`optimize_code`、`chat`、`search_knowledge`、`list_memories`、`add_memory`、`get_scan_history` 等。

## 数据与配置

运行时数据位于 `~/.mr-sliy/`：

```
~/.mr-sliy/
├── database/                  # SQLite 数据库
├── reports/                   # 导出的分析报告
├── logs/                      # 运行日志
├── chat_memory.json           # 对话记忆（跨对话全局共享）
├── chat_memory_<hash>.json    # 按工作区隔离的独立记忆
├── update_source.json         # 检查更新源地址
└── database_connections.json  # 云端数据库连接配置
```

LLM API Key 在应用"设置"页配置，存储于本地数据库，不落明文；环境变量方式参见 `.env.example`。

## 安全

- API Key 存储在本地数据库，不暴露在代码或配置文件中
- 代码修改类操作经确认门控（按风险分级），支持一键回滚
- 检查更新仅拉取版本清单；打开外部链接仅允许 http/https
- 不上传任何代码或数据到第三方服务器

## 更新日志

完整历史见 [GitHub Releases](https://github.com/whureww/Mr.Sliy--AI_Agent/releases)。

### v0.1.6（2026-09-14）

- 修复"无法连接 GitHub（HTTP 301）"：仓库迁移后旧地址被永久重定向，而请求未跟随重定向——更新源改为新仓库地址，且清单拉取现在会跟随 301/302/307/308 重定向
- 注：v0.1.5 及更早版本内置旧地址，无法应用内自更新，请从 Release 页手动下载一次本版

### v0.1.5（2026-09-14）

- 修复分析模式发送按钮不随主题色：禁用态底色/图标色改为由当前主题色实时派生
- 更新下载改为手动触发、支持取消；修复取消后被换源逻辑当作网络错误继续下载的问题

### v0.1.4（2026-09-14）

- 全自动对话记忆（零操作）：每轮对话后 AI 自动提取偏好与约定写入记忆库；跨对话记忆开关（全局共享 / 按工作区隔离）
- 质量评分改为加权缺陷密度：按严重度加权并引入千行代码分母，需重新扫描生效
- 编辑模式 AI 对话改流式输出；主工作区布局可调；编辑器多标签溢出收纳
- MCP 可用性自检；修复换源下载产出损坏安装包的问题
