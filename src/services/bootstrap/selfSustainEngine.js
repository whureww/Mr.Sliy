const { logger } = require('../../utils/logger');
const { eventBus, SYSTEM_EVENTS } = require('../../utils/eventBus');
const { telemetry } = require('../../utils/telemetry');
const { systemMonitor } = require('../../utils/systemMonitor');
const { ruleEngine } = require('./ruleEngine');
const { analysisEngine } = require('./analysisEngine');
const { validator } = require('./validator');

class SelfSustainEngine {
  constructor() {
    this.isRunning = false;
    this.sustainCycleTimer = null;
    this.cycleInterval = 5 * 60 * 1000;
    this.currentCycle = 0;
    this.cycleHistory = [];
    this.maxHistorySize = 50;
    this.setupEventListeners();
  }

  setupEventListeners() {
    eventBus.on(SYSTEM_EVENTS.SYSTEM_ERROR, async (error) => {
      telemetry.recordEvent('system_error', 'sustain_engine', {
        message: error.message,
        stack: error.stack
      }, 'error');
    });

    eventBus.on(SYSTEM_EVENTS.SYSTEM_WARNING, async (warning) => {
      telemetry.recordEvent('system_warning', 'sustain_engine', warning, 'warning');
    });

    eventBus.on(SYSTEM_EVENTS.SYSTEM_RECOVER, async (data) => {
      telemetry.recordEvent('system_recovered', 'sustain_engine', data, 'info');
    });

    eventBus.on(SYSTEM_EVENTS.SYSTEM_DEGRADE, async (data) => {
      telemetry.recordEvent('system_degraded', 'sustain_engine', data, 'warning');
    });
  }

  start() {
    if (this.isRunning) {
      logger.debug('AI自持引擎已在运行中');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 AI自持引擎已启动 - 进入自主运行模式');

    this.runSustainCycle();

    this.sustainCycleTimer = setInterval(() => {
      this.runSustainCycle().catch(err => {
        logger.error(`自持周期执行失败: ${err.message}`);
      });
    }, this.cycleInterval);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.sustainCycleTimer) {
      clearInterval(this.sustainCycleTimer);
      this.sustainCycleTimer = null;
    }
    analysisEngine.stop();
    logger.info('AI自持引擎已停止');
  }

  async runSustainCycle() {
    if (!this.isRunning) return;

    this.currentCycle++;
    const cycleId = `cycle_${Date.now()}`;
    const cycleStart = Date.now();

    logger.debug(`开始自持周期 #${this.currentCycle}`);

    const beforeState = validator.captureState('pre');

    try {
      telemetry.recordEvent('sustain_cycle_start', 'sustain_engine', {
        cycleId,
        cycleNumber: this.currentCycle
      }, 'info');

      await this.runRuleEvaluation();
      await this.runHealthCheck();
      if (this.currentCycle % 6 === 0) {
        await this.runAIAnalysis();
      }

      const afterState = validator.captureState('post');

      const validation = await validator.validate(cycleId, 'cycle', beforeState, afterState);

      const cycleResult = {
        cycleId,
        cycleNumber: this.currentCycle,
        duration: Date.now() - cycleStart,
        validation,
        timestamp: Date.now()
      };

      this.cycleHistory.push(cycleResult);
      if (this.cycleHistory.length > this.maxHistorySize) {
        this.cycleHistory.shift();
      }

      telemetry.recordEvent('sustain_cycle_complete', 'sustain_engine', {
        cycleId,
        cycleNumber: this.currentCycle,
        duration: cycleResult.duration,
        success: validation.success
      }, 'info');

      logger.debug(`自持周期 #${this.currentCycle} 完成 (${cycleResult.duration}ms)`);
    } catch (error) {
      logger.error(`自持周期 #${this.currentCycle} 失败: ${error.message}`);
      telemetry.recordEvent('sustain_cycle_error', 'sustain_engine', {
        cycleId,
        cycleNumber: this.currentCycle,
        error: error.message
      }, 'error');
    }
  }

  async runRuleEvaluation() {
    try {
      const results = await ruleEngine.runEvaluation();
      if (results.length > 0) {
        logger.info(`规则引擎执行了 ${results.length} 个动作`);
        telemetry.recordEvent('rule_evaluation', 'sustain_engine', {
          matchedRules: results.length,
          results
        }, 'info');
      }
      return results;
    } catch (error) {
      logger.error(`规则评估失败: ${error.message}`);
      return [];
    }
  }

  async runHealthCheck() {
    try {
      await systemMonitor.runHealthCheck();
      const status = systemMonitor.getHealthStatus();
      telemetry.recordEvent('health_check', 'sustain_engine', {
        status: status.overallStatus,
        issues: status.issues?.length || 0,
        warnings: status.warnings?.length || 0
      }, status.overallStatus === 'healthy' ? 'info' : 'warning');
      return status;
    } catch (error) {
      logger.error(`健康检查失败: ${error.message}`);
      return null;
    }
  }

  async runAIAnalysis(focus = 'general') {
    try {
      const result = await analysisEngine.runAnalysis(focus);
      if (result.success) {
        logger.info(`AI分析完成: ${result.analysis.summary}`);
      }
      return result;
    } catch (error) {
      logger.error(`AI分析失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async triggerManualAnalysis(focus = 'general') {
    logger.info(`手动触发AI分析，焦点: ${focus}`);
    return await this.runAIAnalysis(focus);
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      currentCycle: this.currentCycle,
      cycleInterval: this.cycleInterval,
      lastCycle: this.cycleHistory[this.cycleHistory.length - 1] || null,
      totalCycles: this.cycleHistory.length
    };
  }

  getStats() {
    const telemetryData = telemetry.collect();
    const ruleStats = {
      totalRules: ruleEngine.getRules().length,
      executionHistory: ruleEngine.getRuleHistory().length
    };
    const analysisStats = analysisEngine.getAnalysisStats();
    const validationStats = validator.getValidationStats();

    return {
      uptime: telemetryData.uptime,
      metrics: telemetryData.metrics,
      rules: ruleStats,
      analysis: analysisStats,
      validation: validationStats,
      cycles: {
        total: this.cycleHistory.length,
        current: this.currentCycle
      }
    };
  }

  getCycleHistory() {
    return [...this.cycleHistory];
  }

  async getDashboard() {
    const healthStatus = systemMonitor.getHealthStatus();
    const lastAnalysis = analysisEngine.getLastAnalysis();
    const stats = this.getStats();

    return {
      timestamp: Date.now(),
      engineStatus: this.getStatus(),
      health: healthStatus,
      lastAnalysis,
      stats,
      recentCycles: this.cycleHistory.slice(-5)
    };
  }
}

const selfSustainEngine = new SelfSustainEngine();

module.exports = {
  SelfSustainEngine,
  selfSustainEngine
};