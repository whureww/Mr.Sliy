const { logger } = require('../../utils/logger');
const { eventBus, SYSTEM_EVENTS } = require('../../utils/eventBus');
const { telemetry } = require('../../utils/telemetry');
const { providerManager } = require('../llm/providers');
const { getDatabase } = require('../../utils/database');

class AnalysisEngine {
  constructor() {
    this.analysisInterval = 30 * 60 * 1000;
    this.analysisTimer = null;
    this.isRunning = false;
    this.lastAnalysis = null;
    this.analysisHistory = [];
    this.maxHistorySize = 50;
    this.init();
  }

  init() {
    try {
      const db = getDatabase();
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_analysis_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          analysis_type TEXT NOT NULL,
          focus TEXT,
          input_data TEXT,
          analysis_result TEXT,
          suggestions TEXT,
          confidence REAL DEFAULT 0,
          executed INTEGER DEFAULT 0,
          execution_result TEXT,
          timestamp INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_type ON ai_analysis_records(analysis_type);
        CREATE INDEX IF NOT EXISTS idx_analysis_timestamp ON ai_analysis_records(timestamp);
      `);
      logger.info('AI分析引擎已初始化');
    } catch (error) {
      logger.error(`AI分析引擎初始化失败: ${error.message}`);
    }
  }

  start() {
    if (this.isRunning) {
      logger.debug('AI分析引擎已在运行中');
      return;
    }

    this.isRunning = true;
    logger.info('AI分析引擎已启动');

    this.analysisTimer = setInterval(() => {
      this.runAnalysis().catch(err => {
        logger.error(`定时AI分析失败: ${err.message}`);
      });
    }, this.analysisInterval);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    logger.info('AI分析引擎已停止');
  }

  async runAnalysis(focus = 'general', customData = null) {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      logger.warn('未配置LLM提供商，跳过AI分析');
      return { success: false, error: '未配置LLM提供商' };
    }

    try {
      logger.info(`开始AI分析，焦点: ${focus}`);

      const data = customData || await this.collectAnalysisData();
      const prompt = this.buildAnalysisPrompt(data, focus);

      telemetry.recordEvent('ai_analysis_request', 'analysis_engine', { focus }, 'info');

      const result = await provider.chat([
        { role: 'system', content: '你是一个智能体系统分析专家，负责分析系统运行数据并提供改进建议。请以JSON格式返回分析结果。' },
        { role: 'user', content: prompt }
      ]);

      const analysis = this.parseAnalysisResult(result.content || result);

      await this.saveAnalysis({
        type: 'scheduled',
        focus,
        inputData: data,
        result: analysis,
        confidence: analysis.confidence || 0.5
      });

      this.lastAnalysis = { focus, analysis, timestamp: Date.now() };
      this.analysisHistory.push(this.lastAnalysis);
      if (this.analysisHistory.length > this.maxHistorySize) {
        this.analysisHistory.shift();
      }

      telemetry.recordEvent('ai_analysis_result', 'analysis_engine', {
        focus,
        success: true,
        confidence: analysis.confidence
      }, 'info');

      if (analysis.suggestions && analysis.suggestions.length > 0) {
        await this.processSuggestions(analysis.suggestions, focus);
      }

      logger.debug(`AI分析完成，生成 ${analysis.suggestions?.length || 0} 条建议`);
      return { success: true, analysis };
    } catch (error) {
      logger.error(`AI分析失败: ${error.message}`);
      telemetry.recordEvent('ai_analysis_result', 'analysis_engine', {
        focus,
        success: false,
        error: error.message
      }, 'error');
      return { success: false, error: error.message };
    }
  }

  async collectAnalysisData() {
    const telemetryData = telemetry.collect();
    const historicalData = await telemetry.getHistoricalData(24);

    return {
      timestamp: Date.now(),
      telemetry: telemetryData,
      historical: {
        totalEvents: historicalData.summary.totalEvents,
        byCategory: historicalData.summary.byCategory,
        bySeverity: historicalData.summary.bySeverity
      },
      recentEvents: telemetryData.recentEvents.slice(-20)
    };
  }

  buildAnalysisPrompt(data, focus) {
    const focusDescriptions = {
      general: '全面分析系统运行状态，识别问题和改进机会',
      optimization_quality: '分析代码优化质量，识别优化失败的原因',
      system_stability: '分析系统稳定性，识别频繁修复的根本原因',
      performance: '分析系统性能，识别性能瓶颈',
      knowledge_base: '分析知识库使用情况，识别知识库扩充需求',
      provider_reliability: '分析LLM提供商可靠性，识别提供商切换需求'
    };

    return `请分析以下智能体系统运行数据，${focusDescriptions[focus] || focusDescriptions.general}。

## 系统运行数据
${JSON.stringify(data.telemetry, null, 2)}

## 历史数据摘要（24小时）
${JSON.stringify(data.historical, null, 2)}

## 最近事件
${JSON.stringify(data.recentEvents, null, 2)}

请严格按照以下JSON格式返回分析结果，不要包含任何其他文字：
{
  "summary": "分析摘要",
  "issues": [
    {
      "type": "问题类型",
      "severity": "critical|warning|info",
      "description": "问题描述",
      "rootCause": "根本原因",
      "impact": "影响范围"
    }
  ],
  "suggestions": [
    {
      "type": "code|config|knowledge|rule|provider",
      "priority": "high|medium|low",
      "title": "建议标题",
      "description": "详细描述",
      "expectedAction": "update_knowledge|update_code|update_config|switch_provider|add_rule|cleanup",
      "params": {},
      "confidence": 0.8
    }
  ],
  "confidence": 0.85,
  "recommendations": ["其他建议"]
}`;
  }

  parseAnalysisResult(result) {
    try {
      let content = typeof result === 'string' ? result : JSON.stringify(result);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const parsed = JSON.parse(content);

      return {
        summary: parsed.summary || '无摘要',
        issues: parsed.issues || [],
        suggestions: parsed.suggestions || [],
        confidence: parsed.confidence || 0.5,
        recommendations: parsed.recommendations || []
      };
    } catch (error) {
      logger.warn(`解析AI分析结果失败: ${error.message}`);
      return {
        summary: '分析结果解析失败',
        issues: [],
        suggestions: [],
        confidence: 0,
        recommendations: []
      };
    }
  }

  async processSuggestions(suggestions, focus) {
    const { selfUpdateManager } = require('./selfUpdateManager');
    const { ruleEngine } = require('./ruleEngine');

    for (const suggestion of suggestions) {
      try {
        telemetry.recordEvent('suggestion_received', 'analysis_engine', {
          type: suggestion.type,
          priority: suggestion.priority,
          title: suggestion.title
        }, 'info');

        const shouldExecute = suggestion.priority === 'high' ||
          (suggestion.confidence && suggestion.confidence >= 0.8);

        if (shouldExecute && suggestion.expectedAction) {
          await this.executeSuggestion(suggestion, selfUpdateManager, ruleEngine);
        } else {
          logger.debug(`建议待确认: [${suggestion.priority}] ${suggestion.title}`);
        }
      } catch (error) {
        logger.error(`处理建议失败: ${error.message}`);
      }
    }
  }

  async executeSuggestion(suggestion, selfUpdateManager, ruleEngine) {
    telemetry.recordEvent('suggestion_executed', 'analysis_engine', {
      type: suggestion.type,
      action: suggestion.expectedAction,
      title: suggestion.title
    }, 'info');

    switch (suggestion.expectedAction) {
      case 'update_knowledge':
        return await selfUpdateManager.updateFromAISuggestion(suggestion.description, { autoConfirm: false });

      case 'update_code':
        return await selfUpdateManager.updateFromAISuggestion(suggestion.description, { autoConfirm: false });

      case 'update_config':
        logger.info(`配置更新建议: ${suggestion.description}`);
        return { success: true, action: 'config_update_logged' };

      case 'switch_provider':
        return await ruleEngine.actionSwitchProvider(suggestion.params || {});

      case 'add_rule':
        ruleEngine.addRule({
          id: `ai_rule_${Date.now()}`,
          name: suggestion.title,
          description: suggestion.description,
          condition: suggestion.params?.condition || { type: 'metric_threshold', metric: 'errors', operator: '>', value: 5 },
          action: suggestion.params?.action || 'notify',
          actionParams: suggestion.params?.actionParams || {},
          priority: suggestion.priority === 'high' ? 80 : 50
        });
        return { success: true, action: 'rule_added' };

      case 'cleanup':
        return await ruleEngine.actionCleanupMemory({});

      default:
        logger.info(`未执行的建议动作: ${suggestion.expectedAction}`);
        return { success: false, error: '未知动作' };
    }
  }

  async saveAnalysis(analysis) {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO ai_analysis_records 
        (analysis_type, focus, input_data, analysis_result, suggestions, confidence, executed, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        analysis.type,
        analysis.focus || 'general',
        JSON.stringify(analysis.inputData).substring(0, 5000),
        JSON.stringify(analysis.result).substring(0, 5000),
        JSON.stringify(analysis.result.suggestions || []).substring(0, 5000),
        analysis.confidence || 0,
        0,
        Date.now()
      );
    } catch (error) {
      logger.error(`保存AI分析记录失败: ${error.message}`);
    }
  }

  getLastAnalysis() {
    return this.lastAnalysis;
  }

  getAnalysisHistory() {
    return [...this.analysisHistory];
  }

  async getAnalysisStats() {
    try {
      const db = getDatabase();
      const total = db.prepare('SELECT COUNT(*) as count FROM ai_analysis_records').get();
      const byType = db.prepare('SELECT analysis_type, COUNT(*) as count FROM ai_analysis_records GROUP BY analysis_type').all();
      const recentExecuted = db.prepare('SELECT COUNT(*) as count FROM ai_analysis_records WHERE executed = 1 AND timestamp >= ?').get(Date.now() - 24 * 60 * 60 * 1000);

      return {
        total: total.count,
        byType,
        recentExecuted: recentExecuted.count
      };
    } catch (error) {
      return { total: 0, byType: [], recentExecuted: 0 };
    }
  }
}

const analysisEngine = new AnalysisEngine();

module.exports = {
  AnalysisEngine,
  analysisEngine
};