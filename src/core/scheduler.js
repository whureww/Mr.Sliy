// 添加子步骤耗时记录和波动警告
const logStepDuration = (stepName, startTime) => {
  const duration = Date.now() - startTime;
  console.log(`[${stepName}] 耗时: ${duration}ms`);
  if (duration > 200) {
    console.warn(`[警告] ${stepName} 耗时超过200ms: ${duration}ms`);
  }
  return duration;
};

// 示例使用：在周期执行中
function executeCycle() {
  const cycleStart = Date.now();
  
  const step1Start = Date.now();
  // 执行子步骤1
  logStepDuration('子步骤1', step1Start);
  
  const step2Start = Date.now();
  // 执行子步骤2
  logStepDuration('子步骤2', step2Start);
  
  const totalDuration = Date.now() - cycleStart;
  console.log(`周期总耗时: ${totalDuration}ms`);
}