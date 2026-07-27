/**
 * 代码重构技能
 * 提供代码重构建议和自动重构功能
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');
const { parseCode, extractFunctions } = require('../../services/ast/parser');

class CodeRefactoringSkill extends Skill {
  constructor() {
    super(
      'code-refactoring',
      '代码重构技能 - 提供重构建议和自动重构',
      '1.0.0'
    );
    this.dependencies = ['ast-parser', 'code-detection'];
  }

  async init() {
    logger.info('代码重构技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && (context.sourceCode || context.filePath);
  }

  async execute(context = {}) {
    const { sourceCode, filePath, refactorType, options = {} } = context;

    if (!sourceCode && !filePath) {
      throw new Error('请提供源代码或文件路径');
    }

    const fs = require('fs');
    const code = sourceCode || fs.readFileSync(filePath, 'utf-8');
    const language = options.language || getFileLanguage(filePath || '');

    if (refactorType) {
      return this._applyRefactoring(code, language, refactorType, options);
    }

    return this._analyzeAndSuggest(code, filePath || 'unknown', language);
  }

  async suggestRefactoring(sourceCode, language = 'javascript') {
    return this._analyzeAndSuggest(sourceCode, 'unknown', language);
  }

  async applyExtractMethod(sourceCode, language = 'javascript', options = {}) {
    return this._applyRefactoring(sourceCode, language, 'extract_method', options);
  }

  async applyInlineMethod(sourceCode, language = 'javascript', options = {}) {
    return this._applyRefactoring(sourceCode, language, 'inline_method', options);
  }

  async applyRenameVariable(sourceCode, language = 'javascript', options = {}) {
    return this._applyRefactoring(sourceCode, language, 'rename_variable', options);
  }

  async applyExtractClass(sourceCode, language = 'javascript', options = {}) {
    return this._applyRefactoring(sourceCode, language, 'extract_class', options);
  }

  async applySimplifyConditional(sourceCode, language = 'javascript', options = {}) {
    return this._applyRefactoring(sourceCode, language, 'simplify_conditional', options);
  }

  async _analyzeAndSuggest(sourceCode, filePath, language) {
    const startTime = Date.now();

    try {
      const suggestions = [];
      
      // 分析代码复杂度
      const complexityAnalysis = require('./code-analysis/complexityAnalysis');
      const complexityResult = await complexityAnalysis.execute({ sourceCode, language });
      
      if (complexityResult.success) {
        const cyclomatic = complexityResult.cyclomaticComplexity;
        if (cyclomatic.maxComplexity > 10) {
          suggestions.push({
            type: 'extract_method',
            severity: 'high',
            title: '提取方法',
            description: `检测到高复杂度函数（圈复杂度: ${cyclomatic.maxComplexity}），建议拆分为多个小函数`,
            targets: cyclomatic.functions.filter(f => f.cyclomaticComplexity > 10)
          });
        }
      }

      // 检测代码问题
      const codeDetection = require('./code-detection');
      const detectionResult = await codeDetection.execute({ sourceCode, language });
      
      if (detectionResult.success && detectionResult.issues) {
        const longFunctions = detectionResult.issues.filter(i => i.issueType === 'long_function');
        if (longFunctions.length > 0) {
          suggestions.push({
            type: 'extract_method',
            severity: 'medium',
            title: '拆分长函数',
            description: `检测到 ${longFunctions.length} 个过长函数，建议拆分为多个职责单一的函数`,
            targets: longFunctions
          });
        }

        const deepNesting = detectionResult.issues.filter(i => i.issueType === 'deep_nesting');
        if (deepNesting.length > 0) {
          suggestions.push({
            type: 'simplify_conditional',
            severity: 'medium',
            title: '简化条件嵌套',
            description: `检测到 ${deepNesting.length} 处深层嵌套，建议提取或简化`,
            targets: deepNesting
          });
        }

        const duplicateCode = detectionResult.issues.filter(i => i.issueType === 'duplicate_code');
        if (duplicateCode.length > 0) {
          suggestions.push({
            type: 'extract_method',
            severity: 'high',
            title: '消除重复代码',
            description: `检测到 ${duplicateCode.length} 处重复代码，建议提取为共用函数`,
            targets: duplicateCode
          });
        }
      }

      // 分析代码结构
      const parseResult = await parseCode(sourceCode, language);
      if (parseResult.success) {
        const tree = parseResult.tree;
        const functions = extractFunctions(tree, sourceCode);
        
        // 查找可以内联的简单函数
        const simpleFunctions = functions.filter(f => {
          const lines = f.code?.split('\n') || [];
          return lines.length <= 3 && !f.params?.length;
        });
        
        if (simpleFunctions.length > 0) {
          suggestions.push({
            type: 'inline_method',
            severity: 'low',
            title: '内联简单函数',
            description: `检测到 ${simpleFunctions.length} 个简单函数可以内联，提高代码可读性`,
            targets: simpleFunctions
          });
        }
      }

      return {
        success: true,
        filePath,
        language,
        totalSuggestions: suggestions.length,
        suggestions: suggestions.sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        }),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`重构分析失败: ${filePath}`, error);
      return {
        success: false,
        message: error.message,
        filePath,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _applyRefactoring(sourceCode, language, refactorType, options) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = this._buildRefactoringPrompt(sourceCode, language, refactorType, options);
      const response = await llmProvider.complete(prompt, {
        maxTokens: 4000,
        temperature: 0.5
      });

      const refactoredCode = this._extractCode(response.content);

      return {
        success: true,
        refactorType,
        originalCode: sourceCode,
        refactoredCode,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`重构失败: ${refactorType}`, error);
      return {
        success: false,
        message: error.message,
        refactorType,
        durationMs: Date.now() - startTime
      };
    }
  }

  _buildRefactoringPrompt(sourceCode, language, refactorType, options) {
    const refactorDescriptions = {
      extract_method: '将复杂函数拆分为多个小函数',
      inline_method: '将简单函数内联到调用处',
      rename_variable: '重命名变量为更有意义的名称',
      extract_class: '将相关功能提取为独立类',
      simplify_conditional: '简化复杂的条件逻辑'
    };

    return `你是一个专业的${language}代码重构专家。请对以下代码进行重构：

重构类型：${refactorDescriptions[refactorType] || refactorType}

${options.target ? `目标：${JSON.stringify(options.target)}` : ''}

原始代码：
\`\`\`${language}
${sourceCode}
\`\`\`

重构要求：
- 保持功能不变
- 提高代码可读性
- 遵循最佳实践
- 添加必要的注释

请输出重构后的完整代码。`;
  }

  _extractCode(text) {
    const codeBlocks = text.match(/```(\w+)?\n([\s\S]*?)```/g);
    if (codeBlocks && codeBlocks.length > 0) {
      return codeBlocks[0].replace(/```(\w+)?\n/, '').replace(/```$/, '');
    }
    return text;
  }
}

const codeRefactoringSkill = new CodeRefactoringSkill();

module.exports = codeRefactoringSkill;
