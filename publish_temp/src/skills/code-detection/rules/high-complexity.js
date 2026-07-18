const { generateUUID, getFileLanguage } = require('../../../utils/helpers');

const meta = {
  id: 'high_complexity',
  name: '圈复杂度检测',
  description: '检测圈复杂度过高的函数',
  category: 'code-smell',
  defaultSeverity: 'medium'
};

const DEFAULT_THRESHOLD = 10;

function detect(tree, sourceCode, filePath, ruleConfig) {
  const issues = [];
  const threshold = ruleConfig.threshold || DEFAULT_THRESHOLD;

  try {
    const lines = sourceCode.split('\n');
    const funcDeclarations = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(/function\s+(\w+)\s*\(/);
      if (match) {
        let braceCount = 0;
        const hasOpenBrace = lines[i].includes('{');
        if (hasOpenBrace) braceCount++;

        let endLine = i;
        for (let j = i + 1; j < lines.length; j++) {
          const lineBraces = (lines[j].match(/\{/g) || []).length;
          const closeBraces = (lines[j].match(/\}/g) || []).length;
          braceCount += lineBraces - closeBraces;

          if (braceCount <= 0) {
            endLine = j;
            break;
          }
        }

        funcDeclarations.push({
          name: match[1],
          startLine: i,
          endLine: endLine,
          text: lines[i].trim()
        });
      }
    }

    funcDeclarations.forEach(funcDecl => {
      let complexity = 1;

      for (let i = funcDecl.startLine; i <= funcDecl.endLine; i++) {
        const line = lines[i];
        if (!line) continue;

        const trimmed = line.trim();

        if (trimmed.startsWith('if (') || trimmed.startsWith('if(')) {
          complexity++;
        }
        if (trimmed.startsWith('for (')) {
          complexity++;
        }
        if (trimmed.startsWith('while (')) {
          complexity++;
        }
        if (trimmed.startsWith('case ')) {
          complexity++;
        }
        if (trimmed.startsWith('catch (')) {
          complexity++;
        }

        const andCount = (trimmed.match(/&&/g) || []).length;
        const orCount = (trimmed.match(/\|\|/g) || []).length;
        complexity += andCount + orCount;
      }

      if (complexity > threshold) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'high_complexity',
          severity: ruleConfig.severity || meta.defaultSeverity,
          message: `函数"${funcDecl.name}"圈复杂度过高(${complexity})`,
          suggestion: '简化逻辑结构，减少嵌套层级',
          lineStart: funcDecl.startLine + 1,
          lineEnd: funcDecl.endLine + 1,
          columnStart: 0,
          columnEnd: funcDecl.text.length,
          codeSnippet: funcDecl.text.substring(0, 100),
          astNodeType: 'function_declaration',
          metadata: {
            complexity,
            threshold
          }
        });
      }
    });
  } catch (error) {
    console.error('检测圈复杂度失败:', error);
  }

  return issues;
}

module.exports = { meta, detect };
