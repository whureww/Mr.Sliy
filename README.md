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
│   ├── agent.js            # 智能体主类
│   └── startup.js          # 启动初始化
├── cli/                    # 命令行界面
│   └── index.js            # CLI入口和交互逻辑
├── config/                 # 配置管理
│   └── index.js            # 配置加载和管理
├── core/                   # 核心组件
│   └── agentInitializer.js # Agent初始化器
├── engine/                 # 双模式引擎
│   ├── dualModeEngine.js   # 在线/离线双模引擎
│   └── sustainCycle.js     # 自持周期管理
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
├── scheduler/              # 任务调度
│   └── taskScheduler.js    # 定时任务调度器
├── services/
│   ├── ast/                # Tree-sitter AST 解析
│   │   └── parser.js
│   ├── bootstrap/          # 自更新与自修复
│   │   ├── confirmationGate.js  # 门控确认
│   │   ├── rollback.js          # 回滚机制
│   │   ├── selfRepairManager.js # 自修复管理
│   │   ├── selfUpdateManager.js # 自更新管理
│   │   ├── selfSustainEngine.js # 自持引擎核心
│   │   ├── analysisEngine.js    # AI分析引擎
│   │   ├── ruleEngine.js        # 规则引擎
│   │   ├── telemetry.js         # 遥测数据收集
│   │   └── validator.js         # 效果验证器
│   ├── detection/          # 问题检测器
│   │   └── detector.js
│   ├── llm/                # LLM 提供商适配
│   │   └── providers.js
│   ├── optimization/       # 优化引擎
│   │   ├── optimizer.js         # 优化器主类
│   │   ├── patternEngine.js     # 模式推理引擎
│   │   ├── ruleEngine.js        # 规则引擎
│   │   └── semanticAnalyzer.js  # 语义分析引擎
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
│   ├── crypto.js           # 加密工具
│   ├── database.js         # 数据库抽象层
│   ├── dbAdapter.js        # 数据库适配器（双写同步）
│   ├── eventBus.js         # 事件总线
│   ├── helpers.js          # 辅助函数
│   ├── logger.js           # 日志系统
│   ├── memoryManager.js    # 内存管理
│   ├── moduleRegistry.js   # 模块注册中心
│   ├── mysql.js            # MySQL 连接工具
│   ├── notificationSystem.js # 通知系统
│   ├── progress.js         # 进度条
│   ├── response.js         # 响应处理
│   ├── systemMonitor.js    # 系统监控
│   └── telemetry.js        # 遥测数据
├── workers/                # Worker 线程池
│   ├── parser.js           # 解析器Worker
│   └── pool.js             # 线程池管理
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

### v3.2.0
> 更新日期: 2026-07-23

- **🐛 LLM提供商配置修复**：修复大模型提供商注册后无法切换和显示已配置状态的问题
  - **数据库查询修复**：`getLLMKeyFromDB` 函数改用 JavaScript `find()` 方法匹配记录，解决 `better-sqlite3` 参数化查询问题
  - **is_active条件移除**：移除查询条件中的 `AND is_active = 1`，简化查询逻辑
- **🔧 云端同步状态优化**：将"云端同步状态"改为"上次同步"，显示相对时间（从未同步/刚刚/X分钟前/X小时前/X天前）
- **🐛 切换连接逻辑修复**：修复切换默认连接时自动同步数据的问题，切换连接仅切换连接，不同步数据
- **🐛 confirmation_history表同步修复**：修复从云端下载数据时 `created_at` NOT NULL 约束失败问题
  - **无效日期处理**：MySQL返回的无效Date对象（`0000-00-00`）转换为默认日期 `1970-01-01 00:00:00`
  - **空字符串处理**：空字符串转换为默认日期或null，确保NOT NULL约束满足
- **🔧 日期格式转换优化**：ISO日期字符串（如 `2026-07-22T04:55:52.000Z`）正确转换为MySQL兼容格式

### v3.1.9
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的多个问题
  - **ai_analysis_records时间戳修复**：`timestamp` 字段是 `BIGINT` 类型，不应转换为 DATETIME，修复数据截断错误
  - **TEXT字段默认值修复**：移除 TEXT/BLOB/JSON 类型字段的默认值设置，兼容 MySQL 语法要求
  - **sql_mode禁用**：添加 `SET sql_mode = ''` 禁用严格模式，避免日期格式校验错误
  - **DATETIME类型修正**：将 `created_at` 字段从 TIMESTAMP 改为 DATETIME，避免毫秒时间戳插入错误
- **🔧 MySQL备份脚本优化**：重新设计数据库导出脚本，确保生成的SQL文件兼容MySQL 5.5+
  - 支持 BIGINT 时间戳字段
  - 移除 TEXT 字段默认值
  - 禁用严格模式
  - 包含完整表结构和数据

### v3.1.9
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的多个问题
  - **ai_analysis_records时间戳修复**：`timestamp` 字段是 `BIGINT` 类型，不应转换为 DATETIME，修复数据截断错误
  - **TEXT字段默认值修复**：移除 TEXT/BLOB/JSON 类型字段的默认值设置，兼容 MySQL 语法要求
  - **sql_mode禁用**：添加 `SET sql_mode = ''` 禁用严格模式，避免日期格式校验错误
  - **DATETIME类型修正**：将 `created_at` 字段从 TIMESTAMP 改为 DATETIME，避免毫秒时间戳插入错误
- **🔧 MySQL备份脚本优化**：重新设计数据库导出脚本，确保生成的SQL文件兼容MySQL 5.5+
  - 支持 BIGINT 时间戳字段
  - 移除 TEXT 字段默认值
  - 禁用严格模式
  - 包含完整表结构和数据

### v3.1.8
> 更新日期: 2026-07-22

- **知识库扩充**: 扩展200条知识条目，涵盖基础知识、常见问题解答、知识查询等主题

### v3.1.7
> 更新日期: 2026-07-22

- **任务调度器优化**: 新增任务调度器模块，支持定时任务管理和执行

### v3.1.6
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的多个问题
  - **ai_analysis_records时间戳修复**：`timestamp` 字段是 `BIGINT` 类型，不应转换为 DATETIME，修复数据截断错误
  - **缺失表自动创建**：新增 `ensureAllTablesExist()` 函数，`initDatabase()` 完成后检查表数量，自动创建缺失的表
  - **表结构同步增强**：增强 `syncTableSchemaFromSqlite()` 函数，确保从SQLite读取的表结构能正确转换为MySQL格式
- **🔧 表数量验证**：`initDatabase()` 完成后显示实际表数量/期望表数量，表不足时自动补充创建
- **📝 日志增强**：同步过程中添加更多调试日志，便于追踪表创建和数据同步状态

### v3.1.5
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的表结构不一致问题
  - **ai_analysis_records 表修复**：添加缺失的 `execution_result` 字段，修复同步失败问题
  - **新增9张缺失表**：添加 `api_request_log`、`code_analysis_record`、`analysis_result`、`notification`、`system_monitor`、`backup_history`、`kb_import_history`、`dependency_version`、`project_analysis_summary` 表
  - **同步表列表更新**：从23张表增加到32张表，确保所有业务表都能同步到云端
  - **字段自动检测**：更新迁移逻辑，检测到缺少字段时自动重建表结构
- **🔧 表结构自动同步**：新增 `syncTableSchemaFromSqlite()` 函数，当MySQL表不存在时自动从SQLite读取表结构并创建
- **📊 表数量动态统计**：修复 `mysql.js` 中硬编码表数量的问题，改为从 `information_schema.TABLES` 动态查询实际表数量
- **📝 schema.sql完整更新**：更新SQLite初始化脚本，包含全部32张业务表及索引

### v3.1.4
> 更新日期: 2026-07-22

- **📝 日志级别优化**：将同步队列相关的日志级别从 warn 降为 debug，减少控制台噪音