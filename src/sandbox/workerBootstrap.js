const { parentPort, workerData } = require('worker_threads');
const path = require('path');

// 设置 Worker 环境标识，用于日志去重
if (workerData && workerData.isWorker) {
  process.env.WORKER_THREAD_ID = workerData.serviceName || 'unknown';
  
  // Worker 内部将日志级别设置为 warn，避免重复日志输出
  // 重要日志通过 parentPort 发送到主进程
  try {
    const { logger } = require('../utils/logger');
    // 修改所有 transports 的日志级别为 warn
    if (logger && logger.transports) {
      logger.transports.forEach(transport => {
        transport.level = 'warn';
      });
    }
  } catch (e) {
    // 忽略日志级别设置错误
  }
}

class WorkerBootstrap {
  constructor() {
    this.service = null;
    this.servicePath = workerData.servicePath;
    this.serviceName = workerData.serviceName;
    this.version = workerData.version;
    this.maxMemory = workerData.maxMemory;
    
    this.isInitialized = false;
    this.requestCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
  }

  async init() {
    try {
      const resolvedPath = path.resolve(this.servicePath);
      const ServiceClass = require(resolvedPath);
      
      const logger = this._createLogger();
      
      this.service = new ServiceClass({
        name: this.serviceName,
        version: this.version,
        logger,
        postMessage: (type, data) => parentPort.postMessage({ type, data })
      });

      if (typeof this.service.init === 'function') {
        await this.service.init();
      }

      this.isInitialized = true;
      
      parentPort.postMessage({
        type: 'ready',
        data: {
          serviceName: this.serviceName,
          version: this.version,
          capabilities: this.service.capabilities || [],
          memory: this._getMemoryInfo()
        }
      });

      this._log('info', `${this.serviceName} v${this.version} 初始化完成`);

    } catch (error) {
      this._log('error', `${this.serviceName} 初始化失败: ${error.message}`);
      parentPort.postMessage({
        type: 'init_error',
        data: { message: error.message, stack: error.stack }
      });
      process.exit(1);
    }
  }

  _createLogger() {
    return {
      info: (msg) => this._log('info', msg),
      warn: (msg) => this._log('warn', msg),
      error: (msg) => this._log('error', msg),
      debug: (msg) => this._log('debug', msg)
    };
  }

  _log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${this.serviceName}] ${message}`;
    parentPort.postMessage({
      type: 'log',
      data: { level, message: logMessage }
    });
  }

  async handleRequest(request) {
    const { id, action, params } = request;
    this.requestCount++;
    
    const startTime = Date.now();
    
    try {
      let result;
      
      if (action === 'health_check') {
        result = this._performHealthCheck();
      } else if (typeof this.service[action] === 'function') {
        result = await this.service[action](params);
      } else if (typeof this.service.handle === 'function') {
        result = await this.service.handle(action, params);
      } else {
        throw new Error(`未知操作: ${action}`);
      }

      const duration = Date.now() - startTime;
      
      parentPort.postMessage({
        type: 'response',
        id,
        data: result,
        duration
      });

    } catch (error) {
      this.errorCount++;
      const duration = Date.now() - startTime;
      
      parentPort.postMessage({
        type: 'response',
        id,
        error: error.message,
        stack: error.stack,
        duration
      });
    }
  }

  _performHealthCheck() {
    const serviceHealth = this.service.getHealth?.() || {};
    
    return {
      status: serviceHealth.status || 'ok',
      service: this.serviceName,
      version: this.version,
      uptime: Date.now() - this.startTime,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      memory: this._getMemoryInfo(),
      serviceHealth
    };
  }

  _getMemoryInfo() {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
    };
  }

  async handleShutdown() {
    this._log('info', `正在关闭 ${this.serviceName}...`);
    
    try {
      if (typeof this.service.shutdown === 'function') {
        await this.service.shutdown();
      }
    } catch (error) {
      this._log('error', `关闭时出错: ${error.message}`);
    }
    
    parentPort.postMessage({ type: 'shutdown_complete' });
  }

  async handleHotReload(config) {
    this._log('info', `正在热重载 ${this.serviceName}...`);
    
    try {
      if (typeof this.service.onHotReload === 'function') {
        await this.service.onHotReload(config);
      }
      
      parentPort.postMessage({
        type: 'hot_reload_complete',
        id: config.id,
        data: { success: true }
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'hot_reload_complete',
        id: config.id,
        error: error.message
      });
    }
  }

  start() {
    parentPort.on('message', async (message) => {
      const { type } = message;

      switch (type) {
        case 'request':
          await this.handleRequest(message);
          break;

        case 'shutdown':
          await this.handleShutdown();
          break;

        case 'health_check':
          const health = this._performHealthCheck();
          parentPort.postMessage({
            type: 'health_check',
            data: health
          });
          break;

        case 'hot_reload':
          await this.handleHotReload(message.config);
          break;

        case 'ping':
          parentPort.postMessage({
            type: 'pong',
            id: message.id,
            data: { uptime: Date.now() - this.startTime }
          });
          break;

        default:
          this._log('warn', `未知消息类型: ${type}`);
      }
    });

    setInterval(() => {
      if (this.isInitialized) {
        const health = this._performHealthCheck();
        parentPort.postMessage({
          type: 'health_check',
          data: health
        });
      }
    }, 10000);

    process.on('uncaughtException', (error) => {
      this._log('error', `未捕获异常: ${error.message}`);
      parentPort.postMessage({
        type: 'error',
        data: { message: error.message, stack: error.stack }
      });
    });

    process.on('unhandledRejection', (reason) => {
      this._log('error', `未处理的Promise拒绝: ${reason?.message || reason}`);
      parentPort.postMessage({
        type: 'error',
        data: { message: reason?.message || String(reason), stack: reason?.stack }
      });
    });

    this._log('info', 'Worker引导完成，等待请求...');
  }
}

const bootstrap = new WorkerBootstrap();
bootstrap.init().then(() => bootstrap.start());
