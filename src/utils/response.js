/**
 * API响应工具模块
 * 统一API响应格式
 */

/**
 * 成功响应
 */
function success(data = null, message = '操作成功', code = 200) {
  return {
    success: true,
    code,
    message,
    data,
    timestamp: new Date().toISOString()
  };
}

/**
 * 错误响应
 */
function error(message = '操作失败', code = 500, errors = null) {
  return {
    success: false,
    code,
    message,
    errors,
    timestamp: new Date().toISOString()
  };
}

/**
 * 分页响应
 */
function paginate(data, total, page, pageSize) {
  return {
    success: true,
    code: 200,
    message: '查询成功',
    data: {
      list: data,
      pagination: {
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil(total / parseInt(pageSize))
      }
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * 参数验证错误响应
 */
function validationError(errors) {
  return {
    success: false,
    code: 400,
    message: '参数验证失败',
    errors,
    timestamp: new Date().toISOString()
  };
}

/**
 * 未授权响应
 */
function unauthorized(message = '未授权访问') {
  return {
    success: false,
    code: 401,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * 禁止访问响应
 */
function forbidden(message = '禁止访问') {
  return {
    success: false,
    code: 403,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * 资源未找到响应
 */
function notFound(message = '资源未找到') {
  return {
    success: false,
    code: 404,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * 服务端错误响应
 */
function serverError(message = '服务器内部错误', errors = null) {
  return {
    success: false,
    code: 500,
    message,
    errors,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  success,
  error,
  paginate,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  serverError
};