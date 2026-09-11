/**
 * 多LLM提供商管理模块
 * 支持OpenAI、Claude、Ollama、Azure OpenAI等云端大模型
 * API密钥从数据库读取，不暴露在代码或环境变量中
 */

const { logger } = require('../../utils/logger');
const { queryOne } = require('../../utils/database');
const { logDeduplicator } = require('../../utils/logDeduplicator');

/**
 * 从数据库获取LLM API密钥
 */
async function getLLMKeyFromDB(providerName) {
  try {
    const { dbAdapter } = require('../../utils/dbAdapter');
    const sqlite = dbAdapter.getSqlite();
    
    const allRecords = sqlite.prepare('SELECT * FROM llm_api_keys').all();
    const matched = allRecords.find(r => r.provider_name === providerName);
    if (matched) {
      return {
        api_key: matched.api_key,
        api_url: matched.api_url,
        model_name: matched.model_name
      };
    }
    return null;
  } catch (error) {
    logger.debug(`从数据库获取${providerName}密钥失败: ${error.message}`);
    return null;
  }
}

/**
 * 统一提取各格式 API 响应的 token 用量与缓存命中信息
 * 兼容：OpenAI 兼容(prompt_tokens_details.cached_tokens)、DeepSeek(prompt_cache_hit_tokens)、
 *      Claude(input_tokens/cache_read_input_tokens)、Ollama(eval_count)、Gemini(usageMetadata)
 */
function extractUsage(data) {
  const u = data?.usage || data?.usageMetadata || {};
  const promptTokens = u.prompt_tokens ?? u.input_tokens ?? u.prompt_tokens_count ?? u.promptTokenCount ?? 0;
  const completionTokens = u.completion_tokens ?? u.output_tokens ?? u.eval_count ?? u.candidatesTokenCount ?? 0;
  let cacheHit = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0;
  let cacheMiss = u.prompt_cache_miss_tokens ?? u.cache_creation_input_tokens ?? 0;
  if (!cacheMiss && promptTokens > 0) {
    cacheMiss = Math.max(0, promptTokens - cacheHit);
  }
  const totalTokens = u.total_tokens ?? u.totalTokenCount ?? ((promptTokens + completionTokens) || 0);
  return {
    promptTokens: promptTokens || 0,
    completionTokens: completionTokens || 0,
    totalTokens: totalTokens || 0,
    cacheHitTokens: cacheHit || 0,
    cacheMissTokens: cacheMiss || 0
  };
}

/**
 * 优化请求的稳定系统提示词。
 * 前缀缓存关键：DeepSeek 等厂商按请求前缀（64 token 块）自动缓存，
 * 本段与 buildOptimizationPrompt 的固定前缀部分在所有请求间保持逐字一致才能命中缓存，
 * 修改措辞会导致缓存全量失效，请谨慎调整。
 */
const OPTIMIZATION_SYSTEM_PROMPT = `你是一个专业的代码优化专家，擅长代码重构、性能优化、安全加固和最佳实践建议。你将收到一段待优化代码及其问题上下文，需要输出严格符合约定格式的 JSON 结果。

优化总则：
1. 保持外部行为不变：不改变函数签名、返回值语义和可观察的副作用，除非上下文明确说明问题本身就是行为缺陷。
2. 优先最小改动：选择风险最低、收益明确的改法，避免大范围重写。
3. 保持原代码风格与缩进，注释语言与原代码一致。
4. 若代码已足够好，optimizedCode 可与原代码相同，并在 explanation 中说明原因。

按问题类型的专项策略：
【安全类】SQL 与命令拼接改为参数化查询或白名单校验；硬编码密钥、账号密码改为环境变量或配置读取；外部输入增加类型与长度校验；eval、new Function 等动态执行替换为静态实现。
【性能类】循环内不变的计算外提到循环外；频繁的数组 includes/find 改用 Set/Map；循环内字符串拼接改用数组 join 或模板字符串；避免在循环中重复编译正则；多次链式 filter/map 合并为单次遍历。
【可读性类】var 改为 const/let 并优先 const；魔法数字与魔法字符串提取为具名常量；嵌套超过三层时用提前返回拍平；过长函数按单一职责拆分；重复逻辑提取为公共函数；删除注释掉的死代码与无用变量。
【现代语法类】回调改为 async/await；对象与数组取值使用解构赋值；字符串拼接使用模板字符串；判空使用可选链 ?. 与空值合并 ??；集合拷贝与合并使用展开运算符。
【资源与健壮类】文件句柄、数据库连接使用 try/finally 确保释放；异步操作补充错误处理；定时器与事件监听不再使用时及时注销。

输出格式（严格遵守）：
- 只输出一个 JSON 对象，禁止使用 markdown 代码块包裹，禁止输出 JSON 之外的任何内容。
- optimizedCode 必须是完整可运行的代码；其中的换行写成 \\n，双引号转义为 \\"，确保 JSON 可被直接解析。
- explanation 使用简体中文，说明改了什么、为什么、解决了什么问题。
- suggestions 给出 2~4 条与本次优化相关的最佳实践建议。

输出示例（仅作格式参考，内容必须按实际问题生成）：
{"optimizedCode": "const MAX_RETRY = 3;\\nfor (let i = 0; i < MAX_RETRY; i++) {\\n  await run(i);\\n}", "explanation": "将魔法数字 3 提取为具名常量 MAX_RETRY，循环计数改用 let 声明，提升可读性与作用域安全性。", "suggestions": ["常量命名使用全大写下划线风格", "声明变量时优先使用 const"]}`;

/**
 * 构建优化提示词。
 * 前缀缓存关键：开头到"以下是本次请求的具体上下文"之前的所有内容均为固定文本，
 * 变化内容（语言/问题/代码）一律放在尾部，确保跨请求前缀逐字一致。
 */
function buildOptimizationPrompt(codeSnippet, context) {
  const MAX_SNIPPET_CHARS = 1500;
  let snippet = typeof codeSnippet === 'string' ? codeSnippet : '';
  const notes = [];

  // 大文件按问题行开窗：优先展示问题行附近 ±25 行，替代无差别硬截断
  const issueLine = context && Number(context.issueLine) > 0 ? Number(context.issueLine) : null;
  if (issueLine) {
    const lines = snippet.split('\n');
    if (lines.length > 60) {
      const half = 25;
      const start = Math.max(0, issueLine - 1 - half);
      const end = Math.min(lines.length, issueLine - 1 + half + 1);
      snippet = lines.slice(start, end).join('\n');
      notes.push(`注：文件较长，已围绕第 ${issueLine} 行开窗，仅展示第 ${start + 1}-${end} 行`);
    }
  }

  // 超长片段仍做截断兜底：过长的代码既增加调用成本，也是缓存 miss 的主要来源
  if (snippet.length > MAX_SNIPPET_CHARS) {
    snippet = snippet.slice(0, MAX_SNIPPET_CHARS);
    notes.push('原代码过长，以上仅保留前 1500 字符，已截断');
  }

  return `请分析以下代码片段并提供优化建议。

任务说明：
- 阅读待优化代码与问题上下文，按照系统提示中的优化总则与专项策略给出最优改法。
- optimizedCode 必须是完整可运行的代码，不要用省略号或注释截断。
- explanation 使用简体中文，聚焦主要改动点。
- suggestions 给出 2~4 条与本次优化相关的最佳实践建议。
- 返回结果必须是一个可直接被 JSON.parse 解析的 json 对象。

以下是本次请求的具体上下文：
代码语言: ${context.language || '未知'}
问题类型: ${context.issueType || 'general'}
问题描述: ${context.message || '一般性优化'}

待优化代码:
\`\`\`${context.language || ''}
${snippet}
\`\`\`${notes.length ? `\n（${notes.join('；')}）` : ''}`;
}

/**
 * 消息规范化：严格对齐官方 OpenAI Chat Completions 的 messages schema。
 * 只保留 role/content 两个字段，role 限定 system|user|assistant，
 * content 统一为字符串——任何调用方传入的多余字段都会被剥离，
 * 保证所有调用路径序列化后的请求逐字节一致（前缀缓存命中的前提）。
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'system' || m.role === 'user' || m.role === 'assistant' ? m.role : 'user';
    let content = m.content;
    if (typeof content !== 'string') {
      // 官方多模态数组格式 → 拼接其中的 text 段
      if (Array.isArray(content)) content = content.filter(p => p && typeof p.text === 'string').map(p => p.text).join('\n');
      else if (content != null) content = String(content);
      else continue;
    }
    out.push({ role, content });
  }
  return out;
}

/**
 * 构建官方 OpenAI Chat Completions 请求体。
 * 字段与顺序严格对齐官方文档示例：model → messages → temperature → top_p
 * → max_tokens → stream → response_format，所有 OpenAI 兼容提供商共用，
 * 确保字节级一致的请求构造（前缀缓存命中的前提）。
 * @param {object} p
 * @param {string} p.model        模型名
 * @param {Array}  p.messages     已规范化消息
 * @param {object} p.options      temperature/topP/maxTokens/stream/jsonMode
 * @param {boolean} p.jsonMode    追加官方 response_format: {type:'json_object'}
 */
function buildChatCompletionsBody({ model, messages, options = {}, jsonMode = false }) {
  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 1,
    max_tokens: options.maxTokens ?? 2000,
    stream: options.stream ?? false
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

/**
 * 统一执行 OpenAI 兼容 /chat/completions 调用。
 * 所有 OpenAI 协议提供商（OpenAI/DeepSeek/智谱/Moonshot/豆包/自定义）共用：
 * - 请求体由 buildChatCompletionsBody 统一构造（官方格式）
 * - 错误按官方 schema 解析（error.message）
 * - 响应按官方 schema 提取（choices[0].message.content + usage）
 * - json 模式下若网关返回 400（不支持 response_format），自动降级重试一次
 * - 返回值附带 extractUsage 的缓存命中统计
 */
async function postChatCompletions({ url, apiKey, model, messages, options = {}, jsonMode = false, label = 'LLM' }) {
  const send = async (withJsonMode) => {
    const body = buildChatCompletionsBody({ model, messages: normalizeMessages(messages), options, jsonMode: withJsonMode });
    return fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    }, label);
  };

  let response = await send(jsonMode);
  // 部分 OpenAI 兼容网关不支持 response_format：400 时去掉该字段重试一次
  if (!response.ok && response.status === 400 && jsonMode) {
    response = await send(false);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`${label}错误: ${errorData.error?.message || errorData.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // 按官方语义解析 JSON 输出（json 模式或模型自律输出时直接得到对象）
  let parsed = null;
  try {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
  } catch (e) { /* 保持 null，调用方按原文处理 */ }

  return {
    // 仅在调用方明确要求 JSON 输出（jsonMode）时才把解析结果作为 content；
    // 普通聊天回复可能包含 JSON 示例/代码块，绝不能自动解析成对象（否则前端收到 [object Object]）
    content: jsonMode && parsed ? parsed : content,
    rawContent: content,
    tokensUsed: data.usage?.total_tokens || 0,
    usage: extractUsage(data),
    model: data.model || model
  };
}

/**
 * 带指数退避的 fetch 重试：429 限流、5xx 服务端错误、网络抖动自动重试（最多 2 次）。
 * 4xx 业务错误（401/400 等）不重试；AbortError（用户主动取消）立即抛出。
 */
async function fetchWithRetry(url, options = {}, label = 'LLM', maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        logger.warn(`${label} 请求被限流/服务异常(${res.status})，${Math.round(800 * Math.pow(2, attempt))}ms 后重试 (${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e && e.name === 'AbortError') throw e;
      if (attempt < maxRetries) {
        logger.warn(`${label} 网络错误(${e.message})，${Math.round(800 * Math.pow(2, attempt))}ms 后重试 (${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * OpenAI 兼容协议的 SSE 流式对话：逐 delta 回调 onDelta，返回完整聚合结果。
 * body 由 buildChatCompletionsBody 统一构造（stream: true）。
 */
async function streamChatCompletions({ url, apiKey, model, messages, options = {}, label = 'LLM', onDelta = () => {}, signal }) {
  const body = buildChatCompletionsBody({ model, messages: normalizeMessages(messages), options: { ...options, stream: true }, jsonMode: false });
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  }, label);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`${label}错误: ${errorData.error?.message || errorData.message || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let usage = null;
  let modelUsed = model;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onDelta(delta);
        }
        if (j.usage) usage = extractUsage(j);
        if (j.model) modelUsed = j.model;
      } catch (e) { /* 忽略无法解析的心跳/杂项行 */ }
    }
  }

  return {
    content: full,
    rawContent: full,
    tokensUsed: usage?.total_tokens || 0,
    usage,
    model: modelUsed
  };
}

/**
 * LLM提供商基类
 */
class LLMProvider {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.cachedKey = null;
    this.cacheTime = 0;
    // 由 providerManager.register 注入，用于记录 token 用量
    this.usageRecorder = null;
  }

  /**
   * 记录一次调用的用量（注入的 usageRecorder 由管理器实现）
   */
  trackUsage(data) {
    try {
      if (typeof this.usageRecorder === 'function' && data) {
        this.usageRecorder(extractUsage(data), data.model);
      }
    } catch (e) {
      // 记录失败不影响主流程
    }
  }

  async getKeyFromDB() {
    const now = Date.now();
    if (this.cachedKey && now - this.cacheTime < 300000) {
      return this.cachedKey;
    }

    const key = await getLLMKeyFromDB(this.name);
    if (key) {
      this.cachedKey = key;
      this.cacheTime = now;
    }
    return key;
  }

  async chat(messages, options = {}) {
    throw new Error('子类必须实现chat方法');
  }

  /**
   * 流式对话：OpenAI 兼容协议提供商（openaiProtocol 标记）走 SSE 真·逐字输出，
   * 其余提供商回落为一次性返回（模拟单次增量）。signal 用于用户中断。
   */
  async chatStream(messages, options = {}, onDelta = () => {}, signal) {
    if (!this.openaiProtocol) {
      const result = await this.chat(messages, { ...options, jsonMode: false });
      const content = typeof result.content === 'string' ? result.content : String(result.content || '');
      if (content) onDelta(content);
      return result;
    }

    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error(`${this.name} API Key未配置`);
    }
    const apiKey = dbKey.api_key;
    const baseUrl = (dbKey.api_url || this.baseURL).replace(/\/+$/, '');
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';
    return streamChatCompletions({
      url,
      apiKey,
      model: options.model || dbKey.model_name || this.model,
      messages,
      options,
      label: `${this.name} API`,
      onDelta,
      signal
    });
  }

  async optimizeCode(codeSnippet, context, options = {}) {
    const prompt = buildOptimizationPrompt(codeSnippet, context);
    const messages = [
      { role: 'system', content: OPTIMIZATION_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ];
    // jsonMode → 官方 response_format: {type:'json_object'}，提升 JSON 输出可靠性
    return this.chat(messages, { ...options, jsonMode: true });
  }
}

/**
 * OpenAI提供商
 */
class OpenAIProvider extends LLMProvider {
  constructor(config) {
    super('openai', config);
    this.openaiProtocol = true;
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('OpenAI API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = (dbKey.api_url || this.baseURL).replace(/\/+$/, '');
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

    try {
      return await postChatCompletions({
        url,
        apiKey,
        model: options.model || dbKey.model_name || this.model,
        messages,
        options,
        jsonMode: !!options.jsonMode,
        label: 'OpenAI API'
      });
    } catch (error) {
      logger.error('OpenAI调用失败:', error);
      throw error;
    }
  }
}

/**
 * Claude (Anthropic) 提供商
 */
class ClaudeProvider extends LLMProvider {
  constructor(config) {
    super('claude', config);
    this.baseURL = config.baseURL || 'https://api.anthropic.com/v1';
    this.model = config.model || 'claude-3-sonnet-20240229';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('Claude API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const url = (dbKey.api_url || this.baseURL) + '/messages';

    // 转换消息格式
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const userMessages = messages.filter(m => m.role !== 'system');

    const body = {
      model: options.model || dbKey.model_name || this.model,
      max_tokens: options.maxTokens || 2000,
      temperature: options.temperature ?? 0.7,
      system: systemMessage,
      messages: userMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    };

    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      }, 'Claude API');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Claude API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: options.jsonMode && parsed ? parsed : content,
        rawContent: content,
        tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens || 0,
        usage: extractUsage(data),
        model: data.model
      };
    } catch (error) {
      logger.error('Claude调用失败:', error);
      throw error;
    }
  }
}

/**
 * Ollama (本地大模型) 提供商
 */
class OllamaProvider extends LLMProvider {
  constructor(config) {
    super('ollama', config);
    this.baseURL = config.baseURL || 'http://localhost:11434';
    this.model = config.model || 'codellama';
  }

  async isAvailable() {
    // Ollama不需要API Key，但需要本地服务运行
    // 尝试连接本地服务验证可用性
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseURL}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  async chat(messages, options = {}) {
    const url = `${this.baseURL}/api/chat`;
    const body = {
      model: options.model || this.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens || 2000
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Ollama服务错误: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.message?.content || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: options.jsonMode && parsed ? parsed : content,
        rawContent: content,
        tokensUsed: data.eval_count || 0,
        usage: extractUsage(data),
        model: data.model
      };
    } catch (error) {
      logger.error('Ollama调用失败:', error);
      throw error;
    }
  }
}

/**
 * Google Gemini 提供商
 */
class GeminiProvider extends LLMProvider {
  constructor(config) {
    super('gemini', config);
    this.baseURL = config.baseURL || 'https://generativelanguage.googleapis.com/v1beta';
    this.model = config.model || 'gemini-1.5-pro';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('Gemini API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = dbKey.api_url || this.baseURL;
    const model = options.model || dbKey.model_name || this.model;
    const url = `${baseUrl}/models/${model}:generateContent`;
    
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }]
    }));

    const body = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens || 2000,
        topP: options.topP || 1
      }
    };

    try {
      const response = await fetchWithRetry(`${url}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, 'Gemini API');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: options.jsonMode && parsed ? parsed : content,
        rawContent: content,
        tokensUsed: data.usageMetadata?.totalTokenCount || 0,
        usage: extractUsage(data),
        model: data.model
      };
    } catch (error) {
      logger.error('Gemini调用失败:', error);
      throw error;
    }
  }
}

/**
 * 阿里通义千问 提供商
 */
class TongyiProvider extends LLMProvider {
  constructor(config) {
    super('tongyi', config);
    this.baseURL = config.baseURL || 'https://dashscope.aliyuncs.com/api/v1';
    this.model = config.model || 'qwen-plus';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('通义千问 API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = dbKey.api_url || this.baseURL;
    const url = `${baseUrl}/services/aigc/text-generation/generation`;
    const body = {
      model: options.model || dbKey.model_name || this.model,
      input: {
        messages
      },
      parameters: {
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 2000
      }
    };

    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      }, '通义千问');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`通义千问错误: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.output?.text || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: options.jsonMode && parsed ? parsed : content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        usage: extractUsage(data),
        model: data.model
      };
    } catch (error) {
      logger.error('通义千问调用失败:', error);
      throw error;
    }
  }
}

/**
 * 字节豆包 提供商
 */
class DoubaoProvider extends LLMProvider {
  constructor(config) {
    super('doubao', config);
    this.openaiProtocol = true;
    this.baseURL = config.baseURL || 'https://api.doubao.com/v1';
    this.model = config.model || 'Doubao-7B';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('豆包 API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = (dbKey.api_url || this.baseURL).replace(/\/+$/, '');
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

    try {
      return await postChatCompletions({
        url,
        apiKey,
        model: options.model || dbKey.model_name || this.model,
        messages,
        options,
        jsonMode: !!options.jsonMode,
        label: '豆包 API'
      });
    } catch (error) {
      logger.error('豆包调用失败:', error);
      throw error;
    }
  }
}

/**
 * 百度文心一言 提供商
 */
class WenxinProvider extends LLMProvider {
  constructor(config) {
    super('wenxin', config);
    this.baseURL = config.baseURL || 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat';
    this.accessToken = null;
    this.tokenExpireTime = 0;
    this.model = config.model || 'ernie-3.5';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    if (!key || !key.api_key) return false;
    // 文心一言需要apiKey和secretKey，存储格式为JSON或分隔符
    try {
      const keyData = JSON.parse(key.api_key);
      return !!keyData.apiKey && !!keyData.secretKey;
    } catch (e) {
      // 如果不是JSON，尝试分隔符格式 "apiKey|secretKey"
      const parts = key.api_key.split('|');
      return parts.length === 2 && parts[0] && parts[1];
    }
  }

  async getAccessToken(apiKey, secretKey) {
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }

    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
    const response = await fetchWithRetry(url, {}, '文心一言Token');
    const data = await response.json();
    
    this.accessToken = data.access_token;
    this.tokenExpireTime = Date.now() + (data.expires_in - 60) * 1000;
    
    return this.accessToken;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('文心一言 API Key未配置');
    }

    let apiKey, secretKey;
    try {
      const keyData = JSON.parse(dbKey.api_key);
      apiKey = keyData.apiKey;
      secretKey = keyData.secretKey;
    } catch (e) {
      const parts = dbKey.api_key.split('|');
      apiKey = parts[0];
      secretKey = parts[1];
    }

    if (!apiKey || !secretKey) {
      throw new Error('文心一言 API Key或Secret Key未配置');
    }

    const accessToken = await this.getAccessToken(apiKey, secretKey);
    const baseUrl = dbKey.api_url || this.baseURL;
    const model = options.model || dbKey.model_name || this.model;
    const url = `${baseUrl}/${model}?access_token=${accessToken}`;

    const body = {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000
    };

    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, '文心一言');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`文心一言错误: ${errorData.error_msg || response.statusText}`);
      }

      const data = await response.json();
      const content = data.result || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: options.jsonMode && parsed ? parsed : content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        usage: extractUsage(data),
        model: model
      };
    } catch (error) {
      logger.error('文心一言调用失败:', error);
      throw error;
    }
  }
}

/**
 * Azure OpenAI 提供商
 */
class AzureOpenAIProvider extends LLMProvider {
  constructor(config) {
    super('azure', config);
    this.apiVersion = config.apiVersion || '2024-02-01';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    if (!key || !key.api_key) return false;
    // Azure需要endpoint和apiKey，endpoint存储在api_url
    return !!key.api_url && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key || !dbKey.api_url) {
      throw new Error('Azure OpenAI配置不完整');
    }

    const apiKey = dbKey.api_key;
    const endpoint = dbKey.api_url;
    const deploymentName = dbKey.model_name || 'gpt-4';
    const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${this.apiVersion}`;
    const body = {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000
    };

    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify(body)
      }, 'Azure OpenAI');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Azure OpenAI错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: options.jsonMode && parsed ? parsed : content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        usage: extractUsage(data),
        model: data.model
      };
    } catch (error) {
      logger.error('Azure OpenAI调用失败:', error);
      throw error;
    }
  }
}

/**
 * DeepSeek 提供商
 */
class DeepSeekProvider extends LLMProvider {
  constructor(config) {
    super('deepseek', config);
    this.openaiProtocol = true;
    this.baseURL = config.baseURL || 'https://api.deepseek.com/v1';
    this.model = config.model || 'deepseek-chat';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('DeepSeek API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = (dbKey.api_url || this.baseURL).replace(/\/+$/, '');
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

    try {
      return await postChatCompletions({
        url,
        apiKey,
        model: options.model || dbKey.model_name || this.model,
        messages,
        options,
        jsonMode: !!options.jsonMode,
        label: 'DeepSeek'
      });
    } catch (error) {
      logger.error('DeepSeek调用失败:', error);
      throw error;
    }
  }
}

/**
 * 智谱AI (ChatGLM) 提供商
 */
class ZhipuProvider extends LLMProvider {
  constructor(config) {
    super('zhipu', config);
    this.baseURL = config.baseURL || 'https://open.bigmodel.cn/api/paas/v4';
    this.model = config.model || 'glm-4';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('智谱AI API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const url = (dbKey.api_url || this.baseURL) + '/chat/completions';
    const body = {
      model: options.model || dbKey.model_name || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000,
      top_p: options.topP || 1,
      stream: options.stream || false
    };

    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      }, '智谱AI');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`智谱AI错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      return {
        content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        usage: extractUsage(data),
        model: data.model
      };
    } catch (error) {
      logger.error('智谱AI调用失败:', error);
      throw error;
    }
  }
}

/**
 * Moonshot AI (Kimi) 提供商
 */
class MoonshotProvider extends LLMProvider {
  constructor(config) {
    super('moonshot', config);
    this.openaiProtocol = true;
    this.baseURL = config.baseURL || 'https://api.moonshot.cn/v1';
    this.model = config.model || 'moonshot-v1-8k';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('Moonshot API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = (dbKey.api_url || this.baseURL).replace(/\/+$/, '');
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

    try {
      return await postChatCompletions({
        url,
        apiKey,
        model: options.model || dbKey.model_name || this.model,
        messages,
        options,
        jsonMode: !!options.jsonMode,
        label: 'Moonshot'
      });
    } catch (error) {
      logger.error('Moonshot调用失败:', error);
      throw error;
    }
  }
}

/**
 * 自定义提供商（OpenAI 兼容协议）
 * 适配任意兼容 /chat/completions 的服务：国产模型代理、OneAPI、vLLM、私有部署等
 * name 以 custom- 开头，配置从 llm_api_keys 表按名读取
 */
class CustomProvider extends LLMProvider {
  constructor(name, config) {
    super(name, config);
    this.openaiProtocol = true;
    this.model = config.model || '';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key && !!key.api_url;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key || !dbKey.api_url) {
      throw new Error(`自定义提供商 ${this.name} 配置不完整（需 API Key 与 API 地址）`);
    }

    const apiKey = dbKey.api_key;
    const base = dbKey.api_url.replace(/\/+$/, '');
    const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';

    try {
      return await postChatCompletions({
        url,
        apiKey,
        model: options.model || dbKey.model_name || this.model || 'default',
        messages,
        options,
        jsonMode: !!options.jsonMode,
        label: this.name
      });
    } catch (error) {
      logger.error(`自定义提供商 ${this.name} 调用失败:`, error);
      throw error;
    }
  }
}

/**
 * LLM提供商管理器
 */
class LLMProviderManager {
  constructor() {
    this.providers = new Map();
    this.activeProvider = null;
    this._cachedProviders = [];
    // 会话级用量统计（实时），历史累计持久化在 api_request_log
    this.sessionUsage = {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      requests: 0
    };

    this.register('openai', {});
    this.register('deepseek', {});
    this.register('zhipu', {});
    this.register('tongyi', {});
    this.register('moonshot', {});
    this.register('ollama', {});
  }

  /**
   * 记录一次调用用量：更新会话统计 + 持久化到 api_request_log
   */
  recordUsage(usage, providerName, model) {
    if (!usage || typeof usage !== 'object') return;
    const s = this.sessionUsage;
    s.requests += 1;
    s.totalTokens += usage.totalTokens || 0;
    s.promptTokens += usage.promptTokens || 0;
    s.completionTokens += usage.completionTokens || 0;
    s.cacheHitTokens += usage.cacheHitTokens || 0;
    s.cacheMissTokens += usage.cacheMissTokens || 0;
    try {
      const { getDatabase } = require('../../utils/database');
      const db = getDatabase();
      db.prepare(
        `INSERT INTO api_request_log (provider_name, endpoint, request_method, response_status, tokens_used, is_success)
         VALUES (?, ?, 'POST', 200, ?, 1)`
      ).run(providerName || 'unknown', model || 'chat/completions', usage.totalTokens || 0);
    } catch (e) {
      logger.debug(`记录API用量失败: ${e.message}`);
    }
  }

  /**
   * 查询用量：会话实时 + 历史累计（api_request_log 聚合）
   */
  getUsageStats() {
    let history = { totalTokens: 0, requests: 0 };
    try {
      const { getDatabase } = require('../../utils/database');
      const db = getDatabase();
      const row = db.prepare(
        `SELECT COALESCE(SUM(tokens_used), 0) AS totalTokens, COUNT(*) AS requests
         FROM api_request_log WHERE is_success = 1`
      ).get();
      if (row) history = { totalTokens: row.totalTokens || 0, requests: row.requests || 0 };
    } catch (e) {
      logger.debug(`查询历史用量失败: ${e.message}`);
    }
    const active = this.getActiveProvider();
    const s = this.sessionUsage;
    const cacheTotal = s.cacheHitTokens + s.cacheMissTokens;
    return {
      active: active ? { name: active.name, model: active.model || null } : null,
      session: {
        ...s,
        cacheHitRate: cacheTotal > 0 ? Math.round((s.cacheHitTokens / cacheTotal) * 1000) / 10 : null
      },
      history
    };
  }
  
  async init() {
    await this.loadCustomProviders();
    await this.refreshProviderStatus();
    await this.restoreActiveProvider();
  }

  /**
   * 从数据库加载自定义提供商（provider_name 以 custom- 开头）
   */
  async loadCustomProviders() {
    try {
      const { dbAdapter } = require('../../utils/dbAdapter');
      const sqlite = dbAdapter.getSqlite();
      const rows = sqlite.prepare("SELECT provider_name, api_url, model_name FROM llm_api_keys WHERE provider_name LIKE 'custom-%'").all();
      for (const row of rows) {
        try {
          this.register(row.provider_name, {});
        } catch (e) {
          logger.warn(`加载自定义提供商 ${row.provider_name} 失败: ${e.message}`);
        }
      }
      if (rows.length > 0) {
        logger.info(`已加载 ${rows.length} 个自定义LLM提供商`);
      }
    } catch (error) {
      logger.warn(`加载自定义提供商失败: ${error.message}`);
    }
  }
  
  async restoreActiveProvider() {
    try {
      const { queryOne } = require('../../utils/database');
      const config = await queryOne('SELECT config_value FROM sys_config WHERE config_key = ?', ['active_llm_provider']);
      
      if (config && config.config_value) {
        const savedProvider = config.config_value.toLowerCase();
        const provider = this.providers.get(savedProvider);
        
        if (provider) {
          try {
            if (await provider.isAvailable()) {
              this.activeProvider = provider;
              logger.info(`已恢复上次使用的提供商: ${savedProvider}`);
              return;
            } else {
              logger.warn(`上次使用的提供商 ${savedProvider} 不可用，正在自动检测...`);
            }
          } catch (e) {
            logger.warn(`检查提供商 ${savedProvider} 失败: ${e.message}`);
          }
        }
      }
      
      await this.autoDetectAvailableProvider();
    } catch (error) {
      logger.warn('恢复活跃提供商失败:', error.message);
      await this.autoDetectAvailableProvider();
    }
  }
  
  async refreshProviderStatus() {
    const providers = [];
    for (const [name, provider] of this.providers) {
      let isAvail = false;
      try {
        isAvail = await provider.isAvailable();
      } catch (e) {
        isAvail = false;
      }
      providers.push({
        name,
        available: isAvail,
        model: provider.model || provider.deploymentName
      });
    }
    this._cachedProviders = providers;
    return providers;
  }
  
  async autoDetectAvailableProvider() {
    for (const [name, provider] of this.providers) {
      try {
        if (await provider.isAvailable()) {
          this.activeProvider = provider;
          logger.info(`自动检测到可用提供商: ${name}`);
          return;
        }
      } catch (error) {
        logger.debug(`检测提供商 ${name} 失败: ${error.message}`);
      }
    }
    logger.warn('未检测到可用的LLM提供商，请在数据库中配置API密钥');
  }

  /**
   * 注册提供商
   */
  register(name, config) {
    let provider;
    switch (name.toLowerCase()) {
      case 'openai':
        provider = new OpenAIProvider(config);
        break;
      case 'claude':
      case 'anthropic':
        provider = new ClaudeProvider(config);
        break;
      case 'ollama':
        provider = new OllamaProvider(config);
        break;
      case 'azure':
      case 'azureopenai':
        provider = new AzureOpenAIProvider(config);
        break;
      case 'gemini':
      case 'google':
        provider = new GeminiProvider(config);
        break;
      case 'tongyi':
      case 'qwen':
        provider = new TongyiProvider(config);
        break;
      case 'doubao':
      case 'bytedance':
        provider = new DoubaoProvider(config);
        break;
      case 'wenxin':
      case 'ernie':
      case 'baidu':
        provider = new WenxinProvider(config);
        break;
      case 'deepseek':
        provider = new DeepSeekProvider(config);
        break;
      case 'zhipu':
      case 'chatglm':
      case 'glm':
        provider = new ZhipuProvider(config);
        break;
      case 'moonshot':
      case 'kimi':
        provider = new MoonshotProvider(config);
        break;
      default:
        if (name.toLowerCase().startsWith('custom-')) {
          provider = new CustomProvider(name.toLowerCase(), config);
        } else {
          throw new Error(`不支持的提供商: ${name}`);
        }
    }

    // 包装 chat：统一记录 token 用量与缓存命中（覆盖所有调用路径）
    const providerName = name.toLowerCase();
    const originalChat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const result = await originalChat(messages, options);
      try {
        if (result && result.usage) {
          this.recordUsage(result.usage, providerName, result.model);
        }
      } catch (e) {
        // 记录失败不影响调用
      }
      return result;
    };

    this.providers.set(providerName, provider);
    
    // Worker 环境下使用 debug 级别，避免重复日志
    const isWorker = !!process.env.WORKER_THREAD_ID;
    if (isWorker) {
      logger.debug(`注册LLM提供商: ${name}`);
    } else {
      logDeduplicator.logWithDeduplication('info', `llm_register_${name.toLowerCase()}`, `注册LLM提供商: ${name}`);
    }
    return provider;
  }

  /**
   * 设置活跃提供商
   */
  async setActiveProvider(name) {
    const provider = this.providers.get(name.toLowerCase());
    if (!provider) {
      throw new Error(`未找到提供商: ${name}`);
    }
    if (!(await provider.isAvailable())) {
      throw new Error(`提供商 ${name} 不可用，请检查数据库配置`);
    }
    this.activeProvider = provider;
    logger.info(`切换活跃LLM提供商: ${name}`);
    
    // 保存到数据库
    try {
      const { execute } = require('../../utils/database');
      await execute(
        'INSERT OR REPLACE INTO sys_config (config_key, config_value, config_type, description, is_public) VALUES (?, ?, ?, ?, ?)',
        ['active_llm_provider', name.toLowerCase(), 'string', '当前活跃的LLM提供商', 0]
      );
    } catch (error) {
      logger.warn('保存活跃提供商失败:', error.message);
    }
    
    return provider;
  }

  /**
   * 获取活跃提供商
   */
  getActiveProvider() {
    return this.activeProvider;
  }

  /**
   * 获取所有可用提供商（同步返回缓存结果）
   */
  getAvailableProviders() {
    if (this._cachedProviders && this._cachedProviders.length > 0) {
      return this._cachedProviders;
    }
    // 如果缓存为空，返回所有provider但available为false
    const result = [];
    this.providers.forEach((provider, name) => {
      result.push({
        name,
        available: false,
        model: provider.model || provider.deploymentName
      });
    });
    return result;
  }

  /**
   * 获取所有已注册提供商
   */
  getAllProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * 使用活跃提供商发送请求
   */
  async chat(messages, options = {}) {
    if (!this.activeProvider) {
      throw new Error('未设置活跃LLM提供商');
    }
    return this.activeProvider.chat(messages, options);
  }

  /**
   * 使用活跃提供商优化代码
   */
  async optimizeCode(codeSnippet, context, options = {}) {
    if (!this.activeProvider) {
      throw new Error('未设置活跃LLM提供商');
    }
    return this.activeProvider.optimizeCode(codeSnippet, context, options);
  }

  /**
   * 注销提供商（删除自定义提供商时调用）
   */
  unregister(name) {
    const key = name.toLowerCase();
    const provider = this.providers.get(key);
    if (provider) {
      this.providers.delete(key);
      if (this.activeProvider === provider) {
        this.activeProvider = null;
      }
      logger.info(`注销LLM提供商: ${key}`);
    }
  }

  /**
   * 更新提供商配置
   */
  updateProviderConfig(name, config) {
    const provider = this.providers.get(name.toLowerCase());
    if (provider) {
      Object.assign(provider.config, config);
      if (config.baseURL) provider.baseURL = config.baseURL;
      if (config.model) provider.model = config.model;
      if (config.endpoint) provider.endpoint = config.endpoint;
      if (config.deploymentName) provider.deploymentName = config.deploymentName;
      if (config.secretKey) provider.secretKey = config.secretKey;
      if (config.apiVersion) provider.apiVersion = config.apiVersion;
      provider.cachedKey = null;
      logger.info(`更新提供商配置: ${name}`);
    }
  }
}

// 单例实例
const providerManager = new LLMProviderManager();

module.exports = {
  LLMProviderManager,
  OpenAIProvider,
  ClaudeProvider,
  OllamaProvider,
  AzureOpenAIProvider,
  GeminiProvider,
  TongyiProvider,
  DoubaoProvider,
  WenxinProvider,
  CustomProvider,
  OPTIMIZATION_SYSTEM_PROMPT,
  buildOptimizationPrompt,
  providerManager
};
