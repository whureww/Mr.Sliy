/**
 * 文档生成技能
 * 自动生成代码文档和技术文档
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');
const { parseCode, extractFunctions } = require('../../services/ast/parser');

class DocumentationSkill extends Skill {
  constructor() {
    super(
      'documentation',
      '文档生成技能 - 自动生成代码文档和技术文档',
      '1.0.0'
    );
    this.dependencies = ['ast-parser'];
  }

  async init() {
    logger.info('文档生成技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && (context.sourceCode || context.filePath || context.project);
  }

  async execute(context = {}) {
    const { sourceCode, filePath, project, docType = 'code', options = {} } = context;

    if (!sourceCode && !filePath && !project) {
      throw new Error('请提供源代码、文件路径或项目信息');
    }

    const fs = require('fs');
    const code = sourceCode || (filePath ? fs.readFileSync(filePath, 'utf-8') : '');
    const language = options.language || getFileLanguage(filePath || '');

    switch (docType) {
      case 'code':
        return this._generateCodeDocs(code, filePath || 'unknown', language);
      case 'api':
        return this._generateAPIDocs(code, filePath || 'unknown', language);
      case 'readme':
        return this._generateReadme(project || code, language);
      case 'changelog':
        return this._generateChangelog(options.changes || []);
      case 'architecture':
        return this._generateArchitectureDocs(project || code, language);
      default:
        return this._generateCodeDocs(code, filePath || 'unknown', language);
    }
  }

  async generateCodeDocs(sourceCode, language = 'javascript') {
    return this._generateCodeDocs(sourceCode, 'unknown', language);
  }

  async generateAPIDocs(sourceCode, language = 'javascript') {
    return this._generateAPIDocs(sourceCode, 'unknown', language);
  }

  async generateReadme(projectInfo, language = 'javascript') {
    return this._generateReadme(projectInfo, language);
  }

  async _generateCodeDocs(sourceCode, filePath, language) {
    const startTime = Date.now();

    try {
      const docs = [];
      const parseResult = await parseCode(sourceCode, language);
      
      if (parseResult.success) {
        const tree = parseResult.tree;
        const functions = extractFunctions(tree, sourceCode);

        for (const func of functions) {
          const doc = await this._generateFunctionDoc(func, language);
          docs.push(doc);
        }
      }

      return {
        success: true,
        filePath,
        language,
        totalFunctions: docs.length,
        docs,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`代码文档生成失败: ${filePath}`, error);
      return {
        success: false,
        message: error.message,
        filePath,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateAPIDocs(sourceCode, filePath, language) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `你是一个专业的API文档专家。请为以下代码生成API文档：

语言：${language}

代码：
\`\`\`${language}
${sourceCode}
\`\`\`

请输出：
1. API端点列表
2. 请求方法和路径
3. 请求参数
4. 响应格式
5. 错误码

使用OpenAPI格式输出。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 4000,
        temperature: 0.3
      });

      return {
        success: true,
        filePath,
        apiDocs: response.content,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`API文档生成失败: ${filePath}`, error);
      return {
        success: false,
        message: error.message,
        filePath,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateReadme(projectInfo, language) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `你是一个专业的技术文档专家。请为以下项目生成README文档：

项目信息：
${typeof projectInfo === 'object' ? JSON.stringify(projectInfo, null, 2) : projectInfo}

语言：${language}

请输出完整的README文档，包含：
1. 项目简介
2. 功能特性
3. 快速开始
4. 安装步骤
5. 使用方法
6. API文档
7. 贡献指南
8. 许可证`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 4000,
        temperature: 0.5
      });

      return {
        success: true,
        readme: response.content,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('README生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateChangelog(changes) {
    const startTime = Date.now();

    try {
      let changelog = '# 更新日志\n\n';
      
      const groupedChanges = {
        '✨ 新功能': changes.filter(c => c.type === 'feature'),
        '🔧 优化': changes.filter(c => c.type === 'optimization'),
        '🐛 修复': changes.filter(c => c.type === 'bugfix'),
        '📝 文档': changes.filter(c => c.type === 'documentation'),
        '🚨 安全': changes.filter(c => c.type === 'security')
      };

      for (const [category, items] of Object.entries(groupedChanges)) {
        if (items.length > 0) {
          changelog += `## ${category}\n\n`;
          items.forEach(item => {
            changelog += `- ${item.description}\n`;
          });
          changelog += '\n';
        }
      }

      return {
        success: true,
        changelog,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('更新日志生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateArchitectureDocs(projectInfo, language) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `你是一个专业的架构师。请为以下项目生成架构文档：

项目信息：
${typeof projectInfo === 'object' ? JSON.stringify(projectInfo, null, 2) : projectInfo}

语言：${language}

请输出：
1. 系统架构图描述
2. 模块划分
3. 数据流
4. 技术选型
5. 部署方案`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 4000,
        temperature: 0.5
      });

      return {
        success: true,
        architectureDocs: response.content,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('架构文档生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateFunctionDoc(func, language) {
    const llmProvider = require('../../services/llm/providers').getCurrentProvider();
    
    const prompt = `为以下${language}函数生成JSDoc注释：

函数：
${func.code}

请输出完整的JSDoc注释。`;

    const response = await llmProvider.complete(prompt, {
      maxTokens: 500,
      temperature: 0.3
    });

    return {
      name: func.name,
      startLine: func.startLine,
      endLine: func.endLine,
      jsdoc: response.content
    };
  }
}

const documentationSkill = new DocumentationSkill();

module.exports = documentationSkill;
