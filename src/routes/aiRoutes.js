/**
 * AI优化路由模块
 * 处理AI代码优化相关请求
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { optimizeWithRAG } = require('../services/rag/agent');
const { success, error } = require('../utils/response');
const { logger } = require('../utils/logger');
const { getFileLanguage } = require('../utils/helpers');
const { providerManager } = require('../services/llm/providers');

/**
 * 跨会话记忆库：~/.mr-sliy/chat_memory.json
 * 用户级偏好与项目约定（例："这个项目用 4 空格缩进"、"别用 var"），
 * 对话中由 LLM 自动提取，注入聊天系统提示词。
 *
 * 作用域（scope）：跨对话记忆开启时 scope 为空 → 读写全局文件；
 * 关闭跨对话时 scope 为对话标识（如工作区路径）→ 读写按对话隔离的独立文件，
 * 记忆功能仍然生效但各对话互不共享。
 */
const MEMORY_FILE = path.join(os.homedir(), '.mr-sliy', 'chat_memory.json');
const MEMORY_MAX = 50;

/** scope → 存储文件：空 = 全局 chat_memory.json；非空 = chat_memory_<hash>.json */
function memoryFileForScope(scope) {
  const s = String(scope || '').trim();
  if (!s) return MEMORY_FILE;
  const hash = crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
  return path.join(path.dirname(MEMORY_FILE), `chat_memory_${hash}.json`);
}

function loadMemories(scope) {
  try {
    const raw = fs.readFileSync(memoryFileForScope(scope), 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveMemories(list, scope) {
  const file = memoryFileForScope(scope);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list.slice(-MEMORY_MAX), null, 2), 'utf-8');
}

function addMemory(text, source = 'manual', scope) {
  const t = String(text || '').trim();
  if (!t) return null;
  const list = loadMemories(scope);
  // 去重（完全相同的文本）
  if (list.some((m) => m.text === t)) return null;
  const item = { id: `mem-${Date.now()}-${Math.floor(Math.random() * 10000)}`, text: t.slice(0, 200), source: source === 'auto' ? 'auto' : 'manual', createdAt: new Date().toISOString() };
  list.push(item);
  saveMemories(list, scope);
  return item;
}

/** 从用户消息中启发式提取值得记住的偏好/约定（记忆条数满时静默跳过） */
const MEMORY_PATTERNS = /(记住|以后都?要|以后请|请记住|偏好|我喜欢|我不喜欢|不要用|别用|我们用|我们使用|我们的项目|约定|规范是|统一用|一律用)/;

/** @deprecated 已被 LLM 自动提取 scheduleAutoMemory 取代（双通道会产生重复低质条目）；保留导出防外部引用 */
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

/**
 * 全自动记忆：对话结束后异步调用 LLM 从本轮对话提取值得长期记住的内容
 * （用户偏好/项目约定/重要事实），零人工干预。
 *
 * 设计要点:
 * - setImmediate 异步执行，不阻塞对话响应；全程静默失败（仅 warn 日志）
 * - 单飞互斥（autoMemoryBusy）：上一轮提取未完成时跳过本轮，避免并发重复
 * - 提取 prompt 携带已知记忆列表供 LLM 去重；结果再与现有记忆做兜底去重
 * - 成本控制：消息过短跳过、maxTokens 300、最多提取 3 条
 */
let autoMemoryBusy = false;

function scheduleAutoMemory({ provider, userText, assistantText, scope }) {
  try {
    if (!provider || typeof provider.chat !== 'function') return;
    const u = String(userText || '').trim();
    if (u.length < 16) return; // 过短消息无提取价值
    if (autoMemoryBusy || loadMemories(scope).length >= MEMORY_MAX) return;
    autoMemoryBusy = true;

    setImmediate(async () => {
      try {
        const known = loadMemories(scope).map((m) => `- ${m.text}`).join('\n');
        const system =
          '你是对话记忆提取器。从对话中提取值得长期记住的信息（用户偏好/项目约定/重要事实）。' +
          '排除一次性任务请求、闲聊和代码本身。若已被已知记忆覆盖或没有新信息，返回空数组 []。' +
          '只输出 JSON 字符串数组，最多 3 条，每条为独立陈述句且不超过 100 字。';
        const user =
          `已知记忆:\n${known || '（无）'}\n\n对话:\n用户: ${u.slice(0, 800)}\n助手: ${String(assistantText || '').trim().slice(0, 400)}`;
        const r = await provider.chat(
          [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          { temperature: 0.2, maxTokens: 300 }
        );
        const raw = typeof r.content === 'string' ? r.content : String(r.content || '');
        const stripped = raw.replace(/```(?:json)?/g, '').trim();
        let arr = null;
        try {
          arr = JSON.parse(stripped);
        } catch {
          const m = raw.match(/\[[\s\S]*\]/);
          if (m) {
            try {
              arr = JSON.parse(m[0]);
            } catch {
              /* 放弃本轮 */
            }
          }
        }
        if (!Array.isArray(arr)) return;
        const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
        const existing = loadMemories(scope);
        const picked = arr
          .filter((s) => typeof s === 'string' && s.trim().length >= 4)
          .map((s) => s.trim().slice(0, 200))
          .filter((s) => !existing.some((m) => norm(m.text) === norm(s) || m.text.includes(s) || s.includes(m.text)))
          .slice(0, 3);
        for (const s of picked) {
          if (addMemory(s, 'auto', scope)) logger.info(`自动记忆: ${s}`);
        }
      } catch (e) {
        logger.warn('自动记忆提取失败:', e.message);
      } finally {
        autoMemoryBusy = false;
      }
    });
  } catch (e) {
    autoMemoryBusy = false;
    logger.warn('自动记忆调度失败:', e.message);
  }
}

/** 记忆注入文本（无记忆时返回空串）；scope 空 = 全局记忆，非空 = 对话隔离记忆 */
function memoryPromptBlock(scope) {
  const list = loadMemories(scope);
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
    const { messages, context, memoryScope } = req.body || {};

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

    // 上下文压缩（早期历史 → 摘要）+ 记忆与工作区上下文注入
    // memoryScope: 空串/未传 = 跨对话全局记忆；非空 = 按对话隔离的记忆
    const scope = typeof memoryScope === 'string' ? memoryScope : '';
    const systemPrompt = CHAT_SYSTEM_PROMPT + memoryPromptBlock(scope) + contextPromptBlock(context);
    const chatMessages = buildChatMessages(systemPrompt, history);

    const result = await provider.chat(chatMessages, { temperature: 0.8, maxTokens: 2048 });

    const reply = typeof result.content === 'string' ? result.content : String(result.content || '');

    // 全自动记忆：响应完成后异步提取（不阻塞、失败静默）
    scheduleAutoMemory({ provider, userText: history[history.length - 1].content, assistantText: reply, scope });

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
    const { messages, context, memoryScope } = req.body || {};
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

    const scope = typeof memoryScope === 'string' ? memoryScope : '';
    const systemPrompt = CHAT_SYSTEM_PROMPT + memoryPromptBlock(scope) + contextPromptBlock(context);
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

    let replyBuf = ''; // 累积完整回复，供结束后自动记忆提取
    const result = await provider.chatStream(
      chatMessages,
      { temperature: 0.8, maxTokens: 2048 },
      (delta) => {
        replyBuf += delta;
        sendSSE({ delta });
      },
      controller.signal
    );

    sendSSE({ done: true, usage: result.usage || null });
    if (!closed) res.end();
    // 全自动记忆：仅在流正常结束（未被客户端中断）时提取，中断时上下文不完整
    if (!closed) {
      scheduleAutoMemory({ provider, userText: history[history.length - 1].content, assistantText: replyBuf, scope });
    }
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
 * 跨会话记忆管理：列表 / 删除 / 清空
 * 记忆写入完全由对话过程中的 LLM 自动提取完成，不再提供 HTTP 手动新增入口；
 * scope 为对话标识（关闭跨对话记忆时按对话隔离），空 = 全局。
 */
router.get('/memory/list', (req, res) => {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
  return res.json(success({ memories: loadMemories(scope), file: memoryFileForScope(scope) }));
});

router.delete('/memory/:id', (req, res) => {
  try {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
    const list = loadMemories(scope);
    const next = list.filter((m) => m.id !== req.params.id);
    saveMemories(next, scope);
    return res.json(success({ removed: list.length - next.length }));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

router.delete('/memory', (req, res) => {
  try {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
    saveMemories([], scope);
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
module.exports.extractMemoryFromText = extractMemoryFromText; // @deprecated 保留防外部引用
module.exports.scheduleAutoMemory = scheduleAutoMemory;
module.exports.loadMemories = loadMemories;
module.exports.saveMemories = saveMemories;
module.exports.addMemory = addMemory;
module.exports.MEMORY_MAX = MEMORY_MAX;