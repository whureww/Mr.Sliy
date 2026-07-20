const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/code_optimizer.db');
const BACKUP_PATH = path.join(__dirname, '../database_backup_mysql.sql');

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

function sqliteToMysqlType(sqliteType, columnName) {
  const lowerType = (sqliteType || '').toLowerCase();
  
  if (lowerType.includes('integer')) {
    if (columnName === 'id') return 'INT';
    return 'INT';
  }
  if (lowerType.includes('real') || lowerType.includes('float') || lowerType.includes('double')) {
    return 'DECIMAL(10,2)';
  }
  if (lowerType.includes('text')) {
    return 'TEXT';
  }
  if (lowerType.includes('blob')) {
    return 'BLOB';
  }
  if (lowerType.includes('boolean')) {
    return 'TINYINT(1)';
  }
  if (lowerType.includes('datetime') || lowerType.includes('timestamp')) {
    return 'DATETIME';
  }
  if (lowerType.includes('varchar')) {
    return sqliteType.toUpperCase();
  }
  return 'TEXT';
}

function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

async function createMysqlBackup() {
  console.log('开始创建MySQL格式数据库备份...');

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map(row => row.name);

    console.log(`发现 ${tables.length} 张表`);

    let sqlContent = `-- ========================================================
-- Mr.Sliy 智能体数据库完整备份 (MySQL格式)
-- 版本: v3.0.2
-- 日期: ${new Date().toISOString().split('T')[0]}
-- 包含: ${tables.length} 张表 + 索引 + 数据
-- MySQL版本要求: 5.7+ / 8.0+
-- ========================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

`;

    for (const tableName of tables) {
      const columns = getTableColumns(db, tableName);
      const rows = db.prepare(`SELECT * FROM ${tableName}`).all();

      sqlContent += `-- ----------------------------\n`;
      sqlContent += `-- Table structure for ${tableName}\n`;
      sqlContent += `-- ----------------------------\n`;
      sqlContent += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
      sqlContent += `CREATE TABLE \`${tableName}\` (\n`;

      const columnDefinitions = [];
      const indexes = [];
      let hasAutoIncrement = false;

      for (const col of columns) {
        let def = `  \`${col.name}\` ${sqliteToMysqlType(col.type, col.name)}`;
        
        if (col.notnull) {
          def += ' NOT NULL';
        }
        
        if (col.dflt_value !== null && col.dflt_value !== undefined) {
          if (col.dflt_value === 'CURRENT_TIMESTAMP') {
            def += " DEFAULT CURRENT_TIMESTAMP";
          } else if (col.dflt_value === '0') {
            def += " DEFAULT 0";
          } else if (col.dflt_value === '1') {
            def += " DEFAULT 1";
          } else {
            let dflt = col.dflt_value;
            if (dflt.startsWith("'") && dflt.endsWith("'")) {
              dflt = dflt.substring(1, dflt.length - 1);
            }
            def += ` DEFAULT '${dflt.replace(/'/g, "''")}'`;
          }
        }
        
        if (col.pk === 1) {
          def += ' PRIMARY KEY';
          if (col.type.toLowerCase().includes('autoincrement')) {
            def += ' AUTO_INCREMENT';
            hasAutoIncrement = true;
          }
        }

        if ((col.name === 'updated_at' || col.name === 'updatedAt') && !hasAutoIncrement) {
          def += ' ON UPDATE CURRENT_TIMESTAMP';
        }

        columnDefinitions.push(def);
      }

      sqlContent += columnDefinitions.join(',\n') + '\n';
      sqlContent += ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n';

      const indexInfo = db.prepare(`PRAGMA index_list(${tableName})`).all();
      for (const idx of indexInfo) {
        if (idx.name.startsWith('sqlite_autoindex')) continue;
        
        const idxColumns = db.prepare(`PRAGMA index_info(${idx.name})`).all();
        const colNames = idxColumns.map(c => `\`${c.name}\``).join(', ');
        
        let unique = '';
        if (idx.unique) {
          unique = 'UNIQUE ';
        }
        
        sqlContent += `CREATE ${unique}INDEX \`${idx.name}\` ON \`${tableName}\` (${colNames});\n`;
      }
      
      if (indexes.length > 0) {
        sqlContent += '\n';
      }

      if (rows.length > 0) {
        const colNames = columns.map(col => `\`${col.name}\``).join(', ');
        
        sqlContent += `-- ----------------------------\n`;
        sqlContent += `-- Records of ${tableName} (${rows.length} 条)\n`;
        sqlContent += `-- ----------------------------\n`;

        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          const values = batch.map(row => {
            const rowValues = columns.map(col => {
              const value = row[col.name];
              if (col.type.toLowerCase().includes('boolean')) {
                return value ? '1' : '0';
              }
              return escapeSqlValue(value);
            });
            return `(${rowValues.join(', ')})`;
          }).join(',\n');

          sqlContent += `INSERT INTO \`${tableName}\` (${colNames}) VALUES\n${values};\n\n`;
        }
      } else {
        sqlContent += `-- ${tableName}: 无数据\n\n`;
      }

      console.log(`  ${tableName}: ${rows.length} 条记录`);
    }

    sqlContent += `SET FOREIGN_KEY_CHECKS = 1;

-- ========================================================
-- 备份完成
-- ========================================================`;

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

if (require.main === module) {
  createMysqlBackup().catch(error => {
    console.error('备份脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = { createMysqlBackup };