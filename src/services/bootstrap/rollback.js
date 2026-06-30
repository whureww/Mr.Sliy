/**
 * 回滚模块
 * 提供系统回滚能力，支持更新和修复操作的回滚
 * 创建备份、恢复备份、管理备份记录
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { execute, query, queryOne } = require('../../utils/database');
const { generateUUID } = require('../../utils/helpers');

class RollbackManager {
  constructor() {
    this.backupDirectory = path.join(process.cwd(), 'backups');
    this.maxBackups = 10;
    this.backupTypes = ['update', 'repair', 'database', 'code', 'config', 'system', 'test'];
    this.ensureBackupDirectory();
  }

  ensureBackupDirectory() {
    if (!fs.existsSync(this.backupDirectory)) {
      fs.mkdirSync(this.backupDirectory, { recursive: true });
    }
  }

  async createBackup(backupType, targetPath, options = {}) {
    if (!this.backupTypes.includes(backupType)) {
      return { success: false, error: `未知备份类型: ${backupType}` };
    }

    const backupId = generateUUID();
    const timestamp = Date.now();
    const backupDir = path.join(this.backupDirectory, backupType, backupId);
    
    fs.mkdirSync(backupDir, { recursive: true });

    try {
      const stats = fs.statSync(targetPath);
      
      if (stats.isDirectory()) {
        await this.copyDirectory(targetPath, backupDir);
      } else {
        fs.copyFileSync(targetPath, path.join(backupDir, path.basename(targetPath)));
      }

      const pkg = require('../../../package.json');
      
      await execute(
        'INSERT INTO self_update_history (id, update_type, target_version, current_version, update_source, update_content, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [backupId, 'backup', pkg.version, pkg.version, 'system', JSON.stringify({ targetPath, backupType }), 'applied']
      );

      await this.cleanupOldBackups(backupType);

      logger.info(`创建备份成功: ${backupId}`);

      return {
        success: true,
        backupId,
        backupType,
        targetPath,
        timestamp,
        size: this.getDirectorySize(backupDir)
      };
    } catch (error) {
      logger.error('创建备份失败:', error);
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
      return { success: false, error: error.message };
    }
  }

  async restoreBackup(backupId) {
    const backupRecord = await queryOne('SELECT * FROM self_update_history WHERE id = ?', [backupId]);
    
    if (!backupRecord) {
      return { success: false, error: '备份记录不存在' };
    }

    if (backupRecord.status !== 'applied') {
      return { success: false, error: '备份未应用，无法恢复' };
    }

    const backupDir = path.join(this.backupDirectory, backupRecord.update_type, backupId);
    
    if (!fs.existsSync(backupDir)) {
      return { success: false, error: '备份文件不存在' };
    }

    try {
      let content;
      try {
        content = JSON.parse(backupRecord.update_content);
      } catch {
        content = { targetPath: process.cwd() };
      }

      const targetPath = content.targetPath;

      if (fs.existsSync(targetPath)) {
        const tempDir = path.join(this.backupDirectory, 'temp', Date.now().toString());
        fs.mkdirSync(tempDir, { recursive: true });
        
        if (fs.statSync(targetPath).isDirectory()) {
          await this.copyDirectory(targetPath, tempDir);
        } else {
          fs.copyFileSync(targetPath, path.join(tempDir, path.basename(targetPath)));
        }
      }

      const backupFiles = fs.readdirSync(backupDir);
      
      if (backupFiles.length === 1 && fs.statSync(path.join(backupDir, backupFiles[0])).isFile()) {
        const fileName = backupFiles[0];
        const restorePath = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory() 
          ? path.join(targetPath, fileName) 
          : targetPath;
        
        fs.writeFileSync(restorePath, fs.readFileSync(path.join(backupDir, fileName)));
      } else {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
        }
        await this.copyDirectory(backupDir, targetPath);
      }

      await execute(
        'UPDATE self_update_history SET status = ?, rollback_at = ? WHERE id = ?',
        ['rolled_back', Date.now(), backupId]
      );

      logger.info(`恢复备份成功: ${backupId}`);

      return {
        success: true,
        backupId,
        targetPath,
        restoredAt: Date.now()
      };
    } catch (error) {
      logger.error('恢复备份失败:', error);
      return { success: false, error: error.message };
    }
  }

  async rollbackUpdate(updateId) {
    const updateRecord = await queryOne('SELECT * FROM self_update_history WHERE id = ?', [updateId]);
    
    if (!updateRecord) {
      return { success: false, error: '更新记录不存在' };
    }

    if (updateRecord.status !== 'applied') {
      return { success: false, error: `更新状态为 ${updateRecord.status}，无法回滚` };
    }

    if (updateRecord.rollback_version) {
      const backups = await this.listBackups('update', 5);
      const recentBackup = backups[0];
      
      if (recentBackup) {
        const restoreResult = await this.restoreBackup(recentBackup.id);
        
        if (restoreResult.success) {
          await execute(
            'UPDATE self_update_history SET status = ?, rollback_at = ? WHERE id = ?',
            ['rolled_back', Date.now(), updateId]
          );
          
          return { success: true, updateId, message: '回滚成功' };
        }
        
        return restoreResult;
      }
    }

    await execute(
      'UPDATE self_update_history SET status = ?, rollback_at = ? WHERE id = ?',
      ['rolled_back', Date.now(), updateId]
    );

    return { success: true, updateId, message: '回滚完成（无备份恢复）' };
  }

  async rollbackRepair(repairId) {
    const repairRecord = await queryOne('SELECT * FROM self_repair_history WHERE id = ?', [repairId]);
    
    if (!repairRecord) {
      return { success: false, error: '修复记录不存在' };
    }

    if (repairRecord.status !== 'success') {
      return { success: false, error: `修复状态为 ${repairRecord.status}，无法回滚` };
    }

    await execute(
      'UPDATE self_repair_history SET status = ?, rollback_at = ? WHERE id = ?',
      ['rolled_back', Date.now(), repairId]
    );

    const backups = await this.listBackups('repair', 5);
    if (backups.length > 0) {
      const restoreResult = await this.restoreBackup(backups[0].id);
      if (restoreResult.success) {
        return { success: true, repairId, message: '回滚成功' };
      }
    }

    return { success: true, repairId, message: '回滚完成（无备份恢复）' };
  }

  async listBackups(backupType = null, limit = 20) {
    try {
      let sql = 'SELECT * FROM self_update_history WHERE 1=1';
      const params = [];

      if (backupType) {
        sql += ' AND update_type = ?';
        params.push(backupType);
      } else {
        sql += ' AND update_type IN (?)';
        params.push(this.backupTypes.join(','));
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const records = await query(sql, params);

      return records.map(record => {
        let content = {};
        try {
          content = JSON.parse(record.update_content);
        } catch {}
        
        return {
          id: record.id,
          backupType: record.update_type,
          targetPath: content.targetPath,
          timestamp: record.created_at,
          status: record.status,
          size: 0
        };
      });
    } catch (error) {
      logger.error('查询备份记录失败:', error);
      return [];
    }
  }

  async getBackupInfo(backupId) {
    const record = await queryOne('SELECT * FROM self_update_history WHERE id = ?', [backupId]);
    
    if (!record) {
      return null;
    }

    let content = {};
    try {
      content = JSON.parse(record.update_content);
    } catch {}

    const backupDir = path.join(this.backupDirectory, record.update_type, backupId);
    const exists = fs.existsSync(backupDir);
    const size = exists ? this.getDirectorySize(backupDir) : 0;

    return {
      id: record.id,
      backupType: record.update_type,
      targetPath: content.targetPath,
      timestamp: record.created_at,
      status: record.status,
      size,
      exists
    };
  }

  async deleteBackup(backupId) {
    const record = await queryOne('SELECT * FROM self_update_history WHERE id = ?', [backupId]);
    
    if (!record) {
      return { success: false, error: '备份记录不存在' };
    }

    const backupDir = path.join(this.backupDirectory, record.update_type, backupId);
    
    try {
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }

      await execute('DELETE FROM self_update_history WHERE id = ?', [backupId]);

      logger.info(`删除备份成功: ${backupId}`);
      return { success: true, backupId };
    } catch (error) {
      logger.error('删除备份失败:', error);
      return { success: false, error: error.message };
    }
  }

  async cleanupOldBackups(backupType) {
    const backups = await this.listBackups(backupType, this.maxBackups + 5);
    
    if (backups.length <= this.maxBackups) {
      return;
    }

    const toDelete = backups.slice(this.maxBackups);
    
    for (const backup of toDelete) {
      await this.deleteBackup(backup.id);
    }

    logger.info(`清理了 ${toDelete.length} 个旧备份`);
  }

  async copyDirectory(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    
    const files = fs.readdirSync(src);
    
    for (const file of files) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      
      const stats = fs.statSync(srcPath);
      
      if (stats.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  getDirectorySize(dir) {
    let size = 0;
    
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    }
    
    return size;
  }

  async createFullSystemBackup() {
    const pkg = require('../../../package.json');
    const backupId = generateUUID();
    const timestamp = Date.now();
    const backupDir = path.join(this.backupDirectory, 'system', backupId);
    
    fs.mkdirSync(backupDir, { recursive: true });

    try {
      const excludeDirs = ['node_modules', '.git', 'backups', 'logs'];
      
      await this.copyDirectoryExclude(process.cwd(), backupDir, excludeDirs);

      await execute(
        'INSERT INTO self_update_history (id, update_type, target_version, current_version, update_source, update_content, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [backupId, 'system', pkg.version, pkg.version, 'system', JSON.stringify({ type: 'full_system' }), 'applied']
      );

      await this.cleanupOldBackups('system');

      logger.info(`创建系统全量备份成功: ${backupId}`);

      return {
        success: true,
        backupId,
        backupType: 'system',
        timestamp,
        size: this.getDirectorySize(backupDir)
      };
    } catch (error) {
      logger.error('创建系统全量备份失败:', error);
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
      return { success: false, error: error.message };
    }
  }

  async copyDirectoryExclude(src, dest, excludeDirs) {
    fs.mkdirSync(dest, { recursive: true });
    
    const files = fs.readdirSync(src);
    
    for (const file of files) {
      if (excludeDirs.includes(file)) {
        continue;
      }
      
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      
      const stats = fs.statSync(srcPath);
      
      if (stats.isDirectory()) {
        await this.copyDirectoryExclude(srcPath, destPath, excludeDirs);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

const rollbackManager = new RollbackManager();

module.exports = {
  RollbackManager,
  rollbackManager
};