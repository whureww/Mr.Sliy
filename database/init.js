/**
 * 数据库初始化脚本
 * 创建SQLite数据库和所有表结构
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 数据库文件路径
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'code_optimizer.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * 初始化数据库
 */
function initDatabase() {
  console.log('开始初始化数据库...');
  
  // 确保数据库目录存在
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`创建数据库目录: ${dbDir}`);
  }

  // 创建数据库连接
  const db = new Database(DB_PATH);
  
  // 启用外键约束
  db.pragma('foreign_keys = ON');
  
  // 读取并执行SQL脚本
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  
  // 执行整个SQL脚本（better-sqlite3支持多语句执行）
  try {
    db.exec(schemaSql);
    console.log('SQL脚本执行完成');
  } catch (error) {
    console.error('执行SQL脚本失败:', error.message);
    throw error;
  }
  
  console.log('数据库表创建完成');
  
  // 插入默认配置
  insertDefaultConfig(db);
  
  // 创建默认管理员账户
  insertDefaultAdmin(db);
  
  // 关闭数据库连接
  db.close();
  
  console.log('数据库初始化完成！');
  console.log(`数据库文件位置: ${DB_PATH}`);
}

/**
 * 插入默认系统配置
 */
function insertDefaultConfig(db) {
  console.log('插入默认系统配置...');
  
  const defaultConfigs = [
    { key: 'ai_api_key', value: '', type: 'string', desc: 'AI API密钥', isPublic: false },
    { key: 'ai_api_url', value: 'https://api.openai.com/v1', type: 'string', desc: 'AI API地址', isPublic: true },
    { key: 'ai_model', value: 'gpt-4', type: 'string', desc: 'AI模型名称', isPublic: true },
    { key: 'ai_timeout', value: '30000', type: 'number', desc: 'AI调用超时时间(毫秒)', isPublic: true },
    { key: 'default_mode', value: 'offline', type: 'string', desc: '默认运行模式(offline/online)', isPublic: true },
    { key: 'max_file_size', value: '1048576', type: 'number', desc: '最大文件大小(字节)', isPublic: true },
    { key: 'scan_timeout', value: '60000', type: 'number', desc: '扫描超时时间(毫秒)', isPublic: true },
    { key: 'enable_parallel_scan', value: 'true', type: 'boolean', desc: '启用并行扫描', isPublic: true },
    { key: 'max_parallel_jobs', value: '4', type: 'number', desc: '最大并行任务数', isPublic: true },
    { key: 'scan_extensions', value: '.js,.ts,.jsx,.tsx,.py,.java,.go,.rs', type: 'string', desc: '扫描文件扩展名', isPublic: true },
    { key: 'exclude_dirs', value: 'node_modules,dist,build,out,.git,coverage', type: 'string', desc: '排除目录', isPublic: true },
    { key: 'detect_unused_variables', value: 'true', type: 'boolean', desc: '检测未使用变量', isPublic: true },
    { key: 'detect_unused_imports', value: 'true', type: 'boolean', desc: '检测未使用导入', isPublic: true },
    { key: 'detect_unused_functions', value: 'true', type: 'boolean', desc: '检测未使用函数', isPublic: true },
    { key: 'detect_magic_numbers', value: 'true', type: 'boolean', desc: '检测魔法数字', isPublic: true },
    { key: 'max_function_lines', value: '50', type: 'number', desc: '函数最大行数', isPublic: true },
    { key: 'max_cyclomatic_complexity', value: '10', type: 'number', desc: '最大圈复杂度', isPublic: true },
    { key: 'log_level', value: 'info', type: 'string', desc: '日志级别', isPublic: false },
    { key: 'rate_limit_max', value: '100', type: 'number', desc: 'API速率限制(每15分钟)', isPublic: true },
  ];
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO sys_config (config_key, config_value, config_type, description, is_public)
    VALUES (@key, @value, @type, @desc, @isPublic)
  `);
  
  const insertMany = db.transaction((configs) => {
    for (const config of configs) {
      insertStmt.run({
        key: config.key,
        value: config.value,
        type: config.type,
        desc: config.desc,
        isPublic: config.isPublic ? 1 : 0
      });
    }
  });
  
  insertMany(defaultConfigs);
  console.log(`插入 ${defaultConfigs.length} 条默认配置`);
}

/**
 * 创建默认管理员账户
 */
function insertDefaultAdmin(db) {
  console.log('创建默认管理员账户...');
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO sys_user (username, password_hash, email, role, status)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  // 使用 scrypt 哈希密码
  const { hashPassword } = require('../src/utils/crypto');
  const defaultPassword = 'admin123';
  const passwordHash = hashPassword(defaultPassword);
  
  insertStmt.run(
    'admin',
    passwordHash,
    'admin@example.com',
    'admin',
    'active'
  );
  
  console.log('默认管理员账户: admin / admin123');
}

// 执行初始化
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase };