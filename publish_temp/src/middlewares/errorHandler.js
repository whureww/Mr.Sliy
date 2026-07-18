/**
 * Express中间件模块
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { logger } = require('../utils/logger');

/**
 * 安全中间件配置
 */
const securityMiddleware = [
  // Helmet安全头
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
];

/**
 * CORS中间件配置
 */
const corsMiddleware = cors({
  origin: config.cors.origins,
  credentials: config.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Size'],
  maxAge: 86400, // 24小时
});

/**
 * 速率限制中间件
 */
const rateLimitMiddleware = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    success: false,
    code: 429,
    message: '请求过于频繁，请稍后再试',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn(`速率限制触发: ${req.ip} - ${req.method} ${req.url}`);
    res.status(429).json(options.message);
  }
});

/**
 * 请求体解析中间件
 */
const bodyParserMiddleware = [
  // JSON解析
  require('express').json({
    limit: '10mb',
    strict: true,
  }),
  // URL编码解析
  require('express').urlencoded({
    extended: true,
    limit: '10mb',
  }),
];

/**
 * 错误处理中间件
 */
function errorHandler(err, req, res, next) {
  logger.error('错误处理中间件捕获:', err);
  
  // JWT错误
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      code: 401,
      message: '无效的认证令牌',
      timestamp: new Date().toISOString()
    });
  }
  
  // 验证错误
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      code: 400,
      message: '参数验证失败',
      errors: err.errors,
      timestamp: new Date().toISOString()
    });
  }
  
  // 语法错误
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      code: 400,
      message: 'JSON解析错误',
      timestamp: new Date().toISOString()
    });
  }
  
  // 数据库错误
  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(400).json({
      success: false,
      code: 400,
      message: '数据约束冲突',
      timestamp: new Date().toISOString()
    });
  }
  
  // 默认错误
  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || '服务器内部错误';
  
  res.status(statusCode).json({
    success: false,
    code: statusCode,
    message,
    errors: config.server.nodeEnv === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });
}

/**
 * 404处理中间件
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    code: 404,
    message: `路由未找到: ${req.method} ${req.url}`,
    timestamp: new Date().toISOString()
  });
}

/**
 * 异步错误捕获包装器
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  securityMiddleware,
  corsMiddleware,
  rateLimitMiddleware,
  bodyParserMiddleware,
  errorHandler,
  notFoundHandler,
  asyncHandler
};