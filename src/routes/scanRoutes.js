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
    }
    
    logger.info(`扫描文件完成: ${filePath}`);
    
    return res.json(success({
      filePath,
      language: detectionResult.language,
      totalIssues: detectionResult.totalIssues,
      issueCounts: detectionResult.issueCounts,
      issues: detectionResult.issues,
      optimizations: detectionResult.optimizations || [],
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
        totalFiles: 0,
        scannedFiles: 0,
        totalIssues: 0,
        durationMs: Date.now() - startTime
      }));
    }
    
    // 执行批量扫描
    const scanResults = await batchDetect(filesToScan);
    
    // 创建扫描任务记录
    const taskId = generateUUID();
    const projectId = await createProjectRecord(projectPath);
    
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
 */
async function createProjectRecord(projectPath) {
  const db = getDatabase();
  const projectName = path.basename(projectPath);
  
  const stmt = db.prepare(`
    INSERT INTO scan_project (project_name, project_path, total_files)
    VALUES (?, ?, ?)
  `);
  
  const result = stmt.run(projectName, projectPath, 0);
  return result.lastInsertRowid;
}

/**
 * 创建任务记录
 */
async function createTaskRecord(taskId, projectId, data) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    INSERT INTO scan_task (id, project_id, scan_mode, scan_type, target_path, 
                           file_count, scanned_files, issue_count, duration_ms, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    taskId,
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

module.exports = router;