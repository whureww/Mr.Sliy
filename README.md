# Mr.Sliy

基于 Tree-sitter 与 RAG 的多语言代码优化智能体，支持代码分析、问题检测、智能优化等功能。

## ✨ 特性

- **多语言支持**：支持 JavaScript、TypeScript、Python、Java、Go、C++、C#、Rust、Swift、Kotlin、PHP、Ruby、Scala 等 15+ 种编程语言
- **Tree-sitter 解析**：基于 Tree-sitter 的 WASM 解析器，深度分析代码结构
- **问题检测**：内置 14+ 种检测规则，自动检测代码中的潜在问题
- **智能优化**：结合大语言模型提供专业的代码优化建议
- **离线优化**：无网络时基于本地知识库和规则引擎进行代码优化（50+规则、20+模式）
- **知识库管理**：内置 RAG 知识库，支持自定义知识扩展，支持云端数据库同步，包含3000+条知识条目和2100+条优化案例
- **进度可视化**：所有操作都有实时进度条展示，显示实际已用时间
- **CLI 交互**：友好的命令行界面，支持多种交互方式
- **双数据库支持**：支持 SQLite（本地）和 MySQL（云端），自动回退机制，重启后自动记忆连接状态
- **AI自持引擎**：实现完整的"监控→分析→决策→执行→验证"闭环，系统能持续自我改进，空闲时自动执行更新和修复
- **统一错误处理**：标准化错误分类、处理和日志记录，提升系统稳定性
- **安全增强**：输入验证、参数化查询、JWT认证、密码哈希等安全措施
- **性能优化**：AST解析缓存、并行规则执行、数据库批量同步、指数退避重试
- **沙箱服务架构**：基于 Worker Threads 的服务隔离架构，每个功能模块独立运行，支持热替换，单一功能崩溃不影响其他服务

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

启动后输入 `/config` 进入配置管理：

1. 选择 `1) 提供商管理` → `2) 注册新提供商`
2. 输入提供商名称（如 `deepseek`、`zhipu`、`tongyi`）
3. 输入 API Key
4. 选择 `1) 切换` 到新注册的提供商
5. 开始使用 AI 功能！

### 配置云端数据库

启动后输入 `/config` 进入配置管理：

1. 选择 `2) 知识库管理`
2. 选择数据库连接配置选项
3. 输入 MySQL 连接信息（主机、端口、用户名、密码、数据库名）
4. 测试连接并设置为默认连接
5. **重启后自动使用云端数据库，无需重新切换**

### 离线使用

如果不想使用云端大模型，可以：
1. 输入 `/config` → `3) 模式切换` 切换到"离线模式"
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
| `/analyze` | 代码分析（分析文件 / 扫描项目） |
| `/optimize` | 交互式代码优化 |
| `/sustain` | AI自持引擎（仪表盘 / 引擎控制 / AI分析 / 手动更新 / 手动修复 / 规则管理 / 遥测数据 / 验证统计） |
| `/config` | 配置管理（提供商管理 / 知识库管理 / 模式切换） |
| `/status` | 系统状态（查看状态 / 健康检查） |
| `/pending` | 待处理确认队列 |
| `/help` | 显示帮助文档 |
| `/clear` | 清空屏幕 |
| `/exit` | 退出程序 |

### 交互方式

- 输入 `/` 可快速搜索命令
- 使用 `↑↓` 方向键选择命令
- 按 `Tab` 自动补全
- 按 `Enter` 确认执行
- 直接输入文字与 AI 聊天
- 在子菜单中输入 `q` 或 `quit` 返回主菜单

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
│   ├── code-analysis/      # 代码分析子技能
│   │   ├── index.js                    # 主入口
│   │   ├── complexityAnalysis.js       # 复杂度分析（圈复杂度、认知复杂度）
│   │   ├── securityDetection.js        # 安全检测（XSS、SQL注入、硬编码密钥）
│   │   └── performanceOptimization.js  # 性能优化分析（循环效率、内存问题）
│   ├── code-detection/     # 代码问题检测
│   │   ├── index.js
│   │   └── rules/          # 检测规则（14+规则）
│   ├── code-optimization/  # 代码优化子技能
│   │   └── index.js        # 自动修复策略（8+策略）
│   ├── code-generation/    # 代码生成（参考 superpowers）
│   │   └── index.js        # 需求→代码、单元测试、模拟数据
│   ├── code-refactoring/   # 代码重构（参考 superpowers）
│   │   └── index.js        # 提取方法、内联、重命名、简化条件
│   ├── code-debugging/     # 代码调试（参考 superpowers）
│   │   └── index.js        # 错误分析、问题诊断、潜在bug检测
│   ├── documentation/      # 文档生成（参考 superpowers）
│   │   └── index.js        # 代码文档、API文档、README、架构文档
│   ├── database/           # 数据库开发（参考 supabase/agent-skills）
│   │   └── index.js        # 表结构生成、SQL查询、数据库迁移、ER图
│   ├── security-audit/     # 安全审计（参考 auditor-skill）
│   │   └── index.js        # 全面安全审计、深度分析、审计报告
│   ├── Skill.js            # 技能基类
│   └── index.js            # 技能管理器
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
