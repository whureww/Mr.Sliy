/**
 * MCP (Model Context Protocol) 服务器核心
 * 实现 JSON-RPC 2.0 消息分发与 MCP 方法（initialize / tools/list / tools/call / ping 等）。
 * 传输层（stdio / HTTP）只需将原始消息交给 handleMessage()，并把返回值回发给客户端。
 */

const { logger } = require('../utils/logger');
const { buildToolRegistry, TOOL_SUMMARIES } = require('./tools');

// 版本号跟随根 package.json，避免多处手工同步
const SERVER_INFO = { name: 'mr-sliy', version: require('../../package.json').version };
const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];

// JSON-RPC 2.0 标准错误码
const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603
};

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------- 工具调用日志（模块级共享：HTTP 与 stdio 两个传输实例都写入同一份） ----------
const CALL_LOGS = [];
const CALL_LOGS_CAP = 200;

function logToolCall(entry) {
  CALL_LOGS.push(entry);
  if (CALL_LOGS.length > CALL_LOGS_CAP) CALL_LOGS.splice(0, CALL_LOGS.length - CALL_LOGS_CAP);
}

/** 最近的工具调用记录（新的在前），供设置页查看外部客户端都调用了什么 */
function recentToolCalls(limit = 50) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  return CALL_LOGS.slice(-n).reverse();
}

/** 参数摘要：截断到 300 字符，避免日志被大参数撑爆 */
function summarizeArgs(args) {
  try {
    const s = JSON.stringify(args) || '';
    return s.length > 300 ? s.slice(0, 300) + `…(${s.length} chars)` : s;
  } catch {
    return '[unserializable]';
  }
}

function createMcpServer() {
  const registry = buildToolRegistry();

  /**
   * 处理一条 JSON-RPC 消息（对象或 JSON 字符串）。
   * meta.transport 用于调用日志标注来源（http / stdio）。
   * 返回响应对象；通知类消息（无 id）返回 null，不需要回发。
   */
  async function handleMessage(raw, meta) {
    let msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return rpcError(null, ERR.PARSE, 'Parse error');
    }

    const hasId = msg && typeof msg === 'object' && msg.id !== undefined && msg.id !== null;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // 请求格式非法：有 id 才回错误，通知一律静默
      return hasId ? rpcError(msg.id, ERR.INVALID_REQUEST, 'Invalid Request') : null;
    }

    const isNotification = !hasId;
    const transport = meta && meta.transport ? meta.transport : 'unknown';
    // tools/call 全程计时并写日志（含失败/未知工具），其余方法不记录
    if (msg.method === 'tools/call') {
      const started = Date.now();
      const args = (msg.params && msg.params.arguments) || {};
      const name = (msg.params && msg.params.name) || '';
      try {
        const result = await dispatch(msg);
        const isError = !!(result && result.isError);
        logToolCall({
          ts: new Date().toISOString(),
          tool: String(name),
          args: summarizeArgs(args),
          ok: !isError,
          error: isError && Array.isArray(result?.content) ? String(result.content[0]?.text || '').slice(0, 200) : '',
          elapsedMs: Date.now() - started,
          transport
        });
        if (isNotification || result === undefined) return null;
        return { jsonrpc: '2.0', id: msg.id, result };
      } catch (err) {
        logToolCall({
          ts: new Date().toISOString(),
          tool: String(name),
          args: summarizeArgs(args),
          ok: false,
          error: (err && err.message) || 'Internal error',
          elapsedMs: Date.now() - started,
          transport
        });
        throw err;
      }
    }
    try {
      const result = await dispatch(msg);
      if (isNotification || result === undefined) return null;
      return { jsonrpc: '2.0', id: msg.id, result };
    } catch (err) {
      if (isNotification) return null;
      const code = err && err.rpcCode ? err.rpcCode : ERR.INTERNAL;
      const message = err && err.message ? err.message : 'Internal error';
      logger.warn(`MCP 请求 ${msg.method} 失败: ${message}`);
      return { jsonrpc: '2.0', id: msg.id, error: { code, message } };
    }
  }

  async function dispatch(msg) {
    const method = msg.method;
    const params = msg.params || {};

    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        // 客户端版本在支持列表内则原样返回，否则回落到我们支持的最高版本
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL;
        return {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'MR·SLIY 代码优化智能体：提供代码扫描（AST 检测）、AI 优化、助手对话、知识库检索、跨会话记忆与扫描历史等工具。'
        };
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/roots/list_changed':
        return undefined;

      case 'ping':
        return {};

      case 'tools/list':
        return { tools: registry.list() };

      case 'tools/call': {
        const name = params.name;
        const args = params.arguments || {};
        const tool = registry.get(name);
        if (!tool) {
          const err = new Error(`未知工具: ${name}`);
          err.rpcCode = ERR.INVALID_PARAMS;
          throw err;
        }
        try {
          const result = await tool.handler(args);
          // 工具返回 { content:[...] } 则原样采用；普通对象包装为 JSON 文本内容
          if (result && typeof result === 'object' && Array.isArray(result.content)) {
            return result;
          }
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          logger.warn(`MCP 工具 ${name} 执行失败: ${err.message}`);
          return {
            content: [{ type: 'text', text: `工具执行失败: ${err.message}` }],
            isError: true
          };
        }
      }

      default: {
        const err = new Error(`Method not found: ${method}`);
        err.rpcCode = ERR.METHOD_NOT_FOUND;
        throw err;
      }
    }
  }

  return { handleMessage, tools: registry.list() };
}

module.exports = { createMcpServer, SERVER_INFO, SUPPORTED_PROTOCOLS, TOOL_SUMMARIES, recentToolCalls };
