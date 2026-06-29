# 基于 Tree-sitter 与 RAG 的多语言代码优化智能体

## 更新日志

### v2.2.15 (2026-06-30)

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

