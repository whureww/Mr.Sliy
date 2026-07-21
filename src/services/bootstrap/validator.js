const { logger } = require('../../utils/logger');
const { telemetry } = require('../../utils/telemetry');
const { getDatabase } = require('../../utils/database');

class Validator {
  constructor() {
    this.validationHistory = [];
    this.maxHistorySize = 100;
    this.init();
  }

  init() {
    try {
      const db = getDatabase();
      db.exec(`
        CREATE TABLE IF NOT EXISTS validation_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          validation_type TEXT NOT NULL,
          target_id TEXT,
          target_type TEXT,
          before_state TEXT,
          after_state TEXT,
          metrics_before TEXT,
          metrics_after TEXT,
          success INTEGER DEFAULT 0,
          improvement_score REAL DEFAULT 0,
          timestamp INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_validation_type ON validation_records(validation_type);
        CREATE INDEX IF NOT EXISTS idx_validation_target ON validation_records(target_id);
        CREATE INDEX IF NOT EXISTS idx_validation_timestamp ON validation_records(timestamp);
      `);
      logger.info('效果验证器已初始化');
    } catch (error) {
      logger.error(`效果验证器初始化失败: ${error.message}`);
    }
  }

  captureState(type = 'pre') {
    const metrics = telemetry.getMetrics();
    const collected = telemetry.collect();
    return {
      type,
      timestamp: Date.now(),
      metrics: { ...metrics },
      system: {
        memoryUsage: collected.system.memoryUsage,
        freeMemory: collected.system.freeMemory
      }
    };
  }

  async validate(targetId, targetType, beforeState, afterState) {
    try {
      logger.debug(`开始验证 ${targetType}: ${targetId}`);

      const validation = {
        targetId,
        targetType,
        beforeState,
        afterState,
        timestamp: Date.now(),
        success: false,
        improvementScore: 0,
        metrics: {}
      };

      switch (targetType) {
        case 'update':
          validation.metrics = await this.validateUpdate(beforeState, afterState);
          break;
        case 'repair':
          validation.metrics = await this.validateRepair(beforeState, afterState);
          break;
        case 'optimization':
          validation.metrics = await this.validateOptimization(beforeState, afterState);
          break;
        case 'rule':
          validation.metrics = await this.validateRule(beforeState, afterState);
          break;
        case 'cycle':
          validation.metrics = await this.validateCycle(beforeState, afterState);
          break;
        default:
          validation.metrics = this.compareStates(beforeState, afterState);
      }

      validation.success = validation.metrics.success || false;
      validation.improvementScore = validation.metrics.improvementScore || 0;

      this.saveValidation(validation);
      this.validationHistory.push(validation);
      if (this.validationHistory.length > this.maxHistorySize) {
        this.validationHistory.shift();
      }

      if (validation.success) {
        logger.debug(`验证成功: ${targetType} (${targetId}) 改进分数: ${validation.improvementScore}`);
      } else {
        logger.warn(`验证失败: ${targetType} (${targetId})`);
      }

      return validation;
    } catch (error) {
      logger.error(`验证过程失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async validateUpdate(beforeState, afterState) {
    const comparison = this.compareStates(beforeState, afterState);
    const success = comparison.metricsImproved || comparison.errorsReduced;
    return {
      success,
      improvementScore: comparison.improvementScore,
      details: comparison
    };
  }

  async validateRepair(beforeState, afterState) {
    const repairSuccess = afterState.metrics.repairSuccesses > (beforeState.metrics.repairSuccesses || 0);
    const errorsReduced = (afterState.metrics.errors?.length || 0) < (beforeState.metrics.errors?.length || 0);
    const success = repairSuccess || errorsReduced;

    return {
      success,
      improvementScore: success ? 0.7 : 0,
      details: { repairSuccess, errorsReduced }
    };
  }

  async validateOptimization(beforeState, afterState) {
    const successRateBefore = beforeState.metrics.optimizationSuccessRate || 0;
    const successRateAfter = afterState.metrics.optimizationSuccessRate || 0;
    const improvement = successRateAfter - successRateBefore;
    const success = improvement >= 0;

    return {
      success,
      improvementScore: Math.max(0, improvement / 100),
      details: { successRateBefore, successRateAfter, improvement }
    };
  }

  async validateRule(beforeState, afterState) {
    const ruleActionsBefore = beforeState.metrics.ruleActions || 0;
    const ruleActionsAfter = afterState.metrics.ruleActions || 0;
    const success = ruleActionsAfter >= ruleActionsBefore;

    return {
      success,
      improvementScore: success ? 0.5 : 0,
      details: { ruleActionsBefore, ruleActionsAfter }
    };
  }

  async validateCycle(beforeState, afterState) {
    const beforeErrors = beforeState.metrics.errors?.length || 0;
    const afterErrors = afterState.metrics.errors?.length || 0;
    
    const errorsNotIncreased = afterErrors <= beforeErrors;
    const systemStable = !beforeState.metrics.criticalError && !afterState.metrics.criticalError;
    
    const success = errorsNotIncreased && systemStable;

    return {
      success,
      improvementScore: success ? 0.3 : 0,
      details: { 
        errorsNotIncreased, 
        systemStable,
        beforeErrors,
        afterErrors
      }
    };
  }

  compareStates(beforeState, afterState) {
    const before = beforeState.metrics || {};
    const after = afterState.metrics || {};

    const metricsImproved =
      (after.optimizationSuccessRate || 0) >= (before.optimizationSuccessRate || 0) &&
      (after.knowledgeHitRate || 0) >= (before.knowledgeHitRate || 0) &&
      (after.providerFailureRate || 0) <= (before.providerFailureRate || 0);

    const errorsBefore = before.errors?.length || 0;
    const errorsAfter = after.errors?.length || 0;
    const errorsReduced = errorsAfter <= errorsBefore;

    let improvementScore = 0;
    if (metricsImproved) improvementScore += 0.5;
    if (errorsReduced) improvementScore += 0.3;
    if (after.optimizationSuccessRate > before.optimizationSuccessRate) improvementScore += 0.2;

    return {
      metricsImproved,
      errorsReduced,
      improvementScore,
      before: { successRate: before.optimizationSuccessRate, hitRate: before.knowledgeHitRate, failureRate: before.providerFailureRate },
      after: { successRate: after.optimizationSuccessRate, hitRate: after.knowledgeHitRate, failureRate: after.providerFailureRate }
    };
  }

  saveValidation(validation) {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO validation_records 
        (validation_type, target_id, target_type, before_state, after_state, metrics_before, metrics_after, success, improvement_score, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'automatic',
        validation.targetId,
        validation.targetType,
        JSON.stringify(validation.beforeState).substring(0, 2000),
        JSON.stringify(validation.afterState).substring(0, 2000),
        JSON.stringify(validation.beforeState.metrics || {}).substring(0, 2000),
        JSON.stringify(validation.afterState.metrics || {}).substring(0, 2000),
        validation.success ? 1 : 0,
        validation.improvementScore,
        validation.timestamp
      );
    } catch (error) {
      logger.error(`保存验证记录失败: ${error.message}`);
    }
  }

  getValidationHistory() {
    return [...this.validationHistory];
  }

  async getValidationStats() {
    try {
      const db = getDatabase();
      const total = db.prepare('SELECT COUNT(*) as count FROM validation_records').get();
      const successful = db.prepare('SELECT COUNT(*) as count FROM validation_records WHERE success = 1').get();
      const avgImprovement = db.prepare('SELECT AVG(improvement_score) as avg FROM validation_records').get();

      return {
        total: total.count,
        successful: successful.count,
        successRate: total.count > 0 ? (successful.count / total.count * 100).toFixed(2) : 0,
        avgImprovement: avgImprovement.avg || 0
      };
    } catch (error) {
      return { total: 0, successful: 0, successRate: 0, avgImprovement: 0 };
    }
  }
}

const validator = new Validator();

module.exports = {
  Validator,
  validator
};