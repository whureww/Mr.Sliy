const { parserPool } = require('./src/workers/pool');

async function main() {
  console.log('=== Worker Threads 优化测试 ===\n');

  try {
    console.log('1. 测试线程池状态...');
    const stats = parserPool.getPoolStats();
    console.log(`   ✓ 总线程数: ${stats.totalWorkers}`);
    console.log(`   ✓ 空闲线程数: ${stats.idleWorkers}`);
    console.log('');

    console.log('2. 测试解析简单代码...');
    const jsCode = `function hello() {
  console.log('Hello World');
}`;
    
    const result = await parserPool.parse(jsCode, 'javascript');
    console.log(`   ✓ 解析成功: ${result.success}`);
    console.log(`   ✓ 语言: ${result.language}`);
    console.log(`   ✓ 使用fallback: ${result.fallback}`);
    console.log(`   ✓ 根节点类型: ${result.rootNode.type}`);
    console.log('');

    console.log('3. 测试解析复杂代码...');
    const complexCode = `class Calculator {
  constructor() {
    this.result = 0;
  }
  
  add(a, b) {
    return a + b;
  }
  
  multiply(a, b) {
    return a * b;
  }
}`;

    const complexResult = await parserPool.parse(complexCode, 'javascript');
    console.log(`   ✓ 解析成功: ${complexResult.success}`);
    console.log(`   ✓ 根节点类型: ${complexResult.rootNode.type}`);
    console.log(`   ✓ 子节点数: ${complexResult.rootNode.children.length}`);
    console.log('');

    console.log('4. 测试并发解析...');
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      tasks.push(parserPool.parse(jsCode, 'javascript'));
    }

    const startTime = Date.now();
    const results = await Promise.all(tasks);
    const elapsed = Date.now() - startTime;

    console.log(`   ✓ 并发解析完成: ${results.length} 个任务`);
    console.log(`   ✓ 总耗时: ${elapsed}ms`);
    console.log(`   ✓ 平均耗时: ${Math.round(elapsed / results.length)}ms`);
    console.log('');

    console.log('5. 测试Python代码解析...');
    const pythonCode = `def fibonacci(n):
  if n <= 1:
    return n
  return fibonacci(n-1) + fibonacci(n-2)`;

    const pyResult = await parserPool.parse(pythonCode, 'python');
    console.log(`   ✓ 解析成功: ${pyResult.success}`);
    console.log(`   ✓ 使用fallback: ${pyResult.fallback}`);
    console.log('');

    console.log('6. 测试线程池状态...');
    const finalStats = parserPool.getPoolStats();
    console.log(`   ✓ 总线程数: ${finalStats.totalWorkers}`);
    console.log(`   ✓ 空闲线程数: ${finalStats.idleWorkers}`);
    console.log(`   ✓ 待处理任务数: ${finalStats.pendingTasks}`);
    console.log('');

    console.log('=== 所有测试通过！===');

    await parserPool.close();

  } catch (error) {
    console.error('\n测试失败:', error.message);
    console.error(error.stack);
    await parserPool.close();
    process.exit(1);
  }
}

main();