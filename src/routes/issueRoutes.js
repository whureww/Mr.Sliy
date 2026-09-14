/**
 * 缺陷路由模块
 * 处理代码缺陷查询和管理
 */

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../utils/database');
const { success, error, paginate } = require('../utils/response');
const { logger } = require('../utils/logger');

/**
 * 获取缺陷列表
 */
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const taskId = req.query.taskId;
    const projectId = req.query.projectId;
    const severity = req.query.severity;
    const issueType = req.query.issueType;
    const isFixed = req.query.isFixed;
    
    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (taskId) {
      whereClause += ' AND task_id = ?';
      params.push(taskId);
    }
    
    if (projectId) {
      whereClause += ' AND project_id = ?';
      params.push(projectId);
    }
    
    if (severity) {
      whereClause += ' AND severity = ?';
      params.push(severity);
    }
    
    if (issueType) {
      whereClause += ' AND issue_type = ?';
      params.push(issueType);
    }
    
    if (isFixed) {
      whereClause += ' AND is_fixed = ?';
      params.push(isFixed === 'true' ? 1 : 0);
    }
    
    // 查询总数
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM code_issue ${whereClause}`);
    const countResult = countStmt.get(...params);
    const total = countResult.total;
    
    // 查询数据
    const offset = (page - 1) * pageSize;
    const dataStmt = db.prepare(`
      SELECT * FROM code_issue ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    
    const issues = dataStmt.all(...params, pageSize, offset);
    
    return res.json(paginate(issues, total, page, pageSize));
  } catch (err) {
    logger.error('获取缺陷列表失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 获取缺陷统计信息
 * 支持 ?projectId= 按项目过滤（质量概览按单个项目的扫描情况展示评分）；
 * 不传 projectId 时为全库聚合（历史行为兼容）
 * 注意：必须注册在 GET /:id 之前，否则 "stats" 会被当作缺陷 id 捕获
 */
router.get('/stats', (req, res) => {
  try {
    const db = getDatabase();

    const projectId = req.query.projectId;
    let projectFilter = '';
    const filterParams = [];
    if (projectId) {
      projectFilter = ' WHERE project_id = ?';
      filterParams.push(projectId);
    }

    // 一次性回填历史遗留的空语言字段（按文件扩展名推断），幂等
    try {
      db.prepare(`
        UPDATE code_issue SET language = CASE
          WHEN file_path LIKE '%.ts' OR file_path LIKE '%.tsx' THEN 'typescript'
          WHEN file_path LIKE '%.js' OR file_path LIKE '%.jsx' OR file_path LIKE '%.mjs' OR file_path LIKE '%.cjs' THEN 'javascript'
          WHEN file_path LIKE '%.py' THEN 'python'
          WHEN file_path LIKE '%.java' THEN 'java'
          WHEN file_path LIKE '%.go' THEN 'go'
          WHEN file_path LIKE '%.rs' THEN 'rust'
          WHEN file_path LIKE '%.c' OR file_path LIKE '%.h' THEN 'c'
          WHEN file_path LIKE '%.cpp' OR file_path LIKE '%.cc' OR file_path LIKE '%.hpp' THEN 'cpp'
          WHEN file_path LIKE '%.html' OR file_path LIKE '%.htm' THEN 'html'
          WHEN file_path LIKE '%.css' OR file_path LIKE '%.scss' THEN 'css'
          WHEN file_path LIKE '%.json' THEN 'json'
          WHEN file_path LIKE '%.md' THEN 'markdown'
          WHEN file_path LIKE '%.vue' THEN 'vue'
          WHEN file_path LIKE '%.php' THEN 'php'
          ELSE 'other'
        END
        WHERE language IS NULL OR language = '' OR language = '未知'
      `).run();
    } catch (backfillErr) {
      logger.warn(`回填语言字段失败: ${backfillErr.message}`);
    }

    // 按类型统计
    const typeStmt = db.prepare(`
      SELECT issue_type, COUNT(*) as count
      FROM code_issue${projectFilter}
      GROUP BY issue_type
      ORDER BY count DESC
    `);
    const typeStats = typeStmt.all(...filterParams);

    // 按严重程度统计
    const severityStmt = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM code_issue${projectFilter}
      GROUP BY severity
    `);
    const severityStats = severityStmt.all(...filterParams);

    // 按语言统计
    const languageStmt = db.prepare(`
      SELECT language, COUNT(*) as count
      FROM code_issue${projectFilter}
      GROUP BY language
      ORDER BY count DESC
    `);
    const languageStats = languageStmt.all(...filterParams);

    // 总数统计
    const totalStmt = db.prepare(`SELECT COUNT(*) as total FROM code_issue${projectFilter}`);
    const totalResult = totalStmt.get(...filterParams);

    // 已修复统计
    const fixedStmt = db.prepare(`SELECT COUNT(*) as fixed FROM code_issue WHERE is_fixed = 1${projectId ? ' AND project_id = ?' : ''}`);
    const fixedResult = fixedStmt.get(...filterParams);

    // 未修复缺陷按严重度分布(质量评分的加权输入;severityStats 含已修复,评分不可用)
    const unfixedSevStmt = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM code_issue
      WHERE is_fixed = 0${projectId ? ' AND project_id = ?' : ''}
      GROUP BY severity
    `);
    const unfixedSeverityStats = unfixedSevStmt.all(...filterParams);

    // 项目规模(加权缺陷密度评分的分母;旧数据可能为 0,由扫描完成时补记)
    let projectSize = { totalFiles: 0, totalLines: 0 };
    if (projectId) {
      const sizeRow = db.prepare('SELECT total_files, total_lines FROM scan_project WHERE id = ?').get(projectId);
      if (sizeRow) {
        projectSize = { totalFiles: sizeRow.total_files || 0, totalLines: sizeRow.total_lines || 0 };
      }
    }

    return res.json(success({
      total: totalResult.total,
      fixed: fixedResult.fixed,
      unfixed: totalResult.total - fixedResult.fixed,
      typeStats,
      severityStats,
      languageStats,
      unfixedSeverityStats,
      projectSize
    }));
  } catch (err) {
    logger.error('获取缺陷统计失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 获取缺陷详情
 */
router.get('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    
    const stmt = db.prepare('SELECT * FROM code_issue WHERE id = ?');
    const issue = stmt.get(id);
    
    if (!issue) {
      return res.status(404).json(error('缺陷未找到', 404));
    }
    
    // 获取相关的AI优化记录
    const optimizeStmt = db.prepare('SELECT * FROM ai_optimize_record WHERE issue_id = ?');
    const optimizations = optimizeStmt.all(id);
    
    return res.json(success({
      issue,
      optimizations
    }));
  } catch (err) {
    logger.error('获取缺陷详情失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 更新缺陷状态（标记为已修复）
 */
router.put('/:id/fix', (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const { userId } = req.body;
    
    const stmt = db.prepare(`
      UPDATE code_issue
      SET is_fixed = 1, fixed_at = CURRENT_TIMESTAMP, fixed_by_user_id = ?
      WHERE id = ?
    `);
    
    const result = stmt.run(userId || null, id);
    
    if (result.changes === 0) {
      return res.status(404).json(error('缺陷未找到', 404));
    }
    
    logger.info(`缺陷已标记为修复: ${id}`);
    
    return res.json(success({
      id,
      isFixed: true
    }));
  } catch (err) {
    logger.error('更新缺陷状态失败:', err);
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;