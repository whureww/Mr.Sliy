const { getNodesByType } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'missing_comment',
  name: '缺少注释检测',
  description: '检测较长函数是否缺少注释说明',
  category: 'code-smell',
  defaultSeverity: 'low'
};

const DEFAULT_MIN_LINES = 10;

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];
  const minLines = ruleConfig.threshold || DEFAULT_MIN_LINES;

  try {
    const functionDeclarations = getNodesByType(tree.rootNode, 'function_declaration');

    functionDeclarations.forEach(funcDecl => {
      const funcLines = funcDecl.endPosition.row - funcDecl.startPosition.row + 1;
      if (funcLines > minLines) {
        const lineNum = funcDecl.startPosition.row;
        let hasComment = false;

        if (lineNum > 0) {
          const previousLine = sourceCode.split('\n')[lineNum - 1];
          if (previousLine.trim().startsWith('//') || previousLine.trim().startsWith('/**') || previousLine.trim().startsWith('/*')) {
            hasComment = true;
          }
        }

        if (!hasComment) {
          const funcNameMatch = funcDecl.text.match(/function\s+(\w+)/);
          const funcName = funcNameMatch ? funcNameMatch[1] : 'anonymous';

          issues.push({
            id: generateUUID(),
            filePath,
            fileName: filePath.split(/[/\\]/).pop(),
            language: getFileLanguage(filePath),
            issueType: 'missing_comment',
            severity: ruleConfig.severity || meta.defaultSeverity,
            message: `函数"${funcName}"缺少注释说明`,
            suggestion: '添加函数说明注释，提高代码可读性',
            lineStart: funcDecl.startPosition.row + 1,
            lineEnd: funcDecl.endPosition.row + 1,
            columnStart: funcDecl.startPosition.column,
            columnEnd: funcDecl.endPosition.column,
            codeSnippet: funcDecl.text.substring(0, 50),
            astNodeType: 'function_declaration'
          });
        }
      }
    });
  } catch (error) {
    console.error('检测缺少注释失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
