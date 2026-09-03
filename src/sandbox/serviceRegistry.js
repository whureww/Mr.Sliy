const path = require('path');
const { logger } = require('../utils/logger');
const { generateUUID } = require('../utils/helpers');

class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.serviceConfigs = new Map();
    this.eventHandlers = new Map();
    this.metrics = {
      totalRequests: 0,
      totalErrors: 0,
      serviceStarts: 0,
      serviceReloads: 0
    };
  }

  async registerService(serviceName, config) {
    if (this.services.has(serviceName)) {
      throw new Error(`服务 ${serviceName} 已注册`);
    }

    // 使用 ServicePool 包装（默认单实例，config.instances > 1 时启用多实例负载均衡）
    const { ServicePool } = require('./servicePool');

    const pool = new ServicePool(serviceName, config);

    pool.on('event', (event, payload) => {
      this._emitServiceEvent(serviceName, event, payload);
    });

    await pool.start();

    this.services.set(serviceName, pool);
    this.serviceConfigs.set(serviceName, config);
    this.metrics.serviceStarts++;

    const instCount = Math.max(1, config.instances || 1);
    logger.info(`服务注册成功: ${serviceName} v${config.version || '1.0.0'} (实例数: ${instCount})`);
    return { success: true, service: pool.getStatus() };
  }

  async unregisterService(serviceName) {
    const service = this.services.get(serviceName);
    if (!service) {
      return { success: false, error: `服务 ${serviceName} 不存在` };
    }

    await service.stop();
    this.services.delete(serviceName);
    this.serviceConfigs.delete(serviceName);

    logger.info(`服务已注销: ${serviceName}`);
    return { success: true };
  }

  async hotReloadService(serviceName, newConfig) {
    const oldPool = this.services.get(serviceName);
    if (!oldPool) {
      return { success: false, error: `服务 ${serviceName} 不存在` };
    }

    const config = newConfig || this.serviceConfigs.get(serviceName);

    logger.info(`开始热替换服务: ${serviceName}`);
    logger.info(`  旧版本: ${oldPool.version}`);
    logger.info(`  新版本: ${config.version || 'unknown'}`);

    const { ServicePool } = require('./servicePool');

    const newPool = new ServicePool(serviceName, config);

    newPool.on('event', (event, payload) => {
      this._emitServiceEvent(serviceName, event, payload);
    });

    try {
      await newPool.start();
      await newPool.waitUntilReady(config.startupTimeout || 15000);

      const pendingRequests = oldPool.getPendingRequests();
      newPool.takeoverRequests(pendingRequests);

      await oldPool.gracefulShutdown();

      this.services.set(serviceName, newPool);
      this.serviceConfigs.set(serviceName, config);
      this.metrics.serviceReloads++;

      logger.info(`服务热替换完成: ${serviceName} v${newPool.version}`);

      return {
        success: true,
        service: newPool.getStatus(),
        oldVersion: oldPool.version,
        newVersion: newPool.version
      };

    } catch (error) {
      logger.error(`热替换失败: ${serviceName}`, error.message);

      if (newPool.isRunning()) {
        await newPool.stop().catch(() => {});
      }

      return { success: false, error: error.message };
    }
  }

  async execute(serviceName, action, params = {}) {
    const service = this.services.get(serviceName);
    if (!service || !service.isReady()) {
      throw new Error(`服务 ${serviceName} 不可用`);
    }

    this.metrics.totalRequests++;

    try {
      const result = await service.execute(action, params);
      return result;
    } catch (error) {
      this.metrics.totalErrors++;
      // 补充调用上下文，便于 AI 修复管道定位
      if (!error.service) error.service = serviceName;
      if (!error.action) error.action = action;
      logger.error(`服务调用失败 [${serviceName}.${action}]:`, error.message);
      throw error;
    }
  }

  async executeWithTimeout(serviceName, action, params = {}, timeoutMs = 30000) {
    let timeoutHandle = null;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`操作超时: ${action}`)), timeoutMs);
    });

    try {
      const result = await Promise.race([
        this.execute(serviceName, action, params),
        timeoutPromise
      ]);
      clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle);
      throw error;
    }
  }

  getService(serviceName) {
    return this.services.get(serviceName);
  }

  getStatus() {
    const status = {};
    for (const [name, service] of this.services) {
      status[name] = service.getStatus();
    }
    return {
      services: status,
      metrics: { ...this.metrics },
      totalServices: this.services.size
    };
  }

  getServiceStatus(serviceName) {
    const service = this.services.get(serviceName);
    return service ? service.getStatus() : null;
  }

  onServiceEvent(serviceName, handler) {
    if (!this.eventHandlers.has(serviceName)) {
      this.eventHandlers.set(serviceName, new Map());
    }
    this.eventHandlers.get(serviceName).set(generateUUID(), handler);
  }

  _emitServiceEvent(serviceName, event, payload) {
    const handlers = this.eventHandlers.get(serviceName);
    if (handlers) {
      for (const [, handler] of handlers) {
        try {
          handler(event, payload);
        } catch (e) {
          logger.error(`事件处理器错误 [${serviceName}]:`, e.message);
        }
      }
    }
  }

  async stopAll() {
    logger.info('正在停止所有服务...');
    
    const results = [];
    for (const [name, service] of this.services) {
      try {
        await service.stop();
        results.push({ service: name, success: true });
        logger.info(`服务已停止: ${name}`);
      } catch (error) {
        results.push({ service: name, success: false, error: error.message });
        logger.error(`停止服务失败 [${name}]:`, error.message);
      }
    }
    
    this.services.clear();
    this.serviceConfigs.clear();
    
    logger.info('所有服务已停止');
    return results;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      totalErrors: 0,
      serviceStarts: 0,
      serviceReloads: 0
    };
  }
}

const serviceRegistry = new ServiceRegistry();

module.exports = {
  ServiceRegistry,
  serviceRegistry
};
