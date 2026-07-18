const { getNodesByType } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'unused_imports',
  name: '未使用导入检测',
  description: '检测已声明但从未使用的导入',
  category: 'code-smell',
  defaultSeverity: 'low'
};

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];

  try {
    const importStatements = getNodesByType(tree.rootNode, 'import_statement');
    const identifiers = getNodesByType(tree.rootNode, 'identifier');

    importStatements.forEach(importStmt => {
      const importMatch = importStmt.text.match(/import\s+(\w+)\s+from/);

      if (importMatch) {
        const importedName = importMatch[1];

        const isUsed = identifiers.some(id =>
          id.text === importedName &&
          id.startPosition.row !== importStmt.startPosition.row
        );

        if (!isUsed) {
          issues.push({
            id: generateUUID(),
            filePath,
            fileName: filePath.split(/[/\\]/).pop(),
            language: getFileLanguage(filePath),
            issueType: 'unused_import',
            severity: ruleConfig.severity || meta.defaultSeverity,
            message: `导入"${importedName}"已声明但从未使用`,
            suggestion: '删除未使用的导入以减少打包体积',
            lineStart: importStmt.startPosition.row + 1,
            lineEnd: importStmt.endPosition.row + 1,
            columnStart: importStmt.startPosition.column,
            columnEnd: importStmt.endPosition.column,
            codeSnippet: importStmt.text,
            astNodeType: 'import_statement'
          });
        }
      }
    });
  } catch (error) {
    console.error('检测未使用导入失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
