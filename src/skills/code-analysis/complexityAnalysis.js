/**
 * 代码复杂度分析技能
 * 提供代码复杂度评估、圈复杂度计算、认知复杂度分析等功能
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');
const { parseCode, extractFunctions } = require('../../services/ast/parser');

class ComplexityAnalysisSkill extends Skill {
  constructor() {
    super(
      'complexity-analysis',
      '代码复杂度分析技能 - 圈复杂度、认知复杂度评估',
      '1.0.0'
    );
    this.dependencies = ['ast-parser'];
  }

  async init() {
    logger.info('代码复杂度分析技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && (context.sourceCode || context.filePath);
  }

  async execute(context = {}) {
    const { sourceCode, filePath, options = {} } = context;

    if (!sourceCode && !filePath) {
      throw new Error('请提供源代码或文件路径');
    }

    const fs = require('fs');
    const code = sourceCode || fs.readFileSync(filePath, 'utf-8');
    const language = options.language || getFileLanguage(filePath || '');

    return this._analyzeComplexity(code, filePath || 'unknown', language);
  }

  async calculateCyclomaticComplexity(sourceCode, language = 'javascript') {
    const parseResult = await parseCode(sourceCode, language);
    
    if (!parseResult.success) {
      return { success: false, error: parseResult.error };
    }

    const tree = parseResult.tree;
    const functions = extractFunctions(tree, sourceCode);
    
    const results = [];
    let totalComplexity = 0;

    for (const func of functions) {
      const complexity = this._calculateFunctionComplexity(func.code || '', func.params);
      totalComplexity += complexity;
      
      results.push({
        name: func.name,
        startLine: func.startLine,
        endLine: func.endLine,
        cyclomaticComplexity: complexity,
        status: this._getComplexityStatus(complexity)
      });
    }

    const avgComplexity = functions.length > 0 ? totalComplexity / functions.length : 0;

    return {
      success: true,
      totalFunctions: functions.length,
      totalComplexity,
      averageComplexity: avgComplexity.toFixed(2),
      maxComplexity: results.length > 0 ? Math.max(...results.map(r => r.cyclomaticComplexity)) : 0,
      functions: results,
      overallStatus: this._getComplexityStatus(avgComplexity)
    };
  }

  async calculateCognitiveComplexity(sourceCode, language = 'javascript') {
    const lines = sourceCode.split('\n');
    let complexity = 1;
    let nestingLevel = 0;
    const hotspots = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      if (!line || line.startsWith('//')) continue;

      const complexityKeywords = [
        'if', 'else', 'for', 'while', 'do', 'switch', 'case',
        'catch', 'finally', 'break', 'continue', 'return'
      ];

      for (const keyword of complexityKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'g');
        let match;
        while ((match = regex.exec(line)) !== null) {
          if (!this._isInString(line, match.index)) {
            complexity++;
            
            if (['if', 'for', 'while', 'do', 'switch', 'case'].includes(keyword)) {
              nestingLevel++;
              complexity += nestingLevel;
              
              if (complexity > 10) {
                hotspots.push({
                  line: lineNum,
                  code: line,
                  keyword,
                  nestingLevel
                });
              }
            }
          }
        }
      }

      if (line.includes('{')) {
        nestingLevel++;
      } else if (line.includes('}')) {
        nestingLevel = Math.max(0, nestingLevel - 1);
      }
    }

    return {
      success: true,
      cognitiveComplexity: complexity,
      status: this._getCognitiveComplexityStatus(complexity),
      hotspots
    };
  }

  _calculateFunctionComplexity(code, params = []) {
    let complexity = 1;
    
    if (!code) return complexity;

    const decisionPoints = [
      /\bif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bdo\b/g,
      /\bswitch\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\&\&/g,
      /\|\|/g,
      /\?.*:/g
    ];

    for (const pattern of decisionPoints) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  _getComplexityStatus(complexity) {
    if (complexity <= 5) return { level: 'low', color: 'green', message: '复杂度低，代码清晰' };
    if (complexity <= 10) return { level: 'medium', color: 'yellow', message: '复杂度中等，建议重构' };
    if (complexity <= 20) return { level: 'high', color: 'orange', message: '复杂度较高，需要优化' };
    return { level: 'critical', color: 'red', message: '复杂度极高，严重影响可维护性' };
  }

  _getCognitiveComplexityStatus(complexity) {
    if (complexity <= 10) return { level: 'low', color: 'green', message: '认知复杂度低' };
    if (complexity <= 20) return { level: 'medium', color: 'yellow', message: '认知复杂度中等' };
    if (complexity <= 30) return { level: 'high', color: 'orange', message: '认知复杂度较高' };
    return { level: 'critical', color: 'red', message: '认知复杂度极高' };
  }

  _isInString(line, index) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;

    for (let i = 0; i < index; i++) {
      const char = line[i];
      
      if (char === "'" && !inDoubleQuote && !inBacktick) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote && !inBacktick) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
        inBacktick = !inBacktick;
      }
    }

    return inSingleQuote || inDoubleQuote || inBacktick;
  }

  async _analyzeComplexity(sourceCode, filePath, language) {
    const startTime = Date.now();

    try {
      const cyclomatic = await this.calculateCyclomaticComplexity(sourceCode, language);
      const cognitive = await this.calculateCognitiveComplexity(sourceCode, language);

      return {
        success: true,
        filePath,
        language,
        cyclomaticComplexity: cyclomatic,
        cognitiveComplexity: cognitive,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`复杂度分析失败: ${filePath}`, error);
      return {
        success: false,
        message: error.message,
        filePath,
        durationMs: Date.now() - startTime
      };
    }
  }
}

const complexityAnalysisSkill = new ComplexityAnalysisSkill();

module.exports = complexityAnalysisSkill;
