const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const Database = require('better-sqlite3');

async function exportSQL() {
  try {
    const CONFIG_FILE = path.join(__dirname, 'data', 'database_connections.json');
    let entries = [];
    let cases = [];
    
    if (fs.existsSync(CONFIG_FILE)) {
      const connConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const defaultConnId = connConfig.defaultConnection;
      const defaultConn = connConfig.connections[defaultConnId];
      
      if (defaultConn && defaultConn.enabled && defaultConn.host) {
        console.log(`当前数据库: MySQL (${defaultConn.host})`);
        
        const pool = mysql.createPool({
          host: defaultConn.host,
          port: defaultConn.port,
          user: defaultConn.user,
          password: defaultConn.password,
          database: defaultConn.database,
          connectionLimit: defaultConn.connectionLimit
        });
        
        const [entriesResult] = await pool.query('SELECT * FROM kb_entries');
        const [casesResult] = await pool.query('SELECT * FROM kb_cases');
        
        entries = entriesResult;
        cases = casesResult;
        
        await pool.end();
      } else {
        console.log('当前数据库: SQLite');
        
        const dbPath = './database/code_optimizer.db';
        const absPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(path.join(__dirname, dbPath));
        const sqliteDb = new Database(absPath);
        
        entries = sqliteDb.prepare('SELECT * FROM kb_entries').all();
        cases = sqliteDb.prepare('SELECT * FROM kb_cases').all();
        
        sqliteDb.close();
      }
    } else {
      console.log('当前数据库: SQLite');
      
      const dbPath = './database/code_optimizer.db';
      const absPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(path.join(__dirname, dbPath));
      const sqliteDb = new Database(absPath);
      
      entries = sqliteDb.prepare('SELECT * FROM kb_entries').all();
      cases = sqliteDb.prepare('SELECT * FROM kb_cases').all();
      
      sqliteDb.close();
    }
    
    let sql = '-- === kb_entries ===\n';
    entries.forEach(e => {
      const content = e.content ? e.content.replace(/'/g, "''") : '';
      const tags = e.tags ? (typeof e.tags === 'string' ? e.tags.replace(/'/g, "''") : JSON.stringify(e.tags).replace(/'/g, "''")) : '[]';
      const source = e.source ? e.source.replace(/'/g, "''") : '';
      sql += `INSERT INTO kb_entries (id, content, content_type, language, tags, source, vector_json, created_at) VALUES ('${e.id}', '${content}', '${e.content_type}', '${e.language}', '${tags}', '${source}', '${e.vector_json || ''}', '${e.created_at}');\n`;
    });
    
    sql += '\n-- === kb_cases ===\n';
    cases.forEach(c => {
      const originalCode = c.original_code ? c.original_code.replace(/'/g, "''") : '';
      const optimizedCode = c.optimized_code ? c.optimized_code.replace(/'/g, "''") : '';
      const explanation = c.explanation ? c.explanation.replace(/'/g, "''") : '';
      sql += `INSERT INTO kb_cases (id, original_code, optimized_code, explanation, language, issue_type, vector_json, usage_count, rating, created_at) VALUES ('${c.id}', '${originalCode}', '${optimizedCode}', '${explanation}', '${c.language}', '${c.issue_type}', '${c.vector_json || ''}', ${c.usage_count || 0}, ${c.rating || 0}, '${c.created_at}');\n`;
    });
    
    fs.writeFileSync('knowledge_backup.sql', sql, 'utf-8');
    console.log(`导出完成！共 ${entries.length} 条知识条目，${cases.length} 条优化案例`);
  } catch (error) {
    console.error('导出失败:', error);
    process.exit(1);
  }
}

exportSQL();