/**
 * 代码调试技能
 * 提供代码调试、错误分析和修复建议
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');

class CodeDebuggingSkill extends Skill {
  constructor() {
    super(
      'code-debugging',
      '代码调试技能 - 错误分析和修复建议',
      '1.0.0'
    );
    this.dependencies = ['llm-provider'];
  }

  async init() {
    logger.info('代码调试技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && (context.sourceCode || context.error || context.issue);
  }

  async execute(context = {}) {
    const { sourceCode, filePath, error, issue, options = {} } = context;

    if (!sourceCode && !error && !issue) {
      throw new Error('请提供源代码、错误信息或问题描述');
    }

    const fs = require('fs');
    const code = sourceCode || (filePath ? fs.readFileSync(filePath, 'utf-8') : '');
    const language = options.language || getFileLanguage(filePath || '');

    if (error) {
      return this._analyzeError(error, code, language);
    }

    if (issue) {
      return this._analyzeIssue(issue, code, language);
    }

    return this._detectPotentialBugs(code, language);
  }

  async analyzeError(error, sourceCode, language = 'javascript') {
    return this._analyzeError(error, sourceCode, language);
  }

  async analyzeIssue(issue, sourceCode, language = 'javascript') {
    return this._analyzeIssue(issue, sourceCode, language);
  }

  async detectPotentialBugs(sourceCode, language = 'javascript') {
    return this._detectPotentialBugs(sourceCode, language);
  }

  async _analyzeError(error, sourceCode, language) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `你是一个专业的${language}调试专家。请分析以下错误并提供修复方案：

错误信息：
${error.message || error}
${error.stack || ''}

相关代码：
\`\`\`${language}
${sourceCode}
\`\`\`

请分析：
1. 错误原因
2. 修复方案
3. 修复后的代码

请输出详细的分析和修复建议。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 4000,
        temperature: 0.3
      });

      return {
        success: true,
        error,
        analysis: response.content,
        durationMs: Date.now() - startTime
      };
    } catch (analysisError) {
      logger.error('错误分析失败', analysisError);
      return {
        success: false,
        message: analysisError.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _analyzeIssue(issue, sourceCode, language) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `你是一个专业的${language}调试专家。请分析以下问题并提供解决方案：

问题描述：
${issue}

相关代码：
\`\`\`${language}
${sourceCode}
\`\`\`

请分析：
1. 问题根因
2. 解决方案
3. 改进后的代码

请输出详细的分析和建议。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 4000,
        temperature: 0.3
      });

      return {
        success: true,
        issue,
        analysis: response.content,
        durationMs: Date.now() - startTime
      };
    } catch (analysisError) {
      logger.error('问题分析失败', analysisError);
      return {
        success: false,
        message: analysisError.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _detectPotentialBugs(sourceCode, language) {
    const startTime = Date.now();

    try {
      // 使用代码检测技能查找潜在问题
      const codeDetection = require('./code-detection');
      const detectionResult = await codeDetection.execute({ sourceCode, language });

      // 使用安全检测技能查找安全问题
      const securityDetection = require('./code-analysis/securityDetection');
      const securityResult = await securityDetection.execute({ sourceCode, language });

      // 使用复杂度分析技能查找复杂度问题
      const complexityAnalysis = require('./code-analysis/complexityAnalysis');
      const complexityResult = await complexityAnalysis.execute({ sourceCode, language });

      const potentialBugs = [];

      if (detectionResult.success && detectionResult.issues) {
        potentialBugs.push(...detectionResult.issues.map(issue => ({
          type: 'code_issue',
          ...issue
        })));
      }

      if (securityResult.success && securityResult.issues) {
        potentialBugs.push(...securityResult.issues.map(issue => ({
          type: 'security_issue',
          ...issue
        })));
      }

      if (complexityResult.success) {
        const cyclomatic = complexityResult.cyclomaticComplexity;
        if (cyclomatic.overallStatus.level === 'critical') {
          potentialBugs.push({
            type: 'complexity_issue',
            severity: 'critical',
            title: '代码复杂度极高',
            description: '高复杂度代码更容易出现bug，建议重构',
            functions: cyclomatic.functions.filter(f => f.status.level === 'critical')
          });
        }
      }

      return {
        success: true,
        totalBugs: potentialBugs.length,
        potentialBugs: potentialBugs.sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        }),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('潜在bug检测失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }
}

const codeDebuggingSkill = new CodeDebuggingSkill();

module.exports = codeDebuggingSkill;
