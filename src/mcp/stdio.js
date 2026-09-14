/**
 * MCP stdio 传输：按行读取 stdin 的 JSON-RPC 消息，响应逐条写入 stdout。
 * 协议约定：stdout 专用于 JSON-RPC 消息，日志一律走 stderr 或文件。
 */

const { logger } = require('../utils/logger');

function runStdio() {
  const { createMcpServer } = require('./server');
  const server = createMcpServer();
  let closed = false;

  const send = (obj) => {
    try {
      process.stdout.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      /* 客户端断开时写入失败，忽略 */
    }
  };

  async function onLine(line) {
    let resp = null;
    try {
      resp = await server.handleMessage(line, { transport: 'stdio' });
    } catch (err) {
      // handleMessage 内部已兜底，此处仅防御极端异常
      resp = { jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } };
    }
    if (!closed && resp) send(resp);
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) void onLine(line);
    }
  });
  process.stdin.on('end', () => {
    closed = true;
    logger.info('MCP stdio 客户端断开，进程退出');
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(1));

  logger.info(`MCP stdio 服务器就绪: ${SERVER_INFO_STRING()}`);
}

function SERVER_INFO_STRING() {
  const { SERVER_INFO } = require('./server');
  return `${SERVER_INFO.name}@${SERVER_INFO.version}`;
}

module.exports = { runStdio };
