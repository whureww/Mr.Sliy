const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');
const { logger } = require('./logger');
const mysql = require('./mysql');

let sqliteDb = null;
let retryTimer = null;
const MAX_RETRY_COUNT = 5;
const RETRY_INTERVAL = 30000;

function getSqliteDatabase() {
  if (!sqliteDb) {
    let dbPath = config.database.path;
    if (!path.isAbsolute(dbPath)) {
      const userDataDir = path.join(require('os').homedir(), '.mr-sliy', 'database');
      dbPath = path.join(userDataDir, 'code_optimizer.db');
    }
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');
    initSyncQueueTable();
    createAllTables();
    startRetryTimer();
    logger.info(`SQLite数据库路径: ${dbPath}`);
  }
  return sqliteDb;
}

function initSyncQueueTable() {
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        sql TEXT NOT NULL,
        params TEXT,
        operation_type TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        last_retry_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    logger.debug(`初始化同步队列表失败: ${e.message}`);
  }
}

function createAllTables() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS sys_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      email VARCHAR(100),
      role VARCHAR(20) NOT NULL DEFAULT 'operator',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      last_login_at DATETIME,
      login_count INTEGER DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sys_oper_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username VARCHAR(50),
      operation_type VARCHAR(50) NOT NULL,
      operation_desc TEXT,
      request_method VARCHAR(10),
      request_url VARCHAR(255),
      request_params TEXT,
      response_status INTEGER,
      ip_address VARCHAR(50),
      user_agent TEXT,
      duration_ms INTEGER,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sys_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key VARCHAR(100) NOT NULL UNIQUE,
      config_value TEXT,
      config_type VARCHAR(50),
      description TEXT,
      is_public BOOLEAN DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS scan_project (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name VARCHAR(200) NOT NULL,
      project_path VARCHAR(500),
      project_type VARCHAR(50),
      language VARCHAR(50),
      status VARCHAR(20) DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS scan_task (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      task_name VARCHAR(200) NOT NULL,
      scan_mode VARCHAR(50),
      scan_type VARCHAR(50),
      status VARCHAR(20) DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS code_issue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      project_id INTEGER,
      file_path VARCHAR(500),
      file_name VARCHAR(200),
      line_number INTEGER,
      issue_type VARCHAR(50),
      severity VARCHAR(20),
      title VARCHAR(200),
      description TEXT,
      suggestion TEXT,
      is_fixed BOOLEAN DEFAULT 0,
      fixed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS ai_optimize_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER,
      task_id INTEGER,
      original_code TEXT,
      optimized_code TEXT,
      optimization_type VARCHAR(50),
      confidence REAL DEFAULT 0,
      applied BOOLEAN DEFAULT 0,
      applied_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS code_report (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      project_id INTEGER,
      report_name VARCHAR(200),
      report_type VARCHAR(50),
      report_data TEXT,
      generated_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS llm_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name VARCHAR(50) NOT NULL,
      api_key VARCHAR(255) NOT NULL,
      api_url VARCHAR(255),
      model_name VARCHAR(100),
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS api_access_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_key VARCHAR(64) NOT NULL UNIQUE,
      key_name VARCHAR(100),
      permissions TEXT,
      rate_limit INTEGER DEFAULT 1000,
      expires_at DATETIME,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS self_update_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      update_type VARCHAR(50),
      target_version VARCHAR(20),
      current_version VARCHAR(20),
      version_after VARCHAR(20),
      status VARCHAR(20),
      error_message TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS self_repair_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_type VARCHAR(100),
      error_message TEXT,
      error_stack TEXT,
      affected_component VARCHAR(100),
      repair_status VARCHAR(20),
      repair_result TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS confirmation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_type VARCHAR(50),
      risk_level VARCHAR(20),
      step_name VARCHAR(100),
      step_number INTEGER,
      total_steps INTEGER,
      user_confirmed BOOLEAN,
      confirmed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS kb_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL,
      language TEXT,
      tags TEXT,
      source TEXT,
      vector_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS kb_cases (
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
    )`,
    `CREATE TABLE IF NOT EXISTS code_standards (
      id VARCHAR(36) PRIMARY KEY,
      rule_name VARCHAR(100) NOT NULL,
      rule_description TEXT NOT NULL,
      bad_example TEXT,
      good_example TEXT,
      language VARCHAR(20),
      severity VARCHAR(20),
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      preference_key VARCHAR(100),
      preference_value TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS kb_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key VARCHAR(100),
      value TEXT,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type VARCHAR(100) NOT NULL,
      event_category VARCHAR(100) NOT NULL,
      event_data TEXT,
      severity VARCHAR(20) DEFAULT 'info',
      timestamp BIGINT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sustain_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      condition TEXT NOT NULL,
      action TEXT NOT NULL,
      action_params TEXT,
      priority INTEGER DEFAULT 50,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS rule_execution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id VARCHAR(36) NOT NULL,
      rule_name VARCHAR(100) NOT NULL,
      context TEXT,
      action_taken TEXT,
      result TEXT,
      success INTEGER,
      timestamp BIGINT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS ai_analysis_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_type VARCHAR(50) NOT NULL,
      focus VARCHAR(100) DEFAULT 'general',
      input_data TEXT,
      analysis_result TEXT,
      suggestions TEXT,
      confidence REAL DEFAULT 0,
      executed BOOLEAN DEFAULT 0,
      execution_result TEXT,
      timestamp BIGINT NOT NULL,
      output_data TEXT,
      ai_model VARCHAR(100),
      tokens_used INTEGER,
      duration_ms INTEGER,
      success BOOLEAN DEFAULT 1,
      error_message TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS validation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      validation_type VARCHAR(50) NOT NULL,
      target_id TEXT,
      target_type VARCHAR(50),
      before_state TEXT,
      after_state TEXT,
      metrics_before TEXT,
      metrics_after TEXT,
      success INTEGER DEFAULT 0,
      improvement_score REAL DEFAULT 0,
      timestamp BIGINT NOT NULL,
      cycle_id TEXT,
      result TEXT,
      score REAL,
      passed BOOLEAN DEFAULT 0,
      details TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS api_request_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER,
      provider_name VARCHAR(50),
      endpoint VARCHAR(255),
      request_method VARCHAR(10),
      request_headers TEXT,
      request_body TEXT,
      response_status INTEGER,
      response_body TEXT,
      response_headers TEXT,
      tokens_used INTEGER,
      latency_ms INTEGER,
      error_message TEXT,
      is_success BOOLEAN DEFAULT 1,
      user_id INTEGER,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS code_analysis_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      task_id INTEGER,
      file_path VARCHAR(500),
      file_name VARCHAR(200),
      analysis_type VARCHAR(50),
      analysis_result TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS analysis_result (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER,
      project_id INTEGER,
      task_id INTEGER,
      result_type VARCHAR(50),
      result_data TEXT,
      score REAL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notification (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      message_type VARCHAR(50),
      title VARCHAR(200),
      content TEXT,
      is_read BOOLEAN DEFAULT 0,
      read_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS system_monitor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_type VARCHAR(50),
      metric_name VARCHAR(100),
      metric_value REAL,
      unit VARCHAR(20),
      threshold REAL,
      status VARCHAR(20) DEFAULT 'normal',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS backup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_type VARCHAR(50),
      backup_path VARCHAR(500),
      backup_size INTEGER,
      backup_count INTEGER,
      status VARCHAR(20),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS kb_import_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type VARCHAR(50),
      source_path VARCHAR(500),
      file_count INTEGER,
      imported_count INTEGER,
      status VARCHAR(20),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS dependency_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name VARCHAR(200),
      current_version VARCHAR(50),
      latest_version VARCHAR(50),
      is_outdated BOOLEAN DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS project_analysis_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      analysis_date DATETIME,
      total_files INTEGER,
      total_issues INTEGER,
      fixed_issues INTEGER,
      score REAL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];
  
  for (const sql of tables) {
    try {
      sqliteDb.exec(sql);
    } catch (e) {
      logger.warn(`创建表失败: ${e.message}`);
    }
  }
  
  logger.info(`SQLite数据库表初始化完成（${tables.length}张表）`);
}

function enqueueSyncOperation(tableName, sql, params, operationType) {
  try {
    const id = require('./helpers').generateUUID();
    sqliteDb.prepare(`
      INSERT INTO sync_queue (id, table_name, sql, params, operation_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, tableName, sql, JSON.stringify(params), operationType);
    logger.debug(`操作已加入同步队列 [${tableName}]: ${operationType}`);
  } catch (e) {
    logger.warn(`加入同步队列失败: ${e.message}`);
  }
}

async function processSyncQueue() {
  if (!mysql.isEnabled()) return;
  
  try {
    const pendingOperations = sqliteDb.prepare(`
      SELECT * FROM sync_queue 
      WHERE retry_count < ? 
      ORDER BY created_at ASC
      LIMIT 100
    `).all(MAX_RETRY_COUNT);
    
    if (pendingOperations.length === 0) return;
    
    const pool = mysql.getPool();
    if (!pool) return;
    
    for (const op of pendingOperations) {
      try {
        const params = op.params ? JSON.parse(op.params) : [];
        const convertedParams = convertTimestampParams(params, op.table_name);
        await mysql.execute(op.sql, convertedParams);
        
        sqliteDb.prepare('DELETE FROM sync_queue WHERE id = ?').run(op.id);
        logger.debug(`同步队列操作成功 [${op.table_name}]: ${op.operation_type}`);
      } catch (error) {
        if (error.message.includes('Duplicate entry')) {
          sqliteDb.prepare('DELETE FROM sync_queue WHERE id = ?').run(op.id);
          logger.debug(`同步队列操作跳过（重复主键）[${op.table_name}]`);
          continue;
        }
        
        sqliteDb.prepare(`
          UPDATE sync_queue 
          SET retry_count = retry_count + 1, last_retry_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(op.id);
        logger.debug(`同步队列操作重试失败 [${op.table_name}]: ${error.message}, 重试次数: ${op.retry_count + 1}`);
        
        if (op.retry_count + 1 >= MAX_RETRY_COUNT) {
          logger.debug(`同步队列操作达到最大重试次数，已放弃 [${op.table_name}]: ${op.sql}`);
        }
      }
    }
  } catch (e) {
    logger.debug(`处理同步队列失败: ${e.message}`);
  }
}

function startRetryTimer() {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(processSyncQueue, RETRY_INTERVAL);
  logger.debug('同步队列重试定时器已启动');
  
  mysql.startHealthCheckTimer();
}

function escapeValue(value, convertTimestamp = true) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (convertTimestamp && value > 1000000000000) {
      return "'" + new Date(value).toISOString().slice(0, 19).replace('T', ' ') + "'";
    }
    return value.toString();
  }
  if (value instanceof Date) {
    return "'" + value.toISOString().slice(0, 19).replace('T', ' ') + "'";
  }
  if (typeof value === 'object') {
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
  }
  const strValue = value.toString();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(strValue)) {
    return "'" + strValue.slice(0, 19).replace('T', ' ') + "'";
  }
  return "'" + strValue.replace(/'/g, "''") + "'";
}

function convertTimestampParams(params, tableName = '') {
  const noTimestampTables = ['telemetry_events', 'validation_records', 'ai_analysis_records', 'rule_execution_log'];
  const shouldConvert = !noTimestampTables.includes(tableName);
  
  return params.map(param => {
    if (shouldConvert && typeof param === 'number' && param > 1000000000000) {
      return new Date(param).toISOString().slice(0, 19).replace('T', ' ');
    }
    if (shouldConvert && param instanceof Date) {
      return param.toISOString().slice(0, 19).replace('T', ' ');
    }
    if (shouldConvert && typeof param === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(param)) {
      return param.slice(0, 19).replace('T', ' ');
    }
    return param;
  });
}

function extractTableName(sql) {
  const match = sql.match(/^(INSERT|UPDATE|DELETE)\s+(INTO|FROM)\s+(\w+)/i);
  if (match && match[3]) {
    return match[3];
  }
  return '';
}

function executeMysqlAsync(sql, params, tableName = null) {
  if (!mysql.isEnabled()) return;
  
  setImmediate(async () => {
    try {
      const convertedParams = convertTimestampParams(params, tableName);
      await mysql.execute(sql, convertedParams);
    } catch (error) {
      logger.debug(`MySQL操作失败，加入重试队列: ${error.message}`);
      if (tableName) {
        enqueueSyncOperation(tableName, sql, params, 'execute');
      }
    }
  });
}

function executeMysqlInsertAsync(tableName, rows) {
  if (!mysql.isEnabled() || !Array.isArray(rows) || rows.length === 0) return;
  
  setImmediate(async () => {
    try {
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((_, i) => `?`).join(', ');
      const sql = `INSERT INTO \`${tableName}\` (\`${columns.join('\`, \`')}\`) VALUES (${placeholders})`;
      
      for (const row of rows) {
        const params = convertTimestampParams(columns.map(col => row[col]), tableName);
        await mysql.execute(sql, params);
      }
    } catch (error) {
      logger.debug(`MySQL批量插入失败，加入重试队列 [${tableName}]: ${error.message}`);
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((_, i) => `?`).join(', ');
      const sql = `INSERT INTO \`${tableName}\` (\`${columns.join('\`, \`')}\`) VALUES (${placeholders})`;
      
      for (const row of rows) {
        enqueueSyncOperation(tableName, sql, columns.map(col => row[col]), 'insert');
      }
    }
  });
}

function extractTableName(sql) {
  const match = sql.match(/INSERT\s+INTO\s+`?(\w+)`?|UPDATE\s+`?(\w+)`?|DELETE\s+FROM\s+`?(\w+)`?/i);
  return match ? (match[1] || match[2] || match[3]) : null;
}

async function syncTableSchemaFromSqlite(connection, tableName, targetTableName) {
  try {
    const sqlite = getSqliteDatabase();
    const schemaResult = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
    
    if (!schemaResult || schemaResult.length === 0) {
      throw new Error(`SQLite表 ${tableName} 不存在`);
    }
    
    const columns = schemaResult.map(col => {
      let mysqlType = col.type.toUpperCase();
      
      if (mysqlType === 'INTEGER') {
        mysqlType = col.pk === 1 && col.notnull === 1 ? 'INT PRIMARY KEY AUTO_INCREMENT' : 'INT';
      } else if (mysqlType === 'TEXT') {
        mysqlType = col.pk === 1 ? 'VARCHAR(36)' : 'TEXT';
      } else if (mysqlType === 'REAL') {
        mysqlType = 'DECIMAL(10,2)';
      } else if (mysqlType === 'BOOLEAN') {
        mysqlType = 'TINYINT(1)';
      } else if (mysqlType === 'BIGINT') {
        mysqlType = 'BIGINT';
      } else if (mysqlType === 'DATETIME') {
        mysqlType = 'DATETIME';
      } else if (mysqlType === 'VARCHAR') {
        mysqlType = `VARCHAR(${col.dflt_value || 255})`;
      }
      
      let constraint = '';
      if (col.notnull === 1 && !mysqlType.includes('PRIMARY KEY')) {
        constraint += ' NOT NULL';
      }
      if (col.dflt_value !== null && col.dflt_value !== undefined) {
        let defaultValue = col.dflt_value;
        if (typeof defaultValue === 'string') {
          if (['CURRENT_TIMESTAMP', 'NULL', 'TRUE', 'FALSE', 'NOW()', 'CURDATE()', 'CURTIME()'].includes(defaultValue.toUpperCase())) {
            defaultValue = defaultValue.toUpperCase();
          } else if (!defaultValue.startsWith("'")) {
            defaultValue = `'${defaultValue}'`;
          }
        }
        constraint += ` DEFAULT ${defaultValue}`;
      }
      if (col.pk === 1 && !mysqlType.includes('PRIMARY KEY')) {
        constraint += ' PRIMARY KEY';
      }
      
      return `\`${col.name}\` ${mysqlType}${constraint}`;
    });
    
    const createSql = `CREATE TABLE \`${targetTableName}\` (${columns.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    await connection.execute(createSql);
    
    logger.info(`从SQLite同步表结构成功 [${tableName}]`);
  } catch (error) {
    logger.error(`从SQLite同步表结构失败 [${tableName}]: ${error.message}`);
    throw error;
  }
}

async function ensureTableColumns(connection, tableName) {
  try {
    const sqlite = getSqliteDatabase();
    const sqliteSchema = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
    
    if (!sqliteSchema || sqliteSchema.length === 0) {
      return;
    }
    
    const [mysqlColumns] = await connection.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    const mysqlColumnNames = mysqlColumns.map(col => col.Field);
    
    for (const col of sqliteSchema) {
      if (!mysqlColumnNames.includes(col.name)) {
        let mysqlType = col.type.toUpperCase();
        
        if (mysqlType === 'INTEGER') {
          mysqlType = 'INT';
        } else if (mysqlType === 'TEXT') {
          mysqlType = col.pk === 1 ? 'VARCHAR(36)' : 'TEXT';
        } else if (mysqlType === 'REAL') {
          mysqlType = 'DECIMAL(10,2)';
        } else if (mysqlType === 'BOOLEAN') {
          mysqlType = 'TINYINT(1)';
        } else if (mysqlType === 'BIGINT') {
          mysqlType = 'BIGINT';
        } else if (mysqlType === 'DATETIME') {
          mysqlType = 'DATETIME';
        } else if (mysqlType === 'VARCHAR') {
          mysqlType = `VARCHAR(${col.dflt_value || 255})`;
        }
        
        let constraint = '';
        if (col.notnull === 1) {
          constraint += ' NOT NULL';
        }
        if (col.dflt_value !== null && col.dflt_value !== undefined) {
          let defaultValue = col.dflt_value;
          if (typeof defaultValue === 'string') {
            if (['CURRENT_TIMESTAMP', 'NULL', 'TRUE', 'FALSE', 'NOW()', 'CURDATE()', 'CURTIME()'].includes(defaultValue.toUpperCase())) {
              defaultValue = defaultValue.toUpperCase();
            } else if (!defaultValue.startsWith("'")) {
              defaultValue = `'${defaultValue}'`;
            }
          }
          constraint += ` DEFAULT ${defaultValue}`;
        }
        
        await connection.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${col.name}\` ${mysqlType}${constraint}`);
        logger.info(`为 ${tableName} 表添加缺失列: ${col.name}`);
      }
    }
  } catch (error) {
    logger.warn(`检查 ${tableName} 表列失败: ${error.message}`);
  }
}

function convertSqlForMysql(sql) {
  return sql
    .replace(/\$(\d+)/g, '?')
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'INT PRIMARY KEY AUTO_INCREMENT')
    .replace(/BOOLEAN/g, 'TINYINT(1)')
    .replace(/REAL/g, 'DECIMAL(10,2)')
    .replace(/TEXT PRIMARY KEY/g, 'VARCHAR(36) PRIMARY KEY');
}

function adaptSqliteResultForMysql(tableName, result, params) {
  const sqlite = getSqliteDatabase();
  let row = null;
  
  if (params && params.length > 0) {
    try {
      row = sqlite.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(params[0]);
    } catch (e) {
      logger.debug(`查询插入行失败: ${e.message}`);
    }
  }
  
  if (!row && result.lastInsertRowid) {
    try {
      row = sqlite.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(result.lastInsertRowid);
    } catch (e) {
      logger.debug(`查询插入行失败(使用lastInsertRowid): ${e.message}`);
    }
  }
  
  if (!row && result.changes > 0) {
    try {
      row = sqlite.prepare(`SELECT * FROM ${tableName} ORDER BY id DESC LIMIT 1`).get();
    } catch (e) {
      logger.debug(`查询最新插入行失败: ${e.message}`);
    }
  }
  
  if (row) {
    executeMysqlInsertAsync(tableName, [row]);
  }
}

class DbAdapter {
  constructor() {
    this._sqlite = getSqliteDatabase();
  }

  getSqlite() {
    return this._sqlite;
  }

  isMysqlEnabled() {
    return mysql.isEnabled();
  }

  getSyncQueueCount() {
    try {
      return this._sqlite.prepare('SELECT COUNT(*) as count FROM sync_queue').get().count;
    } catch (e) {
      return 0;
    }
  }

  pragma(...args) {
    return this._sqlite.pragma(...args);
  }

  exec(sql) {
    return this._sqlite.exec(sql);
  }

  prepare(sql) {
    const stmt = this._sqlite.prepare(sql);
    const tableName = extractTableName(sql);
    
    return {
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
      run: (...args) => {
        const result = stmt.run(...args);
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        
        if (mysql.isEnabled() && tableName) {
          const mysqlSql = convertSqlForMysql(sql);
          
          if (sql.toUpperCase().startsWith('INSERT')) {
            adaptSqliteResultForMysql(tableName, result, params);
          } else {
            executeMysqlAsync(mysqlSql, params, tableName);
          }
        }
        
        return result;
      },
      pluck: () => stmt.pluck(),
      expand: () => stmt.expand()
    };
  }

  get(sql, params = []) {
    return this._sqlite.prepare(sql).get(params);
  }

  all(sql, params = []) {
    return this._sqlite.prepare(sql).all(params);
  }

  run(sql, ...args) {
    const tableName = extractTableName(sql);
    const stmt = this._sqlite.prepare(sql);
    const result = stmt.run(...args);
    const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    
    if (mysql.isEnabled() && tableName) {
      const mysqlSql = convertSqlForMysql(sql);
      
      if (sql.toUpperCase().startsWith('INSERT')) {
        adaptSqliteResultForMysql(tableName, result, params);
      } else {
        executeMysqlAsync(mysqlSql, params, tableName);
      }
    }
    
    return result;
  }

  insert(tableName, data) {
    const columns = Object.keys(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const values = columns.map(col => data[col]);
    
    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    const result = this._sqlite.prepare(sql).run(values);
    
    if (mysql.isEnabled()) {
      executeMysqlInsertAsync(tableName, [data]);
    }
    
    return result;
  }

  insertMany(tableName, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    
    const sqlOperations = [];
    
    const insertManyTx = this._sqlite.transaction((items) => {
      const stmt = this._sqlite.prepare(sql);
      for (const item of items) {
        const params = columns.map(col => item[col]);
        sqlOperations.push({ sql, params: [params] });
        stmt.run(params);
      }
    });
    
    insertManyTx(rows);
    
    if (mysql.isEnabled()) {
      setImmediate(async () => {
        try {
          const pool = mysql.getPool();
          if (pool) {
            const connection = await pool.getConnection();
            await connection.beginTransaction();
            try {
              for (const op of sqlOperations) {
                const mysqlSql = convertSqlForMysql(op.sql);
                const params = Array.isArray(op.params[0]) ? op.params[0] : [];
                const convertedParams = convertTimestampParams(params, tableName);
                await connection.execute(mysqlSql, convertedParams);
              }
              await connection.commit();
            } catch (error) {
              await connection.rollback();
              logger.debug(`MySQL批量插入失败: ${error.message}`);
              for (const op of sqlOperations) {
                enqueueSyncOperation(tableName, convertSqlForMysql(op.sql), Array.isArray(op.params[0]) ? op.params[0] : [], 'insert');
              }
            } finally {
              connection.release();
            }
          }
        } catch (error) {
          logger.warn(`MySQL批量插入初始化失败: ${error.message}`);
          for (const op of sqlOperations) {
            enqueueSyncOperation(tableName, convertSqlForMysql(op.sql), Array.isArray(op.params[0]) ? op.params[0] : [], 'insert');
          }
        }
      });
    }
  }

  update(tableName, data, where) {
    const setClause = Object.keys(data).map((key, i) => `${key} = $${i + 1}`).join(', ');
    const whereClause = Object.keys(where).map((key, i) => `${key} = $${Object.keys(data).length + i + 1}`).join(' AND ');
    
    const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;
    const values = [...Object.values(data), ...Object.values(where)];
    
    const result = this._sqlite.prepare(sql).run(values);
    
    if (mysql.isEnabled()) {
      const mysqlSetClause = Object.keys(data).map(key => `\`${key}\` = ?`).join(', ');
      const mysqlWhereClause = Object.keys(where).map(key => `\`${key}\` = ?`).join(' AND ');
      const mysqlSql = `UPDATE \`${tableName}\` SET ${mysqlSetClause} WHERE ${mysqlWhereClause}`;
      executeMysqlAsync(mysqlSql, [...Object.values(data), ...Object.values(where)]);
    }
    
    return result;
  }

  delete(tableName, where) {
    const whereClause = Object.keys(where).map((key, i) => `${key} = $${i + 1}`).join(' AND ');
    const sql = `DELETE FROM ${tableName} WHERE ${whereClause}`;
    const values = Object.values(where);
    
    const result = this._sqlite.prepare(sql).run(values);
    
    if (mysql.isEnabled()) {
      const mysqlWhereClause = Object.keys(where).map(key => `\`${key}\` = ?`).join(' AND ');
      const mysqlSql = `DELETE FROM \`${tableName}\` WHERE ${mysqlWhereClause}`;
      executeMysqlAsync(mysqlSql, values);
    }
    
    return result;
  }

  transaction(fn) {
    let result;
    const sqlOperations = [];
    const originalPrepare = this._sqlite.prepare.bind(this._sqlite);
    
    try {
      this._sqlite.prepare = (sql) => {
        const stmt = originalPrepare(sql);
        const originalRun = stmt.run.bind(stmt);
        stmt.run = (...args) => {
          const tableName = extractTableName(sql);
          sqlOperations.push({ sql, params: args, tableName });
          return originalRun(...args);
        };
        return stmt;
      };
      
      result = this._sqlite.transaction(fn)();
    } finally {
      this._sqlite.prepare = originalPrepare;
    }
    
    if (mysql.isEnabled() && sqlOperations.length > 0) {
      setImmediate(async () => {
        try {
          const pool = mysql.getPool();
          if (pool) {
            const connection = await pool.getConnection();
            await connection.beginTransaction();
            try {
              for (const op of sqlOperations) {
                const mysqlSql = convertSqlForMysql(op.sql);
                const params = Array.isArray(op.params[0]) ? op.params[0] : [];
                const convertedParams = convertTimestampParams(params, op.tableName);
                await connection.execute(mysqlSql, convertedParams);
              }
              await connection.commit();
            } catch (error) {
              await connection.rollback();
              logger.warn(`MySQL事务失败: ${error.message}`);
            } finally {
              connection.release();
            }
          }
        } catch (error) {
          logger.warn(`MySQL事务初始化失败: ${error.message}`);
        }
      });
    }
    
    return result;
  }

  async syncLocalToRemote(tableName) {
    if (!mysql.isEnabled()) {
      logger.warn('MySQL未启用，无法同步');
      return { success: false, message: 'MySQL未启用' };
    }

    try {
      const rows = this._sqlite.prepare(`SELECT * FROM ${tableName}`).all();
      
      if (rows.length === 0) {
        logger.info(`同步 ${tableName}: 0 条记录`);
        return { success: true, count: 0, table: tableName };
      }
      
      const pool = mysql.getPool();
      if (!pool) {
        return { success: false, message: 'MySQL连接池不可用', table: tableName };
      }
      
      const connection = await pool.getConnection();
      
      const [remoteRows] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
      const remoteCount = remoteRows[0]?.count || 0;
      
      if (remoteCount > 0 && rows.length < remoteCount * 0.5) {
        logger.warn(`同步 ${tableName}: 本地(${rows.length})远少于云端(${remoteCount})，跳过以防止数据丢失`);
        connection.release();
        return { success: true, count: 0, table: tableName, skipped: true };
      }
      
      try {
        await connection.beginTransaction();
        
        await connection.execute("SET sql_mode = ''");
        
        const tempTable = `${tableName}_sync_temp`;
        const backupTable = `${tableName}_sync_backup`;
        
        await connection.execute(`DROP TABLE IF EXISTS \`${tempTable}\``);
        
        await ensureTableColumns(connection, tableName);
        
        try {
          await syncTableSchemaFromSqlite(connection, tableName, tempTable);
        } catch (schemaError) {
          logger.warn(`从SQLite同步表结构失败，尝试使用LIKE创建 [${tableName}]: ${schemaError.message}`);
          try {
            await connection.execute(`CREATE TABLE \`${tempTable}\` LIKE \`${tableName}\``);
          } catch (createError) {
            logger.error(`使用LIKE创建表失败 [${tableName}]: ${createError.message}`);
            throw new Error(`表 ${tableName} 创建失败: ${createError.message}`);
          }
        }
        
        const columns = Object.keys(rows[0]);
        const noTimestampTables = ['telemetry_events', 'validation_records', 'ai_analysis_records', 'rule_execution_log'];
        const convertTimestamp = !noTimestampTables.includes(tableName);
        
        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          const values = batch.map(row => {
            return '(' + columns.map(col => escapeValue(row[col], convertTimestamp)).join(', ') + ')';
          }).join(',\n');
          await connection.execute(`INSERT INTO \`${tempTable}\` (\`${columns.join('\`, \`')}\`) VALUES ${values}`);
        }
        
        await connection.execute(`RENAME TABLE \`${tableName}\` TO \`${backupTable}\`, \`${tempTable}\` TO \`${tableName}\``);
        await connection.execute(`DROP TABLE IF EXISTS \`${backupTable}\``);
        
        await connection.commit();
        
        logger.info(`同步 ${tableName}: ${rows.length} 条记录`);
        return { success: true, count: rows.length, table: tableName };
      } catch (error) {
        await connection.rollback();
        logger.error(`同步 ${tableName} 失败，已回滚: ${error.message}`);
        return { success: false, message: error.message, table: tableName };
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`同步 ${tableName} 失败: ${error.message}`);
      return { success: false, message: error.message, table: tableName };
    }
  }

  async syncAllLocalToRemote() {
    if (!mysql.isEnabled()) {
      return { success: false, message: 'MySQL未启用' };
    }

    logger.info('开始全量同步本地数据到云端...');
    
    const tables = [
      'sys_user', 'sys_oper_log', 'sys_config',
      'scan_project', 'scan_task', 'code_issue',
      'ai_optimize_record', 'code_report', 'llm_api_keys',
      'api_access_keys', 'self_update_history', 'self_repair_history',
      'confirmation_history', 'kb_entries', 'kb_cases',
      'code_standards', 'user_preferences', 'kb_metadata',
      'telemetry_events', 'sustain_rules', 'rule_execution_log',
      'ai_analysis_records', 'validation_records',
      'api_request_log', 'code_analysis_record', 'analysis_result',
      'notification', 'system_monitor', 'backup_history',
      'kb_import_history', 'dependency_version', 'project_analysis_summary'
    ];

    const results = [];
    let successCount = 0;
    let totalCount = 0;

    for (const table of tables) {
      const result = await this.syncLocalToRemote(table);
      results.push(result);
      if (result.success) {
        successCount++;
        totalCount += result.count || 0;
      }
    }

    logger.info(`全量同步完成: ${successCount}/${tables.length} 张表成功，共 ${totalCount} 条记录`);
    
    const { config } = require('../config');
    config.mysql.lastSyncTime = new Date();
    
    return {
      success: successCount === tables.length,
      message: `同步完成: ${successCount}/${tables.length} 张表成功`,
      totalRecords: totalCount,
      results
    };
  }

  async syncRemoteToLocal(tableName) {
    if (!mysql.isEnabled()) {
      return { success: false, message: 'MySQL未启用', table: tableName };
    }

    try {
      const pool = mysql.getPool();
      if (!pool) {
        return { success: false, message: 'MySQL连接池不可用', table: tableName };
      }
      
      const connection = await pool.getConnection();
      
      try {
        await this.syncMysqlSchemaToSqlite(connection, tableName);
        
        const [rows, fields] = await connection.query(`SELECT * FROM \`${tableName}\``);
        
        if (rows.length === 0) {
          logger.info(`同步 ${tableName}: 0 条记录（云端为空）`);
          connection.release();
          return { success: true, count: 0, table: tableName };
        }
        
        const sqlite = getSqliteDatabase();
        
        const sqliteColumns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all().map(col => col.name);
        
        let mysqlColumns = [];
        if (fields && fields.length > 0) {
          mysqlColumns = fields.map(field => field.name);
        } else if (typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
          mysqlColumns = Object.keys(rows[0]);
        }
        
        if (mysqlColumns.length === 0) {
          logger.warn(`同步 ${tableName}: 无法获取MySQL列名`);
          connection.release();
          return { success: true, count: 0, table: tableName };
        }
        
        let commonColumns = mysqlColumns.filter(col => sqliteColumns.includes(col));
        
        if (commonColumns.length === 0) {
          logger.warn(`同步 ${tableName}: MySQL列 [${mysqlColumns.slice(0, 5).join(', ')}...] vs SQLite列 [${sqliteColumns.slice(0, 5).join(', ')}...]`);
          const lowerSqlite = sqliteColumns.map(c => c.toLowerCase());
          commonColumns = mysqlColumns.filter(col => lowerSqlite.includes(col.toLowerCase()));
          if (commonColumns.length === 0) {
            logger.warn(`同步 ${tableName}: 没有匹配的列，跳过`);
            connection.release();
            return { success: true, count: 0, table: tableName };
          }
          logger.info(`同步 ${tableName}: 大小写不敏感匹配成功，使用列 [${commonColumns.slice(0, 5).join(', ')}...]`);
        }
        
        sqlite.prepare(`DELETE FROM ${tableName}`).run();
        
        const noTimestampTables = ['telemetry_events', 'validation_records', 'ai_analysis_records', 'rule_execution_log'];
        const convertTimestamp = !noTimestampTables.includes(tableName);
        
        const sqliteSchema = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
        const notNullDateColumns = new Set();
        for (const col of sqliteSchema) {
          if (col.notnull === 1 && (col.type.toUpperCase() === 'TEXT' || col.type.toUpperCase() === 'DATETIME')) {
            notNullDateColumns.add(col.name);
          }
        }
        
        const insertSql = `INSERT INTO ${tableName} (${commonColumns.join(', ')}) VALUES (${commonColumns.map(() => '?').join(', ')})`;
        const insertStmt = sqlite.prepare(insertSql);
        
        sqlite.exec('BEGIN TRANSACTION');
        try {
          for (const row of rows) {
            const values = commonColumns.map((col, index) => {
              let val;
              if (typeof row === 'object' && !Array.isArray(row)) {
                val = row[col];
              } else {
                val = row[index];
              }
              if (val === null || val === undefined) {
                if (notNullDateColumns.has(col)) {
                  return '1970-01-01 00:00:00';
                }
                return null;
              }
              if (typeof val === 'bigint') {
                return Number(val);
              }
              if (Buffer.isBuffer(val)) {
                return val.toString('base64');
              }
              if (typeof val === 'object' && val !== null) {
                if (val instanceof Date) {
                  if (isNaN(val.getTime())) {
                    if (notNullDateColumns.has(col)) {
                      return '1970-01-01 00:00:00';
                    }
                    return null;
                  }
                  return val.toISOString().replace('T', ' ').replace('.000Z', '');
                }
                if (typeof val.toNumber === 'function') {
                  return val.toNumber();
                }
                if (typeof val.toString === 'function') {
                  const str = val.toString();
                  if (!isNaN(str) && str !== '') {
                    return Number(str);
                  }
                  return str;
                }
                try {
                  return JSON.stringify(val);
                } catch (e) {
                  return String(val);
                }
              }
              if (typeof val === 'string') {
                if (/^0000-00-00/.test(val)) {
                  if (notNullDateColumns.has(col)) {
                    return '1970-01-01 00:00:00';
                  }
                  return null;
                }
                if (val.trim() === '') {
                  if (notNullDateColumns.has(col)) {
                    return '1970-01-01 00:00:00';
                  }
                  return null;
                }
                if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val)) {
                  return val;
                }
                if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
                  return val.replace('T', ' ').replace('.000Z', '').replace('Z', '');
                }
              }
              return val;
            });
            insertStmt.run(values);
          }
          sqlite.exec('COMMIT');
        } catch (e) {
          sqlite.exec('ROLLBACK');
          logger.error(`同步 ${tableName} 失败，最后一行数据: ${JSON.stringify(row)}`);
          throw e;
        }
        
        logger.info(`同步 ${tableName}: ${rows.length} 条记录`);
        return { success: true, count: rows.length, table: tableName };
      } catch (error) {
        logger.error(`同步 ${tableName} 失败: ${error.message}`);
        return { success: false, message: error.message, table: tableName };
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`同步 ${tableName} 失败: ${error.message}`);
      return { success: false, message: error.message, table: tableName };
    }
  }

  async syncAllRemoteToLocal() {
    if (!mysql.isEnabled()) {
      return { success: false, message: 'MySQL未启用' };
    }

    logger.info('开始全量同步云端数据到本地...');
    
    const tables = [
      'sys_user', 'sys_oper_log', 'sys_config',
      'scan_project', 'scan_task', 'code_issue',
      'ai_optimize_record', 'code_report', 'llm_api_keys',
      'api_access_keys', 'self_update_history', 'self_repair_history',
      'confirmation_history', 'kb_entries', 'kb_cases',
      'code_standards', 'user_preferences', 'kb_metadata',
      'telemetry_events', 'sustain_rules', 'rule_execution_log',
      'ai_analysis_records', 'validation_records',
      'api_request_log', 'code_analysis_record', 'analysis_result',
      'notification', 'system_monitor', 'backup_history',
      'kb_import_history', 'dependency_version', 'project_analysis_summary'
    ];
    
    const results = [];
    let successCount = 0;
    let totalCount = 0;
    
    for (const table of tables) {
      const result = await this.syncRemoteToLocal(table);
      results.push(result);
      if (result.success) {
        successCount++;
        totalCount += result.count || 0;
      }
    }

    logger.info(`全量同步完成: ${successCount}/${tables.length} 张表成功，共 ${totalCount} 条记录`);
    
    const { config } = require('../config');
    config.mysql.lastSyncTime = new Date();
    
    return {
      success: successCount === tables.length,
      message: `同步完成: ${successCount}/${tables.length} 张表成功，共 ${totalCount} 条记录`,
      totalRecords: totalCount,
      results
    };
  }

  async syncMysqlSchemaToSqlite(connection, tableName) {
    try {
      const sqlite = getSqliteDatabase();
      
      const [mysqlColumns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
      const sqliteSchema = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
      const sqliteColumnNames = sqliteSchema.map(col => col.name);
      
      let hasChanges = false;
      
      const mysqlIdCol = mysqlColumns.find(col => col.Key === 'PRI');
      const sqliteIdCol = sqliteSchema.find(col => col.pk === 1);
      
      let needRebuild = false;
      if (mysqlIdCol && sqliteIdCol) {
        const mysqlIdType = mysqlIdCol.Type.toLowerCase();
        const sqliteIdType = sqliteIdCol.type.toUpperCase();
        
        if (mysqlIdType.includes('varchar') && sqliteIdType === 'INTEGER') {
          needRebuild = true;
        }
      }
      
      if (needRebuild) {
        logger.info(`SQLite表 ${tableName} 主键类型不匹配，需要重建`);
        
        const tempData = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
        
        sqlite.exec(`DROP TABLE IF EXISTS ${tableName}`);
        
        let createSql = `CREATE TABLE ${tableName} (`;
        const colDefs = [];
        
        for (const mysqlCol of mysqlColumns) {
          const colName = mysqlCol.Field;
          let sqliteType = 'TEXT';
          const mysqlType = mysqlCol.Type.toLowerCase();
          
          if (mysqlType.includes('int')) {
            sqliteType = mysqlType.includes('bigint') ? 'INTEGER' : 'INTEGER';
          } else if (mysqlType.includes('decimal') || mysqlType.includes('float') || mysqlType.includes('double')) {
            sqliteType = 'REAL';
          } else if (mysqlType.includes('datetime') || mysqlType.includes('timestamp')) {
            sqliteType = 'TEXT';
          } else if (mysqlType.includes('text')) {
            sqliteType = 'TEXT';
          } else if (mysqlType.includes('varchar')) {
            sqliteType = 'TEXT';
          } else if (mysqlType.includes('boolean') || mysqlType.includes('tinyint(1)')) {
            sqliteType = 'INTEGER';
          } else if (mysqlType.includes('blob')) {
            sqliteType = 'BLOB';
          }
          
          let constraint = '';
          if (mysqlCol.Key === 'PRI') {
            constraint += ' PRIMARY KEY';
          }
          if (mysqlCol.Null === 'NO') {
            constraint += ' NOT NULL';
          }
          if (mysqlCol.Default !== null && mysqlCol.Default !== undefined) {
            let defaultValue = mysqlCol.Default;
            if (typeof defaultValue === 'string') {
              if (!defaultValue.startsWith("'") && !['CURRENT_TIMESTAMP', 'NULL', '0', '1'].includes(defaultValue)) {
                defaultValue = `'${defaultValue}'`;
              }
            }
            constraint += ` DEFAULT ${defaultValue}`;
          }
          
          colDefs.push(`${colName} ${sqliteType}${constraint}`);
        }
        
        createSql += colDefs.join(', ') + ')';
        sqlite.exec(createSql);
        
        logger.info(`SQLite表 ${tableName} 重建完成`);
        return;
      }
      
      for (const mysqlCol of mysqlColumns) {
        const colName = mysqlCol.Field;
        if (!sqliteColumnNames.includes(colName)) {
          let sqliteType = 'TEXT';
          const mysqlType = mysqlCol.Type.toLowerCase();
          
          if (mysqlType.includes('int')) {
            sqliteType = mysqlType.includes('bigint') ? 'INTEGER' : 'INTEGER';
          } else if (mysqlType.includes('decimal') || mysqlType.includes('float') || mysqlType.includes('double')) {
            sqliteType = 'REAL';
          } else if (mysqlType.includes('datetime') || mysqlType.includes('timestamp')) {
            sqliteType = 'TEXT';
          } else if (mysqlType.includes('text')) {
            sqliteType = 'TEXT';
          } else if (mysqlType.includes('varchar')) {
            sqliteType = 'TEXT';
          } else if (mysqlType.includes('boolean') || mysqlType.includes('tinyint(1)')) {
            sqliteType = 'INTEGER';
          } else if (mysqlType.includes('blob')) {
            sqliteType = 'BLOB';
          }
          
          let constraint = '';
          if (mysqlCol.Null === 'NO') {
            constraint += ' NOT NULL';
          }
          if (mysqlCol.Default !== null && mysqlCol.Default !== undefined) {
            let defaultValue = mysqlCol.Default;
            if (typeof defaultValue === 'string') {
              if (!defaultValue.startsWith("'") && !['CURRENT_TIMESTAMP', 'NULL', '0', '1'].includes(defaultValue)) {
                defaultValue = `'${defaultValue}'`;
              }
            }
            constraint += ` DEFAULT ${defaultValue}`;
          }
          
          try {
            sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${sqliteType}${constraint}`);
            logger.debug(`SQLite表 ${tableName} 添加缺失字段: ${colName}`);
            hasChanges = true;
          } catch (e) {
            logger.debug(`SQLite表 ${tableName} 添加字段 ${colName} 失败: ${e.message}`);
          }
        }
      }
      
      if (hasChanges) {
        logger.info(`SQLite表 ${tableName} 结构同步完成`);
      }
    } catch (error) {
      logger.debug(`同步MySQL表结构到SQLite失败 [${tableName}]: ${error.message}`);
    }
  }

  close() {
    if (sqliteDb) {
      sqliteDb.close();
      sqliteDb = null;
    }
  }
}

const dbAdapter = new DbAdapter();

module.exports = { dbAdapter };