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
      let entryVector = {};
      try {
        entryVector = JSON.parse(entry.vector_json || '{}');
      } catch (e) {
        entryVector = {};
      }
      const similarity = embedder.cosineSimilarity(queryVector, entryVector);
      
      let tags = [];
      try {
        tags = entry.tags ? JSON.parse(entry.tags) : [];
      } catch (e) {
        tags = entry.tags ? [entry.tags] : [];
      }
      
      return {
        id: entry.id,
        content: entry.content,
        type: entry.content_type,
        language: entry.language,
        tags,
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
      let caseVector = {};
      try {
        caseVector = JSON.parse(c.vector_json || '{}');
      } catch (e) {
        caseVector = {};
      }
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
      entries: entries.map(e => {
        let tags = [];
        try {
          tags = e.tags ? JSON.parse(e.tags) : [];
        } catch (err) {
          tags = e.tags ? [e.tags] : [];
        }
        return {
          id: e.id,
          content: e.content,
          content_type: e.content_type,
          language: e.language,
          tags,
          source: e.source,
          created_at: e.created_at
        };
      }),
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
    const db = getDatabase();
    
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
      { content: 'Go中使用defer语句确保资源释放和清理操作的执行。', type: 'best_practice', language: 'go', tags: ['defer', 'resource', 'go'] },
      
      // ===== TypeScript 最佳实践 =====
      { content: 'TypeScript中使用interface定义对象类型，使用type定义联合类型和交叉类型。', type: 'best_practice', language: 'typescript', tags: ['interface', 'type', 'typescript'] },
      { content: 'TypeScript中使用泛型（Generics）编写可重用的组件和函数。', type: 'best_practice', language: 'typescript', tags: ['generics', 'typescript', 'reusability'] },
      { content: 'TypeScript中使用枚举（enum）或常量对象替代魔法字符串。', type: 'best_practice', language: 'typescript', tags: ['enum', 'constants', 'typescript'] },
      { content: 'TypeScript中使用namespace或模块组织代码，避免全局命名空间污染。', type: 'best_practice', language: 'typescript', tags: ['namespace', 'module', 'organization'] },
      { content: 'TypeScript中使用严格模式（strict: true）捕获更多类型错误。', type: 'best_practice', language: 'typescript', tags: ['strict', 'type_safety', 'typescript'] },
      { content: 'TypeScript中使用类型守卫（type guard）和类型断言安全地处理类型转换。', type: 'best_practice', language: 'typescript', tags: ['type_guard', 'type_assertion', 'safety'] },
      { content: 'TypeScript中使用装饰器（Decorator）增强类和方法的功能。', type: 'best_practice', language: 'typescript', tags: ['decorator', 'metaprogramming', 'typescript'] },
      { content: 'TypeScript中使用Promise和async/await处理异步操作。', type: 'best_practice', language: 'typescript', tags: ['async', 'await', 'promise'] },
      { content: 'TypeScript中避免使用any类型，尽量使用具体类型以获得类型检查。', type: 'best_practice', language: 'typescript', tags: ['any', 'type_safety', 'typescript'] },
      { content: 'TypeScript中使用utility types（Partial、Required、Pick、Omit等）转换类型。', type: 'best_practice', language: 'typescript', tags: ['utility_types', 'typescript', 'type_manipulation'] },
      
      // ===== Java 最佳实践 =====
      { content: 'Java中使用接口（Interface）定义契约，使用抽象类提供部分实现。', type: 'best_practice', language: 'java', tags: ['interface', 'abstract', 'java', 'oop'] },
      { content: 'Java中使用try-with-resources自动关闭AutoCloseable资源。', type: 'best_practice', language: 'java', tags: ['try_with_resources', 'java', 'resource'] },
      { content: 'Java中使用StringBuilder或StringBuffer进行字符串拼接，避免+运算符创建多个对象。', type: 'best_practice', language: 'java', tags: ['stringbuilder', 'performance', 'java', 'string'] },
      { content: 'Java中使用枚举（enum）代替整数常量，提高类型安全性。', type: 'best_practice', language: 'java', tags: ['enum', 'type_safety', 'java'] },
      { content: 'Java中使用HashMap或LinkedHashMap替代Hashtable，性能更好且非同步。', type: 'best_practice', language: 'java', tags: ['hashmap', 'collections', 'java', 'performance'] },
      { content: 'Java中使用ArrayList或LinkedList替代Vector，性能更好。', type: 'best_practice', language: 'java', tags: ['arraylist', 'collections', 'java'] },
      { content: 'Java中使用异常体系（Checked vs Unchecked Exception）合理处理错误。', type: 'best_practice', language: 'java', tags: ['exception', 'error_handling', 'java'] },
      { content: 'Java中使用泛型（Generics）提高类型安全性和代码复用性。', type: 'best_practice', language: 'java', tags: ['generics', 'java', 'type_safety'] },
      { content: 'Java中使用Lambda表达式和Stream API简化集合操作。', type: 'best_practice', language: 'java', tags: ['lambda', 'stream', 'java', 'functional'] },
      { content: 'Java中使用@Override注解标记方法重写，确保编译时检查。', type: 'best_practice', language: 'java', tags: ['override', 'annotation', 'java'] },
      { content: 'Java中使用不可变对象（Immutable）和值对象减少副作用。', type: 'best_practice', language: 'java', tags: ['immutable', 'value_object', 'java'] },
      { content: 'Java中使用依赖注入（DI）框架如Spring管理对象生命周期。', type: 'best_practice', language: 'java', tags: ['di', 'spring', 'java', 'architecture'] },
      
      // ===== Python 最佳实践 =====
      { content: 'Python中遵循PEP 8代码风格规范，使用4空格缩进。', type: 'best_practice', language: 'python', tags: ['pep8', 'code_style', 'python'] },
      { content: 'Python中使用虚拟环境（venv或conda）隔离项目依赖。', type: 'best_practice', language: 'python', tags: ['venv', 'virtualenv', 'python', 'dependencies'] },
      { content: 'Python中使用__init__.py文件标识包，使用相对导入避免循环引用。', type: 'best_practice', language: 'python', tags: ['package', 'import', 'python'] },
      { content: 'Python中使用docstring（文档字符串）编写函数和类的文档。', type: 'best_practice', language: 'python', tags: ['docstring', 'documentation', 'python'] },
      { content: 'Python中使用类型提示（Type Hints）提高代码可读性和IDE支持。', type: 'best_practice', language: 'python', tags: ['type_hints', 'typing', 'python'] },
      { content: 'Python中使用装饰器（Decorator）增强函数或类的功能。', type: 'best_practice', language: 'python', tags: ['decorator', 'metaprogramming', 'python'] },
      { content: 'Python中使用上下文管理器（Context Manager）管理资源。', type: 'best_practice', language: 'python', tags: ['context_manager', 'with', 'python'] },
      { content: 'Python中使用迭代器（Iterator）和生成器（Generator）处理数据流。', type: 'best_practice', language: 'python', tags: ['iterator', 'generator', 'python'] },
      { content: 'Python中使用列表/字典/集合推导式简化代码。', type: 'best_practice', language: 'python', tags: ['comprehension', 'pythonic', 'python'] },
      { content: 'Python中使用异常处理（try/except/finally）合理处理错误。', type: 'best_practice', language: 'python', tags: ['exception', 'error_handling', 'python'] },
      { content: 'Python中使用logging模块替代print进行日志记录。', type: 'best_practice', language: 'python', tags: ['logging', 'debug', 'python'] },
      { content: 'Python中使用pip freeze > requirements.txt锁定依赖版本。', type: 'best_practice', language: 'python', tags: ['pip', 'requirements', 'python', 'dependencies'] },
      
      // ===== Go 最佳实践 =====
      { content: 'Go中使用error返回值而非异常处理错误。', type: 'best_practice', language: 'go', tags: ['error', 'error_handling', 'go'] },
      { content: 'Go中使用goroutine和channel实现并发。', type: 'best_practice', language: 'go', tags: ['goroutine', 'channel', 'concurrency', 'go'] },
      { content: 'Go中使用context.Context传递请求级数据和取消信号。', type: 'best_practice', language: 'go', tags: ['context', 'go', 'cancellation'] },
      { content: 'Go中使用defer确保资源释放。', type: 'best_practice', language: 'go', tags: ['defer', 'go', 'resource'] },
      { content: 'Go中使用struct组合替代继承。', type: 'best_practice', language: 'go', tags: ['composition', 'embedding', 'go'] },
      { content: 'Go中使用interface定义行为而非类型。', type: 'best_practice', language: 'go', tags: ['interface', 'go', 'design'] },
      { content: 'Go中使用指针接收者和值接收者的选择：需要修改时用指针。', type: 'best_practice', language: 'go', tags: ['pointer', 'receiver', 'go'] },
      { content: 'Go中使用sync.WaitGroup等待goroutine完成。', type: 'best_practice', language: 'go', tags: ['waitgroup', 'goroutine', 'go', 'synchronization'] },
      { content: 'Go中使用select语句处理多个channel操作。', type: 'best_practice', language: 'go', tags: ['select', 'channel', 'go', 'concurrency'] },
      { content: 'Go中使用go fmt自动格式化代码，保持一致的代码风格。', type: 'best_practice', language: 'go', tags: ['gofmt', 'code_style', 'go'] },
      
      // ===== C/C++ 最佳实践 =====
      { content: 'C/C++中使用智能指针（unique_ptr、shared_ptr）管理内存。', type: 'best_practice', language: 'cpp', tags: ['smart_pointer', 'memory', 'cpp'] },
      { content: 'C/C++中使用RAII（资源获取即初始化）管理资源生命周期。', type: 'best_practice', language: 'cpp', tags: ['raii', 'resource', 'cpp'] },
      { content: 'C/C++中避免使用裸指针和new/delete，优先使用智能指针。', type: 'best_practice', language: 'cpp', tags: ['raw_pointer', 'memory', 'cpp'] },
      { content: 'C/C++中使用const修饰符增加代码的不可变性和优化机会。', type: 'best_practice', language: 'cpp', tags: ['const', 'optimization', 'cpp'] },
      { content: 'C/C++中使用引用（&）替代指针以获得更安全的语义。', type: 'best_practice', language: 'cpp', tags: ['reference', 'safety', 'cpp'] },
      { content: 'C/C++中使用模板（Template）实现泛型编程。', type: 'best_practice', language: 'cpp', tags: ['template', 'generic', 'cpp'] },
      { content: 'C/C++中使用命名空间（namespace）避免名称冲突。', type: 'best_practice', language: 'cpp', tags: ['namespace', 'cpp'] },
      { content: 'C/C++中遵循Rule of Three/Five（析构函数、拷贝构造、赋值运算符）。', type: 'best_practice', language: 'cpp', tags: ['rule_of_three', 'rule_of_five', 'cpp'] },
      { content: 'C/C++中使用范围for循环（Range-based for）简化迭代。', type: 'best_practice', language: 'cpp', tags: ['range_for', 'iteration', 'cpp'] },
      { content: 'C/C++中使用异常处理（try/catch）或返回错误码处理错误。', type: 'best_practice', language: 'cpp', tags: ['exception', 'error_handling', 'cpp'] },
      
      // ===== 框架与生态 =====
      { content: 'React中使用Hooks替代类组件，提高代码复用性和可读性。', type: 'best_practice', language: 'javascript', tags: ['react', 'hooks', 'frontend'] },
      { content: 'React中使用useMemo和useCallback优化性能，避免不必要的重渲染。', type: 'performance', language: 'javascript', tags: ['react', 'memo', 'performance'] },
      { content: 'React中使用React.memo、useMemo、useCallback进行组件优化。', type: 'performance', language: 'javascript', tags: ['react', 'optimization', 'memo'] },
      { content: 'React中使用Context API或状态管理库（Redux、Zustand）管理全局状态。', type: 'best_practice', language: 'javascript', tags: ['react', 'state_management', 'context'] },
      { content: 'React中使用React.lazy和Suspense实现组件懒加载。', type: 'performance', language: 'javascript', tags: ['react', 'lazy_load', 'code_splitting'] },
      { content: 'Vue中使用Composition API替代Options API，逻辑复用更灵活。', type: 'best_practice', language: 'javascript', tags: ['vue', 'composition_api', 'frontend'] },
      { content: 'Vue中使用Pinia或Vuex进行状态管理。', type: 'best_practice', language: 'javascript', tags: ['vue', 'pinia', 'state_management'] },
      { content: 'Vue中使用v-once、v-memo、v-show等指令优化渲染性能。', type: 'performance', language: 'javascript', tags: ['vue', 'performance', 'directives'] },
      { content: 'Express中使用Router分离路由，保持代码结构清晰。', type: 'best_practice', language: 'javascript', tags: ['express', 'router', 'nodejs'] },
      { content: 'Express中使用中间件处理横切关注点（认证、日志、CORS等）。', type: 'pattern', language: 'javascript', tags: ['express', 'middleware', 'nodejs'] },
      { content: 'Express中使用错误处理中间件统一处理错误。', type: 'best_practice', language: 'javascript', tags: ['express', 'error_handling', 'middleware'] },
      { content: 'Django中使用MVT架构（Model-View-Template）组织代码。', type: 'best_practice', language: 'python', tags: ['django', 'mvt', 'web_framework'] },
      { content: 'Django中使用ORM（Object-Relational Mapping）操作数据库，避免原生SQL。', type: 'best_practice', language: 'python', tags: ['django', 'orm', 'database'] },
      { content: 'Spring Boot中使用注解驱动开发，简化配置。', type: 'best_practice', language: 'java', tags: ['spring_boot', 'annotation', 'java'] },
      { content: 'Spring Boot中使用自动配置（Auto-Configuration）快速搭建项目。', type: 'best_practice', language: 'java', tags: ['spring_boot', 'auto_config', 'java'] },
      
      // ===== 数据库优化 =====
      { content: '数据库查询使用EXPLAIN分析执行计划，识别性能瓶颈。', type: 'performance', language: 'general', tags: ['database', 'explain', 'sql', 'performance'] },
      { content: '数据库中使用索引（B-tree、Hash、Full-text）加速查询。', type: 'performance', language: 'general', tags: ['database', 'index', 'performance'] },
      { content: '数据库中避免SELECT *，只查询需要的列。', type: 'performance', language: 'general', tags: ['database', 'select', 'sql', 'performance'] },
      { content: '数据库中使用LIMIT分页，避免返回大量数据。', type: 'performance', language: 'general', tags: ['database', 'pagination', 'sql', 'performance'] },
      { content: '数据库中合理设计表结构，遵循数据库范式（1NF、2NF、3NF）。', type: 'best_practice', language: 'general', tags: ['database', 'normalization', 'sql', 'design'] },
      { content: '数据库在高并发场景下考虑反范式设计，以空间换时间。', type: 'performance', language: 'general', tags: ['database', 'denormalization', 'performance'] },
      { content: 'MySQL中使用InnoDB引擎支持事务和行级锁。', type: 'best_practice', language: 'general', tags: ['mysql', 'innodb', 'transaction'] },
      { content: 'MySQL中使用VARCHAR替代CHAR，节省存储空间。', type: 'best_practice', language: 'general', tags: ['mysql', 'varchar', 'storage'] },
      { content: 'MySQL中合理设置连接池大小，避免连接过多或过少。', type: 'performance', language: 'general', tags: ['mysql', 'connection_pool', 'performance'] },
      { content: 'Redis中使用适当的数据结构（String、Hash、List、Set、Sorted Set）。', type: 'best_practice', language: 'general', tags: ['redis', 'data_structure', 'cache'] },
      { content: 'Redis中设置合理的过期时间（TTL），避免内存泄漏。', type: 'best_practice', language: 'general', tags: ['redis', 'ttl', 'memory'] },
      { content: 'MongoDB中使用嵌入文档或引用关系设计数据模型。', type: 'best_practice', language: 'general', tags: ['mongodb', 'data_model', 'nosql'] },
      
      // ===== 设计模式 =====
      { content: '单例模式（Singleton）：确保一个类只有一个实例，并提供全局访问点。', type: 'design_pattern', language: 'general', tags: ['singleton', 'creational', 'pattern'] },
      { content: '工厂方法模式（Factory Method）：定义创建对象的接口，让子类决定实例化哪个类。', type: 'design_pattern', language: 'general', tags: ['factory_method', 'creational', 'pattern'] },
      { content: '抽象工厂模式（Abstract Factory）：创建一系列相关产品对象。', type: 'design_pattern', language: 'general', tags: ['abstract_factory', 'creational', 'pattern'] },
      { content: '建造者模式（Builder）：分步创建复杂对象。', type: 'design_pattern', language: 'general', tags: ['builder', 'creational', 'pattern'] },
      { content: '原型模式（Prototype）：通过复制已有对象创建新对象。', type: 'design_pattern', language: 'general', tags: ['prototype', 'creational', 'pattern'] },
      { content: '适配器模式（Adapter）：将类的接口转换成客户希望的接口。', type: 'design_pattern', language: 'general', tags: ['adapter', 'structural', 'pattern'] },
      { content: '装饰器模式（Decorator）：动态地给对象添加额外职责。', type: 'design_pattern', language: 'general', tags: ['decorator', 'structural', 'pattern'] },
      { content: '代理模式（Proxy）：为对象提供代理控制访问。', type: 'design_pattern', language: 'general', tags: ['proxy', 'structural', 'pattern'] },
      { content: '外观模式（Facade）：为子系统提供统一的简化接口。', type: 'design_pattern', language: 'general', tags: ['facade', 'structural', 'pattern'] },
      { content: '组合模式（Composite）：将对象组合成树形结构表示层次关系。', type: 'design_pattern', language: 'general', tags: ['composite', 'structural', 'pattern'] },
      { content: '桥接模式（Bridge）：将抽象部分与实现部分分离。', type: 'design_pattern', language: 'general', tags: ['bridge', 'structural', 'pattern'] },
      { content: '策略模式（Strategy）：定义算法族，分别封装，互相替换。', type: 'design_pattern', language: 'general', tags: ['strategy', 'behavioral', 'pattern'] },
      { content: '观察者模式（Observer）：定义对象间一对多的依赖关系。', type: 'design_pattern', language: 'general', tags: ['observer', 'behavioral', 'pattern'] },
      { content: '命令模式（Command）：将请求封装成对象。', type: 'design_pattern', language: 'general', tags: ['command', 'behavioral', 'pattern'] },
      { content: '状态模式（State）：允许对象在状态改变时改变其行为。', type: 'design_pattern', language: 'general', tags: ['state', 'behavioral', 'pattern'] },
      { content: '模板方法模式（Template Method）：定义算法骨架，将某些步骤延迟到子类。', type: 'design_pattern', language: 'general', tags: ['template_method', 'behavioral', 'pattern'] },
      { content: '访问者模式（Visitor）：为对象结构中的各元素定义新操作。', type: 'design_pattern', language: 'general', tags: ['visitor', 'behavioral', 'pattern'] },
      { content: '迭代器模式（Iterator）：提供一种顺序访问集合中元素的方法。', type: 'design_pattern', language: 'general', tags: ['iterator', 'behavioral', 'pattern'] },
      { content: '中介者模式（Mediator）：用中介对象封装一系列对象交互。', type: 'design_pattern', language: 'general', tags: ['mediator', 'behavioral', 'pattern'] },
      { content: '备忘录模式（Memento）：在不破坏封装的前提下保存和恢复对象状态。', type: 'design_pattern', language: 'general', tags: ['memento', 'behavioral', 'pattern'] },
      { content: '解释器模式（Interpreter）：定义文法的解释器。', type: 'design_pattern', language: 'general', tags: ['interpreter', 'behavioral', 'pattern'] },
      
      // ===== 安全编码 =====
      { content: '始终验证和清理所有用户输入，使用白名单验证。', type: 'security', language: 'general', tags: ['input_validation', 'security'] },
      { content: '使用HTTPS加密传输数据，防止中间人攻击。', type: 'security', language: 'general', tags: ['https', 'tls', 'security'] },
      { content: '密码存储使用bcrypt、scrypt或argon2等加盐哈希算法。', type: 'security', language: 'general', tags: ['password', 'hashing', 'security'] },
      { content: '实现适当的会话管理，使用安全的Cookie和Token。', type: 'security', language: 'general', tags: ['session', 'cookie', 'token', 'security'] },
      { content: '实施速率限制防止暴力破解和DoS攻击。', type: 'security', language: 'general', tags: ['rate_limit', 'dos', 'security'] },
      { content: '使用CSRF Token防止跨站请求伪造攻击。', type: 'security', language: 'general', tags: ['csrf', 'security'] },
      { content: '使用Content Security Policy（CSP）防止XSS攻击。', type: 'security', language: 'general', tags: ['csp', 'xss', 'security'] },
      { content: '敏感数据加密存储，使用AES-256或RSA算法。', type: 'security', language: 'general', tags: ['encryption', 'sensitive_data', 'security'] },
      { content: '实施最小权限原则，用户只拥有必要的权限。', type: 'security', language: 'general', tags: ['least_privilege', 'security'] },
      { content: '定期更新依赖库，修复已知安全漏洞。', type: 'security', language: 'general', tags: ['dependency', 'update', 'security'] },
      { content: '使用OWASP Top 10作为安全检查清单。', type: 'security', language: 'general', tags: ['owasp', 'security', 'checklist'] },
      { content: '避免在URL中传递敏感信息，使用POST方法和请求体。', type: 'security', language: 'general', tags: ['url', 'sensitive_data', 'security'] },
      
      // ===== 测试最佳实践 =====
      { content: '测试金字塔：底层单元测试最多，中层集成测试，顶层端到端测试最少。', type: 'testing', language: 'general', tags: ['test_pyramid', 'testing', 'strategy'] },
      { content: '单元测试应独立、可重复、自验证、及时执行（FIRST原则）。', type: 'testing', language: 'general', tags: ['unit_test', 'first', 'testing'] },
      { content: '使用Mock或Stub隔离外部依赖。', type: 'testing', language: 'general', tags: ['mock', 'stub', 'testing'] },
      { content: '测试应覆盖正常路径、边界条件和异常场景。', type: 'testing', language: 'general', tags: ['coverage', 'boundary', 'testing'] },
      { content: '使用测试框架如Jest、Mocha、JUnit简化测试编写。', type: 'testing', language: 'general', tags: ['jest', 'mocha', 'junit', 'testing'] },
      { content: '代码覆盖率工具如Istanbul、JaCoCo帮助识别未覆盖的代码。', type: 'testing', language: 'general', tags: ['coverage', 'istanbul', 'jacoco'] },
      { content: '使用持续集成（CI）自动运行测试。', type: 'testing', language: 'general', tags: ['ci', 'cd', 'testing', 'automation'] },
      { content: '测试命名应清晰描述测试意图和预期结果。', type: 'testing', language: 'general', tags: ['naming', 'test', 'readability'] },
      { content: '避免测试实现细节，测试行为和接口。', type: 'testing', language: 'general', tags: ['behavior', 'interface', 'testing'] },
      { content: '使用参数化测试减少重复代码。', type: 'testing', language: 'general', tags: ['parameterized', 'testing', 'efficiency'] },
      
      // ===== 性能优化 =====
      { content: '使用性能分析工具（Chrome DevTools、Profiler）识别瓶颈。', type: 'performance', language: 'general', tags: ['profiler', 'performance', 'debugging'] },
      { content: '懒加载（Lazy Loading）非关键资源，加快首屏渲染。', type: 'performance', language: 'javascript', tags: ['lazy_loading', 'performance', 'frontend'] },
      { content: '图片优化：压缩、使用WebP/AVIF格式、响应式图片。', type: 'performance', language: 'general', tags: ['image', 'optimization', 'performance'] },
      { content: '代码分割（Code Splitting）减小打包体积。', type: 'performance', language: 'javascript', tags: ['code_splitting', 'bundling', 'performance'] },
      { content: '使用CDN加速静态资源分发。', type: 'performance', language: 'general', tags: ['cdn', 'static', 'performance'] },
      { content: '合理设置HTTP缓存头（Cache-Control、ETag）。', type: 'performance', language: 'general', tags: ['caching', 'http', 'performance'] },
      { content: '使用Service Worker实现离线缓存和PWA。', type: 'performance', language: 'javascript', tags: ['service_worker', 'pwa', 'caching'] },
      { content: '数据库连接使用连接池复用连接，避免频繁创建销毁。', type: 'performance', language: 'general', tags: ['connection_pool', 'database', 'performance'] },
      { content: '异步I/O避免阻塞主线程，提高并发性能。', type: 'performance', language: 'general', tags: ['async', 'non_blocking', 'performance'] },
      { content: '使用对象池（Object Pool）复用频繁创建销毁的对象。', type: 'performance', language: 'general', tags: ['object_pool', 'performance', 'memory'] },
      { content: '前端使用虚拟滚动（Virtual Scroll）处理大量列表数据。', type: 'performance', language: 'javascript', tags: ['virtual_scroll', 'list', 'performance'] },
      { content: '使用Web Worker处理CPU密集型任务，避免阻塞UI。', type: 'performance', language: 'javascript', tags: ['web_worker', 'cpu', 'ui_blocking'] },
      
      // ===== 代码评审 =====
      { content: '代码评审关注：正确性、可维护性、性能、安全性、测试覆盖。', type: 'code_review', language: 'general', tags: ['review', 'checklist', 'quality'] },
      { content: '使用TODO、FIXME、HACK标记待处理问题，但不应长期遗留。', type: 'code_review', language: 'general', tags: ['todo', 'fixme', 'hack', 'maintenance'] },
      { content: '遵循单一职责原则（SRP）：一个类/模块只做一件事。', type: 'code_review', language: 'general', tags: ['srp', 'single_responsibility', 'solid'] },
      { content: '遵循开闭原则（OCP）：对扩展开放，对修改关闭。', type: 'code_review', language: 'general', tags: ['ocp', 'open_closed', 'solid'] },
      { content: '遵循里氏替换原则（LSP）：子类型必须能替换其基类型。', type: 'code_review', language: 'general', tags: ['lsp', 'liskov_substitution', 'solid'] },
      { content: '遵循接口隔离原则（ISP）：客户端不应依赖它不需要的接口。', type: 'code_review', language: 'general', tags: ['isp', 'interface_segregation', 'solid'] },
      { content: '遵循依赖倒置原则（DIP）：依赖抽象，不依赖具体。', type: 'code_review', language: 'general', tags: ['dip', 'dependency_inversion', 'solid'] },
      
      // ===== 常见反模式 =====
      { content: '避免上帝类（God Object）：承担过多职责的类，应拆分为多个小类。', type: 'anti_pattern', language: 'general', tags: ['god_object', 'refactoring', 'design'] },
      { content: '避免过长方法（Long Method）：方法过长应拆分为多个子方法。', type: 'anti_pattern', language: 'general', tags: ['long_method', 'refactoring', 'maintainability'] },
      { content: '避免过长参数列表（Long Parameter List）：参数过多使用对象封装。', type: 'anti_pattern', language: 'general', tags: ['long_parameter', 'refactoring', 'api_design'] },
      { content: '避免过度继承（Refused Bequest）：子类不使用父类方法，应改用组合。', type: 'anti_pattern', language: 'general', tags: ['inheritance', 'composition', 'design'] },
      { content: '避免 Shotgun Surgery：一个变更需要修改多处代码，说明耦合度高。', type: 'anti_pattern', language: 'general', tags: ['shotgun_surgery', 'coupling', 'refactoring'] },
      { content: '避免代码异味（Code Smell）：重复代码、过长方法、过深嵌套等。', type: 'anti_pattern', language: 'general', tags: ['code_smell', 'refactoring', 'quality'] },
      { content: '避免魔法数字（Magic Number）：数字应提取为命名常量。', type: 'anti_pattern', language: 'general', tags: ['magic_number', 'constants', 'readability'] },
      { content: '避免不必要的复杂性（Unnecessary Complexity）：不要过度设计。', type: 'anti_pattern', language: 'general', tags: ['over_engineering', 'simplicity', 'kiss'] },
      { content: '避免过早优化（Premature Optimization）：先让代码工作，再优化。', type: 'anti_pattern', language: 'general', tags: ['premature_optimization', 'kiss', 'YAGNI'] },
      { content: '避免硬编码（Hardcoding）：使用配置、环境变量替代硬编码值。', type: 'anti_pattern', language: 'general', tags: ['hardcoding', 'configuration', 'maintainability'] },
      
      // ===== 网络与API =====
      { content: 'RESTful API使用HTTP方法语义：GET获取、POST创建、PUT更新、DELETE删除。', type: 'api_design', language: 'general', tags: ['rest', 'http', 'api'] },
      { content: 'API设计遵循版本化、幂等性、错误码规范。', type: 'api_design', language: 'general', tags: ['api', 'versioning', 'idempotency'] },
      { content: '使用JWT或OAuth 2.0进行API认证和授权。', type: 'api_design', language: 'general', tags: ['jwt', 'oauth', 'authentication'] },
      { content: '实现API限流（Rate Limiting）保护后端服务。', type: 'api_design', language: 'general', tags: ['rate_limit', 'api', 'protection'] },
      { content: '使用GraphQL提供灵活的API查询能力。', type: 'api_design', language: 'general', tags: ['graphql', 'api', 'query'] },
      { content: '使用WebSockets实现实时通信。', type: 'api_design', language: 'general', tags: ['websocket', 'realtime', 'communication'] },
      { content: '使用gRPC实现高性能的服务间通信。', type: 'api_design', language: 'general', tags: ['grpc', 'rpc', 'performance'] },
      { content: 'API文档使用OpenAPI/Swagger自动生成。', type: 'api_design', language: 'general', tags: ['openapi', 'swagger', 'documentation'] },
      
      // ===== 架构设计 =====
      { content: '微服务架构：将单体应用拆分为小的独立服务，通过API通信。', type: 'architecture', language: 'general', tags: ['microservices', 'soa', 'architecture'] },
      { content: '事件驱动架构：使用消息队列（Kafka、RabbitMQ）实现松耦合。', type: 'architecture', language: 'general', tags: ['event_driven', 'message_queue', 'architecture'] },
      { content: 'CQRS：命令查询职责分离，读写使用不同模型。', type: 'architecture', language: 'general', tags: ['cqrs', 'ddd', 'architecture'] },
      { content: 'DDD（领域驱动设计）：使用聚合根、值对象、限界上下文建模。', type: 'architecture', language: 'general', tags: ['ddd', 'domain_driven', 'architecture'] },
      { content: '六边形架构（Ports & Adapters）：核心业务与外部依赖解耦。', type: 'architecture', language: 'general', tags: ['hexagonal', 'ports_adapters', 'architecture'] },
      { content: '分层架构：表现层、业务层、数据访问层分离。', type: 'architecture', language: 'general', tags: ['layered', 'architecture', 'design'] },
      { content: '无状态设计：服务器不保存客户端状态，便于水平扩展。', type: 'architecture', language: 'general', tags: ['stateless', 'scalability', 'architecture'] },
      { content: 'CAP理论：一致性、可用性、分区容错性三者只能选二。', type: 'architecture', language: 'general', tags: ['cap', 'distributed', 'theory'] },
      
      // ===== 调试与诊断 =====
      { content: '使用日志分级（DEBUG、INFO、WARN、ERROR）合理记录信息。', type: 'debugging', language: 'general', tags: ['logging', 'log_level', 'monitoring'] },
      { content: '使用断点和调试器（Chrome DevTools、GDB）调试代码。', type: 'debugging', language: 'general', tags: ['debugger', 'breakpoint', 'debugging'] },
      { content: '使用核心转储（Core Dump）分析崩溃原因。', type: 'debugging', language: 'general', tags: ['core_dump', 'crash', 'debugging'] },
      { content: '使用性能计数器和追踪工具识别性能瓶颈。', type: 'debugging', language: 'general', tags: ['profiler', 'tracing', 'performance'] },
      { content: '使用内存分析工具（Memory Profiler）检测内存泄漏。', type: 'debugging', language: 'general', tags: ['memory_leak', 'profiler', 'debugging'] },
      { content: '使用分布式追踪（OpenTelemetry）分析微服务调用链。', type: 'debugging', language: 'general', tags: ['distributed_tracing', 'observability', 'monitoring'] },
      
      // ===== Ruby 最佳实践 =====
      { content: 'Ruby中使用块（Block）和迭代器简化集合操作。', type: 'best_practice', language: 'ruby', tags: ['block', 'iterator', 'ruby'] },
      { content: 'Ruby中使用符号（Symbol）作为不可变字符串键，性能更好。', type: 'best_practice', language: 'ruby', tags: ['symbol', 'hash', 'ruby'] },
      { content: 'Ruby中使用模块（Module）和类（Class）组织代码。', type: 'best_practice', language: 'ruby', tags: ['module', 'class', 'ruby'] },
      { content: 'Ruby中使用异常处理（begin/rescue/ensure）管理错误。', type: 'best_practice', language: 'ruby', tags: ['exception', 'rescue', 'ruby'] },
      { content: 'Ruby中使用Enumerable模块的方法（map、select、reduce等）。', type: 'best_practice', language: 'ruby', tags: ['enumerable', 'collection', 'ruby'] },
      { content: 'Ruby中使用Rails约定优于配置原则。', type: 'best_practice', language: 'ruby', tags: ['rails', 'convention', 'ruby'] },
      { content: 'Ruby中使用gem和bundler管理依赖。', type: 'best_practice', language: 'ruby', tags: ['gem', 'bundler', 'ruby', 'dependencies'] },
      { content: 'Ruby中使用RSpec或Minitest编写测试。', type: 'testing', language: 'ruby', tags: ['rspec', 'minitest', 'ruby', 'testing'] },
      { content: 'Ruby中使用do...end或{}定义代码块。', type: 'best_practice', language: 'ruby', tags: ['block', 'syntax', 'ruby'] },
      { content: 'Ruby中使用字符串插值#{}替代字符串拼接。', type: 'best_practice', language: 'ruby', tags: ['string_interpolation', 'ruby'] },
      
      // ===== PHP 最佳实践 =====
      { content: 'PHP中使用命名空间（Namespace）和自动加载（Autoload）组织代码。', type: 'best_practice', language: 'php', tags: ['namespace', 'autoload', 'php'] },
      { content: 'PHP中使用类型声明（Type Hints）提高代码可靠性。', type: 'best_practice', language: 'php', tags: ['type_hint', 'php', 'php7'] },
      { content: 'PHP中使用严格类型模式（declare(strict_types=1)）。', type: 'best_practice', language: 'php', tags: ['strict_types', 'php'] },
      { content: 'PHP中使用异常处理（try/catch/finally）管理错误。', type: 'best_practice', language: 'php', tags: ['exception', 'try_catch', 'php'] },
      { content: 'PHP中使用PDO操作数据库，防止SQL注入。', type: 'security', language: 'php', tags: ['pdo', 'sql_injection', 'php'] },
      { content: 'PHP中使用composer管理依赖。', type: 'best_practice', language: 'php', tags: ['composer', 'php', 'dependencies'] },
      { content: 'PHP中使用Laravel框架的MVC架构。', type: 'best_practice', language: 'php', tags: ['laravel', 'mvc', 'php', 'framework'] },
      { content: 'PHP中使用Eloquent ORM操作数据库。', type: 'best_practice', language: 'php', tags: ['eloquent', 'orm', 'laravel', 'php'] },
      { content: 'PHP中使用Blade模板引擎生成HTML。', type: 'best_practice', language: 'php', tags: ['blade', 'template', 'laravel', 'php'] },
      { content: 'PHP中避免使用mysql_*函数，使用mysqli或PDO。', type: 'best_practice', language: 'php', tags: ['mysqli', 'pdo', 'php', 'deprecated'] },
      
      // ===== Swift 最佳实践 =====
      { content: 'Swift中使用可选绑定（if let）安全处理可选值。', type: 'best_practice', language: 'swift', tags: ['optional', 'if_let', 'swift'] },
      { content: 'Swift中使用guard语句提前退出，减少嵌套。', type: 'best_practice', language: 'swift', tags: ['guard', 'early_return', 'swift'] },
      { content: 'Swift中使用协议（Protocol）定义契约和扩展功能。', type: 'best_practice', language: 'swift', tags: ['protocol', 'extension', 'swift'] },
      { content: 'Swift中使用值类型（Struct、Enum）优先于引用类型（Class）。', type: 'best_practice', language: 'swift', tags: ['struct', 'enum', 'value_type', 'swift'] },
      { content: 'Swift中使用闭包（Closure）捕获和传递代码块。', type: 'best_practice', language: 'swift', tags: ['closure', 'swift'] },
      { content: 'Swift中使用泛型（Generics）编写可重用代码。', type: 'best_practice', language: 'swift', tags: ['generics', 'swift'] },
      { content: 'Swift中使用错误处理（do/try/catch）。', type: 'best_practice', language: 'swift', tags: ['error_handling', 'do_catch', 'swift'] },
      { content: 'Swift中使用SwiftUI声明式UI框架。', type: 'best_practice', language: 'swift', tags: ['swiftui', 'ui', 'ios', 'swift'] },
      { content: 'Swift中使用Combine框架处理异步事件流。', type: 'best_practice', language: 'swift', tags: ['combine', 'reactive', 'swift'] },
      { content: 'Swift中遵循Swift API设计指南。', type: 'best_practice', language: 'swift', tags: ['api_design', 'convention', 'swift'] },
      
      // ===== Kotlin 最佳实践 =====
      { content: 'Kotlin中使用val声明不可变变量，var声明可变变量。', type: 'best_practice', language: 'kotlin', tags: ['val', 'var', 'kotlin'] },
      { content: 'Kotlin中使用空安全操作符（?.、?:、!!）处理空值。', type: 'best_practice', language: 'kotlin', tags: ['null_safety', 'kotlin'] },
      { content: 'Kotlin中使用data class自动生成equals、hashCode、toString。', type: 'best_practice', language: 'kotlin', tags: ['data_class', 'kotlin'] },
      { content: 'Kotlin中使用扩展函数（Extension Function）为类添加功能。', type: 'best_practice', language: 'kotlin', tags: ['extension_function', 'kotlin'] },
      { content: 'Kotlin中使用协程（Coroutine）处理异步操作。', type: 'best_practice', language: 'kotlin', tags: ['coroutine', 'async', 'kotlin'] },
      { content: 'Kotlin中使用Flow或StateFlow处理数据流。', type: 'best_practice', language: 'kotlin', tags: ['flow', 'reactive', 'kotlin'] },
      { content: 'Kotlin中使用sealed class实现受限的类层次结构。', type: 'best_practice', language: 'kotlin', tags: ['sealed_class', 'kotlin'] },
      { content: 'Kotlin中使用作用域函数（let、run、apply、also、with）。', type: 'best_practice', language: 'kotlin', tags: ['scope_function', 'kotlin'] },
      { content: 'Kotlin中使用Android Jetpack组件（ViewModel、LiveData、Room）。', type: 'best_practice', language: 'kotlin', tags: ['android', 'jetpack', 'kotlin'] },
      { content: 'Kotlin中使用Ktor或Spring Boot构建后端服务。', type: 'best_practice', language: 'kotlin', tags: ['ktor', 'spring_boot', 'kotlin'] },
      
      // ===== Rust 最佳实践 =====
      { content: 'Rust中使用所有权（Ownership）系统确保内存安全。', type: 'best_practice', language: 'rust', tags: ['ownership', 'memory_safety', 'rust'] },
      { content: 'Rust中使用借用（Borrowing）和生命周期（Lifetime）。', type: 'best_practice', language: 'rust', tags: ['borrowing', 'lifetime', 'rust'] },
      { content: 'Rust中使用Result类型处理错误，避免异常。', type: 'best_practice', language: 'rust', tags: ['result', 'error_handling', 'rust'] },
      { content: 'Rust中使用枚举（Enum）和模式匹配处理多种情况。', type: 'best_practice', language: 'rust', tags: ['enum', 'pattern_matching', 'rust'] },
      { content: 'Rust中使用trait定义接口，struct实现。', type: 'best_practice', language: 'rust', tags: ['trait', 'struct', 'rust'] },
      { content: 'Rust中使用Cargo管理项目和依赖。', type: 'best_practice', language: 'rust', tags: ['cargo', 'rust', 'dependencies'] },
      { content: 'Rust中使用Rc、Arc智能指针实现共享所有权。', type: 'best_practice', language: 'rust', tags: ['rc', 'arc', 'smart_pointer', 'rust'] },
      { content: 'Rust中使用mut关键字声明可变变量。', type: 'best_practice', language: 'rust', tags: ['mut', 'mutability', 'rust'] },
      { content: 'Rust中使用迭代器（Iterator）处理集合。', type: 'best_practice', language: 'rust', tags: ['iterator', 'rust'] },
      { content: 'Rust中使用Tokio或async-std进行异步编程。', type: 'best_practice', language: 'rust', tags: ['tokio', 'async', 'rust'] },
      
      // ===== C# 最佳实践 =====
      { content: 'C#中使用var关键字在明显的情况下简化类型声明。', type: 'best_practice', language: 'csharp', tags: ['var', 'type_inference', 'csharp'] },
      { content: 'C#中使用属性（Property）封装字段访问。', type: 'best_practice', language: 'csharp', tags: ['property', 'encapsulation', 'csharp'] },
      { content: 'C#中使用LINQ查询语法简化集合操作。', type: 'best_practice', language: 'csharp', tags: ['linq', 'query', 'csharp'] },
      { content: 'C#中使用async/await处理异步操作。', type: 'best_practice', language: 'csharp', tags: ['async', 'await', 'csharp'] },
      { content: 'C#中使用Nullable类型（T?）表示可能为null的值。', type: 'best_practice', language: 'csharp', tags: ['nullable', 'csharp'] },
      { content: 'C#中使用模式匹配（switch表达式、is运算符）。', type: 'best_practice', language: 'csharp', tags: ['pattern_matching', 'csharp'] },
      { content: 'C#中使用Record类型创建不可变数据类。', type: 'best_practice', language: 'csharp', tags: ['record', 'immutable', 'csharp'] },
      { content: 'C#中使用Span和Memory优化内存分配。', type: 'best_practice', language: 'csharp', tags: ['span', 'memory', 'performance', 'csharp'] },
      { content: 'C#中使用依赖注入（DI）容器管理服务。', type: 'best_practice', language: 'csharp', tags: ['dependency_injection', 'dotnet', 'csharp'] },
      { content: 'C#中使用ASP.NET Core构建Web应用。', type: 'best_practice', language: 'csharp', tags: ['asp_net_core', 'web', 'csharp'] },
      
      // ===== Lua 最佳实践 =====
      { content: 'Lua中使用table作为主要数据结构（数组、字典、对象）。', type: 'best_practice', language: 'lua', tags: ['table', 'data_structure', 'lua'] },
      { content: 'Lua中使用local声明局部变量，避免全局污染。', type: 'best_practice', language: 'lua', tags: ['local', 'scope', 'lua'] },
      { content: 'Lua中使用:调用方法，.访问属性。', type: 'best_practice', language: 'lua', tags: ['method', 'operator', 'lua'] },
      { content: 'Lua中使用coroutine实现协同程序。', type: 'best_practice', language: 'lua', tags: ['coroutine', 'concurrency', 'lua'] },
      { content: 'Lua中使用metatable和metamethod实现运算符重载。', type: 'best_practice', language: 'lua', tags: ['metatable', 'metamethod', 'lua'] },
      
      // ===== 前端深度知识 =====
      { content: 'CSS中使用Flexbox布局替代浮动，实现响应式设计。', type: 'best_practice', language: 'css', tags: ['flexbox', 'layout', 'css'] },
      { content: 'CSS中使用Grid布局实现复杂的二维布局。', type: 'best_practice', language: 'css', tags: ['grid', 'layout', 'css'] },
      { content: 'CSS中使用CSS变量（Custom Properties）提高可维护性。', type: 'best_practice', language: 'css', tags: ['css_variable', 'custom_property', 'css'] },
      { content: 'CSS中使用响应式设计（媒体查询、rem单位、vw/vh）。', type: 'best_practice', language: 'css', tags: ['responsive', 'media_query', 'css'] },
      { content: 'CSS中使用BEM命名规范组织类名。', type: 'best_practice', language: 'css', tags: ['bem', 'naming', 'css', 'scss'] },
      { content: 'CSS中避免使用!important，优先使用更高优先级的选择器。', type: 'best_practice', language: 'css', tags: ['important', 'specificity', 'css'] },
      { content: 'Sass/Less中使用变量、嵌套、混入（Mixin）减少重复。', type: 'best_practice', language: 'css', tags: ['sass', 'less', 'preprocessor', 'css'] },
      { content: 'HTML5中使用语义化标签（header、nav、main、article、section、footer）。', type: 'best_practice', language: 'html', tags: ['semantic', 'html5', 'html'] },
      { content: 'HTML中使用ARIA属性提高无障碍访问性。', type: 'best_practice', language: 'html', tags: ['aria', 'accessibility', 'html'] },
      { content: 'Webpack/Vite中使用代码分割（Code Splitting）优化打包。', type: 'performance', language: 'javascript', tags: ['webpack', 'vite', 'code_splitting'] },
      { content: 'Webpack/Vite中使用Tree Shaking移除未使用代码。', type: 'performance', language: 'javascript', tags: ['tree_shaking', 'bundler', 'webpack'] },
      { content: '使用WebAssembly（WASM）在浏览器中运行高性能代码。', type: 'performance', language: 'javascript', tags: ['wasm', 'webassembly', 'performance'] },
      { content: 'Service Worker实现离线缓存和PWA支持。', type: 'best_practice', language: 'javascript', tags: ['service_worker', 'pwa', 'offline'] },
      { content: 'Web Workers处理CPU密集型任务，避免阻塞主线程。', type: 'performance', language: 'javascript', tags: ['web_worker', 'cpu', 'performance'] },
      { content: '使用IndexedDB存储大量结构化数据。', type: 'best_practice', language: 'javascript', tags: ['indexeddb', 'storage', 'browser'] },
      { content: '使用WebSocket实现服务器推送和实时通信。', type: 'best_practice', language: 'javascript', tags: ['websocket', 'realtime', 'communication'] },
      { content: '使用requestAnimationFrame实现平滑动画。', type: 'performance', language: 'javascript', tags: ['requestAnimationFrame', 'animation', 'performance'] },
      { content: '使用IntersectionObserver实现图片懒加载。', type: 'performance', language: 'javascript', tags: ['intersection_observer', 'lazy_loading', 'performance'] },
      { content: '使用MutationObserver监听DOM变化。', type: 'best_practice', language: 'javascript', tags: ['mutation_observer', 'dom'] },
      { content: '使用PostMessage实现跨窗口安全通信。', type: 'best_practice', language: 'javascript', tags: ['postMessage', 'cross_window', 'security'] },
      
      // ===== 后端深度知识 =====
      { content: 'Node.js中使用事件循环（Event Loop）实现非阻塞I/O。', type: 'best_practice', language: 'javascript', tags: ['event_loop', 'nodejs', 'async'] },
      { content: 'Node.js中使用Stream处理大数据流，避免内存溢出。', type: 'performance', language: 'javascript', tags: ['stream', 'nodejs', 'memory'] },
      { content: 'Node.js中使用Buffer处理二进制数据。', type: 'best_practice', language: 'javascript', tags: ['buffer', 'binary', 'nodejs'] },
      { content: 'Node.js中使用Cluster或PM2实现多进程部署。', type: 'performance', language: 'javascript', tags: ['cluster', 'pm2', 'nodejs', 'deployment'] },
      { content: 'Node.js中使用Redis缓存热点数据，减少数据库压力。', type: 'performance', language: 'javascript', tags: ['redis', 'cache', 'nodejs'] },
      { content: 'Spring Boot中使用自动配置减少样板代码。', type: 'best_practice', language: 'java', tags: ['spring_boot', 'auto_config'] },
      { content: 'Spring Boot中使用Spring Security实现认证授权。', type: 'best_practice', language: 'java', tags: ['spring_security', 'authentication', 'authorization'] },
      { content: 'Spring Boot中使用Spring Data JPA简化数据访问。', type: 'best_practice', language: 'java', tags: ['spring_data', 'jpa', 'repository'] },
      { content: 'Django中使用中间件（Middleware）处理请求生命周期。', type: 'best_practice', language: 'python', tags: ['django', 'middleware', 'request'] },
      { content: 'Django中使用Django REST Framework构建RESTful API。', type: 'best_practice', language: 'python', tags: ['django_rest', 'api', 'restful'] },
      { content: 'Flask中使用蓝图（Blueprint）组织大型应用。', type: 'best_practice', language: 'python', tags: ['flask', 'blueprint', 'application_structure'] },
      { content: 'FastAPI中使用类型提示自动生成API文档。', type: 'best_practice', language: 'python', tags: ['fastapi', 'swagger', 'openapi'] },
      { content: '使用JWT（JSON Web Token）实现无状态认证。', type: 'security', language: 'general', tags: ['jwt', 'authentication', 'token'] },
      { content: '使用OAuth 2.0实现第三方登录。', type: 'security', language: 'general', tags: ['oauth2', 'authentication', 'sso'] },
      { content: '使用GraphQL提供灵活的API查询。', type: 'best_practice', language: 'general', tags: ['graphql', 'api', 'query'] },
      { content: '使用gRPC实现高性能服务间通信。', type: 'performance', language: 'general', tags: ['grpc', 'rpc', 'protobuf', 'performance'] },
      
      // ===== DevOps 与容器 =====
      { content: 'Docker中使用多阶段构建减小镜像体积。', type: 'best_practice', language: 'general', tags: ['docker', 'multi_stage', 'image_optimization'] },
      { content: 'Docker中使用.dockerignore排除不需要的文件。', type: 'best_practice', language: 'general', tags: ['docker', 'dockerignore', 'build'] },
      { content: 'Docker中使用 volumes 或 bind mounts 持久化数据。', type: 'best_practice', language: 'general', tags: ['docker', 'volume', 'persistence'] },
      { content: 'Kubernetes中使用Deployment管理应用副本。', type: 'best_practice', language: 'general', tags: ['kubernetes', 'deployment', 'orchestration'] },
      { content: 'Kubernetes中使用Service暴露应用端口。', type: 'best_practice', language: 'general', tags: ['kubernetes', 'service', 'networking'] },
      { content: 'Kubernetes中使用ConfigMap和Secret管理配置。', type: 'best_practice', language: 'general', tags: ['kubernetes', 'configmap', 'secret'] },
      { content: 'Kubernetes中使用Ingress管理外部访问。', type: 'best_practice', language: 'general', tags: ['kubernetes', 'ingress', 'routing'] },
      { content: 'CI/CD中使用GitHub Actions或GitLab CI自动化部署。', type: 'best_practice', language: 'general', tags: ['ci_cd', 'github_actions', 'gitlab_ci'] },
      { content: 'CI/CD中使用Docker Compose编排多个服务。', type: 'best_practice', language: 'general', tags: ['docker_compose', 'orchestration', 'ci_cd'] },
      { content: 'Nginx中使用gzip压缩减少传输体积。', type: 'performance', language: 'general', tags: ['nginx', 'gzip', 'compression'] },
      { content: 'Nginx中使用反向代理和负载均衡。', type: 'best_practice', language: 'general', tags: ['nginx', 'reverse_proxy', 'load_balancing'] },
      { content: 'Nginx中使用SSL/TLS配置HTTPS。', type: 'security', language: 'general', tags: ['nginx', 'ssl', 'https', 'tls'] },
      { content: '使用Prometheus和Grafana监控系统指标。', type: 'best_practice', language: 'general', tags: ['prometheus', 'grafana', 'monitoring'] },
      { content: '使用ELK Stack（Elasticsearch、Logstash、Kibana）收集日志。', type: 'best_practice', language: 'general', tags: ['elk', 'logging', 'monitoring'] },
      { content: '使用Jenkins或GitLab CI实现持续集成。', type: 'best_practice', language: 'general', tags: ['jenkins', 'gitlab_ci', 'ci'] },
      
      // ===== 移动端开发 =====
      { content: 'iOS中使用MVC/MVVM架构组织代码。', type: 'best_practice', language: 'swift', tags: ['ios', 'mvc', 'mvvm', 'architecture'] },
      { content: 'iOS中使用Auto Layout实现自适应界面。', type: 'best_practice', language: 'swift', tags: ['ios', 'auto_layout', 'ui'] },
      { content: 'iOS中使用CoreData或SwiftData持久化数据。', type: 'best_practice', language: 'swift', tags: ['ios', 'coredata', 'swiftdata', 'persistence'] },
      { content: 'Android中使用Activity和Fragment构建界面。', type: 'best_practice', language: 'kotlin', tags: ['android', 'activity', 'fragment'] },
      { content: 'Android中使用ViewModel和LiveData实现MVVM架构。', type: 'best_practice', language: 'kotlin', tags: ['android', 'viewmodel', 'livedata', 'mvvm'] },
      { content: 'Android中使用Room数据库持久化数据。', type: 'best_practice', language: 'kotlin', tags: ['android', 'room', 'database', 'persistence'] },
      { content: 'Flutter中使用Widget构建UI，状态管理用Provider或Riverpod。', type: 'best_practice', language: 'dart', tags: ['flutter', 'widget', 'state_management'] },
      { content: 'Flutter中使用Dart的const构造函数优化性能。', type: 'performance', language: 'dart', tags: ['flutter', 'const', 'performance'] },
      { content: 'React Native中使用StyleSheet.create优化样式。', type: 'best_practice', language: 'javascript', tags: ['react_native', 'stylesheet', 'mobile'] },
      { content: 'React Native中使用FlatList处理长列表。', type: 'performance', language: 'javascript', tags: ['react_native', 'flatlist', 'list', 'performance'] },
      
      // ===== 错误码与异常知识库 =====
      { content: 'JavaScript: TypeError - 操作值的类型不是预期类型。检查变量类型。', type: 'error_code', language: 'javascript', tags: ['type_error', 'exception', 'javascript'] },
      { content: 'JavaScript: ReferenceError - 引用了未声明的变量。检查变量声明。', type: 'error_code', language: 'javascript', tags: ['reference_error', 'exception', 'javascript'] },
      { content: 'JavaScript: SyntaxError - 代码语法错误。检查语法拼写。', type: 'error_code', language: 'javascript', tags: ['syntax_error', 'exception', 'javascript'] },
      { content: 'JavaScript: RangeError - 数值超出有效范围。检查数组长度、递归深度。', type: 'error_code', language: 'javascript', tags: ['range_error', 'exception', 'javascript'] },
      { content: 'Python: TypeError - 操作或函数应用于不适当类型的对象。', type: 'error_code', language: 'python', tags: ['type_error', 'exception', 'python'] },
      { content: 'Python: ValueError - 操作或函数接收到正确类型但不适当的值。', type: 'error_code', language: 'python', tags: ['value_error', 'exception', 'python'] },
      { content: 'Python: KeyError - 字典中找不到指定的键。使用.get()安全访问。', type: 'error_code', language: 'python', tags: ['key_error', 'dict', 'exception', 'python'] },
      { content: 'Python: IndexError - 序列索引超出范围。检查数组长度。', type: 'error_code', language: 'python', tags: ['index_error', 'exception', 'python'] },
      { content: 'HTTP 400 Bad Request - 请求格式错误或参数无效。', type: 'error_code', language: 'general', tags: ['http', '400', 'bad_request'] },
      { content: 'HTTP 401 Unauthorized - 未认证或认证失败。', type: 'error_code', language: 'general', tags: ['http', '401', 'unauthorized'] },
      { content: 'HTTP 403 Forbidden - 已认证但无权限访问资源。', type: 'error_code', language: 'general', tags: ['http', '403', 'forbidden'] },
      { content: 'HTTP 404 Not Found - 请求的资源不存在。', type: 'error_code', language: 'general', tags: ['http', '404', 'not_found'] },
      { content: 'HTTP 500 Internal Server Error - 服务器内部错误。', type: 'error_code', language: 'general', tags: ['http', '500', 'server_error'] },
      { content: 'HTTP 502 Bad Gateway - 网关或代理收到无效响应。', type: 'error_code', language: 'general', tags: ['http', '502', 'bad_gateway'] },
      { content: 'HTTP 503 Service Unavailable - 服务暂时不可用。', type: 'error_code', language: 'general', tags: ['http', '503', 'service_unavailable'] },
      { content: 'SQL: 1062 Duplicate Entry - 唯一键冲突。检查主键或唯一索引。', type: 'error_code', language: 'general', tags: ['sql', '1062', 'duplicate_entry'] },
      { content: 'SQL: 1054 Unknown Column - 列名不存在。检查表结构和字段名。', type: 'error_code', language: 'general', tags: ['sql', '1054', 'unknown_column'] },
      { content: 'SQL: 1146 Table Doesn\'t Exist - 表不存在。检查表名和数据库。', type: 'error_code', language: 'general', tags: ['sql', '1146', 'table_not_exist'] },
      
      // ===== API 速查 =====
      { content: 'Array: map() - 遍历数组每个元素，返回新数组：arr.map(item => item * 2)', type: 'api_reference', language: 'javascript', tags: ['array', 'map', 'functional'] },
      { content: 'Array: filter() - 过滤满足条件的元素：arr.filter(item => item > 0)', type: 'api_reference', language: 'javascript', tags: ['array', 'filter', 'functional'] },
      { content: 'Array: reduce() - 累积计算数组值：arr.reduce((sum, item) => sum + item, 0)', type: 'api_reference', language: 'javascript', tags: ['array', 'reduce', 'functional'] },
      { content: 'Array: find() - 查找第一个满足条件的元素：arr.find(item => item.id === 1)', type: 'api_reference', language: 'javascript', tags: ['array', 'find', 'search'] },
      { content: 'Array: some() - 检查是否至少有一个元素满足条件：arr.some(item => item > 0)', type: 'api_reference', language: 'javascript', tags: ['array', 'some', 'check'] },
      { content: 'Array: every() - 检查是否所有元素满足条件：arr.every(item => item.active)', type: 'api_reference', language: 'javascript', tags: ['array', 'every', 'check'] },
      { content: 'Array: includes() - 检查数组是否包含指定值：arr.includes(value)', type: 'api_reference', language: 'javascript', tags: ['array', 'includes', 'search'] },
      { content: 'String: startsWith() - 检查字符串是否以指定开头：str.startsWith("hello")', type: 'api_reference', language: 'javascript', tags: ['string', 'startsWith', 'check'] },
      { content: 'String: endsWith() - 检查字符串是否以指定结尾：str.endsWith(".js")', type: 'api_reference', language: 'javascript', tags: ['string', 'endsWith', 'check'] },
      { content: 'String: includes() - 检查字符串是否包含指定子串：str.includes("world")', type: 'api_reference', language: 'javascript', tags: ['string', 'includes', 'search'] },
      { content: 'Object: Object.keys() - 获取对象所有键：Object.keys(obj)', type: 'api_reference', language: 'javascript', tags: ['object', 'keys', 'iteration'] },
      { content: 'Object: Object.entries() - 获取对象所有键值对：Object.entries(obj)', type: 'api_reference', language: 'javascript', tags: ['object', 'entries', 'iteration'] },
      { content: 'Object: Object.assign() - 合并对象属性：Object.assign(target, source)', type: 'api_reference', language: 'javascript', tags: ['object', 'assign', 'merge'] },
      { content: 'Math: Math.max(...arr) - 获取数组最大值', type: 'api_reference', language: 'javascript', tags: ['math', 'max', 'utility'] },
      { content: 'Math: Math.min(...arr) - 获取数组最小值', type: 'api_reference', language: 'javascript', tags: ['math', 'min', 'utility'] },
      { content: 'Date: new Date().toISOString() - 获取ISO格式时间戳', type: 'api_reference', language: 'javascript', tags: ['date', 'iso_string', 'time'] },
      { content: 'Promise: Promise.all() - 并行执行多个异步操作', type: 'api_reference', language: 'javascript', tags: ['promise', 'all', 'async'] },
      { content: 'Promise: Promise.race() - 返回最先完成的Promise结果', type: 'api_reference', language: 'javascript', tags: ['promise', 'race', 'async'] },
      
      // ===== 正则表达式库 =====
      { content: '正则: 邮箱验证 - /^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$/', type: 'regex', language: 'general', tags: ['email', 'validation', 'regex'] },
      { content: '正则: URL匹配 - /^https?:\\/\\/[\\w.-]+\\.[\\w.-]+/', type: 'regex', language: 'general', tags: ['url', 'validation', 'regex'] },
      { content: '正则: 中国大陆手机号 - /^1[3-9]\\d{9}$/', type: 'regex', language: 'general', tags: ['phone', 'china', 'validation', 'regex'] },
      { content: '正则: IPv4地址 - /^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$/', type: 'regex', language: 'general', tags: ['ipv4', 'ip', 'validation', 'regex'] },
      { content: '正则: 日期格式YYYY-MM-DD - /^\\d{4}-\\d{2}-\\d{2}$/', type: 'regex', language: 'general', tags: ['date', 'format', 'validation', 'regex'] },
      { content: '正则: 时间格式HH:mm:ss - /^\\d{2}:\\d{2}:\\d{2}$/', type: 'regex', language: 'general', tags: ['time', 'format', 'validation', 'regex'] },
      { content: '正则: HTML标签去除 - /<[^>]*>/g', type: 'regex', language: 'general', tags: ['html', 'strip_tags', 'regex'] },
      { content: '正则: 空白字符匹配 - /\\s+/g', type: 'regex', language: 'general', tags: ['whitespace', 'trim', 'regex'] },
      { content: '正则: 中文字符匹配 - /[\\u4e00-\\u9fa5]/g', type: 'regex', language: 'general', tags: ['chinese', 'unicode', 'regex'] },
      { content: '正则: 金额格式 - /^\\d+(\\.\\d{1,2})?$/', type: 'regex', language: 'general', tags: ['money', 'decimal', 'validation', 'regex'] },
      
      // ===== 代码片段库 =====
      { content: '防抖函数(JavaScript): const debounce = (fn, delay) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; };', type: 'code_snippet', language: 'javascript', tags: ['debounce', 'performance', 'utility'] },
      { content: '节流函数(JavaScript): const throttle = (fn, limit) => { let inThrottle; return (...args) => { if (!inThrottle) { fn(...args); inThrottle = true; setTimeout(() => inThrottle = false, limit); } }; };', type: 'code_snippet', language: 'javascript', tags: ['throttle', 'performance', 'utility'] },
      { content: '深拷贝(JavaScript): const deepClone = (obj) => { if (typeof obj !== "object" || obj === null) return obj; return Array.isArray(obj) ? obj.map(deepClone) : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deepClone(v)])); };', type: 'code_snippet', language: 'javascript', tags: ['deep_clone', 'utility', 'copy'] },
      { content: '格式化金额(JavaScript): const formatMoney = (num) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(num);', type: 'code_snippet', language: 'javascript', tags: ['format', 'currency', 'utility'] },
      { content: '验证邮箱(JavaScript): const isValidEmail = (email) => /^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$/.test(email);', type: 'code_snippet', language: 'javascript', tags: ['validation', 'email', 'utility'] },
      { content: '本地存储封装(JavaScript): const storage = { get: (k) => JSON.parse(localStorage.getItem(k)), set: (k, v) => localStorage.setItem(k, JSON.stringify(v)), remove: (k) => localStorage.removeItem(k) };', type: 'code_snippet', language: 'javascript', tags: ['localStorage', 'storage', 'utility'] },
      { content: '请求封装(JavaScript): const request = async (url, options = {}) => { const res = await fetch(url, { headers: { "Content-Type": "application/json", ...options.headers }, ...options }); return res.json(); };', type: 'code_snippet', language: 'javascript', tags: ['fetch', 'http', 'utility'] },
      { content: '重试函数(JavaScript): const retry = async (fn, maxRetries = 3, delay = 1000) => { for (let i = 0; i < maxRetries; i++) { try { return await fn(); } catch (e) { if (i === maxRetries - 1) throw e; await new Promise(resolve => setTimeout(resolve, delay)); } } };', type: 'code_snippet', language: 'javascript', tags: ['retry', 'error_handling', 'utility'] },
      { content: '节流函数(Python): import time; def throttle(fn, limit): last_call = 0; def wrapper(*args, **kwargs): nonlocal last_call; now = time.time(); if now - last_call >= limit: last_call = now; return fn(*args, **kwargs); return wrapper', type: 'code_snippet', language: 'python', tags: ['throttle', 'performance', 'utility'] },
      { content: '单例模式(Python): class Singleton: _instance = None; def __new__(cls): if cls._instance is None: cls._instance = super().__new__(cls); return cls._instance', type: 'code_snippet', language: 'python', tags: ['singleton', 'design_pattern', 'utility'] },
      
      // ===== 系统设计模式 =====
      { content: '微服务架构: 将单体应用拆分为小型独立服务，通过API通信，每个服务独立部署和扩展。', type: 'architecture', language: 'general', tags: ['microservices', 'architecture', 'design'] },
      { content: '事件驱动架构: 基于事件的异步通信，服务间通过消息队列解耦。', type: 'architecture', language: 'general', tags: ['event_driven', 'architecture', 'async'] },
      { content: 'CQRS: 命令查询职责分离，写操作和读操作使用不同的模型和存储。', type: 'architecture', language: 'general', tags: ['cqrs', 'architecture', 'pattern'] },
      { content: 'Event Sourcing: 将状态变更存储为事件序列，可重放事件重建状态。', type: 'architecture', language: 'general', tags: ['event_sourcing', 'architecture', 'pattern'] },
      { content: '六边形架构(Ports & Adapters): 将核心业务逻辑与外部依赖解耦，通过端口适配器。', type: 'architecture', language: 'general', tags: ['hexagonal', 'clean_architecture', 'design'] },
      { content: '洋葱架构: 从内到外依次为：领域层、服务层、接口层、基础设施层。', type: 'architecture', language: 'general', tags: ['onion_architecture', 'clean_architecture'] },
      { content: '分层架构: 表现层、业务逻辑层、数据访问层、数据存储层分离。', type: 'architecture', language: 'general', tags: ['layered', 'architecture', 'design'] },
      { content: '服务网格(Service Mesh): 通过sidecar代理管理服务间通信、负载均衡、熔断。', type: 'architecture', language: 'general', tags: ['service_mesh', 'istio', 'envoy'] },
      { content: 'Serverless架构: 按需执行代码，无需管理服务器，按实际使用量付费。', type: 'architecture', language: 'general', tags: ['serverless', 'faas', 'cloud'] },
      { content: '单体架构(Modular Monolith): 模块化的单体应用，未来可平滑迁移到微服务。', type: 'architecture', language: 'general', tags: ['monolith', 'modular', 'architecture'] },
      
      // ===== 云服务与基础设施 =====
      { content: 'AWS S3: 对象存储服务，提供高可用、可扩展的文件存储。', type: 'cloud', language: 'general', tags: ['aws', 's3', 'storage', 'cloud'] },
      { content: 'AWS EC2: 弹性计算云，提供可配置的计算容量。', type: 'cloud', language: 'general', tags: ['aws', 'ec2', 'compute', 'cloud'] },
      { content: 'AWS Lambda: 无服务器计算，按请求次数计费。', type: 'cloud', language: 'general', tags: ['aws', 'lambda', 'serverless', 'cloud'] },
      { content: 'AWS RDS: 关系型数据库服务，支持MySQL、PostgreSQL等。', type: 'cloud', language: 'general', tags: ['aws', 'rds', 'database', 'cloud'] },
      { content: 'AWS DynamoDB: 无服务器NoSQL数据库，自动扩缩容。', type: 'cloud', language: 'general', tags: ['aws', 'dynamodb', 'nosql', 'cloud'] },
      { content: 'AWS CloudFront: 内容分发网络，加速静态资源访问。', type: 'cloud', language: 'general', tags: ['aws', 'cloudfront', 'cdn', 'cloud'] },
      { content: 'AWS API Gateway: RESTful和WebSocket API托管服务。', type: 'cloud', language: 'general', tags: ['aws', 'api_gateway', 'cloud'] },
      { content: 'Azure Functions: 事件驱动的无服务器计算服务。', type: 'cloud', language: 'general', tags: ['azure', 'functions', 'serverless', 'cloud'] },
      { content: 'GCP Cloud Run: 无服务器容器运行服务。', type: 'cloud', language: 'general', tags: ['gcp', 'cloud_run', 'serverless', 'cloud'] },
      { content: '阿里云OSS: 对象存储服务，支持海量、安全、低成本。', type: 'cloud', language: 'general', tags: ['aliyun', 'oss', 'storage', 'cloud'] },
      
      // ===== 测试模式与实践 =====
      { content: '单元测试: 测试单个函数或模块，不依赖外部系统。', type: 'testing', language: 'general', tags: ['unit_test', 'testing', 'isolated'] },
      { content: '集成测试: 测试多个模块协同工作。', type: 'testing', language: 'general', tags: ['integration_test', 'testing', 'integration'] },
      { content: '端到端测试(E2E): 模拟真实用户操作，测试完整流程。', type: 'testing', language: 'general', tags: ['e2e_test', 'testing', 'cypress', 'playwright'] },
      { content: 'TDD(测试驱动开发): 先编写测试，再实现功能。', type: 'testing', language: 'general', tags: ['tdd', 'testing', 'development_process'] },
      { content: 'Mocking: 使用模拟对象替代真实依赖。', type: 'testing', language: 'general', tags: ['mocking', 'testing', 'jest', 'mocha'] },
      { content: 'Patching: 替换被测对象的方法或属性。', type: 'testing', language: 'general', tags: ['patching', 'testing', 'monkey_patch'] },
      { content: '测试覆盖率: 衡量代码被测试覆盖的百分比，目标80%+。', type: 'testing', language: 'general', tags: ['coverage', 'testing', 'code_quality'] },
      { content: '参数化测试: 使用不同参数运行同一测试逻辑。', type: 'testing', language: 'general', tags: ['parameterized', 'testing', 'data_driven'] },
      { content: '测试夹具(Fixture): 为测试提供固定的测试数据。', type: 'testing', language: 'general', tags: ['fixture', 'testing', 'test_data'] },
      { content: '断言(Assertion): 验证代码输出是否符合预期。', type: 'testing', language: 'general', tags: ['assertion', 'testing', 'validation'] },
      { content: 'Jest: Facebook出品的JavaScript测试框架。', type: 'testing', language: 'javascript', tags: ['jest', 'testing', 'framework'] },
      { content: 'Pytest: Python生态最流行的测试框架。', type: 'testing', language: 'python', tags: ['pytest', 'testing', 'framework'] },
      { content: 'JUnit: Java生态最常用的单元测试框架。', type: 'testing', language: 'java', tags: ['junit', 'testing', 'framework'] },
      { content: 'Mocha/Chai: Node.js灵活的测试框架和断言库。', type: 'testing', language: 'javascript', tags: ['mocha', 'chai', 'testing', 'framework'] },
      { content: 'Cypress: 前端端到端测试框架。', type: 'testing', language: 'javascript', tags: ['cypress', 'e2e', 'testing', 'framework'] },
      
      // ===== 更多设计模式 =====
      { content: '建造者模式(Builder): 分步骤构建复杂对象，可选参数使用setter。', type: 'design_pattern', language: 'general', tags: ['builder', 'creational', 'design_pattern'] },
      { content: '原型模式(Prototype): 通过克隆已有对象创建新对象。', type: 'design_pattern', language: 'general', tags: ['prototype', 'creational', 'design_pattern'] },
      { content: '工厂方法(Factory Method): 定义创建对象的接口，由子类决定实例化哪个类。', type: 'design_pattern', language: 'general', tags: ['factory_method', 'creational', 'design_pattern'] },
      { content: '抽象工厂(Abstract Factory): 创建相关产品族的工厂接口。', type: 'design_pattern', language: 'general', tags: ['abstract_factory', 'creational', 'design_pattern'] },
      { content: '适配器模式(Adapter): 将一个类的接口转换为客户端期望的接口。', type: 'design_pattern', language: 'general', tags: ['adapter', 'structural', 'design_pattern'] },
      { content: '桥接模式(Bridge): 将抽象部分与实现部分分离。', type: 'design_pattern', language: 'general', tags: ['bridge', 'structural', 'design_pattern'] },
      { content: '组合模式(Composite): 将对象组合成树状结构表示整体与部分。', type: 'design_pattern', language: 'general', tags: ['composite', 'structural', 'design_pattern'] },
      { content: '装饰器模式(Decorator): 动态地给对象添加额外的职责。', type: 'design_pattern', language: 'general', tags: ['decorator', 'structural', 'design_pattern'] },
      { content: '外观模式(Facade): 为子系统提供统一的简化接口。', type: 'design_pattern', language: 'general', tags: ['facade', 'structural', 'design_pattern'] },
      { content: '享元模式(Flyweight): 共享对象以减少内存使用。', type: 'design_pattern', language: 'general', tags: ['flyweight', 'structural', 'design_pattern'] },
      { content: '代理模式(Proxy): 为对象提供代理以控制访问。', type: 'design_pattern', language: 'general', tags: ['proxy', 'structural', 'design_pattern'] },
      { content: '职责链(Chain of Responsibility): 将请求沿处理链传递。', type: 'design_pattern', language: 'general', tags: ['chain_of_responsibility', 'behavioral', 'design_pattern'] },
      { content: '命令模式(Command): 将请求封装为对象，支持撤销。', type: 'design_pattern', language: 'general', tags: ['command', 'behavioral', 'design_pattern'] },
      { content: '迭代器模式(Iterator): 提供遍历集合的方式，不暴露内部表示。', type: 'design_pattern', language: 'general', tags: ['iterator', 'behavioral', 'design_pattern'] },
      { content: '中介者模式(Mediator): 用中介对象封装一系列对象交互。', type: 'design_pattern', language: 'general', tags: ['mediator', 'behavioral', 'design_pattern'] },
      { content: '备忘录模式(Memento): 保存对象状态以便恢复。', type: 'design_pattern', language: 'general', tags: ['memento', 'behavioral', 'design_pattern'] },
      { content: '观察者模式(Observer): 定义一对多的依赖关系。', type: 'design_pattern', language: 'general', tags: ['observer', 'behavioral', 'design_pattern'] },
      { content: '状态模式(State): 允许对象在内部状态变化时改变行为。', type: 'design_pattern', language: 'general', tags: ['state', 'behavioral', 'design_pattern'] },
      { content: '策略模式(Strategy): 定义算法族，分别封装，互相可替换。', type: 'design_pattern', language: 'general', tags: ['strategy', 'behavioral', 'design_pattern'] },
      { content: '模板方法(Template Method): 在父类定义算法骨架，子类实现细节。', type: 'design_pattern', language: 'general', tags: ['template_method', 'behavioral', 'design_pattern'] },
      { content: '访问者模式(Visitor): 为对象结构中的元素定义新操作。', type: 'design_pattern', language: 'general', tags: ['visitor', 'behavioral', 'design_pattern'] },
      
      // ===== 分布式系统知识 =====
      { content: 'CAP定理: 一致性、可用性、分区容错性三者只能取二。', type: 'distributed', language: 'general', tags: ['cap', 'theory', 'distributed'] },
      { content: 'BASE理论: 基本可用、软状态、最终一致性。', type: 'distributed', language: 'general', tags: ['base', 'theory', 'distributed'] },
      { content: '一致性哈希: 特殊哈希函数，解决分布式缓存节点变化时的数据重分布。', type: 'distributed', language: 'general', tags: ['consistent_hashing', 'distributed', 'caching'] },
      { content: 'Raft算法: 分布式一致性协议，用于Leader选举和日志复制。', type: 'distributed', language: 'general', tags: ['raft', 'consensus', 'distributed'] },
      { content: 'Paxos算法: 分布式系统共识协议。', type: 'distributed', language: 'general', tags: ['paxos', 'consensus', 'distributed'] },
      { content: '两阶段提交(2PC): 分布式事务协议。', type: 'distributed', language: 'general', tags: ['2pc', 'transaction', 'distributed'] },
      { content: '三阶段提交(3PC): 在2PC基础上改进的分布式事务协议。', type: 'distributed', language: 'general', tags: ['3pc', 'transaction', 'distributed'] },
      { content: 'Saga模式: 管理分布式事务的长事务模式。', type: 'distributed', language: 'general', tags: ['saga', 'long_running', 'transaction'] },
      { content: '幂等性: 同一操作执行多次与执行一次效果相同。', type: 'distributed', language: 'general', tags: ['idempotency', 'api', 'design'] },
      { content: '最终一致性: 经过一段时间后所有节点数据达到一致状态。', type: 'distributed', language: 'general', tags: ['eventual_consistency', 'distributed'] },
      
      // ===== 缓存策略 =====
      { content: 'Cache-Aside模式: 应用先查缓存，miss再查数据库并回填缓存。', type: 'caching', language: 'general', tags: ['cache_aside', 'caching', 'pattern'] },
      { content: 'Read-Through模式: 由缓存组件负责加载数据。', type: 'caching', language: 'general', tags: ['read_through', 'caching', 'pattern'] },
      { content: 'Write-Through模式: 写操作同时写入缓存和数据库。', type: 'caching', language: 'general', tags: ['write_through', 'caching', 'pattern'] },
      { content: 'Write-Behind模式: 先写缓存，稍后异步写数据库。', type: 'caching', language: 'general', tags: ['write_behind', 'caching', 'pattern'] },
      { content: '缓存穿透: 查询不存在的数据，绕过缓存直接查询数据库。解决方案:布隆过滤器。', type: 'caching', language: 'general', tags: ['cache_penetration', 'caching', 'problem'] },
      { content: '缓存击穿: 热点key过期瞬间大量请求直接打到数据库。解决方案:互斥锁。', type: 'caching', language: 'general', tags: ['cache_breakdown', 'caching', 'problem'] },
      { content: '缓存雪崩: 大量key同时过期或缓存服务宕机。解决方案:随机过期时间。', type: 'caching', language: 'general', tags: ['cache_avalanche', 'caching', 'problem'] },
      { content: 'Redis: 高性能内存数据库，支持多种数据结构。', type: 'caching', language: 'general', tags: ['redis', 'cache', 'nosql'] },
      { content: 'Memcached: 分布式内存对象缓存系统。', type: 'caching', language: 'general', tags: ['memcached', 'cache', 'distributed'] },
      { content: 'CDN缓存: 边缘节点缓存静态资源，减少源站压力。', type: 'caching', language: 'general', tags: ['cdn', 'cache', 'edge'] },
      
      // ===== 数据库优化深度 =====
      { content: '聚簇索引: 数据行物理顺序与索引顺序一致，InnoDB主键索引。', type: 'database', language: 'general', tags: ['clustered_index', 'mysql', 'index'] },
      { content: '非聚簇索引: 索引存储主键值，需要回表查询。', type: 'database', language: 'general', tags: ['non_clustered', 'mysql', 'index'] },
      { content: '覆盖索引: 查询所需字段全部在索引中，无需回表。', type: 'database', language: 'general', tags: ['covering_index', 'mysql', 'optimization'] },
      { content: '最左前缀原则: 联合索引(a,b,c)只能匹配a、ab、abc，不能匹配b或bc。', type: 'database', language: 'general', tags: ['leftmost_prefix', 'mysql', 'index'] },
      { content: 'Explain分析: 使用EXPLAIN查看SQL执行计划，诊断性能问题。', type: 'database', language: 'general', tags: ['explain', 'mysql', 'optimization'] },
      { content: '慢查询日志: 记录执行时间超过阈值的SQL语句。', type: 'database', language: 'general', tags: ['slow_query', 'mysql', 'logging'] },
      { content: '分库分表: 水平拆分数据库和表以提升性能。', type: 'database', language: 'general', tags: ['shard', 'sharding', 'database', 'scalability'] },
      { content: '读写分离: 主库写、从库读，分散数据库压力。', type: 'database', language: 'general', tags: ['read_write_split', 'database', 'scalability'] },
      { content: '连接池: 复用数据库连接，减少连接开销。', type: 'database', language: 'general', tags: ['connection_pool', 'database', 'performance'] },
      { content: '事务隔离级别: 读未提交、读已提交、可重复读、串行化。', type: 'database', language: 'general', tags: ['transaction', 'isolation', 'acid'] },
      { content: '数据库范式: 1NF、2NF、3NF减少数据冗余。', type: 'database', language: 'general', tags: ['normalization', 'database', 'design'] },
      { content: '反范式化: 适度冗余数据以提升查询性能。', type: 'database', language: 'general', tags: ['denormalization', 'database', 'performance'] },
      
      // ===== 更多API与框架知识 =====
      { content: 'RESTful API设计: 使用HTTP方法(GET/POST/PUT/DELETE)操作资源。', type: 'api_design', language: 'general', tags: ['rest', 'api', 'http'] },
      { content: 'API版本控制: URL版本(/v1/)或Header版本(Accept)。', type: 'api_design', language: 'general', tags: ['versioning', 'api', 'evolution'] },
      { content: 'API限流: 防止API滥用，保护后端服务。常用算法:令牌桶、漏桶。', type: 'api_design', language: 'general', tags: ['rate_limiting', 'api', 'protection'] },
      { content: 'API文档: 使用Swagger/OpenAPI生成交互式文档。', type: 'api_design', language: 'general', tags: ['swagger', 'openapi', 'documentation'] },
      { content: 'GraphQL Schema: 定义类型系统，描述API的结构和功能。', type: 'api_design', language: 'general', tags: ['graphql', 'schema', 'api'] },
      { content: 'Webhook: 事件驱动的回调机制，用于系统间通知。', type: 'api_design', language: 'general', tags: ['webhook', 'callback', 'integration'] },
      { content: 'HATEOAS: 超媒体驱动的REST API。', type: 'api_design', language: 'general', tags: ['hateoas', 'rest', ' Richardson'] },
      { content: 'CORS: 跨域资源共享，控制跨域请求。', type: 'api_design', language: 'general', tags: ['cors', 'cross_origin', 'web'] },
      
      // ===== 安全深度知识 =====
      { content: 'OWASP Top 10: 十大Web应用安全风险。', type: 'security', language: 'general', tags: ['owasp', 'security', 'web'] },
      { content: 'CSRF防护: 使用Token验证请求来源。', type: 'security', language: 'general', tags: ['csrf', 'security', 'token'] },
      { content: 'CSP(内容安全策略): 限制页面可加载的资源来源。', type: 'security', language: 'general', tags: ['csp', 'security', 'xss'] },
      { content: 'HSTS: 强制使用HTTPS，防止SSL剥离攻击。', type: 'security', language: 'general', tags: ['hsts', 'security', 'https'] },
      { content: 'Clickjacking防护: 使用X-Frame-Options防止点击劫持。', type: 'security', language: 'general', tags: ['clickjacking', 'security', 'x_frame'] },
      { content: 'SSRF防护: 验证URL白名单，防止服务器端请求伪造。', type: 'security', language: 'general', tags: ['ssrf', 'security', 'validation'] },
      { content: '路径遍历防护: 规范化路径，验证文件路径白名单。', type: 'security', language: 'general', tags: ['path_traversal', 'security', 'file'] },
      { content: '命令注入防护: 避免拼接shell命令，使用API。', type: 'security', language: 'general', tags: ['command_injection', 'security', 'shell'] },
      { content: '反序列化漏洞: 使用安全的序列化格式，避免自动反序列化。', type: 'security', language: 'general', tags: ['deserialization', 'security', 'injection'] },
      { content: '敏感数据加密: 使用AES-256加密存储敏感信息。', type: 'security', language: 'general', tags: ['encryption', 'aes', 'data_protection'] },
      { content: 'TLS/SSL配置: 正确配置HTTPS证书和加密套件。', type: 'security', language: 'general', tags: ['tls', 'ssl', 'https', 'certificate'] },
      { content: '密钥管理: 使用HSM或云KMS管理加密密钥。', type: 'security', language: 'general', tags: ['key_management', 'kms', 'hsm'] },
      
      // ===== 代码质量与重构 =====
      { content: '圈复杂度: 衡量函数逻辑复杂度，建议不超过10。', type: 'code_quality', language: 'general', tags: ['cyclomatic_complexity', 'code_quality', 'metric'] },
      { content: '认知复杂度: 衡量代码阅读和理解的难度。', type: 'code_quality', language: 'general', tags: ['cognitive_complexity', 'code_quality', 'metric'] },
      { content: '代码覆盖率: 行覆盖率、分支覆盖率、路径覆盖率。', type: 'code_quality', language: 'general', tags: ['coverage', 'code_quality', 'metric'] },
      { content: '代码重复率: 超过5%需要重构。', type: 'code_quality', language: 'general', tags: ['duplication', 'code_quality', 'metric'] },
      { content: '代码异味(Code Smell): 潜在问题的代码特征。', type: 'code_quality', language: 'general', tags: ['code_smell', 'refactoring'] },
      { content: '重构手法: 提取方法、内联方法、移动方法、重命名等。', type: 'refactoring', language: 'general', tags: ['refactoring', 'technique', 'clean_code'] },
      { content: 'SOLID原则: 单一职责、开闭、里氏替换、接口隔离、依赖倒置。', type: 'code_quality', language: 'general', tags: ['solid', 'principles', 'design'] },
      { content: 'DRY原则: 不要重复自己。', type: 'code_quality', language: 'general', tags: ['dry', 'principles', 'design'] },
      { content: 'KISS原则: 保持简单。', type: 'code_quality', language: 'general', tags: ['kiss', 'principles', 'design'] },
      { content: 'YAGNI原则: 不需要的不要实现。', type: 'code_quality', language: 'general', tags: ['yagni', 'principles', 'agile'] },
      
      // ===== 更多代码片段 =====
      { content: '深拷贝(通用): function deepClone(obj) { if (obj === null || typeof obj !== "object") return obj; if (Array.isArray(obj)) return obj.map(deepClone); const clone = {}; for (const key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) clone[key] = deepClone(obj[key]); } return clone; }', type: 'code_snippet', language: 'javascript', tags: ['deep_clone', 'utility', 'copy'] },
      { content: '节流函数(JS简化版): function throttle(fn, wait) { let last = 0; return function(...args) { const now = Date.now(); if (now - last >= wait) { fn.apply(this, args); last = now; } }; }', type: 'code_snippet', language: 'javascript', tags: ['throttle', 'performance', 'utility'] },
      { content: '深合并对象(JS): function deepMerge(target, source) { for (const key of Object.keys(source)) { if (source[key] && typeof source[key] === "object") { target[key] = deepMerge(target[key] || {}, source[key]); } else { target[key] = source[key]; } } return target; }', type: 'code_snippet', language: 'javascript', tags: ['deep_merge', 'utility', 'object'] },
      { content: '随机字符串生成(JS): function randomString(length = 16) { const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); }', type: 'code_snippet', language: 'javascript', tags: ['random', 'string', 'utility'] },
      { content: 'UUID生成(v4): function uuid() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); }); }', type: 'code_snippet', language: 'javascript', tags: ['uuid', 'generator', 'utility'] },
      { content: '分页函数(JS): function paginate(array, page, pageSize) { const start = (page - 1) * pageSize; return { data: array.slice(start, start + pageSize), total: array.length, page, pageSize, totalPages: Math.ceil(array.length / pageSize) }; }', type: 'code_snippet', language: 'javascript', tags: ['pagination', 'utility', 'array'] },
      { content: 'CSV解析(简化版): function parseCSV(str) { return str.split("\\n").map(row => row.split(",").map(cell => cell.trim())); }', type: 'code_snippet', language: 'javascript', tags: ['csv', 'parser', 'utility'] },
      { content: '颜色格式转换: function hexToRgb(hex) { const result = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex); return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null; }', type: 'code_snippet', language: 'javascript', tags: ['color', 'conversion', 'utility'] },
      { content: '睡眠函数(JS): const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));', type: 'code_snippet', language: 'javascript', tags: ['sleep', 'async', 'utility'] },
      { content: '文件上传进度: const upload = async (file, onProgress) => { return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.upload.onprogress = (e) => onProgress((e.loaded / e.total) * 100); xhr.onload = () => resolve(xhr.response); xhr.onerror = reject; xhr.open("POST", "/api/upload"); xhr.setRequestHeader("Content-Type", file.type); xhr.send(file); }); };', type: 'code_snippet', language: 'javascript', tags: ['upload', 'progress', 'utility'] },
      
      // ===== 更多 Go 知识 =====
      { content: 'Go中使用defer确保资源释放。', type: 'best_practice', language: 'go', tags: ['defer', 'resource_management', 'go'] },
      { content: 'Go中使用context包传递请求范围的元数据。', type: 'best_practice', language: 'go', tags: ['context', 'go', 'metadata'] },
      { content: 'Go中使用sync.WaitGroup等待goroutine完成。', type: 'best_practice', language: 'go', tags: ['waitgroup', 'concurrency', 'go'] },
      { content: 'Go中使用channel在goroutine间通信。', type: 'best_practice', language: 'go', tags: ['channel', 'communication', 'concurrency'] },
      { content: 'Go中使用select处理多个channel操作。', type: 'best_practice', language: 'go', tags: ['select', 'channel', 'concurrency'] },
      { content: 'Go中使用interface{}或any表示任意类型。', type: 'best_practice', language: 'go', tags: ['interface', 'any', 'type', 'go'] },
      { content: 'Go中使用struct标签定义序列化规则。', type: 'best_practice', language: 'go', tags: ['struct_tag', 'serialization', 'json'] },
      { content: 'Go中使用panic和recover处理运行时异常。', type: 'best_practice', language: 'go', tags: ['panic', 'recover', 'error_handling'] },
      { content: 'Go中使用gorm或sqlx简化数据库操作。', type: 'best_practice', language: 'go', tags: ['gorm', 'sqlx', 'orm', 'database'] },
      { content: 'Go中使用net/http包构建HTTP服务。', type: 'best_practice', language: 'go', tags: ['net_http', 'web', 'server'] },
      
      // ===== 更多 Rust 知识 =====
      { content: 'Rust中使用Arc<Mutex<T>>在多线程间共享可变数据。', type: 'best_practice', language: 'rust', tags: ['arc', 'mutex', 'concurrency', 'rust'] },
      { content: 'Rust中使用Vec<T>存储可变长度序列。', type: 'best_practice', language: 'rust', tags: ['vec', 'collection', 'rust'] },
      { content: 'Rust中使用HashMap<K,V>存储键值对。', type: 'best_practice', language: 'rust', tags: ['hashmap', 'collection', 'rust'] },
      { content: 'Rust中使用Option<T>处理可能为null的值。', type: 'best_practice', language: 'rust', tags: ['option', 'null_safety', 'rust'] },
      { content: 'Rust中使用match表达式进行模式匹配。', type: 'best_practice', language: 'rust', tags: ['match', 'pattern_matching', 'rust'] },
      { content: 'Rust中使用生命周期标注解决借用问题。', type: 'best_practice', language: 'rust', tags: ['lifetime', 'borrow', 'rust'] },
      { content: 'Rust中使用unsafe块执行不安全操作。', type: 'best_practice', language: 'rust', tags: ['unsafe', 'raw_pointer', 'rust'] },
      { content: 'Rust中使用serde进行序列化/反序列化。', type: 'best_practice', language: 'rust', tags: ['serde', 'serialization', 'rust'] },
      { content: 'Rust中使用actix-web或axum构建Web服务。', type: 'best_practice', language: 'rust', tags: ['actix', 'axum', 'web', 'rust'] },
      { content: 'Rust中使用sqlx或diesel进行数据库操作。', type: 'best_practice', language: 'rust', tags: ['sqlx', 'diesel', 'database', 'rust'] },
      
      // ===== 更多框架与工具知识 =====
      { content: 'React中使用useState管理组件状态。', type: 'best_practice', language: 'javascript', tags: ['react', 'hooks', 'state'] },
      { content: 'React中使用useEffect处理副作用。', type: 'best_practice', language: 'javascript', tags: ['react', 'hooks', 'effect'] },
      { content: 'React中使用useMemo缓存计算结果。', type: 'performance', language: 'javascript', tags: ['react', 'hooks', 'memoization'] },
      { content: 'React中使用useCallback缓存函数引用。', type: 'performance', language: 'javascript', tags: ['react', 'hooks', 'callback'] },
      { content: 'React中使用Context API跨组件共享状态。', type: 'best_practice', language: 'javascript', tags: ['react', 'context', 'state'] },
      { content: 'Vue中使用Composition API组织逻辑。', type: 'best_practice', language: 'javascript', tags: ['vue', 'composition_api', 'setup'] },
      { content: 'Vue中使用Pinia或Vuex管理全局状态。', type: 'best_practice', language: 'javascript', tags: ['vue', 'pinia', 'state_management'] },
      { content: 'Express中使用中间件处理请求。', type: 'best_practice', language: 'javascript', tags: ['express', 'middleware', 'web'] },
      { content: 'Koa中使用洋葱模型处理请求响应。', type: 'best_practice', language: 'javascript', tags: ['koa', 'onion_model', 'web'] },
      { content: 'NestJS使用装饰器和依赖注入构建企业级应用。', type: 'best_practice', language: 'typescript', tags: ['nestjs', 'di', 'decorator', 'framework'] },
      { content: 'Vite: 下一代前端构建工具，基于ESBundler。', type: 'best_practice', language: 'javascript', tags: ['vite', 'build_tool', 'frontend'] },
      { content: 'Webpack: 模块打包器，支持代码分割和Tree Shaking。', type: 'best_practice', language: 'javascript', tags: ['webpack', 'bundler', 'frontend'] },
      { content: 'ESLint: JavaScript/TypeScript代码检查工具。', type: 'best_practice', language: 'javascript', tags: ['eslint', 'linting', 'code_quality'] },
      { content: 'Prettier: 代码格式化工具，统一团队代码风格。', type: 'best_practice', language: 'general', tags: ['prettier', 'formatter', 'code_style'] },
      { content: 'Husky: Git钩子工具，自动化lint和测试。', type: 'best_practice', language: 'general', tags: ['husky', 'git_hooks', 'ci'] },
      
      // ===== JavaScript 深度知识（续）=====
      { content: 'JavaScript原型链: 对象通过__proto__链接到构造函数的prototype。', type: 'best_practice', language: 'javascript', tags: ['prototype', 'inheritance', 'javascript'] },
      { content: 'JavaScript闭包: 函数能访问其词法作用域的变量，即使在外部执行。', type: 'best_practice', language: 'javascript', tags: ['closure', 'scope', 'javascript'] },
      { content: 'JavaScript事件循环: 宏任务（setTimeout）和微任务（Promise）的执行顺序。', type: 'best_practice', language: 'javascript', tags: ['event_loop', 'microtask', 'macrotask'] },
      { content: 'JavaScript变量提升: var声明提升但初始化不提升，let/const不提升。', type: 'best_practice', language: 'javascript', tags: ['hoisting', 'variable', 'javascript'] },
      { content: 'JavaScript作用域: 全局、函数、块级三种作用域。', type: 'best_practice', language: 'javascript', tags: ['scope', 'javascript', 'lexical'] },
      { content: 'JavaScript原型继承: 通过原型链实现对象间的属性和方法共享。', type: 'best_practice', language: 'javascript', tags: ['prototype', 'inheritance', 'oop'] },
      { content: 'JavaScript函数式编程: 一等公民、纯函数、不可变性、高阶函数。', type: 'best_practice', language: 'javascript', tags: ['functional', 'programming', 'javascript'] },
      { content: 'JavaScript Stream API: 处理流式数据的API，适用于大数据量。', type: 'best_practice', language: 'javascript', tags: ['stream', 'api', 'data_processing'] },
      { content: 'JavaScript Iterator协议: 自定义对象的迭代行为。', type: 'best_practice', language: 'javascript', tags: ['iterator', 'protocol', 'iteration'] },
      { content: 'JavaScript Generator: 可暂停和恢复的迭代器函数。', type: 'best_practice', language: 'javascript', tags: ['generator', 'iterator', 'async'] },
      { content: 'JavaScript Proxy: 创建对象的代理，拦截所有操作。', type: 'best_practice', language: 'javascript', tags: ['proxy', 'metaprogramming', 'javascript'] },
      { content: 'JavaScript Reflect: 提供对象默认行为的可拦截操作。', type: 'best_practice', language: 'javascript', tags: ['reflect', 'metaprogramming', 'javascript'] },
      { content: 'JavaScript WeakMap/WeakSet: 键为弱引用的Map/Set，不阻止垃圾回收。', type: 'best_practice', language: 'javascript', tags: ['weakmap', 'weakset', 'memory'] },
      { content: 'JavaScript Symbol: 创建唯一标识符，避免命名冲突。', type: 'best_practice', language: 'javascript', tags: ['symbol', 'unique', 'identifier'] },
      { content: 'JavaScript BigInt: 支持任意精度整数运算。', type: 'best_practice', language: 'javascript', tags: ['bigint', 'integer', 'precision'] },
      
      // ===== Python 深度知识（续）=====
      { content: 'Python装饰器: 在不修改原函数代码的情况下扩展函数功能。', type: 'best_practice', language: 'python', tags: ['decorator', 'metaprogramming', 'python'] },
      { content: 'Python生成器(Generator): 使用yield关键字的惰性求值迭代器。', type: 'best_practice', language: 'python', tags: ['generator', 'lazy', 'iterator'] },
      { content: 'Python上下文管理器: 使用with语句管理资源的获取和释放。', type: 'best_practice', language: 'python', tags: ['context_manager', 'with', 'resource'] },
      { content: 'Python元类(Metaclass): 创建类的类，控制类的创建过程。', type: 'best_practice', language: 'python', tags: ['metaclass', 'metaprogramming', 'oop'] },
      { content: 'Python GIL(全局解释器锁): 确保同一时刻只有一个线程执行Python字节码。', type: 'best_practice', language: 'python', tags: ['gil', 'threading', 'concurrency'] },
      { content: 'Python多进程: 使用multiprocessing模块绕过GIL限制。', type: 'best_practice', language: 'python', tags: ['multiprocessing', 'parallel', 'concurrency'] },
      { content: 'Python异步IO(asyncio): 使用单线程处理大量IO操作。', type: 'best_practice', language: 'python', tags: ['asyncio', 'async', 'io'] },
      { content: 'Python数据类(dataclass): 自动生成__init__等方法的装饰器。', type: 'best_practice', language: 'python', tags: ['dataclass', 'code_generation', 'python'] },
      { content: 'Python类型提示: 使用typing模块标注函数参数和返回值类型。', type: 'best_practice', language: 'python', tags: ['type_hint', 'typing', 'python'] },
      { content: 'Python Walrus操作符(:=): 在表达式中同时赋值。', type: 'best_practice', language: 'python', tags: ['walrus', 'assignment', 'python'] },
      { content: 'Python f-string: 格式化字符串的最佳方式，支持表达式嵌入。', type: 'best_practice', language: 'python', tags: ['f_string', 'format', 'string'] },
      { content: 'Python列表/字典/集合推导式: 简洁创建集合的语法。', type: 'best_practice', language: 'python', tags: ['comprehension', 'list', 'dict', 'set'] },
      { content: 'Python迭代器协议: __iter__和__next__方法实现自定义迭代。', type: 'best_practice', language: 'python', tags: ['iterator', 'protocol', 'iteration'] },
      { content: 'Python魔法方法: __init__、__str__、__repr__等特殊方法。', type: 'best_practice', language: 'python', tags: ['magic_method', 'dunder', 'oop'] },
      { content: 'Python虚拟环境: 使用venv或virtualenv隔离项目依赖。', type: 'best_practice', language: 'python', tags: ['venv', 'virtualenv', 'dependency'] },
      
      // ===== 数据结构与算法 =====
      { content: '数组(Array): 连续内存存储，随机访问O(1)，插入删除O(n)。', type: 'data_structure', language: 'general', tags: ['array', 'data_structure', 'performance'] },
      { content: '链表(LinkedList): 节点通过指针链接，插入删除O(1)，访问O(n)。', type: 'data_structure', language: 'general', tags: ['linked_list', 'data_structure', 'pointer'] },
      { content: '栈(Stack): 后进先出(LIFO)，常用于函数调用、表达式求值。', type: 'data_structure', language: 'general', tags: ['stack', 'lifo', 'data_structure'] },
      { content: '队列(Queue): 先进先出(FIFO)，常用于任务调度、BFS。', type: 'data_structure', language: 'general', tags: ['queue', 'fifo', 'data_structure'] },
      { content: '哈希表(HashTable): 键值对存储，平均O(1)查找、插入、删除。', type: 'data_structure', language: 'general', tags: ['hashtable', 'hash_map', 'data_structure'] },
      { content: '二叉搜索树(BST): 左子树<根<右子树，平均O(log n)操作。', type: 'data_structure', language: 'general', tags: ['bst', 'binary_tree', 'data_structure'] },
      { content: '红黑树: 自平衡二叉搜索树，最坏O(log n)操作。', type: 'data_structure', language: 'general', tags: ['red_black_tree', 'balanced_tree'] },
      { content: '堆(Heap): 完全二叉树，用于优先队列和排序。', type: 'data_structure', language: 'general', tags: ['heap', 'priority_queue', 'data_structure'] },
      { content: '跳表(SkipList): 多层链表，支持快速查找。', type: 'data_structure', language: 'general', tags: ['skiplist', 'data_structure', 'redis'] },
      { content: '图(Graph): 顶点和边的集合，分为有向图和无向图。', type: 'data_structure', language: 'general', tags: ['graph', 'data_structure', 'algorithm'] },
      { content: '动态规划: 分解子问题，存储中间结果避免重复计算。', type: 'algorithm', language: 'general', tags: ['dynamic_programming', 'algorithm', 'optimization'] },
      { content: '贪心算法: 每步选择当前最优，期望全局最优。', type: 'algorithm', language: 'general', tags: ['greedy', 'algorithm', 'optimization'] },
      { content: '分治算法: 分解、递归求解、合并。', type: 'algorithm', language: 'general', tags: ['divide_and_conquer', 'algorithm', 'merge_sort'] },
      { content: '回溯算法: 深度优先搜索+剪枝。', type: 'algorithm', language: 'general', tags: ['backtracking', 'algorithm', 'dfs'] },
      { content: '二分查找: 在有序数组中O(log n)查找。', type: 'algorithm', language: 'general', tags: ['binary_search', 'algorithm', 'search'] },
      { content: '快速排序: O(n log n)平均复杂度，不稳定排序。', type: 'algorithm', language: 'general', tags: ['quicksort', 'sorting', 'algorithm'] },
      { content: '归并排序: O(n log n)稳定排序，需要额外空间。', type: 'algorithm', language: 'general', tags: ['merge_sort', 'sorting', 'algorithm'] },
      { content: '冒泡排序: O(n²)时间复杂度，教学用。', type: 'algorithm', language: 'general', tags: ['bubble_sort', 'sorting', 'algorithm'] },
      { content: 'BFS(广度优先搜索): 使用队列，逐层遍历图。', type: 'algorithm', language: 'general', tags: ['bfs', 'graph', 'search'] },
      { content: 'DFS(深度优先搜索): 使用栈/递归，深度优先遍历图。', type: 'algorithm', language: 'general', tags: ['dfs', 'graph', 'search'] },
      
      // ===== AI/ML 基础知识 =====
      { content: '机器学习: 从数据中学习规律，用于预测或分类。', type: 'ai_ml', language: 'general', tags: ['machine_learning', 'ai', 'ml'] },
      { content: '监督学习: 使用标注数据训练模型（分类、回归）。', type: 'ai_ml', language: 'general', tags: ['supervised', 'learning', 'classification'] },
      { content: '无监督学习: 使用无标注数据发现模式（聚类、降维）。', type: 'ai_ml', language: 'general', tags: ['unsupervised', 'learning', 'clustering'] },
      { content: '强化学习: 智能体通过与环境交互学习策略。', type: 'ai_ml', language: 'general', tags: ['reinforcement_learning', 'ai'] },
      { content: '过拟合: 模型过度拟合训练数据，泛化能力差。', type: 'ai_ml', language: 'general', tags: ['overfitting', 'ml', 'model'] },
      { content: '欠拟合: 模型复杂度不够，无法捕捉数据规律。', type: 'ai_ml', language: 'general', tags: ['underfitting', 'ml', 'model'] },
      { content: '交叉验证: 评估模型泛化能力的方法。', type: 'ai_ml', language: 'general', tags: ['cross_validation', 'ml', 'evaluation'] },
      { content: '特征工程: 从原始数据中提取、构造有效特征。', type: 'ai_ml', language: 'general', tags: ['feature_engineering', 'ml', 'data_preprocessing'] },
      { content: '神经网络: 模拟生物神经元的计算模型。', type: 'ai_ml', language: 'general', tags: ['neural_network', 'deep_learning', 'ai'] },
      { content: '深度学习: 使用多层神经网络学习特征。', type: 'ai_ml', language: 'general', tags: ['deep_learning', 'neural_network'] },
      { content: 'Transformer: 基于自注意力机制的深度学习架构。', type: 'ai_ml', language: 'general', tags: ['transformer', 'attention', 'nlp'] },
      { content: 'GPT: 基于Transformer的大语言模型。', type: 'ai_ml', language: 'general', tags: ['gpt', 'llm', 'nlp', 'generative'] },
      { content: 'Embedding: 将文本转换为稠密向量表示。', type: 'ai_ml', language: 'general', tags: ['embedding', 'vector', 'nlp'] },
      { content: 'RAG(检索增强生成): 结合检索和生成的LLM应用范式。', type: 'ai_ml', language: 'general', tags: ['rag', 'retrieval', 'llm', 'generation'] },
      { content: 'Prompt Engineering: 设计有效提示以引导LLM输出。', type: 'ai_ml', language: 'general', tags: ['prompt_engineering', 'llm', 'nlp'] },
      
      // ===== Git 与版本控制 =====
      { content: 'Git工作流: Git Flow、GitHub Flow、Trunk-Based开发。', type: 'git', language: 'general', tags: ['git', 'workflow', 'branching'] },
      { content: 'Git Rebase: 重新提交历史，保持线性历史。', type: 'git', language: 'general', tags: ['git', 'rebase', 'history'] },
      { content: 'Git Merge: 合并分支，保留完整历史。', type: 'git', language: 'general', tags: ['git', 'merge', 'branching'] },
      { content: 'Git Cherry-pick: 挑选特定提交应用到当前分支。', type: 'git', language: 'general', tags: ['git', 'cherry_pick', 'commit'] },
      { content: 'Git Bisect: 使用二分查找定位引入bug的提交。', type: 'git', language: 'general', tags: ['git', 'bisect', 'debugging'] },
      { content: 'Git Stash: 暂存工作区修改，切换分支后恢复。', type: 'git', language: 'general', tags: ['git', 'stash', 'workflow'] },
      { content: 'Git Revert: 创建新提交撤销指定提交的更改。', type: 'git', language: 'general', tags: ['git', 'revert', 'undo'] },
      { content: 'Git Reset: 重置HEAD到指定状态（soft/mixed/hard）。', type: 'git', language: 'general', tags: ['git', 'reset', 'undo'] },
      { content: 'Git Hooks: 在特定事件触发时执行脚本。', type: 'git', language: 'general', tags: ['git', 'hooks', 'automation'] },
      { content: '.gitignore: 配置不应被Git追踪的文件。', type: 'git', language: 'general', tags: ['gitignore', 'git', 'configuration'] },
      
      // ===== 更多工具与库 =====
      { content: 'Lodash: 现代JavaScript实用工具库。', type: 'tool', language: 'javascript', tags: ['lodash', 'utility', 'library'] },
      { content: 'Ramda: 函数式编程库。', type: 'tool', language: 'javascript', tags: ['ramda', 'functional', 'library'] },
      { content: 'RxJS: 响应式编程库，基于可观察对象。', type: 'tool', language: 'javascript', tags: ['rxjs', 'reactive', 'observable'] },
      { content: 'Zustand: 轻量级React状态管理库。', type: 'tool', language: 'javascript', tags: ['zustand', 'state_management', 'react'] },
      { content: 'Redux Toolkit: Redux官方推荐的工具集。', type: 'tool', language: 'javascript', tags: ['redux_toolkit', 'state_management'] },
      { content: 'Axios: 基于Promise的HTTP客户端。', type: 'tool', language: 'javascript', tags: ['axios', 'http', 'client'] },
      { content: 'Ky: 基于fetch的轻量级HTTP客户端。', type: 'tool', language: 'javascript', tags: ['ky', 'http', 'fetch'] },
      { content: 'Zod: TypeScript优先的模式验证库。', type: 'tool', language: 'typescript', tags: ['zod', 'validation', 'schema'] },
      { content: 'Yup: JavaScript对象模式验证库。', type: 'tool', language: 'javascript', tags: ['yup', 'validation', 'schema'] },
      { content: 'Framer Motion: React动画库。', type: 'tool', language: 'javascript', tags: ['framer_motion', 'animation', 'react'] },
      { content: 'Three.js: 浏览器3D图形库。', type: 'tool', language: 'javascript', tags: ['three.js', '3d', 'webgl'] },
      { content: 'D3.js: 数据可视化库。', type: 'tool', language: 'javascript', tags: ['d3', 'visualization', 'data'] },
      { content: 'Chart.js: 简单灵活的图表库。', type: 'tool', language: 'javascript', tags: ['chart.js', 'chart', 'visualization'] },
      { content: 'Tailwind CSS: 实用优先的CSS框架。', type: 'tool', language: 'css', tags: ['tailwind', 'css', 'utility'] },
      { content: 'Styled Components: CSS-in-JS库。', type: 'tool', language: 'javascript', tags: ['styled_components', 'css_in_js', 'react'] },
      
      // ===== 更多最佳实践 =====
      { content: '代码审查(Code Review): 发现bug、提升质量、共享知识。', type: 'best_practice', language: 'general', tags: ['code_review', 'quality', 'collaboration'] },
      { content: '结对编程(Pair Programming): 两人共用一台电脑编程。', type: 'best_practice', language: 'general', tags: ['pair_programming', 'agile', 'collaboration'] },
      { content: '持续集成(CI): 每次提交自动运行测试。', type: 'best_practice', language: 'general', tags: ['ci', 'continuous_integration', 'automation'] },
      { content: '持续交付(CD): 随时可将代码部署到生产环境。', type: 'best_practice', language: 'general', tags: ['cd', 'continuous_delivery', 'deployment'] },
      { content: 'Feature Flag: 使用功能开关控制特性发布。', type: 'best_practice', language: 'general', tags: ['feature_flag', 'feature_toggle', 'release'] },
      { content: 'A/B测试: 对比两个版本的效果。', type: 'best_practice', language: 'general', tags: ['ab_test', 'experimentation', 'metrics'] },
      { content: '灰度发布: 逐步向更多用户发布新版本。', type: 'best_practice', language: 'general', tags: ['canary', 'gray_release', 'deployment'] },
      { content: '蓝绿部署: 准备两套环境，快速切换。', type: 'best_practice', language: 'general', tags: ['blue_green', 'deployment', 'zero_downtime'] },
      { content: '配置分离: 代码与配置分离，支持多环境。', type: 'best_practice', language: 'general', tags: ['configuration', 'environment', 'separation'] },
      { content: '特性模块化: 将大特性拆分为可独立开发和发布的小模块。', type: 'best_practice', language: 'general', tags: ['modularization', 'feature', 'architecture'] },
      
      // ===== HTTP 与网络协议 =====
      { content: 'HTTP/1.1: 文本协议，支持持久连接、管道化。', type: 'network', language: 'general', tags: ['http', 'protocol', 'web'] },
      { content: 'HTTP/2: 二进制协议，多路复用、头部压缩、服务器推送。', type: 'network', language: 'general', tags: ['http2', 'protocol', 'performance'] },
      { content: 'HTTP/3: 基于QUIC协议，减少延迟。', type: 'network', language: 'general', tags: ['http3', 'quic', 'protocol'] },
      { content: 'TCP: 面向连接的可靠传输协议，三次握手建立连接。', type: 'network', language: 'general', tags: ['tcp', 'transport', 'protocol'] },
      { content: 'UDP: 无连接的不可靠传输，速度快。', type: 'network', language: 'general', tags: ['udp', 'transport', 'protocol'] },
      { content: 'WebSocket: 全双工通信协议，基于HTTP握手升级。', type: 'network', language: 'general', tags: ['websocket', 'realtime', 'communication'] },
      { content: 'HTTP状态码: 2xx成功、3xx重定向、4xx客户端错误、5xx服务端错误。', type: 'network', language: 'general', tags: ['http', 'status_code', 'response'] },
      { content: 'HTTP Header: Content-Type、Authorization、Cache-Control等。', type: 'network', language: 'general', tags: ['http', 'header', 'request'] },
      { content: 'REST API约束: 无状态、客户端-服务器、统一接口。', type: 'network', language: 'general', tags: ['rest', 'api', 'architecture'] },
      { content: 'SOAP: 基于XML的Web服务协议。', type: 'network', language: 'general', tags: ['soap', 'web_service', 'xml'] },
      { content: 'TLS 1.3: 改进的传输层安全协议，握手更简洁。', type: 'network', language: 'general', tags: ['tls', 'encryption', 'security'] },
      { content: 'DNS解析: 将域名转换为IP地址。', type: 'network', language: 'general', tags: ['dns', 'resolution', 'networking'] },
      { content: 'CDN工作原理: 边缘缓存回源刷新。', type: 'network', language: 'general', tags: ['cdn', 'edge', 'caching'] },
      { content: '负载均衡: 轮询、最少连接、IP哈希等算法。', type: 'network', language: 'general', tags: ['load_balancing', 'networking', 'scalability'] },
      { content: '反向代理: 客户端不知道真实服务器。', type: 'network', language: 'general', tags: ['reverse_proxy', 'networking', 'security'] },
      
      // ===== 浏览器与前端性能 =====
      { content: '浏览器渲染流程: HTML解析→DOM构建→CSS解析→样式计算→布局→绘制→合成。', type: 'frontend', language: 'javascript', tags: ['rendering', 'browser', 'performance'] },
      { content: '关键渲染路径: 减少关键资源数量和大小。', type: 'frontend', language: 'javascript', tags: ['critical_rendering', 'path', 'performance'] },
      { content: '阻塞渲染资源: CSS阻塞渲染，JS阻塞解析。', type: 'frontend', language: 'javascript', tags: ['render_blocking', 'css', 'javascript'] },
      { content: 'CSS性能: 避免复杂选择器、减少重绘重排。', type: 'frontend', language: 'css', tags: ['css', 'performance', 'rendering'] },
      { content: '图片优化: 使用WebP/AVIF、懒加载、响应式图片。', type: 'frontend', language: 'general', tags: ['image', 'optimization', 'performance'] },
      { content: '字体优化: 使用font-display: swap防止FOIT。', type: 'frontend', language: 'css', tags: ['font', 'optimization', 'css'] },
      { content: '资源预加载: preload、prefetch、preconnect、dns-prefetch。', type: 'frontend', language: 'html', tags: ['preload', 'prefetch', 'resource_hint'] },
      { content: 'Web Vitals: LCP、FID、CLS核心性能指标。', type: 'frontend', language: 'javascript', tags: ['web_vitals', 'metrics', 'performance'] },
      { content: 'Service Worker缓存策略: Cache-First、Network-First、Stale-While-Revalidate。', type: 'frontend', language: 'javascript', tags: ['service_worker', 'caching', 'pwa'] },
      { content: 'HTTP缓存: Cache-Control、ETag、Last-Modified。', type: 'frontend', language: 'javascript', tags: ['http_cache', 'caching', 'performance'] },
      { content: '代码分割: 路由级分割、组件级分割、动态import。', type: 'frontend', language: 'javascript', tags: ['code_splitting', 'bundler', 'performance'] },
      { content: 'Tree Shaking: 移除未使用的导出代码。', type: 'frontend', language: 'javascript', tags: ['tree_shaking', 'bundler', 'performance'] },
      { content: 'ESM vs CommonJS: ESM支持静态分析和Tree Shaking。', type: 'frontend', language: 'javascript', tags: ['esm', 'commonjs', 'module'] },
      { content: 'Virtual DOM: React在内存中构建虚拟DOM，差异更新真实DOM。', type: 'frontend', language: 'javascript', tags: ['virtual_dom', 'react', 'diffing'] },
      { content: 'Diff算法: React使用O(n)复杂度的双指针比较。', type: 'frontend', language: 'javascript', tags: ['diffing', 'algorithm', 'react'] },
      
      // ===== Node.js 深度知识 =====
      { content: 'Node.js事件循环: timers、pending callbacks、idle、poll、check、close。', type: 'backend', language: 'javascript', tags: ['nodejs', 'event_loop', 'libuv'] },
      { content: 'Node.js模块系统: CommonJS和ESM两种。', type: 'backend', language: 'javascript', tags: ['nodejs', 'module', 'commonjs'] },
      { content: 'Node.js Cluster: 利用多核CPU。', type: 'backend', language: 'javascript', tags: ['nodejs', 'cluster', 'multi_core'] },
      { content: 'Node.js Child Process: 创建子进程执行外部命令。', type: 'backend', language: 'javascript', tags: ['nodejs', 'child_process', 'system'] },
      { content: 'Node.js Stream: Readable、Writable、Duplex、Transform。', type: 'backend', language: 'javascript', tags: ['nodejs', 'stream', 'pipe'] },
      { content: 'Node.js Buffer: 处理二进制数据的内存区域。', type: 'backend', language: 'javascript', tags: ['nodejs', 'buffer', 'binary'] },
      { content: 'Node.js Event Emitter: 事件发布订阅模式实现。', type: 'backend', language: 'javascript', tags: ['nodejs', 'event_emitter', 'pub_sub'] },
      { content: 'Node.js PM2: 生产级进程管理器。', type: 'backend', language: 'javascript', tags: ['nodejs', 'pm2', 'process_manager'] },
      { content: 'Node.js NPM: 包管理器和注册表。', type: 'backend', language: 'javascript', tags: ['npm', 'package_manager', 'nodejs'] },
      { content: 'Node.js npx: 无需全局安装即可运行包。', type: 'backend', language: 'javascript', tags: ['npx', 'npm', 'nodejs'] },
      
      // ===== 微服务与架构 =====
      { content: '服务注册发现: Eureka、Consul、etcd。', type: 'architecture', language: 'general', tags: ['service_discovery', 'eureka', 'consul'] },
      { content: 'API Gateway: 路由、认证、限流、日志。', type: 'architecture', language: 'general', tags: ['api_gateway', 'zuul', 'kong'] },
      { content: '配置中心: Spring Cloud Config、Apollo、Nacos。', type: 'architecture', language: 'general', tags: ['config_center', 'configuration', 'microservices'] },
      { content: '服务熔断: 调用失败时返回降级响应。', type: 'architecture', language: 'general', tags: ['circuit_breaker', 'resilience', 'hystrix'] },
      { content: '服务限流: 令牌桶、漏桶算法控制请求速率。', type: 'architecture', language: 'general', tags: ['rate_limiting', 'resilience', 'sentinel'] },
      { content: '分布式事务: 2PC、TCC、Saga、消息最终一致性。', type: 'architecture', language: 'general', tags: ['distributed_transaction', 'tcc', 'saga'] },
      { content: '分布式锁: Redis、ZooKeeper、Etcd实现。', type: 'architecture', language: 'general', tags: ['distributed_lock', 'redis', 'zookeeper'] },
      { content: '分布式ID: Snowflake、UUID、Leaf算法。', type: 'architecture', language: 'general', tags: ['distributed_id', 'snowflake', 'uuid'] },
      { content: '链路追踪: Zipkin、Jaeger、SkyWalking。', type: 'architecture', language: 'general', tags: ['tracing', 'zipkin', 'jaeger', 'observability'] },
      { content: '服务治理: 熔断、限流、降级、负载均衡。', type: 'architecture', language: 'general', tags: ['governance', 'resilience', 'microservices'] },
      
      // ===== 容器与DevOps =====
      { content: 'Docker镜像优化: 最小化基础镜像、多阶段构建、合理缓存。', type: 'devops', language: 'general', tags: ['docker', 'image', 'optimization'] },
      { content: 'K8s Pod: 容器调度的最小单位。', type: 'devops', language: 'general', tags: ['kubernetes', 'pod', 'container'] },
      { content: 'K8s Deployment: 管理Pod副本和滚动更新。', type: 'devops', language: 'general', tags: ['kubernetes', 'deployment', 'replicas'] },
      { content: 'K8s Service: 为Pod提供稳定的网络访问点。', type: 'devops', language: 'general', tags: ['kubernetes', 'service', 'networking'] },
      { content: 'K8s Ingress: HTTP/S七层路由。', type: 'devops', language: 'general', tags: ['kubernetes', 'ingress', 'routing'] },
      { content: 'K8s Namespace: 资源隔离和权限边界。', type: 'devops', language: 'general', tags: ['kubernetes', 'namespace', 'isolation'] },
      { content: 'Helm: Kubernetes包管理器和模板引擎。', type: 'devops', language: 'general', tags: ['helm', 'kubernetes', 'package_manager'] },
      { content: 'Prometheus: 开源监控系统和时间序列数据库。', type: 'devops', language: 'general', tags: ['prometheus', 'monitoring', 'metrics'] },
      { content: 'Grafana: 数据可视化和分析平台。', type: 'devops', language: 'general', tags: ['grafana', 'visualization', 'monitoring'] },
      { content: 'Jenkins: 开源自动化服务器，CI/CD平台。', type: 'devops', language: 'general', tags: ['jenkins', 'ci_cd', 'automation'] },
      
      // ===== 数据库深度知识 =====
      { content: 'SQL事务ACID: 原子性、一致性、隔离性、持久性。', type: 'database', language: 'general', tags: ['acid', 'transaction', 'sql'] },
      { content: 'SQL JOIN: INNER JOIN、LEFT/RIGHT OUTER JOIN、FULL JOIN、CROSS JOIN。', type: 'database', language: 'general', tags: ['sql_join', 'sql', 'query'] },
      { content: 'SQL子查询: 在查询中嵌套查询。', type: 'database', language: 'general', tags: ['subquery', 'sql', 'query'] },
      { content: 'SQL窗口函数: ROW_NUMBER、RANK、SUM() OVER等。', type: 'database', language: 'general', tags: ['window_function', 'sql', 'analytics'] },
      { content: 'SQL索引类型: B+树、哈希、全文索引。', type: 'database', language: 'general', tags: ['index', 'b_tree', 'hash'] },
      { content: 'MongoDB: 文档型NoSQL数据库，使用BSON格式。', type: 'database', language: 'general', tags: ['mongodb', 'nosql', 'document'] },
      { content: 'Cassandra: 列式NoSQL数据库，高可用高扩展性。', type: 'database', language: 'general', tags: ['cassandra', 'nosql', 'column_family'] },
      { content: 'Elasticsearch: 分布式搜索引擎和分析数据库。', type: 'database', language: 'general', tags: ['elasticsearch', 'search', 'analytics'] },
      { content: 'PostgreSQL: 功能丰富的开源关系型数据库。', type: 'database', language: 'general', tags: ['postgresql', 'sql', 'open_source'] },
      { content: '数据库迁移: Flyway、Liquibase管理Schema变更。', type: 'database', language: 'general', tags: ['migration', 'flyway', 'liquibase'] },
      
      // ===== 设计模式补充 =====
      { content: '依赖注入(DI): 外部传入对象依赖，减少耦合。', type: 'design_pattern', language: 'general', tags: ['dependency_injection', 'di', 'ioc'] },
      { content: '控制反转(IoC): 框架控制对象创建和生命周期。', type: 'design_pattern', language: 'general', tags: ['inversion_of_control', 'ioc', 'container'] },
      { content: 'MVC模式: Model、View、Controller分离。', type: 'design_pattern', language: 'general', tags: ['mvc', 'architectural', 'pattern'] },
      { content: 'MVVM模式: Model、View、ViewModel，数据双向绑定。', type: 'design_pattern', language: 'general', tags: ['mvvm', 'architectural', 'pattern'] },
      { content: 'Event Bus: 全局事件总线，组件间通信。', type: 'design_pattern', language: 'general', tags: ['event_bus', 'pub_sub', 'communication'] },
      { content: 'Service Locator: 服务定位器模式，IoC的替代方案。', type: 'design_pattern', language: 'general', tags: ['service_locator', 'di', 'ioc'] },
      { content: '对象池模式: 预创建对象并复用，减少创建开销。', type: 'design_pattern', language: 'general', tags: ['object_pool', 'performance', 'pattern'] },
      { content: '空对象模式: 用不做任何事的对象替代null检查。', type: 'design_pattern', language: 'general', tags: ['null_object', 'pattern', 'null_safety'] },
      { content: '规格模式: 将业务规则封装为可组合的规格对象。', type: 'design_pattern', language: 'general', tags: ['specification', 'business_rule', 'pattern'] },
      { content: '仓储模式: 封装数据访问逻辑，提供类似集合的接口。', type: 'design_pattern', language: 'general', tags: ['repository', 'data_access', 'ddd'] },
      
      // ===== 敏捷开发 =====
      { content: 'Scrum: 敏捷框架，Sprint、产品待办、每日站会。', type: 'agile', language: 'general', tags: ['scrum', 'agile', 'framework'] },
      { content: 'Kanban: 看板方法，可视化工作流和限制在制品。', type: 'agile', language: 'general', tags: ['kanban', 'agile', 'workflow'] },
      { content: 'Sprint Planning: Sprint计划会议，确定目标和任务。', type: 'agile', language: 'general', tags: ['sprint', 'planning', 'scrum'] },
      { content: 'Daily Standup: 每日站会，同步进度和障碍。', type: 'agile', language: 'general', tags: ['standup', 'scrum', 'communication'] },
      { content: 'Retrospective: 回顾会议，总结改进。', type: 'agile', language: 'general', tags: ['retrospective', 'scrum', 'improvement'] },
      { content: 'User Story: 用户故事，描述功能需求。', type: 'agile', language: 'general', tags: ['user_story', 'requirement', 'agile'] },
      { content: 'Story Point: 故事点，估算复杂度。', type: 'agile', language: 'general', tags: ['story_point', 'estimation', 'agile'] },
      { content: 'Definition of Done: 完成的定义，验收标准。', type: 'agile', language: 'general', tags: ['definition_of_done', 'acceptance', 'agile'] },
      { content: 'Velocity: 团队速率，衡量生产力。', type: 'agile', language: 'general', tags: ['velocity', 'metric', 'agile'] },
      { content: 'Burndown Chart: 燃尽图，展示剩余工作量。', type: 'agile', language: 'general', tags: ['burndown', 'chart', 'agile', 'visualization'] },
      
      // ===== JavaScript 实用技巧 =====
      { content: '数组去重(JS): [...new Set(array)] 或 Array.from(new Set(array))', type: 'code_snippet', language: 'javascript', tags: ['array', 'dedup', 'set'] },
      { content: '扁平化数组(JS): arr.flat(depth) 或 arr.reduce((acc, val) => acc.concat(val), [])', type: 'code_snippet', language: 'javascript', tags: ['array', 'flatten', 'recursive'] },
      { content: '对象转数组(JS): Object.entries(obj).map(([k, v]) => ({ key: k, value: v }))', type: 'code_snippet', language: 'javascript', tags: ['object', 'convert', 'array'] },
      { content: '条件属性(JS): const obj = { ...(condition && { key: value }) }', type: 'code_snippet', language: 'javascript', tags: ['conditional', 'object', 'spread'] },
      { content: '短路求值(JS): const value = obj?.prop ?? defaultVal', type: 'code_snippet', language: 'javascript', tags: ['short_circuit', 'null_safety'] },
      { content: '解构重命名(JS): const { oldName: newName } = obj', type: 'code_snippet', language: 'javascript', tags: ['destructuring', 'rename', 'object'] },
      { content: '默认参数(JS): function fn(param = defaultValue) {}', type: 'code_snippet', language: 'javascript', tags: ['default_parameter', 'function'] },
      { content: '剩余参数(JS): function fn(...args) { args.forEach(a => console.log(a)) }', type: 'code_snippet', language: 'javascript', tags: ['rest_parameter', 'function', 'variadic'] },
      { content: '标记模板(JS): tag`text ${expr} text` 用于自定义字符串处理', type: 'code_snippet', language: 'javascript', tags: ['tagged_template', 'template_literal'] },
      { content: '可选链(JS): obj?.prop?.method?.() 安全访问嵌套属性', type: 'code_snippet', language: 'javascript', tags: ['optional_chaining', 'null_safety'] },
      
      // ===== Python 实用技巧 =====
      { content: '字典合并(Python): {**dict1, **dict2} 或 dict1 | dict2 (3.9+)', type: 'code_snippet', language: 'python', tags: ['dict', 'merge', 'unpacking'] },
      { content: '元组解包(Python): a, *b, c = [1, 2, 3, 4, 5]', type: 'code_snippet', language: 'python', tags: ['unpacking', 'tuple', 'star'] },
      { content: '集合运算(Python): set_a & set_b 交集, | 并集, - 差集, ^ 对称差', type: 'code_snippet', language: 'python', tags: ['set', 'operation', 'math'] },
      { content: '字典推导式(Python): {k: v for k, v in items if condition}', type: 'code_snippet', language: 'python', tags: ['dict_comprehension', 'mapping', 'filtering'] },
      { content: '生成器表达式(Python): (x**2 for x in range(1000000)) 惰性生成', type: 'code_snippet', language: 'python', tags: ['generator', 'expression', 'lazy'] },
      { content: '枚举遍历(Python): for idx, val in enumerate(items, 1):', type: 'code_snippet', language: 'python', tags: ['enumerate', 'iteration', 'index'] },
      { content: '并行遍历(Python): for a, b in zip(list_a, list_b):', type: 'code_snippet', language: 'python', tags: ['zip', 'parallel', 'iteration'] },
      { content: '解包(Python): first, *rest = items 或 first, *middle, last = items', type: 'code_snippet', language: 'python', tags: ['unpacking', 'star', 'destructuring'] },
      { content: 'walrus操作符(Python): if (n := len(a)) > 10: print(f"List too long ({n} elements)")', type: 'code_snippet', language: 'python', tags: ['walrus', 'assignment', 'expression'] },
      { content: '类型提示(Python): def greet(name: str, times: int = 1) -> str:', type: 'code_snippet', language: 'python', tags: ['type_hint', 'function', 'typing'] },
      
      // ===== 通用代码片段 =====
      { content: '防抖函数(通用): debounce(fn, delay) => (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay) }', type: 'code_snippet', language: 'general', tags: ['debounce', 'rate_limit', 'utility'] },
      { content: '节流函数(通用): throttle(fn, interval) => { let last = 0; return (...args) => { const now = Date.now(); if (now - last >= interval) { fn(...args); last = now } } }', type: 'code_snippet', language: 'general', tags: ['throttle', 'rate_limit', 'utility'] },
      { content: '柯里化(通用): curry(fn) => curried = (...args) => args.length >= fn.length ? fn(...args) : (...more) => curried(...args, ...more)', type: 'code_snippet', language: 'general', tags: ['currying', 'functional', 'utility'] },
      { content: '函数组合(通用): compose(f, g) => x => f(g(x))', type: 'code_snippet', language: 'general', tags: ['compose', 'functional', 'utility'] },
      { content: '记忆化(通用): memoize(fn) => { const cache = new Map(); return (...args) => { const key = JSON.stringify(args); return cache.get(key) ?? (cache.set(key, fn(...args)), cache.get(key)) } }', type: 'code_snippet', language: 'general', tags: ['memoize', 'caching', 'performance'] },
      
      // ===== 前端开发技巧 =====
      { content: 'CSS变量使用: --color-primary: #3498db; color: var(--color-primary);', type: 'frontend', language: 'css', tags: ['css_variable', 'custom_property', 'theming'] },
      { content: 'Flexbox居中: display: flex; justify-content: center; align-items: center;', type: 'frontend', language: 'css', tags: ['flexbox', 'center', 'layout'] },
      { content: 'Grid布局: display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;', type: 'frontend', language: 'css', tags: ['grid', 'layout', 'responsive'] },
      { content: '响应式图片: <img src="image.jpg" srcset="image-400.jpg 400w, image-800.jpg 800w" sizes="(max-width: 600px) 400px, 800px">', type: 'frontend', language: 'html', tags: ['responsive', 'image', 'performance'] },
      { content: '懒加载: <img loading="lazy" src="image.jpg" alt=""> 或 <iframe loading="lazy"', type: 'frontend', language: 'html', tags: ['lazy_loading', 'image', 'performance'] },
      { content: '骨架屏: 加载时显示灰色占位元素，提升用户体验。', type: 'frontend', language: 'css', tags: ['skeleton', 'loading', 'ux'] },
      { content: 'Transition API: 平滑过渡元素出现和消失。', type: 'frontend', language: 'javascript', tags: ['transition', 'animation', 'dom'] },
      { content: 'Portal: React中渲染到DOM节点外部。', type: 'frontend', language: 'javascript', tags: ['portal', 'react', 'modal'] },
      { content: 'HOC(高阶组件): 包装组件以添加额外功能。', type: 'frontend', language: 'javascript', tags: ['hoc', 'react', 'pattern'] },
      { content: '自定义Hook: 封装可复用的状态逻辑。', type: 'frontend', language: 'javascript', tags: ['custom_hook', 'react', 'reuse'] },
      
      // ===== 后端开发技巧 =====
      { content: 'JWT认证流程: 用户登录→服务器签发JWT→客户端存储→请求时携带→服务器验证', type: 'backend', language: 'general', tags: ['jwt', 'authentication', 'flow'] },
      { content: 'OAuth2流程: 授权码模式、隐式模式、密码模式、客户端模式。', type: 'backend', language: 'general', tags: ['oauth2', 'authorization', 'flow'] },
      { content: '分页实现: 使用游标分页或偏移分页，游标更适合大数据量。', type: 'backend', language: 'general', tags: ['pagination', 'cursor', 'offset'] },
      { content: 'API版本策略: URL路径版本、查询参数版本、Header版本。', type: 'backend', language: 'general', tags: ['api_version', 'strategy', 'evolution'] },
      { content: '幂等性设计: POST请求支持幂等键，防止重复提交。', type: 'backend', language: 'general', tags: ['idempotency', 'api', 'design'] },
      { content: 'API错误处理: 统一错误响应格式，包含错误码和描述。', type: 'backend', language: 'general', tags: ['error_handling', 'api', 'response'] },
      { content: '数据库连接池: 配置合理的连接数（CPU密集型: CPU+1, IO密集型: 2*CPU）。', type: 'backend', language: 'general', tags: ['connection_pool', 'database', 'configuration'] },
      { content: '缓存穿透防护: 使用布隆过滤器或空值缓存。', type: 'backend', language: 'general', tags: ['cache_penetration', 'bloom_filter'] },
      { content: '缓存击穿防护: 使用互斥锁重建缓存。', type: 'backend', language: 'general', tags: ['cache_breakdown', 'mutex'] },
      { content: '缓存雪崩防护: 随机化过期时间、多级缓存。', type: 'backend', language: 'general', tags: ['cache_avalanche', 'random_expiry'] },
      
      // ===== 系统管理与运维 =====
      { content: 'Linux权限: chmod 755 rwxr-xr-x, chown user:group file', type: 'devops', language: 'general', tags: ['linux', 'permission', 'chmod'] },
      { content: 'Linux进程管理: ps、top、htop、kill、nice、renice', type: 'devops', language: 'general', tags: ['linux', 'process', 'management'] },
      { content: 'Linux文件操作: cp、mv、rm、mkdir、touch、cat、less、more', type: 'devops', language: 'general', tags: ['linux', 'file', 'operation'] },
      { content: 'Linux磁盘管理: df、du、fdisk、mkfs、mount、umount', type: 'devops', language: 'general', tags: ['linux', 'disk', 'storage'] },
      { content: 'Linux网络: ip、ifconfig、netstat、ss、ping、traceroute', type: 'devops', language: 'general', tags: ['linux', 'network', 'diagnostic'] },
      { content: 'Shell脚本基础: #!/bin/bash、变量、条件、循环、函数', type: 'devops', language: 'general', tags: ['shell', 'scripting', 'bash'] },
      { content: '日志管理: syslog、journalctl、logrotate', type: 'devops', language: 'general', tags: ['logging', 'linux', 'system'] },
      { content: '备份策略: 全量备份、增量备份、差异备份', type: 'devops', language: 'general', tags: ['backup', 'strategy', 'recovery'] },
      { content: '磁盘RAID: RAID0(条带)、RAID1(镜像)、RAID5(校验)、RAID10', type: 'devops', language: 'general', tags: ['raid', 'disk', 'redundancy'] },
      { content: 'LVM逻辑卷: 动态调整磁盘分区大小。', type: 'devops', language: 'general', tags: ['lvm', 'logical_volume', 'storage'] },
      
      // ===== 测试与调试 =====
      { content: '黑盒测试: 不了解内部实现，仅测试输入输出。', type: 'testing', language: 'general', tags: ['black_box', 'testing', 'method'] },
      { content: '白盒测试: 了解内部实现，测试代码路径。', type: 'testing', language: 'general', tags: ['white_box', 'testing', 'method'] },
      { content: '灰盒测试: 部分了解内部实现。', type: 'testing', language: 'general', tags: ['gray_box', 'testing', 'method'] },
      { content: '断言风格: assert、expect、should三种断言风格。', type: 'testing', language: 'general', tags: ['assertion', 'style', 'testing'] },
      { content: '测试金字塔: 单元测试多、集成测试中、E2E测试少。', type: 'testing', language: 'general', tags: ['test_pyramid', 'strategy', 'testing'] },
      { content: '调试技巧: 二分查找、日志分析、内存分析、性能剖析。', type: 'debugging', language: 'general', tags: ['debugging', 'technique', 'troubleshooting'] },
      { content: '核心转储分析: 使用gdb/lldb分析crash dump。', type: 'debugging', language: 'general', tags: ['core_dump', 'gdb', 'crash'] },
      { content: '远程调试: attach到远程进程进行调试。', type: 'debugging', language: 'general', tags: ['remote_debug', 'debugger', 'process'] },
      { content: '日志级别: DEBUG、INFO、WARN、ERROR、FATAL。', type: 'debugging', language: 'general', tags: ['log_level', 'logging', 'observability'] },
      { content: '错误分类: 语法错误、运行时错误、逻辑错误、资源错误。', type: 'debugging', language: 'general', tags: ['error_classification', 'bug', 'diagnostic'] },
      
      // ===== 安全与合规 =====
      { content: '数据加密: 对称加密(AES)、非对称加密(RSA)、哈希(SHA-256)。', type: 'security', language: 'general', tags: ['encryption', 'aes', 'rsa', 'sha'] },
      { content: '数字签名: 确保消息完整性和来源认证。', type: 'security', language: 'general', tags: ['digital_signature', 'integrity', 'authentication'] },
      { content: '证书管理: X.509证书、CA、证书链。', type: 'security', language: 'general', tags: ['certificate', 'x509', 'ca'] },
      { content: '双因素认证(2FA): 密码+手机验证码/硬件密钥。', type: 'security', language: 'general', tags: ['2fa', 'authentication', 'mfa'] },
      { content: '密码策略: 长度、复杂度、历史、过期。', type: 'security', language: 'general', tags: ['password', 'policy', 'security'] },
      { content: 'GDPR合规: 数据保护、隐私权、被遗忘权。', type: 'security', language: 'general', tags: ['gdpr', 'compliance', 'privacy'] },
      { content: 'SQL注入防御: 参数化查询、输入验证、ORM。', type: 'security', language: 'general', tags: ['sql_injection', 'prevention', 'parameterized'] },
      { content: 'XSS防御: 输出编码、CSP、输入验证。', type: 'security', language: 'general', tags: ['xss', 'prevention', 'encoding'] },
      { content: 'CSRF防御: Token验证、SameSite Cookie、Referer检查。', type: 'security', language: 'general', tags: ['csrf', 'prevention', 'token'] },
      { content: '文件上传安全: 类型检查、大小限制、病毒扫描、重命名存储。', type: 'security', language: 'general', tags: ['file_upload', 'security', 'validation'] },
      
      // ===== 产品与设计 =====
      { content: '用户旅程地图: 可视化用户与产品的交互全过程。', type: 'product', language: 'general', tags: ['user_journey', 'ux', 'design'] },
      { content: '用户故事地图: 按用户活动和任务组织需求。', type: 'product', language: 'general', tags: ['story_map', 'requirement', 'agile'] },
      { content: 'MVP(最小可行产品): 用最少的功能验证市场假设。', type: 'product', language: 'general', tags: ['mvp', 'product', 'strategy'] },
      { content: '精益创业: 构建-测量-学习循环。', type: 'product', language: 'general', tags: ['lean_startup', 'build_measure_learn'] },
      { content: 'AARRR漏斗: 获取、激活、留存、推荐、收入。', type: 'product', language: 'general', tags: ['aarrr', 'funnel', 'growth'] },
      { content: 'OKR: 目标与关键结果的目标管理方法。', type: 'product', language: 'general', tags: ['okr', 'goal', 'management'] },
      { content: 'KPI: 关键绩效指标，衡量业务成功。', type: 'product', language: 'general', tags: ['kpi', 'metric', 'performance'] },
      { content: '用户增长模型: 病毒式增长、付费增长、粘性增长。', type: 'product', language: 'general', tags: ['growth_model', 'user', 'acquisition'] },
      { content: '产品生命周期: 引入、成长、成熟、衰退。', type: 'product', language: 'general', tags: ['product_lifecycle', 'stage', 'strategy'] },
      { content: '功能优先级: RICE模型(Reach、Impact、Confidence、Effort)。', type: 'product', language: 'general', tags: ['rice', 'priority', 'framework'] },
      
      // ===== 大数据与分析 =====
      { content: 'Hadoop: 分布式存储和计算框架，处理海量数据。', type: 'big_data', language: 'java', tags: ['hadoop', 'distributed', 'storage'] },
      { content: 'HDFS: Hadoop分布式文件系统，高容错、高吞吐。', type: 'big_data', language: 'java', tags: ['hdfs', 'filesystem', 'hadoop'] },
      { content: 'MapReduce: 分布式计算模型，Map+Reduce阶段。', type: 'big_data', language: 'java', tags: ['mapreduce', 'computing', 'hadoop'] },
      { content: 'YARN: Hadoop资源管理框架，调度和监控集群资源。', type: 'big_data', language: 'java', tags: ['yarn', 'resource', 'scheduling'] },
      { content: 'Spark: 内存计算引擎，比MapReduce快100倍。', type: 'big_data', language: 'scala', tags: ['spark', 'in_memory', 'computing'] },
      { content: 'Spark SQL: 用SQL查询结构化数据。', type: 'big_data', language: 'scala', tags: ['spark_sql', 'sql', 'structured'] },
      { content: 'Spark Streaming: 实时数据流处理。', type: 'big_data', language: 'scala', tags: ['spark_streaming', 'realtime', 'stream'] },
      { content: 'Flink: 下一代流式数据处理引擎，支持有状态计算。', type: 'big_data', language: 'java', tags: ['flink', 'streaming', 'stateful'] },
      { content: 'Kafka: 分布式事件流平台，高吞吐消息队列。', type: 'big_data', language: 'java', tags: ['kafka', 'message_queue', 'stream'] },
      { content: 'Hive: 数据仓库基础架构，SQL查询HDFS数据。', type: 'big_data', language: 'java', tags: ['hive', 'data_warehouse', 'sql'] },
      { content: 'Pig: 高级数据流语言，处理Hadoop数据。', type: 'big_data', language: 'java', tags: ['pig', 'dataflow', 'hadoop'] },
      { content: 'HBase: 分布式列式数据库，基于HDFS。', type: 'big_data', language: 'java', tags: ['hbase', 'columnar', 'nosql'] },
      { content: 'ClickHouse: 列式存储分析数据库，实时查询。', type: 'big_data', language: 'cpp', tags: ['clickhouse', 'columnar', 'analytics'] },
      { content: 'Elasticsearch: 分布式搜索和分析引擎。', type: 'big_data', language: 'java', tags: ['elasticsearch', 'search', 'analytics'] },
      { content: 'Logstash: 数据收集和处理管道。', type: 'big_data', language: 'java', tags: ['logstash', 'etl', 'pipeline'] },
      { content: 'Kibana: Elasticsearch的可视化界面。', type: 'big_data', language: 'javascript', tags: ['kibana', 'visualization', 'monitoring'] },
      { content: 'ETL: 抽取、转换、加载数据流程。', type: 'big_data', language: 'general', tags: ['etl', 'data_pipeline', 'extract'] },
      { content: '数据湖: 存储任意结构数据的集中式仓库。', type: 'big_data', language: 'general', tags: ['data_lake', 'storage', 'repository'] },
      { content: '数据仓库: 面向分析的结构化数据存储。', type: 'big_data', language: 'general', tags: ['data_warehouse', 'bi', 'analytics'] },
      { content: 'Lambda架构: 批处理+速度层+服务层的三层架构。', type: 'big_data', language: 'general', tags: ['lambda_architecture', 'batch', 'realtime'] },
      
      // ===== 物联网(IoT) =====
      { content: 'MQTT: 轻量级物联网消息传输协议。', type: 'iot', language: 'general', tags: ['mqtt', 'protocol', 'lightweight'] },
      { content: 'CoAP: 受限应用协议，面向低功耗设备。', type: 'iot', language: 'general', tags: ['coap', 'protocol', 'embedded'] },
      { content: 'Zigbee: 低功耗无线通信协议，用于智能家居。', type: 'iot', language: 'general', tags: ['zigbee', 'wireless', 'smart_home'] },
      { content: 'Bluetooth Low Energy: 低功耗蓝牙，IoT设备常用。', type: 'iot', language: 'general', tags: ['ble', 'bluetooth', 'low_energy'] },
      { content: 'LoRaWAN: 长距离低功耗广域网。', type: 'iot', language: 'general', tags: ['lorawan', 'long_range', 'lpwan'] },
      { content: 'IoT平台: 设备管理、数据收集、规则引擎。', type: 'iot', language: 'general', tags: ['iot_platform', 'device', 'management'] },
      { content: '边缘计算: 在数据源附近处理数据，减少延迟。', type: 'iot', language: 'general', tags: ['edge_computing', 'latency', 'processing'] },
      { content: '数字孪生: 物理实体的虚拟映射，实时同步。', type: 'iot', language: 'general', tags: ['digital_twin', 'virtualization', 'iot'] },
      { content: '嵌入式系统: 专用计算系统，资源受限。', type: 'iot', language: 'c', tags: ['embedded', 'firmware', 'real_time'] },
      { content: 'RTOS: 实时操作系统，FreeRTOS、RT-Thread。', type: 'iot', language: 'c', tags: ['rtos', 'real_time', 'embedded'] },
      
      // ===== 游戏开发 =====
      { content: '游戏引擎: Unity、Unreal Engine、Godot。', type: 'game_dev', language: 'csharp', tags: ['game_engine', 'unity', 'unreal'] },
      { content: '游戏循环: 固定时间步长的更新和渲染循环。', type: 'game_dev', language: 'c++', tags: ['game_loop', 'fixed_timestep', 'update'] },
      { content: 'ECS架构: 实体-组件-系统架构，数据驱动。', type: 'game_dev', language: 'c++', tags: ['ecs', 'entity', 'component'] },
      { content: '物理引擎: 刚体、碰撞检测、力学模拟。', type: 'game_dev', language: 'c++', tags: ['physics', 'collision', 'rigid_body'] },
      { content: '游戏AI: 行为树、状态机、实用系统。', type: 'game_dev', language: 'c++', tags: ['game_ai', 'behavior_tree', 'state_machine'] },
      { content: '网络同步: 客户端预测、服务器纠正、插值。', type: 'game_dev', language: 'c++', tags: ['networking', 'synchronization', 'prediction'] },
      { content: '游戏渲染: 管线渲染、延迟渲染、光线追踪。', type: 'game_dev', language: 'c++', tags: ['rendering', 'pipeline', 'ray_tracing'] },
      { content: 'Shader编程: GPU着色器，顶点/片段/计算着色器。', type: 'game_dev', language: 'glsl', tags: ['shader', 'gpu', 'glsl'] },
      { content: '资源管理: 内存池、对象池、资源加载。', type: 'game_dev', language: 'c++', tags: ['resource_management', 'memory_pool', 'asset'] },
      { content: '游戏编辑器: 关卡设计、场景编辑、调试工具。', type: 'game_dev', language: 'c++', tags: ['editor', 'level_design', 'tool'] },
      
      // ===== 云服务与架构 =====
      { content: 'AWS EC2: 弹性计算云，可扩展虚拟机。', type: 'cloud', language: 'general', tags: ['aws', 'ec2', 'compute'] },
      { content: 'AWS S3: 简单存储服务，对象存储。', type: 'cloud', language: 'general', tags: ['aws', 's3', 'storage'] },
      { content: 'AWS Lambda: 无服务器计算，事件驱动。', type: 'cloud', language: 'general', tags: ['aws', 'lambda', 'serverless'] },
      { content: 'AWS RDS: 关系型数据库服务。', type: 'cloud', language: 'general', tags: ['aws', 'rds', 'database'] },
      { content: 'AWS DynamoDB: 托管NoSQL数据库。', type: 'cloud', language: 'general', tags: ['aws', 'dynamodb', 'nosql'] },
      { content: 'AWS CloudFront: CDN内容分发网络。', type: 'cloud', language: 'general', tags: ['aws', 'cloudfront', 'cdn'] },
      { content: 'AWS Route53: 可扩展DNS和域名注册。', type: 'cloud', language: 'general', tags: ['aws', 'route53', 'dns'] },
      { content: 'AWS IAM: 身份和访问管理。', type: 'cloud', language: 'general', tags: ['aws', 'iam', 'security'] },
      { content: 'AWS SQS: 简单队列服务。', type: 'cloud', language: 'general', tags: ['aws', 'sqs', 'message_queue'] },
      { content: 'AWS SNS: 简单通知服务。', type: 'cloud', language: 'general', tags: ['aws', 'sns', 'notification'] },
      { content: 'Azure Virtual Machines: 微软云虚拟机服务。', type: 'cloud', language: 'general', tags: ['azure', 'vm', 'compute'] },
      { content: 'Azure Functions: 无服务器函数计算。', type: 'cloud', language: 'general', tags: ['azure', 'functions', 'serverless'] },
      { content: 'Azure Blob Storage: 大规模对象存储。', type: 'cloud', language: 'general', tags: ['azure', 'blob', 'storage'] },
      { content: 'Google Cloud Compute: GCP虚拟机服务。', type: 'cloud', language: 'general', tags: ['gcp', 'compute', 'vm'] },
      { content: 'Google Cloud Functions: GCP无服务器计算。', type: 'cloud', language: 'general', tags: ['gcp', 'functions', 'serverless'] },
      { content: 'Serverless架构: 按需执行，无需管理服务器。', type: 'cloud', language: 'general', tags: ['serverless', 'faas', 'event_driven'] },
      { content: '微前端: 将前端应用拆分为独立模块。', type: 'architecture', language: 'javascript', tags: ['microfrontend', 'modular', 'frontend'] },
      { content: 'BFF(Backend for Frontend): 面向前端的后端聚合层。', type: 'architecture', language: 'general', tags: ['bff', 'aggregation', 'backend'] },
      { content: 'CQRS: 命令查询职责分离。', type: 'architecture', language: 'general', tags: ['cqrs', 'separation', 'pattern'] },
      { content: '事件溯源: 存储事件而非当前状态。', type: 'architecture', language: 'general', tags: ['event_sourcing', 'event', 'state'] },
      
      // ===== 更多算法与数据结构 =====
      { content: '红黑树: 自平衡二叉搜索树，O(log n)操作。', type: 'algorithm', language: 'general', tags: ['red_black_tree', 'balanced', 'bst'] },
      { content: 'B树: 多路平衡搜索树，磁盘友好。', type: 'algorithm', language: 'general', tags: ['b_tree', 'multi_way', 'disk'] },
      { content: 'B+树: B树变体，叶子节点链表，范围查询优化。', type: 'algorithm', language: 'general', tags: ['b_plus_tree', 'index', 'range_query'] },
      { content: '跳表: 基于概率的平衡树替代方案。', type: 'algorithm', language: 'general', tags: ['skip_list', 'probabilistic', 'balanced'] },
      { content: '堆: 完全二叉树，优先队列实现。', type: 'data_structure', language: 'general', tags: ['heap', 'priority_queue', 'binary_tree'] },
      { content: '并查集: 不相交集合合并和查找。', type: 'data_structure', language: 'general', tags: ['union_find', 'disjoint_set', 'dsu'] },
      { content: '线段树: 高效范围查询和更新。', type: 'data_structure', language: 'general', tags: ['segment_tree', 'range_query', 'rmq'] },
      { content: '树状数组(BIT): 高效前缀和查询。', type: 'data_structure', language: 'general', tags: ['fenwick_tree', 'binary_indexed', 'prefix_sum'] },
      { content: '字典树(Trie): 字符串前缀匹配。', type: 'data_structure', language: 'general', tags: ['trie', 'prefix_tree', 'string'] },
      { content: '后缀树: 字符串所有后缀的压缩树。', type: 'data_structure', language: 'general', tags: ['suffix_tree', 'string', 'suffix'] },
      { content: '哈希表: O(1)平均查找、插入、删除。', type: 'data_structure', language: 'general', tags: ['hash_table', 'hash_map', 'dictionary'] },
      { content: '布隆过滤器: 空间效率高的概率数据结构。', type: 'data_structure', language: 'general', tags: ['bloom_filter', 'probabilistic', 'membership'] },
      { content: 'LRU缓存: 最近最少使用淘汰策略。', type: 'data_structure', language: 'general', tags: ['lru', 'cache', 'eviction'] },
      { content: 'LFU缓存: 最不经常使用淘汰策略。', type: 'data_structure', language: 'general', tags: ['lfu', 'cache', 'frequency'] },
      { content: '一致性哈希: 分布式哈希，减少节点变化时的数据迁移。', type: 'algorithm', language: 'general', tags: ['consistent_hashing', 'distributed', 'hash'] },
      
      // ===== 更广泛的编程知识 =====
      { content: 'RESTful API: 资源导向、HTTP方法、无状态。', type: 'api_design', language: 'general', tags: ['rest', 'api', 'stateless'] },
      { content: 'GraphQL: 查询语言，按需获取数据。', type: 'api_design', language: 'general', tags: ['graphql', 'query', 'schema'] },
      { content: 'gRPC: 高性能RPC框架，基于Protobuf。', type: 'api_design', language: 'general', tags: ['grpc', 'rpc', 'protobuf'] },
      { content: 'WebSocket: 全双工通信协议。', type: 'network', language: 'general', tags: ['websocket', 'full_duplex', 'realtime'] },
      { content: 'Server-Sent Events: 服务器推送事件。', type: 'network', language: 'general', tags: ['sse', 'server_push', 'realtime'] },
      { content: 'WebRTC: 网页实时通信，P2P音视频。', type: 'network', language: 'general', tags: ['webrtc', 'p2p', 'realtime'] },
      { content: 'TCP三次握手: SYN→SYN-ACK→ACK建立连接。', type: 'network', language: 'general', tags: ['tcp', 'handshake', 'connection'] },
      { content: 'TCP四次挥手: FIN→ACK→FIN→ACK断开连接。', type: 'network', language: 'general', tags: ['tcp', 'termination', 'four_way'] },
      { content: 'UDP: 无连接、不可靠但快速的传输协议。', type: 'network', language: 'general', tags: ['udp', 'connectionless', 'fast'] },
      { content: 'DNS解析: 域名→IP地址的解析过程。', type: 'network', language: 'general', tags: ['dns', 'resolution', 'domain'] },
      { content: 'HTTPS: HTTP over TLS/SSL，加密传输。', type: 'network', language: 'general', tags: ['https', 'tls', 'encryption'] },
      { content: 'HTTP/2: 多路复用、头部压缩、服务器推送。', type: 'network', language: 'general', tags: ['http2', 'multiplexing', 'compression'] },
      { content: 'HTTP/3: 基于QUIC，改进传输层。', type: 'network', language: 'general', tags: ['http3', 'quic', 'udp'] },
      { content: 'Load Balancing: 轮询、最少连接、加权、一致性哈希。', type: 'network', language: 'general', tags: ['load_balancing', 'strategy', 'distribution'] },
      
      // ===== 高级编程概念 =====
      { content: '元编程: 程序操作自身的能力（反射、宏、注解）。', type: 'programming_concept', language: 'general', tags: ['metaprogramming', 'reflection', 'macro'] },
      { content: '异步编程: 回调、Promise、async/await、事件循环。', type: 'programming_concept', language: 'general', tags: ['async', 'event_loop', 'non_blocking'] },
      { content: '函数式编程: 纯函数、不可变性、一等公民函数。', type: 'programming_concept', language: 'general', tags: ['functional', 'immutable', 'pure'] },
      { content: '响应式编程: 基于异步数据流的编程范式。', type: 'programming_concept', language: 'general', tags: ['reactive', 'observable', 'stream'] },
      { content: '并发编程: 多线程、多进程、协程、Greenlet。', type: 'programming_concept', language: 'general', tags: ['concurrency', 'thread', 'coroutine'] },
      { content: '并行编程: 同时执行多个计算任务。', type: 'programming_concept', language: 'general', tags: ['parallelism', 'multiprocessing', 'gpu'] },
      { content: '内存管理: 垃圾回收、引用计数、手动管理。', type: 'programming_concept', language: 'general', tags: ['memory_management', 'gc', 'allocation'] },
      { content: '指针与引用: 直接内存访问 vs 安全引用。', type: 'programming_concept', language: 'c', tags: ['pointer', 'reference', 'memory'] },
      { content: '泛型编程: 类型无关的通用代码。', type: 'programming_concept', language: 'general', tags: ['generics', 'polymorphism', 'template'] },
      { content: '面向对象: 封装、继承、多态、抽象。', type: 'programming_concept', language: 'general', tags: ['oop', 'encapsulation', 'inheritance'] },
      
      // ===== 更多语言特定知识 =====
      { content: 'Rust所有权: 每个值有所有者，值在所有者离开作用域时被丢弃。', type: 'language_feature', language: 'rust', tags: ['ownership', 'lifetime', 'borrow'] },
      { content: 'Rust借用规则: 同时只能有一个可变引用或任意数量的不可变引用。', type: 'language_feature', language: 'rust', tags: ['borrowing', 'rule', 'reference'] },
      { content: 'Rust生命周期: 保证引用在有效期内有效。', type: 'language_feature', language: 'rust', tags: ['lifetime', 'annotation', 'reference'] },
      { content: 'Rust Trait: 定义行为接口，类似接口。', type: 'language_feature', language: 'rust', tags: ['trait', 'interface', 'behavior'] },
      { content: 'Rust模式匹配: match表达式，强大的模式解构。', type: 'language_feature', language: 'rust', tags: ['pattern_matching', 'match', 'destructure'] },
      { content: 'Go Goroutine: 轻量级并发执行单元。', type: 'language_feature', language: 'go', tags: ['goroutine', 'concurrency', 'lightweight'] },
      { content: 'Go Channel: 类型安全的通信管道。', type: 'language_feature', language: 'go', tags: ['channel', 'communication', 'type_safe'] },
      { content: 'Go Defer: 延迟执行，资源清理。', type: 'language_feature', language: 'go', tags: ['defer', 'cleanup', 'resource'] },
      { content: 'Go Interface: 隐式满足的接口。', type: 'language_feature', language: 'go', tags: ['interface', 'implicit', 'duck_typing'] },
      { content: 'Go Select: 多路复用channel操作。', type: 'language_feature', language: 'go', tags: ['select', 'multiplexing', 'channel'] },
      { content: 'Python GIL: 全局解释器锁，限制多线程。', type: 'language_feature', language: 'python', tags: ['gil', 'threading', 'limitation'] },
      { content: 'Python装饰器: 函数/类的包装器，增强功能。', type: 'language_feature', language: 'python', tags: ['decorator', 'wrapper', 'meta'] },
      { content: 'Python上下文管理器: with语句，资源管理。', type: 'language_feature', language: 'python', tags: ['context_manager', 'with', 'resource'] },
      { content: 'Python元类: 创建类的类，高级元编程。', type: 'language_feature', language: 'python', tags: ['metaclass', 'class_creator', 'metaprogramming'] },
      { content: 'Java泛型: 编译期类型检查，类型擦除。', type: 'language_feature', language: 'java', tags: ['generics', 'type_erasure', 'compile_time'] },
      { content: 'Java注解: 元数据标注，编译期/运行期处理。', type: 'language_feature', language: 'java', tags: ['annotation', 'metadata', 'reflection'] },
      { content: 'Java Stream API: 函数式数据处理管道。', type: 'language_feature', language: 'java', tags: ['stream', 'functional', 'pipeline'] },
      { content: 'Java Lambda: 匿名函数，函数式编程支持。', type: 'language_feature', language: 'java', tags: ['lambda', 'anonymous', 'functional'] },
      { content: 'Java多态: 编译时多态(重载)和运行时多态(重写)。', type: 'language_feature', language: 'java', tags: ['polymorphism', 'overload', 'override'] },
      { content: 'C++ RAII: 资源获取即初始化，自动资源管理。', type: 'language_feature', language: 'cpp', tags: ['raii', 'resource', 'destructor'] },
      { content: 'C++智能指针: unique_ptr、shared_ptr、weak_ptr。', type: 'language_feature', language: 'cpp', tags: ['smart_pointer', 'unique_ptr', 'shared_ptr'] },
      { content: 'C++模板: 泛型编程，编译期多态。', type: 'language_feature', language: 'cpp', tags: ['template', 'metaprogramming', 'compile_time'] },
      { content: 'C++移动语义: 避免不必要的深拷贝。', type: 'language_feature', language: 'cpp', tags: ['move_semantics', 'rvalue', 'performance'] },
      { content: 'TypeScript类型系统: 静态类型、结构类型、渐进式类型。', type: 'language_feature', language: 'typescript', tags: ['type_system', 'static', 'structural'] },
      { content: 'TypeScript泛型: 类型参数化。', type: 'language_feature', language: 'typescript', tags: ['generics', 'type_parameter', 'reusable'] },
      { content: 'TypeScript条件类型: 根据条件选择类型。', type: 'language_feature', language: 'typescript', tags: ['conditional_type', 'mapped', 'infer'] },
      { content: 'JavaScript原型链: 对象属性查找机制。', type: 'language_feature', language: 'javascript', tags: ['prototype', 'inheritance', 'chain'] },
      { content: 'JavaScript闭包: 函数及其词法作用域的组合。', type: 'language_feature', language: 'javascript', tags: ['closure', 'scope', 'lexical'] },
      { content: 'JavaScript事件循环: 微任务和宏任务的执行顺序。', type: 'language_feature', language: 'javascript', tags: ['event_loop', 'microtask', 'macrotask'] },
      { content: 'Promise: 异步操作的最终结果。', type: 'language_feature', language: 'javascript', tags: ['promise', 'async', 'future'] },
      
      // ===== 代码质量与重构 =====
      { content: 'SOLID原则: 单一职责、开闭、里氏替换、接口隔离、依赖反转。', type: 'design_principle', language: 'general', tags: ['solid', 'principle', 'oop'] },
      { content: 'KISS原则: 保持简单，避免过度设计。', type: 'design_principle', language: 'general', tags: ['kiss', 'simple', 'over_engineering'] },
      { content: 'YAGNI: 你不会需要它，避免添加不必要的功能。', type: 'design_principle', language: 'general', tags: ['yagni', 'agile', 'simplicity'] },
      { content: 'DRY原则: 不要重复自己。', type: 'design_principle', language: 'general', tags: ['dry', 'donot_repeat', 'reuse'] },
      { content: 'Composition over Inheritance: 组合优于继承。', type: 'design_principle', language: 'general', tags: ['composition', 'inheritance', 'prefer'] },
      { content: 'Law of Demeter: 最小知识原则，减少耦合。', type: 'design_principle', language: 'general', tags: ['lod', 'demeter', 'coupling'] },
      { content: '代码异味: 过长方法、过大类、过度耦合、重复代码。', type: 'code_smell', language: 'general', tags: ['code_smell', 'refactoring', 'clean_code'] },
      { content: '重构模式: 提取方法、内联变量、移动方法、替换条件为多态。', type: 'refactoring', language: 'general', tags: ['refactoring', 'pattern', 'improvement'] },
      { content: 'Clean Code: 有意义的命名、小函数、单一抽象层。', type: 'code_quality', language: 'general', tags: ['clean_code', 'readability', 'maintainable'] },
      { content: '代码评审: 同行评审、自动化工具、检查清单。', type: 'code_review', language: 'general', tags: ['code_review', 'peer_review', 'checklist'] },
      
      // ===== 性能优化知识 =====
      { content: 'CPU缓存: L1/L2/L3缓存，缓存行、缓存命中。', type: 'performance', language: 'general', tags: ['cpu_cache', 'memory', 'performance'] },
      { content: '分支预测: 现代CPU的分支预测和投机执行。', type: 'performance', language: 'general', tags: ['branch_prediction', 'cpu', 'speculative'] },
      { content: 'SIMD: 单指令多数据，并行数据处理。', type: 'performance', language: 'c', tags: ['simd', 'vectorization', 'parallel'] },
      { content: '内存对齐: 数据在内存中的排列方式影响访问效率。', type: 'performance', language: 'c', tags: ['memory_alignment', 'padding', 'struct'] },
      { content: '对象池: 预分配和复用对象，减少GC压力。', type: 'performance', language: 'general', tags: ['object_pool', 'gc', 'allocation'] },
      { content: '零拷贝: 减少数据在内核态和用户态之间的复制。', type: 'performance', language: 'general', tags: ['zero_copy', 'kernel', 'performance'] },
      { content: '无锁编程: CAS原子操作、无锁数据结构。', type: 'performance', language: 'general', tags: ['lock_free', 'cas', 'atomic'] },
      { content: 'JIT编译: 热点代码编译为机器码。', type: 'performance', language: 'general', tags: ['jit', 'compilation', 'runtime'] },
      { content: 'AOT编译: 提前编译为原生代码。', type: 'performance', language: 'general', tags: ['aot', 'native', 'compile'] },
      { content: 'Profiling: 性能剖析，CPU profile、内存profile。', type: 'performance', language: 'general', tags: ['profiling', 'cpu', 'memory'] },
      
      // ===== 数据科学与机器学习 =====
      { content: '监督学习: 有标签数据训练模型，分类和回归。', type: 'ai_ml', language: 'python', tags: ['supervised', 'classification', 'regression'] },
      { content: '无监督学习: 无标签数据发现模式，聚类和降维。', type: 'ai_ml', language: 'python', tags: ['unsupervised', 'clustering', 'dimensionality'] },
      { content: '强化学习: 智能体通过与环境交互学习策略。', type: 'ai_ml', language: 'python', tags: ['reinforcement', 'agent', 'policy'] },
      { content: '线性回归: 拟合输入输出的线性关系。', type: 'ai_ml', language: 'python', tags: ['linear_regression', 'regression', 'model'] },
      { content: '逻辑回归: 二分类预测，sigmoid函数。', type: 'ai_ml', language: 'python', tags: ['logistic_regression', 'classification', 'sigmoid'] },
      { content: '决策树: 基于特征条件的树形分类模型。', type: 'ai_ml', language: 'python', tags: ['decision_tree', 'cART', 'classification'] },
      { content: '随机森林: 多棵决策树的集成学习。', type: 'ai_ml', language: 'python', tags: ['random_forest', 'ensemble', 'bagging'] },
      { content: '梯度提升树: 序列化构建弱分类器。', type: 'ai_ml', language: 'python', tags: ['gradient_boosting', 'xgboost', 'lightgbm'] },
      { content: '支持向量机(SVM): 最大间隔分类器。', type: 'ai_ml', language: 'python', tags: ['svm', 'kernel', 'max_margin'] },
      { content: 'K-Means聚类: 基于距离的迭代聚类。', type: 'ai_ml', language: 'python', tags: ['kmeans', 'clustering', 'centroid'] },
      { content: '主成分分析(PCA): 降维技术，保留最大方差。', type: 'ai_ml', language: 'python', tags: ['pca', 'dimensionality_reduction', 'variance'] },
      { content: '神经网络: 多层感知机，前馈和反向传播。', type: 'ai_ml', language: 'python', tags: ['neural_network', 'mlp', 'backpropagation'] },
      { content: '卷积神经网络(CNN): 处理图像的局部连接网络。', type: 'ai_ml', language: 'python', tags: ['cnn', 'convolutional', 'image'] },
      { content: '循环神经网络(RNN): 处理序列数据。', type: 'ai_ml', language: 'python', tags: ['rnn', 'recurrent', 'sequence'] },
      { content: 'Transformer: 基于自注意力机制的深度学习模型。', type: 'ai_ml', language: 'python', tags: ['transformer', 'attention', 'self_attention'] },
      { content: 'BERT: 双向编码器表示，预训练语言模型。', type: 'ai_ml', language: 'python', tags: ['bert', 'nlp', 'pretraining'] },
      { content: 'GPT: 生成式预训练转换器。', type: 'ai_ml', language: 'python', tags: ['gpt', 'generative', 'llm'] },
      { content: '损失函数: 交叉熵、MSE、MAE等优化目标。', type: 'ai_ml', language: 'python', tags: ['loss_function', 'cross_entropy', 'mse'] },
      { content: '优化器: SGD、Adam、RMSprop等。', type: 'ai_ml', language: 'python', tags: ['optimizer', 'adam', 'sgd'] },
      { content: '过拟合与欠拟合: 模型复杂度与泛化能力的权衡。', type: 'ai_ml', language: 'python', tags: ['overfitting', 'underfitting', 'regularization'] },
      
      // ===== 计算机科学基础 =====
      { content: '时间复杂度: O(1)、O(log n)、O(n)、O(n log n)、O(n²)、O(2^n)。', type: 'algorithm', language: 'general', tags: ['time_complexity', 'big_o', 'notation'] },
      { content: '空间复杂度: 算法所需内存空间。', type: 'algorithm', language: 'general', tags: ['space_complexity', 'memory', 'big_o'] },
      { content: '排序算法: 冒泡、选择、插入、归并、快速、堆排序。', type: 'algorithm', language: 'general', tags: ['sorting', 'algorithm', 'comparison'] },
      { content: '查找算法: 线性查找、二分查找、哈希查找。', type: 'algorithm', language: 'general', tags: ['searching', 'binary_search', 'hash'] },
      { content: '动态规划: 最优子结构、重叠子问题。', type: 'algorithm', language: 'general', tags: ['dynamic_programming', 'memoization', 'optimization'] },
      { content: '贪心算法: 每一步做出局部最优选择。', type: 'algorithm', language: 'general', tags: ['greedy', 'local_optimum', 'algorithm'] },
      { content: '分治法: 分解、解决、合并。', type: 'algorithm', language: 'general', tags: ['divide_and_conquer', 'merge_sort', 'quicksort'] },
      { content: '回溯法: 深度优先搜索+剪枝。', type: 'algorithm', language: 'general', tags: ['backtracking', 'dfs', 'pruning'] },
      { content: '图算法: BFS、DFS、最短路径、最小生成树。', type: 'algorithm', language: 'general', tags: ['graph', 'bfs', 'dfs', 'shortest_path'] },
      { content: '字符串算法: KMP、Boyer-Moore、Rabin-Karp。', type: 'algorithm', language: 'general', tags: ['string', 'pattern_matching', 'kmp'] },
      
      // ===== 操作系统基础 =====
      { content: '进程与线程: 资源分配单位vs执行单位。', type: 'os', language: 'general', tags: ['process', 'thread', 'concurrency'] },
      { content: '进程间通信: 管道、消息队列、共享内存、信号量。', type: 'os', language: 'general', tags: ['ipc', 'pipe', 'shared_memory'] },
      { content: '进程调度: FCFS、SJF、优先级、时间片轮转。', type: 'os', language: 'general', tags: ['scheduling', 'fcfs', 'round_robin'] },
      { content: '内存管理: 分页、分段、虚拟内存。', type: 'os', language: 'general', tags: ['memory', 'paging', 'segmentation', 'virtual'] },
      { content: '页面置换: FIFO、LRU、LFU、Clock算法。', type: 'os', language: 'general', tags: ['page_replacement', 'lru', 'fifo'] },
      { content: '文件系统: FAT、NTFS、ext4、APFS。', type: 'os', language: 'general', tags: ['filesystem', 'fat', 'ntfs', 'ext4'] },
      { content: '死锁: 四个必要条件、预防和避免。', type: 'os', language: 'general', tags: ['deadlock', 'prevention', 'four_conditions'] },
      { content: '同步与互斥: 互斥锁、条件变量、信号量。', type: 'os', language: 'general', tags: ['synchronization', 'mutex', 'semaphore'] },
      
      // ===== 更多DevOps与SRE =====
      { content: 'CI/CD流程: 持续集成、持续交付、持续部署。', type: 'devops', language: 'general', tags: ['ci_cd', 'continuous', 'pipeline'] },
      { content: 'Jenkins: 开源自动化服务器。', type: 'devops', language: 'general', tags: ['jenkins', 'automation', 'pipeline'] },
      { content: 'GitHub Actions: 原生CI/CD。', type: 'devops', language: 'general', tags: ['github_actions', 'ci_cd', 'workflow'] },
      { content: 'GitLab CI: GitLab内置CI/CD。', type: 'devops', language: 'general', tags: ['gitlab_ci', 'ci_cd', 'runner'] },
      { content: 'Terraform: 基础设施即代码。', type: 'devops', language: 'general', tags: ['terraform', 'iac', 'infrastructure'] },
      { content: 'Ansible: 自动化配置管理。', type: 'devops', language: 'general', tags: ['ansible', 'configuration', 'automation'] },
      { content: 'Prometheus: 监控和告警系统。', type: 'devops', language: 'general', tags: ['prometheus', 'monitoring', 'alerting'] },
      { content: 'Grafana: 数据可视化和仪表盘。', type: 'devops', language: 'general', tags: ['grafana', 'visualization', 'dashboard'] },
      { content: 'OpenTelemetry: 可观测性数据框架。', type: 'devops', language: 'general', tags: ['opentelemetry', 'observability', 'tracing'] },
      { content: 'SLA/SLO/SLA: 服务等级协议、目标、承诺。', type: 'devops', language: 'general', tags: ['sla', 'slo', 'slis', 'reliability'] },
      { content: 'Site Reliability Engineering: 站点可靠性工程。', type: 'devops', language: 'general', tags: ['sre', 'reliability', 'incident'] },
      { content: '混沌工程: 主动注入故障验证系统弹性。', type: 'devops', language: 'general', tags: ['chaos_engineering', 'resilience', 'fault_injection'] },
      { content: '蓝绿部署: 零停机部署策略。', type: 'devops', language: 'general', tags: ['blue_green', 'deployment', 'zero_downtime'] },
      { content: '金丝雀发布: 逐步发布新版本。', type: 'devops', language: 'general', tags: ['canary', 'release', 'gradual'] },
      { content: '特性开关: 控制功能可见性。', type: 'devops', language: 'general', tags: ['feature_flag', 'toggle', 'release'] },
      
      // ===== 更多前端技术 =====
      { content: 'Vue.js: 渐进式JavaScript框架。', type: 'frontend', language: 'javascript', tags: ['vue', 'framework', 'progressive'] },
      { content: 'Vue Composition API: 基于函数的组件逻辑复用。', type: 'frontend', language: 'javascript', tags: ['vue', 'composition_api', 'hook'] },
      { content: 'Angular: 完整的前端MVC框架。', type: 'frontend', language: 'typescript', tags: ['angular', 'framework', 'mvc'] },
      { content: 'Svelte: 编译时框架，虚拟DOM替代。', type: 'frontend', language: 'javascript', tags: ['svelte', 'compiler', 'framework'] },
      { content: 'Next.js: React的全栈框架。', type: 'frontend', language: 'javascript', tags: ['nextjs', 'react', 'ssr'] },
      { content: 'Nuxt.js: Vue的全栈框架。', type: 'frontend', language: 'javascript', tags: ['nuxt', 'vue', 'ssr'] },
      { content: 'Vite: 新一代前端构建工具。', type: 'frontend', language: 'javascript', tags: ['vite', 'build_tool', 'hmr'] },
      { content: 'Webpack: 模块打包器。', type: 'frontend', language: 'javascript', tags: ['webpack', 'bundler', 'module'] },
      { content: 'Babel: JavaScript转译器。', type: 'frontend', language: 'javascript', tags: ['babel', 'transpiler', 'esnext'] },
      { content: 'ESLint: JavaScript代码检查工具。', type: 'frontend', language: 'javascript', tags: ['eslint', 'linter', 'code_quality'] },
      { content: 'Prettier: 代码格式化工具。', type: 'frontend', language: 'javascript', tags: ['prettier', 'formatter', 'code_style'] },
      { content: 'Tailwind CSS: 实用优先的CSS框架。', type: 'frontend', language: 'css', tags: ['tailwind', 'css', 'utility_first'] },
      { content: 'PostCSS: CSS转换工具。', type: 'frontend', language: 'css', tags: ['postcss', 'transform', 'autoprefixer'] },
      { content: 'WebAssembly: 二进制指令格式，高性能执行。', type: 'frontend', language: 'wasm', tags: ['wasm', 'binary', 'performance'] },
      { content: 'Service Worker: 浏览器后台脚本，离线支持。', type: 'frontend', language: 'javascript', tags: ['service_worker', 'offline', 'pwa'] },
      { content: 'Web Components: 原生组件化方案。', type: 'frontend', language: 'javascript', tags: ['web_components', 'custom_element', 'shadow_dom'] },
      { content: 'Shadow DOM: 样式和DOM封装。', type: 'frontend', language: 'javascript', tags: ['shadow_dom', 'encapsulation', 'web_component'] },
      { content: 'HTML5 Canvas: 2D图形绘制API。', type: 'frontend', language: 'javascript', tags: ['canvas', '2d', 'graphics'] },
      { content: 'WebGL: 基于OpenGL ES的3D图形API。', type: 'frontend', language: 'javascript', tags: ['webgl', '3d', 'gpu'] },
      { content: 'IndexedDB: 浏览器端NoSQL数据库。', type: 'frontend', language: 'javascript', tags: ['indexeddb', 'nosql', 'browser_storage'] },
      
      // ===== 更多后端技术 =====
      { content: 'Express.js: Node.js Web应用框架。', type: 'backend', language: 'javascript', tags: ['express', 'nodejs', 'web_framework'] },
      { content: 'Koa.js: 轻量级Node.js框架。', type: 'backend', language: 'javascript', tags: ['koa', 'middleware', 'nodejs'] },
      { content: 'NestJS: 渐进式Node.js框架，基于TypeScript。', type: 'backend', language: 'typescript', tags: ['nestjs', 'nodejs', 'typescript'] },
      { content: 'Django: Python Web框架，遵循MTV架构。', type: 'backend', language: 'python', tags: ['django', 'python', 'mtv'] },
      { content: 'Flask: Python轻量级Web框架。', type: 'backend', language: 'python', tags: ['flask', 'python', 'micro_framework'] },
      { content: 'FastAPI: 现代Python Web框架，基于ASGI。', type: 'backend', language: 'python', tags: ['fastapi', 'python', 'asgi'] },
      { content: 'Spring Boot: Java Web框架，自动配置。', type: 'backend', language: 'java', tags: ['spring_boot', 'java', 'auto_config'] },
      { content: 'Ruby on Rails: Ruby Web框架，约定优于配置。', type: 'backend', language: 'ruby', tags: ['rails', 'ruby', 'convention'] },
      { content: 'Laravel: PHP Web框架，优雅简洁。', type: 'backend', language: 'php', tags: ['laravel', 'php', 'eloquent'] },
      { content: 'ASP.NET Core: 跨平台Web框架。', type: 'backend', language: 'csharp', tags: ['aspnet', 'csharp', 'cross_platform'] },
      { content: 'GraphQL Apollo: GraphQL服务器实现。', type: 'backend', language: 'javascript', tags: ['apollo', 'graphql', 'server'] },
      { content: 'Socket.IO: WebSocket实时通信库。', type: 'backend', language: 'javascript', tags: ['socketio', 'websocket', 'realtime'] },
      
      // ===== 数据库深入知识 =====
      { content: '数据库事务: ACID特性（原子性、一致性、隔离性、持久性）。', type: 'database', language: 'general', tags: ['acid', 'transaction', 'property'] },
      { content: 'SQL优化: EXPLAIN、索引使用、执行计划分析。', type: 'database', language: 'general', tags: ['sql_optimization', 'explain', 'execution_plan'] },
      { content: '分库分表: 垂直拆分、水平拆分、分片策略。', type: 'database', language: 'general', tags: ['sharding', 'partitioning', 'scaling'] },
      { content: '数据复制: 主从复制、多主复制、无中心化复制。', type: 'database', language: 'general', tags: ['replication', 'master_slave', 'multi_master'] },
      { content: 'MongoDB: 文档型NoSQL数据库。', type: 'database', language: 'javascript', tags: ['mongodb', 'document', 'nosql'] },
      { content: 'Redis: 内存键值存储，支持多种数据结构。', type: 'database', language: 'general', tags: ['redis', 'in_memory', 'key_value'] },
      { content: 'PostgreSQL: 功能丰富的开源关系型数据库。', type: 'database', language: 'general', tags: ['postgresql', 'psql', 'open_source'] },
      { content: 'MySQL: 最流行的开源关系型数据库。', type: 'database', language: 'general', tags: ['mysql', 'relational', 'open_source'] },
      { content: 'MariaDB: MySQL的开源分支。', type: 'database', language: 'general', tags: ['mariadb', 'mysql', 'fork'] },
      { content: 'SQLite: 轻量级嵌入式数据库。', type: 'database', language: 'c', tags: ['sqlite', 'embedded', 'file_based'] },
      { content: 'DynamoDB: AWS托管的键值/文档数据库。', type: 'database', language: 'general', tags: ['dynamodb', 'aws', 'managed'] },
      { content: 'Cassandra: 分布式宽列存储数据库。', type: 'database', language: 'java', tags: ['cassandra', 'wide_column', 'distributed'] },
      { content: 'Neo4j: 图数据库。', type: 'database', language: 'java', tags: ['neo4j', 'graph', 'nosql'] },
      { content: 'InnoDB: MySQL的事务存储引擎。', type: 'database', language: 'c', tags: ['innodb', 'mysql', 'engine'] },
      { content: 'MyISAM: MySQL的非事务存储引擎。', type: 'database', language: 'c', tags: ['myisam', 'mysql', 'engine'] },
      { content: '数据库连接池优化: 最大连接数、空闲超时、获取超时。', type: 'database', language: 'general', tags: ['connection_pool', 'tuning', 'performance'] },
      
      // ===== 更多设计模式 =====
      { content: '工厂方法模式: 定义创建对象的接口，子类决定实例化。', type: 'design_pattern', language: 'general', tags: ['factory_method', 'creational', 'pattern'] },
      { content: '抽象工厂模式: 创建相关对象的家族。', type: 'design_pattern', language: 'general', tags: ['abstract_factory', 'creational', 'pattern'] },
      { content: '原型模式: 克隆现有对象。', type: 'design_pattern', language: 'general', tags: ['prototype', 'creational', 'clone'] },
      { content: '建造者模式: 分步构建复杂对象。', type: 'design_pattern', language: 'general', tags: ['builder', 'creational', 'construction'] },
      { content: '适配器模式: 将不兼容的接口转换。', type: 'design_pattern', language: 'general', tags: ['adapter', 'structural', 'wrapper'] },
      { content: '桥接模式: 分离抽象和实现。', type: 'design_pattern', language: 'general', tags: ['bridge', 'structural', 'abstraction'] },
      { content: '装饰器模式: 动态添加对象行为。', type: 'design_pattern', language: 'general', tags: ['decorator', 'structural', 'wrapping'] },
      { content: '外观模式: 简化子系统的接口。', type: 'design_pattern', language: 'general', tags: ['facade', 'structural', 'simplify'] },
      { content: '享元模式: 共享对象减少内存使用。', type: 'design_pattern', language: 'general', tags: ['flyweight', 'structural', 'memory'] },
      { content: '代理模式: 为对象提供代理。', type: 'design_pattern', language: 'general', tags: ['proxy', 'structural', 'representative'] },
      { content: '职责链模式: 请求沿链传递。', type: 'design_pattern', language: 'general', tags: ['chain_of_responsibility', 'behavioral', 'handler'] },
      { content: '命令模式: 将请求封装为对象。', type: 'design_pattern', language: 'general', tags: ['command', 'behavioral', 'encapsulate'] },
      { content: '中介者模式: 对象间通过中介通信。', type: 'design_pattern', language: 'general', tags: ['mediator', 'behavioral', 'communication'] },
      { content: '备忘录模式: 保存和恢复对象状态。', type: 'design_pattern', language: 'general', tags: ['memento', 'behavioral', 'state'] },
      { content: '观察者模式: 对象间的一对多依赖。', type: 'design_pattern', language: 'general', tags: ['observer', 'behavioral', 'event'] },
      { content: '状态模式: 对象状态变化时改变行为。', type: 'design_pattern', language: 'general', tags: ['state', 'behavioral', 'transition'] },
      { content: '策略模式: 定义一系列可互换算法。', type: 'design_pattern', language: 'general', tags: ['strategy', 'behavioral', 'algorithm'] },
      { content: '模板方法模式: 定义算法骨架。', type: 'design_pattern', language: 'general', tags: ['template_method', 'behavioral', 'skeleton'] },
      { content: '访问者模式: 分离数据结构和操作。', type: 'design_pattern', language: 'general', tags: ['visitor', 'behavioral', 'operation'] },
      { content: '迭代器模式: 顺序访问集合元素。', type: 'design_pattern', language: 'general', tags: ['iterator', 'behavioral', 'traversal'] },
      
      // ===== 错误码与解决方案 =====
      { content: 'ECONNREFUSED: 连接被拒绝，检查服务是否启动、端口是否正确。', type: 'error_code', language: 'general', tags: ['connection', 'refused', 'network'] },
      { content: 'ETIMEDOUT: 连接超时，检查网络延迟、服务器负载。', type: 'error_code', language: 'general', tags: ['timeout', 'network', 'latency'] },
      { content: 'ENOENT: 文件不存在，检查路径、文件是否存在。', type: 'error_code', language: 'c', tags: ['file', 'not_found', 'io'] },
      { content: 'EACCES: 权限不足，检查文件/目录权限。', type: 'error_code', language: 'c', tags: ['permission', 'denied', 'file'] },
      { content: 'ENOMEM: 内存不足，优化内存使用或增加系统内存。', type: 'error_code', language: 'c', tags: ['memory', 'out', 'allocation'] },
      { content: 'EPIPE: 管道破裂，写入已关闭的管道。', type: 'error_code', language: 'c', tags: ['pipe', 'broken', 'io'] },
      { content: 'EADDRINUSE: 地址已被使用，更换端口或释放占用。', type: 'error_code', language: 'c', tags: ['address', 'in_use', 'port'] },
      { content: 'HTTP 400: 请求错误，检查请求参数格式。', type: 'error_code', language: 'general', tags: ['http', '400', 'bad_request'] },
      { content: 'HTTP 401: 未授权，检查认证凭证。', type: 'error_code', language: 'general', tags: ['http', '401', 'unauthorized'] },
      { content: 'HTTP 403: 禁止访问，检查权限。', type: 'error_code', language: 'general', tags: ['http', '403', 'forbidden'] },
      { content: 'HTTP 404: 资源不存在，检查URL。', type: 'error_code', language: 'general', tags: ['http', '404', 'not_found'] },
      { content: 'HTTP 429: 请求过多，实现速率限制。', type: 'error_code', language: 'general', tags: ['http', '429', 'rate_limit'] },
      { content: 'HTTP 500: 服务器内部错误，检查服务日志。', type: 'error_code', language: 'general', tags: ['http', '500', 'server_error'] },
      { content: 'HTTP 502: 网关错误，检查上游服务。', type: 'error_code', language: 'general', tags: ['http', '502', 'bad_gateway'] },
      { content: 'HTTP 503: 服务不可用，服务可能正在重启。', type: 'error_code', language: 'general', tags: ['http', '503', 'unavailable'] },
      { content: 'HTTP 504: 网关注入超时，检查上游响应时间。', type: 'error_code', language: 'general', tags: ['http', '504', 'gateway_timeout'] },
      
      // ===== 常用正则表达式 =====
      { content: '邮箱正则: /^[\\w.-]+@[\\w-]+\\.[\\w.-]+$/', type: 'regex', language: 'general', tags: ['email', 'validation', 'regex'] },
      { content: '手机号正则(中国): /^1[3-9]\\d{9}$/', type: 'regex', language: 'general', tags: ['phone', 'china', 'regex'] },
      { content: 'URL正则: /^https?:\\/\\/[\\w-]+(\\.[\\w-]+)+[\\w.,@?^=%&:/~+#-]*$/', type: 'regex', language: 'general', tags: ['url', 'validation', 'regex'] },
      { content: 'IP地址正则: /^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$/', type: 'regex', language: 'general', tags: ['ip', 'validation', 'regex'] },
      { content: '日期正则(YYYY-MM-DD): /^\\d{4}-\\d{2}-\\d{2}$/', type: 'regex', language: 'general', tags: ['date', 'validation', 'regex'] },
      { content: '时间正则(HH:mm:ss): /^([01]?\\d|2[0-3]):[0-5]\\d:[0-5]\\d$/', type: 'regex', language: 'general', tags: ['time', 'validation', 'regex'] },
      { content: '身份证正则(中国): /^[1-9]\\d{5}(19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]$/', type: 'regex', language: 'general', tags: ['id_card', 'china', 'regex'] },
      { content: '邮政编码正则: /^\\d{6}$/', type: 'regex', language: 'general', tags: ['postal', 'code', 'regex'] },
      { content: '用户名正则: /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/', type: 'regex', language: 'general', tags: ['username', 'validation', 'regex'] },
      { content: '密码强度正则: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$/', type: 'regex', language: 'general', tags: ['password', 'strength', 'regex'] },
      
      // ===== API 速查 =====
      { content: 'Fetch API: fetch(url, { method, headers, body }) 返回Response。', type: 'api_reference', language: 'javascript', tags: ['fetch', 'http', 'api'] },
      { content: 'Response对象: .status、.ok、.json()、.text()、.headers。', type: 'api_reference', language: 'javascript', tags: ['response', 'fetch', 'api'] },
      { content: 'Request对象: new Request(url, init) 可复用的请求对象。', type: 'api_reference', language: 'javascript', tags: ['request', 'fetch', 'api'] },
      { content: 'Headers API: new Headers()、.append()、.get()、.set()、.entries()。', type: 'api_reference', language: 'javascript', tags: ['headers', 'fetch', 'api'] },
      { content: 'localStorage: .setItem(key, val)、.getItem(key)、.removeItem(key)、.clear()。', type: 'api_reference', language: 'javascript', tags: ['localstorage', 'storage', 'api'] },
      { content: 'sessionStorage: 与localStorage类似，标签页级别存储。', type: 'api_reference', language: 'javascript', tags: ['sessionstorage', 'storage', 'api'] },
      { content: 'Document.querySelector: 使用CSS选择器查询DOM元素。', type: 'api_reference', language: 'javascript', tags: ['querySelector', 'dom', 'api'] },
      { content: 'Document.querySelectorAll: 返回所有匹配元素的NodeList。', type: 'api_reference', language: 'javascript', tags: ['querySelectorAll', 'dom', 'api'] },
      { content: 'Element.classList: .add()、.remove()、.toggle()、.contains()、.replace()。', type: 'api_reference', language: 'javascript', tags: ['classList', 'dom', 'css'] },
      { content: 'Element.dataset: 访问data-*属性。', type: 'api_reference', language: 'javascript', tags: ['dataset', 'dom', 'attribute'] },
      { content: 'JSON.parse(str, reviver): 解析JSON字符串，reviver可转换值。', type: 'api_reference', language: 'javascript', tags: ['json', 'parse', 'api'] },
      { content: 'JSON.stringify(obj, replacer, space): 序列化JSON，replacer可过滤。', type: 'api_reference', language: 'javascript', tags: ['json', 'stringify', 'api'] },
      { content: 'Array.prototype: .map()、.filter()、.reduce()、.find()、.some()、.every()。', type: 'api_reference', language: 'javascript', tags: ['array', 'method', 'api'] },
      { content: 'Promise.all(iterable): 所有Promise成功后返回结果数组。', type: 'api_reference', language: 'javascript', tags: ['promise', 'all', 'api'] },
      { content: 'Promise.race(iterable): 第一个settled的Promise结果。', type: 'api_reference', language: 'javascript', tags: ['promise', 'race', 'api'] },
      { content: 'Promise.allSettled(iterable): 所有Promise完成后返回状态数组。', type: 'api_reference', language: 'javascript', tags: ['promise', 'allSettled', 'api'] },
      { content: 'Promise.any(iterable): 第一个fulfilled的Promise结果。', type: 'api_reference', language: 'javascript', tags: ['promise', 'any', 'api'] },
      { content: 'async/await: 异步函数、await等待Promise。', type: 'api_reference', language: 'javascript', tags: ['async', 'await', 'promise'] },
      
      // ===== Git 版本控制 =====
      { content: 'git init: 初始化新仓库。', type: 'git', language: 'general', tags: ['git', 'init', 'repository'] },
      { content: 'git clone: 克隆远程仓库。', type: 'git', language: 'general', tags: ['git', 'clone', 'repository'] },
      { content: 'git add: 添加文件到暂存区。', type: 'git', language: 'general', tags: ['git', 'add', 'staging'] },
      { content: 'git commit: 提交暂存区到本地仓库。', type: 'git', language: 'general', tags: ['git', 'commit', 'commit_message'] },
      { content: 'git push: 推送本地提交到远程。', type: 'git', language: 'general', tags: ['git', 'push', 'remote'] },
      { content: 'git pull: 拉取远程更新并合并。', type: 'git', language: 'general', tags: ['git', 'pull', 'fetch_merge'] },
      { content: 'git fetch: 拉取远程更新但不合并。', type: 'git', language: 'general', tags: ['git', 'fetch', 'remote'] },
      { content: 'git branch: 创建/删除/列出分支。', type: 'git', language: 'general', tags: ['git', 'branch', 'branching'] },
      { content: 'git merge: 合并分支。', type: 'git', language: 'general', tags: ['git', 'merge', 'branching'] },
      { content: 'git rebase: 变基，线性化提交历史。', type: 'git', language: 'general', tags: ['git', 'rebase', 'history'] },
      { content: 'git stash: 暂存当前修改。', type: 'git', language: 'general', tags: ['git', 'stash', 'temporary'] },
      { content: 'git reset: 重置HEAD到指定状态。', type: 'git', language: 'general', tags: ['git', 'reset', 'undo'] },
      { content: 'git revert: 创建新提交撤销指定提交。', type: 'git', language: 'general', tags: ['git', 'revert', 'undo'] },
      { content: 'git reflog: 查看HEAD引用历史。', type: 'git', language: 'general', tags: ['git', 'reflog', 'history'] },
      { content: 'git cherry-pick: 拣选特定提交。', type: 'git', language: 'general', tags: ['git', 'cherry_pick', 'commit'] },
      { content: 'git squash: 压缩多个提交为一个。', type: 'git', language: 'general', tags: ['git', 'squash', 'commit'] },
      { content: 'git bisect: 二分查找引入bug的提交。', type: 'git', language: 'general', tags: ['git', 'bisect', 'debugging'] },
      
      // ===== 实用代码片段 =====
      { content: '深拷贝(JS): const deepClone = obj => JSON.parse(JSON.stringify(obj));', type: 'code_snippet', language: 'javascript', tags: ['deep_clone', 'json', 'utility'] },
      { content: '生成唯一ID(JS): const uid = () => Math.random().toString(36).substr(2, 9);', type: 'code_snippet', language: 'javascript', tags: ['uid', 'unique_id', 'random'] },
      { content: '格式化日期(JS): new Date().toISOString().split("T")[0];', type: 'code_snippet', language: 'javascript', tags: ['date', 'format', 'utility'] },
      { content: '随机数(JS): const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;', type: 'code_snippet', language: 'javascript', tags: ['random', 'number', 'utility'] },
      { content: '等待延迟(JS): const sleep = ms => new Promise(res => setTimeout(res, ms));', type: 'code_snippet', language: 'javascript', tags: ['sleep', 'delay', 'promise'] },
      { content: '检测空对象(JS): const isEmpty = obj => Object.keys(obj).length === 0;', type: 'code_snippet', language: 'javascript', tags: ['empty', 'object', 'utility'] },
      { content: '截断字符串(JS): const truncate = (str, n) => str.length > n ? str.slice(0, n) + "..." : str;', type: 'code_snippet', language: 'javascript', tags: ['truncate', 'string', 'utility'] },
      { content: '验证URL(JS): const isValidUrl = str => /^https?:\\/\\/.+/.test(str);', type: 'code_snippet', language: 'javascript', tags: ['url', 'validate', 'regex'] },
      { content: '转换驼峰到下划线(JS): const toSnake = str => str.replace(/[A-Z]/g, c => "_" + c.toLowerCase());', type: 'code_snippet', language: 'javascript', tags: ['camel', 'snake', 'convert'] },
      { content: '转换下划线到驼峰(JS): const toCamel = str => str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());', type: 'code_snippet', language: 'javascript', tags: ['snake', 'camel', 'convert'] },
      { content: '读取文件(Python): with open("file.txt", "r") as f: content = f.read()', type: 'code_snippet', language: 'python', tags: ['file', 'read', 'context'] },
      { content: '写入文件(Python): with open("file.txt", "w") as f: f.write("content")', type: 'code_snippet', language: 'python', tags: ['file', 'write', 'context'] },
      { content: 'CSV读写(Python): import csv; csv.writer(f).writerow(row); csv.reader(f)', type: 'code_snippet', language: 'python', tags: ['csv', 'read', 'write'] },
      { content: 'JSON读写(Python): import json; json.dump(data, f); json.load(f)', type: 'code_snippet', language: 'python', tags: ['json', 'read', 'write'] },
      { content: '时间格式化(Python): datetime.now().strftime("%Y-%m-%d %H:%M:%S")', type: 'code_snippet', language: 'python', tags: ['datetime', 'format', 'strftime'] },
      { content: '进度条(Python): from tqdm import tqdm; for i in tqdm(range(100)):', type: 'code_snippet', language: 'python', tags: ['progress', 'bar', 'tqdm'] },
      { content: '命令行参数(Python): import argparse; parser.add_argument("--verbose")', type: 'code_snippet', language: 'python', tags: ['argparse', 'cli', 'argument'] },
      { content: '环境变量(Python): import os; os.environ.get("KEY", "default")', type: 'code_snippet', language: 'python', tags: ['env', 'variable', 'config'] },
      
      // ===== 系统设计案例 =====
      { content: '短链服务: 哈希生成短码、缓存查询、重定向跳转。', type: 'system_design', language: 'general', tags: ['url_shortener', 'hash', 'cache'] },
      { content: '秒杀系统: 库存扣减、限流、异步下单、最终一致性。', type: 'system_design', language: 'general', tags: ['seckill', 'flash_sale', 'high_concurrency'] },
      { content: '聊天室: WebSocket、消息广播、在线状态、历史消息。', type: 'system_design', language: 'general', tags: ['chat', 'websocket', 'realtime'] },
      { content: '图片处理: 上传存储、CDN分发、缩略图生成、格式转换。', type: 'system_design', language: 'general', tags: ['image', 'processing', 'cdn'] },
      { content: '推送服务: 设备注册、消息队列、批量推送、送达确认。', type: 'system_design', language: 'general', tags: ['push', 'notification', 'mobile'] },
      { content: '搜索引擎: 爬虫、索引、分词、相关性排序。', type: 'system_design', language: 'general', tags: ['search', 'engine', 'indexing'] },
      { content: '推荐系统: 协同过滤、内容推荐、实时更新、AB测试。', type: 'system_design', language: 'general', tags: ['recommendation', 'collaborative', 'filtering'] },
      { content: '支付系统: 第三方对接、对账、风控、幂等保证。', type: 'system_design', language: 'general', tags: ['payment', 'third_party', 'reconciliation'] },
      { content: '订单系统: 状态机、库存扣减、支付回调、物流追踪。', type: 'system_design', language: 'general', tags: ['order', 'state_machine', 'inventory'] },
      { content: '日志系统: 采集、传输、存储、索引、查询分析。', type: 'system_design', language: 'general', tags: ['logging', 'elk', 'observability'] },
      
      // ===== 编程最佳实践 =====
      { content: '命名规范: 匈牙利命名、驼峰、下划线、帕斯卡命名。', type: 'best_practice', language: 'general', tags: ['naming', 'convention', 'readability'] },
      { content: '注释规范: JSDoc、docstring、JavaDoc、XML文档注释。', type: 'best_practice', language: 'general', tags: ['comment', 'documentation', 'spec'] },
      { content: '代码审查清单: 功能正确性、性能、安全、可维护性。', type: 'best_practice', language: 'general', tags: ['review', 'checklist', 'quality'] },
      { content: '提交规范(Conventional Commits): feat:、fix:、docs:、style:、refactor:。', type: 'best_practice', language: 'general', tags: ['commit', 'conventional', 'message'] },
      { content: '分支策略(Git Flow): main、develop、feature、release、hotfix。', type: 'best_practice', language: 'general', tags: ['git_flow', 'branching', 'workflow'] },
      { content: '代码覆盖率: 行覆盖率、分支覆盖率、语句覆盖率。', type: 'best_practice', language: 'general', tags: ['coverage', 'testing', 'metric'] },
      { content: '依赖管理: 锁定版本、定期更新、安全审计。', type: 'best_practice', language: 'general', tags: ['dependency', 'management', 'security'] },
      { content: 'API文档: Swagger/OpenAPI、自动生成、版本管理。', type: 'best_practice', language: 'general', tags: ['api_doc', 'swagger', 'openapi'] },
      { content: '代码格式化: Prettier、Black、gofmt、clang-format。', type: 'best_practice', language: 'general', tags: ['formatter', 'style', 'consistency'] },
      { content: '静态分析: ESLint、Pylint、SonarQube、Checkstyle。', type: 'best_practice', language: 'general', tags: ['static_analysis', 'linter', 'quality'] },
      
      // ===== 前端性能优化 =====
      { content: '关键渲染路径(CRP): 最小化HTML、CSS、JS的数量和体积。', type: 'performance', language: 'general', tags: ['crp', 'render', 'optimization'] },
      { content: '关键CSS内联: 首屏所需CSS内联到HTML。', type: 'performance', language: 'general', tags: ['critical_css', 'inline', 'first_paint'] },
      { content: '预加载: <link rel="preload"> 预加载关键资源。', type: 'performance', language: 'general', tags: ['preload', 'resource', 'hint'] },
      { content: '预连接: <link rel="preconnect"> 提前建立连接。', type: 'performance', language: 'general', tags: ['preconnect', 'dns', 'connection'] },
      { content: 'HTTP缓存: Cache-Control、ETag、Last-Modified。', type: 'performance', language: 'general', tags: ['http_cache', 'cache_control', 'etag'] },
      { content: 'Service Worker缓存: 离线缓存、策略选择缓存。', type: 'performance', language: 'javascript', tags: ['service_worker', 'cache', 'offline'] },
      { content: '图片优化: 压缩、格式转换(WebP/AVIF)、响应式。', type: 'performance', language: 'general', tags: ['image', 'compression', 'webp'] },
      { content: '字体优化: font-display: swap、子集化、预加载。', type: 'performance', language: 'css', tags: ['font', 'swap', 'subset'] },
      { content: '代码分割: 路由级、组件级、供应商级分割。', type: 'performance', language: 'javascript', tags: ['code_splitting', 'chunk', 'lazy_load'] },
      { content: 'Tree Shaking: 移除未使用的导出代码。', type: 'performance', language: 'javascript', tags: ['tree_shaking', 'dead_code', 'bundler'] },
      { content: '压缩与混淆: Minify、Uglify、Terser。', type: 'performance', language: 'general', tags: ['minify', 'uglify', 'compress'] },
      { content: 'CDN加速: 静态资源CDN分发。', type: 'performance', language: 'general', tags: ['cdn', 'static', 'distribution'] },
      { content: 'Web Vitals: LCP、FID、CLS核心指标。', type: 'performance', language: 'general', tags: ['web_vitals', 'lcp', 'fid', 'cls'] },
      { content: 'LCP(Largest Contentful Paint): 最大内容绘制时间。', type: 'performance', language: 'general', tags: ['lcp', 'paint', 'metric'] },
      { content: 'FID(First Input Delay): 首次输入延迟。', type: 'performance', language: 'general', tags: ['fid', 'interaction', 'metric'] },
      { content: 'CLS(Cumulative Layout Shift): 累积布局偏移。', type: 'performance', language: 'general', tags: ['cls', 'layout', 'metric'] },
      
      // ===== 后端性能优化 =====
      { content: '数据库索引优化: 选择性高的列、复合索引顺序。', type: 'performance', language: 'general', tags: ['index', 'database', 'selectivity'] },
      { content: '查询优化: 避免SELECT *、使用EXPLAIN、限制结果集。', type: 'performance', language: 'general', tags: ['query', 'optimization', 'explain'] },
      { content: '缓存策略: Cache-Aside、Read-Through、Write-Through、Write-Behind。', type: 'performance', language: 'general', tags: ['cache_strategy', 'pattern', 'approach'] },
      { content: '消息队列: 异步处理、削峰填谷、服务解耦。', type: 'performance', language: 'general', tags: ['message_queue', 'async', 'decoupling'] },
      { content: '负载均衡: Nginx、HAProxy、云LB。', type: 'performance', language: 'general', tags: ['load_balancer', 'nginx', 'haproxy'] },
      { content: 'API网关: 路由、限流、鉴权、日志。', type: 'performance', language: 'general', tags: ['api_gateway', 'routing', 'rate_limit'] },
      { content: '微服务拆分: 按业务域拆分、限界上下文。', type: 'performance', language: 'general', tags: ['microservice', 'bounded_context', 'domain'] },
      { content: '服务发现: 注册中心(Consul/Eureka/Nacos)。', type: 'performance', language: 'general', tags: ['service_discovery', 'registry', 'consul'] },
      { content: '链路追踪: Zipkin、Jaeger、SkyWalking。', type: 'performance', language: 'general', tags: ['tracing', 'zipkin', 'jaeger'] },
      { content: '日志聚合: ELK、Loki、Splunk。', type: 'performance', language: 'general', tags: ['log_aggregation', 'elk', 'loki'] },
      
      // ===== 更多编程范式与模式 =====
      { content: '事件驱动架构: 事件生产、事件总线、事件消费者。', type: 'architecture', language: 'general', tags: ['event_driven', 'eda', 'pub_sub'] },
      { content: '服务网格: Sidecar代理、服务发现、流量管理。', type: 'architecture', language: 'general', tags: ['service_mesh', 'istio', 'envoy'] },
      { content: 'Serverless架构: 函数即服务(FaaS)、后端即服务(BaaS)。', type: 'architecture', language: 'general', tags: ['serverless', 'faas', 'baas'] },
      { content: '微内核架构: 核心+插件，操作系统常用。', type: 'architecture', language: 'general', tags: ['microkernel', 'kernel', 'plugin'] },
      { content: '管道-过滤器架构: 数据流经多个处理阶段。', type: 'architecture', language: 'general', tags: ['pipeline', 'filter', 'dataflow'] },
      { content: '分层架构: 表现层、业务层、数据层。', type: 'architecture', language: 'general', tags: ['layered', 'n_tier', 'separation'] },
      { content: '洋葱架构: 依赖倒置，核心在最内层。', type: 'architecture', language: 'general', tags: ['onion', 'clean_architecture', 'dependency_inversion'] },
      { content: '六边形架构(端口适配器): 业务核心与技术实现分离。', type: 'architecture', language: 'general', tags: ['hexagonal', 'ports', 'adapters'] },
      
      // ===== 网络与协议深度 =====
      { content: 'QUIC协议: 基于UDP的加密传输协议、多路复用、0-RTT握手。', type: 'network', language: 'general', tags: ['quic', 'udp', 'encrypted'] },
      { content: 'TLS握手: 非对称加密协商对称密钥。', type: 'network', language: 'general', tags: ['tls', 'handshake', 'encryption'] },
      { content: 'DNS解析过程: 根→TLD→权威→递归。', type: 'network', language: 'general', tags: ['dns', 'resolution', 'recursive'] },
      { content: 'CDN工作原理: 边缘节点缓存、回源、分发。', type: 'network', language: 'general', tags: ['cdn', 'edge', 'origin'] },
      { content: '负载均衡算法: 轮询、加权轮询、最少连接、IP哈希、一致性哈希。', type: 'network', language: 'general', tags: ['load_balancing', 'algorithm', 'distribution'] },
      { content: 'Nginx反向代理: 静态资源、负载均衡、SSL终结。', type: 'network', language: 'general', tags: ['nginx', 'reverse_proxy', 'static'] },
      { content: 'Netty: Java异步网络应用框架。', type: 'network', language: 'java', tags: ['netty', 'nio', 'network'] },
      { content: 'gRPC通信: HTTP/2、Protobuf序列化、双向流。', type: 'network', language: 'general', tags: ['grpc', 'protobuf', 'http2'] },
      
      // ===== 容器与K8s深入 =====
      { content: 'Docker镜像: 分层存储、Copy-on-Write、Dockerfile构建。', type: 'devops', language: 'general', tags: ['docker', 'image', 'layer'] },
      { content: 'Docker Volume: 持久化数据存储。', type: 'devops', language: 'general', tags: ['docker', 'volume', 'persistence'] },
      { content: 'Docker Network: bridge、host、overlay、macvlan。', type: 'devops', language: 'general', tags: ['docker', 'network', 'bridge'] },
      { content: 'Dockerfile优化: 减少层数、利用缓存、多阶段构建。', type: 'devops', language: 'general', tags: ['dockerfile', 'optimization', 'multi_stage'] },
      { content: 'Kubernetes Pod: 最小调度单元，包含一个或多个容器。', type: 'devops', language: 'general', tags: ['k8s', 'pod', 'scheduling'] },
      { content: 'Kubernetes Service: 稳定的网络入口。', type: 'devops', language: 'general', tags: ['k8s', 'service', 'load_balancing'] },
      { content: 'Kubernetes Deployment: 管理Pod副本和更新。', type: 'devops', language: 'general', tags: ['k8s', 'deployment', 'replica'] },
      { content: 'Kubernetes StatefulSet: 有状态应用管理。', type: 'devops', language: 'general', tags: ['k8s', 'statefulset', 'stateful'] },
      { content: 'Kubernetes DaemonSet: 每个节点运行一个Pod。', type: 'devops', language: 'general', tags: ['k8s', 'daemonset', 'node'] },
      { content: 'Kubernetes ConfigMap/Secret: 配置和密钥管理。', type: 'devops', language: 'general', tags: ['k8s', 'configmap', 'secret'] },
      { content: 'Kubernetes Ingress: 外部访问入口。', type: 'devops', language: 'general', tags: ['k8s', 'ingress', 'external'] },
      { content: 'Helm: Kubernetes包管理器。', type: 'devops', language: 'general', tags: ['helm', 'package', 'k8s'] },
      
      // ===== 数据处理与ETL =====
      { content: '数据管道: 数据源→处理→存储→服务。', type: 'data_pipeline', language: 'general', tags: ['data_pipeline', 'etl', 'flow'] },
      { content: 'Apache Airflow: 工作流编排工具。', type: 'data_pipeline', language: 'python', tags: ['airflow', 'workflow', 'scheduling'] },
      { content: 'Apache Beam: 统一批处理和流处理。', type: 'data_pipeline', language: 'java', tags: ['beam', 'unified', 'processing'] },
      { content: 'Apache NiFi: 数据流处理系统。', type: 'data_pipeline', language: 'java', tags: ['nifi', 'dataflow', 'processing'] },
      { content: '数据清洗: 去重、缺失值处理、异常值处理。', type: 'data_pipeline', language: 'general', tags: ['data_cleaning', 'preprocessing', 'quality'] },
      { content: '数据转换: 格式转换、编码转换、单位换算。', type: 'data_pipeline', language: 'general', tags: ['data_transformation', 'format', 'convert'] },
      { content: '数据加载: 全量加载、增量加载、实时加载。', type: 'data_pipeline', language: 'general', tags: ['data_loading', 'full', 'incremental'] },
      { content: 'CDC(变更数据捕获): 捕获数据库变更。', type: 'data_pipeline', language: 'general', tags: ['cdc', 'change_data', 'capture'] },
      
      // ===== 软件测试深入 =====
      { content: '单元测试: 测试最小可测试单元。', type: 'testing', language: 'general', tags: ['unit_test', 'isolated', 'fast'] },
      { content: '集成测试: 测试多个模块协作。', type: 'testing', language: 'general', tags: ['integration_test', 'collaboration', 'module'] },
      { content: 'E2E测试: 端到端测试用户流程。', type: 'testing', language: 'general', tags: ['e2e_test', 'user_flow', 'full'] },
      { content: '回归测试: 确保修改未破坏已有功能。', type: 'testing', language: 'general', tags: ['regression_test', 'verification', 'change'] },
      { content: '压力测试: 高负载下系统行为。', type: 'testing', language: 'general', tags: ['stress_test', 'high_load', 'performance'] },
      { content: '负载测试: 预期负载下系统行为。', type: 'testing', language: 'general', tags: ['load_test', 'expected_load', 'performance'] },
      { content: '稳定性测试: 长时间运行系统稳定性。', type: 'testing', language: 'general', tags: ['stability_test', 'soak', 'long_run'] },
      { content: '安全测试: 渗透测试、漏洞扫描。', type: 'testing', language: 'general', tags: ['security_test', 'penetration', 'vulnerability'] },
      { content: 'Jest: JavaScript测试框架。', type: 'testing', language: 'javascript', tags: ['jest', 'test_framework', 'js'] },
      { content: 'PyTest: Python测试框架。', type: 'testing', language: 'python', tags: ['pytest', 'test_framework', 'python'] },
      { content: 'JUnit: Java单元测试框架。', type: 'testing', language: 'java', tags: ['junit', 'test_framework', 'java'] },
      { content: 'Mock/Stub/Fake: 测试替身类型。', type: 'testing', language: 'general', tags: ['mock', 'stub', 'fake'] },
      { content: 'TDD(测试驱动开发): 先写测试、再写实现。', type: 'testing', language: 'general', tags: ['tdd', 'test_first', 'red_green_refactor'] },
      
      // ===== 更多安全知识 =====
      { content: 'HTTPS握手: TLS 1.3简化握手过程。', type: 'security', language: 'general', tags: ['https', 'tls', 'handshake'] },
      { content: 'JWT结构: Header.Payload.Signature三段Base64。', type: 'security', language: 'general', tags: ['jwt', 'structure', 'token'] },
      { content: 'OAuth2授权码模式: 安全的第三方授权流程。', type: 'security', language: 'general', tags: ['oauth2', 'authorization_code', 'flow'] },
      { content: 'OpenID Connect: OAuth2 + 身份认证层。', type: 'security', language: 'general', tags: ['oidc', 'authentication', 'identity'] },
      { content: 'CORS: 跨域资源共享策略。', type: 'security', language: 'general', tags: ['cors', 'cross_origin', 'browser'] },
      { content: 'CSP(内容安全策略): 防止XSS和数据注入。', type: 'security', language: 'general', tags: ['csp', 'content_security', 'xss_prevention'] },
      { content: 'HSTS: 强制HTTPS连接。', type: 'security', language: 'general', tags: ['hsts', 'https', 'enforce'] },
      { content: 'SRF令牌: 防止跨站请求伪造。', type: 'security', language: 'general', tags: ['csrf', 'token', 'prevention'] },
      { content: 'OWASP Top 10: 最常见的Web安全风险。', type: 'security', language: 'general', tags: ['owasp', 'top10', 'web_security'] },
      { content: '密钥管理: KMS、HSM、密钥轮换。', type: 'security', language: 'general', tags: ['key_management', 'kms', 'hsm'] },
      { content: '渗透测试: 黑盒、白盒、灰盒测试。', type: 'security', language: 'general', tags: ['penetration', 'black_box', 'white_box'] },
      { content: '代码审计: 安全代码审查、漏洞识别。', type: 'security', language: 'general', tags: ['code_audit', 'security', 'vulnerability'] },
      
      // ===== 数据库设计深入 =====
      { content: '三范式: 1NF→2NF→3NF，减少数据冗余。', type: 'database', language: 'general', tags: ['normalization', '3nf', 'redundancy'] },
      { content: '反范式化: 有意引入冗余提高读性能。', type: 'database', language: 'general', tags: ['denormalization', 'redundancy', 'read_performance'] },
      { content: '数据库设计: ER模型、表设计、关系设计。', type: 'database', language: 'general', tags: ['er_model', 'table_design', 'relationship'] },
      { content: 'OLTP vs OLAP: 事务处理vs分析处理。', type: 'database', language: 'general', tags: ['oltp', 'olap', 'workload'] },
      { content: '行存储vs列存储: 按行存储vs按列存储。', type: 'database', language: 'general', tags: ['row_store', 'column_store', 'storage'] },
      { content: '数据库监控: 慢查询、连接数、锁等待、缓存命中率。', type: 'database', language: 'general', tags: ['monitoring', 'slow_query', 'metrics'] },
      { content: 'MySQL主从复制: binlog、relay log、同步延迟。', type: 'database', language: 'general', tags: ['mysql', 'replication', 'binlog'] },
      { content: 'Redis持久化: RDB快照、AOF追加。', type: 'database', language: 'general', tags: ['redis', 'persistence', 'rdb', 'aof'] },
      { content: 'Redis数据结构: String、Hash、List、Set、ZSet。', type: 'database', language: 'general', tags: ['redis', 'data_structure', 'type'] },
      { content: 'MongoDB聚合管道: $match、$group、$sort、$project。', type: 'database', language: 'javascript', tags: ['mongodb', 'aggregation', 'pipeline'] },
      
      // ===== 移动端开发 =====
      { content: 'iOS开发: Swift、SwiftUI、UIKit、Combine。', type: 'mobile', language: 'swift', tags: ['ios', 'swift', 'swiftui'] },
      { content: 'Android开发: Kotlin、Jetpack Compose、ViewModel。', type: 'mobile', language: 'kotlin', tags: ['android', 'kotlin', 'compose'] },
      { content: 'Flutter: Dart跨平台UI框架。', type: 'mobile', language: 'dart', tags: ['flutter', 'dart', 'cross_platform'] },
      { content: 'React Native: React跨平台移动应用。', type: 'mobile', language: 'javascript', tags: ['react_native', 'cross_platform', 'mobile'] },
      { content: '小程序开发: WXML、WXSS、JS/TS、JSON配置。', type: 'mobile', language: 'javascript', tags: ['miniprogram', 'wechat', 'taro'] },
      { content: '移动端性能: 启动速度、内存占用、电量消耗。', type: 'mobile', language: 'general', tags: ['mobile', 'performance', 'optimization'] },
      { content: '移动端存储: SharedPreferences、UserDefaults、SQLite、CoreData。', type: 'mobile', language: 'general', tags: ['mobile', 'storage', 'local'] },
      { content: '推送通知: APNs(Apple)、FCM(Google)。', type: 'mobile', language: 'general', tags: ['push', 'apns', 'fcm'] },
      
      // ===== 游戏与图形 =====
      { content: 'OpenGL: 开放图形库，跨语言3D渲染。', type: 'graphics', language: 'c', tags: ['opengl', '3d', 'rendering'] },
      { content: 'Vulkan: 下一代高性能图形API。', type: 'graphics', language: 'c', tags: ['vulkan', 'graphics', 'api'] },
      { content: 'DirectX: Microsoft多媒体API。', type: 'graphics', language: 'c++', tags: ['directx', 'microsoft', 'multimedia'] },
      { content: 'Metal: Apple高性能图形API。', type: 'graphics', language: 'c', tags: ['metal', 'apple', 'graphics'] },
      { content: '光线追踪: 真实感渲染技术。', type: 'graphics', language: 'c++', tags: ['ray_tracing', 'realistic', 'rendering'] },
      { content: '着色器语言: GLSL、HLSL、MSL。', type: 'graphics', language: 'glsl', tags: ['shader', 'glsl', 'hlsl'] },
      
      // ===== AI与机器学习工程 =====
      { content: 'MLOps: 机器学习流水线工程。', type: 'ai_ml', language: 'python', tags: ['mlops', 'pipeline', 'deployment'] },
      { content: '特征工程: 特征提取、选择、变换。', type: 'ai_ml', language: 'python', tags: ['feature_engineering', 'extraction', 'selection'] },
      { content: '模型评估: 准确率、召回率、F1、AUC。', type: 'ai_ml', language: 'python', tags: ['model_evaluation', 'accuracy', 'recall', 'f1'] },
      { content: '交叉验证: K折交叉验证、留一法。', type: 'ai_ml', language: 'python', tags: ['cross_validation', 'k_fold', 'evaluation'] },
      { content: '超参数调优: 网格搜索、随机搜索、贝叶斯优化。', type: 'ai_ml', language: 'python', tags: ['hyperparameter', 'tuning', 'grid_search'] },
      { content: '模型部署: 导出ONNX、TensorRT、TorchScript。', type: 'ai_ml', language: 'python', tags: ['model_deployment', 'onnx', 'tensorrt'] },
      { content: '数据标注: 人工标注、弱监督、主动学习。', type: 'ai_ml', language: 'python', tags: ['data_labeling', 'annotation', 'weak_supervision'] },
      { content: '大语言模型: LLM、预训练、微调、Prompt工程。', type: 'ai_ml', language: 'python', tags: ['llm', 'pretraining', 'fine_tuning'] },
      { content: 'RAG(检索增强生成): 结合检索和生成。', type: 'ai_ml', language: 'python', tags: ['rag', 'retrieval', 'generation'] },
      { content: '向量数据库: Pinecone、Milvus、Weaviate、Chroma。', type: 'ai_ml', language: 'python', tags: ['vector_db', 'pinecone', 'milvus'] },
      
      // ===== 更多工具与生产力 =====
      { content: 'VS Code: 跨平台代码编辑器。', type: 'tool', language: 'general', tags: ['vscode', 'editor', 'ide'] },
      { content: 'Sublime Text: 轻量级文本编辑器。', type: 'tool', language: 'general', tags: ['sublime', 'text_editor', 'fast'] },
      { content: 'IntelliJ IDEA: Java集成开发环境。', type: 'tool', language: 'java', tags: ['intellij', 'ide', 'java'] },
      { content: 'PyCharm: Python集成开发环境。', type: 'tool', language: 'python', tags: ['pycharm', 'ide', 'python'] },
      { content: 'WebStorm: JavaScript/TypeScript IDE。', type: 'tool', language: 'javascript', tags: ['webstorm', 'ide', 'js'] },
      { content: 'Vim/Neovim: 高效终端文本编辑器。', type: 'tool', language: 'general', tags: ['vim', 'neovim', 'terminal'] },
      { content: 'Emacs: 可扩展文本编辑器。', type: 'tool', language: 'lisp', tags: ['emacs', 'editor', 'extensible'] },
      { content: 'Postman: API测试工具。', type: 'tool', language: 'general', tags: ['postman', 'api_testing', 'rest'] },
      { content: 'Insomnia: REST和GraphQL客户端。', type: 'tool', language: 'general', tags: ['insomnia', 'rest_client', 'graphql'] },
      { content: 'DBeaver: 通用数据库管理工具。', type: 'tool', language: 'general', tags: ['dbeaver', 'database', 'management'] },
      { content: 'Navicat: 数据库管理和开发工具。', type: 'tool', language: 'general', tags: ['navicat', 'mysql', 'management'] },
      { content: 'Redis Commander: Redis Web管理界面。', type: 'tool', language: 'javascript', tags: ['redis', 'commander', 'web_ui'] },
      { content: 'TablePlus: 现代原生数据库工具。', type: 'tool', language: 'general', tags: ['tableplus', 'database', 'native'] },
      { content: 'Chrome DevTools: 浏览器Web开发工具。', type: 'tool', language: 'javascript', tags: ['devtools', 'chrome', 'debugging'] },
      { content: 'Firebug: 浏览器调试扩展(已停止)。', type: 'tool', language: 'javascript', tags: ['firebug', 'browser', 'debugging'] },
      { content: 'Charles Proxy: HTTP代理调试工具。', type: 'tool', language: 'general', tags: ['charles', 'proxy', 'debugging'] },
      { content: 'Wireshark: 网络协议分析器。', type: 'tool', language: 'general', tags: ['wireshark', 'network', 'analyzer'] },
      { content: 'Fiddler: Web调试代理。', type: 'tool', language: 'general', tags: ['fiddler', 'web_debugging', 'proxy'] },
      { content: 'JMeter: 性能测试工具。', type: 'tool', language: 'java', tags: ['jmeter', 'performance', 'load_test'] },
      { content: 'Gatling: 现代化负载测试工具。', type: 'tool', language: 'scala', tags: ['gatling', 'load_testing', 'performance'] },
      
      // ===== 更多数据结构与算法 =====
      { content: '跳表查询: 平均O(log n)，支持并发。', type: 'data_structure', language: 'general', tags: ['skip_list', 'search', 'concurrent'] },
      { content: '斐波那契堆: 摊销O(1)插入，O(log n)提取最小。', type: 'data_structure', language: 'general', tags: ['fibonacci_heap', 'amortized', 'insertion'] },
      { content: 'BloomFilter: 可能存在/一定不存在，空间效率高。', type: 'data_structure', language: 'general', tags: ['bloom_filter', 'probabilistic', 'membership'] },
      { content: 'Count-Min Sketch: 概率数据结构，频率估计。', type: 'data_structure', language: 'general', tags: ['count_min_sketch', 'frequency', 'estimation'] },
      { content: 'HyperLogLog: 基数估计算法。', type: 'data_structure', language: 'general', tags: ['hyperloglog', 'cardinality', 'estimation'] },
      { content: 'Quadtree: 二维空间分区树。', type: 'data_structure', language: 'general', tags: ['quadtree', 'spatial', '2d'] },
      { content: 'Octree: 三维空间分区树。', type: 'data_structure', language: 'general', tags: ['octree', 'spatial', '3d'] },
      { content: 'R-Tree: 空间索引，范围查询。', type: 'data_structure', language: 'general', tags: ['r_tree', 'spatial', 'index'] },
      { content: 'Skip List vs Balanced Tree: 实现简单，范围查询高效。', type: 'data_structure', language: 'general', tags: ['comparison', 'skip_list', 'bst'] },
      { content: '一致性哈希实现: 虚拟节点、哈希环。', type: 'algorithm', language: 'general', tags: ['consistent_hashing', 'virtual_node', 'ring'] },
      
      // ===== 编程规范与代码风格 =====
      { content: 'ESLint配置: .eslintrc.js、extends、rules。', type: 'code_quality', language: 'javascript', tags: ['eslint', 'config', 'linter'] },
      { content: 'Prettier配置: .prettierrc、printWidth、tabWidth。', type: 'code_quality', language: 'javascript', tags: ['prettier', 'config', 'formatter'] },
      { content: 'EditorConfig: 统一编辑器配置。', type: 'code_quality', language: 'general', tags: ['editorconfig', 'consistency', 'team'] },
      { content: 'Husky: Git hooks工具。', type: 'code_quality', language: 'javascript', tags: ['husky', 'git_hook', 'precommit'] },
      { content: 'Lint-staged: 仅检查暂存文件。', type: 'code_quality', language: 'javascript', tags: ['lint_staged', 'git', 'precommit'] },
      { content: 'Commitlint: 提交信息规范检查。', type: 'code_quality', language: 'javascript', tags: ['commitlint', 'convention', 'message'] },
      { content: 'Semantic Release: 基于提交的版本自动管理。', type: 'code_quality', language: 'javascript', tags: ['semantic_release', 'version', 'automation'] },
      
      // ===== 分布式系统设计 =====
      { content: 'CAP定理: 一致性、可用性、分区容忍性只能选二。', type: 'distributed', language: 'general', tags: ['cap', 'theorem', 'consistency'] },
      { content: 'BASE理论: 基本可用、软状态、最终一致。', type: 'distributed', language: 'general', tags: ['base', 'theory', 'eventual_consistency'] },
      { content: '一致性模型: 强一致、线性一致、因果一致、最终一致。', type: 'distributed', language: 'general', tags: ['consistency', 'model', 'level'] },
      { content: '共识算法: Paxos、Raft、ZAB。', type: 'distributed', language: 'general', tags: ['consensus', 'paxos', 'raft'] },
      { content: '拜占庭将军问题: 容错共识问题。', type: 'distributed', language: 'general', tags: ['byzantine', 'consensus', 'fault_tolerance'] },
      { content: '向量时钟: 事件因果关系追踪。', type: 'distributed', language: 'general', tags: ['vector_clock', 'causality', 'tracking'] },
      { content: '逻辑时钟(Lamport): 事件排序。', type: 'distributed', language: 'general', tags: ['logical_clock', 'lamport', 'ordering'] },
      { content: 'Gossip协议: 去中心化信息传播。', type: 'distributed', language: 'general', tags: ['gossip', 'protocol', 'decentralized'] },
      { content: '分片与复制: 水平扩展和数据冗余。', type: 'distributed', language: 'general', tags: ['sharding', 'replication', 'scaling'] },
      { content: '代理模式(分布式): 正向代理、反向代理、隧道。', type: 'distributed', language: 'general', tags: ['proxy', 'forward', 'reverse'] },
      
      // ===== 敏捷与项目管理 =====
      { content: 'Sprint Planning: 冲刺规划会议。', type: 'agile', language: 'general', tags: ['sprint', 'planning', 'scrum'] },
      { content: 'Sprint Review: 冲刺评审会议。', type: 'agile', language: 'general', tags: ['sprint', 'review', 'scrum'] },
      { content: 'Sprint Retrospective: 冲刺回顾会议。', type: 'agile', language: 'general', tags: ['sprint', 'retrospective', 'scrum'] },
      { content: 'Daily Standup: 每日站会(15分钟)。', type: 'agile', language: 'general', tags: ['daily_standup', 'scrum', 'communication'] },
      { content: 'Product Backlog: 产品待办列表，按优先级排序。', type: 'agile', language: 'general', tags: ['backlog', 'product', 'prioritization'] },
      { content: 'Sprint Backlog: 冲刺待办列表，本迭代目标。', type: 'agile', language: 'general', tags: ['sprint_backlog', 'iteration', 'goal'] },
      { content: '燃尽图: 剩余工作量随时间变化。', type: 'agile', language: 'general', tags: ['burndown', 'chart', 'progress'] },
      { content: '燃起图: 已完成工作量随时间变化。', type: 'agile', language: 'general', tags: ['burnup', 'chart', 'progress'] },
      { content: 'Kanban看板: 待办/进行中/已完成列。', type: 'agile', language: 'general', tags: ['kanban', 'board', 'visualization'] },
      { content: '瓶颈理论(TOC): 识别并改进系统瓶颈。', type: 'agile', language: 'general', tags: ['constraint', 'bottleneck', 'improvement'] },
      
      // ===== 网络安全与加密 =====
      { content: '对称加密算法: AES、DES、3DES、SM4。', type: 'security', language: 'general', tags: ['symmetric', 'encryption', 'aes'] },
      { content: '非对称加密算法: RSA、ECC、SM2。', type: 'security', language: 'general', tags: ['asymmetric', 'encryption', 'rsa'] },
      { content: '哈希算法: MD5(不安全)、SHA-256、SHA-3、SM3。', type: 'security', language: 'general', tags: ['hash', 'md5', 'sha256'] },
      { content: '消息认证码: HMAC、CMAC。', type: 'security', language: 'general', tags: ['mac', 'hmac', 'authenticity'] },
      { content: '密码学难题: 大数分解、椭圆曲线离散对数。', type: 'security', language: 'general', tags: ['cryptographic', 'hard_problem', 'factorization'] },
      { content: '零知识证明: zk-SNARK、zk-STARK。', type: 'security', language: 'general', tags: ['zero_knowledge', 'zk_snark', 'privacy'] },
      { content: '同态加密: 加密状态下进行计算。', type: 'security', language: 'general', tags: ['homomorphic', 'encryption', 'privacy'] },
      { content: '区块链基础: 哈希链、Merkle树、共识机制。', type: 'security', language: 'general', tags: ['blockchain', 'hash_chain', 'merkle'] },
      
      // ===== 前端框架深入 =====
      { content: 'React Hooks: useState、useEffect、useContext、useReducer、useRef。', type: 'frontend', language: 'javascript', tags: ['react', 'hooks', 'functional'] },
      { content: 'React Router: 客户端路由。', type: 'frontend', language: 'javascript', tags: ['react_router', 'routing', 'navigation'] },
      { content: 'Redux Toolkit: 简化Redux开发。', type: 'frontend', language: 'javascript', tags: ['redux_toolkit', 'state_management', 'redux'] },
      { content: 'Zustand: 轻量级状态管理。', type: 'frontend', language: 'javascript', tags: ['zustand', 'state_management', 'lightweight'] },
      { content: 'React Query/SWR: 服务端状态管理。', type: 'frontend', language: 'javascript', tags: ['react_query', 'swr', 'server_state'] },
      { content: 'Vue 3 Composition API: setup、ref、reactive、computed、watch。', type: 'frontend', language: 'javascript', tags: ['vue3', 'composition_api', 'ref'] },
      { content: 'Pinia: Vue官方推荐状态管理。', type: 'frontend', language: 'javascript', tags: ['pinia', 'vue', 'state_management'] },
      { content: 'Angular DI: 依赖注入系统。', type: 'frontend', language: 'typescript', tags: ['angular', 'di', 'dependency_injection'] },
      { content: 'RxJS: 响应式扩展库。', type: 'frontend', language: 'javascript', tags: ['rxjs', 'reactive', 'observable'] },
      { content: 'Three.js: WebGL 3D库。', type: 'frontend', language: 'javascript', tags: ['threejs', '3d', 'webgl'] },
      
      // ===== 后端框架深入 =====
      { content: 'Express中间件: 请求处理管道。', type: 'backend', language: 'javascript', tags: ['express', 'middleware', 'pipeline'] },
      { content: 'Express路由: Router、参数、查询。', type: 'backend', language: 'javascript', tags: ['express', 'router', 'routing'] },
      { content: 'Spring IoC: 控制反转容器。', type: 'backend', language: 'java', tags: ['spring', 'ioc', 'inversion'] },
      { content: 'Spring AOP: 面向切面编程。', type: 'backend', language: 'java', tags: ['spring', 'aop', 'aspect'] },
      { content: 'Spring MVC: Web MVC框架。', type: 'backend', language: 'java', tags: ['spring_mvc', 'web', 'mvc'] },
      { content: 'Spring Security: 安全框架。', type: 'backend', language: 'java', tags: ['spring_security', 'authentication', 'authorization'] },
      { content: 'Spring Data JPA: 数据访问层。', type: 'backend', language: 'java', tags: ['spring_data', 'jpa', 'repository'] },
      { content: 'Django ORM: 对象关系映射。', type: 'backend', language: 'python', tags: ['django_orm', 'queryset', 'model'] },
      { content: 'Django中间件: 请求处理管道。', type: 'backend', language: 'python', tags: ['django', 'middleware', 'request'] },
      { content: 'Flask Blueprint: 模块化应用。', type: 'backend', language: 'python', tags: ['flask', 'blueprint', 'modular'] },
      
      // ===== AI/ML 深入 =====
      { content: '神经网络优化: 梯度下降、学习率、动量。', type: 'ai_ml', language: 'python', tags: ['neural_network', 'optimization', 'gradient'] },
      { content: '正则化技术: L1/L2正则、Dropout、Early Stopping。', type: 'ai_ml', language: 'python', tags: ['regularization', 'l1', 'l2', 'dropout'] },
      { content: '批量归一化: 加速训练、提供正则化。', type: 'ai_ml', language: 'python', tags: ['batch_normalization', 'training', 'speedup'] },
      { content: '注意力机制: Self-Attention、Multi-Head Attention。', type: 'ai_ml', language: 'python', tags: ['attention', 'transformer', 'self_attention'] },
      { content: 'Embedding: 文本向量化、词嵌入。', type: 'ai_ml', language: 'python', tags: ['embedding', 'vectorization', 'nlp'] },
      { content: '扩散模型: DDPM、DDIM、Stable Diffusion。', type: 'ai_ml', language: 'python', tags: ['diffusion', 'generative', 'image'] },
      { content: '强化学习算法: Q-Learning、Policy Gradient、PPO。', type: 'ai_ml', language: 'python', tags: ['reinforcement', 'q_learning', 'ppo'] },
      { content: '联邦学习: 数据不出本地的分布式学习。', type: 'ai_ml', language: 'python', tags: ['federated', 'learning', 'privacy'] },
      { content: '迁移学习: 预训练模型微调。', type: 'ai_ml', language: 'python', tags: ['transfer', 'learning', 'fine_tuning'] },
      { content: 'Prompt Engineering: 提示词设计、Few-Shot、Chain-of-Thought。', type: 'ai_ml', language: 'python', tags: ['prompt', 'engineering', 'few_shot'] },
      
      // ===== 更多编程范式 =====
      { content: '元编程: 编写操作程序的程序。', type: 'programming', language: 'general', tags: ['metaprogramming', 'reflection', 'code_generation'] },
      { content: '声明式编程: SQL、HTML、正则表达式。', type: 'programming', language: 'general', tags: ['declarative', 'sql', 'html'] },
      { content: '命令式编程: C、Java、Python基础。', type: 'programming', language: 'general', tags: ['imperative', 'c', 'java'] },
      { content: '面向对象编程: 类、对象、继承、多态。', type: 'programming', language: 'general', tags: ['oop', 'class', 'inheritance'] },
      { content: '函数式编程: 纯函数、不可变性、高阶函数。', type: 'programming', language: 'general', tags: ['functional', 'pure_function', 'immutable'] },
      { content: '逻辑编程: Prolog、关系、回溯。', type: 'programming', language: 'prolog', tags: ['logic', 'prolog', 'backtracking'] },
      { content: '约束编程: 满足约束问题(CSP)。', type: 'programming', language: 'general', tags: ['constraint', 'csp', 'satisfaction'] },
      { content: '面向切面编程: AOP、横切关注点。', type: 'programming', language: 'general', tags: ['aop', 'cross_cutting', 'aspect'] },
      { content: '数据驱动编程: 数据与逻辑分离。', type: 'programming', language: 'general', tags: ['data_driven', 'separation', 'configuration'] },
      { content: '事件驱动编程: 事件、回调、事件循环。', type: 'programming', language: 'general', tags: ['event_driven', 'callback', 'event_loop'] },
      
      // ===== 更多测试知识 =====
      { content: '测试金字塔: 单元测试>集成测试>E2E测试。', type: 'testing', language: 'general', tags: ['pyramid', 'unit', 'integration'] },
      { content: '测试覆盖率: 行覆盖、分支覆盖、路径覆盖。', type: 'testing', language: 'general', tags: ['coverage', 'line', 'branch'] },
      { content: 'Mutation Testing: 代码变异测试。', type: 'testing', language: 'general', tags: ['mutation', 'testing', 'quality'] },
      { content: 'Property-Based Testing: 基于属性的测试。', type: 'testing', language: 'general', tags: ['property', 'quickcheck', 'generative'] },
      { content: 'Snapshot Testing: UI快照测试。', type: 'testing', language: 'javascript', tags: ['snapshot', 'jest', 'ui'] },
      { content: 'Contract Testing: 消费者驱动契约测试。', type: 'testing', language: 'general', tags: ['contract', 'pact', 'consumer_driven'] },
      { content: 'Chaos Engineering: 混沌工程，故障注入。', type: 'testing', language: 'general', tags: ['chaos', 'engineering', 'failure_injection'] },
      { content: 'Regression Testing: 回归测试。', type: 'testing', language: 'general', tags: ['regression', 'test_suite', 'automation'] },
      { content: 'Smoke Testing: 冒烟测试，基本功能验证。', type: 'testing', language: 'general', tags: ['smoke', 'basic', 'verification'] },
      { content: 'Sanity Testing: 健全性测试。', type: 'testing', language: 'general', tags: ['sanity', 'quick', 'validation'] },
      { content: 'Cucumber: BDD框架，自然语言测试。', type: 'testing', language: 'general', tags: ['cucumber', 'bdd', 'gherkin'] },
      { content: 'Pact: 消费者驱动契约测试框架。', type: 'testing', language: 'javascript', tags: ['pact', 'cdc', 'contract'] },
      { content: 'Gherkin: Given/When/Then语法。', type: 'testing', language: 'general', tags: ['gherkin', 'bdd', 'syntax'] },
      
      // ===== 更多DevOps与SRE =====
      { content: 'Terraform: 基础设施即代码(IaC)。', type: 'devops', language: 'hcl', tags: ['terraform', 'iac', 'infrastructure'] },
      { content: 'Ansible: 自动化配置管理。', type: 'devops', language: 'yaml', tags: ['ansible', 'automation', 'config'] },
      { content: 'Puppet: 配置管理工具。', type: 'devops', language: 'ruby', tags: ['puppet', 'configuration', 'management'] },
      { content: 'Chef: 配置管理框架。', type: 'devops', language: 'ruby', tags: ['chef', 'configuration', 'ruby'] },
      { content: 'Vagrant: 开发环境虚拟化。', type: 'devops', language: 'ruby', tags: ['vagrant', 'vm', 'development'] },
      { content: 'Prometheus: 监控和告警系统。', type: 'devops', language: 'go', tags: ['prometheus', 'monitoring', 'alerting'] },
      { content: 'Grafana: 数据可视化仪表盘。', type: 'devops', language: 'typescript', tags: ['grafana', 'visualization', 'dashboard'] },
      { content: 'ELK Stack: Elasticsearch、Logstash、Kibana。', type: 'devops', language: 'java', tags: ['elk', 'logging', 'analytics'] },
      { content: 'Splunk: 日志分析平台。', type: 'devops', language: 'general', tags: ['splunk', 'log_analysis', 'monitoring'] },
      { content: 'Sentry: 应用错误监控。', type: 'devops', language: 'python', tags: ['sentry', 'error_monitoring', 'crash'] },
      { content: 'OpenTelemetry: 可观测性数据标准。', type: 'devops', language: 'general', tags: ['opentelemetry', 'observability', 'standard'] },
      { content: 'SLO/SLA/SLA: 服务目标、协议、承诺。', type: 'devops', language: 'general', tags: ['slo', 'sla', 'slc'] },
      { content: 'On-call: 值班响应，故障处理。', type: 'devops', language: 'general', tags: ['oncall', 'incident', 'response'] },
      { content: 'Postmortem: 故障复盘。', type: 'devops', language: 'general', tags: ['postmortem', 'incident', 'review'] },
      
      // ===== 系统设计模式 =====
      { content: 'CQRS: 命令查询职责分离。', type: 'design_pattern', language: 'general', tags: ['cqrs', 'command', 'query'] },
      { content: 'Event Sourcing: 事件溯源。', type: 'design_pattern', language: 'general', tags: ['event_sourcing', 'event', 'state'] },
      { content: 'Saga Pattern: 长事务编排。', type: 'design_pattern', language: 'general', tags: ['saga', 'orchestration', 'choreography'] },
      { content: 'Outbox Pattern: 保证消息可靠投递。', type: 'design_pattern', language: 'general', tags: ['outbox', 'reliability', 'messaging'] },
      { content: 'Sidecar Pattern: 旁路代理。', type: 'design_pattern', language: 'general', tags: ['sidecar', 'proxy', 'envoy'] },
      { content: 'Ambassador Pattern: 外部服务代理。', type: 'design_pattern', language: 'general', tags: ['ambassador', 'proxy', 'external'] },
      { content: 'Anti-Corruption Layer: 防腐层。', type: 'design_pattern', language: 'general', tags: ['acl', 'anti_corruption', 'bounded_context'] },
      { content: 'Strangler Fig Pattern: 渐进式迁移。', type: 'design_pattern', language: 'general', tags: ['strangler', 'fig', 'migration'] },
      { content: 'Bulkhead Pattern: 隔离舱壁模式。', type: 'design_pattern', language: 'general', tags: ['bulkhead', 'isolation', 'failure'] },
      { content: 'Circuit Breaker: 断路器模式。', type: 'design_pattern', language: 'general', tags: ['circuit_breaker', 'resilience', 'failure'] },
      { content: 'Retry Pattern: 重试模式。', type: 'design_pattern', language: 'general', tags: ['retry', 'resilience', 'transient'] },
      { content: 'Timeout Pattern: 超时模式。', type: 'design_pattern', language: 'general', tags: ['timeout', 'resilience', 'deadline'] },
      { content: 'Cache Aside: 旁路缓存。', type: 'design_pattern', language: 'general', tags: ['cache_aside', 'cache', 'pattern'] },
      { content: 'Write Through: 写穿模式。', type: 'design_pattern', language: 'general', tags: ['write_through', 'cache', 'write'] },
      { content: 'Write Behind: 写后模式。', type: 'design_pattern', language: 'general', tags: ['write_behind', 'cache', 'async'] },
      
      // ===== 更多算法与数学 =====
      { content: '动态规划: 最优子结构、重叠子问题。', type: 'algorithm', language: 'general', tags: ['dp', 'optimal', 'substructure'] },
      { content: '贪心算法: 局部最优导致全局最优。', type: 'algorithm', language: 'general', tags: ['greedy', 'local_optimal', 'global'] },
      { content: '分治算法: 分解-解决-合并。', type: 'algorithm', language: 'general', tags: ['divide_conquer', 'merge_sort', 'quick_sort'] },
      { content: '回溯算法: 试探-回溯。', type: 'algorithm', language: 'general', tags: ['backtracking', 'permutation', 'combination'] },
      { content: '分支限界: 广度优先+界限剪枝。', type: 'algorithm', language: 'general', tags: ['branch_bound', 'bfs', 'pruning'] },
      { content: '随机化算法: 概率正确性。', type: 'algorithm', language: 'general', tags: ['randomized', 'probabilistic', 'quickselect'] },
      { content: '字符串算法: KMP、Boyer-Moore、Rabin-Karp。', type: 'algorithm', language: 'general', tags: ['string', 'kmp', 'boyer_moore'] },
      { content: '图算法: Dijkstra、Bellman-Ford、Floyd-Warshall。', type: 'algorithm', language: 'general', tags: ['graph', 'dijkstra', 'bellman_ford'] },
      { content: '最大流: Ford-Fulkerson、Edmonds-Karp。', type: 'algorithm', language: 'general', tags: ['max_flow', 'ford_fulkerson', 'edmonds_karp'] },
      { content: '最小割: Stoer-Wagner、Karger。', type: 'algorithm', language: 'general', tags: ['min_cut', 'stoer_wagner', 'karger'] },
      { content: '计算几何: 凸包、最近点、空间查询。', type: 'algorithm', language: 'general', tags: ['computational_geometry', 'convex_hull', 'kd_tree'] },
      { content: '数论算法: GCD、素性测试、模运算。', type: 'algorithm', language: 'general', tags: ['number_theory', 'gcd', 'primality'] },
      { content: '快速傅里叶变换: O(n log n)多项式乘法。', type: 'algorithm', language: 'general', tags: ['fft', 'polynomial', 'nlogn'] },
      { content: '后缀数组: 高效字符串处理。', type: 'data_structure', language: 'general', tags: ['suffix_array', 'string', 'lcp'] },
      { content: 'Trie树: 前缀树。', type: 'data_structure', language: 'general', tags: ['trie', 'prefix', 'dictionary'] },
      
      // ===== 更多数据库知识 =====
      { content: '数据库恢复: WAL、检查点、模糊检查点。', type: 'database', language: 'general', tags: ['recovery', 'wal', 'checkpoint'] },
      { content: '数据库调优: 缓冲池、日志文件、参数配置。', type: 'database', language: 'general', tags: ['tuning', 'buffer_pool', 'configuration'] },
      { content: '数据库分表: 水平拆分、垂直拆分。', type: 'database', language: 'general', tags: ['sharding', 'horizontal', 'vertical'] },
      { content: '数据库中间件: ShardingSphere、MyCAT。', type: 'database', language: 'java', tags: ['middleware', 'sharding_sphere', 'mycat'] },
      { content: 'NewSQL: TiDB、CockroachDB、OceanBase。', type: 'database', language: 'general', tags: ['newsql', 'tidb', 'cockroachdb'] },
      { content: 'HTAP: 混合事务分析处理。', type: 'database', language: 'general', tags: ['htap', 'oltp', 'olap'] },
      { content: '向量存储: FAISS、Milvus、Pinecone。', type: 'database', language: 'python', tags: ['vector', 'faiss', 'milvus'] },
      { content: '时序数据库: InfluxDB、TimescaleDB、TDengine。', type: 'database', language: 'general', tags: ['time_series', 'influxdb', 'timescale'] },
      { content: '图数据库: Neo4j、JanusGraph、OrientDB。', type: 'database', language: 'general', tags: ['graph', 'neo4j', 'janus'] },
      { content: '文档数据库: MongoDB、CouchDB、RavenDB。', type: 'database', language: 'general', tags: ['document', 'mongodb', 'couchdb'] },
      
      // ===== 浏览器与Web深入 =====
      { content: 'Event Loop: 微任务、宏任务、渲染时机。', type: 'frontend', language: 'javascript', tags: ['event_loop', 'microtask', 'macrotask'] },
      { content: 'Web Workers: 多线程计算。', type: 'frontend', language: 'javascript', tags: ['web_worker', 'multithreading', 'offscreen'] },
      { content: 'SharedArrayBuffer: 跨线程共享内存。', type: 'frontend', language: 'javascript', tags: ['shared_array_buffer', 'atomics', 'memory'] },
      { content: 'Service Worker: 离线缓存、推送通知。', type: 'frontend', language: 'javascript', tags: ['service_worker', 'pwa', 'offline'] },
      { content: 'WebAssembly: 高性能编译语言。', type: 'frontend', language: 'wasm', tags: ['wasm', 'webassembly', 'performance'] },
      { content: 'Web Components: 自定义元素、Shadow DOM。', type: 'frontend', language: 'javascript', tags: ['web_components', 'shadow_dom', 'custom_element'] },
      { content: 'Web Animations API: 高性能动画。', type: 'frontend', language: 'javascript', tags: ['web_animations', 'animation', 'performance'] },
      { content: 'Web Audio API: 音频处理。', type: 'frontend', language: 'javascript', tags: ['web_audio', 'audio', 'synthesis'] },
      { content: 'WebRTC: 实时通信。', type: 'frontend', language: 'javascript', tags: ['webrtc', 'real_time', 'peer_to_peer'] },
      { content: 'WebGPU: 下一代图形API。', type: 'frontend', language: 'javascript', tags: ['webgpu', 'graphics', 'compute'] },
      
      // ===== 更多系统与基础设施 =====
      { content: 'Linux进程管理: fork、exec、wait、signal。', type: 'system', language: 'c', tags: ['linux', 'process', 'fork'] },
      { content: 'Linux内存管理: 虚拟内存、页面替换、OOM。', type: 'system', language: 'c', tags: ['linux', 'memory', 'virtual'] },
      { content: 'Linux文件系统: ext4、XFS、Btrfs、ZFS。', type: 'system', language: 'c', tags: ['filesystem', 'ext4', 'xfs'] },
      { content: 'Linux网络栈: netfilter、iptables、nftables。', type: 'system', language: 'c', tags: ['netfilter', 'iptables', 'network'] },
      { content: 'Windows API: Win32、COM、WinRT。', type: 'system', language: 'c', tags: ['windows', 'win32', 'api'] },
      { content: 'POSIX标准: 可移植操作系统接口。', type: 'system', language: 'c', tags: ['posix', 'standard', 'portability'] },
      { content: '系统调用: syscall、context switch。', type: 'system', language: 'c', tags: ['syscall', 'context_switch', 'kernel'] },
      { content: '内核态vs用户态: 权限环、系统调用。', type: 'system', language: 'c', tags: ['kernel', 'userland', 'privilege'] },
      { content: '虚拟内存: 页表、TLB、内存映射。', type: 'system', language: 'c', tags: ['virtual_memory', 'page_table', 'tlb'] },
      { content: 'IO多路复用: select、poll、epoll、kqueue。', type: 'system', language: 'c', tags: ['io_multiplexing', 'epoll', 'select'] },
      { content: '零拷贝技术: sendfile、mmap、splice。', type: 'system', language: 'c', tags: ['zero_copy', 'sendfile', 'mmap'] },
      { content: 'NUMA架构: 非统一内存访问。', type: 'system', language: 'c', tags: ['numa', 'memory', 'architecture'] },
      { content: 'CPU缓存: L1/L2/L3、缓存一致性(MESI)。', type: 'system', language: 'c', tags: ['cpu_cache', 'mesi', 'coherence'] },
      { content: '无锁编程: CAS、fence、RCU。', type: 'system', language: 'c', tags: ['lock_free', 'cas', 'rcu'] },
      { content: '中断处理: 硬中断、软中断、顶半部/底半部。', type: 'system', language: 'c', tags: ['interrupt', 'irq', 'deferred'] },
      
      // ===== 更多网络协议与HTTP =====
      { content: 'HTTP/2: 多路复用、头部压缩、服务器推送。', type: 'network', language: 'general', tags: ['http2', 'multiplexing', 'header_compression'] },
      { content: 'HTTP/3: 基于QUIC协议。', type: 'network', language: 'general', tags: ['http3', 'quic', 'udp'] },
      { content: 'WebSocket: 全双工通信。', type: 'network', language: 'general', tags: ['websocket', 'full_duplex', 'real_time'] },
      { content: 'Server-Sent Events: 服务器推送事件。', type: 'network', language: 'general', tags: ['sse', 'server_push', 'eventsource'] },
      { content: 'gRPC: HTTP/2上的RPC框架。', type: 'network', language: 'general', tags: ['grpc', 'http2', 'rpc'] },
      { content: 'GraphQL: 查询语言和运行时。', type: 'network', language: 'general', tags: ['graphql', 'query', 'schema'] },
      { content: 'SOAP: 简单对象访问协议(XML)。', type: 'network', language: 'general', tags: ['soap', 'xml', 'protocol'] },
      { content: 'REST: 表述性状态转移。', type: 'network', language: 'general', tags: ['rest', 'stateless', 'resource'] },
      { content: 'Mermaid: 图表和可视化工具。', type: 'tool', language: 'markdown', tags: ['mermaid', 'diagram', 'visualization'] },
      { content: 'PlantUML: UML图表工具。', type: 'tool', language: 'text', tags: ['plantuml', 'uml', 'diagram'] },
      { content: 'Markdown: 轻量级标记语言。', type: 'tool', language: 'markdown', tags: ['markdown', 'lightweight', 'markup'] },
      { content: 'reStructuredText: 文档标记语言。', type: 'tool', language: 'restructuredtext', tags: ['rst', 'documentation', 'sphinx'] },
      
      // ===== 更多前端工具链 =====
      { content: 'Vite: 下一代前端构建工具。', type: 'frontend', language: 'javascript', tags: ['vite', 'build', 'dev_server'] },
      { content: 'Webpack: 模块打包器。', type: 'frontend', language: 'javascript', tags: ['webpack', 'bundler', 'module'] },
      { content: 'Rollup: 下一代打包器。', type: 'frontend', language: 'javascript', tags: ['rollup', 'bundler', 'es_module'] },
      { content: 'esbuild: 极速JavaScript打包器。', type: 'frontend', language: 'go', tags: ['esbuild', 'bundler', 'fast'] },
      { content: 'Turbopack: Rust编写的打包器。', type: 'frontend', language: 'rust', tags: ['turbopack', 'rust', 'bundler'] },
      { content: 'Babel: JavaScript转译器。', type: 'frontend', language: 'javascript', tags: ['babel', 'transpiler', 'polyfill'] },
      { content: 'SWC: Rust编写的转译器。', type: 'frontend', language: 'rust', tags: ['swc', 'transpiler', 'fast'] },
      { content: 'TypeScript: 带类型的JavaScript超集。', type: 'frontend', language: 'typescript', tags: ['typescript', 'type_safety', 'static'] },
      { content: 'PostCSS: CSS转换工具。', type: 'frontend', language: 'javascript', tags: ['postcss', 'css', 'transform'] },
      { content: 'Tailwind CSS: 原子化CSS框架。', type: 'frontend', language: 'css', tags: ['tailwind', 'utility', 'atomic'] },
      { content: 'Sass/SCSS: CSS预处理器。', type: 'frontend', language: 'ruby', tags: ['sass', 'scss', 'preprocessor'] },
      { content: 'Less: CSS预处理器。', type: 'frontend', language: 'javascript', tags: ['less', 'preprocessor', 'css'] },
      
      // ===== 更多编程语言特性 =====
      { content: 'TypeScript高级类型: 条件类型、映射类型、模板字面量类型。', type: 'language_feature', language: 'typescript', tags: ['advanced_types', 'conditional', 'mapped'] },
      { content: 'TypeScript泛型: 类型参数、约束、默认值。', type: 'language_feature', language: 'typescript', tags: ['generics', 'type_parameter', 'constraint'] },
      { content: 'TypeScript装饰器: 类装饰器、方法装饰器、属性装饰器。', type: 'language_feature', language: 'typescript', tags: ['decorator', 'class', 'method'] },
      { content: 'Rust所有权: 所有权、借用、生命周期。', type: 'language_feature', language: 'rust', tags: ['ownership', 'borrowing', 'lifetime'] },
      { content: 'Rust模式匹配: match、if let、while let。', type: 'language_feature', language: 'rust', tags: ['pattern_matching', 'match', 'enum'] },
      { content: 'Rust宏: 声明宏、过程宏。', type: 'language_feature', language: 'rust', tags: ['macro', 'declarative', 'procedural'] },
      { content: 'Go协程与通道: goroutine、channel、select。', type: 'language_feature', language: 'go', tags: ['goroutine', 'channel', 'select'] },
      { content: 'Go接口: 鸭子类型、空接口、类型断言。', type: 'language_feature', language: 'go', tags: ['interface', 'duck_typing', 'type_assertion'] },
      { content: 'Go错误处理: 显式错误、errors包、panic/recover。', type: 'language_feature', language: 'go', tags: ['error_handling', 'panic', 'recover'] },
      { content: 'Python装饰器: 函数装饰器、类装饰器、带参数装饰器。', type: 'language_feature', language: 'python', tags: ['decorator', 'function', 'class'] },
      { content: 'Python描述符: __get__、__set__、__delete__。', type: 'language_feature', language: 'python', tags: ['descriptor', 'property', 'attribute'] },
      { content: 'Python元类: metaclass、__init_subclass__。', type: 'language_feature', language: 'python', tags: ['metaclass', 'class', 'dynamic'] },
      { content: 'Java泛型擦除: 编译时类型信息丢失。', type: 'language_feature', language: 'java', tags: ['generics_erasure', 'type', 'compile_time'] },
      { content: 'Java注解: @Override、@Deprecated、自定义注解。', type: 'language_feature', language: 'java', tags: ['annotation', 'reflect', 'metadata'] },
      { content: 'Java多线程: Thread、Runnable、synchronized、Lock。', type: 'language_feature', language: 'java', tags: ['multithreading', 'synchronized', 'lock'] },
      
      // ===== 更多领域特定知识 =====
      { content: '支付系统: 支付网关、清算、结算、对账。', type: 'domain', language: 'general', tags: ['payment', 'clearing', 'settlement'] },
      { content: '风控系统: 规则引擎、机器学习、实时决策。', type: 'domain', language: 'general', tags: ['risk_control', 'rule_engine', 'ml'] },
      { content: '推荐系统: 协同过滤、内容推荐、混合推荐。', type: 'domain', language: 'general', tags: ['recommendation', 'collaborative_filtering', 'content_based'] },
      { content: '搜索系统: 倒排索引、PageRank、向量搜索。', type: 'domain', language: 'general', tags: ['search', 'inverted_index', 'pagerank'] },
      { content: '广告系统: 实时竞价、定向投放、效果归因。', type: 'domain', language: 'general', tags: ['advertising', 'rtb', 'targeting'] },
      { content: '直播系统: 推流、转码、分发、低延迟。', type: 'domain', language: 'general', tags: ['live_streaming', 'rtmp', 'hls'] },
      { content: '短视频系统: 编码、CDN、预加载、秒开。', type: 'domain', language: 'general', tags: ['video', 'encoding', 'cdn'] },
      { content: '电商系统: 商品、订单、库存、营销。', type: 'domain', language: 'general', tags: ['ecommerce', 'product', 'order'] },
      { content: '社交系统: 关系链、消息推送、内容审核。', type: 'domain', language: 'general', tags: ['social', 'relationship', 'push'] },
      { content: '物流系统: 路径规划、库存管理、配送调度。', type: 'domain', language: 'general', tags: ['logistics', 'routing', 'inventory'] },
      
      // ===== 更多数据处理与分析 =====
      { content: 'ETL: 抽取-转换-加载。', type: 'data_processing', language: 'general', tags: ['etl', 'extract', 'transform'] },
      { content: 'ELT: 抽取-加载-转换(现代数据栈)。', type: 'data_processing', language: 'general', tags: ['elt', 'modern_data', 'warehouse'] },
      { content: '数据仓库: Kimball维度建模、Inmon范式。', type: 'data_processing', language: 'general', tags: ['data_warehouse', 'kimball', 'inmon'] },
      { content: '数据湖: 存储任意格式数据。', type: 'data_processing', language: 'general', tags: ['data_lake', 'storage', 'raw'] },
      { content: 'Lakehouse: 数据湖+数据仓库融合。', type: 'data_processing', language: 'general', tags: ['lakehouse', 'delta_lake', 'iceberg'] },
      { content: 'Apache Spark: 大规模数据处理引擎。', type: 'data_processing', language: 'scala', tags: ['spark', 'batch', 'streaming'] },
      { content: 'Apache Flink: 实时流处理引擎。', type: 'data_processing', language: 'java', tags: ['flink', 'streaming', 'real_time'] },
      { content: 'Apache Kafka: 分布式消息队列。', type: 'data_processing', language: 'java', tags: ['kafka', 'messaging', 'streaming'] },
      { content: 'Apache Hadoop: 分布式计算框架。', type: 'data_processing', language: 'java', tags: ['hadoop', 'mapreduce', 'hdfs'] },
      { content: 'Apache Airflow: 工作流调度。', type: 'data_processing', language: 'python', tags: ['airflow', 'workflow', 'scheduling'] },
      { content: 'dbt: 数据转换工具。', type: 'data_processing', language: 'sql', tags: ['dbt', 'transformation', 'warehouse'] },
      { content: 'Tableau/Power BI: 商业智能工具。', type: 'data_processing', language: 'general', tags: ['bi', 'tableau', 'power_bi'] },
      
      // ===== 代码质量与重构 =====
      { content: '代码异味: 过长方法、魔法数字、过度耦合。', type: 'code_quality', language: 'general', tags: ['code_smell', 'long_method', 'magic_number'] },
      { content: '重构模式: 提取方法、内联变量、移动方法。', type: 'code_quality', language: 'general', tags: ['refactoring', 'extract_method', 'inline'] },
      { content: '技术债务: 有意vs无意、度量、偿还。', type: 'code_quality', language: 'general', tags: ['tech_debt', 'intentional', 'metric'] },
      { content: '代码评审: 设计、正确性、可读性、性能。', type: 'code_quality', language: 'general', tags: ['code_review', 'design', 'correctness'] },
      { content: '静态分析: SonarQube、ESLint、Pylint。', type: 'code_quality', language: 'general', tags: ['static_analysis', 'sonarqube', 'lint'] },
      { content: '代码覆盖率工具: Istanbul、JaCoCo、Coverage.py。', type: 'code_quality', language: 'general', tags: ['coverage', 'istanbul', 'jacoco'] },
      
      // ===== 云服务与Serverless =====
      { content: 'AWS核心服务: EC2、S3、RDS、Lambda。', type: 'cloud', language: 'general', tags: ['aws', 'ec2', 's3'] },
      { content: 'Azure核心服务: VM、Blob Storage、SQL Database、Functions。', type: 'cloud', language: 'general', tags: ['azure', 'vm', 'blob'] },
      { content: 'Google Cloud: Compute Engine、Cloud Storage、BigQuery、Cloud Functions。', type: 'cloud', language: 'general', tags: ['gcp', 'compute', 'storage'] },
      { content: 'Serverless架构: 按执行付费、自动扩缩。', type: 'cloud', language: 'general', tags: ['serverless', 'faas', 'lambda'] },
      { content: 'API Gateway: 请求路由、限流、认证。', type: 'cloud', language: 'general', tags: ['api_gateway', 'routing', 'rate_limit'] },
      { content: 'CDN: 内容分发网络、边缘缓存。', type: 'cloud', language: 'general', tags: ['cdn', 'edge', 'cache'] },
      { content: '负载均衡: L4/L7、轮询、最少连接、一致性哈希。', type: 'cloud', language: 'general', tags: ['load_balancer', 'l4', 'l7'] },
      { content: 'Auto Scaling: 自动扩缩组、伸缩策略。', type: 'cloud', language: 'general', tags: ['auto_scaling', 'asg', 'policy'] },
      { content: '云存储: 对象存储、块存储、文件存储。', type: 'cloud', language: 'general', tags: ['cloud_storage', 'object', 'block'] },
      
      // ===== 更多容器与编排 =====
      { content: 'Dockerfile优化: 层缓存、多阶段构建、.dockerignore。', type: 'devops', language: 'dockerfile', tags: ['dockerfile', 'optimization', 'layer'] },
      { content: 'Kubernetes核心: Pod、Service、Deployment、StatefulSet。', type: 'devops', language: 'yaml', tags: ['kubernetes', 'pod', 'service'] },
      { content: 'Kubernetes网络: CNI、Service类型、Ingress。', type: 'devops', language: 'yaml', tags: ['k8s_network', 'cni', 'ingress'] },
      { content: 'Kubernetes存储: PV、PVC、StorageClass。', type: 'devops', language: 'yaml', tags: ['k8s_storage', 'pv', 'pvc'] },
      { content: 'Helm: Kubernetes包管理。', type: 'devops', language: 'yaml', tags: ['helm', 'chart', 'package'] },
      { content: 'Istio/Linkerd: 服务网格。', type: 'devops', language: 'go', tags: ['service_mesh', 'istio', 'linkerd'] },
      { content: '容器安全: 镜像扫描、运行时保护、Seccomp。', type: 'devops', language: 'general', tags: ['container_security', 'image_scan', 'seccomp'] },
      
      // ===== 更多项目管理与协作 =====
      { content: 'Git工作流: Git Flow、GitHub Flow、Trunk-Based。', type: 'collaboration', language: 'general', tags: ['git_flow', 'github_flow', 'trunk_based'] },
      { content: 'Pull Request: 代码评审、讨论、CI检查。', type: 'collaboration', language: 'general', tags: ['pull_request', 'review', 'discussion'] },
      { content: '代码合并策略: Merge Commit、Squash、Rebase。', type: 'collaboration', language: 'general', tags: ['merge', 'squash', 'rebase'] },
      { content: 'Code Owners: 代码所有者、自动评审请求。', type: 'collaboration', language: 'general', tags: ['codeowners', 'review', 'ownership'] },
      { content: 'Feature Flag: 功能开关、灰度发布。', type: 'collaboration', language: 'general', tags: ['feature_flag', 'feature_toggle', 'canary'] },
      { content: 'A/B测试: 分流、统计显著性、假设检验。', type: 'collaboration', language: 'general', tags: ['ab_testing', 'split', 'significance'] },
      
      // ===== 更多数据库优化 =====
      { content: 'MySQL执行计划: EXPLAIN、key、rows、Extra。', type: 'database', language: 'sql', tags: ['mysql', 'explain', 'execution_plan'] },
      { content: 'MySQL索引类型: B+树、哈希、全文、空间。', type: 'database', language: 'sql', tags: ['mysql_index', 'b_plus', 'hash'] },
      { content: 'MySQL锁机制: 行锁、表锁、间隙锁、Next-Key。', type: 'database', language: 'sql', tags: ['mysql_lock', 'row_lock', 'gap_lock'] },
      { content: 'MySQL事务隔离: 读未提交、读已提交、可重复读、串行化。', type: 'database', language: 'sql', tags: ['isolation', 'read_uncommitted', 'repeatable_read'] },
      { content: 'PostgreSQL高级功能: CTE、窗口函数、JSONB、全文搜索。', type: 'database', language: 'sql', tags: ['postgresql', 'cte', 'window_function'] },
      { content: 'Redis数据结构: String、Hash、List、Set、Sorted Set、Stream。', type: 'database', language: 'general', tags: ['redis', 'data_structure', 'stream'] },
      { content: 'Redis持久化: RDB、AOF。', type: 'database', language: 'general', tags: ['redis', 'rdb', 'aof'] },
      { content: 'Redis集群: 主从、哨兵、Cluster。', type: 'database', language: 'general', tags: ['redis_cluster', 'sentinel', 'master_slave'] },
      { content: 'MongoDB聚合管道: $match、$group、$project、$lookup。', type: 'database', language: 'javascript', tags: ['mongodb', 'aggregation', 'pipeline'] },
      { content: '数据库连接池: HikariCP、pg.Pool、mysql2/promise。', type: 'database', language: 'general', tags: ['connection_pool', 'hikaricp', 'pg_pool'] },
      
      // ===== 更多性能优化 =====
      { content: 'CPU缓存优化: 缓存行、伪共享、空间局部性。', type: 'performance', language: 'c', tags: ['cpu_cache', 'false_sharing', 'spatial_locality'] },
      { content: 'SIMD: 单指令多数据并行。', type: 'performance', language: 'c', tags: ['simd', 'vectorization', 'parallel'] },
      { content: '异步IO: io_uring、AIO、O_DIRECT。', type: 'performance', language: 'c', tags: ['async_io', 'io_uring', 'direct_io'] },
      { content: '内存池: 减少碎片、快速分配。', type: 'performance', language: 'c', tags: ['memory_pool', 'allocation', 'fragmentation'] },
      { content: '对象池: 复用对象、减少GC压力。', type: 'performance', language: 'general', tags: ['object_pool', 'reuse', 'gc'] },
      { content: 'GC优化: 代际GC、分代收集、GC调优。', type: 'performance', language: 'general', tags: ['gc', 'garbage_collection', 'generation'] },
      { content: 'JIT编译: 即时编译、热点检测、反优化。', type: 'performance', language: 'general', tags: ['jit', 'just_in_time', 'hotspot'] },
      { content: 'Profiling: CPU profile、内存profile、火焰图。', type: 'performance', language: 'general', tags: ['profiling', 'flame_graph', 'cpu_profile'] },
      
      // ===== 更多前沿与新兴技术 =====
      { content: '量子计算: Qubit、量子门、Shor算法。', type: 'emerging', language: 'general', tags: ['quantum', 'qubit', 'algorithm'] },
      { content: '区块链: 分布式账本、智能合约、共识。', type: 'emerging', language: 'solidity', tags: ['blockchain', 'smart_contract', 'consensus'] },
      { content: 'Web3: 去中心化应用、DApp、DAO。', type: 'emerging', language: 'solidity', tags: ['web3', 'dapp', 'dao'] },
      { content: '边缘计算: Edge Computing、Fog Computing。', type: 'emerging', language: 'general', tags: ['edge_computing', 'fog', 'iot'] },
      { content: '空间计算: AR/VR/MR、数字孪生。', type: 'emerging', language: 'general', tags: ['spatial', 'ar', 'vr'] },
      { content: '生物计算: DNA计算、神经形态计算。', type: 'emerging', language: 'general', tags: ['bio_computing', 'dna', 'neuromorphic'] },
      { content: '光计算: 光子计算、光学神经网络。', type: 'emerging', language: 'general', tags: ['optical', 'photon', 'neural'] },
      { content: '可信执行环境: TEE、SGX、SEV。', type: 'emerging', language: 'general', tags: ['tee', 'sgx', 'sev'] },
      
      // ===== 更多编程语言与框架 =====
      { content: 'Ruby on Rails: MVC框架、ActiveRecord、ActionController。', type: 'language_feature', language: 'ruby', tags: ['rails', 'mvc', 'activerecord'] },
      { content: 'PHP Laravel: Eloquent ORM、Blade、Middleware。', type: 'language_feature', language: 'php', tags: ['laravel', 'eloquent', 'blade'] },
      { content: 'Swift SwiftUI: 声明式UI、Combine、Swift Concurrency。', type: 'language_feature', language: 'swift', tags: ['swiftui', 'combine', 'async'] },
      { content: 'Kotlin Coroutines: 协程、Flow、StateFlow。', type: 'language_feature', language: 'kotlin', tags: ['coroutine', 'flow', 'stateflow'] },
      { content: 'Elixir/Phoenix: 函数式、OTP、LiveView。', type: 'language_feature', language: 'elixir', tags: ['elixir', 'phoenix', 'otp'] },
      { content: 'Clojure: Lisp方言、不可变数据、REPL驱动。', type: 'language_feature', language: 'clojure', tags: ['clojure', 'lisp', 'immutable'] },
      { content: 'Dart/Flutter: 跨平台UI、Widget、状态管理。', type: 'language_feature', language: 'dart', tags: ['dart', 'flutter', 'widget'] },
      { content: 'Zig: 系统编程、手动内存、编译期计算。', type: 'language_feature', language: 'zig', tags: ['zig', 'system', 'manual_memory'] },
      { content: 'Crystal: Ruby类语法、编译型、类型推断。', type: 'language_feature', language: 'crystal', tags: ['crystal', 'compiled', 'type_inference'] },
      
      // ===== 更多AI与ML工程 =====
      { content: '模型压缩: 量化、剪枝、知识蒸馏。', type: 'ai_ml', language: 'python', tags: ['compression', 'quantization', 'pruning'] },
      { content: '模型评估: 准确率、精确率、召回率、F1、AUC。', type: 'ai_ml', language: 'python', tags: ['evaluation', 'accuracy', 'precision'] },
      { content: '交叉验证: K折、分层K折、留一法。', type: 'ai_ml', language: 'python', tags: ['cross_validation', 'kfold', 'stratified'] },
      { content: '特征工程: 特征选择、特征变换、特征构造。', type: 'ai_ml', language: 'python', tags: ['feature_engineering', 'selection', 'transformation'] },
      { content: '过拟合与欠拟合: 方差-偏差权衡。', type: 'ai_ml', language: 'python', tags: ['overfitting', 'underfitting', 'bias_variance'] },
      { content: '神经网络架构: CNN、RNN、LSTM、Transformer。', type: 'ai_ml', language: 'python', tags: ['cnn', 'rnn', 'lstm', 'transformer'] },
      { content: '优化器: SGD、Adam、RMSProp、Adagrad。', type: 'ai_ml', language: 'python', tags: ['optimizer', 'sgd', 'adam'] },
      { content: '损失函数: 交叉熵、MSE、MAE、Huber。', type: 'ai_ml', language: 'python', tags: ['loss', 'cross_entropy', 'mse'] },
      { content: '学习率调度: 步进、余弦退火、Warmup。', type: 'ai_ml', language: 'python', tags: ['lr_schedule', 'cosine', 'warmup'] },
      { content: '数据增强: 图像、文本、音频增强。', type: 'ai_ml', language: 'python', tags: ['augmentation', 'image', 'text'] },
      
      // ===== 更多微服务与架构 =====
      { content: 'API设计: RESTful、GraphQL、gRPC、OpenAPI。', type: 'architecture', language: 'general', tags: ['api_design', 'rest', 'openapi'] },
      { content: '事件驱动架构: 发布-订阅、事件溯源、CQRS。', type: 'architecture', language: 'general', tags: ['event_driven', 'pubsub', 'cqrs'] },
      { content: '微服务拆分: 按业务能力、限界上下文。', type: 'architecture', language: 'general', tags: ['microservice', 'bounded_context', 'ddd'] },
      { content: '服务发现: 客户端发现、服务端发现。', type: 'architecture', language: 'general', tags: ['service_discovery', 'eureka', 'consul'] },
      { content: '分布式追踪: OpenTelemetry、Zipkin、Jaeger。', type: 'architecture', language: 'general', tags: ['tracing', 'opentelemetry', 'zipkin'] },
      { content: '配置中心: Apollo、Nacos、Spring Cloud Config。', type: 'architecture', language: 'general', tags: ['config_center', 'apollo', 'nacos'] },
      { content: '熔断降级: Hystrix、Resilience4j、Sentinel。', type: 'architecture', language: 'general', tags: ['circuit_breaker', 'hystrix', 'sentinel'] },
      { content: '限流算法: 令牌桶、漏桶、滑动窗口。', type: 'architecture', language: 'general', tags: ['rate_limiting', 'token_bucket', 'leaky_bucket'] },
      
      // ===== 更多前端设计与用户体验 =====
      { content: '响应式设计: 媒体查询、Flexbox、Grid。', type: 'frontend', language: 'css', tags: ['responsive', 'media_query', 'flexbox'] },
      { content: '可访问性(WCAG): ARIA、语义化、键盘导航。', type: 'frontend', language: 'html', tags: ['accessibility', 'wcag', 'aria'] },
      { content: '移动端优化: 触摸事件、手势、设备像素比。', type: 'frontend', language: 'javascript', tags: ['mobile', 'touch', 'gesture'] },
      { content: '动画性能: requestAnimationFrame、will-change、transform。', type: 'frontend', language: 'css', tags: ['animation', 'performance', 'will_change'] },
      { content: '首屏优化: 关键CSS、预加载、懒加载。', type: 'frontend', language: 'html', tags: ['first_paint', 'critical_css', 'preload'] },
      { content: 'Lighthouse: 性能、可访问性、最佳实践评分。', type: 'tool', language: 'javascript', tags: ['lighthouse', 'audit', 'performance'] },
      { content: 'Core Web Vitals: LCP、FID、CLS。', type: 'performance', language: 'web', tags: ['core_web_vitals', 'lcp', 'fid', 'cls'] },
      
      // ===== 更多测试与质量保障 =====
      { content: 'Jest: JavaScript测试框架。', type: 'tool', language: 'javascript', tags: ['jest', 'testing', 'framework'] },
      { content: 'Mocha/Chai: BDD/TDD测试。', type: 'tool', language: 'javascript', tags: ['mocha', 'chai', 'bdd'] },
      { content: 'Vitest: 基于Vite的测试框架。', type: 'tool', language: 'javascript', tags: ['vitest', 'vite', 'testing'] },
      { content: 'Pytest: Python测试框架。', type: 'tool', language: 'python', tags: ['pytest', 'python', 'testing'] },
      { content: 'JUnit: Java单元测试框架。', type: 'tool', language: 'java', tags: ['junit', 'java', 'unit_test'] },
      { content: 'Selenium: Web自动化测试。', type: 'tool', language: 'python', tags: ['selenium', 'web', 'automation'] },
      { content: 'Playwright: 跨浏览器自动化测试。', type: 'tool', language: 'typescript', tags: ['playwright', 'cross_browser', 'e2e'] },
      { content: 'Cypress: 前端E2E测试框架。', type: 'tool', language: 'javascript', tags: ['cypress', 'e2e', 'frontend'] },
      { content: 'Appium: 移动端自动化测试。', type: 'tool', language: 'python', tags: ['appium', 'mobile', 'automation'] },
      
      // ===== 更多设计模式(行为型) =====
      { content: '状态模式: 状态驱动行为变化。', type: 'design_pattern', language: 'general', tags: ['state', 'behavioral', 'fsm'] },
      { content: '观察者模式: 一对多依赖关系。', type: 'design_pattern', language: 'general', tags: ['observer', 'publisher', 'subscriber'] },
      { content: '策略模式: 算法族可互换。', type: 'design_pattern', language: 'general', tags: ['strategy', 'algorithm', 'encapsulation'] },
      { content: '模板方法: 算法框架骨架。', type: 'design_pattern', language: 'general', tags: ['template_method', 'skeleton', 'inheritance'] },
      { content: '命令模式: 请求封装为对象。', type: 'design_pattern', language: 'general', tags: ['command', 'request', 'undo'] },
      { content: '访问者模式: 分离数据结构与操作。', type: 'design_pattern', language: 'general', tags: ['visitor', 'double_dispatch', 'tree'] },
      { content: '中介者模式: 对象间通信封装。', type: 'design_pattern', language: 'general', tags: ['mediator', 'communication', 'colleague'] },
      { content: '备忘录模式: 状态保存与恢复。', type: 'design_pattern', language: 'general', tags: ['memento', 'snapshot', 'undo'] },
      { content: '迭代器模式: 顺序访问集合元素。', type: 'design_pattern', language: 'general', tags: ['iterator', 'traversal', 'collection'] },
      
      // ===== 更多设计模式(创建型/结构型) =====
      { content: '工厂方法: 创建对象接口。', type: 'design_pattern', language: 'general', tags: ['factory_method', 'creation', 'interface'] },
      { content: '抽象工厂: 产品族创建。', type: 'design_pattern', language: 'general', tags: ['abstract_factory', 'product_family', 'creation'] },
      { content: '建造者模式: 分步构造复杂对象。', type: 'design_pattern', language: 'general', tags: ['builder', 'construction', 'fluent'] },
      { content: '原型模式: 克隆现有对象。', type: 'design_pattern', language: 'general', tags: ['prototype', 'cloning', 'copy'] },
      { content: '单例模式: 唯一实例。', type: 'design_pattern', language: 'general', tags: ['singleton', 'global', 'instance'] },
      { content: '适配器模式: 接口转换。', type: 'design_pattern', language: 'general', tags: ['adapter', 'wrapper', 'interface'] },
      { content: '装饰器模式: 动态添加功能。', type: 'design_pattern', language: 'general', tags: ['decorator', 'wrapper', 'dynamic'] },
      { content: '外观模式: 简化复杂子系统。', type: 'design_pattern', language: 'general', tags: ['facade', 'simplify', 'subsystem'] },
      { content: '享元模式: 共享对象减少内存。', type: 'design_pattern', language: 'general', tags: ['flyweight', 'sharing', 'memory'] },
      { content: '组合模式: 树形结构统一处理。', type: 'design_pattern', language: 'general', tags: ['composite', 'tree', 'hierarchy'] },
      
      // ===== 更多深度技术知识 =====
      { content: '浏览器渲染: 解析、布局、绘制、合成。', type: 'frontend', language: 'javascript', tags: ['rendering', 'layout', 'composite'] },
      { content: '关键渲染路径: HTML→CSS→JS执行顺序。', type: 'frontend', language: 'html', tags: ['critical_rendering', 'path', 'performance'] },
      { content: 'Service Worker生命周期: 安装、激活、工作。', type: 'frontend', language: 'javascript', tags: ['service_worker', 'lifecycle', 'pwa'] },
      { content: 'CSS BFC: 块级格式化上下文。', type: 'frontend', language: 'css', tags: ['bfc', 'block_formatting', 'layout'] },
      { content: 'CSS层叠与特异性: 选择器优先级。', type: 'frontend', language: 'css', tags: ['cascade', 'specificity', 'selector'] },
      { content: 'Flexbox: 弹性盒子布局。', type: 'frontend', language: 'css', tags: ['flexbox', 'layout', 'box'] },
      { content: 'CSS Grid: 二维网格布局。', type: 'frontend', language: 'css', tags: ['grid', 'layout', '2d'] },
      { content: 'CSS选择器: 伪类、伪元素、属性选择器。', type: 'frontend', language: 'css', tags: ['selector', 'pseudo', 'attribute'] },
      { content: 'JavaScript原型链: __proto__、prototype、constructor。', type: 'language_feature', language: 'javascript', tags: ['prototype', 'chain', 'inheritance'] },
      { content: 'JavaScript闭包: 函数引用词法作用域。', type: 'language_feature', language: 'javascript', tags: ['closure', 'lexical', 'scope'] },
      { content: 'JavaScript事件循环: 宏任务、微任务执行顺序。', type: 'language_feature', language: 'javascript', tags: ['event_loop', 'microtask', 'macrotask'] },
      { content: 'JavaScript Promise: 链式调用、错误传播、Promise.all/race/any。', type: 'language_feature', language: 'javascript', tags: ['promise', 'chain', 'error_propagation'] },
      { content: 'JavaScript Generator: 生成器函数、迭代协议。', type: 'language_feature', language: 'javascript', tags: ['generator', 'iterator', 'yield'] },
      { content: 'JavaScript Proxy: 对象代理、元编程。', type: 'language_feature', language: 'javascript', tags: ['proxy', 'metaprogramming', 'trap'] },
      { content: 'JavaScript Reflect: 反射API。', type: 'language_feature', language: 'javascript', tags: ['reflect', 'reflection', 'meta'] },
      { content: 'ES6模块: import/export、模块作用域。', type: 'language_feature', language: 'javascript', tags: ['es6_module', 'import', 'export'] },
      { content: 'ES6箭头函数: 词法this、简洁语法。', type: 'language_feature', language: 'javascript', tags: ['arrow_function', 'lexical_this', 'es6'] },
      { content: 'ES6解构: 数组解构、对象解构、默认值。', type: 'language_feature', language: 'javascript', tags: ['destructuring', 'array', 'object'] },
      { content: 'ES6展开运算符: 数组展开、对象展开。', type: 'language_feature', language: 'javascript', tags: ['spread', 'rest', 'operator'] },
      { content: 'ES6类语法: class、extends、super、static。', type: 'language_feature', language: 'javascript', tags: ['class', 'extends', 'super'] },
      
      // ===== 更多编程最佳实践 =====
      { content: 'SOLID原则: 单一职责、开闭、里氏替换、接口隔离、依赖倒置。', type: 'code_quality', language: 'general', tags: ['solid', 'srp', 'ocp'] },
      { content: 'DRY原则: 不要重复自己。', type: 'code_quality', language: 'general', tags: ['dry', 'repetition', 'abstraction'] },
      { content: 'KISS原则: 保持简单。', type: 'code_quality', language: 'general', tags: ['kiss', 'simplicity', 'complexity'] },
      { content: 'YAGNI原则: 不需要的就不要实现。', type: 'code_quality', language: 'general', tags: ['yagni', 'premature', 'simplicity'] },
      { content: 'WET原则: 写够三次。', type: 'code_quality', language: 'general', tags: ['wet', 'abstraction', 'rule_of_three'] },
      { content: 'SoC原则: 关注点分离。', type: 'code_quality', language: 'general', tags: ['soc', 'separation', 'concerns'] },
      { content: 'Law of Demeter: 迪米特法则。', type: 'code_quality', language: 'general', tags: ['demeter', 'least_knowledge', 'coupling'] },
      { content: 'Composition over Inheritance: 组合优于继承。', type: 'code_quality', language: 'general', tags: ['composition', 'inheritance', 'flexibility'] },
      { content: 'Prefer Empty Over Null: 优先使用空集合而非null。', type: 'code_quality', language: 'general', tags: ['empty', 'null', 'avoid_null'] },
      { content: 'Fail Fast: 快速失败原则。', type: 'code_quality', language: 'general', tags: ['fail_fast', 'validation', 'early_check'] },
      
      // ===== 更多网络与安全 =====
      { content: 'HTTPS: TLS/SSL加密传输。', type: 'security', language: 'general', tags: ['https', 'tls', 'ssl'] },
      { content: 'CORS: 跨域资源共享。', type: 'security', language: 'javascript', tags: ['cors', 'cross_origin', 'preflight'] },
      { content: 'CSRF防护: Token验证、SameSite Cookie。', type: 'security', language: 'general', tags: ['csrf', 'token', 'samesite'] },
      { content: 'XSS防护: 输入转义、CSP、HttpOnly Cookie。', type: 'security', language: 'general', tags: ['xss', 'csp', 'sanitization'] },
      { content: 'SQL注入: 参数化查询、ORM、输入验证。', type: 'security', language: 'general', tags: ['sql_injection', 'parameterized', 'orm'] },
      { content: '路径遍历: 路径规范化、白名单。', type: 'security', language: 'general', tags: ['path_traversal', 'normalization', 'whitelist'] },
      { content: 'SSRF防护: URL验证、内网访问限制。', type: 'security', language: 'general', tags: ['ssrf', 'url_validation', 'network'] },
      { content: 'JWT安全: 密钥管理、算法选择、过期策略。', type: 'security', language: 'general', tags: ['jwt', 'token', 'signing'] },
      { content: 'OAuth2: 授权码、隐式、客户端凭证模式。', type: 'security', language: 'general', tags: ['oauth2', 'authorization_code', 'implicit'] },
      { content: 'OIDC: 身份认证协议。', type: 'security', language: 'general', tags: ['oidc', 'identity', 'claims'] },
      { content: 'SAML: 安全断言标记语言。', type: 'security', language: 'general', tags: ['saml', 'identity', 'federation'] },
      { content: '双因素认证: TOTP、SMS、生物识别。', type: 'security', language: 'general', tags: ['2fa', 'totp', 'biometric'] },
      
      // ===== 更多Git与版本控制 =====
      { content: 'Git rebase: 变基操作、交互式rebase。', type: 'collaboration', language: 'general', tags: ['rebase', 'interactive', 'history'] },
      { content: 'Git cherry-pick: 挑选提交。', type: 'collaboration', language: 'general', tags: ['cherry_pick', 'commit', 'select'] },
      { content: 'Git bisect: 二分查找问题提交。', type: 'collaboration', language: 'general', tags: ['bisect', 'debugging', 'binary_search'] },
      { content: 'Git stash: 暂存工作。', type: 'collaboration', language: 'general', tags: ['stash', 'temporary', 'worktree'] },
      { content: 'Git revert: 反向提交。', type: 'collaboration', language: 'general', tags: ['revert', 'undo', 'safe'] },
      { content: 'Git hooks: pre-commit、commit-msg、pre-push。', type: 'collaboration', language: 'general', tags: ['hooks', 'pre_commit', 'commit_msg'] },
      { content: 'Git LFS: 大文件存储。', type: 'collaboration', language: 'general', tags: ['lfs', 'large_file', 'storage'] },
      { content: 'Git submodule: 子模块。', type: 'collaboration', language: 'general', tags: ['submodule', 'subrepo', 'dependency'] },
      { content: 'Git subtree: 子树合并。', type: 'collaboration', language: 'general', tags: ['subtree', 'merge', 'inclusion'] },
      { content: 'GitHub Actions: CI/CD自动化。', type: 'collaboration', language: 'yaml', tags: ['github_actions', 'ci', 'cd'] },
      
      // ===== 更多算法与数据结构 =====
      { content: '堆排序: O(n log n)不稳定排序。', type: 'algorithm', language: 'general', tags: ['heap_sort', 'comparison', 'sorting'] },
      { content: '归并排序: O(n log n)稳定排序。', type: 'algorithm', language: 'general', tags: ['merge_sort', 'divide_conquer', 'stable'] },
      { content: '快速排序: O(n log n)平均，原地排序。', type: 'algorithm', language: 'general', tags: ['quick_sort', 'partition', 'pivot'] },
      { content: '计数排序: O(n)非比较排序(整数)。', type: 'algorithm', language: 'general', tags: ['counting_sort', 'non_comparison', 'integer'] },
      { content: '基数排序: O(k*n)非比较排序。', type: 'algorithm', language: 'general', tags: ['radix_sort', 'non_comparison', 'digit'] },
      { content: '桶排序: O(n+k)平均，分布排序。', type: 'algorithm', language: 'general', tags: ['bucket_sort', 'distribution', 'hash'] },
      { content: '冒泡排序: O(n²)简单排序。', type: 'algorithm', language: 'general', tags: ['bubble_sort', 'comparison', 'simple'] },
      { content: '插入排序: O(n²)小规模数据。', type: 'algorithm', language: 'general', tags: ['insertion_sort', 'comparison', 'adaptive'] },
      { content: '希尔排序: O(n^1.3)平均。', type: 'algorithm', language: 'general', tags: ['shell_sort', 'gap', 'diminishing'] },
      { content: '选择排序: O(n²)不稳定。', type: 'algorithm', language: 'general', tags: ['selection_sort', 'comparison', 'unstable'] },
      
      // ===== 更多数据库深入 =====
      { content: 'MySQL架构: 连接器、管理器、解析器、优化器、执行器。', type: 'database', language: 'sql', tags: ['mysql_arch', 'connector', 'optimizer'] },
      { content: 'InnoDB引擎: B+树索引、事务、行锁。', type: 'database', language: 'sql', tags: ['innodb', 'b_plus', 'transaction'] },
      { content: 'MyISAM引擎: 表锁、全文索引。', type: 'database', language: 'sql', tags: ['myisam', 'table_lock', 'fulltext'] },
      { content: 'SQL优化: 避免SELECT *、使用LIMIT、合理JOIN。', type: 'database', language: 'sql', tags: ['sql_optimization', 'select', 'join'] },
      { content: 'SQL注入防护: 输入验证、参数化、ORM。', type: 'security', language: 'sql', tags: ['sql_injection', 'prevention', 'orm'] },
      { content: '数据库触发器: INSERT/UPDATE/DELETE触发器。', type: 'database', language: 'sql', tags: ['trigger', 'insert', 'update'] },
      { content: '存储过程: 预编译的SQL语句集合。', type: 'database', language: 'sql', tags: ['stored_procedure', 'plsql', 'transact_sql'] },
      { content: '视图: 虚拟表、物化视图。', type: 'database', language: 'sql', tags: ['view', 'materialized', 'virtual'] },
      { content: '分区表: 范围、列表、哈希、键分区。', type: 'database', language: 'sql', tags: ['partition', 'range', 'hash'] },
      { content: '外键约束: 参照完整性。', type: 'database', language: 'sql', tags: ['foreign_key', 'referential', 'integrity'] },
      
      // ===== 更多运维与排错 =====
      { content: 'CPU高排查: top、htop、perf、火焰图。', type: 'ops', language: 'general', tags: ['cpu', 'troubleshooting', 'perf'] },
      { content: '内存高排查: free、vmstat、valgrind、pmap。', type: 'ops', language: 'general', tags: ['memory', 'troubleshooting', 'valgrind'] },
      { content: '磁盘IO排查: iostat、iotop、dstat。', type: 'ops', language: 'general', tags: ['disk_io', 'troubleshooting', 'iostat'] },
      { content: '网络排查: netstat、ss、tcpdump、wireshark。', type: 'ops', language: 'general', tags: ['network', 'troubleshooting', 'tcpdump'] },
      { content: '进程排查: ps、pstree、strace、ltrace。', type: 'ops', language: 'general', tags: ['process', 'troubleshooting', 'strace'] },
      { content: '日志分析: grep、awk、sed、jq。', type: 'ops', language: 'general', tags: ['log', 'analysis', 'grep'] },
      { content: '性能剖析: py-spy、pprof、perf。', type: 'ops', language: 'general', tags: ['profiling', 'py_spy', 'pprof'] },
      
      // ===== 更多前端构建与工具 =====
      { content: 'npm/pnpm/yarn: 包管理器。', type: 'tool', language: 'javascript', tags: ['npm', 'pnpm', 'yarn'] },
      { content: 'NVM: Node版本管理器。', type: 'tool', language: 'bash', tags: ['nvm', 'node_version', 'manager'] },
      { content: 'Webpack Loader: babel-loader、css-loader、file-loader。', type: 'frontend', language: 'javascript', tags: ['webpack_loader', 'babel', 'css'] },
      { content: 'Webpack Plugin: HtmlWebpackPlugin、MiniCssExtractPlugin。', type: 'frontend', language: 'javascript', tags: ['webpack_plugin', 'html', 'css_extract'] },
      { content: 'Webpack优化: Tree Shaking、代码分割、懒加载。', type: 'frontend', language: 'javascript', tags: ['tree_shaking', 'code_split', 'lazy_load'] },
      { content: 'Module Federation: 微前端模块共享。', type: 'frontend', language: 'javascript', tags: ['module_federation', 'micro_frontend', 'shared'] },
      { content: 'Monorepo: Lerna、Nx、Turborepo。', type: 'tool', language: 'javascript', tags: ['monorepo', 'lerna', 'nx'] },
      
      // ===== 最后的条目：更多通用知识 =====
      { content: 'Git分支策略: 主分支、开发分支、功能分支、发布分支。', type: 'collaboration', language: 'general', tags: ['branch', 'strategy', 'workflow'] },
      { content: 'Git合并冲突解决: 手动解决、合并工具、三向合并。', type: 'collaboration', language: 'general', tags: ['conflict', 'merge', 'resolve'] },
      { content: 'Git标签: 版本标签、注解标签、轻量标签。', type: 'collaboration', language: 'general', tags: ['tag', 'version', 'release'] },
      { content: 'CI/CD流水线: 构建、测试、部署、回滚。', type: 'devops', language: 'general', tags: ['ci_cd', 'pipeline', 'deploy'] },
      { content: '容器编排: Docker Swarm、Kubernetes、Nomad。', type: 'devops', language: 'general', tags: ['orchestration', 'docker_swarm', 'nomad'] },
      { content: '服务网格: Istio、Linkerd、Consul Connect。', type: 'devops', language: 'general', tags: ['service_mesh', 'istio', 'linkerd'] },
      { content: '持续交付: CD、蓝绿部署、金丝雀发布。', type: 'devops', language: 'general', tags: ['continuous_delivery', 'blue_green', 'canary'] },
      { content: '基础设施即代码: IaC、Terraform、Pulumi。', type: 'devops', language: 'general', tags: ['iac', 'terraform', 'pulumi'] },
      { content: '配置管理: Ansible、SaltStack、Chef。', type: 'devops', language: 'general', tags: ['config_mgmt', 'ansible', 'saltstack'] },
      { content: '日志系统: ELK、Loki、Splunk。', type: 'devops', language: 'general', tags: ['logging', 'elk', 'loki'] },
      { content: '监控系统: Prometheus、Grafana、Zabbix。', type: 'devops', language: 'general', tags: ['monitoring', 'prometheus', 'zabbix'] },
      { content: '告警系统: Alertmanager、PagerDuty、Opsgenie。', type: 'devops', language: 'general', tags: ['alerting', 'alertmanager', 'pagerduty'] },
      { content: 'APM: 应用性能监控(New Relic、Dynatrace)。', type: 'devops', language: 'general', tags: ['apm', 'new_relic', 'dynatrace'] },
      { content: '错误追踪: Sentry、Rollbar、Bugsnag。', type: 'devops', language: 'general', tags: ['error_tracking', 'sentry', 'rollbar'] },
      { content: '浏览器工具: Chrome DevTools、Firefox DevTools。', type: 'tool', language: 'javascript', tags: ['devtools', 'debugging', 'profiling'] },
      { content: '接口调试: Postman、Insomnia、curl。', type: 'tool', language: 'general', tags: ['api_testing', 'postman', 'curl'] },
      { content: '数据库客户端: DBeaver、Navicat、MySQL Workbench。', type: 'tool', language: 'general', tags: ['db_client', 'dbeaver', 'mysql_workbench'] },
      { content: 'Redis客户端: Redis Insight、Redis Commander、medis。', type: 'tool', language: 'general', tags: ['redis_client', 'insight', 'medis'] },
      { content: '消息队列: RabbitMQ、Apache RocketMQ、ActiveMQ。', type: 'middleware', language: 'java', tags: ['mq', 'rabbitmq', 'rocketmq'] },
      { content: 'RPC框架: Dubbo、Motan、gRPC。', type: 'middleware', language: 'java', tags: ['rpc', 'dubbo', 'motan'] },
      { content: '缓存框架: Spring Cache、Caffeine、Guava Cache。', type: 'middleware', language: 'java', tags: ['cache_framework', 'caffeine', 'spring_cache'] },
      { content: '分布式锁: Redis、Zookeeper、Etcd。', type: 'middleware', language: 'java', tags: ['distributed_lock', 'zookeeper', 'etcd'] },
      { content: '分布式ID: Snowflake、Leaf、IdGenerator。', type: 'middleware', language: 'java', tags: ['distributed_id', 'snowflake', 'leaf'] },
      { content: '限流组件: Sentinel、Guava RateLimiter、Bucket4j。', type: 'middleware', language: 'java', tags: ['rate_limiter', 'sentinel', 'guava'] },
      { content: '消息中间件: Kafka、RocketMQ、Pulsar。', type: 'middleware', language: 'java', tags: ['messaging', 'kafka', 'pulsar'] },
      { content: '任务调度: Quartz、XXL-Job、Cron。', type: 'middleware', language: 'java', tags: ['scheduler', 'quartz', 'xxl_job'] },
      { content: '搜索引擎: Elasticsearch、Solr、Meilisearch。', type: 'middleware', language: 'java', tags: ['search_engine', 'elasticsearch', 'solr'] },
      { content: '全文检索: 倒排索引、BM25、向量检索。', type: 'middleware', language: 'java', tags: ['fulltext_search', 'bm25', 'vector'] },
      { content: 'ORM框架: MyBatis、Hibernate、JPA。', type: 'middleware', language: 'java', tags: ['orm', 'mybatis', 'hibernate'] },
      { content: '对象存储: MinIO、Ceph、OpenStack Swift。', type: 'middleware', language: 'general', tags: ['object_storage', 'minio', 'ceph'] },
      { content: '文件存储: NFS、AFP、SMB/CIFS。', type: 'middleware', language: 'general', tags: ['file_storage', 'nfs', 'smb'] },
      { content: '块存储: AWS EBS、GCP PD、Azure Disk。', type: 'middleware', language: 'general', tags: ['block_storage', 'ebs', 'pd'] },
      { content: 'DNS协议: 递归查询、迭代查询、缓存。', type: 'network', language: 'general', tags: ['dns', 'recursive', 'iterative'] },
      { content: 'TCP协议: 三次握手、四次挥手、流量控制。', type: 'network', language: 'general', tags: ['tcp', 'handshake', 'flow_control'] },
      { content: 'UDP协议: 无连接、不可靠、快速传输。', type: 'network', language: 'general', tags: ['udp', 'connectionless', 'datagram'] },
      { content: 'ARP协议: 地址解析。', type: 'network', language: 'general', tags: ['arp', 'address_resolution', 'ethernet'] },
      { content: 'ICMP协议: 网络诊断(ping)。', type: 'network', language: 'general', tags: ['icmp', 'ping', 'diagnostic'] },
      { content: 'BGP协议: 边界网关协议。', type: 'network', language: 'general', tags: ['bgp', 'routing', 'autonomous_system'] },
      { content: 'OSPF协议: 开放最短路径优先。', type: 'network', language: 'general', tags: ['ospf', 'link_state', 'routing'] },
      { content: 'VLAN: 虚拟局域网。', type: 'network', language: 'general', tags: ['vlan', 'virtual_lan', 'segmentation'] },
      { content: 'NAT: 网络地址转换。', type: 'network', language: 'general', tags: ['nat', 'address_translation', 'ipv4'] },
      { content: 'SDN: 软件定义网络。', type: 'network', language: 'general', tags: ['sdn', 'software_defined', 'controller'] },
      { content: 'NFV: 网络功能虚拟化。', type: 'network', language: 'general', tags: ['nfv', 'virtualization', 'network_function'] },
      { content: 'CDN原理: 边缘节点、回源、缓存策略。', type: 'cloud', language: 'general', tags: ['cdn', 'edge', 'origin'] },
      { content: 'DNS解析: 权威DNS、递归DNS、本地缓存。', type: 'cloud', language: 'general', tags: ['dns_resolution', 'authoritative', 'recursive'] },
      { content: 'API版本管理: URL版本、Header版本、查询参数。', type: 'api', language: 'general', tags: ['versioning', 'url', 'header'] },
      { content: 'API文档: Swagger、OpenAPI、RAML。', type: 'api', language: 'general', tags: ['api_doc', 'swagger', 'openapi'] },
      { content: 'API设计风格: REST、RPC、GraphQL、WebSocket。', type: 'api', language: 'general', tags: ['api_style', 'rest', 'rpc'] },
      { content: '微前端:  Qian、Single-SPA、Module Federation。', type: 'frontend', language: 'javascript', tags: ['micro_frontend', 'qiankun', 'single_spa'] },
      { content: '渐进式Web应用: PWA、Service Worker、Manifest。', type: 'frontend', language: 'javascript', tags: ['pwa', 'progressive', 'manifest'] },
      { content: 'Web无障碍: ARIA标签、键盘导航、屏幕阅读器。', type: 'frontend', language: 'html', tags: ['accessibility', 'aria', 'screen_reader'] },
      { content: '国际化(i18n): 翻译、时区、数字格式。', type: 'frontend', language: 'javascript', tags: ['i18n', 'translation', 'locale'] },
      { content: '本地化(l10n): 货币、日期、度量单位。', type: 'frontend', language: 'javascript', tags: ['l10n', 'localization', 'format'] },
      { content: 'SEO优化: 元标签、结构化数据、XML Sitemap。', type: 'frontend', language: 'html', tags: ['seo', 'meta_tags', 'sitemap'] },
      { content: '性能预算: 加载时间、TTI、包大小限制。', type: 'performance', language: 'web', tags: ['performance_budget', 'tti', 'bundle_size'] },
      { content: '图片优化: WebP/AVIF、响应式图片、懒加载。', type: 'performance', language: 'html', tags: ['image_optimization', 'webp', 'lazy_load'] },
      { content: '字体优化: 子集化、FOUT/FOIT、font-display。', type: 'performance', language: 'css', tags: ['font_optimization', 'subset', 'font_display'] },
      { content: 'Critical CSS: 首屏所需内联CSS。', type: 'performance', language: 'css', tags: ['critical_css', 'inline', 'above_fold'] },
      { content: '代码分割: 路由级、组件级动态import。', type: 'performance', language: 'javascript', tags: ['code_splitting', 'dynamic_import', 'route_level'] },
      { content: 'Babel优化: preset-env、targets、polyfill。', type: 'frontend', language: 'javascript', tags: ['babel', 'preset_env', 'polyfill'] },
      { content: 'TypeScript工程: tsconfig、paths、references。', type: 'frontend', language: 'typescript', tags: ['tsconfig', 'project_references', 'paths'] },
      { content: 'Node.js模块解析: CommonJS、ESM、解析算法。', type: 'language_feature', language: 'javascript', tags: ['node_modules', 'cjs', 'esm'] },
      { content: 'Node.js Stream: Readable、Writable、Transform、Duplex。', type: 'language_feature', language: 'javascript', tags: ['stream', 'readable', 'writable'] },
      { content: 'Node.js Buffer: 二进制数据处理。', type: 'language_feature', language: 'javascript', tags: ['buffer', 'binary', 'encoding'] },
      { content: 'Node.js Cluster: 多核利用。', type: 'language_feature', language: 'javascript', tags: ['cluster', 'worker', 'multicore'] },
      { content: 'Node.js Worker Threads: 多线程。', type: 'language_feature', language: 'javascript', tags: ['worker_threads', 'multithreading', 'cpu_bound'] },
      { content: 'Node.js性能: V8优化、内存限制、GC调优。', type: 'performance', language: 'javascript', tags: ['node_performance', 'v8', 'gc'] },
      { content: 'Python GIL: 全局解释器锁。', type: 'language_feature', language: 'python', tags: ['gil', 'multithreading', 'cpython'] },
      { content: 'Python虚拟环境: venv、virtualenv、conda。', type: 'tool', language: 'python', tags: ['virtualenv', 'venv', 'conda'] },
      { content: 'Python包管理: pip、poetry、pipenv。', type: 'tool', language: 'python', tags: ['pip', 'poetry', 'pipenv'] },
      { content: 'Python异步编程: asyncio、await、async。', type: 'language_feature', language: 'python', tags: ['asyncio', 'async', 'await'] },
      { content: 'Python类型提示: type hints、mypy、pyright。', type: 'language_feature', language: 'python', tags: ['type_hints', 'mypy', 'pyright'] },
      { content: 'Java内存模型: 堆、栈、方法区、GC。', type: 'language_feature', language: 'java', tags: ['jvm_memory', 'heap', 'stack'] },
      { content: 'JVM调优: 堆大小、GC算法、JIT编译。', type: 'performance', language: 'java', tags: ['jvm_tuning', 'heap_size', 'gc_algorithm'] },
      { content: 'Spring Boot自动配置: @EnableAutoConfiguration、条件装配。', type: 'language_feature', language: 'java', tags: ['spring_boot', 'autoconfig', 'conditional'] },
      { content: 'Spring Cloud: 微服务全家桶。', type: 'language_feature', language: 'java', tags: ['spring_cloud', 'microservice', 'feign'] },
      { content: 'Go语言特性: interface、defer、panic/recover、goroutine。', type: 'language_feature', language: 'go', tags: ['go_features', 'defer', 'panic'] },
      { content: 'Go性能优化: 逃逸分析、内存分配、GC。', type: 'performance', language: 'go', tags: ['go_performance', 'escape_analysis', 'gc'] },
      { content: 'Rust内存安全: 所有权、借用检查器、生命周期。', type: 'language_feature', language: 'rust', tags: ['rust_safety', 'borrow_checker', 'lifetime'] },
      { content: 'Rust异步: async/await、Tokio、Futures。', type: 'language_feature', language: 'rust', tags: ['rust_async', 'tokio', 'future'] },
      { content: '系统设计: 高可用、可扩展、可维护。', type: 'architecture', language: 'general', tags: ['system_design', 'availability', 'scalability'] },
      { content: '容量规划: 性能测试、容量预测、弹性伸缩。', type: 'architecture', language: 'general', tags: ['capacity', 'planning', 'forecasting'] },
      { content: '灾难恢复: RTO、RPO、备份策略。', type: 'architecture', language: 'general', tags: ['disaster_recovery', 'rto', 'rpo'] },
      { content: '多活架构: 同城双活、异地多活。', type: 'architecture', language: 'general', tags: ['multi_active', 'same_city', 'dr'] },
      { content: '去中心系统: AP、CP选择、一致性权衡。', type: 'architecture', language: 'general', tags: ['cap_theorem', 'ap', 'cp'] },
      { content: 'IDL: 接口定义语言(Protocol Buffers、Thrift)。', type: 'language_feature', language: 'general', tags: ['idl', 'protobuf', 'thrift'] },
      { content: '序列化: JSON、XML、MessagePack、Avro、Protobuf。', type: 'language_feature', language: 'general', tags: ['serialization', 'json', 'protobuf'] },
      { content: '跨语言通信: gRPC、REST、消息队列。', type: 'architecture', language: 'general', tags: ['cross_language', 'grpc', 'rest'] },
      { content: 'DDD领域驱动设计: 限界上下文、聚合根、实体、值对象。', type: 'architecture', language: 'general', tags: ['ddd', 'bounded_context', 'aggregate_root'] },
      { content: 'Clean Architecture: 清洁架构分层。', type: 'architecture', language: 'general', tags: ['clean_arch', 'layered', 'dependency_rule'] },
      { content: '六边形架构: 端口与适配器。', type: 'architecture', language: 'general', tags: ['hexagonal', 'ports_adapters', 'clean'] },
      { content: '洋葱架构: 洋葱分层依赖。', type: 'architecture', language: 'general', tags: ['onion', 'layered', 'inner'] },
      { content: 'CQRS+ES: 命令查询职责分离+事件溯源。', type: 'architecture', language: 'general', tags: ['cqrs_es', 'write_model', 'read_model'] },
      { content: '事件驱动架构: 发布-订阅、事件总线、事件存储。', type: 'architecture', language: 'general', tags: ['event_driven', 'event_bus', 'event_store'] },
      { content: 'MVC: Model-View-Controller。', type: 'architecture', language: 'general', tags: ['mvc', 'model', 'view', 'controller'] },
      { content: 'MVVM: Model-View-ViewModel。', type: 'architecture', language: 'general', tags: ['mvvm', 'viewmodel', 'two_way'] },
      { content: 'MVP: Model-View-Presenter。', type: 'architecture', language: 'general', tags: ['mvp', 'presenter', 'passive_view'] },
      { content: '微服务通信: 同步(RPC)vs异步(消息)。', type: 'architecture', language: 'general', tags: ['microservice_comm', 'rpc', 'messaging'] },
      { content: 'API网关: 路由、鉴权、限流、熔断。', type: 'architecture', language: 'general', tags: ['api_gateway', 'router', 'auth'] },
      { content: 'BFF模式: 后端为前端服务。', type: 'architecture', language: 'general', tags: ['bff', 'backend_for_frontend', 'aggregation'] },
      { content: '微前端架构: 独立部署、独立技术栈。', type: 'architecture', language: 'general', tags: ['micro_frontend', 'independent', 'deployment'] },
      { content: '模块化单体: 模块化单体架构。', type: 'architecture', language: 'general', tags: ['modular_monolith', 'modular', 'monolith'] },
      { content: '数据库版本管理: Flyway、Liquibase、Alembic。', type: 'database', language: 'general', tags: ['db_migration', 'flyway', 'liquibase'] },
      { content: '数据库迁移: Schema变更、数据迁移、零停机。', type: 'database', language: 'general', tags: ['migration', 'schema_change', 'zero_downtime'] },
      { content: '数据一致性: 强一致、最终一致、因果一致。', type: 'database', language: 'general', tags: ['consistency', 'strong', 'eventual'] },
      { content: '分布式事务: 2PC、3PC、TCC。', type: 'database', language: 'general', tags: ['distributed_tx', '2pc', 'tcc'] },
      { content: '日志系统: 结构化日志、日志聚合、日志分析。', type: 'ops', language: 'general', tags: ['logging', 'structured', 'aggregation'] },
      { content: '链路追踪: Trace、Span、TraceID。', type: 'ops', language: 'general', tags: ['tracing', 'trace_id', 'span'] },
      { content: '可观测性: 指标、日志、追踪(三大支柱)。', type: 'ops', language: 'general', tags: ['observability', 'metrics', 'traces'] },
      { content: 'SRE核心: SLIs、SLOs、错误预算。', type: 'ops', language: 'general', tags: ['sre', 'sli', 'error_budget'] }
    ];

    let addedEntries = 0;
    let skippedEntries = 0;
    
    for (let i = 0; i < defaultEntries.length; i++) {
      const entry = defaultEntries[i];
      try {
        const existing = db.prepare('SELECT id FROM kb_entries WHERE content = ? LIMIT 1').get(entry.content);
        if (existing) {
          skippedEntries++;
          continue;
        }
        await this.addEntry(entry.content, {
          type: entry.type,
          language: entry.language,
          tags: entry.tags,
          source: 'default'
        });
        addedEntries++;
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
      },
      
      // ===== JavaScript/TypeScript 优化案例 =====
      {
        original: '// 检查多个条件\nif (status === "active" || status === "pending" || status === "processing") {\n  // do something\n}',
        optimized: '// 使用includes简化\nif (["active", "pending", "processing"].includes(status)) {\n  // do something\n}',
        explanation: '使用Array.includes简化多条件判断',
        language: 'javascript',
        issueType: 'condition_simplification'
      },
      {
        original: '// 传统字符串拼接\nlet greeting = "Hello, " + name + "! You are " + age + " years old.";',
        optimized: '// 使用模板字符串\nconst greeting = `Hello, ${name}! You are ${age} years old.`;',
        explanation: '使用模板字符串替代字符串拼接，更清晰可读',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: '// 深层嵌套\nif (user) {\n  if (user.address) {\n    if (user.address.city) {\n      console.log(user.address.city);\n    }\n  }\n}',
        optimized: '// 使用可选链\nconsole.log(user?.address?.city);',
        explanation: '使用可选链操作符简化深层属性访问',
        language: 'javascript',
        issueType: 'null_check'
      },
      {
        original: '// 手动创建新数组\nconst newArray = [];\nfor (let i = 0; i < originalArray.length; i++) {\n  newArray.push(originalArray[i] * 2);\n}',
        optimized: '// 使用map\nconst newArray = originalArray.map(item => item * 2);',
        explanation: '使用Array.map替代for循环，更函数式',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 查找数组元素\nlet found = null;\nfor (let i = 0; i < users.length; i++) {\n  if (users[i].id === targetId) {\n    found = users[i];\n    break;\n  }\n}',
        optimized: '// 使用find\nconst found = users.find(user => user.id === targetId);',
        explanation: '使用Array.find查找元素，更简洁',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 检查数组是否满足条件\nlet allActive = true;\nfor (let i = 0; i < users.length; i++) {\n  if (!users[i].active) {\n    allActive = false;\n    break;\n  }\n}',
        optimized: '// 使用every\nconst allActive = users.every(user => user.active);',
        explanation: '使用Array.every检查所有元素是否满足条件',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 累加计算总数\nlet total = 0;\nfor (let i = 0; i < prices.length; i++) {\n  total += prices[i];\n}',
        optimized: '// 使用reduce\nconst total = prices.reduce((sum, price) => sum + price, 0);',
        explanation: '使用Array.reduce进行累加计算',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 去除数组重复值\nconst uniqueArray = [];\nfor (let i = 0; i < array.length; i++) {\n  if (uniqueArray.indexOf(array[i]) === -1) {\n    uniqueArray.push(array[i]);\n  }\n}',
        optimized: '// 使用Set\nconst uniqueArray = [...new Set(array)];',
        explanation: '使用Set去除数组重复值，更高效',
        language: 'javascript',
        issueType: 'performance'
      },
      {
        original: '// 深度拷贝\nconst copy = JSON.parse(JSON.stringify(obj));',
        optimized: '// 使用structuredClone (现代浏览器)\nconst copy = structuredClone(obj);\n// 或使用lodash\n// import { cloneDeep } from "lodash";\n// const copy = cloneDeep(obj);',
        explanation: '使用structuredClone或专门的深拷贝库替代JSON序列化',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: '// 回调地狱\ngetUser(userId, (err, user) => {\n  if (err) return handleError(err);\n  getOrders(user.id, (err, orders) => {\n    if (err) return handleError(err);\n    getProducts(orders[0].productId, (err, product) => {\n      if (err) return handleError(err);\n      console.log(product);\n    });\n  });\n});',
        optimized: '// 使用async/await\nasync function getUserProduct(userId) {\n  try {\n    const user = await getUser(userId);\n    const orders = await getOrders(user.id);\n    const product = await getProduct(orders[0].productId);\n    console.log(product);\n  } catch (err) {\n    handleError(err);\n  }\n}',
        explanation: '使用async/await替代回调，避免回调地狱',
        language: 'javascript',
        issueType: 'async_improvement'
      },
      {
        original: '// 不必要的else\nif (condition) {\n  return value1;\n} else {\n  return value2;\n}',
        optimized: '// 移除else\nif (condition) {\n  return value1;\n}\nreturn value2;',
        explanation: '在return后移除不必要的else语句',
        language: 'javascript',
        issueType: 'unnecessary_else'
      },
      {
        original: '// 冗长的对象属性\nconst name = person.name;\nconst age = person.age;\nconst city = person.address.city;',
        optimized: '// 使用解构\nconst { name, age, address: { city } } = person;',
        explanation: '使用对象解构简化属性访问',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: '// 合并数组\nconst combined = array1.concat(array2).concat(array3);',
        optimized: '// 使用扩展运算符\nconst combined = [...array1, ...array2, ...array3];',
        explanation: '使用扩展运算符合并数组，更简洁',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: '// 类型转换\nconst num = parseInt(str);\nconst floatNum = parseFloat(str);',
        optimized: '// 使用一元运算符\nconst num = +str;\nconst floatNum = +str;',
        explanation: '使用一元+运算符进行类型转换，更简洁',
        language: 'javascript',
        issueType: 'code_style'
      },
      {
        original: '// 检查数组是否为空\nif (array.length === 0) { ... }',
        optimized: '// 使用非空检查\nif (!array?.length) { ... }',
        explanation: '使用可选链和非空检查，更安全',
        language: 'javascript',
        issueType: 'null_check'
      },
      
      // ===== Python 优化案例 =====
      {
        original: '# 传统循环计算\nresult = []\nfor i in range(len(data)):\n    if data[i] > 0:\n        result.append(data[i] ** 2)',
        optimized: '# 使用列表推导式\nresult = [x**2 for x in data if x > 0]',
        explanation: '使用列表推导式简化循环和条件判断',
        language: 'python',
        issueType: 'loop_optimization'
      },
      {
        original: '# 创建字典\nsquares = {}\nfor i in range(5):\n    squares[i] = i ** 2',
        optimized: '# 使用字典推导式\nsquares = {i: i**2 for i in range(5)}',
        explanation: '使用字典推导式创建字典',
        language: 'python',
        issueType: 'loop_optimization'
      },
      {
        original: '# 去重\nitems = [1, 2, 2, 3, 3, 3, 4]\nunique = []\nfor item in items:\n    if item not in unique:\n        unique.append(item)',
        optimized: '# 使用Set去重\nitems = [1, 2, 2, 3, 3, 3, 4]\nunique = list(set(items))',
        explanation: '使用Set进行去重，更高效',
        language: 'python',
        issueType: 'performance'
      },
      {
        original: '# 读取文件\nfile = open("data.txt", "r")\ncontent = file.read()\nfile.close()',
        optimized: '# 使用with语句\nwith open("data.txt", "r") as file:\n    content = file.read()',
        explanation: '使用with语句确保文件正确关闭',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: '# 多条件排序\nstudents.sort(key=lambda s: (-s.grade, s.name))',
        optimized: '# 使用operator.itemgetter\nfrom operator import attrgetter\nstudents.sort(key=attrgetter("grade", "name"), reverse=True)',
        explanation: '使用attrgetter替代lambda，更高效',
        language: 'python',
        issueType: 'performance'
      },
      {
        original: '# 检查键是否存在\nif key in my_dict:\n    value = my_dict[key]\nelse:\n    value = default_value',
        optimized: '# 使用get方法\nvalue = my_dict.get(key, default_value)',
        explanation: '使用dict.get方法简化条件获取',
        language: 'python',
        issueType: 'code_style'
      },
      {
        original: '# 字符串拼接\nresult = ""\nfor item in items:\n    result += str(item)',
        optimized: '# 使用join\nresult = "".join(str(item) for item in items)',
        explanation: '使用str.join进行字符串拼接，更高效',
        language: 'python',
        issueType: 'performance'
      },
      {
        original: '# 枚举遍历\nfor i in range(len(items)):\n    print(i, items[i])',
        optimized: '# 使用enumerate\nfor i, item in enumerate(items):\n    print(i, item)',
        explanation: '使用enumerate进行枚举遍历',
        language: 'python',
        issueType: 'code_style'
      },
      {
        original: '# 解包元组\npoint = (3, 4)\nx = point[0]\ny = point[1]',
        optimized: '# 直接解包\npoint = (3, 4)\nx, y = point',
        explanation: '使用元组解包简化代码',
        language: 'python',
        issueType: 'code_style'
      },
      {
        original: '# 斐波那契数列（低效）\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
        optimized: '# 使用生成器\ndef fibonacci():\n    a, b = 0, 1\n    while True:\n        yield a\n        a, b = b, a + b',
        explanation: '使用生成器实现斐波那契数列，更高效且可无限生成',
        language: 'python',
        issueType: 'performance'
      },
      
      // ===== Java 优化案例 =====
      {
        original: '// 字符串拼接\nString result = "";\nfor (String item : items) {\n    result += item;\n}',
        optimized: '// 使用StringBuilder\nStringBuilder sb = new StringBuilder();\nfor (String item : items) {\n    sb.append(item);\n}\nString result = sb.toString();',
        explanation: '使用StringBuilder进行字符串拼接，性能更好',
        language: 'java',
        issueType: 'performance'
      },
      {
        original: '// 遍历Map\nfor (String key : map.keySet()) {\n    System.out.println(key + ": " + map.get(key));\n}',
        optimized: '// 使用entrySet\nfor (Map.Entry<String, Integer> entry : map.entrySet()) {\n    System.out.println(entry.getKey() + ": " + entry.getValue());\n}',
        explanation: '使用entrySet遍历Map，避免重复查找',
        language: 'java',
        issueType: 'performance'
      },
      {
        original: '// 传统循环\nint sum = 0;\nfor (int i = 0; i < numbers.length; i++) {\n    sum += numbers[i];\n}',
        optimized: '// 使用Stream API\nint sum = Arrays.stream(numbers).sum();',
        explanation: '使用Stream API简化集合操作',
        language: 'java',
        issueType: 'code_style'
      },
      {
        original: '// 检查列表是否包含\nif (list.contains(item)) { ... }',
        optimized: '// 如果频繁检查，使用HashSet\nSet<String> set = new HashSet<>(list);\nif (set.contains(item)) { ... }',
        explanation: '频繁的contains检查应使用HashSet，O(1)查找',
        language: 'java',
        issueType: 'performance'
      },
      
      // ===== Go 优化案例 =====
      {
        original: '// 创建切片\nslice := make([]int, 0)\nfor i := 0; i < 100; i++ {\n    slice = append(slice, i)\n}',
        optimized: '// 预分配容量\nslice := make([]int, 0, 100)\nfor i := 0; i < 100; i++ {\n    slice = append(slice, i)\n}',
        explanation: '预分配切片容量，减少扩容开销',
        language: 'go',
        issueType: 'performance'
      },
      {
        original: '// 错误处理\nresult, err := doSomething()\nif err != nil {\n    fmt.Println("Error:", err)\n    // 忘记return或继续\n}\n// 继续使用result',
        optimized: '// 正确的错误处理\nresult, err := doSomething()\nif err != nil {\n    return err\n}\n// 只有在无错误时才使用result',
        explanation: '正确处理错误后立即返回，避免使用无效数据',
        language: 'go',
        issueType: 'error_handling'
      },
      
      // ===== TypeScript 优化案例 =====
      {
        original: '// 使用any类型\nfunction processData(data: any) {\n    return data.value + data.count;\n}',
        optimized: '// 使用具体类型\ninterface Data {\n    value: string;\n    count: number;\n}\nfunction processData(data: Data): string {\n    return `${data.value}: ${data.count}`;\n}',
        explanation: '使用接口定义数据结构，获得类型安全',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// 类型断言\nconst element = document.getElementById("myInput") as HTMLInputElement;\nconst value = element.value;',
        optimized: '// 使用类型守卫\nconst element = document.getElementById("myInput");\nif (element instanceof HTMLInputElement) {\n    const value = element.value;\n}',
        explanation: '使用类型守卫替代断言，更安全',
        language: 'typescript',
        issueType: 'type_safety'
      },
      
      // ===== 通用优化案例 =====
      {
        original: '// 魔法数字\nif (user.age > 18) { ... }\nif (status === 2) { ... }',
        optimized: '// 使用命名常量\nconst LEGAL_AGE = 18;\nconst STATUS_APPROVED = 2;\nif (user.age > LEGAL_AGE) { ... }\nif (status === STATUS_APPROVED) { ... }',
        explanation: '将魔法数字提取为命名常量',
        language: 'general',
        issueType: 'magic_number'
      },
      {
        original: '// 嵌套条件\nif (a) {\n    if (b) {\n        if (c) {\n            doSomething();\n        }\n    }\n}',
        optimized: '// 使用卫语句\nif (!a) return;\nif (!b) return;\nif (!c) return;\ndoSomething();',
        explanation: '使用卫语句减少嵌套层级',
        language: 'general',
        issueType: 'nested_condition'
      },
      {
        original: '// 过长函数\nfunction processOrder(order) {\n    // 50+行代码处理各种逻辑\n}',
        optimized: '// 拆分为多个小函数\nfunction processOrder(order) {\n    validateOrder(order);\n    calculateTotal(order);\n    applyDiscounts(order);\n    generateInvoice(order);\n}',
        explanation: '将长函数拆分为多个职责单一的小函数',
        language: 'general',
        issueType: 'long_function'
      },
      {
        original: '// 重复代码\nconst tax1 = price1 * 0.08;\nconst tax2 = price2 * 0.08;\nconst tax3 = price3 * 0.08;',
        optimized: '// 提取为函数\nconst TAX_RATE = 0.08;\nfunction calculateTax(price) {\n    return price * TAX_RATE;\n}\nconst tax1 = calculateTax(price1);\nconst tax2 = calculateTax(price2);\nconst tax3 = calculateTax(price3);',
        explanation: '提取重复代码为函数或常量',
        language: 'general',
        issueType: 'dry_violation'
      },
      {
        original: '// 硬编码\nif (email === "admin@example.com") { ... }\nif (apiUrl === "http://localhost:3000") { ... }',
        optimized: '// 使用常量或配置\nconst ADMIN_EMAIL = config.adminEmail;\nconst API_BASE_URL = config.apiUrl;\nif (email === ADMIN_EMAIL) { ... }\nif (apiUrl === API_BASE_URL) { ... }',
        explanation: '使用配置或常量替代硬编码值',
        language: 'general',
        issueType: 'hardcoding'
      },
      
      // ===== 安全相关案例 =====
      {
        original: '// SQL拼接（不安全）\nconst query = `SELECT * FROM users WHERE name = "${userInput}"`;\nconst result = db.query(query);',
        optimized: '// 使用参数化查询\nconst query = "SELECT * FROM users WHERE name = ?";\nconst result = db.query(query, [userInput]);',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'sql_injection'
      },
      {
        original: '// 未转义HTML\nconst html = `<div>${userInput}</div>`;\ndocument.innerHTML = html;',
        optimized: '// 转义用户输入\nimport escapeHtml from "escape-html";\nconst safeHtml = `<div>${escapeHtml(userInput)}</div>`;\ndocument.innerHTML = safeHtml;',
        explanation: '对用户输入进行HTML转义防止XSS攻击',
        language: 'javascript',
        issueType: 'xss_prevention'
      },
      
      // ===== 更多 JavaScript/TypeScript 优化案例 =====
      {
        original: '// 使用for循环遍历\nfor (let i = 0; i < items.length; i++) {\n  console.log(items[i]);\n}',
        optimized: '// 使用forEach更简洁\nitems.forEach(item => console.log(item));',
        explanation: '使用Array.forEach替代传统for循环，代码更简洁',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 查找元素索引\nlet index = -1;\nfor (let i = 0; i < arr.length; i++) {\n  if (arr[i].id === targetId) {\n    index = i;\n    break;\n  }\n}',
        optimized: '// 使用findIndex\nconst index = arr.findIndex(item => item.id === targetId);',
        explanation: '使用Array.findIndex替代手动循环查找索引',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 检查数组是否有满足条件的元素\nlet hasActive = false;\nfor (let i = 0; i < users.length; i++) {\n  if (users[i].active) {\n    hasActive = true;\n    break;\n  }\n}',
        optimized: '// 使用some\nconst hasActive = users.some(user => user.active);',
        explanation: '使用Array.some检查是否存在满足条件的元素',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 数组去重\nconst unique = [];\nfor (let i = 0; i < arr.length; i++) {\n  if (!unique.includes(arr[i])) {\n    unique.push(arr[i]);\n  }\n}',
        optimized: '// 使用Set去重\nconst unique = [...new Set(arr)];',
        explanation: '使用Set数据结构高效去重，性能优于includes检查',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 字符串拼接\nlet result = "";\nfor (let i = 0; i < parts.length; i++) {\n  result += parts[i];\n}',
        optimized: '// 使用join\nconst result = parts.join("");',
        explanation: '使用Array.join替代+=拼接字符串，性能更好',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 多个条件判断\nif (user !== null && user !== undefined && user.address !== null && user.address !== undefined && user.address.city !== null && user.address.city !== undefined) {\n  console.log(user.address.city);\n}',
        optimized: '// 使用可选链\nconst city = user?.address?.city;\nif (city) console.log(city);',
        explanation: '使用可选链操作符(?.)简化多层空值检查',
        language: 'javascript',
        issueType: 'null_check'
      },
      {
        original: '// 提供默认值\nconst name = user.name !== undefined && user.name !== null ? user.name : "Unknown";',
        optimized: '// 使用空值合并\nconst name = user.name ?? "Unknown";',
        explanation: '使用空值合并操作符(??)提供默认值，比三元运算符更简洁',
        language: 'javascript',
        issueType: 'null_check'
      },
      {
        original: '// 数组求和\nlet sum = 0;\nfor (let i = 0; i < numbers.length; i++) {\n  sum += numbers[i];\n}',
        optimized: '// 使用reduce求和\nconst sum = numbers.reduce((acc, num) => acc + num, 0);',
        explanation: '使用Array.reduce进行累积计算',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 类型转换\nconst str = value.toString();\nif (str === "undefined" || str === "null") {\n  return "default";\n}',
        optimized: '// 使用类型转换\nconst num = Number(value) || 0;',
        explanation: '使用Number()转换并提供默认值',
        language: 'javascript',
        issueType: 'type_conversion'
      },
      {
        original: '// 重复属性访问\nconst name = user.name;\nconst age = user.age;\nconst email = user.email;\nconst city = user.city;',
        optimized: '// 使用解构赋值\nconst { name, age, email, city } = user;',
        explanation: '使用解构赋值从对象提取多个属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 异步回调地狱\ngetUser(userId, (err, user) => {\n  if (err) return handleError(err);\n  getOrders(user.id, (err, orders) => {\n    if (err) return handleError(err);\n    getProduct(orders[0].productId, (err, product) => {\n      if (err) return handleError(err);\n      renderPage(user, orders, product);\n    });\n  });\n});',
        optimized: '// 使用async/await\nasync function loadData() {\n  try {\n    const user = await getUser(userId);\n    const orders = await getOrders(user.id);\n    const product = await getProduct(orders[0].productId);\n    renderPage(user, orders, product);\n  } catch (err) {\n    handleError(err);\n  }\n}',
        explanation: '使用async/await替代嵌套回调，避免回调地狱',
        language: 'javascript',
        issueType: 'async_optimization'
      },
      {
        original: '// 并行请求\nconst user = await getUser(userId);\nconst orders = await getOrders(userId);\nconst products = await getProducts(userId);',
        optimized: '// 并行执行\nconst [user, orders, products] = await Promise.all([\n  getUser(userId),\n  getOrders(userId),\n  getProducts(userId)\n]);',
        explanation: '使用Promise.all并行执行独立的异步操作',
        language: 'javascript',
        issueType: 'async_optimization'
      },
      {
        original: '// 大数组处理\nconst result = [];\nfor (let i = 0; i < bigArray.length; i++) {\n  if (bigArray[i].active) {\n    result.push(bigArray[i]);\n  }\n}',
        optimized: '// 使用filter\nconst result = bigArray.filter(item => item.active);',
        explanation: '使用Array.filter过滤数组，表达意图更清晰',
        language: 'javascript',
        issueType: 'loop_optimization'
      },
      {
        original: '// 构建配置对象\nconst config = {};\nconfig.host = "localhost";\nconfig.port = 3000;\nconfig.debug = true;\nconfig.database = "mydb";',
        optimized: '// 使用对象字面量\nconst config = {\n  host: "localhost",\n  port: 3000,\n  debug: true,\n  database: "mydb"\n};',
        explanation: '使用对象字面量一次性创建所有属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 函数参数检查\nfunction createUser(name, age, email) {\n  if (name === undefined || name === null || name === "") {\n    throw new Error("Name is required");\n  }\n  if (age === undefined || age === null || typeof age !== "number") {\n    throw new Error("Age must be a number");\n  }\n  if (email === undefined || email === null || !email.includes("@")) {\n    throw new Error("Invalid email");\n  }\n}',
        optimized: '// 使用参数默认值和校验\nfunction createUser(name, age, email) {\n  name = name?.trim();\n  if (!name) throw new Error("Name is required");\n  if (typeof age !== "number" || age < 0) throw new Error("Age must be a positive number");\n  if (!/^[^@]+@[^@]+\\.[^@]+$/.test(email || "")) throw new Error("Invalid email");\n}',
        explanation: '简化参数检查逻辑，使用更简洁的验证方式',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      
      // ===== Python 优化案例 =====
      {
        original: '# 使用循环构建列表\nsquares = []\nfor i in range(10):\n    squares.append(i ** 2)',
        optimized: '# 使用列表推导式\nsquares = [i ** 2 for i in range(10)]',
        explanation: '使用列表推导式更简洁高效',
        language: 'python',
        issueType: 'loop_optimization'
      },
      {
        original: '# 过滤列表\nactive_users = []\nfor user in users:\n    if user.active:\n        active_users.append(user)',
        optimized: '# 使用列表推导式过滤\nactive_users = [user for user in users if user.active]',
        explanation: '使用列表推导式过滤列表',
        language: 'python',
        issueType: 'loop_optimization'
      },
      {
        original: '# 字典合并\nmerged = {}\nfor d in dicts:\n    for k, v in d.items():\n        merged[k] = v',
        optimized: '# 使用字典解包\nmerged = {**d1, **d2, **d3}',
        explanation: '使用字典解包操作符合并多个字典',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 字符串格式化\nmessage = "Hello " + name + ", you have " + str(count) + " new messages."',
        optimized: '# 使用f-string\nmessage = f"Hello {name}, you have {count} new messages."',
        explanation: '使用f-string格式化字符串，更简洁可读',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 异常处理\nimport sys\ntry:\n    result = risky_operation()\nexcept Exception as e:\n    print("Error:", str(e))\n    sys.exit(1)',
        optimized: '# 更好的异常处理\ntry:\n    result = risky_operation()\nexcept (ValueError, TypeError) as e:\n    logger.error(f"Operation failed: {e}")\n    raise OperationError(f"Failed: {e}") from e',
        explanation: '捕获特定异常类型，使用日志而非print',
        language: 'python',
        issueType: 'error_handling'
      },
      {
        original: '# 读写文件\nfile = open("data.txt", "r")\ncontent = file.read()\nfile.close()',
        optimized: '# 使用with语句自动关闭\nwith open("data.txt", "r") as f:\n    content = f.read()',
        explanation: '使用with上下文管理器确保文件正确关闭',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: '# 检查key是否存在\nif key in my_dict:\n    value = my_dict[key]\nelse:\n    value = "default"',
        optimized: '# 使用get方法\nvalue = my_dict.get(key, "default")',
        explanation: '使用dict.get()安全获取值并提供默认值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 遍历同时获取索引和值\nindex = 0\nfor item in items:\n    print(f"{index}: {item}")\n    index += 1',
        optimized: '# 使用enumerate\nfor index, item in enumerate(items):\n    print(f"{index}: {item}")',
        explanation: '使用enumerate同时获取索引和值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 大列表计算\nresult = []\nfor i in range(1000000):\n    result.append(i * i)',
        optimized: '# 使用生成器节省内存\ndef square_gen(n):\n    for i in range(n):\n        yield i * i\n\nresult = list(square_gen(1000000))',
        explanation: '使用生成器处理大数据集，节省内存',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '# 使用可变默认参数\ndef add_item(item, lst=[]):\n    lst.append(item)\n    return lst',
        optimized: '# 使用不可变默认参数\ndef add_item(item, lst=None):\n    if lst is None:\n        lst = []\n    lst.append(item)\n    return lst',
        explanation: '避免使用可变对象作为默认参数',
        language: 'python',
        issueType: 'bug_fix'
      },
      
      // ===== Java 优化案例 =====
      {
        original: '// 字符串拼接（循环中）\nString result = "";\nfor (String item : items) {\n    result += item;\n}',
        optimized: '// 使用StringBuilder\nStringBuilder sb = new StringBuilder();\nfor (String item : items) {\n    sb.append(item);\n}\nString result = sb.toString();',
        explanation: '循环中使用StringBuilder拼接字符串，避免性能问题',
        language: 'java',
        issueType: 'performance_optimization'
      },
      {
        original: '// 遍历集合查找\nfor (User user : users) {\n    if (user.getId() == targetId) {\n        return user;\n    }\n}\nreturn null;',
        optimized: '// 使用Stream API\nreturn users.stream()\n    .filter(user -> user.getId() == targetId)\n    .findFirst()\n    .orElse(null);',
        explanation: '使用Stream API更优雅地处理集合操作',
        language: 'java',
        issueType: 'code_simplification'
      },
      
      // ===== Go 优化案例 =====
      {
        original: '// 切片追加\ns := make([]int, 0)\nfor i := 0; i < 10000; i++ {\n    s = append(s, i)\n}',
        optimized: '// 预分配容量提升性能\ns := make([]int, 0, 10000)\nfor i := 0; i < 10000; i++ {\n    s = append(s, i)\n}',
        explanation: '预分配切片容量避免多次扩容',
        language: 'go',
        issueType: 'performance_optimization'
      },
      {
        original: '// 错误处理简化\nresult, err := doSomething()\nif err != nil {\n    fmt.Println("Error:", err)\n    return\n}\n_ = result',
        optimized: '// 统一错误处理模式\nresult, err := doSomething()\nif err != nil {\n    return fmt.Errorf("doSomething failed: %w", err)\n}',
        explanation: '使用%w包装错误以保留错误链',
        language: 'go',
        issueType: 'error_handling'
      },
      
      // ===== TypeScript 优化案例 =====
      {
        original: '// 类型断言\nconst value = someValue as unknown as string;',
        optimized: '// 使用类型守卫\nfunction isString(value: unknown): value is string {\n  return typeof value === "string";\n}\n\nif (isString(someValue)) {\n  // someValue 自动推断为 string\n}',
        explanation: '使用类型守卫替代不安全的类型断言',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// 重复类型定义\nfunction getUser(id: number): { id: number; name: string; email: string } { ... }\nfunction updateUser(id: number, data: { name: string; email: string }): void { ... }',
        optimized: '// 使用类型别名/接口\ninterface User {\n  id: number;\n  name: string;\n  email: string;\n}\n\ntype UserUpdate = Pick<User, "name" | "email">;\n\nfunction getUser(id: number): User { ... }\nfunction updateUser(id: number, data: UserUpdate): void { ... }',
        explanation: '使用接口和类型别名避免重复类型定义',
        language: 'typescript',
        issueType: 'code_simplification'
      },
      
      // ===== 通用优化案例 =====
      {
        original: '// 硬编码配置\nconst API_URL = "http://localhost:3000/api";\nconst API_KEY = "sk-1234567890abcdef";',
        optimized: '// 使用环境变量\nconst API_URL = process.env.API_URL;\nconst API_KEY = process.env.API_KEY;',
        explanation: '使用环境变量管理敏感配置信息',
        language: 'general',
        issueType: 'security'
      },
      {
        original: '// 过长函数\nfunction processOrder(order) {\n  // 50+ 行代码处理订单逻辑\n  // 包含验证、计算、保存、通知等所有操作\n}',
        optimized: '// 拆分为多个小函数\nfunction processOrder(order) {\n  validateOrder(order);\n  const total = calculateTotal(order);\n  saveOrder(order, total);\n  notifyCustomer(order);\n}',
        explanation: '将过长函数拆分为职责单一的小函数',
        language: 'general',
        issueType: 'code_structure'
      },
      {
        original: '// 上帝类\nclass OrderManager {\n  // 订单CRUD\n  // 库存管理\n  // 支付处理\n  // 邮件发送\n  // 日志记录\n  // 报表生成\n}',
        optimized: '// 拆分为多个专职类\nclass OrderService { /* 订单逻辑 */ }\nclass InventoryService { /* 库存逻辑 */ }\nclass PaymentService { /* 支付逻辑 */ }\nclass NotificationService { /* 通知逻辑 */ }',
        explanation: '遵循单一职责原则，将上帝类拆分为多个专职类',
        language: 'general',
        issueType: 'design_pattern'
      },
      
      // ===== 更多安全案例 =====
      {
        original: '// SQL拼接查询\nconst query = `SELECT * FROM users WHERE name = "${username}"`;\ndb.query(query);',
        optimized: '// 使用参数化查询\nconst query = "SELECT * FROM users WHERE name = ?";\ndb.query(query, [username]);',
        explanation: '使用参数化查询防止SQL注入攻击',
        language: 'general',
        issueType: 'sql_injection'
      },
      {
        original: '// 明文存储密码\nuser.password = password;',
        optimized: '// 使用加密存储\nconst hashedPassword = await bcrypt.hash(password, 10);\nuser.password = hashedPassword;',
        explanation: '使用bcrypt加密存储用户密码',
        language: 'general',
        issueType: 'password_security'
      },
      
      // ===== 更多 JavaScript 优化案例 =====
      {
        original: '// 递归计算斐波那契\nfunction fibonacci(n) {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}',
        optimized: '// 使用动态规划优化\nfunction fibonacci(n) {\n  if (n <= 1) return n;\n  let prev = 0, curr = 1;\n  for (let i = 2; i <= n; i++) {\n    [prev, curr] = [curr, prev + curr];\n  }\n  return curr;\n}',
        explanation: '使用动态规划将O(2^n)优化到O(n)',
        language: 'javascript',
        issueType: 'algorithm_optimization'
      },
      {
        original: '// 使用JSON.parse解析可能无效的JSON\nfunction parseConfig(configStr) {\n  return JSON.parse(configStr);\n}',
        optimized: '// 安全解析JSON\nfunction parseConfig(configStr) {\n  try {\n    return JSON.parse(configStr);\n  } catch (e) {\n    return null;\n  }\n}',
        explanation: '使用try-catch安全解析JSON',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 深合并配置\nfunction mergeConfig(base, override) {\n  const result = {};\n  for (const key in base) {\n    result[key] = base[key];\n  }\n  for (const key in override) {\n    result[key] = override[key];\n  }\n  return result;\n}',
        optimized: '// 使用展开运算符\nconst mergedConfig = { ...baseConfig, ...overrideConfig };',
        explanation: '使用展开运算符合并对象，更简洁',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 手动查找最大/最小值\nfunction getMinMax(arr) {\n  let min = arr[0];\n  let max = arr[0];\n  for (let i = 1; i < arr.length; i++) {\n    if (arr[i] < min) min = arr[i];\n    if (arr[i] > max) max = arr[i];\n  }\n  return { min, max };\n}',
        optimized: '// 使用Math.min/max展开\nconst min = Math.min(...arr);\nconst max = Math.max(...arr);',
        explanation: '使用Math.min/max和展开操作符简化',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 格式化日期\nfunction formatDate(date) {\n  const year = date.getFullYear();\n  const month = String(date.getMonth() + 1).padStart(2, "0");\n  const day = String(date.getDate()).padStart(2, "0");\n  return `${year}-${month}-${day}`;\n}',
        optimized: '// 使用toISOString或Intl\nconst formatted = date.toISOString().split("T")[0];\n// 或\nconst formatted = new Intl.DateTimeFormat("en-CA").format(date);',
        explanation: '使用内置方法格式化日期',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 检查数组是否包含某个值\nfunction hasValue(arr, val) {\n  return arr.indexOf(val) !== -1;\n}',
        optimized: '// 使用includes\nconst hasValue = arr.includes(val);',
        explanation: '使用Array.includes替代indexOf检查',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 数组排序\nconst sorted = arr.sort((a, b) => {\n  if (a.name < b.name) return -1;\n  if (a.name > b.name) return 1;\n  return 0;\n});',
        optimized: '// 简化排序\nconst sorted = arr.sort((a, b) => a.name.localeCompare(b.name));',
        explanation: '使用localeCompare简化字符串排序',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 获取数组最后一个元素\nconst last = arr[arr.length - 1];',
        optimized: '// 使用at()方法\nconst last = arr.at(-1);',
        explanation: '使用Array.at(-1)获取最后一个元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 合并多个数组\nconst merged = arr1.concat(arr2).concat(arr3);',
        optimized: '// 使用展开运算符\nconst merged = [...arr1, ...arr2, ...arr3];',
        explanation: '使用展开运算符合并数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 字符串转数字\nconst num = parseInt(str, 10);',
        optimized: '// 使用一元加号\nconst num = +str;',
        explanation: '使用一元加号快速转换数字',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      
      // ===== 更多 Python 优化案例 =====
      {
        original: '# 检查列表是否为空\nif len(items) == 0:\n    print("列表为空")',
        optimized: '# 使用布尔判断\nif not items:\n    print("列表为空")',
        explanation: '使用Python的隐式布尔判断',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 字典访问\nvalue = my_dict["key"] if "key" in my_dict else "default"',
        optimized: '# 使用get方法\nvalue = my_dict.get("key", "default")',
        explanation: '使用dict.get()更简洁',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 列表过滤和映射\nresult = []\nfor x in numbers:\n    if x > 0:\n        result.append(x * 2)',
        optimized: '# 使用列表推导式\nresult = [x * 2 for x in numbers if x > 0]',
        explanation: '使用列表推导式同时过滤和映射',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 集合操作\nlist_a = [1, 2, 3, 4]\nlist_b = [3, 4, 5, 6]\ncommon = []\nfor item in list_a:\n    if item in list_b:\n        common.append(item)',
        optimized: '# 使用set交集\ncommon = list(set(list_a) & set(list_b))',
        explanation: '使用set进行集合操作',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '# 多条件判断\nif status == "active" or status == "pending" or status == "processing":\n    pass',
        optimized: '# 使用in操作符\nif status in ("active", "pending", "processing"):\n    pass',
        explanation: '使用in操作符检查多个可能值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 枚举字典\nfor key in my_dict.keys():\n    print(key, my_dict[key])',
        optimized: '# 使用items()\nfor key, value in my_dict.items():\n    print(key, value)',
        explanation: '使用dict.items()同时获取键和值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '# 条件赋值\nif score >= 90:\n    grade = "A"\nelif score >= 80:\n    grade = "B"\nelse:\n    grade = "C"',
        optimized: '# 使用三元表达式\ngrade = "A" if score >= 90 else "B" if score >= 80 else "C"',
        explanation: '使用嵌套三元表达式简化条件赋值',
        language: 'python',
        issueType: 'code_simplification'
      },
      
      // ===== 更多 Java 优化案例 =====
      {
        original: '// 创建HashMap并添加元素\nMap<String, Integer> map = new HashMap<>();\nmap.put("a", 1);\nmap.put("b", 2);\nmap.put("c", 3);',
        optimized: '// 使用Diamond操作符或Stream\nMap<String, Integer> map = Map.of("a", 1, "b", 2, "c", 3);',
        explanation: '使用Map.of()创建不可变Map',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: '// 检查集合是否为空\nif (list != null && list.size() > 0) {\n    // 处理\n}',
        optimized: '// 使用CollectionUtils\nif (CollectionUtils.isNotEmpty(list)) {\n    // 处理\n}',
        explanation: '使用Apache Commons工具类简化检查',
        language: 'java',
        issueType: 'code_simplification'
      },
      
      // ===== 更多 Go 优化案例 =====
      {
        original: '// 字符串拼接\nvar result string\nfor _, s := range parts {\n    result += s\n}',
        optimized: '// 使用strings.Builder\nvar sb strings.Builder\nfor _, s := range parts {\n    sb.WriteString(s)\n}\nresult := sb.String()',
        explanation: '循环中使用strings.Builder，避免O(n²)复杂度',
        language: 'go',
        issueType: 'performance_optimization'
      },
      
      // ===== 更多通用优化案例 =====
      {
        original: '// 硬编码魔法数字\nif (status == 3) { // 3表示已完成\n    sendNotification();\n}',
        optimized: '// 使用命名常量\nconst STATUS_COMPLETED = 3;\nif (status == STATUS_COMPLETED) {\n    sendNotification();\n}',
        explanation: '使用命名常量替代魔法数字',
        language: 'general',
        issueType: 'code_readability'
      },
      {
        original: '// 过度注释显而易见的代码\n// 将i初始化为0\nlet i = 0;\n// 循环10次\nfor (i = 0; i < 10; i++) {\n    // 打印i的值\n    console.log(i);\n}',
        optimized: '// 无意义的注释已删除\nfor (let i = 0; i < 10; i++) {\n    console.log(i);\n}',
        explanation: '删除冗余注释，代码应当自解释',
        language: 'general',
        issueType: 'code_readability'
      },
      {
        original: '// 不必要的临时变量\nconst temp = getValue();\nconst result = temp * 2;\nreturn result;',
        optimized: '// 直接返回\nreturn getValue() * 2;',
        explanation: '删除不必要的临时变量',
        language: 'general',
        issueType: 'code_simplification'
      },
      {
        original: '// 方法名不清晰\nfunction doSomething(a, b, c) { ... }',
        optimized: '// 语义化命名\nfunction calculateOrderTotal(items, discount, shipping) { ... }',
        explanation: '使用有意义的方法名和参数名',
        language: 'general',
        issueType: 'code_readability'
      },
      
      // ===== 更多安全案例 =====
      {
        original: '// 直接拼接用户输入到HTML\nconst content = `<div>${userInput}</div>`;',
        optimized: '// 使用模板转义或sanitize\nimport DOMPurify from "dompurify";\nconst cleanInput = DOMPurify.sanitize(userInput);\nconst content = `<div>${cleanInput}</div>`;',
        explanation: '使用DOMPurify净化HTML输入',
        language: 'javascript',
        issueType: 'xss_prevention'
      },
      {
        original: '// 使用eval执行用户输入\neval(userScript);',
        optimized: '// 避免使用eval\n// 使用Function构造器（有限安全）\nconst fn = new Function(userScript);\n// 或使用沙箱执行\nimport vm from "vm";\nconst result = vm.runInNewContext(userScript, {}, { timeout: 1000 });',
        explanation: '避免使用eval执行动态代码',
        language: 'javascript',
        issueType: 'code_injection'
      },
      {
        original: '// 在URL中传递敏感数据\nfetch(`/api/users?token=${apiKey}`);',
        optimized: '// 使用Authorization header\nfetch("/api/users", {\n  headers: {\n    "Authorization": `Bearer ${apiKey}`\n  }\n});',
        explanation: '使用Header传递敏感信息，避免URL暴露',
        language: 'javascript',
        issueType: 'data_protection'
      },
      
      // ===== 更多性能优化案例 =====
      {
        original: '// 每次渲染都创建新对象\nfunction renderList(items) {\n  return items.map(item => (\n    <div style={{ color: "red", fontSize: 14, padding: 10 }}>\n      {item.name}\n    </div>\n  ));\n}',
        optimized: '// 提取样式为常量\nconst itemStyle = { color: "red", fontSize: 14, padding: 10 };\nfunction renderList(items) {\n  return items.map(item => (\n    <div style={itemStyle}>\n      {item.name}\n    </div>\n  ));\n}',
        explanation: '将静态对象移出渲染循环，避免不必要的重新创建',
        language: 'javascript',
        issueType: 'rendering_performance'
      },
      {
        original: '// 大量DOM操作\nfor (let i = 0; i < 1000; i++) {\n  const div = document.createElement("div");\n  div.textContent = `Item ${i}`;\n  document.body.appendChild(div);\n}',
        optimized: '// 使用DocumentFragment\nconst fragment = document.createDocumentFragment();\nfor (let i = 0; i < 1000; i++) {\n  const div = document.createElement("div");\n  div.textContent = `Item ${i}`;\n  fragment.appendChild(div);\n}\ndocument.body.appendChild(fragment);',
        explanation: '使用DocumentFragment减少DOM重排',
        language: 'javascript',
        issueType: 'dom_performance'
      },
      {
        original: '// 每次都访问DOM\nconst button = document.getElementById("myButton");\nbutton.addEventListener("click", () => {\n  const input = document.getElementById("myInput");\n  const value = input.value;\n  // 处理value\n});',
        optimized: '// 缓存DOM引用\nconst button = document.getElementById("myButton");\nconst input = document.getElementById("myInput");\nbutton.addEventListener("click", () => {\n  const value = input.value;\n  // 处理value\n});',
        explanation: '缓存DOM引用，避免重复查询',
        language: 'javascript',
        issueType: 'dom_performance'
      },
      
      // ===== 更多 TypeScript 优化案例 =====
      {
        original: '// 使用any类型\nfunction parseResponse(data: any) {\n  return JSON.parse(data);\n}',
        optimized: '// 使用泛型约束\nfunction parseResponse<T>(data: string): T {\n  return JSON.parse(data) as T;\n}\n\n// 使用\ninterface User { name: string; age: number; }\nconst user = parseResponse<User>(jsonString);',
        explanation: '使用泛型提供类型安全',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// 类型断言过多\nconst el = document.getElementById("myDiv") as any;\nel.style.color = "red";',
        optimized: '// 使用类型守卫或HTML元素类型\nconst el = document.getElementById("myDiv");\nif (el instanceof HTMLDivElement) {\n  el.style.color = "red";\n}',
        explanation: '使用正确的类型而非any',
        language: 'typescript',
        issueType: 'type_safety'
      },
      
      // ===== 更多高级优化案例 =====
      {
        original: '// 未处理Promise拒绝\nfetchData().then(data => {\n  console.log(data);\n});',
        optimized: '// 添加错误处理\nfetchData()\n  .then(data => console.log(data))\n  .catch(err => console.error("Fetch failed:", err));',
        explanation: '始终处理Promise的拒绝状态',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 异步函数中未处理异常\nasync function loadUser(id) {\n  const response = await fetch(`/api/users/${id}`);\n  return response.json();\n}',
        optimized: '// 添加try-catch处理\nasync function loadUser(id) {\n  try {\n    const response = await fetch(`/api/users/${id}`);\n    if (!response.ok) throw new Error(`HTTP ${response.status}`);\n    return await response.json();\n  } catch (error) {\n    logger.error(`Failed to load user ${id}:`, error);\n    throw error;\n  }\n}',
        explanation: '异步函数中使用try-catch正确处理异常',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 多次调用API获取关联数据\nasync function getOrderDetails(orderId) {\n  const order = await getOrder(orderId);\n  const customer = await getCustomer(order.customerId);\n  const items = order.items.map(async item => {\n    const product = await getProduct(item.productId);\n    return { ...item, product };\n  });\n  return { order, customer, items };\n}',
        optimized: '// 并行获取独立数据\nasync function getOrderDetails(orderId) {\n  const order = await getOrder(orderId);\n  const [customer, enrichedItems] = await Promise.all([\n    getCustomer(order.customerId),\n    Promise.all(order.items.map(async item => {\n      const product = await getProduct(item.productId);\n      return { ...item, product };\n    }))\n  ]);\n  return { order, customer, items: enrichedItems };\n}',
        explanation: '使用Promise.all并行获取独立数据',
        language: 'javascript',
        issueType: 'async_optimization'
      },
      {
        original: '// 组件每次渲染都创建新函数\nfunction ProductList({ products }) {\n  return (\n    <div>\n      {products.map(product => (\n        <ProductCard \n          key={product.id} \n          onClick={() => handleSelect(product)}\n        />\n      ))}\n    </div>\n  );\n}',
        optimized: '// 使用useCallback缓存函数引用\nfunction ProductList({ products }) {\n  const handleSelect = useCallback((product) => {\n    // 处理选择\n  }, []);\n  \n  return (\n    <div>\n      {products.map(product => (\n        <ProductCard \n          key={product.id} \n          onClick={() => handleSelect(product)}\n        />\n      ))}\n    </div>\n  );\n}',
        explanation: '使用useCallback避免不必要的子组件重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 在render中执行昂贵计算\nfunction Dashboard({ data }) {\n  const sortedData = data.sort((a, b) => b.value - a.value);\n  const stats = calculateStats(data);\n  return <Chart data={sortedData} stats={stats} />;\n}',
        optimized: '// 使用useMemo缓存计算结果\nfunction Dashboard({ data }) {\n  const sortedData = useMemo(() => \n    [...data].sort((a, b) => b.value - a.value), \n    [data]\n  );\n  const stats = useMemo(() => calculateStats(data), [data]);\n  return <Chart data={sortedData} stats={stats} />;\n}',
        explanation: '使用useMemo缓存昂贵计算的结果',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的重渲染\nfunction UserProfile({ user }) {\n  console.log("Rendering UserProfile");\n  return (\n    <div>\n      <h1>{user.name}</h1>\n      <p>{user.bio}</p>\n    </div>\n  );\n}\nexport default UserProfile;',
        optimized: '// 使用React.memo防止不必要的重渲染\nconst UserProfile = React.memo(function UserProfile({ user }) {\n  return (\n    <div>\n      <h1>{user.name}</h1>\n      <p>{user.bio}</p>\n    </div>\n  );\n});\nexport default UserProfile;',
        explanation: '使用React.memo避免props未变时的重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 原始SQL查询（可能注入）\nfunction getUserByName(name) {\n  const query = "SELECT * FROM users WHERE name = \'" + name + "\'";\n  return db.query(query);\n}',
        optimized: '// 使用参数化查询\nfunction getUserByName(name) {\n  const query = "SELECT * FROM users WHERE name = ?";\n  return db.query(query, [name]);\n}',
        explanation: '使用参数化查询防止SQL注入',
        language: 'general',
        issueType: 'sql_injection'
      },
      {
        original: '// Python中不必要的列表复制\ndef process_data(data):\n    cleaned = [item.strip() for item in data]\n    filtered = [item for item in cleaned if item]\n    return filtered',
        optimized: '// 使用生成器节省内存\ndef process_data(data):\n    return [item.strip() for item in data if item.strip()]',
        explanation: '合并多个列表操作为一个列表推导式',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python中手动检查类型\ndef process(value):\n    if type(value) == str:\n        return value.upper()\n    elif type(value) == int:\n        return value * 2\n    else:\n        return None',
        optimized: '// 使用isinstance检查\ndef process(value):\n    if isinstance(value, str):\n        return value.upper()\n    elif isinstance(value, int):\n        return value * 2\n    return None',
        explanation: '使用isinstance而非type()检查类型',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// 未分页查询所有数据\nSELECT * FROM orders WHERE user_id = 123;',
        optimized: '// 添加分页\nSELECT * FROM orders WHERE user_id = 123 LIMIT 20 OFFSET 0;\n// 或使用游标\nSELECT * FROM orders WHERE user_id = 123 AND id > last_id LIMIT 20;',
        explanation: '大数据集查询必须使用分页',
        language: 'general',
        issueType: 'database_optimization'
      },
      {
        original: '// 缺少索引的查询\nSELECT * FROM orders WHERE status = "pending" AND created_at > "2024-01-01";',
        optimized: '// 添加复合索引\nCREATE INDEX idx_status_created ON orders (status, created_at);\nSELECT * FROM orders WHERE status = "pending" AND created_at > "2024-01-01";',
        explanation: '为常用查询条件添加复合索引',
        language: 'general',
        issueType: 'database_optimization'
      },
      {
        original: '// 长事务持有锁\nBEGIN TRANSACTION;\nUPDATE accounts SET balance = balance - 100 WHERE id = 1;\n-- 执行其他操作...\n-- 网络调用、日志记录等\nCOMMIT;',
        optimized: '// 缩短事务范围\n-- 先执行网络调用、日志等\nBEGIN TRANSACTION;\nUPDATE accounts SET balance = balance - 100 WHERE id = 1;\nCOMMIT;',
        explanation: '缩短事务持有数据库锁的时间',
        language: 'general',
        issueType: 'database_optimization'
      },
      {
        original: '// 单例模式（非线程安全）\nclass Database {\n  static instance = null;\n  static getInstance() {\n    if (!Database.instance) {\n      Database.instance = new Database();\n    }\n    return Database.instance;\n  }\n}',
        optimized: '// 线程安全的单例（使用双重检查锁定）\nclass Database {\n  static volatile instance = null;\n  static synchronized getInstance() {\n    if (!Database.instance) {\n      synchronized (Database.class) {\n        if (!Database.instance) {\n          Database.instance = new Database();\n        }\n      }\n    }\n    return Database.instance;\n  }\n}',
        explanation: '使用双重检查锁定实现线程安全的单例',
        language: 'java',
        issueType: 'concurrency_safety'
      },
      {
        original: '// 字符串拼接（循环中）\nStringBuilder result = new StringBuilder();\nfor (String s : largeList) {\n    result.append(s);\n    result.append(",");\n}\nreturn result.toString();',
        optimized: '// 使用String.join\nreturn String.join(",", largeList);',
        explanation: '使用String.join简化字符串拼接',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: '// 并发请求无超时控制\nconst responses = await Promise.all(\n  urls.map(url => fetch(url))\n);',
        optimized: '// 添加超时控制\nconst fetchWithTimeout = (url, timeout = 5000) => {\n  return Promise.race([\n    fetch(url),\n    new Promise((_, reject) => \n      setTimeout(() => reject(new Error("Timeout")), timeout)\n    )\n  ]);\n};\n\nconst responses = await Promise.all(\n  urls.map(url => fetchWithTimeout(url))\n);',
        explanation: '为并发请求添加超时控制',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: '// 不处理的资源关闭\nconst file = openFile("data.txt");\nconst data = file.read();\nprocessData(data);\n// file未关闭！',
        optimized: '// 使用资源自动管理\nwith openFile("data.txt") as file:\n  const data = file.read();\n  processData(data);\n// 或使用try-finally\nconst file = openFile("data.txt");\ntry {\n  const data = file.read();\n  processData(data);\n} finally {\n  file.close();\n}',
        explanation: '确保资源在使用后正确关闭',
        language: 'general',
        issueType: 'resource_management'
      },
      {
        original: '// 硬编码连接字符串\nconst connectionString = "Server=localhost;Database=mydb;User Id=sa;Password=pass123";',
        optimized: '// 使用配置文件/环境变量\nconst connectionString = process.env.DB_CONNECTION_STRING;\n// 或使用配置系统\nconst config = require(\'./config\');\nconst connectionString = config.database.connectionString;',
        explanation: '不要在代码中硬编码敏感配置信息',
        language: 'general',
        issueType: 'security'
      },
      {
        original: '// 忽略错误的Promise\ngetData().then(\n  result => console.log(result)\n);',
        optimized: '// 添加完整的错误处理\ngetData()\n  .then(result => console.log(result))\n  .catch(error => {\n    console.error("Error:", error.message);\n    // 上报错误监控\n    reportError(error);\n  });',
        explanation: '不要忽略Promise的错误，添加完整处理',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 创建不必要的中间变量\nconst tempResult = calculate(a, b);\nconst finalResult = transform(tempResult);\nconst output = format(finalResult);\nreturn output;',
        optimized: '// 链式调用\nreturn format(transform(calculate(a, b)));',
        explanation: '使用函数组合减少不必要的中间变量',
        language: 'general',
        issueType: 'code_simplification'
      },
      {
        original: '// 在循环中创建新对象\nfor (let i = 0; i < 10000; i++) {\n  const config = { option1: "value1", option2: "value2" };\n  doSomething(config);\n}',
        optimized: '// 将配置对象移到循环外\nconst config = { option1: "value1", option2: "value2" };\nfor (let i = 0; i < 10000; i++) {\n  doSomething(config);\n}',
        explanation: '将不变的对象创建移到循环外',
        language: 'general',
        issueType: 'performance_optimization'
      },
      
      // ===== 更多实战优化案例 =====
      {
        original: '// 未使用连接池\nconst connection = mysql.createConnection(config);\nconnection.connect();\n// 每次请求都创建新连接',
        optimized: '// 使用连接池\nconst pool = mysql.createPool({\n  connectionLimit: 10,\n  host: config.host,\n  user: config.user,\n  database: config.database\n});\n// 复用连接',
        explanation: '使用连接池复用数据库连接，减少开销',
        language: 'javascript',
        issueType: 'database_optimization'
      },
      {
        original: '// N+1查询问题\nconst users = await getUsers();\nfor (const user of users) {\n  const orders = await getOrdersByUserId(user.id);\n  user.orders = orders;\n}',
        optimized: '// 使用JOIN或批量查询\nconst usersWithOrders = await db.query(`\n  SELECT u.*, o.* \n  FROM users u \n  LEFT JOIN orders o ON u.id = o.user_id\n`);\n// 或批量获取orders\nconst allOrders = await getOrdersByUserIds(users.map(u => u.id));',
        explanation: '避免N+1查询，使用JOIN或批量查询',
        language: 'general',
        issueType: 'database_optimization'
      },
      {
        original: '// 前端：未优化的图片加载\n<img src="/huge-image.jpg" alt="产品图">',
        optimized: '// 优化的图片加载\n<img \n  src="/product.webp" \n  loading="lazy"\n  width="800" \n  height="600"\n  alt="产品图"\n  decoding="async"\n>',
        explanation: '使用现代格式、懒加载、显式尺寸',
        language: 'html',
        issueType: 'frontend_optimization'
      },
      {
        original: '// 未压缩的Bundle\n// 整个lodash库打包进来\nimport _ from "lodash";\n_.debounce(fn, 300);\n_.cloneDeep(obj);',
        optimized: '// Tree-shakeable的导入\nimport { debounce, cloneDeep } from "lodash-es";\n// 或使用原生替代\nconst debouncedFn = debounce(fn, 300);\nconst cloned = structuredClone(obj);',
        explanation: '只导入需要的函数，使用tree-shaking',
        language: 'javascript',
        issueType: 'bundle_optimization'
      },
      {
        original: '// 不必要的全局样式覆盖\nbody {\n  margin: 0;\n  padding: 0;\n}\n.container {\n  width: 100%;\n}\n.button {\n  background-color: blue;\n  color: white;\n}',
        optimized: '// 使用CSS变量和合理的作用域\n:root {\n  --primary-color: blue;\n  --text-color: white;\n}\n\n.container {\n  max-width: 1200px;\n  margin: 0 auto;\n}\n\n.btn-primary {\n  background: var(--primary-color);\n  color: var(--text-color);\n}',
        explanation: '使用CSS变量、BEM命名、响应式设计',
        language: 'css',
        issueType: 'frontend_optimization'
      },
      {
        original: '// Python中的递归实现斐波那契\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
        optimized: '// 使用动态规划\n memo = {}\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    if n not in memo:\n        memo[n] = fibonacci(n-1) + fibonacci(n-2)\n    return memo[n]\n# 或使用迭代\ndef fibonacci_iter(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a',
        explanation: '使用动态规划或迭代避免指数级递归',
        language: 'python',
        issueType: 'algorithm_optimization'
      },
      {
        original: '// 同步阻塞的Node.js代码\nconst data = fs.readFileSync("large-file.json", "utf8");\nconst parsed = JSON.parse(data);\nconsole.log(parsed);',
        optimized: '// 异步非阻塞\nasync function readAndParse() {\n  const data = await fs.promises.readFile("large-file.json", "utf8");\n  const parsed = JSON.parse(data);\n  console.log(parsed);\n}\nreadAndParse();',
        explanation: '使用异步API避免阻塞事件循环',
        language: 'javascript',
        issueType: 'async_optimization'
      },
      {
        original: '// 未使用缓存的API\nasync function fetchUserData(userId) {\n  const response = await fetch(`/api/users/${userId}`);\n  return response.json();\n}',
        optimized: '// 添加内存缓存\nconst userCache = new Map();\nasync function fetchUserData(userId) {\n  if (userCache.has(userId)) {\n    return userCache.get(userId);\n  }\n  const promise = fetch(`/api/users/${userId}`)\n    .then(res => res.json())\n    .catch(err => {\n      userCache.delete(userId);\n      throw err;\n    });\n  userCache.set(userId, promise);\n  return promise;\n}',
        explanation: '缓存API请求结果，避免重复调用',
        language: 'javascript',
        issueType: 'caching'
      },
      {
        original: '// 过度使用useEffect\nfunction Component({ data }) {\n  const [processedData, setProcessedData] = useState([]);\n  \n  useEffect(() => {\n    const result = expensiveCalculation(data);\n    setProcessedData(result);\n  }, [data]);\n  \n  return <div>{processedData.length}</div>;\n}',
        optimized: '// 使用useMemo替代useEffect+useState\nfunction Component({ data }) {\n  const processedData = useMemo(\n    () => expensiveCalculation(data),\n    [data]\n  );\n  \n  return <div>{processedData.length}</div>;\n}',
        explanation: '使用useMemo替代useEffect+setState模式',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不完整的错误信息\nthrow new Error("Something went wrong");',
        optimized: "// 详细的错误信息\nthrow new Error(`Failed to process order ${orderId}: invalid status \"${status}\"`);\n// 或创建自定义错误类\nclass OrderProcessingError extends Error {\n  constructor(orderId, status) {\n    super(`Failed to process order ${orderId}: invalid status \"${status}\"`);\n    this.name = 'OrderProcessingError';\n    this.orderId = orderId;\n    this.status = status;\n  }\n}",
        explanation: '提供有意义的错误信息和自定义错误类型',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 没有使用函数参数\nfunction calculate(x) {\n  const y = 10;\n  return x + y;\n}',
        optimized: '// 移除未使用的参数或添加注释说明\nfunction calculate(x) {\n  const y = 10;  // 固定增量值\n  return x + y;\n}\n// 或如果应该使用参数：\nfunction calculate(x, y = 10) {\n  return x + y;\n}',
        explanation: '移除未使用的参数或合理利用',
        language: 'general',
        issueType: 'code_simplification'
      },
      {
        original: '// 复杂的if-else链\nfunction getDiscount(customer) {\n  if (customer.type === "VIP" && customer.orders > 100) {\n    return 0.2;\n  } else if (customer.type === "VIP") {\n    return 0.15;\n  } else if (customer.type === "Regular" && customer.orders > 50) {\n    return 0.1;\n  } else if (customer.type === "Regular") {\n    return 0.05;\n  } else {\n    return 0;\n  }\n}',
        optimized: '// 使用策略对象或查找表\nconst discountRules = [\n  { condition: c => c.type === "VIP" && c.orders > 100, rate: 0.2 },\n  { condition: c => c.type === "VIP", rate: 0.15 },\n  { condition: c => c.type === "Regular" && c.orders > 50, rate: 0.1 },\n  { condition: c => c.type === "Regular", rate: 0.05 },\n  { condition: () => true, rate: 0 }\n];\n\nfunction getDiscount(customer) {\n  const rule = discountRules.find(r => r.condition(customer));\n  return rule.rate;\n}',
        explanation: '用数据驱动的查找表替代复杂if-else',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 每次调用都创建新的正则\nfunction isValidEmail(email) {\n  const regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;\n  return regex.test(email);\n}',
        optimized: '// 将正则提升到模块级\nconst EMAIL_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;\n\nfunction isValidEmail(email) {\n  return EMAIL_REGEX.test(email);\n}',
        explanation: '正则表达式只编译一次，提升性能',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的类型转换\nconst num = parseInt(str);\nconst result = num + 10;\n// 如果str本来就是数字类型',
        optimized: '// 使用更简洁的方式\nconst num = Number(str);  // 或 +str\nconst result = num + 10;\n// 如果确定是整数：\nconst intNum = parseInt(str, 10);\n// 使用显式的基数参数',
        explanation: '使用正确的类型转换方法和基数参数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 重复的JSON.parse\ntry {\n  const config = JSON.parse(localStorage.getItem("config"));\n  const user = JSON.parse(localStorage.getItem("user"));\n  const data = JSON.parse(localStorage.getItem("data"));\n} catch (e) {\n  console.error("Parse error:", e);\n}',
        optimized: '// 创建通用的安全解析函数\nfunction safeParseJSON(str, fallback = null) {\n  try {\n    return JSON.parse(str);\n  } catch {\n    return fallback;\n  }\n}\n\nconst config = safeParseJSON(localStorage.getItem("config"), {});\nconst user = safeParseJSON(localStorage.getItem("user"), null);\nconst data = safeParseJSON(localStorage.getItem("data"), []);',
        explanation: '封装安全的JSON解析，避免重复try-catch',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 长参数列表\nfunction createUser(firstName, lastName, email, phone, address, city, country, zipCode, role, department, isActive, createdAt) {\n  // ...\n}',
        optimized: '// 使用选项对象\nfunction createUser(userData) {\n  const {\n    firstName, lastName, email, phone,\n    address, city, country, zipCode,\n    role = "user",\n    department = "general",\n    isActive = true,\n    createdAt = new Date()\n  } = userData;\n  // ...\n}',
        explanation: '使用选项对象减少参数数量，提高可读性',
        language: 'general',
        issueType: 'code_simplification'
      },
      {
        original: '// 无注释的正则\nconst regex = /^(\\d{3})-(\\d{3})-(\\d{4})$/;',
        optimized: '// 带有命名捕获组和注释\nconst regex = /^\n  (?<areaCode>\\d{3})    # 区号\n  -                     # 分隔符\n  (?<prefix>\\d{3})      # 前缀\n  -                     # 分隔符\n  (?<lineNumber>\\d{4})  # 号码\n$/x;',
        explanation: '使用命名捕获组和verbose模式增加正则可读性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 隐式类型转换\nconst value = "5" + 3;  // "53"\nconst result = "5" - 3;  // 2\nif (value == 53) { ... }  // true',
        optimized: '// 使用严格相等和显式转换\nconst strValue = "5";\nconst numValue = 3;\nconst concatenated = strValue + numValue;  // "53"\nconst sum = Number(strValue) + numValue;  // 8\nif (concatenated === "53") { ... }  // 严格比较',
        explanation: '使用===严格相等避免隐式类型转换',
        language: 'javascript',
        issueType: 'type_safety'
      },
      {
        original: '// 不必要的闭包\nconst handler = () => {\n  const data = this.data;\n  doSomething(data);\n}.bind(this);',
        optimized: '// 使用箭头函数或直接引用\n// 如果在类方法中：\nclass MyComponent {\n  constructor() {\n    this.handler = () => doSomething(this.data);\n  }\n  // 或使用方法绑定\n  handleClick = () => {\n    doSomething(this.data);\n  }\n}',
        explanation: '合理使用箭头函数和方法绑定',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// React中未使用的导入\nimport React, { useState, useEffect, useReducer } from "react";\nimport { Button, Card, Input, Modal } from "antd";\n\nfunction MyComponent() {\n  const [count, setCount] = useState(0);\n  \n  return (\n    <Card>\n      <Button onClick={() => setCount(count + 1)}>Click {count}</Button>\n    </Card>\n  );\n}',
        optimized: '// 移除未使用的导入\nimport React, { useState } from "react";\nimport { Card, Button } from "antd";\n\nfunction MyComponent() {\n  const [count, setCount] = useState(0);\n  \n  return (\n    <Card>\n      <Button onClick={() => setCount(c => c + 1)}>Click {count}</Button>\n    </Card>\n  );\n}',
        explanation: '移除未使用的导入和依赖，使用函数式更新',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      
      // ===== 更多深度优化案例 =====
      {
        original: '// 阻塞式重试\nasync function fetchWithRetry(url, retries = 3) {\n  for (let i = 0; i < retries; i++) {\n    try {\n      return await fetch(url);\n    } catch (e) {\n      if (i === retries - 1) throw e;\n    }\n  }\n}',
        optimized: '// 带指数退避和抖动的重试\nasync function fetchWithRetry(url, retries = 3) {\n  for (let i = 0; i < retries; i++) {\n    try {\n      return await fetch(url);\n    } catch (e) {\n      if (i === retries - 1) throw e;\n      const delay = Math.min(1000 * Math.pow(2, i), 60000);\n      const jitter = delay * (0.5 + Math.random() * 0.5);\n      await new Promise(r => setTimeout(r, jitter));\n    }\n  }\n}',
        explanation: '使用指数退避和抖动避免惊群效应',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: '// 直接操作DOM代替虚拟DOM\nfunction updateList(items) {\n  const list = document.getElementById("list");\n  list.innerHTML = "";\n  items.forEach(item => {\n    const li = document.createElement("li");\n    li.textContent = item.name;\n    list.appendChild(li);\n  });\n}',
        optimized: '// 使用DocumentFragment减少重排\nfunction updateList(items) {\n  const list = document.getElementById("list");\n  const fragment = document.createDocumentFragment();\n  items.forEach(item => {\n    const li = document.createElement("li");\n    li.textContent = item.name;\n    fragment.appendChild(li);\n  });\n  list.innerHTML = "";\n  list.appendChild(fragment);\n}',
        explanation: '使用DocumentFragment减少DOM重排次数',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 未使用防抖的搜索输入\nconst searchInput = document.getElementById("search");\nsearchInput.addEventListener("input", (e) => {\n  searchAPI(e.target.value);\n});',
        optimized: '// 使用防抖减少API调用\nconst debouncedSearch = debounce((value) => {\n  searchAPI(value);\n}, 300);\n\nsearchInput.addEventListener("input", (e) => {\n  debouncedSearch(e.target.value);\n});',
        explanation: '搜索框添加防抖，减少不必要的API调用',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 计算属性未缓存\nclass Circle {\n  constructor(radius) {\n    this.radius = radius;\n  }\n  get area() {\n    return Math.PI * this.radius ** 2;\n  }\n  get circumference() {\n    return 2 * Math.PI * this.radius;\n  }\n}',
        optimized: '// 缓存计算结果\nclass Circle {\n  constructor(radius) {\n    this._radius = radius;\n    this._area = null;\n    this._circumference = null;\n  }\n  \n  get radius() { return this._radius; }\n  set radius(value) {\n    this._radius = value;\n    this._area = null;\n    this._circumference = null;\n  }\n  \n  get area() {\n    if (this._area === null) {\n      this._area = Math.PI * this._radius ** 2;\n    }\n    return this._area;\n  }\n  \n  get circumference() {\n    if (this._circumference === null) {\n      this._circumference = 2 * Math.PI * this._radius;\n    }\n    return this._circumference;\n  }\n}',
        explanation: '在属性未变化时缓存计算结果',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的数组遍历\nconst result = data\n  .filter(item => item.active)\n  .map(item => item.value * 2)\n  .filter(value => value > 10)\n  .map(value => ({ value, doubled: true }));',
        optimized: '// 使用单次reduce完成所有操作\nconst result = data.reduce((acc, item) => {\n  if (!item.active) return acc;\n  const doubled = item.value * 2;\n  if (doubled > 10) {\n    acc.push({ value: doubled, doubled: true });\n  }\n  return acc;\n}, []);',
        explanation: '使用reduce一次遍历完成多步操作',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 硬编码的API端点\nconst API_URL = "http://localhost:3000/api/v1/users";\n\nasync function getUsers() {\n  const response = await fetch(API_URL);\n  return response.json();\n}',
        optimized: '// 使用环境变量和配置\nconst config = {\n  development: { baseUrl: "http://localhost:3000" },\n  staging: { baseUrl: "https://staging-api.example.com" },\n  production: { baseUrl: "https://api.example.com" }\n};\n\nconst API_BASE = config[process.env.NODE_ENV].baseUrl;\nconst API_VERSION = "v1";\n\nasync function getUsers() {\n  const response = await fetch(`${API_BASE}/${API_VERSION}/users`);\n  return response.json();\n}',
        explanation: '使用环境配置管理不同环境的API地址',
        language: 'javascript',
        issueType: 'config_best_practice'
      },
      {
        original: '// 手写深拷贝\nfunction deepClone(obj) {\n  if (obj === null || typeof obj !== "object") return obj;\n  if (Array.isArray(obj)) {\n    return obj.map(item => deepClone(item));\n  }\n  const clone = {};\n  for (const key in obj) {\n    clone[key] = deepClone(obj[key]);\n  }\n  return clone;\n}',
        optimized: '// 使用原生API或序列化\n// 现代浏览器\nconst cloned = structuredClone(obj);\n// 或使用序列化（注意函数和Symbol等会丢失）\nconst cloned = JSON.parse(JSON.stringify(obj));\n// 或使用成熟库\nimport { cloneDeep } from "lodash-es";\nconst cloned = cloneDeep(obj);',
        explanation: '使用现代API或成熟库进行深拷贝',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// Python中手动展开循环\nresult = []\nfor i in range(len(data)):\n    if data[i] > 0:\n        result.append(data[i] * 2)',
        optimized: '// 使用列表推导式\nresult = [x * 2 for x in data if x > 0]',
        explanation: '使用列表推导式更简洁高效',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python中使用map和filter\nfiltered = filter(lambda x: x > 0, data)\nresult = map(lambda x: x * 2, filtered)\noutput = list(result)',
        optimized: '// 使用列表推导式更具可读性\nresult = [x * 2 for x in data if x > 0]',
        explanation: '列表推导式比map/filter更具Pythonic风格',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// React useEffect依赖数组不完整\nfunction UserCard({ userId }) {\n  const [user, setUser] = useState(null);\n  \n  useEffect(() => {\n    fetchUser(userId).then(setUser);\n  }, []);  // 缺少userId依赖\n  \n  return user ? <div>{user.name}</div> : null;\n}',
        optimized: '// 正确的依赖数组\nfunction UserCard({ userId }) {\n  const [user, setUser] = useState(null);\n  \n  useEffect(() => {\n    let cancelled = false;\n    fetchUser(userId).then(data => {\n      if (!cancelled) setUser(data);\n    });\n    return () => { cancelled = true; };\n  }, [userId]);  // 正确的依赖\n  \n  return user ? <div>{user.name}</div> : null;\n}',
        explanation: 'useEffect依赖数组必须完整，处理取消逻辑',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不处理组件卸载\nfunction Timer() {\n  const [seconds, setSeconds] = useState(0);\n  \n  useEffect(() => {\n    setInterval(() => {\n      setSeconds(s => s + 1);\n    }, 1000);\n  }, []);\n  \n  return <div>{seconds}s</div>;\n}',
        optimized: '// 清理定时器\nfunction Timer() {\n  const [seconds, setSeconds] = useState(0);\n  \n  useEffect(() => {\n    const interval = setInterval(() => {\n      setSeconds(s => s + 1);\n    }, 1000);\n    return () => clearInterval(interval);\n  }, []);\n  \n  return <div>{seconds}s</div>;\n}',
        explanation: 'useEffect必须清理副作用，避免内存泄漏',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// JavaScript中字符串拼接\nlet result = "";\nfor (const item of items) {\n  result += item.name + ", ";  // 每次都创建新字符串\n}',
        optimized: '// 使用join或数组累加\nconst names = items.map(item => item.name);\nconst result = names.join(", ");',
        explanation: '字符串不可变，大量拼接使用join或数组',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的函数重复调用\nconst price = getPrice();\nconst tax = getTax();\nconst discount = getDiscount();\nconst total = calculateTotal(price, tax, discount);',
        optimized: '// 如果getPrice/getTax/getDiscount有计算开销且值不变\nconst { price, tax, discount } = useMemo(() => ({\n  price: getPrice(),\n  tax: getTax(),\n  discount: getDiscount()\n}), []);\nconst total = calculateTotal(price, tax, discount);',
        explanation: '缓存计算结果避免重复调用',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 缺少输入验证的API\napp.post("/transfer", (req, res) => {\n  const { from, to, amount } = req.body;\n  transferMoney(from, to, amount);\n  res.json({ success: true });\n});',
        optimized: '// 添加输入验证\napp.post("/transfer", (req, res) => {\n  const { error, value } = transferSchema.validate(req.body);\n  if (error) {\n    return res.status(400).json({ error: error.details[0].message });\n  }\n  \n  const { from, to, amount } = value;\n  \n  if (amount <= 0) {\n    return res.status(400).json({ error: "Amount must be positive" });\n  }\n  \n  transferMoney(from, to, amount);\n  res.json({ success: true });\n});',
        explanation: '所有外部输入必须验证和清理',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 同步日志记录\nfunction processOrder(order) {\n  const result = validate(order);\n  logger.info(`Processing order ${order.id}`);\n  const processed = calculateTotal(result);\n  logger.info(`Order ${order.id} total: ${processed.total}`);\n  return saveOrder(processed);\n}',
        optimized: '// 异步日志 + 结构化日志\nconst logger = winston.createLogger({...});\n\nasync function processOrder(order) {\n  const result = validate(order);\n  logger.info({ event: "order_process_start", orderId: order.id });\n  const processed = calculateTotal(result);\n  logger.info({ event: "order_process_total", orderId: order.id, total: processed.total });\n  return saveOrder(processed);\n}',
        explanation: '使用结构化日志便于搜索和分析',
        language: 'javascript',
        issueType: 'observability'
      },
      {
        original: '// 单个大SQL查询\nSELECT * FROM orders o, users u, products p\nWHERE o.user_id = u.id AND o.product_id = p.id\nAND o.status = "pending"',
        optimized: '// 使用明确JOIN和分页\nSELECT o.*, u.name as user_name, p.name as product_name\nFROM orders o\nINNER JOIN users u ON o.user_id = u.id\nINNER JOIN products p ON o.product_id = p.id\nWHERE o.status = ?\nORDER BY o.created_at DESC\nLIMIT ? OFFSET ?',
        explanation: '使用明确的JOIN语法和参数化查询',
        language: 'general',
        issueType: 'database_optimization'
      },
      {
        original: '// 长函数包含多种职责\nfunction processUserData(userData) {\n  // 验证\n  if (!userData.email || !userData.name) {\n    throw new Error("Invalid user data");\n  }\n  // 转换\n  const formatted = {\n    email: userData.email.toLowerCase().trim(),\n    name: userData.name.trim(),\n    age: parseInt(userData.age) || 0\n  };\n  // 保存\n  const user = db.query("INSERT INTO users ...");\n  // 发送通知\n  emailService.sendWelcome(formatted.email);\n  // 记录\n  analytics.track("user_created", { userId: user.id });\n}',
        optimized: '// 拆分为单一职责的小函数\nfunction createUser(userData) {\n  const validated = validateUserData(userData);\n  const formatted = formatUserData(validated);\n  const user = saveUser(formatted);\n  notifyUser(user);\n  trackUserCreation(user);\n  return user;\n}\n\nfunction validateUserData(data) { ... }\nfunction formatUserData(data) { ... }\nfunction saveUser(data) { ... }\nfunction notifyUser(user) { ... }\nfunction trackUserCreation(user) { ... }',
        explanation: '单一职责原则，每个函数只做一件事',
        language: 'general',
        issueType: 'code_simplification'
      },
      {
        original: '// 缺失的错误边界\nclass Dashboard extends React.Component {\n  render() {\n    return (\n      <div>\n        <Header />\n        <Content />\n        <Footer />\n      </div>\n    );\n  }\n}',
        optimized: '// 添加错误边界\nclass Dashboard extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { hasError: false };\n  }\n  \n  static getDerivedStateFromError(error) {\n    return { hasError: true };\n  }\n  \n  componentDidCatch(error, info) {\n    console.error("Dashboard Error:", error, info);\n  }\n  \n  render() {\n    if (this.state.hasError) {\n      return <ErrorFallback />;\n    }\n    return (\n      <div>\n        <Header />\n        <Content />\n        <Footer />\n      </div>\n    );\n  }\n}',
        explanation: '使用错误边界捕获子组件渲染错误',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 缺失的卸载清理\nclass ChatRoom extends React.Component {\n  componentDidMount() {\n    this.socket = io("/chat");\n    this.socket.on("message", this.handleMessage);\n  }\n  \n  handleMessage = (msg) => {\n    this.setState({ messages: [...this.state.messages, msg] });\n  }\n}',
        optimized: '// 添加componentWillUnmount清理\nclass ChatRoom extends React.Component {\n  componentDidMount() {\n    this.socket = io("/chat");\n    this.socket.on("message", this.handleMessage);\n  }\n  \n  componentWillUnmount() {\n    this.socket.off("message", this.handleMessage);\n    this.socket.disconnect();\n  }\n  \n  handleMessage = (msg) => {\n    this.setState(prev => ({ messages: [...prev.messages, msg] }));\n  }\n}',
        explanation: '组件卸载时清理事件监听和连接',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 通用异常捕获\ntry {\n  riskyOperation();\n} catch (e) {\n  console.error(e);\n}',
        optimized: '// 精细的异常处理\ntry {\n  const result = await riskyOperation();\n  return result;\n} catch (networkError) {\n  if (networkError.code === "TIMEOUT") {\n    return retryWithBackoff();\n  }\n  return handleNetworkError(networkError);\n} catch (validationError) {\n  return showValidationError(validationError);\n} catch (error) {\n  logger.critical("Unexpected error", error);\n  return showGenericError();\n}',
        explanation: '根据错误类型进行针对性处理',
        language: 'javascript',
        issueType: 'error_handling'
      },
      
      // ===== 大量实战优化案例 =====
      {
        original: '// 未处理的Promise链\nfetchUser(id)\n  .then(user => getOrders(user.id))\n  .then(orders => {\n    console.log(orders);\n  });',
        optimized: '// 添加错误处理和async/await\nasync function loadUserData(id) {\n  try {\n    const user = await fetchUser(id);\n    const orders = await getOrders(user.id);\n    return { user, orders };\n  } catch (error) {\n    if (error.status === 404) {\n      showNotFoundError();\n    } else {\n      showGenericError(error);\n    }\n  }\n}',
        explanation: '使用async/await和try-catch处理异步错误',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 未使用的Context导致重渲染\nconst ThemeContext = React.createContext();\n\nfunction App() {\n  const [theme, setTheme] = useState("light");\n  return (\n    <ThemeContext.Provider value={{ theme, setTheme }}>\n      <Header />\n      <Main />\n      <Footer />\n    </ThemeContext.Provider>\n  );\n}',
        optimized: '// 使用useMemo避免Context值变化导致所有消费者重渲染\nfunction App() {\n  const [theme, setTheme] = useState("light");\n  const value = useMemo(\n    () => ({ theme, setTheme }),\n    [theme]\n  );\n  return (\n    <ThemeContext.Provider value={value}>\n      <Header />\n      <Main />\n      <Footer />\n    </ThemeContext.Provider>\n  );\n}',
        explanation: '使用useMemo缓存Context value避免不必要的重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不使用虚拟化的长列表\nfunction BigList({ items }) {\n  return (\n    <div>\n      {items.map(item => (\n        <ListItem key={item.id} item={item} />\n      ))}\n    </div>\n  );\n}',
        optimized: '// 使用虚拟滚动\nimport { VirtualList } from "react-window";\n\nfunction BigList({ items }) {\n  const Row = ({ index, style }) => (\n    <ListItem item={items[index]} style={style} />\n  );\n  return (\n    <VirtualList\n      height={600}\n      itemCount={items.length}\n      itemSize={50}\n      width="100%"\n    >\n      {Row}\n    </VirtualList>\n  );\n}',
        explanation: '使用虚拟滚动处理大量列表项',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 后端：N+1查询\nconst posts = await Post.findAll();\nfor (const post of posts) {\n  const comments = await Comment.findAll({\n    where: { postId: post.id }\n  });\n  post.comments = comments;\n}',
        optimized: '// 使用include或批量查询\nconst posts = await Post.findAll({\n  include: [{ model: Comment }]\n});\n// 或批量获取\nconst postIds = posts.map(p => p.id);\nconst allComments = await Comment.findAll({\n  where: { postId: postIds }\n});\nconst commentsByPost = groupBy(allComments, "postId");\nposts.forEach(p => p.comments = commentsByPost[p.id] || []);',
        explanation: '使用Eager Loading或批量查询避免N+1问题',
        language: 'javascript',
        issueType: 'database_optimization'
      },
      {
        original: '// Python递归深度限制\nimport sys\nsys.setrecursionlimit(100000)\n\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
        optimized: '// 使用迭代代替递归\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a',
        explanation: '使用迭代避免递归深度限制和栈溢出',
        language: 'python',
        issueType: 'algorithm_optimization'
      },
      {
        original: '// 硬编码的超时时间\nconst result = await fetch(url, { timeout: 5000 });',
        optimized: '// 可配置的超时和重试\nconst config = getConfig();\nconst controller = new AbortController();\nconst timeoutId = setTimeout(() => controller.abort(), config.timeout);\n\ntry {\n  const response = await fetch(url, {\n    signal: controller.signal,\n    headers: getAuthHeaders()\n  });\n  return response.json();\n} finally {\n  clearTimeout(timeoutId);\n}',
        explanation: '使用AbortController实现可配置超时',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: '// 不必要的类型断言\nconst element = document.getElementById("app") as HTMLDivElement;\nelement.innerHTML = "Hello";',
        optimized: '// 类型安全的DOM操作\nconst element = document.getElementById("app");\nif (element instanceof HTMLDivElement) {\n  element.textContent = "Hello";\n} else {\n  throw new Error("Element #app is not a div");\n}',
        explanation: '使用instanceof进行类型检查而非类型断言',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// 循环中创建闭包\nconst buttons = document.querySelectorAll("button");\nfor (var i = 0; i < buttons.length; i++) {\n  buttons[i].addEventListener("click", function() {\n    console.log("Button " + i + " clicked");\n  });\n}',
        optimized: '// 使用let或forEach\nconst buttons = document.querySelectorAll("button");\nbuttons.forEach((button, i) => {\n  button.addEventListener("click", () => {\n    console.log(`Button ${i} clicked`);\n  });\n});',
        explanation: '使用let或forEach避免闭包陷阱',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: '// 不使用CSS变量的主题\n.button-primary {\n  background-color: #3498db;\n  color: white;\n  border: 1px solid #2980b9;\n}\n\n.button-secondary {\n  background-color: #95a5a6;\n  color: white;\n  border: 1px solid #7f8c8d;\n}',
        optimized: '// 使用CSS变量便于主题切换\n:root {\n  --color-primary: #3498db;\n  --color-primary-dark: #2980b9;\n  --color-secondary: #95a5a6;\n  --color-secondary-dark: #7f8c8d;\n  --color-white: white;\n}\n\n.button-primary {\n  background-color: var(--color-primary);\n  color: var(--color-white);\n  border: 1px solid var(--color-primary-dark);\n}\n\n.button-secondary {\n  background-color: var(--color-secondary);\n  color: var(--color-white);\n  border: 1px solid var(--color-secondary-dark);\n}',
        explanation: '使用CSS变量便于维护和主题切换',
        language: 'css',
        issueType: 'frontend_optimization'
      },
      {
        original: '// 不必要的重计算\nfunction calculateTotal(items) {\n  let total = 0;\n  for (const item of items) {\n    total += item.price * item.quantity;\n  }\n  return total;\n}\n\n// 每次渲染都计算\nconst total = calculateTotal(cartItems);',
        optimized: '// 使用useMemo缓存结果\nconst total = useMemo(() => {\n  return cartItems.reduce((sum, item) => \n    sum + item.price * item.quantity, 0\n  );\n}, [cartItems]);',
        explanation: '使用useMemo和reduce优化计算',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 数组去重性能差\nconst uniqueItems = [];\nfor (const item of items) {\n  if (!uniqueItems.includes(item)) {\n    uniqueItems.push(item);\n  }\n}',
        optimized: '// 使用Set O(1)查找\nconst uniqueItems = [...new Set(items)];\n// 或使用filter和indexOf\nconst uniqueItems = items.filter(\n  (item, index) => items.indexOf(item) === index\n);',
        explanation: '使用Set进行高效数组去重',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的深拷贝\nconst config = { ...defaultConfig, ...userConfig };',
        optimized: '// 仅在需要时使用深拷贝\nconst config = deepMerge(defaultConfig, userConfig);\n// 或使用结构化克隆\nconst config = structuredClone({ ...defaultConfig, ...userConfig });',
        explanation: '仅在嵌套结构需要时使用深拷贝',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不处理Promise rejections\npromise.then(result => {\n  console.log(result);\n});',
        optimized: '// 添加完整的错误处理\npromise\n  .then(result => console.log(result))\n  .catch(error => console.error("Error:", error))\n  .finally(() => console.log("Done"));',
        explanation: '使用catch和finally处理所有Promise状态',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 不必要的循环\nconst result = [];\nfor (let i = 0; i < items.length; i++) {\n  result.push(items[i].name);\n}',
        optimized: '// 使用map更简洁\nconst result = items.map(item => item.name);',
        explanation: '使用高阶函数map替代手动循环',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 重复的条件判断\nfunction getPrice(type) {\n  if (type === "A") return 100;\n  if (type === "B") return 200;\n  if (type === "C") return 300;\n  return 0;\n}',
        optimized: '// 使用查找表\nconst PRICE_MAP = { A: 100, B: 200, C: 300 };\nfunction getPrice(type) {\n  return PRICE_MAP[type] ?? 0;\n}',
        explanation: '使用对象查找表替代if链',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 未优化的图片\n<img src="/product.jpg" alt="Product">',
        optimized: '// 优化的图片\n<img\n  src="/product.avif"\n  srcset="/product-400.avif 400w, /product-800.avif 800w"\n  sizes="(max-width: 600px) 400px, 800px"\n  loading="lazy"\n  decoding="async"\n  width="800"\n  height="600"\n  alt="Product"\n>',
        explanation: '使用现代格式、响应式图片、懒加载',
        language: 'html',
        issueType: 'frontend_optimization'
      },
      {
        original: '// 无错误处理的文件操作\nconst data = fs.readFileSync("config.json");\nconst config = JSON.parse(data);',
        optimized: '// 添加错误处理\nlet config;\ntry {\n  const data = fs.readFileSync("config.json", "utf8");\n  config = JSON.parse(data);\n} catch (error) {\n  if (error.code === "ENOENT") {\n    config = getDefaultConfig();\n  } else if (error instanceof SyntaxError) {\n    throw new Error("Invalid config.json format");\n  } else {\n    throw error;\n  }\n}',
        explanation: '处理文件不存在、JSON格式错误等异常',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// React中滥用Context\nconst UserContext = React.createContext(null);\n\nfunction App() {\n  const [user, setUser] = useState(null);\n  const [preferences, setPreferences] = useState({});\n  const [notifications, setNotifications] = useState([]);\n  // ... more state\n  \n  return (\n    <UserContext.Provider value={{ user, setUser, preferences, setPreferences, notifications, setNotifications }}>\n      <AppContent />\n    </UserContext.Provider>\n  );\n}',
        optimized: '// 拆分为多个Context或使用useReducer\nconst UserContext = React.createContext();\nconst PreferencesContext = React.createContext();\n\nfunction AppProvider({ children }) {\n  const [user, setUser] = useState(null);\n  const [preferences, setPreferences] = useState({});\n  \n  return (\n    <UserContext.Provider value={{ user, setUser }}>\n      <PreferencesContext.Provider value={{ preferences, setPreferences }}>\n        {children}\n      </PreferencesContext.Provider>\n    </UserContext.Provider>\n  );\n}',
        explanation: '拆分Context避免不必要的重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 后端未使用数据库事务\nconst user = await User.create(userData);\nconst wallet = await Wallet.create({ userId: user.id, balance: 0 });\nconst analytics = await Analytics.create({ event: "user_created", userId: user.id });',
        optimized: '// 使用事务保证一致性\nconst result = await db.transaction(async (trx) => {\n  const user = await User.create(userData, { transaction: trx });\n  const wallet = await Wallet.create(\n    { userId: user.id, balance: 0 },\n    { transaction: trx }\n  );\n  return user;\n});',
        explanation: '使用数据库事务保证数据一致性',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: '// Python中不必要的list创建\nresult = list(filter(lambda x: x > 0, data))\nresult.sort()\nresult = result[:10]',
        optimized: '// 使用生成器和内置函数\nimport heapq\nresult = heapq.nsmallest(10, (x for x in data if x > 0))\n# 或更简单的方式\nresult = sorted((x for x in data if x > 0))[:10]',
        explanation: '使用生成器和内置函数优化Python代码',
        language: 'python',
        issueType: 'code_simplification'
      },
      
      // ===== 更多优化案例 =====
      {
        original: '// 未缓存的昂贵计算\nfunction getExpensiveData() {\n  let result = null;\n  for (let i = 0; i < 1000000; i++) {\n    result = complexCalculation();\n  }\n  return result;\n}\n\n// 每次调用都重新计算\nconst data1 = getExpensiveData();\nconst data2 = getExpensiveData();',
        optimized: '// 使用缓存(Memoization)\nconst cache = new Map();\nfunction getExpensiveData() {\n  if (cache.has(\'result\')) {\n    return cache.get(\'result\');\n  }\n  let result = null;\n  for (let i = 0; i < 1000000; i++) {\n    result = complexCalculation();\n  }\n  cache.set(\'result\', result);\n  return result;\n}',
        explanation: '使用缓存避免重复计算',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 同步阻塞的读取\nconst data = fs.readFileSync(filePath);\nprocessData(data);\nconst config = fs.readFileSync(configPath);\nprocessConfig(config);',
        optimized: '// 并行异步读取\nconst [data, config] = await Promise.all([\n  fs.promises.readFile(filePath),\n  fs.promises.readFile(configPath)\n]);\nprocessData(data);\nprocessConfig(config);',
        explanation: '使用Promise.all并行执行IO操作',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 过度使用useEffect同步state\nconst [count, setCount] = useState(0);\nconst [doubled, setDoubled] = useState(0);\n\nuseEffect(() => {\n  setDoubled(count * 2);\n}, [count]);',
        optimized: '// 直接计算派生值\nconst [count, setCount] = useState(0);\nconst doubled = count * 2; // 直接计算，无需useEffect',
        explanation: '避免使用useEffect同步派生状态',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 无类型检查的API响应\nfunction getUser(response) {\n  return JSON.parse(response.body);\n}\n\nconst user = getUser(apiResponse);\nconsole.log(user.name); // 可能不存在',
        optimized: '// 添加类型验证\nfunction getUser(response) {\n  const data = JSON.parse(response.body);\n  if (!data || typeof data.name !== \'string\') {\n    throw new Error(\'Invalid user response\');\n  }\n  return data;\n}\n\nconst user = getUser(apiResponse);\nconsole.log(user.name);',
        explanation: '验证API响应的数据类型',
        language: 'javascript',
        issueType: 'type_safety'
      },
      {
        original: '// 硬编码重试次数和延迟\nlet retries = 0;\nwhile (retries < 3) {\n  try {\n    return await fetch(url);\n  } catch (e) {\n    retries++;\n    await new Promise(r => setTimeout(r, 1000));\n  }\n}',
        optimized: '// 指数退避重试\nasync function fetchWithRetry(url, options = {}) {\n  const {\n    maxRetries = 3,\n    baseDelay = 1000,\n    maxDelay = 30000,\n    shouldRetry = (err) => err.status >= 500\n  } = options;\n  \n  for (let attempt = 0; attempt <= maxRetries; attempt++) {\n    try {\n      return await fetch(url);\n    } catch (error) {\n      if (attempt >= maxRetries || !shouldRetry(error)) {\n        throw error;\n      }\n      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);\n      await sleep(delay + Math.random() * 1000);\n    }\n  }\n}',
        explanation: '实现指数退避的重试机制',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: '// Python: 逐行读取大文件\nlines = []\nwith open(\'large_file.txt\', \'r\') as f:\n    for line in f:\n        lines.append(line.strip())\n# 全部加载到内存',
        optimized: '// Python: 生成器按需读取\ndef read_large_file(file_path):\n    with open(file_path, \'r\') as f:\n        for line in f:\n            yield line.strip()\n\n# 按需迭代\nfor line in read_large_file(\'large_file.txt\'):\n    process(line)',
        explanation: '使用生成器处理大文件避免内存溢出',
        language: 'python',
        issueType: 'memory_optimization'
      },
      {
        original: '// MySQL: SELECT * 全表扫描\nSELECT * FROM orders WHERE status = \'pending\';',
        optimized: '// MySQL: 使用索引\nALTER TABLE orders ADD INDEX idx_status (status);\nSELECT id, user_id, total, created_at\nFROM orders WHERE status = \'pending\'\nLIMIT 100;',
        explanation: '创建索引并只查询需要的列',
        language: 'sql',
        issueType: 'database_optimization'
      },
      {
        original: '// 未处理的数据库连接关闭\nconst connection = await pool.getConnection();\nconst result = await connection.query(\'SELECT * FROM users\');\n// 忘记释放连接！',
        optimized: '// 正确释放连接\nconst connection = await pool.getConnection();\ntry {\n  const result = await connection.query(\'SELECT * FROM users\');\n  return result;\n} finally {\n  connection.release();\n}',
        explanation: '使用try-finally确保数据库连接释放',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: '// 不必要的组件重渲染\nfunction UserList({ users, onSelect }) {\n  console.log(\'UserList rendered\');\n  return (\n    <ul>\n      {users.map(user => (\n        <li key={user.id} onClick={() => onSelect(user)}>\n          {user.name}\n        </li>\n      ))}\n    </ul>\n  );\n}',
        optimized: '// 优化避免不必要的重渲染\nconst UserListItem = React.memo(function UserListItem({ user, onSelect }) {\n  console.log(\'UserListItem rendered:\', user.id);\n  return <li onClick={() => onSelect(user)}>{user.name}</li>;\n});\n\nfunction UserList({ users, onSelect }) {\n  return (\n    <ul>\n      {users.map(user => (\n        <UserListItem key={user.id} user={user} onSelect={onSelect} />\n      ))}\n    </ul>\n  );\n}',
        explanation: '使用React.memo避免不必要的列表项重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 循环中使用DOM操作\nconst items = document.querySelectorAll(\'.item\');\nfor (let i = 0; i < items.length; i++) {\n  items[i].style.backgroundColor = \'red\';\n  items[i].style.color = \'white\';\n  items[i].style.padding = \'10px\';\n  items[i].style.borderRadius = \'5px\';\n}',
        optimized: '// 使用classList批量操作\nconst style = document.createElement(\'style\');\nstyle.textContent = \'.item.urgent { background: red; color: white; padding: 10px; border-radius: 5px; }\';\ndocument.head.appendChild(style);\ndocument.querySelectorAll(\'.item\').forEach(el => el.classList.add(\'urgent\'));',
        explanation: '使用CSS类而非逐元素样式操作',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不安全的字符串拼接SQL\nconst query = `SELECT * FROM users WHERE name = \'${username}\'`;',
        optimized: '// 使用参数化查询\nconst query = \'SELECT * FROM users WHERE name = ?\';\nconst result = db.prepare(query).get(username);',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 递归计算斐波那契(指数级)\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)',
        optimized: '// 动态规划O(n)\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a',
        explanation: '使用动态规划优化指数级递归',
        language: 'python',
        issueType: 'algorithm_optimization'
      },
      {
        original: '// 冗余的对象创建\nfunction createUser(data) {\n  const user = new Object();\n  user.name = data.name;\n  user.email = data.email;\n  user.age = data.age;\n  return user;\n}',
        optimized: '// 使用对象字面量和展开\nfunction createUser(data) {\n  return { ...data, createdAt: new Date(), id: generateId() };\n}',
        explanation: '使用对象展开语法简化对象创建',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 大数组频繁splice\nconst arr = [1, 2, 3, 4, 5];\narr.splice(0, 1); // O(n)操作\narr.splice(0, 1); // O(n)操作\n// 头部删除性能差',
        optimized: '// 使用尾部操作或双端队列\nconst arr = [1, 2, 3, 4, 5];\narr.pop(); // O(1)尾部删除\n// 或使用双端队列实现\nclass Deque {\n  constructor() { this.items = {}; this.head = 0; this.tail = 0; }\n  push(item) { this.items[this.tail++] = item; }\n  pop() { return this.items[--this.tail]; }\n  shift() { return this.items[this.head++]; }\n  unshift(item) { this.items[--this.head] = item; }\n}',
        explanation: '避免数组头部操作，使用双端队列',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 无并发控制的批量请求\nconst results = [];\nfor (const id of ids) {\n  const result = await fetchItem(id);\n  results.push(result);\n}\n// 顺序执行慢',
        optimized: '// 使用并发控制\nasync function batchFetch(ids, concurrency = 5) {\n  const results = [];\n  let currentIndex = 0;\n  \n  async function worker() {\n    while (currentIndex < ids.length) {\n      const index = currentIndex++;\n      results[index] = await fetchItem(ids[index]);\n    }\n  }\n  \n  const workers = Array(concurrency).fill(null).map(() => worker());\n  await Promise.all(workers);\n  return results;\n}',
        explanation: '使用并发控制优化批量请求',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// CSS: 不必要的重绘\n.animation {\n  width: 100px;\n  height: 100px;\n  transition: width 0.3s, height 0.3s, transform 0.3s;\n}\n\n.animation:hover {\n  width: 200px;\n  height: 200px;\n  transform: scale(1.5);\n}',
        optimized: '// 使用transform和opacity触发GPU加速\n.animation {\n  width: 100px;\n  height: 100px;\n  transition: transform 0.3s;\n  transform-origin: center;\n  will-change: transform;\n}\n\n.animation:hover {\n  transform: scale(2);\n}',
        explanation: '使用transform而非改变尺寸触发GPU合成',
        language: 'css',
        issueType: 'frontend_optimization'
      },
      {
        original: '// 不必要的useEffect依赖\nfunction Dashboard({ userId }) {\n  const [data, setData] = useState(null);\n  \n  useEffect(() => {\n    fetchData(userId).then(setData);\n  }, [userId]);\n  \n  const handleRefresh = () => {\n    fetchData(userId).then(setData);\n  };\n  \n  return <div>{data?.name} <button onClick={handleRefresh}>刷新</button></div>;\n}',
        optimized: '// 提取数据获取逻辑到自定义Hook\nfunction useUserData(userId) {\n  const [data, setData] = useState(null);\n  const [loading, setLoading] = useState(true);\n  \n  const refetch = useCallback(async () => {\n    setLoading(true);\n    const result = await fetchData(userId);\n    setData(result);\n    setLoading(false);\n  }, [userId]);\n  \n  useEffect(() => { refetch(); }, [refetch]);\n  \n  return { data, loading, refetch };\n}\n\nfunction Dashboard({ userId }) {\n  const { data, loading, refetch } = useUserData(userId);\n  return <div>{data?.name} <button onClick={refetch}>刷新</button></div>;\n}',
        explanation: '提取自定义Hook复用数据获取逻辑',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 重复的try-catch模式\nasync function saveUser(user) {\n  try {\n    await db.users.insert(user);\n    return { success: true };\n  } catch (e) {\n    if (e.code === \'UNIQUE_CONSTRAINT\') {\n      return { success: false, error: \'用户名已存在\' };\n    }\n    throw e;\n  }\n}\n\nasync function saveOrder(order) {\n  try {\n    await db.orders.insert(order);\n    return { success: true };\n  } catch (e) {\n    if (e.code === \'UNIQUE_CONSTRAINT\') {\n      return { success: false, error: \'订单号已存在\' };\n    }\n    throw e;\n  }\n}',
        optimized: '// 提取通用错误处理\nasync function safeInsert(table, data, errorMessage) {\n  try {\n    await table.insert(data);\n    return { success: true };\n  } catch (e) {\n    if (e.code === \'UNIQUE_CONSTRAINT\') {\n      return { success: false, error: errorMessage };\n    }\n    throw e;\n  }\n}\n\nconst saveUser = (user) => safeInsert(db.users, user, \'用户名已存在\');\nconst saveOrder = (order) => safeInsert(db.orders, order, \'订单号已存在\');',
        explanation: '提取通用的数据库错误处理逻辑',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 未使用的CSS变量和重复值\n.button {\n  padding: 10px 20px;\n  margin: 10px 20px;\n  border-radius: 10px;\n  font-size: 14px;\n  line-height: 1.5;\n}\n\n.card {\n  padding: 10px 20px;\n  margin: 5px 10px;\n  border-radius: 10px;\n  font-size: 16px;\n  line-height: 1.5;\n}',
        optimized: '// 使用CSS变量和继承\n:root {\n  --spacing-sm: 5px;\n  --spacing-md: 10px;\n  --spacing-lg: 20px;\n  --radius: 10px;\n  --font-base: 14px;\n  --line-height: 1.5;\n}\n\n.button, .card {\n  padding: var(--spacing-md) var(--spacing-lg);\n  border-radius: var(--radius);\n  line-height: var(--line-height);\n}\n\n.button { margin: var(--spacing-md) var(--spacing-lg); font-size: var(--font-base); }\n.card { margin: var(--spacing-sm) var(--spacing-md); font-size: 16px; }',
        explanation: '使用CSS变量和选择器组合减少重复',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '// 每次更新都重新获取配置\nfunction getConfig() {\n  return {\n    apiUrl: process.env.API_URL,\n    timeout: parseInt(process.env.TIMEOUT) || 5000,\n    retries: parseInt(process.env.RETRIES) || 3\n  };\n}\n\n// 每次调用都重新创建对象\nconst config = getConfig();\nfetch(config.apiUrl, { timeout: config.timeout });',
        optimized: '// 模块级缓存配置\nlet cachedConfig = null;\nfunction getConfig() {\n  if (cachedConfig) return cachedConfig;\n  cachedConfig = Object.freeze({\n    apiUrl: process.env.API_URL,\n    timeout: parseInt(process.env.TIMEOUT, 10) || 5000,\n    retries: parseInt(process.env.RETRIES, 10) || 3\n  });\n  return cachedConfig;\n}',
        explanation: '模块级缓存配置避免重复创建对象',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      
      // ===== 大量新增优化案例 =====
      {
        original: '// 不必要的数组遍历\nconst data = [1, 2, 3, 4, 5];\nconst filtered = data.filter(x => x > 3);\nconst mapped = filtered.map(x => x * 2);\nconst sum = mapped.reduce((a, b) => a + b, 0);',
        optimized: '// 链式单次遍历\nconst result = data.reduce((acc, x) => {\n  if (x > 3) {\n    acc.sum += x * 2;\n    acc.count++;\n  }\n  return acc;\n}, { sum: 0, count: 0 });',
        explanation: '使用reduce单次遍历替代多次遍历',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 无缓存的数据库查询\nfunction getProduct(id) {\n  const db = getDatabase();\n  return db.query(\'SELECT * FROM products WHERE id = ?\', [id]);\n}\n// 每次都查数据库',
        optimized: '// 添加缓存层\nconst productCache = new Map();\nasync function getProduct(id) {\n  if (productCache.has(id)) {\n    return productCache.get(id);\n  }\n  const db = getDatabase();\n  const product = await db.query(\'SELECT * FROM products WHERE id = ?\', [id]);\n  productCache.set(id, product);\n  return product;\n}',
        explanation: '使用缓存减少数据库查询次数',
        language: 'javascript',
        issueType: 'database_optimization'
      },
      {
        original: '// 顺序执行API调用\nconst user = await fetchUser(userId);\nconst orders = await fetchOrders(user.id);\nconst notifications = await fetchNotifications(user.id);',
        optimized: '// 并行执行独立请求\nconst [user, orders, notifications] = await Promise.all([\n  fetchUser(userId),\n  fetchOrders(userId),\n  fetchNotifications(userId)\n]);',
        explanation: '使用Promise.all并行执行独立API调用',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// React中useEffect获取数据\nfunction ProfilePage({ userId }) {\n  const [user, setUser] = useState(null);\n  const [loading, setLoading] = useState(true);\n  \n  useEffect(() => {\n    setLoading(true);\n    fetchUser(userId).then(data => {\n      setUser(data);\n      setLoading(false);\n    });\n  }, [userId]);\n  \n  if (loading) return <Loading />;\n  return <div>{user.name}</div>;\n}',
        optimized: '// 使用SWR或React Query优化\nimport { useQuery } from \'@tanstack/react-query\';\n\nfunction ProfilePage({ userId }) {\n  const { data: user, isLoading } = useQuery({\n    queryKey: [\'user\', userId],\n    queryFn: () => fetchUser(userId),\n    staleTime: 5 * 60 * 1000,\n    cacheTime: 30 * 60 * 1000,\n  });\n  \n  if (isLoading) return <Loading />;\n  return <div>{user.name}</div>;\n}',
        explanation: '使用React Query管理服务端状态',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 未处理的Promise错误\nfetch(url).then(response => response.json()).then(data => console.log(data));',
        optimized: '// 添加完整的错误处理和类型检查\nasync function fetchData(url) {\n  try {\n    const response = await fetch(url);\n    if (!response.ok) {\n      throw new Error(`HTTP ${response.status}`);\n    }\n    const data = await response.json();\n    if (!isValidData(data)) {\n      throw new Error(\'Invalid response data\');\n    }\n    return data;\n  } catch (error) {\n    if (error instanceof TypeError) {\n      console.error(\'Network error:\', error.message);\n    } else {\n      console.error(\'Request failed:\', error.message);\n    }\n    throw error;\n  }\n}',
        explanation: '完整的错误处理和响应验证',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// Python读取大文件\nwith open(\'huge_file.csv\', \'r\') as f:\n    data = f.readlines()\n    for line in data:\n        process(line)',
        optimized: '// 使用生成器逐行读取\nimport csv\n\ndef read_csv_large(filepath):\n    with open(filepath, \'r\') as f:\n        reader = csv.reader(f)\n        header = next(reader)\n        for row in reader:\n            yield dict(zip(header, row))\n\nfor record in read_csv_large(\'huge_file.csv\'):\n    process(record)',
        explanation: '使用生成器处理大文件避免内存溢出',
        language: 'python',
        issueType: 'memory_optimization'
      },
      {
        original: '// MySQL慢查询\nSELECT * FROM orders WHERE user_id = 123 AND status = \'completed\' ORDER BY created_at;',
        optimized: '// 优化SQL\n-- 创建复合索引\nALTER TABLE orders ADD INDEX idx_user_status_created (user_id, status, created_at);\n-- 只查询需要的字段\nSELECT id, total, created_at\nFROM orders \nWHERE user_id = 123 \n  AND status = \'completed\' \nORDER BY created_at DESC\nLIMIT 50;',
        explanation: '添加索引并优化查询字段和排序',
        language: 'sql',
        issueType: 'database_optimization'
      },
      {
        original: '// 不必要的对象深拷贝\nconst deepCopy = JSON.parse(JSON.stringify(data));\nconst result = deepCopy.nested.value;',
        optimized: '// 使用浅拷贝或structuredClone\n// 浅层结构\nconst shallowCopy = { ...data };\n// 深层结构(浏览器原生)\nconst deepCopy = structuredClone(data);\n// 仅拷贝需要的部分\nconst value = data.nested?.value;',
        explanation: '使用合适的拷贝方式避免性能浪费',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 循环中频繁创建临时对象\nconst results = [];\nfor (let i = 0; i < 100000; i++) {\n  const obj = { id: i, value: Math.random() };\n  results.push({ ...obj, doubled: obj.value * 2 });\n}',
        optimized: '// 直接创建最终对象\nconst results = new Array(100000);\nfor (let i = 0; i < 100000; i++) {\n  const value = Math.random();\n  results[i] = { id: i, value, doubled: value * 2 };\n}',
        explanation: '避免循环中创建不必要的临时对象',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// REST API: 硬编码的URL拼接\nconst url = \'https://api.example.com/users/\' + userId + \'/orders?status=\' + status;\nfetch(url);',
        optimized: '// 使用URL构造器\nconst url = new URL(`https://api.example.com/users/${userId}/orders`);\nurl.searchParams.set(\'status\', status);\nfetch(url.toString());',
        explanation: '使用URL构造器安全地构建URL',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 重复的表单验证逻辑\nfunction validateEmail(value) {\n  if (!value || !value.includes(\'@\')) return false;\n  const domain = value.split(\'@\')[1];\n  if (!domain.includes(\'.\')) return false;\n  return true;\n}\n\nfunction validatePhone(value) {\n  if (!value || value.length !== 11) return false;\n  if (!/^\\d+$/.test(value)) return false;\n  return true;\n}',
        optimized: '// 使用验证库\nimport Joi from \'joi\';\n\nconst userSchema = Joi.object({\n  email: Joi.string().email().required(),\n  phone: Joi.string().pattern(/^\\d{11}$/).required(),\n  password: Joi.string().min(8).max(30).strong().required(),\n});\n\nfunction validateUser(data) {\n  const { error, value } = userSchema.validate(data);\n  if (error) {\n    throw new ValidationError(error.message);\n  }\n  return value;\n}',
        explanation: '使用专业的验证库替代手动验证',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 手动状态管理(React)\nfunction TodoApp() {\n  const [todos, setTodos] = useState([]);\n  const [filter, setFilter] = useState(\'all\');\n  const [editingId, setEditingId] = useState(null);\n  \n  const addTodo = (text) => setTodos([...todos, { id: Date.now(), text, done: false }]);\n  const toggleTodo = (id) => setTodos(todos.map(t => t.id === id ? { ...t, done: !t.done } : t));\n  const deleteTodo = (id) => setTodos(todos.filter(t => t.id !== id));\n  const editTodo = (id, text) => setTodos(todos.map(t => t.id === id ? { ...t, text } : t));\n  \n  const filtered = filter === \'all\' ? todos : filter === \'active\' ? todos.filter(t => !t.done) : todos.filter(t => t.done);\n}',
        optimized: '// 使用useReducer或Zustand\nimport { create } from \'zustand\';\n\nconst useTodoStore = create((set) => ({\n  todos: [],\n  filter: \'all\',\n  addTodo: (text) => set((state) => ({ todos: [...state.todos, { id: Date.now(), text, done: false }] })),\n  toggleTodo: (id) => set((state) => ({ todos: state.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) })),\n  deleteTodo: (id) => set((state) => ({ todos: state.todos.filter(t => t.id !== id) })),\n  setFilter: (filter) => set({ filter }),\n  getFilteredTodos: () => {\n    const { todos, filter } = useTodoStore.getState();\n    if (filter === \'active\') return todos.filter(t => !t.done);\n    if (filter === \'completed\') return todos.filter(t => t.done);\n    return todos;\n  }\n}));',
        explanation: '使用状态管理库替代复杂的useState逻辑',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 无分页的大数据列表\n<template>\n  <div>\n    <div v-for="item in items" :key="item.id">\n      {{ item.name }}\n    </div>\n  </div>\n</template>\n\n<script>\nexport default {\n  data() {\n    return {\n      items: []\n    };\n  },\n  async mounted() {\n    this.items = await fetchAllItems(); // 可能上万条\n  }\n};\n</script>',
        optimized: '// 使用虚拟滚动和分页\n<template>\n  <div>\n    <RecycleScroller\n      :items="items"\n      :item-size="50"\n      :key="item => item.id"\n      v-slot="{ item }"\n    >\n      {{ item.name }}\n    </RecycleScroller>\n    <button @click="loadMore">加载更多</button>\n  </div>\n</template>\n\n<script>\nexport default {\n  data() {\n    return {\n      items: [],\n      page: 1,\n      hasMore: true\n    };\n  },\n  async mounted() {\n    await this.loadMore();\n  },\n  methods: {\n    async loadMore() {\n      const newItems = await fetchItems(this.page);\n      this.items.push(...newItems);\n      this.page++;\n      this.hasMore = newItems.length === PAGE_SIZE;\n    }\n  }\n};\n</script>',
        explanation: '使用虚拟滚动和分页优化大数据列表',
        language: 'vue',
        issueType: 'frontend_optimization'
      },
      {
        original: '// 不安全的CORS配置\nconst corsOptions = {\n  origin: \'*\',\n  methods: [\'GET\', \'POST\', \'PUT\', \'DELETE\'],\n  credentials: true\n};',
        optimized: '// 安全的CORS配置\nconst allowedOrigins = [\n  \'https://app.example.com\',\n  \'https://admin.example.com\'\n];\n\nconst corsOptions = {\n  origin: (origin, callback) => {\n    if (!origin || allowedOrigins.includes(origin)) {\n      callback(null, true);\n    } else {\n      callback(new Error(\'Not allowed by CORS\'));\n    }\n  },\n  methods: [\'GET\', \'POST\'],\n  credentials: true,\n  maxAge: 3600,\n  optionsSuccessStatus: 204\n};',
        explanation: '配置安全的CORS策略限制来源',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 过度使用try-catch\nfunction processOrder(order) {\n  let validated;\n  try { validated = validate(order); } catch (e) { throw new Error(\'Validation failed\'); }\n  let saved;\n  try { saved = saveToDb(validated); } catch (e) { throw new Error(\'Save failed\'); }\n  let emailed;\n  try { emailed = sendEmail(saved); } catch (e) { throw new Error(\'Email failed\'); }\n  return emailed;\n}',
        optimized: '// 使用async/await和集中错误处理\nasync function processOrder(order) {\n  const validated = validate(order);\n  const saved = await saveToDb(validated);\n  const emailed = await sendEmail(saved);\n  return emailed;\n}\n\n// 在调用处统一处理\ntry {\n  const result = await processOrder(order);\n  return successResponse(result);\n} catch (error) {\n  logger.error(\'Order processing failed\', error);\n  return errorResponse(error);\n}',
        explanation: '避免在每个步骤都用try-catch，在外层统一处理',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 未使用的索引\nSELECT * FROM users WHERE LOWER(email) = \'USER@EXAMPLE.COM\';',
        optimized: '// 使用索引友好的查询\n-- 存储时已转换为小写\nSELECT * FROM users WHERE email = \'user@example.com\';\n-- 或添加表达式索引\nCREATE INDEX idx_email_lower ON users (LOWER(email));',
        explanation: '避免在WHERE子句中使用函数导致索引失效',
        language: 'sql',
        issueType: 'database_optimization'
      },
      {
        original: '// 无并发控制的大量并发\nconst promises = ids.map(id => fetchData(id));\nconst results = await Promise.all(promises);\n// 如果ids有10000个，会同时发起10000个请求',
        optimized: '// 使用并发控制\nasync function pool(concurrency, iterable, iteratorFn) {\n  const results = [];\n  const executing = new Set();\n  for (const item of iterable) {\n    const p = Promise.resolve().then(() => iteratorFn(item));\n    results.push(p);\n    executing.add(p);\n    const clean = () => executing.delete(p);\n    p.then(clean, clean);\n    if (executing.size >= concurrency) {\n      await Promise.race(executing);\n    }\n  }\n  return Promise.all(results);\n}\n\nconst results = await pool(10, ids, id => fetchData(id));',
        explanation: '实现并发控制防止请求风暴',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 每次渲染都创建新的回调\nfunction ProductList({ products }) {\n  return (\n    <ul>\n      {products.map(product => (\n        <li key={product.id} onClick={() => handleSelect(product.id)}>\n          {product.name}\n        </li>\n      ))}\n    </ul>\n  );\n}',
        optimized: '// 使用useCallback缓存回调\nfunction ProductList({ products }) {\n  const handleSelect = useCallback((id) => {\n    selectProduct(id);\n  }, []);\n  \n  return (\n    <ul>\n      {products.map(product => (\n        <li key={product.id} onClick={() => handleSelect(product.id)}>\n          {product.name}\n        </li>\n      ))}\n    </ul>\n  );\n}',
        explanation: '使用useCallback缓存事件处理函数',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 冗余的if-else判断\nfunction getShippingCost(weight, destination) {\n  if (weight <= 1 && destination === \'domestic\') return 5;\n  if (weight <= 1 && destination === \'international\') return 15;\n  if (weight <= 5 && destination === \'domestic\') return 10;\n  if (weight <= 5 && destination === \'international\') return 25;\n  if (weight <= 10 && destination === \'domestic\') return 20;\n  if (weight <= 10 && destination === \'international\') return 40;\n  return 50;\n}',
        optimized: '// 使用二维查找表\nconst SHIPPING_TABLE = {\n  domestic: { 1: 5, 5: 10, 10: 20 },\n  international: { 1: 15, 5: 25, 10: 40 }\n};\n\nfunction getShippingCost(weight, destination) {\n  const tier = Math.ceil(weight);\n  const rates = SHIPPING_TABLE[destination];\n  if (!rates) return 50;\n  const tierKeys = Object.keys(rates).map(Number).sort((a, b) => a - b);\n  const applicable = tierKeys.find(k => tier <= k);\n  return rates[applicable] ?? 50;\n}',
        explanation: '使用查找表替代复杂的if-else链',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不使用CSS transition的hover\n.card {\n  background: white;\n  transform: scale(1);\n}\n\n.card:hover {\n  background: #f0f0f0;\n  transform: scale(1.05);\n}',
        optimized: '// 添加平滑过渡效果\n.card {\n  background: white;\n  transform: scale(1);\n  transition: background 0.3s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n  will-change: transform;\n}\n\n.card:hover {\n  background: #f0f0f0;\n  transform: scale(1.05);\n}',
        explanation: '添加CSS过渡提升用户体验',
        language: 'css',
        issueType: 'frontend_optimization'
      },
      {
        original: '// 不必要的字符串拼接日志\nconsole.log(\'User \' + userId + \' performed action \' + actionType + \' at \' + new Date());\n// 多个字符串拼接',
        optimized: '// 使用模板字符串或结构化日志\nconsole.log(`User ${userId} performed ${actionType} at ${new Date().toISOString()}`);\n// 或使用结构化日志\nlogger.info(\'user_action\', {\n  userId,\n  actionType,\n  timestamp: new Date().toISOString()\n});',
        explanation: '使用模板字符串或结构化日志',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 无分页的游标查询\nconst users = db.query(\'SELECT * FROM users ORDER BY id LIMIT 10000\');',
        optimized: '// 使用游标分页\nconst PAGE_SIZE = 100;\nlet lastId = 0;\nconst batch = db.query(\n  \'SELECT * FROM users WHERE id > ? ORDER BY id LIMIT ?\',\n  [lastId, PAGE_SIZE]\n);\nlastId = batch[batch.length - 1]?.id || 0;',
        explanation: '使用游标分页避免大量数据一次性加载',
        language: 'javascript',
        issueType: 'database_optimization'
      },
      {
        original: '// 不处理的未定义值\nfunction getDiscount(user) {\n  return user.orders.total * 0.1; // 如果orders未定义会报错\n}',
        optimized: '// 使用可选链和空值合并\nfunction getDiscount(user) {\n  const total = user?.orders?.total ?? 0;\n  return total * 0.1;\n}',
        explanation: '使用可选链和空值合并安全访问嵌套属性',
        language: 'javascript',
        issueType: 'type_safety'
      },
      {
        original: '// 数组去重和计数\nconst items = [\'apple\', \'banana\', \'apple\', \'cherry\', \'banana\', \'apple\'];\nconst counts = {};\nfor (const item of items) {\n  counts[item] = (counts[item] || 0) + 1;\n}\nconst unique = Object.keys(counts);',
        optimized: '// 使用Map和reduce更简洁\nconst counts = items.reduce((map, item) => {\n  map.set(item, (map.get(item) || 0) + 1);\n  return map;\n}, new Map());\n\nconst unique = [...counts.keys()];\n// 或直接使用Set\nconst unique2 = [...new Set(items)];',
        explanation: '使用Map和Set简化数组操作',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的useEffect同步URL\nfunction useQueryState(key, defaultValue) {\n  const [value, setValue] = useState(() => {\n    return new URLSearchParams(window.location.search).get(key) || defaultValue;\n  });\n  \n  useEffect(() => {\n    const url = new URL(window.location.href);\n    url.searchParams.set(key, value);\n    window.history.replaceState({}, \'\', url);\n  }, [key, value]);\n  \n  return [value, setValue];\n}',
        optimized: '// 使用React Router的useSearchParams\nimport { useSearchParams } from \'react-router-dom\';\n\nfunction useQueryState(key, defaultValue) {\n  const [searchParams, setSearchParams] = useSearchParams();\n  const value = searchParams.get(key) || defaultValue;\n  \n  const setValue = (newValue) => {\n    searchParams.set(key, newValue);\n    setSearchParams(searchParams);\n  };\n  \n  return [value, setValue];\n}',
        explanation: '使用React Router的URL搜索参数管理',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 同步写入大量日志\nfor (let i = 0; i < 1000000; i++) {\n  fs.appendFileSync(\'log.txt\', `Log entry ${i}\\n`);\n}',
        optimized: '// 使用异步批量写入\nconst writeStream = fs.createWriteStream(\'log.txt\', { flags: \'a\' });\nfor (let i = 0; i < 1000000; i++) {\n  writeStream.write(`Log entry ${i}\\n`);\n}\nwriteStream.end();\n// 或使用日志库(如pino/winston)',
        explanation: '使用流或日志库高效写入大量日志',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 客户端过滤大量数据\nconst allProducts = fetchAllProducts(); // 10000条\nconst filtered = allProducts.filter(p => p.category === selectedCategory);\nconst sorted = filtered.sort((a, b) => a.price - b.price);',
        optimized: '// 在服务端过滤和排序\nconst filteredProducts = fetchProducts({\n  category: selectedCategory,\n  sort: \'price_asc\',\n  page: 1,\n  pageSize: 20\n});',
        explanation: '将过滤和排序推到服务端处理',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不使用防抖的搜索输入\nfunction SearchInput() {\n  const [query, setQuery] = useState(\'\');\n  \n  const handleChange = (e) => {\n    setQuery(e.target.value);\n    searchAPI(e.target.value); // 每次输入都搜索\n  };\n  \n  return <input onChange={handleChange} />;\n}',
        optimized: '// 使用debounce防抖\nimport { useDebouncedValue } from \'@mantine/hooks\';\n\nfunction SearchInput() {\n  const [query, setQuery] = useState(\'\');\n  const [debouncedQuery] = useDebouncedValue(query, 300);\n  \n  useEffect(() => {\n    if (debouncedQuery) {\n      searchAPI(debouncedQuery);\n    }\n  }, [debouncedQuery]);\n  \n  return <input onChange={(e) => setQuery(e.target.value)} />;\n}',
        explanation: '使用防抖减少API调用频率',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 过度使用useEffect\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  const [doubled, setDoubled] = useState(0);\n  const [halved, setHalved] = useState(0);\n  \n  useEffect(() => { setDoubled(count * 2); }, [count]);\n  useEffect(() => { setHalved(count / 2); }, [count]);\n  \n  return <div>{doubled} {halved}</div>;\n}',
        optimized: '// 直接计算派生值\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  const doubled = count * 2; // 直接计算\n  const halved = Math.floor(count / 2); // 无需额外state\n  \n  return <div>{doubled} {halved}</div>;\n}',
        explanation: '避免使用useEffect和额外state存储派生值',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的Array构造\nconst arr = new Array(1000).fill(0).map((_, i) => i);',
        optimized: '// 使用Array.from更高效\nconst arr = Array.from({ length: 1000 }, (_, i) => i);\n// 或使用展开运算符\nconst arr2 = [...Array(1000).keys()];',
        explanation: '使用Array.from替代fill+map更高效',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 手动深拷贝对象\nfunction deepClone(obj) {\n  if (obj === null || typeof obj !== \'object\') return obj;\n  if (Array.isArray(obj)) return obj.map(item => deepClone(item));\n  const result = {};\n  for (const key in obj) {\n    if (obj.hasOwnProperty(key)) {\n      result[key] = deepClone(obj[key]);\n    }\n  }\n  return result;\n}',
        optimized: '// 使用原生structuredClone(浏览器/Node 17+)\nconst cloned = structuredClone(original);\n// 或使用JSON(仅限可序列化数据)\nconst cloned2 = JSON.parse(JSON.stringify(original));\n// 或使用lodash\nimport { cloneDeep } from \'lodash\';\nconst cloned3 = cloneDeep(original);',
        explanation: '使用原生API或库替代手写深拷贝',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不安全的直接DOM操作\nconst element = document.getElementById(\'content\');\nelement.innerHTML = userInput; // XSS风险',
        optimized: '// 使用安全的DOM API\nconst element = document.getElementById(\'content\');\nelement.textContent = sanitize(userInput);\n// 或使用框架的安全绑定(React自动转义)\n// <div>{userInput}</div>',
        explanation: '使用textContent或框架绑定防止XSS',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 硬编码的时间格式\nconst dateStr = \'2024-01-15T10:30:00Z\';\nconst year = dateStr.substring(0, 4);\nconst month = dateStr.substring(5, 7);\nconst day = dateStr.substring(8, 10);\nconsole.log(year + \'/\' + month + \'/\' + day);',
        optimized: '// 使用Date API和Intl\nconst date = new Date(\'2024-01-15T10:30:00Z\');\nconst formatter = new Intl.DateTimeFormat(\'zh-CN\', {\n  year: \'numeric\',\n  month: \'2-digit\',\n  day: \'2-digit\'\n});\nconsole.log(formatter.format(date)); // 2024/01/15',
        explanation: '使用Intl.DateTimeFormat进行本地化日期格式化',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不可读的复杂逻辑\nconst result = data.filter(x => x.age > 18 && x.status === \'active\' && x.country === \'US\').map(x => ({ name: x.name, score: x.score * 1.1 })).sort((a, b) => b.score - a.score).slice(0, 10);',
        optimized: '// 提取为可读的步骤\nconst adults = data.filter(x => x.age > 18);\nconst activeUsers = adults.filter(x => x.status === \'active\');\nconst usUsers = activeUsers.filter(x => x.country === \'US\');\nconst scored = usUsers.map(x => ({ name: x.name, score: x.score * 1.1 }));\nconst sorted = scored.sort((a, b) => b.score - a.score);\nconst top10 = sorted.slice(0, 10);\n// 或使用有意义的变量名和函数\nconst getTop10UsActiveAdults = (data) => data\n  .filter(isAdult)\n  .filter(isActive)\n  .filter(isUS)\n  .map(addScoreBonus)\n  .sort(byScoreDescending)\n  .slice(0, 10);',
        explanation: '拆分复杂链为可读的步骤或有意义的函数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的中间变量\nfunction calculatePrice(basePrice, discount) {\n  const discounted = basePrice * (1 - discount);\n  const withTax = discounted * 1.1;\n  const withShipping = withTax + 10;\n  return withShipping;\n}',
        optimized: '// 合理命名的中间变量(有助于可读性)\nfunction calculatePrice(basePrice, discount) {\n  const discountedPrice = basePrice * (1 - discount);\n  const priceWithTax = discountedPrice * 1.1;\n  const finalPrice = priceWithTax + 10;\n  return finalPrice;\n}\n// 或使用链式计算\nconst finalPrice = basePrice\n  * (1 - discount)  // 折扣\n  * 1.1            // 税费\n  + 10;            // 运费',
        explanation: '使用有意义的变量名提高可读性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 硬编码的魔法数字\nif (user.age >= 18 && user.age <= 65) {\n  // 工作年龄\n  calculateSalary(user);\n}\nif (order.total > 10000) {\n  // 大客户\n  applyDiscount(order);\n}',
        optimized: '// 使用命名常量\nconst WORKING_AGE_MIN = 18;\nconst WORKING_AGE_MAX = 65;\nconst LARGE_ORDER_THRESHOLD = 10000;\n\nif (user.age >= WORKING_AGE_MIN && user.age <= WORKING_AGE_MAX) {\n  calculateSalary(user);\n}\nif (order.total > LARGE_ORDER_THRESHOLD) {\n  applyDiscount(order);\n}',
        explanation: '使用命名常量替代魔法数字',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的类型断言\nfunction getLength(value) {\n  return value.length; // 如果value不是数组会报错\n}',
        optimized: '// 添加类型检查\nfunction getLength(value) {\n  if (Array.isArray(value) || typeof value === \'string\') {\n    return value.length;\n  }\n  throw new TypeError(`Expected array or string, got ${typeof value}`);\n}\n// 或使用TypeScript类型守卫\nfunction getLength(value: string | any[]): number {\n  return value.length;\n}',
        explanation: '添加类型检查或使用TypeScript确保类型安全',
        language: 'javascript',
        issueType: 'type_safety'
      },
      {
        original: '// 大量重复的try-catch模式\nasync function createUser(data) {\n  try {\n    validateUser(data);\n    const result = await userRepository.save(data);\n    return result;\n  } catch (e) {\n    if (e.name === \'ValidationError\') {\n      return { error: e.message, status: 400 };\n    }\n    if (e.code === \'ER_DUP_ENTRY\') {\n      return { error: \'用户名已存在\', status: 409 };\n    }\n    throw e;\n  }\n}',
        optimized: '// 提取错误处理中间件\nfunction withErrorHandler(handler) {\n  return async (req, res) => {\n    try {\n      const result = await handler(req);\n      res.json(result);\n    } catch (error) {\n      handleError(error, res);\n    }\n  };\n}\n\nconst createUser = withErrorHandler(async (req) => {\n  validateUser(req.body);\n  return userRepository.save(req.body);\n});',
        explanation: '使用错误处理中间件统一异常处理',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 手动管理定时器\nlet timerId;\nfunction startTimer() {\n  timerId = setInterval(() => {\n    updateTime();\n  }, 1000);\n}\nfunction stopTimer() {\n  clearInterval(timerId);\n}\n// 组件卸载时忘记清理',
        optimized: '// React useEffect自动清理\nfunction Timer() {\n  const [time, setTime] = useState(new Date());\n  \n  useEffect(() => {\n    const timer = setInterval(() => {\n      setTime(new Date());\n    }, 1000);\n    return () => clearInterval(timer); // 自动清理\n  }, []);\n  \n  return <div>{time.toLocaleTimeString()}</div>;\n}',
        explanation: '使用React useEffect的清理函数自动管理定时器',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: '// 无缓存的计算属性\nfunction Cart({ items }) {\n  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);\n  const discount = total > 100 ? total * 0.1 : 0;\n  \n  return <div>Total: ${total - discount}</div>;\n}',
        optimized: '// 使用useMemo缓存计算\nfunction Cart({ items }) {\n  const { total, itemCount, discount } = useMemo(() => {\n    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);\n    const discount = total > 100 ? total * 0.1 : 0;\n    return { total, itemCount, discount };\n  }, [items]);\n  \n  return <div>Total: ${total - discount}</div>;\n}',
        explanation: '使用useMemo缓存昂贵的计算',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 冗长的开关语句\nfunction getIcon(type) {\n  switch(type) {\n    case \'success\': return \'<CheckIcon />\';\n    case \'error\': return \'<ErrorIcon />\';\n    case \'warning\': return \'<WarningIcon />\';\n    case \'info\': return \'<InfoIcon />\';\n    default: return null;\n  }\n}',
        optimized: '// 使用对象映射\nconst ICON_MAP = {\n  success: CheckIcon,\n  error: ErrorIcon,\n  warning: WarningIcon,\n  info: InfoIcon\n};\n\nfunction getIcon(type) {\n  const Icon = ICON_MAP[type];\n  return Icon ? <Icon /> : null;\n}',
        explanation: '使用对象映射替代冗长的switch/case',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不处理的异步竞态条件\nfunction SearchPage() {\n  const [results, setResults] = useState([]);\n  const [query, setQuery] = useState(\'\');\n  \n  const handleSearch = async () => {\n    const data = await searchAPI(query);\n    setResults(data); // 如果快速输入，可能显示过期结果\n  };\n  \n  return <input onChange={(e) => { setQuery(e.target.value); handleSearch(); }} />;\n}',
        optimized: '// 使用AbortController或版本号\nfunction SearchPage() {\n  const [results, setResults] = useState([]);\n  const [query, setQuery] = useState(\'\');\n  const versionRef = useRef(0);\n  \n  const handleSearch = async () => {\n    const currentVersion = ++versionRef.current;\n    const data = await searchAPI(query);\n    if (currentVersion === versionRef.current) {\n      setResults(data); // 仅显示最新请求结果\n    }\n  };\n  \n  return <input onChange={(e) => { setQuery(e.target.value); handleSearch(); }} />;\n}',
        explanation: '使用版本号或AbortController处理异步竞态条件',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: '// Python: 不必要的嵌套循环\nfor i in range(len(matrix)):\n    for j in range(len(matrix[i])):\n        if matrix[i][j] > threshold:\n            matrix[i][j] = transform(matrix[i][j])',
        optimized: '// 使用NumPy向量化操作\nimport numpy as np\n\nmatrix = np.array(matrix)\nmask = matrix > threshold\nmatrix[mask] = transform(matrix[mask])\n// 或使用列表推导\nresult = [[transform(v) if v > threshold else v for v in row] for row in matrix]',
        explanation: '使用NumPy向量化操作或列表推导优化Python',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// 未处理的文件上传错误\napp.post(\'/upload\', (req, res) => {\n  const file = req.files.avatar;\n  fs.rename(file.path, \'/uploads/\' + file.name);\n  res.send(\'OK\');\n});',
        optimized: '// 添加完整的错误处理和验证\napp.post(\'/upload\', upload.single(\'avatar\'), (req, res) => {\n  try {\n    if (!req.file) {\n      return res.status(400).json({ error: \'No file uploaded\' });\n    }\n    if (req.file.size > 5 * 1024 * 1024) {\n      return res.status(400).json({ error: \'File too large (max 5MB)\' });\n    }\n    if (!ALLOWED_TYPES.includes(req.file.mimetype)) {\n      return res.status(400).json({ error: \'Invalid file type\' });\n    }\n    const ext = path.extname(req.file.originalname);\n    const fileName = `${Date.now()}${ext}`;\n    fs.rename(req.file.path, path.join(UPLOAD_DIR, fileName), (err) => {\n      if (err) { return res.status(500).json({ error: \'Upload failed\' }); }\n      res.json({ url: `/uploads/${fileName}` });\n    });\n  } catch (error) {\n    res.status(500).json({ error: \'Server error\' });\n  }\n});',
        explanation: '添加完整的文件上传错误处理和验证',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 不必要的重排(reflow)\nconst elements = document.querySelectorAll(\'.item\');\nelements.forEach(el => {\n  el.style.width = el.offsetWidth + 10 + \'px\'; // 读取触发重排\n});',
        optimized: '// 批量读取后批量写入\nconst elements = document.querySelectorAll(\'.item\');\nconst widths = [];\nelements.forEach(el => widths.push(el.offsetWidth)); // 批量读取\n// 批量写入\nelements.forEach((el, i) => { el.style.width = widths[i] + 10 + \'px\'; });',
        explanation: '将读取和写入操作分离以减少重排',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// Python: 逐行处理大文件慢\nwith open(\'log.txt\') as f:\n    lines = f.readlines()\n    for line in lines:\n        if \'ERROR\' in line:\n            process_error(line)',
        optimized: '// 使用迭代器和生成器\nimport re\n\ndef iter_errors(filepath):\n    with open(filepath, \'r\') as f:\n        for line in f:\n            if \'ERROR\' in line:\n                yield line.strip()\n\nfor error_line in iter_errors(\'log.txt\'):\n    process_error(error_line)',
        explanation: '使用生成器避免一次性加载全部内容',
        language: 'python',
        issueType: 'memory_optimization'
      },
      {
        original: '// 不安全的反序列化\nconst user = JSON.parse(requestBody);\ndb.execute(`SELECT * FROM users WHERE name = \'${user.name}\'`);',
        optimized: '// 使用参数化查询和验证\nconst userSchema = Joi.object({ name: Joi.string().max(50).required() });\nconst { error, value } = userSchema.validate(requestBody);\nif (error) return res.status(400).json({ error: error.message });\n\nconst result = await db.query(\'SELECT * FROM users WHERE name = ?\', [value.name]);',
        explanation: '使用参数化查询和输入验证防止注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 不必要的重复查询\nfunction getUserWithPosts(userId) {\n  const user = getUser(userId);\n  const posts = getPosts(userId);\n  const followers = getFollowers(userId);\n  return { user, posts, followers };\n}',
        optimized: '// 使用数据聚合层或批量接口\nasync function getUserWithPosts(userId) {\n  const [user, posts, followers] = await Promise.all([\n    getUser(userId),\n    getPosts(userId),\n    getFollowers(userId)\n  ]);\n  return { user, posts, followers };\n}\n// 或提供专门的聚合API\nconst profile = await api.get(`/users/${userId}/profile`);\n// 后端在一个事务中返回完整数据',
        explanation: '使用Promise.all或聚合接口并行获取关联数据',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      
      // ===== 更多优化案例批量 =====
      {
        original: '// 硬编码API URL\nconst API_URL = \'http://localhost:3000/api\';\nfetch(API_URL + \'/users\');',
        optimized: '// 使用环境变量和配置\nconst config = {\n  apiUrl: process.env.VITE_API_URL || \'http://localhost:3000/api\'\n};\nfetch(`${config.apiUrl}/users`);',
        explanation: '使用环境变量管理API URL',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 嵌套回调地狱\ngetUser(id, function(user) {\n  getOrders(user.id, function(orders) {\n    getPayment(user.id, function(payment) {\n      sendEmail(user, orders, payment, function(result) {\n        console.log(result);\n      });\n    });\n  });\n});',
        optimized: '// 使用async/await\nasync function processUser(id) {\n  try {\n    const user = await getUser(id);\n    const [orders, payment] = await Promise.all([\n      getOrders(user.id),\n      getPayment(user.id)\n    ]);\n    const result = await sendEmail(user, orders, payment);\n    console.log(result);\n  } catch (error) {\n    console.error(error);\n  }\n}',
        explanation: '使用async/await替代回调地狱',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的循环中字符串拼接\nlet result = \'\';\nfor (const item of items) {\n  result += item.name + \', \';\n}\nresult = result.slice(0, -2);',
        optimized: '// 使用join()\nconst result = items.map(i => i.name).join(\', \');\n// 或使用reduce\nconst result2 = items.reduce((acc, item) => acc + item.name + \', \', \'\').slice(0, -2);',
        explanation: '使用join方法高效拼接字符串',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的数组拷贝\nconst copy = original.slice();\nconst sorted = copy.sort((a, b) => a.value - b.value);\noriginal = sorted; // 错误：sorted和copy指向同一个数组',
        optimized: '// 正确的数组拷贝和排序\nconst sorted = [...original].sort((a, b) => a.value - b.value);\n// 或使用sort稳定排序\nconst sorted2 = original.map(x => ({ ...x })).sort((a, b) => a.value - b.value);',
        explanation: '正确地拷贝和排序数组避免副作用',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: '// 不处理空值的链式调用\nconst city = user.address.city.street; // 如果address为null会崩溃',
        optimized: '// 使用可选链\nconst city = user?.address?.city?.street ?? \'Unknown\';\n// 或使用reduce\nconst city = [user, \'address\', \'city\', \'street\'].reduce((obj, key) => obj?.[key], undefined) ?? \'Unknown\';',
        explanation: '使用可选链安全访问深层属性',
        language: 'javascript',
        issueType: 'type_safety'
      },
      {
        original: '// 手动实现防抖\nlet timeout;\nfunction debounce(fn, delay) {\n  clearTimeout(timeout);\n  timeout = setTimeout(fn, delay);\n}',
        optimized: '// 使用lodash或手写更好的防抖\nimport { debounce } from \'lodash\';\n// 或手写更完整的版本\nfunction debounce(fn, wait = 300) {\n  let timeout;\n  const debounced = function(...args) {\n    clearTimeout(timeout);\n    timeout = setTimeout(() => {\n      fn.apply(this, args);\n    }, wait);\n  };\n  debounced.cancel = () => clearTimeout(timeout);\n  return debounced;\n}',
        explanation: '使用成熟的防抖实现或库',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 循环中创建大量闭包\nconst handlers = [];\nfor (let i = 0; i < 100; i++) {\n  handlers.push(() => console.log(i)); // 每次创建新闭包\n}',
        optimized: '// 使用共享函数\nfunction createHandler(i) {\n  return () => console.log(i);\n}\nconst handlers = Array.from({ length: 100 }, (_, i) => createHandler(i));\n// 或在React中使用useCallback',
        explanation: '避免循环中创建不必要的闭包',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的对象拷贝\nconst config = { ...baseConfig, ...userConfig };\n// 如果baseConfig很大，每次调用都拷贝',
        optimized: '// 使用缓存或合并策略\nconst cache = new WeakMap();\nfunction getConfig(userConfig) {\n  if (cache.has(userConfig)) return cache.get(userConfig);\n  const config = { ...baseConfig, ...userConfig };\n  cache.set(userConfig, config);\n  return config;\n}',
        explanation: '使用WeakMap缓存对象合并结果',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 错误的Map使用\nconst map = new Map();\nmap.set(\'key1\', value1);\nmap.set(\'key2\', value2);\n// 忘记处理key不存在的情况',
        optimized: '// 正确的Map使用\nconst map = new Map([\n  [\'key1\', value1],\n  [\'key2\', value2]\n]);\nconst value = map.get(\'key1\') ?? defaultValue;\nif (map.has(\'key3\')) {\n  console.log(map.get(\'key3\'));\n} else {\n  console.log(\'Key not found\');\n}',
        explanation: '正确初始化和使用Map',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的数组遍历查找\nconst found = items.find(item => item.id === targetId);\nconst index = items.findIndex(item => item.id === targetId);\nconst filtered = items.filter(item => item.category === targetCategory);\n// 三次遍历',
        optimized: '// 使用Map或单次遍历\nconst itemMap = new Map(items.map(item => [item.id, item]));\nconst found = itemMap.get(targetId);\nconst index = items.findIndex(item => item.id === targetId);\n// 或单次遍历同时完成多个操作\nconst { foundItem, filteredItems } = items.reduce((acc, item) => {\n  if (item.id === targetId) acc.foundItem = item;\n  if (item.category === targetCategory) acc.filteredItems.push(item);\n  return acc;\n}, { foundItem: null, filteredItems: [] });',
        explanation: '使用Map或单次遍历替代多次遍历',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不安全的eval使用\nconst result = eval(userInput); // 极不安全',
        optimized: '// 避免eval，使用安全替代\nconst result = JSON.parse(userInput); // 如果是JSON\n// 或使用Function构造器(仍然不安全)\nconst fn = new Function(\'return \' + sanitize(userInput));\nconst result = fn();\n// 最好使用白名单解析\nconst result = parseWithWhitelist(userInput, [\'addition\', \'subtraction\']);',
        explanation: '避免使用eval，使用安全的替代方案',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 重复的条件表达式\nif (status === \'active\' || status === \'pending\' || status === \'processing\') {\n  // 处理中状态\n}',
        optimized: '// 使用includes或Set\nconst IN_PROGRESS_STATUSES = [\'active\', \'pending\', \'processing\'];\nif (IN_PROGRESS_STATUSES.includes(status)) {\n  // 处理中状态\n}\n// 或使用Set O(1)查找\nconst statusSet = new Set(IN_PROGRESS_STATUSES);\nif (statusSet.has(status)) { ... }',
        explanation: '使用数组includes或Set替代多个条件判断',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的await在非Promise上\nconst value = await someValue; // 如果someValue不是Promise会有警告',
        optimized: '// 仅对Promise使用await\nconst value = someValue; // 直接使用\nconst asyncResult = await asyncOperation(); // 仅对异步操作使用await',
        explanation: '仅对Promise使用await避免不必要的开销',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// Python: 不必要的字典键检查\nif key in my_dict:\n    value = my_dict[key]\nelse:\n    value = default',
        optimized: '// 使用get方法更简洁\nvalue = my_dict.get(key, default)\n// 或使用setdefault\nvalue = my_dict.setdefault(key, default)',
        explanation: '使用字典get方法替代手动键检查',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 循环中的列表append\nresult = []\nfor i in range(10000):\n    result.append(i * i)',
        optimized: '// 使用列表推导\nresult = [i * i for i in range(10000)]\n// 或使用生成器(如果不需要全部数据)\nresult_generator = (i * i for i in range(10000))',
        explanation: '使用列表推导替代循环append',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 多次遍历数据\ndata = [1, 2, 3, 4, 5]\neven = [x for x in data if x % 2 == 0]\nsquares = [x**2 for x in data]\nfiltered = [x for x in data if x > 3]',
        optimized: '// 使用单次遍历\nresult = { \'even\': [], \'squares\': [], \'filtered\': [] }\nfor x in data:\n    if x % 2 == 0: result[\'even\'].append(x)\n    result[\'squares\'].append(x**2)\n    if x > 3: result[\'filtered\'].append(x)',
        explanation: '使用单次遍历替代多次列表推导',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// TypeScript: 类型断言过多\nconst data = response as any as User;\nconsole.log(data.name as string);',
        optimized: '// 使用正确的类型定义\ninterface ApiResponse<T> {\n  data: T;\n  status: number;\n}\n\nfunction fetchUser(id: string): Promise<ApiResponse<User>> {\n  return fetch(`/api/users/${id}`).then(r => r.json());\n}\n// 自动类型推断\nconst { data } = await fetchUser(\'123\');\nconsole.log(data.name);',
        explanation: '使用正确的TypeScript类型定义避免类型断言',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// 不必要的重新实现Object方法\nconst obj = { a: 1, b: 2 };\nconst keys = [];\nfor (const key in obj) {\n  keys.push(key);\n}',
        optimized: '// 使用Object.keys/values/entries\nconst keys = Object.keys(obj);\nconst values = Object.values(obj);\nconst entries = Object.entries(obj);\nfor (const [key, value] of Object.entries(obj)) {\n  console.log(key, value);\n}',
        explanation: '使用Object内置方法简化操作',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的中间数组\nconst uniqueSorted = [...new Set(items)].sort();\n// 如果items很大，创建了两个临时结构',
        optimized: '// 使用更高效的方法\n// 对于小数据使用Set+sort\nconst unique = [...new Set(items)];\nunique.sort();\n// 对于大数据可以考虑排序后去重\nconst sorted = [...items].sort();\nconst uniqueSorted = sorted.filter((item, i) => i === 0 || item !== sorted[i-1]);',
        explanation: '根据数据规模选择合适的去重排序方案',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的字符串重复拼接\nconst apiEndpoint = \'/api/v1/users\';\nconst url1 = \'https://example.com\' + apiEndpoint;\nconst url2 = \'https://example.com\' + apiEndpoint + \'/\' + id;\nconst url3 = \'https://example.com\' + apiEndpoint + \'/search?\' + params;',
        optimized: '// 使用URL构造器或模板\nconst BASE_URL = \'https://example.com\';\nconst API_BASE = `${BASE_URL}/api/v1`;\n\nconst url1 = `${API_BASE}/users`;\nconst url2 = `${API_BASE}/users/${id}`;\nconst url3 = new URL(\`${API_BASE}/users/search\`);\nurl3.search = new URLSearchParams(params).toString();',
        explanation: '使用常量和URL构造器管理URL',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的组件重新挂载\n{isLoading && <Loading />}\n{!isLoading && <Content data={data} />}\n// 每次isLoading变化都重新创建Content',
        optimized: '// 使用条件渲染避免重新挂载\n{isLoading ? <Loading /> : <Content data={data} />}\n// 或使用key控制生命周期\n<Content key={userId} data={data} /> // 仅在userId变化时重新挂载',
        explanation: '使用正确的条件渲染避免不必要的组件重新挂载',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不安全的JWT存储(localStorage)\nlocalStorage.setItem(\'token\', jwt);\nconst token = localStorage.getItem(\'token\');',
        optimized: '// 使用HttpOnly Cookie存储JWT\n// 后端设置Cookie: Set-Cookie: token=xxx; HttpOnly; Secure; SameSite=Strict\n// 前端自动携带Cookie\nfetch(\'/api/protected\', { credentials: \'include\' });\n// 或使用内存存储(更安全但刷新丢失)\nlet token = null;\nfunction setToken(newToken) { token = newToken; }\nfunction getToken() { return token; }',
        explanation: '使用HttpOnly Cookie或内存存储JWT',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 硬编码的错误消息\nif (error.code === \'TIMEOUT\') {\n  alert(\'请求超时，请重试\');\n}\nif (error.code === \'NETWORK\') {\n  alert(\'网络错误，请检查连接\');\n}',
        optimized: '// 使用国际化的错误消息\nconst ERROR_MESSAGES = {\n  TIMEOUT: i18n.t(\'error.timeout\'),\n  NETWORK: i18n.t(\'error.network\'),\n  UNAUTHORIZED: i18n.t(\'error.unauthorized\')\n};\n\nconst message = ERROR_MESSAGES[error.code] || i18n.t(\'error.unknown\');\nshowError(message);',
        explanation: '使用国际化的错误消息和映射',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的重复计算\nfunction calculateTotal(items) {\n  const taxRate = getTaxRate(); // 每次调用都查询\n  const total = items.reduce((sum, item) => sum + item.price, 0);\n  return total * (1 + taxRate);\n}',
        optimized: '// 缓存税率查询\nconst taxRateCache = new Map();\nfunction getTaxRate(country) {\n  if (taxRateCache.has(country)) {\n    return taxRateCache.get(country);\n  }\n  const rate = fetchTaxRateFromServer(country);\n  taxRateCache.set(country, rate);\n  return rate;\n}\n\nfunction calculateTotal(items, country) {\n  const taxRate = getTaxRate(country);\n  const total = items.reduce((sum, item) => sum + item.price, 0);\n  return total * (1 + taxRate);\n}',
        explanation: '使用缓存避免重复查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的console.log生产代码\nconsole.log(\'Debug info:\', data);\nconsole.trace();\nconsole.log(\'Memory usage:\', performance.memory);',
        optimized: '// 使用日志库\nimport logger from \'./logger\';\n\nlogger.debug(\'Debug info\', { data });\nlogger.info(\'Operation completed\', { duration: elapsed });\n// 使用不同日志级别\n// debug: 开发调试\n// info: 重要信息\n// warn: 警告\n// error: 错误',
        explanation: '使用专业日志库替代console.log',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '// 不安全的文件路径拼接\nconst filePath = baseDir + \'/\' + fileName;\n// 如果fileName包含..可能导致路径遍历',
        optimized: '// 使用path.join和验证\nimport path from \'path\';\nimport fs from \'fs\';\n\nfunction safePath(baseDir, fileName) {\n  const fullPath = path.resolve(baseDir, fileName);\n  const normalizedBase = path.resolve(baseDir);\n  if (!fullPath.startsWith(normalizedBase)) {\n    throw new Error(\'Invalid file path\');\n  }\n  return fullPath;\n}\n\nconst filePath = safePath(baseDir, fileName);',
        explanation: '使用path.join和验证防止路径遍历攻击',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 不必要的JSON序列化\nconst json = JSON.stringify(data);\nconst parsed = JSON.parse(json);\n// 如果data已经是对象，没必要序列化再解析',
        optimized: '// 直接使用对象\nconst result = { ...data }; // 如果需要拷贝\n// 仅在需要网络传输或存储时序列化\nconst jsonString = JSON.stringify(data);\n// 接收到字符串时才反序列化\nconst received = JSON.parse(receivedString);',
        explanation: '避免不必要的JSON序列化反序列化',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的全局变量\nlet counter = 0;\nfunction increment() { counter++; }\nfunction decrement() { counter--; }\nfunction getCount() { return counter; }',
        optimized: '// 使用闭包封装\nfunction createCounter(initialValue = 0) {\n  let counter = initialValue;\n  return {\n    increment() { return ++counter; },\n    decrement() { return --counter; },\n    get value() { return counter; }\n  };\n}\n\nconst counter = createCounter(10);\ncounter.increment();\nconsole.log(counter.value); // 11',
        explanation: '使用闭包封装替代全局变量',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '// 硬编码的重试逻辑\nlet retries = 0;\nconst maxRetries = 5;\nconst delay = 1000;\n\nasync function fetchWithRetry(url) {\n  while (retries < maxRetries) {\n    try {\n      return await fetch(url);\n    } catch (e) {\n      retries++;\n      await new Promise(r => setTimeout(r, delay));\n    }\n  }\n  throw new Error(\'Max retries exceeded\');\n}',
        optimized: '// 可配置的重试机制\nasync function fetchWithRetry(url, options = {}) {\n  const {\n    maxRetries = 3,\n    baseDelay = 1000,\n    maxDelay = 30000,\n    retryOn = (err) => err.status >= 500,\n    backoff = (attempt) => Math.min(baseDelay * 2 ** attempt, maxDelay)\n  } = options;\n\n  for (let attempt = 0; attempt <= maxRetries; attempt++) {\n    try {\n      return await fetch(url);\n    } catch (error) {\n      if (attempt >= maxRetries || !retryOn(error)) throw error;\n      await new Promise(r => setTimeout(r, backoff(attempt)));\n    }\n  }\n}',
        explanation: '实现可配置的指数退避重试',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: '// 不必要的useEffect清理不完整\nfunction Timer() {\n  const [seconds, setSeconds] = useState(0);\n  const timer = useRef(null);\n\n  useEffect(() => {\n    timer.current = setInterval(() => {\n      setSeconds(s => s + 1);\n    }, 1000);\n    // 缺少清理函数\n  }, []);\n\n  return <div>{seconds}</div>;\n}',
        optimized: '// 正确的useEffect清理\nfunction Timer() {\n  const [seconds, setSeconds] = useState(0);\n\n  useEffect(() => {\n    const timer = setInterval(() => {\n      setSeconds(s => s + 1);\n    }, 1000);\n    return () => clearInterval(timer);\n  }, []);\n\n  return <div>{seconds}</div>;\n}',
        explanation: '在useEffect中正确清理定时器',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: '// 不必要的数组创建\nconst result = [];\nfor (const item of items) {\n  if (item.active) {\n    const transformed = transform(item);\n    result.push(transformed);\n  }\n}',
        optimized: '// 使用filter+map链式操作\nconst result = items\n  .filter(item => item.active)\n  .map(item => transform(item));\n// 或使用reduce单次遍历(大数据量)\nconst result2 = items.reduce((acc, item) => {\n  if (item.active) acc.push(transform(item));\n  return acc;\n}, []);',
        explanation: '使用高阶函数替代手动循环',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的类型检查\nfunction getFullName(firstName, lastName) {\n  if (typeof firstName !== \'string\') {\n    throw new TypeError(\'firstName must be a string\');\n  }\n  if (typeof lastName !== \'string\') {\n    throw new TypeError(\'lastName must be a string\');\n  }\n  return firstName + \' \' + lastName;\n}',
        optimized: '// 使用TypeScript或简洁的验证\nfunction getFullName(firstName: string, lastName: string): string {\n  return `${firstName} ${lastName}`;\n}\n// 或使用运行时验证库\nconst nameSchema = z.object({\n  firstName: z.string().min(1),\n  lastName: z.string().min(1)\n});\n\nfunction getFullName(data) {\n  const { firstName, lastName } = nameSchema.parse(data);\n  return `${firstName} ${lastName}`;\n}',
        explanation: '使用TypeScript或验证库简化类型检查',
        language: 'javascript',
        issueType: 'type_safety'
      },
      {
        original: '// 硬编码的魔法字符串\nif (user.role === \'admin\') {\n  // admin逻辑\n}\nif (user.status === \'active\') {\n  // active逻辑\n}',
        optimized: '// 使用枚举或常量\nconst UserRoles = { ADMIN: \'admin\', USER: \'user\', MODERATOR: \'moderator\' };\nconst UserStatus = { ACTIVE: \'active\', INACTIVE: \'inactive\', SUSPENDED: \'suspended\' };\n\nif (user.role === UserRoles.ADMIN) { ... }\nif (user.status === UserStatus.ACTIVE) { ... }',
        explanation: '使用枚举或常量替代魔法字符串',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的对象属性访问\nconst name = user[\'name\']; // 不必要的括号\nconst age = user["age"];',
        optimized: '// 使用点号访问\nconst name = user.name;\nconst age = user.age;\n// 仅在动态属性名时使用括号\nconst dynamicProp = getPropName();\nconst value = user[dynamicProp];',
        explanation: '使用点号访问简化代码',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的switch/case fallthrough\nfunction getDayName(day) {\n  switch(day) {\n    case 0: return \'Sunday\';\n    case 1: return \'Monday\';\n    case 2: return \'Tuesday\';\n    case 3: return \'Wednesday\';\n    case 4: return \'Thursday\';\n    case 5: return \'Friday\';\n    case 6: return \'Saturday\';\n    default: return \'Invalid day\';\n  }\n}',
        optimized: '// 使用数组或对象映射\nconst DAYS = [\'Sunday\', \'Monday\', \'Tuesday\', \'Wednesday\', \'Thursday\', \'Friday\', \'Saturday\'];\nfunction getDayName(day) {\n  return DAYS[day] ?? \'Invalid day\';\n}\n// 或使用Intl\nconst getDayName = (day, locale = \'en-US\') =>\n  new Intl.DateTimeFormat(locale, { weekday: \'long\' })\n    .format(new Date(2024, 0, day + 1));',
        explanation: '使用数组或Intl替代冗长switch',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的类型转换\nx = 42\ny = float(x)  # 不必要，如果运算会自动转换\nresult = x + y  # y已经是float',
        optimized: '// 仅在需要时转换\nx = 42\nresult = x + 0.0  # Python自动提升类型\n# 或直接使用\nresult = float(x) + 0.0  # 如果需要明确浮点类型',
        explanation: '仅在必要时进行类型转换',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// JavaScript: 不必要的===\'\'检查\nif (value !== null && value !== undefined && value !== \'\') {\n  // 处理有效值\n}',
        optimized: '// 使用空值合并或truthy检查\nif (value != null && value !== \'\') {\n  // value不是null/undefined且不是空字符串\n}\n// 或更简洁的\nif (value ?? \'\' !== \'\') { ... }\n// 或使用Boolean转换\nif (value) { ... } // 注意：0和空字符串会是falsy',
        explanation: '使用简洁的null检查替代多重条件',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的函数包装\nconst wrapped = function() {\n  return originalFunction.apply(this, arguments);\n};',
        optimized: '// 使用箭头函数或直接引用\nconst wrapped = (...args) => originalFunction(...args);\n// 或直接使用\nconst wrapped = originalFunction.bind(thisArg);',
        explanation: '使用箭头函数或bind简化函数包装',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的深拷贝传递给子组件\n<ChildComponent user={{...user}} /> // 每次渲染都创建新对象',
        optimized: '// 使用稳定引用或memoize\nconst userMemoized = useMemo(() => ({ ...user }), [user]);\n<ChildComponent user={userMemoized} />\n// 或直接传递user(如果它是稳定的)\n<ChildComponent user={user} />',
        explanation: '避免在JSX中创建新对象作为props',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      
      // ===== 第三批优化案例 =====
      {
        original: '// 不必要的map遍历创建对象\nconst items = list.map(item => ({ id: item.id, name: item.name }));\n// 每次渲染都创建新数组和新对象',
        optimized: '// 使用useMemo缓存结果\nconst items = useMemo(() => list.map(item => ({ id: item.id, name: item.name })), [list]);\n// 或使用reselect(如果在Redux中)\nconst selectItems = createSelector(\n  [selectList],\n  list => list.map(item => ({ id: item.id, name: item.name }))\n);',
        explanation: '使用useMemo或reselect缓存派生数据',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不安全的innerHTML注入\nconst userHtml = `<div>${userInput}</div>`;\nelement.innerHTML = userHtml; // XSS风险',
        optimized: '// 使用textContent或转义\nconst escaped = escapeHtml(userInput);\nelement.textContent = userInput; // 直接设置文本\n// 或使用框架的自动转义\n// React: <div>{userInput}</div> 自动转义\n// Vue: <div>{{ userInput }}</div> 自动转义',
        explanation: '避免使用innerHTML，使用安全的文本设置',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 不必要的复杂正则\nconst emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;\nif (emailRegex.test(input)) { ... }',
        optimized: '// 使用已验证的库\nimport validator from \'validator\';\nif (validator.isEmail(input)) { ... }\n// 或使用更精确的正则\nconst emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;\n// 添加了+和-支持',
        explanation: '使用成熟的验证库或更精确的正则',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '// 不安全的直接对象引用\nconst user = JSON.parse(localStorage.getItem(\'user\'));\n// user.role可以被篡改',
        optimized: '// 使用签名验证\nconst userData = localStorage.getItem(\'user\');\nconst signature = localStorage.getItem(\'user_sig\');\nif (verifySignature(userData, signature)) {\n  const user = JSON.parse(userData);\n  // user数据可信\n}\n// 或使用HttpOnly Cookie存储敏感信息',
        explanation: '验证本地存储数据的完整性',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 不必要的setInterval未清理\nconst timer = setInterval(() => {\n  fetchData();\n}, 5000);\n// 组件卸载时未清理定时器',
        optimized: '// 使用useEffect清理\nuseEffect(() => {\n  const timer = setInterval(() => {\n    fetchData();\n  }, 5000);\n  return () => clearInterval(timer);\n}, []);\n// 或使用useRef存储定时器\nconst timerRef = useRef(null);\ntimerRef.current = setInterval(fetchData, 5000);\nuseEffect(() => () => clearInterval(timerRef.current), []);',
        explanation: '在组件卸载时清理定时器',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: '// 不必要的props逐层传递\n<App>\n  <Layout user={user} />\n    <Sidebar user={user} />\n      <UserCard user={user} />\n        <Avatar user={user} />\n</App>\n// props drilling',
        optimized: '// 使用Context或状态管理\nconst UserContext = createContext(null);\n\n<UserContext.Provider value={user}>\n  <Layout />\n    <Sidebar />\n      <UserCard />\n        <Avatar />\n</UserContext.Provider>\n\n// 在子组件中直接消费\nfunction Avatar() {\n  const user = useContext(UserContext);\n  return <img src={user.avatar} />;\n}',
        explanation: '使用Context API替代props drilling',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的try/catch包裹\nlet result;\ntry {\n  result = JSON.parse(input);\n} catch (e) {\n  result = null;\n}',
        optimized: '// 使用安全的解析函数\nfunction safeParseJSON(str, fallback = null) {\n  try {\n    return JSON.parse(str);\n  } catch {\n    return fallback;\n  }\n}\nconst result = safeParseJSON(input);\n// 或使用Promise包装\nconst result = await Promise.resolve(JSON.parse(input)).catch(() => null);',
        explanation: '使用安全的JSON解析函数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的类实例化\nmy_list = list()\nmy_dict = dict()\nmy_set = set()\nmy_tuple = tuple()',
        optimized: '// 使用字面量创建\nmy_list = []\nmy_dict = {}\nmy_set = set()\nmy_tuple = ()\n// 更简洁且更快',
        explanation: '使用字面量替代构造函数创建集合',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的循环计数\ncount = 0\nfor item in items:\n    if item.active:\n        count += 1',
        optimized: '// 使用sum和生成器\ncount = sum(1 for item in items if item.active)\n# 或使用len和列表推导\ncount = len([item for item in items if item.active])\n# 或使用filter\ncount = sum(map(lambda x: 1 if x.active else 0, items))',
        explanation: '使用sum和生成器表达式计数',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的字符串格式化\nmsg = \'Hello, \' + name + \'! You have \' + str(count) + \' new messages.\'',
        optimized: '// 使用f-string\nmsg = f\'Hello, {name}! You have {count} new messages.\'\n// 或使用format方法\nmsg = \'Hello, {}! You have {} new messages.\'.format(name, count)\n// 或使用模板字符串(复杂场景)\nfrom string import Template\nmsg = Template(\'Hello, $name! You have $count new messages.\').substitute(name=name, count=count)',
        explanation: '使用f-string替代字符串拼接',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的临时变量\ntemp = data[\"name\"]\ndata[\"name\"] = data[\"age\"]\ndata[\"age\"] = temp',
        optimized: '// 使用元组解包\ndata[\"name\"], data[\"age\"] = data[\"age\"], data[\"name\"]\n// 或使用字典方法\nvalue = data.pop(\"name\")\ndata[\"name\"] = data.pop(\"age\")\ndata[\"age\"] = value',
        explanation: '使用元组解包交换值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的循环查找\nresult = None\nfor item in items:\n    if item.id == target_id:\n        result = item\n        break',
        optimized: '// 使用next或字典\nresult = next((item for item in items if item.id == target_id), None)\n# 或使用字典(O(1)查找)\nitem_dict = {item.id: item for item in items}\nresult = item_dict.get(target_id)',
        explanation: '使用next或字典替代循环查找',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不安全的文件上传\nconst upload = multer({ dest: \'uploads/\' });\napp.post(\'/upload\', upload.single(\'file\'), (req, res) => {\n  res.send(\'File uploaded\');\n});',
        optimized: '// 添加文件类型和大小验证\nconst upload = multer({\n  dest: \'uploads/\',\n  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB\n  fileFilter: (req, file, cb) => {\n    const allowedTypes = [\'image/jpeg\', \'image/png\', \'application/pdf\'];\n    if (allowedTypes.includes(file.mimetype)) {\n      cb(null, true);\n    } else {\n      cb(new Error(\'Invalid file type\'));\n    }\n  }\n});',
        explanation: '添加文件上传的类型和大小限制',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// TypeScript: 不必要的类型断言重复使用\nconst user = response as User;\nconst name = (response as User).name;\nconst age = (response as User).age;',
        optimized: '// 只断言一次\nconst user = response as User;\nconst name = user.name;\nconst age = user.age;\n// 或使用类型守卫\nfunction isUser(obj: any): obj is User {\n  return \'name\' in obj && \'age\' in obj;\n}\nif (isUser(response)) {\n  // 类型自动推断\n}',
        explanation: '避免重复的类型断言',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// TypeScript: 不必要的any类型\nfunction parseData(input: any): any {\n  return JSON.parse(input);\n}',
        optimized: '// 使用泛型和unknown\nfunction parseData<T>(input: string): T {\n  return JSON.parse(input) as T;\n}\n// 或使用安全的unknown类型\nfunction parseData(input: string): unknown {\n  return JSON.parse(input);\n}\nconst data = parseData<User>(input) as User; // 在使用时断言',
        explanation: '使用泛型和unknown替代any',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// 不必要的组件内创建函数\nfunction MyComponent() {\n  const handleClick = () => {\n    doSomething(props.id);\n  };\n  // 每次渲染都创建新函数\n  return <Button onClick={handleClick} />;\n}',
        optimized: '// 使用useCallback缓存函数\nfunction MyComponent({ id }) {\n  const handleClick = useCallback(() => {\n    doSomething(id);\n  }, [id]);\n  return <Button onClick={handleClick} />;\n}\n// 或使用useEvent(React未来提案)\nconst handleClick = useEvent(() => {\n  doSomething(id);\n});',
        explanation: '使用useCallback缓存事件处理函数',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的复杂CSS选择器\n#main-container .wrapper .content .card .header .title {\n  font-size: 24px;\n  color: #333;\n}',
        optimized: '// 使用CSS类或BEM命名\n.card__title {\n  font-size: 24px;\n  color: #333;\n}\n// 或使用CSS变量\n.card {\n  --title-size: 24px;\n  --title-color: #333;\n}\n.card__title {\n  font-size: var(--title-size);\n  color: var(--title-color);\n}',
        explanation: '使用CSS类或BEM命名简化选择器',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '// 不必要的内联样式循环\nconst items = list.map(item => (\n  <div style={{ color: item.active ? \'green\' : \'gray\', fontSize: \'14px\' }}>\n    {item.name}\n  </div>\n));',
        optimized: '// 使用CSS类或CSS-in-JS\n// CSS\n.item { color: gray; font-size: 14px; }\n.item.active { color: green; }\n\n// JSX\nconst items = list.map(item => (\n  <div className={`item ${item.active ? \'active\' : \'\'}`}>\n    {item.name}\n  </div>\n));',
        explanation: '使用CSS类替代内联样式',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的DOM操作循环\nconst elements = document.querySelectorAll(\'.item\');\nelements.forEach(el => {\n  el.style.color = \'red\';\n  el.style.fontSize = \'16px\';\n  el.classList.add(\'highlighted\');\n});',
        optimized: '// 使用CSS类批量修改\n// CSS: .item.highlighted { color: red; font-size: 16px; }\ndocument.querySelectorAll(\'.item\').forEach(el => el.classList.add(\'highlighted\'));\n// 或使用classList API\nelements.forEach(el => {\n  el.classList.add(\'highlighted\');\n  el.classList.remove(\'normal\');\n});',
        explanation: '使用CSS类批量修改样式',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的多次数据库查询\nfunction getUserPosts(userId) {\n  const user = db.getUser(userId);\n  const posts = db.getPosts(userId);\n  const comments = db.getComments(userId);\n  return { user, posts, comments };\n}',
        optimized: '// 使用JOIN查询或批量操作\nfunction getUserPosts(userId) {\n  const result = db.query(`\n    SELECT u.*, p.*, c.*\n    FROM users u\n    LEFT JOIN posts p ON u.id = p.user_id\n    LEFT JOIN comments c ON u.id = c.user_id\n    WHERE u.id = ?\n  `, [userId]);\n  return result;\n}\n// 或使用ORM的预加载\nconst user = await User.findByPk(userId, {\n  include: [Post, Comment]\n});',
        explanation: '使用JOIN或预加载减少数据库查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不安全的SQL拼接\nconst query = `SELECT * FROM users WHERE name = \'${name}\' AND age > ${age}`;\ndb.execute(query);',
        optimized: '// 使用参数化查询\nconst query = \'SELECT * FROM users WHERE name = ? AND age > ?\';\ndb.execute(query, [name, age]);\n// 或使用ORM\nconst users = await User.findAll({\n  where: { name: name, age: { [Op.gt]: age } }\n});',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 不必要的错误处理重复\nfunction processData(data) {\n  let result;\n  try {\n    result = parse(data);\n  } catch (e) {\n    result = defaultResult;\n    console.error(e);\n  }\n  return result;\n}\n\nfunction processOther(data) {\n  let result;\n  try {\n    result = transform(data);\n  } catch (e) {\n    result = defaultResult;\n    console.error(e);\n  }\n  return result;\n}',
        optimized: '// 使用高阶函数封装错误处理\nfunction withFallback(fn, fallback, errorHandler = console.error) {\n  return (...args) => {\n    try {\n      return fn(...args);\n    } catch (error) {\n      errorHandler(error);\n      return fallback;\n    }\n  };\n}\n\nconst processData = withFallback(parse, defaultResult);\nconst processOther = withFallback(transform, defaultResult);',
        explanation: '使用高阶函数封装重复的错误处理',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的可变状态\nlet counter = 0;\nfunction increment() { counter++; return counter; }\nfunction decrement() { counter--; return counter; }',
        optimized: '// 使用不可变状态模式\nfunction createCounter(initial = 0) {\n  const state = { value: initial };\n  return {\n    increment: () => ({ ...state, value: state.value + 1 }),\n    decrement: () => ({ ...state, value: state.value - 1 }),\n    get: () => state.value\n  };\n}\n// 或使用React的useReducer\nconst [state, dispatch] = useReducer(counterReducer, { value: 0 });',
        explanation: '使用不可变状态替代可变全局变量',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '// Vue: 不必要的computed中副作用\ncomputed: {\n  fullName() {\n    this.firstName + this.lastName;\n    this.saveToStorage(); // 副作用！\n    return this.firstName + this.lastName;\n  }\n}',
        optimized: '// 保持computed纯粹，副作用使用watch\ncomputed: {\n  fullName() {\n    return this.firstName + this.lastName;\n  }\n},\nwatch: {\n  fullName(newVal) {\n    this.saveToStorage();\n  }\n}\n// 或使用watchEffect\nwatchEffect(() => {\n  this.saveToStorage(this.fullName);\n});',
        explanation: '保持Vue computed纯粹，副作用使用watch',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '// Vue: 不必要的template中复杂表达式\n{{ items.filter(item => item.active).map(item => item.name).join(\', \') }}',
        optimized: '// 使用计算属性\ncomputed: {\n  activeItemNames() {\n    return this.items\n      .filter(item => item.active)\n      .map(item => item.name)\n      .join(\', \');\n  }\n}\n// 模板中使用\n{{ activeItemNames }}',
        explanation: '使用computed属性简化模板表达式',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// Node.js: 不必要的同步文件读取\nconst data = fs.readFileSync(\'file.txt\', \'utf8\');\nprocessData(data);',
        optimized: '// 使用异步或流式读取\nconst data = await fs.promises.readFile(\'file.txt\', \'utf8\');\nprocessData(data);\n// 或使用流式处理大文件\nconst readStream = fs.createReadStream(\'large_file.txt\', \'utf8\');\nreadStream.pipe(transformStream).pipe(writeStream);',
        explanation: '使用异步或流式I/O替代同步操作',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// Node.js: 不必要的手动事件监听\nconst server = http.createServer((req, res) => {\n  // 处理请求\n});\nserver.listen(3000);\nserver.on(\'request\', customHandler); // 额外的处理',
        optimized: '// 使用中间件模式\nconst express = require(\'express\');\nconst app = express();\n\napp.use(logger);\napp.use(auth);\napp.use(bodyParser.json());\napp.get(\'/api/users\', getUserHandler);\napp.post(\'/api/users\', createUserHandler);\napp.use(errorHandler);\n\napp.listen(3000);',
        explanation: '使用中间件模式组织Node.js应用',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '// 不必要的组件库直接使用\nimport { Button } from \'antd\';\n// 引入整个antd库',
        optimized: '// 使用按需引入或treeshaking\n// antd v4+自动tree-shaking\n// 或使用babel-plugin-import配置\n// babel.config.js\nmodule.exports = {\n  plugins: [\n    [\'import\', { libraryName: \'antd\', style: \'css\' }]\n  ]\n};\n// 或使用eslint-plugin-import帮助发现问题',
        explanation: '使用按需引入减少打包体积',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的CSS重复定义\n.btn-primary {\n  background-color: #007bff;\n  color: white;\n  padding: 10px 20px;\n  border: none;\n  border-radius: 4px;\n}\n.btn-secondary {\n  background-color: #6c757d;\n  color: white;\n  padding: 10px 20px;\n  border: none;\n  border-radius: 4px;\n}',
        optimized: '// 使用CSS变量或继承\n.btn {\n  padding: 10px 20px;\n  border: none;\n  border-radius: 4px;\n  color: white;\n}\n.btn-primary { background-color: #007bff; }\n.btn-secondary { background-color: #6c757d; }\n// 或使用@extend(Sass)\n%btn-base {\n  padding: 10px 20px;\n  border: none;\n  border-radius: 4px;\n  color: white;\n}\n.btn-primary { @extend %btn-base; background-color: #007bff; }',
        explanation: '使用继承或CSS变量减少重复',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '// 不必要的JavaScript动画\nlet position = 0;\nfunction animate() {\n  position += 10;\n  document.getElementById(\'box\').style.left = position + \'px\';\n  if (position < 200) {\n    requestAnimationFrame(animate);\n  }\n}\nanimate();',
        optimized: '// 使用CSS动画\n@keyframes slide {\n  from { left: 0; }\n  to { left: 200px; }\n}\n.box {\n  animation: slide 2s ease-in-out;\n}\n// 或使用Web Animations API\nconst element = document.getElementById(\'box\');\nelement.animate([\n  { left: \'0px\' },\n  { left: \'200px\' }\n], { duration: 2000, easing: \'ease-in-out\' });',
        explanation: '使用CSS动画或Web Animations API',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的频繁DOM操作\nfor (let i = 0; i < 1000; i++) {\n  const div = document.createElement(\'div\');\n  div.textContent = \'Item \' + i;\n  document.getElementById(\'container\').appendChild(div);\n}',
        optimized: '// 使用DocumentFragment或批量更新\nconst fragment = document.createDocumentFragment();\nfor (let i = 0; i < 1000; i++) {\n  const div = document.createElement(\'div\');\n  div.textContent = \'Item \' + i;\n  fragment.appendChild(div);\n}\ndocument.getElementById(\'container\').appendChild(fragment);\n// 或使用innerHTML一次性写入\nconst html = Array.from({ length: 1000 }, (_, i) => `<div>Item ${i}</div>`).join(\'\');\ndocument.getElementById(\'container\').innerHTML = html;',
        explanation: '使用DocumentFragment或批量更新减少重排',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不安全的CORS配置\napp.use(cors({\n  origin: \'*\' // 允许所有源\n}));',
        optimized: '// 配置具体的允许源\nconst allowedOrigins = [\n  \'https://example.com\',\n  \'https://app.example.com\',\n  process.env.DEV_ORIGIN\n];\n\napp.use(cors({\n  origin: (origin, callback) => {\n    if (allowedOrigins.includes(origin) || !origin) {\n      callback(null, true);\n    } else {\n      callback(new Error(\'Not allowed by CORS\'));\n    }\n  },\n  credentials: true\n}));',
        explanation: '配置具体的CORS允许源',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 不必要的React Context重新渲染\nconst ThemeContext = createContext(null);\n\nfunction App() {\n  const [theme, setTheme] = useState(\'light\');\n  return (\n    <ThemeContext.Provider value={theme}>\n      <Layout />\n    </ThemeContext.Provider>\n  );\n}\n// 所有消费者都会在theme变化时重新渲染',
        optimized: '// 使用useMemo优化Context值\nfunction App() {\n  const [theme, setTheme] = useState(\'light\');\n  const value = useMemo(() => ({ theme, setTheme }), [theme]);\n  return (\n    <ThemeContext.Provider value={value}>\n      <Layout />\n    </ThemeContext.Provider>\n  );\n}\n// 或使用Context selector避免不必要的渲染\nconst { theme } = useThemeSelector(state => ({ theme: state.theme }));',
        explanation: '使用useMemo优化Context避免不必要渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的日期操作\nconst date = new Date();\nconst year = date.getFullYear();\nconst month = date.getMonth() + 1;\nconst day = date.getDate();\nconst formatted = `${year}-${month}-${day}`;',
        optimized: '// 使用Intl或日期库\nconst formatted = new Intl.DateTimeFormat(\'en-CA\').format(date); // 2024-01-15\n// 或使用date-fns/dayjs\nimport { format } from \'date-fns\';\nconst formatted2 = format(date, \'yyyy-MM-dd\');\n// 或使用toISOString\nconst formatted3 = date.toISOString().split(\'T\')[0];',
        explanation: '使用日期库或Intl API格式化日期',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的字典访问\nuser = {\"name\": \"John\", \"age\": 30}\ntry:\n  name = user[\"name\"]\nexcept KeyError:\n  name = \"Unknown\"',
        optimized: '// 使用get方法\nname = user.get(\"name\", \"Unknown\")\n# 或使用defaultdict\nfrom collections import defaultdict\nuser = defaultdict(lambda: \"Unknown\", {\"name\": \"John\"})\nname = user[\"name\"]  # John\nnickname = user[\"nickname\"]  # Unknown',
        explanation: '使用get或defaultdict安全访问字典',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的循环列表构造\nsquares = []\nfor x in range(10):\n    squares.append(x * x)\n\nevens = []\nfor x in range(10):\n    if x % 2 == 0:\n        evens.append(x)',
        optimized: '// 使用列表推导\nsquares = [x * x for x in range(10)]\nevens = [x for x in range(10) if x % 2 == 0]\n# 或使用生成器(大数据)\nsquares_gen = (x * x for x in range(1000000))\n# 或使用map/filter\nsquares = list(map(lambda x: x * x, range(10)))\nevens = list(filter(lambda x: x % 2 == 0, range(10)))',
        explanation: '使用列表推导简化循环',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// JavaScript: 不必要的sort排序\nconst numbers = [3, 1, 4, 1, 5, 9, 2, 6];\nnumbers.sort(); // 按字符串排序！\n// 结果: [1, 1, 2, 3, 4, 5, 6, 9] 错误顺序',
        optimized: '// 正确的数字排序\nnumbers.sort((a, b) => a - b);\n// 或使用Intl.Collator\nconst collator = new Intl.Collator(undefined, { numeric: true });\nnumbers.sort(collator.compare);\n// 或使用类型安全的排序\nnumbers.sort((a, b) => Number(a) - Number(b));',
        explanation: '使用正确的比较函数排序数字',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: '// 不必要的大量import\nimport React from \'react\';\nimport { useState, useEffect, useRef, useCallback, useMemo } from \'react\';\nimport { Button, Input, Modal, Table, Form } from \'antd\';\nimport { debounce, throttle } from \'lodash\';',
        optimized: '// 使用按需引入或重新导出\n// index.js\nexport { useState, useEffect, useRef, useCallback, useMemo } from \'react\';\nexport { Button, Input, Modal } from \'antd\';\nexport { debounce } from \'lodash\';\n\n// 使用时\nimport { useState, Button, debounce } from \'./index\';\n// 或使用路径别名\nimport { debounce } from \'@utils/throttle\';',
        explanation: '使用重新导出或路径别名优化import',
        language: 'javascript',
        issueType: 'code_organization'
      },
      {
        original: '// 不必要的组件重复渲染\nfunction Dashboard({ data }) {\n  const sortedData = data.sort((a, b) => a.value - b.value);\n  // 每次渲染都创建新数组和排序\n  return <Chart data={sortedData} />;\n}',
        optimized: '// 使用useMemo缓存计算\nfunction Dashboard({ data }) {\n  const sortedData = useMemo(() => {\n    return [...data].sort((a, b) => a.value - b.value);\n  }, [data]);\n  return <Chart data={sortedData} />;\n}\n// 注意: sort会修改原数组，需要先拷贝',
        explanation: '使用useMemo缓存排序和计算结果',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的深拷贝\nconst cloned = JSON.parse(JSON.stringify(obj));\n// 不支持函数、undefined、NaN、Infinity、RegExp、Date等',
        optimized: '// 使用structuredClone或lodash\nconst cloned = structuredClone(obj); // 浏览器原生\n// 或使用lodash\nimport _ from \'lodash\';\nconst cloned2 = _.cloneDeep(obj);\n// 或使用递归实现\nfunction deepClone(obj) {\n  if (obj === null || typeof obj !== \'object\') return obj;\n  if (obj instanceof Date) return new Date(obj);\n  if (obj instanceof RegExp) return new RegExp(obj);\n  const cloned = Array.isArray(obj) ? [] : {};\n  for (const key in obj) {\n    cloned[key] = deepClone(obj[key]);\n  }\n  return cloned;\n}',
        explanation: '使用structuredClone或lodash进行深拷贝',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的大量useEffect\nfunction Profile({ userId }) {\n  const [user, setUser] = useState(null);\n  const [posts, setPosts] = useState([]);\n  const [followers, setFollowers] = useState([]);\n\n  useEffect(() => {\n    fetchUser(userId).then(setUser);\n  }, [userId]);\n\n  useEffect(() => {\n    fetchPosts(userId).then(setPosts);\n  }, [userId]);\n\n  useEffect(() => {\n    fetchFollowers(userId).then(setFollowers);\n  }, [userId]);\n}',
        optimized: '// 使用单个useEffect或数据获取库\nfunction Profile({ userId }) {\n  const { data: user } = useQuery([\'user\', userId], () => fetchUser(userId));\n  const { data: posts } = useQuery([\'posts\', userId], () => fetchPosts(userId));\n  const { data: followers } = useQuery([\'followers\', userId], () => fetchFollowers(userId));\n}\n// 使用React Query自动缓存、去重、后台更新\n// 或使用SWR\nexport default function Profile({ userId }) {\n  const { data: user } = useSWR(`/api/user/${userId}`);\n  const { data: posts } = useSWR(`/api/posts/${userId}`);\n}',
        explanation: '使用React Query或SWR优化数据获取',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      
      // ===== 第四批优化案例 =====
      {
        original: '// 不必要的数组解构\nconst first = arr[0];\nconst second = arr[1];\nconst third = arr[2];',
        optimized: '// 使用数组解构\nconst [first, second, third] = arr;\n// 或使用rest操作符\nconst [first, ...rest] = arr;',
        explanation: '使用数组解构简化取值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的对象属性复制\nconst name = user.name;\nconst age = user.age;\nconst email = user.email;',
        optimized: '// 使用对象解构\nconst { name, age, email } = user;\n// 或使用重命名\nconst { name: userName, age: userAge } = user;',
        explanation: '使用对象解构简化取值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的函数参数传递\nfunction createUser(name, age, email, role, status) {\n  // 5个参数，顺序容易搞错\n}',
        optimized: '// 使用对象参数\nfunction createUser({ name, age, email, role, status }) {\n  // 参数清晰，顺序无关\n}\n// 调用时\ncreateUser({ name: \'John\', age: 30, email: \'john@example.com\', role: \'admin\', status: \'active\' });',
        explanation: '使用对象参数避免参数顺序混淆',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的默认参数实现\nfunction greet(name) {\n  if (name === undefined) {\n    name = \'World\';\n  }\n  return \'Hello, \' + name;\n}',
        optimized: '// 使用默认参数值\nfunction greet(name = \'World\') {\n  return `Hello, ${name}`;\n}\n// 或使用解构默认值\nfunction createUser({ name = \'Anonymous\', age = 0 } = {}) {\n  return { name, age };\n}',
        explanation: '使用默认参数值简化代码',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的手动绑定\nconst button = document.getElementById(\'myBtn\');\nbutton.addEventListener(\'click\', function() {\n  this.classList.toggle(\'active\');\n}.bind(button));',
        optimized: '// 使用箭头函数(不绑定this)\nconst button = document.getElementById(\'myBtn\');\nbutton.addEventListener(\'click\', (e) => {\n  button.classList.toggle(\'active\');\n  // 或使用e.target\n  e.target.classList.toggle(\'active\');\n});\n// 或使用事件委托',
        explanation: '使用箭头函数简化事件处理',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的forEach使用\nconst result = [];\narr.forEach(item => {\n  if (item > 0) {\n    result.push(item * 2);\n  }\n});',
        optimized: '// 使用filter和map组合\nconst result = arr.filter(x => x > 0).map(x => x * 2);\n// 或使用reduce单次遍历(大数据)\nconst result2 = arr.reduce((acc, x) => {\n  if (x > 0) acc.push(x * 2);\n  return acc;\n}, []);',
        explanation: '使用高阶函数组合替代forEach',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的数组查找\nlet found = null;\nfor (const item of items) {\n  if (item.id === targetId) {\n    found = item;\n    break;\n  }\n}',
        optimized: '// 使用find方法\nconst found = items.find(item => item.id === targetId);\n// 或使用Map O(1)查找\nconst itemMap = new Map(items.map(i => [i.id, i]));\nconst found2 = itemMap.get(targetId);',
        explanation: '使用find或Map替代循环查找',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的数组包含检查\nlet exists = false;\nfor (const item of items) {\n  if (item === target) {\n    exists = true;\n    break;\n  }\n}',
        optimized: '// 使用includes或Set\nconst exists = items.includes(target);\n// 或使用Set O(1)\nconst itemSet = new Set(items);\nconst exists2 = itemSet.has(target);',
        explanation: '使用includes或Set替代循环检查',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的数组求和\nlet sum = 0;\nfor (const item of items) {\n  sum += item.value;\n}',
        optimized: '// 使用reduce\nconst sum = items.reduce((acc, item) => acc + item.value, 0);\n// 或使用解构加和\nconst total = items.reduce((s, { value }) => s + value, 0);',
        explanation: '使用reduce求和',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的字符串拼接\nconst url = \'/api/users/\' + userId + \'/posts?page=\' + page + \'&limit=\' + limit;',
        optimized: '// 使用模板字符串或URL构造器\nconst url = `/api/users/${userId}/posts?page=${page}&limit=${limit}`;\n// 或使用URL/URLSearchParams\nconst url = new URL(`/api/users/${userId}/posts`, \'https://example.com\');\nurl.searchParams.set(\'page\', page);\nurl.searchParams.set(\'limit\', limit);',
        explanation: '使用模板字符串或URL构造器',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的条件分支\nlet status;\nif (score >= 90) {\n  status = \'A\';\n} else if (score >= 80) {\n  status = \'B\';\n} else if (score >= 70) {\n  status = \'C\';\n} else if (score >= 60) {\n  status = \'D\';\n} else {\n  status = \'F\';\n}',
        optimized: '// 使用三元运算符或映射表\nconst status = score >= 90 ? \'A\' : score >= 80 ? \'B\' : score >= 70 ? \'C\' : score >= 60 ? \'D\' : \'F\';\n// 或使用查找表\nconst gradeThresholds = [[90, \'A\'], [80, \'B\'], [70, \'C\'], [60, \'D\']];\nconst grade = gradeThresholds.find(([threshold]) => score >= threshold)?.[1] ?? \'F\';',
        explanation: '使用三元运算符或映射表简化分支',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的函数包装\nfunction getUser() {\n  const user = fetchUser();\n  return user;\n}',
        optimized: '// 直接引用\nconst getUser = fetchUser;\n// 或使用箭头函数\nconst getUser = () => fetchUser();',
        explanation: '避免不必要的函数包装',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的类型转换\nconst num = parseInt(str, 10);\nconst floatNum = parseFloat(str);\n// 或\nconst num2 = Number(str);',
        optimized: '// 使用parseInt/parseFloat或Number\nconst integer = parseInt(str, 10); // 解析整数\nconst float = parseFloat(str); // 解析浮点数\nconst anyNum = +str; // 最快的转换方式（但不支持NaN检测）\n// 注意: 使用parseInt时总是指定基数10',
        explanation: '使用正确的类型转换方法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的Promise包装\nasync function fetchData() {\n  return new Promise((resolve, reject) => {\n    fetch(url)\n      .then(res => res.json())\n      .then(data => resolve(data))\n      .catch(err => reject(err));\n  });\n}',
        optimized: '// 直接使用fetch(它已经返回Promise)\nasync function fetchData() {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(`HTTP error ${res.status}`);\n  return res.json();\n}\n// 或直接返回fetch\nconst fetchData = (url) => fetch(url).then(res => res.json());',
        explanation: '避免不必要的Promise包装',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的async/await在Promise.all上\nasync function getData() {\n  const users = await fetchUsers();\n  const posts = await fetchPosts();\n  const comments = await fetchComments();\n  return { users, posts, comments };\n}',
        optimized: '// 使用Promise.all并行请求\nasync function getData() {\n  const [users, posts, comments] = await Promise.all([\n    fetchUsers(),\n    fetchPosts(),\n    fetchComments()\n  ]);\n  return { users, posts, comments };\n}\n// 并行请求大大缩短总时间',
        explanation: '使用Promise.all并行获取独立数据',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的catch返回\nasync function fetchUser(id) {\n  try {\n    const user = await fetch(id);\n    return user;\n  } catch (e) {\n    return null; // 静默吞掉错误\n  }\n}',
        optimized: '// 正确的错误处理\nasync function fetchUser(id) {\n  try {\n    const user = await fetch(id);\n    if (!user.ok) throw new Error(`HTTP ${user.status}`);\n    return user.json();\n  } catch (error) {\n    logger.error(`Failed to fetch user ${id}`, error);\n    throw error; // 重新抛出让调用方处理\n  }\n}\n// 或返回带错误的对象\nreturn { data: user, error: null };\n// 错误时\nreturn { data: null, error: e.message };',
        explanation: '正确处理异步错误',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 不必要的null检查重复\nif (user !== null && user !== undefined && user.address !== null && user.address !== undefined) {\n  console.log(user.address.city);\n}',
        optimized: '// 使用可选链和空值合并\nconst city = user?.address?.city ?? \'Unknown\';\n// 或使用短路求值\nconst city = user && user.address && user.address.city;\n// 更安全的方式',
        explanation: '使用可选链简化null检查',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的数组去重\nconst unique = [];\nfor (const item of arr) {\n  if (!unique.includes(item)) {\n    unique.push(item);\n  }\n}',
        optimized: '// 使用Set去重\nconst unique = [...new Set(arr)];\n// 或使用filter和indexOf\nconst unique2 = arr.filter((item, i) => arr.indexOf(item) === i);\n// Set方法O(n)，filter+indexOf O(n²)',
        explanation: '使用Set高效去重',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的对象合并\nconst merged = {};\nfor (const key in obj1) {\n  merged[key] = obj1[key];\n}\nfor (const key in obj2) {\n  merged[key] = obj2[key];\n}',
        optimized: '// 使用展开运算符或Object.assign\nconst merged = { ...obj1, ...obj2 };\n// 或使用Object.assign\nconst merged2 = Object.assign({}, obj1, obj2);\n// 注意: 后者覆盖前者的同名属性',
        explanation: '使用展开运算符合并对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的函数调用次数\nconst result = items.map(item => transform(item));\n// 如果transform很耗时',
        optimized: '// 使用缓存或memoize\nconst memoizedTransform = memoize(transform);\nconst result = items.map(memoizedTransform);\n// 或使用Map缓存结果\nconst cache = new Map();\nconst result = items.map(item => {\n  if (!cache.has(item.id)) {\n    cache.set(item.id, transform(item));\n  }\n  return cache.get(item.id);\n});',
        explanation: '使用memoize或缓存避免重复计算',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的CSS @import\n@import url(\'font-awesome.css\');\n@import url(\'bootstrap.css\');\n// 阻塞渲染，每个@import都是新的HTTP请求',
        optimized: '// 使用link标签或CSS预处理器\n// HTML中使用link\n<link rel=\"stylesheet\" href=\"font-awesome.css\">\n<link rel=\"stylesheet\" href=\"bootstrap.css\">\n// 或使用Sass/Less预处理器\n// main.scss\n@import \'font-awesome\';\n@import \'bootstrap\';\n// 构建时合并为单个文件',
        explanation: '避免CSS @import阻塞渲染',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的JavaScript动画属性改变\nelement.style.left = position + \'px\';\nelement.style.top = (position * 2) + \'px\';\n// 每次改变都触发重排',
        optimized: '// 使用transform和opacity\n// CSS属性如transform和opacity不触发重排\nfunction animate(element, position) {\n  element.style.transform = `translate(${position}px, ${position * 2}px)`;\n}\n// 或使用will-change提示浏览器\n.element {\n  will-change: transform;\n}',
        explanation: '使用transform替代left/top动画',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的React重新渲染\nfunction UserList({ users, onSelect }) {\n  const handleClick = (user) => {\n    onSelect(user);\n  };\n  return (\n    <ul>\n      {users.map(user => (\n        <li key={user.id} onClick={() => handleClick(user)}>\n          {user.name}\n        </li>\n      ))}\n    </ul>\n  );\n}',
        optimized: '// 使用React.memo和useCallback\nconst UserItem = React.memo(({ user, onSelect }) => (\n  <li onClick={() => onSelect(user)}>{user.name}</li>\n));\n\nfunction UserList({ users, onSelect }) {\n  const handleClick = useCallback((user) => onSelect(user), [onSelect]);\n  return (\n    <ul>\n      {users.map(user => (\n        <UserItem key={user.id} user={user} onSelect={handleClick} />\n      ))}\n    </ul>\n  );\n}',
        explanation: '使用React.memo和useCallback优化列表',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的组件状态派生\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  const [doubleCount, setDoubleCount] = useState(0); // 冗余状态\n\n  const increment = () => {\n    setCount(c => c + 1);\n    setDoubleCount(count * 2); // 依赖count，但可能不同步\n  };\n}',
        optimized: '// 使用派生状态\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  const doubleCount = count * 2; // 派生值，不需要useState\n\n  const increment = () => {\n    setCount(c => c + 1);\n  };\n  return <div>{count} * 2 = {doubleCount}</div>;\n}\n// 或使用useReducer',
        explanation: '使用派生状态减少冗余useState',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的重复网络请求\nfunction UserProfile({ userId }) {\n  useEffect(() => {\n    fetchUser(userId).then(setUser);\n  }, [userId]);\n  // 如果父组件重新渲染，可能触发多次请求\n}',
        optimized: '// 使用数据获取库或缓存\n// React Query自动缓存和去重\nfunction UserProfile({ userId }) {\n  const { data: user } = useQuery(\n    [\'user\', userId],\n    () => fetchUser(userId),\n    { staleTime: 60000 } // 60秒内不重复请求\n  );\n}\n// 或使用SWR\nconst { data } = useSWR(`/api/user/${userId}`, fetcher, { revalidateOnFocus: false });',
        explanation: '使用数据获取库缓存和去重请求',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的文件上传后验证\nconst upload = multer({ dest: \'uploads/\' });\napp.post(\'/upload\', upload.single(\'file\'), (req, res) => {\n  // 上传后验证\n  if (req.file.mimetype !== \'image/png\') {\n    fs.unlink(req.file.path); // 删除不安全文件\n    return res.status(400).send(\'Invalid type\');\n  }\n  res.send(\'Upload successful\');\n});',
        optimized: '// 在上传前验证\nconst ALLOWED_TYPES = new Set([\'image/png\', \'image/jpeg\']);\nconst upload = multer({\n  storage: multer.diskStorage({\n    destination: \'uploads/\',\n    filename: (req, file, cb) => {\n      const unique = Date.now() + \'-\' + file.originalname;\n      cb(null, unique);\n    }\n  }),\n  fileFilter: (req, file, cb) => {\n    if (ALLOWED_TYPES.has(file.mimetype)) {\n      cb(null, true);\n    } else {\n      cb(new AppError(\'Not allowed\', 400));\n    }\n  },\n  limits: { fileSize: 5 * 1024 * 1024 }\n});',
        explanation: '在文件上传前验证类型和大小',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '// 不必要的Node.js事件监听器\nconst EventEmitter = require(\'events\');\nconst emitter = new EventEmitter();\n\nconst handler = (data) => {\n  console.log(\'Received:\', data);\n};\n\nemitter.on(\'data\', handler);\n// 忘记在组件销毁时移除\nemitter.removeListener(\'data\', handler);',
        optimized: '// 使用一次性监听或自动清理\n// 一次性监听\nemitter.once(\'data\', handler);\n// 或在useEffect中清理\nuseEffect(() => {\n  emitter.on(\'data\', handler);\n  return () => {\n    emitter.removeListener(\'data\', handler);\n  };\n}, []);\n// 或使用AbortController\nconst controller = new AbortController();\nemitter.addEventListener(\'data\', handler, { signal: controller.signal });\ncontroller.abort(); // 自动清理',
        explanation: '正确清理事件监听器避免内存泄漏',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: '// 不必要的全局错误捕获\nwindow.onerror = function(msg, url, line, col, error) {\n  console.error(msg, url, line, col, error);\n  // 发送到监控系统\n  fetch(\'/api/errors\', {\n    method: \'POST\',\n    body: JSON.stringify({ msg, url, line, col, error })\n  });\n};',
        optimized: '// 使用专业的错误监控\n// Sentry\nimport * as Sentry from \'@sentry/browser\';\nSentry.init({ dsn: \'https://examplePublicKey@o0.ingest.sentry.io/0\' });\nSentry.captureException(error);\n// 或使用window.onerror + unhandledrejection\nwindow.addEventListener(\'unhandledrejection\', (event) => {\n  Sentry.captureException(event.reason);\n});',
        explanation: '使用专业的错误监控系统',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '// 不必要的数据库连接管理\nconst mysql = require(\'mysql2\');\nconst connection = mysql.createConnection({\n  host: \'localhost\',\n  user: \'root\',\n  password: \'password\',\n  database: \'mydb\'\n});\n\nconnection.connect();\nconnection.query(\'SELECT * FROM users\', (err, results) => {\n  console.log(results);\n  connection.end();\n});',
        optimized: '// 使用连接池\nconst mysql = require(\'mysql2/promise\');\nconst pool = mysql.createPool({\n  host: process.env.DB_HOST,\n  user: process.env.DB_USER,\n  password: process.env.DB_PASSWORD,\n  database: process.env.DB_NAME,\n  waitForConnections: true,\n  connectionLimit: 10,\n  queueLimit: 0\n});\n\nasync function query(sql, params) {\n  const [results] = await pool.execute(sql, params);\n  return results;\n}\nconst users = await query(\'SELECT * FROM users WHERE id = ?\', [userId]);',
        explanation: '使用连接池管理数据库连接',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// Python: 不必要的类属性修改\nclass User:\n    def __init__(self, name):\n        self.name = name\n\nuser = User(\'John\')\nuser.age = 30  # 动态添加属性\nuser.email = \'john@example.com\'',
        optimized: '// 使用__slots__限制属性\nclass User:\n    __slots__ = [\'name\', \'age\', \'email\']\n    def __init__(self, name):\n        self.name = name\n\nuser = User(\'John\')\nuser.age = 30\n# user.job = \'Developer\'  # 会抛出AttributeError\n# 或使用dataclass\nfrom dataclasses import dataclass\n@dataclass\nclass User:\n    name: str\n    age: int = 0\n    email: str = \'\'',
        explanation: '使用__slots__或dataclass优化类',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// Python: 不必要的循环引用\nresults = []\nfor batch in batches:\n    results.extend(process_batch(batch))',
        optimized: '// 使用列表推导或itertools\nresults = [item for batch in batches for item in process_batch(batch)]\n# 或使用itertools.chain\nfrom itertools import chain\nresults = list(chain.from_iterable(process_batch(b) for b in batches))\n# 或使用生成器节省内存\ndef process_all(batches):\n    for batch in batches:\n        yield from process_batch(batch)',
        explanation: '使用itertools或列表推导简化循环',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// Python: 不必要的异常捕获\ntry:\n    with open(\'file.txt\', \'r\') as f:\n        content = f.read()\nexcept FileNotFoundError:\n    content = \'\'\nexcept PermissionError:\n    content = \'\'\nexcept Exception:\n    content = \'\'',
        optimized: '// 使用日志和统一处理\nimport logging\nlogger = logging.getLogger(__name__)\n\ntry:\n    with open(\'file.txt\', \'r\') as f:\n        content = f.read()\nexcept (FileNotFoundError, PermissionError) as e:\n    logger.warning(f\'Cannot read file: {e}\')\n    content = \'\'\nexcept Exception as e:\n    logger.error(f\'Unexpected error: {e}\')\n    raise',
        explanation: '使用日志和精确的异常处理',
        language: 'python',
        issueType: 'error_handling'
      },
      {
        original: '// TypeScript: 不必要的类型断言\nfunction getLength(value: string | number): number {\n  if ((value as string).length !== undefined) {\n    return (value as string).length;\n  }\n  return (value as number).toString().length;\n}',
        optimized: '// 使用类型守卫\nfunction getLength(value: string | number): number {\n  if (typeof value === \'string\') {\n    return value.length;\n  }\n  return value.toString().length;\n}\n// 或使用in操作符\ninterface WithLength { length: number; }\nfunction hasLength(value: any): value is WithLength {\n  return typeof value === \'string\' || typeof value === \'object\';\n}',
        explanation: '使用类型守卫替代类型断言',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// TypeScript: 不必要的显式类型声明\nlet name: string = \'John\';\nlet age: number = 30;\nlet isActive: boolean = true;',
        optimized: '// 依赖类型推断\nlet name = \'John\'; // 推断为string\nlet age = 30; // 推断为number\nlet isActive = true; // 推断为boolean\n// 仅在需要时声明类型\nlet value = getValue(); // 类型不确定时\nlet value: User = getUser(); // 需要明确类型时',
        explanation: '依赖TypeScript类型推断',
        language: 'typescript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的React Context值创建\nconst ThemeContext = createContext({ theme: \'light\', toggle: () => {} });\n\nfunction App() {\n  const [theme, setTheme] = useState(\'light\');\n  return (\n    <ThemeContext.Provider value={{ theme, setTheme }}>\n      <Layout />\n    </ThemeContext.Provider>\n  );\n}\n// 每次渲染都创建新对象',
        optimized: '// 使用useMemo稳定Context值\nconst ThemeContext = createContext({ theme: \'light\', toggle: () => {} });\n\nfunction App() {\n  const [theme, setTheme] = useState(\'light\');\n  const value = useMemo(\n    () => ({ theme, setTheme }),\n    [theme]\n  );\n  return (\n    <ThemeContext.Provider value={value}>\n      <Layout />\n    </ThemeContext.Provider>\n  );\n}',
        explanation: '使用useMemo稳定Context值避免重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的React useEffect依赖数组\nfunction SearchResults({ query }) {\n  const [results, setResults] = useState([]);\n\n  useEffect(() => {\n    searchAPI(query).then(setResults);\n  }, []); // 错误：依赖数组缺少query\n}',
        optimized: '// 正确的依赖数组\nfunction SearchResults({ query }) {\n  const [results, setResults] = useState([]);\n\n  useEffect(() => {\n    let cancelled = false;\n    searchAPI(query).then(data => {\n      if (!cancelled) setResults(data);\n    });\n    return () => { cancelled = true; }; // 清理竞态\n  }, [query]); // 正确：添加query依赖\n}',
        explanation: '正确使用useEffect依赖数组和清理',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: '// 不必要的React渲染列表\nfunction TodoList({ todos }) {\n  return (\n    <div>\n      {todos.map(todo => (\n        <div key={todo.id}>\n          <input type=\"checkbox\" checked={todo.done} />\n          <span>{todo.text}</span>\n        </div>\n      ))}\n    </div>\n  );\n}',
        optimized: '// 使用虚拟列表优化大数据量\nimport { FixedSizeList } from \'react-window\';\n\nfunction TodoList({ todos }) {\n  const Row = ({ index, style }) => (\n    <div style={style}>\n      <input type=\"checkbox\" checked={todos[index].done} />\n      <span>{todos[index].text}</span>\n    </div>\n  );\n  return (\n    <FixedSizeList\n      height={400}\n      width={300}\n      itemCount={todos.length}\n      itemSize={35}\n    >\n      {Row}\n    </FixedSizeList>\n  );\n}',
        explanation: '使用虚拟列表优化大数据量渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      
      // ===== 第五批优化案例 =====
      {
        original: '// 不必要的数组filter+map两次遍历\nconst activeUsers = users.filter(u => u.active);\nconst names = activeUsers.map(u => u.name);',
        optimized: '// 使用reduce单次遍历\nconst { activeUsers, names } = users.reduce((acc, user) => {\n  if (user.active) {\n    acc.activeUsers.push(user);\n    acc.names.push(user.name);\n  }\n  return acc;\n}, { activeUsers: [], names: [] });',
        explanation: '使用reduce替代filter+map多次遍历',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的setTimeout递归\nfunction loop() {\n  doSomething();\n  setTimeout(loop, 100); // 每次都分配新的定时器ID\n}\nloop();',
        optimized: '// 使用setInterval或requestAnimationFrame\nconst timer = setInterval(doSomething, 100);\n// 或使用requestAnimationFrame(动画场景)\nfunction animate() {\n  doSomething();\n  requestAnimationFrame(animate);\n}\nrequestAnimationFrame(animate);',
        explanation: '使用setInterval或requestAnimationFrame替代setTimeout递归',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的数组键值查找\nconst key = \'user_\' + id;\nconst value = map[key];\nif (value !== undefined) {\n  console.log(value);\n}',
        optimized: '// 使用Map和has/get\nconst value = map.get(id);\nif (map.has(id)) {\n  console.log(value);\n}\n// Map比普通对象更快的键值查找\n// 注意: Map的键可以是任意类型，对象只能用字符串',
        explanation: '使用Map替代对象进行键值存储',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的字符串数组拼接\nconst items = [\'apple\', \'banana\', \'cherry\'];\nlet result = \'\';\nfor (let i = 0; i < items.length; i++) {\n  result += items[i];\n  if (i < items.length - 1) {\n    result += \', \';\n  }\n}',
        optimized: '// 使用join\nconst result = items.join(\', \');\n// join是原生实现，速度快得多',
        explanation: '使用join方法高效拼接字符串数组',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的函数debounce实现\nlet timeoutId;\nfunction debounce(fn, delay) {\n  return function() {\n    clearTimeout(timeoutId);\n    timeoutId = setTimeout(() => {\n      fn.apply(this, arguments);\n    }, delay);\n  };\n}',
        optimized: '// 使用成熟的debounce实现或lodash\nimport { debounce } from \'lodash\';\nconst debouncedSearch = debounce((query) => {\n  fetchResults(query);\n}, 300);\n// lodash的debounce支持取消、立即执行等选项',
        explanation: '使用lodash的debounce替代手动实现',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的防抖与节流混用\nlet lastTime = 0;\nfunction throttle(fn, limit) {\n  return function() {\n    const now = Date.now();\n    if (now - lastTime >= limit) {\n      lastTime = now;\n      fn.apply(this, arguments);\n    }\n  };\n}',
        optimized: '// 使用lodash的throttle\nimport { throttle } from \'lodash\';\nconst throttledScroll = throttle(() => {\n  updateScrollPosition();\n}, 100);\nwindow.addEventListener(\'scroll\', throttledScroll);\n// throttle保证至少每limit毫秒执行一次',
        explanation: '使用lodash的throttle替代手动实现',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的对象拷贝用于不可变更新\nconst newUser = {\n  ...user,\n  name: \'New Name\',\n  address: {\n    ...user.address,\n    city: \'New City\'\n  }\n};',
        optimized: '// 使用immer或结构化更新\nimport produce from \'immer\';\nconst newUser = produce(user, draft => {\n  draft.name = \'New Name\';\n  draft.address.city = \'New City\';\n});\n// immer自动处理不可变更新，代码更简洁',
        explanation: '使用immer简化嵌套对象的不可变更新',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的状态管理混乱\nfunction App() {\n  const [user, setUser] = useState(null);\n  const [posts, setPosts] = useState([]);\n  const [loading, setLoading] = useState(false);\n  const [error, setError] = useState(null);\n  // 多个独立的useState',
        optimized: '// 使用useReducer或状态管理库\nconst initialState = { user: null, posts: [], loading: false, error: null };\nfunction reducer(state, action) {\n  switch (action.type) {\n    case \'FETCH_START\': return { ...state, loading: true };\n    case \'FETCH_SUCCESS\': return { ...state, loading: false, user: action.payload };\n    case \'FETCH_ERROR\': return { ...state, loading: false, error: action.payload };\n    default: return state;\n  }\n}\nconst [state, dispatch] = useReducer(reducer, initialState);',
        explanation: '使用useReducer或状态管理库管理复杂状态',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '// 不必要的API调用错误处理\nasync function getUser(userId) {\n  try {\n    const response = await fetch(`/api/users/${userId}`);\n    const data = await response.json();\n    return data;\n  } catch (error) {\n    console.error(\'Error:\', error);\n    return null; // 所有错误都返回null\n  }\n}',
        optimized: '// 处理不同类型的错误\nclass APIError extends Error {\n  constructor(message, status, data) {\n    super(message);\n    this.status = status;\n    this.data = data;\n  }\n}\n\nasync function getUser(userId) {\n  const response = await fetch(`/api/users/${userId}`);\n  if (!response.ok) {\n    const errorData = await response.json().catch(() => ({}));\n    throw new APIError(response.statusText, response.status, errorData);\n  }\n  return response.json();\n}\n// 调用方可以区分错误类型\ntry {\n  const user = await getUser(123);\n} catch (e) {\n  if (e.status === 404) showNotFound();\n  else if (e.status === 401) redirectToLogin();\n  else showGenericError();\n}',
        explanation: '定义自定义错误类处理不同错误场景',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 不必要的重复验证逻辑\nfunction isValidEmail(email) {\n  const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  return regex.test(email);\n}\n\nfunction isValidPassword(password) {\n  return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);\n}\n\nfunction isValidUsername(username) {\n  return /^[a-zA-Z0-9_]{3,20}$/.test(username);\n}',
        optimized: '// 使用验证库或声明式验证\nimport validator from \'validator\';\nimport Joi from \'joi\';\n\n// 声明式验证\nconst userSchema = Joi.object({\n  email: Joi.string().email().required(),\n  password: Joi.string().min(8).pattern(/[A-Z]/).pattern(/[0-9]/).required(),\n  username: Joi.string().alphanum().min(3).max(20).required()\n});\n\nfunction validateUser(data) {\n  const { error, value } = userSchema.validate(data);\n  if (error) throw new ValidationError(error.message);\n  return value;\n}',
        explanation: '使用验证库进行声明式数据验证',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的配置硬编码\nconst API_BASE = \'http://localhost:3000\';\nconst TIMEOUT = 5000;\nconst MAX_RETRIES = 3;\nconst DB_HOST = \'localhost\';\nconst DB_USER = \'admin\';\nconst DB_PASS = \'secret123\';',
        optimized: '// 使用环境变量和配置文件\n// .env\nVITE_API_URL=https://api.example.com\nVITE_TIMEOUT=5000\n\n// config.js\nconst config = {\n  apiUrl: import.meta.env.VITE_API_URL || \'http://localhost:3000\',\n  timeout: parseInt(import.meta.env.VITE_TIMEOUT) || 5000,\n  retries: parseInt(import.meta.env.VITE_RETRIES) || 3,\n  db: {\n    host: process.env.DB_HOST,\n    user: process.env.DB_USER,\n    pass: process.env.DB_PASS\n  }\n};\nexport default config;',
        explanation: '使用环境变量管理配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '// 不必要的组件间通信复杂\nfunction Parent() {\n  const [data, setData] = useState({});\n  const handleData = (childData) => setData(childData);\n  return (\n    <ChildA onData={handleData} parentData={data} />\n  );\n}\n\nfunction ChildA({ onData, parentData }) {\n  return <ChildB onData={onData} parentData={parentData} />;\n}\n\nfunction ChildB({ onData, parentData }) {\n  return <ChildC onData={onData} parentData={parentData} />;\n}\n\nfunction ChildC({ onData, parentData }) {\n  // 需要数据但传递了3层\n}',
        optimized: '// 使用Context或状态管理\nconst DataContext = createContext();\n\nfunction Parent() {\n  const [data, setData] = useState({});\n  return (\n    <DataContext.Provider value={{ data, setData }}>\n      <ChildA />\n    </DataContext.Provider>\n  );\n}\n\nfunction ChildC() {\n  const { data, setData } = useContext(DataContext);\n  // 直接使用，无需逐层传递\n}',
        explanation: '使用Context或状态管理避免逐层props传递',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '// Python: 不必要的函数参数可变默认值\ndef append_to(item, lst=[]):\n    lst.append(item)\n    return lst\n\n# 问题：多次调用共享同一个列表\nprint(append_to(1))  # [1]\nprint(append_to(2))  # [1, 2] 而不是 [2]',
        optimized: '// 使用None作为默认值\ndef append_to(item, lst=None):\n    if lst is None:\n        lst = []\n    lst.append(item)\n    return lst\n\nprint(append_to(1))  # [1]\nprint(append_to(2))  # [2] 正确',
        explanation: '使用None作为默认值避免可变默认参数',
        language: 'python',
        issueType: 'bug_fix'
      },
      {
        original: '// Python: 不必要的全局变量修改\ncounter = 0\n\ndef increment():\n    global counter\n    counter += 1\n    return counter',
        optimized: '// 使用类或闭包封装\nclass Counter:\n    def __init__(self, start=0):\n        self._count = start\n    def increment(self):\n        self._count += 1\n        return self._count\n    @property\n    def count(self):\n        return self._count\n\n# 或使用闭包\ndef create_counter(start=0):\n    count = start\n    def increment():\n        nonlocal count\n        count += 1\n        return count\n    return increment',
        explanation: '使用类或闭包封装状态',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: '// Python: 不必要的循环读取大文件\nwith open(\'large_file.txt\', \'r\') as f:\n    data = f.read()  # 一次性读取全部到内存\n    process(data)',
        optimized: '// 使用流式或分块读取\nwith open(\'large_file.txt\', \'r\') as f:\n    for line in f:  # 逐行读取\n        process(line)\n\n# 或使用分块读取\nwith open(\'large_file.txt\', \'rb\') as f:\n    while chunk := f.read(8192):  # 8KB块\n        process(chunk)',
        explanation: '使用流式处理大文件避免内存溢出',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// Python: 不必要的重复数据库连接\nimport psycopg2\n\ndef get_user(user_id):\n    conn = psycopg2.connect(database=\'mydb\', user=\'admin\')\n    cur = conn.cursor()\n    cur.execute(\'SELECT * FROM users WHERE id = %s\', (user_id,))\n    result = cur.fetchone()\n    cur.close()\n    conn.close()\n    return result',
        optimized: '// 使用连接池\nfrom psycopg2.pool import SimpleConnectionPool\n\npool = SimpleConnectionPool(1, 10, database=\'mydb\', user=\'admin\')\n\ndef get_user(user_id):\n    conn = pool.getconn()\n    try:\n        cur = conn.cursor()\n        cur.execute(\'SELECT * FROM users WHERE id = %s\', (user_id,))\n        result = cur.fetchone()\n        return result\n    finally:\n        pool.putconn(conn)',
        explanation: '使用连接池管理数据库连接',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// CSS: 不必要的!important使用\n.button {\n  background-color: blue !important;\n  color: white !important;\n  padding: 10px !important;\n}\n#main .button {\n  background-color: red !important; // 被覆盖\n}',
        optimized: '// 使用更具体的选择器或CSS特异性\n.button {\n  background-color: blue;\n  color: white;\n  padding: 10px;\n}\n\n#main .button {\n  background-color: red; // 更高特异性自动覆盖\n}\n// 或使用CSS变量\n:root {\n  --primary-color: blue;\n}\n.button {\n  background-color: var(--primary-color);\n}\n#main {\n  --primary-color: red;\n}',
        explanation: '避免使用!important，使用CSS特异性',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '// CSS: 不必要的JavaScript动画\nlet scrollTop = 0;\nfunction animate() {\n  scrollTop += 10;\n  document.documentElement.scrollTop = scrollTop;\n  if (scrollTop < target) {\n    requestAnimationFrame(animate);\n  }\n}\nanimate();',
        optimized: '// 使用CSS scroll-behavior或scrollTo\n// CSS\nhtml {\n  scroll-behavior: smooth;\n}\n// JS\nwindow.scrollTo({ top: target, behavior: \'smooth\' });\n// 或使用scrollIntoView\nelement.scrollIntoView({ behavior: \'smooth\', block: \'start\' });',
        explanation: '使用CSS滚动行为替代JavaScript动画',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: '// TypeScript: 不必要的类型断言\nfunction getProperty(obj: any, key: string) {\n  return (obj as any)[key];\n  // 或\n  return obj[key] as any;\n}',
        optimized: '// 使用泛型和索引签名\nfunction getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {\n  return obj[key];\n}\n// 或使用keyof操作符\ninterface User {\n  name: string;\n  age: number;\n}\ntype UserKeys = keyof User; // \'name\' | \'age\'\n\nfunction get(user: User, key: UserKeys) {\n  return user[key]; // 类型安全\n}',
        explanation: '使用泛型和keyof替代any和类型断言',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// TypeScript: 不必要的类型转换\nconst value = someValue as unknown as string;\nconst num = value as unknown as number;',
        optimized: '// 使用类型守卫或正确的类型定义\nfunction isString(value: unknown): value is string {\n  return typeof value === \'string\';\n}\n\nfunction isNumber(value: unknown): value is number {\n  return typeof value === \'number\';\n}\n\nif (isString(someValue)) {\n  const value = someValue; // 自动推断为string\n}\nif (isNumber(someValue)) {\n  const num = someValue; // 自动推断为number\n}',
        explanation: '使用类型守卫替代双重断言',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: '// 不必要的React重新计算\nfunction Dashboard({ data }) {\n  const total = data.reduce((sum, item) => sum + item.value, 0);\n  const average = total / data.length;\n  const max = Math.max(...data.map(i => i.value));\n  const min = Math.min(...data.map(i => i.value));\n  // 每次渲染都重新计算\n}',
        optimized: '// 使用useMemo缓存计算结果\nfunction Dashboard({ data }) {\n  const stats = useMemo(() => {\n    const values = data.map(i => i.value);\n    const total = values.reduce((a, b) => a + b, 0);\n    return {\n      total,\n      average: total / data.length,\n      max: Math.max(...values),\n      min: Math.min(...values)\n    };\n  }, [data]);\n  return <div>Total: {stats.total}</div>;\n}',
        explanation: '使用useMemo缓存昂贵计算',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '// 不必要的React Context值\nconst CountContext = createContext(0);\n\nfunction Provider({ children }) {\n  const [count, setCount] = useState(0);\n  // 传递两个独立的Context\n  return (\n    <CountContext.Provider value={count}>\n      <SetCountContext.Provider value={setCount}>\n        {children}\n      </SetCountContext.Provider>\n    </CountContext.Provider>\n  );\n}',
        optimized: '// 使用单一Context和useReducer\nconst CountContext = createContext();\n\nfunction reducer(state, action) {\n  switch (action.type) {\n    case \'INCREMENT\': return state + 1;\n    case \'DECREMENT\': return state - 1;\n    default: return state;\n  }\n}\n\nfunction Provider({ children }) {\n  const [state, dispatch] = useReducer(reducer, 0);\n  const value = useMemo(() => ({ state, dispatch }), [state]);\n  return (\n    <CountContext.Provider value={value}>\n      {children}\n    </CountContext.Provider>\n  );\n}',
        explanation: '使用useReducer和单一Context管理状态',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '// 不必要的API调用重复\nasync function fetchUsers() {\n  const response = await fetch(\'/api/users\');\n  if (!response.ok) {\n    throw new Error(\'Failed to fetch users\');\n  }\n  return response.json();\n}\n\nasync function fetchPosts() {\n  const response = await fetch(\'/api/posts\');\n  if (!response.ok) {\n    throw new Error(\'Failed to fetch posts\');\n  }\n  return response.json();\n}',
        optimized: '// 使用API客户端封装\nclass APIClient {\n  constructor(baseURL) {\n    this.baseURL = baseURL;\n  }\n\n  async request(endpoint, options = {}) {\n    const response = await fetch(`${this.baseURL}${endpoint}`, {\n      headers: { \'Content-Type\': \'application/json\', ...options.headers },\n      ...options\n    });\n    if (!response.ok) {\n      throw new HTTPError(response.status, response.statusText);\n    }\n    return response.json();\n  }\n\n  get(endpoint) {\n    return this.request(endpoint);\n  }\n\n  post(endpoint, data) {\n    return this.request(endpoint, {\n      method: \'POST\',\n      body: JSON.stringify(data)\n    });\n  }\n}\n\nconst api = new APIClient(\'https://api.example.com\');\nconst users = await api.get(\'/users\');',
        explanation: '使用API客户端封装统一的请求逻辑',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '// 不必要的数据转换\nconst transformed = data.map(item => {\n  return {\n    id: item.id,\n    fullName: item.firstName + \' \' + item.lastName,\n    email: item.email.toLowerCase(),\n    isActive: item.status === \'active\',\n    createdAt: new Date(item.created_at)\n  };\n});',
        optimized: '// 使用transform函数或库\nfunction transformUser(item) {\n  return {\n    id: item.id,\n    fullName: `${item.firstName} ${item.lastName}`,\n    email: item.email.toLowerCase(),\n    isActive: item.status === \'active\',\n    createdAt: new Date(item.created_at)\n  };\n}\n\nconst transformed = data.map(transformUser);\n// 或使用lodash\nimport _ from \'lodash\';\nconst transformed2 = _.map(data, _.flow(transformUser));',
        explanation: '使用提取函数或库简化数据转换',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的异步等待优化\nasync function processUsers(userIds) {\n  const results = [];\n  for (const id of userIds) {\n    const user = await fetchUser(id);\n    results.push(user);\n  }\n  return results;\n}',
        optimized: '// 使用Promise.all并行获取\nasync function processUsers(userIds) {\n  const results = await Promise.all(\n    userIds.map(id => fetchUser(id))\n  );\n  return results;\n}\n// 或使用分批并发控制\nasync function processUsers(userIds, concurrency = 5) {\n  const results = [];\n  for (let i = 0; i < userIds.length; i += concurrency) {\n    const batch = userIds.slice(i, i + concurrency);\n    const batchResults = await Promise.all(\n      batch.map(id => fetchUser(id))\n    );\n    results.push(...batchResults);\n  }\n  return results;\n}',
        explanation: '使用Promise.all或分批并发控制优化异步',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '// 不必要的错误信息不明确\nif (!user) {\n  throw new Error(\'Error\');\n}\nif (!user.name) {\n  throw new Error(\'Error\');\n}\nif (!user.email) {\n  throw new Error(\'Error\');\n}',
        optimized: '// 使用有意义的错误信息和自定义错误\nclass ValidationError extends Error {\n  constructor(field, message) {\n    super(`${field}: ${message}`);\n    this.name = \'ValidationError\';\n    this.field = field;\n  }\n}\n\nfunction validateUser(user) {\n  if (!user) {\n    throw new ValidationError(\'user\', \'is required\');\n  }\n  if (!user.name) {\n    throw new ValidationError(\'name\', \'must not be empty\');\n  }\n  if (!isValidEmail(user.email)) {\n    throw new ValidationError(\'email\', \'is invalid\');\n  }\n}',
        explanation: '使用自定义错误类提供有意义的错误信息',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: '// 不必要的对象属性枚举\nconst obj = { a: 1, b: 2, c: 3 };\nconst keys = [];\nconst values = [];\nfor (const key in obj) {\n  keys.push(key);\n  values.push(obj[key]);\n}',
        optimized: '// 使用Object方法\nconst keys = Object.keys(obj);\nconst values = Object.values(obj);\nconst entries = Object.entries(obj);\n// 或使用for...of遍历entries\nfor (const [key, value] of Object.entries(obj)) {\n  console.log(`${key}: ${value}`);\n}',
        explanation: '使用Object.keys/values/entries遍历对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// 不必要的条件渲染逻辑\nfunction Header({ isLoggedIn, user }) {\n  if (isLoggedIn) {\n    return <div>Welcome, {user.name}</div>;\n  } else {\n    return <button onClick={login}>Login</button>;\n  }\n}',
        optimized: '// 使用三元运算符或提前return\nfunction Header({ isLoggedIn, user }) {\n  if (isLoggedIn) {\n    return <div>Welcome, {user.name}</div>;\n  }\n  return <button onClick={login}>Login</button>;\n}\n// 或使用三元\nreturn isLoggedIn ? <div>Welcome, {user.name}</div> : <button onClick={login}>Login</button>;',
        explanation: '使用提前return或三元运算符简化条件渲染',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的列表反转\nreversed_list = []\nfor i in range(len(original_list) - 1, -1, -1):\n    reversed_list.append(original_list[i])',
        optimized: '// 使用切片反转\nreversed_list = original_list[::-1]\n# 或使用reversed函数\nreversed_list = list(reversed(original_list))\n# 注意: reversed返回迭代器，需要list()转换',
        explanation: '使用切片或reversed函数反转列表',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的集合操作\nlist_a = [1, 2, 3, 4, 5]\nlist_b = [4, 5, 6, 7, 8]\nintersection = []\nfor item in list_a:\n    if item in list_b:\n        intersection.append(item)',
        optimized: '// 使用set操作\nset_a = set(list_a)\nset_b = set(list_b)\nintersection = list(set_a & set_b)  # 交集\nunion = list(set_a | set_b)  # 并集\ndifference = list(set_a - set_b)  # 差集\n# set操作的时间复杂度远低于列表遍历',
        explanation: '使用set进行集合运算',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: '// Python: 不必要的字典默认值\nconfig = {}\nif \'timeout\' not in config:\n    config[\'timeout\'] = 30\nif \'retries\' not in config:\n    config[\'retries\'] = 3\nif \'host\' not in config:\n    config[\'host\'] = \'localhost\'',
        optimized: '// 使用dict.setdefault或defaultdict\nconfig.setdefault(\'timeout\', 30)\nconfig.setdefault(\'retries\', 3)\nconfig.setdefault(\'host\', \'localhost\')\n# 或使用字典合并\nconfig = {\'timeout\': 30, \'retries\': 3} | user_config\n# 或使用dataclass\nfrom dataclasses import dataclass\n@dataclass\nclass Config:\n    timeout: int = 30\n    retries: int = 3\n    host: str = \'localhost\'\nconfig = Config(**user_config)',
        explanation: '使用setdefault或字典合并设置默认值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: '// Python: 不必要的字符串格式化\nmessage = \'User \' + str(user_id) + \' logged in at \' + str(login_time) + \' from \' + ip_address',
        optimized: '// 使用f-string或str.format\nmessage = f\'User {user_id} logged in at {login_time} from {ip_address}\'\n# 或使用logging\nlogger.info(\'User %s logged in at %s from %s\', user_id, login_time, ip_address)\n# logging模块自动格式化，性能更好',
        explanation: '使用f-string或logging模块格式化日志',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'function memoize(fn) { const cache = {}; return function() { const key = JSON.stringify(arguments); if (cache[key]) { return cache[key]; } const result = fn.apply(this, arguments); cache[key] = result; return result; }; }',
        optimized: 'const memoize = (fn, resolver) => { const cache = new Map(); return function(...args) { const key = resolver ? resolver(...args) : JSON.stringify(args); if (cache.has(key)) return cache.get(key); const result = fn.apply(this, args); cache.set(key, result); return result; }; };',
        explanation: '使用Map和resolver函数优化memoize实现',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const obj = { a: 1, b: 2 }; Object.defineProperty(obj, "c", { value: 3, enumerable: true, configurable: true, writable: true });',
        optimized: 'const obj = { a: 1, b: 2, c: 3 };',
        explanation: '使用对象字面量直接定义属性，替代defineProperty',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = [1, 2, 3]; const newArr = []; arr.forEach(x => { newArr.push(x * 2); });',
        optimized: 'const newArr = [1, 2, 3].map(x => x * 2);',
        explanation: '使用map替代forEach+push',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'let result = 0; for (let i = 0; i < 10; i++) { result += i * i; }',
        optimized: 'const result = Array.from({ length: 10 }, (_, i) => i * i).reduce((a, b) => a + b, 0);',
        explanation: '使用函数式编程计算平方和',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const data = JSON.parse(response); if (data.user) { console.log(data.user.name); }',
        optimized: 'try { const data = JSON.parse(response); console.log(data.user?.name); } catch (e) { console.error("Parse failed:", e.message); }',
        explanation: '添加JSON解析错误处理和可选链',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: 'const list = document.getElementById("list"); for (let i = 0; i < 100; i++) { const li = document.createElement("li"); li.textContent = "Item " + i; list.appendChild(li); }',
        optimized: 'const list = document.getElementById("list"); const fragment = document.createDocumentFragment(); for (let i = 0; i < 100; i++) { const li = document.createElement("li"); li.textContent = `Item ${i}`; fragment.appendChild(li); } list.appendChild(fragment);',
        explanation: '使用DocumentFragment批量操作DOM，减少重排',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function Person(name) { this.name = name; this.sayHello = function() { console.log("Hello, " + this.name); }; }',
        optimized: 'class Person { constructor(name) { this.name = name; } sayHello() { console.log(`Hello, ${this.name}`); } }',
        explanation: '使用class语法，方法共享原型更省内存',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const items = data.filter(function(item) { return item.status === "active"; }).map(function(item) { return item.name; });',
        optimized: 'const items = data.filter(i => i.status === "active").map(i => i.name);',
        explanation: '使用箭头函数简化filter和map回调',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const config = {}; config.host = "localhost"; config.port = 3000; config.debug = true;',
        optimized: 'const config = { host: "localhost", port: 3000, debug: true };',
        explanation: '使用对象字面量一次性创建配置对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function getData(url) { return fetch(url).then(function(response) { return response.json(); }).then(function(data) { return data.items; }).catch(function(error) { console.error(error); }); }',
        optimized: 'const getData = async (url) => { try { const res = await fetch(url); const data = await res.json(); return data.items; } catch (error) { console.error(error); } };',
        explanation: '使用async/await替代Promise链',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'let total = 0; for (let i = 0; i < orders.length; i++) { total += orders[i].amount; }',
        optimized: 'const total = orders.reduce((sum, o) => sum + o.amount, 0);',
        explanation: '使用reduce求和替代for循环',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'if (user !== null && user.address !== null && user.address.city !== null) { return user.address.city; }',
        optimized: 'return user?.address?.city;',
        explanation: '使用可选链简化深层空值检查',
        language: 'javascript',
        issueType: 'null_check'
      },
      {
        original: 'function isEmpty(obj) { for (let key in obj) { if (obj.hasOwnProperty(key)) { return false; } } return true; }',
        optimized: 'const isEmpty = obj => Object.keys(obj).length === 0;',
        explanation: '使用Object.keys检查空对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const sorted = items.slice().sort(function(a, b) { return a.value - b.value; });',
        optimized: 'const sorted = [...items].sort((a, b) => a.value - b.value);',
        explanation: '使用展开运算符和箭头函数简化排序',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const colors = ["red", "green", "blue"]; const first = colors[0]; const rest = colors.slice(1);',
        optimized: 'const [first, ...rest] = ["red", "green", "blue"];',
        explanation: '使用解构和剩余运算符提取数组元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'let result = ""; const words = ["Hello", "World"]; for (let i = 0; i < words.length; i++) { result += words[i] + " "; }',
        optimized: 'const result = ["Hello", "World"].join(" ");',
        explanation: '使用join替代循环拼接',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function cloneArray(arr) { return arr.slice(); }',
        optimized: 'const cloneArray = arr => [...arr];',
        explanation: '使用展开运算符替代slice复制数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const user = { name: "Alice", age: 30 }; const name = user.name; const age = user.age;',
        optimized: 'const { name, age } = { name: "Alice", age: 30 };',
        explanation: '使用对象解构提取属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'if (value === null || value === undefined || value === "") { return "default"; }',
        optimized: 'return value ?? "default";',
        explanation: '使用空值合并操作符提供默认值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const numbers = [5, 3, 8, 1, 9, 2]; let max = numbers[0]; for (let i = 1; i < numbers.length; i++) { if (numbers[i] > max) { max = numbers[i]; } }',
        optimized: 'const max = Math.max(...[5, 3, 8, 1, 9, 2]);',
        explanation: '使用Math.max和展开运算符求最大值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function fetchWithRetry(url, retries) { return fetch(url).catch(function(err) { if (retries > 0) { return fetchWithRetry(url, retries - 1); } throw err; }); }',
        optimized: 'const fetchWithRetry = async (url, retries = 3) => { try { return await fetch(url); } catch (err) { if (retries > 0) return fetchWithRetry(url, retries - 1); throw err; } };',
        explanation: '使用async/await重写重试逻辑',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const products = [{ id: 1, price: 10 }, { id: 2, price: 20 }]; let total = 0; for (let i = 0; i < products.length; i++) { total += products[i].price; }',
        optimized: 'const total = [{ id: 1, price: 10 }, { id: 2, price: 20 }].reduce((sum, p) => sum + p.price, 0);',
        explanation: '使用reduce计算总价',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const data = { name: "test", value: 42 }; const json = JSON.stringify(data);',
        optimized: 'const json = JSON.stringify({ name: "test", value: 42 }, null, 2);',
        explanation: '使用格式化参数美化JSON输出',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const arr = [1, 2, 2, 3, 3, 3]; const unique = []; for (let i = 0; i < arr.length; i++) { if (unique.indexOf(arr[i]) === -1) { unique.push(arr[i]); } }',
        optimized: 'const unique = [...new Set([1, 2, 2, 3, 3, 3])];',
        explanation: '使用Set快速去重',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'let cache = {}; function getCachedData(key) { if (cache[key] !== undefined) { return cache[key]; } const data = expensiveOperation(key); cache[key] = data; return data; }',
        optimized: 'const cache = new Map(); async function getCachedData(key) { if (cache.has(key)) return cache.get(key); const data = await expensiveOperation(key); cache.set(key, data); return data; }',
        explanation: '使用Map替代普通对象做缓存',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function parseQuery(url) { const query = url.split("?")[1]; const params = {}; if (query) { const pairs = query.split("&"); for (let i = 0; i < pairs.length; i++) { const [key, value] = pairs[i].split("="); params[key] = decodeURIComponent(value || ""); } } return params; }',
        optimized: 'const parseQuery = url => { const params = new URLSearchParams(url.split("?")[1]); return Object.fromEntries(params); };',
        explanation: '使用URLSearchParams解析查询参数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function validateEmail(email) { const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/; return re.test(email); }',
        optimized: 'const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/; const validateEmail = email => EMAIL_REGEX.test(email);',
        explanation: '正则提取到常量避免重复编译',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const items = document.querySelectorAll(".card"); for (let i = 0; i < items.length; i++) { items[i].classList.add("highlight"); }',
        optimized: 'document.querySelectorAll(".card").forEach(item => item.classList.add("highlight"));',
        explanation: '使用forEach简化DOM操作',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const names = users.map(function(u) { return u.name; }); const ages = users.map(function(u) { return u.age; });',
        optimized: 'const { names, ages } = users.reduce((acc, u) => { acc.names.push(u.name); acc.ages.push(u.age); return acc; }, { names: [], ages: [] });',
        explanation: '一次reduce同时提取多个字段',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'let sum = 0; for (const n of numbers) { sum += n * 2; }',
        optimized: 'const sum = numbers.reduce((acc, n) => acc + n * 2, 0);',
        explanation: '使用reduce替代for...of循环',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'if (user.hasPermission("edit") && user.isActive() && user.isVerified()) { editContent(); }',
        optimized: 'if (user?.hasPermission("edit") && user?.isActive?.() && user?.isVerified?.()) { editContent(); }',
        explanation: '使用可选链调用方法，防止空引用',
        language: 'javascript',
        issueType: 'null_check'
      },
      {
        original: 'const values = [1, 2, 3]; const a = values[0]; const b = values[1]; const c = values[2];',
        optimized: 'const [a, b, c] = [1, 2, 3];',
        explanation: '使用数组解构简化取值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = { x: 1, y: 2 }; const x = obj.x; const y = obj.y;',
        optimized: 'const { x, y } = { x: 1, y: 2 };',
        explanation: '使用对象解构简化取值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const result = data.map(item => item.value).filter(v => v > 10).reduce((a, b) => a + b, 0);',
        optimized: 'const result = data.reduce((sum, item) => item.value > 10 ? sum + item.value : sum, 0);',
        explanation: '合并map+filter+reduce为单次reduce',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function formatDateTime(date) { const d = new Date(date); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() + " " + d.getHours() + ":" + d.getMinutes(); }',
        optimized: 'const formatDateTime = date => new Date(date).toISOString().slice(0, 16).replace("T", " ");',
        explanation: '使用原生toISOString简化日期格式化',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const items = [1, 2, 3, 4, 5]; const doubled = items.map(x => x * 2); const filtered = doubled.filter(x => x > 5);',
        optimized: 'const filtered = [1, 2, 3, 4, 5].flatMap(x => { const d = x * 2; return d > 5 ? [d] : []; });',
        explanation: '使用flatMap合并map和filter操作',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function uuid() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) { const r = Math.random() * 16 | 0; const v = c === "x" ? r : (r & 0x3 | 0x8); return v.toString(16); }); }',
        optimized: 'const uuid = () => crypto.randomUUID();',
        explanation: '使用原生crypto.randomUUID生成UUID',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const text = "Hello World"; const chars = []; for (let i = 0; i < text.length; i++) { chars.push(text[i]); }',
        optimized: 'const chars = [...text];',
        explanation: '使用展开运算符将字符串转为字符数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const numbers = [3, 1, 4, 1, 5]; const sorted = numbers.sort(function(a, b) { return a - b; });',
        optimized: 'const sorted = [...[3, 1, 4, 1, 5]].sort((a, b) => a - b);',
        explanation: '使用展开运算符创建副本后排序，不修改原数组',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const result = {}; for (const item of data) { result[item.id] = item; }',
        optimized: 'const result = Object.fromEntries(data.map(item => [item.id, item]));',
        explanation: '使用Object.fromEntries创建映射表',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function add(a, b) { return a + b; } function multiply(a, b) { return a * b; }',
        optimized: 'const add = (a, b) => a + b; const multiply = (a, b) => a * b;',
        explanation: '使用箭头函数简化简单运算',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const values = [1, null, 3, undefined, 5]; const filtered = values.filter(v => v !== null && v !== undefined);',
        optimized: 'const filtered = [1, null, 3, undefined, 5].filter(v => v != null);',
        explanation: '使用!= null同时过滤null和undefined',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const activeUsers = []; for (const u of users) { if (u.isActive) { activeUsers.push(u); } }',
        optimized: 'const activeUsers = users.filter(u => u.isActive);',
        explanation: '使用filter替代for...of筛选',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const ids = [1, 2, 3]; const users = ids.map(function(id) { return getUser(id); });',
        optimized: 'const users = await Promise.all([1, 2, 3].map(id => getUser(id)));',
        explanation: '使用Promise.all并发请求',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function throttle(fn, wait) { let last = 0; return function() { const now = Date.now(); if (now - last >= wait) { last = now; fn(); } }; }',
        optimized: 'const throttle = (fn, wait) => { let lastCall = 0; let timer = null; return function(...args) { const now = Date.now(); const remaining = wait - (now - lastCall); if (remaining <= 0) { if (timer) { clearTimeout(timer); timer = null; } lastCall = now; fn.apply(this, args); } else if (!timer) { timer = setTimeout(() => { lastCall = Date.now(); timer = null; fn.apply(this, args); }, remaining); } }; };',
        explanation: '完善throttle实现，支持leading和trailing调用',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = data.map(item => item.name).join(", ");',
        optimized: 'const result = data.map(item => item.name).join(", ");',
        explanation: '使用join替代循环拼接字符串',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'if (x > 0) { if (y > 0) { if (z > 0) { return x + y + z; } } }',
        optimized: 'if (x > 0 && y > 0 && z > 0) { return x + y + z; }',
        explanation: '合并嵌套if为条件与运算',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function getFullYear() { return new Date().getFullYear(); }',
        optimized: 'const getFullYear = () => new Date().getFullYear();',
        explanation: '使用箭头函数简化无参数函数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const user = { name: "Alice", roles: ["admin", "user"] }; const isAdmin = user.roles.indexOf("admin") !== -1;',
        optimized: 'const isAdmin = user.roles.includes("admin");',
        explanation: '使用includes替代indexOf检查元素存在性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const data = { a: 1, b: 2 }; const clone = {}; for (const key in data) { clone[key] = data[key]; }',
        optimized: 'const clone = { ...{ a: 1, b: 2 } };',
        explanation: '使用展开运算符浅拷贝对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const result = arr.filter(x => x > 0).filter(x => x < 100);',
        optimized: 'const result = arr.filter(x => x > 0 && x < 100);',
        explanation: '合并多个filter条件为一个',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const values = [1, 2, 3]; const sum = values.reduce(function(a, b) { return a + b; }, 0);',
        optimized: 'const sum = [1, 2, 3].reduce((a, b) => a + b, 0);',
        explanation: '使用箭头函数简化reduce回调',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = { a: 1 }; Object.freeze(obj); obj.a = 2; console.log(obj.a);',
        optimized: 'const obj = Object.freeze({ a: 1 }); try { obj.a = 2; } catch (e) { console.log("Cannot modify frozen object"); }',
        explanation: '冻结对象添加错误处理',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: 'function findUser(users, name) { for (let i = 0; i < users.length; i++) { if (users[i].name === name) { return users[i]; } } return null; }',
        optimized: 'const findUser = (users, name) => users.find(u => u.name === name) || null;',
        explanation: '使用find替代for循环查找',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const values = [1, 2, 3, 4, 5]; const evens = values.filter(function(v) { return v % 2 === 0; });',
        optimized: 'const evens = [1, 2, 3, 4, 5].filter(v => v % 2 === 0);',
        explanation: '使用箭头函数简化filter回调',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'let result = 1; for (let i = 2; i <= 10; i++) { result *= i; }',
        optimized: 'const result = Array.from({ length: 9 }, (_, i) => i + 2).reduce((a, b) => a * b, 1);',
        explanation: '使用reduce计算阶乘',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr1 = [1, 2]; const arr2 = [3, 4]; const combined = arr1.concat(arr2);',
        optimized: 'const combined = [...[1, 2], ...[3, 4]];',
        explanation: '使用展开运算符替代concat合并数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj1 = { a: 1 }; const obj2 = { b: 2 }; const merged = Object.assign({}, obj1, obj2);',
        optimized: 'const merged = { ...{ a: 1 }, ...{ b: 2 } };',
        explanation: '使用展开运算符替代Object.assign合并对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function getUser(id) { return fetch(`/api/users/${id}`).then(res => res.json()).then(data => data.user); }',
        optimized: 'const getUser = async id => { const res = await fetch(`/api/users/${id}`); return res.json().then(d => d.user); };',
        explanation: '使用async/await简化异步流程',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const arr = [1, 2, 3]; const mapped = arr.map(x => ({ value: x }));',
        optimized: 'const mapped = [1, 2, 3].map(x => ({ value: x }));',
        explanation: '使用简写箭头函数直接返回对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'def process_data(data): result = [] for item in data: if item["active"]: result.append(item["name"]) return result',
        optimized: 'def process_data(data): return [item["name"] for item in data if item["active"]]',
        explanation: '使用列表推导式替代循环',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_user(user_id): try: user = db.query(User).filter(User.id == user_id).first() except Exception: user = None return user',
        optimized: 'def get_user(user_id): return db.query(User).get(user_id)',
        explanation: '使用get方法简化查询，get自动返回None',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import os path = os.path.join("data", "files", "report.txt") if os.path.exists(path): with open(path) as f: content = f.read()',
        optimized: 'from pathlib import Path path = Path("data") / "files" / "report.txt" if path.exists(): content = path.read_text()',
        explanation: '使用pathlib替代os.path，更现代的文件路径处理',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def calculate_total(items): total = 0 for item in items: total += item.price * item.quantity return total',
        optimized: 'def calculate_total(items): return sum(item.price * item.quantity for item in items)',
        explanation: '使用生成器表达式和sum求和',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'class User: def __init__(self, name): self.name = name def greet(self): return "Hello, " + self.name',
        optimized: 'class User: def __init__(self, name: str): self.name = name def greet(self) -> str: return f"Hello, {self.name}"',
        explanation: '添加类型注解和f-string格式化',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def divide(a, b): if b == 0: return None else: return a / b',
        optimized: 'def divide(a: float, b: float) -> float | None: if b == 0: raise ValueError("Cannot divide by zero") return a / b',
        explanation: '使用Union类型注解和异常替代返回None',
        language: 'python',
        issueType: 'error_handling'
      },
      {
        original: 'def get_config(): config = {} config["host"] = os.getenv("HOST", "localhost") config["port"] = int(os.getenv("PORT", "3000")) config["debug"] = os.getenv("DEBUG", "false").lower() == "true" return config',
        optimized: 'from dataclasses import dataclass @dataclass class Config: host: str = "localhost" port: int = 3000 debug: bool = False @classmethod def from_env(cls): return cls( host=os.getenv("HOST", cls.host), port=int(os.getenv("PORT", cls.port)), debug=os.getenv("DEBUG", "false").lower() == "true" )',
        explanation: '使用dataclass和类方法替代字典配置',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'data = [1, 2, 3, 4, 5] result = [] for x in data: if x % 2 == 0: result.append(x * x)',
        optimized: 'result = [x * x for x in data if x % 2 == 0]',
        explanation: '使用列表推导式替代循环和条件判断',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def fibonacci(n): if n <= 1: return n a, b = 0, 1 for _ in range(2, n + 1): a, b = b, a + b return b',
        optimized: 'from functools import lru_cache @lru_cache(maxsize=None) def fibonacci(n: int) -> int: if n <= 1: return n return fibonacci(n - 1) + fibonacci(n - 2)',
        explanation: '使用lru_cache缓存递归结果，O(n)变为O(log n)',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'def sort_users(users): return sorted(users, key=lambda u: u.age)',
        optimized: 'from operator import attrgetter def sort_users(users): return sorted(users, key=attrgetter("age"))',
        explanation: '使用attrgetter替代lambda，性能更好',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'def read_lines(filename): with open(filename) as f: lines = f.readlines() return [line.strip() for line in lines if line.strip()]',
        optimized: 'def read_lines(filename): with open(filename) as f: return [line.strip() for line in f if line.strip()]',
        explanation: '直接迭代文件对象，节省内存',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'user = {"name": "Alice", "age": 25} name = user.get("name", "Unknown") age = user.get("age", 0) email = user.get("email", "none")',
        optimized: 'from dataclasses import dataclass @dataclass class User: name: str = "Unknown" age: int = 0 email: str = "none" user = User(**raw_data)',
        explanation: '使用dataclass代替字典获取，类型安全',
        language: 'python',
        issueType: 'type_safety'
      },
      {
        original: 'def send_email(to, subject, body, cc=None, bcc=None, attachments=None): ...',
        optimized: 'def send_email(*, to: str, subject: str, body: str, cc: list[str] | None = None, bcc: list[str] | None = None, attachments: list[str] | None = None) -> None: ...',
        explanation: '使用仅限关键字参数和类型注解',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'result = {} for k, v in data.items(): if v > 0: result[k] = v * 2',
        optimized: 'result = {k: v * 2 for k, v in data.items() if v > 0}',
        explanation: '使用字典推导式替代循环',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def timer(func): def wrapper(*args, **kwargs): import time start = time.time() result = func(*args, **kwargs) print(f"Time: {time.time() - start}") return result return wrapper',
        optimized: 'import time from functools import wraps def timer(func): @wraps(func) def wrapper(*args, **kwargs): start = time.perf_counter() result = func(*args, **kwargs) print(f"Time: {time.perf_counter() - start:.4f}s") return result return wrapper',
        explanation: '使用functools.wraps保留函数元信息，perf_counter更精确',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'class Database: def connect(self): self.conn = sqlite3.connect("app.db") def query(self, sql): return self.conn.execute(sql).fetchall() def close(self): self.conn.close()',
        optimized: 'from contextlib import contextmanager @contextmanager def get_db(): conn = sqlite3.connect("app.db") try: yield conn finally: conn.close() with get_db() as conn: results = conn.execute("SELECT * FROM users").fetchall()',
        explanation: '使用上下文管理器确保资源正确释放',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'for i in range(len(items)): print(i, items[i])',
        optimized: 'for i, item in enumerate(items): print(i, item)',
        explanation: '使用enumerate获取索引和值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'if user is not None and user.is_active and user.has_role("admin"): grant_access(user)',
        optimized: 'if user and user.is_active and user.has_role("admin"): grant_access(user)',
        explanation: '简化条件判断，真值检查已包含None检查',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_page(page_num, per_page=20): start = (page_num - 1) * per_page end = start + per_page return data[start:end]',
        optimized: 'def get_page(page_num: int = 1, per_page: int = 20) -> list: start = (page_num - 1) * per_page return data[start:start + per_page]',
        explanation: '添加类型注解，简化变量',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'try: result = risky_operation() except Exception as e: result = None logging.error(f"Error: {e}")',
        optimized: 'try: result = risky_operation() except ValueError as e: logging.warning(f"Invalid value: {e}") result = default_value except Exception as e: logging.exception("Unexpected error") raise',
        explanation: '捕获具体异常，使用logging.exception保留堆栈',
        language: 'python',
        issueType: 'error_handling'
      },
      {
        original: 'def format_price(price): return "$" + str(round(price, 2))',
        optimized: 'def format_price(price: float) -> str: return f"${price:,.2f}"',
        explanation: '使用f-string格式化，支持千分位',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'names = [] ages = [] for user in users: names.append(user.name) ages.append(user.age)',
        optimized: 'names, ages = zip(*((u.name, u.age) for u in users))',
        explanation: '使用zip和生成器表达式一次遍历提取多个字段',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'def get_or_create(session, model, defaults=None, **kwargs): instance = session.query(model).filter_by(**kwargs).first() if instance: return instance, False params = {**kwargs} if defaults: params.update(defaults) instance = model(**params) session.add(instance) return instance, True',
        optimized: 'from sqlalchemy.orm import sessionmaker def get_or_create(session, model, defaults=None, **kwargs): instance = session.query(model).filter_by(**kwargs).first() if instance: return instance, False params = kwargs.copy() if defaults: params.update(defaults) instance = model(**params) session.add(instance) session.flush() return instance, True',
        explanation: '添加flush确保instance有主键，更可靠的get_or_create',
        language: 'python',
        issueType: 'reliability'
      },
      {
        original: 'items = [1, 2, 3, 4, 5] total = 0 for item in items: total += item average = total / len(items)',
        optimized: 'average = sum(items) / len(items)',
        explanation: '使用sum内建函数替代循环',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def log_message(level, message): timestamps = {"debug": 10, "info": 20, "warning": 30, "error": 40} import logging logger = logging.getLogger(__name__) logger.log(timestamps[level], message)',
        optimized: 'import logging logger = logging.getLogger(__name__) def log_message(level: str, message: str) -> None: getattr(logger, level.lower(), logger.info)(message)',
        explanation: '使用getattr动态调用日志级别方法',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'data = {"a": 1, "b": 2, "c": 3} for key in data: print(key, data[key])',
        optimized: 'for key, value in data.items(): print(key, value)',
        explanation: '使用items()直接遍历键值对',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def is_valid_email(email): import re pattern = r"[^@]+@[^@]+\\.[^@]+" return bool(re.match(pattern, email))',
        optimized: 'import re EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$") def is_valid_email(email: str) -> bool: return bool(EMAIL_RE.match(email))',
        explanation: '预编译正则表达式，添加类型注解',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'def chunk_list(lst, chunk_size): for i in range(0, len(lst), chunk_size): yield lst[i:i + chunk_size]',
        optimized: 'from itertools import islice def chunk_list(lst, n): it = iter(lst) while True: chunk = list(islice(it, n)) if not chunk: break yield chunk',
        explanation: '使用itertools.islice实现更高效的分块',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'colors = ("red", "green", "blue") for i in range(len(colors)): print(i, colors[i])',
        optimized: 'for i, color in enumerate(colors): print(i, color)',
        explanation: '使用enumerate替代range+len',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def apply_discount(price, discount): if discount > 0 and discount < 1: return price * (1 - discount) elif discount >= 1: return 0 else: return price',
        optimized: 'def apply_discount(price: float, discount: float) -> float: if 0 < discount < 1: return price * (1 - discount) return max(0, price - discount)',
        explanation: '简化条件逻辑，使用max确保不为负',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import pickle with open("data.pkl", "rb") as f: data = pickle.load(f)',
        optimized: 'import json with open("data.json") as f: data = json.load(f)',
        explanation: '使用JSON替代pickle，更安全且跨语言兼容',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def get_user_name(user_id): user = db.session.get(User, user_id) if user: return user.name return "Unknown"',
        optimized: 'def get_user_name(user_id: int) -> str: user = db.session.get(User, user_id) return user.name if user else "Unknown"',
        explanation: '使用条件表达式简化返回逻辑',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'for i in range(100): if i % 2 == 0: if i % 3 == 0: print(i)',
        optimized: 'for i in range(100): if i % 6 == 0: print(i)',
        explanation: '简化嵌套条件为单个取模判断',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def load_users(filepath): users = [] with open(filepath) as f: for line in f: name, age = line.strip().split(",") users.append({"name": name, "age": int(age)}) return users',
        optimized: 'import csv def load_users(filepath: str) -> list[dict]: with open(filepath, newline="") as f: return list(csv.DictReader(f, fieldnames=["name", "age"]))',
        explanation: '使用csv模块和DictReader简化CSV解析',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def calculate_bmi(weight, height): bmi = weight / (height ** 2) if bmi < 18.5: category = "underweight" elif bmi < 25: category = "normal" elif bmi < 30: category = "overweight" else: category = "obese" return bmi, category',
        optimized: 'def calculate_bmi(weight: float, height: float) -> tuple[float, str]: bmi = weight / height ** 2 category = "underweight" if bmi < 18.5 else "normal" if bmi < 25 else "overweight" if bmi < 30 else "obese" return bmi, category',
        explanation: '使用三元表达式链简化if-elif',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def process_items(items): result = {} for item in items: category = item.get("category", "other") if category not in result: result[category] = [] result[category].append(item) return result',
        optimized: 'from collections import defaultdict def process_items(items): result = defaultdict(list) for item in items: result[item.get("category", "other")].append(item) return dict(result)',
        explanation: '使用defaultdict简化分组逻辑',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def is_leap_year(year): if year % 4 == 0: if year % 100 == 0: if year % 400 == 0: return True return False return True return False',
        optimized: 'def is_leap_year(year: int) -> bool: return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)',
        explanation: '简化闰年判断逻辑为单行表达式',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_stats(numbers): count = len(numbers) total = sum(numbers) average = total / count minimum = min(numbers) maximum = max(numbers) return {"count": count, "total": total, "average": average, "min": minimum, "max": maximum}',
        optimized: 'from statistics import mean def get_stats(numbers: list[int]) -> dict: return {"count": len(numbers), "total": sum(numbers), "average": mean(numbers), "min": min(numbers), "max": max(numbers)}',
        explanation: '使用statistics模块和内建函数简化统计',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'user = User() user.name = "Alice" user.email = "alice@example.com" user.save()',
        optimized: 'user = User(name="Alice", email="alice@example.com") user.save()',
        explanation: '使用构造函数一次性设置属性',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'if not items: return None first = items[0] return first',
        optimized: 'return items[0] if items else None',
        explanation: '使用条件表达式简化取首元素',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_settings(): settings = {} with open("settings.json") as f: raw = json.load(f) for key, value in raw.items(): settings[key.upper()] = value return settings',
        optimized: 'def get_settings() -> dict[str, str]: with open("settings.json") as f: return {k.upper(): v for k, v in json.load(f).items()}',
        explanation: '使用字典推导式简化键名转换',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'names = ["Alice", "Bob", "Charlie"] scores = [95, 87, 92] for i in range(len(names)): print(names[i], scores[i])',
        optimized: 'for name, score in zip(["Alice", "Bob", "Charlie"], [95, 87, 92]): print(name, score)',
        explanation: '使用zip并行迭代多个列表',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_user_roles(user_id): user = User.query.get(user_id) if user is None: return [] roles = [] for role in user.roles: roles.append(role.name) return roles',
        optimized: 'def get_user_roles(user_id: int) -> list[str]: user = User.query.get(user_id) return [r.name for r in user.roles] if user else []',
        explanation: '使用列表推导式和条件表达式简化',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def safe_divide(a, b): try: return a / b except: return None',
        optimized: 'def safe_divide(a: float, b: float) -> float | None: try: return a / b except ZeroDivisionError: return None',
        explanation: '捕获具体异常而非裸except',
        language: 'python',
        issueType: 'error_handling'
      },
      {
        original: 'def read_config(filepath): config = {} try: with open(filepath) as f: for line in f: line = line.strip() if "=" in line: key, value = line.split("=", 1) config[key.strip()] = value.strip() except FileNotFoundError: pass return config',
        optimized: 'import configparser def read_config(filepath: str) -> dict: config = configparser.ConfigParser() config.read(filepath) return dict(config["DEFAULT"]) if "DEFAULT" in config else {k: v for section in config.sections() for k, v in config[section].items()}',
        explanation: '使用configparser模块解析配置文件',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def is_empty(value): if value is None: return True if isinstance(value, (list, dict, str)): return len(value) == 0 return False',
        optimized: 'def is_empty(value) -> bool: if value is None: return True if isinstance(value, (list, dict, str)): return not value return False',
        explanation: '使用not运算符替代len == 0检查',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import time start = time.time() result = expensive_operation() elapsed = time.time() - start',
        optimized: 'import time start = time.perf_counter() result = expensive_operation() elapsed = time.perf_counter() - start',
        explanation: '使用perf_counter替代time.time()测量耗时',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'items.sort(key=lambda x: x[2])',
        optimized: 'from operator import itemgetter items.sort(key=itemgetter(2))',
        explanation: '使用itemgetter替代lambda，排序性能提升',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'def get_total(orders): total = 0 for order in orders: if order.status == "paid": total += order.amount return total',
        optimized: 'def get_total(orders: list[Order]) -> float: return sum(o.amount for o in orders if o.status == "paid")',
        explanation: '使用生成器表达式替代循环累加',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def batch_process(items, batch_size): batches = [] for i in range(0, len(items), batch_size): batches.append(items[i:i + batch_size]) for batch in batches: process_batch(batch)',
        optimized: 'def batch_process(items: list, batch_size: int) -> None: for i in range(0, len(items), batch_size): process_batch(items[i:i + batch_size])',
        explanation: '直接在循环中处理批次，避免创建中间列表',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'def validate_input(data): errors = [] if not data.get("name"): errors.append("Name is required") if len(data.get("name", "")) < 2: errors.append("Name must be at least 2 characters") if not data.get("email"): errors.append("Email is required") return errors',
        optimized: 'def validate_input(data: dict) -> list[str]: errors = [] name = data.get("name", "") if not name: errors.append("Name is required") elif len(name) < 2: errors.append("Name must be at least 2 characters") if not data.get("email"): errors.append("Email is required") return errors',
        explanation: '使用elif避免重复检查，提前返回',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'from typing import List, Dict, Optional def search_users(query: str, limit: int = 10) -> List[Dict]: ...',
        optimized: 'def search_users(query: str, limit: int = 10) -> list[dict]: ...',
        explanation: '使用Python 3.9+内建泛型类型替代typing模块',
        language: 'python',
        issueType: 'type_safety'
      },
      {
        original: 'cache = {} def get_data(key): if key in cache: return cache[key] data = expensive_lookup(key) cache[key] = data return data',
        optimized: 'from functools import lru_cache @lru_cache(maxsize=128) def get_data(key: str) -> Any: return expensive_lookup(key)',
        explanation: '使用lru_cache自动管理缓存',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'def format_duration(seconds): hours = seconds // 3600 minutes = (seconds % 3600) // 60 secs = seconds % 60 return f"{hours}h {minutes}m {secs}s"',
        optimized: 'def format_duration(seconds: int) -> str: h, remainder = divmod(seconds, 3600) m, s = divmod(remainder, 60) return f"{h}h {m}m {s}s"',
        explanation: '使用divmod简化时间计算',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def load_data(filepath): data = [] with open(filepath, encoding="utf-8") as f: reader = csv.reader(f) for row in reader: data.append(row) return data',
        optimized: 'import csv def load_data(filepath: str) -> list[list[str]]: with open(filepath, encoding="utf-8") as f: return list(csv.reader(f))',
        explanation: '直接将csv读取转为列表',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def is_valid_password(password): if len(password) < 8: return False if not any(c.isupper() for c in password): return False if not any(c.islower() for c in password): return False if not any(c.isdigit() for c in password): return False return True',
        optimized: 'def is_valid_password(password: str) -> bool: return len(password) >= 8 and any(c.isupper() for c in password) and any(c.islower() for c in password) and any(c.isdigit() for c in password)',
        explanation: '使用all/any简化密码验证',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'class Singleton: _instance = None def __new__(cls): if cls._instance is None: cls._instance = super().__new__(cls) return cls._instance',
        optimized: 'from functools import lru_cache @lru_cache(maxsize=1) class Singleton: def __init__(self): pass',
        explanation: '使用lru_cache实现单例模式',
        language: 'python',
        issueType: 'code_architecture'
      },
      {
        original: 'data = {"users": [{"name": "Alice", "age": 25}, {"name": "Bob", "age": 30}]} names = [u["name"] for u in data["users"]]',
        optimized: 'names = [u["name"] for u in data.get("users", [])]',
        explanation: '使用get安全访问嵌套字典',
        language: 'python',
        issueType: 'null_check'
      },
      {
        original: 'const query = "SELECT * FROM users WHERE name = \'" + username + "\'"; db.query(query);',
        optimized: 'const query = "SELECT * FROM users WHERE name = ?"; db.query(query, [username]);',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const html = "<div>" + userInput + "</div>"; document.getElementById("app").innerHTML = html;',
        optimized: 'const div = document.createElement("div"); div.textContent = userInput; document.getElementById("app").appendChild(div);',
        explanation: '使用textContent替代innerHTML防止XSS',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/user/:id", (req, res) => { const query = `SELECT * FROM users WHERE id = ${req.params.id}`; db.query(query, (err, result) => { res.json(result); }); });',
        optimized: 'app.get("/user/:id", (req, res) => { const sql = "SELECT * FROM users WHERE id = ?"; db.query(sql, [req.params.id], (err, result) => { if (err) return res.status(500).send("Error"); res.json(result); }); });',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function verifyToken(token) { const decoded = jwt.decode(token, "secret"); return decoded; }',
        optimized: 'const jwt = require("jsonwebtoken"); function verifyToken(token) { try { return jwt.verify(token, process.env.JWT_SECRET); } catch (err) { return null; } }',
        explanation: '使用环境变量存储密钥，使用verify替代decode',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<form action="/login" method="POST"> <input type="text" name="username"> <input type="password" name="password"> <input type="submit"> </form>',
        optimized: '<form action="/login" method="POST"> <input type="hidden" name="_csrf" value="<%= csrfToken %>"> <input type="text" name="username" autocomplete="username"> <input type="password" name="password" autocomplete="current-password"> <input type="submit"> </form>',
        explanation: '添加CSRF令牌和autocomplete属性',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const crypto = require("crypto"); const hash = crypto.createHash("md5").update(password).digest("hex");',
        optimized: 'const bcrypt = require("bcrypt"); const hash = await bcrypt.hash(password, 12);',
        explanation: '使用bcrypt替代MD5，更安全的密码哈希',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'res.cookie("token", token);',
        optimized: 'res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "strict", maxAge: 3600000 });',
        explanation: '设置安全的Cookie属性',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(express.json());',
        optimized: 'const express = require("express"); const helmet = require("helmet"); const app = express(); app.use(helmet()); app.use(express.json({ limit: "1mb" }));',
        explanation: '使用helmet添加安全头，限制请求体大小',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.query(`SELECT * FROM products WHERE category = \'${category}\'`)',
        optimized: 'db.query("SELECT * FROM products WHERE category = ?", [category])',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const fs = require("fs"); const content = fs.readFileSync(filePath); res.send(content);',
        optimized: 'const path = require("path"); const fs = require("fs"); const safePath = path.resolve(__dirname, "uploads", req.params.filename); if (!safePath.startsWith(path.resolve(__dirname, "uploads"))) { return res.status(403).send("Forbidden"); } fs.readFile(safePath, (err, content) => { res.send(content); });',
        explanation: '验证文件路径防止路径遍历攻击',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<img src="${userAvatar}" onerror="alert(\'XSS\')">',
        optimized: '<img src="${escapeHtml(userAvatar)}" alt="Avatar" loading="lazy">',
        explanation: '对用户输入进行HTML转义，移除内联事件',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const password = "admin123"; const hash = crypto.createHash("sha256").update(password).digest();',
        optimized: 'const bcrypt = require("bcrypt"); const hash = await bcrypt.hash("admin123", 12); const isValid = await bcrypt.compare(inputPassword, hash);',
        explanation: '使用bcrypt替代SHA256进行密码哈希',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); next(); });',
        optimized: 'app.use(cors({ origin: ["https://example.com", "https://app.example.com"], methods: ["GET", "POST"], credentials: true, maxAge: 3600 }));',
        explanation: '配置严格的CORS策略',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'def get_user(username): query = "SELECT * FROM users WHERE username = \'" + username + "\'" return db.execute(query).fetchone()',
        optimized: 'def get_user(username: str): query = "SELECT * FROM users WHERE username = ?" return db.execute(query, (username,)).fetchone()',
        explanation: '使用参数化查询防止SQL注入',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'import pickle data = pickle.loads(user_input)',
        optimized: 'import json data = json.loads(user_input)',
        explanation: '使用JSON替代pickle，防止反序列化攻击',
        language: 'python',
        issueType: 'security'
      },
      {
        original: '@app.route("/download") def download(): filename = request.args.get("file") return send_file(filename)',
        optimized: '@app.route("/download") def download(): filename = request.args.get("file", "") safe_path = os.path.join(app.config["UPLOAD_FOLDER"], filename) if not safe_path.startswith(app.config["UPLOAD_FOLDER"]): abort(403) return send_file(safe_path)',
        explanation: '验证文件路径防止路径遍历',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'from django.contrib.auth.hashers import make_password password = make_password(raw_password)',
        optimized: 'from django.contrib.auth.hashers import make_password, check_password hashed = make_password(raw_password) is_valid = check_password(input_password, hashed)',
        explanation: '使用Django内置密码哈希，自动选择最强算法',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def sanitize_html(html): from html.parser import HTMLParser class MyParser(HTMLParser): pass parser = MyParser() parser.feed(html) return html',
        optimized: 'import bleach def sanitize_html(html: str) -> str: return bleach.clean(html, tags=["b", "i", "u", "p", "br"], strip=True)',
        explanation: '使用bleach库清理HTML防止XSS',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'const token = req.headers.authorization.split(" ")[1]; const user = jwt.decode(token, "my-secret-key");',
        optimized: 'const jwt = require("jsonwebtoken"); const token = req.headers.authorization?.split(" ")[1]; if (!token) return res.status(401).send("Unauthorized"); try { const user = jwt.verify(token, process.env.JWT_SECRET); req.user = user; next(); } catch { res.status(403).send("Invalid token"); }',
        explanation: '安全的JWT验证中间件',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.execute("DELETE FROM users WHERE id = " + userId)',
        optimized: 'db.execute("DELETE FROM users WHERE id = ?", [userId])',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.post("/api/data", (req, res) => { const data = req.body; eval(data.script); res.send("ok"); });',
        optimized: 'app.post("/api/data", (req, res) => { const data = req.body; if (!validateData(data)) return res.status(400).send("Invalid"); processData(data); res.json({ success: true }); });',
        explanation: '移除eval执行用户输入，使用数据验证',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<div ng-bind-html="userContent"></div>',
        optimized: '<div ng-bind-html="userContent | sanitize"></div>',
        explanation: '使用sanitize过滤器清理HTML',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const password = userInput; const hash = md5(password);',
        optimized: 'const bcrypt = require("bcrypt"); const hash = await bcrypt.hash(userInput, 12);',
        explanation: '使用bcrypt替代MD5存储密码',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/admin", (req, res) => { if (req.query.token === "admin123") { res.sendFile("admin.html"); } else { res.sendStatus(403); } });',
        optimized: 'app.get("/admin", authMiddleware(["admin"]), (req, res) => { res.sendFile("admin.html"); });',
        explanation: '使用角色权限中间件替代硬编码token',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function authenticate(username, password) { const query = `SELECT * FROM users WHERE username = ${username}`; db.query(query, (err, user) => { if (!user) return false; return bcrypt.compareSync(password, user.password); }); }',
        optimized: 'async function authenticate(username, password) { const user = await db.query("SELECT * FROM users WHERE username = ?", [username]); if (!user.length) return false; return bcrypt.compareSync(password, user[0].password); }',
        explanation: '参数化查询+异步认证',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'sessionStorage.setItem("user", JSON.stringify(userData));',
        optimized: 'const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "1h" }); res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "strict" });',
        explanation: '使用httpOnly Cookie存储JWT替代sessionStorage',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(express.json()); app.use("/api", routes);',
        optimized: 'const express = require("express"); const rateLimit = require("express-rate-limit"); const app = express(); app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })); app.use(express.json({ limit: "1mb" }));',
        explanation: '添加速率限制防止暴力破解',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const mysql = require("mysql"); const conn = mysql.createConnection({ host: "localhost", user: "root", password: "root", database: "app" });',
        optimized: 'const mysql = require("mysql2/promise"); const conn = mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: true } });',
        explanation: '使用环境变量和SSL连接数据库',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function escapeHtml(str) { const div = document.createElement("div"); div.appendChild(document.createTextNode(str)); return div.innerHTML; }',
        optimized: 'function escapeHtml(str) { const map = { amp: "&amp;", lt: "&lt", gt: "&gt", quot: "&quot", apos: "&#39;" }; return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;"); }',
        explanation: '使用链式replace转义HTML特殊字符防止XSS',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'var_dump($_GET["user"]);',
        optimized: 'echo htmlspecialchars($_GET["user"], ENT_QUOTES, "UTF-8");',
        explanation: '使用htmlspecialchars转义输出防止XSS',
        language: 'php',
        issueType: 'security'
      },
      {
        original: '$query = "SELECT * FROM users WHERE name = \'" . $_POST["name"] . "\'"; mysql_query($query);',
        optimized: '$stmt = $pdo->prepare("SELECT * FROM users WHERE name = ?"); $stmt->execute([$_POST["name"]]);',
        explanation: '使用PDO预处理语句防止SQL注入',
        language: 'php',
        issueType: 'security'
      },
      {
        original: 'const password = "secret123"; $hash = password_hash($password, PASSWORD_DEFAULT);',
        optimized: '$hash = password_hash("secret123", PASSWORD_DEFAULT); $valid = password_verify($input, $hash);',
        explanation: '使用PHP内建password_hash',
        language: 'php',
        issueType: 'security'
      },
      {
        original: '@app.route("/search") def search(): query = request.args.get("q") results = db.execute(f"SELECT * FROM products WHERE name LIKE \'%{query}%\'").fetchall() return render_template("results.html", results=results)',
        optimized: '@app.route("/search") def search(): query = request.args.get("q", "") results = db.execute("SELECT * FROM products WHERE name LIKE ?", (f"%{query}%",)).fetchall() return render_template("results.html", results=results)',
        explanation: '使用参数化查询防止SQL注入',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def send_email(to, subject, body): import smtplib server = smtplib.SMTP("smtp.example.com") server.sendmail("from@example.com", [to], f"Subject: {subject}\\n\\n{body}")',
        optimized: 'import smtplib from email.mime.text import MIMEText def send_email(to: str, subject: str, body: str): msg = MIMEText(body) msg["Subject"] = subject msg["From"] = "noreply@example.com" msg["To"] = to with smtplib.SMTP_SSL("smtp.example.com", 465) as server: server.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"]) server.send_message(msg)',
        explanation: '使用SMTP_SSL和环境变量保护凭据',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'const token = localStorage.getItem("auth_token"); fetch("/api/data", { headers: { "Authorization": "Bearer " + token } });',
        optimized: 'const token = getCookie("token"); fetch("/api/data", { headers: { "Authorization": `Bearer ${token}`, "X-Requested-With": "XMLHttpRequest" }, credentials: "include" });',
        explanation: '避免在localStorage存储token，使用httpOnly Cookie',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.collection("users").find({ $where: function() { return this.name == "admin" && this.password == "pass"; } });',
        optimized: 'db.collection("users").find({ name: "admin", password: "pass" });',
        explanation: '避免MongoDB $where注入，使用普通查询',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const mongoose = require("mongoose"); const userSchema = new mongoose.Schema({ name: String, role: String });',
        optimized: 'const userSchema = new mongoose.Schema({ name: { type: String, required: true, index: true }, role: { type: String, enum: ["user", "admin"], default: "user" } });',
        explanation: '使用Schema验证和枚举限制字段值',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const ObjectId = mongoose.Types.ObjectId; const id = req.params.id; User.findById(id, callback);',
        optimized: 'const { Types: { ObjectId } } = mongoose; if (!ObjectId.isValid(req.params.id)) return res.status(400).send("Invalid ID"); User.findById(req.params.id, callback);',
        explanation: '验证MongoDB ObjectId有效性',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function decodeToken(token) { return Buffer.from(token, "base64").toString("utf-8"); }',
        optimized: 'const jwt = require("jsonwebtoken"); function verifyToken(token) { try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; } }',
        explanation: '使用JWT验证替代Base64解码',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<!DOCTYPE html> <html> <head> <title>Page</title> </head> <body> <div id="app"></div> <script src="app.js"></script> </body> </html>',
        optimized: '<!DOCTYPE html> <html lang="en"> <head> <meta charset="UTF-8"> <meta name="viewport" content="width=device-width, initial-scale=1.0"> <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\';"> <title>Page</title> </head> <body> <div id="app"></div> <script src="app.js" nonce="abc123"></script> </body> </html>',
        explanation: '添加Content-Security-Policy头防止XSS',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const axios = require("axios"); const response = await axios.get(apiUrl, { headers: { "Authorization": "Bearer " + token } });',
        optimized: 'const axios = require("axios"); const httpsAgent = new https.Agent({ rejectUnauthorized: true }); const response = await axios.get(apiUrl, { headers: { "Authorization": `Bearer ${token}`, "X-API-Key": process.env.API_KEY }, httpsAgent, timeout: 5000, maxRedirects: 5 });',
        explanation: '添加API密钥、超时和HTTPS代理配置',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const sql = "SELECT * FROM users WHERE name = " + userInput; db.query(sql);',
        optimized: 'const sql = "SELECT * FROM users WHERE name = ?"; db.query(sql, [userInput]);',
        explanation: '始终使用预编译语句防止SQL注入',
        language: 'sql',
        issueType: 'security'
      },
      {
        original: 'const crypto = require("crypto"); const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv("aes-256-cbc", key, iv); let encrypted = cipher.update(data); encrypted = Buffer.concat([encrypted, cipher.final()]);',
        optimized: 'const crypto = require("crypto"); function encrypt(data, password) { const key = crypto.scryptSync(password, "salt", 32); const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final(), cipher.getAuthTag()]); return Buffer.concat([iv, encrypted]); }',
        explanation: '使用AES-256-GCM替代CBC模式，提供认证加密',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(express.static("public"));',
        optimized: 'const express = require("express"); const helmet = require("helmet"); const app = express(); app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["\'self\'"], scriptSrc: ["\'self\'"], styleSrc: ["\'self\'", "\'unsafe-inline\'"], imgSrc: ["\'self\'", "data:", "https://"] } } })); app.use(express.static("public", { maxAge: "1y", immutable: true }));',
        explanation: '配置完整的Helmet安全头',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'document.cookie = "session=" + token;',
        optimized: 'document.cookie = "session=" + token + "; HttpOnly; Secure; SameSite=Strict; Path=/";',
        explanation: '设置Cookie安全属性',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const fs = require("fs"); const config = JSON.parse(fs.readFileSync("config.json"));',
        optimized: 'const fs = require("fs"); const path = require("path"); const configPath = path.resolve(process.env.CONFIG_PATH || "config.json"); if (!fs.existsSync(configPath)) { throw new Error("Config not found"); } const config = JSON.parse(fs.readFileSync(configPath, "utf8"));',
        explanation: '使用环境变量指定配置路径，防止路径遍历',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'window.location.href = "/redirect?url=" + userInput;',
        optimized: 'const ALLOWED_HOSTS = ["example.com", "app.example.com"]; function safeRedirect(url) { try { const parsed = new URL(url); if (!ALLOWED_HOSTS.includes(parsed.hostname)) { throw new Error("Not allowed"); } window.location.href = url; } catch { window.location.href = "/"; } }',
        explanation: '验证重定向目标防止开放重定向攻击',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import hashlib hash = hashlib.md5(password.encode()).hexdigest()',
        optimized: 'import hashlib import salt = os.urandom(32) key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000) stored = salt + key',
        explanation: '使用PBKDF2替代MD5，添加随机盐',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'import os os.system("rm -rf " + user_input)',
        optimized: 'import subprocess subprocess.run(["rm", "-rf", safe_path], check=True)',
        explanation: '使用subprocess.run列表参数替代os.system',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def get_user(request): user_id = request.GET.get("id") return User.objects.get(id=user_id)',
        optimized: 'from django.core.exceptions import ValidationError def get_user(request): try: user_id = int(request.GET.get("id", 0)) except (ValueError, TypeError): raise ValidationError("Invalid user ID") return User.objects.get(id=user_id)',
        explanation: '验证输入类型防止注入',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'useEffect(() => { fetch(`/api/user/${userId}`).then(r => r.json()).then(setData); }, [userId]);',
        optimized: 'useEffect(() => { let cancelled = false; fetch(`/api/user/${encodeURIComponent(userId)}`).then(r => r.json()).then(data => { if (!cancelled) setData(data); }); return () => { cancelled = true; }; }, [userId]);',
        explanation: '使用cancelled标志防止竞态，编码URL参数',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: '<a href="javascript:alert(document.cookie)">Click</a>',
        optimized: '<a href="#" onclick="handleClick(event)">Click</a>',
        explanation: '避免使用javascript:协议，使用事件处理',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const WebSocket = require("ws"); const wss = new WebSocket.Server({ port: 8080 }); wss.on("connection", (ws) => { ws.on("message", (message) => { eval(message.toString()); }); });',
        optimized: 'const wss = new WebSocket.Server({ port: 8080, verifyClient: (info, cb) => { const token = info.req.headers["sec-websocket-protocol"]; verifyToken(token).then(valid => cb(valid)); } }); wss.on("connection", (ws) => { ws.on("message", (message) => { const data = validateMessage(JSON.parse(message.toString())); handleMessage(ws, data); }); });',
        explanation: '验证WebSocket连接和消息内容',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { createServer } = require("http"); const server = createServer((req, res) => { res.end(req.url); });',
        optimized: 'const { createServer } = require("http"); const server = createServer((req, res) => { const url = new URL(req.url, "http://localhost"); const sanitizedPath = sanitizePath(url.pathname); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ path: sanitizedPath })); });',
        explanation: '使用URL对象解析和验证路径',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'localStorage.setItem("user", JSON.stringify(user));',
        optimized: 'const encrypted = CryptoJS.AES.encrypt(JSON.stringify(user), process.env.STORAGE_KEY); sessionStorage.setItem("user", encrypted.toString());',
        explanation: '加密存储敏感数据，使用sessionStorage限制生命周期',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.collection("orders").aggregate([{ $match: req.body.filter }, { $group: { _id: "$category", total: { $sum: "$amount" } } }]);',
        optimized: 'const sanitizeFilter = (filter) => { const allowed = ["status", "category", "date"]; const result = {}; for (const key of allowed) { if (filter[key] !== undefined) result[key] = filter[key]; } return result; }; const filter = sanitizeFilter(req.body.filter); db.collection("orders").aggregate([{ $match: filter }, { $group: { _id: "$category", total: { $sum: "$amount" } } }]);',
        explanation: '白名单过滤用户输入的MongoDB查询条件',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'rateLimit({ windowMs: 60000, max: 10000 })',
        optimized: 'rateLimit({ windowMs: 60000, max: 100, skip: (req) => req.ip === "127.0.0.1", standardHeaders: true, legacyHeaders: false })',
        explanation: '合理配置速率限制，排除内部IP',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(bodyParser.json({ limit: "50mb" }));',
        optimized: 'const app = express(); app.use(express.json({ limit: "1mb" })); app.use(express.urlencoded({ extended: true, limit: "1mb" }));',
        explanation: '限制请求体大小防止DoS攻击',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import requests response = requests.get(user_input_url)',
        optimized: 'import requests from urllib.parse import urlparse def safe_fetch(url): parsed = urlparse(url) if parsed.scheme not in ("http", "https"): raise ValueError("Invalid scheme") if parsed.hostname in ("localhost", "127.0.0.1"): raise ValueError("Internal URL blocked") return requests.get(url, timeout=5)',
        explanation: '验证URL防止SSRF攻击',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'function handleFileUpload(file) { const reader = new FileReader(); reader.onload = (e) => { eval(e.target.result); }; reader.readAsText(file); }',
        optimized: 'function handleFileUpload(file) { if (!ALLOWED_TYPES.includes(file.type)) return alert("Invalid file type"); if (file.size > MAX_SIZE) return alert("File too large"); const reader = new FileReader(); reader.onload = (e) => { processConfig(JSON.parse(e.target.result)); }; reader.readAsText(file); }',
        explanation: '验证文件类型和大小，使用JSON.parse替代eval',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const session = require("express-session"); app.use(session({ secret: "keyboard cat", resave: false, saveUninitialized: true }));',
        optimized: 'const session = require("express-session"); const RedisStore = require("connect-redis")(session); app.use(session({ store: new RedisStore({ client: redisClient }), secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: true, httpOnly: true, sameSite: "strict", maxAge: 3600000 } }));',
        explanation: '使用Redis存储会话，配置安全Cookie',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'var_dump($_COOKIE);',
        optimized: 'setcookie("session", $token, [\'httponly\' => true, \'secure\' => true, \'samesite\' => \'Strict\', \'expires\' => time() + 3600]);',
        explanation: '配置安全的PHP会话Cookie',
        language: 'php',
        issueType: 'security'
      },
      {
        original: 'def login(request): username = request.POST["username"] password = request.POST["password"] user = User.objects.get(username=username) if user.check_password(password): login(request, user)',
        optimized: 'from django.contrib.auth import authenticate, login def login_view(request): if request.method == "POST": username = request.POST.get("username", "") password = request.POST.get("password", "") user = authenticate(request, username=username, password=password) if user is not None and user.is_active: login(request, user) else: return render(request, "login.html", {"error": "Invalid credentials"})',
        explanation: '使用Django认证系统，检查is_active',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'window.addEventListener("message", (e) => { const data = e.data; eval(data); });',
        optimized: 'window.addEventListener("message", (e) => { if (e.origin !== "https://trusted-source.com") return; const data = JSON.parse(e.data); if (data.type === "CONFIG") updateConfig(data.payload); });',
        explanation: '验证postMessage来源和格式',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { exec } = require("child_process"); exec("ls " + user_input, (err, stdout) => { console.log(stdout); });',
        optimized: 'const { execFile } = require("child_process"); const path = require("path"); const safePath = path.resolve(userInput); if (!safePath.startsWith("/allowed/dir")) { return callback(new Error("Forbidden")); } execFile("ls", [safePath], (err, stdout) => { console.log(stdout); });',
        explanation: '使用execFile和路径验证防止命令注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import subprocess result = subprocess.check_output("netstat -an", shell=True)',
        optimized: 'import subprocess result = subprocess.check_output(["netstat", "-an"], shell=False)',
        explanation: '避免shell=True防止命令注入',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'const jwt = require("jsonwebtoken"); const token = jwt.sign({ user: data }, "secret");',
        optimized: 'const jwt = require("jsonwebtoken"); const token = jwt.sign({ sub: userId, role: userRole }, process.env.JWT_SECRET, { algorithm: "RS256", expiresIn: "15m", jwtid: uuid });',
        explanation: '使用RS256非对称加密，短过期时间，唯一jti',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'SELECT * FROM users WHERE email = "user@example.com"',
        optimized: 'SELECT id, name, email, created_at FROM users WHERE email = ?',
        explanation: '只查询需要的字段，避免SELECT *',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders WHERE user_id = 123 ORDER BY created_at DESC',
        optimized: 'CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC); SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        explanation: '创建复合索引优化排序查询，添加LIMIT',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT COUNT(*) FROM users WHERE status = "active"',
        optimized: 'CREATE INDEX idx_users_status ON users(status); SELECT COUNT(*) FROM users WHERE status = ?',
        explanation: '为WHERE条件创建索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM products WHERE name LIKE "%phone%"',
        optimized: 'ALTER TABLE products ADD FULLTEXT INDEX ft_name(name); SELECT * FROM products WHERE MATCH(name) AGAINST("phone" IN NATURAL LANGUAGE MODE)',
        explanation: '使用全文索引替代LIKE模糊查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'DELETE FROM logs WHERE created_at < "2023-01-01"',
        optimized: 'DELETE FROM logs WHERE created_at < ? LIMIT 1000',
        explanation: '分批删除大量数据，避免锁表',
        language: 'sql',
        issueType: 'reliability'
      },
      {
        original: 'SELECT * FROM users WHERE id IN (1, 2, 3, 4, 5)',
        optimized: 'SELECT * FROM users WHERE id IN (?)',
        explanation: '使用参数化IN查询',
        language: 'sql',
        issueType: 'security'
      },
      {
        original: 'UPDATE products SET stock = stock - 1 WHERE id = 1',
        optimized: 'UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0',
        explanation: '添加条件防止超卖，原子操作',
        language: 'sql',
        issueType: 'reliability'
      },
      {
        original: 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id',
        optimized: 'CREATE INDEX idx_orders_user_id ON orders(user_id); SELECT o.*, u.name FROM orders o JOIN users u ON o.user_id = u.id',
        explanation: '确保JOIN字段有索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const mysql = require("mysql"); const connection = mysql.createConnection({ host: "localhost", user: "root", password: "pass", database: "app" });',
        optimized: 'const mysql = require("mysql2/promise"); const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 10, queueLimit: 0 });',
        explanation: '使用连接池替代单连接，支持多连接复用',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'const redis = require("redis"); const client = redis.createClient(); await client.set("user:1", JSON.stringify(userData));',
        optimized: 'const redis = require("redis"); const client = redis.createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: 1 } }); async function getUser(id) { const cached = await client.get(`user:${id}`); if (cached) return JSON.parse(cached); const user = await db.getUser(id); await client.setEx(`user:${id}`, 3600, JSON.stringify(user)); return user; }',
        explanation: '使用Redis缓存数据库查询结果，设置TTL',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'class User(BaseModel): name = CharField() email = CharField() class Meta: db_table = "users"',
        optimized: 'class User(BaseModel): name = CharField(max_length=100, db_index=True) email = CharField(max_length=255, unique=True) class Meta: db_table = "users" indexes = ( (("name", "email"), True), )',
        explanation: '添加字段约束和复合索引',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.session.query(User).filter(User.status == "active").all()',
        optimized: 'db.session.query(User).filter(User.status == "active").order_by(User.created_at.desc()).limit(20).all()',
        explanation: '添加排序和分页，避免全表扫描',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'const User = mongoose.model("User", userSchema); User.find({}).exec(callback);',
        optimized: 'User.find({ status: "active" }).select("name email -_id").lean().limit(20).exec(callback);',
        explanation: '使用lean()返回纯JSON，select选择字段，limit分页',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.collection("users").find({}).toArray(function(err, users) { ... });',
        optimized: 'db.collection("users").find({ status: "active" }).project({ name: 1, email: 1, _id: 0 }).limit(20).toArray(...);',
        explanation: '使用project投影字段，limit限制结果',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE age > 20 AND city = "Beijing"',
        optimized: 'CREATE INDEX idx_users_city_age ON users(city, age); SELECT * FROM users WHERE city = ? AND age > ?',
        explanation: '创建索引覆盖WHERE条件，等值条件在前',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'UPDATE orders SET status = "shipped" WHERE id = 123',
        optimized: 'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ? AND status = ?',
        explanation: '添加乐观锁检查防止状态冲突',
        language: 'sql',
        issueType: 'reliability'
      },
      {
        original: 'async function getUsers() { const users = await db.query("SELECT * FROM users"); const posts = await db.query("SELECT * FROM posts"); return { users, posts }; }',
        optimized: 'async function getUsers() { const [users, posts] = await Promise.all([db.query("SELECT * FROM users"), db.query("SELECT * FROM posts")]); return { users, posts }; }',
        explanation: '使用Promise.all并行查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'def get_user_orders(user_id): user = User.query.get(user_id) orders = Order.query.filter_by(user_id=user_id).all() return user, orders',
        optimized: 'def get_user_orders(user_id): user, orders = db_session.query(User, Order).outerjoin(Order, Order.user_id == User.id).filter(User.id == user_id).first() return user, orders',
        explanation: '使用JOIN查询替代两次查询',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'const cache = {} function getExpensiveData(key) { if (cache[key]) { return cache[key]; } const result = db.query("SELECT * FROM data WHERE key = ?", [key]); cache[key] = result; return result; }',
        optimized: 'const NodeCache = require("node-cache"); const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); async function getExpensiveData(key) { const cached = cache.get(key); if (cached) return cached; const result = await db.query("SELECT * FROM data WHERE key = ?", [key]); cache.set(key, result); return result; }',
        explanation: '使用NodeCache自动管理缓存过期',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))',
        optimized: 'cursor.execute("SELECT id, name, email FROM users WHERE id = %s", (user_id,))',
        explanation: '只查询需要的字段',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM products WHERE category_id IN (SELECT id FROM categories WHERE parent_id = 1)',
        optimized: 'SELECT p.* FROM products p JOIN categories c ON p.category_id = c.id WHERE c.parent_id = 1 CREATE INDEX idx_categories_parent ON categories(parent_id)',
        explanation: '使用JOIN替代子查询，性能更优',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.collection("logs").aggregate([{ $group: { _id: "$userId", count: { $sum: 1 } } }]);',
        optimized: 'db.collection("logs").aggregate([{ $match: { createdAt: { $gte: startDate } } }, { $group: { _id: "$userId", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }]);',
        explanation: '添加$match过滤数据，减少聚合计算量',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { Sequelize } = require("sequelize"); const sequelize = new Sequelize("db", "user", "pass", { host: "localhost" });',
        optimized: 'const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, { host: process.env.DB_HOST, dialect: "mysql", pool: { max: 10, min: 2, acquire: 30000, idle: 10000 }, logging: false });',
        explanation: '配置连接池和日志选项',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'SELECT * FROM users WHERE name LIKE "John%"',
        optimized: 'CREATE INDEX idx_users_name ON users(name); SELECT * FROM users WHERE name LIKE "John%"',
        explanation: '为前缀LIKE查询创建索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'function getUserPosts(userId) { const posts = db.query("SELECT * FROM posts WHERE user_id = " + userId); return posts; }',
        optimized: 'async function getUserPosts(userId) { const posts = await db.query("SELECT p.id, p.title, p.created_at FROM posts p WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 50", [userId]); return posts; }',
        explanation: '参数化查询+分页+指定字段',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'data = MyModel.objects.all() result = [item.serialize() for item in data]',
        optimized: 'result = list(MyModel.objects.values("id", "name", "created_at").filter(status="active")[:100])',
        explanation: '使用values()和切片减少数据传输',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'INSERT INTO users (name, email) VALUES ("Alice", "alice@test.com")',
        optimized: 'INSERT INTO users (name, email) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
        explanation: '使用ON DUPLICATE KEY UPDATE实现upsert',
        language: 'sql',
        issueType: 'reliability'
      },
      {
        original: 'SELECT * FROM orders WHERE user_id = 1 ORDER BY created_at',
        optimized: 'SELECT * FROM orders WHERE user_id = 1 ORDER BY created_at LIMIT 0, 20',
        explanation: '添加LIMIT限制返回行数',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'class Order(db.Model): id = db.Column(db.Integer, primary_key=True) user_id = db.Column(db.Integer) status = db.Column(db.String) amount = db.Column(db.Float)',
        optimized: 'class Order(db.Model): __tablename__ = "orders" id = db.Column(db.Integer, primary_key=True, autoincrement=True) user_id = db.Column(db.Integer, db.ForeignKey("users.id"), index=True, nullable=False) status = db.Column(db.String(20), index=True, default="pending") amount = db.Column(db.Numeric(12, 2), nullable=False) __table_args__ = (db.Index("idx_user_status", "user_id", "status"),)',
        explanation: '添加外键、索引、约束和复合索引',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'const db = firebase.firestore(); const snapshot = await db.collection("users").get();',
        optimized: 'const snapshot = await db.collection("users").where("status", "==", "active").orderBy("created_at", "desc").limit(20).get();',
        explanation: '使用where+orderBy+limit优化Firestore查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT SUM(amount) FROM orders WHERE user_id = 123',
        optimized: 'CREATE INDEX idx_orders_user_amount ON orders(user_id, amount); SELECT SUM(amount) FROM orders WHERE user_id = 123',
        explanation: '创建覆盖索引优化聚合查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = await db.query("SELECT * FROM products WHERE price > 100");',
        optimized: 'const [result] = await db.execute("SELECT id, name, price FROM products WHERE price > ? ORDER BY price LIMIT ?", [100, 50]);',
        explanation: '使用预处理语句，指定字段和排序',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function searchProducts(keyword) { return db.query("SELECT * FROM products WHERE name LIKE \'%" + keyword + "%\'"); }',
        optimized: 'async function searchProducts(keyword) { const [rows] = await db.execute("SELECT id, name, price FROM products WHERE name LIKE ? LIMIT 20", [`%${keyword}%`]); return rows; }',
        explanation: '参数化LIKE查询，添加LIMIT',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import psycopg2 conn = psycopg2.connect(host="localhost", dbname="app") cur = conn.cursor() cur.execute("SELECT * FROM users")',
        optimized: 'import psycopg2 from psycopg2.pool import SimpleConnectionPool pool = SimpleConnectionPool(1, 10, host="localhost", dbname="app") conn = pool.getconn() cur = conn.cursor() cur.execute("SELECT id, name FROM users WHERE active = %s LIMIT %s", (True, 100))',
        explanation: '使用连接池和参数化查询',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'SELECT * FROM users WHERE created_at BETWEEN "2023-01-01" AND "2023-12-31"',
        optimized: 'CREATE INDEX idx_users_created_at ON users(created_at); SELECT id, name FROM users WHERE created_at BETWEEN ? AND ? ORDER BY created_at LIMIT 100',
        explanation: '为时间范围查询创建索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const DataStore = require("nedb"); const db = new DataStore({ filename: "data.db", autoload: true });',
        optimized: 'const { MongoClient } = require("mongodb"); const client = new MongoClient(uri, { maxPoolSize: 10, w: 1 }); await client.connect(); const db = client.db("app");',
        explanation: '使用MongoDB替代NeDB，支持连接池和W协议',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'user = User.objects.get(id=1) posts = Post.objects.filter(user=user) comments = Comment.objects.filter(post__in=posts)',
        optimized: 'user = User.objects.select_related().get(id=1) posts = Post.objects.filter(user=user).select_related("category") comments = Comment.objects.filter(post__in=posts).only("id", "content")',
        explanation: '使用select_related和only减少查询量',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)")',
        optimized: 'db.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"); db.run("CREATE INDEX idx_users_email ON users(email)");',
        explanation: '添加约束、默认值和索引',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'async function getProfile(userId) { const user = await User.findById(userId); const posts = await Post.find({ userId }); const followers = await Follower.countDocuments({ userId }); return { user, posts, followers }; }',
        optimized: 'async function getProfile(userId) { const [user, posts, followers] = await Promise.all([User.findById(userId).select("-password"), Post.find({ userId }).sort("-createdAt").limit(10), Follower.countDocuments({ userId })]); return { user, posts, followers }; }',
        explanation: '并行查询+排除敏感字段+限制结果',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM products WHERE description LIKE "%excellent%"',
        optimized: 'ALTER TABLE products ADD FULLTEXT INDEX ft_description(description); SELECT * FROM products WHERE MATCH(description) AGAINST(\'excellent\' IN BOOLEAN MODE)',
        explanation: '全文索引替代%LIKE%，支持中文分词',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'for (const item of items) { await db.query("INSERT INTO items (name) VALUES (?)", [item.name]); }',
        optimized: 'await db.query("INSERT INTO items (name) VALUES " + items.map(() => "(?)").join(","), items.map(i => [i.name]));',
        explanation: '批量插入替代逐条插入',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const Objection = require("objection"); const knex = require("knex"); const db = knex({ client: "pg", connection: "postgres://localhost/app" });',
        optimized: 'const knex = require("knex")({ client: "pg", connection: { host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME, port: 5432, ssl: { require: true, rejectUnauthorized: false } }, pool: { min: 2, max: 10 }, migrations: { tableName: "knex_migrations" } });',
        explanation: '配置Knex连接池和SSL',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'SELECT * FROM orders WHERE MONTH(created_at) = 6',
        optimized: 'CREATE INDEX idx_orders_created_at ON orders(created_at); SELECT * FROM orders WHERE created_at >= "2023-06-01" AND created_at < "2023-07-01"',
        explanation: '避免在WHERE中使用函数，改用范围查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'result = db.execute("SELECT * FROM products WHERE name LIKE ? AND price > ?", (keyword, minPrice))',
        optimized: 'result = db.execute("SELECT id, name, price, stock FROM products WHERE name LIKE ? AND price > ? ORDER BY price LIMIT ?", (f"%{keyword}%", minPrice, 50))',
        explanation: '添加排序、LIMIT和指定字段',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'User.updateMany({ role: "temp" }, { $set: { role: "user" } })',
        optimized: 'User.updateMany({ role: "temp", expiresAt: { $lt: new Date() } }, { $set: { role: "user" } }, { multi: true, writeConcern: { w: 1 } })',
        explanation: '添加查询条件和写关注',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'cursor.execute("SELECT * FROM orders") rows = cursor.fetchall() for row in rows: process(row)',
        optimized: 'cursor.execute("SELECT id, status, amount FROM orders WHERE status = %s", ("pending",)) while True: rows = cursor.fetchmany(1000) if not rows: break for row in rows: process(row)',
        explanation: '使用fetchmany分批获取，避免内存溢出',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'const redis = require("redis"); const client = redis.createClient(); client.hset("user:1", "name", "Alice", "email", "alice@test.com");',
        optimized: 'const redis = require("redis"); const client = redis.createClient(); async function cacheUser(user) { const key = `user:${user.id}`; await client.hSet(key, { name: user.name, email: user.email, updated: Date.now() }); await client.expire(key, 3600); }',
        explanation: '使用Hash存储用户数据，设置过期时间',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM notifications WHERE user_id = 1 AND read = false',
        optimized: 'CREATE INDEX idx_notifications_user_read ON notifications(user_id, read); SELECT id, message, created_at FROM notifications WHERE user_id = ? AND read = false ORDER BY created_at DESC LIMIT 20',
        explanation: '创建复合索引+排序+分页',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient();',
        optimized: 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, log: ["warn", "error"] });',
        explanation: '使用环境变量配置Prisma连接',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'db.session.query(User).filter(User.name.like("%" + name + "%")).all()',
        optimized: 'db.session.query(User).filter(User.name.ilike("%" + name + "%")).limit(20).all()',
        explanation: '使用ilike不区分大小写+limit',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM audit_log WHERE action = "login" ORDER BY timestamp',
        optimized: 'CREATE TABLE audit_log ( id BIGSERIAL PRIMARY KEY, user_id INT NOT NULL, action VARCHAR(50) NOT NULL, details JSONB, timestamp TIMESTAMPTZ DEFAULT NOW() ); CREATE INDEX idx_audit_log_action_time ON audit_log(action, timestamp DESC); SELECT user_id, timestamp FROM audit_log WHERE action = ? ORDER BY timestamp DESC LIMIT 100',
        explanation: '重建表结构+GIN索引+分区表',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'async function batchUpdate(ids, status) { for (const id of ids) { await db.query("UPDATE users SET status = ? WHERE id = ?", [status, id]); } }',
        optimized: 'async function batchUpdate(ids, status) { const placeholders = ids.map(() => "?").join(","); await db.query(`UPDATE users SET status = ? WHERE id IN (${placeholders})`, [status, ...ids]); }',
        explanation: '使用IN查询批量更新',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id WHERE u.status = "active"',
        optimized: 'CREATE INDEX idx_users_status ON users(status); CREATE INDEX idx_orders_user ON orders(user_id); SELECT u.id, u.name, o.total FROM users u INNER JOIN orders o ON u.id = o.user_id WHERE u.status = ?',
        explanation: '确保JOIN和WHERE字段都有索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const cache = {} function getCachedData(key) { if (cache[key]) { return cache[key]; } const data = expensiveQuery(key); cache[key] = data; return data; }',
        optimized: 'const LRU = require("lru-cache"); const cache = new LRU({ max: 500, ttl: 1000 * 60 * 5 }); async function getCachedData(key) { let data = cache.get(key); if (data) return data; data = await expensiveQuery(key); cache.set(key, data); return data; }',
        explanation: '使用LRU缓存替代简单对象缓存',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'class CustomModel(models.Model): name = models.CharField(max_length=100) class Meta: managed = False',
        optimized: 'class CustomModel(models.Model): name = models.CharField(max_length=100, validators=[validate_name]) class Meta: indexes = [models.Index(fields=["name"])] ordering = ["-name"]',
        explanation: '添加模型验证器和索引',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'const db = require("better-sqlite3")("app.db"); const stmt = db.prepare("SELECT * FROM users WHERE id = ?"); const user = stmt.get(userId);',
        optimized: 'const db = require("better-sqlite3")("app.db"); db.pragma("journal_mode = WAL"); db.pragma("synchronous = NORMAL"); const stmt = db.prepare("SELECT id, name, email FROM users WHERE id = ?"); const user = stmt.get(userId);',
        explanation: '启用WAL模式提高并发读写性能',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE email = "test@test.com" OR username = "test"',
        optimized: 'CREATE UNIQUE INDEX idx_users_email ON users(email); CREATE INDEX idx_users_username ON users(username); SELECT * FROM users WHERE email = ? OR username = ?',
        explanation: '为OR条件的每个字段创建索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'function UserService() { this.users = db.query("SELECT * FROM users"); }',
        optimized: 'async function getUsers(options = {}) { const { page = 1, limit = 20, status } = options; const offset = (page - 1) * limit; const query = "SELECT id, name, email, created_at FROM users"; const params = []; if (status) { query += " WHERE status = ?"; params.push(status); } query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"; params.push(limit, offset); const [rows] = await db.execute(query, params); return rows; }',
        explanation: '构建灵活的分页查询函数',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const Sequelize = require("sequelize"); const sequelize = new Sequelize("sqlite::memory:");',
        optimized: 'const sequelize = new Sequelize({ dialect: "sqlite", storage: "./app.db", pool: { max: 5, min: 1 }, logging: console.log, define: { timestamps: true, underscored: true } });',
        explanation: '配置Sequelize连接池和模型选项',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'function App() { const [count, setCount] = useState(0); return <div onClick={() => setCount(count + 1)}>Count: {count}</div>; }',
        optimized: 'const App = () => { const [count, setCount] = useState(0); return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>; };',
        explanation: '使用函数式更新避免闭包陷阱，用button替代div',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: 'useEffect(() => { fetchData(); });',
        optimized: 'useEffect(() => { let cancelled = false; fetchData().then(data => { if (!cancelled) setData(data); }); return () => { cancelled = true; }; }, []);',
        explanation: '添加依赖数组和清理函数防止内存泄漏',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: 'const UserList = (props) => { const users = props.users.filter(u => u.active); return <div>{users.map(u => <div key={u.id}>{u.name}</div>)}</div>; };',
        optimized: 'const UserList = ({ users }) => { const activeUsers = useMemo(() => users.filter(u => u.active), [users]); return <div>{activeUsers.map(u => <div key={u.id}>{u.name}</div>)}</div>; };',
        explanation: '使用useMemo缓存过滤结果，避免每次渲染重新计算',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: 'function Product({ product }) { return <div className="product"><h3>{product.name}</h3><p>{product.description}</p><span>${product.price}</span></div>; }',
        optimized: 'const Product = memo(function Product({ product }) { return <div className="product"><h3>{product.name}</h3><p>{product.description}</p><span>${product.price}</span></div>; });',
        explanation: '使用React.memo避免不必要的重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: 'const App = () => { const [data, setData] = useState({}); const [loading, setLoading] = useState(false); const [error, setError] = useState(null); return <div>...</div>; };',
        optimized: 'const App = () => { const { data, loading, error } = useFetch("/api/data"); return <div>...</div>; };',
        explanation: '使用自定义Hook封装数据获取逻辑',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const items = [1, 2, 3]; const listItems = items.map(item => <li>{item}</li>);',
        optimized: 'const items = [1, 2, 3]; const listItems = items.map(item => <li key={item}>{item}</li>);',
        explanation: '为列表元素添加唯一key属性',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: '@app.get("/api/user") def get_user(): return {"name": "Alice", "age": 25}',
        optimized: '@app.get("/api/user", response_model=UserResponse) def get_user(): return UserResponse(name="Alice", age=25)',
        explanation: '使用Pydantic响应模型自动校验和文档化',
        language: 'python',
        issueType: 'type_safety'
      },
      {
        original: '<div :class="{ active: isActive, disabled: isDisabled }">Content</div>',
        optimized: '<div :class="[{ active: isActive }, { disabled: isDisabled }]">Content</div>',
        explanation: 'Vue使用数组语法绑定多个类',
        language: 'html',
        issueType: 'code_simplification'
      },
      {
        original: 'const data = reactive({ count: 0 }); data.count++;',
        optimized: 'const data = ref(0); data.value++;',
        explanation: 'Vue3中使用ref替代reactive处理原始类型',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'computed: { filteredList() { return this.list.filter(item => item.active); } }',
        optimized: 'const filteredList = computed(() => list.value.filter(item => item.active));',
        explanation: 'Vue3 Composition API使用computed',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '<style>.container { display: flex; flex-direction: row; justify-content: center; align-items: center; }</style>',
        optimized: '.container { display: flex; justify-content: center; align-items: center; }',
        explanation: '简化flex布局，flex-direction默认row',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.box { margin-top: 10px; margin-right: 20px; margin-bottom: 10px; margin-left: 20px; }',
        optimized: '.box { margin: 10px 20px; }',
        explanation: '使用简写属性替代单独设置四个方向',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '#header { background-color: #ff0000; color: #ffffff; font-size: 16px; }',
        optimized: '#header { background: #f00; color: #fff; font-size: 1rem; }',
        explanation: '使用简写和短颜色值，rem单位更灵活',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '@media screen and (min-width: 768px) and (max-width: 1024px) { .container { width: 800px; } }',
        optimized: '@media (min-width: 768px) { .container { max-width: 800px; width: 90%; } }',
        explanation: '简化媒体查询，使用max-width实现响应式',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '<img src="image.jpg" alt="product" width="800" height="600">',
        optimized: '<img src="image.jpg" alt="product" width="800" height="600" loading="lazy" decoding="async">',
        explanation: '添加lazy加载和异步解码优化性能',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '<div onclick="handleClick()">Click me</div>',
        optimized: '<button @click="handleClick">Click me</button>',
        explanation: '使用button替代div添加事件，更好的语义和可访问性',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<form> <input type="text" id="name"> <input type="submit"> </form>',
        optimized: '<form aria-label="User form"> <input type="text" id="name" name="name" required aria-required="true" aria-label="User name"> <input type="submit" value="Submit"> </form>',
        explanation: '添加ARIA属性提升可访问性',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: 'const store = createStore(reducer);',
        optimized: 'const store = configureStore({ reducer: rootReducer, middleware: [thunk, logger] });',
        explanation: '使用Redux Toolkit的configureStore',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function reducer(state, action) { switch (action.type) { case "INCREMENT": return { ...state, count: state.count + 1 }; case "DECREMENT": return { ...state, count: state.count - 1 }; default: return state; } }',
        optimized: 'const counterSlice = createSlice({ name: "counter", initialState: { count: 0 }, reducers: { increment: state => { state.count++ }, decrement: state => { state.count-- } } });',
        explanation: '使用Redux Toolkit的createSlice简化reducer',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const App = () => { const [user, setUser] = useState(null); useEffect(() => { fetch("/api/user").then(r => r.json()).then(setUser); }, []); if (!user) return <Loading />; return <Dashboard user={user} />; };',
        optimized: 'const App = () => { const { data: user, isLoading } = useQuery("user", fetchUser); if (isLoading) return <Loading />; return <Dashboard user={user} />; };',
        explanation: '使用React Query管理服务端状态',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function App() { const inputRef = useRef(); const handleFocus = () => inputRef.current.focus(); return <input ref={inputRef} />; }',
        optimized: 'const App = () => { const inputRef = useRef(null); const handleFocus = () => inputRef.current?.focus(); return <input ref={inputRef} />; };',
        explanation: '使用可选链和null初始值的useRef',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const withAuth = (Component) => { return class extends React.Component { constructor(props) { super(props); this.state = { isAuth: false }; } componentDidMount() { checkAuth().then(authed => this.setState({ isAuth: authed })); } render() { if (!this.state.isAuth) return null; return <Component {...this.props} />; } }; };',
        optimized: 'const withAuth = (Component) => (props) => { const { isAuth } = useAuth(); if (!isAuth) return <Redirect to="/login" />; return <Component {...props} />; };',
        explanation: '使用Hooks简化高阶组件',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '.card { box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1); border-radius: 5px; padding: 20px; }',
        optimized: '.card { box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); border-radius: 0.5rem; padding: 1.25rem; }',
        explanation: '使用rem单位和简化数值优化响应式',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '.gradient { background: linear-gradient(to right, #ff0000, #00ff00, #0000ff); }',
        optimized: '.gradient { background: linear-gradient(90deg, #f00, #0f0, #00f); }',
        explanation: '使用短颜色值和deg单位简化渐变',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.container { display: grid; grid-template-columns: 1fr 1fr 1fr; grid-gap: 10px; }',
        optimized: '.container { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.625rem; }',
        explanation: '使用repeat函数简化网格和gap替代grid-gap',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: 'const router = createBrowserRouter([ { path: "/", element: <Home /> }, { path: "/about", element: <About /> }, ]);',
        optimized: 'const router = createBrowserRouter([ { path: "/", element: <Home />, children: [{ path: "about", element: <About /> }] }, ]);',
        explanation: '使用嵌套路由简化路由配置',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const Navbar = () => { const [isOpen, setIsOpen] = useState(false); return <nav>{isOpen && <Menu />}</nav>; };',
        optimized: 'const Navbar = () => { const [isOpen, setIsOpen] = useState(false); return <nav><button aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>Menu</button>{isOpen && <Menu />}</nav>; };',
        explanation: '添加aria-expanded提升可访问性',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const items = [1, 2, 3]; const total = items.reduce((a, b) => a + b, 0);',
        optimized: 'const total = [1, 2, 3].reduce((a, b) => a + b, 0);',
        explanation: '直接在表达式上调用reduce',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '<template> <div v-for="item in items" :key="item.id"> {{ item.name }} </div> </template>',
        optimized: '<template> <div v-for="(item, index) in items" :key="item.id || index"> {{ item.name }} </div> </template>',
        explanation: '使用index作为key的fallback',
        language: 'html',
        issueType: 'bug_fix'
      },
      {
        original: '<div v-if="show" v-else>Hidden</div>',
        optimized: '<div v-show="show">Content</div>',
        explanation: '频繁切换使用v-show替代v-if',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '@keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } } .fade-in { animation: fadeIn 1s ease-in; }',
        optimized: '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } } .fade-in { animation: fadeIn 0.3s ease-out; }',
        explanation: '使用from/to简化关键帧，缩短动画时间',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.flex { display: flex; flex-direction: column; flex-wrap: wrap; justify-content: flex-start; align-items: flex-start; align-content: flex-start; }',
        optimized: '.flex { display: flex; flex-flow: column wrap; justify-content: flex-start; }',
        explanation: '使用flex-flow简化flex-direction+flex-wrap',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: 'const useLocalStorage = (key, initial) => { const [value, setValue] = useState(() => { const item = localStorage.getItem(key); return item ? JSON.parse(item) : initial; }); useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]); return [value, setValue]; };',
        optimized: 'const useLocalStorage = (key, initial) => { const [value, setValue] = useState(() => { try { const item = localStorage.getItem(key); return item ? JSON.parse(item) : initial; } catch { return initial; } }); useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]); return [value, setValue]; };',
        explanation: '添加try-catch处理localStorage异常',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: 'const App = () => { const [count, setCount] = useState(0); const handleClick = () => setCount(count + 1); return <button onClick={handleClick}>Click</button>; };',
        optimized: 'const App = () => { const [count, setCount] = useState(0); const handleClick = useCallback(() => setCount(c => c + 1), []); return <button onClick={handleClick}>Click</button>; };',
        explanation: '使用useCallback缓存事件处理函数',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '.modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 400px; height: 300px; }',
        optimized: '.modal { position: fixed; inset: 0; margin: auto; width: min(90vw, 400px); height: min(80vh, 300px); display: grid; place-items: center; }',
        explanation: '使用inset和min实现响应式居中',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '<img src="logo.png" alt="">',
        optimized: '<img src="logo.png" alt="Company Logo" width="200" height="50">',
        explanation: '添加有意义的alt文本和尺寸',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: 'const routes = [ { path: "/", component: Home }, { path: "/about", component: About }, { path: "/contact", component: Contact } ];',
        optimized: 'const routes = [ { path: "/", element: <Home /> }, { path: "/about", element: <About /> }, { path: "/contact", element: <Contact /> } ];',
        explanation: '使用React Router v6的element属性替代component',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const store = useReducer(reducer, initialState); const [state, dispatch] = store;',
        optimized: 'const [state, dispatch] = useReducer(reducer, initialState);',
        explanation: '简化useReducer返回值解构',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '.button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }',
        optimized: '.btn { background: var(--primary); color: var(--text-inverse); padding: 0.625rem 1.25rem; border: none; border-radius: 0.25rem; cursor: pointer; transition: background 0.2s; } .btn:hover { background: var(--primary-dark); }',
        explanation: '使用CSS变量和rem单位优化主题切换',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '<h1 style="color: red; font-size: 24px;">Title</h1>',
        optimized: '<h1 class="title">Title</h1> .title { color: var(--danger); font-size: 1.5rem; }',
        explanation: '使用CSS类替代内联样式',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: 'const App = () => { const data = useSelector(state => state.data); const dispatch = useDispatch(); return <div>{data.map(item => <span key={item.id}>{item.name}</span>)}</div>; };',
        optimized: 'const App = () => { const data = useSelector(selectData); const dispatch = useDispatch(); return <div>{data.map(item => <span key={item.id}>{item.name}</span>)}</div>; };',
        explanation: '使用memoized selector优化Redux性能',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: 'const Nav = () => { return <nav><a href="/home">Home</a><a href="/about">About</a></nav>; };',
        optimized: 'const Nav = () => { return <nav><Link to="/home">Home</Link><Link to="/about">About</Link></nav>; };',
        explanation: '使用Link组件避免页面刷新',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '.loading { display: none; } .loading.active { display: block; }',
        optimized: '.loading { display: none; &.active { display: block; } }',
        explanation: '使用嵌套语法简化CSS选择器',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: 'const products = [{ id: 1, name: "Laptop", price: 999 }, { id: 2, name: "Mouse", price: 29 }]; const list = products.map(p => <ProductCard key={p.id} product={p} />);',
        optimized: 'const list = products.map(p => <ProductCard key={p.id} product={p} />); const ProductCard = memo(({ product }) => (<div>{product.name}: ${product.price}</div>));',
        explanation: '将ProductCard提取为memoized组件',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: 'const config = { host: "localhost", port: 3000, debug: true }; const host = config.host; const port = config.port; const debug = config.debug;',
        optimized: 'const { host, port, debug } = { host: "localhost", port: 3000, debug: true };',
        explanation: '使用对象解构提取配置',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '.responsive { font-size: 16px; } @media (max-width: 768px) { .responsive { font-size: 14px; } } @media (max-width: 480px) { .responsive { font-size: 12px; } }',
        optimized: '.responsive { font-size: clamp(0.75rem, 2vw, 1rem); }',
        explanation: '使用clamp实现流式响应式字体',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '<div class="container"> <div class="row"> <div class="col-md-6">Left</div> <div class="col-md-6">Right</div> </div> </div>',
        optimized: '<main class="container"> <section class="grid grid-cols-1 md:grid-cols-2 gap-4"> <div>Left</div> <div>Right</div> </section> </main>',
        explanation: '使用Tailwind简化响应式布局',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: 'const App = () => { const [theme, setTheme] = useState("light"); return <div className={theme}><button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Toggle</button></div>; };',
        optimized: 'const ThemeContext = createContext(); const ThemeProvider = ({ children }) => { const [theme, setTheme] = useState("light"); return <ThemeContext.Provider value={{ theme, toggle: () => setTheme(t => t === "light" ? "dark" : "light") }}>{children}</ThemeContext.Provider>; };',
        explanation: '使用Context API管理全局主题状态',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: '@import url("reset.css"); @import url("variables.css"); @import url("components.css");',
        optimized: '@import url("variables.css"); @import url("reset.css"); @import url("components.css");',
        explanation: '调整import顺序，变量在reset之前加载',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: 'const ListItem = (props) => { console.log("Rendering:", props.id); return <li>{props.text}</li>; };',
        optimized: 'const ListItem = memo(({ id, text }) => { console.log("Rendering:", id); return <li>{text}</li>; });',
        explanation: '使用memo和解构props减少重渲染',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '.card { transition: all 0.3s ease; }',
        optimized: '.card { transition: transform 0.3s ease, box-shadow 0.3s ease; will-change: transform; }',
        explanation: '只过渡需要的属性，添加will-change提示浏览器优化',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: 'const App = () => { const data = useSelector(state => state.data); const loading = useSelector(state => state.loading); const error = useSelector(state => state.error); if (loading) return <Loader />; if (error) return <Error message={error} />; return <List data={data} />; };',
        optimized: 'const selectData = state => ({ data: state.data, loading: state.loading, error: state.error }); const App = () => { const { data, loading, error } = useSelector(selectData); if (loading) return <Loader />; if (error) return <Error message={error} />; return <List data={data} />; };',
        explanation: '使用自定义selector减少useSelector调用次数',
        language: 'javascript',
        issueType: 'react_optimization'
      },
      {
        original: '<section> <h2>News</h2> <article> <h3>Article Title</h3> <p>Content...</p> </article> </section>',
        optimized: '<section aria-labelledby="news-heading"> <h2 id="news-heading">News</h2> <article> <h3>Article Title</h3> <p>Content...</p> </article> </section>',
        explanation: '使用aria-labelledby关联标题提升可访问性',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: 'const items = new Array(1000).fill(0).map((_, i) => i); const visible = items.slice(0, 20);',
        optimized: 'const items = Array.from({ length: 1000 }, (_, i) => i); const visible = items.slice(0, 20);',
        explanation: '使用Array.from替代fill+map优化性能',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '.sticky { position: fixed; top: 0; z-index: 100; }',
        optimized: '.sticky { position: sticky; top: 0; z-index: 100; }',
        explanation: '使用position:sticky替代fixed实现粘性定位',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: 'const express = require("express"); const app = express(); app.get("/", (req, res) => { res.send("Hello World"); });',
        optimized: 'import express from "express"; const app = express(); app.get("/", (req, res) => res.json({ message: "Hello World" }));',
        explanation: '使用ES模块和JSON响应',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const bodyParser = require("body-parser"); app.use(bodyParser.json());',
        optimized: 'app.use(express.json());',
        explanation: 'Express内置JSON解析，无需body-parser',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const result = await pool.query("SELECT * FROM users WHERE id = " + userId);',
        optimized: 'const result = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((err, req, res, next) => { console.error(err); res.status(500).send("Internal Server Error"); });',
        optimized: 'app.use((err, req, res, next) => { logger.error(err); res.status(err.status || 500).json({ error: err.message }); });',
        explanation: '使用结构化日志和JSON错误响应',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: 'const data = await fs.readFile("file.txt");',
        optimized: 'const data = await fs.promises.readFile("file.txt", "utf8");',
        explanation: '使用fs.promises和指定编码',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const redis = require("redis"); const client = redis.createClient();',
        optimized: 'import { createClient } from "redis"; const client = createClient({ url: process.env.REDIS_URL }); client.connect();',
        explanation: '使用Redis v4客户端和环境变量配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'function App() { const [count, setCount] = useState(0); return <div>{count}</div>; }',
        optimized: 'function App(): JSX.Element { const [count, setCount] = useState<number>(0); return <div>{count}</div>; }',
        explanation: 'TypeScript中为useState添加类型参数',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'interface User { name: string; age: number; } function greet(user) { return `Hello ${user.name}`; }',
        optimized: 'interface User { name: string; age: number; } function greet(user: User): string { return `Hello ${user.name}`; }',
        explanation: '为函数参数和返回值添加类型注解',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const user = getUser(); console.log(user.address.street);',
        optimized: 'const user = getUser(); console.log(user?.address?.street);',
        explanation: '使用可选链防止访问null属性出错',
        language: 'typescript',
        issueType: 'bug_fix'
      },
      {
        original: 'let value = data || defaultValue;',
        optimized: 'let value = data ?? defaultValue;',
        explanation: '使用空值合并运算符替代逻辑或',
        language: 'typescript',
        issueType: 'code_simplification'
      },
      {
        original: 'function getLength(value) { if (typeof value === "string") { return value.length; } else { return value.toString().length; } }',
        optimized: 'function getLength(value: string | number): number { return value.toString().length; }',
        explanation: '使用联合类型简化类型判断',
        language: 'typescript',
        issueType: 'code_simplification'
      },
      {
        original: 'function createPair(key, value) { return { key: key, value: value }; }',
        optimized: 'function createPair<K, V>(key: K, value: V): { key: K; value: V } { return { key, value }; }',
        explanation: '使用泛型创建类型安全的工具函数',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const items = [1, 2, 3]; const doubled = items.map(x => x * 2);',
        optimized: 'const items: readonly number[] = [1, 2, 3]; const doubled: number[] = items.map((x): number => x * 2);',
        explanation: '添加完整的TypeScript类型注解',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'enum Status { Active, Inactive, Pending }',
        optimized: 'const Status = { Active: "active", Inactive: "inactive", Pending: "pending" } as const; type Status = typeof Status[keyof typeof Status];',
        explanation: '使用const断言创建联合字符串类型替代数字枚举',
        language: 'typescript',
        issueType: 'code_quality'
      },
      {
        original: 'func main() { fmt.Println("Hello World") }',
        optimized: 'package main; import "fmt"; func main() { fmt.Println("Hello, World!") }',
        explanation: 'Go标准的包声明和导入格式',
        language: 'go',
        issueType: 'code_quality'
      },
      {
        original: 'func add(a, b int) int { return a + b }',
        optimized: 'func add(a, b int) int { return a + b } // 简洁的Go函数',
        explanation: 'Go函数简洁明了，类型后置',
        language: 'go',
        issueType: 'code_simplification'
      },
      {
        original: 'for i := 0; i < 10; i++ { fmt.Println(i) }',
        optimized: 'for i := 0; i < 10; i++ { fmt.Println(i) }',
        explanation: 'Go的三部分for循环',
        language: 'go',
        issueType: 'code_quality'
      },
      {
        original: 'ch := make(chan int); go func() { ch <- 42 }(); val := <-ch;',
        optimized: 'ch := make(chan int, 1); go func() { ch <- 42 }(); val := <-ch;',
        explanation: '使用缓冲channel避免goroutine泄漏',
        language: 'go',
        issueType: 'concurrency'
      },
      {
        original: 'var wg sync.WaitGroup; wg.Add(1); go func() { defer wg.Done(); doWork() }(); wg.Wait();',
        optimized: 'var wg sync.WaitGroup; wg.Add(1); go func() { defer wg.Done(); doWork() }(); wg.Wait();',
        explanation: '使用WaitGroup同步goroutine完成',
        language: 'go',
        issueType: 'concurrency'
      },
      {
        original: 'type User struct { Name string; Age int; }',
        optimized: 'type User struct { Name string `json:"name"`; Age int `json:"age"` }',
        explanation: '添加JSON标签支持序列化',
        language: 'go',
        issueType: 'code_quality'
      },
      {
        original: 'if err != nil { fmt.Println(err); os.Exit(1) }',
        optimized: 'if err != nil { log.Fatalf("error: %v", err) }',
        explanation: '使用log.Fatalf简化错误退出',
        language: 'go',
        issueType: 'error_handling'
      },
      {
        original: 'var mu sync.Mutex; mu.Lock(); count++; mu.Unlock();',
        optimized: 'var mu sync.Mutex; mu.Lock(); count++; mu.Unlock();',
        explanation: '使用互斥锁保护并发访问',
        language: 'go',
        issueType: 'concurrency'
      },
      {
        original: 'defer file.Close(); file.Write(data);',
        optimized: 'file, err := os.Open("file.txt"); if err != nil { return err }; defer file.Close(); file.Write(data);',
        explanation: '打开文件后立即defer Close，错误检查',
        language: 'go',
        issueType: 'resource_management'
      },
      {
        original: 'Java code: public class Hello { public static void main(String[] args) { System.out.println("Hello World"); } }',
        optimized: 'public class Hello { public static void main(String[] args) { System.out.println("Hello, World!"); } }',
        explanation: 'Java标准Hello World程序',
        language: 'java',
        issueType: 'code_quality'
      },
      {
        original: 'List<String> names = new ArrayList<>(); names.add("Alice"); names.add("Bob");',
        optimized: 'List<String> names = List.of("Alice", "Bob");',
        explanation: '使用List.of创建不可变列表',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'Map<String, Integer> scores = new HashMap<>(); scores.put("Alice", 95); scores.put("Bob", 87);',
        optimized: 'Map<String, Integer> scores = Map.of("Alice", 95, "Bob", 87);',
        explanation: '使用Map.of创建不可变Map',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'String result = ""; for (String s : list) { result += s; }',
        optimized: 'String result = String.join("", list);',
        explanation: '使用String.join替代循环拼接',
        language: 'java',
        issueType: 'performance_optimization'
      },
      {
        original: 'int sum = 0; for (int i = 0; i < numbers.length; i++) { sum += numbers[i]; }',
        optimized: 'int sum = Arrays.stream(numbers).sum();',
        explanation: '使用Stream API简化求和',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'List<String> filtered = new ArrayList<>(); for (String s : list) { if (s.length() > 3) { filtered.add(s); } }',
        optimized: 'List<String> filtered = list.stream().filter(s -> s.length() > 3).collect(Collectors.toList());',
        explanation: '使用Stream API的filter和collect',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'try { riskyOperation(); } catch (Exception e) { System.out.println("Error: " + e.getMessage()); }',
        optimized: 'try { riskyOperation(); } catch (SpecificException e) { logger.error("Operation failed", e); }',
        explanation: '捕获具体异常而非通用Exception',
        language: 'java',
        issueType: 'error_handling'
      },
      {
        original: 'Runnable r = () -> System.out.println("Hello"); new Thread(r).start();',
        optimized: 'ExecutorService executor = Executors.newSingleThreadExecutor(); executor.submit(() -> System.out.println("Hello")); executor.shutdown();',
        explanation: '使用ExecutorService替代裸Thread',
        language: 'java',
        issueType: 'concurrency'
      },
      {
        original: 'synchronized (this) { count++; }',
        optimized: 'private final AtomicInteger count = new AtomicInteger(0); count.incrementAndGet();',
        explanation: '使用AtomicInteger替代synchronized',
        language: 'java',
        issueType: 'concurrency'
      },
      {
        original: 'docker run -p 3000:3000 -v /app:/app node:16 node server.js',
        optimized: 'docker run -d -p 3000:3000 --name my-app --restart unless-stopped node:16-alpine node server.js',
        explanation: '添加-d后台运行、--name命名、--restart策略',
        language: 'docker',
        issueType: 'code_quality'
      },
      {
        original: 'FROM node:16 COPY . /app WORKDIR /app RUN npm install CMD ["node", "server.js"]',
        optimized: 'FROM node:16-alpine WORKDIR /app COPY package*.json ./ RUN npm ci --production COPY . . USER node CMD ["node", "server.js"]',
        explanation: '多阶段构建，使用npm ci，非root用户运行',
        language: 'docker',
        issueType: 'code_quality'
      },
      {
        original: 'FROM python:3.9 COPY . /app RUN pip install -r requirements.txt CMD ["python", "app.py"]',
        optimized: 'FROM python:3.9-slim WORKDIR /app COPY requirements.txt RUN pip install --no-cache-dir -r requirements.txt COPY . . USER appuser CMD ["gunicorn", "app:app"]',
        explanation: '使用slim镜像，--no-cache-dir减少镜像大小',
        language: 'docker',
        issueType: 'performance_optimization'
      },
      {
        original: 'apiVersion: v1 kind: Pod metadata: name: my-app spec: containers: - name: app image: my-app:latest ports: - containerPort: 8080',
        optimized: 'apiVersion: apps/v1 kind: Deployment metadata: name: my-app spec: replicas: 3 selector: { matchLabels: { app: my-app } } template: { metadata: { labels: { app: my-app } }, spec: { containers: [{ name: app, image: my-app:latest, ports: [{ containerPort: 8080 }], resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { cpu: 500m, memory: 256Mi } } }] }',
        explanation: '使用Deployment管理副本和资源限制',
        language: 'yaml',
        issueType: 'code_architecture'
      },
      {
        original: 'const http = require("http"); const server = http.createServer((req, res) => { res.end("Hello"); }); server.listen(3000);',
        optimized: 'const http = require("http"); const server = http.createServer(handleRequest); server.on("error", handleError); server.listen(3000, () => console.log("Server running on 3000"));',
        explanation: '分离请求处理函数，添加错误处理',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function UserController { this.users = []; this.addUser = function(user) { this.users.push(user); }; }',
        optimized: 'class UserController { constructor() { this.users = []; } addUser(user) { this.users.push(user); } }',
        explanation: '使用ES6类替代构造函数',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const fs = require("fs"); fs.readFile("data.json", (err, data) => { if (err) console.error(err); else console.log(JSON.parse(data)); });',
        optimized: 'import { readFile } from "fs/promises"; try { const data = JSON.parse(await readFile("data.json", "utf8")); console.log(data); } catch (err) { console.error(err); }',
        explanation: '使用fs/promises和async/await',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function debounce(fn, delay) { let timer; return function() { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, arguments), delay); }; }',
        optimized: 'const debounce = (fn, delay) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; };',
        explanation: '简化debounce使用箭头函数和rest参数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient();',
        optimized: 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient({ log: ["warn", "error"] });',
        explanation: '配置PrismaClient日志级别',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'async function getUser(id) { const user = await prisma.user.findUnique({ where: { id } }); if (!user) { throw new Error("User not found"); } return user; }',
        optimized: 'async function getUser(id) { return prisma.user.findUniqueOrThrow({ where: { id } }); }',
        explanation: '使用findUniqueOrThrow简化错误处理',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const express = require("express"); const cors = require("cors"); const helmet = require("helmet"); const app = express(); app.use(cors()); app.use(helmet());',
        optimized: 'import express from "express"; import cors from "cors"; import helmet from "helmet"; const app = express(); app.use(cors({ origin: process.env.CLIENT_URL, credentials: true })); app.use(helmet());',
        explanation: '配置CORS允许特定源，添加Helmet安全头',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.post("/login", (req, res) => { const { username, password } = req.body; const user = db.findUser(username); if (user && user.password === password) { res.json({ token: "abc123" }); } });',
        optimized: 'app.post("/login", async (req, res) => { const { username, password } = req.body; const user = await User.findByUsername(username); if (!user || !await bcrypt.compare(password, user.passwordHash)) { return res.status(401).json({ error: "Invalid credentials" }); } const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" }); res.json({ token }); });',
        explanation: '使用bcrypt验证密码，JWT签发token',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const jwt = require("jsonwebtoken"); const token = jwt.sign({ userId: 1 }, "secret");',
        optimized: 'import jwt from "jsonwebtoken"; const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "15m" });',
        explanation: '使用环境变量存储密钥，设置过期时间',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'pub fn add(a: i32, b: i32) -> i32 { a + b }',
        optimized: 'pub fn add(a: i32, b: i32) -> i32 { a + b }',
        explanation: 'Rust函数，最后表达式作为返回值',
        language: 'rust',
        issueType: 'code_simplification'
      },
      {
        original: 'fn main() { let x = 5; let y = 10; println!("{}", x + y); }',
        optimized: 'fn main() { let x = 5; let y = 10; println!("Sum: {}", x + y); }',
        explanation: 'Rust变量和打印',
        language: 'rust',
        issueType: 'code_quality'
      },
      {
        original: 'struct User { name: String, age: u32, }',
        optimized: '#[derive(Debug)] struct User { name: String, age: u32 }',
        explanation: '添加Debug派生宏支持调试打印',
        language: 'rust',
        issueType: 'code_quality'
      },
      {
        original: 'let v = vec![1, 2, 3]; for i in 0..v.len() { println!("{}", v[i]); }',
        optimized: 'let v = vec![1, 2, 3]; for val in &v { println!("{}", val); }',
        explanation: '使用迭代器替代索引访问',
        language: 'rust',
        issueType: 'code_simplification'
      },
      {
        original: 'match result { Ok(val) => println!("Success: {}", val), Err(e) => println!("Error: {}", e), }',
        optimized: 'match result { Ok(val) => println!("Success: {}", val), Err(e) => eprintln!("Error: {}", e), }',
        explanation: '错误信息使用eprintln输出到stderr',
        language: 'rust',
        issueType: 'error_handling'
      },
      {
        original: 'let s = String::from("hello"); let s2 = s; println!("{}", s);',
        optimized: 'let s = String::from("hello"); let s2 = s.clone(); println!("{} {}", s, s2);',
        explanation: '使用clone避免所有权转移导致的编译错误',
        language: 'rust',
        issueType: 'bug_fix'
      },
      {
        original: 'async function fetchData(url) { const response = await fetch(url); const data = await response.json(); return data; }',
        optimized: 'const fetchData = async (url: string) => { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };',
        explanation: 'TypeScript添加类型和错误处理',
        language: 'typescript',
        issueType: 'error_handling'
      },
      {
        original: 'type Callback = (result, error) => void;',
        optimized: 'type Callback<T> = (result: T | null, error: Error | null) => void;',
        explanation: '使用泛型和联合类型定义回调',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const config = { host: "localhost", port: 3000 };',
        optimized: 'interface IConfig { host: string; port: number; readonly debug: boolean; } const config: IConfig = { host: "localhost", port: 3000, debug: false };',
        explanation: '定义配置接口，属性使用readonly',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'function getData(id) { return fetch(`/api/${id}`).then(r => r.json()); }',
        optimized: 'async function getData<T>(id: string): Promise<T> { const res = await fetch(`/api/${id}`); if (!res.ok) throw new HTTPError(res.statusText, res.status); return res.json() as Promise<T>; }',
        explanation: '泛型async函数，自定义错误类型',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'kubectl create deployment my-app --image=my-app:latest',
        optimized: 'kubectl create deployment my-app --image=my-app:latest --replicas=3 && kubectl expose deployment my-app --port=80 --type=LoadBalancer',
        explanation: '创建多副本部署并暴露服务',
        language: 'yaml',
        issueType: 'code_architecture'
      },
      {
        original: 'helm install my-app ./chart',
        optimized: 'helm install my-app ./chart --set replicas=3 --set image.tag=v1.2.0 --namespace production --create-namespace',
        explanation: 'Helm安装时设置参数和命名空间',
        language: 'yaml',
        issueType: 'code_quality'
      },
      {
        original: 'const pino = require("pino"); const logger = pino();',
        optimized: 'import pino from "pino"; const logger = pino({ level: process.env.LOG_LEVEL || "info", transport: { target: "pino/file", options: { destination: 1 } } });',
        explanation: '配置Pino日志级别和输出目标',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const amqp = require("amqplib"); const conn = amqp.connect("amqp://localhost");',
        optimized: 'import amqp from "amqplib"; const conn = await amqp.connect(process.env.RABBITMQ_URL); const channel = await conn.createChannel(); await channel.assertQueue("tasks", { durable: true });',
        explanation: '使用环境变量和durable队列',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const { createClient } = require("graphql-ws"); const client = createClient({ url: "ws://localhost:4000/graphql" });',
        optimized: 'import { WebSocket } from "ws"; import { createClient } from "graphql-ws"; const client = createClient({ url: "ws://localhost:4000/graphql", webSocketImpl: WebSocket });',
        explanation: 'GraphQL WebSocket配置自定义WebSocket实现',
        language: 'typescript',
        issueType: 'code_quality'
      },
      {
        original: 'const { ApolloServer } = require("apollo-server-express"); const server = new ApolloServer({ typeDefs, resolvers });',
        optimized: 'import { ApolloServer } from "@apollo/server"; import { expressMiddleware } from "@apollo/server/express4"; const server = new ApolloServer({ typeDefs, resolvers, introspection: true }); await server.start(); app.use("/graphql", expressMiddleware(server, { context: async ({ req }) => ({ user: getUser(req) }) }));',
        explanation: '使用Apollo Server 4的express中间件',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { GraphQLClient } = require("graphql-request"); const client = new GraphQLClient("http://localhost:4000/graphql");',
        optimized: 'import { GraphQLClient } from "graphql-request"; const client = new GraphQLClient(process.env.GRAPHQL_URL, { headers: { Authorization: `Bearer ${token}` } });',
        explanation: 'GraphQL客户端添加认证头',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.collection("users").find({ age: { $gt: 18 } }).toArray()',
        optimized: 'db.collection("users").find({ age: { $gt: 18 } }).sort({ name: 1 }).limit(100).toArray()',
        explanation: 'MongoDB查询添加排序和限制',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.collection("users").createIndex({ email: 1 })',
        optimized: 'db.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true })',
        explanation: '创建唯一稀疏索引约束',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { MongoClient } = require("mongodb"); const client = new MongoClient("mongodb://localhost:27017");',
        optimized: 'import { MongoClient } from "mongodb"; const client = new MongoClient(process.env.MONGO_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });',
        explanation: 'MongoDB客户端配置连接池和超时',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'app.use(rateLimit({ windowMs: 60000, max: 100 }));',
        optimized: 'import rateLimit from "express-rate-limit"; const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }); app.use(limiter);',
        explanation: '配置Express速率限制',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { createHash } = require("crypto"); const hash = createHash("sha256").update(password).digest("hex");',
        optimized: 'import { scryptSync, randomBytes } from "crypto"; const salt = randomBytes(16).toString("hex"); const hash = scryptSync(password, salt, 64).toString("hex");',
        explanation: '使用scrypt替代SHA256进行密码哈希',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const validator = require("validator"); if (validator.isEmail(email)) { ... }',
        optimized: 'import validator from "validator"; if (validator.isEmail(email) && validator.isLength(password, { min: 8 })) { ... }',
        explanation: '组合多个验证器校验用户输入',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'function timeout(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }',
        optimized: 'const timeout = (ms) => new Promise(res => setTimeout(res, ms));',
        explanation: '简化Promise timeout函数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function retry(fn, retries = 3) { return fn().catch(err => retries > 0 ? retry(fn, retries - 1) : Promise.reject(err)); }',
        optimized: 'async function retry(fn, retries = 3, delay = 1000) { try { return await fn(); } catch (err) { if (retries <= 0) throw err; await new Promise(r => setTimeout(r, delay)); return retry(fn, retries - 1, delay * 2); } }',
        explanation: '添加指数退避的重试逻辑',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const { EventEmitter } = require("events"); const bus = new EventEmitter();',
        optimized: 'import { EventEmitter } from "events"; class AppBus extends EventEmitter {} const bus = new AppBus(); bus.on("user:created", handleUserCreated);',
        explanation: '扩展EventEmitter创建类型化事件总线',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { createServer } = require("http"); const server = createServer((req, res) => { res.writeHead(200); res.end(); });',
        optimized: 'import { createServer } from "http"; const server = createServer({ keepAliveTimeout: 65 * 1000, headersTimeout: 66 * 1000 }, (req, res) => { res.writeHead(200); res.end("OK"); });',
        explanation: '配置服务器超时参数',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'apiVersion: networking.k8s.io/v1 kind: Ingress metadata: name: my-ingress spec: rules: - host: example.com http: paths: - path: / pathType: Prefix backend: service: name: my-service port: number: 80',
        optimized: 'apiVersion: networking.k8s.io/v1 kind: Ingress metadata: name: my-ingress annotations: { "nginx.ingress.kubernetes.io/ssl-redirect": "true", "cert-manager.io/cluster-issuer": "letsencrypt-prod" } spec: tls: [{ hosts: ["example.com"], secretName: "example-tls" }] rules: [{ host: "example.com", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: my-service, port: { number: 80 } } } }] } }]',
        explanation: 'Ingress配置TLS和cert-manager自动证书',
        language: 'yaml',
        issueType: 'security'
      },
      {
        original: 'kubectl scale deployment my-app --replicas=5',
        optimized: 'kubectl scale deployment my-app --replicas=5 && kubectl rollout status deployment/my-app --timeout=60s',
        explanation: '扩缩容后等待部署完成',
        language: 'yaml',
        issueType: 'reliability'
      },
      {
        original: 'const { Worker } = require("worker_threads"); const worker = new Worker("./worker.js");',
        optimized: 'import { Worker } from "worker_threads"; const worker = new Worker(new URL("./worker.js", import.meta.url), { workerData: { chunkSize: 1000 } });',
        explanation: '使用Worker Threads处理CPU密集任务',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { Cluster } = require("puppeteer"); const cluster = Cluster.launch({ concurrency: Cluster.CONCURRENCY_PAGE });',
        optimized: 'import puppeteer from "puppeteer"; const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: "new" }); const page = await browser.newPage();',
        explanation: '使用Puppeteer直接操控浏览器',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const result = items.filter(x => x.active).map(x => x.name);',
        optimized: 'const result = items.filter(x => x.active).map(x => x.name);',
        explanation: '使用链式filter+map处理数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }',
        optimized: 'const deepClone = obj => structuredClone(obj);',
        explanation: '使用structuredClone替代JSON序列化深拷贝',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const date = new Date(2024, 0, 15);',
        optimized: 'const date = new Date("2024-01-15");',
        explanation: '使用ISO日期格式避免时区问题',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: 'const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }); const price = fmt.format(99.99);',
        optimized: 'const price = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(99.99);',
        explanation: '使用Intl.NumberFormat格式化货币',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const url = new URLSearchParams(window.location.search); const id = url.get("id");',
        optimized: 'const id = new URL(window.location.href).searchParams.get("id");',
        explanation: '使用URL对象解析查询参数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'if (type === "string" || type === "number" || type === "boolean") { ... }',
        optimized: 'if (["string", "number", "boolean"].includes(type)) { ... }',
        explanation: '使用includes简化多值判断',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = { a: 1, b: 2 }; const keys = Object.keys(obj); const values = Object.values(obj); const entries = Object.entries(obj);',
        optimized: 'const obj = { a: 1, b: 2 }; for (const [key, value] of Object.entries(obj)) { console.log(key, value); }',
        explanation: '使用for...of遍历Object.entries',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = [1, 2, 3, 4, 5]; const evens = arr.filter(n => n % 2 === 0);',
        optimized: 'const evens = [1, 2, 3, 4, 5].filter(n => n % 2 === 0);',
        explanation: '直接在数组字面量上调用方法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function sum(a, b, c, d) { return a + b + c + d; } const total = sum(1, 2, 3, 4);',
        optimized: 'const sum = (...nums) => nums.reduce((a, b) => a + b, 0); const total = sum(1, 2, 3, 4);',
        explanation: '使用rest参数和reduce处理任意数量参数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const promise = new Promise((resolve, reject) => { setTimeout(() => resolve("done"), 1000); });',
        optimized: 'const promise = new Promise(resolve => setTimeout(() => resolve("done"), 1000));',
        explanation: '简化Promise，不需要时省略reject',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = [3, 1, 4, 1, 5, 9, 2, 6]; arr.sort();',
        optimized: 'const sorted = [3, 1, 4, 1, 5, 9, 2, 6].sort((a, b) => a - b);',
        explanation: '数字排序需指定比较函数',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: 'const unique = [...new Set(items)];',
        optimized: 'const unique = [...new Set(items.map(i => i.id))];',
        explanation: '使用Set和map提取对象的唯一属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = JSON.parse(str); const name = obj.name; const age = obj.age;',
        optimized: 'const { name, age } = JSON.parse(str);',
        explanation: '使用解构赋值提取JSON属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'if (user !== null && user !== undefined) { ... }',
        optimized: 'if (user != null) { ... }',
        explanation: '使用!= null同时检查null和undefined',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const greeting = user ? `Hello, ${user.name}!` : "Hello, guest!";',
        optimized: 'const greeting = `Hello, ${user?.name ?? "guest"}!`;',
        explanation: '使用可选链和空值合并简化条件模板',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const config = Object.assign({}, defaults, options);',
        optimized: 'const config = { ...defaults, ...options };',
        explanation: '使用展开运算符替代Object.assign',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const newArr = arr.slice(); newArr.push(item);',
        optimized: 'const newArr = [...arr, item];',
        explanation: '使用展开运算符创建新数组并添加元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr1 = [1, 2]; const arr2 = [3, 4]; const combined = arr1.concat(arr2);',
        optimized: 'const combined = [...arr1, ...arr2];',
        explanation: '使用展开运算符合并数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function greet(name) { name = name || "World"; return `Hello, ${name}!`; }',
        optimized: 'const greet = (name = "World") => `Hello, ${name}!`;',
        explanation: '使用默认参数替代||运算符',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const items = [1, 2, 3]; for (let i = 0; i < items.length; i++) { console.log(items[i]); }',
        optimized: 'for (const item of [1, 2, 3]) { console.log(item); }',
        explanation: '使用for...of替代传统for循环',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'import os; for root, dirs, files in os.walk("/path/to/dir"): for file in files: print(os.path.join(root, file))',
        optimized: 'from pathlib import Path; for file in Path("/path/to/dir").rglob("*"): print(file)',
        explanation: '使用pathlib替代os.walk遍历文件',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def fibonacci(n): if n <= 1: return n; return fibonacci(n-1) + fibonacci(n-2)',
        optimized: 'from functools import lru_cache; @lru_cache(maxsize=None) def fibonacci(n): if n <= 1: return n; return fibonacci(n-1) + fibonacci(n-2)',
        explanation: '使用lru_cache缓存斐波那契数列计算',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'data = [x**2 for x in range(1000000)]',
        optimized: 'data = (x**2 for x in range(1000000))',
        explanation: '生成器表达式替代列表推导节省内存',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'try: f = open("data.txt", "r"): content = f.read(); finally: f.close()',
        optimized: 'with open("data.txt") as f: content = f.read()',
        explanation: '使用with语句确保文件正确关闭',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'cursor.execute("SELECT * FROM users WHERE name = " + name);',
        optimized: 'cursor.execute("SELECT * FROM users WHERE name = %s", (name,));',
        explanation: '使用参数化查询防止SQL注入',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'results = [] for i in range(10): results.append(i * i)',
        optimized: 'results = [i * i for i in range(10)]',
        explanation: '使用列表推导式简化循环',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'data = {} for key, value in items: if key not in data: data[key] = [] data[key].append(value)',
        optimized: 'from collections import defaultdict; data = defaultdict(list); for key, value in items: data[key].append(value)',
        explanation: '使用defaultdict简化字典列表构建',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import pickle; with open("data.pkl", "wb") as f: pickle.dump(data, f)',
        optimized: 'import json; with open("data.json", "w") as f: json.dump(data, f, indent=2)',
        explanation: '使用JSON替代pickle进行序列化',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def validate(func): def wrapper(*args, **kwargs): if not args[0]: raise ValueError("Invalid"); return func(*args, **kwargs); return wrapper',
        optimized: 'from functools import wraps; def validate(func): @wraps(func) def wrapper(*args, **kwargs): if not args[0]: raise ValueError("Invalid"); return func(*args, **kwargs); return wrapper',
        explanation: '使用functools.wraps保留函数元信息',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'async def fetch_data(): await asyncio.sleep(1); return {"data": "test"}',
        optimized: 'async def fetch_data(): await asyncio.sleep(1); return {"data": "test"}',
        explanation: '使用asyncio进行异步IO操作',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'class User: def __init__(self, name, email): self.name = name; self.email = email; self.created_at = datetime.now()',
        optimized: 'from dataclasses import dataclass; from datetime import datetime; @dataclass class User: name: str; email: str; created_at: datetime = field(default_factory=datetime.now)',
        explanation: '使用dataclass简化数据类定义',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'html = "<div>" + text + "</div>"',
        optimized: 'import html; safe_html = f"<div>{html.escape(text)}</div>"',
        explanation: '使用html.escape防止XSS攻击',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'conn = psycopg2.connect(host="localhost", dbname="mydb", user="admin", password="admin123")',
        optimized: 'import os; conn = psycopg2.connect(host=os.environ["DB_HOST"], dbname=os.environ["DB_NAME"], user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"])',
        explanation: '使用环境变量存储数据库凭据',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def slow_function(): total = 0 for i in range(1000000): total += i return total',
        optimized: 'import numpy as np; def fast_function(): return np.sum(np.arange(1000000))',
        explanation: '使用NumPy向量化运算替代Python循环',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'items.sort(key=lambda x: x[1])',
        optimized: 'items.sort(key=operator.itemgetter(1))',
        explanation: '使用operator.itemgetter替代lambda排序',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'try: result = risky() except Exception as e: logging.error(f"Error: {e}") result = None',
        optimized: 'try: result = risky() except SpecificError: logging.exception("Operation failed") result = None',
        explanation: '捕获具体异常，使用logging.exception记录堆栈',
        language: 'python',
        issueType: 'error_handling'
      },
      {
        original: 'def process(self, data): result = transform(data) return result',
        optimized: '@staticmethod def process(data): return transform(data)',
        explanation: '不需要self参数时使用@staticmethod',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'query = "INSERT INTO users (name, email) VALUES (%s, %s)"; cursor.execute(query, (name, email))',
        optimized: 'cursor.execute("INSERT INTO users (name, email) VALUES (%s, %s)", (name, email))',
        explanation: '简化SQL执行，不需要单独的查询变量',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'from typing import List, Dict, Optional def find_user(users: List[Dict]) -> Optional[Dict]: for user in users: if user["name"] == target: return user return None',
        optimized: 'from typing import List, Dict, Optional; def find_user(users: List[Dict]) -> Optional[Dict]: return next((u for u in users if u["name"] == target), None)',
        explanation: '使用next()生成器表达式替代循环查找',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'SELECT * FROM orders WHERE user_id = 1 ORDER BY created_at DESC LIMIT 10',
        optimized: 'SELECT id, user_id, total, status, created_at FROM orders WHERE user_id = 1 ORDER BY created_at DESC LIMIT 10',
        explanation: '只查询需要的字段避免SELECT *',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT u.name, u.email, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status = "pending"',
        optimized: 'SELECT u.name, u.email, SUM(o.total) as pending_total FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status = "pending" GROUP BY u.id, u.name, u.email',
        explanation: '添加聚合函数和GROUP BY优化查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM products WHERE name LIKE "%phone%"',
        optimized: 'CREATE INDEX idx_products_name ON products USING gin (to_tsvector("simple", name)); SELECT * FROM products WHERE to_tsvector("simple", name) @@ to_tsquery("simple", "phone")',
        explanation: '使用全文索引替代LIKE模糊查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const [data, setData] = useState([]); const [loading, setLoading] = useState(false); const [error, setError] = useState(null);',
        optimized: 'const { data, loading, error } = useApi("/api/items");',
        explanation: '使用自定义Hook封装API请求状态',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const Button = (props) => { return <button style={{ padding: "10px 20px", background: "blue", color: "white" }} onClick={props.onClick}>{props.children}</button>; };',
        optimized: 'const Button = styled.button` padding: 10px 20px; background: blue; color: white; `; const StyledButton = ({ onClick, children }) => <Button onClick={onClick}>{children}</Button>;',
        explanation: '使用styled-components替代内联样式',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '<div style="display: flex; flex-direction: column; gap: 10px; padding: 20px;">...</div>',
        optimized: '.container { display: flex; flex-direction: column; gap: 0.625rem; padding: 1.25rem; } <div className="container">...</div>',
        explanation: '使用CSS类替代内联样式',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: 'const list = items.map(item => <Item key={item.id} {...item} onSelect={handleSelect} />);',
        optimized: 'const list = items.map(item => <Item key={item.id} item={item} onSelect={handleSelect} />);',
        explanation: '避免使用展开运算符传递props',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const App = () => { const [user, setUser] = useState(null); useEffect(() => { fetchUser().then(setUser); }, []); return user ? <Dashboard user={user} /> : <Loading />; };',
        optimized: 'const App = () => { const { data: user } = useSWR("/api/user", fetchUser); return user ? <Dashboard user={user} /> : <Loading />; };',
        explanation: '使用SWR库简化数据获取和缓存',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const Nav = () => { const [current, setCurrent] = useState("/"); return <nav>{routes.map(r => <a key={r.path} href={r.path} onClick={() => setCurrent(r.path)}>{r.name}</a>)}</nav>; };',
        optimized: 'const Nav = () => { const location = useLocation(); return <nav>{routes.map(r => <Link key={r.path} to={r.path} className={location.pathname === r.path ? "active" : ""}>{r.name}</Link>)}</nav>; };',
        explanation: '使用React Router的useLocation和Link',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const Button = forwardRef((props, ref) => { return <button ref={ref}>{props.children}</button>; });',
        optimized: 'const Button = forwardRef(({ children, ...props }, ref) => { return <button ref={ref} {...props}>{children}</button>; });',
        explanation: '使用forwardRef正确转发ref和props',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const Modal = ({ isOpen, onClose, children }) => { if (!isOpen) return null; return <div className="modal-overlay" onClick={onClose}>{children}</div>; };',
        optimized: 'const Modal = ({ isOpen, onClose, children }) => { const overlayRef = useRef(); const contentRef = useRef(); useEffect(() => { if (isOpen) { contentRef.current?.focus(); } }, [isOpen]); if (!isOpen) return null; return <div ref={overlayRef} className="modal-overlay" onClick={(e) => e.target === overlayRef.current && onClose()}><div ref={contentRef} tabIndex={-1}>{children}</div></div>; };',
        explanation: '添加焦点管理和点击遮罩关闭',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: '.grid { display: grid; grid-template-columns: 1fr 2fr 1fr; grid-template-rows: auto; grid-template-areas: "header header header" "sidebar main main" "footer footer footer"; }',
        optimized: '.layout { display: grid; grid-template-columns: 1fr 2fr 1fr; grid-template-areas: "header header header" "sidebar main main" "footer footer footer"; gap: 1rem; }',
        explanation: '使用CSS Grid模板区域布局',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.animation { animation-name: slideIn; animation-duration: 0.5s; animation-timing-function: ease-out; animation-delay: 0s; animation-iteration-count: 1; animation-direction: normal; animation-fill-mode: none; }',
        optimized: '.animation { animation: slideIn 0.5s ease-out; }',
        explanation: '使用animation简写属性',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.text { text-align: center; text-decoration: none; text-transform: uppercase; text-indent: 0; letter-spacing: 2px; line-height: 1.5; }',
        optimized: '.text { text-align: center; text-decoration: none; text-transform: uppercase; letter-spacing: 0.125rem; line-height: 1.5; }',
        explanation: '移除不必要的默认值，使用rem单位',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.responsive { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 20px; }',
        optimized: '.responsive { width: min(100% - 2rem, 1200px); margin-inline: auto; }',
        explanation: '使用min()和margin-inline简化响应式容器',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: 'function useFetch(url) { const [data, setData] = useState(null); const [error, setError] = useState(null); const [loading, setLoading] = useState(true); useEffect(() => { fetch(url).then(r => r.json()).then(setData).catch(setError).finally(() => setLoading(false)); }, [url]); return { data, error, loading }; }',
        optimized: 'function useFetch<T>(url: string): UseFetchResult<T> { const [state, setState] = useState<UseFetchResult<T>>({ data: null, error: null, loading: true }); useEffect(() => { let cancelled = false; fetch(url).then(r => r.json()).then(data => { if (!cancelled) setState({ data, error: null, loading: false }); }).catch(error => { if (!cancelled) setState({ data: null, error, loading: false }); }); return () => { cancelled = true; }; }, [url]); return state; }',
        explanation: '添加取消机制的类型安全的useFetch Hook',
        language: 'typescript',
        issueType: 'code_architecture'
      },
      {
        original: 'app.listen(3000);',
        optimized: 'const PORT = process.env.PORT || 3000; app.listen(PORT, () => console.log(`Server on port ${PORT}`));',
        explanation: '使用环境变量配置端口，添加日志',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const db = mysql.createConnection({ host: "localhost", user: "root", password: "", database: "test" });',
        optimized: 'const db = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 10 });',
        explanation: '使用连接池和环境变量',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'const jwt = require("jsonwebtoken"); const middleware = (req, res, next) => { const token = req.headers.authorization?.split(" ")[1]; const decoded = jwt.verify(token, "secret"); req.user = decoded; next(); };',
        optimized: 'import jwt from "jsonwebtoken"; const auth = (req, res, next) => { const token = req.header("Authorization")?.replace("Bearer ", ""); if (!token) return res.status(401).json({ error: "Unauthorized" }); try { const decoded = jwt.verify(token, process.env.JWT_SECRET); req.user = decoded; next(); } catch { return res.status(401).json({ error: "Invalid token" }); } };',
        explanation: '完整的JWT认证中间件，使用环境变量和错误处理',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { Storage } = require("@google-cloud/storage"); const storage = new Storage();',
        optimized: 'import { Storage } from "@google-cloud/storage"; const storage = new Storage({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
        explanation: '配置GCP Storage凭据',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { PubSub } = require("@google-cloud/pubsub"); const pubsub = new PubSub();',
        optimized: 'import { PubSub } from "@google-cloud/pubsub"; const pubsub = new PubSub({ projectId: process.env.GCP_PROJECT }); const topic = pubsub.topic(process.env.PUBSUB_TOPIC);',
        explanation: '配置Pub/Sub项目和主题',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'class UserService { async getUser(id) { const user = await this.db.query("SELECT * FROM users WHERE id = ?", [id]); return user; } }',
        optimized: 'class UserService { constructor(db) { this.db = db; } async getUser(id) { const [user] = await this.db.query("SELECT * FROM users WHERE id = ?", [id]); return user[0] || null; } }',
        explanation: '依赖注入和正确的数组解构',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const cache = new Map(); function expensiveComputation(key) { if (cache.has(key)) { return cache.get(key); } const result = doExpensiveWork(key); cache.set(key, result); return result; }',
        optimized: 'const memoize = fn => { const cache = new Map(); return (...args) => { const key = JSON.stringify(args); if (!cache.has(key)) cache.set(key, fn(...args)); return cache.get(key); }; }; const expensiveComputation = memoize(doExpensiveWork);',
        explanation: '使用memoize高阶函数实现通用缓存',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const ws = new WebSocket("ws://localhost:8080"); ws.onmessage = (e) => { console.log(e.data); };',
        optimized: 'const ws = new WebSocket(process.env.WS_URL); ws.addEventListener("message", handleMessage); ws.addEventListener("error", handleError); ws.addEventListener("close", handleClose); const reconnect = () => setTimeout(connect, 1000); ws.addEventListener("close", reconnect);',
        explanation: '添加连接管理和自动重连',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const { Queue } = require("bull"); const queue = new Queue("tasks"); queue.add({ data: "test" });',
        optimized: 'import { Queue } from "bull"; const queue = new Queue("tasks", { redis: { host: process.env.REDIS_HOST, port: 6379 } }); queue.process("email", async (job) => { await sendEmail(job.data); }); queue.add("email", { to: "user@test.com" }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });',
        explanation: '配置Bull队列的Redis连接和重试策略',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'func fetchData(ctx context.Context) ([]Data, error) { data, err := db.Query(ctx, "SELECT * FROM data") return data, err }',
        optimized: 'func fetchData(ctx context.Context) ([]Data, error) { ctx, cancel := context.WithTimeout(ctx, 5*time.Second); defer cancel(); rows, err := db.QueryContext(ctx, "SELECT * FROM data") if err != nil { return nil, err } defer rows.Close(); var data []Data for rows.Next() { var d Data; if err := rows.Scan(&d.ID, &d.Name); err != nil { return nil, err } data = append(data, d) } return data, rows.Err() }',
        explanation: '使用context超时和正确的rows处理',
        language: 'go',
        issueType: 'reliability'
      },
      {
        original: 'func main() { router := gin.Default(); router.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) }); router.Run(":8080") }',
        optimized: 'func main() { r := gin.Default(); r.GET("/health", healthHandler); r.GET("/api/users", listUsers); r.POST("/api/users", createUser); r.Run(":" + os.Getenv("PORT")) }',
        explanation: 'Gin路由处理函数分离和环境变量端口',
        language: 'go',
        issueType: 'code_architecture'
      },
      {
        original: 'CREATE TABLE users (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100), email VARCHAR(200))',
        optimized: 'CREATE TABLE users (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100) NOT NULL, email VARCHAR(200) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_name (name)) ENGINE=InnoDB',
        explanation: '添加约束、默认值和索引',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'app.get("/items/:id", (req, res) => { const id = req.params.id; db.query("SELECT * FROM items WHERE id = " + id, (err, result) => { if (err) throw err; res.json(result); }); });',
        optimized: 'app.get("/items/:id", async (req, res) => { const [item] = await db.query("SELECT * FROM items WHERE id = ?", [req.params.id]); if (!item.length) return res.status(404).json({ error: "Not found" }); res.json(item[0]); });',
        explanation: '使用参数化查询和async/await',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function throttle(fn, limit) { let inThrottle; return function() { const args = arguments; const context = this; if (!inThrottle) { fn.apply(context, args); inThrottle = true; setTimeout(() => inThrottle = false, limit); } }; }',
        optimized: 'const throttle = (fn, limit) => { let lastCall = 0; let timer = null; return (...args) => { const now = Date.now(); const remaining = limit - (now - lastCall); if (remaining <= 0) { clearTimeout(timer); lastCall = now; fn(...args); } else if (!timer) { timer = setTimeout(() => { lastCall = Date.now(); fn(...args); timer = null; }, remaining); } }; };',
        explanation: '优化throttle实现，保证首尾执行',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { v4: uuidv4 } = require("uuid"); const id = uuidv4();',
        optimized: 'import { randomUUID } from "crypto"; const id = randomUUID();',
        explanation: '使用Node.js内置crypto.randomUUID替代uuid库',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const bcrypt = require("bcrypt"); const hash = bcrypt.hashSync(password, 10);',
        optimized: 'import bcrypt from "bcrypt"; const hash = await bcrypt.hash(password, 12);',
        explanation: '使用异步bcrypt和更高的salt轮数',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function validateEmail(email) { const re = /^[\\w.-]+@[\\w.-]+\\.\\w+$/; return re.test(email); }',
        optimized: 'function validateEmail(email) { return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(email); }',
        explanation: '更严格的邮箱验证正则',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { nanoid } = require("nanoid"); const id = nanoid();',
        optimized: 'import { randomBytes } from "crypto"; const id = randomBytes(8).toString("hex");',
        explanation: '使用Node.js内置crypto生成随机ID',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { createCanvas } = require("canvas"); const canvas = createCanvas(200, 200); const ctx = canvas.getContext("2d");',
        optimized: 'import { createCanvas } from "canvas"; const canvas = createCanvas(400, 400); const ctx = canvas.getContext("2d"); ctx.scale(2, 2);',
        explanation: '使用高分辨率Canvas和缩放',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const sharp = require("sharp"); sharp("input.jpg").resize(200, 200).toFile("output.jpg");',
        optimized: 'import sharp from "sharp"; await sharp("input.jpg").resize(200, 200, { fit: "cover" }).jpeg({ quality: 80, mozjpeg: true }).toFile("output.jpg");',
        explanation: 'Sharp配置输出质量和格式优化',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { Worker } = require("worker_threads"); const workers = []; for (let i = 0; i < 4; i++) { workers.push(new Worker("./worker.js")); }',
        optimized: 'import { Worker } from "worker_threads"; import { cpus } from "os"; const numWorkers = cpus().length; const workers = Array.from({ length: numWorkers }, () => new Worker(new URL("./worker.js", import.meta.url)));',
        explanation: '根据CPU核心数动态创建Worker',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { clusterApiUrl } = require("@solana/web3.js"); const connection = new Connection(clusterApiUrl("devnet"));',
        optimized: 'import { Connection, clusterApiUrl } from "@solana/web3.js"; const connection = new Connection(clusterApiUrl("mainnet-beta"), { wsEndpoint: process.env.RPC_WS_ENDPOINT });',
        explanation: 'Solana主网连接配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { ethers } = require("ethers"); const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545");',
        optimized: 'import { ethers } from "ethers"; const provider = new ethers.JsonRpcProvider(process.env.RPC_URL); const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);',
        explanation: 'Ethers.js v6的JsonRpcProvider和钱包配置',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '@app.route("/user/<int:user_id>") def get_user(user_id): user = User.query.get(user_id) if user: return jsonify(user.serialize()) return jsonify({"error": "Not found"}), 404',
        optimized: 'from flask import Blueprint; users_bp = Blueprint("users", __name__); @users_bp.get("/<int:user_id>") def get_user(user_id): user = User.query.get_or_404(user_id) return user.serialize()',
        explanation: '使用Flask Blueprint和get_or_404简化错误处理',
        language: 'python',
        issueType: 'code_architecture'
      },
      {
        original: 'def process_users(users): active = [u for u in users if u.active] return map(lambda u: transform(u), active)',
        optimized: 'def process_users(users): return [transform(u) for u in users if u.active]',
        explanation: '使用列表推导式替代filter+map组合',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'class Singleton: _instance = None def __new__(cls): if cls._instance is None: cls._instance = super().__new__(cls) return cls._instance',
        optimized: 'from threading import Lock; class Singleton: _instance = None _lock = Lock() def __new__(cls): if cls._instance is None: with cls._lock: if cls._instance is None: cls._instance = super().__new__(cls) return cls._instance',
        explanation: '使用双重检查锁定实现线程安全的单例',
        language: 'python',
        issueType: 'concurrency'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(compression());',
        optimized: 'import compression from "compression"; app.use(compression({ level: 6, threshold: 1024 }));',
        explanation: '配置gzip压缩级别和阈值',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { client } = require("redis"); client.set("key", "value"); client.get("key", (err, value) => { console.log(value); });',
        optimized: 'import { createClient } from "redis"; const client = createClient({ url: process.env.REDIS_URL }); await client.connect(); await client.set("key", "value", { EX: 3600 }); const value = await client.get("key");',
        explanation: 'Redis v4异步API和过期时间设置',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'const { createServer } = require("http"); const server = createServer(handler); server.listen(port);',
        optimized: 'import { createServer } from "http"; const server = createServer({ keepAliveTimeout: 65000, headersTimeout: 66000, requestTimeout: 30000 }, handler); server.listen(port, () => console.log(`Listening on ${port}`)); process.on("SIGTERM", () => server.close());',
        explanation: '配置超时和优雅关闭',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'func (h *Handler) GetUser(c *gin.Context) { id := c.Param("id") user, err := h.service.GetUser(id) if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return } c.JSON(200, user) }',
        optimized: 'func (h *Handler) GetUser(c *gin.Context) { id := c.Param("id"); user, err := h.service.GetUser(c.Request.Context(), id); if err != nil { h.handleError(c, err); return } c.JSON(200, user) }',
        explanation: '传递context和统一错误处理',
        language: 'go',
        issueType: 'reliability'
      },
      {
        original: 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient(); async function main() { await prisma.$connect(); const users = await prisma.user.findMany(); console.log(users); }',
        optimized: 'const prisma = new PrismaClient(); async function bootstrap() { try { const users = await prisma.user.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 10 }); console.log(users); } finally { await prisma.$disconnect(); } } bootstrap();',
        explanation: 'Prisma查询添加条件、排序和限制，确保断开连接',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'type User struct { ID int; Name string; Email string; CreatedAt time.Time } func NewUser(name, email string) *User { return &User{ Name: name, Email: email, CreatedAt: time.Now() } }',
        optimized: 'type User struct { ID int `json:"id"`; Name string `json:"name"`; Email string `json:"email"`; CreatedAt time.Time `json:"created_at"` } func NewUser(name, email string) (*User, error) { if name == "" || email == "" { return nil, errors.New("invalid input") } return &User{ Name: name, Email: email, CreatedAt: time.Now() }, nil }',
        explanation: '添加JSON标签和输入验证',
        language: 'go',
        issueType: 'code_quality'
      },
      {
        original: 'const arr = [1, 2, 3, 4, 5]; const sum = arr.reduce((acc, val) => acc + val, 0);',
        optimized: 'const arr = [1, 2, 3, 4, 5]; const sum = arr.reduce((acc, val) => acc + val, 0);',
        explanation: '使用reduce计算数组求和',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = { name: "Alice", age: 30 }; const name = obj.name; const age = obj.age;',
        optimized: 'const { name, age } = { name: "Alice", age: 30 };',
        explanation: '对象解构提取属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function greet(greeting, name) { greeting = greeting || "Hello"; name = name || "World"; return `${greeting}, ${name}!`; }',
        optimized: 'const greet = (greeting = "Hello", name = "World") => `${greeting}, ${name}!`;',
        explanation: '箭头函数+默认参数简化',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const numbers = [1, 2, 3, 4, 5]; const squared = numbers.map(n => n * n);',
        optimized: 'const squared = [1, 2, 3, 4, 5].map(n => n * n);',
        explanation: '直接在数组字面量上调用map',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function isEven(n) { return n % 2 === 0; } const evens = numbers.filter(isEven);',
        optimized: 'const evens = numbers.filter(n => n % 2 === 0);',
        explanation: '使用箭头函数内联过滤条件',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const sorted = items.sort((a, b) => a.name.localeCompare(b.name));',
        optimized: 'const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));',
        explanation: '使用展开运算符避免修改原数组',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: 'const found = items.find(item => item.id === targetId);',
        optimized: 'const found = items.find(item => item.id === targetId) ?? defaultItem;',
        explanation: '使用空值合并提供默认值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const hasActive = items.some(item => item.active); const allActive = items.every(item => item.active);',
        optimized: 'const hasActive = items.some(i => i.active); const allActive = items.every(i => i.active);',
        explanation: '使用some和every检查数组元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const [first, ...rest] = [1, 2, 3, 4, 5];',
        optimized: 'const [first, ...rest] = [1, 2, 3, 4, 5];',
        explanation: '使用解构和rest运算符提取首尾元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const merged = Object.assign({}, obj1, obj2);',
        optimized: 'const merged = { ...obj1, ...obj2 };',
        explanation: '展开运算符合并对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const newObj = Object.assign({}, obj, { name: "new" });',
        optimized: 'const newObj = { ...obj, name: "new" };',
        explanation: '展开运算符覆盖对象属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'class Point { constructor(x, y) { this.x = x; this.y = y; } length() { return Math.sqrt(this.x ** 2 + this.y ** 2); } }',
        optimized: 'class Point { constructor(public x: number, public y: number) {} get length() { return Math.sqrt(this.x ** 2 + this.y ** 2); } }',
        explanation: 'TypeScript中使用参数属性和getter',
        language: 'typescript',
        issueType: 'code_simplification'
      },
      {
        original: 'type User = { name: string; age: number; } | { guest: true }; function handle(user: User) { ... }',
        optimized: 'type User = { name: string; age: number } | { guest: true }; function handle(user: User) { if ("guest" in user) { ... } else { ... } }',
        explanation: '使用判别属性进行类型缩窄',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };',
        optimized: 'type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };',
        explanation: '递归深度Partial类型工具',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'type PickUser = Pick<User, "name" | "email">;',
        optimized: 'type PickUser = Pick<User, "name" | "email">;',
        explanation: '使用Pick工具类型选择特定属性',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'type PartialUser = Partial<User>;',
        optimized: 'type PartialUser = Partial<User>;',
        explanation: '使用Partial工具类型将所有属性变为可选',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'type ReadonlyUser = Readonly<User>;',
        optimized: 'type ReadonlyUser = Readonly<User>;',
        explanation: '使用Readonly工具类型创建只读类型',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const map = new Map(); map.set("key1", "value1"); map.set("key2", "value2");',
        optimized: 'const map = new Map([["key1", "value1"], ["key2", "value2"]]);',
        explanation: '使用Map构造函数初始化数据',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const set = new Set(); set.add(1); set.add(2); set.add(3);',
        optimized: 'const set = new Set([1, 2, 3]);',
        explanation: '使用Set构造函数初始化数据',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const weakMap = new WeakMap(); weakMap.set(obj, "value");',
        optimized: 'const weakMap = new WeakMap(); weakMap.set(obj, "value");',
        explanation: '使用WeakMap存储对象引用不被GC回收',
        language: 'javascript',
        issueType: 'memory_management'
      },
      {
        original: 'const weakSet = new WeakSet(); weakSet.add(obj);',
        optimized: 'const weakSet = new WeakSet(); weakSet.add(obj);',
        explanation: '使用WeakSet存储对象引用',
        language: 'javascript',
        issueType: 'memory_management'
      },
      {
        original: 'const sym = Symbol("description"); const obj = { [sym]: "value" };',
        optimized: 'const sym = Symbol("description"); const obj = { [sym]: "value" };',
        explanation: '使用Symbol作为对象键避免属性冲突',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const regex = /hello/i; const result = regex.test("Hello World");',
        optimized: 'const result = /hello/i.test("Hello World");',
        explanation: '内联正则表达式简化代码',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const str = "Hello World"; const upper = str.toUpperCase(); const lower = str.toLowerCase();',
        optimized: 'const str = "Hello World"; const upper = str.toUpperCase(); const lower = str.toLowerCase();',
        explanation: '字符串大小写转换方法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const str = "  Hello  "; const trimmed = str.trim();',
        optimized: 'const trimmed = "  Hello  ".trim();',
        explanation: '使用trim移除首尾空白',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const str = "a,b,c"; const arr = str.split(",");',
        optimized: 'const arr = "a,b,c".split(",");',
        explanation: '使用split分割字符串',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = ["a", "b", "c"]; const str = arr.join("-");',
        optimized: 'const str = ["a", "b", "c"].join("-");',
        explanation: '使用join将数组连接为字符串',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const str = "Hello World"; const replaced = str.replace("World", "Universe");',
        optimized: 'const replaced = "Hello World".replace("World", "Universe");',
        explanation: '使用replace替换字符串内容',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const str = "Hello World"; const includes = str.includes("World");',
        optimized: 'const includes = "Hello World".includes("World");',
        explanation: '使用includes检查子字符串',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const str = "Hello World"; const starts = str.startsWith("Hello"); const ends = str.endsWith("World");',
        optimized: 'const starts = "Hello World".startsWith("Hello"); const ends = "Hello World".endsWith("World");',
        explanation: '使用startsWith和endsWith检查字符串首尾',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const str = "Hello World"; const index = str.indexOf("World");',
        optimized: 'const index = "Hello World".indexOf("World");',
        explanation: '使用indexOf查找子字符串位置',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function Person(name, age) { this.name = name; this.age = age; } Person.prototype.greet = function() { return `Hello, ${this.name}`; };',
        optimized: 'class Person { constructor(name, age) { this.name = name; this.age = age; } greet() { return `Hello, ${this.name}`; } }',
        explanation: '使用ES6类替代原型链',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const calculator = { add: function(a, b) { return a + b; }, subtract: function(a, b) { return a - b; } };',
        optimized: 'const calculator = { add(a, b) { return a + b; }, subtract(a, b) { return a - b; } };',
        explanation: '使用ES6方法简写语法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const key = "name"; const obj = { [key]: "Alice" };',
        optimized: 'const key = "name"; const obj = { [key]: "Alice" };',
        explanation: '使用计算属性名动态创建对象属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const name = "Alice"; const age = 30; const obj = { name: name, age: age };',
        optimized: 'const obj = { name, age };',
        explanation: '使用属性简写语法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function save(data) { localStorage.setItem("data", JSON.stringify(data)); } function load() { return JSON.parse(localStorage.getItem("data")); }',
        optimized: 'const storage = { save(key, data) { localStorage.setItem(key, JSON.stringify(data)); } load(key) { return JSON.parse(localStorage.getItem(key)); } };',
        explanation: '封装localStorage读写操作',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const EventEmitter = require("events"); const emitter = new EventEmitter(); emitter.on("event", (data) => { console.log(data); }); emitter.emit("event", "hello");',
        optimized: 'import { EventEmitter } from "events"; class AppEmitter extends EventEmitter {} const emitter = new AppEmitter(); emitter.on("user:login", handleLogin); emitter.emit("user:login", { userId: 1 });',
        explanation: '扩展EventEmitter创建类型化事件发射器',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const fs = require("fs"); fs.readFile("file.txt", "utf8", (err, data) => { if (err) console.error(err); else console.log(data); });',
        optimized: 'import { readFile } from "fs/promises"; try { const data = await readFile("file.txt", "utf8"); console.log(data); } catch (err) { console.error(err); }',
        explanation: '使用fs/promises和async/await替代回调',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const express = require("express"); const app = express();',
        optimized: 'import express from "express"; const app = express();',
        explanation: '使用ES模块导入Express',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const path = require("path"); const filePath = path.join(__dirname, "public", "index.html");',
        optimized: 'import path from "path"; import { fileURLToPath } from "url"; const __dirname = path.dirname(fileURLToPath(import.meta.url)); const filePath = path.join(__dirname, "public", "index.html");',
        explanation: 'ES模块中正确获取__dirname',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const http = require("http"); http.createServer((req, res) => { res.end("Hello World"); }).listen(3000);',
        optimized: 'import http from "http"; const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("Hello World"); }); server.listen(3000);',
        explanation: 'ES模块创建HTTP服务器并设置正确的Content-Type',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const crypto = require("crypto"); const hash = crypto.createHash("sha256").update(data).digest("hex");',
        optimized: 'import { createHash } from "crypto"; const hash = createHash("sha256").update(data).digest("hex");',
        explanation: 'ES模块导入crypto函数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { v4: uuidv4 } = require("uuid"); const id = uuidv4();',
        optimized: 'import { randomUUID } from "crypto"; const id = randomUUID();',
        explanation: '使用Node.js内置crypto.randomUUID替代uuid库',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const os = require("os"); const cpus = os.cpus();',
        optimized: 'import { cpus } from "os"; const numWorkers = cpus().length;',
        explanation: 'ES模块导入os.cpus获取CPU核心数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const url = require("url"); const parsed = url.parse("http://example.com/path?query=1");',
        optimized: 'const parsed = new URL("http://example.com/path?query=1"); const query = parsed.searchParams.get("query");',
        explanation: '使用WHATWG URL API替代旧的url.parse',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const zlib = require("zlib"); zlib.gzip(input, (err, buffer) => { ... });',
        optimized: 'import { gzipSync } from "zlib"; const compressed = gzipSync(input);',
        explanation: '使用ES模块和同步压缩',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const net = require("net"); const server = net.createServer(socket => { ... });',
        optimized: 'import net from "net"; const server = net.createServer(socket => { ... });',
        explanation: 'ES模块导入net模块',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const dns = require("dns"); dns.lookup("example.com", (err, address) => { ... });',
        optimized: 'import dns from "dns"; const { address } = await dns.promises.lookup("example.com");',
        explanation: '使用dns.promises API异步DNS查询',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const stream = require("stream"); const readable = new stream.Readable();',
        optimized: 'import { Readable } from "stream"; const readable = new Readable({ read() { this.push(null); } });',
        explanation: 'ES模块创建Readable流',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { spawn } = require("child_process"); const child = spawn("ls", ["-la"]);',
        optimized: 'import { spawn } from "child_process"; const child = spawn("ls", ["-la"], { stdio: "inherit" });',
        explanation: '使用ES模块和stdio配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'function* idGenerator() { let id = 0; while (true) { yield id++; } }',
        optimized: 'function* idGenerator() { let id = 0; while (true) { yield id++; } } const gen = idGenerator(); console.log(gen.next().value);',
        explanation: '使用生成器函数创建ID生成器',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'async function fetchAll(urls) { const results = []; for (const url of urls) { const response = await fetch(url); results.push(await response.json()); } return results; }',
        optimized: 'const fetchAll = async (urls) => { const results = await Promise.all(urls.map(u => fetch(u).then(r => r.json()))); return results; };',
        explanation: '使用Promise.all并行获取数据',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'async function fetchWithRetry(url, retries = 3) { for (let i = 0; i < retries; i++) { try { const res = await fetch(url); return await res.json(); } catch (e) { if (i === retries - 1) throw e; } } }',
        optimized: 'async function fetchWithRetry(url, retries = 3, delay = 1000) { for (let i = 0; i < retries; i++) { try { const res = await fetch(url); if (!res.ok) throw new Error(res.statusText); return await res.json(); } catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, delay * (i + 1))); } } }',
        explanation: '添加指数退避和HTTP状态检查的重试',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const { AbortController } = require("abort-controller");',
        optimized: 'const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000); fetch(url, { signal: controller.signal }).then(res => clearTimeout(timeout));',
        explanation: '使用AbortController实现请求超时',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'function throttle(fn, delay) { let lastCall = 0; return function() { const now = Date.now(); if (now - lastCall >= delay) { lastCall = now; fn.apply(this, arguments); } }; }',
        optimized: 'const throttle = (fn, delay) => { let lastCall = 0; let timer = null; return (...args) => { const now = Date.now(); const remaining = delay - (now - lastCall); if (remaining <= 0) { clearTimeout(timer); lastCall = now; fn(...args); } else if (!timer) { timer = setTimeout(() => { lastCall = Date.now(); fn(...args); timer = null; }, remaining); } }; };',
        explanation: '优化throttle实现，保证首尾执行',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function debounce(fn, delay) { let timer; return function() { const context = this; const args = arguments; clearTimeout(timer); timer = setTimeout(function() { fn.apply(context, args); }, delay); }; }',
        optimized: 'const debounce = (fn, delay) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; };',
        explanation: '简化debounce使用箭头函数和rest参数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const once = (fn) => { let called = false; return function() { if (!called) { called = true; fn.apply(this, arguments); } }; };',
        optimized: 'const once = (fn) => { let called = false; return (...args) => { if (!called) { called = true; fn(...args); } }; };',
        explanation: '简化once函数确保只执行一次',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const memoize = (fn) => { const cache = {}; return function() { const key = arguments[0]; if (!(key in cache)) { cache[key] = fn.apply(this, arguments); } return cache[key]; }; };',
        optimized: 'const memoize = (fn) => { const cache = new Map(); return (...args) => { const key = JSON.stringify(args); if (!cache.has(key)) cache.set(key, fn(...args)); return cache.get(key); }; };',
        explanation: '使用Map和JSON序列化支持多参数缓存',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const pipe = (...fns) => (value) => fns.reduce((acc, fn) => fn(acc), value);',
        optimized: 'const pipe = (...fns) => (value) => fns.reduce((acc, fn) => fn(acc), value);',
        explanation: '使用reduce实现函数管道',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const compose = (...fns) => (value) => fns.reduceRight((acc, fn) => fn(acc), value);',
        optimized: 'const compose = (...fns) => (value) => fns.reduceRight((acc, fn) => fn(acc), value);',
        explanation: '使用reduceRight实现函数组合',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const curry = (fn) => { return function curried(...args) { if (args.length >= fn.length) { return fn.apply(this, args); } return function(...moreArgs) { return curried.apply(this, args.concat(moreArgs)); }; }; };',
        optimized: 'const curry = (fn) => { return function curried(...args) { if (args.length >= fn.length) return fn(...args); return (...more) => curried(...args, ...more); }; };',
        explanation: '简化柯里化函数实现',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const partial = (fn, ...preArgs) => (...laterArgs) => fn(...preArgs, ...laterArgs);',
        optimized: 'const partial = (fn, ...preArgs) => (...laterArgs) => fn(...preArgs, ...laterArgs);',
        explanation: '实现函数偏应用',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function retry(fn, options = {}) { const { retries = 3, delay = 1000 } = options; return fn().catch(err => { if (retries > 0) { return new Promise(resolve => setTimeout(resolve, delay)).then(() => retry(fn, { retries: retries - 1, delay: delay * 2 })); } throw err; }); }',
        optimized: 'async function retry(fn, options = {}) { const { retries = 3, delay = 1000 } = options; try { return await fn(); } catch (err) { if (retries <= 0) throw err; await new Promise(resolve => setTimeout(resolve, delay)); return retry(fn, { retries: retries - 1, delay: delay * 2 }); } }',
        explanation: '使用async/await简化重试逻辑',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const pLimit = require("p-limit"); const limit = pLimit(3); const promises = items.map(item => limit(() => processItem(item))); const results = await Promise.all(promises);',
        optimized: 'import pLimit from "p-limit"; const limit = pLimit(3); const results = await Promise.all(items.map(item => limit(() => processItem(item))));',
        explanation: '使用p-limit限制并发任务数量',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { Mutex } = require("async-mutex"); const mutex = new Mutex(); async function safeOperation() { const release = await mutex.acquire(); try { await doOperation(); } finally { release(); } }',
        optimized: 'import { Mutex } from "async-mutex"; const mutex = new Mutex(); async function safeOperation() { const release = await mutex.acquire(); try { await doOperation(); } finally { release(); } }',
        explanation: '使用async-mutex确保并发安全',
        language: 'javascript',
        issueType: 'concurrency'
      },
      {
        original: 'const { Queue } = require("bull"); const queue = new Queue("tasks");',
        optimized: 'import { Queue } from "bull"; const queue = new Queue("tasks", { redis: { host: process.env.REDIS_HOST } });',
        explanation: 'Bull队列配置Redis连接',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { Agenda } = require("agenda"); const agenda = new Agenda({ db: { address: "mongodb://localhost/agenda" } });',
        optimized: 'import { Agenda } from "agenda"; const agenda = new Agenda({ db: { address: process.env.MONGO_URI } }); await agenda.start();',
        explanation: 'Agenda定时任务配置和启动',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const express = require("express"); const app = express(); const router = express.Router();',
        optimized: 'import express from "express"; const app = express(); const router = express.Router();',
        explanation: 'ES模块创建Express Router',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'router.get("/users", (req, res) => { db.query("SELECT * FROM users", (err, result) => { if (err) throw err; res.json(result); }); });',
        optimized: 'router.get("/users", async (req, res) => { try { const [users] = await db.query("SELECT * FROM users"); res.json(users); } catch (err) { res.status(500).json({ error: err.message }); } });',
        explanation: '使用async/await和错误处理',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: 'router.post("/users", (req, res) => { const { name, email } = req.body; db.query("INSERT INTO users (name, email) VALUES (?, ?)", [name, email], (err, result) => { if (err) throw err; res.json({ id: result.insertId }); }); });',
        optimized: 'router.post("/users", async (req, res) => { const { name, email } = req.body; try { const [result] = await db.query("INSERT INTO users (name, email) VALUES (?, ?)", [name, email]); res.status(201).json({ id: result.insertId }); } catch (err) { res.status(400).json({ error: err.message }); } });',
        explanation: 'POST路由使用async/await和正确的状态码',
        language: 'javascript',
        issueType: 'error_handling'
      },
      {
        original: 'const { auth } = require("express-oauth2-jwt-bearer"); app.use(auth({ audience: "api", issuer: "https://example.com" }));',
        optimized: 'import { auth } from "express-oauth2-jwt-bearer"; app.use(auth({ audience: process.env.AUDIENCE, issuer: process.env.ISSUER }));',
        explanation: 'OAuth2 JWT认证配置使用环境变量',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { requireAuth } = require("@clerk/clerk-sdk-node");',
        optimized: 'import { Clerk } from "@clerk/clerk-sdk-node"; const clerk = Clerk({ apiKey: process.env.CLERK_API_KEY });',
        explanation: 'Clerk SDK初始化使用环境变量',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { stripe } = require("stripe")("sk_test_...");',
        optimized: 'import Stripe from "stripe"; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);',
        explanation: 'Stripe初始化使用环境变量密钥',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { Twilio } = require("twilio"); const client = new Twilio("sid", "token");',
        optimized: 'import twilio from "twilio"; const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);',
        explanation: 'Twilio客户端使用环境变量凭据',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const sgMail = require("@sendgrid/mail"); sgMail.setApiKey("SG.xxx...");',
        optimized: 'import sgMail from "@sendgrid/mail"; sgMail.setApiKey(process.env.SENDGRID_API_KEY);',
        explanation: 'SendGrid使用环境变量API密钥',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { OAuth2Client } = require("google-auth-library"); const client = new OAuth2Client("client-id");',
        optimized: 'import { OAuth2Client } from "google-auth-library"; const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);',
        explanation: 'Google OAuth客户端使用环境变量',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { createClient } = require("@supabase/supabase-js"); const supabase = createClient("url", "key");',
        optimized: 'import { createClient } from "@supabase/supabase-js"; const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);',
        explanation: 'Supabase客户端使用环境变量',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { PineconeClient } = require("@pinecone-database/pinecone"); const client = new PineconeClient();',
        optimized: 'import { Pinecone } from "@pinecone-database/pinecone"; const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY, environment: process.env.PINECONE_ENV });',
        explanation: 'Pinecone向量数据库客户端配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { WeaviateClient } = require("weaviate-client"); const client = WeaviateClient({ scheme: "https", host: "localhost" });',
        optimized: 'import weaviate from "weaviate-client"; const client = weaviate.client({ scheme: "https", host: process.env.WEAVIATE_HOST, apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY) });',
        explanation: 'Weaviate向量数据库客户端配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { MilvusClient } = require("@zilliz/milvus2-sdk-node"); const client = new MilvusClient({ address: "localhost:19530" });',
        optimized: 'import { MilvusClient } from "@zilliz/milvus2-sdk-node"; const client = new MilvusClient({ address: process.env.MILVUS_ADDRESS });',
        explanation: 'Milvus向量数据库客户端配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'pg_ctl start -D /var/lib/postgresql/data',
        optimized: 'pg_ctl start -D /var/lib/postgresql/data -l /var/log/postgresql/logfile',
        explanation: 'PostgreSQL启动指定数据目录和日志',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'mongod --dbpath /data/db',
        optimized: 'mongod --dbpath /data/db --logpath /var/log/mongodb/mongod.log --fork',
        explanation: 'MongoDB启动指定数据路径、日志和后台模式',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'redis-server',
        optimized: 'redis-server --daemonize yes --dir /var/lib/redis --logfile /var/log/redis/redis.log',
        explanation: 'Redis以守护进程模式启动指定目录和日志',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'SELECT * FROM products WHERE name ILIKE "%phone%"',
        optimized: 'SELECT id, name, price FROM products WHERE name ILIKE $1 ORDER BY name',
        explanation: 'PostgreSQL参数化ILIKE查询',
        language: 'sql',
        issueType: 'security'
      },
      {
        original: 'INSERT INTO users (name, email) VALUES ("Alice", "alice@test.com")',
        optimized: 'INSERT INTO users (name, email) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET name = $1 RETURNING id',
        explanation: 'PostgreSQL使用ON CONFLICT实现upsert',
        language: 'sql',
        issueType: 'code_simplification'
      },
      {
        original: 'UPDATE users SET status = "inactive" WHERE id = 1',
        optimized: 'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status',
        explanation: 'PostgreSQL UPDATE使用参数化和RETURNING子句',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'DELETE FROM users WHERE id = 1',
        optimized: 'DELETE FROM users WHERE id = $1 RETURNING id, name',
        explanation: 'PostgreSQL DELETE使用参数化和RETURNING子句',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'const { Builder, By, until } = require("selenium-webdriver"); const driver = new Builder().forBrowser("chrome").build();',
        optimized: 'import { Builder, By, until } from "selenium-webdriver"; const driver = await new Builder().forBrowser("chrome").setChromeOptions(new chrome.Options().headless()).build();',
        explanation: 'Selenium配置headless Chrome模式',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { chromium } = require("playwright"); const browser = await chromium.launch();',
        optimized: 'import { chromium } from "playwright"; const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });',
        explanation: 'Playwright配置headless模式和沙盒参数',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { Builder } = require("webdriverio"); const driver = Builder.forBrowser("chrome").build();',
        optimized: 'import { remote } from "webdriverio"; const driver = await remote({ capabilities: { browserName: "chrome" } });',
        explanation: 'WebDriverIO v6远程连接配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { defineConfig } = require("cypress"); module.exports = defineConfig({ e2e: { baseUrl: "http://localhost:3000" } });',
        optimized: 'import { defineConfig } from "cypress"; export default defineConfig({ e2e: { baseUrl: process.env.CYPRESS_BASE_URL, supportFile: false } });',
        explanation: 'Cypress配置使用环境变量',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { defineConfig } = require("vitest"); module.exports = defineConfig({ test: { environment: "jsdom" } });',
        optimized: 'import { defineConfig } from "vitest"; export default defineConfig({ test: { environment: "jsdom", globals: true }, include: ["src/**/*.test.{js,ts,jsx,tsx}"] });',
        explanation: 'Vitest配置jsdom环境',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { defineConfig } = require("playwright/test"); module.exports = defineConfig({ webServer: { command: "npm run dev" } });',
        optimized: 'import { defineConfig, devices } from "@playwright/test"; export default defineConfig({ projects: [{ ...devices["Desktop Chrome"] }], webServer: { command: "npm run dev", url: "http://localhost:3000" } });',
        explanation: 'Playwright测试配置桌面Chrome',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'it("should work", () => { cy.visit("/"); cy.get("button").click(); });',
        optimized: 'it("should work", () => { cy.visit("/"); cy.get("button").should("be.visible").click(); cy.url().should("include", "/success"); });',
        explanation: 'Cypress添加断言确保按钮可见和URL变化',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'test("renders title", () => { render(<App />); expect(screen.getByText("Title")).toBeInTheDocument(); });',
        optimized: 'test("renders title", async () => { render(<App />); expect(await screen.findByRole("heading", { name: "Title" })).toBeInTheDocument(); });',
        explanation: 'React Testing Library使用findBy等待异步元素',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { JSDOM } = require("jsdom"); const dom = new JSDOM("<!DOCTYPE html><div id=\'root\'></div>");',
        optimized: 'import { JSDOM } from "jsdom"; const dom = new JSDOM("<!DOCTYPE html>", { url: "http://localhost", runScripts: "dangerously" });',
        explanation: 'JSDOM配置URL和脚本执行',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { faker } = require("@faker-js/faker"); const name = faker.name.firstName();',
        optimized: 'import { faker } from "@faker-js/faker/locale/en_US"; const name = faker.person.firstName();',
        explanation: 'Faker.js v8正确导入locale',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { chance } = require("chance"); const c = new Chance(); const email = c.email();',
        optimized: 'import Chance from "chance"; const c = new Chance(); const email = c.email({ domain: "example.com" });',
        explanation: 'Chance.js配置特定域名生成邮箱',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { factory } = require("factory-bot"); factory.define("user", User, { name: "Alice", age: 30 });',
        optimized: 'import { Factory, faker } from "factory-bot-ts"; Factory.define(User, ({ faker }) => ({ name: faker.name.firstName(), age: faker.datatype.number({ min: 18, max: 99 }) }));',
        explanation: '使用factory-bot-ts和faker生成测试数据',
        language: 'typescript',
        issueType: 'code_quality'
      }
,
      {
        original: 'for (var i = 0; i < arr.length; i++) { console.log(arr[i]); }',
        optimized: 'for (let i = 0, len = arr.length; i < len; i++) { console.log(arr[i]); }',
        explanation: '缓存数组长度避免每次迭代重新计算',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'arr.forEach(item => { sum += item; });',
        optimized: 'for (let i = 0; i < arr.length; i++) { sum += arr[i]; }',
        explanation: '使用for循环替代forEach以获得更好性能',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = arr.filter(x => x > 10).map(x => x * 2).reduce((a, b) => a + b, 0);',
        optimized: 'const result = arr.reduce((acc, x) => { if (x > 10) acc.push(x * 2); return acc; }, []).reduce((a, b) => a + b, 0);',
        explanation: '合并多次遍历为单次reduce操作',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'let str = ""; for (let i = 0; i < 10000; i++) { str += "item" + i; }',
        optimized: 'const parts = []; for (let i = 0; i < 10000; i++) { parts.push("item" + i); } const str = parts.join("");',
        explanation: '使用数组join替代字符串拼接以避免O(n²)复杂度',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const cached = expensiveFunction(); module.exports = { cached, expensiveFunction };',
        optimized: 'let cached = null; function getCached() { if (cached === null) cached = expensiveFunction(); return cached; } module.exports = { getCached, expensiveFunction };',
        explanation: '实现惰性缓存避免不必要的计算',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function debounce(fn) { return function() { setTimeout(() => fn.apply(this, arguments), 300); }; }',
        optimized: 'function debounce(fn, delay = 300) { let timer = null; return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); }; }',
        explanation: '正确的防抖实现，每次调用重置计时器',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const memoize = fn => { const cache = {}; return (...args) => { const key = args.join(","); if (cache[key]) return cache[key]; cache[key] = fn(...args); return cache[key]; }; };',
        optimized: 'const memoize = fn => { const cache = new Map(); return (...args) => { const key = JSON.stringify(args); if (cache.has(key)) return cache.get(key); const result = fn(...args); cache.set(key, result); return result; }; };',
        explanation: '使用Map替代普通对象作为缓存，支持任意类型键',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = { a: 1 }; obj.b = 2; obj.c = 3; Object.freeze(obj);',
        optimized: 'const obj = Object.freeze({ a: 1, b: 2, c: 3 });',
        explanation: '在对象创建后立即冻结，确保不可变',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = [1, 2, 3]; const copy = arr.slice(); copy.push(4);',
        optimized: 'const arr = [1, 2, 3]; const copy = [...arr, 4];',
        explanation: '使用展开运算符创建数组副本并添加元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const merged = Object.assign({}, obj1, obj2, obj3);',
        optimized: 'const merged = { ...obj1, ...obj2, ...obj3 };',
        explanation: '使用对象展开运算符替代Object.assign',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'if (user && user.address && user.address.city) { console.log(user.address.city); }',
        optimized: 'console.log(user?.address?.city);',
        explanation: '使用可选链简化嵌套属性访问',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const name = user.name !== undefined && user.name !== null ? user.name : "default";',
        optimized: 'const name = user.name ?? "default";',
        explanation: '使用空值合并运算符简化空值检查',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'async function fetchData() { const response = await fetch("/api/data"); const data = await response.json(); return data; }',
        optimized: 'const fetchData = async () => { const data = await fetch("/api/data").then(r => r.json()); return data; };',
        explanation: '使用箭头函数和链式调用简化异步代码',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function User(name, age) { this.name = name; this.age = age; } User.prototype.greet = function() { return "Hello, " + this.name; };',
        optimized: 'class User { constructor(name, age) { this.name = name; this.age = age; } greet() { return `Hello, ${this.name}`; } }',
        explanation: '使用ES6 class语法替代原型继承',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const x = a + b; const y = x * 2; const z = y - 1;',
        optimized: 'const z = (a + b) * 2 - 1;',
        explanation: '合并中间变量简化表达式',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const items = ["a", "b", "c"]; for (var i = 0; i < items.length; i++) { (function(item) { setTimeout(function() { console.log(item); }, 1000); })(items[i]); }',
        optimized: 'const items = ["a", "b", "c"]; items.forEach(item => { setTimeout(() => console.log(item), 1000); });',
        explanation: '使用let或forEach替代IIFE避免闭包陷阱',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: 'const data = JSON.parse(responseText);',
        optimized: 'const data = JSON.parse(responseText);',
        explanation: '使用JSON.parse替代eval解析JSON',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'element.addEventListener("click", function(e) { if (e.target.classList.contains("button")) { handleClick(); } });',
        optimized: 'element.addEventListener("click", e => { if (e.target.closest(".button")) handleClick(); });',
        explanation: '使用事件委托和closest简化事件处理',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = arr.find(x => x.id === targetId);',
        optimized: 'const result = arr.find(x => x.id === targetId);',
        explanation: '使用find替代filter获取单个匹配元素',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const sorted = arr.sort(function(a, b) { return a - b; });',
        optimized: 'const sorted = [...arr].sort((a, b) => a - b);',
        explanation: '在排序前创建副本避免修改原数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'Promise.all([promise1, promise2, promise3]).then(results => { console.log(results); });',
        optimized: 'const results = await Promise.all([promise1, promise2, promise3]);',
        explanation: '使用async/await替代Promise链，代码更清晰',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = {}; obj[propertyName] = value;',
        optimized: 'const obj = { [propertyName]: value };',
        explanation: '使用计算属性名简化动态属性赋值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const firstName = person.firstName; const lastName = person.lastName; const age = person.age;',
        optimized: 'const { firstName, lastName, age } = person;',
        explanation: '使用解构赋值提取对象属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const newArr = arr.map(function(item) { return item * 2; });',
        optimized: 'const newArr = arr.map(item => item * 2);',
        explanation: '使用箭头函数简化回调',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function greet(name) { name = name || "World"; return "Hello " + name; }',
        optimized: 'const greet = (name = "World") => `Hello ${name}`;',
        explanation: '使用默认参数和模板字符串',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const items = [1, 2, 3, 4, 5]; const filtered = items.filter(x => x > 3); const mapped = filtered.map(x => x * 2);',
        optimized: 'const mapped = [1, 2, 3, 4, 5].filter(x => x > 3).map(x => x * 2);',
        explanation: '链式调用简化数组操作',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const data = response.data; const status = response.status;',
        optimized: 'const { data, status } = response;',
        explanation: '使用解构提取Axios响应',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const url = "https://api.example.com/users/" + userId + "?page=" + page;',
        optimized: 'const url = `https://api.example.com/users/${userId}?page=${page}`;',
        explanation: '使用模板字符串简化URL拼接',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function sum(a, b, c, d) { return a + b + c + d; } const result = sum(1, 2, 3, 4);',
        optimized: 'const sum = (...nums) => nums.reduce((a, b) => a + b, 0); const result = sum(1, 2, 3, 4);',
        explanation: '使用剩余参数支持任意数量参数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = [1, 2, 3]; const a = arr[0]; const b = arr[1]; const c = arr[2];',
        optimized: 'const [a, b, c] = [1, 2, 3];',
        explanation: '使用数组解构提取元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const cache = {}; function getData(key) { if (cache[key]) return cache[key]; const data = fetchData(key); cache[key] = data; return data; }',
        optimized: 'const getData = (() => { const cache = new Map(); return async (key) => { if (cache.has(key)) return cache.get(key); const data = await fetchData(key); cache.set(key, data); return data; }; })();',
        explanation: '使用闭包和Map封装缓存逻辑',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function validate(data) { if (!data.name) return false; if (!data.email) return false; if (!data.age) return false; return true; }',
        optimized: 'const validate = data => !!(data.name && data.email && data.age);',
        explanation: '简化验证逻辑为单行表达式',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const items = ["apple", "banana", "cherry"]; const html = "<ul>"; for (let i = 0; i < items.length; i++) { html += "<li>" + items[i] + "</li>"; } html += "</ul>";',
        optimized: 'const html = `<ul>${["apple", "banana", "cherry"].map(item => `<li>${item}</li>`).join("")}</ul>`;',
        explanation: '使用map和join生成HTML',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const user = {}; if (name) user.name = name; if (email) user.email = email; if (age) user.age = age;',
        optimized: 'const user = { ...(name && { name }), ...(email && { email }), ...(age && { age }) };',
        explanation: '使用条件展开运算符构建对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'let total = 0; const items = [1, 2, 3, 4, 5]; items.forEach(item => { total += item; });',
        optimized: 'const total = [1, 2, 3, 4, 5].reduce((sum, item) => sum + item, 0);',
        explanation: '使用reduce替代forEach累加',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const found = false; for (let i = 0; i < arr.length; i++) { if (arr[i] > 10) { found = true; break; } }',
        optimized: 'const found = arr.some(x => x > 10);',
        explanation: '使用some方法检查是否存在满足条件的元素',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const allValid = true; for (let i = 0; i < arr.length; i++) { if (arr[i] < 0) { allValid = false; break; } }',
        optimized: 'const allValid = arr.every(x => x >= 0);',
        explanation: '使用every方法检查所有元素是否满足条件',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const unique = []; for (let i = 0; i < arr.length; i++) { if (unique.indexOf(arr[i]) === -1) { unique.push(arr[i]); } }',
        optimized: 'const unique = [...new Set(arr)];',
        explanation: '使用Set快速去重',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const result = {}; for (let i = 0; i < arr.length; i++) { const key = arr[i].category; if (!result[key]) result[key] = []; result[key].push(arr[i]); }',
        optimized: 'const result = arr.reduce((acc, item) => { (acc[item.category] = acc[item.category] || []).push(item); return acc; }, {});',
        explanation: '使用reduce进行数据分组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const a = 5; const b = 10; const temp = a; a = b; b = temp;',
        optimized: 'let a = 5; let b = 10; [a, b] = [b, a];',
        explanation: '使用解构交换变量值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const result = a > b ? a : b; const max = result > c ? result : c;',
        optimized: 'const max = Math.max(a, b, c);',
        explanation: '使用Math.max获取最大值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const min = a < b ? a : b; const result = min < c ? min : c;',
        optimized: 'const result = Math.min(a, b, c);',
        explanation: '使用Math.min获取最小值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const pow = Math.pow(2, 10);',
        optimized: 'const pow = 2 ** 10;',
        explanation: '使用指数运算符替代Math.pow',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = [1, 2, 3]; const doubled = arr.map(x => x * 2);',
        optimized: 'const doubled = [1, 2, 3].map(x => x * 2);',
        explanation: '链式调用简化数组操作',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = { a: 1 }; obj.a = 2;',
        optimized: 'const obj = { a: 1 }; obj.a = 2; Object.assign(obj, { a: 2 });',
        explanation: '使用Object.assign批量更新属性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function logMessage(message) { if (typeof message === "string") { console.log(message); } }',
        optimized: 'const logMessage = msg => typeof msg === "string" && console.log(msg);',
        explanation: '使用短路求值简化条件日志',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const name = user.name || "Anonymous";',
        optimized: 'const name = user?.name || "Anonymous";',
        explanation: '结合可选链和短路运算',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const items = ["a", "b", "c"]; const index = items.indexOf("b");',
        optimized: 'const index = ["a", "b", "c"].indexOf("b");',
        explanation: '直接在数组字面量上调用方法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const exists = arr.indexOf(item) !== -1;',
        optimized: 'const exists = arr.includes(item);',
        explanation: '使用includes替代indexOf检查存在性',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const isEven = n => n % 2 === 0; const evens = arr.filter(isEven);',
        optimized: 'const evens = arr.filter(n => n % 2 === 0);',
        explanation: '内联简单函数表达式',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const result = arr.map(x => String(x));',
        optimized: 'const result = arr.map(String);',
        explanation: '直接传递构造函数引用',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const keys = Object.keys(obj); const values = keys.map(k => obj[k]);',
        optimized: 'const values = Object.values(obj);',
        explanation: '使用Object.values直接获取值',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const entries = Object.keys(obj).map(k => [k, obj[k]]);',
        optimized: 'const entries = Object.entries(obj);',
        explanation: '使用Object.entries直接获取键值对',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const clone = JSON.parse(JSON.stringify(obj));',
        optimized: 'const clone = structuredClone(obj);',
        explanation: '使用structuredClone进行深拷贝',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const obj = Object.fromEntries(new Map([["a", 1], ["b", 2]]));',
        optimized: 'const obj = Object.fromEntries([["a", 1], ["b", 2]]);',
        explanation: '使用Object.fromEntries创建对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const promise = new Promise((resolve, reject) => { fs.readFile("file.txt", (err, data) => { if (err) reject(err); else resolve(data); }); });',
        optimized: 'const { promisify } = require("util"); const readFile = promisify(fs.readFile); const data = await readFile("file.txt");',
        explanation: '使用util.promisify回调转Promise',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'let cache = {}; async function fetchWithCache(url) { if (cache[url]) return cache[url]; const data = await fetch(url).then(r => r.json()); cache[url] = data; return data; }',
        optimized: 'const fetchWithCache = (() => { const cache = new Map(); return async url => { if (cache.has(url)) return cache.get(url); const data = await fetch(url).then(r => r.json()); cache.set(url, data); return data; }; })();',
        explanation: '使用IIFE和Map实现封装的缓存fetch',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'class Animal { speak() { return "Animal speaks"; } } class Dog extends Animal { speak() { return "Dog barks"; } }',
        optimized: 'class Animal { speak() { return "Animal speaks"; } } class Dog extends Animal { speak() { return `${super.speaks()} loudly`; } }',
        explanation: '在子类中通过super调用父类方法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function createUser(name, email) { return { name: name, email: email, createdAt: Date.now() }; }',
        optimized: 'const createUser = (name, email) => ({ name, email, createdAt: Date.now() });',
        explanation: '使用属性简写和箭头函数简化工厂函数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const arr = [5, 2, 8, 1, 9]; arr.sort((a, b) => a - b);',
        optimized: 'const sorted = [...[5, 2, 8, 1, 9]].sort((a, b) => a - b);',
        explanation: '排序前创建副本避免修改原数组',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const handler = { get(target, prop) { return prop in target ? target[prop] : 42; } }; const proxy = new Proxy({}, handler);',
        optimized: 'const proxy = new Proxy({}, { get: (t, p) => p in t ? t[p] : 42 });',
        explanation: '使用Proxy实现默认值属性访问',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const arr = [1, 2, 3]; const iterator = arr[Symbol.iterator](); console.log(iterator.next());',
        optimized: 'for (const item of [1, 2, 3]) { console.log(item); }',
        explanation: '使用for...of循环迭代可迭代对象',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const set = new Set([1, 2, 3, 2, 1]); const unique = Array.from(set);',
        optimized: 'const unique = [...new Set([1, 2, 3, 2, 1])];',
        explanation: '使用展开运算符简化Set转数组',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const map = new Map(); map.set("key1", "value1"); map.set("key2", "value2");',
        optimized: 'const map = new Map([["key1", "value1"], ["key2", "value2"]]);',
        explanation: '使用初始化数据创建Map',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const weakMap = new WeakMap(); const key = { id: 1 }; weakMap.set(key, "value");',
        optimized: 'const weakMap = new WeakMap(); const key = { id: 1 }; weakMap.set(key, "value");',
        explanation: '使用WeakMap存储对象引用，避免内存泄漏',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'let counter = 0; setInterval(() => { counter++; console.log(counter); }, 1000);',
        optimized: 'let counter = 0; const timerId = setInterval(() => { counter++; console.log(counter); }, 1000); clearInterval(timerId);',
        explanation: '保存定时器ID以便清理，避免内存泄漏',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'const bigInt = 9007199254740993n; console.log(bigInt + 1n);',
        optimized: 'const bigInt = 9007199254740993n; console.log(bigInt + 1n);',
        explanation: '使用BigInt处理超大整数',
        language: 'javascript',
        issueType: 'code_quality'
      }
,
      {
        original: 'def get_user(user_id): return db.query("SELECT * FROM users WHERE id = " + str(user_id))',
        optimized: 'def get_user(user_id): return db.query("SELECT * FROM users WHERE id = ?", (user_id,))',
        explanation: '使用参数化查询防止SQL注入',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def calculate_total(items): total = 0 for item in items: total += item.price * item.quantity return total',
        optimized: 'def calculate_total(items): return sum(item.price * item.quantity for item in items)',
        explanation: '使用生成器表达式简化求和计算',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_status(score): if score >= 90: return "A" elif score >= 80: return "B" elif score >= 70: return "C" elif score >= 60: return "D" else: return "F"',
        optimized: 'def get_status(score): grades = [(90, "A"), (80, "B"), (70, "C"), (60, "D")]; return next((g for s, g in grades if score >= s), "F")',
        explanation: '使用数据驱动方式替代if-elif链',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import pickle data = pickle.loads(user_input)',
        optimized: 'import json data = json.loads(user_input)',
        explanation: '使用JSON替代pickle进行数据反序列化',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def process_data(data): result = [] for item in data: if item.active: result.append(transform(item)) return result',
        optimized: 'def process_data(data): return [transform(item) for item in data if item.active]',
        explanation: '使用列表推导式替代循环',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'class Singleton: _instance = None def __new__(cls): if cls._instance is None: cls._instance = super().__new__(cls) return cls._instance',
        optimized: 'from functools import lru_cache @lru_cache(maxsize=1) def get_singleton(): return Singleton()',
        explanation: '使用lru_cache实现单例模式',
        language: 'python',
        issueType: 'code_architecture'
      },
      {
        original: 'def read_file(filename): f = open(filename, "r") content = f.read() f.close() return content',
        optimized: 'def read_file(filename): with open(filename, "r") as f: return f.read()',
        explanation: '使用with语句确保文件正确关闭',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'my_list = [1, 2, 3, 4, 5] squared = [] for x in my_list: squared.append(x ** 2)',
        optimized: 'squared = [x ** 2 for x in [1, 2, 3, 4, 5]]',
        explanation: '使用列表推导式简化映射操作',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'my_dict = {} for key, value in original.items(): my_dict[key] = value * 2',
        optimized: 'my_dict = {k: v * 2 for k, v in original.items()}',
        explanation: '使用字典推导式创建新字典',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def fibonacci(n): if n <= 1: return n return fibonacci(n-1) + fibonacci(n-2)',
        optimized: 'from functools import lru_cache @lru_cache(maxsize=None) def fibonacci(n): if n <= 1: return n return fibonacci(n-1) + fibonacci(n-2)',
        explanation: '使用lru_cache缓存递归结果',
        language: 'python',
        issueType: 'performance_optimization'
      },
      {
        original: 'class DatabaseConnection: def __init__(self): self.connection = None def connect(self): self.connection = create_connection() def close(self): if self.connection: self.connection.close()',
        optimized: 'from contextlib import contextmanager @contextmanager def get_connection(): conn = create_connection() try: yield conn finally: conn.close()',
        explanation: '使用上下文管理器管理数据库连接',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'data = [1, 2, 3, 4, 5] filtered = [] for x in data: if x > 3: filtered.append(x)',
        optimized: 'filtered = list(filter(lambda x: x > 3, data))',
        explanation: '使用filter函数进行过滤',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'total = 0 for x in [1, 2, 3, 4, 5]: total += x',
        optimized: 'total = sum([1, 2, 3, 4, 5])',
        explanation: '使用sum函数求和',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'result = "" for word in ["Hello", "World"]: result += word + " "',
        optimized: 'result = " ".join(["Hello", "World"])',
        explanation: '使用join拼接字符串',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def validate_email(email): if "@" not in email: return False domain = email.split("@")[1] if "." not in domain: return False return True',
        optimized: 'import re def validate_email(email): return bool(re.match(r"^[^@]+@[^@]+\\.[^@]+$", email))',
        explanation: '使用正则表达式验证邮箱格式',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def calculate_bmi(weight, height): bmi = weight / (height ** 2) return bmi',
        optimized: 'def calculate_bmi(weight: float, height: float) -> float: return weight / (height ** 2)',
        explanation: '添加类型注解提高可读性',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'from datetime import datetime def get_timestamp(): now = datetime.now() return now.strftime("%Y-%m-%d %H:%M:%S")',
        optimized: 'from datetime import datetime def get_timestamp(): return datetime.now().isoformat()',
        explanation: '使用isoformat替代手动格式化',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'data = {"name": "Alice", "age": 25} name = data["name"] age = data["age"]',
        optimized: 'data = {"name": "Alice", "age": 25} name, age = data["name"], data["age"]',
        explanation: '使用多变量赋值简化提取',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_user_info(user): name = user.get("name", "Unknown") email = user.get("email", "N/A") return f"{name} ({email})"',
        optimized: 'def get_user_info(user): return f"{user.get(\'name\', \'Unknown\')} ({user.get(\'email\', \'N/A\')})"',
        explanation: '使用f-string格式化简化输出',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'items = [1, 2, 3] doubled = list(map(lambda x: x * 2, items))',
        optimized: 'items = [1, 2, 3] doubled = [x * 2 for x in items]',
        explanation: '使用列表推导式替代map+lambda',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'items = [1, 2, 3, 4, 5] evens = list(filter(lambda x: x % 2 == 0, items))',
        optimized: 'items = [1, 2, 3, 4, 5] evens = [x for x in items if x % 2 == 0]',
        explanation: '使用列表推导式替代filter+lambda',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def process_list(data): result = [] for i, item in enumerate(data): if item > 0: result.append((i, item * 2)) return result',
        optimized: 'def process_list(data): return [(i, x * 2) for i, x in enumerate(data) if x > 0]',
        explanation: '使用列表推导式合并过滤和转换',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_average(numbers): total = sum(numbers) count = len(numbers) if count == 0: return 0 return total / count',
        optimized: 'def get_average(numbers): return sum(numbers) / len(numbers) if numbers else 0',
        explanation: '使用短路求值简化空列表检查',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import os path = "data/file.txt" if os.path.exists(path): os.remove(path)',
        optimized: 'import os path = "data/file.txt" if os.path.exists(path): os.remove(path)',
        explanation: '使用os.path检查文件是否存在',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'class Animal: def __init__(self, name): self.name = name def speak(self): return f"{self.name} makes a sound" class Dog(Animal): def speak(self): return f"{self.name} barks"',
        optimized: 'class Animal: def __init__(self, name): self.name = name def speak(self): return f"{self.name} makes a sound" class Dog(Animal): def speak(self): return f"{self.name} barks"',
        explanation: '正确的类继承和方法重写',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'try: result = risky_operation() except Exception as e: print(f"Error: {e}") result = None',
        optimized: 'try: result = risky_operation() except (ValueError, TypeError) as e: print(f"Error: {e}") result = None',
        explanation: '捕获具体异常替代通用Exception',
        language: 'python',
        issueType: 'error_handling'
      },
      {
        original: 'from collections import Counter words = ["apple", "banana", "apple", "cherry", "banana", "apple"] counts = Counter(words) print(counts.most_common(2))',
        optimized: 'from collections import Counter words = ["apple", "banana", "apple", "cherry", "banana", "apple"] counts = Counter(words) print(counts.most_common(2))',
        explanation: '使用Counter统计词频',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'data = [("a", 1), ("b", 2), ("c", 3)] d = dict() for k, v in data: d[k] = v',
        optimized: 'data = [("a", 1), ("b", 2), ("c", 3)] d = dict(data)',
        explanation: '直接从元组列表创建字典',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def chunk_list(lst, chunk_size): chunks = [] for i in range(0, len(lst), chunk_size): chunks.append(lst[i:i + chunk_size]) return chunks',
        optimized: 'def chunk_list(lst, n): return [lst[i:i+n] for i in range(0, len(lst), n)]',
        explanation: '使用列表推导式简化分块操作',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def merge_dicts(dict1, dict2): result = dict1.copy() result.update(dict2) return result',
        optimized: 'def merge_dicts(dict1, dict2): return {**dict1, **dict2}',
        explanation: '使用双星号运算符合并字典',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_user_name(user_id): try: user = db.get_user(user_id) return user.name except AttributeError: return "Unknown"',
        optimized: 'def get_user_name(user_id): user = db.get_user(user_id) return getattr(user, "name", "Unknown")',
        explanation: '使用getattr安全获取属性',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'data = [1, 2, 3, 4, 5] first = data[0] second = data[1] rest = data[2:]',
        optimized: 'first, second, *rest = [1, 2, 3, 4, 5]',
        explanation: '使用星号表达式进行多元赋值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def is_valid_age(age): if isinstance(age, int) and 0 <= age <= 150: return True return False',
        optimized: 'def is_valid_age(age): return isinstance(age, int) and 0 <= age <= 150',
        explanation: '直接返回布尔表达式简化验证',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def sum_positive(numbers): total = 0 for n in numbers: if n > 0: total += n return total',
        optimized: 'def sum_positive(numbers): return sum(n for n in numbers if n > 0)',
        explanation: '使用生成器表达式求和',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import functools def memoize(fn): cache = {} @functools.wraps(fn) def wrapper(*args): if args not in cache: cache[args] = fn(*args) return cache[args] return wrapper',
        optimized: 'from functools import lru_cache @lru_cache(maxsize=128) def expensive_func(*args): return compute(*args)',
        explanation: '使用lru_cache替代手动实现memoize',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def sort_by_length(words): words.sort(key=len)',
        optimized: 'def sort_by_length(words): return sorted(words, key=len)',
        explanation: '使用sorted返回新列表而非原地排序',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'import json config_file = open("config.json", "r") config = json.load(config_file) config_file.close()',
        optimized: 'import json with open("config.json") as f: config = json.load(f)',
        explanation: '使用with语句确保文件正确关闭',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'def get_data(): data = fetch_from_api() if data is None: data = get_from_cache() if data is None: data = {} return data',
        optimized: 'def get_data(): return fetch_from_api() or get_from_cache() or {}',
        explanation: '使用or链简化空值回退逻辑',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import statistics numbers = [1, 2, 3, 4, 5] avg = statistics.mean(numbers)',
        optimized: 'numbers = [1, 2, 3, 4, 5] avg = sum(numbers) / len(numbers)',
        explanation: '使用内置函数计算平均值避免额外依赖',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_domain(url): url = url.replace("https://", "").replace("http://", "") return url.split("/")[0]',
        optimized: 'from urllib.parse import urlparse def get_domain(url): return urlparse(url).netloc',
        explanation: '使用urllib.parse解析URL',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'items = [("apple", 3), ("banana", 1), ("cherry", 2)] items.sort(key=lambda x: x[1], reverse=True)',
        optimized: 'items = [("apple", 3), ("banana", 1), ("cherry", 2)] items.sort(key=lambda x: -x[1])',
        explanation: '使用取负值替代reverse参数',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def greet(name, greeting="Hello"): return f"{greeting}, {name}!"',
        optimized: 'def greet(name, greeting="Hello"): return f"{greeting}, {name}!"',
        explanation: '使用默认参数简化可选参数',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_absolute_path(relative_path): import os return os.path.join(os.getcwd(), relative_path)',
        optimized: 'from pathlib import Path def get_absolute_path(relative_path): return Path(relative_path).resolve()',
        explanation: '使用pathlib进行路径操作',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'data = {"users": [{"name": "Alice", "age": 25}, {"name": "Bob", "age": 30}]} names = [u["name"] for u in data["users"]]',
        optimized: 'names = [u["name"] for u in data.get("users", [])]',
        explanation: '使用get方法安全访问嵌套数据',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def process_batch(items): results = [] for item in items: try: result = process(item) results.append(result) except Exception as e: print(f"Error processing {item}: {e}") continue return results',
        optimized: 'def process_batch(items): results = [] for item in items: try: results.append(process(item)) except Exception as e: print(f"Error processing {item}: {e}") return results',
        explanation: '简化异常处理逻辑',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'class Cache: def __init__(self): self._data = {} def get(self, key): if key in self._data: return self._data[key] return None def set(self, key, value): self._data[key] = value',
        optimized: 'from collections import OrderedDict class Cache: def __init__(self, max_size=128): self._cache = OrderedDict() self._max_size = max_size def get(self, key): if key in self._cache: self._cache.move_to_end(key) return self._cache[key] return None def set(self, key, value): self._cache[key] = value self._cache.move_to_end(key) if len(self._cache) > self._max_size: self._cache.popitem(last=False)',
        explanation: '使用OrderedDict实现LRU缓存',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'def read_large_file(file_path): with open(file_path, "r") as f: data = f.read() return data',
        optimized: 'def read_large_file(file_path): with open(file_path) as f: for line in f: yield line.strip()',
        explanation: '使用生成器逐行读取大文件',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'import time start = time.time() do_something() elapsed = time.time() - start',
        optimized: 'import time start = time.perf_counter() do_something() elapsed = time.perf_counter() - start',
        explanation: '使用perf_counter进行高精度计时',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def add_item(inventory, item): if item not in inventory: inventory[item] = 0 inventory[item] += 1 return inventory',
        optimized: 'from collections import defaultdict def add_item(inventory, item): inventory[item] += 1 return inventory',
        explanation: '使用defaultdict简化计数逻辑',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'data = [1, 2, 3] a, b, c = data',
        optimized: 'a, b, c = [1, 2, 3]',
        explanation: '使用元组解包简化赋值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def is_empty(value): if value is None: return True if isinstance(value, (list, dict, str)): return len(value) == 0 return False',
        optimized: 'def is_empty(value): return not value',
        explanation: '使用not关键字简化空值检查',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import re text = "Phone: 123-456-7890" match = re.search(r"\\d{3}-\\d{3}-\\d{4}", text) phone = match.group() if match else None',
        optimized: 'import re phone = re.search(r"\\d{3}-\\d{3}-\\d{4}", "Phone: 123-456-7890")',
        explanation: '使用walrus运算符简化正则匹配赋值',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'from typing import List def process_items(items: List[str]) -> List[str]: return [item.upper() for item in items]',
        optimized: 'from typing import List def process_items(items: List[str]) -> List[str]: return [item.upper() for item in items]',
        explanation: '使用类型注解提高代码可读性',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'numbers = [1, 2, 3, 4, 5] result = list(map(str, numbers))',
        optimized: 'result = list(map(str, [1, 2, 3, 4, 5]))',
        explanation: '使用map将数字转换为字符串',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def get_config(): config = {} config["host"] = os.environ.get("DB_HOST", "localhost") config["port"] = int(os.environ.get("DB_PORT", "5432")) config["user"] = os.environ.get("DB_USER", "admin") return config',
        optimized: 'def get_config(): return {"host": os.environ.get("DB_HOST", "localhost"), "port": int(os.environ.get("DB_PORT", "5432")), "user": os.environ.get("DB_USER", "admin")}',
        explanation: '使用字典字面量简化配置创建',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'class User: def __init__(self, name, email): self.name = name self.email = email def __repr__(self): return f"User(name={self.name}, email={self.email})"',
        optimized: 'from dataclasses import dataclass @dataclass class User: name: str email: str',
        explanation: '使用dataclass自动生成__init__和__repr__',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'def calculate_discount(price, is_member): if is_member: return price * 0.9 else: return price',
        optimized: 'def calculate_discount(price, is_member): return price * 0.9 if is_member else price',
        explanation: '使用三元表达式简化if-else',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import math result = math.sqrt(16)',
        optimized: 'import math result = math.isqrt(16)',
        explanation: '使用isqrt计算整数平方根',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'items = [1, 2, 3, 4, 5] doubled = [] for i, item in enumerate(items): doubled.append(item * 2)',
        optimized: 'items = [1, 2, 3, 4, 5] doubled = [x * 2 for x in items]',
        explanation: '简化列表操作去除不必要的enumerate',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'from datetime import datetime, timedelta def get_expiry_date(days=30): return datetime.now() + timedelta(days=days)',
        optimized: 'from datetime import datetime, timedelta def get_expiry_date(days=30): return datetime.now() + timedelta(days=days)',
        explanation: '使用timedelta进行日期计算',
        language: 'python',
        issueType: 'code_quality'
      }
,
      {
        original: 'const sql = "SELECT * FROM users WHERE name = " + userName; db.query(sql);',
        optimized: 'const sql = "SELECT * FROM users WHERE name = ?"; db.query(sql, [userName]);',
        explanation: '使用参数化查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const sql = `DELETE FROM users WHERE id = ${userId}`;',
        optimized: 'const sql = "DELETE FROM users WHERE id = ?"; db.query(sql, [userId]);',
        explanation: '禁止在SQL中使用模板字符串拼接变量',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<div>{{{ userInput }}}</div>',
        optimized: '<div>{{ userInput }}</div>',
        explanation: '使用双花括号自动转义XSS',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'document.getElementById("output").innerHTML = userInput;',
        optimized: 'document.getElementById("output").textContent = userInput;',
        explanation: '使用textContent替代innerHTML防止XSS',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'res.cookie("token", tokenValue);',
        optimized: 'res.cookie("token", tokenValue, { httpOnly: true, secure: true, sameSite: "strict" });',
        explanation: '设置安全Cookie属性防止会话劫持',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const hash = password + salt; const hashed = md5(hash);',
        optimized: 'const hashed = bcrypt.hashSync(password, 10);',
        explanation: '使用bcrypt替代md5进行密码哈希',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use(express.session({ secret: "my-secret" }));',
        optimized: 'app.use(session({ secret: process.env.SESSION_SECRET, httpOnly: true, secure: true, sameSite: "lax" }));',
        explanation: '从环境变量读取密钥并设置安全属性',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/api/data", (req, res) => { res.json(data); });',
        optimized: 'app.use(helmet()); app.get("/api/data", (req, res) => { res.json(data); });',
        explanation: '使用Helmet设置HTTP安全头',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const crypto = require("crypto"); const hash = crypto.createHash("md5").update(data).digest("hex");',
        optimized: 'const crypto = require("crypto"); const hash = crypto.createHash("sha256").update(data).digest("hex");',
        explanation: '使用SHA256替代MD5哈希算法',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'eval(userInput);',
        optimized: 'JSON.parse(userInput);',
        explanation: '禁止使用eval执行用户输入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use(cors());',
        optimized: 'app.use(cors({ origin: "https://trusted-domain.com", credentials: true }));',
        explanation: '限制CORS允许的源域名',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'fetch(url).then(r => r.json()).then(data => console.log(data));',
        optimized: 'fetch(url, { credentials: "same-origin" }).then(r => r.json()).then(data => console.log(data));',
        explanation: '明确指定fetch的credentials策略',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const stmt = db.prepare("SELECT * FROM users WHERE username = ?"); const user = stmt.get(userName);',
        optimized: 'const stmt = db.prepare("SELECT * FROM users WHERE username = ?"); const user = stmt.get(userName);',
        explanation: '使用预编译语句防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.post("/login", (req, res) => { const { username, password } = req.body; res.json({ token: generateToken(username) }); });',
        optimized: 'app.post("/login", rateLimit(5), (req, res) => { const { username, password } = req.body; const isValid = bcrypt.compareSync(password, storedHash); if (!isValid) return res.status(401).json({ error: "Invalid credentials" }); res.json({ token: generateToken(username) }); });',
        explanation: '登录接口添加限流和密码验证',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const html = "<div>" + userInput + "</div>";',
        optimized: 'function escapeHtml(str) { const div = document.createElement("div"); div.textContent = str; return div.innerHTML; } const html = "<div>" + escapeHtml(userInput) + "</div>";',
        explanation: '使用DOM方法进行HTML转义防止XSS',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'crypto.createCipher("aes-128-cbc", key).update(data);',
        optimized: 'crypto.createCipheriv("aes-256-gcm", key, iv).update(data);',
        explanation: '使用GCM模式和随机IV的AES-256加密',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const token = jwt.sign(payload, "secret-key");',
        optimized: 'const token = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });',
        explanation: '使用环境变量存储密钥并指定算法和过期时间',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const fs = require("fs"); fs.readFileSync(userPath);',
        optimized: 'const path = require("path"); const safePath = path.resolve(userPath); if (!safePath.startsWith(ALLOWED_DIR)) throw new Error("Access denied"); fs.readFileSync(safePath);',
        explanation: '路径遍历攻击防护',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'subprocess.exec(userCommand);',
        optimized: 'subprocess.execFile(sanitizedCommand, args);',
        explanation: '使用execFile替代exec防止命令注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.query(`UPDATE users SET name = "${name}" WHERE id = ${id}`);',
        optimized: 'db.query("UPDATE users SET name = ? WHERE id = ?", [name, id]);',
        explanation: '参数化更新查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import requests response = requests.get(url, params={"q": query})',
        optimized: 'import requests response = requests.get(url, params={"q": query}, timeout=5, verify=True)',
        explanation: '添加超时和SSL验证的安全请求',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'subprocess.call(user_input, shell=True)',
        optimized: 'subprocess.call([user_input], shell=False)',
        explanation: '避免使用shell=True防止命令注入',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'open(user_file, "r")',
        optimized: 'import os safe_path = os.path.realpath(user_file) if safe_path.startswith(ALLOWED_DIR): open(safe_path, "r")',
        explanation: '路径遍历攻击防护',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'hashlib.md5(password.encode()).hexdigest()',
        optimized: 'import bcrypt bcrypt.hashpw(password.encode(), bcrypt.gensalt())',
        explanation: '使用bcrypt替代md5密码哈希',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'pickle.loads(user_data)',
        optimized: 'import json json.loads(user_data)',
        explanation: '使用JSON替代pickle反序列化',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'eval(user_expression)',
        optimized: 'import ast ast.literal_eval(user_expression)',
        explanation: '使用ast.literal_eval安全求值',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'Django settings: DEBUG = True',
        optimized: 'Django settings: DEBUG = False ALLOWED_HOSTS = ["example.com"]',
        explanation: '生产环境禁用DEBUG模式',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'const https = require("https"); https.get("https://api.example.com", (res) => {});',
        optimized: 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1"; const https = require("https");',
        explanation: '确保HTTPS证书验证启用',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { res.setHeader("X-Frame-Options", "ALLOW"); next(); });',
        optimized: 'app.use((req, res, next) => { res.setHeader("X-Frame-Options", "DENY"); next(); });',
        explanation: '设置X-Frame-Options防止点击劫持',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'res.setHeader("Content-Security-Policy", "default-src *");',
        optimized: 'res.setHeader("Content-Security-Policy", "default-src \'self\'; script-src \'self\'");',
        explanation: '配置严格的内容安全策略(CSP)',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<a href="/delete?id=1" onclick="return confirm(\'sure?\')">Delete</a>',
        optimized: '<form method="post" action="/delete"><input type="hidden" name="id" value="1"><button type="submit">Delete</button></form>',
        explanation: '使用POST表单替代GET请求执行敏感操作',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const token = localStorage.getItem("auth_token");',
        optimized: 'const token = document.cookie.split("; ").find(row => row.startsWith("auth_token="));',
        explanation: '使用HttpOnly Cookie存储认证token',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'user.password = newPassword;',
        optimized: 'user.passwordHash = bcrypt.hashSync(newPassword, 10);',
        explanation: '存储密码哈希而非明文',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'api.get("/users/" + userId);',
        optimized: 'api.get(`/users/${userId}`, { headers: { "Authorization": `Bearer ${token}` } });',
        explanation: '所有API请求添加认证头',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const connection = mysql.createConnection({ host: "localhost", user: "root", password: "root" });',
        optimized: 'const connection = mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD });',
        explanation: '数据库凭据存储在环境变量中',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<form action="/search" method="get"><input name="q"></form>',
        optimized: '<form action="/search" method="get" accept-charset="utf-8"><input name="q" maxlength="100"></form>',
        explanation: '表单输入添加长度限制',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(express.bodyParser());',
        optimized: 'app.use(express.json({ limit: "1mb" }));',
        explanation: '限制请求体大小防止DoS攻击',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function verifyToken(token) { const decoded = jwt.decode(token, "secret"); return decoded; }',
        optimized: 'function verifyToken(token) { try { return jwt.verify(token, process.env.JWT_SECRET); } catch (e) { return null; } }',
        explanation: '使用jwt.verify替代jwt.decode验证token',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/admin", (req, res) => { if (req.query.admin) { /* admin access */ } });',
        optimized: 'app.get("/admin", authMiddleware, (req, res) => { /* admin access */ });',
        explanation: '使用认证中间件保护管理路由',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'window.location.href = "/redirect?url=" + userInput;',
        optimized: 'const allowedDomains = ["trusted.com"]; const url = new URL(userInput); if (allowedDomains.includes(url.hostname)) window.location.href = url;',
        explanation: '开放重定向攻击防护',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { exec } = require("child_process"); exec(`convert ${imagePath} -resize 100x100 output.jpg`);',
        optimized: 'const { execFile } = require("child_process"); const safeName = imagePath.split("/").pop().replace(/[^a-zA-Z0-9.]/g, ""); execFile("convert", [safeName, "-resize", "100x100", "output.jpg"]);',
        explanation: '命令注入防护，对文件路径进行清理',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'fs.readFile(userPath, (err, data) => { res.send(data); });',
        optimized: 'const resolved = path.resolve(userPath); if (!resolved.startsWith(BASE_DIR)) return res.status(403).send("Forbidden"); fs.readFile(resolved, (err, data) => { res.send(data); });',
        explanation: '路径遍历防护',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); });',
        optimized: 'app.use(cors({ origin: process.env.ALLOWED_ORIGINS.split(",") }));',
        explanation: 'CORS策略限制允许的源',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const password = req.body.password; db.query("UPDATE users SET password = ? WHERE id = ?", [password, userId]);',
        optimized: 'const hashedPassword = bcrypt.hashSync(req.body.password, 10); db.query("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, userId]);',
        explanation: '密码哈希后存储',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import hashlib hashed = hashlib.sha256(password.encode()).hexdigest()',
        optimized: 'import bcrypt hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())',
        explanation: '使用bcrypt替代sha256',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'db.execute(f"SELECT * FROM users WHERE name = \'{name}\'")',
        optimized: 'db.execute("SELECT * FROM users WHERE name = ?", (name,))',
        explanation: 'SQLite参数化查询',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'from django.conf import settings settings.DEBUG = True',
        optimized: 'from django.conf import settings settings.DEBUG = False',
        explanation: '生产环境关闭DEBUG',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'import yaml data = yaml.load(user_input)',
        optimized: 'import yaml data = yaml.safe_load(user_input)',
        explanation: '使用safe_load防止YAML反序列化攻击',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(express.json()); app.listen(3000);',
        optimized: 'const helmet = require("helmet"); const rateLimit = require("express-rate-limit"); app.use(helmet()); app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));',
        explanation: '使用Helmet和限流增强API安全',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/profile", (req, res) => { res.json({ email: req.user.email }); });',
        optimized: 'app.get("/profile", authMiddleware, (req, res) => { res.json({ email: req.user.email }); });',
        explanation: '所有路由添加认证中间件',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<form method="post" action="/submit"><input name="data"></form>',
        optimized: '<form method="post" action="/submit"><input type="hidden" name="_csrf" value="${csrfToken}"><input name="data"></form>',
        explanation: '表单添加CSRF Token防护',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'crypto.createHash("md5").update(password).digest("hex")',
        optimized: 'crypto.scryptSync(password, salt, 64).toString("hex")',
        explanation: '使用scrypt替代md5进行密钥派生',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const fileType = req.files.file.mimetype;',
        optimized: 'const allowedTypes = ["image/jpeg", "image/png", "application/pdf"]; if (!allowedTypes.includes(fileType)) throw new Error("Invalid file type");',
        explanation: '验证上传文件的MIME类型',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'npm install express',
        optimized: 'npm install express@4.18.2 --save-exact',
        explanation: '使用精确版本号安装依赖',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const Redis = require("ioredis"); const redis = new Redis();',
        optimized: 'const redis = new Redis({ password: process.env.REDIS_PASSWORD, tls: { rejectUnauthorized: true } });',
        explanation: 'Redis连接使用密码和TLS',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'window.localStorage.setItem("session_key", value);',
        optimized: 'document.cookie = "session_key=" + value + "; HttpOnly; Secure; SameSite=Strict";',
        explanation: '敏感数据不存储在localStorage中',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const axios = require("axios"); axios.get("http://api.example.com/data");',
        optimized: 'axios.get("https://api.example.com/data");',
        explanation: '使用HTTPS而非HTTP',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.query("SELECT * FROM users")',
        optimized: 'db.query("SELECT id, name, email FROM users")',
        explanation: '只查询需要的字段避免数据泄露',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'res.json(user);',
        optimized: 'const { password, ...safeUser } = user; res.json(safeUser);',
        explanation: '返回数据时排除敏感字段',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function handleFileUpload(req, res) { const file = req.files.upload; file.mv("/uploads/" + file.name); }',
        optimized: 'function handleFileUpload(req, res) { const file = req.files.upload; const ext = path.extname(file.name).toLowerCase(); if (![".jpg", ".png", ".pdf"].includes(ext)) return res.status(400).send("Invalid file type"); const uniqueName = uuid.v4() + ext; file.mv("/uploads/" + uniqueName); }',
        explanation: '文件上传验证类型和生成安全文件名',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'rateLimit({ windowMs: 60000, max: 1000 })',
        optimized: 'rateLimit({ windowMs: 60000, max: 60, skipSuccessfulRequests: true })',
        explanation: '合理的API限流策略',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { req.user = getUserFromToken(req.headers.authorization); next(); });',
        optimized: 'app.use((req, res, next) => { try { req.user = verifyAndDecodeToken(req.headers.authorization); next(); } catch (e) { res.status(401).json({ error: "Unauthorized" }); } });',
        explanation: '认证中间件添加错误处理',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'SELECT * FROM users WHERE id = ?',
        optimized: 'SELECT id, username, email FROM users WHERE id = ?',
        explanation: '避免使用SELECT *暴露所有字段',
        language: 'sql',
        issueType: 'security'
      },
      {
        original: '<meta http-equiv="Content-Security-Policy" content="default-src *">',
        optimized: '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'">',
        explanation: '配置合理的CSP策略',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'const secretKey = "sk-abc123def456";',
        optimized: 'const secretKey = process.env.STRIPE_SECRET_KEY;',
        explanation: '密钥存储在环境变量而非代码中',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function sanitize(input) { return input.replace(/<[^>]*>/g, ""); }',
        optimized: 'const sanitizeHtml = require("sanitize-html"); function sanitize(input) { return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }); }',
        explanation: '使用专用HTML清理库',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'user.input_role = req.body.role;',
        optimized: 'const allowedRoles = ["user", "admin"]; if (!allowedRoles.includes(req.body.role)) return res.status(400).send("Invalid role"); user.input_role = req.body.role;',
        explanation: '使用白名单验证角色输入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import requests response = requests.get(url, params={"q": query})',
        optimized: 'import requests response = requests.get(url, params={"q": query}, timeout=5, verify=True)',
        explanation: '添加SSL验证和超时',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'git add . && git commit -m "update"',
        optimized: 'git add specific_files && git commit -m "update"',
        explanation: '只提交必要文件避免泄露',
        language: 'general',
        issueType: 'security'
      },
      {
        original: '.env file with DATABASE_URL=postgres://user:password@host/db',
        optimized: '.env in .gitignore and use environment variables',
        explanation: '敏感配置不纳入版本控制',
        language: 'general',
        issueType: 'security'
      },
      {
        original: 'axios.post("/api/data", data, { headers: { "Content-Type": "application/json" } });',
        optimized: 'axios.post("/api/data", JSON.stringify(data), { headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken } });',
        explanation: '添加CSRF Token到POST请求',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const crypto = require("crypto"); crypto.randomBytes(16).toString("hex");',
        optimized: 'const crypto = require("crypto"); crypto.randomUUID();',
        explanation: '使用randomUUID生成安全随机ID',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use(express.json({ limit: "50mb" }));',
        optimized: 'app.use(express.json({ limit: "1mb" }));',
        explanation: '合理限制请求体大小',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: '<div v-html="userInput"></div>',
        optimized: '<div>{{ userInput }}</div>',
        explanation: 'Vue中避免使用v-html渲染用户输入',
        language: 'html',
        issueType: 'security'
      },
      {
        original: 'dangerouslySetInnerHTML={{ __html: userInput }}',
        optimized: '{userInput}',
        explanation: 'React中避免使用dangerouslySetInnerHTML',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'Statement stmt = conn.createStatement(); ResultSet rs = stmt.executeQuery("SELECT * FROM users WHERE name = \'" + name + "\'");',
        optimized: 'PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM users WHERE name = ?"); pstmt.setString(1, name); ResultSet rs = pstmt.executeQuery();',
        explanation: 'Java使用PreparedStatement防止SQL注入',
        language: 'java',
        issueType: 'security'
      },
      {
        original: 'password.equals(inputPassword)',
        optimized: 'MessageDigest.getInstance("SHA-256").digest(password.getBytes())',
        explanation: 'Java中使用常量时间比较密码',
        language: 'java',
        issueType: 'security'
      },
      {
        original: 'import go from "os/exec" exec.Command("ls -la").Run()',
        optimized: 'exec.Command("ls", "-la").Run()',
        explanation: 'Go中避免使用shell执行命令',
        language: 'go',
        issueType: 'security'
      },
      {
        original: 'db.Exec("DELETE FROM users WHERE id = " + strconv.Itoa(id))',
        optimized: 'db.Exec("DELETE FROM users WHERE id = ?", id)',
        explanation: 'Go中使用参数化SQL查询',
        language: 'go',
        issueType: 'security'
      },
      {
        original: 'const token = jwt.sign({ role: "admin" }, "key");',
        optimized: 'const token = jwt.sign({ sub: userId, role: "admin" }, process.env.JWT_PRIVATE_KEY, { algorithm: "RS256", expiresIn: "15m" });',
        explanation: '使用非对称加密和短期令牌',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const password = req.body.password; const passwordHash = crypto.createHash("sha256").update(password).digest("hex");',
        optimized: 'const passwordHash = await bcrypt.hash(req.body.password, 12);',
        explanation: '使用bcrypt(12轮)替代sha256',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.post("/upload", (req, res) => { const file = req.files.image; file.save("/uploads/" + file.name); });',
        optimized: 'app.post("/upload", (req, res) => { const file = req.files.image; if (file.size > 5 * 1024 * 1024) return res.status(400).send("Too large"); const ext = file.name.split(".").pop().toLowerCase(); if (!["jpg", "png", "gif"].includes(ext)) return res.status(400).send("Invalid"); const filename = uuid.v4() + "." + ext; file.save("/uploads/" + filename); });',
        explanation: '文件上传完整验证流程',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const ip = req.headers["x-forwarded-for"];',
        optimized: 'const ip = req.ip;',
        explanation: '使用req.ip获取真实IP而非信任代理头',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/verify", (req, res) => { const token = req.query.token; verifyToken(token); });',
        optimized: 'app.get("/verify", (req, res) => { const token = req.query.token; if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).send("Invalid token format"); verifyToken(token); });',
        explanation: 'Token格式验证',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.query(`SELECT * FROM ${tableName}`);',
        optimized: 'const allowedTables = ["users", "products", "orders"]; if (!allowedTables.includes(tableName)) throw new Error("Invalid table name"); db.query(`SELECT * FROM ${tableName}`);',
        explanation: '动态表名使用白名单验证',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "text/html"); next(); });',
        optimized: 'app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });',
        explanation: '设置nosniff防止MIME类型嗅探',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { res.setHeader("Strict-Transport-Security", "max-age=3600"); next(); });',
        optimized: 'app.use((req, res, next) => { res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"); next(); });',
        explanation: 'HSTS设置包含子域和预加载',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use(helmet({ contentSecurityPolicy: false }));',
        optimized: 'app.use(helmet());',
        explanation: '启用所有Helmet安全头默认配置',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const client = new MongoClient("mongodb://user:pass@localhost/db");',
        optimized: 'const client = new MongoClient("mongodb://user:pass@localhost/db?tls=true&authSource=admin");',
        explanation: 'MongoDB连接启用TLS和认证源',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'user.password = generateHash(req.body.password); await user.save();',
        optimized: 'user.password = await bcrypt.hash(req.body.password, 12); await user.save();',
        explanation: '使用bcrypt异步哈希密码',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'ctx.cookies.set("session", sessionId);',
        optimized: 'ctx.cookies.set("session", sessionId, { httpOnly: true, secure: true, sameSite: "strict" });',
        explanation: 'Koa中设置安全Cookie',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function validateInput(input) { if (input.length > 1000) return false; return true; }',
        optimized: 'function validateInput(input) { if (typeof input !== "string" || input.length > 1000) return false; return /^[a-zA-Z0-9\\s]+$/.test(input); }',
        explanation: '输入验证添加类型和格式检查',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const mysql = require("mysql2/promise"); const conn = await mysql.createConnection({ host: "localhost", user: "root" });',
        optimized: 'const conn = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: true });',
        explanation: 'MySQL连接使用环境变量和SSL',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import hashlib hashed = hashlib.sha256(password.encode()).hexdigest()',
        optimized: 'import bcrypt hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))',
        explanation: '使用带轮数的bcrypt',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'def get_user(user_id): return db.query("SELECT * FROM users WHERE id = " + str(user_id))',
        optimized: 'def get_user(user_id): return db.query("SELECT * FROM users WHERE id = ?", (user_id,))',
        explanation: 'Python中使用参数化查询',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'const jwt = require("jsonwebtoken"); const token = jwt.sign(payload, "hardcoded-secret");',
        optimized: 'const jwt = require("jsonwebtoken"); const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });',
        explanation: 'JWT密钥从环境变量读取',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const fs = require("fs"); fs.writeFile("config.json", configData);',
        optimized: 'const fs = require("fs"); fs.writeFile("config.json", JSON.stringify(configData, null, 2), { mode: 0o600 });',
        explanation: '文件写入设置安全权限',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'crypto.createHash("sha1").update(data).digest()',
        optimized: 'crypto.createHash("sha256").update(data).digest()',
        explanation: '使用SHA256替代SHA1',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import tempfile tmp = tempfile.mktemp()',
        optimized: 'import tempfile with tempfile.NamedTemporaryFile(delete=False) as f: tmp = f.name',
        explanation: '使用安全的临时文件创建',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'import os os.system("rm -rf " + user_dir)',
        optimized: 'import subprocess subprocess.run(["rm", "-rf", safe_dir], check=True)',
        explanation: '避免使用os.system执行命令',
        language: 'python',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { res.setHeader("Referrer-Policy", "unsafe-url"); next(); });',
        optimized: 'app.use((req, res, next) => { res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin"); next(); });',
        explanation: '设置严格的Referrer-Policy',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { res.setHeader("Permissions-Policy", "geolocation=()"); next(); });',
        optimized: 'app.use((req, res, next) => { res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()"); next(); });',
        explanation: '配置Permissions-Policy禁用敏感API',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const redis = new Redis(); redis.set("session:" + sid, data);',
        optimized: 'const redis = new Redis({ password: process.env.REDIS_PASSWORD }); redis.setex("session:" + sid, 3600, JSON.stringify(data));',
        explanation: 'Redis添加密码认证和过期时间',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.post("/api/execute", (req, res) => { eval(req.body.code); });',
        optimized: 'app.post("/api/execute", (req, res) => { const sandbox = require("vm").createContext({}); require("vm").runInContext(req.body.code, sandbox, { timeout: 1000 }); });',
        explanation: '代码执行使用沙箱和超时',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function checkPermission(user, action) { if (user.role === "admin") return true; return false; }',
        optimized: 'function checkPermission(user, action) { const allowed = permissions[user.role]; return allowed ? allowed.includes(action) : false; }',
        explanation: '基于角色的权限检查',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'api.post("/data", { name: req.body.name });',
        optimized: 'const Joi = require("joi"); const schema = Joi.object({ name: Joi.string().max(100).required() }); const { error } = schema.validate(req.body); if (error) return res.status(400).send(error.details[0].message);',
        explanation: '使用Joi验证请求数据',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/:id", (req, res) => { const id = req.params.id; db.query("SELECT * FROM items WHERE id = " + id); });',
        optimized: 'app.get("/:id", (req, res) => { const id = parseInt(req.params.id); if (isNaN(id)) return res.status(400).send("Invalid ID"); db.query("SELECT * FROM items WHERE id = ?", [id]); });',
        explanation: '路径参数验证和参数化查询',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use(morgan("combined"));',
        optimized: 'app.use(morgan("combined", { skip: (req, res) => res.statusCode < 400 }));',
        explanation: '日志中跳过正常请求减少敏感信息泄露',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { execSync } = require("child_process"); execSync(`git log -p ${commitHash}`);',
        optimized: 'const { execFile } = require("child_process"); execFile("git", ["log", "-p", safeHash]);',
        explanation: '命令执行参数清理',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const puppeteer = require("puppeteer"); const page = await browser.newPage(); await page.goto(userProvidedUrl);',
        optimized: 'const url = new URL(userProvidedUrl); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid URL"); await page.goto(url.href);',
        explanation: 'Puppeteer中验证URL协议',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const config = require("./config.json");',
        optimized: 'const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));',
        explanation: '配置文件解析而非直接require',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'process.env.SECRET_KEY = "my-secret-key";',
        optimized: 'import dotenv from "dotenv"; dotenv.config(); const SECRET_KEY = process.env.SECRET_KEY;',
        explanation: '使用dotenv管理环境变量',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const ip = req.connection.remoteAddress;',
        optimized: 'const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.connection.remoteAddress;',
        explanation: '正确获取真实客户端IP',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'db.query("INSERT INTO users (name, email) VALUES (" + name + ", " + email + ")");',
        optimized: 'db.query("INSERT INTO users (name, email) VALUES (?, ?)", [name, email]);',
        explanation: 'INSERT语句使用参数化查询',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.use((req, res, next) => { req.startTime = Date.now(); next(); });',
        optimized: 'app.set("trust proxy", 1); app.use((req, res, next) => { req.startTime = Date.now(); next(); });',
        explanation: '设置信任代理正确获取客户端信息',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const { Client } = require("pg"); const client = new Client({ user: "admin", password: "pass", database: "mydb" });',
        optimized: 'const { Client } = require("pg"); const client = new Client({ user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, host: process.env.DB_HOST, ssl: true });',
        explanation: 'PostgreSQL使用环境变量和SSL',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'mongoose.connect("mongodb://localhost/mydb");',
        optimized: 'mongoose.connect(process.env.MONGODB_URI, { ssl: true, sslValidate: true });',
        explanation: 'MongoDB连接使用环境变量和SSL',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'function downloadFile(url) { http.get(url, (res) => { res.pipe(fs.createWriteStream("file")); }); }',
        optimized: 'function downloadFile(url) { const parsedUrl = new URL(url); if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Invalid protocol"); http.get(url, (res) => { res.pipe(fs.createWriteStream("file")); }); }',
        explanation: '下载文件前验证URL协议',
        language: 'javascript',
        issueType: 'security'
      }
,
      {
        original: 'SELECT * FROM users WHERE id = 1;',
        optimized: 'SELECT id, name, email, created_at FROM users WHERE id = 1;',
        explanation: '避免SELECT *只查询需要的字段',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders WHERE user_id = 1;',
        optimized: 'CREATE INDEX idx_orders_user_id ON orders(user_id); SELECT * FROM orders WHERE user_id = 1;',
        explanation: '为常用查询字段创建索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM products WHERE category = "electronics" ORDER BY price;',
        optimized: 'CREATE INDEX idx_products_category_price ON products(category, price); SELECT * FROM products WHERE category = "electronics" ORDER BY price;',
        explanation: '使用复合索引优化排序查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT COUNT(*) FROM users;',
        optimized: 'SELECT COUNT(1) FROM users;',
        explanation: '使用COUNT(1)替代COUNT(*)',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE YEAR(created_at) = 2024;',
        optimized: 'SELECT * FROM users WHERE created_at >= "2024-01-01" AND created_at < "2025-01-01";',
        explanation: '避免在WHERE中使用函数导致索引失效',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders WHERE status IN (1, 2, 3);',
        optimized: 'ALTER TABLE orders ADD INDEX idx_status (status); SELECT * FROM orders WHERE status IN (1, 2, 3);',
        explanation: '为IN查询字段添加索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE name LIKE "%john%";',
        optimized: 'SELECT * FROM users WHERE name LIKE "john%";',
        explanation: '使用前缀通配符使索引用效',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders WHERE user_id = 1 AND status = 2;',
        optimized: 'CREATE INDEX idx_user_status ON orders(user_id, status); SELECT * FROM orders WHERE user_id = 1 AND status = 2;',
        explanation: '创建覆盖索引优化多条件查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT u.*, o.* FROM users u JOIN orders o ON u.id = o.user_id;',
        optimized: 'SELECT u.id, u.name, o.id, o.total FROM users u INNER JOIN orders o ON u.id = o.user_id;',
        explanation: 'JOIN查询只选择必要字段',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE id = (SELECT user_id FROM orders WHERE id = 1);',
        optimized: 'SELECT u.* FROM users u INNER JOIN orders o ON u.id = o.user_id WHERE o.id = 1;',
        explanation: '使用JOIN替代子查询提高性能',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE status = 1);',
        optimized: 'SELECT u.* FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 1);',
        explanation: '使用EXISTS替代IN子查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'INSERT INTO users (name, email) VALUES ("Alice", "alice@test.com"); INSERT INTO users (name, email) VALUES ("Bob", "bob@test.com");',
        optimized: 'INSERT INTO users (name, email) VALUES ("Alice", "alice@test.com"), ("Bob", "bob@test.com");',
        explanation: '批量插入减少数据库交互',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'UPDATE users SET name = "Alice" WHERE id = 1; UPDATE users SET name = "Bob" WHERE id = 2;',
        optimized: 'UPDATE users SET name = CASE id WHEN 1 THEN "Alice" WHEN 2 THEN "Bob" END WHERE id IN (1, 2);',
        explanation: '使用CASE WHEN合并多条更新',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const mysql = require("mysql"); const connection = mysql.createConnection({ host: "localhost", user: "root", password: "pass" });',
        optimized: 'const pool = mysql.createPool({ connectionLimit: 10, host: "localhost", user: "root", password: "pass" });',
        explanation: '使用连接池替代单连接',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'async function getData() { const result = await db.query("SELECT * FROM users"); return result; }',
        optimized: 'const cache = new Map(); async function getData() { const key = "users"; if (cache.has(key)) return cache.get(key); const result = await db.query("SELECT * FROM users"); cache.set(key, result); return result; }',
        explanation: '添加内存缓存减少数据库查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const Redis = require("ioredis"); const redis = new Redis(); async function getUser(id) { const cached = await redis.get(`user:${id}`); if (cached) return JSON.parse(cached); const user = await db.query("SELECT * FROM users WHERE id = ?", [id]); await redis.set(`user:${id}`, JSON.stringify(user), "EX", 3600); return user; }',
        optimized: 'const redis = new Redis(); async function getUser(id) { const cached = await redis.get(`user:${id}`); if (cached) return JSON.parse(cached); const user = await db.query("SELECT * FROM users WHERE id = ?", [id]); await redis.setex(`user:${id}`, 3600, JSON.stringify(user)); return user; }',
        explanation: 'Redis缓存带过期时间',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM logs WHERE created_at > "2024-01-01";',
        optimized: 'CREATE PARTITION TABLE logs (PARTITION BY RANGE (TO_DAYS(created_at))); SELECT * FROM logs WHERE created_at > "2024-01-01";',
        explanation: '使用表分区优化大数据量查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const sqlite3 = require("sqlite3"); const db = new sqlite3.Database("data.db");',
        optimized: 'const db = new sqlite3.Database("data.db"); db.pragma("journal_mode=WAL"); db.pragma("synchronous=NORMAL");',
        explanation: 'SQLite启用WAL模式提高并发性能',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'await Promise.all(ids.map(id => db.query("SELECT * FROM users WHERE id = ?", [id])));',
        optimized: 'await db.query("SELECT * FROM users WHERE id IN (?)", [ids]);',
        explanation: '批量查询替代循环查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { DataTypes } = require("sequelize"); const User = sequelize.define("User", { name: DataTypes.STRING });',
        optimized: 'const User = sequelize.define("User", { name: { type: DataTypes.STRING, allowNull: false, unique: true } }, { indexes: [{ fields: ["name"] }] });',
        explanation: 'Sequelize模型添加索引和约束',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users LIMIT 10000, 10;',
        optimized: 'SELECT * FROM users WHERE id > lastId ORDER BY id LIMIT 10;',
        explanation: '使用游标分页替代LIMIT OFFSET',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.query("SELECT * FROM users WHERE id = " + id);',
        optimized: 'db.query("SELECT * FROM users WHERE id = ?", [id]);',
        explanation: '参数化查询防止SQL注入同时利用查询计划缓存',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'async function getUsers() { const [users] = await db.query("SELECT * FROM users"); return users; }',
        optimized: 'const getUsers = async () => { const [users] = await db.query("SELECT id, name, email FROM users WHERE active = 1"); return users; };',
        explanation: '只查询必要字段添加过滤条件',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'User.findAll({ limit: 100 });',
        optimized: 'User.findAll({ where: { active: true }, attributes: ["id", "name"], limit: 100, cache: true });',
        explanation: 'ORM查询添加条件和缓存',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders;',
        optimized: 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 50;',
        explanation: '查询添加LIMIT限制返回行数',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.query("SELECT * FROM products WHERE name LIKE ?", ["%phone%"]);',
        optimized: 'db.query("SELECT * FROM products WHERE MATCH(name) AGAINST(?)", ["phone"]);',
        explanation: '使用全文索引替代LIKE模糊搜索',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const redis = require("redis"); const client = redis.createClient(); client.set("key", "value");',
        optimized: 'const { createClient } = require("redis"); const client = createClient({ url: "redis://localhost:6379" }); await client.connect(); await client.set("key", "value", { EX: 3600 });',
        explanation: 'Redis添加连接管理和过期时间',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'for (const id of ids) { await db.query("UPDATE users SET status = ? WHERE id = ?", ["active", id]); }',
        optimized: 'const placeholders = ids.map(() => "(?, ?)").join(","); const values = ids.flatMap(id => ["active", id]); await db.query(`INSERT INTO users (status, id) VALUES ${placeholders} ON DUPLICATE KEY UPDATE status = VALUES(status)`, values);',
        explanation: '批量更新使用ON DUPLICATE KEY',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT AVG(price) FROM products WHERE category = "electronics";',
        optimized: 'CREATE INDEX idx_category_price ON products(category, price); SELECT AVG(price) FROM products WHERE category = "electronics";',
        explanation: '索引覆盖聚合查询',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = await db.query("SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id");',
        optimized: 'const result = await db.query("SELECT u.id, u.name, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id, u.name");',
        explanation: '使用GROUP BY聚合减少JOIN结果集',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users;',
        optimized: 'SELECT id, name, email FROM users WHERE active = 1 ORDER BY id LIMIT 100;',
        explanation: '添加查询条件和LIMIT',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.query("SELECT * FROM sessions WHERE token = ?", [token]);',
        optimized: 'db.query("SELECT * FROM sessions WHERE token = ? AND expires_at > NOW()", [token]);',
        explanation: '会话查询添加过期检查',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'INSERT INTO logs (message) VALUES (?)',
        optimized: 'INSERT INTO logs (message, created_at) VALUES (?, NOW())',
        explanation: '日志表添加时间戳',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'User.hasMany(Post); Post.belongsTo(User);',
        optimized: 'User.hasMany(Post, { foreignKey: "user_id", onDelete: "CASCADE" }); Post.belongsTo(User);',
        explanation: 'ORM关系添加外键约束和级联删除',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const result = await db.query("SELECT * FROM products WHERE category = ?", [category]);',
        optimized: 'const cacheKey = `products:${category}`; const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); const result = await db.query("SELECT * FROM products WHERE category = ?", [category]); await redis.setex(cacheKey, 1800, JSON.stringify(result)); return result;',
        explanation: '多级缓存策略',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM notifications WHERE user_id = ? LIMIT 100;',
        optimized: 'CREATE INDEX idx_notifications_user_read ON notifications(user_id, read); SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT 100;',
        explanation: '复合索引优化筛选和排序',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = db.query("SELECT * FROM products WHERE name = ?", [name]);',
        optimized: 'db.query("SELECT * FROM products WHERE name = ?", [name]); const result = db.query("SELECT COUNT(*) FROM products WHERE name = ?", [name]);',
        explanation: '使用COUNT统计替代返回全量数据',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE id BETWEEN 100 AND 200;',
        optimized: 'SELECT * FROM users WHERE id >= 100 AND id <= 200;',
        explanation: '使用>=和<=替代BETWEEN以利用索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const db = new sqlite3.Database("data.db"); db.serialize(() => { db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"); });',
        optimized: 'const db = new sqlite3.Database("data.db"); db.pragma("journal_mode=WAL"); db.serialize(() => { db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)"); });',
        explanation: 'SQLite添加WAL模式和表不存在检查',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'SELECT * FROM orders;',
        optimized: 'SELECT id, user_id, total, status FROM orders WHERE status != "cancelled" ORDER BY id DESC LIMIT 50;',
        explanation: '排除已取消订单并限制返回',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'await db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [userId]);',
        optimized: 'await db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [userId]); // Only update if within threshold',
        explanation: '避免不必要的数据库写入',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = await db.query("SELECT * FROM products WHERE id IN (" + ids.join(",") + ")");',
        optimized: 'const result = await db.query("SELECT * FROM products WHERE id IN (?)", [ids]);',
        explanation: '参数化IN查询防止SQL注入',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'SELECT * FROM users WHERE email = ?',
        optimized: 'SELECT id, name, email, password_hash FROM users WHERE email = ?',
        explanation: '登录查询返回密码哈希用于验证',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'const connection = mysql.createConnection({ host: "localhost", user: "root", password: "", database: "test" });',
        optimized: 'const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 20 });',
        explanation: '使用连接池和环境变量配置',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'SELECT * FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY);',
        optimized: 'CREATE INDEX idx_orders_created_at ON orders(created_at); SELECT * FROM orders WHERE created_at > ?;',
        explanation: '为时间范围查询创建索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = await db.query("SELECT * FROM users"); res.json(result);',
        optimized: 'const result = await db.query("SELECT id, name, email FROM users WHERE active = 1"); res.json(result);',
        explanation: 'API响应排除敏感字段',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'SELECT * FROM products WHERE price > 100;',
        optimized: 'CREATE INDEX idx_products_price ON products(price); SELECT * FROM products WHERE price > 100;',
        explanation: '为范围查询创建索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const query = db.query("SELECT * FROM users WHERE name = " + name);',
        optimized: 'const query = db.query("SELECT * FROM users WHERE name = ?", [name]);',
        explanation: '参数化查询利用执行计划缓存',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'User.findAndCountAll({ where: { status: "active" } });',
        optimized: 'User.findAndCountAll({ where: { status: "active" }, attributes: ["id", "name"], limit: 20, offset: 0 });',
        explanation: '分页查询添加属性选择和限制',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id WHERE orders.id IS NULL;',
        optimized: 'SELECT u.* FROM users u WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);',
        explanation: '使用NOT EXISTS替代LEFT JOIN查找无订单用户',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { Client } = require("pg"); const client = new Client({ connectionString: "postgres://user:pass@localhost/db" });',
        optimized: 'const { Pool } = require("pg"); const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30000 });',
        explanation: 'PostgreSQL使用连接池',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM products WHERE MATCH(description) AGAINST("phone");',
        optimized: 'ALTER TABLE products ADD FULLTEXT INDEX ft_description(description); SELECT * FROM products WHERE MATCH(description) AGAINST("phone" IN NATURAL LANGUAGE MODE);',
        explanation: '创建全文索引用于全文搜索',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const result = db.query("SELECT * FROM users WHERE id = ?", [userId]);',
        optimized: 'const cacheKey = `user:${userId}`; let user = await redis.get(cacheKey); if (user) return JSON.parse(user); user = await db.query("SELECT * FROM users WHERE id = ?", [userId]); await redis.setex(cacheKey, 3600, JSON.stringify(user)); return user;',
        explanation: '单条查询添加Redis缓存',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders WHERE user_id = 1 OR status = 2;',
        optimized: 'CREATE INDEX idx_orders_user_id ON orders(user_id); CREATE INDEX idx_orders_status ON orders(status); SELECT * FROM orders WHERE user_id = 1 OR status = 2;',
        explanation: 'OR查询为每个条件创建独立索引',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");',
        optimized: 'db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");',
        explanation: '建表添加约束和默认值',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'SELECT * FROM products WHERE category = ? ORDER BY price LIMIT 10;',
        optimized: 'CREATE INDEX idx_cat_price ON products(category, price); SELECT * FROM products WHERE category = ? ORDER BY price LIMIT 10;',
        explanation: '复合索引覆盖查询和排序',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'async function getProducts() { const result = await db.query("SELECT * FROM products"); return result; }',
        optimized: 'const getProducts = async () => { const result = await db.query("SELECT id, name, price, category FROM products WHERE active = 1"); return result; };',
        explanation: '查询添加WHERE条件选择必要字段',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users WHERE name LIKE "%son%";',
        optimized: 'SELECT * FROM users WHERE SOUNDEX(name) = SOUNDEX("Jason");',
        explanation: '使用SOUNDEX进行近似匹配',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'INSERT INTO analytics (user_id, event, timestamp) VALUES (?, ?, ?)',
        optimized: 'INSERT INTO analytics (user_id, event, timestamp) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE count = count + 1',
        explanation: '分析数据使用UPSERT',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'db.query("SELECT * FROM orders WHERE user_id = ?", [userId]);',
        optimized: 'const userOrders = await cache.wrap(`orders:${userId}`, () => db.query("SELECT * FROM orders WHERE user_id = ?", [userId]), { ttl: 600 });',
        explanation: '使用缓存包装减少查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'CREATE TABLE users (id INT, name VARCHAR(100));',
        optimized: 'CREATE TABLE users (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100) NOT NULL, email VARCHAR(255) UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);',
        explanation: '建表添加主键、约束和默认值',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'SELECT * FROM users ORDER BY RAND() LIMIT 1;',
        optimized: 'SELECT * FROM users WHERE id >= (SELECT FLOOR(RAND() * (SELECT MAX(id) FROM users))) LIMIT 1;',
        explanation: '优化随机查询避免全表扫描',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const User = sequelize.define("user", { name: Sequelize.STRING });',
        optimized: 'const User = sequelize.define("user", { id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true }, name: { type: Sequelize.STRING(100), allowNull: false, validate: { notEmpty: true } } }, { tableName: "users", timestamps: true });',
        explanation: 'Sequelize模型添加完整定义',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'SELECT * FROM products p JOIN categories c ON p.category_id = c.id;',
        optimized: 'SELECT p.id, p.name, p.price, c.name as category_name FROM products p INNER JOIN categories c ON p.category_id = c.id WHERE p.active = 1;',
        explanation: 'JOIN查询添加WHERE条件和字段选择',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.query("SELECT * FROM users");',
        optimized: 'db.query("SELECT * FROM users WHERE id > ? ORDER BY id LIMIT ?", [lastId, batchSize]);',
        explanation: '大数据量分页查询',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const redis = new Redis(); redis.pipeline().set("key1", "val1").set("key2", "val2").exec();',
        optimized: 'const redis = new Redis(); const pipeline = redis.pipeline(); pipeline.set("key1", "val1"); pipeline.set("key2", "val2"); await pipeline.exec();',
        explanation: 'Redis管道批量命令',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders WHERE YEAR(created_at) = 2024 AND MONTH(created_at) = 6;',
        optimized: 'SELECT * FROM orders WHERE created_at >= "2024-06-01" AND created_at < "2024-07-01";',
        explanation: '日期范围查询避免函数使用',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'User.bulkCreate(users);',
        optimized: 'User.bulkCreate(users, { validate: true, ignoreDuplicates: true });',
        explanation: '批量创建添加验证和忽略重复',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'db.query("CREATE TABLE users (id INT)");',
        optimized: 'db.query("CREATE TABLE IF NOT EXISTS users (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");',
        explanation: '建表添加完整定义和引擎指定',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'const sequelize = new Sequelize("database", "user", "password", { host: "localhost" });',
        optimized: 'const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, { host: process.env.DB_HOST, dialect: "mysql", pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }, logging: false });',
        explanation: 'Sequelize连接池配置',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM orders;',
        optimized: 'SELECT * FROM orders WHERE id > ? ORDER BY id LIMIT 100;',
        explanation: '使用WHERE替代全表扫描',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'for (const user of users) { await User.update(user, { where: { id: user.id } }); }',
        optimized: 'await User.bulkCreate(users, { updateOnDuplicate: ["name", "email"] });',
        explanation: '使用bulkCreate替代逐条更新',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.query("SELECT * FROM users WHERE id = " + userId);',
        optimized: 'const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);',
        explanation: '使用参数化查询和解构结果',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'SELECT * FROM users WHERE id IN (1, 2, 3);',
        optimized: 'SELECT id, name, email FROM users WHERE id IN (1, 2, 3) FOR UPDATE;',
        explanation: '使用FOR UPDATE锁定行保证一致性',
        language: 'sql',
        issueType: 'reliability'
      },
      {
        original: 'db.query("UPDATE users SET name = ? WHERE id = ?", [name, id]);',
        optimized: 'const [result] = await db.query("UPDATE users SET name = ? WHERE id = ?", [name, id]); if (result.affectedRows === 0) throw new Error("User not found");',
        explanation: '检查UPDATE影响行数',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'SELECT * FROM products;',
        optimized: 'SELECT * FROM products WHERE id BETWEEN ? AND ?;',
        explanation: '使用主键范围查询替代全表扫描',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'async function saveData(data) { await db.query("INSERT INTO data (payload) VALUES (?)", [JSON.stringify(data)]); }',
        optimized: 'async function saveData(data) { const client = await pool.connect(); try { await client.query("INSERT INTO data (payload) VALUES ($1)", [JSON.stringify(data)]); } finally { client.release(); } }',
        explanation: '数据库连接使用try-finally释放',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'SELECT * FROM users WHERE name = "John";',
        optimized: 'PREPARE stmt FROM "SELECT * FROM users WHERE name = ?"; SET @name = "John"; EXECUTE stmt USING @name; DEALLOCATE PREPARE stmt;',
        explanation: '使用预编译语句减少SQL解析开销',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.query("DELETE FROM users WHERE id = ?", [id]);',
        optimized: 'db.query("UPDATE users SET deleted_at = NOW() WHERE id = ?", [id]);',
        explanation: '软删除替代硬删除',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'const knex = require("knex")({ client: "pg" });',
        optimized: 'const knex = require("knex")({ client: "pg", connection: process.env.DATABASE_URL, pool: { min: 2, max: 10 } });',
        explanation: 'Knex配置连接池',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id JOIN products p ON o.product_id = p.id;',
        optimized: 'SELECT u.id, u.name, o.id as order_id, p.name as product_name FROM users u INNER JOIN orders o ON u.id = o.user_id INNER JOIN products p ON o.product_id = p.id WHERE o.status = "paid";',
        explanation: '多表JOIN添加条件和字段选择',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'await transaction.start(); await db.query("INSERT INTO orders ..."); await db.query("UPDATE inventory ..."); await transaction.commit();',
        optimized: 'const tx = await db.transaction(); try { await tx.query("INSERT INTO orders ..."); await tx.query("UPDATE inventory ..."); await tx.commit(); } catch (e) { await tx.rollback(); throw e; }',
        explanation: '事务添加错误回滚',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'SELECT * FROM users;',
        optimized: 'SELECT * FROM users ORDER BY id LIMIT 1000 OFFSET 0;',
        explanation: '分页查询避免全表返回',
        language: 'sql',
        issueType: 'performance_optimization'
      },
      {
        original: 'const db = require("better-sqlite3")("data.db"); const insert = db.prepare("INSERT INTO users (name) VALUES (?)");',
        optimized: 'const db = require("better-sqlite3")("data.db"); db.pragma("journal_mode=WAL"); const insert = db.prepare("INSERT INTO users (name) VALUES (?)"); const transaction = db.transaction((names) => { for (const name of names) insert.run(name); });',
        explanation: 'SQLite使用事务批量操作',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'SELECT * FROM products WHERE name LIKE "%iphone%";',
        optimized: 'SELECT * FROM products WHERE name REGEXP "iphone";',
        explanation: '使用REGEXP替代LIKE进行复杂匹配',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'const db = new sqlite3.Database("test.db");',
        optimized: 'const db = new sqlite3.Database("test.db"); db.pragma("journal_mode=WAL"); db.pragma("foreign_keys=ON");',
        explanation: 'SQLite启用外键和WAL模式',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'INSERT INTO users (name, email) VALUES (?, ?)',
        optimized: 'INSERT INTO users (name, email, created_at, updated_at) VALUES (?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE updated_at = NOW()',
        explanation: '使用UPSERT处理重复插入',
        language: 'sql',
        issueType: 'code_quality'
      },
      {
        original: 'const client = new MongoClient("mongodb://localhost:27017");',
        optimized: 'const client = new MongoClient("mongodb://localhost:27017", { maxPoolSize: 20, minPoolSize: 5, serverSelectionTimeoutMS: 5000 });',
        explanation: 'MongoDB客户端连接池配置',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.collection("users").find({}).toArray();',
        optimized: 'db.collection("users").find({ active: true }).project({ name: 1, email: 1 }).limit(100).toArray();',
        explanation: 'MongoDB查询添加条件和投影',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'db.collection("orders").aggregate([{ $match: { status: "paid" } }, { $group: { _id: "$user_id", total: { $sum: "$amount" } } }]);',
        optimized: 'db.collection("orders").aggregate([{ $match: { status: "paid" } }, { $group: { _id: "$user_id", total: { $sum: "$amount" } } }], { allowDiskUse: true, maxTimeMS: 30000 });',
        explanation: 'MongoDB聚合添加选项防止超时',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'db.collection("users").createIndex({ email: 1 });',
        optimized: 'db.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true, background: true });',
        explanation: 'MongoDB索引添加选项',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'db.collection("users").updateOne({ _id: id }, { $set: { name: newName } });',
        optimized: 'const result = await db.collection("users").updateOne({ _id: id, version: expectedVersion }, { $set: { name: newName }, $inc: { version: 1 } }); if (result.matchedCount === 0) throw new Error("Concurrent modification detected");',
        explanation: '乐观锁防止并发修改',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const schema = new Schema({ name: String });',
        optimized: 'const schema = new Schema({ name: { type: String, required: true, index: true, validate: v => v.length > 0 } }, { timestamps: true, versionKey: true });',
        explanation: 'Mongoose Schema添加验证和版本键',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'Model.find({});',
        optimized: 'Model.find({ active: true }).select("name email -_id").limit(50).sort("-createdAt");',
        explanation: 'Mongoose查询添加条件、选择和排序',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const doc = await Model.findById(id); doc.name = "new"; await doc.save();',
        optimized: 'await Model.findByIdAndUpdate(id, { $set: { name: "new" } }, { new: true, runValidators: true });',
        explanation: '使用findByIdAndUpdate替代save',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'Model.deleteOne({ _id: id });',
        optimized: 'Model.findByIdAndUpdate(id, { $set: { deletedAt: new Date() } }, { new: true });',
        explanation: 'Mongoose软删除',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const db = firebase.firestore(); const doc = await db.collection("users").doc(id).get();',
        optimized: 'const doc = await db.collection("users").doc(id).get(); if (!doc.exists()) return null; return { id: doc.id, ...doc.data() };',
        explanation: 'Firestore文档存在性检查',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'db.collection("orders").add({ userId: id, total: 100 });',
        optimized: 'const batch = db.batch(); const orderRef = db.collection("orders").doc(); batch.set(orderRef, { userId: id, total: 100, createdAt: db.FieldValue.serverTimestamp() }); batch.update(userRef, { total: db.FieldValue.increment(100) }); await batch.commit();',
        explanation: 'Firestore批量操作保证原子性',
        language: 'javascript',
        issueType: 'reliability'
      },
      {
        original: 'const ref = db.ref("users/" + userId); ref.once("value", snapshot => { console.log(snapshot.val()); });',
        optimized: 'const snapshot = await db.ref(`users/${userId}`).once("value"); const user = snapshot.val(); if (!user) throw new Error("User not found");',
        explanation: 'Firebase使用once替代on避免泄漏',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'db.collection("users").where("age", ">", 18).get();',
        optimized: 'const snapshot = await db.collection("users").where("age", ">", 18).orderBy("age").limit(50).get(); const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));',
        explanation: 'Firestore查询添加排序和限制',
        language: 'javascript',
        issueType: 'performance_optimization'
      }
,
      {
        original: 'function App() { const [count, setCount] = useState(0); return <div onClick={() => setCount(count + 1)}>{count}</div>; }',
        optimized: 'function App() { const [count, setCount] = useState(0); return <div onClick={() => setCount(c => c + 1)}>{count}</div>; }',
        explanation: '使用函数式更新避免闭包陷阱',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: 'const List = ({ items }) => { const [filtered, setFiltered] = useState(items); return <div>{filtered.map(i => <div key={i.id}>{i.name}</div>)}</div>; };',
        optimized: 'const List = ({ items }) => { const filtered = useMemo(() => items.filter(i => i.active), [items]); return <div>{filtered.map(i => <div key={i.id}>{i.name}</div>)}</div>; };',
        explanation: '使用useMemo优化列表过滤',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'function UserCard({ user }) { return <div><img src={user.avatar} /><h3>{user.name}</h3><p>{user.bio}</p></div>; }',
        optimized: 'const UserCard = React.memo(function UserCard({ user }) { return <div><img src={user.avatar} alt={user.name} /><h3>{user.name}</h3><p>{user.bio}</p></div>; });',
        explanation: '使用React.memo避免不必要的重渲染',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const SearchInput = () => { const [query, setQuery] = useState(""); useEffect(() => { fetchResults(query); }, [query]); return <input value={query} onChange={e => setQuery(e.target.value)} />; };',
        optimized: 'const SearchInput = () => { const [query, setQuery] = useState(""); const debouncedQuery = useDebounce(query, 300); useEffect(() => { fetchResults(debouncedQuery); }, [debouncedQuery]); return <input value={query} onChange={e => setQuery(e.target.value)} />; };',
        explanation: '使用防抖优化搜索输入',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { useState, useEffect } = React; useEffect(() => { const timer = setInterval(() => setCount(c => c + 1), 1000); });',
        optimized: 'useEffect(() => { const timer = setInterval(() => setCount(c => c + 1), 1000); return () => clearInterval(timer); }, []);',
        explanation: 'useEffect正确清理副作用',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'const Button = () => { return <button onclick={handleClick}>Click</button>; }',
        optimized: 'const Button = () => { return <button onClick={handleClick}>Click</button>; }',
        explanation: 'React中使用camelCase事件属性',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const items = [{ id: 1 }, { id: 2 }]; const list = items.map(item => <div>{item.id}</div>);',
        optimized: 'const list = items.map(item => <div key={item.id}>{item.id}</div>);',
        explanation: '列表渲染必须添加key属性',
        language: 'javascript',
        issueType: 'bug_fix'
      },
      {
        original: 'function Form() { const [data, setData] = useState({}); return <form><input value={data.name} onChange={e => setData({ name: e.target.value })} /></form>; }',
        optimized: 'function Form() { const [data, setData] = useState({ name: "", email: "" }); const handleChange = e => setData({ ...data, [e.target.name]: e.target.value }); return <form><input name="name" value={data.name} onChange={handleChange} /><input name="email" value={data.email} onChange={handleChange} /></form>; }',
        explanation: '使用动态属性名简化表单处理',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const UserList = () => { const [users, setUsers] = useState([]); fetch("/api/users").then(r => r.json()).then(data => setUsers(data)); return <div>{users.map(u => <div>{u.name}</div>)}</div>; };',
        optimized: 'const UserList = () => { const [users, setUsers] = useState([]); useEffect(() => { fetch("/api/users").then(r => r.json()).then(setUsers); }, []); return <div>{users.map(u => <div key={u.id}>{u.name}</div>)}</div>; };',
        explanation: '数据获取放入useEffect中',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { createContext, useContext } = React; const ThemeContext = createContext();',
        optimized: 'const ThemeContext = createContext("light"); const ThemeProvider = ({ children }) => { const [theme, setTheme] = useState("light"); return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>; };',
        explanation: '创建带默认值和Provider的Context',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const store = createStore(reducer);',
        optimized: 'const store = createStore(rootReducer, compose(withDevtools(), applyMiddleware(thunk)));',
        explanation: 'Redux Store添加中间件和DevTools',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function mapStateToProps(state) { return { users: state.users, loading: state.loading }; }',
        optimized: 'const mapStateToProps = state => ({ users: state.users, loading: state.loading }); export default connect(mapStateToProps)(UserList);',
        explanation: '简化mapStateToProps和连接组件',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const action = { type: "ADD_USER", user };',
        optimized: 'const addUser = user => ({ type: "ADD_USER", payload: user });',
        explanation: '使用action creator替代内联action',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function reducer(state, action) { switch (action.type) { case "ADD": return { ...state, items: [...state.items, action.item] }; case "REMOVE": return { ...state, items: state.items.filter(i => i.id !== action.id) }; } }',
        optimized: 'function reducer(state, action) { switch (action.type) { case "ADD": return { ...state, items: [...state.items, action.payload] }; case "REMOVE": return { ...state, items: state.items.filter(i => i.id !== action.payload) }; default: return state; } }',
        explanation: 'Redux reducer添加default分支和payload约定',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const App = () => { return <BrowserRouter><Routes><Route path="/" element={<Home />} /></Routes></BrowserRouter>; };',
        optimized: 'const App = () => { return <BrowserRouter><Routes><Route path="/" element={<Home />} /><Route path="/users/:id" element={<UserDetail />} /><Route path="*" element={<NotFound />} /></Routes></BrowserRouter>; };',
        explanation: 'React Router添加动态路由和404处理',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { Link } = require("react-router-dom"); <a href="/about">About</a>',
        optimized: '<Link to="/about" className="nav-link">About</Link>',
        explanation: '使用React Router的Link组件替代a标签',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const image = <img src={url} />;',
        optimized: 'const image = <img src={url} alt="description" loading="lazy" width={400} height={300} />;',
        explanation: '图片添加alt、lazy loading和尺寸',
        language: 'jsx',
        issueType: 'performance_optimization'
      },
      {
        original: '<div style={{ color: "red", fontSize: 16 }}>Error</div>',
        optimized: '<div className="error-message">Error</div>',
        explanation: '使用CSS类替代内联样式',
        language: 'jsx',
        issueType: 'code_quality'
      },
      {
        original: 'const Modal = () => { const [open, setOpen] = useState(false); return <div>{open && <div className="modal">...</div>}<button onClick={() => setOpen(true)}>Open</button></div>; };',
        optimized: 'const Modal = ({ isOpen, onClose }) => { if (!isOpen) return null; return <div className="modal-overlay" onClick={onClose}><div className="modal" onClick={e => e.stopPropagation()}>...</div></div>; };',
        explanation: '受控Modal组件便于复用',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const App = () => { import("./lazy-component"); return <div><Suspense fallback={<Loading />}><LazyComponent /></Suspense></div>; };',
        optimized: 'const LazyComponent = React.lazy(() => import("./lazy-component")); const App = () => <Suspense fallback={<Loading />}><LazyComponent /></Suspense>;',
        explanation: 'React.lazy实现代码分割',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const { useQuery } = require("react-query"); const { data } = useQuery("users", fetchUsers);',
        optimized: 'const { data, isLoading, error } = useQuery({ queryKey: ["users"], queryFn: fetchUsers, staleTime: 60000, refetchOnWindowFocus: false });',
        explanation: 'React Query添加配置选项',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: 'const mutation = useMutation(newUser => axios.post("/api/users", newUser));',
        optimized: 'const mutation = useMutation({ mutationFn: newUser => axios.post("/api/users", newUser), onSuccess: () => queryClient.invalidateQueries("users") });',
        explanation: 'React Query mutation添加缓存失效',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function withAuth(Component) { return function(props) { if (!isAuthenticated) return <Redirect to="/login" />; return <Component {...props} />; }; }',
        optimized: 'const withAuth = Component => props => { const { user } = useAuth(); if (!user) return <Navigate to="/login" replace />; return <Component {...props} />; };',
        explanation: '高阶组件简化为函数式写法',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: '<div v-if="show">Content</div><div v-else>Other</div>',
        optimized: '<div v-show="show">Content</div>',
        explanation: '频繁切换使用v-show替代v-if',
        language: 'vue',
        issueType: 'performance_optimization'
      },
      {
        original: '<li v-for="item in items">{{ item.name }}</li>',
        optimized: '<li v-for="item in items" :key="item.id">{{ item.name }}</li>',
        explanation: 'Vue列表渲染添加key绑定',
        language: 'vue',
        issueType: 'bug_fix'
      },
      {
        original: '<input v-model="message" />',
        optimized: '<input v-model.lazy="message" />',
        explanation: 'v-model使用lazy修饰符减少更新',
        language: 'vue',
        issueType: 'performance_optimization'
      },
      {
        original: 'const app = Vue.createApp({ data() { return { count: 0 }; }, methods: { increment() { this.count++; } } });',
        optimized: 'const app = Vue.createApp({ data: () => ({ count: 0 }), methods: { increment() { this.count++; } }, computed: { doubleCount() { return this.count * 2; } } });',
        explanation: 'Vue添加computed属性',
        language: 'vue',
        issueType: 'code_architecture'
      },
      {
        original: '<template><div>{{ reversedText }}</div></template><script>export default { data() { return { text: "hello" }; }, computed: { reversedText() { return this.text.split("").reverse().join(""); } } };</script>',
        optimized: '<template><div>{{ reversedText }}</div></template><script setup>import { computed, ref } from "vue"; const text = ref("hello"); const reversedText = computed(() => text.value.split("").reverse().join(""));</script>',
        explanation: 'Vue 3使用Composition API',
        language: 'vue',
        issueType: 'code_simplification'
      },
      {
        original: '<div class="container" :style="{ color: textColor }">Text</div>',
        optimized: '<div class="container text-large" :class="{ active: isActive }">Text</div>',
        explanation: '使用:class动态绑定和静态CSS类',
        language: 'vue',
        issueType: 'code_quality'
      },
      {
        original: 'const store = new Vuex.Store({ state: { count: 0 }, mutations: { increment(state) { state.count++; } } });',
        optimized: 'const store = createStore({ state: { count: 0 }, mutations: { increment(state) { state.count++; } }, actions: { incrementAsync({ commit }) { setTimeout(() => commit("increment"), 1000); } } });',
        explanation: 'Vuex Store使用actions处理异步',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const app = Vue.createApp(App); app.use(router); app.mount("#app");',
        optimized: 'const app = Vue.createApp(App); app.use(router); app.use(pinia); app.mount("#app");',
        explanation: 'Vue 3使用Pinia替代Vuex',
        language: 'vue',
        issueType: 'code_architecture'
      },
      {
        original: '<div v-if="loading">Loading...</div><div v-else>{{ data }}</div>',
        optimized: '<Suspense><template #default>{{ data }}</template><template #fallback>Loading...</template></Suspense>',
        explanation: 'Vue 3使用Suspense组件',
        language: 'vue',
        issueType: 'code_architecture'
      },
      {
        original: '.container { display: flex; flex-direction: row; justify-content: center; align-items: center; }',
        optimized: '.container { display: flex; justify-content: center; align-items: center; }',
        explanation: 'Flexbox省略默认的flex-direction: row',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.element { margin-top: 10px; margin-right: 20px; margin-bottom: 10px; margin-left: 20px; }',
        optimized: '.element { margin: 10px 20px; }',
        explanation: '使用CSS简写属性',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '#header { background-color: #ff0000; }',
        optimized: '.header { background: #f00; }',
        explanation: '使用class替代id和简写颜色',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '.box { width: 100px; height: 100px; padding: 10px; border: 1px solid #000; box-sizing: content-box; }',
        optimized: '.box { width: 100px; height: 100px; padding: 10px; border: 1px solid #000; box-sizing: border-box; }',
        explanation: '使用box-sizing: border-box简化尺寸计算',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '@media (max-width: 768px) { .container { font-size: 16px; } } @media (max-width: 480px) { .container { font-size: 14px; } }',
        optimized: '.container { font-size: clamp(14px, 4vw, 16px); }',
        explanation: '使用clamp替代多断点媒体查询',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: '.btn { background-color: #007bff; color: #ffffff; padding: 10px 20px; border-radius: 4px; } .btn:hover { background-color: #0056b3; }',
        optimized: '.btn { background: var(--primary); color: #fff; padding: 10px 20px; border-radius: 4px; transition: background 0.2s; } .btn:hover { background: var(--primary-dark); }',
        explanation: '使用CSS变量和transition',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '.text { font-size: 16px; font-weight: bold; font-style: italic; }',
        optimized: '.text { font: italic bold 16px sans-serif; }',
        explanation: '使用font简写属性',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.element { position: absolute; top: 10px; left: 10px; right: 10px; bottom: 10px; }',
        optimized: '.element { position: absolute; inset: 10px; }',
        explanation: '使用inset简写属性',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.flex { display: flex; flex-direction: column; flex-wrap: wrap; justify-content: flex-start; align-items: flex-start; }',
        optimized: '.flex { display: flex; flex-flow: column wrap; }',
        explanation: '使用flex-flow简写',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: auto auto; gap: 10px; }',
        optimized: '.grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: auto auto; gap: 10px; }',
        explanation: 'Grid使用repeat函数简化',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.responsive { width: 500px; max-width: 100%; }',
        optimized: '.responsive { width: min(500px, 100%); }',
        explanation: '使用min()简化响应式宽度',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '.dark { background-color: #1a1a1a; color: #ffffff; }',
        optimized: ':root { --bg: #fff; --text: #333; } .dark { --bg: #1a1a1a; --text: #fff; } body { background: var(--bg); color: var(--text); }',
        explanation: '使用CSS变量实现主题切换',
        language: 'css',
        issueType: 'code_architecture'
      },
      {
        original: '<div class="float-left">...</div><div class="float-right">...</div><div style="clear: both"></div>',
        optimized: '.container { display: flex; justify-content: space-between; }',
        explanation: '使用Flexbox替代浮动布局',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '.fade-in { animation-name: fadeIn; animation-duration: 1s; animation-timing-function: ease; animation-delay: 0s; animation-iteration-count: 1; }',
        optimized: '.fade-in { animation: fadeIn 1s ease; }',
        explanation: '使用animation简写属性',
        language: 'css',
        issueType: 'code_simplification'
      },
      {
        original: '<img src="photo.jpg" width="800" height="600" alt="A photo">',
        optimized: '<img src="photo.jpg" width="800" height="600" alt="A photo" loading="lazy" decoding="async">',
        explanation: '图片添加懒加载和异步解码',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '<img src="logo.png">',
        optimized: '<picture><source srcset="logo.webp" type="image/webp"><img src="logo.png" alt="Logo" width="200" height="50"></picture>',
        explanation: '使用picture元素提供WebP格式',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '<video src="movie.mp4" controls></video>',
        optimized: '<video src="movie.mp4" controls preload="metadata" poster="poster.jpg" width="640" height="360"></video>',
        explanation: '视频添加preload和poster',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '<div onClick="handleClick()">Click me</div>',
        optimized: '<button type="button" onClick={handleClick}>Click me</button>',
        explanation: '使用语义化button替代div+onclick',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<a href="#" onclick="doSomething()">Link</a>',
        optimized: '<a href="/action" onClick={e => { e.preventDefault(); doSomething(); }}>Link</a>',
        explanation: '使用正确的href和事件处理',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<div class="header"><div class="nav"><a href="#">Home</a><a href="#">About</a></div></div>',
        optimized: '<header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>',
        explanation: '使用语义化HTML5标签',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<div class="article"><h1>Title</h1><p>Content</p></div>',
        optimized: '<article><h1>Title</h1><p>Content</p></article>',
        explanation: '使用article语义标签',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<div class="footer"><p>Copyright 2024</p></div>',
        optimized: '<footer><p>&copy; 2024 Company</p></footer>',
        explanation: '使用footer语义标签',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<table><tr><td>Name</td><td>Age</td></tr><tr><td>John</td><td>30</td></tr></table>',
        optimized: '<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>John</td><td>30</td></tr></tbody></table>',
        explanation: '表格添加thead和tbody结构',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<input type="text">',
        optimized: '<input type="text" id="name" name="name" placeholder="Enter name" required minlength="2" maxlength="50" autocomplete="name">',
        explanation: '表单输入添加完整属性和验证',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<input type="date">',
        optimized: '<input type="date" min="2024-01-01" max="2024-12-31" required>',
        explanation: '日期输入添加范围限制',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<form><input type="text"><input type="submit"></form>',
        optimized: '<form action="/submit" method="post" novalidate><input type="text" name="username" required autocomplete="username"><button type="submit">Submit</button></form>',
        explanation: '表单添加action、method和novalidate',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<html><head><title>Page</title></head><body></body></html>',
        optimized: '<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page</title></head><body></body></html>',
        explanation: 'HTML添加lang、charset和viewport',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<link href="style.css" rel="stylesheet">',
        optimized: '<link href="style.css" rel="stylesheet" media="print" onload="this.media=\'all\'">',
        explanation: 'CSS添加媒体类型优化加载',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '<script src="app.js"></script>',
        optimized: '<script src="app.js" defer></script>',
        explanation: '脚本添加defer属性不阻塞渲染',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '<script src="analytics.js"></script>',
        optimized: '<script src="analytics.js" async></script>',
        explanation: '第三方脚本使用async加载',
        language: 'html',
        issueType: 'performance_optimization'
      },
      {
        original: '<div tabindex="0">Focusable</div>',
        optimized: '<button>Focusable</button>',
        explanation: '使用button替代tabindex的div',
        language: 'html',
        issueType: 'code_quality'
      },
      {
        original: '<div role="button" onclick="action()">Click</div>',
        optimized: '<button type="button" onclick={action}>Click</button>',
        explanation: '使用原生button替代role模拟',
        language: 'html',
        issueType: 'accessibility'
      },
      {
        original: '<img src="chart.png">',
        optimized: '<img src="chart.png" alt="Bar chart showing sales data for Q1 2024">',
        explanation: '图片添加描述性alt文本',
        language: 'html',
        issueType: 'accessibility'
      },
      {
        original: '<div>Click here</div>',
        optimized: '<a href="/destination">Click here</a>',
        explanation: '使用语义化元素保证可访问性',
        language: 'html',
        issueType: 'accessibility'
      },
      {
        original: 'body { font-size: 16px; } .text { font-size: 1.5em; }',
        optimized: 'body { font-size: 1rem; } .text { font-size: 1.5rem; }',
        explanation: '使用rem替代em确保可访问性',
        language: 'css',
        issueType: 'accessibility'
      },
      {
        original: '.text { color: red; }',
        optimized: '.text { color: #d9534f; }',
        explanation: '使用具体颜色值而非颜色名称',
        language: 'css',
        issueType: 'code_quality'
      },
      {
        original: '.btn { background: blue; color: white; }',
        optimized: '.btn { background: #0000ff; color: #ffffff; } @media (prefers-color-scheme: dark) { .btn { background: #0000cc; } }',
        explanation: '支持深色模式',
        language: 'css',
        issueType: 'accessibility'
      },
      {
        original: 'const items = reactive([1, 2, 3]); items.push(4);',
        optimized: 'const items = ref([1, 2, 3]); items.value.push(4);',
        explanation: 'Vue 3使用ref替代reactive处理数组',
        language: 'vue',
        issueType: 'code_quality'
      },
      {
        original: '<template><div>{{ count }}</div></template><script>export default { data() { return { count: 0 }; } }</script>',
        optimized: '<template><div>{{ count }}</div></template><script setup>import { ref } from "vue"; const count = ref(0);</script>',
        explanation: 'Vue 3使用script setup语法',
        language: 'vue',
        issueType: 'code_simplification'
      },
      {
        original: 'const computed = Vue.computed(() => items.filter(i => i.active));',
        optimized: 'const filtered = computed(() => items.value.filter(i => i.active));',
        explanation: 'Vue 3 computed自动解包ref',
        language: 'vue',
        issueType: 'code_simplification'
      },
      {
        original: 'const watcher = Vue.watch(data, () => console.log("changed"));',
        optimized: 'watchEffect(() => console.log(data.value));',
        explanation: 'Vue 3使用watchEffect替代简单watch',
        language: 'vue',
        issueType: 'code_simplification'
      },
      {
        original: '<Transition name="fade"><div v-if="show">Content</div></Transition>',
        optimized: '<Transition name="fade" mode="out-in"><div v-if="show" key="content">Content</div></Transition>',
        explanation: 'Vue Transition添加mode和key',
        language: 'vue',
        issueType: 'code_quality'
      },
      {
        original: '<KeepAlive><router-view /></KeepAlive>',
        optimized: '<KeepAlive include="Dashboard"><router-view /></KeepAlive>',
        explanation: 'KeepAlive添加include指定缓存组件',
        language: 'vue',
        issueType: 'performance_optimization'
      },
      {
        original: 'const router = VueRouter.createRouter({ history: VueRouter.createWebHashHistory(), routes: [...] });',
        optimized: 'const router = VueRouter.createRouter({ history: VueRouter.createWebHistory(), routes: [...], scrollBehavior() { return { top: 0 }; } });',
        explanation: 'Vue Router使用WebHistory和滚动行为',
        language: 'vue',
        issueType: 'code_quality'
      },
      {
        original: 'const { defineStore } = Pinia; const useCounter = defineStore("counter", { state: () => ({ count: 0 }), actions: { increment() { this.count++; } } });',
        optimized: 'const useCounter = defineStore("counter", () => { const count = ref(0); const increment = () => count.value++; return { count, increment }; });',
        explanation: 'Pinia使用Composition API风格',
        language: 'vue',
        issueType: 'code_architecture'
      },
      {
        original: 'const nuxtConfig = { ssr: true, target: "server" };',
        optimized: 'defineNuxtConfig({ ssr: true, devtools: { enabled: true }, modules: ["@pinia/nuxt"] });',
        explanation: 'Nuxt 3使用defineNuxtConfig',
        language: 'vue',
        issueType: 'code_architecture'
      },
      {
        original: '<template><div>{{ $store.state.count }}</div></template>',
        optimized: '<template><div>{{ count }}</div></template><script setup>import { storeToRefs } from "pinia"; const counterStore = useCounterStore(); const { count } = storeToRefs(counterStore);</script>',
        explanation: 'Pinia使用storeToRefs保持响应性',
        language: 'vue',
        issueType: 'code_quality'
      },
      {
        original: '.container { display: grid; grid-template-columns: 1fr 2fr; gap: 20px; }',
        optimized: '.container { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }',
        explanation: 'CSS Grid使用auto-fit和minmax实现响应式',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: '.card { transition: all 0.3s ease; }',
        optimized: '.card { transition: transform 0.3s ease, box-shadow 0.3s ease; }',
        explanation: 'transition只过渡需要的属性',
        language: 'css',
        issueType: 'performance_optimization'
      },
      {
        original: '.hidden { display: none; }',
        optimized: '.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }',
        explanation: '使用visually-hidden替代display:none保证可访问性',
        language: 'css',
        issueType: 'accessibility'
      },
      {
        original: '.content { line-height: 1.5; letter-spacing: 0.5px; max-width: 800px; }',
        optimized: '.content { line-height: 1.6; letter-spacing: 0.02em; max-width: 70ch; }',
        explanation: '排版优化使用ch单位和合适行高',
        language: 'css',
        issueType: 'accessibility'
      },
      {
        original: 'const el = <div className="container">Hello</div>;',
        optimized: 'const el = <div className="container" data-testid="greeting">Hello</div>;',
        explanation: '添加data-testid方便测试',
        language: 'jsx',
        issueType: 'code_quality'
      },
      {
        original: 'const Button = styled.button`background: ${props => props.primary ? "blue" : "white"}; color: ${props => props.primary ? "white" : "black"};`;',
        optimized: 'const Button = styled.button`background: ${props => props.primary ? "var(--primary)" : "white"}); color: ${props => props.primary ? "white" : "black"};`;',
        explanation: 'styled-components结合CSS变量',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { ThemeProvider } = require("styled-components");',
        optimized: '<ThemeProvider theme={theme}><App /></ThemeProvider>',
        explanation: 'styled-components使用ThemeProvider',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { useForm } = require("react-hook-form"); const { register, handleSubmit } = useForm();',
        optimized: 'const { register, handleSubmit, formState: { errors } } = useForm({ mode: "onTouched" });',
        explanation: 'React Hook Form添加验证模式',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const form = useForm(); const { register, handleSubmit } = form;',
        optimized: 'const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm({ defaultValues: { name: "" } });',
        explanation: 'React Hook Form添加默认值和状态',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const result = useSWR("/api/users", fetcher);',
        optimized: 'const { data, error, isValidating } = useSWR("/api/users", fetcher, { revalidateOnFocus: false, dedupingInterval: 5000 });',
        explanation: 'SWR添加配置选项',
        language: 'javascript',
        issueType: 'performance_optimization'
      },
      {
        original: '<swiper><slide v-for="item in items" :key="item.id">{{ item.name }}</slide></swiper>',
        optimized: '<swiper :options="{ slidesPerView: 3, spaceBetween: 10 }"><slide v-for="item in items" :key="item.id">{{ item.name }}</slide></swiper>',
        explanation: 'Swiper添加配置选项',
        language: 'vue',
        issueType: 'code_quality'
      },
      {
        original: '<el-table :data="tableData"><el-table-column prop="name" label="Name"></el-table-column></el-table>',
        optimized: '<el-table :data="tableData" stripe border highlight-current-row><el-table-column prop="name" label="Name" min-width="120"></el-table-column></el-table>',
        explanation: 'Element UI表格添加样式和最小宽度',
        language: 'vue',
        issueType: 'code_quality'
      },
      {
        original: '<a-form-model :model="form" :rules="rules"><a-form-item label="Name"><a-input v-model="form.name" /></a-form-item></a-form-model>',
        optimized: '<a-form :model="formRef" :rules="rules" layout="vertical"><a-form-item label="Name" name="name"><a-input v-model:value="form.name" placeholder="Enter name" /></a-form-item></a-form>',
        explanation: 'Ant Design Vue表单使用v-model:value',
        language: 'vue',
        issueType: 'code_quality'
      }
,
      {
        original: 'const express = require("express"); const app = express(); app.get("/", (req, res) => { res.send("Hello"); });',
        optimized: 'import express from "express"; const app = express(); app.get("/", (req, res) => { res.json({ message: "Hello" }); });',
        explanation: 'Node.js使用ES模块和JSON响应',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const http = require("http"); const server = http.createServer((req, res) => { res.end("Hello"); }); server.listen(3000);',
        optimized: 'const express = require("express"); const app = express(); app.get("/", (req, res) => res.send("Hello")); app.listen(3000);',
        explanation: '使用Express简化HTTP服务器创建',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'function getUser(req, res) { const id = req.params.id; db.query("SELECT * FROM users WHERE id = " + id, (err, result) => { if (err) res.status(500).send(err.message); else res.json(result); }); }',
        optimized: 'async function getUser(req, res) { try { const [user] = await db.query("SELECT * FROM users WHERE id = ?", [req.params.id]); if (!user) return res.status(404).json({ error: "Not found" }); res.json(user); } catch (err) { res.status(500).json({ error: err.message }); } }',
        explanation: 'Node.js使用async/await和参数化查询',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const fs = require("fs"); fs.readFile("file.txt", (err, data) => { if (err) console.error(err); else console.log(data); });',
        optimized: 'const fs = require("fs/promises"); try { const data = await fs.readFile("file.txt", "utf8"); console.log(data); } catch (err) { console.error(err); }',
        explanation: '使用fs/promises异步读取文件',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { exec } = require("child_process"); exec("ls -la", (err, stdout) => { if (err) console.error(err); console.log(stdout); });',
        optimized: 'const { execFile } = require("child_process"); execFile("ls", ["-la"], (err, stdout) => { if (err) console.error(err); console.log(stdout); });',
        explanation: '使用execFile替代exec更安全',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const ws = require("ws"); const server = new ws.Server({ port: 8080 }); server.on("connection", (socket) => { socket.on("message", (msg) => { socket.send("Echo: " + msg); }); });',
        optimized: 'const { WebSocketServer } = require("ws"); const wss = new WebSocketServer({ port: 8080 }); wss.on("connection", (ws) => { ws.on("message", data => { ws.send(`Echo: ${data}`); }); });',
        explanation: 'WebSocket服务器模板字符串和箭头函数',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { createServer } = require("http"); const { parse } = require("url"); createServer((req, res) => { const pathname = parse(req.url).pathname; if (pathname === "/") { res.writeHead(200); res.end("Home"); } else { res.writeHead(404); res.end("Not Found"); } }).listen(3000);',
        optimized: 'const express = require("express"); const app = express(); app.get("/", (req, res) => res.send("Home")); app.use((req, res) => res.status(404).send("Not Found")); app.listen(3000);',
        explanation: '使用Express简化路由',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const config = require("./config.json"); db.connect(config.database);',
        optimized: 'import dotenv from "dotenv"; dotenv.config(); db.connect({ host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT) });',
        explanation: '使用dotenv管理环境配置',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'function log(message) { console.log("[" + new Date() + "] " + message); }',
        optimized: 'import winston from "winston"; const logger = winston.createLogger({ transports: [new winston.transports.Console(), new winston.transports.File({ filename: "app.log" })] }); logger.info("Server started");',
        explanation: '使用Winston替代console.log',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'class UserService { async getUsers() { const users = await db.query("SELECT * FROM users"); return users; } }',
        optimized: 'class UserService { constructor(db) { this.db = db; } async getUsers({ limit = 10, offset = 0 } = {}) { const [users] = await this.db.query("SELECT id, name, email FROM users WHERE active = 1 LIMIT ? OFFSET ?", [limit, offset]); return users; } }',
        explanation: 'Service类添加依赖注入和参数校验',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { v4: uuidv4 } = require("uuid"); const id = uuidv4();',
        optimized: 'const crypto = require("crypto"); const id = crypto.randomUUID();',
        explanation: '使用Node.js内置crypto.randomUUID',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const bcrypt = require("bcrypt"); const hash = bcrypt.hashSync(password, 10);',
        optimized: 'import bcrypt from "bcrypt"; const hash = await bcrypt.hash(password, 12);',
        explanation: '使用bcrypt异步函数和更高轮数',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const jwt = require("jsonwebtoken"); const token = jwt.sign({ id: 1 }, "secret");',
        optimized: 'import jwt from "jsonwebtoken"; const token = jwt.sign({ sub: userId, role }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });',
        explanation: 'JWT添加算法、过期和环境变量',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'class ApiError extends Error { constructor(status, message) { super(message); this.status = message; } }',
        optimized: 'class ApiError extends Error { constructor(statusCode, message) { super(message); this.statusCode = statusCode; this.isOperational = true; Error.captureStackTrace(this, this.constructor); } }',
        explanation: '自定义错误类添加状态码和堆栈',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'app.use((err, req, res, next) => { console.error(err); res.status(500).send("Internal Error"); });',
        optimized: 'app.use((err, req, res, next) => { logger.error(err); res.status(err.statusCode || 500).json({ error: err.message || "Internal Server Error" }); });',
        explanation: '错误处理中间件使用日志和JSON响应',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const router = express.Router(); router.get("/users", (req, res) => { res.json(users); });',
        optimized: 'const router = express.Router(); router.get("/users", validateQuery(schema), userController.list);',
        explanation: '路由添加验证中间件和控制器',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const auth = require("basic-auth"); app.use((req, res, next) => { const credentials = auth.parse(req.headers.authorization); if (credentials && credentials.name === "admin" && credentials.pass === "secret") next(); else res.status(401).send("Unauthorized"); });',
        optimized: 'app.use(basicAuth({ users: { admin: "secret" }, challenge: true, realm: "Imb4e" }));',
        explanation: '使用basic-auth-connect简化认证',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { createHash } = require("crypto"); const hash = createHash("sha256").update(data).digest("hex");',
        optimized: 'const hash = crypto.createHash("sha256").update(data, "utf8").digest("hex");',
        explanation: '使用crypto.createHash指定编码',
        language: 'javascript',
        issueType: 'code_simplification'
      },
      {
        original: 'const { createCipher, createDecipher } = require("crypto");',
        optimized: 'const { createCipheriv, createDecipheriv, randomBytes } = require("crypto");',
        explanation: '使用createCipheriv替代createCipher',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const express = require("express"); const app = express(); app.use(express.json());',
        optimized: 'app.use(express.json({ limit: "1mb" })); app.use(express.urlencoded({ extended: true, limit: "1mb" }));',
        explanation: 'Express body解析添加大小限制',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'app.get("/api/data", (req, res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.json(data); });',
        optimized: 'app.use(cors({ origin: process.env.ALLOWED_ORIGINS.split(","), credentials: true }));',
        explanation: '使用cors中间件管理CORS',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'const helmet = require("helmet"); app.use(helmet());',
        optimized: 'app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["\'self\'"], scriptSrc: ["\'self\'"] } } }));',
        explanation: 'Helmet配置自定义CSP',
        language: 'javascript',
        issueType: 'security'
      },
      {
        original: 'import os',
        optimized: 'import os from "os";',
        explanation: 'Python 3使用import方式',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def process_data(data): result = [] for item in data: if item.get("active"): result.append(item["value"]) return result',
        optimized: 'def process_data(data): return [item["value"] for item in data if item.get("active")]',
        explanation: '使用列表推导式简化',
        language: 'python',
        issueType: 'code_simplification'
      },
      {
        original: 'import requests response = requests.get("https://api.example.com/data") data = response.json()',
        optimized: 'import requests response = requests.get("https://api.example.com/data", timeout=10) response.raise_for_status() data = response.json()',
        explanation: '请求添加超时和错误检查',
        language: 'python',
        issueType: 'reliability'
      },
      {
        original: 'import asyncio async def fetch_data(): await asyncio.sleep(1) return {"status": "ok"}',
        optimized: 'import asyncio async def fetch_data(): await asyncio.sleep(1) return {"status": "ok"} asyncio.run(fetch_data())',
        explanation: '使用asyncio.run运行异步函数',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'from flask import Flask app = Flask(__name__) @app.route("/") def index(): return "Hello"',
        optimized: 'from flask import Flask, jsonify app = Flask(__name__) @app.route("/") def index(): return jsonify({"message": "Hello"})',
        explanation: 'Flask使用jsonify返回JSON',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'def get_db(): db = psycopg2.connect("host=localhost dbname=test") return db',
        optimized: 'from contextlib import contextmanager @contextmanager def get_db(): conn = psycopg2.connect("host=localhost dbname=test") try: yield conn finally: conn.close()',
        explanation: '使用上下文管理器管理数据库连接',
        language: 'python',
        issueType: 'resource_management'
      },
      {
        original: 'import django',
        optimized: 'import django; django.setup();',
        explanation: 'Django管理命令使用setup()',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'SELECT * FROM users;',
        optimized: 'User.objects.filter(active=True).values("id", "name", "email")[:100]',
        explanation: 'Django ORM替代原始SQL',
        language: 'python',
        issueType: 'code_architecture'
      },
      {
        original: 'user = User.objects.get(id=1) user.delete()',
        optimized: 'user = User.objects.get(id=1) user.is_active = False user.save()',
        explanation: 'Django软删除',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'from celery import Celery app = Celery("tasks", broker="redis://localhost")',
        optimized: 'app = Celery("tasks", broker=os.environ.get("CELERY_BROKER_URL", "redis://localhost"))',
        explanation: 'Celery使用环境变量配置',
        language: 'python',
        issueType: 'code_architecture'
      },
      {
        original: '@app.task def send_email(to, subject, body): send_mail(to, subject, body)',
        optimized: '@app.task(bind=True, max_retries=3, default_retry_delay=60) def send_email(self, to, subject, body): try: send_mail(to, subject, body) except Exception as e: raise self.retry(exc=e)',
        explanation: 'Celery任务添加重试机制',
        language: 'python',
        issueType: 'reliability'
      },
      {
        original: 'type User = { name: string; age: number; };',
        optimized: 'interface User { name: string; age: number; readonly createdAt: Date; }',
        explanation: 'TypeScript使用interface替代type',
        language: 'typescript',
        issueType: 'code_quality'
      },
      {
        original: 'function getUser(id: number): Promise<User> { return db.query("SELECT * FROM users WHERE id = " + id); }',
        optimized: 'async function getUser(id: number): Promise<User | null> { const [users] = await db.query<User[]>("SELECT * FROM users WHERE id = ?", [id]); return users[0] || null; }',
        explanation: 'TypeScript函数添加返回类型和null处理',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const user = users.find(u => u.id === userId); console.log(user.name);',
        optimized: 'const user = users.find(u => u.id === userId); if (user) console.log(user.name);',
        explanation: 'TypeScript检查null后访问属性',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const data = response.data; console.log(data);',
        optimized: 'const data = response?.data; console.log(data ?? "No data");',
        explanation: 'TypeScript使用可选链和空值合并',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'function merge(a, b) { return { ...a, ...b }; }',
        optimized: 'function merge<T, U>(a: T, b: U): T & U { return { ...a, ...b }; }',
        explanation: 'TypeScript使用泛型保证类型安全',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const result = someValue ? someValue : defaultValue;',
        optimized: 'const result = someValue ?? defaultValue;',
        explanation: 'TypeScript使用空值合并运算符',
        language: 'typescript',
        issueType: 'code_simplification'
      },
      {
        original: 'interface Config { host: string; port: number; }',
        optimized: 'interface Config { host: string; port: number; readonly id: symbol; } type PartialConfig = Partial<Config>;',
        explanation: 'TypeScript使用Partial工具类型',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'function logError(error) { console.error(error.message); }',
        optimized: 'function logError(error: Error): void { console.error(error.message); }',
        explanation: 'TypeScript函数参数添加类型',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const map = new Map(); map.set("key", 1);',
        optimized: 'const map = new Map<string, number>(); map.set("key", 1);',
        explanation: 'TypeScript Map添加类型参数',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'const arr = [1, 2, 3]; arr.push("4");',
        optimized: 'const arr: number[] = [1, 2, 3]; arr.push(4);',
        explanation: 'TypeScript数组添加类型注解',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'enum Color { Red, Green, Blue }',
        optimized: 'enum Color { Red = "RED", Green = "GREEN", Blue = "BLUE" }',
        explanation: 'TypeScript枚举使用字符串值',
        language: 'typescript',
        issueType: 'code_quality'
      },
      {
        original: 'const obj = {}; obj.name = "test";',
        optimized: 'const obj: Record<string, string> = {}; obj["name"] = "test";',
        explanation: 'TypeScript使用Record类型',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'function getData(id) { return api.get(`/users/${id}`); }',
        optimized: 'async function getData(id: number): Promise<User> { const { data } = await api.get<User>(`/users/${id}`); return data; }',
        explanation: 'TypeScript async函数添加返回类型',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'type User = { name: string; address: { city: string; zip: string; }; };',
        optimized: 'type User = { name: string; address?: { city: string; zip: string; }; };',
        explanation: 'TypeScript使用?标记可选属性',
        language: 'typescript',
        issueType: 'type_safety'
      },
      {
        original: 'func main() { fmt.Println("Hello World") }',
        optimized: 'package main import "fmt" func main() { fmt.Println("Hello, World!") }',
        explanation: 'Go程序结构正确声明',
        language: 'go',
        issueType: 'code_quality'
      },
      {
        original: 'package main import "net/http" func handler(w http.ResponseWriter, r *http.Request) { w.Write([]byte("Hello")) }',
        optimized: 'package main import ("fmt" "net/http") func handler(w http.ResponseWriter, r *http.Request) { fmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:]) }',
        explanation: 'Go HTTP处理器使用fmt.Fprintf',
        language: 'go',
        issueType: 'code_simplification'
      },
      {
        original: 'func GetUser(c *gin.Context) { id := c.Param("id") user, err := db.Query("SELECT * FROM users WHERE id = " + id) if err != nil { c.JSON(500, gin.H{"error": err.Error()}) return } c.JSON(200, user) }',
        optimized: 'func GetUser(c *gin.Context) { id := c.Param("id") var user User if err := db.QueryRow("SELECT * FROM users WHERE id = ?", id).Scan(&user.ID, &user.Name, &user.Email); err != nil { c.JSON(404, gin.H{"error": "User not found"}) return } c.JSON(200, user) }',
        explanation: 'Gin框架使用参数化查询和结构体',
        language: 'go',
        issueType: 'security'
      },
      {
        original: 'func main() { r := gin.Default() r.GET("/ping", func(c *gin.Context) { c.JSON(200, gin.H{"message": "pong"}) }) r.Run(":8080") }',
        optimized: 'func main() { r := gin.Default() r.GET("/ping", func(c *gin.Context) { c.JSON(200, gin.H{"message": "pong"}) }) r.Run(":8080") }',
        explanation: 'Gin框架基本结构',
        language: 'go',
        issueType: 'code_quality'
      },
      {
        original: 'type User struct { Name string Age int }',
        optimized: 'type User struct { ID uint `json:"id" gorm:"primaryKey"` Name string `json:"name" gorm:"not null"` Age int `json:"age"` CreatedAt time.Time `json:"created_at"` }',
        explanation: 'Go结构体添加tag标签',
        language: 'go',
        issueType: 'code_quality'
      },
      {
        original: 'db.Create(&user)',
        optimized: 'result := db.Create(&user) if result.Error != nil { return err } return nil',
        explanation: 'GORM创建记录检查错误',
        language: 'go',
        issueType: 'reliability'
      },
      {
        original: 'gorm.Open("mysql", "user:pass@tcp(localhost:3306)/db?charset=utf8mb4&parseTime=True&loc=Local")',
        optimized: 'dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, password, host, port, dbname) db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})',
        explanation: 'GORM使用DSN变量配置',
        language: 'go',
        issueType: 'code_architecture'
      },
      {
        original: 'func Process(w io.Writer, r *http.Request) { io.Copy(w, r.Body) }',
        optimized: 'func Process(w io.Writer, r *http.Request) { defer r.Body.Close() io.Copy(w, io.LimitReader(r.Body, 1<<20)) }',
        explanation: 'Go HTTP请求体限制和关闭',
        language: 'go',
        issueType: 'resource_management'
      },
      {
        original: 'var wg sync.WaitGroup for i := 0; i < 10; i++ { wg.Add(1) go func() { defer wg.Done() doWork() }() } wg.Wait()',
        optimized: 'var wg sync.WaitGroup for i := 0; i < 10; i++ { wg.Add(1) go func(id int) { defer wg.Done() doWork(id) }(i) } wg.Wait()',
        explanation: 'Goroutine传递参数避免闭包问题',
        language: 'go',
        issueType: 'bug_fix'
      },
      {
        original: 'ch := make(chan int) go func() { ch <- 1 }() val := <-ch',
        optimized: 'ch := make(chan int, 1) go func() { ch <- 1 }() val := <-ch',
        explanation: '使用缓冲channel避免阻塞',
        language: 'go',
        issueType: 'performance_optimization'
      },
      {
        original: 'import "sync" var once sync.Once once.Do(func() { initConfig() })',
        optimized: 'import "sync" var once sync.Once var config *Config once.Do(func() { config = loadConfig() })',
        explanation: 'sync.Once确保初始化只执行一次',
        language: 'go',
        issueType: 'code_architecture'
      },
      {
        original: 'package main public class HelloWorld { public static void main(String[] args) { System.out.println("Hello World"); } }',
        optimized: 'public class HelloWorld { public static void main(String[] args) { System.out.println("Hello, World!"); } }',
        explanation: 'Java程序结构',
        language: 'java',
        issueType: 'code_quality'
      },
      {
        original: 'List<String> names = Arrays.asList("Alice", "Bob"); for (String name : names) { System.out.println(name); }',
        optimized: 'List<String> names = List.of("Alice", "Bob"); names.forEach(System.out::println);',
        explanation: 'Java使用List.of和方法引用',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'Optional<String> name = Optional.ofNullable(getName()); if (name.isPresent()) { System.out.println(name.get()); }',
        optimized: 'getName().ifPresent(System.out::println);',
        explanation: 'Java Optional使用ifPresent',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'Map<String, Integer> scores = new HashMap<>(); scores.put("Alice", 95); scores.put("Bob", 87);',
        optimized: 'Map<String, Integer> scores = Map.of("Alice", 95, "Bob", 87);',
        explanation: 'Java使用Map.of创建不可变Map',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'List<User> activeUsers = new ArrayList<>(); for (User user : users) { if (user.isActive()) { activeUsers.add(user); } }',
        optimized: 'List<User> activeUsers = users.stream().filter(User::isActive).collect(Collectors.toList());',
        explanation: 'Java Stream API过滤集合',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'int sum = 0; for (int num : numbers) { sum += num; }',
        optimized: 'int sum = numbers.stream().mapToInt(Integer::intValue).sum();',
        explanation: 'Java Stream求和',
        language: 'java',
        issueType: 'code_simplification'
      },
      {
        original: 'CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> fetchData()); future.thenAccept(data -> System.out.println(data));',
        optimized: 'CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> fetchData()).orTimeout(5, TimeUnit.SECONDS); future.thenAccept(data -> System.out.println(data)).exceptionally(ex -> { System.err.println(ex.getMessage()); return null; });',
        explanation: 'Java CompletableFuture添加超时和异常处理',
        language: 'java',
        issueType: 'reliability'
      },
      {
        original: '@RestController @RequestMapping("/api/users") public class UserController { @GetMapping("/{id}") public User getUser(@PathVariable Long id) { return userService.findById(id); } }',
        optimized: '@RestController @RequestMapping("/api/users") public class UserController { @GetMapping("/{id}") public ResponseEntity<User> getUser(@PathVariable Long id) { User user = userService.findById(id); return ResponseEntity.ok(user); } }',
        explanation: 'Spring控制器使用ResponseEntity',
        language: 'java',
        issueType: 'code_architecture'
      },
      {
        original: 'SELECT * FROM users;',
        optimized: 'userRepository.findAll(Specification.where(UserSpecs.isActive()))',
        explanation: 'Spring Data JPA使用Specification',
        language: 'java',
        issueType: 'code_architecture'
      },
      {
        original: '@Entity @Table(name = "users") public class User { @Id @GeneratedValue private Long id; private String name; }',
        optimized: '@Entity @Table(name = "users", indexes = @Index(columnList = "email", unique = true)) public class User { @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id; @Column(nullable = false, length = 100) private String name; @Column(unique = true) private String email; }',
        explanation: 'JPA实体添加约束和索引',
        language: 'java',
        issueType: 'code_quality'
      },
      {
        original: '@Service public class UserService { @Autowired private UserRepository userRepository; }',
        optimized: '@Service public class UserService { private final UserRepository userRepository; public UserService(UserRepository userRepository) { this.userRepository = userRepository; } }',
        explanation: 'Spring使用构造器注入',
        language: 'java',
        issueType: 'code_architecture'
      },
      {
        original: 'docker run -p 8080:8080 myapp',
        optimized: 'docker run -d -p 8080:8080 --name myapp -e NODE_ENV=production myapp:latest',
        explanation: 'Docker运行添加名称、环境变量和后台模式',
        language: 'docker',
        issueType: 'code_quality'
      },
      {
        original: 'FROM node:latest WORKDIR /app COPY . . RUN npm install CMD node server.js',
        optimized: 'FROM node:20-alpine AS build WORKDIR /app COPY package*.json ./ RUN npm ci COPY . . RUN npm run build FROM node:20-alpine WORKDIR /app COPY --from=build /app/dist ./dist COPY package*.json ./ RUN npm ci --production CMD node dist/server.js',
        explanation: 'Dockerfile使用多阶段构建',
        language: 'docker',
        issueType: 'performance_optimization'
      },
      {
        original: 'docker-compose.yml with basic config',
        optimized: 'version: "3.8" services: app: build: . ports: - "8080:8080" environment: - NODE_ENV=production depends_on: - db db: image: postgres:15 environment: POSTGRES_PASSWORD: secret volumes: - pgdata:/var/lib/postgresql/data volumes: pgdata:',
        explanation: 'Docker Compose完整配置',
        language: 'docker',
        issueType: 'code_architecture'
      },
      {
        original: 'apiVersion: v1 kind: Pod metadata: name: myapp spec: containers: - name: myapp image: myapp',
        optimized: 'apiVersion: v1 kind: Deployment metadata: name: myapp spec: replicas: 3 selector: matchLabels: app: myapp template: metadata: labels: app: myapp spec: containers: - name: myapp image: myapp:latest ports: - containerPort: 8080 resources: requests: cpu: 100m memory: 128Mi limits: cpu: 500m memory: 256Mi livenessProbe: httpGet: path: /health port: 8080',
        explanation: 'Kubernetes Deployment添加资源限制和健康检查',
        language: 'yaml',
        issueType: 'reliability'
      },
      {
        original: 'kind: Service apiVersion: v1 metadata: name: myapp spec: selector: app: myapp ports: - port: 80',
        optimized: 'kind: Service apiVersion: v1 metadata: name: myapp-service spec: type: LoadBalancer selector: app: myapp ports: - port: 80 targetPort: 8080 protocol: TCP',
        explanation: 'Kubernetes Service添加类型和目标端口',
        language: 'yaml',
        issueType: 'code_architecture'
      },
      {
        original: 'kubectl create deployment myapp --image=myapp',
        optimized: 'kubectl create deployment myapp --image=myapp:1.0.0 --replicas=3 kubectl expose deployment myapp --type=LoadBalancer --port=8080',
        explanation: 'kubectl创建部署和暴露服务',
        language: 'general',
        issueType: 'code_architecture'
      },
      {
        original: 'helm install myapp ./chart',
        optimized: 'helm install myapp ./chart --set replicas=3 --set image.tag=1.0.0 --namespace production',
        explanation: 'Helm安装添加values和namespace',
        language: 'general',
        issueType: 'code_architecture'
      },
      {
        original: 'const { S3 } = require("aws-sdk"); const s3 = new S3(); s3.upload({ Bucket: "mybucket", Key: "file", Body: data }, callback);',
        optimized: 'import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"; const s3 = new S3Client({ region: "us-east-1" }); await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: data, ContentType: contentType }));',
        explanation: 'AWS SDK v3使用模块化客户端',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { DynamoDB } = require("aws-sdk"); const docClient = new DynamoDB.DocumentClient();',
        optimized: 'import { DynamoDBClient } from "@aws-sdk/client-dynamodb"; import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"; const client = new DynamoDBClient({ region: "us-east-1" }); const docClient = DynamoDBDocumentClient.from(client);',
        explanation: 'DynamoDB使用AWS SDK v3',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { Storage } = require("@google-cloud/storage"); const storage = new Storage();',
        optimized: 'import { Storage } from "@google-cloud/storage"; const storage = new Storage({ projectId: process.env.GCP_PROJECT, keyFilename: process.env.GCP_KEY_FILE });',
        explanation: 'GCP Storage使用环境变量配置',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'gcloud compute instances create my-vm --zone us-central1-a',
        optimized: 'gcloud compute instances create my-vm --zone us-central1-a --machine-type n1-standard-2 --image-family debian-11 --boot-disk-size 50 --tags http-server',
        explanation: 'GCP VM创建添加完整参数',
        language: 'general',
        issueType: 'code_quality'
      },
      {
        original: 'terraform { required_providers { aws = { source = "hashicorp/aws" } } }',
        optimized: 'terraform { required_version = ">= 1.0" required_providers { aws = { source = "hashicorp/aws" version = "~> 5.0" } } }',
        explanation: 'Terraform添加版本约束',
        language: 'hcl',
        issueType: 'code_quality'
      },
      {
        original: 'resource "aws_instance" "web" { ami = "ami-0c55b159cbfafe1f0" instance_type = "t2.micro" }',
        optimized: 'resource "aws_instance" "web" { ami = "ami-0c55b159cbfafe1f0" instance_type = "t3.micro" tags = { Name = "web-server" Environment = "production" } }',
        explanation: 'Terraform资源添加标签',
        language: 'hcl',
        issueType: 'code_quality'
      },
      {
        original: 'git commit -m "fix bug"',
        optimized: 'git commit -m "fix: resolve null pointer exception in user service"',
        explanation: 'Git提交使用Conventional Commits格式',
        language: 'general',
        issueType: 'code_quality'
      },
      {
        original: 'const CI = "github actions"',
        optimized: 'name: CI on: [push, pull_request] jobs: build: runs-on: ubuntu-latest steps: - uses: actions/checkout@v4 - uses: actions/setup-node@v4 with: node-version: 20 - run: npm ci - run: npm test',
        explanation: 'GitHub Actions CI配置',
        language: 'yaml',
        issueType: 'code_architecture'
      },
      {
        original: 'const { defineConfig } = require("vitest/config");',
        optimized: 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { environment: "jsdom", coverage: { provider: "v8" } } });',
        explanation: 'Vitest配置添加覆盖率',
        language: 'typescript',
        issueType: 'code_quality'
      },
      {
        original: 'describe("UserService", () => { it("should get user", () => { ... }); });',
        optimized: 'describe("UserService", () => { it("should return user when exists", async () => { const user = await service.getById(1); expect(user).toBeDefined(); expect(user.name).toBe("Alice"); }); it("should throw when not found", async () => { await expect(service.getById(999)).rejects.toThrow("Not found"); }); });',
        explanation: 'Jest测试添加多个用例和断言',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'cy.visit("/"); cy.get(".button").click();',
        optimized: 'cy.visit("/"); cy.get("[data-testid=submit-btn]").should("be.visible").click(); cy.url().should("include", "/success");',
        explanation: 'Cypress测试使用data-testid和断言',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'test("renders correctly", () => { render(<App />); expect(screen.getByText("Hello")).toBeInTheDocument(); });',
        optimized: 'test("renders correctly", () => { render(<App />); expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument(); });',
        explanation: 'React Testing Library使用getByRole',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'import pytest def test_login(): response = client.post("/login", json={"user": "admin", "pass": "secret"}) assert response.status_code == 200',
        optimized: 'import pytest def test_login_success(client): response = client.post("/login", json={"username": "admin", "password": "secret"}) assert response.status_code == 200 assert "token" in response.json def test_login_invalid(client): response = client.post("/login", json={"username": "admin", "password": "wrong"}) assert response.status_code == 401',
        explanation: 'pytest添加成功和失败测试',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'import unittest class TestUser(unittest.TestCase): def test_get_user(self): user = get_user(1) self.assertEqual(user.name, "Alice")',
        optimized: 'import unittest class TestUser(unittest.TestCase): def setUp(self): self.user_service = UserService() def test_get_user_success(self): user = self.user_service.get_user(1) self.assertIsNotNone(user) self.assertEqual(user.name, "Alice") def test_get_user_not_found(self): user = self.user_service.get_user(999) self.assertIsNone(user)',
        explanation: 'Python unittest添加setUp和多个测试',
        language: 'python',
        issueType: 'code_quality'
      },
      {
        original: 'import { chromium } from "playwright";',
        optimized: 'import { chromium } from "playwright"; const browser = await chromium.launch({ headless: false }); const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const page = await context.newPage();',
        explanation: 'Playwright添加浏览器配置',
        language: 'javascript',
        issueType: 'code_quality'
      },
      {
        original: 'const { MongoClient } = require("mongodb"); const client = new MongoClient("mongodb://localhost"); client.connect();',
        optimized: 'const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000 }); await client.connect(); const db = client.db("myapp");',
        explanation: 'MongoDB客户端连接配置',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { Client } = require("pg"); const client = new Client({ connectionString: "postgres://user:pass@localhost/db" }); client.connect();',
        optimized: 'const { Pool } = require("pg"); const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 }); const client = await pool.connect(); try { const result = await client.query("SELECT NOW()"); console.log(result.rows[0]); } finally { client.release(); }',
        explanation: 'PostgreSQL连接池使用',
        language: 'javascript',
        issueType: 'resource_management'
      },
      {
        original: 'const Redis = require("redis"); const redis = new Redis(); redis.set("key", "value");',
        optimized: 'import { createClient } from "redis"; const redis = createClient({ url: process.env.REDIS_URL }); await redis.connect(); await redis.set("key", "value", { EX: 3600 });',
        explanation: 'Redis添加URL配置和过期时间',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { PineconeClient } = require("@pinecone-database/pinecone");',
        optimized: 'import { Pinecone } from "@pinecone-database/pinecone"; const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY, environment: process.env.PINECONE_ENVIRONMENT });',
        explanation: 'Pinecone向量数据库使用新版SDK',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { MilvusClient } = require("@zilliz/milvus2-sdk-node");',
        optimized: 'import { MilvusClient } from "@zilliz/milvus2-sdk-node"; const client = new MilvusClient({ address: process.env.MILVUS_ADDRESS, token: process.env.MILVUS_TOKEN });',
        explanation: 'Milvus向量数据库连接配置',
        language: 'javascript',
        issueType: 'code_architecture'
      },
      {
        original: 'const { qdrant } = require("@qdrant/js-client-rest");',
        optimized: 'import { QdrantClient } from "@qdrant/js-client-rest"; const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });',
        explanation: 'Qdrant向量数据库客户端配置',
        language: 'javascript',
        issueType: 'code_architecture'
      }
    ];

    let addedCases = 0;
    let skippedCases = 0;
    
    for (let i = 0; i < defaultCases.length; i++) {
      const c = defaultCases[i];
      try {
        const existing = db.prepare('SELECT id FROM kb_cases WHERE original_code = ? LIMIT 1').get(c.original);
        if (existing) {
          skippedCases++;
          continue;
        }
        await this.addCase(c.original, c.optimized, c.explanation, {
          language: c.language,
          issueType: c.issueType
        });
        addedCases++;
      } catch (e) {
        logger.warn(`优化案例插入失败 [${i}]: ${e.message}`, e);
      }
    }

    logger.debug(`默认知识库初始化完成 (新增 ${addedEntries} 条知识, 新增 ${addedCases} 个案例, 跳过 ${skippedEntries} 条重复知识, 跳过 ${skippedCases} 个重复案例)`);
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

  async resetKnowledgeBase(confirm = false) {
    await this.init();
    
    if (!confirm) {
      return { 
        success: false, 
        message: '请确认重置操作，这将清空所有现有知识数据并重新初始化默认内容' 
      };
    }

    const db = getDatabase();
    
    try {
      const entriesCount = db.prepare('SELECT COUNT(*) as count FROM kb_entries').get().count;
      const casesCount = db.prepare('SELECT COUNT(*) as count FROM kb_cases').get().count;
      
      logger.warn(`重置知识库：将删除 ${entriesCount} 条知识条目和 ${casesCount} 个案例`);
      
      db.exec('DELETE FROM kb_entries');
      db.exec('DELETE FROM kb_cases');
      
      await this.seedDefaultKnowledge();
      
      const newStats = await this.getStats();
      
      logger.info(`知识库重置完成：${newStats.totalEntries} 条知识, ${newStats.totalCases} 个案例`);
      
      return {
        success: true,
        message: '知识库已重置并重新初始化',
        before: { entries: entriesCount, cases: casesCount },
        after: { entries: newStats.totalEntries, cases: newStats.totalCases }
      };
    } catch (error) {
      logger.error(`重置知识库失败: ${error.message}`);
      return {
        success: false,
        message: `重置失败: ${error.message}`
      };
    }
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
