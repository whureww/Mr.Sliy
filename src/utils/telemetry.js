const os = require('os');
const { logger } = require('./logger');
const { getSqliteDatabase } = require('./database');

class Telemetry {
  constructor() {
    this.metrics = {
      optimizationRequests: 0,
      optimizationSuccesses: 0,
      optimizationFailures: 0,
      knowledgeQueries: 0,
      knowledgeHits: 0,
      providerCalls: 0,
      providerFailures: 0,
      repairAttempts: 0,
      repairSuccesses: 0,
      updateAttempts: 0,
      updateSuccesses: 0,
      userSessions: 0,
      errors: []
    };
    this.startTime = Date.now();
    this.eventLog = [];
    this.maxEventLogSize = 1000;
    this.init();
  }

  init() {
    try {
      const db = getSqliteDatabase();
      db.exec(`
        CREATE TABLE IF NOT EXISTS telemetry_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          event_category TEXT NOT NULL,
          event_data TEXT,
          severity TEXT DEFAULT 'info',
          timestamp INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_type ON telemetry_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_telemetry_category ON telemetry_events(event_category);
        CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_events(timestamp);
      `);
      logger.info('遥测数据收集器已初始化');
    } catch (error) {
      logger.error(`遥测初始化失败: ${error.message}`);
    }
  }

  recordEvent(eventType, category, data = {}, severity = 'info') {
    const event = {
      eventType,
      category,
      data,
      severity,
      timestamp: Date.now()
    };

    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEventLogSize) {
      this.eventLog.shift();
    }

    this.updateMetrics(eventType, category, data, severity);

    try {
      const db = getSqliteDatabase();
      db.prepare(`
        INSERT INTO telemetry_events (event_type, event_category, event_data, severity, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(eventType, category, JSON.stringify(data), severity, event.timestamp);
    } catch (error) {
      logger.debug(`遥测事件存储失败: ${error.message}`);
    }
  }

  updateMetrics(eventType, category, data, severity) {
    switch (eventType) {
      case 'optimization_request':
        this.metrics.optimizationRequests++;
        break;
      case 'optimization_result':
        if (data.success) {
          this.metrics.optimizationSuccesses++;
        } else {
          this.metrics.optimizationFailures++;
        }
        break;
      case 'knowledge_query':
        this.metrics.knowledgeQueries++;
        if (data.hit) {
          this.metrics.knowledgeHits++;
        }
        break;
      case 'provider_call':
        this.metrics.providerCalls++;
        if (!data.success) {
          this.metrics.providerFailures++;
        }
        break;
      case 'repair_attempt':
        this.metrics.repairAttempts++;
        if (data.success) {
          this.metrics.repairSuccesses++;
        }
        break;
      case 'update_attempt':
        this.metrics.updateAttempts++;
        if (data.success) {
          this.metrics.updateSuccesses++;
        }
        break;
      case 'user_session':
        this.metrics.userSessions++;
        break;
      case 'error':
        if (severity === 'error' || severity === 'critical') {
          this.metrics.errors.push({
            message: data.message || 'Unknown error',
            timestamp: Date.now()
          });
          if (this.metrics.errors.length > 100) {
            this.metrics.errors.shift();
          }
        }
        break;
    }
  }

  collect() {
    const uptime = Date.now() - this.startTime;
    const successRate = this.metrics.optimizationRequests > 0
      ? (this.metrics.optimizationSuccesses / this.metrics.optimizationRequests * 100).toFixed(2)
      : 0;
    const hitRate = this.metrics.knowledgeQueries > 0
      ? (this.metrics.knowledgeHits / this.metrics.knowledgeQueries * 100).toFixed(2)
      : 0;
    const providerFailureRate = this.metrics.providerCalls > 0
      ? (this.metrics.providerFailures / this.metrics.providerCalls * 100).toFixed(2)
      : 0;
    const repairSuccessRate = this.metrics.repairAttempts > 0
      ? (this.metrics.repairSuccesses / this.metrics.repairAttempts * 100).toFixed(2)
      : 0;
    const updateSuccessRate = this.metrics.updateAttempts > 0
      ? (this.metrics.updateSuccesses / this.metrics.updateAttempts * 100).toFixed(2)
      : 0;

    return {
      timestamp: Date.now(),
      uptime,
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        cpuCount: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        memoryUsage: process.memoryUsage(),
        loadAverage: os.loadavg()
      },
      metrics: {
        ...this.metrics,
        optimizationSuccessRate: parseFloat(successRate),
        knowledgeHitRate: parseFloat(hitRate),
        providerFailureRate: parseFloat(providerFailureRate),
        repairSuccessRate: parseFloat(repairSuccessRate),
        updateSuccessRate: parseFloat(updateSuccessRate)
      },
      recentEvents: this.eventLog.slice(-50)
    };
  }

  async getHistoricalData(hours = 24) {
    try {
      const db = getSqliteDatabase();
      const since = Date.now() - (hours * 60 * 60 * 1000);
      const events = db.prepare(`
        SELECT event_type, event_category, event_data, severity, timestamp
        FROM telemetry_events
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT 5000
      `).all(since);

      const summary = {
        totalEvents: events.length,
        byCategory: {},
        bySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
        timeRange: { start: since, end: Date.now() }
      };

      for (const event of events) {
        const category = event.event_category;
        if (!summary.byCategory[category]) {
          summary.byCategory[category] = 0;
        }
        summary.byCategory[category]++;

        if (summary.bySeverity[event.severity] !== undefined) {
          summary.bySeverity[event.severity]++;
        }
      }

      return { events, summary };
    } catch (error) {
      logger.error(`获取历史遥测数据失败: ${error.message}`);
      return { events: [], summary: { totalEvents: 0, byCategory: {}, bySeverity: {} } };
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  reset() {
    this.metrics = {
      optimizationRequests: 0,
      optimizationSuccesses: 0,
      optimizationFailures: 0,
      knowledgeQueries: 0,
      knowledgeHits: 0,
      providerCalls: 0,
      providerFailures: 0,
      repairAttempts: 0,
      repairSuccesses: 0,
      updateAttempts: 0,
      updateSuccesses: 0,
      userSessions: 0,
      errors: []
    };
    this.eventLog = [];
    this.startTime = Date.now();
    logger.info('遥测数据已重置');
  }
}

const telemetry = new Telemetry();

module.exports = {
  Telemetry,
  telemetry
};