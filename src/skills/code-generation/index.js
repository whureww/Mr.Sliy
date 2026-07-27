/**
 * 代码生成技能
 * 基于需求描述生成高质量代码
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');

class CodeGenerationSkill extends Skill {
  constructor() {
    super(
      'code-generation',
      '代码生成技能 - 基于需求描述生成高质量代码',
      '1.0.0'
    );
    this.dependencies = ['llm-provider'];
  }

  async init() {
    logger.info('代码生成技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && context.requirement;
  }

  async execute(context = {}) {
    const { requirement, language = 'javascript', framework = '', options = {} } = context;

    if (!requirement) {
      throw new Error('请提供需求描述');
    }

    return this._generateCode(requirement, language, framework, options);
  }

  async generateFromRequirement(requirement, options = {}) {
    const { language = 'javascript', framework = '', test = true } = options;
    return this.execute({ requirement, language, framework, options: { test } });
  }

  async generateUnitTest(code, options = {}) {
    const { language = 'javascript', framework = 'jest' } = options;
    return this._generateTest(code, language, framework);
  }

  async generateMockData(schema, count = 10) {
    return this._generateMockData(schema, count);
  }

  async _generateCode(requirement, language, framework, options) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = this._buildGenerationPrompt(requirement, language, framework, options);
      const response = await llmProvider.complete(prompt, {
        model: options.model || 'gpt-4',
        maxTokens: options.maxTokens || 4000,
        temperature: options.temperature || 0.7
      });

      const code = this._extractCode(response.content);
      const analysis = await this._analyzeGeneratedCode(code, language);

      return {
        success: true,
        requirement,
        language,
        framework,
        generatedCode: code,
        rawResponse: response.content,
        analysis,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('代码生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateTest(code, language, framework) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `为以下代码生成单元测试，使用${framework}框架：

代码：
\`\`\`${language}
${code}
\`\`\`

请输出完整的测试代码。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 2000,
        temperature: 0.5
      });

      return {
        success: true,
        testCode: this._extractCode(response.content),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('测试代码生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateMockData(schema, count) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `根据以下数据结构生成${count}条模拟数据：

数据结构：
${JSON.stringify(schema, null, 2)}

请输出JSON格式的模拟数据。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 2000,
        temperature: 0.8
      });

      return {
        success: true,
        mockData: this._extractJson(response.content),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('模拟数据生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  _buildGenerationPrompt(requirement, language, framework, options) {
    return `你是一个专业的${language}开发工程师。请根据以下需求生成高质量的代码：

需求描述：
${requirement}

技术栈：
- 语言：${language}
- 框架：${framework || '无'}

代码要求：
${options.test ? '- 包含完整的单元测试\n' : ''}${options.comments ? '- 添加详细注释\n' : ''}${options.optimized ? '- 性能优化\n' : ''}- 遵循最佳实践
- 代码清晰可读
- 错误处理完善
- 模块化设计

请输出完整的代码实现。`;
  }

  _extractCode(text) {
    const codeBlocks = text.match(/```(\w+)?\n([\s\S]*?)```/g);
    if (codeBlocks && codeBlocks.length > 0) {
      return codeBlocks[0].replace(/```(\w+)?\n/, '').replace(/```$/, '');
    }
    return text;
  }

  _extractJson(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async _analyzeGeneratedCode(code, language) {
    const codeAnalysis = require('./code-analysis');
    const codeDetection = require('./code-detection');

    try {
      const analysis = await codeAnalysis.execute({ sourceCode: code, language });
      const detection = await codeDetection.execute({ sourceCode: code, language });

      return {
        metrics: analysis.metrics || {},
        issues: detection.issues || []
      };
    } catch {
      return { metrics: {}, issues: [] };
    }
  }
}

const codeGenerationSkill = new CodeGenerationSkill();

module.exports = codeGenerationSkill;
