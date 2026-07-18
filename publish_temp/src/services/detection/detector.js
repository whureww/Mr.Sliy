/**
 * 代码缺陷检测引擎
 * 基于AST分析识别代码冗余和不规范问题
 */

const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const { countLines, getFileLanguage } = require('../../utils/helpers');
const { parseCode, traverseAST, getNodesByType, extractFunctions, extractVariables, extractImports } = require('../ast/parser');
const { getDatabase } = require('../../utils/database');
const { generateUUID } = require('../../utils/helpers');

/**
 * 检测规则配置
 */
const detectionRules = {
  unusedVariables: {
    enabled: config.detection.unusedVariables,
    severity: 'medium',
    message: '变量已声明但从未使用',
    suggestion: '删除未使用的变量或根据需要使用它'
  },
  unusedImports: {
    enabled: config.detection.unusedImports,
    severity: 'low',
    message: '导入已声明但从未使用',
    suggestion: '删除未使用的导入以减少打包体积'
  },
  unusedFunctions: {
    enabled: config.detection.unusedFunctions,
    severity: 'high',
    message: '函数已定义但从未被调用',
    suggestion: '删除未使用的函数或确认是否应该在代码中使用它'
  },
  magicNumbers: {
    enabled: config.detection.magicNumbers,
    severity: 'low',
    message: '发现魔法数字',
    suggestion: '将魔法数字提取为常量并添加说明性名称'
  },
  longFunctions: {
    enabled: true,
    severity: 'medium',
    threshold: config.detection.maxFunctionLines,
    message: '函数过长',
    suggestion: '将长函数拆分为多个小函数，每个函数负责单一职责'
  },
  highComplexity: {
    enabled: true,
    severity: 'medium',
    threshold: config.detection.maxCyclomaticComplexity,
    message: '圈复杂度过高',
    suggestion: '简化逻辑结构，减少嵌套层级'
  },
  missingComments: {
    enabled: true,
    severity: 'low',
    message: '函数缺少注释',
    suggestion: '添加函数说明注释，提高代码可读性'
  },
  duplicateCode: {
    enabled: true,
    severity: 'medium',
    message: '发现重复代码片段',
    suggestion: '提取重复代码为独立函数或模块'
  },
  deepNesting: {
    enabled: true,
    severity: 'medium',
    threshold: 4,
    message: '嵌套层级过深',
    suggestion: '减少嵌套层级，提取内层逻辑为独立函数'
  },
  nullCheck: {
    enabled: true,
    severity: 'high',
    message: '缺少空值检查',
    suggestion: '添加空值检查以防止运行时错误'
  },
  unnecessaryElse: {
    enabled: true,
    severity: 'low',
    message: 'return后使用不必要的else',
    suggestion: '删除return后的else语句以简化代码'
  },
  consoleLog: {
    enabled: true,
    severity: 'low',
    message: '存在调试用的console.log',
    suggestion: '删除或替换为正式的日志记录'
  }
};

/**
 * 执行代码缺陷检测
 */
async function detectIssues(sourceCode, filePath, options = {}) {
  const startTime = Date.now();
  const language = getFileLanguage(filePath);
  
  try {
    logger.info(`开始检测: ${filePath}`);
    
    // 1. 解析代码为AST
    const parseResult = await parseCode(sourceCode, language);
    
    if (!parseResult.success) {
      return {
        success: false,
        message: parseResult.error,
        filePath
      };
    }
    
    const tree = parseResult.tree;
    const issues = [];
    
    // 2. 执行各项检测
    if (detectionRules.unusedVariables.enabled) {
      const unusedVarIssues = detectUnusedVariables(tree, sourceCode, filePath);
      issues.push(...unusedVarIssues);
    }
    
    if (detectionRules.unusedImports.enabled) {
      const unusedImportIssues = detectUnusedImports(tree, sourceCode, filePath);
      issues.push(...unusedImportIssues);
    }
    
    if (detectionRules.unusedFunctions.enabled) {
      const unusedFuncIssues = detectUnusedFunctions(tree, sourceCode, filePath);
      issues.push(...unusedFuncIssues);
    }
    
    if (detectionRules.magicNumbers.enabled) {
      const magicNumberIssues = detectMagicNumbers(tree, sourceCode, filePath);
      issues.push(...magicNumberIssues);
    }
    
    if (detectionRules.longFunctions.enabled) {
      const longFuncIssues = detectLongFunctions(tree, sourceCode, filePath);
      issues.push(...longFuncIssues);
    }

    if (detectionRules.highComplexity.enabled) {
      const complexityIssues = detectCyclomaticComplexity(tree, sourceCode, filePath);
      issues.push(...complexityIssues);
    }

    if (detectionRules.deepNesting.enabled) {
      const nestingIssues = detectDeepNesting(tree, sourceCode, filePath);
      issues.push(...nestingIssues);
    }

    if (detectionRules.nullCheck.enabled) {
      const nullCheckIssues = detectMissingNullCheck(tree, sourceCode, filePath);
      issues.push(...nullCheckIssues);
    }

    if (detectionRules.unnecessaryElse.enabled) {
      const elseIssues = detectUnnecessaryElse(tree, sourceCode, filePath);
      issues.push(...elseIssues);
    }

    if (detectionRules.consoleLog.enabled) {
      const consoleIssues = detectConsoleLog(tree, sourceCode, filePath);
      issues.push(...consoleIssues);
    }

    if (detectionRules.duplicateCode.enabled) {
      const duplicateIssues = detectDuplicateCode(tree, sourceCode, filePath);
      issues.push(...duplicateIssues);
    }

    if (detectionRules.missingComments.enabled) {
      const commentIssues = detectMissingComments(tree, sourceCode, filePath);
      issues.push(...commentIssues);
    }
    
    // 3. 统计检测结果
    const result = {
      success: true,
      filePath,
      language,
      totalIssues: issues.length,
      issueCounts: {
        critical: issues.filter(i => i.severity === 'critical').length,
        high: issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low: issues.filter(i => i.severity === 'low').length
      },
      issues,
      durationMs: Date.now() - startTime
    };
    
    logger.info(`检测完成: ${filePath}, 发现 ${issues.length} 个问题`);
    
    return result;
  } catch (error) {
    logger.error(`检测失败: ${filePath}`, error);
    return {
      success: false,
      message: error.message,
      filePath,
      durationMs: Date.now() - startTime
    };
  }
}

/**
 * 检测未使用的变量
 */
function detectUnusedVariables(tree, sourceCode, filePath) {
  const issues = [];
  
  try {
    // 提取所有变量声明
    const variableDeclarations = getNodesByType(tree.rootNode, 'variable_declarator');
    
    // 提取所有标识符引用
    const identifiers = getNodesByType(tree.rootNode, 'identifier');
    
    // 检查每个变量是否被使用
    variableDeclarations.forEach(varDecl => {
      const varName = varDecl.text.split('=')[0].trim();
      
      // 检查是否在其他地方被引用（排除声明位置）
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
          severity: detectionRules.unusedVariables.severity,
          message: `变量"${varName}"已声明但从未使用`,
          suggestion: detectionRules.unusedVariables.suggestion,
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
    logger.error('检测未使用变量失败:', error);
  }
  
  return issues;
}

/**
 * 检测未使用的导入
 */
function detectUnusedImports(tree, sourceCode, filePath) {
  const issues = [];
  
  try {
    // 提取导入语句
    const importStatements = getNodesByType(tree.rootNode, 'import_statement');
    
    // 提取所有标识符
    const identifiers = getNodesByType(tree.rootNode, 'identifier');
    
    importStatements.forEach(importStmt => {
      // 提取导入的模块名
      const importMatch = importStmt.text.match(/import\s+(\w+)\s+from/);
      
      if (importMatch) {
        const importedName = importMatch[1];
        
        // 检查是否被使用
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
            severity: detectionRules.unusedImports.severity,
            message: `导入"${importedName}"已声明但从未使用`,
            suggestion: detectionRules.unusedImports.suggestion,
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
    logger.error('检测未使用导入失败:', error);
  }
  
  return issues;
}

/**
 * 检测未使用的函数
 */
function detectUnusedFunctions(tree, sourceCode, filePath) {
  const issues = [];
  
  try {
    // 提取函数声明
    const functionDeclarations = getNodesByType(tree.rootNode, 'function_declaration');
    
    // 提取所有标识符
    const identifiers = getNodesByType(tree.rootNode, 'identifier');
    
    functionDeclarations.forEach(funcDecl => {
      // 提取函数名
      const funcNameMatch = funcDecl.text.match(/function\s+(\w+)\s*\(/);
      
      if (funcNameMatch) {
        const funcName = funcNameMatch[1];
        
        // 检查是否被调用（排除函数定义位置）
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
            severity: detectionRules.unusedFunctions.severity,
            message: `函数"${funcName}"已定义但从未被调用`,
            suggestion: detectionRules.unusedFunctions.suggestion,
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
    logger.error('检测未使用函数失败:', error);
  }
  
  return issues;
}

/**
 * 检测魔法数字
 */
function detectMagicNumbers(tree, sourceCode, filePath) {
  const issues = [];
  
  try {
    // 提取数字节点
    const numberNodes = getNodesByType(tree.rootNode, 'number');
    
    // 常见的魔法数字阈值
    const magicThresholds = [100, 1000, 60, 24, 7, 30, 365, 86400];
    
    numberNodes.forEach(numNode => {
      const numValue = parseFloat(numNode.text);
      
      // 检查是否为魔法数字
      if (magicThresholds.includes(numValue) || numValue > 1000) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'magic_number',
          severity: detectionRules.magicNumbers.severity,
          message: `发现魔法数字: ${numValue}`,
          suggestion: detectionRules.magicNumbers.suggestion,
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
    logger.error('检测魔法数字失败:', error);
  }
  
  return issues;
}

/**
 * 检测过长函数
 */
function detectLongFunctions(tree, sourceCode, filePath) {
  const issues = [];
  
  try {
    // 提取函数声明
    const functionDeclarations = getNodesByType(tree.rootNode, 'function_declaration');
    
    functionDeclarations.forEach(funcDecl => {
      const funcLines = funcDecl.endPosition.row - funcDecl.startPosition.row + 1;
      
      if (funcLines > detectionRules.longFunctions.threshold) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'long_function',
          severity: detectionRules.longFunctions.severity,
          message: `函数过长(${funcLines}行)，建议拆分`,
          suggestion: detectionRules.longFunctions.suggestion,
          lineStart: funcDecl.startPosition.row + 1,
          lineEnd: funcDecl.endPosition.row + 1,
          columnStart: funcDecl.startPosition.column,
          columnEnd: funcDecl.endPosition.column,
          codeSnippet: funcDecl.text.substring(0, 100),
          astNodeType: 'function_declaration',
          metadata: {
            lineCount: funcLines,
            threshold: detectionRules.longFunctions.threshold
          }
        });
      }
    });
  } catch (error) {
    logger.error('检测过长函数失败:', error);
  }
  
  return issues;
}

/**
 * 检测圈复杂度
 */
function detectCyclomaticComplexity(tree, sourceCode, filePath) {
  const issues = [];

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

      if (complexity > detectionRules.highComplexity.threshold) {
        issues.push({
          id: generateUUID(),
          filePath,
          fileName: filePath.split(/[/\\]/).pop(),
          language: getFileLanguage(filePath),
          issueType: 'high_complexity',
          severity: detectionRules.highComplexity.severity,
          message: `函数"${funcDecl.name}"圈复杂度过高(${complexity})`,
          suggestion: detectionRules.highComplexity.suggestion,
          lineStart: funcDecl.startLine + 1,
          lineEnd: funcDecl.endLine + 1,
          columnStart: 0,
          columnEnd: funcDecl.text.length,
          codeSnippet: funcDecl.text.substring(0, 100),
          astNodeType: 'function_declaration',
          metadata: {
            complexity,
            threshold: detectionRules.highComplexity.threshold
          }
        });
      }
    });
  } catch (error) {
    logger.error('检测圈复杂度失败:', error);
  }

  return issues;
}

/**
 * 检测嵌套过深
 */
function detectDeepNesting(tree, sourceCode, filePath) {
  const issues = [];

  try {
    const lines = sourceCode.split('\n');
    let currentDepth = 0;
    let maxDepth = 0;
    let deepLines = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const indentMatch = line.match(/^(\s+)/);
      const indentSpaces = indentMatch ? indentMatch[1].length : 0;
      const indentLevel = Math.floor(indentSpaces / 2);

      currentDepth = indentLevel;

      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
      }

      if (currentDepth > detectionRules.deepNesting.threshold) {
        deepLines.push({
          line: index + 1,
          depth: currentDepth,
          text: trimmed.substring(0, 50)
        });
      }
    });

    if (maxDepth > detectionRules.deepNesting.threshold && deepLines.length > 0) {
      const firstDeepLine = deepLines[0];
      issues.push({
        id: generateUUID(),
        filePath,
        fileName: filePath.split(/[/\\]/).pop(),
        language: getFileLanguage(filePath),
        issueType: 'deep_nesting',
        severity: detectionRules.deepNesting.severity,
        message: `嵌套层级过深(最大${maxDepth}层，阈值${detectionRules.deepNesting.threshold}层)`,
        suggestion: detectionRules.deepNesting.suggestion,
        lineStart: firstDeepLine.line,
        lineEnd: firstDeepLine.line,
        columnStart: 0,
        columnEnd: firstDeepLine.text.length,
        codeSnippet: firstDeepLine.text,
        astNodeType: 'deep_nesting',
        metadata: {
          maxDepth,
          threshold: detectionRules.deepNesting.threshold,
          deepLineCount: deepLines.length
        }
      });
    }
  } catch (error) {
    logger.error('检测嵌套过深失败:', error);
  }

  return issues;
}

/**
 * 检测缺少空值检查
 */
function detectMissingNullCheck(tree, sourceCode, filePath) {
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
                severity: detectionRules.nullCheck.severity,
                message: `参数"${param}"缺少空值检查`,
                suggestion: detectionRules.nullCheck.suggestion,
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
    logger.error('检测空值检查失败:', error);
  }

  return issues;
}

/**
 * 检测不必要的else语句
 */
function detectUnnecessaryElse(tree, sourceCode, filePath) {
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
            severity: detectionRules.unnecessaryElse.severity,
            message: 'return后使用不必要的else',
            suggestion: detectionRules.unnecessaryElse.suggestion,
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
    logger.error('检测不必要else失败:', error);
  }

  return issues;
}

/**
 * 检测调试用console.log
 */
function detectConsoleLog(tree, sourceCode, filePath) {
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
          severity: detectionRules.consoleLog.severity,
          message: '存在调试用的console.log',
          suggestion: detectionRules.consoleLog.suggestion,
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
    logger.error('检测console.log失败:', error);
  }

  return issues;
}

/**
 * 检测重复代码
 */
function detectDuplicateCode(tree, sourceCode, filePath) {
  const issues = [];

  try {
    const lines = sourceCode.split('\n');
    const minDuplicateLines = 3;
    const seenBlocks = new Map();

    for (let i = 0; i < lines.length - minDuplicateLines; i++) {
      const block = lines.slice(i, i + minDuplicateLines).join('\n').trim();
      if (block.length < 20) continue;

      const trimmed = block.replace(/\s+/g, '');
      if (seenBlocks.has(trimmed)) {
        const previousLine = seenBlocks.get(trimmed);
        if (i > previousLine + minDuplicateLines) {
          issues.push({
            id: generateUUID(),
            filePath,
            fileName: filePath.split(/[/\\]/).pop(),
            language: getFileLanguage(filePath),
            issueType: 'duplicate_code',
            severity: detectionRules.duplicateCode.severity,
            message: `发现重复代码片段(第${previousLine + 1}行和第${i + 1}行)`,
            suggestion: detectionRules.duplicateCode.suggestion,
            lineStart: i + 1,
            lineEnd: i + minDuplicateLines,
            columnStart: 0,
            columnEnd: block.length,
            codeSnippet: block.substring(0, 100),
            astNodeType: 'duplicate_block'
          });
        }
      } else {
        seenBlocks.set(trimmed, i);
      }
    }
  } catch (error) {
    logger.error('检测重复代码失败:', error);
  }

  return issues;
}

/**
 * 检测缺少注释
 */
function detectMissingComments(tree, sourceCode, filePath) {
  const issues = [];

  try {
    const functionDeclarations = getNodesByType(tree.rootNode, 'function_declaration');

    functionDeclarations.forEach(funcDecl => {
      const funcLines = funcDecl.endPosition.row - funcDecl.startPosition.row + 1;
      if (funcLines > 10) {
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
            severity: detectionRules.missingComments.severity,
            message: `函数"${funcName}"缺少注释说明`,
            suggestion: detectionRules.missingComments.suggestion,
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
    logger.error('检测缺少注释失败:', error);
  }

  return issues;
}

/**
 * 批量检测多个文件
 */
async function batchDetect(filePaths, options = {}) {
  const results = [];
  const startTime = Date.now();
  
  for (const filePath of filePaths) {
    try {
      const sourceCode = require('fs').readFileSync(filePath, 'utf-8');
      const result = await detectIssues(sourceCode, filePath, options);
      results.push(result);
    } catch (error) {
      logger.error(`批量检测文件失败: ${filePath}`, error);
      results.push({
        success: false,
        message: error.message,
        filePath
      });
    }
  }
  
  return {
    success: true,
    totalFiles: filePaths.length,
    scannedFiles: results.filter(r => r.success).length,
    failedFiles: results.filter(r => !r.success).length,
    totalIssues: results.reduce((sum, r) => sum + (r.totalIssues || 0), 0),
    results,
    durationMs: Date.now() - startTime
  };
}

/**
 * 存储检测结果到数据库
 */
async function saveDetectionResults(taskId, projectId, results) {
  try {
    const { isUsingMySql, execute, getMySqlPool } = require('../../utils/database');
    const allIssues = results.flatMap(r => r.issues || []);

    if (allIssues.length === 0) {
      logger.info('无检测结果需要存储');
      return;
    }

    const insertSql = `
      INSERT INTO code_issue
      (id, task_id, project_id, file_path, file_name, language, issue_type,
       severity, message, suggestion, line_start, line_end, column_start,
       column_end, code_snippet, ast_node_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // MySQL模式：使用连接池事务
    if (isUsingMySql()) {
      const pool = await getMySqlPool();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        for (const issue of allIssues) {
          await connection.execute(insertSql, [
            issue.id,
            taskId,
            projectId,
            issue.filePath,
            issue.fileName,
            issue.language,
            issue.issueType,
            issue.severity,
            issue.message,
            issue.suggestion,
            issue.lineStart,
            issue.lineEnd,
            issue.columnStart,
            issue.columnEnd,
            issue.codeSnippet,
            issue.astNodeType
          ]);
        }

        await connection.commit();
        logger.info(`存储检测结果: ${allIssues.length} 个问题`);
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      // SQLite模式：使用better-sqlite3事务
      const db = getDatabase();
      const stmt = db.prepare(insertSql);
      const insertMany = db.transaction((issues) => {
        for (const issue of issues) {
          stmt.run(
            issue.id,
            taskId,
            projectId,
            issue.filePath,
            issue.fileName,
            issue.language,
            issue.issueType,
            issue.severity,
            issue.message,
            issue.suggestion,
            issue.lineStart,
            issue.lineEnd,
            issue.columnStart,
            issue.columnEnd,
            issue.codeSnippet,
            issue.astNodeType
          );
        }
      });
      insertMany(allIssues);
      logger.info(`存储检测结果: ${allIssues.length} 个问题`);
    }
  } catch (error) {
    logger.error('存储检测结果失败:', error);
  }
}

module.exports = {
  detectIssues,
  batchDetect,
  saveDetectionResults,
  detectionRules
};