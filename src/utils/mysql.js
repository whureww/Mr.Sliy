/**
 * MySQL数据库连接模块
 * 用于云端知识库同步
 * 可选配置，未启用时不影响本地SQLite
 * 支持加密配置存储，确保隐私安全
 * 支持多数据库连接配置和动态切换
 */

const mysql = require('mysql2/promise');
const { config } = require('../config');
const { logger } = require('./logger');

let pool = null;
let currentConnectionConfig = null;

/**
 * 获取MySQL连接池配置
 */
function getMySQLConnectionConfig() {
  if (config.mysql?.enabled && config.mysql?.host) {
    return {
      host: config.mysql.host,
      port: config.mysql.port || 3306,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database || 'code_optimizer',
      connectionLimit: config.mysql.connectionLimit || 10
    };
  }

  return null;
}

/**
 * 使用自定义配置获取MySQL连接池配置
 */
function getConnectionConfigFromCustom(customConfig) {
  if (!customConfig || !customConfig.enabled || !customConfig.host) {
    return null;
  }

  return {
    host: customConfig.host,
    port: customConfig.port || 3306,
    user: customConfig.user,
    password: customConfig.password,
    database: customConfig.database || 'code_optimizer',
    connectionLimit: customConfig.connectionLimit || 10
  };
}

/**
 * 获取MySQL连接池
 */
function getPool() {
  const mysqlConfig = getMySQLConnectionConfig();

  if (!mysqlConfig || !mysqlConfig.host) {
    return null;
  }

  const configKey = `${mysqlConfig.host}:${mysqlConfig.port}:${mysqlConfig.database}:${mysqlConfig.user}`;

  if (!pool || currentConnectionConfig !== configKey) {
    if (pool) {
      try {
        pool.end();
      } catch (e) {
        logger.debug('关闭旧连接池失败:', e.message);
      }
      pool = null;
    }

    try {
      pool = mysql.createPool({
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        database: mysqlConfig.database,
        connectionLimit: mysqlConfig.connectionLimit,
        waitForConnections: true,
        queueLimit: 0,
        charset: 'utf8mb4'
      });

      currentConnectionConfig = configKey;
      logger.info('MySQL连接池创建成功');
    } catch (error) {
      logger.warn(`MySQL连接池创建失败: ${error.message}`);
      pool = null;
      currentConnectionConfig = null;
    }
  }

  return pool;
}

/**
 * 测试MySQL连接
 */
async function testConnection() {
  const pool = getPool();
  if (!pool) {
    return { success: false, message: 'MySQL未启用' };
  }
  
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return { success: true, message: 'MySQL连接成功' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * 执行查询
 */
async function query(sql, params = []) {
  const pool = getPool();
  if (!pool) {
    throw new Error('MySQL未启用');
  }
  
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    logger.debug(`MySQL查询失败: ${error.message}`);
    throw error;
  }
}

/**
 * 执行插入/更新/删除
 */
async function execute(sql, params = []) {
  const pool = getPool();
  if (!pool) {
    throw new Error('MySQL未启用');
  }
  
  try {
    const [result] = await pool.execute(sql, params);
    return {
      success: true,
      affectedRows: result.affectedRows,
      insertId: result.insertId
    };
  } catch (error) {
    logger.debug(`MySQL执行失败: ${error.message}`);
    throw error;
  }
}

/**
 * 初始化MySQL数据库表
 */
async function initDatabase() {
  const pool = getPool();
  if (!pool) {
    return false;
  }
  
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS kb_entries (
        id VARCHAR(36) PRIMARY KEY,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL,
        language VARCHAR(50),
        tags TEXT,
        source VARCHAR(100),
        vector_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS kb_cases (
        id VARCHAR(36) PRIMARY KEY,
        original_code TEXT NOT NULL,
        optimized_code TEXT NOT NULL,
        explanation TEXT,
        language VARCHAR(50),
        issue_type VARCHAR(50),
        vector_json TEXT,
        usage_count INT DEFAULT 0,
        rating DECIMAL(3,1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS kb_metadata (
        meta_key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        id INT PRIMARY KEY AUTO_INCREMENT,
        table_name VARCHAR(50) NOT NULL,
        last_sync_at TIMESTAMP NULL,
        record_count INT DEFAULT 0,
        machine_id VARCHAR(32),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_table_machine (table_name, machine_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`CREATE INDEX idx_content_type ON kb_entries(content_type)`).catch(() => {});
    await query(`CREATE INDEX idx_language ON kb_entries(language)`).catch(() => {});
    await query(`CREATE INDEX idx_issue_type ON kb_cases(issue_type)`).catch(() => {});
    await query(`CREATE INDEX idx_cases_language ON kb_cases(language)`).catch(() => {});
    
    logger.info('MySQL数据库表初始化完成');
    return true;
  } catch (error) {
    logger.warn(`MySQL数据库表初始化失败: ${error.message}`);
    return false;
  }
}

/**
 * 关闭连接池
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('MySQL连接池已关闭');
  }
}

/**
 * 检查MySQL是否可用
 */
function isEnabled() {
  return config.mysql.enabled && getPool() !== null;
}

/**
 * 使用自定义配置创建连接池
 */
function createPoolWithConfig(customConfig) {
  const mysqlConfig = getConnectionConfigFromCustom(customConfig);
  
  if (!mysqlConfig || !mysqlConfig.host) {
    return null;
  }

  try {
    const newPool = mysql.createPool({
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      user: mysqlConfig.user,
      password: mysqlConfig.password,
      database: mysqlConfig.database,
      connectionLimit: mysqlConfig.connectionLimit,
      waitForConnections: true,
      queueLimit: 0,
      charset: 'utf8mb4'
    });

    logger.info(`MySQL连接池创建成功 (${customConfig.name || customConfig.id})`);
    return newPool;
  } catch (error) {
    logger.warn(`MySQL连接池创建失败: ${error.message}`);
    return null;
  }
}

/**
 * 使用自定义配置测试连接
 */
async function testConnectionWithConfig(customConfig) {
  const pool = createPoolWithConfig(customConfig);
  
  if (!pool) {
    return { success: false, message: '连接配置无效' };
  }
  
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    await pool.end();
    return { success: true, message: 'MySQL连接成功' };
  } catch (error) {
    if (pool) {
      try {
        await pool.end();
      } catch (e) {
        logger.debug('关闭临时连接池失败:', e.message);
      }
    }
    return { success: false, message: error.message };
  }
}

/**
 * 切换到指定数据库连接
 */
async function switchConnection(connectionConfig) {
  if (pool) {
    await closePool();
  }

  currentConnectionConfig = connectionConfig;
  
  const mysqlConfig = getConnectionConfigFromCustom(connectionConfig);
  if (!mysqlConfig || !mysqlConfig.host) {
    return { success: false, message: '无效的连接配置' };
  }

  try {
    pool = mysql.createPool({
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      user: mysqlConfig.user,
      password: mysqlConfig.password,
      database: mysqlConfig.database,
      connectionLimit: mysqlConfig.connectionLimit,
      waitForConnections: true,
      queueLimit: 0,
      charset: 'utf8mb4'
    });

    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();

    logger.info(`已切换到数据库连接: ${connectionConfig.name || connectionConfig.id}`);
    return { success: true, message: '数据库连接切换成功' };
  } catch (error) {
    pool = null;
    currentConnectionConfig = null;
    return { success: false, message: error.message };
  }
}

/**
 * 获取当前连接配置
 */
function getCurrentConnectionConfig() {
  return currentConnectionConfig || config.mysql;
}

module.exports = {
  getPool,
  testConnection,
  query,
  execute,
  initDatabase,
  closePool,
  isEnabled,
  createPoolWithConfig,
  testConnectionWithConfig,
  switchConnection,
  getCurrentConnectionConfig
};
