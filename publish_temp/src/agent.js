#!/usr/bin/env node
/**
 * Mr.Sliy - 多语言代码优化智能体
 * 基于 Tree-sitter 与 RAG 的智能检测优化系统
 * 
 * 使用方式:
 *   Mr.Sliy                    # 启动交互式CLI
 *   Mr.Sliy analyze <file>     # 分析单个文件
 *   Mr.Sliy scan <path>        # 扫描项目
 *   Mr.Sliy optimize           # 交互式优化
 */

const { startCLI } = require('./cli');
const { agent } = require('./agent/agent');

// 解析命令行参数
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  // 初始化Agent
  await agent.init();

  // 从环境变量加载提供商配置
  if (process.env.OPENAI_API_KEY) {
    agent.registerProvider('openai', {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4'
    });
  }

  if (process.env.CLAUDE_API_KEY) {
    agent.registerProvider('claude', {
      apiKey: process.env.CLAUDE_API_KEY,
      model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229'
    });
  }

  agent.registerProvider('ollama', {
    baseURL: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'codellama'
  });

  // 处理命令行命令
  switch (command) {
    case 'analyze':
      if (!args[1]) {
        console.error('用法: node src/agent.js analyze <文件路径>');
        process.exit(1);
      }
      {
        const result = await agent.analyzeFile(args[1]);
        console.log(JSON.stringify(result, null, 2));
      }
      break;

    case 'scan':
      if (!args[1]) {
        console.error('用法: node src/agent.js scan <项目路径>');
        process.exit(1);
      }
      {
        const result = await agent.analyzeProject(args[1]);
        console.log(JSON.stringify(result, null, 2));
      }
      break;

    case 'optimize':
      // 交互式优化，启动CLI中的优化流程
      startCLI();
      break;

    case 'status':
      console.log(JSON.stringify(agent.getStatus(), null, 2));
      break;

    default:
      // 无参数或未知命令，启动交互式CLI
      startCLI();
      break;
  }
}

main().catch(error => {
  console.error('Agent启动失败:', error);
  process.exit(1);
});
