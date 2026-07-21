/**
 * 用户路由模块
 */

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../utils/database');
const { success, error, paginate } = require('../utils/response');

router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    
    const countStmt = db.prepare('SELECT COUNT(*) as total FROM sys_user');
    const countResult = countStmt.get();
    
    const offset = (page - 1) * pageSize;
    const dataStmt = db.prepare('SELECT id, username, email, role, status, created_at FROM sys_user ORDER BY created_at DESC LIMIT ? OFFSET ?');
    const users = dataStmt.all(pageSize, offset);
    
    return res.json(paginate(users, countResult.total, page, pageSize));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

router.post('/login', (req, res) => {
  try {
    const db = getDatabase();
    const { username, password } = req.body;
    
    const stmt = db.prepare('SELECT * FROM sys_user WHERE username = ? AND password_hash = ?');
    const user = stmt.get(username, password);
    
    if (!user) {
      return res.status(401).json(error('用户名或密码错误', 401));
    }
    
    return res.json(success({ id: user.id, username: user.username, role: user.role }));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;