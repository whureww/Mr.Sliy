const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { eventBus } = require('./eventBus');
const { generateUUID } = require('./helpers');

class ModuleRegistry {
  constructor() {
    this.modules = new Map();
    this.backupDir = path.join(process.cwd(), 'backups', 'modules');
    this._ensureBackupDir();
  }

  _ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  async register(moduleId, modulePath, options = {}) {
    const normalizedPath = path.resolve(modulePath);
    
    if (!fs.existsSync(normalizedPath)) {
      return { success: false, error: `模块文件不存在: ${modulePath}` };
    }

    try {
      const moduleInfo = await this._loadModule(moduleId, normalizedPath, options);
      this.modules.set(moduleId, moduleInfo);
      
      eventBus.emit('module.registered', {
        moduleId,
        path: normalizedPath,
        version: moduleInfo.version
      });

      return { success: true, module: moduleInfo };
    } catch (error) {
      logger.error(`注册模块失败 ${moduleId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async _loadModule(moduleId, modulePath, options) {
    const stats = fs.statSync(modulePath);
    const version = stats.mtime.getTime().toString();
    
    delete require.cache[require.resolve(modulePath)];
    
    const loadedModule = require(modulePath);
    
    return {
      id: moduleId,
      path: modulePath,
      version,
      loadedAt: Date.now(),
      exports: loadedModule,
      status: 'loaded',
      options,
      reloadCount: 0
    };
  }

  get(moduleId) {
    return this.modules.get(moduleId);
  }

  getAll() {
    return Array.from(this.modules.values());
  }

  has(moduleId) {
    return this.modules.has(moduleId);
  }

  async unregister(moduleId) {
    const moduleInfo = this.modules.get(moduleId);
    if (!moduleInfo) {
      return { success: false, error: `模块不存在: ${moduleId}` };
    }

    try {
      if (moduleInfo.exports && typeof moduleInfo.exports.destroy === 'function') {
        await moduleInfo.exports.destroy();
      }

      this.modules.delete(moduleId);
      
      eventBus.emit('module.unregistered', { moduleId });
      
      return { success: true };
    } catch (error) {
      logger.error(`卸载模块失败 ${moduleId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async reload(moduleId, newPath = null) {
    const moduleInfo = this.modules.get(moduleId);
    if (!moduleInfo) {
      return { success: false, error: `模块不存在: ${moduleId}` };
    }

    const targetPath = newPath || moduleInfo.path;
    
    if (!fs.existsSync(targetPath)) {
      return { success: false, error: `模块文件不存在: ${targetPath}` };
    }

    eventBus.emit('module.reload.start', { moduleId, path: targetPath });

    try {
      await this._backupModule(moduleInfo);

      if (moduleInfo.exports && typeof moduleInfo.exports.destroy === 'function') {
        await moduleInfo.exports.destroy();
      }

      delete require.cache[require.resolve(moduleInfo.path)];

      const stats = fs.statSync(targetPath);
      const newVersion = stats.mtime.getTime().toString();
      
      const newExports = require(targetPath);

      const updatedInfo = {
        ...moduleInfo,
        path: targetPath,
        version: newVersion,
        loadedAt: Date.now(),
        exports: newExports,
        status: 'loaded',
        reloadCount: moduleInfo.reloadCount + 1
      };

      this.modules.set(moduleId, updatedInfo);

      eventBus.emit('module.reload.success', {
        moduleId,
        version: newVersion,
        reloadCount: updatedInfo.reloadCount
      });

      return {
        success: true,
        module: updatedInfo,
        oldVersion: moduleInfo.version,
        newVersion
      };
    } catch (error) {
      logger.error(`重载模块失败 ${moduleId}:`, error);
      
      await this._restoreFromBackup(moduleInfo);

      eventBus.emit('module.reload.failed', {
        moduleId,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  async _backupModule(moduleInfo) {
    const timestamp = Date.now();
    const moduleBackupDir = path.join(this.backupDir, moduleInfo.id);
    
    if (!fs.existsSync(moduleBackupDir)) {
      fs.mkdirSync(moduleBackupDir, { recursive: true });
    }

    const backupPath = path.join(moduleBackupDir, `${timestamp}_${moduleInfo.version}`);
    
    fs.mkdirSync(backupPath, { recursive: true });

    const fileName = path.basename(moduleInfo.path);
    const destPath = path.join(backupPath, fileName);
    
    fs.copyFileSync(moduleInfo.path, destPath);

    return {
      backupPath,
      timestamp,
      version: moduleInfo.version
    };
  }

  async _restoreFromBackup(moduleInfo) {
    const moduleBackupDir = path.join(this.backupDir, moduleInfo.id);
    
    if (!fs.existsSync(moduleBackupDir)) {
      return { success: false, error: '没有找到备份' };
    }

    const backups = fs.readdirSync(moduleBackupDir).sort().reverse();
    
    if (backups.length === 0) {
      return { success: false, error: '没有可用的备份' };
    }

    const latestBackup = backups[0];
    const backupPath = path.join(moduleBackupDir, latestBackup);
    
    const files = fs.readdirSync(backupPath);
    if (files.length === 0) {
      return { success: false, error: '备份目录为空' };
    }

    const fileName = files[0];
    const sourcePath = path.join(backupPath, fileName);
    
    fs.copyFileSync(sourcePath, moduleInfo.path);

    delete require.cache[require.resolve(moduleInfo.path)];
    
    const restoredExports = require(moduleInfo.path);
    
    this.modules.set(moduleInfo.id, {
      ...moduleInfo,
      exports: restoredExports,
      status: 'restored'
    });

    eventBus.emit('module.restored', {
      moduleId: moduleInfo.id,
      backupVersion: latestBackup
    });

    return { success: true, backupVersion: latestBackup };
  }

  async restoreModule(moduleId) {
    const moduleInfo = this.modules.get(moduleId);
    
    if (!moduleInfo) {
      return { success: false, error: `模块 ${moduleId} 未注册` };
    }

    return await this._restoreFromBackup(moduleInfo);
  }

  listBackups(moduleId = null) {
    if (moduleId) {
      const moduleBackupDir = path.join(this.backupDir, moduleId);
      if (!fs.existsSync(moduleBackupDir)) {
        return [];
      }
      return fs.readdirSync(moduleBackupDir).map(name => {
        const [timestamp, version] = name.split('_');
        return {
          timestamp: parseInt(timestamp),
          version,
          path: path.join(moduleBackupDir, name),
          date: new Date(parseInt(timestamp)).toLocaleString()
        };
      }).sort((a, b) => b.timestamp - a.timestamp);
    }

    const result = [];
    if (!fs.existsSync(this.backupDir)) {
      return result;
    }

    const moduleDirs = fs.readdirSync(this.backupDir);
    for (const dir of moduleDirs) {
      const backups = this.listBackups(dir);
      if (backups.length > 0) {
        result.push({
          moduleId: dir,
          backups
        });
      }
    }

    return result;
  }

  getModuleStatus() {
    const result = {};
    for (const [id, info] of this.modules) {
      result[id] = {
        status: info.status,
        version: info.version,
        loadedAt: new Date(info.loadedAt).toLocaleString(),
        reloadCount: info.reloadCount
      };
    }
    return result;
  }

  async updateModule(moduleId, newContent, options = {}) {
    const moduleInfo = this.modules.get(moduleId);
    if (!moduleInfo) {
      return { success: false, error: `模块不存在: ${moduleId}` };
    }

    eventBus.emit('module.update.start', { moduleId });

    try {
      await this._backupModule(moduleInfo);

      fs.writeFileSync(moduleInfo.path, newContent, 'utf-8');

      return await this.reload(moduleId);
    } catch (error) {
      logger.error(`更新模块失败 ${moduleId}:`, error);
      
      await this._restoreFromBackup(moduleInfo);

      eventBus.emit('module.update.failed', {
        moduleId,
        error: error.message
      });

      return { success: false, error: error.message, rolledBack: true };
    }
  }
}

const moduleRegistry = new ModuleRegistry();

module.exports = {
  ModuleRegistry,
  moduleRegistry
};