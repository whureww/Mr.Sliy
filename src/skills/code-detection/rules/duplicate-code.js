const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'duplicate_code',
  name: '重复代码检测',
  description: '检测代码中重复的代码片段',
  category: 'code-smell',
  defaultSeverity: 'medium'
};

const DEFAULT_MIN_LINES = 3;

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];
  const minDuplicateLines = ruleConfig.threshold || DEFAULT_MIN_LINES;

  try {
    const lines = sourceCode.split('\n');
    const seenBlocks = new Map();

    for (let i = 0; i < lines.length - minDuplicateLines; i++) {
      const block = lines.slice(i, i + minDuplicateLines).join('\n').trim();
      if (block.length < 20) continue;

      const trimmed = block.replace(/\s+/g, '');
      if (seenBlocks.has(trimmed)) {
        const previousLine = seenBlocks.get(trimmed);
        if (i > previousLine + minDuplicateLines) {
          issues.push({
            id: generateUUID(),
            filePath,
            fileName: filePath.split(/[/\\]/).pop(),
            language: getFileLanguage(filePath),
            issueType: 'duplicate_code',
            severity: ruleConfig.severity || meta.defaultSeverity,
            message: `发现重复代码片段(第${previousLine + 1}行和第${i + 1}行)`,
            suggestion: '提取重复代码为独立函数或模块',
            lineStart: i + 1,
            lineEnd: i + minDuplicateLines,
            columnStart: 0,
            columnEnd: block.length,
            codeSnippet: block.substring(0, 100),
            astNodeType: 'duplicate_block'
          });
        }
      } else {
        seenBlocks.set(trimmed, i);
      }
    }
  } catch (error) {
    console.error('检测重复代码失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
