/**
 * Express应用主文件
 * 创建并配置Express服务器
 */

const express = require('express');
const path = require('path');
const { config, validate } = require('./config');
const { logger, requestLogger } = require('./utils/logger');
const { closeDatabase } = require('./utils/database');
const {
  securityMiddleware,
  corsMiddleware,
  rateLimitMiddleware,
  bodyParserMiddleware,
  errorHandler,
  notFoundHandler
} = require('./middlewares');

// 导入路由
const routes = require('./routes');

// 创建Express应用
const app = express();

// 验证配置
if (!validate()) {
  process.exit(1);
}

// ============================================
// 配置中间件
// ============================================

// 安全中间件
app.use(securityMiddleware);

// CORS中间件
app.use(corsMiddleware);

// 请求体解析中间件
app.use(bodyParserMiddleware);

// 请求日志中间件
app.use(requestLogger);

// 静态文件服务（用于报告文件）
const reportsDir = path.join(__dirname, '..', 'reports');
app.use('/reports', express.static(reportsDir));

// ============================================
// API路由
// ============================================

// API路由前缀
app.use('/api', rateLimitMiddleware);

// 注册业务路由
app.use('/api', routes);

// 健康检查路由
app.get('/health', (req, res) => {
  res.json({
    success: true,
    code: 200,
    message: '服务运行正常',
    data: {
      status: 'healthy',
      mode: config.defaultMode,
      timestamp: new Date().toISOString()
    }
  });
});

// 根路由
app.get('/', (req, res) => {
  res.json({
    success: true,
    code: 200,
    message: '代码优化智能体API服务',
    data: {
      name: 'Code Optimizer Agent',
      version: '1.0.0',
      description: '基于Tree-sitter与RAG的多语言代码优化智能体',
      endpoints: {
        health: '/health',
        api: '/api',
        docs: '/api/docs'
      }
    }
  });
});

// ============================================
// 错误处理
// ============================================

// 404处理
app.use(notFoundHandler);

// 全局错误处理
app.use(errorHandler);

// ============================================
// 启动服务器
// ============================================

const PORT = config.server.port;
const HOST = config.server.host;

// 启动HTTP服务器
const server = app.listen(PORT, HOST, () => {
  logger.info(`服务器启动成功: http://${HOST}:${PORT}`);
  logger.info(`运行模式: ${config.defaultMode}`);
  logger.info(`环境: ${config.server.nodeEnv}`);
});

// ============================================
// 进程事件处理
// ============================================

// 优雅关闭
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// 未捕获异常处理
process.on('uncaughtException', (err) => {
  logger.error('未捕获异常:', err);
  gracefulShutdown();
});

// 未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason);
});

/**
 * 优雅关闭函数
 */
function gracefulShutdown() {
  logger.info('正在关闭服务器...');
  
  server.close((err) => {
    if (err) {
      logger.error('关闭服务器失败:', err);
      process.exit(1);
    }
    
    logger.info('服务器已关闭');
    
    // 关闭数据库连接
    closeDatabase();
    
    process.exit(0);
  });
  
  // 强制关闭超时
  setTimeout(() => {
    logger.error('强制关闭服务器');
    closeDatabase();
    process.exit(1);
  }, 10000);
}

module.exports = app;