const { logger } = require('../../utils/logger');
const { eventBus, SYSTEM_EVENTS } = require('../../utils/eventBus');
const { telemetry } = require('../../utils/telemetry');
const { getSqliteDatabase } = require('../../utils/database');

class RuleEngine {
  constructor() {
    this.rules = new Map();
    this.ruleHistory = [];
    this.maxHistorySize = 200;
    this.startupTime = Date.now();
    this.minStartupDelay = 5 * 60 * 1000;
    this.init();
  }

  init() {
    try {
      const db = getSqliteDatabase();
      db.exec(`
        CREATE TABLE IF NOT EXISTS sustain_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          condition TEXT NOT NULL,
          action TEXT NOT NULL,
          action_params TEXT,
          priority INTEGER DEFAULT 50,
          enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS rule_execution_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id TEXT NOT NULL,
          rule_name TEXT NOT NULL,
          context TEXT,
          action_taken TEXT,
          result TEXT,
          success INTEGER,
          timestamp INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_rule_log_rule_id ON rule_execution_log(rule_id);
        CREATE INDEX IF NOT EXISTS idx_rule_log_timestamp ON rule_execution_log(timestamp);
      `);

      this.loadRulesFromDb();
      this.loadDefaultRules();
      logger.info(`规则引擎已初始化，加载了 ${this.rules.size} 条规则`);
    } catch (error) {
      logger.error(`规则引擎初始化失败: ${error.message}`);
    }
  }

  loadRulesFromDb() {
    try {
      const db = getSqliteDatabase();
      const rules = db.prepare('SELECT * FROM sustain_rules WHERE enabled = 1 ORDER BY priority DESC').all();
      for (const rule of rules) {
        this.rules.set(rule.rule_id, {
          id: rule.rule_id,
          name: rule.name,
          description: rule.description,
          condition: this.parseCondition(rule.condition),
          action: rule.action,
          actionParams: rule.action_params ? JSON.parse(rule.action_params) : {},
          priority: rule.priority,
          enabled: rule.enabled === 1
        });
      }
    } catch (error) {
      logger.error(`从数据库加载规则失败: ${error.message}`);
    }
  }

  loadDefaultRules() {
    const defaultRules = [
      {
        id: 'switch_provider_on_failure',
        name: '提供商连续失败切换',
        description: '当LLM提供商连续失败3次时自动切换到备用提供商',
        condition: { type: 'metric_threshold', metric: 'providerFailureRate', operator: '>=', value: 30, minSamples: 5 },
        action: 'switch_provider',
        actionParams: {},
        priority: 80
      },
      {
        id: 'knowledge_base_low_hit_rate',
        name: '知识库命中率偏低',
        description: '当知识库命中率低于50%时触发知识库扩充',
        condition: { type: 'metric_threshold', metric: 'knowledgeHitRate', operator: '<', value: 50, minSamples: 20 },
        action: 'suggest_knowledge_update',
        actionParams: {},
        priority: 70
      },
      {
        id: 'high_error_rate',
        name: '错误率过高',
        description: '当优化失败率超过30%时触发AI分析',
        condition: { type: 'metric_threshold', metric: 'optimizationSuccessRate', operator: '<', value: 70, minSamples: 10 },
        action: 'trigger_ai_analysis',
        actionParams: { focus: 'optimization_quality' },
        priority: 90
      },
      {
        id: 'frequent_repairs',
        name: '频繁修复触发',
        description: '当修复尝试次数超过10次时触发深度分析',
        condition: { type: 'metric_threshold', metric: 'repairAttempts', operator: '>=', value: 10, minSamples: 5 },
        action: 'trigger_ai_analysis',
        actionParams: { focus: 'system_stability' },
        priority: 75
      },
      {
        id: 'memory_usage_high',
        name: '内存使用过高',
        description: '当系统内存使用率超过85%时触发清理',
        condition: { type: 'system_check', check: 'memory_usage', operator: '>=', value: 85 },
        action: 'cleanup_memory',
        actionParams: {},
        priority: 60
      }
    ];

    for (const rule of defaultRules) {
      const existingRule = this.rules.get(rule.id);
      if (!existingRule) {
        this.rules.set(rule.id, rule);
        this.saveRuleToDb(rule);
      } else {
        const existingCondition = typeof existingRule.condition === 'string' ? 
          JSON.parse(existingRule.condition) : existingRule.condition;
        if (!existingCondition.minSamples && rule.condition.minSamples) {
          existingCondition.minSamples = rule.condition.minSamples;
          existingRule.condition = existingCondition;
          this.rules.set(rule.id, existingRule);
          this.saveRuleToDb(existingRule);
          logger.info(`更新规则 ${rule.id}，添加最小样本数限制`);
        }
      }
    }
  }

  saveRuleToDb(rule) {
    try {
      const db = getSqliteDatabase();
      db.prepare(`
        INSERT OR REPLACE INTO sustain_rules 
        (rule_id, name, description, condition, action, action_params, priority, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        rule.id,
        rule.name,
        rule.description || '',
        JSON.stringify(rule.condition),
        rule.action,
        JSON.stringify(rule.actionParams || {}),
        rule.priority || 50,
        rule.enabled === false ? 0 : 1
      );
    } catch (error) {
      logger.error(`保存规则到数据库失败: ${error.message}`);
    }
  }

  parseCondition(conditionStr) {
    try {
      return typeof conditionStr === 'string' ? JSON.parse(conditionStr) : conditionStr;
    } catch {
      return { type: 'unknown' };
    }
  }

  async evaluate(context) {
    const elapsedSinceStartup = Date.now() - this.startupTime;
    if (elapsedSinceStartup < this.minStartupDelay) {
      logger.debug(`启动保护中，跳过规则评估 (已启动 ${Math.floor(elapsedSinceStartup / 1000)} 秒)`);
      return [];
    }

    const matchedRules = [];
    const sortedRules = Array.from(this.rules.values())
      .filter(r => r.enabled !== false)
      .sort((a, b) => (b.priority || 50) - (a.priority || 50));

    for (const rule of sortedRules) {
      try {
        const matched = await this.evaluateCondition(rule.condition, context);
        if (matched) {
          matchedRules.push(rule);
        }
      } catch (error) {
        logger.debug(`评估规则 ${rule.id} 失败: ${error.message}`);
      }
    }

    return matchedRules;
  }

  async evaluateCondition(condition, context) {
    if (!condition || !condition.type) return false;

    switch (condition.type) {
      case 'metric_threshold':
        return this.evaluateMetricThreshold(condition, context);
      case 'system_check':
        return this.evaluateSystemCheck(condition, context);
      case 'event_count':
        return this.evaluateEventCount(condition, context);
      case 'composite':
        return this.evaluateComposite(condition, context);
      default:
        return false;
    }
  }

  evaluateMetricThreshold(condition, context) {
    const { metric, operator, value, minSamples } = condition;
    const metrics = context.metrics || telemetry.getMetrics();

    let actualValue = metrics[metric];
    if (actualValue === undefined) {
      const collected = telemetry.collect();
      actualValue = collected.metrics[metric];
    }

    if (actualValue === undefined) return false;

    const sampleCount = this.getSampleCount(metric);
    if (minSamples && sampleCount < minSamples) {
      logger.debug(`规则 ${metric} 跳过：样本数不足 (${sampleCount}/${minSamples})`);
      return false;
    }

    switch (operator) {
      case '>=': return actualValue >= value;
      case '<=': return actualValue <= value;
      case '>': return actualValue > value;
      case '<': return actualValue < value;
      case '==': return actualValue === value;
      case '!=': return actualValue !== value;
      default: return false;
    }
  }

  getSampleCount(metric) {
    const metrics = telemetry.getMetrics();
    switch (metric) {
      case 'optimizationSuccessRate':
        return metrics.optimizationRequests || 0;
      case 'knowledgeHitRate':
        return metrics.knowledgeQueries || 0;
      case 'providerFailureRate':
        return metrics.providerCalls || 0;
      case 'repairAttempts':
        return metrics.repairAttempts || 0;
      default:
        return 0;
    }
  }

  evaluateSystemCheck(condition, context) {
    const { check, operator, value } = condition;
    const system = context.system || telemetry.collect().system;

    let actualValue;
    switch (check) {
      case 'memory_usage':
        const usagePercent = ((system.totalMemory - system.freeMemory) / system.totalMemory * 100);
        actualValue = parseFloat(usagePercent.toFixed(1));
        break;
      case 'cpu_load':
        actualValue = system.loadAverage ? system.loadAverage[0] : 0;
        break;
      case 'free_memory_bytes':
        actualValue = system.freeMemory;
        break;
      default:
        return false;
    }

    switch (operator) {
      case '>=': return actualValue >= value;
      case '<=': return actualValue <= value;
      case '>': return actualValue > value;
      case '<': return actualValue < value;
      default: return false;
    }
  }

  evaluateEventCount(condition, context) {
    const { eventType, timeWindow, operator, value } = condition;
    const windowMs = (timeWindow || 3600) * 1000;
    const since = Date.now() - windowMs;
    const count = telemetry.eventLog.filter(e => e.eventType === eventType && e.timestamp >= since).length;

    switch (operator) {
      case '>=': return count >= value;
      case '<=': return count <= value;
      case '>': return count > value;
      case '<': return count < value;
      case '==': return count === value;
      default: return false;
    }
  }

  evaluateComposite(condition, context) {
    const { conditions, logic = 'and' } = condition;
    if (!conditions || !Array.isArray(conditions)) return false;

    if (logic === 'and') {
      return conditions.every(c => this.evaluateCondition(c, context));
    } else {
      return conditions.some(c => this.evaluateCondition(c, context));
    }
  }

  async executeActions(rules, context) {
    const results = [];

    for (const rule of rules) {
      try {
        const result = await this.executeAction(rule, context);
        results.push({ rule: rule.id, ...result });
        this.logExecution(rule, context, result);
      } catch (error) {
        logger.error(`执行规则 ${rule.id} 动作失败: ${error.message}`);
        results.push({ rule: rule.id, success: false, error: error.message });
        this.logExecution(rule, context, { success: false, error: error.message });
      }
    }

    return results;
  }

  async executeAction(rule, context) {
    const { action, actionParams } = rule;
    telemetry.recordEvent('rule_action', 'rule_engine', { ruleId: rule.id, action }, 'info');

    switch (action) {
      case 'switch_provider':
        return await this.actionSwitchProvider(actionParams);
      case 'suggest_knowledge_update':
        return await this.actionSuggestKnowledgeUpdate(actionParams);
      case 'trigger_ai_analysis':
        return await this.actionTriggerAIAnalysis(actionParams, context);
      case 'cleanup_memory':
        return await this.actionCleanupMemory(actionParams);
      case 'degrade_system':
        return await this.actionDegradeSystem(actionParams);
      case 'notify':
        return await this.actionNotify(actionParams);
      default:
        logger.warn(`未知规则动作: ${action}`);
        return { success: false, error: `未知动作: ${action}` };
    }
  }

  async actionSwitchProvider(params) {
    const { providerManager } = require('../llm/providers');
    const providers = providerManager.getAvailableProviders();
    const activeProvider = providerManager.getActiveProvider();

    for (const provider of providers) {
      if (activeProvider && provider.name === activeProvider.name) continue;
      try {
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          providerManager.setActiveProvider(provider.name);
          logger.info(`规则触发: 已切换到备用提供商 ${provider.name}`);
          telemetry.recordEvent('provider_switched', 'rule_engine', { from: activeProvider?.name, to: provider.name }, 'info');
          return { success: true, action: 'switch_provider', newProvider: provider.name };
        }
      } catch (error) {
        continue;
      }
    }

    return { success: false, error: '没有可用的备用提供商' };
  }

  async actionSuggestKnowledgeUpdate(params) {
    const { selfUpdateManager } = require('./selfUpdateManager');
    try {
      const result = await selfUpdateManager.updateFromAISuggestion(
        '检测到知识库命中率偏低，请分析现有知识库并提供扩充建议',
        { autoConfirm: false }
      );
      return { success: result.success, action: 'suggest_knowledge_update', result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async actionTriggerAIAnalysis(params, context) {
    eventBus.emit(SYSTEM_EVENTS.SYSTEM_WARNING, {
      message: `触发AI分析: ${params.focus || 'general'}`,
      type: params.focus || 'general',
      context
    });
    return { success: true, action: 'trigger_ai_analysis', focus: params.focus };
  }

  async actionCleanupMemory(params) {
    if (global.gc) {
      global.gc();
      logger.info('规则触发: 已执行垃圾回收');
      return { success: true, action: 'cleanup_memory' };
    }
    return { success: false, error: '垃圾回收不可用（需使用 --expose-gc 启动）' };
  }

  async actionDegradeSystem(params) {
    eventBus.emit(SYSTEM_EVENTS.SYSTEM_DEGRADE, {
      reason: params.reason || '规则触发系统降级',
      timestamp: Date.now()
    });
    return { success: true, action: 'degrade_system', reason: params.reason };
  }

  async actionNotify(params) {
    logger.info(`规则通知: ${params.message || '无消息'}`);
    return { success: true, action: 'notify', message: params.message };
  }

  logExecution(rule, context, result) {
    const logEntry = {
      ruleId: rule.id,
      ruleName: rule.name,
      context: JSON.stringify(context).substring(0, 500),
      action: rule.action,
      result: JSON.stringify(result).substring(0, 500),
      success: result.success ? 1 : 0,
      timestamp: Date.now()
    };

    this.ruleHistory.push(logEntry);
    if (this.ruleHistory.length > this.maxHistorySize) {
      this.ruleHistory.shift();
    }

    try {
      const db = getSqliteDatabase();
      db.prepare(`
        INSERT INTO rule_execution_log (rule_id, rule_name, context, action_taken, result, success, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        logEntry.ruleId,
        logEntry.ruleName,
        logEntry.context,
        logEntry.action,
        logEntry.result,
        logEntry.success,
        logEntry.timestamp
      );
    } catch (error) {
      logger.debug(`记录规则执行日志失败: ${error.message}`);
    }
  }

  addRule(rule) {
    this.rules.set(rule.id, rule);
    this.saveRuleToDb(rule);
    logger.info(`新增规则: ${rule.id} - ${rule.name}`);
  }

  removeRule(ruleId) {
    if (this.rules.has(ruleId)) {
      this.rules.delete(ruleId);
      try {
        const db = getSqliteDatabase();
        db.prepare('UPDATE sustain_rules SET enabled = 0 WHERE rule_id = ?').run(ruleId);
      } catch (error) {
        logger.debug(`禁用规则失败: ${error.message}`);
      }
      logger.info(`规则已禁用: ${ruleId}`);
      return true;
    }
    return false;
  }

  getRules() {
    return Array.from(this.rules.values());
  }

  getRuleHistory() {
    return [...this.ruleHistory];
  }

  async runEvaluation(context) {
    const ctx = context || { metrics: telemetry.getMetrics(), system: telemetry.collect().system };
    const matchedRules = await this.evaluate(ctx);
    if (matchedRules.length > 0) {
      logger.info(`规则引擎匹配到 ${matchedRules.length} 条规则`);
      return await this.executeActions(matchedRules, ctx);
    }
    return [];
  }
}

const ruleEngine = new RuleEngine();

module.exports = {
  RuleEngine,
  ruleEngine
};