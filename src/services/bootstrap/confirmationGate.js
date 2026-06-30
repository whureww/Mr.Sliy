/**
 * 确认门控模块
 * 实现人工确认机制，高危操作需用户显式确认后才能执行
 * 支持自动确认、超时处理、操作审批流程
 */

const { logger } = require('../../utils/logger');
const { generateUUID } = require('../../utils/helpers');

class ConfirmationGate {
  constructor() {
    this.pendingRequests = new Map();
    this.autoConfirmThreshold = 30000;
    this.highRiskOperations = [
      'update_code',
      'update_dependency',
      'repair_database',
      'repair_filesystem',
      'rollback_update',
      'rollback_repair',
      'system_reboot'
    ];
    this.mediumRiskOperations = [
      'update_config',
      'update_knowledge',
      'repair_network',
      'repair_configuration'
    ];
    this.lowRiskOperations = [
      'check_update',
      'list_updates',
      'list_repairs',
      'run_validation'
    ];
    this.autoConfirmOperations = ['check_update', 'list_updates', 'list_repairs'];
  }

  async requestConfirmation(request) {
    const { operationType, description, details, skipPrompt = false } = request;
    
    if (this.autoConfirmOperations.includes(operationType)) {
      return await this.autoConfirm(request);
    }

    if (skipPrompt) {
      return await this.autoConfirm(request);
    }

    const requestId = generateUUID();
    const confirmationRequest = {
      id: requestId,
      operationType,
      description,
      details,
      riskLevel: this.getRiskLevel(operationType),
      createdAt: Date.now(),
      status: 'pending'
    };

    this.pendingRequests.set(requestId, confirmationRequest);

    const result = await this.promptUser(request);

    confirmationRequest.status = result.confirmed ? 'confirmed' : 'rejected';
    confirmationRequest.confirmedAt = Date.now();

    if (result.confirmed) {
      logger.info(`操作已确认: ${operationType}`);
    } else {
      logger.warn(`操作已拒绝: ${operationType}`);
    }

    return result;
  }

  async promptUser(request) {
    const { operationType, description, details, riskLevel } = request;

    console.log('\n==================== 确认门控 ====================');
    console.log(`操作类型: ${operationType}`);
    console.log(`风险等级: ${riskLevel.toUpperCase()}`);
    console.log(`描述: ${description}`);
    
    if (details) {
      console.log(`详情:`);
      console.log(`  ${details}`);
    }

    console.log('\n请确认是否执行此操作?');
    console.log('1. 确认执行');
    console.log('2. 拒绝执行');
    console.log('3. 查看详情');

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        console.log('\n[超时] 自动拒绝操作');
        process.stdin.removeListener('data', handleInput);
        resolve({ confirmed: false, reason: 'timeout' });
      }, this.autoConfirmThreshold);

      const handleInput = (data) => {
        const input = data.toString().trim();
        
        clearTimeout(timeoutId);
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
            console.log('\n详细信息:');
            console.log(JSON.stringify(request, null, 2));
            break;
          default:
            console.log('\n无效输入，请输入 1、2 或 3');
            break;
        }
      };

      process.stdin.once('data', handleInput);
    });
  }

  async autoConfirm(request) {
    const { operationType } = request;
    const riskLevel = this.getRiskLevel(operationType);

    if (riskLevel === 'high') {
      logger.warn(`高风险操作需要人工确认: ${operationType}`);
      return { confirmed: false, reason: 'high_risk' };
    }

    logger.info(`自动确认操作: ${operationType}`);
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

  getRequestStatus(requestId) {
    return this.pendingRequests.get(requestId);
  }

  async confirmRequest(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return { success: false, error: '请求不存在' };
    }

    if (request.status !== 'pending') {
      return { success: false, error: `请求状态已为: ${request.status}` };
    }

    request.status = 'confirmed';
    request.confirmedAt = Date.now();
    
    logger.info(`请求已确认: ${requestId}`);
    return { success: true, request };
  }

  async rejectRequest(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return { success: false, error: '请求不存在' };
    }

    if (request.status !== 'pending') {
      return { success: false, error: `请求状态已为: ${request.status}` };
    }

    request.status = 'rejected';
    request.confirmedAt = Date.now();
    
    logger.info(`请求已拒绝: ${requestId}`);
    return { success: true, request };
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