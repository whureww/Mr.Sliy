/**
 * 安全审计技能
 * 提供全面的安全审计功能，参考 auditor-skill
 */

const Skill = require('../Skill');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');

class SecurityAuditSkill extends Skill {
  constructor() {
    super(
      'security-audit',
      '安全审计技能 - 全面的代码安全审计',
      '1.0.0'
    );
    this.dependencies = ['code-detection'];
  }

  async init() {
    logger.info('安全审计技能初始化完成');
    return true;
  }

  canExecute(context = {}) {
    return this.enabled && (context.sourceCode || context.filePath || context.project);
  }

  async execute(context = {}) {
    const { sourceCode, filePath, project, options = {} } = context;

    if (!sourceCode && !filePath && !project) {
      throw new Error('请提供源代码、文件路径或项目信息');
    }

    const fs = require('fs');
    const path = require('path');
    const code = sourceCode || (filePath ? fs.readFileSync(filePath, 'utf-8') : '');
    const language = options.language || getFileLanguage(filePath || '');

    if (project) {
      return this._auditProject(project, options);
    }

    return this._auditCode(code, filePath || 'unknown', language);
  }

  async auditCode(sourceCode, language = 'javascript') {
    return this._auditCode(sourceCode, 'unknown', language);
  }

  async auditProject(projectPath, options = {}) {
    return this._auditProject(projectPath, options);
  }

  async generateAuditReport(results, options = {}) {
    return this._generateReport(results, options);
  }

  async _auditCode(sourceCode, filePath, language) {
    const startTime = Date.now();

    try {
      const findings = [];

      // 安全漏洞检测
      const securityDetection = require('./code-analysis/securityDetection');
      const securityResult = await securityDetection.execute({ sourceCode, language });
      
      if (securityResult.success && securityResult.issues) {
        findings.push(...securityResult.issues.map(issue => ({
          category: 'security_vulnerability',
          ...issue
        })));
      }

      // 代码质量检测
      const codeDetection = require('./code-detection');
      const detectionResult = await codeDetection.execute({ sourceCode, language });
      
      if (detectionResult.success && detectionResult.issues) {
        const highSeverity = detectionResult.issues.filter(i => i.severity === 'critical' || i.severity === 'high');
        findings.push(...highSeverity.map(issue => ({
          category: 'code_quality',
          ...issue
        })));
      }

      // 性能问题检测
      const performanceOptimization = require('./code-analysis/performanceOptimization');
      const performanceResult = await performanceOptimization.execute({ sourceCode, language });
      
      if (performanceResult.success && performanceResult.issues) {
        const highSeverity = performanceResult.issues.filter(i => i.severity === 'critical' || i.severity === 'high');
        findings.push(...highSeverity.map(issue => ({
          category: 'performance',
          ...issue
        })));
      }

      // 复杂度分析
      const complexityAnalysis = require('./code-analysis/complexityAnalysis');
      const complexityResult = await complexityAnalysis.execute({ sourceCode, language });
      
      if (complexityResult.success) {
        const cyclomatic = complexityResult.cyclomaticComplexity;
        if (cyclomatic.overallStatus.level === 'critical') {
          findings.push({
            category: 'complexity',
            severity: 'critical',
            title: '代码复杂度极高',
            description: '高复杂度代码更容易出现安全漏洞',
            functions: cyclomatic.functions.filter(f => f.status.level === 'critical')
          });
        }
      }

      // LLM深度分析
      const deepAnalysis = await this._deepSecurityAnalysis(sourceCode, language);
      if (deepAnalysis.findings) {
        findings.push(...deepAnalysis.findings);
      }

      const severityCounts = {
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: findings.filter(f => f.severity === 'low').length
      };

      return {
        success: true,
        filePath,
        language,
        totalFindings: findings.length,
        severityCounts,
        findings: findings.sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        }),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`安全审计失败: ${filePath}`, error);
      return {
        success: false,
        message: error.message,
        filePath,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _auditProject(projectPath, options) {
    const startTime = Date.now();

    try {
      const fs = require('fs');
      const path = require('path');
      const { scanExtensions, excludeDirs, excludeFiles } = require('../../config').config.scan;

      const files = this._collectFiles(projectPath, scanExtensions, excludeDirs, excludeFiles);
      const allFindings = [];
      const summary = {
        totalFiles: files.length,
        auditedFiles: 0,
        totalFindings: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0 }
      };

      for (const file of files) {
        try {
          const sourceCode = fs.readFileSync(file, 'utf-8');
          const relPath = path.relative(projectPath, file);
          const language = getFileLanguage(file);

          const result = await this._auditCode(sourceCode, relPath, language);
          
          if (result.success) {
            summary.auditedFiles++;
            summary.totalFindings += result.totalFindings;
            summary.severityCounts.critical += result.severityCounts.critical;
            summary.severityCounts.high += result.severityCounts.high;
            summary.severityCounts.medium += result.severityCounts.medium;
            summary.severityCounts.low += result.severityCounts.low;
            
            allFindings.push({
              file: relPath,
              language,
              ...result
            });
          }
        } catch (error) {
          logger.debug(`审计文件失败: ${file}`, error.message);
        }
      }

      return {
        success: true,
        projectPath,
        summary,
        findings: allFindings,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error(`项目安全审计失败: ${projectPath}`, error);
      return {
        success: false,
        message: error.message,
        projectPath,
        durationMs: Date.now() - startTime
      };
    }
  }

  async _deepSecurityAnalysis(sourceCode, language) {
    try {
      const llmProvider = require('../../services/llm/providers').getCurrentProvider();
      
      const prompt = `你是一个专业的安全审计专家。请对以下${language}代码进行深度安全分析：

代码：
\`\`\`${language}
${sourceCode}
\`\`\`

请检查以下安全领域：
1. 输入验证和过滤
2. 认证和授权
3. 会话管理
4. 敏感数据处理
5. 错误处理和日志
6. SQL注入/XSS/CSRF
7. 文件操作安全
8. 并发和竞态条件

请输出发现的安全问题，格式为JSON数组：
[{
  "severity": "critical|high|medium|low",
  "title": "问题标题",
  "description": "问题描述",
  "suggestion": "修复建议"
}]`;

      const response = await llmProvider.complete(prompt, {
        maxTokens: 3000,
        temperature: 0.2
      });

      const jsonMatch = response.content.match(/\[.*\]/s);
      if (jsonMatch) {
        return {
          findings: JSON.parse(jsonMatch[0]).map(f => ({
            category: 'deep_analysis',
            ...f
          }))
        };
      }

      return { findings: [] };
    } catch (error) {
      logger.debug('深度安全分析失败:', error.message);
      return { findings: [] };
    }
  }

  async _generateReport(results, options) {
    const startTime = Date.now();

    try {
      let report = '# 安全审计报告\n\n';
      report += `生成时间: ${new Date().toISOString()}\n\n`;
      
      if (results.summary) {
        report += `## 审计摘要\n\n`;
        report += `- 项目路径: ${results.projectPath}\n`;
        report += `- 总文件数: ${results.summary.totalFiles}\n`;
        report += `- 已审计文件: ${results.summary.auditedFiles}\n`;
        report += `- 发现问题总数: ${results.summary.totalFindings}\n`;
        report += `- 严重级别分布:\n`;
        report += `  - 严重(Critical): ${results.summary.severityCounts.critical}\n`;
        report += `  - 高(High): ${results.summary.severityCounts.high}\n`;
        report += `  - 中(Medium): ${results.summary.severityCounts.medium}\n`;
        report += `  - 低(Low): ${results.summary.severityCounts.low}\n`;
      }

      if (results.findings) {
        report += `\n## 发现的问题\n\n`;
        
        const critical = results.findings.filter(f => f.severity === 'critical');
        const high = results.findings.filter(f => f.severity === 'high');
        const medium = results.findings.filter(f => f.severity === 'medium');
        const low = results.findings.filter(f => f.severity === 'low');

        const groups = [
          { title: '严重问题 (Critical)', items: critical },
          { title: '高风险问题 (High)', items: high },
          { title: '中等风险问题 (Medium)', items: medium },
          { title: '低风险问题 (Low)', items: low }
        ];

        for (const group of groups) {
          if (group.items.length > 0) {
            report += `### ${group.title}\n\n`;
            group.items.forEach((item, index) => {
              report += `${index + 1}. **${item.title}**\n`;
              report += `   - 位置: ${item.file || item.line || '未知'}\n`;
              report += `   - 描述: ${item.description}\n`;
              if (item.suggestion) {
                report += `   - 建议: ${item.suggestion}\n`;
              }
              report += '\n';
            });
          }
        }
      }

      report += `\n## 建议\n\n`;
      report += '根据审计结果，建议采取以下措施：\n';
      report += '1. 优先修复严重和高风险问题\n';
      report += '2. 定期进行安全审计\n';
      report += '3. 实施安全编码规范\n';

      return {
        success: true,
        report,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      logger.error('审计报告生成失败', error);
      return {
        success: false,
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  _collectFiles(dirPath, extensions, excludeDirs, excludeFiles) {
    const fs = require('fs');
    const path = require('path');
    const files = [];

    function scanDirectory(currentPath) {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext) && !excludeFiles.some(ef => entry.name.endsWith(ef))) {
            files.push(fullPath);
          }
        }
      }
    }

    scanDirectory(dirPath);
    return files;
  }
}

const securityAuditSkill = new SecurityAuditSkill();

module.exports = securityAuditSkill;
