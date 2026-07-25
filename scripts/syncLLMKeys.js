/**
 * 同步LLM API密钥到云端
 * 使用环境变量配置数据库连接：MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */

const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3');
const path = require('path');

// 从环境变量读取数据库配置
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'code_optimizer',
  charset: 'utf8mb4'
};

const LOCAL_DB_PATH = path.join(require('os').homedir(), '.mr-sliy', 'database', 'code_optimizer.db');

async function main() {
  console.log('=== 同步LLM API密钥到云端 ===');
  
  // 检查配置
  if (!MYSQL_CONFIG.password) {
    console.error('✗ 请设置 MYSQL_PASSWORD 环境变量');
    process.exit(1);
  }
  
  const pool = mysql.createPool(MYSQL_CONFIG);
  
  // 读取本地数据
  const localData = await new Promise((resolve) => {
    const db = new sqlite3.Database(LOCAL_DB_PATH);
    db.all('SELECT * FROM llm_api_keys', (err, rows) => {
      db.close();
      resolve(rows || []);
    });
  });
  
  console.log('本地 llm_api_keys 数据:', localData.length, '条');
  
  // 同步到云端
  for (const row of localData) {
    try {
      await pool.query(
        `INSERT INTO llm_api_keys (id, provider_name, api_key, api_url, model_name, is_active, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          api_key = VALUES(api_key),
          api_url = VALUES(api_url),
          model_name = VALUES(model_name),
          is_active = VALUES(is_active),
          priority = VALUES(priority),
          updated_at = VALUES(updated_at)`,
        [
          row.id, row.provider_name, row.api_key, row.api_url,
          row.model_name, row.is_active, row.priority, row.created_at, row.updated_at
        ]
      );
      console.log('✓ 同步成功:', row.provider_name);
    } catch (e) {
      console.error('✗ 同步失败:', row.provider_name, e.message);
    }
  }
  
  await pool.end();
  console.log('\n同步完成');
}

main().catch(e => {
  console.error('脚本执行失败:', e.message);
  process.exit(1);
});