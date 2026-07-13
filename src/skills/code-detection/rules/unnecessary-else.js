const { traverseAST } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'unnecessary_else',
  name: '不必要else检测',
  description: '检测return语句后不必要的else语句',
  category: 'code-smell',
  defaultSeverity: 'low'
};

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];

  try {
    traverseAST(tree.rootNode, (node) => {
      if (node.type === 'if_statement' && node.text.includes('else')) {
        const ifBody = node.text.split('else')[0];
        if (ifBody.includes('return ') || ifBody.includes('throw ')) {
          issues.push({
            id: generateUUID(),
            filePath,
            fileName: filePath.split(/[/\\]/).pop(),
            language: getFileLanguage(filePath),
            issueType: 'unnecessary_else',
            severity: ruleConfig.severity || meta.defaultSeverity,
            message: 'return后使用不必要的else',
            suggestion: '删除return后的else语句以简化代码',
            lineStart: node.startPosition.row + 1,
            lineEnd: node.endPosition.row + 1,
            columnStart: node.startPosition.column,
            columnEnd: node.endPosition.column,
            codeSnippet: node.text.substring(0, 80),
            astNodeType: 'if_statement'
          });
        }
      }
    });
  } catch (error) {
    console.error('检测不必要else失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
