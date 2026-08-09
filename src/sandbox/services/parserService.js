const path = require('path');
const { parseCode } = require('../../workers/parser');

class ParserService {
  constructor(context) {
    this.name = context.name;
    this.version = context.version;
    this.logger = context.logger;
    this.postMessage = context.postMessage;
    this.isInitialized = false;
    this.parseCount = 0;
    this.errorCount = 0;
  }

  async init() {
    this.logger.info(`[${this.name}] 代码解析服务初始化中...`);
    this.isInitialized = true;
    this.logger.info(`[${this.name}] 代码解析服务初始化完成`);
  }

  async parse(params) {
    const { code, language } = params;
    this.parseCount++;
    
    try {
      const result = await parseCode(code, language);
      return result;
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 解析失败: ${error.message}`);
      throw error;
    }
  }

  async batchParse(params) {
    const { files } = params;
    const results = [];
    
    for (const file of files) {
      try {
        const result = await parseCode(file.content, file.language);
        results.push({ path: file.path, result, success: true });
      } catch (error) {
        results.push({ 
          path: file.path, 
          success: false, 
          error: error.message 
        });
      }
    }
    
    return { results, totalFiles: files.length, successful: results.filter(r => r.success).length };
  }

  async parseFile(params) {
    const { filePath } = params;
    const fs = require('fs');
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    const code = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).slice(1);
    const languageMap = {
      js: 'javascript', ts: 'typescript', py: 'python',
      java: 'java', go: 'go', rs: 'rust', c: 'c',
      cpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
      swift: 'swift', kt: 'kotlin', scala: 'scala',
      bash: 'bash', css: 'css', html: 'html', json: 'json',
      lua: 'lua', yaml: 'yaml', toml: 'toml', vue: 'vue'
    };
    const language = languageMap[ext] || 'javascript';
    
    return await this.parse({ code, language });
  }

  getHealth() {
    return {
      status: 'ok',
      initialized: this.isInitialized,
      parseCount: this.parseCount,
      errorCount: this.errorCount,
      memory: process.memoryUsage()
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] 代码解析服务关闭`);
    this.isInitialized = false;
  }

  async onHotReload(config) {
    this.logger.info(`[${this.name}] 热重载配置`);
  }
}

module.exports = ParserService;
