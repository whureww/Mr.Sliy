/**
 * 配置管理模块
 * 统一管理应用配置
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'database_connections.json');

function loadConnectionsFromFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const saved = JSON.parse(data);
      if (saved && saved.connections) {
        return {
          defaultConnection: saved.defaultConnection,
          connections: saved.connections
        };
      }
    }
  } catch (e) {
    console.log('加载数据库连接配置失败:', e.message);
  }
  return null;
}

function saveConnectionsToFile() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      defaultConnection: config.databases.defaultConnection,
      connections: config.databases.connections
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.log('保存数据库连接配置失败:', e.message);
    return false;
  }
}

const savedConfig = loadConnectionsFromFile();

const config = {
  // 服务配置
  server: {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    host: process.env.HOST || 'localhost'
  },

  // 数据库配置
  database: {
    path: process.env.DB_PATH || './database/code_optimizer.db',
    // SQLite不需要连接池，但保留配置以备后用
    pool: {
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      min: parseInt(process.env.DB_POOL_MIN) || 2
    }
  },

  // MySQL配置（云端同步，可选）
  mysql: {
    enabled: process.env.MYSQL_ENABLED === 'true' || false,
    host: process.env.MYSQL_HOST || '',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || '',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'code_optimizer',
    connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT) || 10,
    syncOnStartup: process.env.MYSQL_SYNC_ON_STARTUP !== 'false'
  },

  // 多数据库连接配置
  databases: {
    defaultConnection: savedConfig?.defaultConnection || process.env.DEFAULT_DB_CONNECTION || 'mysql',
    connections: savedConfig?.connections || {
      mysql: {
        id: 'mysql',
        name: '默认MySQL',
        type: 'mysql',
        enabled: process.env.MYSQL_ENABLED === 'true' || false,
        host: process.env.MYSQL_HOST || '',
        port: parseInt(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER || '',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'code_optimizer',
        connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT) || 10
      }
    }
  },

  // AI配置
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    apiUrl: process.env.AI_API_URL || 'https://api.openai.com/v1',
    model: process.env.AI_MODEL || 'gpt-4',
    timeout: parseInt(process.env.AI_TIMEOUT) || 30000,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 2000,
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7
  },

  // LLM提供商配置
  llm: {
    // OpenAI
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4'
    },
    // Claude
    claude: {
      apiKey: process.env.CLAUDE_API_KEY || '',
      model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229'
    },
    // Azure OpenAI
    azure: {
      apiKey: process.env.AZURE_OPENAI_KEY || '',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
      deploymentName: process.env.AZURE_DEPLOYMENT_NAME || 'gpt-4'
    },
    // Google Gemini
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro'
    },
    // 阿里通义千问
    tongyi: {
      apiKey: process.env.TONGYI_API_KEY || '',
      model: process.env.TONGYI_MODEL || 'qwen-plus'
    },
    // 字节豆包
    doubao: {
      apiKey: process.env.DOUBAO_API_KEY || '',
      model: process.env.DOUBAO_MODEL || 'Doubao-7B'
    },
    // 百度文心一言
    wenxin: {
      apiKey: process.env.WENXIN_API_KEY || '',
      secretKey: process.env.WENXIN_SECRET_KEY || '',
      model: process.env.WENXIN_MODEL || 'ernie-3.5'
    },
    // DeepSeek
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    },
    // 智谱AI
    zhipu: {
      apiKey: process.env.ZHIPU_API_KEY || '',
      baseURL: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
      model: process.env.ZHIPU_MODEL || 'glm-4'
    },
    // Moonshot AI
    moonshot: {
      apiKey: process.env.MOONSHOT_API_KEY || '',
      baseURL: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
      model: process.env.MOONSHOT_MODEL || 'moonshot-v1-8k'
    },
    // Ollama (本地)
    ollama: {
      baseURL: process.env.OLLAMA_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'codellama'
    }
  },

  // AST扫描配置
  scan: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 1048576, // 1MB
    timeout: parseInt(process.env.SCAN_TIMEOUT) || 60000, // 60秒
    enableParallel: process.env.ENABLE_PARALLEL_SCAN !== 'false',
    maxParallelJobs: parseInt(process.env.MAX_PARALLEL_JOBS) || 4,
    extensions: (process.env.SCAN_EXTENSIONS || '.js,.ts,.jsx,.tsx,.py,.java,.go,.rs')
      .split(',')
      .map(ext => ext.trim()),
    excludeDirs: (process.env.EXCLUDE_DIRS || 'node_modules,dist,build,out,.git,coverage')
      .split(',')
      .map(dir => dir.trim()),
    excludeFiles: (process.env.EXCLUDE_FILES || 'min.js,min.css,.d.ts')
      .split(',')
      .map(file => file.trim())
  },

  // 检测规则配置
  detection: {
    unusedVariables: process.env.DETECT_UNUSED_VARIABLES !== 'false',
    unusedImports: process.env.DETECT_UNUSED_IMPORTS !== 'false',
    unusedFunctions: process.env.DETECT_UNUSED_FUNCTIONS !== 'false',
    magicNumbers: process.env.DETECT_MAGIC_NUMBERS !== 'false',
    maxFunctionLines: parseInt(process.env.MAX_FUNCTION_LINES) || 50,
    maxCyclomaticComplexity: parseInt(process.env.MAX_CYCLOMATIC_COMPLEXITY) || 10,
    maxNestingDepth: parseInt(process.env.MAX_NESTING_DEPTH) || 4,
    enableDeepNestingCheck: process.env.ENABLE_DEEP_NESTING_CHECK !== 'false',
    enableNullCheck: process.env.ENABLE_NULL_CHECK !== 'false',
    enableConsoleLogCheck: process.env.ENABLE_CONSOLE_LOG_CHECK !== 'false',
    enableDuplicateCodeCheck: process.env.ENABLE_DUPLICATE_CODE_CHECK !== 'false',
    enableCommentCheck: process.env.ENABLE_COMMENT_CHECK !== 'false'
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/app.log',
    maxSize: parseInt(process.env.LOG_MAX_SIZE) || 5242880, // 5MB
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
  },

  // CORS配置
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:1420')
      .split(',')
      .map(origin => origin.trim()),
    credentials: true
  },

  // 速率限制配置
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15分钟
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100
  },

  // 默认运行模式
  defaultMode: process.env.DEFAULT_MODE || 'offline' // offline | online
};

/**
 * 获取配置值
 */
function get(key, defaultValue = null) {
  const keys = key.split('.');
  let value = config;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return defaultValue;
    }
  }
  
  return value;
}

/**
 * 检查是否为在线模式
 */
function isOnlineMode() {
  return config.defaultMode === 'online' && config.ai.apiKey && config.ai.apiKey.length > 0;
}

/**
 * 检查是否为离线模式
 */
function isOfflineMode() {
  return !isOnlineMode();
}

/**
 * 验证必要配置
 */
function validate() {
  const errors = [];
  
  if (!config.server.port) {
    errors.push('服务端口未配置');
  }
  
  if (!config.database.path) {
    errors.push('数据库路径未配置');
  }

  if (isOnlineMode()) {
    const hasApiKey = config.llm.providers && 
      Object.values(config.llm.providers).some(p => p.apiKey && p.apiKey.length > 0);
    
    if (!hasApiKey) {
      errors.push('在线模式下需要配置至少一个AI API密钥');
    }
  }

  if (config.server.port && (typeof config.server.port !== 'number' || config.server.port < 1 || config.server.port > 65535)) {
    errors.push('服务端口必须是1-65535之间的数字');
  }

  if (config.llm && config.llm.timeout && (typeof config.llm.timeout !== 'number' || config.llm.timeout < 1000)) {
    errors.push('LLM超时时间必须大于1000ms');
  }

  if (config.llm && config.llm.maxRetries && (typeof config.llm.maxRetries !== 'number' || config.llm.maxRetries < 0)) {
    errors.push('LLM最大重试次数必须大于等于0');
  }
  
  if (errors.length > 0) {
    console.error('配置验证失败:', errors);
    return false;
  }
  
  return true;
}

function addDatabaseConnection(connection) {
  if (!connection.id || !connection.name || !connection.type) {
    return { success: false, message: '缺少必要参数(id/name/type)' };
  }
  
  if (config.databases.connections[connection.id]) {
    return { success: false, message: '连接ID已存在' };
  }
  
  config.databases.connections[connection.id] = {
    id: connection.id,
    name: connection.name,
    type: connection.type || 'mysql',
    enabled: connection.enabled || false,
    host: connection.host || '',
    port: connection.port || 3306,
    user: connection.user || '',
    password: connection.password || '',
    database: connection.database || 'code_optimizer',
    connectionLimit: connection.connectionLimit || 10
  };
  
  saveConnectionsToFile();
  
  return { success: true, message: '数据库连接添加成功' };
}

function updateDatabaseConnection(id, updates) {
  if (!config.databases.connections[id]) {
    return { success: false, message: '连接不存在' };
  }
  
  Object.assign(config.databases.connections[id], updates);
  saveConnectionsToFile();
  
  return { success: true, message: '数据库连接更新成功' };
}

function deleteDatabaseConnection(id) {
  if (id === 'mysql') {
    return { success: false, message: '默认连接不能删除' };
  }
  
  if (!config.databases.connections[id]) {
    return { success: false, message: '连接不存在' };
  }
  
  delete config.databases.connections[id];
  
  if (config.databases.defaultConnection === id) {
    config.databases.defaultConnection = 'mysql';
  }
  
  saveConnectionsToFile();
  
  return { success: true, message: '数据库连接删除成功' };
}

function getDatabaseConnections() {
  return Object.values(config.databases.connections);
}

function getDatabaseConnection(id) {
  return config.databases.connections[id] || null;
}

function setDefaultConnection(id) {
  if (!config.databases.connections[id]) {
    return { success: false, message: '连接不存在' };
  }
  
  config.databases.defaultConnection = id;
  
  const conn = config.databases.connections[id];
  config.mysql.enabled = conn.enabled;
  config.mysql.host = conn.host;
  config.mysql.port = conn.port;
  config.mysql.user = conn.user;
  config.mysql.password = conn.password;
  config.mysql.database = conn.database;
  config.mysql.connectionLimit = conn.connectionLimit;
  
  saveConnectionsToFile();
  
  return { success: true, message: '默认连接已切换到: ' + conn.name };
}

let networkStatus = null;
let lastNetworkCheck = 0;
const NETWORK_CHECK_INTERVAL = 30000;

async function checkNetworkConnectivity() {
  const now = Date.now();
  if (networkStatus !== null && now - lastNetworkCheck < NETWORK_CHECK_INTERVAL) {
    return networkStatus;
  }
  
  const testUrls = [
    'https://api.openai.com/v1/models',
    'https://api.deepseek.com/v1/models',
    'https://open.bigmodel.cn/api/paas/v4/models',
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
  ];
  
  let connected = false;
  
  for (const url of testUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Connection': 'keep-alive' }
      });
      
      clearTimeout(timeout);
      
      if (response.ok || response.status === 401 || response.status === 403) {
        connected = true;
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  networkStatus = connected;
  lastNetworkCheck = now;
  
  return connected;
}

function getNetworkStatus() {
  return {
    connected: networkStatus,
    lastCheck: lastNetworkCheck,
    stale: lastNetworkCheck === 0 || Date.now() - lastNetworkCheck > NETWORK_CHECK_INTERVAL
  };
}

module.exports = {
  config,
  get,
  isOnlineMode,
  isOfflineMode,
  validate,
  addDatabaseConnection,
  updateDatabaseConnection,
  deleteDatabaseConnection,
  getDatabaseConnections,
  getDatabaseConnection,
  setDefaultConnection,
  checkNetworkConnectivity,
  getNetworkStatus
};