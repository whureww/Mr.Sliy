/**
 * MySQL数据库连接模块
 * 用于云端知识库同步
 * 可选配置，未启用时不影响本地SQLite
 * 支持加密配置存储，确保隐私安全
 */

const mysql = require('mysql2/promise');
const { config } = require('../config');
const { logger } = require('./logger');

let pool = null;

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
 * 获取MySQL连接池
 */
function getPool() {
  const mysqlConfig = getMySQLConnectionConfig();

  if (!mysqlConfig || !mysqlConfig.host) {
    return null;
  }

  if (!pool) {
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

      logger.info('MySQL连接池创建成功');
    } catch (error) {
      logger.warn(`MySQL连接池创建失败: ${error.message}`);
      pool = null;
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
    // 创建知识条目表
    await query(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        language VARCHAR(20) DEFAULT 'general',
        source VARCHAR(50) DEFAULT 'default',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category (category),
        INDEX idx_language (language)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // 创建优化案例表
    await query(`
      CREATE TABLE IF NOT EXISTS optimization_cases (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        before_code TEXT,
        after_code TEXT,
        description TEXT,
        language VARCHAR(20) DEFAULT 'javascript',
        complexity VARCHAR(20) DEFAULT 'medium',
        tags TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category (category),
        INDEX idx_language (language)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // 创建同步元数据表
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

module.exports = {
  getPool,
  testConnection,
  query,
  execute,
  initDatabase,
  closePool,
  isEnabled
};
