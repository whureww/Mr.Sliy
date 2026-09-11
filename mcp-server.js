#!/usr/bin/env node
/**
 * MR·SLIY MCP 服务器独立入口（stdio 模式）
 *
 * 供 Claude Desktop / Cursor / Cline 等 MCP 客户端以子进程方式接入：
 *   command: <node 可执行文件>   args: [本文件绝对路径]
 *
 * 关键约束：
 *   1. stdout 专用于 JSON-RPC 消息 —— 所有 console.* 强制重定向到 stderr；
 *   2. production 环境下 winston 不添加控制台 transport（避免污染 stdout）；
 *   3. 数据库与日志路径固定到 ~/.mr-sliy（外部客户端拉起时 CWD 任意，不能依赖相对路径）。
 */

const os = require('os');
const path = require('path');

// ---------- 1) stdout 保护（必须先于任何业务模块加载） ----------
function toStr(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[k] = (...args) => {
    try {
      process.stderr.write('[mr-sliy-mcp] ' + args.map(toStr).join(' ') + '\n');
    } catch {
      /* stderr 不可写时静默 */
    }
  };
}

// ---------- 2) 固定数据/日志路径到 ~/.mr-sliy ----------
const homeBase = path.join(os.homedir(), '.mr-sliy');
if (!process.env.DB_PATH) process.env.DB_PATH = path.join(homeBase, 'database', 'code_optimizer.db');
if (!process.env.LOG_FILE) process.env.LOG_FILE = path.join(homeBase, 'logs', 'mcp.log');
// 抑制 winston 控制台输出（production 不添加 console transport）
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
// 标记 stdio 模式（不监听 HTTP 端口）
process.env.MRSLIY_MCP = 'stdio';

// ---------- 3) 加载安装目录 .env（若存在；dotenv 不覆盖以上已设变量） ----------
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {
  /* dotenv 缺失时忽略 */
}

// ---------- 4) 启动 stdio 服务器 ----------
require('./src/mcp/stdio').runStdio();
