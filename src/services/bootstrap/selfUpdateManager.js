/**
 * 自更新管理器
 * 支持智能体自我更新，包括代码更新、配置更新、知识库更新等
 * 包含沙箱验证、确认门控、自动回滚等安全机制
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { execute, query, queryOne } = require('../../utils/database');
const { generateUUID } = require('../../utils/helpers');
const { sandbox } = require('./sandbox');
const { confirmationGate } = require('./confirmationGate');
const { rollbackManager } = require('./rollback');
const { providerManager } = require('../llm/providers');

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
    
    try {
      const updateRecord = await this.getUpdateRecord(updateId);
      if (!updateRecord) {
        return { success: false, error: '更新记录不存在' };
      }

      if (updateRecord.status === 'applied') {
        return { success: false, error: '更新已应用' };
      }

      if (updateRecord.status === 'rolled_back') {
        return { success: false, error: '更新已回滚' };
      }

      if (!options.skipBackup) {
        await rollbackManager.createBackup('update', process.cwd(), {
          version: updateRecord.current_version,
          description: `Update ${updateId} backup`
        });
      }

      if (!options.skipSandbox) {
        const sandboxResult = await this.runInSandbox(updateRecord);
        updateRecord.sandboxResult = JSON.stringify(sandboxResult);
        
        if (!sandboxResult.success) {
          await this.updateUpdateRecord(updateId, {
            status: 'sandbox_failed',
            sandboxResult: JSON.stringify(sandboxResult),
            errorMessage: sandboxResult.error || sandboxResult.stderr
          });
          return { success: false, error: '沙箱验证失败', sandboxResult };
        }
      }

      if (!options.skipConfirmation) {
        const confirmation = await confirmationGate.requestConfirmation({
          operationType: 'update_code',
          description: `执行${updateRecord.update_type}更新`,
          details: updateRecord.update_content.substring(0, 500),
          skipPrompt: options.autoConfirm
        });

        if (!confirmation.confirmed) {
          await this.updateUpdateRecord(updateId, {
            status: 'rejected',
            userConfirmed: 0,
            confirmedAt: Date.now()
          });
          return { success: false, error: '用户拒绝确认' };
        }

        updateRecord.userConfirmed = 1;
        updateRecord.confirmedAt = Date.now();
      }

      const applyResult = await this.applyUpdate(updateRecord, options);
      
      if (applyResult.success) {
        await this.updateUpdateRecord(updateId, {
          status: 'applied',
          appliedAt: Date.now(),
          durationMs: Date.now() - startTime,
          sandboxResult: updateRecord.sandboxResult,
          userConfirmed: updateRecord.userConfirmed,
          confirmedAt: updateRecord.confirmedAt
        });

        logger.info(`更新应用成功: ${updateId}`);

        return {
          success: true,
          updateId,
          updateType: updateRecord.update_type,
          status: 'applied',
          durationMs: Date.now() - startTime
        };
      } else {
        await this.updateUpdateRecord(updateId, {
          status: 'failed',
          errorMessage: applyResult.error,
          durationMs: Date.now() - startTime
        });

        if (!options.skipRollback) {
          await rollbackManager.rollbackUpdate(updateId);
        }

        return {
          success: false,
          updateId,
          error: applyResult.error,
          rolledBack: !options.skipRollback
        };
      }
    } catch (error) {
      logger.error('执行更新失败:', error);
      await this.updateUpdateRecord(updateId, {
        status: 'error',
        errorMessage: error.message,
        durationMs: Date.now() - startTime
      });
      return { success: false, error: error.message };
    }
  }

  async runInSandbox(updateRecord) {
    const content = updateRecord.update_content;
    let scriptContent = '';

    switch (updateRecord.update_type) {
      case 'code':
        scriptContent = this.generateCodeUpdateScript(content);
        break;
      case 'config':
        scriptContent = this.generateConfigUpdateScript(content);
        break;
      case 'knowledge':
        scriptContent = this.generateKnowledgeUpdateScript(content);
        break;
      default:
        return { success: true, skipped: true, message: '不需要沙箱验证' };
    }

    return sandbox.executeScript(scriptContent);
  }

  generateCodeUpdateScript(content) {
    return `
      const fs = require('fs');
      const path = require('path');
      console.log('沙箱代码更新验证');
      
      try {
        const updateData = JSON.parse(\`${content.replace(/`/g, '\\`')}\`);
        console.log('更新文件:', updateData.filePath);
        console.log('更新内容长度:', updateData.content.length);
        process.exit(0);
      } catch (e) {
        console.error('验证失败:', e.message);
        process.exit(1);
      }
    `;
  }

  generateConfigUpdateScript(content) {
    return `
      const fs = require('fs');
      console.log('沙箱配置更新验证');
      
      try {
        const configData = JSON.parse(\`${content.replace(/`/g, '\\`')}\`);
        console.log('配置键数量:', Object.keys(configData).length);
        process.exit(0);
      } catch (e) {
        console.error('验证失败:', e.message);
        process.exit(1);
      }
    `;
  }

  generateKnowledgeUpdateScript(content) {
    return `
      console.log('沙箱知识库更新验证');
      console.log('知识条目数量:', ${content.length});
      process.exit(0);
    `;
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

      if (!options.skipBackup) {
        await rollbackManager.createBackup('code', filePath);
      }

      fs.writeFileSync(filePath, updateData.content, 'utf-8');

      return { success: true, filePath };
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
    return await rollbackManager.rollbackUpdate(updateId);
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

  async updateFromAISuggestion(suggestion, options = {}) {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      return { success: false, error: '未配置LLM提供商' };
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

    const result = await provider.chat([{ role: 'user', content: prompt }], { temperature: 0.3 });

    let updateData;
    try {
      const jsonMatch = result.content.match(/```json\s*([\s\S]*?)\s*```/) || result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        updateData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        updateData = typeof result.content === 'object' ? result.content : JSON.parse(result.content);
      }
    } catch (e) {
      return { success: false, error: '解析AI响应失败' };
    }

    const createResult = await this.createUpdate(updateData.updateType, updateData.content, {
      source: 'ai_suggestion',
      description: updateData.description
    });

    if (!createResult.success) {
      return createResult;
    }

    return await this.executeUpdate(createResult.updateId, options);
  }
}

const selfUpdateManager = new SelfUpdateManager();

module.exports = {
  SelfUpdateManager,
  selfUpdateManager
};