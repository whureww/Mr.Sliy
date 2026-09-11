/**
 * MCP 工具层：把 MR·SLIY 的核心能力（扫描 / 优化 / 对话 / 知识库 / 记忆 / 历史）
 * 以 MCP tools 形式暴露给外部客户端（Claude Desktop、Cursor、Cline 等）。
 * 所有实现复用现有服务模块，保证与桌面端行为一致。
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { detectIssues, batchDetect, saveDetectionResults } = require('../services/detection/detector');
const { optimizeWithRAG } = require('../services/rag/agent');
const { providerManager } = require('../services/llm/providers');
const { getDatabase } = require('../utils/database');
const { getFileLanguage, generateUUID } = require('../utils/helpers');
const { knowledgeBase } = require('../services/vector/knowledgeBase');
// 复用 AI 路由的提示词/记忆/上下文压缩逻辑（单一来源），以及扫描路由的文件收集与落库
const aiShared = require('../routes/aiRoutes');
const scanShared = require('../routes/scanRoutes');

/** 截断超长文本，避免撑爆客户端上下文 */
function clip(str, max = 4000) {
  const s = String(str == null ? '' : str);
  return s.length > max ? s.slice(0, max) + `\n…（已截断，共 ${s.length} 字符）` : s;
}

// ============================ 工具定义 ============================

const TOOL_SUMMARIES = [
  { name: 'scan_code', description: '扫描一段代码或一个文件，基于 Tree-sitter AST 检测冗余与不规范问题（未使用变量/导入、魔法数字、长函数、高复杂度、深嵌套、console.log 等）。' },
  { name: 'scan_project', description: '扫描整个项目目录：批量检测 js/ts/jsx/tsx/py/java/go 文件并汇总问题统计，结果写入扫描历史。' },
  { name: 'optimize_code', description: '将代码片段交给 MR·SLIY 优化引擎（RAG 知识库 + 可选云端大模型），返回优化后的代码、说明与建议。' },
  { name: 'chat', description: '与 MR·SLIY AI 助手对话：可闲聊、解释代码、请求修改建议（需已配置活跃的大模型提供商）。自动注入跨会话记忆。' },
  { name: 'search_knowledge', description: '检索本地知识库：按语义相似度查找优化案例（原始代码 → 优化代码）与知识条目。' },
  { name: 'list_memories', description: '列出 MR·SLIY AI 助手的跨会话记忆（用户偏好与项目约定）。' },
  { name: 'add_memory', description: '向 MR·SLIY 添加一条跨会话记忆（例如：使用 4 空格缩进）。' },
  { name: 'get_scan_history', description: '查询最近的扫描任务历史（任务名、模式、文件数、问题数、状态）。' }
];

// ============================ 工具实现 ============================

/** 扫描代码片段或文件 */
async function scanCodeHandler(args) {
  const { code, filePath, mode } = args || {};
  let source = typeof code === 'string' ? code : '';
  let target = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : 'snippet.js';

  if (!source && target !== 'snippet.js') {
    if (!fs.existsSync(target)) {
      throw new Error(`文件不存在: ${target}`);
    }
    source = fs.readFileSync(target, 'utf-8');
  }
  if (!source.trim()) {
    throw new Error('缺少待扫描的代码：请提供 code 或存在的 filePath');
  }

  const result = await detectIssues(source, target, { mode: mode === 'online' ? 'online' : 'offline' });
  if (!result.success) {
    throw new Error(result.message || '检测失败');
  }
  return {
    filePath: result.filePath,
    language: result.language,
    totalIssues: result.totalIssues,
    issueCounts: result.issueCounts || null,
    issues: (result.issues || []).slice(0, 50).map((i) => ({
      issueType: i.issueType,
      severity: i.severity,
      message: clip(i.message, 200),
      lineStart: i.lineStart,
      lineEnd: i.lineEnd,
      suggestion: clip(i.suggestion, 300),
      codeSnippet: clip(i.codeSnippet, 400)
    }))
  };
}

/** 扫描项目目录 */
async function scanProjectHandler(args) {
  const { projectPath, mode, maxFiles } = args || {};
  if (!projectPath || !String(projectPath).trim()) {
    throw new Error('缺少 projectPath');
  }
  const dir = path.resolve(String(projectPath).trim());
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`目录不存在: ${dir}`);
  }

  const files = scanShared.collectFiles(dir);
  if (files.length === 0) {
    return { projectPath: dir, totalFiles: 0, message: '未发现可扫描的代码文件' };
  }

  const cap = Math.min(Math.max(parseInt(maxFiles) || 30, 1), 200);
  const batch = files.slice(0, cap);
  const startTime = Date.now();
  const scanResults = await batchDetect(batch);

  // 与桌面端一致：写入项目/任务/问题记录，保证扫描历史完整
  let taskId = null;
  try {
    taskId = generateUUID();
    const projectId = await scanShared.createProjectRecord(dir);
    await scanShared.createTaskRecord(taskId, projectId, {
      scanMode: mode === 'online' ? 'online' : 'offline',
      scanType: 'mcp_project',
      targetPath: dir,
      fileCount: batch.length,
      scannedFiles: scanResults.scannedFiles,
      issueCount: scanResults.totalIssues,
      durationMs: Date.now() - startTime
    });
    await saveDetectionResults(taskId, projectId, scanResults.results);
  } catch (err) {
    logger.warn(`MCP 项目扫描落库失败（不影响返回）: ${err.message}`);
  }

  const byFile = scanResults.results
    .filter((r) => r.success && r.totalIssues > 0)
    .sort((a, b) => (b.totalIssues || 0) - (a.totalIssues || 0))
    .slice(0, 20)
    .map((r) => ({
      filePath: r.filePath,
      totalIssues: r.totalIssues,
      issues: (r.issues || []).slice(0, 10).map((i) => ({
        issueType: i.issueType,
        severity: i.severity,
        message: clip(i.message, 160),
        lineStart: i.lineStart
      }))
    }));

  return {
    projectPath: dir,
    truncated: files.length > cap,
    totalFiles: files.length,
    scannedFiles: scanResults.scannedFiles,
    failedFiles: scanResults.failedFiles,
    totalIssues: scanResults.totalIssues,
    durationMs: Date.now() - startTime,
    taskId,
    topFiles: byFile
  };
}

/** AI 优化代码片段 */
async function optimizeCodeHandler(args) {
  const { code, language, issueType, message } = args || {};
  if (!code || !String(code).trim()) {
    throw new Error('缺少待优化的 code');
  }
  const issue = {
    id: null,
    codeSnippet: String(code),
    message: String(message || '用户通过 MCP 请求优化'),
    issueType: issueType || null
  };
  const context = {
    language: language || getFileLanguage('snippet.js'),
    issueType: issueType || null,
    message: issue.message,
    taskId: null
  };
  const result = await optimizeWithRAG(issue, context);
  if (!result || result.success === false) {
    throw new Error((result && result.message) || '优化失败：未配置大模型或引擎不可用');
  }
  return {
    optimizedCode: clip(result.optimizedCode, 12000),
    explanation: clip(result.explanation || '', 1500),
    suggestions: result.suggestions || [],
    usage: result.usage || result.tokensUsed || null
  };
}

/** AI 助手对话 */
async function chatHandler(args) {
  const { message, history } = args || {};
  if (!message || !String(message).trim()) {
    throw new Error('缺少 message');
  }
  const provider = providerManager.getActiveProvider();
  if (!provider) {
    throw new Error('未配置活跃的大模型提供商：请先在 MR·SLIY 设置中配置并启用一个提供商');
  }

  const hist = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  hist.push({ role: 'user', content: String(message).slice(0, 2000) });

  // 与桌面端一致：自动提取记忆 + 注入记忆块 + 早期历史压缩
  try {
    if (typeof aiShared.extractMemoryFromText === 'function') {
      aiShared.extractMemoryFromText(hist[hist.length - 1].content);
    }
  } catch (e) {
    logger.warn(`MCP 对话记忆提取失败: ${e.message}`);
  }

  const systemPrompt = aiShared.CHAT_SYSTEM_PROMPT + (aiShared.memoryPromptBlock ? aiShared.memoryPromptBlock() : '');
  const chatMessages = aiShared.buildChatMessages(systemPrompt, hist);
  const result = await provider.chat(chatMessages, { temperature: 0.8, maxTokens: 2048 });
  const reply = typeof result.content === 'string' ? result.content : String(result.content || '');
  return { reply: clip(reply, 12000), usage: result.usage || null };
}

/** 检索知识库 */
async function searchKnowledgeHandler(args) {
  const { query, language, topK } = args || {};
  if (!query || !String(query).trim()) {
    throw new Error('缺少 query');
  }
  const k = Math.min(Math.max(parseInt(topK) || 5, 1), 20);
  const out = { cases: [], entries: [] };
  try {
    const cases = await knowledgeBase.searchCases(String(query), { language: language || undefined, topK: Math.min(k, 8) });
    out.cases = (cases || []).map((c) => ({
      id: c.id,
      language: c.language,
      issueType: c.issue_type || c.issueType || null,
      similarity: typeof c.similarity === 'number' ? Math.round(c.similarity * 1000) / 1000 : null,
      originalCode: clip(c.original_code || '', 600),
      optimizedCode: clip(c.optimized_code || '', 600),
      explanation: clip(c.explanation || '', 300)
    }));
  } catch (err) {
    logger.warn(`MCP 知识库案例检索失败: ${err.message}`);
  }
  try {
    const entries = await knowledgeBase.searchEntries(String(query), { language: language || undefined, topK: Math.min(k, 8) });
    out.entries = (entries || []).map((e) => ({
      id: e.id,
      type: e.type,
      language: e.language,
      tags: e.tags,
      similarity: typeof e.similarity === 'number' ? Math.round(e.similarity * 1000) / 1000 : null,
      content: clip(e.content || '', 600)
    }));
  } catch (err) {
    logger.warn(`MCP 知识库条目检索失败: ${err.message}`);
  }
  return out;
}

/** 列出记忆 */
async function listMemoriesHandler() {
  const list = aiShared.loadMemories ? aiShared.loadMemories() : [];
  return { memories: list };
}

/** 添加记忆 */
async function addMemoryHandler(args) {
  const { text } = args || {};
  if (!text || !String(text).trim()) {
    throw new Error('缺少记忆内容 text');
  }
  const list = aiShared.loadMemories ? aiShared.loadMemories() : [];
  if (list.length >= (aiShared.MEMORY_MAX || 50)) {
    throw new Error(`记忆已达上限（${aiShared.MEMORY_MAX || 50} 条）`);
  }
  const item = aiShared.addMemory(String(text).trim());
  if (!item) {
    return { added: false, message: '该记忆已存在' };
  }
  return { added: true, item };
}

/** 扫描历史 */
async function scanHistoryHandler(args) {
  const limit = Math.min(Math.max(parseInt(args && args.limit) || 10, 1), 50);
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, task_name, scan_mode, scan_type, target_path, file_count,
              scanned_files, issue_count, status, created_at
       FROM scan_task ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
  return { tasks: rows };
}

// ============================ 注册表 ============================

const INPUT_SCHEMAS = {
  scan_code: {
    type: 'object',
    properties: {
      code: { type: 'string', description: '待扫描的代码片段（与 filePath 二选一，都提供时优先 code）' },
      filePath: { type: 'string', description: '待扫描的文件绝对路径（未提供 code 时读取此文件）' },
      mode: { type: 'string', enum: ['offline', 'online'], description: '扫描模式，默认 offline' }
    }
  },
  scan_project: {
    type: 'object',
    properties: {
      projectPath: { type: 'string', description: '项目目录绝对路径' },
      mode: { type: 'string', enum: ['offline', 'online'], description: '扫描模式，默认 offline' },
      maxFiles: { type: 'number', description: '最多扫描文件数（1-200，默认 30）' }
    },
    required: ['projectPath']
  },
  optimize_code: {
    type: 'object',
    properties: {
      code: { type: 'string', description: '待优化的代码片段' },
      language: { type: 'string', description: '代码语言（如 javascript/python），缺省自动推断' },
      issueType: { type: 'string', description: '问题类型（如 unusedVariables/magicNumbers）' },
      message: { type: 'string', description: '问题描述或优化要求' }
    },
    required: ['code']
  },
  chat: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '用户消息' },
      history: {
        type: 'array',
        description: '可选的历史消息（最多 16 条）',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' }
          }
        }
      }
    },
    required: ['message']
  },
  search_knowledge: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索文本（代码片段或自然语言）' },
      language: { type: 'string', description: '限定语言（可选）' },
      topK: { type: 'number', description: '返回条数（默认 5）' }
    },
    required: ['query']
  },
  list_memories: { type: 'object', properties: {} },
  add_memory: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '记忆内容，例如：使用 4 空格缩进' }
    },
    required: ['text']
  },
  get_scan_history: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '返回条数（默认 10，最大 50）' }
    }
  }
};

const HANDLERS = {
  scan_code: scanCodeHandler,
  scan_project: scanProjectHandler,
  optimize_code: optimizeCodeHandler,
  chat: chatHandler,
  search_knowledge: searchKnowledgeHandler,
  list_memories: listMemoriesHandler,
  add_memory: addMemoryHandler,
  get_scan_history: scanHistoryHandler
};

function buildToolRegistry() {
  const list = TOOL_SUMMARIES.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: INPUT_SCHEMAS[t.name] || { type: 'object', properties: {} }
  }));
  return {
    list: () => list,
    get: (name) => {
      const idx = HANDLERS[name] ? list.findIndex((t) => t.name === name) : -1;
      if (idx < 0) return null;
      return { ...list[idx], handler: HANDLERS[name] };
    }
  };
}

module.exports = { buildToolRegistry, TOOL_SUMMARIES };
