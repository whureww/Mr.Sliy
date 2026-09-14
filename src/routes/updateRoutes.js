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
const { checkRemoteUpdate, getUpdateSourceUrl, saveUpdateSourceUrl, SOURCE_FILE, CURRENT_VERSION } = require('../services/bootstrap/versionCheck');
const downloader = require('../services/bootstrap/updateDownloader');
const { logger } = require('../utils/logger');

router.get('/updates', async (req, res) => {
  try {
    const { limit = 20, status } = req.query;
    const updates = await selfUpdateManager.listUpdates(status || null, parseInt(limit));
    
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
    // 桌面端上报自身版本（GUI 与 CLI 独立版本化，优先以请求体为准）
    const result = await checkRemoteUpdate(req.body && req.body.currentVersion);
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

/** 更新源地址：读取 / 保存（保存到 ~/.mr-sliy/update_source.json） */
router.get('/update-source', (req, res) => {
  res.json({ success: true, data: { url: getUpdateSourceUrl(), file: SOURCE_FILE, currentVersion: CURRENT_VERSION } });
});

router.post('/update-source', (req, res) => {
  try {
    const url = saveUpdateSourceUrl(req.body && req.body.url);
    res.json({ success: true, data: { url } });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** 开始下载新版本安装包（https 直链;已有下载进行中返回 409;digest 用于 sha256 完整性校验） */
router.post('/update-download/start', (req, res) => {
  try {
    const state = downloader.startDownload(
      req.body && req.body.url,
      req.body && req.body.version,
      req.body && req.body.digest
    );
    res.json({ success: true, data: state });
  } catch (e) {
    const busy = e.code === 'BUSY';
    res.status(busy ? 409 : 400).json({ success: false, error: e.message });
  }
});

/** 查询下载进度/状态（前端轮询）;currentVersion 供恢复扫描做版本门控(只恢复比当前版本新的安装包) */
router.get('/update-download/status', (req, res) => {
  res.json({ success: true, data: downloader.getStatus(req.query && req.query.currentVersion) });
});

/** 取消当前下载 */
router.post('/update-download/cancel', (req, res) => {
  res.json({ success: true, data: { cancelled: downloader.cancelDownload() } });
});

/** 用系统默认浏览器打开下载页（仅允许 http/https） */
router.post('/open-url', (req, res) => {
  const url = String((req.body && req.body.url) || '');
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ success: false, error: '仅允许打开 http/https 链接' });
  }
  try {
    const { spawn } = require('child_process');
    // explorer.exe 打开 URL 会使用系统默认浏览器
    const child = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => logger.warn('打开链接失败:', e.message));
    child.unref();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
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