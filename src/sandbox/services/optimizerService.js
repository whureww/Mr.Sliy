const { Optimizer } = require('../../services/optimization/optimizer');

class OptimizerService {
  constructor(context) {
    this.name = context.name;
    this.version = context.version;
    this.logger = context.logger;
    this.postMessage = context.postMessage;
    this.isInitialized = false;
    this.optimizer = null;
    this.optimizeCount = 0;
    this.errorCount = 0;
  }

  async init() {
    this.logger.info(`[${this.name}] 代码优化服务初始化中...`);
    
    this.optimizer = new Optimizer();
    
    this.isInitialized = true;
    this.logger.info(`[${this.name}] 代码优化服务初始化完成`);
  }

  async optimize(params) {
    const { code, language, mode } = params;
    this.optimizeCount++;
    
    try {
      const result = await this.optimizer.optimize(code, {
        language: language || 'javascript',
        mode: mode || 'auto'
      });
      return result;
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 优化失败: ${error.message}`);
      throw error;
    }
  }

  async optimizeIssue(params) {
    const { code, issue, language, mode } = params;
    this.optimizeCount++;
    
    try {
      const result = await this.optimizer.optimizeIssue(
        issue,
        code,
        mode || 'auto',
        language || 'javascript'
      );
      return result;
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 优化问题失败: ${error.message}`);
      throw error;
    }
  }

  async batchOptimize(params) {
    const { items } = params;
    const results = [];
    
    for (const item of items) {
      try {
        const result = await this.optimizer.optimize(item.code, {
          language: item.language || 'javascript',
          mode: item.mode || 'offline'
        });
        results.push({ id: item.id, success: true, result });
      } catch (error) {
        results.push({ id: item.id, success: false, error: error.message });
      }
    }
    
    return { results, total: items.length, successful: results.filter(r => r.success).length };
  }

  async getRules(params) {
    return this.optimizer.getRules?.() || [];
  }

  async getPatterns(params) {
    return this.optimizer.getPatterns?.() || [];
  }

  getHealth() {
    return {
      status: 'ok',
      initialized: this.isInitialized,
      optimizeCount: this.optimizeCount,
      errorCount: this.errorCount,
      memory: process.memoryUsage()
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] 代码优化服务关闭`);
    this.isInitialized = false;
    this.optimizer = null;
  }

  async onHotReload(config) {
    this.logger.info(`[${this.name}] 热重载配置`);
    if (config?.newRules) {
      this.logger.info(`[${this.name}] 加载新规则`);
    }
  }
}

module.exports = OptimizerService;
