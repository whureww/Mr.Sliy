/**
 * 报告路由模块：将扫描结果生成 HTML/Markdown 分析报告并落盘
 * 输出目录：~/.mr-sliy/reports/
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDatabase } = require('../utils/database');
const { success, error } = require('../utils/response');
const { generateUUID } = require('../utils/helpers');
const { logger } = require('../utils/logger');

const REPORT_DIR = path.join(os.homedir(), '.mr-sliy', 'reports');

const SEVERITY_ORDER = { high: 0, error: 0, medium: 1, warning: 1, low: 2, info: 2 };

function severityKey(s) {
  const k = String(s || 'medium').toLowerCase();
  return SEVERITY_ORDER[k] !== undefined ? k : 'medium';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityLabel(s) {
  const k = severityKey(s);
  return k === 'high' || k === 'error' ? '高危' : k === 'medium' || k === 'warning' ? '中危' : '低危';
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => f && (f.success === undefined || f.success === true) && Array.isArray(f.issues))
    .map((f) => ({
      filePath: f.filePath || f.path || f.file || '未知文件',
      language: f.language || '',
      totalIssues: f.totalIssues !== undefined ? f.totalIssues : f.issues.length,
      issues: f.issues
    }))
    .sort((a, b) => (b.totalIssues || 0) - (a.totalIssues || 0));
}

function buildMarkdown(payload) {
  const s = payload.summary || {};
  const files = normalizeFiles(payload.files);
  const lines = [];
  lines.push(`# MR·SLIY 代码分析报告`);
  lines.push('');
  lines.push(`- 项目路径：${payload.title || payload.projectPath || '-'}`);
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`- 扫描文件：${s.scannedFiles ?? files.length}${s.totalFiles ? ` / ${s.totalFiles}` : ''}${s.failedFiles ? `（失败 ${s.failedFiles}）` : ''}`);
  lines.push(`- 问题总数：${s.totalIssues ?? files.reduce((n, f) => n + (f.totalIssues || 0), 0)}`);
  if (s.durationMs) lines.push(`- 耗时：${(s.durationMs / 1000).toFixed(1)} 秒`);
  lines.push('');
  lines.push('## 问题明细');
  lines.push('');
  for (const f of files) {
    if (f.issues.length === 0) continue;
    lines.push(`### ${f.filePath}（${f.totalIssues} 个问题）`);
    lines.push('');
    for (const i of f.issues) {
      const loc = i.line ? `第 ${i.line} 行` : '';
      lines.push(`- [${severityLabel(i.severity)}] [${i.type || 'issue'}] ${loc} ${i.message || ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildHtml(payload) {
  const s = payload.summary || {};
  const files = normalizeFiles(payload.files);
  const totalIssues = s.totalIssues ?? files.reduce((n, f) => n + (f.totalIssues || 0), 0);
  const sevCount = { high: 0, medium: 0, low: 0 };
  for (const f of files) {
    for (const i of f.issues) sevCount[severityKey(i.severity)]++;
  }
  const fileBlocks = files
    .filter((f) => f.issues.length > 0)
    .map(
      (f) => `
    <section class="file">
      <h2>${esc(f.filePath)} <span class="badge">${f.totalIssues} 个问题</span></h2>
      <table>
        <thead><tr><th>等级</th><th>类型</th><th>位置</th><th>描述</th></tr></thead>
        <tbody>
          ${f.issues
            .map((i) => {
              const k = severityKey(i.severity);
              return `<tr class="sev-${k}"><td>${severityLabel(i.severity)}</td><td>${esc(i.type || 'issue')}</td><td>${i.line ? `第 ${i.line} 行` : '-'}</td><td>${esc(i.message || '')}</td></tr>`;
            })
            .join('\n')}
        </tbody>
      </table>
    </section>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>MR·SLIY 代码分析报告</title>
<style>
  :root { color-scheme: light; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; background: #FBF7F0; color: #2B2622; margin: 0; padding: 40px 16px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .sub { color: #8A8078; font-size: 13px; margin-bottom: 22px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 26px; }
  .card { background: #fff; border: 1px solid #EBE3D7; border-radius: 12px; padding: 14px 20px; min-width: 130px; }
  .card b { display: block; font-size: 22px; }
  .card span { font-size: 12px; color: #8A8078; }
  section.file { background: #fff; border: 1px solid #EBE3D7; border-radius: 12px; padding: 18px 22px; margin-bottom: 16px; }
  section.file h2 { font-size: 15px; margin: 0 0 12px; word-break: break-all; }
  .badge { background: #F6EEE2; color: #9A6700; border-radius: 99px; padding: 2px 10px; font-size: 11px; vertical-align: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #F1EAE0; vertical-align: top; }
  th { color: #8A8078; font-weight: 600; }
  .sev-high td:first-child { color: #CF222E; font-weight: 700; }
  .sev-medium td:first-child { color: #9A6700; font-weight: 700; }
  .sev-low td:first-child { color: #6E7B8B; font-weight: 700; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>MR·SLIY 代码分析报告</h1>
    <div class="sub">${esc(payload.title || payload.projectPath || '')} · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
    <div class="cards">
      <div class="card"><b>${s.totalFiles ?? files.length}</b><span>发现文件</span></div>
      <div class="card"><b>${s.scannedFiles ?? files.length}</b><span>已扫描</span></div>
      <div class="card"><b>${totalIssues}</b><span>问题总数</span></div>
      <div class="card"><b>${sevCount.high}</b><span>高危</span></div>
      <div class="card"><b>${sevCount.medium}</b><span>中危</span></div>
      <div class="card"><b>${sevCount.low}</b><span>低危</span></div>
      ${s.durationMs ? `<div class="card"><b>${(s.durationMs / 1000).toFixed(1)}s</b><span>耗时</span></div>` : ''}
    </div>
    ${fileBlocks || '<p style="color:#8A8078">未发现需要处理的问题</p>'}
  </div>
</body>
</html>`;
}

/**
 * 生成分析报告：接受项目扫描结果 payload，落盘 HTML 或 Markdown
 */
router.post('/generate', (req, res) => {
  try {
    const { title, projectPath, summary, files, format } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json(error('缺少报告数据（files）', 400));
    }

    const fmt = format === 'md' ? 'md' : 'html';
    const reportId = generateUUID();
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const filePath = path.join(REPORT_DIR, `MRSLIY-报告-${new Date().toISOString().slice(0, 10)}-${reportId.slice(0, 6)}.${fmt}`);
    const content = fmt === 'md' ? buildMarkdown({ title, projectPath, summary, files }) : buildHtml({ title, projectPath, summary, files });
    fs.writeFileSync(filePath, content, 'utf-8');

    logger.info(`分析报告已生成: ${filePath}`);

    // 尝试写入数据库记录（失败不阻塞）
    try {
      const db = getDatabase();
      const sizeKb = Math.round((fs.statSync(filePath).size / 1024) * 100) / 100;
      db.prepare(
        `INSERT INTO code_report (task_id, report_name, report_type, file_path, file_size_kb, summary, created_at) VALUES (0, ?, ?, ?, ?, ?, datetime('now','localtime'))`
      ).run(`MR·SLIY 代码分析报告`, fmt, filePath, sizeKb, JSON.stringify(summary || {}));
    } catch (e) {
      logger.warn('报告记录写入数据库失败（不影响报告文件）:', e.message);
    }

    return res.json(success({ reportId, path: filePath, format: fmt }));
  } catch (err) {
    logger.error('报告生成失败:', err);
    return res.status(500).json(error(err.message));
  }
});

router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM code_report ORDER BY created_at DESC LIMIT 20');
    const reports = stmt.all();

    return res.json(success(reports));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;
