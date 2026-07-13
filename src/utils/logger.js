/**
 * 日志工具模块
 * 使用winston实现多级别日志记录
 * 包含敏感数据自动脱敏功能
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');

// 确保日志目录存在
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 敏感字段列表（日志输出时自动脱敏）
const SENSITIVE_FIELDS = [
  'password', 'passwd', 'pwd',
  'apiKey', 'api_key', 'apikey',
  'secret', 'secretKey', 'secret_key',
  'token', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token',
  'authorization', 'auth',
  'privateKey', 'private_key',
  'credential', 'credentials'
];

/**
 * 递归脱敏对象中的敏感字段
 */
function maskSensitiveData(obj, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    // 检查字符串是否可能是API key或token
    if (obj.length > 20 && /^(sk-|pk-|eyJ|xox[baprs]-)/i.test(obj)) {
      return maskString(obj);
    }
    return obj;
  }
  
  if (typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveData(item, depth + 1));
  }
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
      result[key] = typeof value === 'string' ? maskString(value) : '[REDACTED]';
    } else {
      result[key] = maskSensitiveData(value, depth + 1);
    }
  }
  return result;
}

/**
 * 脱敏字符串（显示前4后4，中间用*代替）
 */
function maskString(str) {
  if (!str || str.length <= 8) {
    return '****';
  }
  return str.substring(0, 4) + '*'.repeat(str.length - 8) + str.substring(str.length - 4);
}

// 定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    // 脱敏所有日志消息中的敏感数据
    if (info.message && typeof info.message === 'object') {
      info.message = maskSensitiveData(info.message);
    }
    // 脱敏meta数据
    const metaKeys = Object.keys(info).filter(k => 
      !['level', 'message', 'timestamp', 'stack', 'label', 'durationMs'].includes(k)
    );
    for (const key of metaKeys) {
      info[key] = maskSensitiveData(info[key]);
    }
    return info;
  })(),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${typeof message === 'object' ? JSON.stringify(message) : message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}]: ${typeof message === 'object' ? JSON.stringify(message) : message}`;
  })
);

// 控制台日志格式（带颜色）
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
  })
);

// 创建logger实例
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    // 文件日志
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    }),
    // 错误日志单独文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles
    })
  ]
});

// 开发环境添加控制台输出（显示info及以上级别）
if (config.server.nodeEnv !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'info'
  }));
}

/**
 * 请求日志中间件
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  // 记录请求
  logger.info(`请求开始: ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  // 记录响应
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`请求完成: ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
}

/**
 * 操作日志记录
 */
async function logOperation(data) {
  const db = require('./database').getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO sys_oper_log 
      (user_id, username, operation_type, operation_desc, request_method, 
       request_url, request_params, response_status, ip_address, user_agent, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      data.userId || null,
      data.username || 'system',
      data.operationType,
      data.operationDesc,
      data.requestMethod || null,
      data.requestUrl || null,
      data.requestParams ? JSON.stringify(data.requestParams) : null,
      data.responseStatus || null,
      data.ipAddress || null,
      data.userAgent || null,
      data.durationMs || null
    );
  } catch (error) {
    logger.error('记录操作日志失败:', error);
  }
}

module.exports = {
  logger,
  requestLogger,
  logOperation,
  maskSensitiveData,
  maskString
};