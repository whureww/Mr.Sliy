/**
 * 回滚模块
 * 提供系统回滚能力，支持更新和修复操作的回滚
 * 创建备份、恢复备份、管理备份记录
 * 支持精确回滚到更新前状态
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { execute, query, queryOne } = require('../../utils/database');
const { generateUUID } = require('../../utils/helpers');
const { moduleRegistry } = require('../../utils/moduleRegistry');

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
    const onProgress = options.onProgress;
    const requestPermission = options.requestPermission || (() => Promise.resolve(false));
    
    let backupDir = path.join(this.backupDirectory, backupType, backupId);
    
    try {
      if (onProgress) {
        onProgress({ progress: 5, status: 'running', description: '检查备份条件' });
      }

      const checkResult = await this.checkBackupConditions(targetPath, { onProgress, requestPermission });
      if (!checkResult.success) {
        return checkResult;
      }
      
      if (checkResult.backupDirectory) {
        backupDir = path.join(checkResult.backupDirectory, backupType, backupId);
      }

      fs.mkdirSync(backupDir, { recursive: true });

      fs.mkdirSync(backupDir, { recursive: true });

      if (onProgress) {
        onProgress({ progress: 10, status: 'running', description: '初始化备份目录' });
      }

      const stats = fs.statSync(targetPath);
      const filesToBackup = [];
      const skippedFiles = [];
      
      if (stats.isDirectory()) {
        const excludeDirs = ['node_modules', '.git', 'backups', 'logs', 'module_backups', '.trae-cn', 'dist', 'build'];
        
        if (onProgress) {
          onProgress({ progress: 15, status: 'running', description: '扫描文件列表' });
        }
        
        const allFiles = this.getDirectoryFilesExclude(targetPath, excludeDirs);
        filesToBackup.push(...allFiles);
        
        if (onProgress) {
          onProgress({ progress: 20, status: 'running', description: `发现 ${filesToBackup.length} 个文件` });
        }
        
        let copied = 0;
        await this.copyDirectoryExcludeSafe(targetPath, backupDir, excludeDirs, (filePath, skipped) => {
          if (skipped) {
            skippedFiles.push(filePath);
          } else {
            copied++;
          }
          if (onProgress && filesToBackup.length > 0) {
            const progress = Math.min(20 + Math.round((copied / filesToBackup.length) * 60), 80);
            onProgress({ 
              progress, 
              status: 'running', 
              description: `正在备份 ${copied}/${filesToBackup.length}${skippedFiles.length > 0 ? ` (跳过${skippedFiles.length})` : ''}`,
              currentFile: path.basename(filePath)
            });
          }
        });
      } else {
        if (onProgress) {
          onProgress({ progress: 50, status: 'running', description: `正在备份 ${path.basename(targetPath)}` });
        }
        const copyResult = this.copyFileWithRetry(targetPath, path.join(backupDir, path.basename(targetPath)));
        if (copyResult.success) {
          filesToBackup.push(targetPath);
        } else {
          skippedFiles.push(targetPath);
          logger.warn(`跳过文件: ${targetPath} - ${copyResult.error}`);
        }
      }

      if (filesToBackup.length === 0) {
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
        return { success: false, error: '没有可备份的文件' };
      }

      if (onProgress) {
        onProgress({ progress: 85, status: 'running', description: '保存备份记录' });
      }

      const pkg = require('../../../package.json');
      
      const dbResult = await this.executeWithRetry(
        'INSERT INTO self_update_history (id, update_type, target_version, current_version, update_source, update_content, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [backupId, 'backup', pkg.version, pkg.version, 'system', JSON.stringify({ 
          targetPath, 
          backupType,
          filesToBackup,
          skippedFiles,
          timestamp
        }), 'applied']
      );

      if (!dbResult.success) {
        logger.error(`保存备份记录失败: ${dbResult.error}`);
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
        return { success: false, error: `保存备份记录失败: ${dbResult.error}` };
      }

      if (onProgress) {
        onProgress({ progress: 92, status: 'running', description: '清理旧备份' });
      }

      try {
        await this.cleanupOldBackups(backupType);
      } catch (cleanupError) {
        logger.warn(`清理旧备份失败: ${cleanupError.message}`);
      }

      if (onProgress) {
        onProgress({ progress: 100, status: 'success', description: '备份完成' });
      }

      const result = {
        success: true,
        backupId,
        backupType,
        targetPath,
        timestamp,
        size: this.getDirectorySize(backupDir),
        filesCount: filesToBackup.length,
        filesToBackup,
        skippedCount: skippedFiles.length,
        skippedFiles
      };

      if (skippedFiles.length > 0) {
        logger.warn(`备份完成，但跳过了 ${skippedFiles.length} 个文件: ${backupId}`);
      }
      logger.info(`创建备份成功: ${backupId} (${filesToBackup.length}个文件)`);

      return result;
    } catch (error) {
      logger.error('创建备份失败:', error);
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
      if (onProgress) {
        onProgress({ progress: 0, status: 'failed', description: '备份失败: ' + error.message });
      }
      return { success: false, error: error.message };
    }
  }

  async checkBackupConditions(targetPath, options = {}) {
    const { onProgress, requestPermission } = options;
    
    try {
      if (!fs.existsSync(targetPath)) {
        return { success: false, error: `目标路径不存在: ${targetPath}` };
      }

      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory() && !stats.isFile()) {
        return { success: false, error: '目标路径不是有效的文件或目录' };
      }

      const backupDir = path.dirname(this.backupDirectory);
      const diskInfo = await this.getDiskInfo(backupDir);
      
      if (diskInfo && diskInfo.available < 100 * 1024 * 1024) {
        if (requestPermission) {
          const altPaths = await this.findAlternativeBackupPaths();
          
          if (altPaths.length > 0) {
            const permissionResult = await requestPermission({
              type: 'change_backup_location',
              title: '磁盘空间不足',
              message: `当前备份目录 (${backupDir}) 可用空间不足，需要至少100MB。`,
              details: {
                currentPath: backupDir,
                availableSpace: (diskInfo.available / 1024 / 1024).toFixed(2) + ' MB',
                requiredSpace: '100 MB',
                alternatives: altPaths.slice(0, 5).map(p => ({
                  path: p.path,
                  available: (p.available / 1024 / 1024).toFixed(2) + ' MB'
                }))
              }
            });
            
            if (permissionResult.granted && permissionResult.path) {
              if (onProgress) {
                onProgress({ progress: 8, status: 'running', description: `切换备份位置到: ${permissionResult.path}` });
              }
              logger.info(`备份位置已切换到: ${permissionResult.path}`);
              return { success: true, backupDirectory: permissionResult.path };
            }
          }
        }
        
        return { success: false, error: `磁盘空间不足，当前位置 ${backupDir} 可用空间 ${(diskInfo.available / 1024 / 1024).toFixed(2)} MB，至少需要100MB可用空间` };
      }

      try {
        fs.accessSync(backupDir, fs.constants.W_OK);
      } catch {
        if (requestPermission) {
          const permissionResult = await requestPermission({
            type: 'backup_permission',
            title: '权限不足',
            message: `无法写入备份目录 ${backupDir}，需要写入权限。`,
            details: {
              path: backupDir,
              requiredPermission: '写入权限'
            }
          });
          
          if (permissionResult.granted) {
            return { success: true };
          }
        }
        
        return { success: false, error: `备份目录权限不足: ${backupDir}` };
      }

      return { success: true };
    } catch (error) {
      logger.error('检查备份条件失败:', error);
      return { success: false, error: '检查备份条件失败: ' + error.message };
    }
  }

  async findAlternativeBackupPaths() {
    const paths = [];
    const candidates = [];
    
    if (process.platform === 'win32') {
      candidates.push(
        path.join(process.env.USERPROFILE, 'Documents', 'MrSliyBackups'),
        path.join(process.env.APPDATA, 'MrSliy', 'Backups'),
        path.join(process.env.LOCALAPPDATA, 'MrSliy', 'Backups')
      );
      
      try {
        const { execSync } = require('child_process');
        const output = execSync('wmic logicaldisk get DeviceID,FreeSpace /value', { encoding: 'utf8' });
        const lines = output.trim().split('\n');
        
        let currentDrive = '';
        let currentFreeSpace = 0;
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('DeviceID=')) {
            currentDrive = trimmed.replace('DeviceID=', '').trim();
          } else if (trimmed.startsWith('FreeSpace=')) {
            currentFreeSpace = parseInt(trimmed.replace('FreeSpace=', '').trim());
            if (currentDrive && currentFreeSpace > 100 * 1024 * 1024) {
              candidates.push(path.join(currentDrive, 'MrSliyBackups'));
            }
          }
        }
      } catch {
        logger.debug('无法获取磁盘信息');
      }
    } else {
      candidates.push(
        path.join(process.env.HOME, '.mrsliy', 'backups'),
        path.join('/tmp', 'mrsliy_backups')
      );
    }
    
    for (const candidate of candidates) {
      try {
        const drivePath = path.dirname(candidate);
        const diskInfo = await this.getDiskInfo(drivePath);
        if (diskInfo && diskInfo.available > 100 * 1024 * 1024) {
          paths.push({
            path: candidate,
            available: diskInfo.available
          });
        }
      } catch {
        continue;
      }
    }
    
    paths.sort((a, b) => b.available - a.available);
    return paths;
  }

  async getDiskInfo(dir) {
    try {
      const stats = fs.statSync(dir);
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        const output = execSync(`wmic logicaldisk where "DeviceID='${dir.charAt(0)}:'" get FreeSpace,Size /value`, { encoding: 'utf8' });
        const freeSpaceMatch = output.match(/FreeSpace=(\d+)/);
        const sizeMatch = output.match(/Size=(\d+)/);
        if (freeSpaceMatch && sizeMatch) {
          return {
            available: parseInt(freeSpaceMatch[1]),
            total: parseInt(sizeMatch[1]),
            used: parseInt(sizeMatch[1]) - parseInt(freeSpaceMatch[1])
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  copyFileWithRetry(src, dest, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const srcStats = fs.statSync(src);
        
        if (srcStats.size > 50 * 1024 * 1024) {
          return this.copyLargeFileSync(src, dest);
        }
        
        try {
          fs.copyFileSync(src, dest);
        } catch (copyError) {
          if (copyError.code === 'EPERM' || copyError.code === 'EBUSY') {
            logger.debug(`文件可能被占用，尝试流式复制: ${src}`);
            return this.copyLargeFileSync(src, dest);
          }
          throw copyError;
        }
        
        return { success: true };
      } catch (error) {
        if (i < maxRetries - 1) {
          logger.debug(`文件复制失败，重试 ${i + 1}/${maxRetries}: ${src} - ${error.message}`);
          const waitTime = (i + 1) * 1000;
          const start = Date.now();
          while (Date.now() - start < waitTime) {}
        } else {
          logger.warn(`文件复制失败(已重试${maxRetries}次): ${src} - ${error.message}`);
          return { success: false, error: error.message };
        }
      }
    }
    return { success: false, error: '未知错误' };
  }

  copyLargeFileSync(src, dest) {
    try {
      const readStream = fs.createReadStream(src, { flags: 'r', autoClose: true });
      const writeStream = fs.createWriteStream(dest, { flags: 'w', autoClose: true });
      
      return new Promise((resolve, reject) => {
        readStream.on('error', (err) => {
          readStream.destroy();
          writeStream.destroy();
          reject(err);
        });
        
        writeStream.on('error', (err) => {
          readStream.destroy();
          writeStream.destroy();
          reject(err);
        });
        
        writeStream.on('finish', () => {
          resolve({ success: true });
        });
        
        readStream.pipe(writeStream);
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  copyLargeFile(src, dest) {
    const readStream = fs.createReadStream(src);
    const writeStream = fs.createWriteStream(dest);
    return new Promise((resolve, reject) => {
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      readStream.pipe(writeStream);
    });
  }

  async executeWithRetry(sql, params, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await execute(sql, params);
        return { success: true };
      } catch (error) {
        if (i < maxRetries - 1) {
          logger.debug(`数据库操作失败，重试 ${i + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          return { success: false, error: error.message };
        }
      }
    }
    return { success: false, error: '重试次数耗尽' };
  }

  getDirectoryFilesExclude(dir, excludeDirs = []) {
    const files = [];
    
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      if (excludeDirs.includes(item)) {
        continue;
      }
      
      const fullPath = path.join(dir, item);
      const stats = fs.statSync(fullPath);
      
      if (stats.isDirectory()) {
        files.push(...this.getDirectoryFilesExclude(fullPath, excludeDirs));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
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
      const filesToRestore = content.filesToBackup || [];

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

      logger.info(`恢复备份成功: ${backupId} -> ${targetPath} (${filesToRestore.length}个文件)`);

      return {
        success: true,
        backupId,
        targetPath,
        restoredAt: Date.now(),
        filesCount: filesToRestore.length,
        filesRestored: filesToRestore
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

    let rolledBack = false;
    let backupInfo = null;

    if (updateRecord.rollback_version) {
      const backups = await this.listBackups('update', 10);
      
      for (const backup of backups) {
        const backupContent = await this.getBackupInfo(backup.id);
        if (backupContent && backupContent.exists) {
          backupInfo = backupContent;
          const restoreResult = await this.restoreBackup(backup.id);
          
          if (restoreResult.success) {
            rolledBack = true;
            logger.info(`回滚成功: 使用备份 ${backup.id}`);
            break;
          } else {
            logger.warn(`尝试恢复备份 ${backup.id} 失败: ${restoreResult.error}`);
          }
        }
      }
    }

    if (!rolledBack) {
      logger.warn('未找到可用备份，尝试模块级回滚');
      
      let updateContent;
      try {
        updateContent = JSON.parse(updateRecord.update_content);
      } catch {
        updateContent = {};
      }

      if (updateContent.filePath) {
        const moduleId = path.basename(updateContent.filePath, '.js');
        const restoreResult = await moduleRegistry.restoreModule(moduleId);
        
        if (restoreResult.success) {
          rolledBack = true;
          logger.info(`模块级回滚成功: ${moduleId}`);
        }
      }
    }

    await execute(
      'UPDATE self_update_history SET status = ?, rollback_at = ?, rolled_back_reason = ? WHERE id = ?',
      ['rolled_back', Date.now(), rolledBack ? 'user_request' : 'no_backup', updateId]
    );

    return { 
      success: rolledBack, 
      updateId, 
      message: rolledBack ? '回滚成功' : '回滚完成（无备份恢复）',
      backupUsed: backupInfo ? backupInfo.id : null,
      rolledBack
    };
  }

  async rollbackRepair(repairId) {
    const repairRecord = await queryOne('SELECT * FROM self_repair_history WHERE id = ?', [repairId]);
    
    if (!repairRecord) {
      return { success: false, error: '修复记录不存在' };
    }

    if (repairRecord.status !== 'success') {
      return { success: false, error: `修复状态为 ${repairRecord.status}，无法回滚` };
    }

    let rolledBack = false;

    const backups = await this.listBackups('repair', 5);
    if (backups.length > 0) {
      for (const backup of backups) {
        const restoreResult = await this.restoreBackup(backup.id);
        if (restoreResult.success) {
          rolledBack = true;
          logger.info(`修复回滚成功: 使用备份 ${backup.id}`);
          break;
        }
      }
    }

    await execute(
      'UPDATE self_repair_history SET status = ?, rollback_at = ?, rolled_back_reason = ? WHERE id = ?',
      ['rolled_back', Date.now(), rolledBack ? 'user_request' : 'no_backup', repairId]
    );

    return { 
      success: rolledBack, 
      repairId, 
      message: rolledBack ? '回滚成功' : '回滚完成（无备份恢复）',
      rolledBack
    };
  }

  async rollbackToVersion(version) {
    const updates = await query(
      'SELECT * FROM self_update_history WHERE target_version = ? AND status = ? ORDER BY applied_at DESC',
      [version, 'applied']
    );

    if (updates.length === 0) {
      return { success: false, error: `未找到版本 ${version} 的更新记录` };
    }

    const latestUpdate = updates[0];
    return await this.rollbackUpdate(latestUpdate.id);
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
          size: 0,
          filesCount: content.filesToBackup ? content.filesToBackup.length : 0
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
      exists,
      filesToBackup: content.filesToBackup || [],
      filesCount: content.filesToBackup ? content.filesToBackup.length : 0
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

  getDirectoryFiles(dir) {
    const files = [];
    
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stats = fs.statSync(fullPath);
      
      if (stats.isDirectory()) {
        files.push(...this.getDirectoryFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
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

  async createFullSystemBackup(options = {}) {
    const pkg = require('../../../package.json');
    const backupId = generateUUID();
    const timestamp = Date.now();
    const onProgress = options.onProgress;
    const requestPermission = options.requestPermission || (() => Promise.resolve(false));
    
    let backupDir = path.join(this.backupDirectory, 'system', backupId);
    
    try {
      if (onProgress) {
        onProgress({ progress: 5, status: 'running', description: '检查备份条件' });
      }

      const checkResult = await this.checkBackupConditions(process.cwd(), { onProgress, requestPermission });
      if (!checkResult.success) {
        return checkResult;
      }
      
      if (checkResult.backupDirectory) {
        backupDir = path.join(checkResult.backupDirectory, 'system', backupId);
      }

      fs.mkdirSync(backupDir, { recursive: true });

      if (onProgress) {
        onProgress({ progress: 10, status: 'running', description: '初始化系统备份' });
      }

      const excludeDirs = ['node_modules', '.git', 'backups', 'logs', 'module_backups'];
      
      if (onProgress) {
        onProgress({ progress: 15, status: 'running', description: '扫描系统文件' });
      }
      
      const allFiles = this.getDirectoryFilesExclude(process.cwd(), excludeDirs);
      
      if (onProgress) {
        onProgress({ progress: 20, status: 'running', description: `发现 ${allFiles.length} 个文件` });
      }
      
      let copied = 0;
      const skippedFiles = [];
      await this.copyDirectoryExcludeSafe(process.cwd(), backupDir, excludeDirs, (filePath, skipped) => {
        if (skipped) {
          skippedFiles.push(filePath);
        } else {
          copied++;
        }
        if (onProgress && allFiles.length > 0) {
          const progress = Math.min(20 + Math.round((copied / allFiles.length) * 60), 80);
          onProgress({ 
            progress, 
            status: 'running', 
            description: `正在备份 ${copied}/${allFiles.length}${skippedFiles.length > 0 ? ` (跳过${skippedFiles.length})` : ''}`,
            currentFile: path.basename(filePath)
          });
        }
      });

      const filesToBackup = this.getDirectoryFiles(backupDir);

      if (filesToBackup.length === 0) {
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
        return { success: false, error: '没有可备份的文件' };
      }

      if (onProgress) {
        onProgress({ progress: 85, status: 'running', description: '保存备份记录' });
      }

      const dbResult = await this.executeWithRetry(
        'INSERT INTO self_update_history (id, update_type, target_version, current_version, update_source, update_content, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [backupId, 'system', pkg.version, pkg.version, 'system', JSON.stringify({ 
          type: 'full_system',
          filesToBackup,
          skippedFiles,
          timestamp
        }), 'applied']
      );

      if (!dbResult.success) {
        logger.error(`保存备份记录失败: ${dbResult.error}`);
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
        return { success: false, error: `保存备份记录失败: ${dbResult.error}` };
      }

      if (onProgress) {
        onProgress({ progress: 92, status: 'running', description: '清理旧备份' });
      }

      try {
        await this.cleanupOldBackups('system');
      } catch (cleanupError) {
        logger.warn(`清理旧备份失败: ${cleanupError.message}`);
      }

      if (onProgress) {
        onProgress({ progress: 100, status: 'success', description: '系统备份完成' });
      }

      const result = {
        success: true,
        backupId,
        backupType: 'system',
        timestamp,
        size: this.getDirectorySize(backupDir),
        filesCount: filesToBackup.length,
        skippedCount: skippedFiles.length,
        skippedFiles
      };

      if (skippedFiles.length > 0) {
        logger.warn(`系统备份完成，但跳过了 ${skippedFiles.length} 个文件: ${backupId}`);
      }
      logger.info(`创建系统全量备份成功: ${backupId} (${filesToBackup.length}个文件)`);

      return result;
    } catch (error) {
      logger.error('创建系统全量备份失败:', error);
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
      if (onProgress) {
        onProgress({ progress: 0, status: 'failed', description: '备份失败: ' + error.message });
      }
      return { success: false, error: error.message };
    }
  }

  async copyDirectoryExclude(src, dest, excludeDirs, onFileCopied) {
    fs.mkdirSync(dest, { recursive: true });
    
    const files = fs.readdirSync(src);
    
    for (const file of files) {
      if (excludeDirs.includes(file)) {
        continue;
      }
      
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      
      try {
        const stats = fs.statSync(srcPath);
        
        if (stats.isDirectory()) {
          await this.copyDirectoryExclude(srcPath, destPath, excludeDirs, onFileCopied);
        } else {
          fs.copyFileSync(srcPath, destPath);
          if (onFileCopied) {
            onFileCopied(srcPath, false);
          }
        }
      } catch (error) {
        logger.warn(`复制文件失败，跳过: ${srcPath} - ${error.message}`);
        if (onFileCopied) {
          onFileCopied(srcPath, true);
        }
      }
    }
  }

  async copyDirectoryExcludeSafe(src, dest, excludeDirs, onFileCopied) {
    try {
      fs.mkdirSync(dest, { recursive: true });
    } catch (error) {
      logger.error(`创建目录失败: ${dest} - ${error.message}`);
      return;
    }
    
    let files;
    try {
      files = fs.readdirSync(src);
    } catch (error) {
      logger.error(`读取目录失败: ${src} - ${error.message}`);
      return;
    }
    
    for (const file of files) {
      if (excludeDirs.includes(file)) {
        continue;
      }
      
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      
      try {
        const stats = fs.statSync(srcPath);
        
        if (stats.isDirectory()) {
          await this.copyDirectoryExcludeSafe(srcPath, destPath, excludeDirs, onFileCopied);
        } else {
          const copyResult = this.copyFileWithRetry(srcPath, destPath);
          if (copyResult.success) {
            if (onFileCopied) {
              onFileCopied(srcPath, false);
            }
          } else {
            if (onFileCopied) {
              onFileCopied(srcPath, true);
            }
          }
        }
      } catch (error) {
        logger.warn(`复制文件失败，跳过: ${srcPath} - ${error.message}`);
        if (onFileCopied) {
          onFileCopied(srcPath, true);
        }
      }
    }
  }
}

const rollbackManager = new RollbackManager();

module.exports = {
  RollbackManager,
  rollbackManager
};