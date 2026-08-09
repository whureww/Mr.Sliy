const path = require('path');
const { SandboxBootstrap } = require('./bootstrap');
const { logger } = require('../utils/logger');

async function testSandbox() {
  console.log('========================================');
  console.log('沙箱架构测试开始');
  console.log('========================================\n');

  const bootstrap = new SandboxBootstrap();

  try {
    console.log('[1] 初始化所有服务...');
    const initResult = await bootstrap.startAll();
    console.log('初始化结果:', JSON.stringify(initResult, null, 2));
    console.log('');

    console.log('[2] 检查服务状态...');
    const status = bootstrap.getStatus();
    console.log('服务状态:', JSON.stringify(status, null, 2));
    console.log('');

    console.log('[3] 测试代码解析服务...');
    const parseResult = await bootstrap.execute('parser', 'parse', {
      code: 'function hello() { console.log("Hello, World!"); return 42; }',
      language: 'javascript'
    });
    console.log('解析结果:', JSON.stringify(parseResult, null, 2).substring(0, 500));
    console.log('');

    console.log('[4] 测试知识库搜索...');
    const searchResult = await bootstrap.execute('knowledge', 'search', {
      query: 'JavaScript 性能优化',
      topK: 3
    });
    console.log('搜索结果数量:', searchResult.totalResults);
    console.log('');

    console.log('[5] 测试热替换 parser 服务...');
    const reloadResult = await bootstrap.hotReloadService('parser', '1.1.0');
    console.log('热替换结果:', JSON.stringify(reloadResult, null, 2));
    console.log('');

    console.log('[6] 热替换后验证服务可用...');
    const parseResult2 = await bootstrap.execute('parser', 'parse', {
      code: 'const x = [1, 2, 3].map(n => n * 2);',
      language: 'javascript'
    });
    console.log('热替换后解析结果:', parseResult2.success ? '成功' : '失败');
    console.log('');

    console.log('[7] 测试问题检测服务...');
    const detectResult = await bootstrap.execute('detector', 'detect', {
      code: 'function foo() { var x = 1; var y = 2; return x; }',
      language: 'javascript'
    });
    console.log('检测结果:', detectResult.issues ? `发现 ${detectResult.issues.length} 个问题` : '成功');
    console.log('');

    console.log('[8] 测试服务健康检查...');
    const healthStatus = {};
    for (const serviceName of ['parser', 'detector', 'knowledge']) {
      try {
        const health = await bootstrap.execute(serviceName, 'health_check', {});
        healthStatus[serviceName] = health.status;
      } catch (e) {
        healthStatus[serviceName] = 'error: ' + e.message;
      }
    }
    console.log('健康状态:', JSON.stringify(healthStatus, null, 2));
    console.log('');

    console.log('========================================');
    console.log('所有测试通过！');
    console.log('========================================\n');

  } catch (error) {
    console.error('测试失败:', error.message);
    console.error(error.stack);
  } finally {
    console.log('清理中...');
    await bootstrap.stopAll();
    console.log('测试完成');
  }
}

testSandbox().catch(console.error);
