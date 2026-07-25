/**
 * 检查云端MySQL数据库表结构脚本
 */

const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3');
const path = require('path');

// 云端MySQL配置
const MYSQL_CONFIG = {
  host: '162.211.183.129',
  port: 3306,
  user: 'root',
  password: '123456',
  database: 'code_optimizer',
  charset: 'utf8mb4'
};

// 本地SQLite路径
const LOCAL_DB_PATH = path.join(require('os').homedir(), '.mr-sliy', 'database', 'code_optimizer.db');

// 标准业务表列表（32张）
const STANDARD_TABLES = [
  'sys_user', 'sys_oper_log', 'sys_config',
  'scan_project', 'scan_task', 'code_issue',
  'ai_optimize_record', 'code_report', 'llm_api_keys',
  'api_access_keys', 'self_update_history', 'self_repair_history',
  'confirmation_history', 'kb_entries', 'kb_cases',
  'code_standards', 'user_preferences', 'kb_metadata',
  'telemetry_events', 'sustain_rules', 'rule_execution_log',
  'ai_analysis_records', 'validation_records',
  'api_request_log', 'code_analysis_record', 'analysis_result',
  'notification', 'system_monitor', 'backup_history',
  'kb_import_history', 'dependency_version', 'project_analysis_summary'
];

// 本地特有表（只在SQLite中存在）
const LOCAL_ONLY_TABLES = ['sync_queue'];

// 云端特有表（只在MySQL中存在）
const REMOTE_ONLY_TABLES = ['sync_metadata'];

async function main() {
  console.log('\n=== 云端数据库表结构检查 ===\n');
  
  // 检查云端MySQL数据库
  console.log('1. 检查云端MySQL数据库...');
  const mysqlResult = await checkMySQL();
  
  if (!mysqlResult) {
    console.log('无法连接到云端数据库');
    process.exit(1);
  }
  
  // 检查本地SQLite数据库
  console.log('\n2. 检查本地SQLite数据库...');
  const sqliteResult = await checkSQLite();
  
  // 分析差异
  console.log('\n3. 分析差异...');
  await analyzeDifferences(sqliteResult, mysqlResult);
  
  // 询问是否修复
  const shouldFix = await ask('\n是否修复上述差异？(y/N): ');
  if (shouldFix.toLowerCase() === 'y') {
    console.log('\n4. 开始修复...');
    await fixDifferences(mysqlResult);
    console.log('\n✓ 修复完成');
  }
  
  console.log('\n=== 检查完成 ===');
  process.exit(0);
}

async function checkMySQL() {
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    
    // 测试连接
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
    connection.release();
    
    console.log('   ✓ 连接成功');
    
    // 查询所有表
    const [rows] = await pool.query(`
      SELECT TABLE_NAME, TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = ? 
      ORDER BY TABLE_NAME
    `, [MYSQL_CONFIG.database]);
    
    const tableNames = rows.map(r => r.TABLE_NAME);
    const tableCounts = {};
    rows.forEach(r => {
      tableCounts[r.TABLE_NAME] = parseInt(r.TABLE_ROWS) || 0;
    });
    
    console.log(`   云端MySQL表总数: ${tableNames.length}`);
    console.log(`   表列表: ${tableNames.join(', ')}`);
    
    // 检查缺失的业务表
    const missingTables = STANDARD_TABLES.filter(t => !tableNames.includes(t));
    if (missingTables.length > 0) {
      console.log(`   ⚠️  缺失业务表: ${missingTables.join(', ')}`);
    } else {
      console.log('   ✓ 所有业务表都存在');
    }
    
    // 检查多余的表
    const extraTables = tableNames.filter(t => 
      !STANDARD_TABLES.includes(t) && 
      !REMOTE_ONLY_TABLES.includes(t) &&
      !t.startsWith('_sync_')
    );
    if (extraTables.length > 0) {
      console.log(`   ⚠️  多余的表: ${extraTables.join(', ')}`);
    } else {
      console.log('   ✓ 没有多余的表');
    }
    
    // 检查临时表
    const tempTables = tableNames.filter(t => t.startsWith('_sync_'));
    if (tempTables.length > 0) {
      console.log(`   ⚠️  临时表: ${tempTables.join(', ')}`);
    }
    
    // 输出表行数
    console.log('\n   表行数统计:');
    STANDARD_TABLES.forEach(table => {
      const count = tableCounts[table] || 0;
      console.log(`     ${table}: ${count} 条`);
    });
    
    await pool.end();
    
    return { 
      tables: tableNames, 
      tableCounts: tableCounts,
      missing: missingTables, 
      extra: extraTables,
      temp: tempTables 
    };
    
  } catch (e) {
    console.error(`   ✗ 检查MySQL失败: ${e.message}`);
    return null;
  }
}

async function checkSQLite() {
  return new Promise((resolve) => {
    try {
      if (!require('fs').existsSync(LOCAL_DB_PATH)) {
        console.log('   SQLite数据库文件不存在');
        resolve({ exists: false });
        return;
      }
      
      const db = new sqlite3.Database(LOCAL_DB_PATH, (err) => {
        if (err) {
          console.error(`   ✗ 连接SQLite失败: ${err.message}`);
          resolve({ exists: false });
          return;
        }
        
        db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
          if (err) {
            console.error(`   ✗ 查询SQLite表失败: ${err.message}`);
            db.close();
            resolve({ exists: false });
            return;
          }
          
          const tableNames = rows.map(t => t.name);
          console.log(`   本地SQLite表总数: ${tableNames.length}`);
          
          // 检查缺失的业务表
          const missingTables = STANDARD_TABLES.filter(t => !tableNames.includes(t));
          if (missingTables.length > 0) {
            console.log(`   ⚠️  缺失业务表: ${missingTables.join(', ')}`);
          } else {
            console.log('   ✓ 所有业务表都存在');
          }
          
          db.close();
          resolve({ exists: true, tables: tableNames, missing: missingTables });
        });
      });
      
    } catch (e) {
      console.error(`   ✗ 检查SQLite失败: ${e.message}`);
      resolve({ exists: false });
    }
  });
}

async function analyzeDifferences(sqliteResult, mysqlResult) {
  if (!sqliteResult.exists) {
    console.log('   本地SQLite数据库不存在');
    return;
  }
  
  const sqliteTables = sqliteResult.tables;
  const mysqlTables = mysqlResult.tables;
  
  // MySQL中缺失的业务表
  const missingInMySQL = STANDARD_TABLES.filter(t => !mysqlTables.includes(t));
  if (missingInMySQL.length > 0) {
    console.log(`   MySQL缺失业务表: ${missingInMySQL.join(', ')}`);
  }
  
  // MySQL中多余的表
  const extraInMySQL = mysqlTables.filter(t => 
    !STANDARD_TABLES.includes(t) && 
    !REMOTE_ONLY_TABLES.includes(t) &&
    !t.startsWith('_sync_')
  );
  if (extraInMySQL.length > 0) {
    console.log(`   MySQL多余的表: ${extraInMySQL.join(', ')}`);
  }
  
  // MySQL中的临时表
  const tempTables = mysqlTables.filter(t => t.startsWith('_sync_'));
  if (tempTables.length > 0) {
    console.log(`   MySQL临时表: ${tempTables.join(', ')}`);
  }
}

async function fixDifferences(mysqlResult) {
  try {
    const pool = mysql.createPool(MYSQL_CONFIG);
    
    // 1. 删除临时表
    if (mysqlResult.temp && mysqlResult.temp.length > 0) {
      console.log('   删除临时表...');
      for (const tableName of mysqlResult.temp) {
        console.log(`     删除: ${tableName}`);
        await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      }
    }
    
    // 2. 删除多余的表
    if (mysqlResult.extra && mysqlResult.extra.length > 0) {
      console.log('   删除多余的表...');
      for (const tableName of mysqlResult.extra) {
        console.log(`     删除: ${tableName}`);
        await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      }
    }
    
    // 3. 创建缺失的表（需要使用项目中的mysql.js来初始化表结构）
    if (mysqlResult.missing && mysqlResult.missing.length > 0) {
      console.log('   创建缺失的表...');
      
      // 设置环境变量
      process.env.DATABASE_PATH = LOCAL_DB_PATH;
      process.env.MYSQL_HOST = MYSQL_CONFIG.host;
      process.env.MYSQL_PORT = MYSQL_CONFIG.port;
      process.env.MYSQL_USER = MYSQL_CONFIG.user;
      process.env.MYSQL_PASSWORD = MYSQL_CONFIG.password;
      process.env.MYSQL_DATABASE = MYSQL_CONFIG.database;
      
      // 临时修改配置
      const config = require('../src/config');
      config.mysql.enabled = true;
      config.mysql.host = MYSQL_CONFIG.host;
      config.mysql.port = MYSQL_CONFIG.port;
      config.mysql.user = MYSQL_CONFIG.user;
      config.mysql.password = MYSQL_CONFIG.password;
      config.mysql.database = MYSQL_CONFIG.database;
      
      const mysqlModule = require('../src/utils/mysql');
      await mysqlModule.initDatabase();
    }
    
    await pool.end();
    
    console.log('   ✓ 表结构修复完成');
    
  } catch (e) {
    console.error(`   ✗ 修复失败: ${e.message}`);
  }
}

function ask(question) {
  return new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// 执行脚本
main().catch(e => {
  console.error('脚本执行失败:', e.message);
  process.exit(1);
});