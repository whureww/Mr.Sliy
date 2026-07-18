const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const languageParsers = new Map();
let Parser = null;
let parserInitialized = false;

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

function resolveWasmDir() {
  const candidates = [];

  try {
    const pkgDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    const outDir = path.join(pkgDir, 'out');
    if (fs.existsSync(outDir)) {
      candidates.push(outDir);
    }
  } catch (e) {
    // ignore
  }

  const localPaths = [
    path.join(__dirname, '..', '..', '..', 'wasm'),
    path.join(__dirname, '..', '..', 'wasm'),
    path.join(process.cwd(), 'wasm')
  ];

  if (require.main && require.main.filename) {
    localPaths.push(path.join(path.dirname(require.main.filename), '..', 'wasm'));
  }

  candidates.push(...localPaths);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const files = fs.readdirSync(candidate);
      const validWasmFiles = files.filter(f => f.endsWith('.wasm'));
      if (validWasmFiles.length > 0) {
        return candidate;
      }
    }
  }

  return null;
}

async function initParser() {
  if (parserInitialized) return Parser !== null;
  parserInitialized = true;

  try {
    Parser = require('web-tree-sitter');
    const parserPkgDir = path.dirname(require.resolve('web-tree-sitter/package.json'));
    const treeSitterWasmPath = path.join(parserPkgDir, 'tree-sitter.wasm');

    const initOptions = {};
    if (fs.existsSync(treeSitterWasmPath)) {
      initOptions.locateFile = function(fileName) {
        if (fileName === 'tree-sitter.wasm') {
          return treeSitterWasmPath;
        }
        return fileName;
      };
    }

    await Parser.init(initOptions);
    return true;
  } catch (error) {
    Parser = null;
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
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

async function loadLanguage(languageName) {
  if (languageParsers.has(languageName)) {
    return languageParsers.get(languageName);
  }

  if (!Parser) {
    languageParsers.set(languageName, null);
    return null;
  }

  const wasmPath = findWasmFile(languageName);
  if (!wasmPath) {
    languageParsers.set(languageName, null);
    return null;
  }

  try {
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    languageParsers.set(languageName, { parser: parser, language: language });
    return { parser: parser, language: language };
  } catch (error) {
    languageParsers.set(languageName, null);
    return null;
  }
}

function serializeNode(node) {
  if (!node) return null;

  const children = node.children || node.namedChildren || [];

  return {
    type: node.type,
    text: node.text || '',
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    children: children.map(c => serializeNode(c))
  };
}

async function parseCode(sourceCode, languageName) {
  try {
    const initSuccess = await initParser();

    if (initSuccess) {
      const langParser = await loadLanguage(languageName);

      if (langParser) {
        const tree = langParser.parser.parse(sourceCode);
        const rootNode = serializeNode(tree.rootNode);
        
        return {
          success: true,
          language: languageName,
          rootNode: rootNode,
          fallback: false
        };
      }
    }

    const tree = fallbackParse(sourceCode);
    return {
      success: true,
      language: languageName,
      rootNode: tree.rootNode,
      fallback: true
    };
  } catch (error) {
    const tree = fallbackParse(sourceCode);
    return {
      success: true,
      language: languageName,
      rootNode: tree.rootNode,
      fallback: true,
      error: error.message
    };
  }
}

function fallbackParse(sourceCode) {
  const lines = sourceCode.split('\n');
  const nodes = [];

  lines.forEach(function(line, index) {
    const trimmed = line.trim();
    if (!trimmed) return;

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
    }
  });

  return {
    rootNode: {
      type: 'program',
      children: nodes,
      text: sourceCode,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: lines.length - 1, column: lines[lines.length - 1].length },
      children: nodes
    }
  };
}

if (!isMainThread) {
  parentPort.on('message', async (task) => {
    try {
      const { id, action, sourceCode, languageName } = task;

      let result;
      switch (action) {
        case 'parse':
          result = await parseCode(sourceCode, languageName);
          break;
        case 'init':
          result = await initParser();
          break;
        default:
          result = { success: false, error: 'Unknown action' };
      }

      parentPort.postMessage({ id, result });
    } catch (error) {
      parentPort.postMessage({ id: task.id, result: { success: false, error: error.message } });
    }
  });
}

module.exports = {
  parseCode
};