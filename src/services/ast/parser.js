/**
 * Tree-sitter AST解析服务
 * 支持多语言源代码解析为AST语法树
 * 使用 Worker Threads 线程池隔离CPU密集操作，防止主线程阻塞
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../../utils/logger');
const { getFileLanguage } = require('../../utils/helpers');
const { parserPool } = require('../../workers/pool');

const languageParsers = new Map();
let Parser = null;
let parserInitialized = false;
let parserInitError = null;
let wasmDir = null;
let wasmDirResolved = false;
let diagnostics = [];

const languageMap = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  go: 'go',
  rust: 'rust',
  c: 'c',
  cpp: 'cpp',
  csharp: 'c_sharp',
  ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  scala: 'scala',
  bash: 'bash',
  css: 'css',
  html: 'html',
  json: 'json',
  lua: 'lua',
  yaml: 'yaml',
  toml: 'toml',
  vue: 'vue'
};

function addDiagnostic(category, message, detail) {
  diagnostics.push({ category, message, detail, time: new Date().toISOString() });
  if (diagnostics.length > 50) diagnostics.shift();
}

function getDiagnostics() {
  return [...diagnostics];
}

function resolveWasmDir() {
  if (wasmDirResolved) return wasmDir;
  wasmDirResolved = true;

  addDiagnostic('wasm_dir', '开始查找WASM目录...');

  const candidates = [];

  try {
    const pkgDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    const outDir = path.join(pkgDir, 'out');
    if (fs.existsSync(outDir)) {
      candidates.push({ path: outDir, source: 'tree-sitter-wasms/out' });
    }
  } catch (e) {
    addDiagnostic('wasm_dir', 'tree-sitter-wasms包不可用', e.message);
  }

  try {
    const wasmPkgDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    candidates.push({ path: wasmPkgDir, source: 'tree-sitter-wasms root' });
  } catch (e) {
    // ignore
  }

  const localPaths = [
    { path: path.join(__dirname, '..', '..', '..', 'wasm'), source: '项目根wasm目录' },
    { path: path.join(__dirname, '..', '..', 'wasm'), source: 'src上级wasm目录' },
    { path: path.join(process.cwd(), 'wasm'), source: 'cwd wasm目录' }
  ];

  if (require.main && require.main.filename) {
    localPaths.push({
      path: path.join(path.dirname(require.main.filename), '..', 'wasm'),
      source: '主模块wasm目录'
    });
  }

  candidates.push(...localPaths);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      try {
        const files = fs.readdirSync(candidate.path);
        const validWasmFiles = files.filter(function(f) {
          if (!f.endsWith('.wasm')) return false;
          try {
            const stat = fs.statSync(path.join(candidate.path, f));
            return stat.size > 1000;
          } catch (e) { return false; }
        });
        if (validWasmFiles.length > 0) {
          wasmDir = candidate.path;
          addDiagnostic(
            'wasm_dir',
            '找到WASM目录: ' + candidate.path,
            '来源: ' + candidate.source + ', 文件数: ' + validWasmFiles.length
          );
          logger.debug('WASM目录: ' + candidate.path + ' (' + validWasmFiles.length + '个语言, 来源: ' + candidate.source + ')');
          return wasmDir;
        }
      } catch (e) {
        addDiagnostic('wasm_dir', '读取目录失败: ' + candidate.path, e.message);
      }
    }
  }

  addDiagnostic('wasm_dir', '未找到有效的WASM文件目录');
  logger.warn('未找到有效的WASM文件目录');
  wasmDir = null;
  return null;
}

async function initParser() {
  if (parserInitialized) return Parser !== null;

  parserInitialized = true;

  try {
    addDiagnostic('parser_init', '开始初始化web-tree-sitter...');

    Parser = require('web-tree-sitter');

    const parserPkgDir = path.dirname(require.resolve('web-tree-sitter/package.json'));
    const treeSitterWasmPath = path.join(parserPkgDir, 'tree-sitter.wasm');

    addDiagnostic('parser_init', 'web-tree-sitter路径: ' + parserPkgDir);

    const initOptions = {};

    if (fs.existsSync(treeSitterWasmPath)) {
      initOptions.locateFile = function(fileName) {
        if (fileName === 'tree-sitter.wasm') {
          return treeSitterWasmPath;
        }
        return fileName;
      };
      addDiagnostic('parser_init', '使用自定义locateFile定位tree-sitter.wasm');
    } else {
      addDiagnostic('parser_init', '未找到tree-sitter.wasm，使用默认定位');
    }

    await Parser.init(initOptions);
    addDiagnostic('parser_init', 'Tree-sitter初始化成功');
    logger.info('Tree-sitter Parser初始化成功');
    return true;

  } catch (error) {
    parserInitError = error.message;
    addDiagnostic('parser_init', 'Tree-sitter初始化失败', error.message);
    logger.warn('Tree-sitter Parser初始化失败，将使用基础解析模式:', error.message);
    Parser = null;
    return false;
  }
}

function validateWasmFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      addDiagnostic('wasm_validate', '文件不存在', filePath);
      return false;
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 1000) {
      addDiagnostic('wasm_validate', '文件太小', filePath + ' (' + stat.size + ' bytes)');
      return false;
    }

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);

    const magic = buffer.toString('hex');
    if (magic !== '0061736d') {
      addDiagnostic('wasm_validate', '魔数不匹配', filePath + ': ' + magic);
      return false;
    }

    return true;
  } catch (e) {
    addDiagnostic('wasm_validate', '验证异常', filePath + ': ' + e.message);
    return false;
  }
}

function findWasmFile(languageName) {
  const dir = resolveWasmDir();
  if (!dir) return null;

  const wasmFileName = languageMap[languageName] || languageName;

  const nameVariants = [
    'tree-sitter-' + wasmFileName + '.wasm',
    wasmFileName + '.wasm',
    'tree-sitter-' + wasmFileName.toLowerCase() + '.wasm',
    wasmFileName.toLowerCase() + '.wasm'
  ];

  for (const name of nameVariants) {
    const fullPath = path.join(dir, name);
    if (validateWasmFile(fullPath)) {
      return fullPath;
    }
  }

  try {
    const files = fs.readdirSync(dir);
    const lowerName = wasmFileName.toLowerCase().replace(/_/g, '-');
    const match = files.find(function(f) {
      return f.endsWith('.wasm') && f.toLowerCase().includes(lowerName);
    });
    if (match) {
      const fullPath = path.join(dir, match);
      if (validateWasmFile(fullPath)) {
        addDiagnostic('wasm_find', '通过模糊匹配找到: ' + match);
        return fullPath;
      }
    }
  } catch (e) {
    // ignore
  }

  return null;
}

async function loadLanguage(languageName) {
  if (languageParsers.has(languageName)) {
    return languageParsers.get(languageName);
  }

  if (!Parser) {
    addDiagnostic('lang_load', 'Parser未初始化，跳过', languageName);
    languageParsers.set(languageName, null);
    return null;
  }

  const wasmPath = findWasmFile(languageName);

  if (!wasmPath) {
    addDiagnostic('lang_load', '未找到WASM文件', languageName);
    logger.debug('无WASM文件，跳过: ' + languageName);
    languageParsers.set(languageName, null);
    return null;
  }

  addDiagnostic('lang_load', '尝试加载: ' + languageName, wasmPath);

  try {
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    languageParsers.set(languageName, { parser: parser, language: language });
    addDiagnostic('lang_load', '加载成功: ' + languageName);
    logger.info('加载语言解析器成功: ' + languageName);
    return { parser: parser, language: language };
  } catch (error) {
    addDiagnostic('lang_load', '加载失败: ' + languageName, error.message);
    logger.error('加载语言解析器失败: ' + languageName, error.message);
    languageParsers.set(languageName, null);
    return null;
  }
}

class FallbackParser {
  parse(sourceCode) {
    const lines = sourceCode.split('\n');
    const nodes = [];
    let depth = 0;
    let maxDepth = 0;

    lines.forEach(function(line, index) {
      const trimmed = line.trim();
      if (!trimmed) return;

      const indent = line.length - line.trimStart().length;
      const currentDepth = Math.floor(indent / 2);

      if (trimmed.startsWith('class ') || trimmed.startsWith('function ') ||
          trimmed.startsWith('def ') || trimmed.startsWith('public class ') ||
          trimmed.startsWith('private ') || trimmed.startsWith('public ')) {
        nodes.push({
          type: 'function_definition',
          startPosition: { row: index, column: 0 },
          endPosition: { row: index, column: line.length },
          text: trimmed,
          children: []
        });
        maxDepth = Math.max(maxDepth, currentDepth);
      }
    });

    return {
      rootNode: {
        type: 'program',
        children: nodes,
        text: sourceCode,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: lines.length - 1, column: lines[lines.length - 1].length }
      }
    };
  }
}

async function parseCode(sourceCode, languageName) {
  try {
    const result = await parserPool.parse(sourceCode, languageName);
    
    if (result.success) {
      return {
        success: true,
        tree: { rootNode: result.rootNode },
        language: languageName,
        rootNode: result.rootNode,
        fallback: result.fallback || false
      };
    }

    logger.warn('Worker解析失败，使用基础解析器: ' + languageName);
    const fallback = new FallbackParser();
    const tree = fallback.parse(sourceCode);
    return {
      success: true,
      tree: tree,
      language: languageName,
      rootNode: tree.rootNode,
      fallback: true
    };
  } catch (error) {
    logger.error('解析代码失败:', error);

    const fallback = new FallbackParser();
    const tree = fallback.parse(sourceCode);
    return {
      success: true,
      tree: tree,
      language: languageName,
      rootNode: tree.rootNode,
      fallback: true,
      error: error.message
    };
  }
}

function getNodeType(node) {
  return node.type || 'unknown';
}

function getNodeText(node, sourceCode) {
  if (node.text) return node.text;
  const lines = sourceCode.split('\n');
  const start = node.startPosition;
  const end = node.endPosition;
  if (start.row === end.row) {
    return lines[start.row].substring(start.column, end.column);
  }
  let result = lines[start.row].substring(start.column);
  for (let i = start.row + 1; i < end.row; i++) {
    result += '\n' + lines[i];
  }
  result += '\n' + lines[end.row].substring(0, end.column);
  return result;
}

function findNodesByType(rootNode, type) {
  const results = [];

  function traverse(node) {
    if (node.type === type) {
      results.push(node);
    }
    const children = node.children || node.namedChildren || [];
    children.forEach(function(child) { traverse(child); });
  }

  traverse(rootNode);
  return results;
}

function getAllFunctions(rootNode) {
  const functionTypes = [
    'function_definition',
    'method_declaration',
    'function_declaration',
    'method_definition',
    'func_literal',
    'fn_item',
    'function_item',
    'def',
    'function'
  ];

  const functions = [];

  function traverse(node) {
    if (functionTypes.includes(node.type)) {
      functions.push(node);
      return;
    }
    const children = node.children || node.namedChildren || [];
    children.forEach(function(child) { traverse(child); });
  }

  traverse(rootNode);
  return functions;
}

function getSupportedLanguages() {
  return Object.keys(languageMap);
}

function traverseAST(node, callback) {
  if (!node) return;

  callback(node);

  const children = node.children || node.namedChildren || [];
  children.forEach(function(child) { traverseAST(child, callback); });
}

function getNodesByType(rootNode, type) {
  return findNodesByType(rootNode, type);
}

function extractFunctions(tree, sourceCode) {
  if (!tree || !tree.rootNode) return [];

  const functionNodes = getAllFunctions(tree.rootNode);
  return functionNodes.map(function(node) {
    const name = _extractFunctionName(node);
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const params = _extractFunctionParams(node, sourceCode);
    const isAsync = _isAsyncFunction(node);

    return {
      name: name,
      startLine: startLine,
      endLine: endLine,
      params: params,
      isAsync: isAsync,
      node: node
    };
  });
}

function extractVariables(tree, sourceCode) {
  if (!tree || !tree.rootNode) return [];

  const varTypes = [
    'variable_declarator',
    'lexical_declaration',
    'variable_declaration',
    'assignment_expression'
  ];

  const variables = [];
  const seen = new Set();

  traverseAST(tree.rootNode, function(node) {
    if (varTypes.includes(node.type)) {
      const name = _extractVariableName(node);
      if (name && !seen.has(name)) {
        seen.add(name);
        variables.push({
          name: name,
          line: node.startPosition.row + 1,
          kind: _getVariableKind(node)
        });
      }
    }
  });

  return variables;
}

function extractImports(tree, sourceCode) {
  if (!tree || !tree.rootNode) return [];

  const importTypes = [
    'import_statement',
    'import_declaration',
    'require',
    'call_expression'
  ];

  const imports = [];

  traverseAST(tree.rootNode, function(node) {
    if (node.type === 'import_statement' || node.type === 'import_declaration') {
      const name = _extractImportName(node, sourceCode);
      if (name) {
        imports.push({ name: name, line: node.startPosition.row + 1 });
      }
    }
  });

  return imports;
}

function _extractFunctionName(node) {
  try {
    if (node.children) {
      const nameNode = node.children.find(function(c) {
        return c.type === 'identifier' || c.type === 'property_identifier';
      });
      if (nameNode) return nameNode.text || '';
    }
    const match = (node.text || '').match(/(?:function|def|fn|func)\s+(\w+)/);
    return match ? match[1] : 'anonymous';
  } catch (e) {
    return 'anonymous';
  }
}

function _extractFunctionParams(node, sourceCode) {
  try {
    const text = node.text || '';
    const match = text.match(/\(([^)]*)\)/);
    if (match) {
      return match[1].split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
    }
    return [];
  } catch (e) {
    return [];
  }
}

function _isAsyncFunction(node) {
  try {
    if (node.children) {
      return node.children.some(function(c) { return c.type === 'async'; });
    }
    return (node.text || '').startsWith('async ');
  } catch (e) {
    return false;
  }
}

function _extractVariableName(node) {
  try {
    if (node.children) {
      const nameNode = node.children.find(function(c) { return c.type === 'identifier'; });
      if (nameNode) return nameNode.text || '';
    }
    return '';
  } catch (e) {
    return '';
  }
}

function _getVariableKind(node) {
  try {
    if (node.parent && node.parent.type) {
      if (node.parent.type.includes('let')) return 'let';
      if (node.parent.type.includes('const')) return 'const';
    }
    return 'var';
  } catch (e) {
    return 'var';
  }
}

function _extractImportName(node, sourceCode) {
  try {
    const text = node.text || '';
    const match = text.match(/(?:from|require)\s*['"]([^'"]+)['"]/);
    return match ? match[1] : '';
  } catch (e) {
    return '';
  }
}

module.exports = {
  parseCode: parseCode,
  initParser: initParser,
  loadLanguage: loadLanguage,
  getNodeType: getNodeType,
  getNodeText: getNodeText,
  findNodesByType: findNodesByType,
  getNodesByType: getNodesByType,
  getAllFunctions: getAllFunctions,
  extractFunctions: extractFunctions,
  extractVariables: extractVariables,
  extractImports: extractImports,
  traverseAST: traverseAST,
  getSupportedLanguages: getSupportedLanguages,
  FallbackParser: FallbackParser,
  resolveWasmDir: resolveWasmDir,
  getDiagnostics: getDiagnostics
};
