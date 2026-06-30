/**
 * 沙箱执行模块
 * 在隔离环境中执行脚本和文件操作，防止对主系统造成影响
 * 包含超时机制、资源限制、权限控制等安全措施
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('../../utils/logger');

class Sandbox {
  constructor() {
    this.timeout = 30000;
    this.maxMemory = 256 * 1024 * 1024;
    this.allowedPaths = [process.cwd()];
    this.blockedCommands = ['rm', 'rmdir', 'del', 'format', 'shutdown', 'reboot'];
    this.sandboxDir = this.createSandboxDirectory();
  }

  createSandboxDirectory() {
    const dir = path.join(os.tmpdir(), 'ai-agent-sandbox', Date.now().toString());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async executeScript(scriptContent, options = {}) {
    const timeout = options.timeout || this.timeout;
    const memoryLimit = options.memoryLimit || this.maxMemory;

    return new Promise((resolve) => {
      const scriptPath = path.join(this.sandboxDir, `script_${Date.now()}.js`);
      fs.writeFileSync(scriptPath, scriptContent, 'utf-8');

      const child = spawn(process.execPath, [
        '--max-old-space-size', Math.floor(memoryLimit / (1024 * 1024)),
        scriptPath
      ], {
        cwd: this.sandboxDir,
        env: {
          ...process.env,
          NODE_ENV: 'sandbox',
          SANDBOX_MODE: 'true'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timeoutId = null;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        fs.unlinkSync(scriptPath);
        
        resolve({
          success: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        try { fs.unlinkSync(scriptPath); } catch {}
        
        resolve({
          success: false,
          exitCode: -1,
          error: error.message,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000);
        
        resolve({
          success: false,
          exitCode: -2,
          error: '脚本执行超时',
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      }, timeout);
    });
  }

  async executeFileOperation(filePath, operation, content, options = {}) {
    if (!this.isPathAllowed(filePath)) {
      return { success: false, error: '文件路径超出允许范围' };
    }

    const realPath = path.resolve(filePath);

    if (this.containsBlockedPath(realPath)) {
      return { success: false, error: '文件路径包含被阻止的目录' };
    }

    if (!options.skipBackup) {
      await this.createFileBackup(realPath);
    }

    try {
      switch (operation) {
        case 'write':
          fs.writeFileSync(realPath, content, 'utf-8');
          break;
        case 'append':
          fs.appendFileSync(realPath, content, 'utf-8');
          break;
        case 'replace':
          const existingContent = fs.readFileSync(realPath, 'utf-8');
          const replacedContent = existingContent.replace(options.pattern, content);
          fs.writeFileSync(realPath, replacedContent, 'utf-8');
          break;
        case 'create':
          fs.mkdirSync(path.dirname(realPath), { recursive: true });
          fs.writeFileSync(realPath, content, 'utf-8');
          break;
        default:
          return { success: false, error: `未知操作类型: ${operation}` };
      }

      return { success: true, filePath: realPath, operation };
    } catch (error) {
      if (!options.skipRollback) {
        await this.restoreFileBackup(realPath);
      }
      return { success: false, error: error.message };
    }
  }

  async executeCommand(command, args = [], options = {}) {
    const cmd = command.toLowerCase();
    
    if (this.blockedCommands.includes(cmd)) {
      return { success: false, error: '命令被阻止' };
    }

    const timeout = options.timeout || this.timeout;

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'sandbox',
          SANDBOX_MODE: 'true'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timeoutId = null;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          success: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          success: false,
          exitCode: -1,
          error: error.message,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000);
        
        resolve({
          success: false,
          exitCode: -2,
          error: '命令执行超时',
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      }, timeout);
    });
  }

  async runValidation(testScript) {
    const result = await this.executeScript(testScript);
    
    if (result.success) {
      logger.info('沙箱验证通过');
    } else {
      logger.warn('沙箱验证失败:', result.stderr);
    }

    return result;
  }

  isPathAllowed(filePath) {
    const realPath = path.resolve(filePath);
    return this.allowedPaths.some(allowedPath => 
      realPath.startsWith(path.resolve(allowedPath))
    );
  }

  containsBlockedPath(filePath) {
    const blockedPaths = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/root', 'C:\\Windows', 'C:\\Program Files'];
    return blockedPaths.some(blockedPath => filePath.includes(blockedPath));
  }

  async createFileBackup(filePath) {
    try {
      if (!fs.existsSync(filePath)) return;
      
      const backupPath = `${filePath}.bak.${Date.now()}`;
      fs.copyFileSync(filePath, backupPath);
      return backupPath;
    } catch (error) {
      logger.warn('创建文件备份失败:', error);
      return null;
    }
  }

  async restoreFileBackup(filePath) {
    try {
      const backups = fs.readdirSync(path.dirname(filePath))
        .filter(f => f.startsWith(path.basename(filePath)) && f.endsWith('.bak.'));
      
      if (backups.length === 0) return;
      
      const latestBackup = backups.sort().pop();
      const backupPath = path.join(path.dirname(filePath), latestBackup);
      fs.copyFileSync(backupPath, filePath);
      fs.unlinkSync(backupPath);
      return true;
    } catch (error) {
      logger.warn('恢复文件备份失败:', error);
      return false;
    }
  }

  cleanup() {
    try {
      fs.rmSync(this.sandboxDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn('清理沙箱目录失败:', error);
    }
  }
}

const sandbox = new Sandbox();

module.exports = {
  Sandbox,
  sandbox
};