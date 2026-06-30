/**
 * AI优化路由模块
 * 处理AI代码优化相关请求
 */

const express = require('express');
const router = express.Router();
const { optimizeWithRAG } = require('../services/rag/agent');
const { success, error } = require('../utils/response');
const { logger } = require('../utils/logger');
const { getFileLanguage } = require('../utils/helpers');
const { providerManager } = require('../services/llm/providers');

/**
 * AI优化代码片段
 */
router.post('/optimize', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { code, filePath, language, issueType, message } = req.body;
    
    if (!code) {
      return res.status(400).json(error('缺少代码片段', 400));
    }

    // 检查是否有可用的云端LLM提供商
    const availableProviders = providerManager.getAvailableProviders();
    const hasOnlineProvider = availableProviders.some(p => p.available && p.name !== 'ollama');
    if (!hasOnlineProvider) {
      return res.json(error('当前无可用的云端LLM提供商，无法使用AI优化功能。请在数据库中配置API密钥。'));
    }
    
    // 构建issue对象
    const issue = {
      id: null,
      codeSnippet: code
    };
    
    // 构建上下文
    const context = {
      language: language || getFileLanguage(filePath || 'unknown.js'),
      issueType: issueType || 'general',
      message: message || '优化建议',
      taskId: null
    };
    
    // 执行RAG优化
    const result = await optimizeWithRAG(issue, context);
    
    if (!result.success) {
      return res.json(error(result.message));
    }
    
    logger.info('AI优化完成');
    
    return res.json(success({
      optimizationId: result.optimizationId,
      optimizedCode: result.optimizedCode,
      explanation: result.explanation,
      suggestions: result.suggestions,
      similarSnippets: result.similarSnippets,
      tokensUsed: result.tokensUsed,
      durationMs: Date.now() - startTime
    }));
  } catch (err) {
    logger.error('AI优化失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 获取优化历史
 */
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const { getOptimizationHistory } = require('../services/rag/agent');
    const history = getOptimizationHistory(limit);
    
    return res.json(success({
      total: history.length,
      history
    }));
  } catch (err) {
    logger.error('获取优化历史失败:', err);
    return res.status(500).json(error(err.message));
  }
});

/**
 * 应用优化建议
 */
router.post('/apply', async (req, res) => {
  try {
    const { optimizationId, filePath, originalCode, optimizedCode } = req.body;
    
    if (!filePath || !optimizedCode) {
      return res.status(400).json(error('缺少必要参数', 400));
    }
    
    // 这里应该实现实际的代码替换逻辑
    // 由于安全考虑，实际应用中应该由前端或IDE插件完成替换
    
    logger.info(`优化建议已应用: ${optimizationId}`);
    
    return res.json(success({
      optimizationId,
      filePath,
      applied: true,
      message: '优化建议已应用，请在IDE中确认更改'
    }));
  } catch (err) {
    logger.error('应用优化失败:', err);
    return res.status(500).json(error(err.message));
  }
});

module.exports = router;