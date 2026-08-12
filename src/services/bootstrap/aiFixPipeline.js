/**
 * AI 自动修复管道
 * 职责：错误上下文采集 → LLM 分析 → 生成补丁 → 定位受影响的沙箱服务
 * 不直接修改文件，由 SandboxTrialRunner 沙箱内应用
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { generateUUID } = require('../../utils/helpers');
const { providerManager } = require('../llm/providers');

// 5 个沙箱服务和其包含的路径
const SERVICE_FILE_MAP = {
  parser:    ['src/sandbox/services/parserService.js', 'src/workers/parser.js'],
  detector:  ['src/sandbox/services/detectorService.js', 'src/services/detection/detector.js'],
  optimizer: ['src/sandbox/services/optimizerService.js', 'src/services/optimization/optimizer.js'],
  knowledge: ['src/sandbox/services/knowledgeService.js', 'src/services/vector/knowledgeBase.js'],
  llm:       ['src/sandbox/services/llmService.js', 'src/services/llm/provider.js', 'src/services/llm/providers.js']
};

class AIFixPipeline {
  constructor() {
    this.maxAIIterations = 5;
    this.cacheDir = path.join(process.cwd(), '.cache', 'ai_fix');
    this._ensureCacheDir();
  }

  _ensureCacheDir() {
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch (_) {}
  }

  /**
   * 根据错误栈解析出发生错误的源文件及行号
   */
  extractErrorLocation(error) {
    const result = { files: [], lines: [] };
    if (!error.stack) return result;

    const regex = /\(([^)]+\.js):(\d+):\d+\)/g;
    const cwd = process.cwd();
    let m;
    while ((m = regex.exec(error.stack)) !== null) {
      let file = m[1];
      if (!path.isAbsolute(file)) file = path.resolve(cwd, file);
      if (file.startsWith(cwd)) {
        const rel = path.relative(cwd, file).replace(/\\/g, '/');
        if (!result.files.includes(rel)) result.files.push(rel);
        result.lines.push({ file: rel, line: parseInt(m[2], 10) });
      }
    }
    return result;
  }

  /**
   * 根据错误定位受影响的沙箱服务
   */
  detectAffectedServices(error) {
    const loc = this.extractErrorLocation(error);
    const allFiles = [...loc.files];
    if (error.message) {
      const match = error.message.match(/([\w/]+\.js)/);
      if (match && !allFiles.includes(match[1])) allFiles.push(match[1]);
    }
    const affected = new Set();
    for (const file of allFiles) {
      for (const [svc, patterns] of Object.entries(SERVICE_FILE_MAP)) {
        if (patterns.some(p => file === p || file.includes(p.replace(/\.js$/, '')))) {
          affected.add(svc);
        }
      }
    }
    // runtime/dependency 错误默认尝试包含整个 sandbox service 列表
    if (affected.size === 0) affected.add('parser').add('detector').add('optimizer').add('knowledge').add('llm');
    return { services: Array.from(affected), files: loc };
  }

  /**
   * 读取堆栈相关文件片段（最多前后 20 行）
   */
  readContextSnippets(error, loc) {
    const lines = loc.lines.slice(0, 3); // 最多取3处
    const snippets = [];
    for (const ref of lines) {
      try {
        const full = path.join(process.cwd(), ref.file);
        if (!fs.existsSync(full)) continue;
        const content = fs.readFileSync(full, 'utf-8').split(/\r?\n/);
        const start = Math.max(0, ref.line - 21);
        const end = Math.min(content.length, ref.line + 20);
        const piece = [];
        for (let i = start; i < end; i++) {
          piece.push(`${String(i + 1).padStart(4)}: ${content[i]}`);
        }
        snippets.push({ file: ref.file, centerLine: ref.line, code: piece.join('\n') });
      } catch (_) {}
    }
    return snippets;
  }

  /**
   * 调用 LLM 生成修复方案（返回补丁，不直接应用）
   */
  async generateFix(error, affectedInfo, lastFailure = null, iteration = 1) {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      return { success: false, error: '未配置可用LLM提供商', recoverable: false };
    }

    const loc = affectedInfo.files;
    const snippets = this.readContextSnippets(error, loc);

    const targetHint =
      affectedInfo.services.length === 1
        ? `受影响的沙箱服务: ${affectedInfo.services[0]}。只修改与此服务关联的文件，不要动核心文件。`
        : `可能受影响的沙箱服务: ${affectedInfo.services.join(', ')}。优先修复位于 src/sandbox/services/ 或 src/workers/ 下的文件。`;

    let lastFailureHint = '';
    if (lastFailure) {
      lastFailureHint = `

上一轮修复失败的原因: ${lastFailure.reason || '未知'}
上一轮修复补丁（如果有）: ${lastFailure.patchSummary || '无'}
请参考失败原因重新分析并生成不同的修复方案。`;
    }

    const prompt = `你是系统自动修复专家。根据以下运行时错误信息生成修复补丁。

错误摘要:
- Type: ${this._classify(error)}
- Message: ${error.message}
- Stack:
${error.stack ? error.stack.substring(0, 1200) : 'N/A'}
${lastFailureHint}

相关文件（错误堆栈路径）:
${loc.files.length === 0 ? '未识别' : loc.files.join(', ')}
${loc.files.map(f => `- ${f}`).join('\n')}

源代码上下文 (错误位置前后20行):
${snippets.length === 0 ? '无' : snippets.map(s => `\n== ${s.file} L${s.centerLine} ==\n${s.code}`).join('\n')}

${targetHint}

重要约束:
1. 只修改 src/sandbox/services/, src/workers/, src/services/optimization/, src/services/detection/, src/services/vector/, src/services/llm/ 下的文件
2. 不要修改 src/index.js, src/agent/agent.js, src/config/ 等核心配置文件
3. 修复必须安全，不能引入破坏性改动（如删除整个文件、大范围重构）
4. 如果错误原因不明确，请在补丁中增加更详细的 try-catch 错误捕获和日志，而不是猜测逻辑

请严格只返回 JSON（不要 markdown 包裹）：
{
  "summary": "对错误根因的一句话分析",
  "affectedService": "parser/detector/optimizer/knowledge/llm 之一，选最直接的",
  "patches": [
    {
      "file": "相对路径",
      "type": "replace",
      "oldString": "精确匹配的要替换的旧代码块（至少3行以保证唯一）",
      "newString": "替换后的新代码"
    },
    {
      "file": "相对路径",
      "type": "append",
      "newString": "在文件末尾追加的代码"
    }
  ],
  "smokeTests": [
    {
      "service": "parser",
      "action": "parse",
      "params": { "code": "function hello() { return 42; }", "language": "javascript" },
      "description": "解析一段 JS 代码"
    }
  ]
}

只返回 JSON，不要任何额外文本。`;

    try {
      const result = await provider.chat([{ role: 'user', content: prompt }], { temperature: iteration > 1 ? 0.6 : 0.3 });
      let raw = result.content;
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
      const payload = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : raw);

      // 合法性校验
      if (!payload || !Array.isArray(payload.patches)) {
        return { success: false, error: 'AI 返回格式缺少 patches 数组' };
      }
      if (payload.patches.length > 10) {
        return { success: false, error: `补丁数目过多 (${payload.patches.length})，拒绝应用` };
      }
      if (!payload.affectedService || !SERVICE_FILE_MAP[payload.affectedService]) {
        payload.affectedService = affectedInfo.services[0] || 'parser';
      }
      payload.pipelineId = generateUUID();
      return { success: true, data: payload };
    } catch (e) {
      logger.error(`[AIFixPipeline] LLM 生成修复失败 (第${iteration}轮): ${e.message}`);
      return { success: false, error: `AI响应解析失败: ${e.message}` };
    }
  }

  _classify(error) {
    const errorCategories = {
      database: ['SQLITE_ERROR', 'connection_error', 'table_not_found'],
      network: ['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'],
      file_system: ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EMFILE'],
      dependency: ['MODULE_NOT_FOUND', 'require failed'],
      configuration: ['config_error', 'missing_config', 'invalid_config'],
      runtime: ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError']
    };
    const msg = error.message || '';
    const code = error.code || '';
    const name = error.name || '';
    for (const [k, ps] of Object.entries(errorCategories)) {
      for (const p of ps) if (code.includes(p) || msg.includes(p) || name.includes(p)) return k;
    }
    return 'runtime';
  }
}

const aiFixPipeline = new AIFixPipeline();

module.exports = { AIFixPipeline, aiFixPipeline, SERVICE_FILE_MAP };
