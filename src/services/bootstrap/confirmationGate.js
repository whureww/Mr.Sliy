/**
 * 确认门控模块
 * 实现人工确认机制，高危操作需用户显式确认后才能执行
 * 支持自动确认、超时处理、操作审批流程、多步骤确认
 */

const { logger } = require('../../utils/logger');
const { generateUUID } = require('../../utils/helpers');
const { execute, query } = require('../../utils/database');

class ConfirmationGate {
  constructor() {
    this.pendingRequests = new Map();
    this.confirmationCallbacks = new Map();
    this.autoConfirmThreshold = 180000;
    this.taskExecutors = new Map();
    this.highRiskOperations = [
      'update_code',
      'update_dependency',
      'repair_database',
      'repair_filesystem',
      'rollback_update',
      'rollback_repair',
      'system_reboot',
      'module_update',
      'config_overwrite'
    ];
    this.mediumRiskOperations = [
      'update_config',
      'update_knowledge',
      'repair_network',
      'repair_configuration',
      'create_backup',
      'delete_backup'
    ];
    this.lowRiskOperations = [
      'check_update',
      'list_updates',
      'list_repairs',
      'run_validation',
      'view_backup'
    ];
    this.autoConfirmOperations = ['check_update', 'list_updates', 'list_repairs', 'view_backup'];
    this.confirmationHistory = [];
  }

  async requestConfirmation(request) {
    const { 
      operationType, 
      description, 
      details, 
      skipPrompt = false,
      stepName = '',
      stepNumber = 0,
      totalSteps = 0,
      riskLevel = null,
      impact = '',
      filesAffected = [],
      backupAvailable = false,
      rollbackPossible = false,
      taskExecutor = null,
      taskContext = null
    } = request;
    
    if (this.autoConfirmOperations.includes(operationType)) {
      return await this.autoConfirm(request);
    }

    if (skipPrompt) {
      return await this.autoConfirm(request);
    }

    const requestId = generateUUID();
    const calculatedRiskLevel = riskLevel || this.getRiskLevel(operationType);
    
    const confirmationRequest = {
      id: requestId,
      operationType,
      description,
      details,
      stepName,
      stepNumber,
      totalSteps,
      riskLevel: calculatedRiskLevel,
      impact,
      filesAffected,
      backupAvailable,
      rollbackPossible,
      createdAt: Date.now(),
      status: 'pending',
      taskContext
    };

    this.pendingRequests.set(requestId, confirmationRequest);
    
    if (taskExecutor) {
      this.taskExecutors.set(requestId, taskExecutor);
    }

    const result = await this.promptUser(confirmationRequest);

    if (result.confirmed) {
      confirmationRequest.status = 'confirmed';
      confirmationRequest.confirmedAt = Date.now();
      confirmationRequest.reason = result.reason;
      await this.saveConfirmationRecord(confirmationRequest, result);
      logger.debug(`操作已确认: ${operationType} (步骤${stepNumber}/${totalSteps})`);
      
      if (taskExecutor) {
        await this.executeTask(requestId);
      }
      
      this.notifyPendingRequests();
    } else if (result.reason === 'timeout' || result.reason === 'queue') {
      confirmationRequest.status = 'queued';
      logger.info(`操作已加入待处理队列: ${operationType} (请求ID: ${requestId})`);
    } else {
      confirmationRequest.status = 'rejected';
      confirmationRequest.confirmedAt = Date.now();
      confirmationRequest.reason = result.reason;
      await this.saveConfirmationRecord(confirmationRequest, result);
      logger.warn(`操作已拒绝: ${operationType} (步骤${stepNumber}/${totalSteps})`);
      
      this.taskExecutors.delete(requestId);
    }

    return result;
  }

  async executeTask(requestId) {
    const executor = this.taskExecutors.get(requestId);
    const request = this.pendingRequests.get(requestId);
    
    if (!executor) {
      logger.debug(`没有任务执行器: ${requestId}`);
      return;
    }

    try {
      logger.info(`开始执行任务: ${request.operationType} (请求ID: ${requestId})`);
      await executor();
      logger.info(`任务执行完成: ${request.operationType} (请求ID: ${requestId})`);
    } catch (error) {
      logger.error(`任务执行失败: ${request.operationType} (请求ID: ${requestId}): ${error.message}`);
    } finally {
      this.taskExecutors.delete(requestId);
    }
  }

  async promptUser(request) {
    const { 
      operationType, 
      description, 
      details, 
      riskLevel,
      stepName,
      stepNumber,
      totalSteps,
      impact,
      filesAffected,
      backupAvailable,
      rollbackPossible
    } = request;

    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('                    🔒 确认门控 - 操作审批                              ');
    console.log('═══════════════════════════════════════════════════════════════════════');
    
    if (stepNumber > 0 && totalSteps > 0) {
      console.log(`\n📋 步骤 ${stepNumber}/${totalSteps}: ${stepName}`);
    }
    
    console.log(`\n🔧 操作类型: ${operationType}`);
    
    const riskColors = {
      high: '🔴 高风险',
      medium: '🟡 中风险',
      low: '🟢 低风险'
    };
    console.log(`⚠️  风险等级: ${riskColors[riskLevel] || '⚪ 未知'}`);
    
    console.log(`\n📝 描述: ${description}`);
    
    if (impact) {
      console.log(`\n💥 影响范围: ${impact}`);
    }
    
    if (filesAffected && filesAffected.length > 0) {
      console.log(`\n📂 受影响文件:`);
      filesAffected.forEach(file => {
        console.log(`   - ${file}`);
      });
    }
    
    if (backupAvailable) {
      console.log(`\n✅ 备份已创建，可以回滚`);
    } else {
      console.log(`\n⚠️  未创建备份，无法自动回滚`);
    }
    
    if (rollbackPossible) {
      console.log(`✅ 支持回滚到更新前状态`);
    }
    
    if (details) {
      console.log(`\n🔍 详细信息:`);
      if (typeof details === 'object') {
        console.log(JSON.stringify(details, null, 2));
      } else {
        console.log(details);
      }
    }

    const timeoutMinutes = Math.floor(this.autoConfirmThreshold / 1000 / 60);
    
    console.log('\n───────────────────────────────────────────────────────────────────────');
    console.log(`请确认是否执行此操作? (${timeoutMinutes}分钟超时自动加入队列)`);
    console.log('');
    console.log('  1. ✅ 确认执行');
    console.log('  2. ❌ 拒绝执行');
    console.log('  3. 📖 查看完整详情');
    console.log('  4. 🔄 请求修改方案');
    console.log('  5. 📥 暂存到队列（稍后处理）');
    console.log('');

    return new Promise((resolve) => {
      let timeoutId = null;
      
      if (this.autoConfirmThreshold > 0) {
        timeoutId = setTimeout(() => {
          process.stdin.removeListener('data', handleInput);
          console.log(`\n⏰ 超时(${timeoutMinutes}分钟)，操作已加入待处理队列，您可以稍后使用 /pending 命令处理`);
          resolve({ confirmed: false, reason: 'timeout' });
        }, this.autoConfirmThreshold);
      }

      const handleInput = (data) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        const input = data.toString().trim();
        
        process.stdin.removeListener('data', handleInput);

        switch (input) {
          case '1':
          case 'y':
          case 'yes':
          case '确认':
            resolve({ confirmed: true, reason: 'user_confirm' });
            break;
          case '2':
          case 'n':
          case 'no':
          case '拒绝':
            resolve({ confirmed: false, reason: 'user_reject' });
            break;
          case '3':
          case '详情':
            console.log('\n📋 完整信息:');
            console.log(JSON.stringify(request, null, 2));
            console.log('\n请再次选择:');
            process.stdin.once('data', handleInput);
            break;
          case '4':
          case '修改':
            console.log('\n请描述您希望如何修改:');
            process.stdin.once('data', (modifyData) => {
              const modification = modifyData.toString().trim();
              resolve({ confirmed: false, reason: 'request_modification', modification });
            });
            break;
          case '5':
          case '暂存':
          case '队列':
            console.log('\n📥 操作已暂存到待处理队列，您可以稍后使用 /pending 命令处理');
            resolve({ confirmed: false, reason: 'queue' });
            break;
          case 'q':
          case 'quit':
          case 'exit':
          case '返回':
            console.log('\n📥 操作已暂存到待处理队列，您可以稍后使用 /pending 命令处理');
            resolve({ confirmed: false, reason: 'queue' });
            break;
          default:
            console.log('\n❌ 无效输入，请输入 1、2、3、4、5 或 q(暂存)');
            process.stdin.once('data', handleInput);
            break;
        }
      };

      process.stdin.once('data', handleInput);
    });
  }

  async autoConfirm(request) {
    const { operationType, stepName, stepNumber, totalSteps } = request;
    const riskLevel = this.getRiskLevel(operationType);

    if (riskLevel === 'high') {
      logger.warn(`高风险操作需要人工确认: ${operationType} (步骤${stepNumber}/${totalSteps})`);
      return { confirmed: false, reason: 'high_risk' };
    }

    logger.info(`自动确认操作: ${operationType} (步骤${stepNumber}/${totalSteps})`);
    return { confirmed: true, reason: 'auto_confirm' };
  }

  getRiskLevel(operationType) {
    if (this.highRiskOperations.includes(operationType)) {
      return 'high';
    }
    if (this.mediumRiskOperations.includes(operationType)) {
      return 'medium';
    }
    if (this.lowRiskOperations.includes(operationType)) {
      return 'low';
    }
    return 'medium';
  }

  isHighRisk(operationType) {
    return this.highRiskOperations.includes(operationType);
  }

  isLowRisk(operationType) {
    return this.lowRiskOperations.includes(operationType);
  }

  getPendingRequests() {
    return Array.from(this.pendingRequests.values()).filter(r => r.status === 'pending');
  }

  getQueuedRequests() {
    return Array.from(this.pendingRequests.values()).filter(r => r.status === 'queued');
  }

  getAllPendingAndQueued() {
    return Array.from(this.pendingRequests.values()).filter(r => r.status === 'pending' || r.status === 'queued');
  }

  getRequestStatus(requestId) {
    return this.pendingRequests.get(requestId);
  }

  async confirmRequest(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return { success: false, error: '请求不存在' };
    }

    if (request.status !== 'pending' && request.status !== 'queued') {
      return { success: false, error: `请求状态已为: ${request.status}` };
    }

    request.status = 'confirmed';
    request.confirmedAt = Date.now();
    
    await this.saveConfirmationRecord(request, { confirmed: true, reason: 'user_confirm' });
    
    logger.info(`请求已确认: ${requestId}`);
    
    const callback = this.confirmationCallbacks.get(requestId);
    if (callback) {
      callback({ confirmed: true, reason: 'user_confirm' });
      this.confirmationCallbacks.delete(requestId);
    }
    
    await this.executeTask(requestId);
    
    return { success: true, request };
  }

  async rejectRequest(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return { success: false, error: '请求不存在' };
    }

    if (request.status !== 'pending' && request.status !== 'queued') {
      return { success: false, error: `请求状态已为: ${request.status}` };
    }

    request.status = 'rejected';
    request.confirmedAt = Date.now();
    
    await this.saveConfirmationRecord(request, { confirmed: false, reason: 'user_reject' });
    
    logger.info(`请求已拒绝: ${requestId}`);
    
    const callback = this.confirmationCallbacks.get(requestId);
    if (callback) {
      callback({ confirmed: false, reason: 'user_reject' });
      this.confirmationCallbacks.delete(requestId);
    }
    
    this.taskExecutors.delete(requestId);
    
    return { success: true, request };
  }

  addConfirmationCallback(requestId, callback) {
    this.confirmationCallbacks.set(requestId, callback);
  }

  removeConfirmationCallback(requestId) {
    this.confirmationCallbacks.delete(requestId);
  }

  notifyPendingRequests() {
    const queuedRequests = this.getQueuedRequests();
    if (queuedRequests.length > 0) {
      console.log(`\n📋 有待处理的确认请求 (${queuedRequests.length} 条)，使用 /pending 命令查看`);
    }
  }

  async saveConfirmationRecord(request, result) {
    try {
      await execute(
        'INSERT INTO confirmation_history (id, operation_type, risk_level, step_name, step_number, total_steps, description, impact, files_affected, backup_available, rollback_possible, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          request.id,
          request.operationType,
          request.riskLevel,
          request.stepName,
          request.stepNumber,
          request.totalSteps,
          request.description,
          request.impact,
          JSON.stringify(request.filesAffected),
          request.backupAvailable ? 1 : 0,
          request.rollbackPossible ? 1 : 0,
          result.confirmed ? 'confirmed' : 'rejected',
          result.reason,
          Date.now()
        ]
      );
    } catch (error) {
      logger.error('保存确认记录失败:', error);
    }
  }

  async getConfirmationHistory(limit = 50) {
    try {
      const records = await query(
        'SELECT * FROM confirmation_history ORDER BY created_at DESC LIMIT ?',
        [limit]
      );
      
      return records.map(record => ({
        id: record.id,
        operationType: record.operation_type,
        riskLevel: record.risk_level,
        stepName: record.step_name,
        stepNumber: record.step_number,
        totalSteps: record.total_steps,
        description: record.description,
        impact: record.impact,
        filesAffected: record.files_affected ? JSON.parse(record.files_affected) : [],
        backupAvailable: record.backup_available === 1,
        rollbackPossible: record.rollback_possible === 1,
        status: record.status,
        reason: record.reason,
        createdAt: record.created_at
      }));
    } catch (error) {
      logger.error('查询确认历史失败:', error);
      return [];
    }
  }

  cleanupExpiredRequests() {
    const now = Date.now();
    const expiredThreshold = 5 * 60 * 1000;

    for (const [id, request] of this.pendingRequests) {
      if (request.status === 'pending' && (now - request.createdAt) > expiredThreshold) {
        request.status = 'expired';
        logger.info(`清理过期请求: ${id}`);
      }
    }
  }

  setAutoConfirmThreshold(threshold) {
    this.autoConfirmThreshold = threshold;
    return this.autoConfirmThreshold;
  }

  addHighRiskOperation(operation) {
    if (!this.highRiskOperations.includes(operation)) {
      this.highRiskOperations.push(operation);
    }
    return this.highRiskOperations;
  }

  removeHighRiskOperation(operation) {
    this.highRiskOperations = this.highRiskOperations.filter(o => o !== operation);
    return this.highRiskOperations;
  }

  addAutoConfirmOperation(operation) {
    if (!this.autoConfirmOperations.includes(operation)) {
      this.autoConfirmOperations.push(operation);
    }
    return this.autoConfirmOperations;
  }

  removeAutoConfirmOperation(operation) {
    this.autoConfirmOperations = this.autoConfirmOperations.filter(o => o !== operation);
    return this.autoConfirmOperations;
  }
}

const confirmationGate = new ConfirmationGate();

module.exports = {
  ConfirmationGate,
  confirmationGate
};