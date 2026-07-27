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
- **AI自持引擎**：实现完整的"监控→分析→决策→执行→验证"闭环，系统能持续自我改进，空闲时自动执行更新和修复
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
