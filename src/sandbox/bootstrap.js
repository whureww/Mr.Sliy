const path = require('path');
const { serviceRegistry } = require('./serviceRegistry');
const { logger } = require('../utils/logger');

const serviceConfigs = {
  parser: {
    servicePath: path.join(__dirname, 'services', 'parserService.js'),
    version: '1.0.0',
    timeout: 30000,
    autoRestart: true,
    maxMemory: 512,
    startupTimeout: 15000,
    healthCheckInterval: 30000,
    maxConsecutiveErrors: 10
  },
  
  detector: {
    servicePath: path.join(__dirname, 'services', 'detectorService.js'),
    version: '1.0.0',
    timeout: 60000,
    autoRestart: true,
    maxMemory: 512,
    startupTimeout: 15000,
    healthCheckInterval: 30000,
    maxConsecutiveErrors: 10
  },
  
  optimizer: {
    servicePath: path.join(__dirname, 'services', 'optimizerService.js'),
    version: '1.0.0',
    timeout: 120000,
    autoRestart: true,
    maxMemory: 768,
    startupTimeout: 30000,
    healthCheckInterval: 60000,
    maxConsecutiveErrors: 5
  },
  
  knowledge: {
    servicePath: path.join(__dirname, 'services', 'knowledgeService.js'),
    version: '1.0.0',
    timeout: 10000,
    autoRestart: true,
    maxMemory: 512,
    startupTimeout: 15000,
    healthCheckInterval: 30000,
    maxConsecutiveErrors: 10
  },
  
  llm: {
    servicePath: path.join(__dirname, 'services', 'llmService.js'),
    version: '1.0.0',
    timeout: 60000,
    autoRestart: true,
    maxMemory: 512,
    startupTimeout: 20000,
    healthCheckInterval: 30000,
    maxConsecutiveErrors: 5
  }
};

class SandboxBootstrap {
  constructor() {
    this.registry = serviceRegistry;
    this.initialized = false;
    this.startupOrder = ['knowledge', 'parser', 'detector', 'optimizer', 'llm'];
  }

  async startAll() {
    if (this.initialized) {
      logger.warn('[SandboxBootstrap] 服务已初始化');
      return this.registry.getStatus();
    }

    logger.info('[SandboxBootstrap] 开始初始化所有服务...');
    const startTime = Date.now();
    const results = [];

    for (const serviceName of this.startupOrder) {
      const config = serviceConfigs[serviceName];
      if (!config) {
        logger.warn(`[SandboxBootstrap] 未知服务配置: ${serviceName}`);
        continue;
      }

      try {
        logger.info(`[SandboxBootstrap] 启动服务: ${serviceName}...`);
        const result = await this.registry.registerService(serviceName, config);
        results.push({ service: serviceName, success: true });
        logger.info(`[SandboxBootstrap] 服务启动成功: ${serviceName}`);
      } catch (error) {
        logger.error(`[SandboxBootstrap] 服务启动失败 [${serviceName}]:`, error.message);
        results.push({ service: serviceName, success: false, error: error.message });
      }
    }

    this.initialized = true;
    const duration = Date.now() - startTime;
    
    logger.info(`[SandboxBootstrap] 所有服务初始化完成 (耗时 ${duration}ms)`);
    logger.info(`[SandboxBootstrap] 成功: ${results.filter(r => r.success).length}/${results.length}`);
    
    return {
      success: true,
      duration,
      results,
      status: this.registry.getStatus()
    };
  }

  async stopAll() {
    logger.info('[SandboxBootstrap] 正在停止所有服务...');
    const results = await this.registry.stopAll();
    this.initialized = false;
    logger.info('[SandboxBootstrap] 所有服务已停止');
    return results;
  }

  async hotReloadService(serviceName, newVersion) {
    const config = serviceConfigs[serviceName];
    if (!config) {
      throw new Error(`未知服务: ${serviceName}`);
    }

    const newConfig = {
      ...config,
      version: newVersion || `${config.version}-reload`
    };

    return await this.registry.hotReloadService(serviceName, newConfig);
  }

  getStatus() {
    return {
      initialized: this.initialized,
      services: this.registry.getStatus(),
      configs: Object.keys(serviceConfigs)
    };
  }

  getServiceStatus(serviceName) {
    return this.registry.getServiceStatus(serviceName);
  }

  async execute(serviceName, action, params = {}) {
    return await this.registry.execute(serviceName, action, params);
  }

  isReady() {
    return this.initialized;
  }
}

const sandboxBootstrap = new SandboxBootstrap();

process.on('beforeExit', async () => {
  if (sandboxBootstrap.initialized) {
    await sandboxBootstrap.stopAll();
  }
});

process.on('SIGINT', async () => {
  if (sandboxBootstrap.initialized) {
    await sandboxBootstrap.stopAll();
    process.exit(0);
  }
});

module.exports = {
  SandboxBootstrap,
  sandboxBootstrap,
  serviceConfigs
};
