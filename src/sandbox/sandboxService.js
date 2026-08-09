const { Worker } = require('worker_threads');
const path = require('path');
const { EventEmitter } = require('events');
const { logger } = require('../utils/logger');
const { generateUUID } = require('../utils/helpers');

class SandboxService extends EventEmitter {
  constructor(serviceName, config) {
    super();
    this.serviceName = serviceName;
    this.config = config;
    this.workerPath = config.workerPath || path.join(__dirname, 'workerBootstrap.js');
    this.workerData = {
      serviceName,
      servicePath: config.servicePath,
      version: config.version || '1.0.0',
      maxMemory: config.maxMemory || 512,
      isWorker: true
    };
    
    this.worker = null;
    this._isReady = false;
    this._isRunning = false;
    this._isShuttingDown = false;
    this._isRestarting = false;
    
    this.responseHandlers = new Map();
    this.pendingRequests = new Map();
    
    this.version = config.version || '1.0.0';
    this.startedAt = null;
    this.lastHealthCheck = null;
    this.restartCount = 0;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = config.maxConsecutiveErrors || 10;
    
    this._setupAutoRestart();
  }

  _setupAutoRestart() {
    if (this.config.autoRestart) {
      this.healthCheckInterval = setInterval(() => {
        this._checkHealth();
      }, this.config.healthCheckInterval || 30000);
    }
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.workerPath, {
          workerData: this.workerData,
          env: {
            ...process.env,
            WORKER_THREAD_ID: this.serviceName
          }
        });

        this.worker.on('message', (message) => {
          this._handleMessage(message);
        });

        this.worker.on('error', (error) => {
          logger.error(`[${this.serviceName}] Worker错误:`, error.message);
          this.consecutiveErrors++;
          this._handleWorkerError(error);
        });

        this.worker.on('exit', (code) => {
          if (!this._isShuttingDown && !this._isRestarting) {
            logger.warn(`[${this.serviceName}] Worker退出, code: ${code}`);
            this._isReady = false;
            this._isRunning = false;

            if (this.config.autoRestart) {
              this._attemptRestart();
            }
          }
        });

        this._isRunning = true;
        this.startedAt = Date.now();

        let settled = false;

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`服务 ${this.serviceName} 启动超时`));
          }
        }, this.config.startupTimeout || 15000);

        const checkReady = () => {
          if (settled) return;
          if (this._isReady) {
            settled = true;
            clearTimeout(timeout);
            resolve();
          } else if (this._isRunning) {
            setTimeout(checkReady, 50);
          }
        };
        checkReady();

      } catch (error) {
        reject(error);
      }
    });
  }

  async waitUntilReady(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const check = () => {
        if (this._isReady) {
          resolve();
        } else if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`等待服务 ${this.serviceName} 就绪超时`));
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  async execute(action, params = {}) {
    if (!this._isReady || !this._isRunning) {
      throw new Error(`服务 ${this.serviceName} 不可用`);
    }

    return new Promise((resolve, reject) => {
      const requestId = generateUUID();
      const timeoutMs = this.config.timeout || 30000;
      
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(requestId);
        reject(new Error(`服务调用超时: ${action}`));
      }, timeoutMs);

      this.responseHandlers.set(requestId, {
        resolve,
        reject,
        timeout,
        action,
        params,
        timestamp: Date.now()
      });

      try {
        this.worker.postMessage({
          type: 'request',
          id: requestId,
          action,
          params,
          timestamp: Date.now()
        });
      } catch (error) {
        clearTimeout(timeout);
        this.responseHandlers.delete(requestId);
        reject(error);
      }
    });
  }

  _handleMessage(message) {
    const { type, id, data, error } = message;

    switch (type) {
      case 'ready':
        this._isReady = true;
        this.version = data?.version || this.version;
        this.consecutiveErrors = 0;
        this.emit('ready', { version: this.version });
        break;

      case 'response':
        const handler = this.responseHandlers.get(id);
        if (handler) {
          clearTimeout(handler.timeout);
          this.responseHandlers.delete(id);
          
          if (error) {
            handler.reject(new Error(error));
            this.consecutiveErrors++;
          } else {
            handler.resolve(data);
            this.consecutiveErrors = 0;
          }
        }
        break;

      case 'event':
        this.emit('event', data?.event, data?.payload);
        break;

      case 'health_check':
        this.lastHealthCheck = data;
        break;

      case 'capabilities':
        this.capabilities = data?.capabilities || [];
        break;
    }
  }

  _handleWorkerError(error) {
    this._isReady = false;
    this.emit('error', error);
    
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      logger.error(`[${this.serviceName}] 连续错误过多，触发重启`);
      this.consecutiveErrors = 0;
      this._attemptRestart();
    }
  }

  _attemptRestart() {
    if (this._isRestarting || this._isShuttingDown) return;
    
    this._isRestarting = true;
    this.restartCount++;
    
    const delay = Math.min(1000 * Math.pow(2, this.restartCount), 30000);
    
    logger.info(`[${this.serviceName}] ${delay}ms 后尝试第 ${this.restartCount} 次重启`);
    
    setTimeout(async () => {
      if (this._isShuttingDown) {
        this._isRestarting = false;
        return;
      }
      
      try {
        if (this.worker) {
          await this.worker.terminate().catch(() => {});
          this.worker = null;
        }
        
        await this.start();
        await this.waitUntilReady(10000);
        
        this._isRestarting = false;
        logger.info(`[${this.serviceName}] 重启成功 (第 ${this.restartCount} 次)`);
        
      } catch (error) {
        logger.error(`[${this.serviceName}] 重启失败:`, error.message);
        this._isRestarting = false;
        
        if (this.restartCount < 5) {
          this._attemptRestart();
        }
      }
    }, delay);
  }

  async gracefulShutdown() {
    this._isShuttingDown = true;
    
    this._isReady = false;
    
    const maxWaitTime = 5000;
    const startTime = Date.now();
    
    while (this.responseHandlers.size > 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.responseHandlers.size > 0) {
      logger.warn(`[${this.serviceName}] 强制终止 ${this.responseHandlers.size} 个未完成请求`);
      for (const [, handler] of this.responseHandlers) {
        clearTimeout(handler.timeout);
        handler.reject(new Error('服务正在关闭'));
      }
      this.responseHandlers.clear();
    }
    
    if (this.worker) {
      try {
        if (this._isRunning) {
          this.worker.postMessage({ type: 'shutdown' });
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        await this.worker.terminate();
      } catch (e) {
      }
      this.worker = null;
    }
    
    this._isRunning = false;
    this._isShuttingDown = false;
    
    logger.info(`[${this.serviceName}] 优雅关闭完成`);
  }

  async stop() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    return await this.gracefulShutdown();
  }

  takeoverRequests(pendingRequests) {
    if (!Array.isArray(pendingRequests)) return;
    
    for (const request of pendingRequests) {
      const { action, params, resolve, reject } = request;
      
      this.execute(action, params)
        .then(result => resolve?.(result))
        .catch(error => reject?.(error));
    }
  }

  getPendingRequests() {
    const requests = [];
    for (const [, handler] of this.responseHandlers) {
      requests.push({
        action: handler.action,
        params: handler.params,
        resolve: handler.resolve,
        reject: handler.reject
      });
    }
    return requests;
  }

  isReady() {
    return this._isReady && this._isRunning && !this._isShuttingDown;
  }

  isRunning() {
    return this._isRunning && !this._isShuttingDown;
  }

  getStatus() {
    return {
      name: this.serviceName,
      version: this.version,
      ready: this._isReady,
      running: this._isRunning,
      shuttingDown: this._isShuttingDown,
      restarting: this._isRestarting,
      pendingRequests: this.responseHandlers.size,
      restartCount: this.restartCount,
      consecutiveErrors: this.consecutiveErrors,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      lastHealthCheck: this.lastHealthCheck,
      status: this._isReady ? 'running' : this._isRestarting ? 'restarting' : this._isShuttingDown ? 'shutting_down' : 'stopped'
    };
  }

  async _checkHealth() {
    if (!this._isReady || !this._isRunning) return;
    
    try {
      const health = await this.execute('health_check', {});
      this.lastHealthCheck = health;
      
      if (health?.status === 'unhealthy') {
        logger.warn(`[${this.serviceName}] 健康检查异常`);
        this._attemptRestart();
      }
    } catch (error) {
      logger.warn(`[${this.serviceName}] 健康检查失败:`, error.message);
      this.consecutiveErrors++;
      
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        this._attemptRestart();
      }
    }
  }
}

module.exports = { SandboxService };
