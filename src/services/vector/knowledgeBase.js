/**
 * 知识库模块
 * 使用统一数据库适配器，自动支持本地SQLite和云端MySQL双写同步
 * 存储代码优化案例、最佳实践、编码规范等知识
 */

const { getDatabase } = require('../../utils/database');
const { logger } = require('../../utils/logger');
const { generateUUID } = require('../../utils/helpers');

class SimpleEmbedding {
  constructor() {
    this.vocabulary = new Set();
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  embed(text) {
    const tokens = this.tokenize(text);
    const vector = {};
    const tf = {};

    tokens.forEach(token => {
      tf[token] = (tf[token] || 0) + 1;
    });

    const totalTokens = tokens.length;
    Object.keys(tf).forEach(token => {
      vector[token] = tf[token] / totalTokens;
    });

    return vector;
  }

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

class KnowledgeBase {
  constructor() {
    this.initialized = false;
    this.cachedStats = {
      totalEntries: 0,
      totalCases: 0,
      typeStats: [],
      languageStats: [],
      storage: 'sqlite'
    };
  }

  async init() {
    if (this.initialized) return;

    this._initSqlite();
    
    const db = getDatabase();
    const mysql = require('../../utils/mysql');
    if (mysql.isEnabled()) {
      logger.info('知识库使用本地SQLite，数据自动同步到云端MySQL');
    } else {
      logger.info('知识库使用本地SQLite');
    }

    this.initialized = true;
    await this.getStats();
  }

  _initSqlite() {
    const { getDatabase } = require('../../utils/database');
    const db = getDatabase();
    
    this._ensureTableStructure(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    this._ensureIndexes(db);
  }

  _ensureTableStructure(db) {
    try {
      const kbEntriesSchema = db.prepare("PRAGMA table_info(kb_entries)").all();
      const kbEntriesColumns = kbEntriesSchema.map(col => col.name);
      
      const kbCasesSchema = db.prepare("PRAGMA table_info(kb_cases)").all();
      const kbCasesColumns = kbCasesSchema.map(col => col.name);
      
      const kbEntriesNeedsMigration = !kbEntriesColumns.includes('vector_json');
      const kbCasesNeedsMigration = !kbCasesColumns.includes('vector_json');
      
      if (kbEntriesNeedsMigration || kbCasesNeedsMigration) {
        logger.info('检测到旧版数据库表结构，正在迁移...');
        
        if (kbEntriesNeedsMigration) {
          const entries = db.prepare('SELECT * FROM kb_entries').all();
          db.exec('DROP TABLE IF EXISTS kb_entries');
          db.exec(`
            CREATE TABLE kb_entries (
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
          const stmt = db.prepare(`
            INSERT INTO kb_entries (id, content, content_type, language, tags, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const entry of entries) {
            stmt.run(
              entry.id ? String(entry.id) : this._generateUUID(),
              entry.content,
              entry.content_type || 'general',
              entry.language || null,
              entry.tags || null,
              entry.source || null,
              entry.created_at || new Date().toISOString()
            );
          }
          logger.info(`已迁移 ${entries.length} 条知识条目`);
        }
        
        if (kbCasesNeedsMigration) {
          const cases = db.prepare('SELECT * FROM kb_cases').all();
          db.exec('DROP TABLE IF EXISTS kb_cases');
          db.exec(`
            CREATE TABLE kb_cases (
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
          const stmt = db.prepare(`
            INSERT INTO kb_cases (id, original_code, optimized_code, explanation, language, issue_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const c of cases) {
            stmt.run(
              c.id ? String(c.id) : this._generateUUID(),
              c.original_code,
              c.optimized_code,
              c.explanation || null,
              c.language || null,
              c.issue_type || null,
              c.created_at || new Date().toISOString()
            );
          }
          logger.info(`已迁移 ${cases.length} 条优化案例`);
        }
        
        logger.info('数据库表结构迁移完成');
      }
    } catch (e) {
      logger.warn('数据库表结构检查失败: ' + e.message);
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
    }
  }

  _generateUUID() {
    const { generateUUID } = require('../../utils/helpers');
    return generateUUID();
  }

  _ensureIndexes(db) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_entries_type ON kb_entries(content_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_entries_lang ON kb_entries(language)');
    
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_kb_cases_type ON kb_cases(issue_type)');
    } catch (e) {
      logger.debug('创建索引 idx_kb_cases_type 失败: ' + e.message);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_cases_lang ON kb_cases(language)');
  }

  async addEntry(content, options = {}) {
    await this.init();
    const id = generateUUID();
    const vector = embedder.embed(content);

    const { getDatabase } = require('../../utils/database');
    const db = getDatabase();
    
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

  async addCase(originalCode, optimizedCode, explanation, options = {}) {
    await this.init();
    const id = generateUUID();
    const combinedText = `${originalCode} ${optimizedCode} ${explanation}`;
    const vector = embedder.embed(combinedText);

    const { getDatabase } = require('../../utils/database');
    const db = getDatabase();
    
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

  async searchEntries(query, options = {}) {
    await this.init();
    const queryVector = embedder.embed(query);
    const topK = options.topK || 5;
    const type = options.type;
    const language = options.language;

    const db = getDatabase();
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

    const entries = db.prepare(sql).all(...params);

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

  async searchCases(query, options = {}) {
    await this.init();
    const queryVector = embedder.embed(query);
    const topK = options.topK || 3;
    const language = options.language;
    const issueType = options.issueType;

    const db = getDatabase();
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

    const cases = db.prepare(sql).all(...params);

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

  async findSimilarCases(codeSnippet, options = {}) {
    return this.searchCases(codeSnippet, options);
  }

  async applyOptimizationPattern(codeSnippet, options = {}) {
    await this.init();
    
    const similarCases = await this.searchCases(codeSnippet, {
      topK: 5,
      language: options.language
    });

    if (similarCases.length === 0) {
      return {
        success: false,
        optimizedCode: codeSnippet,
        explanation: '未找到相似的优化案例',
        suggestions: [],
        appliedPatterns: []
      };
    }

    let optimizedCode = codeSnippet;
    const appliedPatterns = [];
    const suggestions = [];

    for (const caseItem of similarCases) {
      if (caseItem.similarity > 0.3) {
        const result = this.applyPattern(codeSnippet, caseItem);
        if (result.changed) {
          optimizedCode = result.code;
          appliedPatterns.push({
            patternId: caseItem.id,
            similarity: caseItem.similarity,
            explanation: caseItem.explanation
          });
          suggestions.push(caseItem.explanation);
        }
      }
    }

    const changed = optimizedCode !== codeSnippet;

    return {
      success: changed,
      optimizedCode,
      explanation: changed 
        ? `应用了${appliedPatterns.length}个优化模式` 
        : '未找到可应用的优化模式',
      suggestions,
      appliedPatterns,
      similarCases: similarCases.filter(c => c.similarity > 0.2)
    };
  }

  applyPattern(codeSnippet, caseItem) {
    const originalCode = caseItem.originalCode;
    const optimizedCode = caseItem.optimizedCode;

    if (!originalCode || !optimizedCode) {
      return { changed: false, code: codeSnippet };
    }

    try {
      const diff = this.computeDiff(originalCode, optimizedCode);
      
      if (diff.length > 0) {
        let result = codeSnippet;
        
        for (const change of diff) {
          if (change.type === 'replace') {
            if (result.includes(change.from)) {
              result = result.replace(change.from, change.to);
            }
          } else if (change.type === 'insert') {
            const insertPoint = result.lastIndexOf(change.after) || result.length;
            result = result.slice(0, insertPoint + change.after.length) + '\n' + change.text + result.slice(insertPoint + change.after.length);
          } else if (change.type === 'delete') {
            if (result.includes(change.text)) {
              result = result.replace(change.text, '');
            }
          }
        }
        
        return { changed: result !== codeSnippet, code: result };
      }
    } catch (e) {
      logger.debug('模式应用失败:', e.message);
    }

    return { changed: false, code: codeSnippet };
  }

  computeDiff(original, optimized) {
    const originalLines = original.split('\n');
    const optimizedLines = optimized.split('\n');
    const diff = [];

    const lcs = this.longestCommonSubsequence(originalLines, optimizedLines);
    
    let i = 0, j = 0, lcsIdx = 0;
    
    while (i < originalLines.length || j < optimizedLines.length) {
      if (lcsIdx < lcs.length && originalLines[i] === lcs[lcsIdx] && optimizedLines[j] === lcs[lcsIdx]) {
        i++;
        j++;
        lcsIdx++;
      } else if (j < optimizedLines.length && (i >= originalLines.length || originalLines[i] !== optimizedLines[j])) {
        const prevLine = j > 0 ? optimizedLines[j - 1] : '';
        diff.push({
          type: 'insert',
          text: optimizedLines[j],
          after: prevLine
        });
        j++;
      } else if (i < originalLines.length && (j >= optimizedLines.length || originalLines[i] !== optimizedLines[j])) {
        diff.push({
          type: 'delete',
          text: originalLines[i]
        });
        i++;
      } else {
        i++;
        j++;
      }
    }

    return this.mergeDiff(diff);
  }

  longestCommonSubsequence(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const result = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return result;
  }

  mergeDiff(diff) {
    const merged = [];
    
    for (let i = 0; i < diff.length; i++) {
      const current = diff[i];
      
      if (current.type === 'delete' && i + 1 < diff.length && diff[i + 1].type === 'insert') {
        merged.push({
          type: 'replace',
          from: current.text,
          to: diff[i + 1].text
        });
        i++;
      } else {
        merged.push(current);
      }
    }
    
    return merged;
  }

  async getStats() {
    await this.init();

    const db = getDatabase();
    const entryCount = db.prepare('SELECT COUNT(*) as count FROM kb_entries').get().count;
    const caseCount = db.prepare('SELECT COUNT(*) as count FROM kb_cases').get().count;

    const typeStats = db.prepare(`
      SELECT content_type, COUNT(*) as count FROM kb_entries GROUP BY content_type
    `).all();

    const languageStats = db.prepare(`
      SELECT language, COUNT(*) as count FROM kb_entries WHERE language IS NOT NULL GROUP BY language
    `).all();

    const mysql = require('../../utils/mysql');
    const stats = {
      totalEntries: entryCount,
      totalCases: caseCount,
      typeStats,
      languageStats,
      storage: mysql.isEnabled() ? 'sqlite+mysql' : 'sqlite'
    };
    this.cachedStats = stats;
    return stats;
  }

  getCachedStats() {
    return this.cachedStats;
  }

  async exportToJSON(options = {}) {
    await this.init();
    
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

  async importFromJSON(data, options = {}) {
    await this.init();
    const { merge = true, skipExisting = true } = options;
    
    let importedEntries = 0;
    let importedCases = 0;
    let skippedEntries = 0;
    let skippedCases = 0;

    const { getDatabase } = require('../../utils/database');
    const db = getDatabase();
    
    if (!merge) {
      db.prepare('DELETE FROM kb_entries').run();
      db.prepare('DELETE FROM kb_cases').run();
    }
    
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
    
    await this.getStats();
    
    return {
      importedEntries,
      importedCases,
      skippedEntries,
      skippedCases,
      totalEntries: importedEntries + skippedEntries,
      totalCases: importedCases + skippedCases
    };
  }

  async seedDefaultKnowledge() {
    await this.init();
    const stats = await this.getStats();
    
    if (stats.totalEntries > 0) {
      logger.debug(`知识库已存在 ${stats.totalEntries} 条，跳过初始化`);
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

    for (let i = 0; i < defaultEntries.length; i++) {
      const entry = defaultEntries[i];
      try {
        await this.addEntry(entry.content, {
          type: entry.type,
          language: entry.language,
          tags: entry.tags,
          source: 'default'
        });
      } catch (e) {
        logger.warn(`知识条目插入失败 [${i}]: ${e.message}`, e);
      }
    }

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

    for (let i = 0; i < defaultCases.length; i++) {
      const c = defaultCases[i];
      try {
        await this.addCase(c.original, c.optimized, c.explanation, {
          language: c.language,
          issueType: c.issueType
        });
      } catch (e) {
        logger.warn(`优化案例插入失败 [${i}]: ${e.message}`, e);
      }
    }

    logger.debug(`默认知识库初始化完成 (${defaultEntries.length}条知识, ${defaultCases.length}个案例)`);
  }

  async updateCaseUsage(caseId, rating) {
    await this.init();

    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE kb_cases 
      SET usage_count = usage_count + 1, 
          rating = (rating * usage_count + ?) / (usage_count + 1)
      WHERE id = ?
    `);
    stmt.run(rating || 5, caseId);
  }

  async findDuplicateEntries() {
    await this.init();
    
    const db = getDatabase();
    const duplicates = {
      entries: db.prepare(`
        SELECT id, content, COUNT(*) as count 
        FROM kb_entries 
        GROUP BY content 
        HAVING COUNT(*) > 1
      `).all(),
      cases: db.prepare(`
        SELECT id, original_code, COUNT(*) as count 
        FROM kb_cases 
        GROUP BY original_code 
        HAVING COUNT(*) > 1
      `).all()
    };

    return duplicates;
  }

  async removeDuplicates() {
    await this.init();
    
    const db = getDatabase();
    let removedEntries = 0;
    let removedCases = 0;

    const duplicates = db.prepare(`
      SELECT content 
      FROM kb_entries 
      GROUP BY content 
      HAVING COUNT(*) > 1
    `).all();
    
    for (const item of duplicates) {
      const entries = db.prepare('SELECT id FROM kb_entries WHERE content = ?').all(item.content);
      const idsToRemove = entries.slice(1).map(e => e.id);
      
      for (const id of idsToRemove) {
        db.prepare('DELETE FROM kb_entries WHERE id = ?').run(id);
        removedEntries++;
      }
    }

    const caseDuplicates = db.prepare(`
      SELECT original_code 
      FROM kb_cases 
      GROUP BY original_code 
      HAVING COUNT(*) > 1
    `).all();
    
    for (const item of caseDuplicates) {
      const cases = db.prepare('SELECT id FROM kb_cases WHERE original_code = ?').all(item.original_code);
      const idsToRemove = cases.slice(1).map(e => e.id);
      
      for (const id of idsToRemove) {
        db.prepare('DELETE FROM kb_cases WHERE id = ?').run(id);
        removedCases++;
      }
    }

    return {
      success: true,
      removedEntries,
      removedCases,
      message: `已删除 ${removedEntries} 条重复知识条目和 ${removedCases} 个重复案例`
    };
  }

  async syncToCloud(mode = 'merge') {
    const mysql = require('../../utils/mysql');
    if (!mysql.isEnabled()) {
      return { success: false, message: 'MySQL未配置' };
    }
    
    logger.info('手动触发知识库全量同步到云端...');
    const { dbAdapter } = require('../../utils/dbAdapter');
    await dbAdapter.syncLocalToRemote('kb_entries');
    await dbAdapter.syncLocalToRemote('kb_cases');
    
    return {
      success: true,
      message: '知识库全量同步完成'
    };
  }

  async syncFromCloud() {
    const mysql = require('../../utils/mysql');
    if (!mysql.isEnabled()) {
      return { success: false, message: 'MySQL未配置' };
    }
    
    try {
      const db = getDatabase();
      const entries = await mysql.query('SELECT * FROM kb_entries');
      const cases = await mysql.query('SELECT * FROM kb_cases');
      
      const parseTags = (tags) => {
        if (!tags) return [];
        try {
          return JSON.parse(tags);
        } catch {
          if (typeof tags === 'string') {
            return tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
          }
          return [];
        }
      };
      
      const importData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        entries: entries.map(e => ({
          id: e.id,
          content: e.content,
          content_type: e.content_type,
          language: e.language,
          tags: parseTags(e.tags),
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
      
      const result = await this.importFromJSON(importData, { merge: false, skipExisting: false });
      
      return {
        success: true,
        ...result,
        message: `从云端同步完成: ${result.importedEntries} 条知识, ${result.importedCases} 个案例`
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async testCloudConnection() {
    const mysql = require('../../utils/mysql');
    return await mysql.testConnection();
  }

  async switchDatabaseConnection(connectionConfig) {
    const mysql = require('../../utils/mysql');
    const result = await mysql.switchConnection(connectionConfig);
    
    if (result.success) {
      this.initialized = false;
      await this.init();
    }
    
    return result;
  }

  async testConnectionWithConfig(connectionConfig) {
    const mysql = require('../../utils/mysql');
    return await mysql.testConnectionWithConfig(connectionConfig);
  }

  getCurrentConnectionId() {
    return null;
  }
}

const knowledgeBase = new KnowledgeBase();

module.exports = {
  KnowledgeBase,
  knowledgeBase,
  SimpleEmbedding
};
