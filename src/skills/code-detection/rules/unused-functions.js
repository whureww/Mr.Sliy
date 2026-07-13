const { getNodesByType } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'unused_functions',
  name: '未使用函数检测',
  description: '检测已定义但从未被调用的函数',
  category: 'code-smell',
  defaultSeverity: 'high'
};

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];

  try {
    const functionDeclarations = getNodesByType(tree.rootNode, 'function_declaration');
    const identifiers = getNodesByType(tree.rootNode, 'identifier');

    functionDeclarations.forEach(funcDecl => {
      const funcNameMatch = funcDecl.text.match(/function\s+(\w+)\s*\(/);

      if (funcNameMatch) {
        const funcName = funcNameMatch[1];

        const isCalled = identifiers.some(id =>
          id.text === funcName &&
          id.startPosition.row !== funcDecl.startPosition.row
        );

        if (!isCalled) {
          issues.push({
            id: generateUUID(),
            filePath,
            fileName: filePath.split(/[/\\]/).pop(),
            language: getFileLanguage(filePath),
            issueType: 'unused_function',
            severity: ruleConfig.severity || meta.defaultSeverity,
            message: `函数"${funcName}"已定义但从未被调用`,
            suggestion: '删除未使用的函数或确认是否应该在代码中使用它',
            lineStart: funcDecl.startPosition.row + 1,
            lineEnd: funcDecl.endPosition.row + 1,
            columnStart: funcDecl.startPosition.column,
            columnEnd: funcDecl.endPosition.column,
            codeSnippet: funcDecl.text.substring(0, 100),
            astNodeType: 'function_declaration'
          });
        }
      }
    });
  } catch (error) {
    console.error('检测未使用函数失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
