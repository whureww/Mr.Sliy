/**
 * MCP 接入状态路由：向 GUI 提供接入信息（协议版本、HTTP 端点、stdio 命令、工具清单），
 * 用于设置页生成 Claude Desktop / Cursor 等客户端的配置片段。
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { success } = require('../utils/response');
const { SERVER_INFO, SUPPORTED_PROTOCOLS, TOOL_SUMMARIES } = require('../mcp/server');
const { config } = require('../config');

router.get('/status', (req, res) => {
  const appRoot = path.join(__dirname, '..', '..');
  return res.json(
    success({
      protocolVersion: SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1],
      supportedProtocolVersions: SUPPORTED_PROTOCOLS,
      serverInfo: SERVER_INFO,
      httpUrl: `http://127.0.0.1:${config.server.port}/mcp`,
      stdio: {
        command: process.execPath,
        args: [path.join(appRoot, 'mcp-server.js')]
      },
      tools: TOOL_SUMMARIES
    })
  );
});

module.exports = router;
