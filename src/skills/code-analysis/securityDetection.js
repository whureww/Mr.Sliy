/**
 * 代码安全检测技能
 * 检测常见的安全漏洞和代码安全问题
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');

class SecurityDetectionSkill extends Skill {
  constructor() {
    super(
      'security-detection',
      '代码安全检测技能 - 检测常见安全漏洞',
      '1.0.0'
    );
    this.dependencies = ['code-detection'];
  }

  async init() {
    logger.info('代码安全检测技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && (context.sourceCode || context.filePath);
  }

  async execute(context = {}) {
    const { sourceCode, filePath, options = {} } = context;

    if (!sourceCode && !filePath) {
      throw new Error('请提供源代码或文件路径');
    }

    const fs = require('fs');
    const code = sourceCode || fs.readFileSync(filePath, 'utf-8');
    const language = options.language || getFileLanguage(filePath || '');

    return this._detectSecurityIssues(code, filePath || 'unknown', language);
  }

  async detectXSSVulnerabilities(sourceCode) {
    const vulnerabilities = [];
    const patterns = [
      {
        name: '直接DOM插入',
        pattern: /innerHTML\s*=\s*[^=]/g,
        description: '直接使用 innerHTML 插入内容可能导致XSS攻击',
        severity: 'high',
        suggestion: '使用 textContent 替代 innerHTML，或对输入进行HTML转义'
      },
      {
        name: 'document.write',
        pattern: /document\.write\s*\(/g,
        description: '使用 document.write 可能导致XSS攻击',
        severity: 'high',
        suggestion: '使用 DOM API 替代 document.write'
      },
      {
        name: 'eval函数',
        pattern: /\beval\s*\(/g,
        description: '使用 eval 执行动态代码可能导致代码注入',
        severity: 'critical',
        suggestion: '避免使用 eval，改用更安全的方式处理动态逻辑'
      },
      {
        name: 'setTimeout/setInterval字符串参数',
        pattern: /setTimeout\s*\(\s*['"]/g,
        description: '使用字符串参数的 setTimeout/setInterval 可能导致代码注入',
        severity: 'medium',
        suggestion: '使用函数引用替代字符串参数'
      }
    ];

    for (const p of patterns) {
      let match;
      const regex = new RegExp(p.pattern);
      while ((match = regex.exec(sourceCode)) !== null) {
        const lineNum = sourceCode.substring(0, match.index).split('\n').length;
        vulnerabilities.push({
          type: 'xss',
          name: p.name,
          line: lineNum,
          severity: p.severity,
          description: p.description,
          suggestion: p.suggestion,
          code: this._extractCodeLine(sourceCode, match.index)
        });
      }
    }

    return vulnerabilities;
  }

  async detectSQLInjection(sourceCode) {
    const vulnerabilities = [];
    const patterns = [
      {
        name: '字符串拼接SQL',
        pattern: /sql\s*[\+=]\s*['"][^'"]*['"]\s*[\+]/g,
        description: '使用字符串拼接构建SQL语句可能导致SQL注入',
        severity: 'critical',
        suggestion: '使用参数化查询或预编译语句'
      },
      {
        name: '动态SQL构建',
        pattern: /SELECT|INSERT|UPDATE|DELETE.*\+.*['"]/gi,
        description: '动态构建SQL语句可能导致SQL注入',
        severity: 'high',
        suggestion: '使用ORM框架或参数化查询'
      }
    ];

    for (const p of patterns) {
      let match;
      const regex = new RegExp(p.pattern);
      while ((match = regex.exec(sourceCode)) !== null) {
        const lineNum = sourceCode.substring(0, match.index).split('\n').length;
        vulnerabilities.push({
          type: 'sql_injection',
          name: p.name,
          line: lineNum,
          severity: p.severity,
          description: p.description,
          suggestion: p.suggestion,
          code: this._extractCodeLine(sourceCode, match.index)
        });
      }
    }

    return vulnerabilities;
  }

  async detectHardcodedSecrets(sourceCode) {
    const vulnerabilities = [];
    const patterns = [
      {
        name: 'API密钥',
        pattern: /api[_-]?key|apiKey|API_KEY/i,
        valuePattern: /['"][A-Za-z0-9]{20,}['"]/g,
        description: '发现硬编码的API密钥',
        severity: 'critical',
        suggestion: '将密钥存储在环境变量或配置文件中'
      },
      {
        name: '密码',
        pattern: /password|passwd|secret/i,
        valuePattern: /['"][^'"]{6,}['"]/g,
        description: '发现硬编码的密码',
        severity: 'critical',
        suggestion: '使用环境变量或加密存储密码'
      },
      {
        name: '令牌',
        pattern: /token|auth[_-]?token|access[_-]?token/i,
        valuePattern: /['"][A-Za-z0-9._-]{10,}['"]/g,
        description: '发现硬编码的令牌',
        severity: 'high',
        suggestion: '使用安全的令牌管理方案'
      }
    ];

    for (const p of patterns) {
      if (p.pattern.test(sourceCode)) {
        const lines = sourceCode.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (p.pattern.test(lines[i])) {
            vulnerabilities.push({
              type: 'hardcoded_secret',
              name: p.name,
              line: i + 1,
              severity: p.severity,
              description: p.description,
              suggestion: p.suggestion,
              code: lines[i].trim()
            });
          }
        }
      }
    }

    return vulnerabilities;
  }

  async detectPathTraversal(sourceCode) {
    const vulnerabilities = [];
    const patterns = [
      {
        name: '路径遍历',
        pattern: /\.\.\/|\.\.\\/g,
        description: '检测到路径遍历攻击模式',
        severity: 'high',
        suggestion: '对用户输入进行路径验证和规范化'
      }
    ];

    for (const p of patterns) {
      let match;
      while ((match = p.pattern.exec(sourceCode)) !== null) {
        const lineNum = sourceCode.substring(0, match.index).split('\n').length;
        vulnerabilities.push({
          type: 'path_traversal',
          name: p.name,
          line: lineNum,
          severity: p.severity,
          description: p.description,
          suggestion: p.suggestion,
          code: this._extractCodeLine(sourceCode, match.index)
        });
      }
    }

    return vulnerabilities;
  }

  _extractCodeLine(sourceCode, index) {
    const lines = sourceCode.substring(0, index).split('\n');
    const currentLine = lines.length;
    const allLines = sourceCode.split('\n');
    return allLines[currentLine - 1]?.trim() || '';
  }

  async _detectSecurityIssues(sourceCode, filePath, language) {
    const startTime = Date.now();

    try {
      const xss = await this.detectXSSVulnerabilities(sourceCode);
      const sqlInjection = await this.detectSQLInjection(sourceCode);
      const secrets = await this.detectHardcodedSecrets(sourceCode);
      const pathTraversal = await this.detectPathTraversal(sourceCode);

      const allIssues = [...xss, ...sqlInjection, ...secrets, ...pathTraversal];
      
      const severityCounts = {
        critical: allIssues.filter(i => i.severity === 'critical').length,
        high: allIssues.filter(i => i.severity === 'high').length,
        medium: allIssues.filter(i => i.severity === 'medium').length,
        low: allIssues.filter(i => i.severity === 'low').length
      };

      return {
        success: true,
        filePath,
        language,
        totalIssues: allIssues.length,
        severityCounts,
        issues: allIssues,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`安全检测失败: ${filePath}`, error);
      return {
        success: false,
        message: error.message,
        filePath,
        durationMs: Date.now() - startTime
      };
    }
  }
}

const securityDetectionSkill = new SecurityDetectionSkill();

module.exports = securityDetectionSkill;
