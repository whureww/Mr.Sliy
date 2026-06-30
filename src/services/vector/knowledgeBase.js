/**
 * 本地向量知识库模块
 * 基于SQLite的离线RAG知识库
 * 存储代码优化案例、最佳实践、编码规范等知识
 * 支持通过云端 API 访问共享知识库
 */

const { getDatabase } = require('../../utils/database');
const { logger } = require('../../utils/logger');
const { generateUUID } = require('../../utils/helpers');

/**
 * 简化的文本向量化（基于TF-IDF思想）
 * 实际项目中可替换为Embedding模型（如sentence-transformers）
 */
class SimpleEmbedding {
  constructor() {
    this.vocabulary = new Set();
  }

  /**
   * 分词
   */
  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  /**
   * 计算文本向量
   */
  embed(text) {
    const tokens = this.tokenize(text);
    const vector = {};
    const tf = {};

    // 计算词频
    tokens.forEach(token => {
      tf[token] = (tf[token] || 0) + 1;
    });

    // 归一化
    const totalTokens = tokens.length;
    Object.keys(tf).forEach(token => {
      vector[token] = tf[token] / totalTokens;
    });

    return vector;
  }

  /**
   * 计算余弦相似度
   */
  cosineSimilarity(vec1, vec2) {
    const keys1 = Object.keys(vec1);
    const keys2 = Object.keys(vec2);
    const allKeys = new Set([...keys1, ...keys2]);

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    allKeys.forEach(key => {
      const v1 = vec1[key] || 0;
      const v2 = vec2[key] || 0;
      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    });

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }
}

const embedder = new SimpleEmbedding();

/**
 * 本地知识库管理器
 */
class LocalKnowledgeBase {
  constructor() {
    this.initialized = false;
  }

  /**
   * 初始化知识库表
   */
  init() {
    if (this.initialized) return;

    const db = getDatabase();
    
    // 知识条目表
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL,
        language TEXT,
        tags TEXT,
        source TEXT,
        vector_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 知识库元数据表
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 优化案例表
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_cases (
        id TEXT PRIMARY KEY,
        original_code TEXT NOT NULL,
        optimized_code TEXT NOT NULL,
        explanation TEXT,
        language TEXT,
        issue_type TEXT,
        vector_json TEXT,
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 数据库迁移：为旧版本添加缺失的列
    try {
      db.exec('ALTER TABLE kb_entries ADD COLUMN IF NOT EXISTS vector_json TEXT');
      db.exec('ALTER TABLE kb_entries ADD COLUMN IF NOT EXISTS source TEXT');
      db.exec('ALTER TABLE kb_cases ADD COLUMN IF NOT EXISTS issue_type TEXT');
      db.exec('ALTER TABLE kb_cases ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0');
      db.exec('ALTER TABLE kb_cases ADD COLUMN IF NOT EXISTS rating REAL DEFAULT 0');
      db.exec('ALTER TABLE kb_cases ADD COLUMN IF NOT EXISTS vector_json TEXT');
    } catch (e) {
      logger.debug('数据库迁移失败，可能是旧版本SQLite不支持: ' + e.message);
    }

    // 创建索引
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_entries_type ON kb_entries(content_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_entries_lang ON kb_entries(language)');
    
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_kb_cases_type ON kb_cases(issue_type)');
    } catch (e) {
      logger.debug('创建索引 idx_kb_cases_type 失败，可能表结构不同: ' + e.message);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_cases_lang ON kb_cases(language)');

    this.initialized = true;
    logger.debug('本地知识库初始化完成');
  }

  /**
   * 添加知识条目
   */
  addEntry(content, options = {}) {
    this.init();
    const db = getDatabase();

    const id = generateUUID();
    const vector = embedder.embed(content);

    const stmt = db.prepare(`
      INSERT INTO kb_entries (id, content, content_type, language, tags, source, vector_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      content,
      options.type || 'general',
      options.language || null,
      options.tags ? JSON.stringify(options.tags) : null,
      options.source || null,
      JSON.stringify(vector)
    );

    logger.debug(`添加知识条目: ${id}`);
    return id;
  }

  /**
   * 添加优化案例
   */
  addCase(originalCode, optimizedCode, explanation, options = {}) {
    this.init();
    const db = getDatabase();

    const id = generateUUID();
    const combinedText = `${originalCode} ${optimizedCode} ${explanation}`;
    const vector = embedder.embed(combinedText);

    const stmt = db.prepare(`
      INSERT INTO kb_cases (id, original_code, optimized_code, explanation, language, issue_type, vector_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      originalCode,
      optimizedCode,
      explanation,
      options.language || null,
      options.issueType || null,
      JSON.stringify(vector)
    );

    logger.debug(`添加优化案例: ${id}`);
    return id;
  }

  /**
   * 检索相似知识条目
   */
  searchEntries(query, options = {}) {
    this.init();
    const db = getDatabase();
    const queryVector = embedder.embed(query);
    const topK = options.topK || 5;
    const type = options.type;
    const language = options.language;

    let sql = 'SELECT id, content, content_type, language, tags, source, vector_json FROM kb_entries';
    const conditions = [];
    const params = [];

    if (type) {
      conditions.push('content_type = ?');
      params.push(type);
    }
    if (language) {
      conditions.push('language = ?');
      params.push(language);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const stmt = db.prepare(sql);
    const entries = stmt.all(...params);

    // 计算相似度并排序
    const results = entries.map(entry => {
      const entryVector = JSON.parse(entry.vector_json || '{}');
      const similarity = embedder.cosineSimilarity(queryVector, entryVector);
      return {
        id: entry.id,
        content: entry.content,
        type: entry.content_type,
        language: entry.language,
        tags: entry.tags ? JSON.parse(entry.tags) : [],
        source: entry.source,
        similarity
      };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * 检索相似优化案例
   */
  searchCases(query, options = {}) {
    this.init();
    const db = getDatabase();
    const queryVector = embedder.embed(query);
    const topK = options.topK || 3;
    const language = options.language;
    const issueType = options.issueType;

    let sql = 'SELECT id, original_code, optimized_code, explanation, language, issue_type, vector_json, usage_count, rating FROM kb_cases';
    const conditions = [];
    const params = [];

    if (language) {
      conditions.push('language = ?');
      params.push(language);
    }
    if (issueType) {
      conditions.push('issue_type = ?');
      params.push(issueType);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const stmt = db.prepare(sql);
    const cases = stmt.all(...params);

    const results = cases.map(c => {
      const caseVector = JSON.parse(c.vector_json || '{}');
      const similarity = embedder.cosineSimilarity(queryVector, caseVector);
      return {
        id: c.id,
        originalCode: c.original_code,
        optimizedCode: c.optimized_code,
        explanation: c.explanation,
        language: c.language,
        issueType: c.issue_type,
        usageCount: c.usage_count,
        rating: c.rating,
        similarity
      };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * 根据代码片段检索相似案例（用于离线优化）
   */
  findSimilarCases(codeSnippet, options = {}) {
    return this.searchCases(codeSnippet, options);
  }

  /**
   * 获取知识库统计
   */
  getStats() {
    this.init();
    const db = getDatabase();

    const entryCount = db.prepare('SELECT COUNT(*) as count FROM kb_entries').get().count;
    const caseCount = db.prepare('SELECT COUNT(*) as count FROM kb_cases').get().count;

    const typeStats = db.prepare(`
      SELECT content_type, COUNT(*) as count FROM kb_entries GROUP BY content_type
    `).all();

    const languageStats = db.prepare(`
      SELECT language, COUNT(*) as count FROM kb_entries WHERE language IS NOT NULL GROUP BY language
    `).all();

    return {
      totalEntries: entryCount,
      totalCases: caseCount,
      typeStats,
      languageStats
    };
  }

  /**
   * 导出知识库为JSON
   */
  exportToJSON(options = {}) {
    this.init();
    const db = getDatabase();
    
    const entries = db.prepare('SELECT * FROM kb_entries').all();
    const cases = db.prepare('SELECT * FROM kb_cases').all();
    
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      entries: entries.map(e => ({
        id: e.id,
        content: e.content,
        content_type: e.content_type,
        language: e.language,
        tags: e.tags ? JSON.parse(e.tags) : [],
        source: e.source,
        created_at: e.created_at
      })),
      cases: cases.map(c => ({
        id: c.id,
        original_code: c.original_code,
        optimized_code: c.optimized_code,
        explanation: c.explanation,
        language: c.language,
        issue_type: c.issue_type,
        usage_count: c.usage_count,
        rating: c.rating,
        created_at: c.created_at
      })),
      stats: {
        entryCount: entries.length,
        caseCount: cases.length
      }
    };
    
    if (options.includeVectors) {
      exportData.entries.forEach((e, i) => {
        e.vector_json = entries[i].vector_json;
      });
      exportData.cases.forEach((c, i) => {
        c.vector_json = cases[i].vector_json;
      });
    }
    
    return exportData;
  }

  /**
   * 从JSON导入知识库
   */
  importFromJSON(data, options = {}) {
    this.init();
    const db = getDatabase();
    const { merge = true, skipExisting = true } = options;
    
    if (!merge) {
      db.prepare('DELETE FROM kb_entries').run();
      db.prepare('DELETE FROM kb_cases').run();
    }
    
    let importedEntries = 0;
    let importedCases = 0;
    let skippedEntries = 0;
    let skippedCases = 0;
    
    const insertEntry = db.prepare(`
      INSERT INTO kb_entries (id, content, content_type, language, tags, source, vector_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertCase = db.prepare(`
      INSERT INTO kb_cases (id, original_code, optimized_code, explanation, language, issue_type, vector_json, usage_count, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const checkEntryExists = db.prepare('SELECT id FROM kb_entries WHERE id = ?');
    const checkCaseExists = db.prepare('SELECT id FROM kb_cases WHERE id = ?');
    
    const tx = db.transaction(() => {
      for (const entry of data.entries || []) {
        if (skipExisting && checkEntryExists.get(entry.id)) {
          skippedEntries++;
          continue;
        }
        
        const vector = entry.vector_json || JSON.stringify(embedder.embed(entry.content));
        insertEntry.run(
          entry.id,
          entry.content,
          entry.content_type || 'general',
          entry.language || null,
          entry.tags ? JSON.stringify(entry.tags) : null,
          entry.source || 'imported',
          vector
        );
        importedEntries++;
      }
      
      for (const caseItem of data.cases || []) {
        if (skipExisting && checkCaseExists.get(caseItem.id)) {
          skippedCases++;
          continue;
        }
        
        const combinedText = `${caseItem.original_code || ''} ${caseItem.optimized_code || ''} ${caseItem.explanation || ''}`;
        const vector = caseItem.vector_json || JSON.stringify(embedder.embed(combinedText));
        insertCase.run(
          caseItem.id,
          caseItem.original_code,
          caseItem.optimized_code,
          caseItem.explanation || null,
          caseItem.language || null,
          caseItem.issue_type || null,
          vector,
          caseItem.usage_count || 0,
          caseItem.rating || 0
        );
        importedCases++;
      }
    });
    
    tx();
    
    return {
      importedEntries,
      importedCases,
      skippedEntries,
      skippedCases,
      totalEntries: importedEntries + skippedEntries,
      totalCases: importedCases + skippedCases
    };
  }

  /**
   * 导出知识库到文件
   */
  exportToFile(filePath, options = {}) {
    const fs = require('fs');
    const path = require('path');
    
    const exportData = this.exportToJSON(options);
    const dir = path.dirname(filePath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf8');
    return exportData.stats;
  }

  /**
   * 从文件导入知识库
   */
  importFromFile(filePath, options = {}) {
    const fs = require('fs');
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return this.importFromJSON(data, options);
  }

  /**
   * 同步到云端MySQL
   */
  async syncToCloud() {
    let mysql;
    try {
      mysql = require('../../utils/mysql');
    } catch (e) {
      return { success: false, message: 'MySQL模块未找到' };
    }
    
    if (!mysql.isEnabled()) {
      return { success: false, message: 'MySQL未启用' };
    }
    
    try {
      await mysql.initDatabase();
      const data = this.exportToJSON({ includeVectors: false });
      let syncedEntries = 0;
      let syncedCases = 0;
      
      for (const entry of data.entries) {
        const existing = await mysql.query(
          'SELECT id FROM kb_entries WHERE id = ?',
          [entry.id]
        );
        
        if (existing.length > 0) {
          await mysql.execute(
            `UPDATE kb_entries SET content = ?, content_type = ?, language = ?, tags = ?, source = ? WHERE id = ?`,
            [
              entry.content,
              entry.content_type,
              entry.language,
              entry.tags ? JSON.stringify(entry.tags) : null,
              entry.source,
              entry.id
            ]
          );
        } else {
          await mysql.execute(
            `INSERT INTO kb_entries (id, content, content_type, language, tags, source) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.content,
              entry.content_type,
              entry.language,
              entry.tags ? JSON.stringify(entry.tags) : null,
              entry.source
            ]
          );
        }
        syncedEntries++;
      }
      
      for (const caseItem of data.cases) {
        const existing = await mysql.query(
          'SELECT id FROM kb_cases WHERE id = ?',
          [caseItem.id]
        );
        
        if (existing.length > 0) {
          await mysql.execute(
            `UPDATE kb_cases SET original_code = ?, optimized_code = ?, explanation = ?, language = ?, issue_type = ?, usage_count = ?, rating = ? WHERE id = ?`,
            [
              caseItem.original_code,
              caseItem.optimized_code,
              caseItem.explanation,
              caseItem.language,
              caseItem.issue_type || 'general',
              caseItem.usage_count || 0,
              caseItem.rating || 0,
              caseItem.id
            ]
          );
        } else {
          await mysql.execute(
            `INSERT INTO kb_cases (id, original_code, optimized_code, explanation, language, issue_type, usage_count, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              caseItem.id,
              caseItem.original_code,
              caseItem.optimized_code,
              caseItem.explanation,
              caseItem.language,
              caseItem.issue_type || 'general',
              caseItem.usage_count || 0,
              caseItem.rating || 0
            ]
          );
        }
        syncedCases++;
      }
      
      const os = require('os');
      const crypto = require('crypto');
      const machineId = crypto.createHash('md5')
        .update(`${os.hostname()}-${os.userInfo().username}-${os.platform()}`)
        .digest('hex')
        .substring(0, 8);
      
      await mysql.execute(
        `INSERT INTO sync_metadata (table_name, last_sync_at, record_count, machine_id) VALUES (?, NOW(), ?, ?) ON DUPLICATE KEY UPDATE last_sync_at = NOW(), record_count = ?`,
        ['kb_entries', syncedEntries, machineId, syncedEntries]
      );
      
      await mysql.execute(
        `INSERT INTO sync_metadata (table_name, last_sync_at, record_count, machine_id) VALUES (?, NOW(), ?, ?) ON DUPLICATE KEY UPDATE last_sync_at = NOW(), record_count = ?`,
        ['kb_cases', syncedCases, machineId, syncedCases]
      );
      
      return {
        success: true,
        syncedEntries,
        syncedCases,
        message: `同步成功: ${syncedEntries} 条知识, ${syncedCases} 个案例`
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 从云端MySQL同步到本地
   */
  async syncFromCloud() {
    let mysql;
    try {
      mysql = require('../../utils/mysql');
    } catch (e) {
      return { success: false, message: 'MySQL模块未找到' };
    }
    
    if (!mysql.isEnabled()) {
      return { success: false, message: 'MySQL未启用' };
    }
    
    try {
      await mysql.initDatabase();
      
      const entries = await mysql.query('SELECT * FROM kb_entries');
      const cases = await mysql.query('SELECT * FROM kb_cases');
      
      const importData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        entries: entries.map(e => ({
          id: e.id,
          content: e.content,
          content_type: e.content_type,
          language: e.language,
          tags: e.tags ? JSON.parse(e.tags) : [],
          source: e.source || 'cloud'
        })),
        cases: cases.map(c => ({
          id: c.id,
          original_code: c.original_code,
          optimized_code: c.optimized_code,
          explanation: c.explanation,
          language: c.language,
          issue_type: c.issue_type,
          usage_count: c.usage_count || 0,
          rating: c.rating || 0
        }))
      };
      
      const result = this.importFromJSON(importData, { merge: true, skipExisting: false });
      
      return {
        success: true,
        ...result,
        message: `从云端同步完成: ${result.importedEntries} 条知识, ${result.importedCases} 个案例`
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 测试云端连接
   */
  async testCloudConnection() {
    let mysql;
    try {
      mysql = require('../../utils/mysql');
    } catch (e) {
      return { success: false, message: 'MySQL模块未找到' };
    }
    
    return await mysql.testConnection();
  }

  /**
   * 初始化默认知识库（编码规范、最佳实践、设计模式、优化案例）
   */
  seedDefaultKnowledge() {
    this.init();
    const db = getDatabase();

    const existingCount = db.prepare("SELECT COUNT(*) as count FROM kb_entries WHERE source = 'default'").get().count;
    if (existingCount > 0) {
      logger.debug(`默认知识库已存在 ${existingCount} 条，跳过初始化`);
      return;
    }

    const defaultEntries = [
      { content: '避免使用魔法数字，应将其提取为命名常量。例如：const MAX_RETRY_COUNT = 3;', type: 'best_practice', language: 'javascript', tags: ['magic_number', 'constants'] },
      { content: '函数应该保持单一职责，长度不超过50行。如果函数过长，应拆分为多个小函数。', type: 'best_practice', language: 'general', tags: ['function', 'single_responsibility'] },
      { content: '删除未使用的变量和导入，减少代码冗余和打包体积。', type: 'best_practice', language: 'general', tags: ['unused', 'cleanup'] },
      { content: '使用const声明不会重新赋值的变量，使用let声明会重新赋值的变量，避免使用var。', type: 'best_practice', language: 'javascript', tags: ['variable', 'const', 'let'] },
      { content: '异步操作应使用async/await而非回调函数，提高代码可读性。', type: 'best_practice', language: 'javascript', tags: ['async', 'await', 'promise'] },
      { content: 'Python中应使用列表推导式替代简单的for循环，提高代码简洁性。', type: 'best_practice', language: 'python', tags: ['list_comprehension', 'pythonic'] },
      { content: '错误处理应使用try/catch块，并提供有意义的错误信息。', type: 'best_practice', language: 'general', tags: ['error_handling', 'try_catch'] },
      { content: '圈复杂度应保持在10以下，过高的复杂度会增加维护成本和Bug风险。', type: 'best_practice', language: 'general', tags: ['complexity', 'cyclomatic'] },
      { content: '避免深层嵌套（超过4层），使用提前返回（early return）和卫语句来扁平化代码。', type: 'best_practice', language: 'general', tags: ['nesting', 'early_return', 'guard_clause'] },
      { content: '在return语句后不需要使用else，可以直接返回以减少嵌套层级。', type: 'best_practice', language: 'general', tags: ['else', 'unnecessary', 'code_style'] },
      { content: '使用对象解构和数组解构来简化代码，提高可读性。', type: 'best_practice', language: 'javascript', tags: ['destructuring', 'es6'] },
      { content: '使用模板字符串代替字符串拼接，使代码更清晰易读。', type: 'best_practice', language: 'javascript', tags: ['template_string', 'es6', 'string'] },
      { content: '避免使用全局变量，使用模块化和闭包来封装状态。', type: 'best_practice', language: 'general', tags: ['global', 'module', 'closure'] },
      { content: '函数参数应保持在3个以内，过多参数可使用对象参数代替。', type: 'best_practice', language: 'general', tags: ['function', 'parameters', 'api_design'] },
      { content: '使用有意义的变量名和函数名，代码应自文档化。', type: 'best_practice', language: 'general', tags: ['naming', 'readability'] },
      { content: '避免重复代码（DRY原则），将重复逻辑提取为函数或模块。', type: 'best_practice', language: 'general', tags: ['dry', 'duplicate', 'refactoring'] },
      { content: '优先使用纯函数，减少副作用，使代码更易于测试和推理。', type: 'best_practice', language: 'general', tags: ['pure_function', 'functional', 'side_effect'] },
      { content: '使用默认参数值代替条件判断，简化函数逻辑。', type: 'best_practice', language: 'javascript', tags: ['default_parameter', 'es6', 'function'] },
      { content: '使用扩展运算符（spread）来复制数组和对象，避免直接修改原数据。', type: 'best_practice', language: 'javascript', tags: ['spread', 'immutable', 'es6'] },
      { content: '使用Map和Set替代普通对象，提供更好的性能和更丰富的API。', type: 'best_practice', language: 'javascript', tags: ['map', 'set', 'data_structure'] },
      { content: 'JavaScript中应严格检查null和undefined，避免运行时错误。', type: 'best_practice', language: 'javascript', tags: ['null', 'undefined', 'safety'] },
      { content: '使用可选链操作符（?.）和空值合并操作符（??）安全访问嵌套属性。', type: 'best_practice', language: 'javascript', tags: ['optional_chaining', 'nullish', 'es2020'] },
      { content: '代码应包含适当的注释，解释为什么这样做而不是做了什么。', type: 'best_practice', language: 'general', tags: ['comment', 'documentation'] },
      { content: '生产代码中应移除console.log等调试语句，使用正式的日志系统。', type: 'best_practice', language: 'javascript', tags: ['console', 'debug', 'logging'] },
      { content: '单例模式确保一个类只有一个实例，并提供全局访问点。', type: 'design_pattern', language: 'general', tags: ['singleton', 'creational'] },
      { content: '工厂模式通过工厂方法创建对象，而不直接使用new操作符。', type: 'design_pattern', language: 'general', tags: ['factory', 'creational'] },
      { content: '观察者模式定义对象间一对多的依赖关系，当一个对象状态改变时所有依赖者都会被通知。', type: 'design_pattern', language: 'general', tags: ['observer', 'behavioral'] },
      { content: '策略模式定义一系列算法，把它们封装起来并可以相互替换。', type: 'design_pattern', language: 'general', tags: ['strategy', 'behavioral'] },
      { content: '装饰器模式动态地给一个对象添加额外的职责，比继承更灵活。', type: 'design_pattern', language: 'general', tags: ['decorator', 'structural'] },
      { content: '适配器模式将一个类的接口转换成客户希望的另一个接口。', type: 'design_pattern', language: 'general', tags: ['adapter', 'structural'] },
      { content: 'Promise.all用于并行执行多个异步操作，提高性能。', type: 'pattern', language: 'javascript', tags: ['promise', 'parallel', 'async'] },
      { content: '使用防抖（debounce）和节流（throttle）优化频繁触发的事件处理。', type: 'pattern', language: 'javascript', tags: ['debounce', 'throttle', 'performance'] },
      { content: '使用记忆化（memoization）缓存昂贵函数的计算结果。', type: 'pattern', language: 'general', tags: ['memoization', 'performance', 'cache'] },
      { content: '惰性求值（Lazy evaluation）延迟计算直到真正需要结果时才执行。', type: 'pattern', language: 'general', tags: ['lazy', 'performance'] },
      { content: '使用错误边界（Error Boundary）优雅地处理React组件中的错误。', type: 'pattern', language: 'javascript', tags: ['error_boundary', 'react'] },
      { content: '中间件模式（Middleware）用于处理请求/响应管道中的横切关注点。', type: 'pattern', language: 'general', tags: ['middleware', 'express'] },
      { content: '批量操作数据库查询，减少数据库访问次数以提高性能。', type: 'performance', language: 'general', tags: ['database', 'batch', 'performance'] },
      { content: '使用索引优化数据库查询速度，避免全表扫描。', type: 'performance', language: 'general', tags: ['database', 'index', 'performance'] },
      { content: '避免在循环中进行DOM操作，应批量修改后一次性更新。', type: 'performance', language: 'javascript', tags: ['dom', 'performance', 'reflow'] },
      { content: '使用事件委托减少事件监听器数量，提高性能并简化代码。', type: 'performance', language: 'javascript', tags: ['event_delegation', 'performance'] },
      { content: '合理使用缓存（内存缓存、Redis、HTTP缓存）减少重复计算和网络请求。', type: 'performance', language: 'general', tags: ['cache', 'performance'] },
      { content: '代码审查应关注：命名清晰度、复杂度、错误处理、边界条件、安全性。', type: 'code_review', language: 'general', tags: ['review', 'quality'] },
      { content: '测试应覆盖正常路径、边界条件和错误场景，确保代码的健壮性。', type: 'testing', language: 'general', tags: ['testing', 'quality'] },
      { content: '使用版本控制（Git）管理代码，每次提交应有清晰的提交信息。', type: 'version_control', language: 'general', tags: ['git', 'best_practice'] },
      { content: '安全编码原则：永远不要信任用户输入，始终进行验证和转义。', type: 'security', language: 'general', tags: ['security', 'input_validation'] },
      { content: '防止SQL注入：使用参数化查询或ORM，永远不要拼接SQL字符串。', type: 'security', language: 'general', tags: ['security', 'sql_injection'] },
      { content: '防止XSS攻击：对用户输入进行HTML转义，使用CSP策略。', type: 'security', language: 'javascript', tags: ['security', 'xss'] },
      { content: 'Python中使用with语句管理资源，确保文件、连接等被正确关闭。', type: 'best_practice', language: 'python', tags: ['context_manager', 'with', 'resource'] },
      { content: 'Python中使用生成器（generator）处理大数据集，节省内存。', type: 'best_practice', language: 'python', tags: ['generator', 'memory', 'performance'] },
      { content: 'Java中使用try-with-resources自动关闭资源。', type: 'best_practice', language: 'java', tags: ['try_with_resources', 'resource', 'java'] },
      { content: 'Go中使用defer语句确保资源释放和清理操作的执行。', type: 'best_practice', language: 'go', tags: ['defer', 'resource', 'go'] }
    ];

    defaultEntries.forEach((entry, idx) => {
      try {
        this.addEntry(entry.content, {
          type: entry.type,
          language: entry.language,
          tags: entry.tags,
          source: 'default'
        });
      } catch (e) {
        logger.warn(`知识条目插入失败 [${idx}]:`, e.message);
      }
    });

    const defaultCases = [
      {
        original: 'for (let i = 0; i < arr.length; i++) { result.push(arr[i] * 2); }',
        optimized: 'const result = arr.map(item => item * 2);',
        explanation: '使用Array.map替代for循环，更简洁且表达力更强',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: 'if (user !== null && user !== undefined && user.name) { ... }',
        optimized: 'if (user?.name) { ... }',
        explanation: '使用可选链操作符简化嵌套属性的空值检查',
        language: 'javascript',
        issueType: 'null_check'
      },
      {
        original: 'const name = user.name ? user.name : "default";',
        optimized: 'const name = user.name ?? "default";',
        explanation: '使用空值合并操作符替代三元运算符，更简洁',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: 'function getFullName(user) { return user.firstName + " " + user.lastName; }',
        optimized: 'const getFullName = ({ firstName, lastName }) => `${firstName} ${lastName}`;',
        explanation: '使用解构和模板字符串简化函数，提高可读性',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: 'let items = []; for (let i = 0; i < data.length; i++) { if (data[i].active) { items.push(data[i]); } }',
        optimized: 'const items = data.filter(item => item.active);',
        explanation: '使用Array.filter替代for循环+条件判断，更函数式',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: 'if (err) { callback(err); } else { callback(null, result); }',
        optimized: 'callback(err, result);',
        explanation: '直接传递参数，移除不必要的if/else',
        language: 'javascript',
        issueType: 'unnecessary_else'
      },
      {
        original: 'function calculate(a, b, c, d, e) { ... }',
        optimized: 'function calculate({ a, b, c, d, e }) { ... }',
        explanation: '使用对象参数替代多个参数，提高可读性和扩展性',
        language: 'javascript',
        issueType: 'function_design'
      },
      {
        original: 'const copy = Object.assign({}, obj);',
        optimized: 'const copy = { ...obj };',
        explanation: '使用扩展运算符替代Object.assign，更简洁',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: 'squares = []\nfor x in range(10):\n    squares.append(x**2)',
        optimized: 'squares = [x**2 for x in range(10)]',
        explanation: '使用列表推导式替代for循环+append，更Pythonic',
        language: 'python',
        issueType: 'loop_optimization'
      },
      {
        original: 'if x > 0:\n    result = "positive"\nelse:\n    result = "negative"',
        optimized: 'result = "positive" if x > 0 else "negative"',
        explanation: '使用三元表达式简化简单的if/else赋值',
        language: 'python',
        issueType: 'code_style'
      }
    ];

    defaultCases.forEach((c, idx) => {
      try {
        this.addCase(c.original, c.optimized, c.explanation, {
          language: c.language,
          issueType: c.issueType
        });
      } catch (e) {
        logger.warn(`优化案例插入失败 [${idx}]:`, e.message);
      }
    });

    logger.debug(`默认知识库初始化完成 (${defaultEntries.length}条知识, ${defaultCases.length}个案例)`);
  }

  /**
   * 更新案例使用次数和评分
   */
  updateCaseUsage(caseId, rating) {
    this.init();
    const db = getDatabase();

    const stmt = db.prepare(`
      UPDATE kb_cases 
      SET usage_count = usage_count + 1, 
          rating = (rating * usage_count + ?) / (usage_count + 1)
      WHERE id = ?
    `);

    stmt.run(rating || 5, caseId);
  }
}

// 单例实例
const knowledgeBase = new LocalKnowledgeBase();

module.exports = {
  LocalKnowledgeBase,
  knowledgeBase,
  SimpleEmbedding
};
