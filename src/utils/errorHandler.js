/**
 * 统一错误处理模块
 * 提供标准化的错误分类、处理和日志记录
 */

const { logger } = require('./logger');

/**
 * 错误类型枚举
 */
const ErrorType = {
  // 数据库相关
  DATABASE_ERROR: 'database_error',
  DATABASE_CONNECTION_ERROR: 'database_connection_error',
  DATABASE_QUERY_ERROR: 'database_query_error',
  DATABASE_SYNC_ERROR: 'database_sync_error',
  
  // 网络相关
  NETWORK_ERROR: 'network_error',
  API_ERROR: 'api_error',
  TIMEOUT_ERROR: 'timeout_error',
  
  // 配置相关
  CONFIG_ERROR: 'config_error',
  VALIDATION_ERROR: 'validation_error',
  
  // 业务逻辑相关
  BUSINESS_ERROR: 'business_error',
  NOT_FOUND_ERROR: 'not_found_error',
  CONFLICT_ERROR: 'conflict_error',
  
  // LLM相关
  LLM_ERROR: 'llm_error',
  LLM_RATE_LIMIT_ERROR: 'llm_rate_limit_error',
  LLM_AUTH_ERROR: 'llm_auth_error',
  
  // AST解析相关
  PARSE_ERROR: 'parse_error',
  SYNTAX_ERROR: 'syntax_error',
  
  // 运行时错误
  RUNTIME_ERROR: 'runtime_error',
  UNKNOWN_ERROR: 'unknown_error'
};

/**
 * 错误分类映射
 */
const errorCategoryMap = {
  'ENOTFOUND': ErrorType.NETWORK_ERROR,
  'ECONNREFUSED': ErrorType.NETWORK_ERROR,
  'ETIMEDOUT': ErrorType.TIMEOUT_ERROR,
  'SQLITE_ERROR': ErrorType.DATABASE_ERROR,
  'SQLITE_CONSTRAINT': ErrorType.DATABASE_ERROR,
  'ER_ACCESS_DENIED_ERROR': ErrorType.DATABASE_CONNECTION_ERROR,
  'ER_BAD_DB_ERROR': ErrorType.DATABASE_CONNECTION_ERROR,
  'ER_HOST_NOT_PRIVILEGED': ErrorType.DATABASE_CONNECTION_ERROR,
  'ER_NETWORK_ERROR': ErrorType.DATABASE_CONNECTION_ERROR,
  'SyntaxError': ErrorType.SYNTAX_ERROR,
  'ValidationError': ErrorType.VALIDATION_ERROR
};

/**
 * 自定义错误类
 */
class AppError extends Error {
  constructor(type, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.details = details;
    this.timestamp = Date.now();
    this.errorId = `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
  
  toJSON() {
    return {
      success: false,
      errorId: this.errorId,
      type: this.type,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * 分类错误
 */
function classifyError(error) {
  if (!error) return ErrorType.UNKNOWN_ERROR;
  
  // 如果已经是AppError，直接返回类型
  if (error.type) return error.type;
  
  const errorCode = error.code || '';
  const errorName = error.name || '';
  const errorMessage = error.message || '';
  
  // 按错误代码分类
  if (errorCategoryMap[errorCode]) {
    return errorCategoryMap[errorCode];
  }
  
  if (errorCategoryMap[errorName]) {
    return errorCategoryMap[errorName];
  }
  
  // 按消息关键词分类
  if (errorMessage.includes('database') || errorMessage.includes('SQL')) {
    return ErrorType.DATABASE_ERROR;
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('connection')) {
    return ErrorType.NETWORK_ERROR;
  }
  
  if (errorMessage.includes('timeout')) {
    return ErrorType.TIMEOUT_ERROR;
  }
  
  if (errorMessage.includes('API') || errorMessage.includes('request')) {
    return ErrorType.API_ERROR;
  }
  
  if (errorMessage.includes('parse') || errorMessage.includes('syntax')) {
    return ErrorType.PARSE_ERROR;
  }
  
  if (errorMessage.includes('validation') || errorMessage.includes('参数')) {
    return ErrorType.VALIDATION_ERROR;
  }
  
  if (errorMessage.includes('not found') || errorMessage.includes('不存在')) {
    return ErrorType.NOT_FOUND_ERROR;
  }
  
  if (errorMessage.includes('conflict') || errorMessage.includes('重复')) {
    return ErrorType.CONFLICT_ERROR;
  }
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('限流')) {
    return ErrorType.LLM_RATE_LIMIT_ERROR;
  }
  
  if (errorMessage.includes('auth') || errorMessage.includes('authentication') || errorMessage.includes('权限')) {
    return ErrorType.LLM_AUTH_ERROR;
  }
  
  if (errorMessage.includes('LLM') || errorMessage.includes('AI') || errorMessage.includes('model')) {
    return ErrorType.LLM_ERROR;
  }
  
  return ErrorType.RUNTIME_ERROR;
}

/**
 * 记录错误日志
 */
function logError(error, context = {}) {
  const errorType = classifyError(error);
  const errorId = error.errorId || `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.error({
    errorId,
    type: errorType,
    message: error.message,
    code: error.code,
    context,
    stack: error.stack
  });
  
  return { errorId, errorType };
}

/**
 * 处理错误并返回标准化响应
 */
function handleError(error, context = {}) {
  const { errorId, errorType } = logError(error, context);
  
  const statusCodes = {
    [ErrorType.VALIDATION_ERROR]: 400,
    [ErrorType.NOT_FOUND_ERROR]: 404,
    [ErrorType.CONFLICT_ERROR]: 409,
    [ErrorType.LLM_AUTH_ERROR]: 401,
    [ErrorType.LLM_RATE_LIMIT_ERROR]: 429,
    [ErrorType.NETWORK_ERROR]: 503,
    [ErrorType.DATABASE_ERROR]: 500,
    [ErrorType.RUNTIME_ERROR]: 500,
    [ErrorType.UNKNOWN_ERROR]: 500
  };
  
  return {
    errorId,
    type: errorType,
    message: error.message,
    statusCode: statusCodes[errorType] || 500,
    context
  };
}

/**
 * 创建标准化错误
 */
function createError(type, message, details = {}) {
  return new AppError(type, message, details);
}

/**
 * 包装异步函数，自动捕获和处理错误
 */
function asyncErrorHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const { errorId, type } = logError(error, {
        function: fn.name,
        args: args.slice(0, 3) // 只记录前3个参数，避免过多信息
      });
      
      throw new AppError(type, error.message, {
        originalError: error,
        errorId,
        function: fn.name
      });
    }
  };
}

/**
 * 错误处理中间件（Express）
 */
function expressErrorHandler(err, req, res, next) {
  const { errorId, type, message, statusCode } = handleError(err, {
    path: req.path,
    method: req.method,
    query: req.query,
    body: req.body ? Object.keys(req.body) : null
  });
  
  res.status(statusCode).json({
    success: false,
    errorId,
    type,
    message,
    timestamp: Date.now()
  });
}

module.exports = {
  ErrorType,
  AppError,
  classifyError,
  logError,
  handleError,
  createError,
  asyncErrorHandler,
  expressErrorHandler
};
