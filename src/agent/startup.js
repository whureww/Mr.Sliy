// 修复启动时重复告警的问题
let startupGuard = false;

function startAgent() {
  if (startupGuard) {
    console.warn('Agent already started, skipping duplicate startup');
    return;
  }
  startupGuard = true;
  
  // 原有的启动逻辑
  console.log('Agent starting...');
  // ... 其他初始化代码
}