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

## 📝 更新日志

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
