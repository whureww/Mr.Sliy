/**
 * 数据库连接模块
 * 支持 SQLite（本地）和 MySQL（云端）两种模式
 */

const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');
const { logger } = require('./logger');

let dbInstance = null;
let mysqlPool = null;

/**
 * 获取数据库实例（单例模式）
 * 支持 SQLite 和 MySQL 两种模式
 */
function getDatabase() {
  const mysqlEnabled = config.mysql?.enabled;

  if (mysqlEnabled) {
    return getMySqlPool();
  }

  if (!dbInstance) {
    let dbPath = config.database.path;

    if (!path.isAbsolute(dbPath)) {
      dbPath = path.resolve(path.join(__dirname, '../../', dbPath));
    }

    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = new Database(dbPath);

    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('journal_mode = WAL');

    ensureSqliteTables();
  }

  return dbInstance;
}

/**
 * 获取 MySQL 连接池
 */
async function getMySqlPool() {
  if (!mysqlPool) {
    const mysqlConfig = config.mysql;

    mysqlPool = mysql.createPool({
      host: mysqlConfig.host,
      port: mysqlConfig.port || 3306,
      user: mysqlConfig.user,
      password: mysqlConfig.password,
      database: mysqlConfig.database,
      connectionLimit: mysqlConfig.connectionLimit || 10,
      waitForConnections: true,
      queueLimit: 0
    });

    // 测试连接
    try {
      const connection = await mysqlPool.getConnection();
      connection.release();
      console.log('MySQL 连接池创建成功');
    } catch (error) {
      console.error('MySQL 连接失败:', error.message);
      throw error;
    }
  }

  return mysqlPool;
}

/**
 * 判断当前是否使用 MySQL
 */
function isUsingMySql() {
  return config.mysql?.enabled === true;
}

/**
 * 关闭数据库连接
 */
async function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  if (mysqlPool) {
    await mysqlPool.end();
    mysqlPool = null;
  }
}

/**
 * 执行查询（返回所有结果）
 */
async function query(sql, params = []) {
  if (isUsingMySql()) {
    const pool = await getMySqlPool();
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  } catch (error) {
    throw error;
  }
}

/**
 * 执行查询（返回单条结果）
 */
async function queryOne(sql, params = []) {
  if (isUsingMySql()) {
    const pool = await getMySqlPool();
    const [rows] = await pool.execute(sql, params);
    return rows[0] || null;
  }

  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    return stmt.get(...params);
  } catch (error) {
    throw error;
  }
}

/**
 * 执行插入/更新/删除操作
 */
async function execute(sql, params = []) {
  if (isUsingMySql()) {
    const pool = await getMySqlPool();
    const [result] = await pool.execute(sql, params);
    return {
      success: true,
      changes: result.affectedRows,
      lastInsertRowid: result.insertId
    };
  }

  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    return {
      success: true,
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 执行事务（仅 SQLite）
 */
function transaction(callback) {
  if (isUsingMySql()) {
    throw new Error('MySQL 模式不支持 transaction，请使用连接池手动事务');
  }

  const db = getDatabase();
  const txn = db.transaction(callback);
  return txn();
}

/**
 * 批量执行（仅 SQLite）
 */
function batchExecute(sqlArray, paramsArray) {
  if (isUsingMySql()) {
    throw new Error('MySQL 模式不支持 batchExecute，请使用连接池');
  }

  const db = getDatabase();
  const stmt = db.prepare(sqlArray);

  const insertMany = db.transaction((items) => {
    for (const params of items) {
      stmt.run(...params);
    }
  });

  return insertMany(paramsArray);
}

const allTablesSqlite = [
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
    project_name VARCHAR(255) NOT NULL,
    project_path VARCHAR(500) NOT NULL,
    project_type VARCHAR(50),
    language VARCHAR(50),
    framework VARCHAR(100),
    description TEXT,
    total_files INTEGER DEFAULT 0,
    total_lines INTEGER DEFAULT 0,
    scan_count INTEGER DEFAULT 0,
    last_scan_at DATETIME,
    user_id INTEGER,
    status VARCHAR(20) DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS scan_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    task_name VARCHAR(255),
    scan_mode VARCHAR(20) NOT NULL,
    scan_type VARCHAR(50) NOT NULL,
    target_path VARCHAR(500),
    file_count INTEGER DEFAULT 0,
    scanned_files INTEGER DEFAULT 0,
    issue_count INTEGER DEFAULT 0,
    issue_critical INTEGER DEFAULT 0,
    issue_high INTEGER DEFAULT 0,
    issue_medium INTEGER DEFAULT 0,
    issue_low INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    started_at DATETIME,
    completed_at DATETIME,
    duration_ms INTEGER,
    error_message TEXT,
    user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS code_issue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    project_id INTEGER,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    language VARCHAR(50),
    issue_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    suggestion TEXT,
    line_start INTEGER NOT NULL,
    line_end INTEGER,
    column_start INTEGER,
    column_end INTEGER,
    code_snippet TEXT,
    ast_node_type VARCHAR(100),
    is_fixed BOOLEAN DEFAULT 0,
    fixed_at DATETIME,
    fixed_by_user_id INTEGER,
    fix_suggestion TEXT,
    ai_optimized BOOLEAN DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS ai_optimize_record (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL,
    task_id INTEGER,
    original_code TEXT NOT NULL,
    optimized_code TEXT,
    explanation TEXT,
    optimization_type VARCHAR(50),
    ai_model VARCHAR(100),
    tokens_used INTEGER,
    api_latency_ms INTEGER,
    user_rating INTEGER,
    user_feedback TEXT,
    is_applied BOOLEAN DEFAULT 0,
    applied_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS code_report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    project_id INTEGER,
    report_name VARCHAR(255) NOT NULL,
    report_type VARCHAR(50),
    file_path VARCHAR(500),
    file_size_kb REAL,
    summary TEXT,
    include_ai_suggestions BOOLEAN DEFAULT 1,
    user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS llm_api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_name VARCHAR(50) NOT NULL,
    api_key TEXT NOT NULL,
    api_url TEXT,
    model_name VARCHAR(100),
    is_active BOOLEAN DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS api_access_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_key VARCHAR(100) NOT NULL UNIQUE,
    key_name VARCHAR(100),
    permissions TEXT,
    rate_limit INTEGER DEFAULT 100,
    usage_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    expires_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    id VARCHAR(36) PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS self_update_history (
    id TEXT PRIMARY KEY,
    update_type VARCHAR(50) NOT NULL,
    target_version VARCHAR(20),
    current_version VARCHAR(20),
    update_source VARCHAR(100),
    update_content TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    user_confirmed BOOLEAN DEFAULT 0,
    confirmed_at DATETIME,
    sandbox_result TEXT,
    applied_at DATETIME,
    rollback_version VARCHAR(20),
    rollback_at DATETIME,
    error_message TEXT,
    duration_ms INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS self_repair_history (
    id TEXT PRIMARY KEY,
    error_type VARCHAR(100) NOT NULL,
    error_message TEXT,
    error_stack TEXT,
    affected_component VARCHAR(100),
    repair_strategy VARCHAR(100),
    repair_content TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    user_confirmed BOOLEAN DEFAULT 0,
    confirmed_at DATETIME,
    sandbox_result TEXT,
    applied_at DATETIME,
    rollback_at DATETIME,
    error_count INTEGER DEFAULT 1,
    last_error_at DATETIME,
    duration_ms INTEGER,
    error_message_detail TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`
];

const allIndexesSqlite = [
  'CREATE INDEX IF NOT EXISTS idx_user_username ON sys_user(username)',
  'CREATE INDEX IF NOT EXISTS idx_user_status ON sys_user(status)',
  'CREATE INDEX IF NOT EXISTS idx_oper_log_user_id ON sys_oper_log(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_oper_log_operation_type ON sys_oper_log(operation_type)',
  'CREATE INDEX IF NOT EXISTS idx_oper_log_created_at ON sys_oper_log(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_config_key ON sys_config(config_key)',
  'CREATE INDEX IF NOT EXISTS idx_project_user_id ON scan_project(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_project_status ON scan_project(status)',
  'CREATE INDEX IF NOT EXISTS idx_task_project_id ON scan_task(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_task_user_id ON scan_task(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_task_status ON scan_task(status)',
  'CREATE INDEX IF NOT EXISTS idx_task_created_at ON scan_task(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_issue_task_id ON code_issue(task_id)',
  'CREATE INDEX IF NOT EXISTS idx_issue_project_id ON code_issue(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_issue_type ON code_issue(issue_type)',
  'CREATE INDEX IF NOT EXISTS idx_issue_severity ON code_issue(severity)',
  'CREATE INDEX IF NOT EXISTS idx_issue_is_fixed ON code_issue(is_fixed)',
  'CREATE INDEX IF NOT EXISTS idx_ai_optimize_issue_id ON ai_optimize_record(issue_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_optimize_task_id ON ai_optimize_record(task_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_optimize_created_at ON ai_optimize_record(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_report_task_id ON code_report(task_id)',
  'CREATE INDEX IF NOT EXISTS idx_report_project_id ON code_report(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_report_user_id ON code_report(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_llm_provider ON llm_api_keys(provider_name)',
  'CREATE INDEX IF NOT EXISTS idx_llm_active ON llm_api_keys(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_access_key ON api_access_keys(access_key)',
  'CREATE INDEX IF NOT EXISTS idx_access_active ON api_access_keys(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_kb_content_type ON kb_entries(content_type)',
  'CREATE INDEX IF NOT EXISTS idx_kb_language ON kb_entries(language)',
  'CREATE INDEX IF NOT EXISTS idx_kb_usage ON kb_entries(usage_count DESC)',
  'CREATE INDEX IF NOT EXISTS idx_kb_cases_language ON kb_cases(language)',
  'CREATE INDEX IF NOT EXISTS idx_kb_cases_category ON kb_cases(category)',
  'CREATE INDEX IF NOT EXISTS idx_kb_cases_effectiveness ON kb_cases(effectiveness_score DESC)',
  'CREATE INDEX IF NOT EXISTS idx_standards_language ON code_standards(language)',
  'CREATE INDEX IF NOT EXISTS idx_standards_severity ON code_standards(severity)',
  'CREATE INDEX IF NOT EXISTS idx_update_type ON self_update_history(update_type)',
  'CREATE INDEX IF NOT EXISTS idx_update_status ON self_update_history(status)',
  'CREATE INDEX IF NOT EXISTS idx_update_created_at ON self_update_history(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_repair_error_type ON self_repair_history(error_type)',
  'CREATE INDEX IF NOT EXISTS idx_repair_status ON self_repair_history(status)',
  'CREATE INDEX IF NOT EXISTS idx_repair_created_at ON self_repair_history(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_repair_component ON self_repair_history(affected_component)'
];

let sqliteInitialized = false;

function ensureSqliteTables() {
  if (sqliteInitialized) return;
  sqliteInitialized = true;

  const db = getDatabase();
  
  try {
    db.exec('DROP TABLE IF EXISTS self_update_history');
    db.exec('DROP TABLE IF EXISTS self_repair_history');
    logger.debug('已删除旧的自更新/自修复表');
  } catch (e) {
    logger.debug('删除旧表失败:', e.message);
  }
  
  for (const sql of allTablesSqlite) {
    try {
      db.exec(sql);
    } catch (e) {
      logger.warn(`创建表失败: ${e.message}`);
    }
  }
  
  for (const sql of allIndexesSqlite) {
    try {
      db.exec(sql);
    } catch (e) {
      // ignore index errors
    }
  }
  
  logger.debug('SQLite 表结构检查完成');
}

/**
 * 初始化 MySQL 数据库表
 */
async function initMySqlTables() {
  const pool = await getMySqlPool();

  const tables = [
    // 知识条目表（字段名与SQLite统一）
    `CREATE TABLE IF NOT EXISTS kb_entries (
      id VARCHAR(36) PRIMARY KEY,
      content TEXT NOT NULL,
      content_type VARCHAR(50) NOT NULL,
      language VARCHAR(20),
      tags TEXT,
      source TEXT,
      vector_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_content_type (content_type),
      INDEX idx_language (language)
    )`,

    // 优化案例表（字段名与SQLite统一）
    `CREATE TABLE IF NOT EXISTS kb_cases (
      id VARCHAR(36) PRIMARY KEY,
      original_code TEXT NOT NULL,
      optimized_code TEXT NOT NULL,
      explanation TEXT,
      language VARCHAR(20),
      issue_type VARCHAR(50),
      vector_json TEXT,
      usage_count INT DEFAULT 0,
      rating DECIMAL(3,2) DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_language (language),
      INDEX idx_issue_type (issue_type),
      INDEX idx_usage (usage_count DESC)
    )`,

    // 代码规范表
    `CREATE TABLE IF NOT EXISTS code_standards (
      id VARCHAR(36) PRIMARY KEY,
      rule_name VARCHAR(100) NOT NULL,
      rule_description TEXT NOT NULL,
      bad_example TEXT,
      good_example TEXT,
      language VARCHAR(20),
      severity VARCHAR(20),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_language (language),
      INDEX idx_severity (severity)
    )`,

    // 用户配置表
    `CREATE TABLE IF NOT EXISTS user_preferences (
      id VARCHAR(36) PRIMARY KEY,
      config_key VARCHAR(100) UNIQUE NOT NULL,
      config_value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    // LLM API密钥表
    `CREATE TABLE IF NOT EXISTS llm_api_keys (
      id INT PRIMARY KEY AUTO_INCREMENT,
      provider_name VARCHAR(50) NOT NULL,
      api_key TEXT NOT NULL,
      api_url TEXT,
      model_name VARCHAR(100),
      is_active BOOLEAN DEFAULT TRUE,
      priority INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_llm_provider (provider_name),
      INDEX idx_llm_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // API访问密钥表
    `CREATE TABLE IF NOT EXISTS api_access_keys (
      id INT PRIMARY KEY AUTO_INCREMENT,
      access_key VARCHAR(100) NOT NULL UNIQUE,
      key_name VARCHAR(100),
      permissions TEXT,
      rate_limit INT DEFAULT 100,
      usage_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      expires_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_access_key (access_key),
      INDEX idx_access_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  for (const sql of tables) {
    await pool.execute(sql);
  }

  console.log('MySQL 数据库表初始化完成');
}

module.exports = {
  getDatabase,
  getMySqlPool,
  isUsingMySql,
  closeDatabase,
  query,
  queryOne,
  execute,
  transaction,
  batchExecute,
  initMySqlTables,
  ensureSqliteTables
};