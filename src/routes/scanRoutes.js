/**
 * 扫描路由模块
 * 处理代码扫描相关请求
 */

const express = require('express');
const router = express.Router();
const { detectIssues, batchDetect, saveDetectionResults } = require('../services/detection/detector');
const { optimizeWithRAG } = require('../services/rag/agent');
const { getDatabase } = require('../utils/database');
const { success, error } = require('../utils/response');
const { logger } = require('../utils/logger');
const { generateUUID, getFileLanguage } = require('../utils/helpers');
const fs = require('fs');
const path = require('path');

/**
 * 扫描单个文件
 */
router.post('/file', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { filePath, sourceCode, mode } = req.body;
    
    if (!filePath || !sourceCode) {
      return res.status(400).json(error('缺少必要参数', 400));
    }
    
    // 执行AST检测
    const detectionResult = await detectIssues(sourceCode, filePath);
    
    if (!detectionResult.success) {
      return res.json(error(detectionResult.message));
    }
    
    // 如果为在线模式，执行AI优化
    if (mode === 'online' && detectionResult.issues.length > 0) {
      const optimizationResults = [];

      for (const issue of detectionResult.issues.slice(0, 5)) { // 限制优化数量
        const optimization = await optimizeWithRAG(issue, {
          language: getFileLanguage(filePath),
          issueType: issue.issueType,
          message: issue.message,
          taskId: null
        });

        optimizationResults.push(optimization);
      }

      detectionResult.optimizations = optimizationResults;

      // 汇总本次云端大模型用量（token 与缓存命中）
      const okResults = optimizationResults.filter((o) => o && o.success && o.usage);
      if (okResults.length > 0) {
        const agg = okResults.reduce(
          (acc, o) => {
            acc.totalTokens += o.usage.totalTokens || 0;
            acc.promptTokens += o.usage.promptTokens || 0;
            acc.completionTokens += o.usage.completionTokens || 0;
            acc.cacheHitTokens += o.usage.cacheHitTokens || 0;
            acc.cacheMissTokens += o.usage.cacheMissTokens || 0;
            return acc;
          },
          { totalTokens: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 }
        );
        const cacheTotal = agg.cacheHitTokens + agg.cacheMissTokens;
        const active = require('../services/llm/providers').providerManager.getActiveProvider();
        detectionResult.llmUsage = {
          ...agg,
          requests: okResults.length,
          model: okResults.find((o) => o.model)?.model || null,
          provider: active ? active.name : null,
          cacheHitRate: cacheTotal > 0 ? Math.round((agg.cacheHitTokens / cacheTotal) * 1000) / 10 : null
        };
      }
    }
    
    logger.info(`扫描文件完成: ${filePath}`);
    
    return res.json(success({
      filePath,
      language: detectionResult.language,
      totalIssues: detectionResult.totalIssues,
      issueCounts: detectionResult.issueCounts,
      issues: detectionResult.issues,
      optimizations: detectionResult.optimizations || [],
      llmUsage: detectionResult.llmUsage || null,
      durationMs: Date.now() - startTime
    }));
  } catch (err) {
    logger.error('扫描文件失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 扫描整个项目
 */
router.post('/project', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { projectPath, mode } = req.body;
    
    if (!projectPath) {
      return res.status(400).json(error('缺少项目路径', 400));
    }
    
    // 收集所有待扫描的文件
    const filesToScan = collectFiles(projectPath);
    
    if (filesToScan.length === 0) {
      return res.json(success({
        projectPath,
        totalFiles: 0,
        scannedFiles: 0,
        failedFiles: 0,
        totalIssues: 0,
        results: [],
        durationMs: Date.now() - startTime
      }));
    }
    
    // 执行批量扫描
    const scanResults = await batchDetect(filesToScan);

    // 创建扫描任务记录
    const taskId = generateUUID();
    const projectId = await createProjectRecord(projectPath);

    // 补记项目规模(total_files/total_lines 此前从未填充恒为 0):
    // 质量评分采用加权缺陷密度,需要代码行数作为分母
    try {
      getDatabase().prepare(`
        UPDATE scan_project
        SET total_files = ?, total_lines = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(filesToScan.length, scanResults.totalLines || 0, projectId);
    } catch (sizeErr) {
      logger.warn('记录项目规模失败:', sizeErr.message);
    }
    
    await createTaskRecord(taskId, projectId, {
      scanMode: mode,
      scanType: 'full_project',
      targetPath: projectPath,
      fileCount: filesToScan.length,
      scannedFiles: scanResults.scannedFiles,
      issueCount: scanResults.totalIssues,
      durationMs: Date.now() - startTime
    });
    
    // 存储检测结果
    await saveDetectionResults(taskId, projectId, scanResults.results);
    
    logger.info(`项目扫描完成: ${projectPath}`);
    
    return res.json(success({
      taskId,
      projectId,
      projectPath,
      totalFiles: filesToScan.length,
      scannedFiles: scanResults.scannedFiles,
      failedFiles: scanResults.failedFiles,
      totalIssues: scanResults.totalIssues,
      results: scanResults.results,
      durationMs: Date.now() - startTime
    }));
  } catch (err) {
    logger.error('项目扫描失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 批量扫描指定文件列表
 */
router.post('/batch', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { filePaths, mode } = req.body;
    
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json(error('缺少文件列表', 400));
    }
    
    const scanResults = await batchDetect(filePaths);
    
    return res.json(success({
      totalFiles: filePaths.length,
      scannedFiles: scanResults.scannedFiles,
      failedFiles: scanResults.failedFiles,
      totalIssues: scanResults.totalIssues,
      results: scanResults.results,
      durationMs: Date.now() - startTime
    }));
  } catch (err) {
    logger.error('批量扫描失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 收集待扫描的文件
 */
function collectFiles(projectPath, extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go']) {
  const files = [];
  const excludeDirs = ['node_modules', 'dist', 'build', 'out', '.git', 'coverage', 'vendor'];
  
  function walkDir(dir) {
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        
        if (excludeDirs.includes(item)) {
          continue;
        }
        
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(fullPath);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (err) {
      logger.warn(`无法访问目录: ${dir}`);
    }
  }
  
  walkDir(projectPath);
  return files;
}

/**
 * 创建项目记录
 * 同一路径复用最近的项目记录(扫描次数+1),避免同一项目反复扫描产生重复记录、
 * 缺陷重复累计导致质量评分失真;历史遗留的同路径重复记录,其缺陷与任务并入
 * 复用记录后标记 deleted(幂等,无重复时为空操作)
 */
async function createProjectRecord(projectPath) {
  const db = getDatabase();
  const projectName = path.basename(projectPath);
  // 归一化比较键:去尾部斜杠 + 忽略大小写(Windows 路径不区分大小写)
  const normKey = String(projectPath).replace(/[\\/]+$/, '').toLowerCase();

  const findStmt = db.prepare(`
    SELECT id FROM scan_project
    WHERE status != 'deleted' AND LOWER(RTRIM(project_path, '\\/')) = ?
    ORDER BY id DESC LIMIT 1
  `);
  const existing = findStmt.get(normKey);

  if (existing) {
    db.prepare(`
      UPDATE scan_project
      SET scan_count = scan_count + 1, last_scan_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(existing.id);

    const dupes = db.prepare(`
      SELECT id FROM scan_project
      WHERE status != 'deleted' AND id != ? AND LOWER(RTRIM(project_path, '\\/')) = ?
    `).all(existing.id, normKey);
    for (const d of dupes) {
      db.prepare('UPDATE code_issue SET project_id = ? WHERE project_id = ?').run(existing.id, d.id);
      db.prepare('UPDATE scan_task SET project_id = ? WHERE project_id = ?').run(existing.id, d.id);
      db.prepare(`UPDATE scan_project SET status = 'deleted' WHERE id = ?`).run(d.id);
      logger.info(`合并重复项目记录: #${d.id} -> #${existing.id} (${projectPath})`);
    }
    return existing.id;
  }

  const stmt = db.prepare(`
    INSERT INTO scan_project (project_name, project_path, total_files, scan_count, last_scan_at)
    VALUES (?, ?, 0, 1, CURRENT_TIMESTAMP)
  `);

  const result = stmt.run(projectName, projectPath);
  return result.lastInsertRowid;
}

/**
 * 创建任务记录
 */
async function createTaskRecord(taskId, projectId, data) {
  const db = getDatabase();

  // scan_task.id 为 INTEGER 自增主键，外部 taskId 仅用于业务关联，不写入主键列
  // task_name 在旧库结构中为 NOT NULL，统一提供项目目录名作为任务名
  const stmt = db.prepare(`
    INSERT INTO scan_task (task_name, project_id, scan_mode, scan_type, target_path,
                           file_count, scanned_files, issue_count, duration_ms, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    data.taskName || path.basename(data.targetPath || '') || taskId,
    projectId,
    data.scanMode,
    data.scanType,
    data.targetPath,
    data.fileCount,
    data.scannedFiles,
    data.issueCount,
    data.durationMs,
    'completed'
  );
}

/**
 * 工作区全文搜索（GUI 跨文件搜索）：
 * 遍历 projectPath 下的文本文件，逐行匹配关键字，返回匹配行（文件、行号、内容）。
 * 跳过依赖/构建产物目录与二进制文件；结果与扫描文件数有上限，truncated 标记截断。
 */
router.post('/search', async (req, res) => {
  try {
    const { projectPath, keyword } = req.body || {};
    if (!projectPath || !fs.existsSync(projectPath)) {
      return res.status(400).json(error('工作区路径无效', 400));
    }
    if (!keyword || String(keyword).trim().length < 2) {
      return res.status(400).json(error('关键字至少 2 个字符', 400));
    }
    const started = Date.now();
    const { searchWorkspace } = require('../utils/workspaceSearch');
    const r = searchWorkspace({ root: projectPath, keyword: String(keyword).trim() });
    return res.json(success({ ...r, durationMs: Date.now() - started }));
  } catch (err) {
    logger.error('工作区搜索失败:', err);
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;

// 供 MCP 工具层复用（项目扫描的文件收集与落库逻辑单一来源）
module.exports.collectFiles = collectFiles;
module.exports.createProjectRecord = createProjectRecord;
module.exports.createTaskRecord = createTaskRecord;