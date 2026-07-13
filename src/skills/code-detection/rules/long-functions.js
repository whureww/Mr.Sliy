const { getNodesByType } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'long_functions',
  name: '过长函数检测',
  description: '检测行数超过阈值的函数',
  category: 'code-smell',
  defaultSeverity: 'medium'
};

const DEFAULT_THRESHOLD = 50;

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];
  const threshold = ruleConfig.threshold || DEFAULT_THRESHOLD;

  try {
    const functionDeclarations = getNodesByType(tree.rootNode, 'function_declaration');

    functionDeclarations.forEach(funcDecl => {
      const funcLines = funcDecl.endPosition.row - funcDecl.startPosition.row + 1;

      if (funcLines > threshold) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'long_function',
          severity: ruleConfig.severity || meta.defaultSeverity,
          message: `函数过长(${funcLines}行)，建议拆分`,
          suggestion: '将长函数拆分为多个小函数，每个函数负责单一职责',
          lineStart: funcDecl.startPosition.row + 1,
          lineEnd: funcDecl.endPosition.row + 1,
          columnStart: funcDecl.startPosition.column,
          columnEnd: funcDecl.endPosition.column,
          codeSnippet: funcDecl.text.substring(0, 100),
          astNodeType: 'function_declaration',
          metadata: {
            lineCount: funcLines,
            threshold
          }
        });
      }
    });
  } catch (error) {
    console.error('检测过长函数失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
