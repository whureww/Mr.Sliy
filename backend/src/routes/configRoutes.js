/**
 * 配置路由模块
 */

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../utils/database');
const { success, error } = require('../utils/response');

router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare('SELECT config_key, config_value, config_type, description FROM sys_config WHERE is_public = 1');
    const configs = stmt.all();
    
    const configMap = {};
    configs.forEach(c => {
      configMap[c.config_key] = {
        value: c.config_value,
        type: c.config_type,
        description: c.description
      };
    });
    
    return res.json(success(configMap));
  } catch (err) {
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;