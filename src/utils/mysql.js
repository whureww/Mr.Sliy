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
let connectionHealthy = false;
let healthCheckTimer = null;
const HEALTH_CHECK_INTERVAL = 60000;

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
      CREATE TABLE IF NOT EXISTS sys_user (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(100),
        role VARCHAR(20) NOT NULL DEFAULT 'operator',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        last_login_at DATETIME,
        login_count INT DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sys_oper_log (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT,
        username VARCHAR(50),
        operation_type VARCHAR(50) NOT NULL,
        operation_desc TEXT,
        request_method VARCHAR(10),
        request_url VARCHAR(255),
        request_params TEXT,
        response_status INT,
        ip_address VARCHAR(50),
        user_agent TEXT,
        duration_ms INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sys_config (
        id INT PRIMARY KEY AUTO_INCREMENT,
        config_key VARCHAR(100) NOT NULL UNIQUE,
        config_value TEXT,
        config_type VARCHAR(50),
        description TEXT,
        is_public BOOLEAN DEFAULT FALSE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS scan_project (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_name VARCHAR(255) NOT NULL,
        project_path VARCHAR(500) NOT NULL,
        project_type VARCHAR(50),
        language VARCHAR(50),
        framework VARCHAR(100),
        description TEXT,
        total_files INT DEFAULT 0,
        total_lines INT DEFAULT 0,
        scan_count INT DEFAULT 0,
        last_scan_at DATETIME,
        user_id INT,
        status VARCHAR(20) DEFAULT 'active',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS scan_task (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT,
        task_name VARCHAR(255),
        scan_mode VARCHAR(20) NOT NULL,
        scan_type VARCHAR(50) NOT NULL,
        target_path VARCHAR(500),
        file_count INT DEFAULT 0,
        scanned_files INT DEFAULT 0,
        issue_count INT DEFAULT 0,
        issue_critical INT DEFAULT 0,
        issue_high INT DEFAULT 0,
        issue_medium INT DEFAULT 0,
        issue_low INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        progress INT DEFAULT 0,
        started_at DATETIME,
        completed_at DATETIME,
        duration_ms INT,
        error_message TEXT,
        user_id INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS code_issue (
        id INT PRIMARY KEY AUTO_INCREMENT,
        task_id INT NOT NULL,
        project_id INT,
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(255),
        language VARCHAR(50),
        issue_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        suggestion TEXT,
        line_start INT NOT NULL,
        line_end INT,
        column_start INT,
        column_end INT,
        code_snippet TEXT,
        ast_node_type VARCHAR(100),
        is_fixed BOOLEAN DEFAULT FALSE,
        fixed_at DATETIME,
        fixed_by_user_id INT,
        fix_suggestion TEXT,
        ai_optimized BOOLEAN DEFAULT FALSE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS ai_optimize_record (
        id INT PRIMARY KEY AUTO_INCREMENT,
        issue_id INT NOT NULL,
        task_id INT,
        original_code TEXT NOT NULL,
        optimized_code TEXT,
        explanation TEXT,
        optimization_type VARCHAR(50),
        ai_model VARCHAR(100),
        tokens_used INT,
        api_latency_ms INT,
        user_rating INT,
        user_feedback TEXT,
        is_applied BOOLEAN DEFAULT FALSE,
        applied_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS code_report (
        id INT PRIMARY KEY AUTO_INCREMENT,
        task_id INT NOT NULL,
        project_id INT,
        report_name VARCHAR(255) NOT NULL,
        report_type VARCHAR(50),
        file_path VARCHAR(500),
        file_size_kb DECIMAL(10,2),
        summary TEXT,
        include_ai_suggestions BOOLEAN DEFAULT TRUE,
        user_id INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS llm_api_keys (
        id INT PRIMARY KEY AUTO_INCREMENT,
        provider_name VARCHAR(50) NOT NULL,
        api_key TEXT NOT NULL,
        api_url TEXT,
        model_name VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE,
        priority INT DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS api_access_keys (
        id INT PRIMARY KEY AUTO_INCREMENT,
        access_key VARCHAR(100) NOT NULL UNIQUE,
        key_name VARCHAR(100),
        permissions TEXT,
        rate_limit INT DEFAULT 100,
        usage_count INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        expires_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS kb_entries (
        id VARCHAR(36) PRIMARY KEY,
        content TEXT NOT NULL,
        content_type VARCHAR(50) NOT NULL,
        language VARCHAR(20),
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
        language VARCHAR(20),
        issue_type VARCHAR(50),
        vector_json TEXT,
        usage_count INT DEFAULT 0,
        rating DECIMAL(3,2) DEFAULT 0.00,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS code_standards (
        id VARCHAR(36) PRIMARY KEY,
        rule_name VARCHAR(100) NOT NULL,
        rule_description TEXT NOT NULL,
        bad_example TEXT,
        good_example TEXT,
        language VARCHAR(20),
        severity VARCHAR(20),
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id VARCHAR(36) PRIMARY KEY,
        config_key VARCHAR(100) UNIQUE NOT NULL,
        config_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id INT PRIMARY KEY AUTO_INCREMENT,
        event_type VARCHAR(100) NOT NULL,
        event_category VARCHAR(100) NOT NULL,
        event_data TEXT,
        severity VARCHAR(20) DEFAULT 'info',
        timestamp BIGINT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sustain_rules (
        id VARCHAR(36) PRIMARY KEY,
        rule_name VARCHAR(100) NOT NULL,
        rule_type VARCHAR(50) NOT NULL,
        \`condition\` TEXT NOT NULL,
        \`action\` TEXT NOT NULL,
        priority INT DEFAULT 0,
        min_samples INT DEFAULT 0,
        enabled BOOLEAN DEFAULT TRUE,
        description TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS rule_execution_log (
        id VARCHAR(36) PRIMARY KEY,
        rule_id VARCHAR(36) NOT NULL,
        rule_name VARCHAR(100),
        execution_result TEXT,
        is_triggered BOOLEAN DEFAULT FALSE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS ai_analysis_records (
        id INT PRIMARY KEY AUTO_INCREMENT,
        analysis_type VARCHAR(50) NOT NULL,
        focus VARCHAR(100) DEFAULT 'general',
        input_data TEXT,
        analysis_result TEXT,
        suggestions TEXT,
        confidence DECIMAL(5,2) DEFAULT 0,
        executed BOOLEAN DEFAULT FALSE,
        execution_result TEXT,
        timestamp BIGINT NOT NULL,
        output_data TEXT,
        ai_model VARCHAR(100),
        tokens_used INT,
        duration_ms INT,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS validation_records (
        id INT PRIMARY KEY AUTO_INCREMENT,
        validation_type VARCHAR(50) NOT NULL,
        target_id VARCHAR(255),
        target_type VARCHAR(50),
        before_state TEXT,
        after_state TEXT,
        metrics_before TEXT,
        metrics_after TEXT,
        success INT DEFAULT 0,
        improvement_score DECIMAL(10,2) DEFAULT 0,
        timestamp BIGINT NOT NULL,
        cycle_id VARCHAR(100),
        result TEXT,
        score DECIMAL(5,2),
        passed BOOLEAN DEFAULT FALSE,
        details TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS self_update_history (
        id VARCHAR(36) PRIMARY KEY,
        update_type VARCHAR(50) NOT NULL,
        target_version VARCHAR(20),
        current_version VARCHAR(20),
        version_after VARCHAR(20),
        update_source VARCHAR(100),
        update_content TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        user_confirmed BOOLEAN DEFAULT FALSE,
        confirmed_at DATETIME,
        rejected_step VARCHAR(100),
        sandbox_result TEXT,
        applied_at DATETIME,
        rollback_version VARCHAR(20),
        rollback_at DATETIME,
        rolled_back_reason VARCHAR(200),
        error_message TEXT,
        duration_ms INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS self_repair_history (
        id VARCHAR(36) PRIMARY KEY,
        error_type VARCHAR(100) NOT NULL,
        error_message TEXT,
        error_stack TEXT,
        affected_component VARCHAR(100),
        repair_strategy VARCHAR(100),
        repair_content TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        user_confirmed BOOLEAN DEFAULT FALSE,
        confirmed_at DATETIME,
        sandbox_result TEXT,
        applied_at DATETIME,
        rollback_at DATETIME,
        rolled_back_reason VARCHAR(200),
        error_count INT DEFAULT 1,
        last_error_at DATETIME,
        duration_ms INT,
        error_message_detail TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS confirmation_history (
        id VARCHAR(36) PRIMARY KEY,
        operation_type VARCHAR(100) NOT NULL,
        risk_level VARCHAR(20) NOT NULL,
        step_name VARCHAR(100),
        step_number INT DEFAULT 0,
        total_steps INT DEFAULT 0,
        description TEXT NOT NULL,
        impact VARCHAR(500),
        files_affected TEXT,
        backup_available BOOLEAN DEFAULT FALSE,
        rollback_possible BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'pending',
        reason VARCHAR(200),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS api_request_log (
        id INT PRIMARY KEY AUTO_INCREMENT,
        api_key_id INT,
        provider_name VARCHAR(50),
        endpoint VARCHAR(255),
        request_method VARCHAR(10),
        request_headers TEXT,
        request_body TEXT,
        response_status INT,
        response_body TEXT,
        response_headers TEXT,
        tokens_used INT,
        latency_ms INT,
        error_message TEXT,
        is_success TINYINT(1) DEFAULT 1,
        user_id INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS code_analysis_record (
        id VARCHAR(36) PRIMARY KEY,
        project_id INT,
        task_id INT,
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(255),
        language VARCHAR(50),
        file_size INT,
        line_count INT,
        complexity_score DECIMAL(10,2),
        maintainability_index DECIMAL(10,2),
        analysis_start_at DATETIME,
        analysis_end_at DATETIME,
        duration_ms INT,
        status VARCHAR(20) DEFAULT 'completed',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS analysis_result (
        id INT PRIMARY KEY AUTO_INCREMENT,
        analysis_id VARCHAR(36) NOT NULL,
        project_id INT,
        task_id INT,
        result_type VARCHAR(50) NOT NULL,
        result_data TEXT,
        confidence DECIMAL(5,2) DEFAULT 0,
        source VARCHAR(100),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS notification (
        id VARCHAR(36) PRIMARY KEY,
        user_id INT,
        message_type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        data_json TEXT,
        is_read TINYINT(1) DEFAULT 0,
        is_confirmed TINYINT(1) DEFAULT 0,
        confirmed_at DATETIME,
        action VARCHAR(50),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS system_monitor (
        id INT PRIMARY KEY AUTO_INCREMENT,
        metric_type VARCHAR(50) NOT NULL,
        metric_name VARCHAR(100) NOT NULL,
        metric_value DECIMAL(18,4) NOT NULL,
        threshold DECIMAL(18,4),
        is_alert TINYINT(1) DEFAULT 0,
        component VARCHAR(100),
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS backup_history (
        id VARCHAR(36) PRIMARY KEY,
        backup_type VARCHAR(50) NOT NULL,
        backup_path VARCHAR(500),
        backup_size BIGINT,
        backup_count INT,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        duration_ms INT,
        user_id INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS kb_import_history (
        id VARCHAR(36) PRIMARY KEY,
        source_type VARCHAR(50) NOT NULL,
        source_path VARCHAR(500),
        file_count INT DEFAULT 0,
        imported_count INT DEFAULT 0,
        skipped_count INT DEFAULT 0,
        duplicate_count INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        user_id INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS dependency_version (
        id INT PRIMARY KEY AUTO_INCREMENT,
        package_name VARCHAR(255) NOT NULL,
        current_version VARCHAR(50),
        latest_version VARCHAR(50),
        is_outdated TINYINT(1) DEFAULT 0,
        update_priority VARCHAR(20) DEFAULT 'low',
        last_check_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS project_analysis_summary (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT NOT NULL,
        analysis_date DATETIME NOT NULL,
        total_files INT DEFAULT 0,
        total_issues INT DEFAULT 0,
        critical_count INT DEFAULT 0,
        high_count INT DEFAULT 0,
        medium_count INT DEFAULT 0,
        low_count INT DEFAULT 0,
        fixed_count INT DEFAULT 0,
        avg_complexity DECIMAL(10,2) DEFAULT 0,
        avg_maintainability DECIMAL(10,2) DEFAULT 0,
        summary TEXT,
        user_id INT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

    await query(`CREATE INDEX idx_user_username ON sys_user(username)`).catch(() => {});
    await query(`CREATE INDEX idx_user_status ON sys_user(status)`).catch(() => {});
    await query(`CREATE INDEX idx_oper_log_user_id ON sys_oper_log(user_id)`).catch(() => {});
    await query(`CREATE INDEX idx_oper_log_operation_type ON sys_oper_log(operation_type)`).catch(() => {});
    await query(`CREATE INDEX idx_config_key ON sys_config(config_key)`).catch(() => {});
    await query(`CREATE INDEX idx_project_user_id ON scan_project(user_id)`).catch(() => {});
    await query(`CREATE INDEX idx_project_status ON scan_project(status)`).catch(() => {});
    await query(`CREATE INDEX idx_task_project_id ON scan_task(project_id)`).catch(() => {});
    await query(`CREATE INDEX idx_task_user_id ON scan_task(user_id)`).catch(() => {});
    await query(`CREATE INDEX idx_task_status ON scan_task(status)`).catch(() => {});
    await query(`CREATE INDEX idx_issue_task_id ON code_issue(task_id)`).catch(() => {});
    await query(`CREATE INDEX idx_issue_project_id ON code_issue(project_id)`).catch(() => {});
    await query(`CREATE INDEX idx_issue_type ON code_issue(issue_type)`).catch(() => {});
    await query(`CREATE INDEX idx_issue_severity ON code_issue(severity)`).catch(() => {});
    await query(`CREATE INDEX idx_issue_is_fixed ON code_issue(is_fixed)`).catch(() => {});
    await query(`CREATE INDEX idx_ai_optimize_issue_id ON ai_optimize_record(issue_id)`).catch(() => {});
    await query(`CREATE INDEX idx_report_task_id ON code_report(task_id)`).catch(() => {});
    await query(`CREATE INDEX idx_report_project_id ON code_report(project_id)`).catch(() => {});
    await query(`CREATE INDEX idx_llm_provider ON llm_api_keys(provider_name)`).catch(() => {});
    await query(`CREATE INDEX idx_llm_active ON llm_api_keys(is_active)`).catch(() => {});
    await query(`CREATE INDEX idx_access_key ON api_access_keys(access_key)`).catch(() => {});
    await query(`CREATE INDEX idx_access_active ON api_access_keys(is_active)`).catch(() => {});
    await query(`CREATE INDEX idx_kb_content_type ON kb_entries(content_type)`).catch(() => {});
    await query(`CREATE INDEX idx_kb_language ON kb_entries(language)`).catch(() => {});
    await query(`CREATE INDEX idx_kb_cases_language ON kb_cases(language)`).catch(() => {});
    await query(`CREATE INDEX idx_kb_cases_issue_type ON kb_cases(issue_type)`).catch(() => {});
    await query(`CREATE INDEX idx_standards_language ON code_standards(language)`).catch(() => {});
    await query(`CREATE INDEX idx_monitor_type ON telemetry_events(event_type)`).catch(() => {});
    await query(`CREATE INDEX idx_monitor_component ON telemetry_events(event_category)`).catch(() => {});
    await query(`CREATE INDEX idx_update_type ON self_update_history(update_type)`).catch(() => {});
    await query(`CREATE INDEX idx_update_status ON self_update_history(status)`).catch(() => {});
    await query(`CREATE INDEX idx_repair_error_type ON self_repair_history(error_type)`).catch(() => {});
    await query(`CREATE INDEX idx_repair_status ON self_repair_history(status)`).catch(() => {});
    await query(`CREATE INDEX idx_confirmation_operation ON confirmation_history(operation_type)`).catch(() => {});
    await query(`CREATE INDEX idx_confirmation_status ON confirmation_history(status)`).catch(() => {});
    
    await migrateTableStructure();
    
    logger.info('MySQL数据库表初始化完成（23张表）');
    return true;
  } catch (error) {
    logger.warn(`MySQL数据库表初始化失败: ${error.message}`);
    return false;
  }
}

/**
 * 迁移表结构以兼容业务代码
 */
async function migrateTableStructure() {
  try {
    await migrateTelemetryEvents();
    await migrateValidationRecords();
    await migrateAiAnalysisRecords();
    
    logger.debug('MySQL表结构迁移完成');
  } catch (error) {
    logger.debug(`MySQL表结构迁移部分失败: ${error.message}`);
  }
}

async function migrateTelemetryEvents() {
  try {
    const columns = await query(`SHOW COLUMNS FROM telemetry_events`);
    const idColumn = columns.find(col => col.Field === 'id');
    
    if (idColumn && idColumn.Type === 'varchar(36)') {
      await query(`CREATE TABLE IF NOT EXISTS telemetry_events_new (
        id INT PRIMARY KEY AUTO_INCREMENT,
        event_type VARCHAR(100) NOT NULL,
        event_category VARCHAR(100) NOT NULL,
        event_data TEXT,
        severity VARCHAR(20) DEFAULT 'info',
        timestamp BIGINT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      
      await query(`INSERT INTO telemetry_events_new (event_type, event_category, event_data, severity, timestamp, created_at)
        SELECT event_type, COALESCE(event_category, '') as event_category, event_data, COALESCE(severity, 'info') as severity, 
               COALESCE(timestamp, 0) as timestamp, COALESCE(created_at, NOW()) as created_at
        FROM telemetry_events`).catch(() => {});
      
      await query(`DROP TABLE telemetry_events`);
      await query(`RENAME TABLE telemetry_events_new TO telemetry_events`);
      
      logger.info('telemetry_events表结构迁移完成');
    }
  } catch (error) {
    logger.debug(`telemetry_events迁移失败: ${error.message}`);
  }
}

async function migrateValidationRecords() {
  try {
    const columns = await query(`SHOW COLUMNS FROM validation_records`);
    const idColumn = columns.find(col => col.Field === 'id');
    
    if (idColumn && idColumn.Type === 'varchar(36)') {
      await query(`CREATE TABLE IF NOT EXISTS validation_records_new (
        id INT PRIMARY KEY AUTO_INCREMENT,
        validation_type VARCHAR(50) NOT NULL,
        target_id VARCHAR(255),
        target_type VARCHAR(50),
        before_state TEXT,
        after_state TEXT,
        metrics_before TEXT,
        metrics_after TEXT,
        success INT DEFAULT 0,
        improvement_score DECIMAL(10,2) DEFAULT 0,
        timestamp BIGINT NOT NULL,
        cycle_id VARCHAR(100),
        result TEXT,
        score DECIMAL(5,2),
        passed BOOLEAN DEFAULT FALSE,
        details TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      
      await query(`INSERT INTO validation_records_new (validation_type, target_id, target_type, before_state, after_state, 
        metrics_before, metrics_after, success, improvement_score, timestamp, cycle_id, result, score, passed, details, created_at)
        SELECT validation_type, target_id, target_type, before_state, after_state, metrics_before, metrics_after, 
               COALESCE(success, 0) as success, COALESCE(improvement_score, 0) as improvement_score, 
               COALESCE(timestamp, 0) as timestamp, cycle_id, result, score, passed, details, COALESCE(created_at, NOW()) as created_at
        FROM validation_records`).catch(() => {});
      
      await query(`DROP TABLE validation_records`);
      await query(`RENAME TABLE validation_records_new TO validation_records`);
      
      logger.info('validation_records表结构迁移完成');
    }
  } catch (error) {
    logger.debug(`validation_records迁移失败: ${error.message}`);
  }
}

async function migrateAiAnalysisRecords() {
  try {
    const columns = await query(`SHOW COLUMNS FROM ai_analysis_records`);
    const idColumn = columns.find(col => col.Field === 'id');
    const executionResultColumn = columns.find(col => col.Field === 'execution_result');
    
    let needsRebuild = false;
    if (idColumn && idColumn.Type === 'varchar(36)') {
      needsRebuild = true;
    }
    if (!executionResultColumn) {
      needsRebuild = true;
    }
    
    if (needsRebuild) {
      await query(`CREATE TABLE IF NOT EXISTS ai_analysis_records_new (
        id INT PRIMARY KEY AUTO_INCREMENT,
        analysis_type VARCHAR(50) NOT NULL,
        focus VARCHAR(100) DEFAULT 'general',
        input_data TEXT,
        analysis_result TEXT,
        suggestions TEXT,
        confidence DECIMAL(5,2) DEFAULT 0,
        executed BOOLEAN DEFAULT FALSE,
        execution_result TEXT,
        timestamp BIGINT NOT NULL,
        output_data TEXT,
        ai_model VARCHAR(100),
        tokens_used INT,
        duration_ms INT,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      
      await query(`INSERT INTO ai_analysis_records_new (analysis_type, focus, input_data, analysis_result, 
        suggestions, confidence, executed, execution_result, timestamp, output_data, ai_model, tokens_used, duration_ms, 
        success, error_message, created_at)
        SELECT analysis_type, COALESCE(focus, 'general') as focus, input_data, 
               COALESCE(analysis_result, '') as analysis_result, COALESCE(suggestions, '') as suggestions, 
               COALESCE(confidence, 0) as confidence, COALESCE(executed, 0) as executed, 
               execution_result,
               COALESCE(timestamp, 0) as timestamp, output_data, ai_model, tokens_used, duration_ms, 
               COALESCE(success, 1) as success, error_message, COALESCE(created_at, NOW()) as created_at
        FROM ai_analysis_records`).catch(() => {});
      
      await query(`DROP TABLE ai_analysis_records`);
      await query(`RENAME TABLE ai_analysis_records_new TO ai_analysis_records`);
      
      logger.info('ai_analysis_records表结构迁移完成');
    }
  } catch (error) {
    logger.debug(`ai_analysis_records迁移失败: ${error.message}`);
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
 * 检查MySQL连接健康状态
 */
async function checkConnectionHealth() {
  if (!config.mysql.enabled) {
    connectionHealthy = false;
    return;
  }
  
  const pool = getPool();
  if (!pool) {
    connectionHealthy = false;
    return;
  }
  
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    connectionHealthy = true;
    logger.debug('MySQL连接健康检查通过');
  } catch (error) {
    connectionHealthy = false;
    logger.warn(`MySQL连接健康检查失败: ${error.message}`);
  }
}

/**
 * 启动健康检查定时器
 */
function startHealthCheckTimer() {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  healthCheckTimer = setInterval(checkConnectionHealth, HEALTH_CHECK_INTERVAL);
  logger.debug('MySQL健康检查定时器已启动');
}

/**
 * 停止健康检查定时器
 */
function stopHealthCheckTimer() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

/**
 * 获取连接健康状态
 */
function isConnectionHealthy() {
  return connectionHealthy;
}

/**
 * 检查MySQL是否可用（包含健康检查）
 */
function isEnabled() {
  return config.mysql.enabled && getPool() !== null && connectionHealthy;
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

    currentConnectionConfig = `${mysqlConfig.host}:${mysqlConfig.port}:${mysqlConfig.database}:${mysqlConfig.user}`;
    connectionHealthy = true;

    logger.info(`已切换到数据库连接: ${connectionConfig.name || connectionConfig.id}`);
    return { success: true, message: '数据库连接切换成功' };
  } catch (error) {
    pool = null;
    currentConnectionConfig = null;
    connectionHealthy = false;
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
  getCurrentConnectionConfig,
  checkConnectionHealth,
  startHealthCheckTimer,
  stopHealthCheckTimer,
  isConnectionHealthy
};
