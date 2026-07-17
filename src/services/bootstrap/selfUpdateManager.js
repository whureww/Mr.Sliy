const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { execute, query, queryOne } = require('../../utils/database');
const { generateUUID, bumpVersion, updateReadme } = require('../../utils/helpers');
const { confirmationGate } = require('./confirmationGate');
const { providerManager } = require('../llm/providers');
const { moduleRegistry } = require('../../utils/moduleRegistry');
const { eventBus, SYSTEM_EVENTS } = require('../../utils/eventBus');
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

    eventBus.on(SYSTEM_EVENTS.SYSTEM_WARNING, async (warning) => {
      logger.warn(`收到系统警告事件: ${warning.message}`);
      await this.handleSystemWarning(warning);
    });

    eventBus.on(SYSTEM_EVENTS.SYSTEM_HEALTH_STATUS, async (status) => {
      await this.handleHealthStatus(status);
    });
  }

  async handleSystemWarning(warning) {
    try {
      if (warning.type === 'knowledge_base_low_hit_rate') {
        logger.info('知识库命中率偏低，建议扩充知识库');
        await this.suggestKnowledgeUpdate();
      } else if (warning.type === 'provider_failure') {
        logger.info('提供商调用失败，建议检查配置或切换提供商');
      } else if (warning.type === 'performance_degradation') {
        logger.info('系统性能下降，建议检查资源使用情况');
      }
    } catch (error) {
      logger.error(`处理系统警告时发生异常: ${error.message}`);
    }
  }

  async suggestKnowledgeUpdate() {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      logger.warn('未配置LLM提供商，无法生成知识库扩充建议');
      return;
    }

    try {
      const result = await this.updateFromAISuggestion(
        '检测到知识库命中率偏低，请分析现有知识库并提供扩充建议',
        { autoConfirm: false }
      );
      if (result.success) {
        logger.info('知识库扩充建议已生成');
      }
    } catch (error) {
      logger.error(`生成知识库扩充建议失败: ${error.message}`);
    }
  }

  async handleHealthStatus(status) {
    logger.debug(`系统健康状态更新: ${JSON.stringify(status)}`);
    if (status.overallStatus === 'degraded') {
      logger.warn(`系统健康状态降级: ${status.issues.join(', ')}`);
    }
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
        
        if (onProgress) {
          onProgress({ progress: 15, status: 'running', description: '创建备份' });
        }
        
        const backupResult = await rollbackManager.createBackup('update', process.cwd(), {
          version: updateRecord.current_version,
          description: `Update ${updateId} backup`,
          onProgress: (p) => {
            if (onProgress) {
              onProgress({ ...p });
            }
          },
          requestPermission: async (permissionRequest) => {
            if (onProgress) {
              onProgress({ 
                progress: null, 
                status: 'confirming', 
                description: permissionRequest.title,
                details: permissionRequest
              });
            }
            return { granted: false };
          }
        });
        
        if (backupResult.success) {
          backupCreated = true;
          logger.info(`备份创建成功: ${backupResult.backupId}`);
        } else {
          logger.warn(`备份创建失败: ${backupResult.error}`);
          if (onProgress) {
            onProgress({ 
              progress: 15, 
              status: 'warning', 
              description: `备份创建失败: ${backupResult.error}`,
              backupFailed: true
            });
          }
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

        reportProgress(7, '更新完成', applyResult, 100);

        const successResult = {
          success: true,
          updateId,
          updateType: updateRecord.update_type,
          status: 'applied',
          durationMs: Date.now() - startTime,
          details: applyResult,
          backupCreated,
          versionBump: null
        };

        if (onProgress) {
          onProgress({ 
            progress: 100, 
            description: '更新完成', 
            details: { ...applyResult },
            status: 'success',
            elapsedMs: Date.now() - startTime
          });
        }

        this.performVersionBump(updateId, updateRecord, applyResult).catch(error => {
          logger.error(`版本迭代失败: ${error.message}`);
        });

        return successResult;
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
      
      if (moduleRegistry.has(moduleId)) {
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
      } else {
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          fs.writeFileSync(filePath, updateData.content, 'utf-8');
          
          logger.info(`文件更新成功: ${filePath}`);
          
          return { success: true, filePath, moduleId };
        } catch (error) {
          logger.error(`文件写入失败: ${filePath}`, error);
          return { success: false, error: error.message };
        }
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

      let entriesAdded = 0;

      if (Array.isArray(knowledgeData)) {
        for (const item of knowledgeData) {
          if (item.type === 'case' && item.originalCode && item.optimizedCode) {
            await knowledgeBase.addCase(item.originalCode, item.optimizedCode, item.explanation || '', {
              language: item.language,
              issueType: item.issueType
            });
            entriesAdded++;
          } else if (item.content) {
            await knowledgeBase.addEntry(item.content, {
              type: item.type || 'general',
              language: item.language,
              tags: item.tags
            });
            entriesAdded++;
          }
        }
      } else if (typeof knowledgeData === 'object' && knowledgeData.action) {
        switch (knowledgeData.action) {
          case 'expand':
            entriesAdded = await this._expandKnowledgeBase(knowledgeData, knowledgeBase);
            break;
          case 'import':
            if (knowledgeData.filePath) {
              const result = await knowledgeBase.importFromFile(knowledgeData.filePath, { merge: true });
              entriesAdded = result.importedEntries + result.importedCases;
            }
            break;
          case 'add':
            if (knowledgeData.entry) {
              await knowledgeBase.addEntry(knowledgeData.entry, {
                type: knowledgeData.type || 'general',
                language: knowledgeData.language,
                tags: knowledgeData.tags
              });
              entriesAdded = 1;
            }
            break;
          case 'addCase':
            if (knowledgeData.originalCode && knowledgeData.optimizedCode) {
              await knowledgeBase.addCase(knowledgeData.originalCode, knowledgeData.optimizedCode, knowledgeData.explanation || '', {
                language: knowledgeData.language,
                issueType: knowledgeData.issueType
              });
              entriesAdded = 1;
            }
            break;
          default:
            return { success: false, error: `未知的知识库操作: ${knowledgeData.action}` };
        }
      }

      const stats = await knowledgeBase.getStats();
      return { success: true, entriesAdded, totalEntries: stats.totalEntries, totalCases: stats.totalCases };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _expandKnowledgeBase(knowledgeData, knowledgeBase) {
    const topics = knowledgeData.topics || ['代码优化', '代码分析', '代码检测', '编程最佳实践'];
    const count = knowledgeData.count || 100;
    
    const knowledgeEntries = [];
    
    const templates = {
      '代码优化': [
        '使用更高效的算法可以显著提升代码性能。例如，将O(n^2)复杂度的嵌套循环优化为O(n log n)的分治法。',
        '避免重复计算是性能优化的关键。可以使用缓存机制存储中间结果，减少重复计算。',
        '内存优化同样重要。及时释放不再使用的对象引用，避免内存泄漏。',
        '使用惰性加载和按需计算可以减少初始化时间和内存占用。',
        '并行处理可以充分利用多核CPU，加速计算密集型任务。',
        '使用适当的数据结构可以大幅提升算法效率。例如，使用HashSet代替线性搜索。',
        '避免频繁的DOM操作或I/O操作，可以批量处理以减少开销。',
        '代码优化不仅是性能提升，还包括可读性和可维护性的改进。',
        '使用设计模式可以使代码更加优雅和可扩展。',
        '定期进行性能分析，找出瓶颈并针对性优化。'
      ],
      '代码分析': [
        '静态代码分析可以在编译阶段发现潜在的bug和安全漏洞。',
        '代码复杂度分析帮助识别难以维护的代码区域。',
        '代码覆盖率分析确保测试用例覆盖了关键代码路径。',
        '依赖分析帮助理解模块间的关系和潜在的耦合问题。',
        '代码质量评估包括可读性、可维护性、可扩展性等多个维度。',
        '使用AST（抽象语法树）可以深入分析代码结构和语义。',
        '代码风格检查确保团队成员遵循一致的编码规范。',
        '安全代码分析可以检测常见的安全漏洞，如SQL注入、XSS攻击等。',
        '性能分析帮助识别代码中的性能瓶颈和优化机会。',
        '代码审查是发现问题和共享知识的重要手段。'
      ],
      '代码检测': [
        '未使用的变量和函数应该及时清理，避免代码冗余。',
        '魔法数字会降低代码可读性，应该使用命名常量代替。',
        '深度嵌套的代码难以理解和维护，应该进行重构。',
        '过长的函数应该拆分为多个小函数，每个函数只负责单一职责。',
        '重复代码应该提取为公共函数或模块，提高代码复用性。',
        '缺少注释的代码难以理解，应该为复杂逻辑添加适当的注释。',
        'Null检查缺失可能导致运行时错误，应该在使用前进行检查。',
        '不必要的else分支可以简化为提前返回，提高代码可读性。',
        'Console.log残留会在生产环境造成问题，应该在发布前清理。',
        '高复杂度的方法难以测试和维护，应该进行重构降低复杂度。'
      ],
      '软件架构': [
        '单一职责原则要求每个类只负责一项职责。',
        '开闭原则要求软件实体对扩展开放，对修改关闭。',
        '里氏替换原则要求子类可以替换父类而不影响程序功能。',
        '依赖倒置原则要求依赖抽象而不是具体实现。',
        '接口隔离原则要求客户端不应该依赖它不需要的接口。',
        '模块化设计可以提高代码的可维护性和可扩展性。',
        '微服务架构将应用拆分为独立的服务，提高开发效率和可扩展性。',
        '事件驱动架构通过事件传递解耦系统组件。',
        '分层架构将系统分为表示层、业务逻辑层和数据访问层。',
        '设计模式提供了经过验证的解决方案，可以解决常见的设计问题。'
      ],
      '编程最佳实践': [
        '使用有意义的变量和函数命名，提高代码可读性。',
        '保持函数短小精悍，每个函数只做一件事。',
        '使用一致的代码风格和格式。',
        '编写单元测试确保代码质量和功能正确性。',
        '使用版本控制管理代码变更。',
        '编写清晰的文档说明代码功能和使用方法。',
        '遵循最小权限原则，只授予必要的权限。',
        '使用防御性编程，处理可能的异常情况。',
        '定期进行代码重构，保持代码质量。',
        '代码评审是发现问题和学习改进的重要途径。'
      ],
      '代码安全': [
        '输入验证是防止安全漏洞的第一道防线。',
        '使用参数化查询防止SQL注入攻击。',
        '对用户输入进行适当的转义防止XSS攻击。',
        '使用HTTPS保护数据传输的安全性。',
        '敏感信息不应该硬编码在代码中，应该使用配置文件或环境变量。',
        '定期更新依赖库，修复已知的安全漏洞。',
        '使用适当的认证和授权机制保护资源。',
        '避免使用不安全的加密算法，应该使用经过验证的加密方案。',
        '日志中不应该记录敏感信息，如密码、API密钥等。',
        '定期进行安全审计，发现和修复潜在的安全问题。'
      ],
      '性能优化': [
        '使用缓存减少重复计算和数据库查询。',
        '优化数据库查询，添加适当的索引。',
        '使用CDN加速静态资源加载。',
        '压缩和合并CSS、JavaScript文件，减少网络请求。',
        '使用异步加载和懒加载减少首屏加载时间。',
        '优化图片资源，使用适当的格式和尺寸。',
        '使用WebSocket或Server-Sent Events实现实时通信。',
        '使用连接池管理数据库连接，减少连接开销。',
        '使用负载均衡分散服务器压力。',
        '定期进行性能测试，监控系统性能指标。'
      ],
      '代码重构': [
        '识别坏味道代码，如重复代码、过长函数、深度嵌套等。',
        '使用提取函数重构，将复杂逻辑拆分为小函数。',
        '使用提取类重构，将相关功能组织到适当的类中。',
        '使用重命名重构，使变量和函数命名更加清晰。',
        '使用移动重构，将代码放到合适的位置。',
        '使用替换算法重构，用更高效的算法替代原有实现。',
        '使用引入参数对象重构，简化函数参数列表。',
        '使用合并条件表达式重构，简化复杂的条件判断。',
        '使用分解条件重构，将复杂条件拆分为多个简单条件。',
        '重构时应该保持功能不变，使用测试确保重构安全。'
      ]
    };

    let added = 0;
    const targetCount = Math.min(count, 1000);
    
    for (const topic of topics) {
      if (added >= targetCount) break;
      
      const topicTemplates = templates[topic] || templates['编程最佳实践'];
      for (let i = 0; i < Math.min(topicTemplates.length, Math.ceil(targetCount / topics.length)); i++) {
        if (added >= targetCount) break;
        
        await knowledgeBase.addEntry(topicTemplates[i], {
          type: 'general',
          language: 'general',
          tags: [topic]
        });
        added++;
      }
    }

    logger.info(`知识库扩展完成，新增 ${added} 条知识`);
    return added;
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

  async performVersionBump(updateId, updateRecord, applyResult) {
    try {
      const changelogItems = [
        `**${updateRecord.update_type === 'code' ? '代码更新' : updateRecord.update_type === 'config' ? '配置更新' : updateRecord.update_type === 'knowledge' ? '知识库更新' : '依赖更新'}**: ${updateRecord.update_source === 'ai_suggestion' ? 'AI生成的更新' : '手动更新'}`,
        `更新内容: ${this._getContentPreview(updateRecord.update_content)}`
      ];
      const versionResult = await this.bumpProjectVersion(changelogItems);
      logger.info(`更新应用成功: ${updateId}，版本迭代: ${versionResult.oldVersion} -> ${versionResult.newVersion}`);

      await this.updateUpdateRecord(updateId, {
        versionAfter: versionResult.newVersion
      });

      return versionResult;
    } catch (error) {
      logger.error(`版本迭代失败: ${error.message}`);
      throw error;
    }
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

请根据建议内容智能判断更新类型，并严格按照以下JSON格式返回，不要包含任何其他文字：

更新类型选择规则:
1. 如果建议涉及代码功能修改、新增功能、修复bug，请使用 "code" 类型
2. 如果建议涉及知识库扩充、添加学习资料，请使用 "knowledge" 类型
3. 如果建议涉及配置参数调整，请使用 "config" 类型
4. 如果建议涉及依赖包更新，请使用 "dependency" 类型

代码更新示例:
{"updateType":"code","description":"优化文件扫描功能","content":{"filePath":"src/utils/scanner.js","content":"function scanFiles(dir) {\n  // 优化后的扫描逻辑\n  return [];\n}"}}

知识库更新示例:
{"updateType":"knowledge","description":"扩充代码优化知识库","content":{"action":"expand","count":500,"topics":["代码优化","性能优化","代码安全"]}}

配置更新示例:
{"updateType":"config","description":"调整日志级别","content":{"log_level":"debug"}}

依赖更新示例:
{"updateType":"dependency","description":"更新依赖包","content":{"name":"lodash","version":"^4.17.21"}}

注意：
1. 优先考虑代码更新，只有明确提到知识库扩充时才使用knowledge类型
2. 只返回纯JSON字符串，不要包含markdown代码块标记
3. 确保JSON格式正确，所有字符串使用双引号
4. content字段必须是对象类型`;

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
      logger.info(`正在调用${provider.name}提供商生成更新方案...`);
      result = await provider.chat([{ role: 'user', content: prompt }], { temperature: 0.3 });
      logger.info(`AI调用完成，响应类型: ${typeof result}, content类型: ${typeof (result?.content)}`);
      if (result && result.content) {
        logger.debug(`AI响应内容(前500字符): ${String(result.content).substring(0, 500)}`);
      }
      if (result && result.rawContent) {
        logger.debug(`AI原始响应(前500字符): ${result.rawContent.substring(0, 500)}`);
      }
    } finally {
      clearTimeout(chatTimeout);
    }

    if (onProgress) {
      onProgress({ progress: 40, description: '解析AI响应', status: 'running' });
    }

    let updateData;
    try {
      if (!result || !result.content) {
        throw new Error('AI返回内容为空，请检查LLM提供商配置和网络连接');
      }
      
      let contentToParse = result.content;
      
      if (typeof contentToParse === 'string') {
        contentToParse = contentToParse.trim();
        
        if (!contentToParse) {
          throw new Error('AI返回内容为空，请检查LLM提供商配置和网络连接');
        }
        
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
      
      if (!contentToParse) {
        throw new Error('AI返回内容为空，请检查LLM提供商配置和网络连接');
      }
      
      updateData = typeof contentToParse === 'object' ? contentToParse : JSON.parse(contentToParse);
      
      if (!updateData.updateType || !updateData.content) {
        throw new Error('AI响应缺少必要字段(updateType或content)');
      }
    } catch (e) {
      logger.error('解析AI响应失败:', e.message);
      logger.error('AI原始响应:', result?.content ? (result.content.substring(0, 500) + (result.content.length > 500 ? '...' : '')) : JSON.stringify(result));
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