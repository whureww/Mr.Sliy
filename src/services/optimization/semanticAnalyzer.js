const { logger } = require('../../utils/logger');
const { parseCode, traverseAST } = require('../ast/parser');

class SemanticAnalyzer {
  async analyze(code, language) {
    const result = {
      features: {},
      issues: [],
      metrics: {},
      patterns: []
    };

    try {
      const tree = await parseCode(code, language);
      
      if (!tree || !tree.rootNode) {
        result.metrics = this.calculateBasicMetrics(code);
        return result;
      }

      const rootNode = tree.rootNode;

      result.features = this.extractFeatures(rootNode, code);
      result.issues = this.detectIssues(rootNode, code);
      result.metrics = this.calculateMetrics(rootNode, code);
      result.patterns = this.detectPatterns(rootNode, code);

    } catch (error) {
      logger.debug('语义分析失败，使用基础分析:', error.message);
      result.metrics = this.calculateBasicMetrics(code);
    }

    return result;
  }

  extractFeatures(rootNode, code) {
    const features = {
      functions: [],
      variables: [],
      controlFlow: [],
      loops: [],
      conditionals: [],
      errorHandlers: [],
      imports: [],
      exports: [],
      classes: [],
      callbacks: [],
      promises: [],
      asyncAwait: []
    };

    traverseAST(rootNode, (node) => {
      switch (node.type) {
        case 'function_definition':
        case 'function_declaration':
        case 'method_declaration':
        case 'method_definition':
        case 'func_literal':
        case 'arrow_function':
          features.functions.push({
            type: node.type,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            isAsync: this.isAsyncFunction(node)
          });
          break;
        
        case 'variable_declaration':
        case 'lexical_declaration':
          features.variables.push({
            type: node.type,
            startLine: node.startPosition.row + 1
          });
          break;
        
        case 'if_statement':
        case 'else_clause':
        case 'ternary_expression':
          features.conditionals.push({
            type: node.type,
            startLine: node.startPosition.row + 1,
            nestedDepth: this.getNodeDepth(node)
          });
          break;
        
        case 'for_statement':
        case 'while_statement':
        case 'do_statement':
          features.loops.push({
            type: node.type,
            startLine: node.startPosition.row + 1,
            nestedDepth: this.getNodeDepth(node)
          });
          break;
        
        case 'try_statement':
        case 'catch_clause':
        case 'finally_clause':
          features.errorHandlers.push({
            type: node.type,
            startLine: node.startPosition.row + 1
          });
          break;
        
        case 'import_statement':
        case 'import_clause':
          features.imports.push({
            type: node.type,
            startLine: node.startPosition.row + 1
          });
          break;
        
        case 'export_statement':
        case 'export_clause':
          features.exports.push({
            type: node.type,
            startLine: node.startPosition.row + 1
          });
          break;
        
        case 'class_declaration':
        case 'class_definition':
          features.classes.push({
            type: node.type,
            startLine: node.startPosition.row + 1
          });
          break;
        
        case 'call_expression':
          const funcName = this.getFunctionName(node);
          if (funcName === 'Promise' || funcName === 'Promise.resolve' || funcName === 'Promise.reject') {
            features.promises.push({
              type: 'promise',
              startLine: node.startPosition.row + 1
            });
          }
          break;
        
        case 'await_expression':
          features.asyncAwait.push({
            type: 'await',
            startLine: node.startPosition.row + 1
          });
          break;
      }
    });

    return features;
  }

  detectIssues(rootNode, code) {
    const issues = [];

    traverseAST(rootNode, (node) => {
      const line = node.startPosition.row + 1;

      if (node.type === 'if_statement') {
        const nestedDepth = this.getNodeDepth(node);
        if (nestedDepth > 3) {
          issues.push({
            type: 'nested_hell',
            severity: 'high',
            message: '嵌套条件过深，建议提取函数或使用早返回',
            line: line
          });
        }
      }

      if (node.type === 'for_statement' || node.type === 'while_statement') {
        const nestedDepth = this.getNodeDepth(node);
        if (nestedDepth > 2) {
          issues.push({
            type: 'nested_loop',
            severity: 'high',
            message: '嵌套循环过深，时间复杂度高，建议优化',
            line: line
          });
        }
      }

      if (node.type === 'call_expression') {
        const funcName = this.getFunctionName(node);
        if (funcName === 'console.log' || funcName === 'console.debug') {
          issues.push({
            type: 'debug_log',
            severity: 'low',
            message: '调试日志不应出现在生产代码中',
            line: line
          });
        }
      }

      if (node.type === 'variable_declaration') {
        issues.push({
          type: 'var_declaration',
          severity: 'medium',
          message: '使用var声明变量，建议使用const/let',
          line: line
        });
      }

      if (node.type === 'numeric_literal') {
        const value = node.text;
        if (/^\d+$/.test(value) && value.length > 2) {
          issues.push({
            type: 'magic_number',
            severity: 'medium',
            message: `魔法数字 ${value}，建议定义常量`,
            line: line
          });
        }
      }

      if (node.type === 'function_definition' || node.type === 'function_declaration') {
        const funcLength = node.endPosition.row - node.startPosition.row + 1;
        if (funcLength > 50) {
          issues.push({
            type: 'long_function',
            severity: 'high',
            message: `函数过长(${funcLength}行)，建议拆分`,
            line: line
          });
        }
      }
    });

    return issues;
  }

  calculateMetrics(rootNode, code) {
    const lines = code.split('\n');
    const functionCount = this.countNodesByType(rootNode, [
      'function_definition', 'function_declaration', 'method_declaration',
      'method_definition', 'arrow_function'
    ]);
    const conditionalCount = this.countNodesByType(rootNode, [
      'if_statement', 'else_clause', 'ternary_expression', 'switch_statement'
    ]);
    const loopCount = this.countNodesByType(rootNode, [
      'for_statement', 'while_statement', 'do_statement'
    ]);
    const maxDepth = this.calculateMaxDepth(rootNode);

    return {
      linesOfCode: lines.length,
      functionCount: functionCount,
      conditionalCount: conditionalCount,
      loopCount: loopCount,
      maxDepth: maxDepth,
      complexity: this.calculateComplexity(rootNode),
      readability: this.calculateReadability(rootNode, lines),
      maintainability: this.calculateMaintainability(rootNode, lines)
    };
  }

  calculateBasicMetrics(code) {
    const lines = code.split('\n');
    const controlFlowKeywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'catch'];
    let controlFlowCount = 0;
    let functionCount = 0;

    lines.forEach(line => {
      controlFlowKeywords.forEach(keyword => {
        if (new RegExp(`\\b${keyword}\\b`).test(line)) {
          controlFlowCount++;
        }
      });
      if (/function\s*\(|=>\s*\{/.test(line)) {
        functionCount++;
      }
    });

    return {
      linesOfCode: lines.length,
      functionCount: functionCount,
      conditionalCount: controlFlowCount,
      loopCount: controlFlowCount,
      maxDepth: 0,
      complexity: 1 + controlFlowCount,
      readability: 80 - (controlFlowCount * 2),
      maintainability: 80 - (controlFlowCount * 3)
    };
  }

  detectPatterns(rootNode, code) {
    const patterns = [];

    traverseAST(rootNode, (node) => {
      if (node.type === 'call_expression') {
        const funcName = this.getFunctionName(node);
        
        if (funcName === 'setTimeout' || funcName === 'setInterval') {
          patterns.push({ type: 'timer', line: node.startPosition.row + 1 });
        }
        
        if (funcName === 'require' || funcName === 'import') {
          patterns.push({ type: 'module_import', line: node.startPosition.row + 1 });
        }
      }

      if (node.type === 'new_expression') {
        const constructorName = this.getFunctionName(node);
        if (constructorName === 'Promise') {
          patterns.push({ type: 'promise_constructor', line: node.startPosition.row + 1 });
        }
      }

      if (node.type === 'arrow_function') {
        patterns.push({ type: 'arrow_function', line: node.startPosition.row + 1 });
      }

      if (node.type === 'template_string') {
        patterns.push({ type: 'template_string', line: node.startPosition.row + 1 });
      }
    });

    return patterns;
  }

  countNodesByType(rootNode, types) {
    let count = 0;
    traverseAST(rootNode, (node) => {
      if (types.includes(node.type)) {
        count++;
      }
    });
    return count;
  }

  calculateMaxDepth(node, depth = 0) {
    let maxDepth = depth;
    const children = node.children || node.namedChildren || [];
    
    children.forEach(child => {
      const childDepth = this.calculateMaxDepth(child, depth + 1);
      maxDepth = Math.max(maxDepth, childDepth);
    });

    return maxDepth;
  }

  calculateComplexity(rootNode) {
    let complexity = 1;
    
    traverseAST(rootNode, (node) => {
      const controlTypes = ['if_statement', 'else_clause', 'for_statement', 
        'while_statement', 'do_statement', 'switch_statement', 'catch_clause',
        'ternary_expression', 'logical_expression'];
      
      if (controlTypes.includes(node.type)) {
        complexity++;
      }
    });

    return complexity;
  }

  calculateReadability(rootNode, lines) {
    const complexity = this.calculateComplexity(rootNode);
    const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
    
    let score = 100;
    score -= complexity * 2;
    score -= Math.max(0, avgLineLength - 80) * 0.5;
    
    return Math.max(0, Math.min(100, score));
  }

  calculateMaintainability(rootNode, lines) {
    const complexity = this.calculateComplexity(rootNode);
    const funcCount = this.countNodesByType(rootNode, [
      'function_definition', 'function_declaration', 'method_declaration', 'method_definition'
    ]);
    
    let score = 100;
    score -= complexity * 3;
    score -= funcCount * 2;
    score -= lines.length * 0.1;
    
    return Math.max(0, Math.min(100, score));
  }

  isAsyncFunction(node) {
    const children = node.children || node.namedChildren || [];
    return children.some(child => child.type === 'async');
  }

  getNodeDepth(node) {
    let depth = 0;
    let parent = node.parent;
    
    while (parent) {
      depth++;
      parent = parent.parent;
    }
    
    return depth;
  }

  getFunctionName(node) {
    if (!node) return '';
    
    if (node.type === 'call_expression') {
      const functionNode = node.children?.find(c => c.type === 'identifier' || c.type === 'member_expression');
      if (functionNode) {
        if (functionNode.type === 'member_expression') {
          const objectName = this.getFunctionName(functionNode.children?.find(c => c.type === 'identifier'));
          const propertyName = this.getFunctionName(functionNode.children?.find(c => c.type === 'property_identifier'));
          return objectName ? `${objectName}.${propertyName}` : propertyName;
        }
        return functionNode.text || '';
      }
    }
    
    if (node.type === 'new_expression') {
      const constructorNode = node.children?.find(c => c.type === 'identifier');
      return constructorNode?.text || '';
    }
    
    return node.text || '';
  }
}

const semanticAnalyzer = new SemanticAnalyzer();

module.exports = {
  SemanticAnalyzer,
  semanticAnalyzer
};