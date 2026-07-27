/**
 * 数据库开发技能
 * 提供数据库设计、SQL生成和数据库操作功能
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');

class DatabaseSkill extends Skill {
  constructor() {
    super(
      'database',
      '数据库开发技能 - 数据库设计、SQL生成和数据库操作',
      '1.0.0'
    );
    this.dependencies = ['llm-provider'];
  }

  async init() {
    logger.info('数据库开发技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && (context.schema || context.query || context.operation);
  }

  async execute(context = {}) {
    const { schema, query, operation, options = {} } = context;

    if (!schema && !query && !operation) {
      throw new Error('请提供数据模型、查询需求或操作类型');
    }

    if (operation) {
      return this._executeOperation(operation, context);
    }

    if (query) {
      return this._generateQuery(query, schema, options);
    }

    return this._generateSchema(schema, options);
  }

  async generateSchema(dataModel, options = {}) {
    return this._generateSchema(dataModel, options);
  }

  async generateQuery(query, schema, options = {}) {
    return this._generateQuery(query, schema, options);
  }

  async generateMigration(oldSchema, newSchema, options = {}) {
    return this._generateMigration(oldSchema, newSchema, options);
  }

  async generateERDiagram(schema, options = {}) {
    return this._generateERDiagram(schema, options);
  }

  async _generateSchema(dataModel, options) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      const databaseType = options.database || 'mysql';
      
      const prompt = `你是一个专业的${databaseType}数据库设计专家。请根据以下数据模型生成${databaseType}建表语句：

数据模型：
${typeof dataModel === 'object' ? JSON.stringify(dataModel, null, 2) : dataModel}

要求：
- 合理的字段类型和约束
- 添加必要的索引
- 考虑数据关系
- 输出完整的CREATE TABLE语句

请输出建表SQL语句。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 3000,
        temperature: 0.3
      });

      return {
        success: true,
        database: databaseType,
        schemaSQL: this._extractSQL(response.content),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('数据库表结构生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateQuery(query, schema, options) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      const databaseType = options.database || 'mysql';
      
      const prompt = `你是一个专业的${databaseType}数据库专家。请根据以下需求和表结构生成${databaseType}查询语句：

查询需求：
${query}

表结构：
${typeof schema === 'object' ? JSON.stringify(schema, null, 2) : schema}

要求：
- 使用参数化查询
- 考虑性能优化
- 添加必要的索引提示

请输出SQL查询语句。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 2000,
        temperature: 0.3
      });

      return {
        success: true,
        database: databaseType,
        querySQL: this._extractSQL(response.content),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('SQL查询生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateMigration(oldSchema, newSchema, options) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      const databaseType = options.database || 'mysql';
      
      const prompt = `你是一个专业的${databaseType}数据库迁移专家。请根据以下表结构变化生成迁移SQL：

旧表结构：
${typeof oldSchema === 'object' ? JSON.stringify(oldSchema, null, 2) : oldSchema}

新表结构：
${typeof newSchema === 'object' ? JSON.stringify(newSchema, null, 2) : newSchema}

要求：
- 生成ALTER TABLE语句
- 确保数据安全
- 添加必要的索引变更

请输出迁移SQL语句。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 2000,
        temperature: 0.3
      });

      return {
        success: true,
        database: databaseType,
        migrationSQL: this._extractSQL(response.content),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('数据库迁移生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _generateERDiagram(schema, options) {
    const startTime = Date.now();

    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `你是一个专业的数据库设计专家。请根据以下表结构生成Mermaid ER图：

表结构：
${typeof schema === 'object' ? JSON.stringify(schema, null, 2) : schema}

请输出Mermaid格式的ER图。`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 2000,
        temperature: 0.5
      });

      return {
        success: true,
        erDiagram: response.content,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('ER图生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _executeOperation(operation, context) {
    const { connection, sql, params = [] } = context;

    try {
      const dbAdapter = require('../../utils/dbAdapter');
      
      if (!connection) {
        return {
          success: false,
          message: '请提供数据库连接'
        };
      }

      const result = await dbAdapter.execute(sql, params);
      
      return {
        success: true,
        operation,
        result,
        affectedRows: result.affectedRows || 0
      };
    } catch (error) {
      logger.error(`数据库操作失败: ${operation}`, error);
      return {
        success: false,
        message: error.message,
        operation
      };
    }
  }

  _extractSQL(text) {
    const sqlBlocks = text.match(/```sql\n([\s\S]*?)```/g);
    if (sqlBlocks && sqlBlocks.length > 0) {
      return sqlBlocks[0].replace(/```sql\n/, '').replace(/```$/, '');
    }
    return text;
  }
}

const databaseSkill = new DatabaseSkill();

module.exports = databaseSkill;
