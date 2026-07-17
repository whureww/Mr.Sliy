/**
 * 缺陷路由模块
 * 处理代码缺陷查询和管理
 */

const express = require('express');
const router = express.Router();
const { getSqliteDatabase } = require('../utils/database');
const { success, error, paginate } = require('../utils/response');
const { logger } = require('../utils/logger');

/**
 * 获取缺陷列表
 */
router.get('/', (req, res) => {
  try {
    const db = getSqliteDatabase();
    
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
 * 获取缺陷详情
 */
router.get('/:id', (req, res) => {
  try {
    const db = getSqliteDatabase();
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
    const db = getSqliteDatabase();
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

/**
 * 获取缺陷统计信息
 */
router.get('/stats', (req, res) => {
  try {
    const db = getSqliteDatabase();
    
    // 按类型统计
    const typeStmt = db.prepare(`
      SELECT issue_type, COUNT(*) as count
      FROM code_issue
      GROUP BY issue_type
      ORDER BY count DESC
    `);
    const typeStats = typeStmt.all();
    
    // 按严重程度统计
    const severityStmt = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM code_issue
      GROUP BY severity
    `);
    const severityStats = severityStmt.all();
    
    // 按语言统计
    const languageStmt = db.prepare(`
      SELECT language, COUNT(*) as count
      FROM code_issue
      GROUP BY language
      ORDER BY count DESC
    `);
    const languageStats = languageStmt.all();
    
    // 总数统计
    const totalStmt = db.prepare('SELECT COUNT(*) as total FROM code_issue');
    const totalResult = totalStmt.get();
    
    // 已修复统计
    const fixedStmt = db.prepare('SELECT COUNT(*) as fixed FROM code_issue WHERE is_fixed = 1');
    const fixedResult = fixedStmt.get();
    
    return res.json(success({
      total: totalResult.total,
      fixed: fixedResult.fixed,
      unfixed: totalResult.total - fixedResult.fixed,
      typeStats,
      severityStats,
      languageStats
    }));
  } catch (err) {
    logger.error('获取缺陷统计失败:', err);
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;