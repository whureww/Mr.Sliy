function initializeAgent() {
  const initOrder = ['config', 'database', 'serviceRegistry', 'scheduler'];
  const failedComponents = [];

  for (const component of initOrder) {
    try {
      if (!checkDependencyAvailable(component)) {
        throw new Error(`Dependency ${component} is not available`);
      }
      initializeComponent(component);
      logInfo(`Component ${component} initialized successfully`);
    } catch (error) {
      logError(`Failed to initialize ${component}: ${error.message}`);
      logError(`Stack trace: ${error.stack}`);
      failedComponents.push({ component, error: error.message });
    }
  }

  if (failedComponents.length > 0) {
    throw new Error(`Initialization failed for components: ${JSON.stringify(failedComponents)}`);
  }
}

function checkDependencyAvailable(component) {
  // 模拟依赖服务可用性检查
  const services = {
    config: true,
    database: true,
    serviceRegistry: true,
    scheduler: true
  };
  return services[component] || false;
}

function initializeComponent(component) {
  // 组件初始化逻辑
  console.log(`Initializing ${component}...`);
}

function logInfo(message) {
  console.log(`[INFO] ${message}`);
}

function logError(message) {
  console.error(`[ERROR] ${message}`);
}