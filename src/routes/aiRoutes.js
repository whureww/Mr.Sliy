/**
 * AI优化路由模块
 * 处理AI代码优化相关请求
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { optimizeWithRAG } = require('../services/rag/agent');
const { success, error } = require('../utils/response');
const { logger } = require('../utils/logger');
const { getFileLanguage } = require('../utils/helpers');
const { providerManager } = require('../services/llm/providers');

/**
 * 跨会话记忆库：~/.mr-sliy/chat_memory.json
 * 用户级偏好与项目约定（例："这个项目用 4 空格缩进"、"别用 var"），
 * 对话中自动提取 + 手动管理，注入聊天系统提示词。
 */
const MEMORY_FILE = path.join(os.homedir(), '.mr-sliy', 'chat_memory.json');
const MEMORY_MAX = 50;

function loadMemories() {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveMemories(list) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(list.slice(-MEMORY_MAX), null, 2), 'utf-8');
}

function addMemory(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const list = loadMemories();
  // 去重（完全相同的文本）
  if (list.some((m) => m.text === t)) return null;
  const item = { id: `mem-${Date.now()}-${Math.floor(Math.random() * 10000)}`, text: t.slice(0, 200), createdAt: new Date().toISOString() };
  list.push(item);
  saveMemories(list);
  return item;
}

/** 从用户消息中启发式提取值得记住的偏好/约定（记忆条数满时静默跳过） */
const MEMORY_PATTERNS = /(记住|以后都?要|以后请|请记住|偏好|我喜欢|我不喜欢|不要用|别用|我们用|我们使用|我们的项目|约定|规范是|统一用|一律用)/;

function extractMemoryFromText(text) {
  try {
    if (!text || text.length > 500) return;
    if (loadMemories().length >= MEMORY_MAX) return;
    const sentences = text.split(/[。！？!?\n；;]/).map((s) => s.trim()).filter(Boolean);
    for (const s of sentences) {
      if (MEMORY_PATTERNS.test(s) && s.length >= 4 && s.length <= 120) {
        const item = addMemory(s);
        if (item) logger.info(`已记住用户偏好: ${item.text}`);
        break;
      }
    }
  } catch (e) {
    logger.warn('记忆提取失败:', e.message);
  }
}

/** 记忆注入文本（无记忆时返回空串） */
function memoryPromptBlock() {
  const list = loadMemories();
  if (list.length === 0) return '';
  return `\n\n已知用户偏好与项目约定（请遵守，不要重复询问）：\n${list.map((m) => `- ${m.text}`).join('\n')}`;
}

/** 工作区上下文注入（当前文件、问题概览等，由客户端随请求传入） */
function contextPromptBlock(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const parts = [];
  if (ctx.fileName) parts.push(`当前打开文件：${ctx.fileName}${ctx.language ? `（${ctx.language}）` : ''}`);
  if (typeof ctx.totalIssues === 'number') parts.push(`扫描检出问题数：${ctx.totalIssues}`);
  if (Array.isArray(ctx.topIssues) && ctx.topIssues.length > 0) {
    parts.push(
      `主要问题：\n${ctx.topIssues
        .slice(0, 5)
        .map((i) => `- [${i.type || 'issue'}] ${String(i.message || '').slice(0, 100)}`)
        .join('\n')}`
    );
  }
  return parts.length ? `\n\n当前工作区上下文（供参考）：\n${parts.join('\n')}` : '';
}

/**
 * 构建聊天消息序列：超出保留上限的早期历史压缩为摘要（上下文压缩），
 * 近期原文保留，系统提示词稳定在前以命中前缀缓存。
 */
function buildChatMessages(systemPrompt, history) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  if (history.length > CHAT_HISTORY_LIMIT) {
    const overflow = history.slice(0, history.length - CHAT_HISTORY_LIMIT);
    const recent = history.slice(-CHAT_HISTORY_LIMIT);
    // 上下文压缩：早期对话压缩为角色化摘要（每条截断，整体封顶），避免长对话"失忆"
    let digest = overflow
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.replace(/\s+/g, ' ').slice(0, 120)}`)
      .join('\n');
    if (digest.length > 1200) digest = digest.slice(0, 1200);
    msgs.push({ role: 'system', content: `对话早期内容摘要（已被压缩，仅供回溯上下文）：\n${digest}` });
    msgs.push(...recent);
  } else {
    msgs.push(...history);
  }
  return msgs;
}

/**
 * AI优化代码片段
 */
router.post('/optimize', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { code, filePath, language, issueType, message, line } = req.body;
    
    if (!code) {
      return res.status(400).json(error('缺少代码片段', 400));
    }

    // 检查是否有可用的云端LLM提供商
    const availableProviders = providerManager.getAvailableProviders();
    const hasOnlineProvider = availableProviders.some(p => p.available && p.name !== 'ollama');
    if (!hasOnlineProvider) {
      return res.json(error('当前无可用的云端LLM提供商，无法使用AI优化功能。请在数据库中配置API密钥。'));
    }
    
    // 构建issue对象
    const issue = {
      id: null,
      codeSnippet: code
    };
    
    // 构建上下文（issueLine 用于大文件按问题行开窗，替代硬截断）
    const context = {
      language: language || getFileLanguage(filePath || 'unknown.js'),
      issueType: issueType || 'general',
      message: message || '优化建议',
      issueLine: Number(line) > 0 ? Number(line) : null,
      taskId: null
    };
    
    // 执行RAG优化
    const result = await optimizeWithRAG(issue, context);
    
    if (!result.success) {
      return res.json(error(result.message));
    }
    
    logger.info('AI优化完成');
    
    return res.json(success({
      optimizationId: result.optimizationId,
      optimizedCode: result.optimizedCode,
      explanation: result.explanation,
      suggestions: result.suggestions,
      similarSnippets: result.similarSnippets,
      tokensUsed: result.tokensUsed,
      durationMs: Date.now() - startTime
    }));
  } catch (err) {
    logger.error('AI优化失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * AI助手对话系统提示词。
 * 前缀缓存关键：本段为固定文本，所有对话请求共用，请勿随意改写措辞。
 * 定位：可以自然闲聊与解答代码/技术问题；明显超出代码范围的话题不展开实质内容，
 * 而是用代码相关的术语把话题引导回来。
 */
const CHAT_SYSTEM_PROMPT = `你是 MR·SLIY 代码优化智能体中的 AI 助手。MR·SLIY 是一款基于 Tree-sitter 与 RAG 的多语言代码分析与优化工具。

你的职责与风格：
1. 与用户自然友好地交流：问候、闲聊、感谢、简单谈天都可以正常回应，语气亲切简洁，可适当使用颜文字。
2. 代码相关的一切请求（解释代码、修改代码、修复报错、优化重构、编写示例、技术问答）都必须正常、完整地处理：给出清晰的解释和具体可用的代码，绝不拒绝，也绝不把这类话题引导到别处。
3. 当用户要求修改/修复/优化某段代码时，先在正文中用简体中文解释修改思路、具体改动点和原因，然后输出一个 <MODIFICATION> 块，块内只放一个 JSON 对象（禁止用 markdown 代码块包裹），字段如下：
{"language":"代码语言","originalCode":"被修改的原始代码（必须与用户提供的代码逐字一致，含缩进，不得省略或改写，便于在文件中定位）","modifiedCode":"修改后的完整代码","summary":"一句话概括本次修改","riskLevel":"low|medium|high","risks":["风险或注意事项1","风险2"]}
riskLevel 判定标准：low=局部小改动且不改变程序行为（重命名、加注释、格式调整）；medium=程序行为有变化或需要回归测试（逻辑修复、返回结构变化、性能重构）；high=涉及安全、数据完整性、并发、公共接口签名变更、删除功能或密钥/密码处理。
无需给出代码修改时，不要输出 <MODIFICATION> 块。
4. 用户提到当前打开的文件、报错信息或想优化代码时，提醒他可以点击「扫描此文件」按钮进行检测，或在问题面板点击「修复」生成优化方案。
5. 用户的话题明显超出代码与技术范围时（例如时事政治、娱乐八卦、医疗、法律、投资建议、写小说等）：先用一两句话友好回应，说明这不在你的擅长范围内，然后自然地把话题引导回代码相关的方向，例如："这个话题我帮不上太多忙。不过如果你在写代码时遇到了报错，或者想优化某个函数的性能，随时可以把代码发给我看看。"。不要展开超范围话题的实质内容，也不要生硬拒绝。回复中不要使用任何 emoji 或颜文字表情。
6. 默认使用简体中文回答，回答保持简洁，避免冗长铺垫。涉及代码修改时，务必让用户清楚改了什么、有什么风险。`;

/** 客户端最多携带的历史条数与单条长度上限 */
const CHAT_HISTORY_LIMIT = 16;
const CHAT_MESSAGE_MAX_CHARS = 2000;

/**
 * AI助手对话（支持自然闲聊与代码话题，超范围话题引导回代码方向）
 * 客户端仅传 user/assistant 历史，系统提示词由服务端统一注入，保证前缀稳定以命中缓存。
 */
router.post('/chat', async (req, res) => {
  try {
    const { messages, context } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json(error('缺少对话消息', 400));
    }

    const provider = providerManager.getActiveProvider();
    if (!provider) {
      return res.json(error('未配置活跃的LLM提供商，请先在提供商管理中配置', 400));
    }

    // 只保留 user/assistant 文本消息（剥离客户端可能带入的 system 或多余字段）
    const history = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, CHAT_MESSAGE_MAX_CHARS) }));

    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      return res.status(400).json(error('对话格式不正确', 400));
    }

    // 跨会话记忆：从用户消息自动提取偏好/约定（异步无关，失败不影响回复）
    extractMemoryFromText(history[history.length - 1].content);

    // 上下文压缩（早期历史 → 摘要）+ 记忆与工作区上下文注入
    const systemPrompt = CHAT_SYSTEM_PROMPT + memoryPromptBlock() + contextPromptBlock(context);
    const chatMessages = buildChatMessages(systemPrompt, history);

    const result = await provider.chat(chatMessages, { temperature: 0.8, maxTokens: 2048 });

    const reply = typeof result.content === 'string' ? result.content : String(result.content || '');

    return res.json(success({
      reply,
      usage: result.usage || null
    }));
  } catch (err) {
    logger.error('AI对话失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * AI助手流式对话（SSE）：逐 delta 推送 {delta}，结束推送 {done:true, usage}。
 * 与 /chat 完全一致的压缩/记忆/上下文逻辑，仅输出方式为流式。
 */
router.post('/chat/stream', async (req, res) => {
  const controller = new AbortController();
  let closed = false;
  req.on('close', () => {
    closed = true;
    controller.abort();
  });

  try {
    const { messages, context } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json(error('缺少对话消息', 400));
    }
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      return res.status(400).json(error('未配置活跃的LLM提供商，请先在提供商管理中配置', 400));
    }

    const history = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, CHAT_MESSAGE_MAX_CHARS) }));

    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      return res.status(400).json(error('对话格式不正确', 400));
    }

    extractMemoryFromText(history[history.length - 1].content);

    const systemPrompt = CHAT_SYSTEM_PROMPT + memoryPromptBlock() + contextPromptBlock(context);
    const chatMessages = buildChatMessages(systemPrompt, history);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendSSE = (obj) => {
      if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    const result = await provider.chatStream(
      chatMessages,
      { temperature: 0.8, maxTokens: 2048 },
      (delta) => sendSSE({ delta }),
      controller.signal
    );

    sendSSE({ done: true, usage: result.usage || null });
    if (!closed) res.end();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      logger.info('AI流式对话被客户端中断');
      return;
    }
    logger.error('AI流式对话失败:', err);
    if (!res.headersSent) {
      return res.status(500).json(error(err.message));
    }
    if (!closed) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

/**
 * 跨会话记忆管理：列表 / 新增 / 删除 / 清空
 */
router.get('/memory/list', (req, res) => {
  return res.json(success({ memories: loadMemories(), file: MEMORY_FILE }));
});

router.post('/memory', (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json(error('缺少记忆内容', 400));
    }
    const list = loadMemories();
    if (list.length >= MEMORY_MAX) {
      return res.json(error(`记忆已达上限（${MEMORY_MAX} 条），请先删除部分记忆`, 400));
    }
    const item = addMemory(text);
    if (!item) return res.json(error('该记忆已存在', 400));
    return res.json(success(item));
  } catch (err) {
    logger.error('新增记忆失败:', err);
    return res.status(500).json(error(err.message));
  }
});

router.delete('/memory/:id', (req, res) => {
  try {
    const list = loadMemories();
    const next = list.filter((m) => m.id !== req.params.id);
    saveMemories(next);
    return res.json(success({ removed: list.length - next.length }));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

router.delete('/memory', (req, res) => {
  try {
    saveMemories([]);
    return res.json(success({ cleared: true }));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

/**
 * 获取优化历史
 */
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const { getOptimizationHistory } = require('../services/rag/agent');
    const history = getOptimizationHistory(limit);
    
    return res.json(success({
      total: history.length,
      history
    }));
  } catch (err) {
    logger.error('获取优化历史失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 应用优化建议
 */
router.post('/apply', async (req, res) => {
  try {
    const { optimizationId, filePath, originalCode, optimizedCode } = req.body;
    
    if (!filePath || !optimizedCode) {
      return res.status(400).json(error('缺少必要参数', 400));
    }
    
    // 这里应该实现实际的代码替换逻辑
    // 由于安全考虑，实际应用中应该由前端或IDE插件完成替换
    
    logger.info(`优化建议已应用: ${optimizationId}`);
    
    return res.json(success({
      optimizationId,
      filePath,
      applied: true,
      message: '优化建议已应用，请在IDE中确认更改'
    }));
  } catch (err) {
    logger.error('应用优化失败:', err);
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;

// 供 MCP 工具层复用（保持提示词 / 记忆 / 上下文压缩逻辑单一来源）
module.exports.CHAT_SYSTEM_PROMPT = CHAT_SYSTEM_PROMPT;
module.exports.buildChatMessages = buildChatMessages;
module.exports.memoryPromptBlock = memoryPromptBlock;
module.exports.extractMemoryFromText = extractMemoryFromText;
module.exports.loadMemories = loadMemories;
module.exports.saveMemories = saveMemories;
module.exports.addMemory = addMemory;
module.exports.MEMORY_MAX = MEMORY_MAX;