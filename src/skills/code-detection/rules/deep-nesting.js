const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'deep_nesting',
  name: '嵌套过深检测',
  description: '检测代码中嵌套层级过深的情况',
  category: 'code-smell',
  defaultSeverity: 'medium'
};

const DEFAULT_THRESHOLD = 4;

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];
  const threshold = ruleConfig.threshold || DEFAULT_THRESHOLD;

  try {
    const lines = sourceCode.split('\n');
    let maxDepth = 0;
    let deepLines = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const indentMatch = line.match(/^(\s+)/);
      const indentSpaces = indentMatch ? indentMatch[1].length : 0;
      const indentLevel = Math.floor(indentSpaces / 2);

      const currentDepth = indentLevel;

      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
      }

      if (currentDepth > threshold) {
        deepLines.push({
          line: index + 1,
          depth: currentDepth,
          text: trimmed.substring(0, 50)
        });
      }
    });

    if (maxDepth > threshold && deepLines.length > 0) {
      const firstDeepLine = deepLines[0];
      issues.push({
        id: generateUUID(),
        filePath,
        fileName: filePath.split(/[/\\]/).pop(),
        language: getFileLanguage(filePath),
        issueType: 'deep_nesting',
        severity: ruleConfig.severity || meta.defaultSeverity,
        message: `嵌套层级过深(最大${maxDepth}层，阈值${threshold}层)`,
        suggestion: '减少嵌套层级，提取内层逻辑为独立函数',
        lineStart: firstDeepLine.line,
        lineEnd: firstDeepLine.line,
        columnStart: 0,
        columnEnd: firstDeepLine.text.length,
        codeSnippet: firstDeepLine.text,
        astNodeType: 'deep_nesting',
        metadata: {
          maxDepth,
          threshold,
          deepLineCount: deepLines.length
        }
      });
    }
  } catch (error) {
    console.error('检测嵌套过深失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
