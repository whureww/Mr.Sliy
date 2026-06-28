const { getNodesByType } = require('../../../services/ast/parser');
const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'magic_numbers',
  name: '魔法数字检测',
  description: '检测代码中出现的魔法数字',
  category: 'code-smell',
  defaultSeverity: 'low'
};

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];

  try {
    const numberNodes = getNodesByType(tree.rootNode, 'number');
    const magicThresholds = [100, 1000, 60, 24, 7, 30, 365, 86400];

    numberNodes.forEach(numNode => {
      const numValue = parseFloat(numNode.text);

      if (magicThresholds.includes(numValue) || numValue > 1000) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'magic_number',
          severity: ruleConfig.severity || meta.defaultSeverity,
          message: `发现魔法数字: ${numValue}`,
          suggestion: '将魔法数字提取为常量并添加说明性名称',
          lineStart: numNode.startPosition.row + 1,
          lineEnd: numNode.endPosition.row + 1,
          columnStart: numNode.startPosition.column,
          columnEnd: numNode.endPosition.column,
          codeSnippet: numNode.text,
          astNodeType: 'number'
        });
      }
    });
  } catch (error) {
    console.error('检测魔法数字失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
