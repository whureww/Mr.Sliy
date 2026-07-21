/**
 * 报告路由模块
 */

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../utils/database');
const { success, error } = require('../utils/response');
const { generateUUID } = require('../utils/helpers');

router.post('/generate', (req, res) => {
  try {
    const { taskId, format, includeAiSuggestions } = req.body;
    
    const reportId = generateUUID();
    const reportUrl = `http://localhost:3000/reports/${reportId}.${format || 'pdf'}`;
    
    return res.json(success({
      reportId,
      url: reportUrl,
      format: format || 'pdf'
    }));
  } catch (err) {
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