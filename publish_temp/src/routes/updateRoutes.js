/**
 * 更新/修复/回滚路由
 * 提供自更新、自修复和回滚相关的API接口
 * 回滚作为更新和修复的子功能
 */

const express = require('express');
const router = express.Router();
const { selfUpdateManager } = require('../services/bootstrap/selfUpdateManager');
const { selfRepairManager } = require('../services/bootstrap/selfRepairManager');
const { confirmationGate } = require('../services/bootstrap/confirmationGate');
const { logger } = require('../utils/logger');

router.get('/updates', async (req, res) => {
  try {
    const { limit = 20, status } = req.query;
    const updates = await selfUpdateManager.listUpdates(parseInt(limit), status);
    
    res.json({
      success: true,
      data: updates
    });
  } catch (error) {
    logger.error('获取更新列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/updates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const update = await selfUpdateManager.getUpdateRecord(id);
    
    if (!update) {
      return res.status(404).json({
        success: false,
        error: '更新记录不存在'
      });
    }
    
    res.json({
      success: true,
      data: update
    });
  } catch (error) {
    logger.error('获取更新详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/updates', async (req, res) => {
  try {
    const { updateType, content, autoConfirm = false } = req.body;
    
    if (!updateType || !content) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数'
      });
    }
    
    const result = await selfUpdateManager.createUpdate(updateType, content, {
      autoConfirm,
      skipBackup: false,
      skipConfirmation: false
    });
    
    res.json(result);
  } catch (error) {
    logger.error('创建更新失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/updates/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const { autoConfirm = false } = req.body;
    
    const result = await selfUpdateManager.executeUpdate(id, {
      autoConfirm,
      skipBackup: false,
      skipConfirmation: !autoConfirm
    });
    
    res.json(result);
  } catch (error) {
    logger.error('执行更新失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/updates/:id/rollback', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await selfUpdateManager.rollbackUpdate(id);
    
    res.json(result);
  } catch (error) {
    logger.error('回滚更新失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/updates/rollback/version/:version', async (req, res) => {
  try {
    const { version } = req.params;
    const result = await selfUpdateManager.rollbackToVersion(version);
    
    res.json(result);
  } catch (error) {
    logger.error('按版本回滚失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/repairs', async (req, res) => {
  try {
    const { limit = 20, status } = req.query;
    const repairs = await selfRepairManager.listRepairs(parseInt(limit), status);
    
    res.json({
      success: true,
      data: repairs
    });
  } catch (error) {
    logger.error('获取修复列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/repairs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const repair = await selfRepairManager.getRepairRecord(id);
    
    if (!repair) {
      return res.status(404).json({
        success: false,
        error: '修复记录不存在'
      });
    }
    
    res.json({
      success: true,
      data: repair
    });
  } catch (error) {
    logger.error('获取修复详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/repairs/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const { autoConfirm = false } = req.body;
    
    const result = await selfRepairManager.executeRepair(id, {
      autoConfirm,
      skipBackup: false,
      skipConfirmation: !autoConfirm
    });
    
    res.json(result);
  } catch (error) {
    logger.error('执行修复失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/repairs/:id/rollback', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await selfRepairManager.rollbackRepair(id);
    
    res.json(result);
  } catch (error) {
    logger.error('回滚修复失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/confirmations', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const confirmations = await confirmationGate.getConfirmationHistory(parseInt(limit));
    
    res.json({
      success: true,
      data: confirmations
    });
  } catch (error) {
    logger.error('获取确认记录失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/check-update', async (req, res) => {
  try {
    const result = await selfUpdateManager.checkForUpdates();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('检查更新失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/run-repair', async (req, res) => {
  try {
    const { autoFix = true } = req.body;
    const result = await selfRepairManager.runRepair(autoFix);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('执行修复失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;