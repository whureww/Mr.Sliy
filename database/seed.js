/**
 * 数据库种子数据脚本
 * 插入测试数据
 */

const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'code_optimizer.db');

/**
 * 插入种子数据
 */
function seedDatabase() {
  console.log('开始插入种子数据...');
  
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  
  try {
    // 插入测试项目
    seedProjects(db);
    
    // 插入测试用户
    seedUsers(db);
    
    // 插入测试扫描任务
    seedScanTasks(db);
    
    // 插入测试代码缺陷
    seedCodeIssues(db);
    
    console.log('种子数据插入完成！');
  } catch (error) {
    console.error('插入种子数据失败:', error);
  } finally {
    db.close();
  }
}

/**
 * 插入测试项目
 */
function seedProjects(db) {
  const projects = [
    {
      name: '示例前端项目',
      path: '/projects/demo-frontend',
      type: 'frontend',
      language: 'javascript',
      framework: 'react',
      description: 'React前端示例项目',
      total_files: 45,
      total_lines: 12500,
      user_id: 1
    },
    {
      name: '示例后端项目',
      path: '/projects/demo-backend',
      type: 'backend',
      language: 'javascript',
      framework: 'express',
      description: 'Express后端示例项目',
      total_files: 32,
      total_lines: 8900,
      user_id: 1
    },
    {
      name: 'Python数据分析项目',
      path: '/projects/python-analysis',
      type: 'backend',
      language: 'python',
      framework: 'django',
      description: 'Django数据分析项目',
      total_files: 28,
      total_lines: 6700,
      user_id: 1
    }
  ];
  
  const stmt = db.prepare(`
    INSERT INTO scan_project 
    (project_name, project_path, project_type, language, framework, description, total_files, total_lines, user_id)
    VALUES (@name, @path, @type, @language, @framework, @description, @total_files, @total_lines, @user_id)
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  
  insertMany(projects);
  console.log(`插入 ${projects.length} 个测试项目`);
}

/**
 * 插入测试用户
 */
function seedUsers(db) {
  const { hashPassword } = require('../src/utils/crypto');
  
  const users = [
    {
      username: 'operator1',
      password_hash: hashPassword('password123'),
      email: 'operator1@example.com',
      role: 'operator',
      status: 'active'
    },
    {
      username: 'operator2',
      password_hash: hashPassword('password123'),
      email: 'operator2@example.com',
      role: 'operator',
      status: 'active'
    }
  ];
  
  const stmt = db.prepare(`
    INSERT INTO sys_user (username, password_hash, email, role, status)
    VALUES (@username, @password_hash, @email, @role, @status)
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  
  insertMany(users);
  console.log(`插入 ${users.length} 个测试用户`);
}

/**
 * 插入测试扫描任务
 */
function seedScanTasks(db) {
  const tasks = [
    {
      project_id: 1,
      task_name: '首次全项目扫描',
      scan_mode: 'offline',
      scan_type: 'full_project',
      target_path: '/projects/demo-frontend',
      file_count: 45,
      scanned_files: 45,
      issue_count: 23,
      issue_critical: 2,
      issue_high: 5,
      issue_medium: 8,
      issue_low: 8,
      status: 'completed',
      progress: 100,
      duration_ms: 15420,
      user_id: 1
    },
    {
      project_id: 1,
      task_name: 'AI优化扫描',
      scan_mode: 'online',
      scan_type: 'full_project',
      target_path: '/projects/demo-frontend',
      file_count: 45,
      scanned_files: 45,
      issue_count: 15,
      issue_critical: 0,
      issue_high: 3,
      issue_medium: 6,
      issue_low: 6,
      status: 'completed',
      progress: 100,
      duration_ms: 45680,
      user_id: 1
    },
    {
      project_id: 2,
      task_name: '后端项目扫描',
      scan_mode: 'offline',
      scan_type: 'full_project',
      target_path: '/projects/demo-backend',
      file_count: 32,
      scanned_files: 32,
      issue_count: 18,
      issue_critical: 1,
      issue_high: 4,
      issue_medium: 7,
      issue_low: 6,
      status: 'completed',
      progress: 100,
      duration_ms: 12350,
      user_id: 1
    }
  ];
  
  const stmt = db.prepare(`
    INSERT INTO scan_task
    (project_id, task_name, scan_mode, scan_type, target_path, file_count, scanned_files, 
     issue_count, issue_critical, issue_high, issue_medium, issue_low, status, progress, duration_ms, user_id)
    VALUES (@project_id, @task_name, @scan_mode, @scan_type, @target_path, @file_count, @scanned_files,
            @issue_count, @issue_critical, @issue_high, @issue_medium, @issue_low, @status, @progress, @duration_ms, @user_id)
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  
  insertMany(tasks);
  console.log(`插入 ${tasks.length} 个测试扫描任务`);
}

/**
 * 插入测试代码缺陷
 */
function seedCodeIssues(db) {
  const issues = [
    {
      task_id: 1,
      project_id: 1,
      file_path: '/projects/demo-frontend/src/components/Header.jsx',
      file_name: 'Header.jsx',
      language: 'javascript',
      issue_type: 'unused_variable',
      severity: 'medium',
      message: '变量"tempData"已声明但从未使用',
      suggestion: '删除未使用的变量或根据需要使用它',
      line_start: 15,
      line_end: 15,
      column_start: 8,
      column_end: 16,
      code_snippet: 'const tempData = []',
      ast_node_type: 'variable_declarator'
    },
    {
      task_id: 1,
      project_id: 1,
      file_path: '/projects/demo-frontend/src/utils/helpers.js',
      file_name: 'helpers.js',
      language: 'javascript',
      issue_type: 'unused_import',
      severity: 'low',
      message: '导入"moment"已声明但从未使用',
      suggestion: '删除未使用的导入以减少打包体积',
      line_start: 3,
      line_end: 3,
      column_start: 8,
      column_end: 14,
      code_snippet: 'import moment from "moment"',
      ast_node_type: 'import_statement'
    },
    {
      task_id: 1,
      project_id: 1,
      file_path: '/projects/demo-frontend/src/pages/Dashboard.jsx',
      file_name: 'Dashboard.jsx',
      language: 'javascript',
      issue_type: 'magic_number',
      severity: 'low',
      message: '发现魔法数字: 86400',
      suggestion: '将魔法数字提取为常量并添加说明性名称',
      line_start: 42,
      line_end: 42,
      column_start: 15,
      column_end: 20,
      code_snippet: 'const timeout = 86400 * 1000',
      ast_node_type: 'number'
    },
    {
      task_id: 1,
      project_id: 1,
      file_path: '/projects/demo-frontend/src/services/api.js',
      file_name: 'api.js',
      language: 'javascript',
      issue_type: 'long_function',
      severity: 'medium',
      message: '函数"processData"过长(87行)，建议拆分',
      suggestion: '将长函数拆分为多个小函数，每个函数负责单一职责',
      line_start: 120,
      line_end: 207,
      column_start: 0,
      column_end: 0,
      code_snippet: 'function processData(data) { ... }',
      ast_node_type: 'function_declaration'
    },
    {
      task_id: 1,
      project_id: 1,
      file_path: '/projects/demo-frontend/src/components/DataTable.jsx',
      file_name: 'DataTable.jsx',
      language: 'javascript',
      issue_type: 'unused_function',
      severity: 'high',
      message: '函数"formatCellValue"已定义但从未被调用',
      suggestion: '删除未使用的函数或确认是否应该在代码中使用它',
      line_start: 89,
      line_end: 95,
      column_start: 0,
      column_end: 0,
      code_snippet: 'const formatCellValue = (value) => { ... }',
      ast_node_type: 'function_declaration'
    }
  ];
  
  const stmt = db.prepare(`
    INSERT INTO code_issue
    (task_id, project_id, file_path, file_name, language, issue_type, severity, message, 
     suggestion, line_start, line_end, column_start, column_end, code_snippet, ast_node_type)
    VALUES (@task_id, @project_id, @file_path, @file_name, @language, @issue_type, @severity, @message,
            @suggestion, @line_start, @line_end, @column_start, @column_end, @code_snippet, @ast_node_type)
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item);
    }
  });
  
  insertMany(issues);
  console.log(`插入 ${issues.length} 个测试代码缺陷`);
}

// 执行种子数据插入
if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };