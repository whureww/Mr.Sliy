const { detectIssues, batchDetect } = require('../../services/detection/detector');

class DetectorService {
  constructor(context) {
    this.name = context.name;
    this.version = context.version;
    this.logger = context.logger;
    this.postMessage = context.postMessage;
    this.isInitialized = false;
    this.detectCount = 0;
    this.errorCount = 0;
  }

  async init() {
    this.logger.info(`[${this.name}] 问题检测服务初始化中...`);
    this.isInitialized = true;
    this.logger.info(`[${this.name}] 问题检测服务初始化完成`);
  }

  async detect(params) {
    const { code, language, options } = params;
    this.detectCount++;
    
    try {
      const result = await detectIssues(code, language, options || {});
      return result;
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 检测失败: ${error.message}`);
      throw error;
    }
  }

  async batchDetect(params) {
    const { files, options } = params;
    this.detectCount += files.length;
    
    try {
      const results = await batchDetect(files, options || {});
      return results;
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 批量检测失败: ${error.message}`);
      throw error;
    }
  }

  async detectFile(params) {
    const { filePath, options } = params;
    const fs = require('fs');
    const path = require('path');
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    
    const code = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).slice(1);
    const languageMap = {
      js: 'javascript', ts: 'typescript', py: 'python',
      java: 'java', go: 'go', rs: 'rust', c: 'c',
      cpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
      swift: 'swift', kt: 'kotlin', vue: 'vue'
    };
    const language = languageMap[ext] || 'javascript';
    
    return await this.detect({ code, language, options });
  }

  async scanProject(params) {
    const { projectPath, maxFiles = 100, options } = params;
    const fs = require('fs');
    const path = require('path');
    
    if (!fs.existsSync(projectPath)) {
      throw new Error(`项目路径不存在: ${projectPath}`);
    }
    
    const files = [];
    const extensions = ['.js', '.ts', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.rb', '.php', '.swift', '.kt', '.vue'];
    
    function scanDir(dir, depth = 0) {
      if (depth > 5 || files.length >= maxFiles) return;
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              scanDir(fullPath, depth + 1);
            }
          } else if (extensions.includes(path.extname(entry.name))) {
            files.push(fullPath);
          }
          if (files.length >= maxFiles) break;
        }
      } catch (e) {
      }
    }
    
    scanDir(projectPath);
    
    const results = [];
    for (const file of files) {
      try {
        const code = fs.readFileSync(file, 'utf-8');
        const ext = path.extname(file).slice(1);
        const languageMap = {
          js: 'javascript', ts: 'typescript', py: 'python',
          java: 'java', go: 'go', rs: 'rust', c: 'c',
          cpp: 'cpp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', vue: 'vue'
        };
        const language = languageMap[ext] || 'javascript';
        const result = await detectIssues(code, language, options || {});
        results.push({ filePath: file, ...result });
      } catch (error) {
        results.push({ filePath: file, success: false, error: error.message });
      }
    }
    
    return {
      totalFiles: files.length,
      scannedFiles: results.length,
      results
    };
  }

  getHealth() {
    return {
      status: 'ok',
      initialized: this.isInitialized,
      detectCount: this.detectCount,
      errorCount: this.errorCount,
      memory: process.memoryUsage()
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] 问题检测服务关闭`);
    this.isInitialized = false;
  }

  async onHotReload(config) {
    this.logger.info(`[${this.name}] 热重载配置`);
  }
}

module.exports = DetectorService;
