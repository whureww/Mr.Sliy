const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');
const { logger } = require('./logger');
const mysql = require('./mysql');

let sqliteDb = null;

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
  }
  return sqliteDb;
}

function escapeValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return value.toString();
  return "'" + value.toString().replace(/'/g, "''") + "'";
}

function executeMysqlAsync(sql, params) {
  if (!mysql.isEnabled()) return;
  
  setImmediate(async () => {
    try {
      await mysql.execute(sql, params);
    } catch (error) {
      logger.warn(`MySQL操作失败: ${error.message}`);
    }
  });
}

function executeMysqlInsertAsync(tableName, rows) {
  if (!mysql.isEnabled() || !Array.isArray(rows) || rows.length === 0) return;
  
  setImmediate(async () => {
    try {
      const columns = Object.keys(rows[0]);
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const values = batch.map(row => {
          return '(' + columns.map(col => escapeValue(row[col])).join(', ') + ')';
        }).join(',\n');
        await mysql.execute(`INSERT INTO \`${tableName}\` (\`${columns.join('\`, \`')}\`) VALUES ${values}`);
      }
    } catch (error) {
      logger.warn(`MySQL批量插入失败 [${tableName}]: ${error.message}`);
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
      get: (params) => stmt.get(params),
      all: (params) => stmt.all(params),
      run: (params) => {
        const result = stmt.run(params);
        
        if (mysql.isEnabled() && tableName) {
          const paramArray = Array.isArray(params) ? params : [];
          const mysqlSql = convertSqlForMysql(sql);
          
          if (sql.toUpperCase().startsWith('INSERT')) {
            adaptSqliteResultForMysql(tableName, result, paramArray);
          } else {
            executeMysqlAsync(mysqlSql, paramArray);
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

  run(sql, params = []) {
    const tableName = extractTableName(sql);
    const stmt = this._sqlite.prepare(sql);
    const result = stmt.run(params);
    
    if (mysql.isEnabled() && tableName) {
      const paramArray = Array.isArray(params) ? params : [];
      const mysqlSql = convertSqlForMysql(sql);
      
      if (sql.toUpperCase().startsWith('INSERT')) {
        adaptSqliteResultForMysql(tableName, result, paramArray);
      } else {
        executeMysqlAsync(mysqlSql, paramArray);
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
    
    const stmt = this._sqlite.prepare(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`);
    const insertMany = this._sqlite.transaction((items) => {
      for (const item of items) {
        stmt.run(columns.map(col => item[col]));
      }
    });
    insertMany(rows);
    
    if (mysql.isEnabled()) {
      executeMysqlInsertAsync(tableName, rows);
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
    
    const trackFn = () => {
      const originalPrepare = this._sqlite.prepare.bind(this._sqlite);
      this._sqlite.prepare = (sql) => {
        const stmt = originalPrepare(sql);
        const originalRun = stmt.run.bind(stmt);
        stmt.run = (...args) => {
          sqlOperations.push({ sql, params: args });
          return originalRun(...args);
        };
        return stmt;
      };
      result = fn();
      this._sqlite.prepare = originalPrepare;
    };
    
    this._sqlite.transaction(trackFn)();
    
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
                await connection.execute(mysqlSql, params);
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
      
      await mysql.execute(`TRUNCATE TABLE \`${tableName}\``);
      
      const columns = Object.keys(rows[0]);
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const values = batch.map(row => {
          return '(' + columns.map(col => escapeValue(row[col])).join(', ') + ')';
        }).join(',\n');
        await mysql.execute(`INSERT INTO \`${tableName}\` (\`${columns.join('\`, \`')}\`) VALUES ${values}`);
      }
      
      logger.info(`同步 ${tableName}: ${rows.length} 条记录`);
      return { success: true, count: rows.length, table: tableName };
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
      'ai_analysis_records', 'validation_records'
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