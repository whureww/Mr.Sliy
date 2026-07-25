# Mr.Sliy

基于 Tree-sitter 与 RAG 的多语言代码优化智能体，支持代码分析、问题检测、智能优化等功能。

## ✨ 特性

- **多语言支持**：支持 JavaScript、TypeScript、Python、Java、Go、C++、C#、Rust、Swift、Kotlin、PHP、Ruby、Scala 等 15+ 种编程语言
- **Tree-sitter 解析**：基于 Tree-sitter 的 WASM 解析器，深度分析代码结构
- **问题检测**：内置 14+ 种检测规则，自动检测代码中的潜在问题
- **智能优化**：结合大语言模型提供专业的代码优化建议
- **离线优化**：无网络时基于本地知识库和规则引擎进行代码优化（50+规则、20+模式）
- **知识库管理**：内置 RAG 知识库，支持自定义知识扩展，支持云端数据库同步，包含1100+条知识条目和660+条优化案例
- **进度可视化**：所有操作都有实时进度条展示，显示实际已用时间
- **CLI 交互**：友好的命令行界面，支持多种交互方式
- **双数据库支持**：支持 SQLite（本地）和 MySQL（云端），自动回退机制，重启后自动记忆连接状态
- **AI自持引擎**：实现完整的"监控→分析→决策→执行→验证"闭环，系统能持续自我改进
- **统一错误处理**：标准化错误分类、处理和日志记录，提升系统稳定性
- **安全增强**：输入验证、参数化查询、JWT认证、密码哈希等安全措施
- **性能优化**：AST解析缓存、并行规则执行、数据库批量同步、指数退避重试

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
- 创建配置文件（`~/.mr-sliy/database_connections.json`）
- 初始化数据库（`~/.mr-sliy/database/code_optimizer.db`）
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
- 上次云端同步时间

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
4. **重启后自动使用云端数据库，无需重新切换**

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

配置文件位于用户主目录：

```bash
# 数据库连接配置
~/.mr-sliy/database_connections.json

# SQLite数据库文件
~/.mr-sliy/database/code_optimizer.db
```

环境变量配置（`.env`）：

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
├── routes/                 # API 路由
├── scheduler/              # 任务调度
│   └── taskScheduler.js    # 定时任务调度器
├── services/
│   ├── ast/                # Tree-sitter AST 解析
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
│   ├── llm/                # LLM 提供商适配
│   ├── optimization/       # 优化引擎
│   ├── rag/                # RAG 知识库
│   └── vector/             # 向量数据库
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
├── agent.js                # CLI 入口
└── index.js                # Web 服务入口
```

## 🛡️ 安全

- API Key 存储在本地数据库中，不暴露在代码或配置文件中
- 使用 `.npmignore` 和 `.gitignore` 排除敏感文件（数据库文件、日志、备份目录等）
- 支持加密配置存储
- 不上传任何代码或数据到第三方服务器
- 历史提交中的敏感文件已清理

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

### 双向同步

- **上传到云端**：将本地 SQLite 数据同步到云端 MySQL
- **从云端下载**：将云端 MySQL 数据同步回本地 SQLite
- **自动记忆**：重启后自动加载上次配置的数据库连接，无需重新切换

## 📝 更新日志

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

### v3.5.6
> 更新日期: 2026-07-25

- **🔍 添加数据库表结构同步工具**：创建 `scripts/syncTables.js` 脚本
  - 检查本地SQLite和云端MySQL数据库的表结构一致性
  - 自动检测缺失的业务表、多余的表和临时表
  - 支持交互式修复：删除临时表、删除多余表、创建缺失表
  - 确保从云端下载和数据同步时能够成功执行
  - 定义了32张标准业务表列表，确保本地和云端表结构一致

### v3.5.5
> 更新日期: 2026-07-25

- **🐛 修复同步队列表缺失 `next_retry_at` 列的问题**：修复 `dbAdapter.js` 中的表结构定义
  - 在 `sync_queue` 表定义中添加了缺失的 `next_retry_at DATETIME` 列
  - 添加了兼容旧数据库的迁移逻辑，使用 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 自动补全缺失列
  - 修复了定时重试任务中更新 `next_retry_at` 列导致的 `no such column` 错误

### v3.5.4
> 更新日期: 2026-07-25

- **🐛 修复主页面输入时频繁重渲染的问题**：优化 `cli/index.js` 中的输入处理逻辑
  - 普通模式下输入：只追加字符，不再触发全界面重渲染
  - 命令模式下输入：只有当命令匹配结果发生变化时才重新渲染
  - 模式切换时（进入/退出命令模式）：重新渲染以更新提示信息
  - 退格键处理：同样遵循上述规则，匹配结果不变时只删除字符

### v3.5.3
> 更新日期: 2026-07-25

- **🐛 修复循环依赖警告**：彻底解决 `config/index.js` 和 `utils/logger.js` 之间的循环依赖问题
  - 在 `config/index.js` 中使用延迟加载 `getLogger()` 函数替代直接导入 logger
  - 在 `utils/logger.js` 中使用延迟加载 `getConfig()` 函数替代直接导入 config
  - 启动时不再出现 `Accessing non-existent property 'config' of module exports inside circular dependency` 警告

### v3.5.2
> 更新日期: 2026-07-25

- **🐛 修复输入框每次输入字符都重渲染界面的问题**：优化 `cli/index.js` 中的输入处理逻辑
  - 修改 `showMenu()` 函数中的字符输入处理，只有当命令匹配结果发生变化时才重新渲染整个界面
  - 否则只追加字符到当前行，避免不必要的全屏重绘
  - 同样优化了退格键处理，匹配结果不变时只删除单个字符

### v3.5.1
> 更新日期: 2026-07-25

- **🐛 修复循环依赖导致的启动错误**：修复 `logger.js` 和 `config/index.js` 之间的循环依赖问题
  - 使用延迟加载（lazy require）方式获取配置，避免模块初始化时的循环引用
  - 添加默认日志配置作为初始化阶段的fallback
  - 修复后智能体启动不再报错

### v3.5.0
> 更新日期: 2026-07-25

- **🔧 代码架构优化**：完成6大方案的代码提升
  - **方案一：错误处理与日志规范化**：创建统一错误处理模块（`utils/errorHandler.js`），定义标准化错误类型，实现错误分类、日志记录和处理函数
  - **方案二：数据库同步性能优化**：实现批量同步、指数退避重试、同步队列机制，提升数据同步效率和可靠性
  - **方案三：AST解析性能优化**：实现AST解析结果缓存（5分钟TTL）、并行规则执行，减少重复解析开销
  - **方案四：代码架构模块化**：分离CLI和API服务，抽取公共模块，完善Express中间件和路由体系
  - **方案五：安全性增强**：创建输入验证模块（`utils/validator.js`）、JWT认证模块（`utils/auth.js`），实现参数化查询、密码哈希、API密钥管理
  - **方案六：测试覆盖**：编写单元测试（validator、auth、errorHandler），覆盖核心工具函数

### v3.4.9
> 更新日期: 2026-07-25

- **🐛 修复重启后云端同步仍需切换连接**：修复重启后 MySQL 连接健康状态未更新导致 `isEnabled()` 返回 `false` 的问题
  - 在 `engine/dualModeEngine.js` 的启动初始化中添加 `await mysql.checkConnectionHealth()` 调用
  - 确保启动时正确更新 `connectionHealthy` 状态
  - 修复后重启智能体可以直接进行云端同步，无需重新切换连接

### v3.4.8
> 更新日期: 2026-07-25

- **🐛 修复重启后数据库同步状态丢失**：修复智能体重启后无法记忆上次配置的数据库连接状态问题
  - 在 `config/index.js` 中添加从文件配置初始化 `config.mysql` 对象的逻辑
  - 在 `engine/dualModeEngine.js` 中添加启动时自动初始化 MySQL 连接的逻辑
  - 修复后重启智能体会自动加载上次配置的数据库连接

### v3.4.7
> 更新日期: 2026-07-25

- **🐛 修复启动报错 SyntaxError**：修复 `showNotification` 函数中 `await` 在非 async 函数中使用导致的语法错误
  - 将 Promise 回调改为 `async (resolve) => { ... }`，使 `await ask()` 可以正常使用
  - 修复后使用 `node src/agent.js` 启动不再报错

### v3.4.6
> 更新日期: 2026-07-25

- **🐛 修复修复提示无法输入**：修复 `showNotification` 函数中修复提示弹窗无法输入操作选项的问题
  - 将 `process.stdin.once('keypress', handleKey)` 方式改为使用项目统一的 `ask()` 函数
  - 修复后用户可以正常在修复提示弹窗中输入 1/2/0 选择操作

### v3.4.5
> 更新日期: 2026-07-25

- **🐛 修复请求队列功能**：修复 `getInput` 函数未定义导致请求队列无法使用的问题
  - 将 `cli/index.js` 第2442行的 `getInput()` 改为项目中已定义的 `ask()` 函数
  - 修复后用户可以正常确认或拒绝待处理请求
- **🐛 修复自动修复记录保存失败**：修复 `selfRepairManager.js` 中 `saveRepairRecord` 方法缺少 `created_at` 字段导致的 NOT NULL 约束错误
  - 在 INSERT 语句中添加 `created_at` 字段和对应的时间戳参数
  - 确保修复记录可以正常保存到数据库

### v3.4.3
> 更新日期: 2026-07-25

- **🐛 修复AI分析保存记录失败**：修复 `saveUpdateRecord` 方法缺少 `created_at` 字段导致的 NOT NULL 约束错误
  - 在 `selfUpdateManager.js` 的 INSERT 语句中添加 `created_at` 字段
  - 在 `rollback.js` 的两个 INSERT 语句中添加 `created_at` 字段
  - 确保所有 `self_update_history` 表的插入操作都包含时间戳

### v3.4.2
> 更新日期: 2026-07-25

- **⏱️ 进度条时间显示优化**：修复AI对话进度条计时不符合实际工作时间的问题
  - 在 `startAnimation()` 中初始化 `startTime`，确保计时从进度条开始动画时算起
  - 将 ETA（预计剩余时间）改为显示已用时间（⏱️）

### v3.4.1
> 更新日期: 2026-07-25

- **⏱️ 进度条时间计数修复**：修复进度条 ETA 计算时间不准确的问题
  - 将 `startTime` 从构造函数初始化改为延迟初始化（第一次更新时设置）

### v3.4.0
> 更新日期: 2026-07-25

- **🔧 配置文件路径修复**：修复数据库连接配置文件路径使用相对路径的问题
  - 将 `CONFIG_FILE` 路径从 `./data/database_connections.json` 改为 `~/.mr-sliy/database_connections.json`
- **🔄 列重命名数据迁移**：添加列重命名数据迁移逻辑，避免数据丢失
- **🔄 主键类型迁移**：为主键类型不匹配的表添加表重建迁移逻辑
- **📋 旧数据库迁移提示**：添加旧数据库检测和迁移提示功能

### v3.3.9
> 更新日期: 2026-07-24

- **🐛 全局安装数据库路径修复**：修复全局安装后数据库路径使用相对路径导致数据不一致的问题

### v3.3.8
> 更新日期: 2026-07-24

- **🔧 SQLite表结构迁移**：添加 `migrateSqliteTables()` 函数，自动检测并添加缺失的列到现有数据库文件

### v3.3.7
> 更新日期: 2026-07-24

- **🐛 数据库表结构修复**：修复 `dbAdapter.js` 中所有表结构定义与 `schema.sql` 不一致的问题，涉及20张表的115个缺失列

### v3.3.6
> 更新日期: 2026-07-23

- **🐛 LLM提供商配置修复**：修复大模型提供商注册后无法切换和显示已配置状态的问题
- **🔧 云端同步状态优化**：将"云端同步状态"改为"上次同步"，显示相对时间

### v3.3.5
> 更新日期: 2026-07-23

- **🐛 切换连接逻辑修复**：修复切换默认连接时自动同步数据的问题，切换连接仅切换连接，不同步数据

### v3.3.4
> 更新日期: 2026-07-23

- **🐛 confirmation_history表同步修复**：修复从云端下载数据时 `created_at` NOT NULL 约束失败问题
- **🔧 日期格式转换优化**：ISO日期字符串正确转换为MySQL兼容格式

### v3.3.3
> 更新日期: 2026-07-23

- **🐛 数据库同步修复**：修复同步过程中表结构不一致导致的失败问题

### v3.3.2
> 更新日期: 2026-07-23

- **🐛 数据库同步修复**：修复同步过程中表结构不一致导致的失败问题

### v3.3.1
> 更新日期: 2026-07-23

- **🐛 数据库同步修复**：修复同步过程中的多个关键问题
  - **MySQL sql_mode 兼容**：在事务开始时执行 `SET sql_mode = ''`
  - **数据库路径修复**：全局安装时使用用户目录存储数据库

### v3.3.0
> 更新日期: 2026-07-23

- **🐛 知识条目插入失败修复**：修复启动时知识条目插入失败的告警问题
  - **表结构自动迁移**：新增 `_ensureTableStructure` 函数

### v3.2.9
> 更新日期: 2026-07-22

- **🐛 知识条目插入失败修复**：修复启动时知识条目插入失败的告警问题
  - **UUID主键查询优化**：修改 `adaptSqliteResultForMysql` 函数

### v3.2.8
> 更新日期: 2026-07-22

- **🐛 知识条目插入失败修复**：修复启动时知识条目插入失败的告警问题
  - **ISO日期字符串处理**：在 `convertTimestampParams` 函数中添加对 ISO 日期字符串的处理

### v3.2.7
> 更新日期: 2026-07-22

- **知识库扩充**: 扩展200条知识条目

### v3.2.6
> 更新日期: 2026-07-22

- **任务调度器优化**: 新增任务调度器模块

### v3.2.5
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的多个问题
  - **ai_analysis_records时间戳修复**：`timestamp` 字段是 `BIGINT` 类型，不应转换为 DATETIME
  - **缺失表自动创建**：新增 `ensureAllTablesExist()` 函数

### v3.2.4
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的表结构不一致问题
  - **ai_analysis_records 表修复**：添加缺失的 `execution_result` 字段
  - **新增9张缺失表**：添加 `api_request_log`、`code_analysis_record`、`analysis_result`、`notification`、`system_monitor`、`backup_history`、`kb_import_history`、`dependency_version`、`project_analysis_summary` 表

### v3.2.2
> 更新日期: 2026-07-22

- **🐛 sustain_rules表结构修复**：修复与规则引擎代码不一致的问题

### v3.2.1
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复同步过程中的表结构不一致问题
  - **rule_execution_log表结构修复**

### v3.2.0
> 更新日期: 2026-07-22

- **🔧 新增从云端下载功能**：实现完整的 `syncRemoteToLocal` 和 `syncAllRemoteToLocal` 函数

### v3.1.10
> 更新日期: 2026-07-22

- **📝 日志级别优化**：将同步队列相关的日志级别从 warn 降为 debug

### v3.1.9
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的多个问题

### v3.1.8
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复MySQL同步过程中的表结构不一致问题

### v3.1.7
> 更新日期: 2026-07-22

- **📊 表数量动态统计**：修复 `mysql.js` 中硬编码表数量的问题

### v3.1.6
> 更新日期: 2026-07-22

- **🐛 数据库同步修复**：修复同步过程中的表结构不一致问题

### v3.1.5
> 更新日期: 2026-07-22

- **🐛 sustain_rules表结构修复**：修复与规则引擎代码不一致的问题

### v3.1.4
> 更新日期: 2026-07-22

- **📝 日志级别优化**：将同步队列相关的日志级别从 warn 降为 debug

### v3.1.3
> 更新日期: 2026-07-22

- **🔧 同步逻辑优化**：改进同步流程，确保云端数据能正确下载到本地

### v3.1.2
> 更新日期: 2026-07-22

- **🛡️ 数据安全保护**：添加同步安全检查，防止本地数据过少覆盖云端数据

### v3.1.1
> 更新日期: 2026-07-22

- **🧹 临时表清理**：添加自动清理临时表功能

### v3.1.0
> 更新日期: 2026-07-22

- **🐛 MySQL类型转换修复**：修复从云端下载数据到本地时的类型转换错误

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

### v1.2.0
> 更新日期: 2026-07-15

- **🔧 新增代码扫描功能**：支持项目目录扫描，批量分析代码
- **🔧 新增问题检测规则**：内置14+种检测规则
- **🔧 新增进度可视化**：所有操作都有实时进度条展示

### v1.1.0
> 更新日期: 2026-07-10

- **🔧 新增智能优化**：结合大语言模型提供专业的代码优化建议
- **🔧 新增CLI交互**：友好的命令行界面

### v1.0.0
> 更新日期: 2026-07-01

- **🎉 首次发布**：基于Tree-sitter的代码分析工具
