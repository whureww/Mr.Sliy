/**
 * 数据库连接模块
 * 支持 SQLite（本地）和 MySQL（云端）两种模式
 * 使用统一适配器，实现双写同步
 */

const { dbAdapter } = require('./dbAdapter');
const { logger } = require('./logger');

/**
 * 获取数据库实例（单例模式）
 * 返回统一的数据库适配器，支持双写同步
 */
function getDatabase() {
  return dbAdapter;
}

/**
 * 获取 SQLite 数据库实例（始终返回 SQLite）
 */
function getSqliteDatabase() {
  return dbAdapter.getSqlite();
}

/**
 * 获取 MySQL 连接池
 */
async function getMySqlPool() {
  const mysql = require('./mysql');
  const pool = mysql.getPool();
  if (!pool) {
    throw new Error('MySQL连接池未创建');
  }
  return pool;
}

/**
 * 判断当前是否使用 MySQL
 */
function isUsingMySql() {
  return dbAdapter.isMysqlEnabled();
}

/**
 * 关闭数据库连接
 */
async function closeDatabase() {
  dbAdapter.close();
}

/**
 * 执行查询（返回所有结果）
 */
async function query(sql, params = []) {
  return dbAdapter.all(sql, params);
}

/**
 * 执行查询（返回单条结果）
 */
async function queryOne(sql, params = []) {
  return dbAdapter.get(sql, params);
}

/**
 * 执行插入/更新/删除操作
 */
async function execute(sql, params = []) {
  const result = await dbAdapter.run(sql, params);
  return {
    success: true,
    changes: result.changes || 0,
    lastInsertRowid: result.lastInsertRowid || 0
  };
}

/**
 * 执行事务
 */
async function transaction(callback) {
  return dbAdapter.transaction(callback);
}

/**
 * 批量执行
 */
async function batchExecute(sql, paramsArray) {
  const stmt = dbAdapter.prepare(sql);
  
  const insertMany = dbAdapter.transaction((items) => {
    for (const params of items) {
      stmt.run(Array.isArray(params) ? params : [params]);
    }
  });
  
  const result = insertMany(paramsArray);
  return result;
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
    version_after VARCHAR(20),
    update_source VARCHAR(100),
    update_content TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    user_confirmed BOOLEAN DEFAULT 0,
    confirmed_at DATETIME,
    rejected_step VARCHAR(100),
    sandbox_result TEXT,
    applied_at DATETIME,
    rollback_version VARCHAR(20),
    rollback_at DATETIME,
    rolled_back_reason VARCHAR(200),
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
    rolled_back_reason VARCHAR(200),
    error_count INTEGER DEFAULT 1,
    last_error_at DATETIME,
    duration_ms INTEGER,
    error_message_detail TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS confirmation_history (
    id TEXT PRIMARY KEY,
    operation_type VARCHAR(100) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    step_name VARCHAR(100),
    step_number INTEGER DEFAULT 0,
    total_steps INTEGER DEFAULT 0,
    description TEXT NOT NULL,
    impact VARCHAR(500),
    files_affected TEXT,
    backup_available BOOLEAN DEFAULT 0,
    rollback_possible BOOLEAN DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    reason VARCHAR(200),
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
    id TEXT PRIMARY KEY,
    project_id INTEGER,
    task_id INTEGER,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    language VARCHAR(50),
    file_size INTEGER,
    line_count INTEGER,
    complexity_score REAL,
    maintainability_index REAL,
    analysis_start_at DATETIME,
    analysis_end_at DATETIME,
    duration_ms INTEGER,
    status VARCHAR(20) DEFAULT 'completed',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS analysis_result (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id TEXT NOT NULL,
    project_id INTEGER,
    task_id INTEGER,
    result_type VARCHAR(50) NOT NULL,
    result_data TEXT,
    confidence REAL DEFAULT 0,
    source VARCHAR(100),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS notification (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    message_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    data_json TEXT,
    is_read BOOLEAN DEFAULT 0,
    is_confirmed BOOLEAN DEFAULT 0,
    confirmed_at DATETIME,
    action VARCHAR(50),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS system_monitor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value REAL NOT NULL,
    threshold REAL,
    is_alert BOOLEAN DEFAULT 0,
    component VARCHAR(100),
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS backup_history (
    id TEXT PRIMARY KEY,
    backup_type VARCHAR(50) NOT NULL,
    backup_path VARCHAR(500),
    backup_size INTEGER,
    backup_count INTEGER,
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    duration_ms INTEGER,
    user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS kb_import_history (
    id TEXT PRIMARY KEY,
    source_type VARCHAR(50) NOT NULL,
    source_path VARCHAR(500),
    file_count INTEGER DEFAULT 0,
    imported_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    duplicate_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS dependency_version (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_name VARCHAR(255) NOT NULL,
    current_version VARCHAR(50),
    latest_version VARCHAR(50),
    is_outdated BOOLEAN DEFAULT 0,
    update_priority VARCHAR(20) DEFAULT 'low',
    last_check_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS project_analysis_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    analysis_date DATETIME NOT NULL,
    total_files INTEGER DEFAULT 0,
    total_issues INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    high_count INTEGER DEFAULT 0,
    medium_count INTEGER DEFAULT 0,
    low_count INTEGER DEFAULT 0,
    fixed_count INTEGER DEFAULT 0,
    avg_complexity REAL DEFAULT 0,
    avg_maintainability REAL DEFAULT 0,
    summary TEXT,
    user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS kb_metadata (
    meta_key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS telemetry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    event_data TEXT,
    severity TEXT DEFAULT 'info',
    timestamp INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS sustain_rules (
    id TEXT PRIMARY KEY,
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL,
    condition TEXT NOT NULL,
    action TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    min_samples INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT 1,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS rule_execution_log (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    rule_name VARCHAR(100),
    execution_result TEXT,
    is_triggered BOOLEAN DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS ai_analysis_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_type TEXT NOT NULL,
    focus TEXT DEFAULT 'general',
    input_data TEXT,
    analysis_result TEXT,
    suggestions TEXT,
    confidence REAL DEFAULT 0,
    executed BOOLEAN DEFAULT 0,
    timestamp INTEGER NOT NULL,
    output_data TEXT,
    ai_model TEXT,
    tokens_used INTEGER,
    duration_ms INTEGER,
    success BOOLEAN DEFAULT 1,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS validation_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    validation_type TEXT NOT NULL,
    target_id TEXT,
    target_type TEXT,
    before_state TEXT,
    after_state TEXT,
    metrics_before TEXT,
    metrics_after TEXT,
    success INTEGER DEFAULT 0,
    improvement_score REAL DEFAULT 0,
    timestamp INTEGER NOT NULL,
    cycle_id VARCHAR(100),
    result TEXT,
    score REAL,
    passed BOOLEAN DEFAULT 0,
    details TEXT,
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
  'CREATE INDEX IF NOT EXISTS idx_repair_component ON self_repair_history(affected_component)',
  'CREATE INDEX IF NOT EXISTS idx_confirmation_operation ON confirmation_history(operation_type)',
  'CREATE INDEX IF NOT EXISTS idx_confirmation_risk_level ON confirmation_history(risk_level)',
  'CREATE INDEX IF NOT EXISTS idx_confirmation_status ON confirmation_history(status)',
  'CREATE INDEX IF NOT EXISTS idx_confirmation_created_at ON confirmation_history(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_api_request_provider ON api_request_log(provider_name)',
  'CREATE INDEX IF NOT EXISTS idx_api_request_endpoint ON api_request_log(endpoint)',
  'CREATE INDEX IF NOT EXISTS idx_api_request_user ON api_request_log(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_api_request_created_at ON api_request_log(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_project_id ON code_analysis_record(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_task_id ON code_analysis_record(task_id)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_file_path ON code_analysis_record(file_path)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_language ON code_analysis_record(language)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_result_id ON analysis_result(analysis_id)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_result_project ON analysis_result(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_result_type ON analysis_result(result_type)',
  'CREATE INDEX IF NOT EXISTS idx_notification_user_id ON notification(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_notification_type ON notification(message_type)',
  'CREATE INDEX IF NOT EXISTS idx_notification_is_read ON notification(is_read)',
  'CREATE INDEX IF NOT EXISTS idx_notification_is_confirmed ON notification(is_confirmed)',
  'CREATE INDEX IF NOT EXISTS idx_monitor_metric_type ON system_monitor(metric_type)',
  'CREATE INDEX IF NOT EXISTS idx_monitor_metric_name ON system_monitor(metric_name)',
  'CREATE INDEX IF NOT EXISTS idx_monitor_component ON system_monitor(component)',
  'CREATE INDEX IF NOT EXISTS idx_monitor_timestamp ON system_monitor(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_backup_type ON backup_history(backup_type)',
  'CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_history(status)',
  'CREATE INDEX IF NOT EXISTS idx_backup_user_id ON backup_history(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_kb_import_source ON kb_import_history(source_type)',
  'CREATE INDEX IF NOT EXISTS idx_kb_import_status ON kb_import_history(status)',
  'CREATE INDEX IF NOT EXISTS idx_kb_import_user_id ON kb_import_history(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_dependency_package ON dependency_version(package_name)',
  'CREATE INDEX IF NOT EXISTS idx_dependency_outdated ON dependency_version(is_outdated)',
  'CREATE INDEX IF NOT EXISTS idx_summary_project_id ON project_analysis_summary(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_summary_date ON project_analysis_summary(analysis_date)',
  'CREATE INDEX IF NOT EXISTS idx_summary_user_id ON project_analysis_summary(user_id)'
];

let sqliteInitialized = false;

function ensureSqliteTables() {
  if (sqliteInitialized) return;

  sqliteInitialized = true;

  const db = getSqliteDatabase();
  
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
      logger.debug(`创建索引失败: ${e.message}`);
    }
  }
}

module.exports = {
  getDatabase,
  getSqliteDatabase,
  getMySqlPool,
  isUsingMySql,
  closeDatabase,
  query,
  queryOne,
  execute,
  transaction,
  batchExecute,
  ensureSqliteTables
};