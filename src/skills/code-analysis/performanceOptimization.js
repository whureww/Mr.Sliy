/**
 * 性能优化技能
 * 提供性能分析和优化建议
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');
const { parseCode, extractFunctions } = require('../../services/ast/parser');

class PerformanceOptimizationSkill extends Skill {
  constructor() {
    super(
      'performance-optimization',
      '性能优化技能 - 性能瓶颈识别和优化建议',
      '1.0.0'
    );
    this.dependencies = ['ast-parser'];
  }

  async init() {
    logger.info('性能优化技能初始化完成');
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

    return this._analyzePerformance(code, filePath || 'unknown', language);
  }

  async analyzeLoops(sourceCode) {
    const issues = [];
    const patterns = [
      {
        name: '嵌套循环',
        pattern: /for\s*\([^)]+\)\s*\{[^}]*for\s*\(/g,
        description: '嵌套循环可能导致O(n^2)时间复杂度',
        severity: 'high',
        suggestion: '考虑使用哈希表或其他数据结构优化'
      },
      {
        name: '数组查找',
        pattern: /\.indexOf\s*\(|includes\s*\(|find\s*\(|filter\s*\(/g,
        description: '在循环内部使用数组查找可能导致性能问题',
        severity: 'medium',
        suggestion: '将数组转换为Set或Map以获得O(1)查找'
      },
      {
        name: '频繁DOM操作',
        pattern: /getElementById|querySelector|appendChild/g,
        description: '在循环中频繁操作DOM会严重影响性能',
        severity: 'high',
        suggestion: '使用DocumentFragment批量操作DOM'
      }
    ];

    for (const p of patterns) {
      let match;
      const regex = new RegExp(p.pattern, 'g');
      while ((match = regex.exec(sourceCode)) !== null) {
        const lineNum = sourceCode.substring(0, match.index).split('\n').length;
        issues.push({
          type: 'loop_performance',
          name: p.name,
          line: lineNum,
          severity: p.severity,
          description: p.description,
          suggestion: p.suggestion
        });
      }
    }

    return issues;
  }

  async analyzeMemoryIssues(sourceCode) {
    const issues = [];
    const patterns = [
      {
        name: '全局变量',
        pattern: /^(var\s+|let\s+|const\s+)(?!function|class)/gm,
        description: '全局变量会增加内存占用并可能导致内存泄漏',
        severity: 'medium',
        suggestion: '尽可能使用局部变量，避免全局变量'
      },
      {
        name: '内存泄漏风险',
        pattern: /addEventListener|setInterval|setTimeout/g,
        description: '事件监听器和定时器如果未正确清理可能导致内存泄漏',
        severity: 'high',
        suggestion: '在组件卸载时移除监听器和清除定时器'
      },
      {
        name: '大数组操作',
        pattern: /\.concat\s*\(|Array\.from\s*\(|slice\s*\(|splice\s*\(/g,
        description: '频繁的数组操作会产生大量临时对象',
        severity: 'medium',
        suggestion: '考虑使用更高效的数据结构或批量处理'
      }
    ];

    for (const p of patterns) {
      let match;
      const regex = new RegExp(p.pattern, 'g');
      while ((match = regex.exec(sourceCode)) !== null) {
        const lineNum = sourceCode.substring(0, match.index).split('\n').length;
        issues.push({
          type: 'memory',
          name: p.name,
          line: lineNum,
          severity: p.severity,
          description: p.description,
          suggestion: p.suggestion
        });
      }
    }

    return issues;
  }

  async analyzeInefficientCode(sourceCode) {
    const issues = [];
    const patterns = [
      {
        name: '重复计算',
        pattern: /(\w+)\s*=\s*(.+?);[\s\S]*?\1\s*=\s*\2/g,
        description: '检测到重复计算相同表达式',
        severity: 'medium',
        suggestion: '将重复计算的结果缓存到变量中'
      },
      {
        name: '字符串拼接',
        pattern: /(\w+)\s*[\+=]\s*['"][^'"]*['"]/g,
        description: '频繁的字符串拼接效率较低',
        severity: 'medium',
        suggestion: '使用数组或模板字符串替代字符串拼接'
      },
      {
        name: '不必要的类型转换',
        pattern: /Number\s*\(|\.toString\(\)|parseInt\s*\(|parseFloat\s*\(/g,
        description: '检测到可能不必要的类型转换',
        severity: 'low',
        suggestion: '检查是否真的需要类型转换'
      }
    ];

    for (const p of patterns) {
      let match;
      const regex = new RegExp(p.pattern, 'g');
      while ((match = regex.exec(sourceCode)) !== null) {
        const lineNum = sourceCode.substring(0, match.index).split('\n').length;
        issues.push({
          type: 'inefficient',
          name: p.name,
          line: lineNum,
          severity: p.severity,
          description: p.description,
          suggestion: p.suggestion
        });
      }
    }

    return issues;
  }

  async _analyzePerformance(sourceCode, filePath, language) {
    const startTime = Date.now();

    try {
      const loopIssues = await this.analyzeLoops(sourceCode);
      const memoryIssues = await this.analyzeMemoryIssues(sourceCode);
      const inefficientIssues = await this.analyzeInefficientCode(sourceCode);

      const allIssues = [...loopIssues, ...memoryIssues, ...inefficientIssues];
      
      const severityCounts = {
        critical: allIssues.filter(i => i.severity === 'critical').length,
        high: allIssues.filter(i => i.severity === 'high').length,
        medium: allIssues.filter(i => i.severity === 'medium').length,
        low: allIssues.filter(i => i.severity === 'low').length
      };

      return {
        success: true,
        filePath,
        language,
        totalIssues: allIssues.length,
        severityCounts,
        issues: allIssues,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`性能分析失败: ${filePath}`, error);
      return {
        success: false,
        message: error.message,
        filePath,
        durationMs: Date.now() - startTime
      };
    }
  }
}

const performanceOptimizationSkill = new PerformanceOptimizationSkill();

module.exports = performanceOptimizationSkill;
