﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿-- ============================================
-- 代码优化智能体数据库架构设计
-- 版本: 1.0.0
-- 描述: 包含8张核心数据表
-- ============================================

-- 1. 用户表 (sys_user)
CREATE TABLE IF NOT EXISTS sys_user (
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
);

-- 2. 操作日志表 (sys_oper_log)
CREATE TABLE IF NOT EXISTS sys_oper_log (
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
);

-- 3. 系统配置表 (sys_config)
CREATE TABLE IF NOT EXISTS sys_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT,
    config_type VARCHAR(50),
    description TEXT,
    is_public BOOLEAN DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. 扫描项目表 (scan_project)
CREATE TABLE IF NOT EXISTS scan_project (
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
);

-- 5. 扫描任务表 (scan_task)
CREATE TABLE IF NOT EXISTS scan_task (
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
);

-- 6. 代码缺陷表 (code_issue)
CREATE TABLE IF NOT EXISTS code_issue (
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
);

-- 7. AI优化记录表 (ai_optimize_record)
CREATE TABLE IF NOT EXISTS ai_optimize_record (
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
);

-- 8. 报告导出表 (code_report)
CREATE TABLE IF NOT EXISTS code_report (
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
);

-- ============================================
-- 索引设计
-- ============================================

CREATE INDEX IF NOT EXISTS idx_user_username ON sys_user(username);
CREATE INDEX IF NOT EXISTS idx_user_status ON sys_user(status);

CREATE INDEX IF NOT EXISTS idx_oper_log_user_id ON sys_oper_log(user_id);
CREATE INDEX IF NOT EXISTS idx_oper_log_operation_type ON sys_oper_log(operation_type);
CREATE INDEX IF NOT EXISTS idx_oper_log_created_at ON sys_oper_log(created_at);

CREATE INDEX IF NOT EXISTS idx_config_key ON sys_config(config_key);

CREATE INDEX IF NOT EXISTS idx_project_user_id ON scan_project(user_id);
CREATE INDEX IF NOT EXISTS idx_project_status ON scan_project(status);

CREATE INDEX IF NOT EXISTS idx_task_project_id ON scan_task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_user_id ON scan_task(user_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON scan_task(status);
CREATE INDEX IF NOT EXISTS idx_task_created_at ON scan_task(created_at);

CREATE INDEX IF NOT EXISTS idx_issue_task_id ON code_issue(task_id);
CREATE INDEX IF NOT EXISTS idx_issue_project_id ON code_issue(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_type ON code_issue(issue_type);
CREATE INDEX IF NOT EXISTS idx_issue_severity ON code_issue(severity);
CREATE INDEX IF NOT EXISTS idx_issue_is_fixed ON code_issue(is_fixed);

CREATE INDEX IF NOT EXISTS idx_ai_optimize_issue_id ON ai_optimize_record(issue_id);
CREATE INDEX IF NOT EXISTS idx_ai_optimize_task_id ON ai_optimize_record(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_optimize_created_at ON ai_optimize_record(created_at);

CREATE INDEX IF NOT EXISTS idx_report_task_id ON code_report(task_id);
CREATE INDEX IF NOT EXISTS idx_report_project_id ON code_report(project_id);
CREATE INDEX IF NOT EXISTS idx_report_user_id ON code_report(user_id);

-- 9. AI模型密钥表 (llm_api_keys)
CREATE TABLE IF NOT EXISTS llm_api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_name VARCHAR(50) NOT NULL,
    api_key TEXT NOT NULL,
    api_url TEXT,
    model_name VARCHAR(100),
    is_active BOOLEAN DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_provider ON llm_api_keys(provider_name);
CREATE INDEX IF NOT EXISTS idx_llm_active ON llm_api_keys(is_active);

-- 10. 访问密钥表 (api_access_keys)
CREATE TABLE IF NOT EXISTS api_access_keys (
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
);

CREATE INDEX IF NOT EXISTS idx_access_key ON api_access_keys(access_key);
CREATE INDEX IF NOT EXISTS idx_access_active ON api_access_keys(is_active);

-- 11. 自更新记录表 (self_update_history)
CREATE TABLE IF NOT EXISTS self_update_history (
    id TEXT PRIMARY KEY,
    update_type VARCHAR(50) NOT NULL,
    target_version VARCHAR(20),
    current_version VARCHAR(20),
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
);

CREATE INDEX IF NOT EXISTS idx_update_type ON self_update_history(update_type);
CREATE INDEX IF NOT EXISTS idx_update_status ON self_update_history(status);
CREATE INDEX IF NOT EXISTS idx_update_created_at ON self_update_history(created_at);

-- 12. 自修复记录表 (self_repair_history)
CREATE TABLE IF NOT EXISTS self_repair_history (
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
);

CREATE INDEX IF NOT EXISTS idx_repair_error_type ON self_repair_history(error_type);
CREATE INDEX IF NOT EXISTS idx_repair_status ON self_repair_history(status);
CREATE INDEX IF NOT EXISTS idx_repair_created_at ON self_repair_history(created_at);
CREATE INDEX IF NOT EXISTS idx_repair_component ON self_repair_history(affected_component);

-- 13. 确认记录表 (confirmation_history)
CREATE TABLE IF NOT EXISTS confirmation_history (
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
);

CREATE INDEX IF NOT EXISTS idx_confirmation_operation ON confirmation_history(operation_type);
CREATE INDEX IF NOT EXISTS idx_confirmation_risk_level ON confirmation_history(risk_level);
CREATE INDEX IF NOT EXISTS idx_confirmation_status ON confirmation_history(status);
CREATE INDEX IF NOT EXISTS idx_confirmation_created_at ON confirmation_history(created_at);
