const { logger } = require('../../utils/logger');
const { semanticAnalyzer } = require('./semanticAnalyzer');
const { ruleEngine } = require('./ruleEngine');
const { patternEngine } = require('./patternEngine');
const { knowledgeBase } = require('../vector/knowledgeBase');
const { providerManager } = require('../llm/providers');
const { config } = require('../../config');

class Optimizer {
  constructor() {
    this.semanticAnalyzer = semanticAnalyzer;
    this.ruleEngine = ruleEngine;
    this.patternEngine = patternEngine;
    this.knowledgeBase = knowledgeBase;
    this.providerManager = providerManager;
  }

  async optimize(code, context = {}) {
    const startTime = Date.now();
    const language = context.language || 'javascript';
    const mode = context.mode || 'auto';

    let result = {
      success: false,
      optimizedCode: code,
      explanation: '',
      suggestions: [],
      appliedRules: [],
      appliedPatterns: [],
      appliedPatternsKB: [],
      mode: '',
      durationMs: 0,
      metrics: {},
      analysis: {}
    };

    try {
      const analysis = await this.semanticAnalyzer.analyze(code, language);
      result.analysis = analysis;
      result.metrics = analysis.metrics;

      switch (mode) {
        case 'online':
          result = await this.optimizeOnline(code, context, analysis);
          break;
        
        case 'offline':
          result = await this.optimizeOffline(code, context, analysis);
          break;
        
        case 'auto':
        default:
          result = await this.optimizeAuto(code, context, analysis);
          break;
      }

    } catch (error) {
      logger.error('优化失败:', error);
      result.success = false;
      result.message = error.message;
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  async optimizeOnline(code, context, analysis) {
    const hasProvider = this.providerManager.getActiveProvider() !== null;
    
    if (!hasProvider) {
      return await this.optimizeOffline(code, context, analysis);
    }

    try {
      const { optimizeWithRAG } = require('../rag/agent');
      const ragResult = await optimizeWithRAG(
        { codeSnippet: code, id: context.issueId },
        context
      );

      if (ragResult.success) {
        return {
          success: true,
          optimizedCode: ragResult.optimizedCode,
          explanation: ragResult.explanation,
          suggestions: ragResult.suggestions || [],
          appliedRules: [],
          appliedPatterns: [],
          appliedPatternsKB: [],
          mode: 'online',
          metrics: analysis.metrics,
          analysis: analysis
        };
      }
    } catch (e) {
      logger.warn('在线优化失败，回退到离线模式:', e.message);
    }

    return await this.optimizeOffline(code, context, analysis);
  }

  async optimizeOffline(code, context, analysis) {
    let optimizedCode = code;
    const allSuggestions = [];
    const appliedRules = [];
    const appliedPatterns = [];
    const appliedPatternsKB = [];

    const kbResult = await this.knowledgeBase.applyOptimizationPattern(code, {
      language: context.language
    });

    if (kbResult.success) {
      optimizedCode = kbResult.optimizedCode;
      appliedPatternsKB.push(...kbResult.appliedPatterns);
      allSuggestions.push(...kbResult.suggestions);
    }

    const patternResult = await this.patternEngine.optimize(optimizedCode, context.language);
    
    if (patternResult.success) {
      optimizedCode = patternResult.optimizedCode;
      appliedPatterns.push(...patternResult.appliedPatterns);
      allSuggestions.push(...patternResult.suggestions);
    }

    const ruleResult = this.ruleEngine.optimize(optimizedCode, context);
    
    if (ruleResult.success) {
      optimizedCode = ruleResult.optimizedCode;
      appliedRules.push(...ruleResult.appliedRules);
      allSuggestions.push(...ruleResult.suggestions);
    }

    const changed = optimizedCode !== code;

    return {
      success: changed,
      optimizedCode: optimizedCode,
      explanation: changed 
        ? `离线优化完成，应用了${appliedRules.length}个规则、${appliedPatterns.length}个模式、${appliedPatternsKB.length}个知识库模式`
        : '离线模式下未找到可应用的优化方案',
      suggestions: [...new Set(allSuggestions)],
      appliedRules: appliedRules,
      appliedPatterns: appliedPatterns,
      appliedPatternsKB: appliedPatternsKB,
      mode: 'offline',
      metrics: analysis.metrics,
      analysis: analysis
    };
  }

  async optimizeAuto(code, context, analysis) {
    const hasProvider = this.providerManager.getActiveProvider() !== null;
    
    if (hasProvider && analysis.metrics.complexity > 5) {
      try {
        const { optimizeWithRAG } = require('../rag/agent');
        const ragResult = await optimizeWithRAG(
          { codeSnippet: code, id: context.issueId },
          context
        );

        if (ragResult.success) {
          return {
            success: true,
            optimizedCode: ragResult.optimizedCode,
            explanation: ragResult.explanation,
            suggestions: ragResult.suggestions || [],
            appliedRules: [],
            appliedPatterns: [],
            appliedPatternsKB: [],
            mode: 'online',
            metrics: analysis.metrics,
            analysis: analysis
          };
        }
      } catch (e) {
        logger.warn('在线优化失败，回退到离线模式:', e.message);
      }
    }

    return await this.optimizeOffline(code, context, analysis);
  }

  async analyze(code, language) {
    return await this.semanticAnalyzer.analyze(code, language);
  }

  async getOptimizationOptions(code, language) {
    const analysis = await this.semanticAnalyzer.analyze(code, language);
    const applicablePatterns = await this.patternEngine.analyze(code, language);
    const rules = this.ruleEngine.getRulesByCategory(language);
    
    return {
      analysis: analysis,
      applicablePatterns: applicablePatterns,
      applicableRules: rules,
      recommendations: this.generateRecommendations(analysis, applicablePatterns, rules)
    };
  }

  generateRecommendations(analysis, patterns, rules) {
    const recommendations = [];

    if (analysis.metrics.complexity > 10) {
      recommendations.push({
        type: 'warning',
        message: '代码复杂度较高，建议拆分函数',
        priority: 'high'
      });
    }

    if (analysis.metrics.maxDepth > 3) {
      recommendations.push({
        type: 'warning',
        message: '嵌套层级过深，建议使用早返回模式',
        priority: 'high'
      });
    }

    if (analysis.metrics.readability < 60) {
      recommendations.push({
        type: 'info',
        message: '代码可读性较低，建议优化命名和结构',
        priority: 'medium'
      });
    }

    if (analysis.metrics.maintainability < 60) {
      recommendations.push({
        type: 'info',
        message: '代码可维护性较低，建议重构',
        priority: 'medium'
      });
    }

    patterns.forEach(p => {
      if (p.confidence > 0.7) {
        recommendations.push({
          type: 'optimization',
          message: p.pattern.transform.explanation,
          priority: p.pattern.risk === 'low' ? 'high' : 'medium'
        });
      }
    });

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  getStats() {
    return {
      rules: this.ruleEngine.getStats(),
      patterns: {
        totalPatterns: this.patternEngine.patterns.length,
        byType: {},
        byRisk: {}
      }
    };
  }
}

const optimizer = new Optimizer();

module.exports = {
  Optimizer,
  optimizer
};