# Mr.Sliy

基于 Tree-sitter 与 RAG 的多语言代码优化智能体，支持代码分析、问题检测、智能优化等功能。

## ✨ 特性

- **多语言支持**：支持 JavaScript、TypeScript、Python、Java、Go、C++、C#、Rust、Swift、Kotlin、PHP、Ruby、Scala 等 15+ 种编程语言
- **Tree-sitter 解析**：基于 Tree-sitter 的 WASM 解析器，深度分析代码结构
- **问题检测**：内置 14+ 种检测规则，自动检测代码中的潜在问题
- **智能优化**：结合大语言模型提供专业的代码优化建议
- **离线优化**：无网络时基于本地知识库和规则引擎进行代码优化（50+规则、20+模式）
- **知识库管理**：内置 RAG 知识库，支持自定义知识扩展，支持云端数据库同步，包含1100+条知识条目和660+条优化案例
- **进度可视化**：所有操作都有实时进度条展示
- **CLI 交互**：友好的命令行界面，支持多种交互方式
- **双数据库支持**：支持 SQLite（本地）和 MySQL（云端），自动回退机制
- **AI自持引擎**：实现完整的"监控→分析→决策→执行→验证"闭环，系统能持续自我改进

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- Windows / macOS / Linux
- MySQL 5.7+（可选，用于云端数据库）

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
- 当前数据库存储类型（SQLite/MySQL）

### 首次使用

启动后输入 `/provider` 进入提供商管理：

1. 选择 `2) 注册新提供商`
2. 输入提供商名称（如 `deepseek`、`zhipu`、`tongyi`）
3. 输入 API Key
4. 选择 `1) 切换` 到新注册的提供商
5. 开始使用 AI 功能！

### 配置云端数据库

启动后输入 `/knowledge` 进入知识库管理：

1. 选择数据库连接配置选项
2. 输入 MySQL 连接信息（主机、端口、用户名、密码、数据库名）
3. 测试连接并设置为默认连接
4. 重启后自动使用云端数据库

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
| `/health` | 健康检查（立即检查、查看状态、历史记录） |
| `/sustain` | AI自持引擎管理（仪表盘、规则管理、AI分析触发、遥测数据） |
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

DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_MODEL=deepseek-chat

ZHIPU_API_KEY=your-zhipu-key
ZHIPU_MODEL=glm-4

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
| DeepSeek | deepseek-chat, deepseek-coder | 深度求索 |
| 智谱 AI | glm-4, glm-3-turbo | 清华智谱 |
| 通义千问 | qwen-plus, qwen-max | 阿里云 |
| Moonshot | kimi-chat, moonshot-v1-8k | 月之暗面 |
| Ollama | codellama, llama2 | 本地部署模型 |

## 🗂️ 项目结构

```
src/
├── agent/                  # 智能体核心逻辑
│   └── agent.js
├── cli/                    # 命令行界面
│   └── index.js
├── config/                 # 配置管理
│   └── index.js
├── engine/                 # 双模式引擎（在线/离线）
│   └── dualModeEngine.js
├── middlewares/            # Express 中间件
│   ├── errorHandler.js
│   └── index.js
├── routes/                 # API 路由
│   ├── aiRoutes.js
│   ├── configRoutes.js
│   ├── issueRoutes.js
│   ├── projectRoutes.js
│   ├── reportRoutes.js
│   ├── scanRoutes.js
│   ├── updateRoutes.js
│   └── userRoutes.js
├── services/
│   ├── ast/                # Tree-sitter AST 解析
│   │   └── parser.js
│   ├── bootstrap/          # 自更新与自修复
│   │   ├── confirmationGate.js
│   │   ├── rollback.js
│   │   ├── selfRepairManager.js
│   │   ├── selfUpdateManager.js
│   │   ├── selfSustainEngine.js
│   │   ├── analysisEngine.js
│   │   ├── ruleEngine.js
│   │   ├── telemetry.js
│   │   └── validator.js
│   ├── detection/          # 问题检测器
│   │   └── detector.js
│   ├── llm/                # LLM 提供商适配
│   │   └── providers.js
│   ├── rag/                # RAG 知识库
│   │   └── agent.js
│   └── vector/             # 向量数据库
│       └── knowledgeBase.js
├── skills/                 # 技能模块
│   ├── code-analysis/
│   ├── code-detection/
│   │   └── rules/          # 检测规则
│   └── code-optimization/
├── utils/                  # 工具函数
│   ├── crypto.js
│   ├── database.js         # 数据库抽象层
│   ├── eventBus.js
│   ├── helpers.js
│   ├── logger.js
│   ├── moduleRegistry.js
│   ├── mysql.js            # MySQL 连接工具
│   ├── progress.js
│   ├── response.js
│   └── systemMonitor.js
├── workers/                # Worker 线程池
│   ├── parser.js
│   └── pool.js
├── agent.js                # CLI 入口
└── index.js                # Web 服务入口
```

## 🛡️ 安全

- API Key 存储在本地数据库中，不暴露在代码或配置文件中
- 使用 `.npmignore` 排除敏感文件
- 支持加密配置存储
- 不上传任何代码或数据到第三方服务器

## 📊 数据库架构

### 支持的数据库

| 数据库类型 | 适用场景 | 特性 |
|------------|----------|------|
| SQLite | 本地开发、离线使用 | 无需额外安装，文件存储 |
| MySQL | 云端部署、多实例同步 | 支持远程连接，数据同步 |

### 自动回退机制

当 MySQL 连接不可用时，系统会自动回退到 SQLite，确保服务正常运行：

1. MySQL 连接池创建失败 → 使用 SQLite
2. MySQL 查询失败 → 记录日志并使用 SQLite
3. MySQL 表初始化失败 → 使用 SQLite

## 📝 更新日志

### v2.9.4
> 更新日期: 2026-07-18

- **🐛 启动告警修复**：修复 `agent.init()` 被重复调用导致的启动告警问题，将 `systemMonitor`、`analysisEngine`、`selfSustainEngine` 的"已在运行中"日志级别从 `warn` 改为 `debug`，启动时不再显示不必要的告警信息

### v2.9.3
> 更新日期: 2026-07-18

- **代码更新**: AI生成的更新

### v2.9.2
> 更新日期: 2026-07-18

- **🐛 规则引擎启动保护**：添加5分钟启动保护期，避免启动时因指标为0误触发更新；为所有指标规则添加最小样本数限制（优化成功率需10次请求、知识库命中率需20次查询、提供商失败率需5次调用），确保只有真正出现问题才触发自更新或自修复
- **🐛 MySQL缺失表修复**：在 `mysql.js` 的 `initDatabase()` 中添加 `self_update_history`、`self_repair_history`、`confirmation_history` 表创建逻辑，以及缺失字段的 `ALTER TABLE` 语句，修复"更新记录失败: no such column: version_after"错误
- **🐛 README更新修复**：修改 `updateReadme()` 函数的匹配逻辑，从匹配"## 📝 更新日志"标题改为直接匹配"### v[\d.]+"版本号格式，确保README更新正常工作
- **🐛 process.stdout.flush错误修复**：在 `ask()` 和 `handleAIChat()` 函数中添加 `typeof process.stdout.flush === 'function'` 检查，避免在不支持该方法的终端环境下报错
- **🐛 自修复重启策略修复**：修改 `repairRuntime` 的 `restart_service` 策略，不再直接调用 `process.exit(0)`，改为提示用户手动重启；在 `autoRepairHandler` 中添加无害运行时错误过滤（如 `process.stdout.flush is not a function`），避免小错误触发自动修复和智能体关闭
- **🔧 验证器增强**：添加 `validateCycle()` 方法，为 cycle 类型验证提供更合适的验证策略（检查错误数量是否增加、系统是否稳定）
- **🔧 规则自动升级**：启动时自动为数据库中已存在的旧规则添加 `minSamples` 参数

### v2.9.1
> 更新日期: 2026-07-18

- **知识库更新**: AI生成的更新

### v2.9.0
> 更新日期: 2026-07-18

- **知识库更新**: AI生成的更新

### v2.8.1
> 更新日期: 2026-07-18

- **🚀 AI自持引擎**：实现完整的AI自持闭环系统，支持自主监控、分析、决策、执行和验证
- **✨ 遥测数据收集**：新建 `telemetry.js`，全面收集系统运行指标（优化成功率、知识命中率、提供商可靠性等）
- **✨ 规则引擎**：新建 `ruleEngine.js`，支持基于阈值的自动决策（提供商切换、知识库扩充、AI分析触发等）
- **✨ AI分析引擎**：新建 `analysisEngine.js`，定期调用LLM分析系统数据，生成改进建议并自动执行
- **✨ 效果验证器**：新建 `validator.js`，验证更新/修复/优化的实际效果，计算改进分数
- **✨ 自持引擎核心**：新建 `selfSustainEngine.js`，协调所有自持模块，每5分钟执行一次自持周期
- **✨ CLI自持管理**：新增 `/sustain` 命令，提供仪表盘、规则管理、AI分析触发、遥测数据查看等功能
- **🔧 闭环架构**：实现"监控→分析→决策→执行→验证"的完整闭环，系统能持续自我改进

### v2.7.10
> 更新日期: 2026-07-17

- **✨ 基础自持系统完善**：方案A全部功能实现完成，所有核心业务功能测试通过
- **✅ 功能验证**：代码分析、知识库管理、提供商管理、云端同步等所有原有功能均正常运行
- **✅ 健康检查验证**：数据库、网络、内存、提供商、依赖五项检查全部通过
- **✅ 系统监控验证**：系统监控自动启动，每分钟健康检查正常执行
- **🔧 代码优化**：优化事件驱动流程，确保自动修复和警告处理机制稳定可靠

### v2.7.9
> 更新日期: 2026-07-17

- **✨ 基础自持系统**：实现事件驱动的自动修复和系统监控能力
- **✨ 系统监控模块**：新建 `systemMonitor.js`，每分钟自动检查系统状态（数据库、网络、内存、提供商、依赖）
- **✨ 事件驱动修复**：扩展 EventBus 添加系统事件常量，`selfRepairManager` 自动响应 `system_error` 事件
- **✨ 系统警告处理**：`selfUpdateManager` 自动响应 `system_warning` 事件，支持知识库命中率低时自动建议扩充
- **✨ CLI健康检查**：新增 `/health` 命令，支持立即执行健康检查、查看健康状态、查看历史记录
- **✨ 系统状态显示**：在 `/status` 命令中添加系统健康状态展示

### v2.7.8
> 更新日期: 2026-07-17

- **✨ 知识库重复检测**：新增重复条目检测功能，基于内容分组识别重复的知识条目和优化案例
- **✨ 重复条目删除**：支持一键删除重复条目，保留每组重复条目的第一条记录
- **✨ 云端同步模式选择**：上传到云端时支持三种模式——合并更新（有则更新无则添加）、覆盖云端（删除云端所有数据后重新上传）、仅追加（只添加新数据不更新已有数据）
- **✨ CLI界面增强**：知识库管理菜单新增"检测重复条目"选项，上传到云端时显示模式选择菜单

### v2.7.7
> 更新日期: 2026-07-17

- **🐛 云端同步修复**：修复测试连接成功后 `mysqlAvailable` 状态未更新导致同步失败的问题，现在测试连接成功后会正确更新状态，确保上传和下载操作正常执行

### v2.7.6
> 更新日期: 2026-07-17

- **🐛 测试连接失败修复**：修复添加数据库连接后测试连接失败导致智能体关闭的问题，将 mysql 模块提前导入并添加 try-catch 错误处理，确保测试连接失败时不会触发未处理的 Promise 拒绝
- **🐛 自动修复误触发修复**：测试连接失败不再触发自动修复流程，避免智能体因普通连接测试失败而关闭

### v2.7.5
> 更新日期: 2026-07-17

- **✨ 知识库大幅扩充**：基于《代码优化与代码检测完整知识库》文档，扩充至1131条知识条目和660条优化案例
- **✨ 多语言支持扩展**：新增 TypeScript、C++、C#、Rust、Swift、Kotlin、PHP、Ruby、Scala、SQL 等语言的优化案例和知识条目
- **🐛 云端同步修复**：修复从云端下载到本地时 `UNIQUE constraint failed: kb_entries.id` 错误，同步时强制写入 SQLite 并先清空本地数据
- **✨ 知识库备份工具**：添加 SQL 导出功能，支持将知识库导出为 SQL 文件用于云端备份
- **✨ 智能优化决策引擎**：协调语义分析、规则优化、模式推理和知识库优化，根据代码复杂度和网络状态自动选择优化策略

### v2.7.4
> 更新日期: 2026-07-17

- **✨ 语义分析引擎**：基于Tree-sitter的AST语义分析，提取代码特征、检测反模式、计算复杂度和可读性
- **✨ 扩展规则引擎**：50+ JavaScript优化规则，涵盖现代化、性能优化、可读性提升等多个维度
- **✨ 模式推理引擎**：20+ AST模式匹配规则，支持回调转Promise、Promise转async/await、魔法数字转常量等高级优化
- **✨ 智能优化决策引擎**：自动选择最优优化策略，优先使用在线AI，失败后自动回退到离线模式

### v2.7.3
> 更新日期: 2026-07-17

- **✨ 增强离线代码优化**：实现纯算法的增强方案，在线时使用云端AI，离线时使用本地知识库和规则引擎
- **✨ 语义分析引擎**：基于Tree-sitter的AST语义分析，提取代码特征、检测反模式、计算复杂度和可读性

### v2.7.2
> 更新日期: 2026-07-17

- **🐛 MySQL 索引创建修复**：修复 MySQL 不支持 `CREATE INDEX IF NOT EXISTS` 语法的问题，改用 `CREATE INDEX` 并忽略重复索引错误
- **🐛 sqlite3 模块修复**：修复项目使用 `better-sqlite3` 而非 `sqlite3` 的模块引用错误
- **🐛 db.prepare is not a function 修复**：添加 `getSqliteDatabase()` 函数，替换所有直接使用 `getDatabase()` 的地方，确保 MySQL 启用时回退到 SQLite 能正确获取 SQLite 数据库实例
- **🔧 isUsingMySql() 优化**：检查实际连接池状态而非仅检查配置，确保数据库切换逻辑正确
- **🔧 数据库调用统一**：修复知识图谱、路由、日志等模块的数据库调用，确保 SQLite 模式下正常工作
