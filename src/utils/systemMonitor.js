const os = require('os');
const http = require('http');
const https = require('https');
const { logger } = require('./logger');
const { eventBus, SYSTEM_EVENTS } = require('./eventBus');
const { getSqliteDatabase } = require('./database');
const { providerManager } = require('../services/llm/providers');

class SystemMonitor {
  constructor() {
    this.checkInterval = 60000;
    this.healthCheckTimer = null;
    this.lastHealthStatus = null;
    this.isRunning = false;
    this.healthHistory = [];
    this.maxHistorySize = 100;
  }

  start() {
    if (this.isRunning) {
      logger.debug('系统监控已在运行中');
      return;
    }

    this.isRunning = true;
    logger.info('系统监控已启动');

    this.runHealthCheck();

    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck();
    }, this.checkInterval);
  }

  stop() {
    if (!this.isRunning) {
      logger.warn('系统监控未在运行');
      return;
    }

    this.isRunning = false;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    logger.info('系统监控已停止');
  }

  async runHealthCheck() {
    if (!this.isRunning) return;

    try {
      const status = await this.checkAll();
      this.lastHealthStatus = status;
      this.addToHistory(status);

      eventBus.emit(SYSTEM_EVENTS.SYSTEM_HEALTH_STATUS, status);

      if (status.overallStatus === 'error') {
        for (const issue of status.issues) {
          eventBus.emit(SYSTEM_EVENTS.SYSTEM_ERROR, new Error(issue));
        }
      } else if (status.overallStatus === 'warning') {
        for (const warning of status.warnings) {
          eventBus.emit(SYSTEM_EVENTS.SYSTEM_WARNING, {
            message: warning,
            type: this.inferWarningType(warning)
          });
        }
      }

      logger.debug(`健康检查完成: ${status.overallStatus} - ${status.issues.length}个问题, ${status.warnings.length}个警告`);
    } catch (error) {
      logger.error(`健康检查执行失败: ${error.message}`);
    }
  }

  async checkAll() {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkNetwork(),
      this.checkMemory(),
      this.checkProviders(),
      this.checkDependencies()
    ]);

    const issues = [];
    const warnings = [];
    const details = {};

    for (const check of checks) {
      details[check.name] = check;
      if (check.status === 'error') {
        issues.push(check.message);
      } else if (check.status === 'warning') {
        warnings.push(check.message);
      }
    }

    let overallStatus = 'healthy';
    if (issues.length > 0) {
      overallStatus = 'error';
    } else if (warnings.length > 0) {
      overallStatus = 'warning';
    }

    return {
      timestamp: Date.now(),
      overallStatus,
      issues,
      warnings,
      details
    };
  }

  async checkDatabase() {
    try {
      const db = getSqliteDatabase();
      const result = db.prepare('SELECT 1 AS test').get();
      if (result && result.test === 1) {
        return {
          name: 'database',
          status: 'healthy',
          message: 'SQLite数据库连接正常',
          details: { type: 'sqlite' }
        };
      } else {
        return {
          name: 'database',
          status: 'error',
          message: 'SQLite数据库查询失败',
          details: { type: 'sqlite' }
        };
      }
    } catch (error) {
      return {
        name: 'database',
        status: 'error',
        message: `SQLite数据库连接失败: ${error.message}`,
        details: { type: 'sqlite', error: error.message }
      };
    }
  }

  async checkNetwork() {
    const testUrls = [
      'https://www.baidu.com',
      'https://www.google.com'
    ];

    for (const url of testUrls) {
      try {
        const result = await this.testNetwork(url);
        if (result.success) {
          return {
            name: 'network',
            status: 'healthy',
            message: `网络连接正常 (${url})`,
            details: { latency: result.latency, url }
          };
        }
      } catch (error) {
        continue;
      }
    }

    return {
      name: 'network',
      status: 'warning',
      message: '网络连接可能受限，部分外部服务不可达',
      details: { testedUrls: testUrls }
    };
  }

  testNetwork(url, timeout = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const protocol = url.startsWith('https') ? https : http;

      const req = protocol.get(url, (res) => {
        const latency = Date.now() - startTime;
        res.destroy();
        resolve({ success: true, latency });
      });

      req.on('error', () => {
        resolve({ success: false });
      });

      req.setTimeout(timeout, () => {
        req.destroy();
        resolve({ success: false });
      });
    });
  }

  checkMemory() {
    const total = os.totalmem();
    const used = os.totalmem() - os.freemem();
    const usagePercent = ((used / total) * 100).toFixed(1);
    const thresholdWarning = 80;
    const thresholdError = 95;

    let status = 'healthy';
    let message = `内存使用率: ${usagePercent}%`;

    if (parseFloat(usagePercent) >= thresholdError) {
      status = 'error';
      message = `内存使用率过高: ${usagePercent}% (超过${thresholdError}%)`;
    } else if (parseFloat(usagePercent) >= thresholdWarning) {
      status = 'warning';
      message = `内存使用率偏高: ${usagePercent}% (超过${thresholdWarning}%)`;
    }

    return {
      name: 'memory',
      status,
      message,
      details: {
        total: this.formatMemory(total),
        used: this.formatMemory(used),
        free: this.formatMemory(os.freemem()),
        usagePercent: parseFloat(usagePercent)
      }
    };
  }

  async checkProviders() {
    const activeProvider = providerManager.getActiveProvider();
    
    if (!activeProvider) {
      return {
        name: 'providers',
        status: 'warning',
        message: '未配置活跃的LLM提供商',
        details: { activeProvider: null, availableProviders: providerManager.getAvailableProviders().length }
      };
    }

    try {
      const isAvailable = await activeProvider.isAvailable();
      if (isAvailable) {
        return {
          name: 'providers',
          status: 'healthy',
          message: `LLM提供商 ${activeProvider.name} 可用`,
          details: { activeProvider: activeProvider.name }
        };
      } else {
        return {
          name: 'providers',
          status: 'warning',
          message: `LLM提供商 ${activeProvider.name} 当前不可用`,
          details: { activeProvider: activeProvider.name }
        };
      }
    } catch (error) {
      return {
        name: 'providers',
        status: 'warning',
        message: `LLM提供商检查失败: ${error.message}`,
        details: { activeProvider: activeProvider.name, error: error.message }
      };
    }
  }

  checkDependencies() {
    const requiredModules = ['better-sqlite3', 'axios', 'express'];
    const missingModules = [];

    for (const moduleName of requiredModules) {
      try {
        require(moduleName);
      } catch (error) {
        missingModules.push(moduleName);
      }
    }

    if (missingModules.length > 0) {
      return {
        name: 'dependencies',
        status: 'error',
        message: `缺少必要依赖: ${missingModules.join(', ')}`,
        details: { missingModules, totalRequired: requiredModules.length }
      };
    }

    return {
      name: 'dependencies',
      status: 'healthy',
      message: '所有必要依赖已安装',
      details: { installedModules: requiredModules.length }
    };
  }

  formatMemory(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  inferWarningType(message) {
    if (message.includes('知识库')) return 'knowledge_base_low_hit_rate';
    if (message.includes('提供商') || message.includes('LLM')) return 'provider_failure';
    if (message.includes('内存') || message.includes('性能')) return 'performance_degradation';
    if (message.includes('网络')) return 'network_issue';
    return 'system_warning';
  }

  addToHistory(status) {
    this.healthHistory.push(status);
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }
  }

  getHealthStatus() {
    return this.lastHealthStatus || {
      timestamp: Date.now(),
      overallStatus: 'unknown',
      issues: [],
      warnings: [],
      details: {}
    };
  }

  getHealthHistory() {
    return [...this.healthHistory];
  }

  async triggerDegrade(reason) {
    logger.warn(`系统降级触发: ${reason}`);
    eventBus.emit(SYSTEM_EVENTS.SYSTEM_DEGRADE, {
      reason,
      timestamp: Date.now()
    });
  }

  async triggerRecover(reason) {
    logger.info(`系统恢复触发: ${reason}`);
    eventBus.emit(SYSTEM_EVENTS.SYSTEM_RECOVER, {
      reason,
      timestamp: Date.now()
    });
  }
}

const systemMonitor = new SystemMonitor();

module.exports = {
  SystemMonitor,
  systemMonitor
};