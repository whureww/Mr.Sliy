const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/code_optimizer.db');
const BACKUP_PATH = path.join(__dirname, '../database_backup_full.sql');
const SCHEMA_PATH = path.join(__dirname, '../database/schema.sql');

function escapeSqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return "'" + value.toString().replace(/'/g, "''") + "'";
}

function getPrimaryKey(db, tableName) {
  const result = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const pk = result.find(col => col.pk === 1);
  return pk ? pk.name : null;
}

function deduplicateData(db, tableName, rows) {
  const pk = getPrimaryKey(db, tableName);
  if (!pk) return rows;

  const existingRows = db.prepare(`SELECT ${pk} FROM ${tableName}`).all();
  const existingPks = new Set(existingRows.map(row => row[pk]));

  const newRows = rows.filter(row => !existingPks.has(row[pk]));
  const duplicateCount = rows.length - newRows.length;

  if (duplicateCount > 0) {
    console.log(`  [查重] ${tableName}: 跳过 ${duplicateCount} 条重复数据`);
  }

  return newRows;
}

async function createBackup() {
  console.log('开始创建数据库备份...');

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  try {
    const schemaContent = fs.readFileSync(SCHEMA_PATH, 'utf8');
    console.log('已加载数据库架构');

    db.exec(schemaContent);
    console.log('已初始化表结构');

    await insertSeedData(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map(row => row.name);

    console.log(`发现 ${tables.length} 张表`);

    let sqlContent = `-- ========================================================
-- Mr.Sliy 智能体数据库完整备份
-- 版本: v3.0.2
-- 日期: ${new Date().toISOString().split('T')[0]}
-- 包含: ${tables.length} 张表 + 索引 + 数据
-- ========================================================

`;

    sqlContent += schemaContent;
    sqlContent += '\n\n-- ========================================================\n';
    sqlContent += '-- 数据备份\n';
    sqlContent += '-- ========================================================\n\n';

    for (const tableName of tables) {
      const rows = db.prepare(`SELECT * FROM ${tableName}`).all();

      if (rows.length === 0) {
        console.log(`  ${tableName}: 无数据`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const columnList = columns.join(', ');

      sqlContent += `-- ${tableName} (${rows.length} 条记录)\n`;

      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const values = batch.map(row => {
          const rowValues = columns.map(col => escapeSqlValue(row[col]));
          return `(${rowValues.join(', ')})`;
        }).join(',\n');

        sqlContent += `INSERT INTO ${tableName} (${columnList}) VALUES\n${values};\n\n`;
      }

      console.log(`  ${tableName}: ${rows.length} 条记录`);
    }

    fs.writeFileSync(BACKUP_PATH, sqlContent, 'utf8');
    console.log(`\n备份完成！文件已保存到: ${BACKUP_PATH}`);
    console.log(`备份文件大小: ${(fs.statSync(BACKUP_PATH).size / 1024).toFixed(2)} KB`);

  } catch (error) {
    console.error('备份失败:', error);
    throw error;
  } finally {
    db.close();
  }
}

async function insertSeedData(db) {
  console.log('正在插入种子数据（带查重）...');

  insertSeedUsers(db);
  insertSeedProjects(db);
  insertSeedScanTasks(db);
  insertSeedCodeIssues(db);
  insertSeedKBEntries(db);
  insertSeedCodeStandards(db);

  console.log('种子数据插入完成');
}

function insertSeedUsers(db) {
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
      username: 'admin',
      password_hash: hashPassword('admin123'),
      email: 'admin@example.com',
      role: 'admin',
      status: 'active'
    }
  ];

  const existing = db.prepare('SELECT username FROM sys_user').all();
  const existingUsernames = new Set(existing.map(u => u.username));

  const newUsers = users.filter(u => !existingUsernames.has(u.username));

  if (newUsers.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO sys_user (username, password_hash, email, role, status)
      VALUES (@username, @password_hash, @email, @role, @status)
    `);
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item);
      }
    });
    insertMany(newUsers);
    console.log(`  sys_user: 新增 ${newUsers.length} 条`);
  } else {
    console.log(`  sys_user: 无新增数据`);
  }
}

function insertSeedProjects(db) {
  const projects = [
    {
      project_name: '示例前端项目',
      project_path: '/projects/demo-frontend',
      project_type: 'frontend',
      language: 'javascript',
      framework: 'react',
      description: 'React前端示例项目',
      total_files: 45,
      total_lines: 12500,
      user_id: 1
    },
    {
      project_name: '示例后端项目',
      project_path: '/projects/demo-backend',
      project_type: 'backend',
      language: 'javascript',
      framework: 'express',
      description: 'Express后端示例项目',
      total_files: 32,
      total_lines: 8900,
      user_id: 1
    },
    {
      project_name: 'Python数据分析项目',
      project_path: '/projects/python-analysis',
      project_type: 'backend',
      language: 'python',
      framework: 'django',
      description: 'Django数据分析项目',
      total_files: 28,
      total_lines: 6700,
      user_id: 1
    },
    {
      project_name: 'Vue电商项目',
      project_path: '/projects/vue-ecommerce',
      project_type: 'frontend',
      language: 'javascript',
      framework: 'vue',
      description: 'Vue.js电商平台项目',
      total_files: 68,
      total_lines: 15200,
      user_id: 1
    },
    {
      project_name: 'Go微服务项目',
      project_path: '/projects/go-microservice',
      project_type: 'backend',
      language: 'go',
      framework: 'gin',
      description: 'Go语言微服务架构项目',
      total_files: 42,
      total_lines: 9800,
      user_id: 1
    }
  ];

  const existing = db.prepare('SELECT project_path FROM scan_project').all();
  const existingPaths = new Set(existing.map(p => p.project_path));

  const newProjects = projects.filter(p => !existingPaths.has(p.project_path));

  if (newProjects.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO scan_project 
      (project_name, project_path, project_type, language, framework, description, total_files, total_lines, user_id)
      VALUES (@project_name, @project_path, @project_type, @language, @framework, @description, @total_files, @total_lines, @user_id)
    `);
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item);
      }
    });
    insertMany(newProjects);
    console.log(`  scan_project: 新增 ${newProjects.length} 条`);
  } else {
    console.log(`  scan_project: 无新增数据`);
  }
}

function insertSeedScanTasks(db) {
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

  const existing = db.prepare('SELECT task_name, project_id FROM scan_task').all();
  const existingKeys = new Set(existing.map(t => `${t.project_id}_${t.task_name}`));

  const newTasks = tasks.filter(t => !existingKeys.has(`${t.project_id}_${t.task_name}`));

  if (newTasks.length > 0) {
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
    insertMany(newTasks);
    console.log(`  scan_task: 新增 ${newTasks.length} 条`);
  } else {
    console.log(`  scan_task: 无新增数据`);
  }
}

function insertSeedCodeIssues(db) {
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
    },
    {
      task_id: 2,
      project_id: 1,
      file_path: '/projects/demo-frontend/src/hooks/useData.js',
      file_name: 'useData.js',
      language: 'javascript',
      issue_type: 'deep_nesting',
      severity: 'medium',
      message: '发现深度嵌套(4层)，建议重构',
      suggestion: '使用早期返回或提取子函数来减少嵌套深度',
      line_start: 20,
      line_end: 65,
      column_start: 0,
      column_end: 0,
      code_snippet: 'if (...) { if (...) { if (...) { ... } } }',
      ast_node_type: 'if_statement'
    },
    {
      task_id: 3,
      project_id: 2,
      file_path: '/projects/demo-backend/routes/users.js',
      file_name: 'users.js',
      language: 'javascript',
      issue_type: 'console_log',
      severity: 'low',
      message: '发现调试用console.log语句',
      suggestion: '删除调试日志或使用专业日志库',
      line_start: 35,
      line_end: 35,
      column_start: 0,
      column_end: 0,
      code_snippet: 'console.log("user data:", user)',
      ast_node_type: 'expression_statement'
    },
    {
      task_id: 3,
      project_id: 2,
      file_path: '/projects/demo-backend/utils/validator.js',
      file_name: 'validator.js',
      language: 'javascript',
      issue_type: 'null_check',
      severity: 'high',
      message: '可能存在空指针引用风险',
      suggestion: '在使用前添加空值检查',
      line_start: 18,
      line_end: 22,
      column_start: 0,
      column_end: 0,
      code_snippet: 'return data.value.toString()',
      ast_node_type: 'call_expression'
    }
  ];

  const existing = db.prepare('SELECT file_path, line_start, issue_type FROM code_issue').all();
  const existingKeys = new Set(existing.map(i => `${i.file_path}_${i.line_start}_${i.issue_type}`));

  const newIssues = issues.filter(i => !existingKeys.has(`${i.file_path}_${i.line_start}_${i.issue_type}`));

  if (newIssues.length > 0) {
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
    insertMany(newIssues);
    console.log(`  code_issue: 新增 ${newIssues.length} 条`);
  } else {
    console.log(`  code_issue: 无新增数据`);
  }
}

function insertSeedKBEntries(db) {
  const entries = [
    {
      id: 'kb_js_001',
      content: 'JavaScript中应避免使用var声明变量，改用let或const。let声明块级作用域变量，const声明常量。',
      content_type: 'rule',
      language: 'javascript',
      tags: 'var,let,const,scope',
      source: 'ES6标准'
    },
    {
      id: 'kb_js_002',
      content: 'React组件中应使用useEffect的依赖数组来控制副作用的执行时机，避免不必要的重渲染。',
      content_type: 'rule',
      language: 'javascript',
      tags: 'react,useEffect,hooks',
      source: 'React官方文档'
    },
    {
      id: 'kb_js_003',
      content: '使用async/await处理异步操作比Promise链式调用更易读，推荐在现代JavaScript中使用。',
      content_type: 'rule',
      language: 'javascript',
      tags: 'async,await,promise',
      source: 'ES8标准'
    },
    {
      id: 'kb_py_001',
      content: 'Python中应使用上下文管理器(with语句)来自动管理资源，如文件、数据库连接等。',
      content_type: 'rule',
      language: 'python',
      tags: 'with,context_manager,resource',
      source: 'Python官方文档'
    },
    {
      id: 'kb_py_002',
      content: 'Python函数参数应避免使用可变对象作为默认值，因为默认值只在函数定义时创建一次。',
      content_type: 'rule',
      language: 'python',
      tags: 'function,default,parameter',
      source: 'Python常见陷阱'
    },
    {
      id: 'kb_go_001',
      content: 'Go语言中错误处理应显式检查，避免忽略错误返回值。',
      content_type: 'rule',
      language: 'go',
      tags: 'error,handling',
      source: 'Go官方文档'
    },
    {
      id: 'kb_optimize_001',
      content: '循环内避免重复计算，应将计算结果缓存到变量中。',
      content_type: 'optimization',
      language: 'general',
      tags: 'performance,loop,cache',
      source: '通用优化原则'
    },
    {
      id: 'kb_optimize_002',
      content: '使用Map或Set替代数组进行查找操作，时间复杂度从O(n)降低到O(1)。',
      content_type: 'optimization',
      language: 'javascript',
      tags: 'performance,map,set',
      source: '数据结构优化'
    }
  ];

  const existing = db.prepare('SELECT id FROM kb_entries').all();
  const existingIds = new Set(existing.map(e => e.id));

  const newEntries = entries.filter(e => !existingIds.has(e.id));

  if (newEntries.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO kb_entries (id, content, content_type, language, tags, source)
      VALUES (@id, @content, @content_type, @language, @tags, @source)
    `);
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item);
      }
    });
    insertMany(newEntries);
    console.log(`  kb_entries: 新增 ${newEntries.length} 条`);
  } else {
    console.log(`  kb_entries: 无新增数据`);
  }
}

function insertSeedCodeStandards(db) {
  const standards = [
    {
      id: 'std_js_001',
      rule_name: '避免未使用的变量',
      rule_description: '所有声明的变量都应该被使用，未使用的变量会增加代码复杂度并可能导致混淆。',
      bad_example: 'const temp = 123;\nreturn result;',
      good_example: 'return result;',
      language: 'javascript',
      severity: 'medium'
    },
    {
      id: 'std_js_002',
      rule_name: '避免魔法数字',
      rule_description: '直接使用数字字面量会降低代码可读性，应将其定义为具名常量。',
      bad_example: 'if (status === 86400) { ... }',
      good_example: 'const MAX_TIMEOUT = 86400;\nif (status === MAX_TIMEOUT) { ... }',
      language: 'javascript',
      severity: 'low'
    },
    {
      id: 'std_js_003',
      rule_name: '函数长度限制',
      rule_description: '单个函数不应超过50行，过长的函数应拆分为多个小函数。',
      bad_example: 'function process(data) {\n  // 80行代码...\n}',
      good_example: 'function process(data) {\n  const parsed = parseData(data);\n  const validated = validate(parsed);\n  return transform(validated);\n}',
      language: 'javascript',
      severity: 'medium'
    },
    {
      id: 'std_py_001',
      rule_name: 'PEP8代码风格',
      rule_description: 'Python代码应遵循PEP8规范，包括缩进、命名风格、空格使用等。',
      bad_example: 'def myFunc(x,y):\n return x+y',
      good_example: 'def my_func(x, y):\n    return x + y',
      language: 'python',
      severity: 'low'
    }
  ];

  const existing = db.prepare('SELECT id FROM code_standards').all();
  const existingIds = new Set(existing.map(s => s.id));

  const newStandards = standards.filter(s => !existingIds.has(s.id));

  if (newStandards.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO code_standards (id, rule_name, rule_description, bad_example, good_example, language, severity)
      VALUES (@id, @rule_name, @rule_description, @bad_example, @good_example, @language, @severity)
    `);
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item);
      }
    });
    insertMany(newStandards);
    console.log(`  code_standards: 新增 ${newStandards.length} 条`);
  } else {
    console.log(`  code_standards: 无新增数据`);
  }
}

if (require.main === module) {
  createBackup().catch(error => {
    console.error('备份脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = { createBackup };