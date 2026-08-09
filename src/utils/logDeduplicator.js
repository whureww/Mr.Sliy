const { logger } = require('./logger');

const logCache = new Map();
const MAX_CACHE_SIZE = 1000;
const CACHE_TTL = 60000;

class LogDeduplicator {
  constructor() {
    this.cache = new Map();
    this.enabled = true;
    this.ttl = CACHE_TTL;
    this.maxSize = MAX_CACHE_SIZE;
  }

  shouldLog(key, ...args) {
    if (!this.enabled) return true;
    
    const now = Date.now();
    const cached = this.cache.get(key);
    
    if (!cached) {
      this.cache.set(key, { count: 1, firstTime: now, lastTime: now });
      this._cleanup();
      return true;
    }
    
    if (now - cached.lastTime > this.ttl) {
      if (cached.count > 1) {
        logger.debug(`[日志去重] ${key} 在过去 ${this.ttl / 1000}s 内重复 ${cached.count} 次`);
      }
      cached.count = 1;
      cached.firstTime = now;
      cached.lastTime = now;
      return true;
    }
    
    cached.count++;
    cached.lastTime = now;
    return false;
  }

  logWithDeduplication(level, key, message, ...args) {
    if (this.shouldLog(key)) {
      const logFn = logger[level] || logger.info;
      logFn(message, ...args);
    } else if (this.shouldLog(`${key}_summary`)) {
      const cached = this.cache.get(key);
      logger.debug(`[日志去重] ${message} (已省略 ${cached.count - 1} 条重复日志)`);
    }
  }

  forceLog(level, message, ...args) {
    const logFn = logger[level] || logger.info;
    logFn(message, ...args);
  }

  getStats() {
    let totalDeduplicated = 0;
    let totalLogged = 0;
    
    for (const [, cached] of this.cache) {
      if (cached.count > 1) {
        totalDeduplicated += cached.count - 1;
      }
      totalLogged++;
    }
    
    return {
      totalKeys: this.cache.size,
      totalLogged,
      totalDeduplicated
    };
  }

  reset() {
    this.cache.clear();
  }

  _cleanup() {
    if (this.cache.size > this.maxSize) {
      const now = Date.now();
      const keysToDelete = [];
      
      for (const [key, cached] of this.cache) {
        if (now - cached.lastTime > this.ttl * 2) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => this.cache.delete(key));
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setTtl(ttl) {
    this.ttl = ttl;
  }
}

const logDeduplicator = new LogDeduplicator();

function dedupLog(key, level = 'info', message, ...args) {
  logDeduplicator.logWithDeduplication(level, key, message, ...args);
}

module.exports = {
  LogDeduplicator,
  logDeduplicator,
  dedupLog
};
