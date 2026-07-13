const { getNodesByType } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'console_log',
  name: 'console.log检测',
  description: '检测调试用的console.log语句',
  category: 'code-smell',
  defaultSeverity: 'low'
};

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];

  try {
    const callExpressions = getNodesByType(tree.rootNode, 'call_expression');

    callExpressions.forEach(callExpr => {
      if (callExpr.text.startsWith('console.log(')) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'console_log',
          severity: ruleConfig.severity || meta.defaultSeverity,
          message: '存在调试用的console.log',
          suggestion: '删除或替换为正式的日志记录',
          lineStart: callExpr.startPosition.row + 1,
          lineEnd: callExpr.endPosition.row + 1,
          columnStart: callExpr.startPosition.column,
          columnEnd: callExpr.endPosition.column,
          codeSnippet: callExpr.text.substring(0, 80),
          astNodeType: 'call_expression'
        });
      }
    });
  } catch (error) {
    console.error('检测console.log失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
