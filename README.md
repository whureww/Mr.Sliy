# 基于 Tree-sitter 与 RAG 的多语言代码优化智能体

## 更新日志

### v2.4.7 (2026-07-13)

#### 🐛 Bug修复
- **标题对齐修复**：修复智能体大标题文字无法对齐的问题，新增 `stripAnsi()`、`getDisplayWidth()`、`padEndDisplay()` 工具函数正确计算中文字符和emoji的终端显示宽度
- **知识库统计修复**：修复知识库统计显示 `undefined` 的问题，新增缓存统计信息机制（`cachedStats`），`getStatus()` 改为同步获取
- **MySQL回退修复**：修复 MySQL 连接失败时未正确回退到 SQLite 的问题，`testConnection()` 和 `initDatabase()` 失败时自动设置 `config.mysql.enabled = false`
- **自更新卡死修复**：修复自更新因缺少 `rollbackManager` 导入导致卡死的问题，添加 LLM API 调用超时机制（120秒）
- **确认门控不显示修复**：修复进度条动画覆盖确认门控输出的问题，备份时排除 `node_modules`、`.git` 等大目录，备份时间从数分钟降至1秒

#### ✨ 新增功能
- **版本自动迭代**：每次更新或修复成功后自动递增版本号，每个版本最多10个小版本（0-9），达到9时自动进位
- **进度反馈增强**：AI智能更新全流程添加进度回调（分析需求→调用AI→解析响应→创建记录→执行更新）
- **数据库回退增强**：`query()`、`queryOne()`、`execute()` 函数在 MySQL 失败时自动回退到 SQLite

#### 🔧 优化改进
- **备份性能优化**：`createBackup()` 排除 `node_modules`、`.git`、`backups`、`logs` 等大目录，新增 `getDirectoryFilesExclude()` 方法
- **确认门控体验**：收到 `status: 'confirming'` 事件时停止进度条动画并清除行内容，确保确认门控正常显示
- **CLI显示增强**：更新成功后显示版本迭代信息（如 `2.4.6 -> 2.4.7`）

---

### v2.4.5 (2026-07-03)

#### 🔧 架构优化
- **重构回滚机制**：回滚作为更新和修复的子模块，不再是独立模块
- **代码结构优化**：删除独立的 rollback.js，回滚逻辑整合到 selfUpdateManager 和 selfRepairManager
- **更新路由结构**：回滚路由改为 `/updates/:id/rollback` 和 `/repairs/:id/rollback`
- **统一模块备份**：使用 moduleRegistry 的备份机制，删除重复的模块备份目录

---

### v2.4.3 (2026-07-03)

#### 🔒 安全增强
- **多步骤门控确认**：在热更新过程中添加3个确认步骤（确认备份完成→确认应用更新→确认更新完成）
- **详细确认信息**：显示风险等级、影响范围、受影响文件、备份状态、回滚可能性
- **优化回滚机制**：支持模块级回滚，确保可以精确回滚到更新前状态
- **确认记录**：所有确认操作记录到数据库，支持查询确认历史
- **请求修改方案**：门控支持用户请求修改方案，拒绝时可说明修改需求

---

### v2.4.2 (2026-07-03)

#### 📊 功能增强
- **更新进度条**：在自更新过程中显示实时进度条，包含详细的更新步骤（加载记录→创建备份→等待确认→应用更新→验证→完成）
- **更新内容预览**：更新前显示更新详情面板，包括更新ID、类型、版本信息和更新内容预览
- **耗时统计**：显示更新操作的总耗时
- **步骤权重**：各步骤按权重计算进度百分比（应用更新40%、验证更新20%等）

---

### v2.4.1 (2026-07-03)

#### ⚡ 性能优化
- **Worker Threads 优化**：将 AST 解析、代码扫描等 CPU 密集操作移入独立 Worker 线程池，防止主线程阻塞卡死
- **线程池管理**：新增 `src/workers/pool.js` 实现线程池，支持自动扩展和任务队列
- **Worker 解析器**：新增 `src/workers/parser.js`，独立初始化 Tree-sitter，与主线程隔离
- **并发解析**：支持多个文件同时解析，显著提升批量分析性能

#### 🐛 Bug修复
- **防止卡死**：主线程不再被 CPU 密集操作阻塞，保持响应流畅

---

### v2.4.0 (2026-07-03)

#### 🔥 架构重构
- **模块独立化架构**：将智能体每个功能模块独立出来，运行中修改个别功能不影响其他功能和智能体运行
- **热替换机制**：替换原有沙箱功能，采用 `delete require.cache + 重新require` 实现模块热替换，无需重启服务
- **ModuleRegistry**：新增模块注册中心，支持 `load/unload/reload` 操作，管理所有功能模块的生命周期
- **EventBus**：新增事件总线，模块间通过事件解耦通信，不再直接引用，降低耦合度

#### 📦 新增功能
- **备份目录结构**：新增 `backups/modules/{模块名}/{时间戳}/` 目录，新旧代码按模块名和时间戳存放，方便回滚
- **更新进度条**：支持实时更新进度和内容显示，用户可清楚看到更新的每一步
- **移除沙箱**：删除 sandbox.js，简化更新流程，采用直接替换+热重载的方式

#### 🛡️ 安全机制
- **自动备份**：更新前自动备份旧模块到 `backups/modules/` 目录
- **自动回滚**：更新失败时自动从备份恢复，确保系统稳定性
- **确认门控**：高危操作（如代码更新）需用户确认后执行

### v2.3.2 (2026-06-30)

#### 🐛 Bug修复
- **CLI箭头键修复**：修复输入 `/` 后上下箭头选择命令失效的问题，增加对 `key.name` 的检测

---

### v2.3.1 (2026-06-30)

#### 📋 功能增强
- **合并历史记录**：新增合并查询更新和修复记录功能，可同时查看所有操作历史
- **修复失败记录优化**：修复失败时显示"自我修复失败"和"系统已回滚"详细信息
- **记录类型标识**：更新和修复记录添加 `type` 字段区分类型
- **CLI显示优化**：合并历史记录使用不同图标和颜色区分（🔄 更新/🔧 修复）

#### 🐛 Bug修复
- **Ollama超时修复**：isAvailable()添加abort控制器，避免连接超时阻塞
- **字段命名修复**：selfUpdateManager.js中字段名自动转换camelCase到snake_case
- **数据库表结构优化**：self_update_history和self_repair_history的id字段改为TEXT支持UUID

---

### v2.3.0 (2026-06-30)

#### 🔄 新增功能
- **自我更新系统**：支持代码、配置、知识库、依赖等更新类型，支持AI驱动更新
- **自动修复机制**：智能体运行时自动检测并修复数据库、网络、依赖、配置等问题
- **沙箱执行环境**：所有更新和修复操作在隔离环境中执行，确保安全
- **人工确认门控**：高危操作需用户显式确认，支持自动确认和超时处理
- **自动回滚机制**：更新失败时自动回滚到之前版本，支持一键回滚
- **更新记录追踪**：`self_update_history` 和 `self_repair_history` 表记录所有操作
- **备份管理**：自动创建备份，支持查看和恢复备份

#### 🛠️ CLI增强
- 新增 `/update` 命令：自更新管理菜单
- 新增 `/repair` 命令：自修复管理菜单
- 新增合并历史记录查看功能

#### 🐛 Bug修复
- **SQL注入风险修复**：knowledgeBase.js改为参数化查询，防止SQL注入攻击
- **数据库表结构统一**：MySQL表字段名与SQLite保持一致（kb_cases/kb_entries）
- **异步调用规范**：dualModeEngine.js中init()调用添加await，避免竞态条件
- **MySQL事务支持**：detector.js中saveDetectionResults函数支持MySQL连接池事务

#### 🔒 安全改进
- **API Key统一存储**：所有LLM提供商API Key统一存储在数据库，通过llm_api_keys表管理
- **配置恢复机制**：启动时自动恢复上次使用的LLM提供商配置
- **机器绑定校验**：配置文件包含机器ID哈希，防止跨设备使用

#### ✨ 功能增强
- **真实AI调用**：RAG优化服务调用真实LLM提供商，移除模拟响应
- **提供商可用性检测**：OllamaProvider.isAvailable改为async，实际验证本地服务状态
- **在线模式判断优化**：AI路由检查可用云端提供商而非配置标志

---

## 项目概述

本项目是一个**独立的代码优化智能体（Agent）**，基于 Tree-sitter AST 语法分析 与 RAG（检索增强生成）技术，支持**离线/在线双模式**运行：

- **离线模式**：本地 AST 静态检测 + 本地 RAG 知识库检索优化
- **在线模式**：AST 检测 + 云端大模型（OpenAI/Claude/Azure等）+ RAG 增强优化

用户可以自由切换云端大模型提供商并配置 API Key，智能体自动适配。

## 隐私保护

### 您的隐私安全保障

本项目**严格保护用户隐私**，所有敏感数据都采用多层安全措施：

#### 🔒 敏感数据隔离

- **API Key 加密存储**：使用 AES-256-GCM 算法加密存储在 `data/provider-config.enc`
- **机器绑定密钥**：加密密钥由本机特征（主机名、用户名、平台等）派生，配置文件无法在其他电脑上解密
- **环境变量优先**：所有敏感配置优先从环境变量读取，不硬编码在代码中

#### 🛡️ npm 发布安全

发布到 npm 的包**绝对不包含**以下敏感文件：

```bash
# 这些文件会被自动排除
.env                          # 环境变量配置（包含 API Key）
data/                        # 数据目录（包含加密配置）
logs/                        # 日志文件
*.db                         # 数据库文件
*.enc                        # 加密配置文件
*.log                        # 日志文件
```

#### 📋 安全清单

| 文件类型 | 保护措施 | 是否包含在发布包中 |
|---------|---------|------------------|
| `.env` | 不提交到 git，不发布到 npm | ❌ 否 |
| API Key | 环境变量 + AES-256-GCM 加密 | ❌ 否 |
| 加密配置 | 机器绑定，无法跨设备使用 | ❌ 否 |
| 数据库 | 本地 SQLite，不同设备独立 | ❌ 否 |
| 日志文件 | 运行时生成，不包含在源码中 | ❌ 否 |
| Tree-sitter WASM | 需要下载 | ✅ 是 |
| 源代码 | 无敏感信息 | ✅ 是 |
| `.env.example` | 仅模板，无实际值 | ✅ 是 |

#### 🔑 多层密钥体系

```
第1层: 环境变量 (.env)          # 用户配置
     ↓
第2层: AES-256-GCM 加密         # 文件存储
     ↓
第3层: 机器特征密钥派生          # 机器绑定
     ↓
第4层: 日志脱敏                  # 输出保护
```



## 核心特性

- **双模智能机制**：离线/在线/自动三种模式自适应切换
- **多语言AST解析**：基于 Tree-sitter，支持 JS/TS/Python/Java/Go 等
- **可切换大模型**：支持 OpenAI、Claude、Azure OpenAI、Ollama（本地）
- **本地RAG知识库**：SQLite 向量存储，持续学习积累优化案例
- **语义级检测**：AST 语法树分析，精准识别逻辑冗余
- **CLI交互式运行**：命令行直接启动，无需额外前端
- **🔄 自我更新**：支持代码、配置、知识库、依赖等更新类型
- **🔧 自动修复**：运行时自动检测并修复数据库、网络、依赖、配置等问题
- **🛡️ 安全机制**：沙箱执行、人工确认门控、自动回滚确保操作安全

## 技术架构

```
code-optimizer-agent/
├── backend/
│   ├── src/
│   │   ├── agent.js              # Agent主入口
│   │   ├── agent/
│   │   │   └── agent.js          # 智能体核心（状态管理、任务调度）
│   │   ├── cli/
│   │   │   └── index.js          # 交互式CLI
│   │   ├── engine/
│   │   │   └── dualModeEngine.js # 双模工作引擎
│   │   ├── services/
│   │   │   ├── ast/
│   │   │   │   └── parser.js     # Tree-sitter AST解析
│   │   │   ├── llm/
│   │   │   │   └── providers.js  # 多LLM提供商管理
│   │   │   ├── vector/
│   │   │   │   └── knowledgeBase.js # 本地向量知识库
│   │   │   └── detection/
│   │   │       └── detector.js   # 代码缺陷检测引擎
│   │   ├── utils/
│   │   │   ├── database.js       # SQLite数据库
│   │   │   ├── logger.js         # 日志系统
│   │   │   ├── helpers.js        # 工具函数
│   │   │   └── response.js       # API响应
│   │   ├── config/
│   │   │   └── index.js          # 配置管理
│   │   └── index.js              # Express服务（可选）
│   ├── database/
│   │   ├── schema.sql            # 数据库架构（8张表）
│   │   ├── init.js               # 初始化脚本
│   │   └── seed.js               # 测试数据
│   └── package.json
└── README.md
```

## 快速开始

### 环境要求
- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
cd backend
npm install
```

### 初始化数据库

```bash
npm run db:init
```

### 启动智能体

```bash
# 启动交互式CLI（默认）
npm start

# 或
node src/agent.js
```

## 使用方式

### 1. 交互式CLI

启动后进入交互式命令行：

```bash
$ npm start

╔══════════════════════════════════════════════════════════════╗
║     基于 Tree-sitter 与 RAG 的多语言代码优化智能体           ║
║     Code Optimizer Agent v1.0.0                              ║
╠══════════════════════════════════════════════════════════════╣
║  离线: AST检测 + 本地RAG知识库                              ║
║  在线: AST检测 + 云端大模型 + RAG增强                       ║
╚══════════════════════════════════════════════════════════════╝

Agent> help
```

### 2. CLI命令

| 命令 | 说明 |
|------|------|
| `analyze <file>` | 分析单个文件 |
| `scan <path>` | 扫描整个项目 |
| `optimize` | 交互式优化代码片段 |
| `mode <offline\|online\|auto>` | 切换工作模式 |
| `provider list` | 列出所有LLM提供商 |
| `provider switch <name>` | 切换活跃提供商 |
| `provider set <name> apiKey <key>` | 设置API Key |
| `knowledge search <query>` | 搜索本地知识库 |
| `status` | 查看Agent状态 |
| `quit` | 退出 |

### 3. 命令行模式（非交互）

```bash
# 分析单个文件
node src/agent.js analyze ./src/example.js

# 扫描整个项目
node src/agent.js scan ./my-project

# 查看状态
node src/agent.js status
```

### 4. 配置云端大模型

在CLI中配置：

```
Agent> provider set openai apiKey sk-your-api-key
Agent> provider set openai model gpt-4
Agent> provider switch openai
Agent> mode online
```

或通过环境变量配置：

```bash
# .env 文件
OPENAI_API_KEY=sk-your-api-key
OPENAI_MODEL=gpt-4

CLAUDE_API_KEY=your-claude-key
CLAUDE_MODEL=claude-3-sonnet-20240229

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=codellama
```

## 双模运行机制

### 离线模式
- 仅启动 **Tree-sitter AST 语法树静态检测**
- 通过 **本地RAG向量知识库** 检索相似案例进行优化
- 完全本地运行，不访问任何外网接口
- 可独立完成代码冗余检测、规范校验

### 在线模式
- AST 精准定位缺陷
- 调用 **云端大模型API**（OpenAI/Claude/Azure等）
- **RAG增强**：将本地知识库检索结果作为上下文注入大模型
- 智能重构、注释补全、逻辑优化
- 优化结果自动回存本地知识库（持续学习）

### 自动模式
- 自动检测是否有可用的云端提供商
- 有则在线，无则离线，无缝切换

## 支持的LLM提供商

| 提供商 | 类型 | 配置项 |
|--------|------|--------|
| OpenAI | 云端 | apiKey, model, baseURL |
| Claude (Anthropic) | 云端 | apiKey, model, baseURL |
| Azure OpenAI | 云端 | apiKey, endpoint, deploymentName |
| Ollama | 本地 | baseURL, model |

## 数据库设计

系统包含8张核心数据表：

1. `sys_user` - 用户管理
2. `sys_oper_log` - 操作日志
3. `sys_config` - 系统配置
4. `scan_project` - 项目信息
5. `scan_task` - 扫描任务
6. `code_issue` - 代码缺陷
7. `ai_optimize_record` - AI优化记录
8. `code_report` - 报告导出

扩展知识库表：
- `kb_entries` - 知识条目
- `kb_cases` - 优化案例

## 系统创新点

1. **离线+在线双模智能机制**：依托AST实现断网可用的高精度离线质检，依托云端大模型实现智能代码重构
2. **RAG增强的大模型调用**：本地知识库检索结果作为上下文注入大模型，提高优化质量
3. **多LLM提供商自由切换**：用户可自由选择和切换云端大模型
4. **持续学习能力**：在线优化结果自动回存本地知识库，知识库越用越智能
5. **语义级代码检测**：基于AST语法树结构分析，而非文本匹配

## 许可证

MIT License

## 附录：npm 发布指南

### 发布前准备

1. **确保登录 npm 账号**

```bash
npm login
```

2. **检查 package.json 配置**

确保以下字段正确：

```json
{
  "name": "mr-sliy",
  "version": "1.0.0",
  "description": "Mr.Sliy - 基于Tree-sitter与RAG的多语言代码优化智能体",
  "files": [
    "src/",
    "database/schema.sql",
    "wasm/",
    ".env.example"
  ]
}
```

3. **测试本地安装**

```bash
# 在 backend 目录
npm install
npm start
```

### 发布步骤

1. **更新版本号**

```bash
# 升级补丁版本（1.0.0 -> 1.0.1）
npm version patch

# 升级次版本（1.0.0 -> 1.1.0）
npm version minor

# 升级主版本（1.0.0 -> 2.0.0）
npm version major
```

2. **查看发布内容**

```bash
npm pack --dry-run
```

这会显示实际会发布哪些文件，确保没有敏感信息。

3. **发布到 npm**

```bash
# 发布到官方 registry
npm publish

# 如果是首次发布（scoped package）
npm publish --access public
```

4. **验证发布**

```bash
# 查看已发布的版本
npm view mr-sliy versions

# 测试安装
npm install -g mr-sliy
```

### GitHub Actions 自动发布（可选）

创建 `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: |
          cd backend
          npm ci

      - name: Publish to npm
        run: |
          cd backend
          npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

在 GitHub Settings -> Secrets 中添加 `NPM_TOKEN`（从 npm website 获取）。

### 多设备使用注意事项

⚠️ **重要提醒**：当在不同电脑上安装时，需要重新配置 API Key：

1. **自动创建配置**：安装后会自动基于 `.env.example` 创建 `.env` 文件
2. **手动配置密钥**：编辑 `.env` 文件，填入你的 API Key
3. **数据库独立**：每台电脑有独立的 SQLite 数据库
4. **配置加密**：provider-config.enc 只能在配置的电脑上解密

