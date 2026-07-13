/**
 * 路由注册模块
 * 统一管理所有API路由
 */

const express = require('express');
const router = express.Router();

// 导入各业务模块路由
const userRoutes = require('./userRoutes');
const configRoutes = require('./configRoutes');
const projectRoutes = require('./projectRoutes');
const scanRoutes = require('./scanRoutes');
const issueRoutes = require('./issueRoutes');
const aiRoutes = require('./aiRoutes');
const reportRoutes = require('./reportRoutes');
const updateRoutes = require('./updateRoutes');

// 注册路由
router.use('/users', userRoutes);
router.use('/config', configRoutes);
router.use('/projects', projectRoutes);
router.use('/scan', scanRoutes);
router.use('/issues', issueRoutes);
router.use('/ai', aiRoutes);
router.use('/reports', reportRoutes);
router.use('/', updateRoutes);

// API文档路由
router.get('/docs', (req, res) => {
  res.json({
    success: true,
    code: 200,
    message: 'API文档',
    data: {
      endpoints: {
        users: {
          base: '/api/users',
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          description: '用户管理'
        },
        config: {
          base: '/api/config',
          methods: ['GET', 'PUT'],
          description: '系统配置'
        },
        projects: {
          base: '/api/projects',
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          description: '项目管理'
        },
        scan: {
          base: '/api/scan',
          methods: ['POST', 'GET'],
          description: '代码扫描'
        },
        issues: {
          base: '/api/issues',
          methods: ['GET', 'PUT'],
          description: '代码缺陷'
        },
        ai: {
          base: '/api/ai',
          methods: ['POST', 'GET'],
          description: 'AI优化'
        },
        reports: {
          base: '/api/reports',
          methods: ['GET', 'POST'],
          description: '报告管理'
        }
      }
    }
  });
});

module.exports = router;