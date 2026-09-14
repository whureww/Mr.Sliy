/**
 * MCP 接入状态路由：向 GUI 提供接入信息（协议版本、HTTP 端点、stdio 命令、工具清单），
 * 用于设置页生成 Claude Desktop / Cursor 等客户端的配置片段。
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { success } = require('../utils/response');
const { SERVER_INFO, SUPPORTED_PROTOCOLS, TOOL_SUMMARIES, recentToolCalls } = require('../mcp/server');
const { config } = require('../config');

router.get('/status', (req, res) => {
  const appRoot = path.join(__dirname, '..', '..');
  return res.json(
    success({
      protocolVersion: SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1],
      supportedProtocolVersions: SUPPORTED_PROTOCOLS,
      serverInfo: SERVER_INFO,
      httpUrl: `http://localhost:${config.server.port}/mcp`,
      stdio: {
        command: process.execPath,
        args: [path.join(appRoot, 'mcp-server.js')]
      },
      tools: TOOL_SUMMARIES
    })
  );
});

/**
 * MCP 工具调用日志：外部客户端（Claude Desktop / Cursor 等）通过 HTTP 或 stdio
 * 调用了哪些工具、参数摘要、耗时与成败。环形缓冲 200 条，新的在前。
 */
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  return res.json(success({ logs: recentToolCalls(limit) }));
});

/**
 * MCP 自检:设置页"检测可用性"按钮调用。
 * 不是回显静态配置——真实走一遍本进程的 HTTP 传输(POST /mcp):
 * initialize 握手 → tools/list → ping,三步全成功才算可用。
 * 每步记录耗时,失败时带出 JSON-RPC 错误信息。
 *
 * 注意探测地址必须用 localhost 而非 127.0.0.1:服务监听 config.server.host
 * (默认 localhost,在部分 Windows 环境解析为 IPv6 ::1),硬编码 127.0.0.1
 * 会在仅监听 IPv6 回环的机器上 fetch failed(实测本机)。
 */
router.get('/selftest', async (req, res) => {
  const url = `http://localhost:${config.server.port}/mcp`;

  /** 发送一条 JSON-RPC 请求并等待响应(无状态模式,单次 POST) */
  const rpc = async (method, params, id) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const started = Date.now();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        signal: ctrl.signal
      });
      const elapsed = Date.now() - started;
      if (!r.ok) {
        let errText = `HTTP ${r.status}`;
        try {
          const j = await r.json();
          if (j && j.error) errText += `: ${j.error.message}`;
        } catch { /* 非 JSON 响应体 */ }
        return { ok: false, elapsed, error: errText };
      }
      const j = await r.json();
      if (j && j.error) return { ok: false, elapsed, error: `${j.error.code}: ${j.error.message}` };
      return { ok: true, elapsed, result: j && j.result };
    } catch (e) {
      return { ok: false, elapsed: Date.now() - started, error: e.name === 'AbortError' ? '请求超时(5s)' : e.message };
    } finally {
      clearTimeout(timer);
    }
  };

  const steps = [];

  // 1) initialize 握手
  const init = await rpc('initialize', {
    protocolVersion: SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1],
    capabilities: {},
    clientInfo: { name: 'mr-sliy-selftest', version: '1.0.0' }
  }, 1);
  steps.push({ step: 'initialize', ok: init.ok, elapsed: init.elapsed, error: init.error || '', serverInfo: init.ok ? init.result?.serverInfo || null : null });
  if (!init.ok) {
    return res.json(success({ available: false, url, steps }));
  }

  // 2) tools/list(验证工具注册表可枚举)
  const list = await rpc('tools/list', {}, 2);
  steps.push({ step: 'tools/list', ok: list.ok, elapsed: list.elapsed, error: list.error || '', toolCount: list.ok ? (list.result?.tools || []).length : 0 });
  if (!list.ok) {
    return res.json(success({ available: false, url, steps }));
  }

  // 3) ping 存活确认
  const ping = await rpc('ping', {}, 3);
  steps.push({ step: 'ping', ok: ping.ok, elapsed: ping.elapsed, error: ping.error || '' });

  return res.json(
    success({
      available: ping.ok,
      url,
      steps,
      totalMs: steps.reduce((s, x) => s + x.elapsed, 0),
      toolCount: steps[1].toolCount
    })
  );
});

module.exports = router;
