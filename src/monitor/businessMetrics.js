const ALERT_THRESHOLD_MS = 60 * 60 * 1000; // 1小时
let lastNonZeroTimestamp = Date.now();

function checkBusinessMetrics(currentValue) {
  if (currentValue > 0) {
    lastNonZeroTimestamp = Date.now();
  } else {
    const elapsed = Date.now() - lastNonZeroTimestamp;
    if (elapsed >= ALERT_THRESHOLD_MS) {
      console.warn(`[ALERT] 业务指标持续为零超过 ${ALERT_THRESHOLD_MS / 1000} 秒，请检查系统状态`);
      // 可扩展通知逻辑，如发送邮件或调用通知服务
    }
  }
}

// 使用示例：每30秒检查一次指标
setInterval(() => {
  const currentValue = getBusinessMetricValue(); // 需实现此函数
  checkBusinessMetrics(currentValue);
}, 30000);

function getBusinessMetricValue() {
  // 实际业务指标获取逻辑，例如从数据库或API读取
  return 0;
}