/**
 * MCP (Model Context Protocol) 服务器核心
 * 实现 JSON-RPC 2.0 消息分发与 MCP 方法（initialize / tools/list / tools/call / ping 等）。
 * 传输层（stdio / HTTP）只需将原始消息交给 handleMessage()，并把返回值回发给客户端。
 */

const { logger } = require('../utils/logger');
const { buildToolRegistry, TOOL_SUMMARIES } = require('./tools');

const SERVER_INFO = { name: 'mr-sliy', version: '3.15.0' };
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

function createMcpServer() {
  const registry = buildToolRegistry();

  /**
   * 处理一条 JSON-RPC 消息（对象或 JSON 字符串）。
   * 返回响应对象；通知类消息（无 id）返回 null，不需要回发。
   */
  async function handleMessage(raw) {
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

module.exports = { createMcpServer, SERVER_INFO, SUPPORTED_PROTOCOLS, TOOL_SUMMARIES };
