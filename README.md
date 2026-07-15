# Mr.Sliy

基于 Tree-sitter 与 RAG 的多语言代码优化智能体，支持代码分析、问题检测、智能优化等功能。

## ✨ 特性

- **多语言支持**：支持 JavaScript、TypeScript、Python、Java、Go、C++、C#、Rust、Swift、Kotlin、PHP、Ruby、Scala 等 15+ 种编程语言
- **Tree-sitter 解析**：基于 Tree-sitter 的 WASM 解析器，深度分析代码结构
- **问题检测**：内置 14+ 种检测规则，自动检测代码中的潜在问题：
  - 未使用变量/函数/导入
  - 魔法数字
  - 深度嵌套
  - 函数过长
  - 重复代码
  - 缺少注释
  - Null 检查缺失
  - 不必要的 else
  - Console.log 残留
  - 高复杂度方法
- **智能优化**：结合大语言模型提供专业的代码优化建议
- **知识库管理**：内置 RAG 知识库，支持自定义知识扩展，可离线使用
- **进度可视化**：所有操作都有实时进度条展示
- **CLI 交互**：友好的命令行界面，支持多种交互方式

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- Windows / macOS / Linux

### 安装

```bash
npm install -g mr-sliy
```

安装过程中会自动完成：
- 创建配置文件
- 初始化数据库
- 下载必要的 Tree-sitter WASM 文件

### 启动

```bash
mr-sliy
```

启动后界面会显示：
- 当前工作模式（离线/在线/自动）
- 已注册的 LLM 提供商数量
- 知识库条目数量

### 首次使用

启动后输入 `/provider` 进入提供商管理：

1. 选择 `2) 注册新提供商`
2. 输入提供商名称（如 `deepseek`、`zhipuai`、`tongyi`）
3. 输入 API Key
4. 选择 `1) 切换` 到新注册的提供商
5. 开始使用 AI 功能！

### 离线使用

如果不想使用云端大模型，可以：
1. 输入 `/mode` 切换到"离线模式"
2. 使用本地 RAG 知识库进行代码分析和优化建议
3. 离线模式下完全不依赖网络

## 📖 命令

### 启动方式

```bash
# 交互式启动
mr-sliy

# 分析单个文件
mr-sliy analyze <file>

# 扫描项目
mr-sliy scan <path>
```

### 智能体命令

| 命令 | 说明 |
|------|------|
| `/analyze` | 分析单个文件 |
| `/scan` | 扫描项目目录 |
| `/optimize` | 交互式代码优化 |
| `/provider` | 大模型提供商管理 |
| `/knowledge` | 知识库管理 |
| `/update` | 自更新管理（代码、配置、知识库更新、合并历史记录） |
| `/repair` | 自修复管理（数据库、网络、依赖修复） |
| `/mode` | 切换工作模式（离线/在线/自动） |
| `/status` | 查看系统状态 |
| `/help` | 显示帮助文档 |
| `/clear` | 清空屏幕 |
| `/exit` | 退出程序 |

### 交互方式

- 输入 `/` 可快速搜索命令
- 使用 `↑↓` 方向键选择命令
- 按 `Tab` 自动补全
- 按 `Enter` 确认执行
- 直接输入文字与 AI 聊天

## ⚙️ 配置

配置文件位于项目根目录的 `.env`：

```bash
# LLM API Keys（可选，不设置则使用离线模式）
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4

CLAUDE_API_KEY=your-claude-key
CLAUDE_MODEL=claude-3-sonnet-20240229

DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_MODEL=deepseek-chat

# 本地模型（Ollama）
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=codellama

# 数据库配置
DB_PATH=./data/code_optimizer.db

# 日志配置
LOG_LEVEL=info
LOG_FILE=./logs/app.log

# MySQL 配置（可选，用于云数据库）
MYSQL_ENABLED=false
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=code_optimizer
```

## 🔧 支持的 LLM 提供商

| 提供商 | 模型示例 | 说明 |
|--------|----------|------|
| OpenAI | gpt-4, gpt-3.5-turbo | OpenAI 官方 API |
| Claude | claude-3-sonnet, claude-3-opus | Anthropic Claude |
| DeepSeek | deepseek-chat, deepseek-coder | 深度求索 |
| 智谱 AI | glm-4, glm-3-turbo | 清华智谱 |
| 通义千问 | qwen-plus, qwen-max | 阿里云 |
| Moonshot | kimi-chat, moonshot-v1-8k | 月之暗面 |
| Google Gemini | gemini-pro, gemini-1.5-pro | Google AI |
| 豆包 | Doubao-7B, Doubao-pro | 字节跳动 |
| 文心一言 | ernie-3.5, ernie-4.0 | 百度 |
| Ollama | codellama, llama2 | 本地部署模型 |

## 🗂️ 项目结构

```
backend/
├── src/
│   ├── agent/              # 智能体核心逻辑
│   ├── cli/                # 命令行界面
│   ├── config/             # 配置管理
│   ├── engine/             # 双模式引擎（在线/离线）
│   ├── services/
│   │   ├── ast/            # Tree-sitter AST 解析
│   │   ├── detection/      # 问题检测器
│   │   ├── llm/            # LLM 提供商适配
│   │   ├── rag/            # RAG 知识库
│   │   └── vector/         # 向量数据库
│   ├── skills/
│   │   ├── code-analysis/  # 代码分析技能
│   │   ├── code-detection/ # 代码检测技能
│   │   └── code-optimization/ # 代码优化技能
│   ├── routes/             # API 路由
│   └── utils/              # 工具函数
├── database/                # 数据库脚本
├── scripts/                # 安装脚本
├── wasm/                   # Tree-sitter WASM 解析器
└── data/                   # 数据存储
```

## 🛡️ 安全

- API Key 存储在本地数据库中，不暴露在代码或配置文件中
- 使用 `.npmignore` 排除敏感文件
- 支持加密配置存储
- 不上传任何代码或数据到第三方服务器

### v2.6.7
> 更新日期: 2026-07-15

- **知识库更新**: AI生成的更新
- 更新内容: {
  "action": "expand",
  "count": 8,
  "topics": [
    "卫语句消除嵌套",
    "清理无效代码",
    "硬编码提取常量",
    ...

### v2.6.5
> 更新日期: 2026-07-15

- **🐛 代码分析错误修复**：修复 `similarCases.filter is not a function` 和 `relatedKnowledge.forEach is not a function` 错误，原因是调用异步方法 `findSimilarCases()` 和 `searchEntries()` 时缺少 `await`，添加 `await` 调用和 `Array.isArray()` 类型检查
- **🐛 自动模式离线显示修复**：修复自动模式始终显示离线状态的问题，优化 `getActualMode()` 方法，正确处理 `networkStatus` 为 `null` 的情况
- **🐛 自更新默认类型修复**：修复自更新默认使用知识库更新的问题，优化AI提示词，优先判断为代码更新，只有明确提到知识库扩充时才使用 `knowledge` 类型

### v2.6.3
> 更新日期: 2026-07-14

- **🔧 自更新类型判断优化**：优化AI提示词，添加更新类型选择规则，优先考虑代码更新

### v2.6.2
> 更新日期: 2026-07-14

- **🐛 自动模式网络检测修复**：修复自动模式网络状态检测逻辑，正确处理初始状态

### v2.6.1
> 更新日期: 2026-07-14

- **🔧 版本迭代逻辑优化**：更新/修复完成后再进行版本迭代和README更新，避免阻塞主流程

### v2.6.0
> 更新日期: 2026-07-13

- **🗑️ 删除GitHub Actions**：删除自动发布到npm的工作流配置

### v2.5.9
> 更新日期: 2026-07-13

- **✨ 备份失败处理优化**：权限不足时向用户请求权限，空间不足时自动查找并切换备用存储位置，文件被占用时使用流式复制确保备份成功

### v2.5.8
> 更新日期: 2026-07-13

- **✨ 备份进度显示**：添加备份进度条实时显示功能，支持文件复制进度追踪

### v2.5.4
> 更新日期: 2026-07-13

- **✨ 多数据库连接管理**：支持用户自定义后端数据库配置，实现知识库扩充

### v2.5.0
> 更新日期: 2026-07-13

- **知识库更新**: AI生成的更新
- 更新内容: {
  "action": "expand",
  "count": 1000,
  "topics": [
    "代码优化",
    "代码分析",
    "代码检测",
    "软件架构...

### v2.4.9
> 更新日期: 2026-07-13

- **🐛 知识库清空修复**：修复npm安装后知识库被清空的问题，`postinstall.js` 脚本中所有异步操作（`knowledgeBase.init()`、`importFromFile()`、`seedDefaultKnowledge()`、`getStats()`）添加 `await`，确保知识库数据完整导入后再退出
- **🐛 AI更新解析修复**：修复AI智能更新"解析AI响应失败"时进度条卡死的问题，增强JSON解析逻辑（优先匹配 ```json``` 代码块，添加必要字段验证），失败时调用 `onProgress` 通知前端停止进度条
- **✨ README自动更新**：每次版本迭代时自动更新 README.md，添加新版本条目到更新日志顶部，包含更新日期和详细变更内容
- **🔧 项目结构清理**：删除临时目录（`publish_temp/`）、测试文件（`test-worker.js`、`test_modules/`），精简项目结构
- **🔧 代码验证**：所有修改文件通过语法检查，确保功能完整性

### v2.4.7
- **🐛 标题对齐修复**：修复智能体大标题文字无法对齐的问题，新增 `stripAnsi()`、`getDisplayWidth()`、`padEndDisplay()` 工具函数正确计算中文字符和emoji的终端显示宽度
- **🐛 知识库统计修复**：修复知识库统计显示 `undefined` 的问题，新增缓存统计信息机制（`cachedStats`），`getStatus()` 改为同步获取
- **🐛 MySQL回退修复**：修复 MySQL 连接失败时未正确回退到 SQLite 的问题，`testConnection()` 和 `initDatabase()` 失败时自动设置 `config.mysql.enabled = false`
- **🐛 自更新卡死修复**：修复自更新因缺少 `rollbackManager` 导入导致卡死的问题，添加 LLM API 调用超时机制（120秒）
- **🐛 确认门控不显示修复**：修复进度条动画覆盖确认门控输出的问题，备份时排除 `node_modules`、`.git` 等大目录，备份时间从数分钟降至1秒
- **✨ 版本自动迭代**：每次更新或修复成功后自动递增版本号，每个版本最多10个小版本（0-9），达到9时自动进位
- **✨ 进度反馈增强**：AI智能更新全流程添加进度回调（分析需求→调用AI→解析响应→创建记录→执行更新）
- **✨ 数据库回退增强**：`query()`、`queryOne()`、`execute()` 函数在 MySQL 失败时自动回退到 SQLite
- **🔧 备份性能优化**：`createBackup()` 排除 `node_modules`、`.git`、`backups`、`logs` 等大目录，新增 `getDirectoryFilesExclude()` 方法
- **🔧 确认门控体验**：收到 `status: 'confirming'` 事件时停止进度条动画并清除行内容，确保确认门控正常显示
- **🔧 CLI显示增强**：更新成功后显示版本迭代信息（如 `2.4.6 -> 2.4.7`）

### v2.4.6
- **☁️ 知识库默认云端存储**：知识库默认优先从云端MySQL读取，MySQL不可用时自动回退到本地SQLite
- **🔄 智能双模式切换**：所有知识库操作（增删改查、导入导出、同步）自动适配MySQL和SQLite
- **🔒 敏感信息保护**：数据库连接信息通过 `.env` 文件配置，已在 `.gitignore` 中排除，不会泄露到GitHub
- **📊 存储状态显示**：知识库统计接口返回 `storage` 字段，标识当前使用的是 mysql 还是 sqlite

### v2.4.5
- **🔧 重构回滚机制**：回滚作为更新和修复的子模块，不再是独立模块
- **📊 代码结构优化**：删除独立的 rollback.js，回滚逻辑整合到 selfUpdateManager 和 selfRepairManager
- **🔄 更新路由结构**：回滚路由改为 `/updates/:id/rollback` 和 `/repairs/:id/rollback`
- **💾 统一模块备份**：使用 moduleRegistry 的备份机制，删除重复的模块备份目录

### v2.4.3
- **🔒 多步骤门控确认**：在热更新过程中添加3个确认步骤（确认备份完成→确认应用更新→确认更新完成）
- **📊 详细确认信息**：显示风险等级、影响范围、受影响文件、备份状态、回滚可能性
- **🔄 优化回滚机制**：支持模块级回滚，确保可以精确回滚到更新前状态
- **📋 确认记录**：所有确认操作记录到数据库，支持查询确认历史
- **⚠️ 请求修改方案**：门控支持用户请求修改方案，拒绝时可说明修改需求

### v2.4.2
- **📊 更新进度条**：在自更新过程中显示实时进度条，包含详细的更新步骤（加载记录→创建备份→等待确认→应用更新→验证→完成）
- **📝 更新内容预览**：更新前显示更新详情面板，包括更新ID、类型、版本信息和更新内容预览
- **⏱️ 耗时统计**：显示更新操作的总耗时
- **📋 步骤权重**：各步骤按权重计算进度百分比（应用更新40%、验证更新20%等）

### v2.4.1
- **⚡ Worker Threads 优化**：将 AST 解析、代码扫描等 CPU 密集操作移入独立 Worker 线程池，防止主线程阻塞卡死
- **🔄 线程池管理**：新增 `src/workers/pool.js` 实现线程池，支持自动扩展和任务队列
- **📦 Worker 解析器**：新增 `src/workers/parser.js`，独立初始化 Tree-sitter，与主线程隔离
- **🔀 并发解析**：支持多个文件同时解析，显著提升批量分析性能
- **🔥 防止卡死**：主线程不再被 CPU 密集操作阻塞，保持响应流畅

### v2.4.0
- **🔥 模块独立化架构**：将智能体每个功能模块独立出来，运行中修改个别功能不影响其他功能和智能体运行
- **🔄 热替换机制**：替换原有沙箱功能，采用 `delete require.cache + 重新require` 实现模块热替换
- **📦 ModuleRegistry**：新增模块注册中心，支持 `load/unload/reload` 操作
- **📡 EventBus**：新增事件总线，模块间通过事件解耦通信，不再直接引用
- **🗂️ 备份目录**：新增 `backups/modules/` 目录，新旧代码按模块名和时间戳存放
- **⏩ 移除沙箱**：删除 sandbox.js，简化更新流程
- **🎯 更新进度条**：支持实时更新进度和内容显示

### v2.3.2
- **🐛 CLI箭头键修复**：修复输入 `/` 后上下箭头选择命令失效的问题，增加对 `key.name` 的检测

### v2.3.1
- **📋 合并历史记录**：新增合并查询更新和修复记录功能，可同时查看所有操作历史
- **🔧 修复失败记录优化**：修复失败时显示"自我修复失败"和"系统已回滚"详细信息
- **📊 记录类型标识**：更新和修复记录添加 `type` 字段区分类型
- **🖼️ CLI显示优化**：合并历史记录使用不同图标和颜色区分（🔄 更新/🔧 修复）
- **🐛 Ollama超时修复**：isAvailable()添加abort控制器，避免连接超时阻塞

### v2.3.0
- **🔄 新增自我更新功能**：支持代码、配置、知识库、依赖等更新类型
- **🔧 新增自动修复功能**：智能体运行时自动检测并修复数据库、网络、依赖、配置等问题
- **🛡️ 新增安全机制**：沙箱执行、人工确认门控、自动回滚确保更新和修复安全性
- **📊 新增更新记录**：`self_update_history` 和 `self_repair_history` 表记录所有更新和修复操作
- **🤖 AI驱动更新**：支持通过自然语言描述让智能体自动生成并执行更新
- **💾 备份管理**：自动创建备份，支持一键回滚到之前版本
- **CLI命令增强**：新增 `/update` 和 `/repair` 命令管理自更新和自修复

### v2.2.14
- 修复模型选择记忆功能，切换提供商后退出再开启会自动恢复上次选择的模型
- 添加活跃提供商持久化到数据库，启动时自动恢复

### v2.2.7
- 修复配置提供商后状态不更新的问题
- 注册/更新提供商后自动刷新缓存

### v2.2.6
- 修复 .env.example 中重复的 MySQL 配置导致 MySQL 默认启用的问题

### v2.2.5
- 修复提供商状态显示错误的问题（异步方法返回 Promise 被当作 true）
- 添加提供商状态缓存机制
- 修复 npm 安装后知识库为空的问题

### v2.2.4
- 修复数据库迁移问题（旧版本数据库缺少 issue_type 列）
- 添加自动迁移逻辑

### v2.2.3
- 移除 postinstall 中下载 WASM 的逻辑，使用 tree-sitter-wasms 包自带的 WASM 文件

### v2.2.2
- 添加 postinstall 脚本自动下载 WASM 文件

### v2.2.1
- 修复 CLI 界面在输入/删除时重复渲染的问题

### v2.2.0
- 优化终端输出兼容性
- 修复方向键选择功能

### v2.1.0
- 添加进度可视化功能
- 所有操作实时展示进度条
- 添加 AI 对话进度条

### v2.0.0
- 完全重构双模式引擎
- 支持离线模式（不依赖云端大模型）
- 优化的 Tree-sitter WASM 解析器加载

### v1.0.0
- 初始版本发布
- 支持代码分析和问题检测
- 支持多个 LLM 提供商

## 📝 License

MIT
