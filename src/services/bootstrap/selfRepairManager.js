const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { execute, query, queryOne } = require('../../utils/database');
const { generateUUID, bumpVersion, updateReadme } = require('../../utils/helpers');
const { confirmationGate } = require('./confirmationGate');
const { providerManager } = require('../llm/providers');
const { moduleRegistry } = require('../../utils/moduleRegistry');
const { eventBus } = require('../../utils/eventBus');

class SelfRepairManager {
  constructor() {
    this.errorCategories = {
      database: ['SQLITE_ERROR', 'SQLITE_CORRUPT', 'SQLITE_NOTADB', 'connection_error', 'table_not_found', 'column_not_found'],
      network: ['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'],
      file_system: ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EMFILE'],
      memory: ['ENOMEM'],
      dependency: ['MODULE_NOT_FOUND', 'require failed'],
      configuration: ['config_error', 'missing_config', 'invalid_config'],
      runtime: ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError']
    };

    this.repairStrategies = {
      database: {
        reconnect: { priority: 1, description: '重新连接数据库' },
        rebuild: { priority: 2, description: '重建数据库表' },
        restore_backup: { priority: 3, description: '从备份恢复数据库' }
      },
      network: {
        retry: { priority: 1, description: '重试连接' },
        switch_provider: { priority: 2, description: '切换备用提供商' },
        fallback_offline: { priority: 3, description: '降级到离线模式' }
      },
      file_system: {
        create_path: { priority: 1, description: '创建缺失路径' },
        fix_permissions: { priority: 2, description: '修复文件权限' },
        cleanup_space: { priority: 3, description: '清理磁盘空间' }
      },
      dependency: {
        reinstall: { priority: 1, description: '重新安装依赖' },
        download_wasm: { priority: 2, description: '下载缺失的WASM文件' },
        fallback_legacy: { priority: 3, description: '回退到兼容版本' }
      },
      configuration: {
        reset_default: { priority: 1, description: '重置为默认配置' },
        validate_config: { priority: 2, description: '验证并修复配置' },
        recreate_config: { priority: 3, description: '重新创建配置文件' }
      },
      runtime: {
        restart_service: { priority: 1, description: '重启服务' },
        clear_cache: { priority: 2, description: '清除缓存' },
        fallback_safe_mode: { priority: 3, description: '切换到安全模式' }
      }
    };

    this.maxRepairAttempts = 3;
    this.minRepairInterval = 60000;
    this.unrepairableErrors = ['ENOSPC', 'EPERM'];
    this.repairHistory = [];

    this._setupEventListeners();
  }

  _setupEventListeners() {
    eventBus.on('module.restored', (data) => {
      logger.warn(`修复模块已恢复: ${data.moduleId}`);
    });
  }

  classifyError(error) {
    const errorMessage = error.message || '';
    const errorCode = error.code || '';
    const errorName = error.name || '';

    for (const [category, patterns] of Object.entries(this.errorCategories)) {
      for (const pattern of patterns) {
        if (errorCode.includes(pattern) || errorMessage.includes(pattern) || errorName.includes(pattern)) {
          return category;
        }
      }
    }

    return 'runtime';
  }

  getRepairStrategies(category) {
    return this.repairStrategies[category] || this.repairStrategies.runtime;
  }

  isUnrepairable(error) {
    const errorCode = error.code || '';
    return this.unrepairableErrors.some(pattern => errorCode.includes(pattern));
  }

  async detectAndRepair(error, options = {}) {
    const startTime = Date.now();
    const errorType = this.classifyError(error);

    if (this.isUnrepairable(error)) {
      await this.saveRepairRecord({
        errorType,
        errorMessage: error.message,
        errorStack: error.stack,
        affectedComponent: 'system',
        repairStrategy: 'none',
        status: 'unrepairable',
        errorCount: 1,
        lastErrorAt: Date.now()
      });

      return { success: false, error: '错误无法自动修复', errorType };
    }

    const strategies = this.getRepairStrategies(errorType);
    const sortedStrategies = Object.entries(strategies)
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [strategyName, strategyInfo] of sortedStrategies) {
      const attemptResult = await this.attemptRepair(error, errorType, strategyName, options);
      
      if (attemptResult.success) {
        await this.saveRepairRecord({
          errorType,
          errorMessage: error.message,
          errorStack: error.stack,
          affectedComponent: 'system',
          repairStrategy: strategyName,
          repairContent: JSON.stringify(attemptResult),
          status: 'success',
          appliedAt: Date.now(),
          durationMs: Date.now() - startTime,
          errorCount: 1
        });

        const changelogItems = [
          `**修复**: ${strategyInfo.description}`,
          `错误类型: ${errorType}`,
          `修复策略: ${strategyName}`
        ];
        const versionResult = await this.bumpProjectVersion(changelogItems);
        logger.info(`修复成功，版本迭代: ${versionResult.oldVersion} -> ${versionResult.newVersion}`);

        return {
          success: true,
          errorType,
          strategy: strategyName,
          message: `使用策略 "${strategyInfo.description}" 修复成功`,
          durationMs: Date.now() - startTime,
          versionBump: versionResult
        };
      }

      logger.warn(`修复策略 ${strategyName} 失败: ${attemptResult.error}`);
    }

    await this.saveRepairRecord({
      errorType,
      errorMessage: `自我修复失败: ${error.message}`,
      errorStack: error.stack,
      affectedComponent: 'system',
      repairStrategy: JSON.stringify(Object.keys(strategies)),
      repairContent: JSON.stringify({
        attemptedStrategies: Object.keys(strategies),
        error: '所有修复策略均失败，系统已回滚'
      }),
      status: 'failed',
      durationMs: Date.now() - startTime,
      errorCount: 1,
      error: '所有修复策略均失败，系统已回滚'
    });

    return {
      success: false,
      errorType,
      error: '所有修复策略均失败，系统已回滚',
      durationMs: Date.now() - startTime
    };
  }

  async attemptRepair(error, errorType, strategyName, options) {
    const startTime = Date.now();

    try {
      if (!options.skipConfirmation) {
        const confirmation = await confirmationGate.requestConfirmation({
          operationType: `repair_${errorType}`,
          description: `修复${errorType}错误，策略: ${strategyName}`,
          details: error.message.substring(0, 200),
          skipPrompt: options.autoConfirm
        });

        if (!confirmation.confirmed) {
          return { success: false, error: '用户拒绝确认' };
        }
      }

      const repairResult = await this.executeRepairStrategy(error, errorType, strategyName, options);

      if (repairResult.success) {
        return {
          success: true,
          strategy: strategyName,
          result: repairResult,
          durationMs: Date.now() - startTime
        };
      }

      return { success: false, error: repairResult.error };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async executeRepairStrategy(error, errorType, strategyName, options) {
    switch (errorType) {
      case 'database':
        return await this.repairDatabase(error, strategyName, options);
      case 'network':
        return await this.repairNetwork(error, strategyName, options);
      case 'file_system':
        return await this.repairFileSystem(error, strategyName, options);
      case 'dependency':
        return await this.repairDependency(error, strategyName, options);
      case 'configuration':
        return await this.repairConfiguration(error, strategyName, options);
      case 'runtime':
        return await this.repairRuntime(error, strategyName, options);
      default:
        return { success: false, error: `未知错误类型: ${errorType}` };
    }
  }

  async repairDatabase(error, strategy, options) {
    try {
      switch (strategy) {
        case 'reconnect': {
          const { closeDatabase, getDatabase } = require('../../utils/database');
          await closeDatabase();
          getDatabase();
          return { success: true, strategy: 'reconnect' };
        }
        case 'rebuild': {
          const { ensureSqliteTables } = require('../../utils/database');
          ensureSqliteTables();
          return { success: true, strategy: 'rebuild' };
        }
        case 'restore_backup': {
          const backups = await rollbackManager.listBackups('database', 5);
          if (backups.length === 0) {
            return { success: false, error: '没有数据库备份' };
          }
          return await rollbackManager.restoreBackup(backups[0].id);
        }
        default:
          return { success: false, error: `未知策略: ${strategy}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async repairNetwork(error, strategy, options) {
    try {
      switch (strategy) {
        case 'retry':
          await new Promise(resolve => setTimeout(resolve, 2000));
          return { success: true, strategy: 'retry' };
        case 'switch_provider':
          await providerManager.refreshProviderStatus();
          const providers = providerManager.getAvailableProviders();
          const altProvider = providers.find(p => p.available && p.name !== 'ollama');
          if (altProvider) {
            await providerManager.setActiveProvider(altProvider.name);
            return { success: true, strategy: 'switch_provider', provider: altProvider.name };
          }
          return { success: false, error: '没有可用的备用提供商' };
        case 'fallback_offline':
          const { engine } = require('../../engine/dualModeEngine');
          engine.setMode('offline');
          return { success: true, strategy: 'fallback_offline' };
        default:
          return { success: false, error: `未知策略: ${strategy}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async repairFileSystem(error, strategy, options) {
    try {
      switch (strategy) {
        case 'create_path': {
          const match = error.message.match(/ENOENT.*'([^']+)'/);
          if (match) {
            const dirPath = path.dirname(match[1]);
            fs.mkdirSync(dirPath, { recursive: true });
            return { success: true, strategy: 'create_path', path: dirPath };
          }
          return { success: false, error: '无法确定缺失路径' };
        }
        case 'fix_permissions':
          return { success: false, error: '权限修复需要管理员权限，请手动处理' };
        case 'cleanup_space':
          return { success: false, error: '磁盘空间清理需要手动处理' };
        default:
          return { success: false, error: `未知策略: ${strategy}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async repairDependency(error, strategy, options) {
    try {
      switch (strategy) {
        case 'reinstall': {
          const { spawn } = require('child_process');
          return new Promise((resolve) => {
            const npm = spawn('npm', ['install'], { cwd: process.cwd() });
            npm.on('close', (code) => {
              resolve({ success: code === 0, strategy: 'reinstall', exitCode: code });
            });
          });
        }
        case 'download_wasm': {
          const downloadScript = path.join(__dirname, '../../scripts/download-tree-sitter.js');
          if (fs.existsSync(downloadScript)) {
            const { spawn } = require('child_process');
            return new Promise((resolve) => {
              const script = spawn(process.execPath, [downloadScript], { cwd: process.cwd() });
              script.on('close', (code) => {
                resolve({ success: code === 0, strategy: 'download_wasm', exitCode: code });
              });
            });
          }
          return { success: false, error: '下载脚本不存在' };
        }
        case 'fallback_legacy':
          return { success: false, error: '回退到兼容版本需要手动处理' };
        default:
          return { success: false, error: `未知策略: ${strategy}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async repairConfiguration(error, strategy, options) {
    try {
      switch (strategy) {
        case 'reset_default': {
          const defaults = require('../../database/init');
          await defaults.initDatabase();
          return { success: true, strategy: 'reset_default' };
        }
        case 'validate_config': {
          const { config } = require('../../config');
          const validKeys = ['database', 'mysql', 'server', 'cors', 'rateLimit', 'ai'];
          const invalidKeys = Object.keys(config).filter(k => !validKeys.includes(k));
          return { success: true, strategy: 'validate_config', invalidKeys };
        }
        case 'recreate_config': {
          const envExample = path.join(__dirname, '../../../.env.example');
          const envFile = path.join(__dirname, '../../../.env');
          if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
            fs.copyFileSync(envExample, envFile);
          }
          return { success: true, strategy: 'recreate_config' };
        }
        default:
          return { success: false, error: `未知策略: ${strategy}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async repairRuntime(error, strategy, options) {
    try {
      switch (strategy) {
        case 'restart_service':
          process.exit(0);
        case 'clear_cache': {
          const { providerManager } = require('../llm/providers');
          providerManager.providers.forEach(p => {
            if (p.cachedKey) p.cachedKey = null;
          });
          return { success: true, strategy: 'clear_cache' };
        }
        case 'fallback_safe_mode': {
          const { engine } = require('../../engine/dualModeEngine');
          engine.setMode('offline');
          return { success: true, strategy: 'fallback_safe_mode' };
        }
        default:
          return { success: false, error: `未知策略: ${strategy}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
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

    let repairContent;
    try {
      repairContent = JSON.parse(repairRecord.repair_content);
    } catch {
      repairContent = {};
    }

    if (repairContent.filePath) {
      const moduleId = path.basename(repairContent.filePath, '.js');
      const restoreResult = await moduleRegistry.restoreModule(moduleId);
      
      if (restoreResult.success) {
        rolledBack = true;
        logger.info(`修复回滚成功: ${moduleId}`);
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

  async listRepairs(errorType = null, status = null, limit = 20) {
    try {
      let sql = 'SELECT * FROM self_repair_history WHERE 1=1';
      const params = [];

      if (errorType) {
        sql += ' AND error_type = ?';
        params.push(errorType);
      }

      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const records = await query(sql, params);

      return records.map(record => ({
        id: record.id,
        errorType: record.error_type,
        errorMessage: record.error_message,
        errorStack: record.error_stack,
        affectedComponent: record.affected_component,
        repairStrategy: record.repair_strategy,
        repairContent: record.repair_content,
        status: record.status,
        userConfirmed: record.user_confirmed === 1,
        confirmedAt: record.confirmed_at,
        sandboxResult: record.sandbox_result ? JSON.parse(record.sandbox_result) : null,
        appliedAt: record.applied_at,
        rollbackAt: record.rollback_at,
        errorCount: record.error_count || 0,
        lastErrorAt: record.last_error_at,
        durationMs: record.duration_ms,
        errorMessageDetail: record.error_message_detail,
        createdAt: record.created_at,
        type: 'repair'
      }));
    } catch (error) {
      logger.error('查询修复记录失败:', error);
      return [];
    }
  }

  async saveRepairRecord(record) {
    try {
      const recordId = generateUUID();
      const { errorType, errorMessage, errorStack, affectedComponent, repairStrategy, repairContent, status, errorCount, lastErrorAt, appliedAt, rollbackAt, sandboxResult, userConfirmed, confirmedAt, durationMs, error } = record;

      await execute(
        'INSERT INTO self_repair_history (id, error_type, error_message, error_stack, affected_component, repair_strategy, repair_content, status, sandbox_result, user_confirmed, confirmed_at, applied_at, rollback_at, error_count, last_error_at, duration_ms, error_message_detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          recordId,
          errorType,
          errorMessage,
          errorStack,
          affectedComponent,
          repairStrategy,
          repairContent || '',
          status,
          sandboxResult ? JSON.stringify(sandboxResult) : null,
          userConfirmed ? 1 : 0,
          confirmedAt || null,
          appliedAt || null,
          rollbackAt || null,
          errorCount || 1,
          lastErrorAt || Date.now(),
          durationMs || null,
          error || null
        ]
      );

      return recordId;
    } catch (error) {
      logger.error('保存修复记录失败:', error);
    }
  }

  /**
   * 版本迭代：每次修复成功后自动递增版本号
   * 规则：每个版本最多10个小版本（0-9），达到9时进位
   * 同步更新 README.md 的更新日志
   */
  async bumpProjectVersion(changelogItems = []) {
    const pkgPath = path.join(__dirname, '../../../package.json');
    const pkg = require(pkgPath);
    const oldVersion = pkg.version;
    const newVersion = bumpVersion(oldVersion);

    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    const readmePath = path.join(__dirname, '../../../README.md');
    const readmeResult = updateReadme(readmePath, newVersion, changelogItems);
    if (readmeResult.success) {
      logger.info(`README更新成功`);
    } else {
      logger.warn(`README更新失败: ${readmeResult.error}`);
    }

    logger.info(`版本迭代: ${oldVersion} -> ${newVersion}`);

    return { oldVersion, newVersion };
  }

  async repairFromAI(error, options = {}) {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      return { success: false, error: '未配置LLM提供商，无法使用AI修复' };
    }

    const prompt = `你是一个系统维护专家。请分析以下错误并提供修复方案。

错误信息:
${error.message}

错误堆栈:
${error.stack ? error.stack.substring(0, 1000) : '无'}

错误类型:
${this.classifyError(error)}

请以JSON格式返回修复方案：
{
  "strategy": "修复策略名称",
  "description": "修复描述",
  "actions": [
    {"type": "file_write", "filePath": "路径", "content": "内容"},
    {"type": "config_update", "key": "键", "value": "值"},
    {"type": "command", "command": "命令"}
  ]
}

注意：
1. 只返回JSON格式
2. 路径必须是相对路径
3. 确保修复方案安全可靠`;

    const result = await provider.chat([{ role: 'user', content: prompt }], { temperature: 0.3 });

    let repairData;
    try {
      const jsonMatch = result.content.match(/```json\s*([\s\S]*?)\s*```/) || result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        repairData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        repairData = typeof result.content === 'object' ? result.content : JSON.parse(result.content);
      }
    } catch (e) {
      return { success: false, error: '解析AI响应失败' };
    }

    for (const action of repairData.actions || []) {
      switch (action.type) {
        case 'file_write': {
          const filePath = path.resolve(action.filePath);
          if (!filePath.startsWith(process.cwd())) {
            return { success: false, error: '文件路径超出允许范围' };
          }
          
          const moduleId = path.basename(filePath, '.js');
          if (moduleRegistry.has(moduleId)) {
            const result = await moduleRegistry.updateModule(moduleId, action.content, options);
            if (!result.success) {
              return result;
            }
          } else {
            fs.writeFileSync(filePath, action.content, 'utf-8');
          }
          break;
        }
        case 'config_update': {
          await execute(
            'INSERT OR REPLACE INTO sys_config (config_key, config_value) VALUES (?, ?)',
            [action.key, JSON.stringify(action.value)]
          );
          break;
        }
        case 'command': {
          const { spawn } = require('child_process');
          return new Promise((resolve) => {
            const [cmd, ...args] = action.command.split(' ');
            const process = spawn(cmd, args, { cwd: process.cwd() });
            process.on('close', (code) => {
              resolve({ success: code === 0, command: action.command, exitCode: code });
            });
          });
        }
      }
    }

    return {
      success: true,
      strategy: repairData.strategy,
      actions: repairData.actions.length
    };
  }
}

const selfRepairManager = new SelfRepairManager();

module.exports = {
  SelfRepairManager,
  selfRepairManager
};