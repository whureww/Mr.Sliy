/**
 * LLM 提供商管理路由
 * 供 GUI 设置页管理云端大模型：查看状态、保存 API Key、切换活跃提供商
 */

const express = require('express');
const router = express.Router();
const { providerManager } = require('../services/llm/providers');
const { success, error } = require('../utils/response');
const { logger } = require('../utils/logger');

/** API Key 打码显示：仅保留首尾各 4 位 */
function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function getKeysTable() {
  const { dbAdapter } = require('../utils/dbAdapter');
  return dbAdapter.getSqlite();
}

/** 惰性初始化：GUI sidecar 不经过 CLI agent，首次访问时加载自定义提供商并恢复活跃状态 */
let initPromise = null;
function ensureProviderInit() {
  if (!initPromise) {
    initPromise = providerManager.init().catch((err) => {
      logger.warn('LLM提供商初始化失败:', err.message);
    });
  }
  return initPromise;
}

/**
 * 提供商列表（含可用状态与活跃项）
 */
router.get('/providers', async (req, res) => {
  try {
    await ensureProviderInit();
    const providers = await providerManager.refreshProviderStatus();
    const active = providerManager.getActiveProvider();
    return res.json(success({
      providers,
      active: active ? active.name : null
    }));
  } catch (err) {
    logger.error('获取LLM提供商列表失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 已保存的 API Key 配置（打码）
 */
router.get('/keys', async (req, res) => {
  try {
    const sqlite = getKeysTable();
    const rows = sqlite.prepare('SELECT provider_name, api_key, api_url, model_name, is_active FROM llm_api_keys').all();
    const keys = rows.map((r) => ({
      provider: r.provider_name,
      maskedKey: maskKey(r.api_key),
      hasKey: !!r.api_key,
      apiUrl: r.api_url || '',
      model: r.model_name || '',
      isActive: !!r.is_active
    }));
    return res.json(success({ keys }));
  } catch (err) {
    logger.error('读取LLM密钥配置失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 保存提供商配置（upsert API Key）
 * body: { apiKey, apiUrl?, model? }
 */
router.post('/providers/:name', async (req, res) => {
  try {
    await ensureProviderInit();
    const { name } = req.params;
    const { apiKey, apiUrl, model } = req.body || {};
    if (!apiKey || !String(apiKey).trim()) {
      return res.status(400).json(error('缺少 API Key'));
    }
    if (!providerManager.getAllProviders().includes(name.toLowerCase())) {
      return res.status(400).json(error(`不支持的提供商: ${name}`));
    }

    const sqlite = getKeysTable();
    const existing = sqlite.prepare('SELECT id FROM llm_api_keys WHERE provider_name = ?').get(name.toLowerCase());
    if (existing) {
      sqlite.prepare('UPDATE llm_api_keys SET api_key = ?, api_url = ?, model_name = ?, is_active = 1 WHERE provider_name = ?')
        .run(String(apiKey).trim(), apiUrl || null, model || null, name.toLowerCase());
    } else {
      sqlite.prepare('INSERT INTO llm_api_keys (provider_name, api_key, api_url, model_name, is_active, priority) VALUES (?, ?, ?, ?, 1, 10)')
        .run(name.toLowerCase(), String(apiKey).trim(), apiUrl || null, model || null);
    }

    // 清除密钥缓存并刷新可用状态
    const provider = providerManager.providers.get(name.toLowerCase());
    if (provider) provider.cachedKey = null;
    await providerManager.refreshProviderStatus();

    logger.info(`已保存 LLM 提供商配置: ${name}`);
    return res.json(success({ provider: name.toLowerCase(), message: `已保存 ${name} 的 API Key` }));
  } catch (err) {
    logger.error('保存LLM配置失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 删除提供商配置
 */
router.delete('/providers/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const key = name.toLowerCase();
    const sqlite = getKeysTable();
    sqlite.prepare('DELETE FROM llm_api_keys WHERE provider_name = ?').run(key);
    // 自定义提供商同时从管理器注销
    if (key.startsWith('custom-')) {
      providerManager.unregister(key);
    } else {
      const provider = providerManager.providers.get(key);
      if (provider) provider.cachedKey = null;
      if (providerManager.getActiveProvider() === provider) {
        providerManager.activeProvider = null;
      }
    }
    await providerManager.refreshProviderStatus();
    return res.json(success({ provider: key, message: '已删除配置' }));
  } catch (err) {
    logger.error('删除LLM配置失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 查询大模型用量：当前活跃提供商 + 会话实时统计 + 历史累计
 */
router.get('/usage', async (req, res) => {
  try {
    await ensureProviderInit();
    return res.json(success(providerManager.getUsageStats()));
  } catch (err) {
    logger.error('查询LLM用量失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 添加自定义提供商（OpenAI 兼容协议）
 * body: { name, apiKey?, apiUrl, model? }
 */
router.post('/custom', async (req, res) => {
  try {
    const { name, apiKey, apiUrl, model } = req.body || {};
    const label = String(name || '').trim();
    if (!label) {
      return res.status(400).json(error('请填写提供商名称'));
    }
    if (!apiUrl || !String(apiUrl).trim()) {
      return res.status(400).json(error('请填写 API 地址（OpenAI 兼容接口，如 https://host/v1）'));
    }
    const slug = label.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'llm';
    const fullName = `custom-${slug}`;
    if (providerManager.getAllProviders().includes(fullName) && !String(fullName).startsWith('custom-')) {
      return res.status(400).json(error(`名称 ${label} 与内置提供商冲突`));
    }

    // 注册（若已存在则复用）并保存配置
    if (!providerManager.providers.get(fullName)) {
      providerManager.register(fullName, {});
    }
    const sqlite = getKeysTable();
    const keyVal = String(apiKey || '').trim() || 'not-required';
    const existing = sqlite.prepare('SELECT id FROM llm_api_keys WHERE provider_name = ?').get(fullName);
    if (existing) {
      sqlite.prepare('UPDATE llm_api_keys SET api_key = ?, api_url = ?, model_name = ? WHERE provider_name = ?')
        .run(keyVal, String(apiUrl).trim(), model || null, fullName);
    } else {
      sqlite.prepare('INSERT INTO llm_api_keys (provider_name, api_key, api_url, model_name, is_active, priority) VALUES (?, ?, ?, ?, 0, 20)')
        .run(fullName, keyVal, String(apiUrl).trim(), model || null);
    }
    const provider = providerManager.providers.get(fullName);
    if (provider) provider.cachedKey = null;

    logger.info(`已添加自定义 LLM 提供商: ${fullName}`);
    return res.json(success({ provider: fullName, message: `已添加自定义提供商「${label}」` }));
  } catch (err) {
    logger.error('添加自定义LLM提供商失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 切换活跃提供商（会校验可用性）
 */
router.post('/providers/:name/activate', async (req, res) => {
  try {
    await ensureProviderInit();
    const { name } = req.params;
    await providerManager.setActiveProvider(name.toLowerCase());
    await providerManager.refreshProviderStatus();
    return res.json(success({ provider: name.toLowerCase(), message: `已切换到大模型: ${name}` }));
  } catch (err) {
    logger.error('切换LLM提供商失败:', err);
    return res.json(error(err.message || '切换失败'));
  }
});

module.exports = router;
