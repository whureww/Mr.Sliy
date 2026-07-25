/**
 * 检查本地和云端数据库表结构一致性
 */

const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3');
const path = require('path');

const MYSQL_CONFIG = {
  host: '162.211.183.129',
  port: 3306,
  user: 'root',
  password: '123456',
  database: 'code_optimizer',
  charset: 'utf8mb4'
};

const LOCAL_DB_PATH = path.join(require('os').homedir(), '.mr-sliy', 'database', 'code_optimizer.db');

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

async function main() {
  console.log('\n=== 检查表结构一致性 ===\n');
  
  const pool = mysql.createPool(MYSQL_CONFIG);
  
  let allMatch = true;
  
  for (const tableName of STANDARD_TABLES) {
    console.log(`检查 ${tableName}...`);
    
    // 获取云端表结构
    const [mysqlColumns] = await pool.query(`DESCRIBE \`${tableName}\``);
    const mysqlColumnNames = mysqlColumns.map(c => c.Field);
    
    // 获取本地表结构
    const sqliteColumns = await new Promise((resolve) => {
      const db = new sqlite3.Database(LOCAL_DB_PATH);
      db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
        db.close();
        resolve(rows || []);
      });
    });
    const sqliteColumnNames = sqliteColumns.map(c => c.name);
    
    // 比较列名
    const missingInMySQL = sqliteColumnNames.filter(c => !mysqlColumnNames.includes(c));
    const missingInSQLite = mysqlColumnNames.filter(c => !sqliteColumnNames.includes(c));
    
    if (missingInMySQL.length > 0) {
      console.log(`   ⚠️  云端缺少列: ${missingInMySQL.join(', ')}`);
      allMatch = false;
      
      // 添加缺失的列
      for (const colName of missingInMySQL) {
        const col = sqliteColumns.find(c => c.name === colName);
        if (col) {
          let mysqlType = convertSQLiteType(col.type);
          let defaultVal = '';
          if (col.dflt_value !== null) {
            if (typeof col.dflt_value === 'string') {
              defaultVal = ` DEFAULT '${col.dflt_value}'`;
            } else {
              defaultVal = ` DEFAULT ${col.dflt_value}`;
            }
          }
          const nullable = col.notnull === 0 ? '' : ' NOT NULL';
          
          try {
            await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${colName}\` ${mysqlType}${nullable}${defaultVal}`);
            console.log(`     ✓ 添加列 ${colName} ${mysqlType}`);
          } catch (e) {
            console.log(`     ✗ 添加列失败: ${e.message}`);
          }
        }
      }
    }
    
    if (missingInSQLite.length > 0) {
      console.log(`   ⚠️  本地缺少列: ${missingInSQLite.join(', ')}`);
      allMatch = false;
    }
    
    if (missingInMySQL.length === 0 && missingInSQLite.length === 0) {
      console.log('   ✓ 结构一致');
    }
    
    console.log();
  }
  
  await pool.end();
  
  if (allMatch) {
    console.log('✓ 所有表结构一致');
  } else {
    console.log('⚠️  已修复部分表结构差异');
  }
  
  console.log('\n=== 检查完成 ===');
}

function convertSQLiteType(sqliteType) {
  const upperType = sqliteType.toUpperCase();
  if (upperType.includes('INTEGER')) return 'INT';
  if (upperType.includes('TEXT')) return 'VARCHAR(255)';
  if (upperType.includes('REAL')) return 'DOUBLE';
  if (upperType.includes('BLOB')) return 'BLOB';
  if (upperType.includes('DATETIME')) return 'DATETIME';
  if (upperType.includes('BOOLEAN')) return 'TINYINT(1)';
  return 'VARCHAR(255)';
}

main().catch(e => {
  console.error('脚本执行失败:', e.message);
  process.exit(1);
});