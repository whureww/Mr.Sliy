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
      dbPath = path.resolve(path.join(__dirname, '../../', dbPath));
    }
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');
    initSyncQueueTable();
    startRetryTimer();
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
  if (typeof value === 'object') {
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
  }
  return "'" + value.toString().replace(/'/g, "''") + "'";
}

function convertTimestampParams(params, tableName = '') {
  const noTimestampTables = ['telemetry_events', 'validation_records'];
  const shouldConvert = !noTimestampTables.includes(tableName);
  
  return params.map(param => {
    if (shouldConvert && typeof param === 'number' && param > 1000000000000) {
      return new Date(param).toISOString().slice(0, 19).replace('T', ' ');
    }
    if (shouldConvert && param instanceof Date) {
      return param.toISOString().slice(0, 19).replace('T', ' ');
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
  
  if (result.lastInsertRowid) {
    row = sqlite.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(result.lastInsertRowid);
  } else if (params && params.length > 0) {
    try {
      row = sqlite.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(params[0]);
    } catch (e) {
      logger.debug(`查询插入行失败: ${e.message}`);
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
        return { success: true, count: 0, table: tableName };
      }
      
      const pool = mysql.getPool();
      if (!pool) {
        return { success: false, message: 'MySQL连接池不可用', table: tableName };
      }
      
      const connection = await pool.getConnection();
      
      try {
        await connection.beginTransaction();
        
        const tempTable = `${tableName}_sync_temp`;
        const backupTable = `${tableName}_sync_backup`;
        
        await connection.execute(`DROP TABLE IF EXISTS \`${tempTable}\``);
        await connection.execute(`CREATE TABLE \`${tempTable}\` LIKE \`${tableName}\``);
        
        const columns = Object.keys(rows[0]);
        const noTimestampTables = ['telemetry_events', 'validation_records'];
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
    
    return {
      success: successCount === tables.length,
      message: `同步完成: ${successCount}/${tables.length} 张表成功`,
      totalRecords: totalCount,
      results
    };
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