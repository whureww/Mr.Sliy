/**
 * 数据库表结构同步脚本
 * 确保MySQL和SQLite的表结构一致
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');

// 设置正确的数据库路径
const dbPath = path.join(require('os').homedir(), '.mr-sliy', 'database', 'code_optimizer.db');

// 标准业务表列表（32张）
const STANDARD_TABLES = [
  'sys_user',
  'sys_oper_log',
  'sys_config',
  'scan_project',
  'scan_task',
  'code_issue',
  'ai_optimize_record',
  'code_report',
  'llm_api_keys',
  'api_access_keys',
  'self_update_history',
  'self_repair_history',
  'confirmation_history',
  'kb_entries',
  'kb_cases',
  'code_standards',
  'user_preferences',
  'kb_metadata',
  'telemetry_events',
  'sustain_rules',
  'rule_execution_log',
  'ai_analysis_records',
  'validation_records',
  'api_request_log',
  'code_analysis_record',
  'analysis_result',
  'notification',
  'system_monitor',
  'backup_history',
  'kb_import_history',
  'dependency_version',
  'project_analysis_summary'
];

// 本地特有表（只在SQLite中存在）
const LOCAL_ONLY_TABLES = ['sync_queue'];

// 云端特有表（只在MySQL中存在）
const REMOTE_ONLY_TABLES = ['sync_metadata'];

// 创建readline接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function main() {
  console.log('\n=== 数据库表结构同步工具 ===\n');
  
  // 检查本地SQLite数据库
  console.log('1. 检查本地SQLite数据库...');
  const sqliteResult = await checkSQLiteTables();
  
  // 检查云端MySQL数据库
  console.log('\n2. 检查云端MySQL数据库...');
  const mysqlResult = await checkMySQLTables();
  
  // 显示差异
  if (mysqlResult && mysqlResult.tables) {
    console.log('\n3. 分析差异...');
    await analyzeDifferences(sqliteResult, mysqlResult);
    
    // 询问是否修复
    const shouldFix = await ask('\n是否修复上述差异？(y/N): ');
    if (shouldFix.toLowerCase() === 'y') {
      console.log('\n4. 开始修复...');
      await fixDifferences(sqliteResult, mysqlResult);
      console.log('\n✓ 修复完成');
    }
  }
  
  rl.close();
  console.log('\n=== 同步完成 ===');
  process.exit(0);
}

async function checkSQLiteTables() {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(dbPath)) {
        console.log('   SQLite数据库文件不存在');
        resolve({ exists: false });
        return;
      }
      
      const Database = require('sqlite3').Database;
      const db = new Database(dbPath, (err) => {
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
            !LOCAL_ONLY_TABLES.includes(t) &&
            !t.startsWith('_') &&
            t !== 'sqlite_sequence' &&
            t !== 'sqlite_stat1' &&
            t !== 'sqlite_stat4'
          );
          if (extraTables.length > 0) {
            console.log(`   ⚠️  多余的表: ${extraTables.join(', ')}`);
          } else {
            console.log('   ✓ 没有多余的表');
          }
          
          db.close();
          resolve({ 
            exists: true, 
            tables: tableNames, 
            missing: missingTables, 
            extra: extraTables 
          });
        });
      });
      
    } catch (e) {
      console.error(`   ✗ 检查SQLite失败: ${e.message}`);
      resolve({ exists: false });
    }
  });
}

async function checkMySQLTables() {
  try {
    // 设置环境变量以确保配置正确加载
    process.env.DATABASE_PATH = dbPath;
    
    const mysql = require('../src/utils/mysql');
    
    if (!mysql.isEnabled()) {
      console.log('   MySQL未启用');
      const shouldEnable = await ask('   是否尝试启用MySQL连接？(y/N): ');
      if (shouldEnable.toLowerCase() !== 'y') {
        console.log('   跳过MySQL检查');
        return null;
      }
    }
    
    const pool = mysql.getPool();
    if (!pool) {
      console.log('   无法获取MySQL连接池，请检查配置');
      return null;
    }
    
    const [rows] = await pool.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      ORDER BY TABLE_NAME
    `);
    
    const tableNames = rows.map(r => r.TABLE_NAME);
    console.log(`   云端MySQL表总数: ${tableNames.length}`);
    console.log(`   表列表: ${tableNames.join(', ')}`);
    
    // 检查缺失的业务表
    const missingTables = STANDARD_TABLES.filter(t => !tableNames.includes(t));
    if (missingTables.length > 0) {
      console.log(`   ⚠️  缺失业务表: ${missingTables.join(', ')}`);
    } else {
      console.log('   ✓ 所有业务表都存在');
    }
    
    // 检查多余的表（临时表和不属于标准列表的表）
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
    
    return { 
      exists: true, 
      tables: tableNames, 
      missing: missingTables, 
      extra: extraTables,
      temp: tempTables 
    };
    
  } catch (e) {
    console.error(`   ✗ 检查MySQL失败: ${e.message}`);
    return null;
  }
}

async function analyzeDifferences(sqliteResult, mysqlResult) {
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
  
  // SQLite中缺失的业务表
  const missingInSQLite = STANDARD_TABLES.filter(t => !sqliteTables.includes(t));
  if (missingInSQLite.length > 0) {
    console.log(`   SQLite缺失业务表: ${missingInSQLite.join(', ')}`);
  }
}

async function fixDifferences(sqliteResult, mysqlResult) {
  try {
    process.env.DATABASE_PATH = dbPath;
    const mysql = require('../src/utils/mysql');
    const pool = mysql.getPool();
    
    if (!pool) {
      console.log('   无法获取MySQL连接池');
      return;
    }
    
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
    
    // 3. 创建缺失的表
    if (mysqlResult.missing && mysqlResult.missing.length > 0) {
      console.log('   创建缺失的表...');
      await mysql.initDatabase();
    }
    
    console.log('   ✓ 表结构修复完成');
    
  } catch (e) {
    console.error(`   ✗ 修复失败: ${e.message}`);
  }
}

// 执行脚本
main().catch(e => {
  console.error('脚本执行失败:', e.message);
  rl.close();
  process.exit(1);
});