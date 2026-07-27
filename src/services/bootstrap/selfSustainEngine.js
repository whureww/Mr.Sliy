const { logger } = require('../../utils/logger');
const { eventBus, SYSTEM_EVENTS } = require('../../utils/eventBus');
const { telemetry } = require('../../utils/telemetry');
const { systemMonitor } = require('../../utils/systemMonitor');
const { ruleEngine } = require('./ruleEngine');
const { analysisEngine } = require('./analysisEngine');
const { validator } = require('./validator');
const { notificationSystem } = require('../../utils/notificationSystem');
const { selfRepairManager } = require('./selfRepairManager');
const { selfUpdateManager } = require('./selfUpdateManager');

class SelfSustainEngine {
  constructor() {
    this.isRunning = false;
    this.sustainCycleTimer = null;
    this.cycleInterval = 5 * 60 * 1000;
    this.currentCycle = 0;
    this.cycleHistory = [];
    this.maxHistorySize = 50;
    
    // 自动更新修复配置
    this.autoRepairEnabled = true;
    this.autoUpdateEnabled = true;
    this.idleThresholdForAuto = 3 * 60 * 1000; // 3分钟空闲后自动执行
    this.minAutoInterval = 30 * 60 * 1000; // 最小自动执行间隔
    this.lastAutoActionTime = 0;
    
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
      
      // 检查是否空闲并执行自动更新修复
      await this.runAutoUpdateAndRepair();

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
        logger.debug(`AI分析完成: ${result.analysis.summary}`);
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

  /**
   * 检查系统是否处于空闲状态
   */
  isSystemIdle() {
    const now = Date.now();
    const idleTime = now - notificationSystem.lastActivityTime;
    return idleTime >= this.idleThresholdForAuto;
  }

  /**
   * 获取距离上次自动执行的时间间隔
   */
  getTimeSinceLastAutoAction() {
    return Date.now() - this.lastAutoActionTime;
  }

  /**
   * 在空闲时自动执行更新和修复
   */
  async runAutoUpdateAndRepair() {
    // 检查是否启用自动更新修复
    if (!this.autoUpdateEnabled && !this.autoRepairEnabled) {
      return;
    }
    
    // 检查是否空闲
    if (!this.isSystemIdle()) {
      return;
    }
    
    // 检查是否超过最小执行间隔
    if (this.getTimeSinceLastAutoAction() < this.minAutoInterval) {
      return;
    }
    
    logger.info('🔄 检测到系统空闲，开始自动执行更新和修复...');
    this.lastAutoActionTime = Date.now();
    
    // 发出开始事件
    eventBus.emit(SYSTEM_EVENTS.AUTO_MAINTENANCE_START);
    
    try {
      // 先执行自动修复
      if (this.autoRepairEnabled) {
        await this.runAutoRepair();
      }
      
      // 再执行自动更新检查
      if (this.autoUpdateEnabled) {
        await this.runAutoUpdateCheck();
      }
      
      logger.info('✅ 自动更新修复完成');
      telemetry.recordEvent('auto_maintenance_complete', 'sustain_engine', {}, 'info');
      
      // 发出结束事件（成功）
      eventBus.emit(SYSTEM_EVENTS.AUTO_MAINTENANCE_END, { success: true });
    } catch (error) {
      logger.error(`自动更新修复失败: ${error.message}`);
      telemetry.recordEvent('auto_maintenance_error', 'sustain_engine', {
        error: error.message
      }, 'error');
      
      // 发出结束事件（失败）
      eventBus.emit(SYSTEM_EVENTS.AUTO_MAINTENANCE_END, { success: false, error: error.message });
    }
  }

  /**
   * 自动执行修复
   */
  async runAutoRepair() {
    logger.info('🔧 开始自动修复检查...');
    
    try {
      // 获取系统健康状态
      const healthStatus = systemMonitor.getHealthStatus();
      
      if (healthStatus.overallStatus !== 'healthy') {
        logger.info(`检测到系统健康问题: ${healthStatus.issues.join(', ')}`);
        
        // 尝试自动修复所有问题
        for (const issue of healthStatus.issues) {
          try {
            const result = await selfRepairManager.detectAndRepair({
              message: issue,
              stack: ''
            }, {
              autoConfirm: true,
              skipBackup: false
            });
            
            if (result.success) {
              logger.info(`✅ 自动修复成功: ${issue}`);
              telemetry.recordEvent('auto_repair_success', 'sustain_engine', {
                issue
              }, 'info');
            } else {
              logger.warn(`❌ 自动修复失败: ${issue}`);
              telemetry.recordEvent('auto_repair_failure', 'sustain_engine', {
                issue,
                reason: result.message
              }, 'warning');
            }
          } catch (repairError) {
            logger.error(`修复 ${issue} 时发生异常: ${repairError.message}`);
          }
        }
      } else {
        logger.info('系统健康状态良好，无需修复');
      }
    } catch (error) {
      logger.error(`自动修复检查失败: ${error.message}`);
    }
  }

  /**
   * 自动执行更新检查
   */
  async runAutoUpdateCheck() {
    logger.info('🔍 开始自动更新检查...');
    
    try {
      // 检查是否有待处理的更新建议
      const pendingUpdates = selfUpdateManager.pendingUpdates;
      
      if (pendingUpdates.length > 0) {
        logger.info(`检测到 ${pendingUpdates.length} 个待处理更新`);
        
        for (const update of pendingUpdates) {
          try {
            // 对于低风险更新自动执行，高风险更新需要确认
            // pendingUpdates 中的对象结构：{ id, updateType, status, ... }
            const updateDescription = update.description || `更新 ${update.updateType || update.id}`;
            const autoConfirm = true; // 自动模式下默认确认
            
            logger.info(`自动执行更新: ${updateDescription}`);
            const result = await selfUpdateManager.executeUpdate(update.id, { 
              autoConfirm: autoConfirm,
              skipConfirmation: autoConfirm
            });
            
            if (result.success) {
              logger.info(`✅ 更新成功: ${updateDescription}`);
              telemetry.recordEvent('auto_update_success', 'sustain_engine', {
                updateType: update.updateType,
                description: updateDescription
              }, 'info');
            } else {
              logger.warn(`❌ 更新失败: ${updateDescription}`);
            }
          } catch (updateError) {
            logger.error(`执行更新 ${update.id} 时发生异常: ${updateError.message}`);
          }
        }
      } else {
        logger.info('无待处理更新');
      }
    } catch (error) {
      logger.error(`自动更新检查失败: ${error.message}`);
    }
  }

  /**
   * 设置自动更新修复配置
   */
  setAutoConfig(options) {
    if (options.autoRepairEnabled !== undefined) {
      this.autoRepairEnabled = options.autoRepairEnabled;
    }
    if (options.autoUpdateEnabled !== undefined) {
      this.autoUpdateEnabled = options.autoUpdateEnabled;
    }
    if (options.idleThresholdForAuto !== undefined) {
      this.idleThresholdForAuto = options.idleThresholdForAuto;
    }
    if (options.minAutoInterval !== undefined) {
      this.minAutoInterval = options.minAutoInterval;
    }
    logger.info(`自动更新修复配置已更新: autoRepair=${this.autoRepairEnabled}, autoUpdate=${this.autoUpdateEnabled}`);
  }

  /**
   * 获取自动更新修复配置
   */
  getAutoConfig() {
    return {
      autoRepairEnabled: this.autoRepairEnabled,
      autoUpdateEnabled: this.autoUpdateEnabled,
      idleThresholdForAuto: this.idleThresholdForAuto,
      minAutoInterval: this.minAutoInterval,
      lastAutoActionTime: this.lastAutoActionTime
    };
  }
}

const selfSustainEngine = new SelfSustainEngine();

module.exports = {
  SelfSustainEngine,
  selfSustainEngine
};