const { sandboxBootstrap } = require('./bootstrap');
const { logger } = require('../utils/logger');

class SandboxManager {
  constructor() {
    this.bootstrap = sandboxBootstrap;
    this.isEnabled = true;
    this.isInitialized = false;
    this.fallbackMode = false;
  }

  async init() {
    if (!this.isEnabled) {
      logger.info('[SandboxManager] 沙箱模式未启用，使用传统模式');
      this.fallbackMode = true;
      return { success: true, mode: 'fallback' };
    }

    try {
      const result = await this.bootstrap.startAll();
      this.isInitialized = result.success;
      
      if (result.success) {
        logger.info('[SandboxManager] 沙箱架构初始化成功');
        logger.info(`[SandboxManager] 服务列表: ${Object.keys(result.status.services).join(', ')}`);
        return { success: true, mode: 'sandbox', status: result.status };
      } else {
        logger.warn('[SandboxManager] 部分服务启动失败，切换到降级模式');
        this.fallbackMode = true;
        return { success: true, mode: 'fallback', errors: result.results.filter(r => !r.success) };
      }
    } catch (error) {
      logger.error('[SandboxManager] 沙箱初始化失败:', error.message);
      logger.info('[SandboxManager] 切换到降级模式');
      this.fallbackMode = true;
      this.isEnabled = false;
      return { success: true, mode: 'fallback', error: error.message };
    }
  }

  async shutdown() {
    if (this.isInitialized) {
      await this.bootstrap.stopAll();
      this.isInitialized = false;
    }
  }

  async parse(code, language) {
    if (this._canUseSandbox('parser')) {
      return await this.bootstrap.execute('parser', 'parse', { code, language });
    }
    const { parseCode } = require('../workers/parser');
    return await parseCode(code, language);
  }

  async detect(code, language, options = {}) {
    if (this._canUseSandbox('detector')) {
      return await this.bootstrap.execute('detector', 'detect', { code, language, options });
    }
    const { detectIssues } = require('../services/detection/detector');
    return await detectIssues(code, language, options);
  }

  async optimize(code, context = {}) {
    if (this._canUseSandbox('optimizer')) {
      return await this.bootstrap.execute('optimizer', 'optimize', {
        code,
        language: context.language,
        mode: context.mode
      });
    }
    const { Optimizer } = require('../services/optimization/optimizer');
    const optimizer = new Optimizer();
    return await optimizer.optimize(code, context);
  }

  async searchKnowledge(query, options = {}) {
    if (this._canUseSandbox('knowledge')) {
      return await this.bootstrap.execute('knowledge', 'search', {
        query,
        topK: options.topK || 10,
        type: options.type || 'all'
      });
    }
    const { knowledgeBase } = require('../services/vector/knowledgeBase');
    const entries = await knowledgeBase.searchEntries(query, options) || [];
    const cases = await knowledgeBase.searchCases(query, options) || [];
    return { results: [...entries, ...cases] };
  }

  async chat(messages, options = {}) {
    if (this._canUseSandbox('llm')) {
      return await this.bootstrap.execute('llm', 'chat', { messages, options });
    }
    const { providerManager } = require('../services/llm/providers');
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      throw new Error('未配置活跃的LLM提供商');
    }
    return await provider.chat(messages, options);
  }

  _canUseSandbox(serviceName) {
    return this.isEnabled && this.isInitialized && !this.fallbackMode;
  }

  isSandboxAvailable() {
    return this.isEnabled && this.isInitialized && !this.fallbackMode;
  }

  getMode() {
    if (!this.isEnabled) return 'fallback';
    if (!this.isInitialized) return 'initializing';
    return this.fallbackMode ? 'fallback' : 'sandbox';
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      initialized: this.isInitialized,
      mode: this.getMode(),
      fallbackMode: this.fallbackMode,
      services: this.isInitialized ? this.bootstrap.getStatus() : null
    };
  }

  async enableSandbox() {
    this.isEnabled = true;
    this.fallbackMode = false;
    if (!this.isInitialized) {
      return await this.init();
    }
  }

  async disableSandbox() {
    await this.shutdown();
    this.isEnabled = false;
    this.fallbackMode = true;
  }

  async hotReloadService(serviceName, newVersion) {
    return await this.bootstrap.hotReloadService(serviceName, newVersion);
  }

  getServiceStatus(serviceName) {
    return this.bootstrap.getServiceStatus(serviceName);
  }
}

const sandboxManager = new SandboxManager();

module.exports = {
  SandboxManager,
  sandboxManager
};
