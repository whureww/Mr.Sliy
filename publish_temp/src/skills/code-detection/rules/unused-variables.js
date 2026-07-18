const { getNodesByType } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'unused_variables',
  name: '未使用变量检测',
  description: '检测已声明但从未使用的变量',
  category: 'code-smell',
  defaultSeverity: 'medium'
};

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];

  try {
    const variableDeclarations = getNodesByType(tree.rootNode, 'variable_declarator');
    const identifiers = getNodesByType(tree.rootNode, 'identifier');

    variableDeclarations.forEach(varDecl => {
      const varName = varDecl.text.split('=')[0].trim();

      const isUsed = identifiers.some(id => {
        return id.text === varName &&
               (id.startPosition.row !== varDecl.startPosition.row ||
                id.startPosition.column !== varDecl.startPosition.column);
      });

      if (!isUsed) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'unused_variable',
          severity: ruleConfig.severity || meta.defaultSeverity,
          message: `变量"${varName}"已声明但从未使用`,
          suggestion: '删除未使用的变量或根据需要使用它',
          lineStart: varDecl.startPosition.row + 1,
          lineEnd: varDecl.endPosition.row + 1,
          columnStart: varDecl.startPosition.column,
          columnEnd: varDecl.endPosition.column,
          codeSnippet: varDecl.text,
          astNodeType: 'variable_declarator'
        });
      }
    });
  } catch (error) {
    console.error('检测未使用变量失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
