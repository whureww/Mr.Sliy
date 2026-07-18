const { ensureServicesReady } = require('./serviceChecker');
const logger = require('../utils/logger');

async function startSustainCycle() {
  logger.info('Starting sustain cycle...');
  
  try {
    // 检查所有必要服务是否就绪
    const servicesReady = await ensureServicesReady(['knowledgeBase', 'ruleEngine']);
    if (!servicesReady) {
      const errorMsg = 'Sustain cycle start failed: required services (knowledgeBase, ruleEngine) not ready';
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    // 触发周期完成事件并记录详细上下文
    const cycleResult = await executeCycle();
    logger.info('Sustain cycle completed successfully', { cycleResult });
    
    // 发射完成事件，附带详细日志
    emit('sustain_cycle_complete', {
      status: 'success',
      timestamp: new Date().toISOString(),
      details: cycleResult
    });
    
  } catch (error) {
    // 增强失败日志记录，包含错误堆栈和上下文
    const failureContext = {
      errorMessage: error.message,
      errorStack: error.stack,
      cycleAttempt: global.cycleAttemptCount || 0,
      serviceStatus: await getServiceStatusSnapshot()
    };
    
    logger.error('Sustain cycle failed', failureContext);
    
    // 发射失败事件，携带详细错误信息
    emit('sustain_cycle_complete', {
      status: 'failed',
      timestamp: new Date().toISOString(),
      error: failureContext
    });
    
    throw error;
  }
}

async function getServiceStatusSnapshot() {
  // 获取当前所有依赖服务的状态快照
  return {
    knowledgeBase: await checkServiceHealth('knowledgeBase'),
    ruleEngine: await checkServiceHealth('ruleEngine')
  };
}

async function checkServiceHealth(serviceName) {
  try {
    const service = require(`./services/${serviceName}`);
    return await service.isReady();
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { startSustainCycle };