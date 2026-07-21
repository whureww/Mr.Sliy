/**
 * 项目路由模块
 */

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../utils/database');
const { success, error, paginate } = require('../utils/response');
const { logger } = require('../utils/logger');

router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    
    const countStmt = db.prepare('SELECT COUNT(*) as total FROM scan_project WHERE status != "deleted"');
    const countResult = countStmt.get();
    
    const offset = (page - 1) * pageSize;
    const dataStmt = db.prepare(`SELECT * FROM scan_project WHERE status != "deleted" ORDER BY created_at DESC LIMIT ? OFFSET ?`);
    const projects = dataStmt.all(pageSize, offset);
    
    return res.json(paginate(projects, countResult.total, page, pageSize));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

router.get('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM scan_project WHERE id = ?');
    const project = stmt.get(req.params.id);
    
    if (!project) {
      return res.status(404).json(error('项目未找到', 404));
    }
    
    return res.json(success(project));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;