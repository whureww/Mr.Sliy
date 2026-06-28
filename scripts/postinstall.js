/**
 * 安装后脚本
 * 用于自动初始化数据库和下载WASM文件
 */

const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkAndCreateEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  const envExamplePath = path.join(__dirname, '../.env.example');

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
      log('📝 检测到 .env.example，正在创建 .env...', 'yellow');
      fs.copyFileSync(envExamplePath, envPath);
      log('✅ .env 文件已创建', 'green');
      log('⚠️  请编辑 .env 文件，配置您的 API Key', 'yellow');
    }
  }
}

function initializeDatabase() {
  return new Promise((resolve) => {
    const dbPath = path.join(__dirname, '../database/code_optimizer.db');

    if (fs.existsSync(dbPath)) {
      log('📦 数据库已存在，跳过初始化', 'blue');
      
      // 尝试导入知识库（合并模式）
      const knowledgeExportPath = path.join(__dirname, '../data/knowledge-export.json');
      if (fs.existsSync(knowledgeExportPath)) {
        log('📚 正在导入知识库数据...', 'yellow');
        try {
          const { knowledgeBase } = require('../src/services/vector/knowledgeBase.js');
          knowledgeBase.init();
          const result = knowledgeBase.importFromFile(knowledgeExportPath, { merge: true, skipExisting: true });
          log(`✅ 知识库导入完成 (新增 ${result.importedEntries} 条知识, ${result.importedCases} 个案例)`, 'green');
        } catch (error) {
          log(`⚠️  知识库导入失败: ${error.message}`, 'yellow');
        }
      }
      
      resolve();
      return;
    }

    log('🗄️  正在初始化数据库...', 'yellow');

    try {
      const { initDatabase } = require('../database/init.js');
      initDatabase();
      log('✅ 数据库初始化完成', 'green');
      
      // 导入知识库数据
      const knowledgeExportPath = path.join(__dirname, '../data/knowledge-export.json');
      if (fs.existsSync(knowledgeExportPath)) {
        log('📚 正在导入知识库数据...', 'yellow');
        const { knowledgeBase } = require('../src/services/vector/knowledgeBase.js');
        knowledgeBase.init();
        const result = knowledgeBase.importFromFile(knowledgeExportPath, { merge: false });
        log(`✅ 知识库导入完成 (${result.importedEntries} 条知识, ${result.importedCases} 个案例)`, 'green');
      } else {
        log('🌱 正在初始化默认知识库...', 'yellow');
        const { knowledgeBase } = require('../src/services/vector/knowledgeBase.js');
        knowledgeBase.init();
        knowledgeBase.seedDefaultKnowledge();
        const stats = knowledgeBase.getStats();
        log(`✅ 知识库初始化完成 (${stats.totalEntries}条知识, ${stats.totalCases}个案例)`, 'green');
      }
      
      resolve();
    } catch (error) {
      log(`⚠️  数据库初始化失败: ${error.message}`, 'yellow');
      log('   请手动运行: npm run init && npm run seed', 'yellow');
      resolve();
    }
  });
}

async function downloadWasmFiles() {
  try {
    const pkgDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    const outDir = path.join(pkgDir, 'out');
    
    if (fs.existsSync(outDir)) {
      const wasmFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.wasm'));
      if (wasmFiles.length > 0) {
        log(`✅ WASM文件已就绪 (${wasmFiles.length} 个语言解析器)`, 'green');
        return;
      }
    }
  } catch (e) {
    // ignore
  }

  log('⚠️  tree-sitter-wasms包未找到，WASM文件可能不可用', 'yellow');
  log('   请确保已安装依赖: npm install', 'yellow');
}

async function main() {
  log('\n🔧 Mr.Sliy 安装后配置...\n', 'bright');

  try {
    checkAndCreateEnvFile();
    await initializeDatabase();
    await downloadWasmFiles();

    log('\n🎉 安装完成！', 'green');
    log('\n🚀 快速开始:', 'green');
    log('   mr-sliy', 'yellow');
    log('\n📋 首次使用:', 'blue');
    log('   1. 运行 mr-sliy 启动智能体', 'blue');
    log('   2. 输入 /provider 进入提供商管理', 'blue');
    log('   3. 选择 2) 注册新提供商，输入 API Key', 'blue');
    log('   4. 选择 1) 切换到新注册的提供商', 'blue');
    log('   5. 开始使用 AI 功能！', 'blue');
    log('\n💡 支持的提供商:', 'blue');
    log('   deepseek, zhipu, tongyi, openai, moonshot, claude 等', 'yellow');
    log('\n');
  } catch (error) {
    log(`\n❌ 安装后配置失败: ${error.message}`, 'red');
    process.exit(1);
  }
}

main();
