const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { execute, query, queryOne } = require('../../utils/database');
const { generateUUID, bumpVersion, updateReadme } = require('../../utils/helpers');
const { confirmationGate } = require('./confirmationGate');
const { providerManager } = require('../llm/providers');
const { moduleRegistry } = require('../../utils/moduleRegistry');
const { eventBus } = require('../../utils/eventBus');
const { rollbackManager } = require('./rollback');

class SelfUpdateManager {
  constructor() {
    this.updateTypes = ['code', 'config', 'knowledge', 'dependency', 'plugin'];
    this.updateSources = ['ai_suggestion', 'manual', 'auto_check', 'remote'];
    this.maxConcurrentUpdates = 1;
    this.updateFrequency = {
      autoCheckInterval: 24 * 60 * 60 * 1000,
      maxRetries: 3,
      retryDelay: 5 * 60 * 1000
    };
    this.pendingUpdates = [];
    this.currentUpdate = null;

    this._setupEventListeners();
  }

  _setupEventListeners() {
    eventBus.on('module.registered', (data) => {
      logger.info(`模块注册成功: ${data.moduleId} v${data.version}`);
    });

    eventBus.on('module.unregistered', (data) => {
      logger.info(`模块卸载: ${data.moduleId}`);
    });

    eventBus.on('module.reload.success', (data) => {
      logger.info(`模块重载成功: ${data.moduleId} (第${data.reloadCount}次)`);
    });

    eventBus.on('module.reload.failed', (data) => {
      logger.error(`模块重载失败: ${data.moduleId} - ${data.error}`);
    });

    eventBus.on('module.restored', (data) => {
      logger.warn(`模块已恢复: ${data.moduleId} from ${data.backupVersion}`);
    });
  }

  async checkForUpdates(options = {}) {
    const updates = [];
    
    if (options.code) {
      updates.push(...await this.checkCodeUpdates());
    }
    if (options.config) {
      updates.push(...await this.checkConfigUpdates());
    }
    if (options.knowledge) {
      updates.push(...await this.checkKnowledgeUpdates());
    }
    if (options.dependency) {
      updates.push(...await this.checkDependencyUpdates());
    }

    return updates;
  }

  async checkCodeUpdates() {
    return [];
  }

  async checkConfigUpdates() {
    return [];
  }

  async checkKnowledgeUpdates() {
    return [];
  }

  async checkDependencyUpdates() {
    return [];
  }

  async createUpdate(updateType, content, options = {}) {
    const updateId = generateUUID();
    const pkg = require('../../../package.json');
    const currentVersion = pkg.version;

    const updateRecord = {
      id: updateId,
      updateType,
      targetVersion: options.targetVersion || currentVersion,
      currentVersion,
      updateSource: options.source || 'manual',
      updateContent: typeof content === 'string' ? content : JSON.stringify(content),
      status: 'pending',
      userConfirmed: false,
      sandboxResult: null,
      appliedAt: null,
      rollbackVersion: currentVersion,
      errorMessage: null,
      durationMs: null
    };

    await this.saveUpdateRecord(updateRecord);

    this.pendingUpdates.push(updateRecord);

    return {
      success: true,
      updateId,
      updateType,
      status: 'pending',
      description: options.description || `创建${updateType}更新`
    };
  }

  async executeUpdate(updateId, options = {}) {
    const startTime = Date.now();
    const { onProgress } = options;
    
    const steps = [
      { name: '加载更新记录', weight: 5 },
      { name: '创建备份', weight: 15 },
      { name: '确认备份完成', weight: 10 },
      { name: '应用更新', weight: 30 },
      { name: '确认应用更新', weight: 15 },
      { name: '验证更新', weight: 15 },
      { name: '完成', weight: 10 }
    ];
    
    const totalWeight = steps.reduce((sum, s) => sum + s.weight, 0);
    let currentWeight = 0;
    let backupCreated = false;

    const reportProgress = (stepIndex, description, details = {}, progress = null) => {
      currentWeight = steps.slice(0, stepIndex).reduce((sum, s) => sum + s.weight, 0);
      const calculatedProgress = progress !== null ? progress : Math.round((currentWeight / totalWeight) * 100);
      
      if (onProgress) {
        onProgress({
          step: stepIndex,
          totalSteps: steps.length,
          stepName: steps[stepIndex - 1]?.name || '',
          progress: calculatedProgress,
          description,
          details,
          status: 'running',
          elapsedMs: Date.now() - startTime
        });
      }
    };

    try {
      reportProgress(1, '加载更新记录');
      const updateRecord = await this.getUpdateRecord(updateId);
      if (!updateRecord) {
        if (onProgress) {
          onProgress({ progress: 0, description: '更新记录不存在', status: 'failed' });
        }
        return { success: false, error: '更新记录不存在' };
      }

      if (updateRecord.status === 'applied') {
        if (onProgress) {
          onProgress({ progress: 0, description: '更新已应用', status: 'error' });
        }
        return { success: false, error: '更新已应用' };
      }

      if (updateRecord.status === 'rolled_back') {
        if (onProgress) {
          onProgress({ progress: 0, description: '更新已回滚', status: 'error' });
        }
        return { success: false, error: '更新已回滚' };
      }

      const parsedContent = this._parseUpdateContent(updateRecord.update_content);
      const filesAffected = parsedContent.filePath ? [parsedContent.filePath] : [];
      
      if (onProgress) {
        onProgress({
          step: 0,
          description: '更新详情',
          details: {
            updateId: updateId,
            updateType: updateRecord.update_type,
            currentVersion: updateRecord.current_version,
            targetVersion: updateRecord.target_version,
            source: updateRecord.update_source,
            contentPreview: this._getContentPreview(updateRecord.update_content),
            filesAffected,
            rollbackPossible: true
          },
          status: 'info'
        });
      }

      if (!options.skipBackup) {
        reportProgress(2, '创建备份', { type: updateRecord.update_type });
        const backupResult = await rollbackManager.createBackup('update', process.cwd(), {
          version: updateRecord.current_version,
          description: `Update ${updateId} backup`
        });
        
        if (backupResult.success) {
          backupCreated = true;
          logger.info(`备份创建成功: ${backupResult.backupId}`);
        } else {
          logger.warn(`备份创建失败: ${backupResult.error}`);
        }
      }

      if (!options.skipConfirmation) {
        reportProgress(3, '确认备份完成', { backupCreated });
        
        if (onProgress) {
          onProgress({
            progress: null,
            description: '等待用户确认',
            status: 'confirming'
          });
        }
        
        const backupConfirmation = await confirmationGate.requestConfirmation({
          operationType: 'create_backup',
          description: `备份已创建${backupCreated ? '成功' : '失败'}，是否继续执行${updateRecord.update_type}更新？`,
          details: {
            updateId,
            updateType: updateRecord.update_type,
            backupCreated,
            currentVersion: updateRecord.current_version,
            targetVersion: updateRecord.target_version
          },
          stepName: '确认备份完成',
          stepNumber: 1,
          totalSteps: 3,
          riskLevel: backupCreated ? 'medium' : 'high',
          impact: backupCreated ? '低风险（可回滚）' : '高风险（无备份）',
          filesAffected,
          backupAvailable: backupCreated,
          rollbackPossible: backupCreated,
          skipPrompt: options.autoConfirm
        });

        if (!backupConfirmation.confirmed) {
          await this.updateUpdateRecord(updateId, {
            status: 'rejected',
            userConfirmed: 0,
            confirmedAt: Date.now(),
            rejectedStep: 'backup_confirmation'
          });
          if (onProgress) {
            onProgress({ 
              progress: Math.round((30 / totalWeight) * 100), 
              description: '用户拒绝确认备份', 
              status: 'cancelled' 
            });
          }
          return { success: false, error: '用户拒绝确认备份', rejectedStep: 'backup_confirmation' };
        }

        updateRecord.userConfirmed = 1;
        updateRecord.confirmedAt = Date.now();
      }

      if (!options.skipConfirmation) {
        reportProgress(4, '等待应用更新确认', { type: updateRecord.update_type });
        
        if (onProgress) {
          onProgress({
            progress: null,
            description: '等待用户确认',
            status: 'confirming'
          });
        }
        
        const applyConfirmation = await confirmationGate.requestConfirmation({
          operationType: updateRecord.update_type === 'code' ? 'update_code' : 
                        updateRecord.update_type === 'dependency' ? 'update_dependency' : 'update_config',
          description: `即将${updateRecord.update_type === 'code' ? '替换代码' : 
                        updateRecord.update_type === 'dependency' ? '更新依赖' : '更新配置'}，确认执行？`,
          details: {
            updateId,
            updateType: updateRecord.update_type,
            contentPreview: this._getContentPreview(updateRecord.update_content),
            filePath: parsedContent.filePath || 'N/A',
            currentVersion: updateRecord.current_version,
            targetVersion: updateRecord.target_version
          },
          stepName: '确认应用更新',
          stepNumber: 2,
          totalSteps: 3,
          riskLevel: updateRecord.update_type === 'code' || updateRecord.update_type === 'dependency' ? 'high' : 'medium',
          impact: updateRecord.update_type === 'code' ? '核心功能模块' : 
                  updateRecord.update_type === 'dependency' ? '依赖环境' : '配置参数',
          filesAffected,
          backupAvailable: backupCreated,
          rollbackPossible: backupCreated,
          skipPrompt: options.autoConfirm
        });

        if (!applyConfirmation.confirmed) {
          await this.updateUpdateRecord(updateId, {
            status: 'rejected',
            userConfirmed: 0,
            confirmedAt: Date.now(),
            rejectedStep: 'apply_confirmation'
          });
          if (onProgress) {
            onProgress({ 
              progress: Math.round((45 / totalWeight) * 100), 
              description: '用户拒绝确认应用更新', 
              status: 'cancelled' 
            });
          }
          return { success: false, error: '用户拒绝确认应用更新', rejectedStep: 'apply_confirmation' };
        }
      }

      reportProgress(5, '应用更新', { 
        type: updateRecord.update_type,
        content: this._getContentPreview(updateRecord.update_content),
        filePath: parsedContent.filePath || 'N/A'
      });

      const applyResult = await this.applyUpdate(updateRecord, options);
      
      reportProgress(6, '验证更新', { result: applyResult.success ? '成功' : '失败' });
      
      if (applyResult.success) {
        if (!options.skipConfirmation) {
          if (onProgress) {
            onProgress({
              progress: null,
              description: '等待用户确认',
              status: 'confirming'
            });
          }
          
          const verifyConfirmation = await confirmationGate.requestConfirmation({
            operationType: 'run_validation',
            description: `更新验证成功！是否确认完成${updateRecord.update_type}更新？`,
            details: {
              updateId,
              updateType: updateRecord.update_type,
              applyResult,
              currentVersion: updateRecord.current_version,
              targetVersion: updateRecord.target_version
            },
            stepName: '确认更新完成',
            stepNumber: 3,
            totalSteps: 3,
            riskLevel: 'medium',
            impact: '更新已完成，系统运行正常',
            filesAffected,
            backupAvailable: backupCreated,
            rollbackPossible: backupCreated,
            skipPrompt: options.autoConfirm
          });

          if (!verifyConfirmation.confirmed) {
            logger.warn('用户拒绝确认更新完成，执行回滚');
            
            reportProgress(6, '执行回滚', { type: updateRecord.update_type });
            await rollbackManager.rollbackUpdate(updateId);
            
            await this.updateUpdateRecord(updateId, {
              status: 'rolled_back',
              userConfirmed: 0,
              rollbackAt: Date.now(),
              rolledBackReason: 'user_rejected_after_success'
            });
            
            if (onProgress) {
              onProgress({ 
                progress: Math.round((85 / totalWeight) * 100), 
                description: '用户拒绝确认，已回滚', 
                status: 'rolled_back',
                elapsedMs: Date.now() - startTime
              });
            }
            return { success: false, error: '用户拒绝确认，已回滚', rolledBack: true };
          }
        }

        await this.updateUpdateRecord(updateId, {
          status: 'applied',
          appliedAt: Date.now(),
          durationMs: Date.now() - startTime,
          sandboxResult: null,
          userConfirmed: updateRecord.userConfirmed,
          confirmedAt: updateRecord.confirmedAt
        });

        const changelogItems = [
          `**${updateRecord.update_type === 'code' ? '代码更新' : updateRecord.update_type === 'config' ? '配置更新' : updateRecord.update_type === 'knowledge' ? '知识库更新' : '依赖更新'}**: ${updateRecord.update_source === 'ai_suggestion' ? 'AI生成的更新' : '手动更新'}`,
          `更新内容: ${this._getContentPreview(updateRecord.update_content)}`
        ];
        const versionResult = await this.bumpProjectVersion(changelogItems);
        logger.info(`更新应用成功: ${updateId}，版本迭代: ${versionResult.oldVersion} -> ${versionResult.newVersion}`);

        reportProgress(7, '更新完成', applyResult, 100);

        if (onProgress) {
          onProgress({ 
            progress: 100, 
            description: '更新完成', 
            details: { ...applyResult, versionBump: versionResult },
            status: 'success',
            elapsedMs: Date.now() - startTime
          });
        }

        return {
          success: true,
          updateId,
          updateType: updateRecord.update_type,
          status: 'applied',
          durationMs: Date.now() - startTime,
          details: applyResult,
          backupCreated,
          versionBump: versionResult
        };
      } else {
        await this.updateUpdateRecord(updateId, {
          status: 'failed',
          errorMessage: applyResult.error,
          durationMs: Date.now() - startTime
        });

        if (!options.skipRollback && backupCreated) {
          reportProgress(6, '执行回滚', { type: updateRecord.update_type });
          const rollbackResult = await rollbackManager.rollbackUpdate(updateId);
          
          if (rollbackResult.success) {
            logger.info(`更新失败，已回滚: ${updateId}`);
          } else {
            logger.error(`更新失败，回滚也失败: ${rollbackResult.error}`);
          }
        }

        if (onProgress) {
          onProgress({ 
            progress: Math.round((60 / totalWeight) * 100), 
            description: '更新失败', 
            details: { error: applyResult.error, rolledBack: !options.skipRollback && backupCreated },
            status: 'failed',
            elapsedMs: Date.now() - startTime
          });
        }

        return {
          success: false,
          updateId,
          error: applyResult.error,
          rolledBack: !options.skipRollback && backupCreated,
          backupCreated
        };
      }
    } catch (error) {
      logger.error('执行更新失败:', error);
      await this.updateUpdateRecord(updateId, {
        status: 'error',
        errorMessage: error.message,
        durationMs: Date.now() - startTime
      });

      if (backupCreated && !options.skipRollback) {
        await rollbackManager.rollbackUpdate(updateId);
      }

      if (onProgress) {
        onProgress({ 
          progress: 0, 
          description: '更新异常', 
          details: { error: error.message, rolledBack: backupCreated && !options.skipRollback },
          status: 'error',
          elapsedMs: Date.now() - startTime
        });
      }

      return { success: false, error: error.message, rolledBack: backupCreated && !options.skipRollback };
    }
  }

  _parseUpdateContent(content) {
    try {
      return JSON.parse(content);
    } catch {
      return { content };
    }
  }

  _getContentPreview(content) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.content) {
        const text = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content, null, 2);
        return text.length > 100 ? text.substring(0, 97) + '...' : text;
      }
      return JSON.stringify(parsed, null, 2).substring(0, 100) + '...';
    } catch {
      return content.length > 100 ? content.substring(0, 97) + '...' : content;
    }
  }

  async applyUpdate(updateRecord, options) {
    const content = updateRecord.update_content;

    switch (updateRecord.update_type) {
      case 'code':
        return await this.applyCodeUpdate(content, options);
      case 'config':
        return await this.applyConfigUpdate(content, options);
      case 'knowledge':
        return await this.applyKnowledgeUpdate(content, options);
      case 'dependency':
        return await this.applyDependencyUpdate(content, options);
      default:
        return { success: false, error: `未知更新类型: ${updateRecord.update_type}` };
    }
  }

  async applyCodeUpdate(content, options) {
    try {
      let updateData;
      try {
        updateData = JSON.parse(content);
      } catch {
        return { success: false, error: '更新内容格式错误' };
      }

      if (!updateData.filePath || !updateData.content) {
        return { success: false, error: '缺少必要字段' };
      }

      const filePath = path.resolve(updateData.filePath);
      
      if (!filePath.startsWith(process.cwd())) {
        return { success: false, error: '文件路径超出允许范围' };
      }

      const moduleId = path.basename(filePath, '.js');
      
      const result = await moduleRegistry.updateModule(moduleId, updateData.content, options);

      if (result.success) {
        return { success: true, filePath, moduleId, version: result.newVersion };
      } else {
        return { 
          success: false, 
          error: result.error,
          rolledBack: result.rolledBack
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async applyConfigUpdate(content, options) {
    try {
      let configData;
      try {
        configData = JSON.parse(content);
      } catch {
        return { success: false, error: '配置内容格式错误' };
      }

      for (const [key, value] of Object.entries(configData)) {
        await execute(
          'INSERT OR REPLACE INTO sys_config (config_key, config_value, config_type, description) VALUES (?, ?, ?, ?)',
          [key, JSON.stringify(value), 'string', '自动更新配置']
        );
      }

      return { success: true, keysUpdated: Object.keys(configData).length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async applyKnowledgeUpdate(content, options) {
    try {
      const { knowledgeBase } = require('../vector/knowledgeBase');
      let knowledgeData;
      
      try {
        knowledgeData = JSON.parse(content);
      } catch {
        return { success: false, error: '知识库内容格式错误' };
      }

      if (Array.isArray(knowledgeData)) {
        knowledgeData.forEach(item => {
          if (item.type === 'case' && item.originalCode && item.optimizedCode) {
            knowledgeBase.addCase(item.originalCode, item.optimizedCode, item.explanation || '', {
              language: item.language,
              issueType: item.issueType
            });
          } else if (item.content) {
            knowledgeBase.addEntry(item.content, {
              type: item.type || 'general',
              language: item.language,
              tags: item.tags
            });
          }
        });
      }

      return { success: true, entriesAdded: Array.isArray(knowledgeData) ? knowledgeData.length : 0 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async applyDependencyUpdate(content, options) {
    try {
      const pkg = require('../../../package.json');
      let dependencyData;
      
      try {
        dependencyData = JSON.parse(content);
      } catch {
        return { success: false, error: '依赖内容格式错误' };
      }

      for (const [name, version] of Object.entries(dependencyData)) {
        pkg.dependencies[name] = version;
      }

      fs.writeFileSync(path.join(__dirname, '../../../package.json'), JSON.stringify(pkg, null, 2));

      return { success: true, dependenciesUpdated: Object.keys(dependencyData).length };
    } catch (error) {
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

    await execute(
      'UPDATE self_update_history SET status = ?, rollback_at = ?, rolled_back_reason = ? WHERE id = ?',
      ['rolled_back', Date.now(), rolledBack ? 'user_request' : 'no_backup', updateId]
    );

    return { 
      success: rolledBack, 
      updateId, 
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

  async listUpdates(status = null, limit = 20) {
    try {
      let sql = 'SELECT * FROM self_update_history WHERE 1=1';
      const params = [];

      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const records = await query(sql, params);

      return records.map(record => ({
        id: record.id,
        updateType: record.update_type,
        targetVersion: record.target_version,
        currentVersion: record.current_version,
        updateSource: record.update_source,
        updateContent: record.update_content,
        status: record.status,
        userConfirmed: record.user_confirmed === 1,
        confirmedAt: record.confirmed_at,
        sandboxResult: record.sandbox_result ? JSON.parse(record.sandbox_result) : null,
        appliedAt: record.applied_at,
        rollbackVersion: record.rollback_version,
        rollbackAt: record.rollback_at,
        errorMessage: record.error_message,
        durationMs: record.duration_ms,
        createdAt: record.created_at,
        type: 'update'
      }));
    } catch (error) {
      logger.error('查询更新记录失败:', error);
      return [];
    }
  }

  async getUpdateRecord(updateId) {
    try {
      return await queryOne('SELECT * FROM self_update_history WHERE id = ?', [updateId]);
    } catch (error) {
      logger.error('查询更新记录失败:', error);
      return null;
    }
  }

  async saveUpdateRecord(record) {
    try {
      await execute(
        'INSERT INTO self_update_history (id, update_type, target_version, current_version, update_source, update_content, status, rollback_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [record.id, record.updateType, record.targetVersion, record.currentVersion, record.updateSource, record.updateContent, record.status, record.rollbackVersion]
      );
    } catch (error) {
      logger.error('保存更新记录失败:', error);
    }
  }

  async updateUpdateRecord(updateId, updates) {
    try {
      const snakeCaseFields = Object.keys(updates).map(key => {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        return `${snakeKey} = ?`;
      }).join(', ');
      const params = [...Object.values(updates), updateId];
      await execute(`UPDATE self_update_history SET ${snakeCaseFields} WHERE id = ?`, params);
    } catch (error) {
      logger.error('更新记录失败:', error);
    }
  }

  /**
   * 版本迭代：每次更新成功后自动递增版本号
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

  async updateFromAISuggestion(suggestion, options = {}) {
    const { onProgress, skipConfirmation, autoConfirm } = options;
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      return { success: false, error: '未配置LLM提供商' };
    }

    if (onProgress) {
      onProgress({ progress: 5, description: '分析更新需求', status: 'running' });
    }

    const prompt = `你是一个代码优化专家。用户请求更新智能体，请分析以下建议并生成具体的更新内容。

建议内容:
${suggestion}

请以JSON格式返回更新内容：
{
  "updateType": "code|config|knowledge|dependency",
  "description": "更新描述",
  "content": {
    "filePath": "要更新的文件路径（仅code类型）",
    "content": "更新后的代码内容（仅code类型）",
    // 或其他类型的内容
  }
}

注意：
1. 只返回JSON格式，不要包含其他文字
2. code类型的filePath必须是相对于项目根目录的路径
3. 确保代码内容完整且正确`;

    if (onProgress) {
      onProgress({ progress: 10, description: '调用AI生成更新方案', status: 'running' });
    }

    const chatTimeout = setTimeout(() => {
      const err = new Error('AI响应超时，请检查网络连接和API配置');
      err.code = 'TIMEOUT';
      throw err;
    }, 120000);

    let result;
    try {
      result = await provider.chat([{ role: 'user', content: prompt }], { temperature: 0.3 });
    } finally {
      clearTimeout(chatTimeout);
    }

    if (onProgress) {
      onProgress({ progress: 40, description: '解析AI响应', status: 'running' });
    }

    let updateData;
    try {
      let contentToParse = result.content;
      
      if (typeof contentToParse === 'string') {
        const jsonBlockMatch = contentToParse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch && jsonBlockMatch[1]) {
          contentToParse = jsonBlockMatch[1];
        } else {
          const jsonInlineMatch = contentToParse.match(/\{[\s\S]*\}/);
          if (jsonInlineMatch) {
            contentToParse = jsonInlineMatch[0];
          }
        }
      }
      
      updateData = typeof contentToParse === 'object' ? contentToParse : JSON.parse(contentToParse);
      
      if (!updateData.updateType || !updateData.content) {
        throw new Error('AI响应缺少必要字段(updateType或content)');
      }
    } catch (e) {
      logger.error('解析AI响应失败:', e.message);
      logger.error('AI原始响应:', result.content ? (result.content.substring(0, 500) + (result.content.length > 500 ? '...' : '')) : result);
      if (onProgress) {
        onProgress({ progress: 40, description: '解析AI响应失败', status: 'failed', details: { error: e.message } });
      }
      return { success: false, error: '解析AI响应失败: ' + e.message };
    }

    if (onProgress) {
      onProgress({ progress: 50, description: '创建更新记录', status: 'running' });
    }

    const createResult = await this.createUpdate(updateData.updateType, updateData.content, {
      source: 'ai_suggestion',
      description: updateData.description
    });

    if (!createResult.success) {
      return createResult;
    }

    if (onProgress) {
      onProgress({ progress: 55, description: '执行更新', status: 'running' });
    }

    return await this.executeUpdate(createResult.updateId, options);
  }
}

const selfUpdateManager = new SelfUpdateManager();

module.exports = {
  SelfUpdateManager,
  selfUpdateManager
};