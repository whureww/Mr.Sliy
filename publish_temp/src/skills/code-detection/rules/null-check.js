const { getNodesByType, traverseAST } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'null_check',
  name: '空值检查检测',
  description: '检测函数参数缺少空值检查的情况',
  category: 'bug-risk',
  defaultSeverity: 'high'
};

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];

  try {
    const functionDeclarations = getNodesByType(tree.rootNode, 'function_declaration');

    functionDeclarations.forEach(funcDecl => {
      const identifiers = getNodesByType(funcDecl, 'identifier');
      const params = funcDecl.text.match(/function\s+\w+\s*\(([^)]*)\)/);

      if (params) {
        const paramNames = params[1].split(',').map(p => p.trim()).filter(p => p.length > 0);

        paramNames.forEach(param => {
          const paramUsages = identifiers.filter(id => id.text === param);
          if (paramUsages.length > 1) {
            let hasNullCheck = false;

            traverseAST(funcDecl, (node) => {
              if (node.type === 'if_statement') {
                if (node.text.includes(`!${param}`) || node.text.includes(`${param} !== null`) ||
                    node.text.includes(`${param} !== undefined`) || node.text.includes(`${param} != null`)) {
                  hasNullCheck = true;
                }
              }
            });

            if (!hasNullCheck && paramUsages.length > 2) {
              issues.push({
                id: generateUUID(),
                filePath,
                fileName: filePath.split(/[/\\]/).pop(),
                language: getFileLanguage(filePath),
                issueType: 'null_check',
                severity: ruleConfig.severity || meta.defaultSeverity,
                message: `参数"${param}"缺少空值检查`,
                suggestion: '添加空值检查以防止运行时错误',
                lineStart: funcDecl.startPosition.row + 1,
                lineEnd: funcDecl.endPosition.row + 1,
                columnStart: funcDecl.startPosition.column,
                columnEnd: funcDecl.endPosition.column,
                codeSnippet: funcDecl.text.substring(0, 100),
                astNodeType: 'function_declaration',
                metadata: {
                  paramName: param
                }
              });
            }
          }
        });
      }
    });
  } catch (error) {
    console.error('检测空值检查失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
