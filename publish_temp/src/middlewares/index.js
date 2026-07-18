/**
 * 中间件导出模块
 */

const {
  securityMiddleware,
  corsMiddleware,
  rateLimitMiddleware,
  bodyParserMiddleware,
  errorHandler,
  notFoundHandler,
  asyncHandler
} = require('./errorHandler');

module.exports = {
  securityMiddleware,
  corsMiddleware,
  rateLimitMiddleware,
  bodyParserMiddleware,
  errorHandler,
  notFoundHandler,
  asyncHandler
};