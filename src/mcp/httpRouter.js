/**
 * MCP Streamable HTTP 传输（无状态模式）：
 * POST /mcp 接收单条 JSON-RPC 消息（或批处理数组），以 JSON 返回响应。
 * 通知类消息不产生响应（HTTP 202）。GET（SSE 流）暂不支持，返回 405。
 */

const express = require('express');
const { logger } = require('../utils/logger');

const router = express.Router();
const { createMcpServer } = require('./server');
const server = createMcpServer();

router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const isBatch = Array.isArray(body);
    const msgs = isBatch ? body : [body];

    const out = [];
    for (const m of msgs) {
      // eslint-disable-next-line no-await-in-loop
      const r = await server.handleMessage(m, { transport: 'http' });
      if (r) out.push(r);
    }

    if (out.length === 0) {
      return res.status(202).end();
    }
    return res.json(isBatch ? out : out[0]);
  } catch (err) {
    logger.error(`MCP HTTP 处理失败: ${err.message}`);
    return res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } });
  }
});

router.get('/', (req, res) => {
  return res.status(405).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32000, message: '本服务器为无状态模式，仅支持 POST；SSE 流式传输暂未启用' }
  });
});

module.exports = router;
