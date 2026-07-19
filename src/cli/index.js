/**
 * Code Optimizer Agent CLI 交互入口
 * 交互式菜单面板 + 命令行智能体
 * 支持：上下键选择、Enter确认、模糊搜索、美化界面
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { agent } = require('../agent/agent');
const { logger } = require('../utils/logger');
const { ProgressBar, MultiStepProgress } = require('../utils/progress');
const { padEndDisplay } = require('../utils/helpers');
const mysql = require('../utils/mysql');
const { notificationSystem } = require('../utils/notificationSystem');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  'bright cyan': '\x1b[96m',
  'bright magenta': '\x1b[95m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m'
};

function c(text, color) {
  return (colors[color] || colors.white) + text + colors.reset;
}

function clearScreen() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[3J');
  } else {
    console.clear();
  }
}

const MENU_ITEMS = [
  { key: 'analyze', command: '/analyze', label: '/analyze', desc: '分析单个文件', shortcut: 'a', keywords: 'analyze file analysis 分析' },
  { key: 'scan', command: '/scan', label: '/scan', desc: '扫描项目目录', shortcut: 's', keywords: 'scan project directory 扫描' },
  { key: 'optimize', command: '/optimize', label: '/optimize', desc: '交互式代码优化', shortcut: 'o', keywords: 'optimize code improvement optimization 优化' },
  { key: 'provider', command: '/provider', label: '/provider', desc: '大模型提供商管理', shortcut: 'p', keywords: 'provider llm model api 提供商 模型' },
  { key: 'knowledge', command: '/knowledge', label: '/knowledge', desc: '知识库管理', shortcut: 'k', keywords: 'knowledge kb database rag 知识库' },
  { key: 'update', command: '/update', label: '/update', desc: '自更新管理', shortcut: 'u', keywords: 'update self-update upgrade 更新 升级' },
  { key: 'repair', command: '/repair', label: '/repair', desc: '自修复管理', shortcut: 'r', keywords: 'repair self-repair fix 修复' },
  { key: 'mode', command: '/mode', label: '/mode', desc: '切换工作模式', shortcut: 'm', keywords: 'mode online offline auto 模式 离线 在线' },
  { key: 'status', command: '/status', label: '/status', desc: '查看系统状态', shortcut: 'i', keywords: 'status info state stat 状态 信息' },
  { key: 'health', command: '/health', label: '/health', desc: '健康检查', shortcut: 'h', keywords: 'health check monitor 健康 检查' },
  { key: 'sustain', command: '/sustain', label: '/sustain', desc: 'AI自持引擎', shortcut: 't', keywords: 'sustain ai self-sustain auto 自持 自动' },
  { key: 'help', command: '/help', label: '/help', desc: '帮助文档', shortcut: '?', keywords: 'help manual usage guide 帮助 说明' },
  { key: 'clear', command: '/clear', label: '/clear', desc: '清空屏幕', shortcut: 'c', keywords: 'clear cls screen clean 清空 清理' },
  { key: 'exit', command: '/exit', label: '/exit', desc: '退出程序', shortcut: 'e', keywords: 'exit quit bye 离开 退出' }
];

const inputState = {
  mode: 'idle',
  selectedIndex: 0,
  filter: '',
  inputBuffer: '',
  inputPrompt: '',
  inputResolve: null,
  inputSubmitOnEnter: true,
  showCursor: true
};

function initInput() {
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
  }
  process.stdin.on('keypress', handleGlobalKeypress);
}

function handleGlobalKeypress(chunk, key) {
  if (inputState.mode === 'menu') {
    handleMenuKeypress(key);
  } else if (inputState.mode === 'search') {
    handleSearchKeypress(key);
  } else if (inputState.mode === 'input' || inputState.mode === 'password') {
    handleInputKeypress(key);
  } else {
    return;
  }
}

function getFilteredMenu() {
  if (!inputState.filter) return MENU_ITEMS;
  const f = inputState.filter.toLowerCase();
  return MENU_ITEMS.filter(item =>
    item.key.toLowerCase().includes(f) ||
    item.label.toLowerCase().includes(f) ||
    item.shortcut.toLowerCase().includes(f) ||
    item.desc.toLowerCase().includes(f) ||
    (item.keywords && item.keywords.toLowerCase().includes(f))
  );
}

function handleMenuKeypress(key) {
  const filtered = getFilteredMenu();

  if (key.name === 'up' || (key.name === 'p' && key.ctrl)) {
    if (filtered.length > 0) {
      inputState.selectedIndex = Math.max(0, inputState.selectedIndex - 1);
      reprintMenu();
      printChatPrompt();
    }
  } else if (key.name === 'down' || (key.name === 'n' && key.ctrl)) {
    if (filtered.length > 0) {
      inputState.selectedIndex = Math.min(filtered.length - 1, inputState.selectedIndex + 1);
      reprintMenu();
      printChatPrompt();
    }
  } else if (key.name === 'return' || key.name === 'enter') {
    if (filtered.length > 0 && filtered[inputState.selectedIndex]) {
      const choice = filtered[inputState.selectedIndex].key;
      inputState.mode = 'idle';
      if (inputState.inputResolve) {
        inputState.inputResolve(choice);
        inputState.inputResolve = null;
      }
    }
  } else if (key.name === '/') {
    inputState.mode = 'search';
    inputState.filter = '';
    inputState.selectedIndex = 0;
    reprintMenu();
    printChatPrompt();
    process.stdout.write('\n  🔎 搜索: ');
  } else if (key.name === 'escape') {
    if (inputState.filter) {
      inputState.filter = '';
      inputState.selectedIndex = 0;
      reprintMenu();
      printChatPrompt();
    }
  } else if (key.name === 'backspace') {
  } else if (key.name === 'q') {
    inputState.mode = 'idle';
    if (inputState.inputResolve) {
      inputState.inputResolve('__BACK__');
      inputState.inputResolve = null;
    }
  } else if (key.name === 'c' && key.ctrl) {
    process.exit(0);
  } else if (!key.ctrl && !key.meta && key.name && key.name.length === 1) {
    const shortcutItem = filtered.find(item => item.shortcut === key.name);
    if (shortcutItem) {
      inputState.mode = 'idle';
      if (inputState.inputResolve) {
        inputState.inputResolve(shortcutItem.key);
        inputState.inputResolve = null;
      }
    }
  }
}

function handleInputKeypress(key) {
  if (key.name === 'return' || key.name === 'enter') {
    const value = inputState.inputBuffer;
    inputState.mode = 'idle';
    inputState.inputBuffer = '';
    inputState.promptText = '';
    process.stdout.write('\n');
    if (inputState.inputResolve) {
      inputState.inputResolve(value);
      inputState.inputResolve = null;
    }
  } else if (key.name === 'backspace') {
    if (inputState.inputBuffer.length > 0) {
      inputState.inputBuffer = inputState.inputBuffer.slice(0, -1);
      process.stdout.write('\r');
      process.stdout.write(c(inputState.promptText, 'white'));
      process.stdout.write(inputState.inputBuffer);
      process.stdout.write('\x1b[K');
    }
  } else if (key.name === 'tab') {
    autocompleteInput();
  } else if (key.name === 'escape') {
    inputState.mode = 'idle';
    inputState.inputBuffer = '';
    inputState.promptText = '';
    process.stdout.write('\n');
    if (inputState.inputResolve) {
      inputState.inputResolve('__CANCEL__');
      inputState.inputResolve = null;
    }
  } else if (key.name === 'c' && key.ctrl) {
    process.exit(0);
  } else if (key.name === 'up' || key.name === 'down' || key.name === 'left' || key.name === 'right' || key.name === 'home' || key.name === 'end' || key.name === 'pageup' || key.name === 'pagedown') {
    return;
  } else if (!key.ctrl && !key.meta && key.sequence && typeof key.sequence === 'string') {
    inputState.inputBuffer += key.sequence;
    if (inputState.mode !== 'password') {
      process.stdout.write(key.sequence);
    } else {
      process.stdout.write('*');
    }
  }
}

function autocompleteInput() {
  const input = inputState.inputBuffer;
  
  if (!input.startsWith('/')) {
    return;
  }
  
  const matches = MENU_ITEMS.filter(item => 
    item.command.startsWith(input) || 
    item.key.startsWith(input.substring(1))
  );
  
  if (matches.length === 1) {
    inputState.inputBuffer = matches[0].command;
    process.stdout.write('\r');
    process.stdout.write(c(inputState.promptText, 'white'));
    process.stdout.write(inputState.inputBuffer);
    process.stdout.write('\x1b[K');
  } else if (matches.length > 1) {
    const commonPrefix = findCommonPrefix(matches.map(m => m.command));
    if (commonPrefix.length > input.length) {
      inputState.inputBuffer = commonPrefix;
      process.stdout.write('\r');
      process.stdout.write(c(inputState.promptText, 'white'));
      process.stdout.write(inputState.inputBuffer);
      process.stdout.write('\x1b[K');
    } else {
      console.log();
      matches.forEach(item => {
        console.log('  ' + c(item.command, 'cyan') + ' - ' + c(item.desc, 'gray'));
      });
      process.stdout.write(c(inputState.promptText, 'white') + inputState.inputBuffer);
    }
  }
}

function findCommonPrefix(strings) {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (strings[i].indexOf(prefix) !== 0) {
      prefix = prefix.substring(0, prefix.length - 1);
      if (prefix === '') return '';
    }
  }
  return prefix;
}

function handleSearchKeypress(key) {
  if (key.name === 'return' || key.name === 'enter') {
    inputState.mode = 'menu';
    process.stdout.write('\n');
    reprintMenu();
  } else if (key.name === 'escape') {
    inputState.filter = '';
    inputState.selectedIndex = 0;
    inputState.mode = 'menu';
    process.stdout.write('\n');
    reprintMenu();
  } else if (key.name === 'backspace') {
    if (inputState.filter.length > 0) {
      inputState.filter = inputState.filter.slice(0, -1);
      inputState.selectedIndex = 0;
      process.stdout.write('\r');
      process.stdout.write('  🔎 搜索: ' + inputState.filter);
      process.stdout.write('\x1b[K');
    }
  } else if (key.name === 'up') {
    const filtered = getFilteredMenu();
    if (filtered.length > 0) {
      inputState.selectedIndex = Math.max(0, inputState.selectedIndex - 1);
      reprintMenu();
      process.stdout.write('  🔎 搜索: ' + inputState.filter);
    }
  } else if (key.name === 'down') {
    const filtered = getFilteredMenu();
    if (filtered.length > 0) {
      inputState.selectedIndex = Math.min(filtered.length - 1, inputState.selectedIndex + 1);
      reprintMenu();
      process.stdout.write('  🔎 搜索: ' + inputState.filter);
    }
  } else if (!key.ctrl && !key.meta && key.sequence) {
    inputState.filter += key.sequence;
    inputState.selectedIndex = 0;
    process.stdout.write(key.sequence);
  }
}

async function showMenu() {
  return new Promise((resolve) => {
    const menuState = {
      input: '',
      selectedIndex: 0,
      resolve,
      isCommandMode: false
    };

    function cleanup() {
      process.stdin.removeListener('keypress', handleKey);
      process.stdin.on('keypress', handleGlobalKeypress);
      inputState.mode = 'idle';
    }

    function render() {
      clearScreen();
      printBanner();
      printStatusBar();
      printMenu();

      process.stdout.write('\n');

      const input = menuState.input || '';
      const filtered = getFilteredCommands(input);

      if (input.startsWith('/') && filtered.length > 0) {
        process.stdout.write(c('  (✧∇✧)╯ 匹配命令:', 'cyan') + '\n');

        const maxDisplay = 5;
        const start = Math.max(0, Math.min(menuState.selectedIndex - Math.floor(maxDisplay / 2), filtered.length - maxDisplay));
        const end = Math.min(start + maxDisplay, filtered.length);

        for (let i = start; i < end; i++) {
          const item = filtered[i];
          const isSel = i === menuState.selectedIndex;
          const prefix = isSel ? c('  ▶ ', 'green') : '    ';
          const cmd = isSel ? c(item.command, 'bright white') : c(item.command, 'cyan');
          const desc = isSel ? c('  ' + item.desc, 'white') : c('  ' + item.desc, 'gray');
          process.stdout.write(prefix + cmd + desc + '\n');
        }

        if (filtered.length > maxDisplay) {
          process.stdout.write(c('    ... 共 ' + filtered.length + ' 条匹配', 'dim') + '\n');
        }
      } else if (input && !input.startsWith('/')) {
        process.stdout.write(c("  (´･ω･`) 按 Enter 发送消息与AI聊天", 'gray') + '\n');
      } else {
        process.stdout.write(c('  输入 /command 执行功能，直接输入文字与AI聊天', 'gray') + '\n');
        process.stdout.write(c('  ↑↓ 选择命令  Enter 确认  Esc 取消', 'gray') + '\n');
      }

      process.stdout.write(c('  ' + '─'.repeat(66), 'dim') + '\n');
      process.stdout.write('\n');
      
      const promptLine = c(' (◕ᴗ◕✿) ', 'magenta') + c('输入命令或与AI聊天: ', 'white') + input;
      process.stdout.write(promptLine);
    }

    function isEnter(chunk) {
      return chunk === '\r' || chunk === '\n' || chunk === '\r\n';
    }

    function isBackspace(chunk) {
      return chunk === '\b' || chunk === '\x7f' || chunk === '\x08';
    }

    function isEscape(chunk) {
      return chunk === '\x1b' || chunk === '\x1b\x1b';
    }

    function isUpArrow(chunk, key) {
      return (chunk === '\x1b[A' || chunk === '\x1bOA') || (key && key.name === 'up');
    }

    function isDownArrow(chunk, key) {
      return (chunk === '\x1b[B' || chunk === '\x1bOB') || (key && key.name === 'down');
    }

    function isTab(chunk) {
      return chunk === '\t';
    }

    function isCtrlC(chunk) {
      return chunk === '\x03';
    }

    function isPrintable(chunk) {
      if (!chunk || typeof chunk !== 'string') return false;
      if (chunk.length === 0) return false;
      if (chunk.startsWith('\x1b')) return false;
      if (chunk === '\r' || chunk === '\n') return false;
      if (chunk === '\b' || chunk === '\x7f') return false;
      if (chunk === '\t') return false;
      if (chunk.charCodeAt(0) < 32 && chunk.charCodeAt(0) !== 0) return false;
      return true;
    }

    function handleKey(chunk, key) {
      if (isEnter(chunk)) {
        cleanup();
        process.stdout.write('\n');

        const input = menuState.input || '';
        if (!input.trim()) {
          resolve(null);
          return;
        }

        const filtered = getFilteredCommands(input);
        if (input.startsWith('/') && filtered.length > 0 && menuState.selectedIndex < filtered.length) {
          resolve(filtered[menuState.selectedIndex].key);
        } else if (input.startsWith('/')) {
          process.stdout.write(c('  ✗ 未知命令: ' + input, 'red') + '\n');
          setTimeout(() => {
            waitEnter().then(() => resolve(null));
          }, 100);
        } else {
          handleAIChat(input.trim()).then(() => resolve(null));
        }
        return;
      }

      if (isEscape(chunk)) {
        cleanup();
        process.stdout.write('\n');
        resolve('__BACK__');
        return;
      }

      if (isUpArrow(chunk, key)) {
        const filtered = getFilteredCommands(menuState.input || '');
        if (filtered.length > 0) {
          menuState.selectedIndex = Math.max(0, menuState.selectedIndex - 1);
          render();
        }
        return;
      }

      if (isDownArrow(chunk, key)) {
        const filtered = getFilteredCommands(menuState.input || '');
        if (filtered.length > 0) {
          menuState.selectedIndex = Math.min(filtered.length - 1, menuState.selectedIndex + 1);
          render();
        }
        return;
      }

      if (isTab(chunk)) {
        const filtered = getFilteredCommands(menuState.input || '');
        if (filtered.length > 0) {
          menuState.input = filtered[menuState.selectedIndex].command;
          menuState.selectedIndex = 0;
          render();
        }
        return;
      }

      if (isBackspace(chunk)) {
        if ((menuState.input || '').length > 0) {
          menuState.input = (menuState.input || '').slice(0, -1);
          menuState.selectedIndex = 0;
          render();
        }
        return;
      }

      if (isCtrlC(chunk)) {
        cleanup();
        process.exit(0);
        return;
      }

      if (isPrintable(chunk)) {
        menuState.input = (menuState.input || '') + chunk;
        menuState.selectedIndex = 0;
        render();
      }
    }

    inputState.mode = 'menu_input';
    process.stdin.removeListener('keypress', handleGlobalKeypress);
    process.stdin.on('keypress', handleKey);
    render();
  });
}

function getFilteredCommands(input) {
  if (!input || !input.startsWith('/')) {
    return [];
  }

  const query = input.substring(1).toLowerCase();

  return MENU_ITEMS.filter(item => {
    const cmdName = item.key.toLowerCase();
    if (cmdName.startsWith(query)) return true;
    if (cmdName.includes(query)) return true;

    if (item.desc.includes(query)) return true;

    return false;
  });
}

function printChatPrompt() {
}

async function chatWithAI() {
  clearScreen();
  printBanner();
  console.log(c('  (◕ᴗ◕✿)  AI代码助手', 'bright cyan'));
  console.log(c('  输入 q 返回主菜单，空行发送消息', 'dim'));
  console.log(c('  仅限代码相关内容，AI可帮您调用智能体功能', 'dim'));
  console.log(c('─'.repeat(70), 'dim'));
  console.log();
  
  const firstMessage = await ask(c('(◕ᴗ◕✿) ', 'magenta') + c("您: ", 'white'));
  if (firstMessage === '__CANCEL__' || firstMessage.toLowerCase() === 'q' || firstMessage.toLowerCase() === 'quit') {
    return;
  }
  if (!firstMessage.trim()) {
    return;
  }
  
  await handleAIChat(firstMessage);
}

function ask(prompt) {
  return new Promise((resolve) => {
    inputState.mode = 'input';
    inputState.inputBuffer = '';
    inputState.promptText = prompt;
    inputState.inputResolve = resolve;
    process.stdout.write(prompt);
    if (typeof process.stdout.flush === 'function') {
      process.stdout.flush();
    }
  });
}

function askPassword(prompt) {
  return new Promise((resolve) => {
    inputState.mode = 'password';
    inputState.inputBuffer = '';
    inputState.inputResolve = resolve;
    process.stdout.write(c(prompt, 'white'));
  });
}

function printBanner() {
  const pkg = require('../../package.json');
  const version = pkg.version || '1.0.0';

  // 像素艺术大标题 "MRSLIY"
  const asciiArt = [
    ' M   M RRRR      SSSS L     IIIII Y   Y ',
    ' MM MM R   R    S     L       I    Y Y  ',
    ' M M M RRRR      SSS  L       I     Y   ',
    ' M   M R  R         S L       I     Y   ',
    ' M   M R   R    SSSS  LLLLL IIIII   Y   '
  ];

  console.log();
  asciiArt.forEach(line => {
    console.log(c(line, 'bright cyan'));
  });

  console.log();
  console.log(c('  ~ 多语言代码优化智能体 ~', 'white'));
  console.log(c('  v' + version, 'dim') + c('  ·  基于 Tree-sitter + RAG 的智能检测优化', 'gray'));
  console.log();

  console.log(c('  (´･ω･`) ', 'magenta') + c('离线模式: ', 'green') + c('AST检测 + 本地RAG知识库', 'white'));
  console.log(c('  (≧∀≦)  ', 'magenta') + c('在线模式: ', 'blue') + c('AST检测 + 云端大模型 + RAG增强', 'white'));
  console.log(c("  (っ'-')╮  ", 'magenta') + c('自动模式: ', 'yellow') + c('智能判断，自动切换最优模式', 'white'));
  console.log();
}

function printStatusBar() {
  const status = agent.getStatus();
  const mode = status.engine.actualMode;
  const modeLabel = mode === 'online' ? 'ONLINE' : mode === 'offline' ? 'OFFLINE' : 'AUTO';
  const providers = status.engine.providers.filter(p => p.available).length;
  const kb = status.engine.knowledgeBase;

  let t = '';
  t += c('  (๑•̀ㅂ•́)و✧  ', 'magenta');
  t += c('状态', 'dim') + ': ' + c(status.state, 'green') + '    ';
  t += c('模式', 'dim') + ': ' + c(modeLabel, 'white') + '    ';
  t += c('提供商', 'dim') + ': ' + c(providers, 'cyan') + '    ';
  t += c('知识库', 'dim') + ': ' + c(kb.totalEntries + '条', 'magenta');

  console.log(t);
  console.log(c('  ' + '─'.repeat(66), 'dim'));
}

function printMenu() {
  console.log();
  console.log(c('  (✧∇✧)╯  可用命令', 'bright cyan'));
  console.log(c('  ' + '─'.repeat(66), 'dim'));

  MENU_ITEMS.forEach(item => {
    console.log('    ' + c(item.command, 'cyan') + c('  - ', 'white') + c(item.desc, 'gray'));
  });

  console.log(c('  ' + '─'.repeat(66), 'dim'));
}

async function handleAIChat(initialMessage) {
  console.log();
  agent.clearChatHistory();
  let message = initialMessage;

  try {
    while (true) {
      console.log();
      
      const progressBar = new ProgressBar({
        total: 100,
        description: 'AI思考中',
        showPercent: true,
        showCount: false,
        showETA: true,
        width: 40
      });

      progressBar.startAnimation();

      let isThinking = true;
      let currentIteration = 0;
      let maxIterations = 5;

      const onProgress = (progress) => {
        if (progress.phase === 'done') {
          isThinking = false;
          progressBar.complete(progress.status);
          return;
        }

        currentIteration = progress.iteration;
        maxIterations = progress.maxIterations;

        if (progress.phase === 'thinking') {
          const percent = Math.round((currentIteration / maxIterations) * 40);
          progressBar.update(percent, `思考第 ${currentIteration}/${maxIterations} 轮`);
        } else if (progress.phase === 'tools') {
          const percent = 40 + Math.round((currentIteration / maxIterations) * 30);
          progressBar.update(percent, `执行 ${progress.toolCount} 个工具`);
        } else if (progress.phase === 'tool') {
          const percent = 40 + Math.round((currentIteration / maxIterations) * 30) + 
                          Math.round((progress.toolIndex / progress.toolCount) * 20);
          progressBar.update(Math.min(95, percent), `执行: ${progress.status}`);
        }
      };

      const result = await agent.chat(message, { onProgress });

      progressBar.stopAnimation();

      process.stdout.write('\n');
      console.log(c(' (◕ᴗ◕✿) AI:', 'magenta'));
      console.log(c('    ' + result.content.replace(/\n/g, '\n    '), 'white'));

      if (result.toolCalls && result.toolCalls.length > 0) {
        console.log();
        console.log(c("  (◕ᴗ◕✿) 已调用工具:", 'cyan'));
        result.toolCalls.forEach((call, i) => {
          console.log(c(`    ${i + 1}. ${call.function}`, 'white'));
          if (call.params && Object.keys(call.params).length > 0) {
            const paramStr = Object.entries(call.params)
              .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 30 ? v.slice(0, 30) + '...' : v}`)
              .join(', ');
            console.log(c(`       参数: ${paramStr}`, 'gray'));
          }
        });
        console.log(c(`    共 ${result.iterations} 轮迭代`, 'gray'));
      }

      console.log();
      console.log(c('─'.repeat(70), 'dim'));
      process.stdout.write('\n');
      if (typeof process.stdout.flush === 'function') {
        process.stdout.flush();
      }
      const nextInput = await ask(c('(◕ᴗ◕✿) ', 'magenta') + c('继续对话或输入 q 返回: ', 'white'));
      
      if (nextInput === '__CANCEL__' || nextInput.toLowerCase() === 'q' || nextInput.toLowerCase() === 'quit' || !nextInput.trim()) {
        agent.clearChatHistory();
        return;
      }
      
      message = nextInput;
    }
  } catch (error) {
    console.log(c('  ✗ 聊天失败: ' + error.message, 'red'));
    console.log(c('    请先在提供商管理中配置并启用LLM提供商', 'yellow'));
    console.log();
    agent.clearChatHistory();
    await waitEnter();
  }
}

function parseFunctionCall(content) {
  const match = content.match(/<function_call>\s*([\s\S]*?)\s*<\/function_call>/i);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function executeFunctionCall(call) {
  switch (call.function) {
    case 'analyze_file':
      if (call.params?.filePath) {
        console.log(c('    正在分析文件: ' + call.params.filePath, 'white'));
        await analyzeFile(call.params.filePath);
      }
      break;
    case 'scan_project':
      if (call.params?.path) {
        console.log(c('    正在扫描项目: ' + call.params.path, 'white'));
        await scanProject(call.params.path);
      }
      break;
    case 'optimize_code':
      if (call.params?.code) {
        console.log(c('    正在优化代码...', 'white'));
        await optimizeCodeWithCode(call.params.code);
      }
      break;
    case 'search_knowledge':
      if (call.params?.query) {
        console.log(c('    正在搜索知识库: ' + call.params.query, 'white'));
        await searchKnowledge(call.params.query);
      }
      break;
    case 'get_status':
      await showStatus();
      break;
    case 'switch_provider':
      if (call.params?.name) {
        console.log(c('    正在切换提供商: ' + call.params.name, 'white'));
        try {
          await agent.switchProvider(call.params.name);
          console.log(c('    ✓ 切换成功', 'green'));
        } catch (error) {
          console.log(c('    ✗ 切换失败: ' + error.message, 'red'));
        }
      }
      break;
    case 'switch_mode':
      if (call.params?.mode) {
        console.log(c('    正在切换模式: ' + call.params.mode, 'white'));
        try {
          await agent.configure({ mode: call.params.mode });
          console.log(c('    ✓ 切换成功', 'green'));
        } catch (error) {
          console.log(c('    ✗ 切换失败: ' + error.message, 'red'));
        }
      }
      break;
    default:
      console.log(c("    (´･ω･`) 未知功能: " + call.function, 'yellow'));
  }
}

async function optimizeCodeWithCode(code) {
  console.log(c('  (◕ᴗ◕✿) 代码优化结果', 'bright cyan'));
  console.log(c('─'.repeat(70), 'dim'));
  console.log();

  try {
    const result = await agent.analyzeSnippet(code, 'javascript', { generalOptimize: true });
    
    if (!result.success) {
      console.log(c('  ✗ 优化失败: ' + result.message, 'red'));
      return;
    }
    
    console.log(c('  ✓ 分析完成 [' + result.mode + ']', 'green'));
    console.log();
    
    result.issues.forEach((issue, i) => {
      console.log(c('  ' + (i + 1) + '. ' + issue.message, 'yellow'));
      
      if (issue.optimization) {
        const expl = (issue.optimization.explanation || '').replace(/参考知识[\s\S]*$/, '').trim();
        if (expl) console.log(c('     说明: ' + expl, 'white'));
        
        if (issue.optimization.optimizedCode && issue.optimization.optimizedCode !== issue.codeSnippet) {
          console.log(c('     优化后:', 'green'));
          issue.optimization.optimizedCode.split('\n').forEach(l => {
            console.log(c('       ' + l, 'cyan'));
          });
        }
        
        if (issue.optimization.suggestions && issue.optimization.suggestions.length > 0) {
          console.log(c('     建议:', 'green'));
          issue.optimization.suggestions.slice(0, 3).forEach(s => {
            console.log(c('       • ' + s, 'white'));
          });
        }
      }
      console.log();
    });
  } catch (error) {
    console.log(c('  ✗ 优化失败: ' + error.message, 'red'));
  }
}

async function searchKnowledge(query) {
  console.log(c('  (≧∀≦) 知识库搜索结果', 'bright cyan'));
  console.log(c('─'.repeat(70), 'dim'));
  console.log();

  try {
    const results = await agent.searchKnowledge(query, { limit: 5 });
    
    if (!results || results.length === 0) {
      console.log(c('  未找到相关知识', 'yellow'));
      return;
    }
    
    results.forEach((item, i) => {
      console.log(c('  ' + (i + 1) + '. ' + (item.title || '知识条目'), 'green'));
      console.log(c('     ' + (item.content || item.description || '').substring(0, 100) + '...', 'white'));
      if (item.type) console.log(c('     类型: ' + item.type, 'dim'));
      console.log();
    });
  } catch (error) {
    console.log(c('  ✗ 搜索失败: ' + error.message, 'red'));
  }
}

function reprintMenu() {
  clearScreen();
  printBanner();
  printStatusBar();
  printMenu();
}

async function analyzeFile() {
  clearScreen();
  printBanner();
  console.log(c(' (✧ω✧) 文件分析', 'bright cyan'));
  console.log(c('  输入 q 返回主菜单，Esc 取消', 'dim'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const filePath = await ask('  请输入文件路径: ');
  
  if (filePath === '__CANCEL__') return;
  if (filePath.toLowerCase() === 'q' || filePath.toLowerCase() === 'quit') return;
  if (!filePath) {
    console.log(c('  已取消', 'yellow'));
    await waitEnter();
    return;
  }
  
  if (!fs.existsSync(filePath)) {
    console.log(c('  ✗ 文件不存在: ' + filePath, 'red'));
    await waitEnter();
    return;
  }
  
  console.log();

  const progressBar = new ProgressBar({
    total: 100,
    description: '文件分析',
    showPercent: true,
    showCount: false,
    showStatus: true,
    showETA: true,
    width: 35
  });

  progressBar.startAnimation();

  const onProgress = (p) => {
    let percent = 0;
    let desc = '文件分析';
    let status = p.status || '';

    switch (p.phase) {
      case 'reading':
        percent = 10;
        desc = '读取文件';
        break;
      case 'parsing':
        percent = 30;
        desc = '解析语法树';
        break;
      case 'optimizing':
        const total = p.totalIssues || 1;
        const current = p.current || 0;
        percent = 30 + Math.round((current / total) * 60);
        desc = '优化 (' + current + '/' + total + ')';
        break;
      case 'done':
        percent = 100;
        desc = '分析完成';
        break;
      default:
        break;
    }

    progressBar.update(percent, { description: desc, status });
  };

  try {
    const result = await agent.analyzeFile(filePath, { onProgress });

    progressBar.complete('分析完成', '发现 ' + result.totalIssues + ' 个问题');
    
    console.log();
    console.log(c('  ┌─ 分析结果 ──────────────────────────────────────────────', 'bright'));
    console.log(c('  语言: ' + result.language, 'white'));
    console.log(c('  模式: ' + result.mode, 'blue'));
    console.log(c('  耗时: ' + result.durationMs + 'ms', 'dim'));
    console.log(c('  发现问题: ' + result.totalIssues + ' 个', result.totalIssues > 0 ? 'yellow' : 'green'));
    
    if (result.totalIssues > 0) {
      const counts = result.issueCounts;
      console.log(c('  严重: ' + counts.critical + '  高: ' + counts.high + '  中: ' + counts.medium + '  低: ' + counts.low, 'white'));
      console.log();
      
      const displayIssues = result.issues.slice(0, 10);
      displayIssues.forEach((issue, i) => {
        const sevColor = issue.severity === 'critical' || issue.severity === 'high' ? 'red' : 'yellow';
        console.log(c('  ' + (i + 1) + '. [' + issue.severity.toUpperCase() + '] ' + issue.message, sevColor));
        console.log(c('     位置: 第' + issue.lineStart + '行', 'dim'));
        
        if (issue.optimization && issue.optimization.success) {
          const expl = (issue.optimization.explanation || '').substring(0, 80).replace(/参考知识[\s\S]*$/, '').trim();
          const mode = issue.optimization.mode === 'online' ? '🔵 大模型' : '🟢 本地';
          if (expl) console.log(c("     (´･ω･`) [" + mode + "] " + expl, 'green'));
        }
      });
      
      if (result.issues.length > 10) {
        console.log(c('  ... 还有 ' + (result.issues.length - 10) + ' 个问题', 'dim'));
      }
    }
    
    console.log();
    console.log(c('  └────────────────────────────────────────────────────────', 'bright'));
    console.log();
    await waitEnter();
  } catch (error) {
    progressBar.fail('分析失败', error.message);
    console.log(c('  ✗ 分析失败: ' + error.message, 'red'));
    await waitEnter();
  }
}

async function scanProject() {
  clearScreen();
  printBanner();
  console.log(c('  (✧ω✧)  项目扫描', 'bright cyan'));
  console.log(c('  输入 q 返回主菜单，Esc 取消', 'dim'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const projectPath = await ask('  请输入项目路径: ');
  
  if (projectPath === '__CANCEL__') return;
  if (projectPath.toLowerCase() === 'q' || projectPath.toLowerCase() === 'quit') return;
  if (!projectPath) {
    console.log(c('  已取消', 'yellow'));
    await waitEnter();
    return;
  }
  
  if (!fs.existsSync(projectPath)) {
    console.log(c('  ✗ 路径不存在: ' + projectPath, 'red'));
    await waitEnter();
    return;
  }
  
  console.log();
  
  const progressBar = new ProgressBar({
    total: 100,
    description: '项目扫描',
    showPercent: true,
    showCount: false,
    showStatus: true,
    showETA: true,
    width: 30
  });

  progressBar.startAnimation();

  const onProgress = (p) => {
    let percent = 0;
    let desc = '项目扫描';
    let status = p.status || '';

    switch (p.phase) {
      case 'collecting':
        percent = 5;
        desc = '收集文件';
        break;
      case 'scanning':
        const total = p.totalFiles || 1;
        const current = p.current || 0;
        percent = Math.round((current / total) * 100);
        desc = current + '/' + total + ' 文件';
        if (p.issuesFound !== undefined) {
          status = (p.currentFileName || '') + ' (' + p.issuesFound + '个问题)';
        }
        break;
      case 'done':
        percent = 100;
        desc = '扫描完成';
        break;
      default:
        break;
    }

    progressBar.update(percent, { description: desc, status });
  };

  try {
    const result = await agent.analyzeProject(projectPath, { onProgress });

    progressBar.complete('扫描完成', result.totalFiles + '个文件, ' + result.totalIssues + '个问题');
    
    console.log();
    console.log(c('  ┌─ 扫描结果 ──────────────────────────────────────────────', 'bright'));
    console.log(c('  模式: ' + result.mode, 'blue'));
    console.log(c('  耗时: ' + result.durationMs + 'ms', 'dim'));
    console.log(c('  扫描文件: ' + result.scannedFiles + '/' + result.totalFiles, 'white'));
    console.log(c('  失败文件: ' + result.failedFiles, result.failedFiles > 0 ? 'yellow' : 'white'));
    console.log(c('  总问题数: ' + result.totalIssues, result.totalIssues > 0 ? 'yellow' : 'green'));
    
    const fileIssues = result.results
      .filter(r => r.success && r.totalIssues > 0)
      .map(r => ({ file: path.basename(r.filePath), count: r.totalIssues }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    
    if (fileIssues.length > 0) {
      console.log();
      console.log(c('  问题最多的文件:', 'cyan'));
      fileIssues.forEach(f => {
        console.log(c('     ' + f.file + ': ' + f.count + ' 个问题', 'white'));
      });
    }
    
    console.log();
    console.log(c('  └────────────────────────────────────────────────────────', 'bright'));
    console.log();
    await waitEnter();
  } catch (error) {
    progressBar.fail('扫描失败', error.message);
    console.log(c('  ✗ 扫描失败: ' + error.message, 'red'));
    await waitEnter();
  }
}

async function optimizeCode() {
  clearScreen();
  printBanner();
  console.log(c('  (◕ᴗ◕✿)  交互式代码优化', 'bright cyan'));
  console.log(c('  输入 q 返回主菜单，空行结束输入', 'dim'));
  console.log(c('─'.repeat(70), 'dim'));
  console.log(c('  请输入代码片段（空行结束输入）:', 'white'));
  console.log();
  
  let codeLines = [];
  while (true) {
    const line = await ask('  > ');
    if (line === '__CANCEL__') return;
    if (line.toLowerCase() === 'q' || line.toLowerCase() === 'quit') return;
    if (!line.trim()) break;
    codeLines.push(line);
  }
  
  const code = codeLines.join('\n');
  if (!code.trim()) {
    console.log(c('  未输入代码', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log();
  
  const progressBar = new ProgressBar({
    total: 100,
    description: '代码优化',
    showPercent: true,
    showCount: false,
    showStatus: true,
    showETA: true,
    width: 30
  });

  progressBar.startAnimation();

  const onProgress = (p) => {
    let percent = 0;
    let desc = '代码优化';
    let status = p.status || '';

    switch (p.phase) {
      case 'parsing':
        percent = 20;
        desc = '解析语法树';
        break;
      case 'optimizing':
        const total = p.totalIssues || 1;
        const current = p.current || 0;
        percent = 20 + Math.round((current / total) * 60);
        desc = '优化 (' + current + '/' + total + ')';
        break;
      case 'general_optimize':
        percent = 80;
        desc = '生成优化建议';
        break;
      case 'done':
        percent = 100;
        desc = '优化完成';
        break;
      default:
        break;
    }

    progressBar.update(percent, { description: desc, status });
  };

  try {
    const result = await agent.analyzeSnippet(code, 'javascript', {
      generalOptimize: true,
      onProgress
    });

    progressBar.complete('优化完成', '发现 ' + result.totalIssues + ' 个问题');
    
    console.log();
    console.log(c('  ┌─ 优化结果 ──────────────────────────────────────────────', 'bright'));
    
    if (!result.success) {
      console.log(c('  ✗ 优化失败: ' + result.message, 'red'));
      console.log(c('  └────────────────────────────────────────────────────────', 'bright'));
      await waitEnter();
      return;
    }
    
    console.log(c('  模式: ' + result.mode, 'blue'));
    
    if (result.issues.length === 0) {
      console.log(c('  ✓ 代码质量优秀，未发现明显问题', 'green'));
    } else {
      result.issues.forEach((issue, i) => {
        console.log();
        console.log(c('  ' + (i + 1) + '. ' + issue.message, 'yellow'));
        
        if (issue.optimization) {
          const mode = issue.optimization.mode === 'online' ? '🔵 大模型' : '🟢 本地';
          const expl = (issue.optimization.explanation || '').replace(/参考知识[\s\S]*$/, '').trim();
          if (expl) console.log(c('     说明: [' + mode + '] ' + expl, 'white'));
          
          if (issue.optimization.optimizedCode && issue.optimization.optimizedCode !== issue.codeSnippet) {
            console.log(c('     优化后:', 'green'));
            issue.optimization.optimizedCode.split('\n').forEach(l => {
              console.log(c('       ' + l, 'cyan'));
            });
          }
          
          if (issue.optimization.suggestions && issue.optimization.suggestions.length > 0) {
            console.log(c('     建议:', 'green'));
            issue.optimization.suggestions.slice(0, 3).forEach(s => {
              console.log(c('       • ' + s, 'white'));
            });
          }
        }
      });
    }
    
    console.log();
    console.log(c('  └────────────────────────────────────────────────────────', 'bright'));
    await waitEnter();
  } catch (error) {
    progressBar.fail('优化失败', error.message);
    console.log(c('  ✗ 优化失败: ' + error.message, 'red'));
    await waitEnter();
  }
}

async function providerMenu() {
  while (true) {
    clearScreen();
    printBanner();
    console.log(c("  (´･ω･`)  大模型提供商管理", 'bright cyan'));
    console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    const providers = agent.getProviders();
    
    console.log(c('  已注册提供商:', 'cyan'));
    providers.forEach((p, i) => {
      const marker = p.available ? '✓' : '✗';
      const color = p.available ? 'green' : 'red';
      const status = p.available ? '已配置' : '未配置';
      console.log(c('  ' + (i + 1) + '. [' + marker + '] ' + p.name + ' (' + p.model + ') ' + status, color));
    });
    console.log();
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) 切换活跃提供商  (switch)', 'white'));
    console.log(c('    2) 注册新提供商    (register)', 'white'));
    console.log(c('    3) 配置API Key     (config)', 'white'));
    console.log(c('    4) 查看可用列表      (list)', 'white'));
    console.log(c('    0) 返回主菜单      (back)', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
      return;
    }
    
    switch (choice) {
      case '1':
      case 'switch':
        await switchProvider();
        break;
      case '2':
      case 'register':
        await registerProvider();
        break;
      case '3':
      case 'config':
        await configProvider();
        break;
      case '4':
      case 'list':
        console.log();
        console.log(c('  支持的提供商:', 'cyan'));
        console.log(c('    openai, claude, azure, gemini, tongyi, doubao, wenxin, deepseek, zhipu, moonshot, ollama', 'white'));
        await waitEnter();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
        await waitEnter();
    }
  }
}

async function switchProvider() {
  const name = await ask('  请输入提供商名称: ');
  if (name === '__CANCEL__') return;
  if (name.toLowerCase() === 'q' || name.toLowerCase() === 'quit') return;
  if (!name) return;
  
  const result = await agent.switchProvider(name);
  console.log(c(result.success ? '  ✓ ' + result.message : '  ✗ ' + result.message, result.success ? 'green' : 'red'));
  await waitEnter();
}

async function registerProvider() {
  const name = await ask('  请输入提供商名称 (例如 deepseek/zhipu/tongyi): ');
  if (name === '__CANCEL__') return;
  if (name.toLowerCase() === 'q' || name.toLowerCase() === 'quit') return;
  if (!name) return;
  
  const apiKey = await ask('  请输入 API Key: ');
  if (apiKey === '__CANCEL__') return;
  if (apiKey.toLowerCase() === 'q') return;
  
  const model = await ask('  请输入模型名称 (可选，直接回车跳过): ');
  if (model === '__CANCEL__') return;
  
  const baseURL = await ask('  请输入 API 地址 (可选，直接回车使用默认): ');
  if (baseURL === '__CANCEL__') return;
  
  const config = { apiKey };
  if (model) config.model = model;
  if (baseURL) config.baseURL = baseURL;
  
  const result = await agent.registerProvider(name, config);
  console.log(c(result.success ? '  ✓ ' + result.message : '  ✗ ' + result.message, result.success ? 'green' : 'red'));
  await waitEnter();
}

async function configProvider() {
  const name = await ask('  请输入提供商名称: ');
  if (name === '__CANCEL__') return;
  if (name.toLowerCase() === 'q' || name.toLowerCase() === 'quit') return;
  if (!name) return;
  
  const apiKey = await ask('  请输入新的 API Key: ');
  if (apiKey === '__CANCEL__') return;
  if (apiKey.toLowerCase() === 'q') return;
  
  const result = await agent.updateProviderConfig(name, { apiKey });
  
  console.log(c(result.success ? '  ✓ ' + result.message : '  ✗ ' + result.message, result.success ? 'green' : 'red'));
  await waitEnter();
}

async function knowledgeMenu() {
  while (true) {
    clearScreen();
    printBanner();
    console.log(c('  (≧∀≦)  知识库管理', 'bright cyan'));
    console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    const stats = agent.getStatus().engine.knowledgeBase;
    console.log(c('  总条目: ' + stats.totalEntries + '  |  总案例: ' + stats.totalCases, 'white'));
    console.log();
    
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) 搜索知识库      (search)', 'white'));
    console.log(c('    2) 导入知识库      (import)', 'white'));
    console.log(c('    3) 导出知识库      (export)', 'white'));
    console.log(c('    4) 添加知识条目    (add)', 'white'));
    console.log(c('    5) 查看统计        (stats)', 'white'));
    console.log(c('    6) 检测重复条目    (duplicate)', 'white'));
    console.log(c('    7) 云端同步设置    (cloud)', 'white'));
    console.log(c('    0) 返回主菜单      (back)', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
      return;
    }
    
    switch (choice) {
      case '1':
      case 'search':
        await searchKnowledge();
        break;
      case '2':
      case 'import':
        await importKnowledge();
        break;
      case '3':
      case 'export':
        await exportKnowledge();
        break;
      case '4':
      case 'add':
        await addKnowledge();
        break;
      case '5':
      case 'stats':
        await showKnowledgeStats();
        break;
      case '6':
      case 'duplicate':
        await checkDuplicateEntries();
        break;
      case '7':
      case 'cloud':
        await cloudSyncMenu();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
        await waitEnter();
    }
  }
}

async function exportKnowledge() {
  console.log();
  const filePath = await ask('  请输入导出文件路径 (默认 data/knowledge-export.json): ');
  
  if (filePath === '__CANCEL__') return;
  if (filePath.toLowerCase() === 'q' || filePath.toLowerCase() === 'quit') return;
  
  try {
    console.log(c('  正在导出知识库...', 'cyan'));
    const result = agent.exportKnowledge(filePath || undefined);
    console.log(c('  (◕ᴗ◕✿) 导出成功！', 'green'));
    console.log(c('    知识条目: ' + result.entryCount + ' 条', 'white'));
    console.log(c('    优化案例: ' + result.caseCount + ' 个', 'white'));
  } catch (error) {
    console.log(c('  ✗ 导出失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function cloudSyncMenu() {
  while (true) {
    console.log();
    console.log(c("  (っ'-')╮  云端同步", 'bright cyan'));
    console.log(c('  输入 q 返回上一级', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    const { config } = require('../config');
    const cloudEnabled = config.mysql.enabled;
    
    console.log(c('  云端同步状态: ' + (cloudEnabled ? c('已启用', 'green') : c('未启用', 'yellow')), 'white'));
    console.log(c('  服务器: ' + config.mysql.host + ':' + config.mysql.port, 'dim'));
    console.log(c('  数据库: ' + config.mysql.database, 'dim'));
    console.log();
    
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) 测试连接        (test)', 'white'));
    console.log(c('    2) 上传到云端      (upload)', 'white'));
    console.log(c('    3) 从云端下载      (download)', 'white'));
    console.log(c('    4) 数据库连接管理  (manage)', 'white'));
    console.log(c('    0) 返回            (back)', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
      return;
    }
    
    switch (choice) {
      case '1':
      case 'test':
        await testCloudConnection();
        break;
      case '2':
      case 'upload':
        await uploadToCloud();
        break;
      case '3':
      case 'download':
        await downloadFromCloud();
        break;
      case '4':
      case 'manage':
        await manageDatabaseConnections();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
    }
  }
}

async function testCloudConnection() {
  console.log();
  console.log(c('  正在测试云端连接...', 'cyan'));
  
  try {
    const result = await agent.testCloudConnection();
    if (result.success) {
      console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
    } else {
      console.log(c('  ✗ 连接失败: ' + result.message, 'red'));
      console.log(c('  提示: 请确保 MySQL 服务器已启动并开放 3306 端口', 'yellow'));
    }
  } catch (error) {
    console.log(c('  ✗ 测试失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function uploadToCloud() {
  console.log();
  console.log(c('  上传模式:', 'cyan'));
  console.log(c('    1) 合并更新 (merge) - 有则更新，无则添加', 'white'));
  console.log(c('    2) 覆盖云端 (overwrite) - 删除云端所有数据后重新上传', 'white'));
  console.log(c('    3) 仅追加 (append) - 只添加新数据，不更新已有数据', 'white'));
  console.log();
  
  const modeChoice = await ask('  请选择上传模式 (默认 1): ');
  if (modeChoice === '__CANCEL__') return;
  
  let mode = 'merge';
  switch (modeChoice) {
    case '2':
    case 'overwrite':
      mode = 'overwrite';
      break;
    case '3':
    case 'append':
      mode = 'append';
      break;
    default:
      mode = 'merge';
  }
  
  const modeName = mode === 'merge' ? '合并更新' : mode === 'overwrite' ? '覆盖云端' : '仅追加';
  const confirm = await ask(`  确认${modeName}模式上传到云端？(y/N): `);
  
  if (confirm === '__CANCEL__') return;
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log(c('  已取消', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log(c('  正在同步到云端...', 'cyan'));
  
  try {
    const result = await agent.syncKnowledgeToCloud(mode);
    if (result.success) {
      console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
      if (result.updatedEntries > 0 || result.updatedCases > 0) {
        console.log(c(`  📝 更新: ${result.updatedEntries} 条知识, ${result.updatedCases} 个案例`, 'yellow'));
      }
    } else {
      console.log(c('  ✗ 同步失败: ' + result.message, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 同步失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function downloadFromCloud() {
  console.log();
  const confirm = await ask('  确认从云端同步到本地？(本地已有数据将被覆盖) (y/N): ');
  
  if (confirm === '__CANCEL__') return;
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log(c('  已取消', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log(c('  正在从云端同步...', 'cyan'));
  
  try {
    const result = await agent.syncKnowledgeFromCloud();
    if (result.success) {
      console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
    } else {
      console.log(c('  ✗ 同步失败: ' + result.message, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 同步失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function manageDatabaseConnections() {
  while (true) {
    console.log();
    console.log(c('  (๑•̀ㅂ•́)و✧  数据库连接管理', 'bright cyan'));
    console.log(c('  输入 q 返回上一级', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    const { getDatabaseConnections, getDatabaseConnection, config } = require('../config');
    const connections = getDatabaseConnections();
    const defaultConn = getDatabaseConnection(config.databases.defaultConnection);
    
    console.log(c('  当前默认连接: ' + (defaultConn ? c(defaultConn.name, 'green') : c('无', 'yellow')), 'white'));
    console.log();
    
    if (connections.length === 0) {
      console.log(c('  暂无数据库连接配置', 'yellow'));
    } else {
      console.log(c('  已配置连接:', 'cyan'));
      connections.forEach((conn, i) => {
        const isDefault = conn.id === config.databases.defaultConnection;
        const status = conn.enabled ? '已启用' : '未启用';
        const statusColor = conn.enabled ? 'green' : 'yellow';
        const defaultMarker = isDefault ? c(' [默认]', 'green') : '';
        console.log(c('  ' + (i + 1) + '. ' + conn.name + defaultMarker, 'white'));
        console.log(c('     类型: ' + conn.type + '  |  状态: ' + status, statusColor));
        console.log(c('     服务器: ' + conn.host + ':' + conn.port, 'dim'));
        console.log(c('     数据库: ' + conn.database, 'dim'));
      });
    }
    
    console.log();
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) 添加新连接      (add)', 'white'));
    console.log(c('    2) 编辑连接        (edit)', 'white'));
    console.log(c('    3) 删除连接        (delete)', 'white'));
    console.log(c('    4) 切换默认连接    (switch)', 'white'));
    console.log(c('    5) 测试连接        (test)', 'white'));
    console.log(c('    0) 返回            (back)', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
      return;
    }
    
    switch (choice) {
      case '1':
      case 'add':
        await addDatabaseConnection();
        break;
      case '2':
      case 'edit':
        await editDatabaseConnection();
        break;
      case '3':
      case 'delete':
        await deleteDatabaseConnection();
        break;
      case '4':
      case 'switch':
        await switchDefaultConnection();
        break;
      case '5':
      case 'test':
        await testSpecificConnection();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
    }
  }
}

async function addDatabaseConnection() {
  console.log();
  console.log(c('  添加新数据库连接', 'bright cyan'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const { addDatabaseConnection: addConn } = require('../config');
  
  const id = await ask('  请输入连接ID (用于标识，如 mydb): ');
  if (id === '__CANCEL__') return;
  if (id.toLowerCase() === 'q' || id.toLowerCase() === 'quit') return;
  if (!id) {
    console.log(c('  连接ID不能为空', 'yellow'));
    await waitEnter();
    return;
  }
  
  const name = await ask('  请输入连接名称 (显示名称): ');
  if (name === '__CANCEL__') return;
  if (!name) {
    console.log(c('  连接名称不能为空', 'yellow'));
    await waitEnter();
    return;
  }
  
  const type = await ask('  请输入数据库类型 (mysql，默认): ');
  if (type === '__CANCEL__') return;
  
  const host = await ask('  请输入主机地址: ');
  if (host === '__CANCEL__') return;
  if (!host) {
    console.log(c('  主机地址不能为空', 'yellow'));
    await waitEnter();
    return;
  }
  
  const port = await ask('  请输入端口 (默认 3306): ');
  if (port === '__CANCEL__') return;
  
  const user = await ask('  请输入用户名: ');
  if (user === '__CANCEL__') return;
  
  const password = await askPassword('  请输入密码 (输入时不显示): ');
  if (password === '__CANCEL__') return;
  
  const database = await ask('  请输入数据库名 (默认 code_optimizer): ');
  if (database === '__CANCEL__') return;
  
  const enabled = await ask('  是否启用 (y/N): ');
  if (enabled === '__CANCEL__') return;
  
  const result = addConn({
    id: id.trim(),
    name: name.trim(),
    type: type.trim() || 'mysql',
    host: host.trim(),
    port: port.trim() ? parseInt(port) : 3306,
    user: user.trim(),
    password: password,
    database: database.trim() || 'code_optimizer',
    enabled: enabled.toLowerCase() === 'y' || enabled.toLowerCase() === 'yes'
  });
  
  console.log();
  if (result.success) {
    console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
    
    const confirmTest = await ask('  是否测试连接？(y/N): ');
    if (confirmTest === '__CANCEL__') {
      await waitEnter();
      return;
    }
    
    if (confirmTest.toLowerCase() === 'y' || confirmTest.toLowerCase() === 'yes') {
      const { getDatabaseConnection } = require('../config');
      const conn = getDatabaseConnection(id);
      if (conn) {
        try {
          const testResult = await mysql.testConnectionWithConfig(conn);
          console.log();
          if (testResult.success) {
            console.log(c('  (◕ᴗ◕✿) ' + testResult.message, 'green'));
          } else {
            console.log(c('  ✗ 测试连接失败: ' + testResult.message, 'red'));
          }
        } catch (error) {
          console.log();
          console.log(c('  ✗ 测试连接异常: ' + error.message, 'red'));
        }
      }
    }
  } else {
    console.log(c('  ✗ ' + result.message, 'red'));
    await waitEnter();
  }
}

async function editDatabaseConnection() {
  console.log();
  console.log(c('  编辑数据库连接', 'bright cyan'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const { getDatabaseConnections, getDatabaseConnection, updateDatabaseConnection } = require('../config');
  const connections = getDatabaseConnections();
  
  if (connections.length === 0) {
    console.log(c('  暂无数据库连接', 'yellow'));
    await waitEnter();
    return;
  }
  
  connections.forEach((conn, i) => {
    console.log(c('  ' + (i + 1) + '. ' + conn.name, 'white'));
    console.log(c('     服务器: ' + conn.host + ':' + conn.port, 'dim'));
  });
  
  const choice = await ask('  请选择要编辑的连接序号: ');
  if (choice === '__CANCEL__') return;
  if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit') return;
  
  const index = parseInt(choice) - 1;
  if (isNaN(index) || index < 0 || index >= connections.length) {
    console.log(c('  无效的选择', 'yellow'));
    await waitEnter();
    return;
  }
  
  const conn = connections[index];
  console.log();
  console.log(c('  当前配置:', 'cyan'));
  console.log(c('    名称: ' + conn.name, 'white'));
  console.log(c('    类型: ' + conn.type, 'white'));
  console.log(c('    主机: ' + conn.host, 'white'));
  console.log(c('    端口: ' + conn.port, 'white'));
  console.log(c('    用户: ' + conn.user, 'white'));
  console.log(c('    数据库: ' + conn.database, 'white'));
  console.log(c('    启用: ' + (conn.enabled ? '是' : '否'), conn.enabled ? 'green' : 'yellow'));
  console.log();
  
  const name = await ask('  请输入新的连接名称 (回车保持不变): ');
  if (name === '__CANCEL__') return;
  
  const host = await ask('  请输入新的主机地址 (回车保持不变): ');
  if (host === '__CANCEL__') return;
  
  const port = await ask('  请输入新的端口 (回车保持不变): ');
  if (port === '__CANCEL__') return;
  
  const user = await ask('  请输入新的用户名 (回车保持不变): ');
  if (user === '__CANCEL__') return;
  
  const password = await askPassword('  请输入新的密码 (回车保持不变，输入时不显示): ');
  if (password === '__CANCEL__') return;
  
  const database = await ask('  请输入新的数据库名 (回车保持不变): ');
  if (database === '__CANCEL__') return;
  
  const enabled = await ask('  是否启用 (y/N，回车保持不变): ');
  if (enabled === '__CANCEL__') return;
  
  const updates = {};
  if (name.trim()) updates.name = name.trim();
  if (host.trim()) updates.host = host.trim();
  if (port.trim()) updates.port = parseInt(port);
  if (user.trim()) updates.user = user.trim();
  if (password !== undefined && password !== null) updates.password = password;
  if (database.trim()) updates.database = database.trim();
  if (enabled && (enabled.toLowerCase() === 'y' || enabled.toLowerCase() === 'yes')) updates.enabled = true;
  if (enabled && (enabled.toLowerCase() === 'n' || enabled.toLowerCase() === 'no')) updates.enabled = false;
  
  const result = updateDatabaseConnection(conn.id, updates);
  
  console.log();
  if (result.success) {
    console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
  } else {
    console.log(c('  ✗ ' + result.message, 'red'));
  }
  await waitEnter();
}

async function deleteDatabaseConnection() {
  console.log();
  console.log(c('  删除数据库连接', 'bright cyan'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const { getDatabaseConnections, deleteDatabaseConnection: delConn } = require('../config');
  const connections = getDatabaseConnections();
  
  if (connections.length <= 1) {
    console.log(c('  至少需要保留一个数据库连接', 'yellow'));
    await waitEnter();
    return;
  }
  
  connections.forEach((conn, i) => {
    const isDefault = conn.id === 'mysql' ? c(' [默认]', 'green') : '';
    console.log(c('  ' + (i + 1) + '. ' + conn.name + isDefault, 'white'));
    console.log(c('     服务器: ' + conn.host + ':' + conn.port, 'dim'));
  });
  
  const choice = await ask('  请选择要删除的连接序号: ');
  if (choice === '__CANCEL__') return;
  if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit') return;
  
  const index = parseInt(choice) - 1;
  if (isNaN(index) || index < 0 || index >= connections.length) {
    console.log(c('  无效的选择', 'yellow'));
    await waitEnter();
    return;
  }
  
  const conn = connections[index];
  if (conn.id === 'mysql') {
    console.log(c('  默认连接不能删除', 'yellow'));
    await waitEnter();
    return;
  }
  
  const confirm = await ask('  确认删除连接 "' + conn.name + '"？(y/N): ');
  if (confirm === '__CANCEL__') return;
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log(c('  已取消', 'yellow'));
    await waitEnter();
    return;
  }
  
  const result = delConn(conn.id);
  
  console.log();
  if (result.success) {
    console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
  } else {
    console.log(c('  ✗ ' + result.message, 'red'));
  }
  await waitEnter();
}

async function switchDefaultConnection() {
  console.log();
  console.log(c('  切换默认数据库连接', 'bright cyan'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const { getDatabaseConnections, setDefaultConnection, config } = require('../config');
  const connections = getDatabaseConnections();
  
  if (connections.length === 0) {
    console.log(c('  暂无数据库连接', 'yellow'));
    await waitEnter();
    return;
  }
  
  connections.forEach((conn, i) => {
    const isDefault = conn.id === config.databases.defaultConnection;
    const marker = isDefault ? c(' [当前默认]', 'green') : '';
    console.log(c('  ' + (i + 1) + '. ' + conn.name + marker, isDefault ? 'green' : 'white'));
    console.log(c('     服务器: ' + conn.host + ':' + conn.port, 'dim'));
    console.log(c('     状态: ' + (conn.enabled ? '已启用' : '未启用'), conn.enabled ? 'green' : 'yellow'));
  });
  
  const choice = await ask('  请选择要设为默认的连接序号: ');
  if (choice === '__CANCEL__') return;
  if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit') return;
  
  const index = parseInt(choice) - 1;
  if (isNaN(index) || index < 0 || index >= connections.length) {
    console.log(c('  无效的选择', 'yellow'));
    await waitEnter();
    return;
  }
  
  const conn = connections[index];
  
  const result = setDefaultConnection(conn.id);
  
  console.log();
  if (result.success) {
    console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
    
    const confirmTest = await ask('  是否测试新的默认连接？(y/N): ');
    if (confirmTest === '__CANCEL__') {
      await waitEnter();
      return;
    }
    
    if (confirmTest.toLowerCase() === 'y' || confirmTest.toLowerCase() === 'yes') {
      await testCloudConnection();
    }
  } else {
    console.log(c('  ✗ ' + result.message, 'red'));
    await waitEnter();
  }
}

async function testSpecificConnection() {
  console.log();
  console.log(c('  测试数据库连接', 'bright cyan'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const { getDatabaseConnections } = require('../config');
  const mysql = require('../utils/mysql');
  const connections = getDatabaseConnections();
  
  if (connections.length === 0) {
    console.log(c('  暂无数据库连接', 'yellow'));
    await waitEnter();
    return;
  }
  
  connections.forEach((conn, i) => {
    console.log(c('  ' + (i + 1) + '. ' + conn.name, 'white'));
    console.log(c('     服务器: ' + conn.host + ':' + conn.port, 'dim'));
  });
  
  const choice = await ask('  请选择要测试的连接序号: ');
  if (choice === '__CANCEL__') return;
  if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit') return;
  
  const index = parseInt(choice) - 1;
  if (isNaN(index) || index < 0 || index >= connections.length) {
    console.log(c('  无效的选择', 'yellow'));
    await waitEnter();
    return;
  }
  
  const conn = connections[index];
  
  console.log(c('  正在测试连接 "' + conn.name + '"...', 'cyan'));
  
  try {
    const result = await mysql.testConnectionWithConfig(conn);
    
    console.log();
    if (result.success) {
      console.log(c('  (◕ᴗ◕✿) ' + result.message, 'green'));
    } else {
      console.log(c('  ✗ 连接失败: ' + result.message, 'red'));
      console.log(c('  提示: 请确保 MySQL 服务器已启动并开放对应端口', 'yellow'));
    }
  } catch (error) {
    console.log();
    console.log(c('  ✗ 测试连接异常: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function searchKnowledge() {
  const query = await ask('  请输入搜索词: ');
  if (query === '__CANCEL__') return;
  if (query.toLowerCase() === 'q' || query.toLowerCase() === 'quit') return;
  if (!query) return;
  
  const results = await agent.queryKnowledge(query);
  console.log();
  console.log(c('  找到 ' + results.total + ' 条结果', 'white'));
  console.log();
  
  if (results.entries.length > 0) {
    console.log(c('  知识条目:', 'cyan'));
    results.entries.slice(0, 5).forEach((e, i) => {
      console.log(c('    ' + (i + 1) + '. [' + (e.similarity * 100).toFixed(0) + '%] ' + e.content.substring(0, 60), 'white'));
    });
  }
  
  if (results.cases.length > 0) {
    console.log(c('  优化案例:', 'cyan'));
    results.cases.slice(0, 5).forEach((cc, i) => {
      console.log(c('    ' + (i + 1) + '. [' + (cc.similarity * 100).toFixed(0) + '%] ' + (cc.explanation || '').substring(0, 60), 'white'));
    });
  }
  
  console.log();
  await waitEnter();
}

async function importKnowledge() {
  while (true) {
    console.log();
    console.log(c('  导入来源:', 'cyan'));
    console.log(c('    1) GitHub 仓库    (github)', 'white'));
    console.log(c('    2) 单个 URL      (url)', 'white'));
    console.log(c('    3) 本地文件      (file)', 'white'));
    console.log(c('    0) 返回          (back)', 'dim'));
    console.log();
    
    const choice = await ask('  请选择来源: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
      return;
    }
    
    switch (choice) {
      case '1':
      case 'github':
        await importFromGithub();
        break;
      case '2':
      case 'url':
        await importFromUrl();
        break;
      case '3':
      case 'file':
        await importFromFile();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
    }
  }
}

async function importFromGithub() {
  const repo = await ask('  请输入GitHub仓库地址 (user/repo): ');
  if (repo === '__CANCEL__') return;
  if (repo.toLowerCase() === 'q' || repo.toLowerCase() === 'quit') return;
  if (!repo) return;
  
  console.log(c('  正在从GitHub获取知识库内容...', 'cyan'));
  
  try {
    const url = 'https://api.github.com/repos/' + repo + '/readme';
    const response = await fetch(url, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
    
    if (!response.ok) {
      console.log(c('  ✗ 获取失败: ' + response.statusText, 'red'));
      await waitEnter();
      return;
    }
    
    const data = await response.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    
    const lines = content.split('\n').filter(l => l.trim().length > 20);
    let added = 0;
    
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      if (line.length > 10 && line.length < 200) {
        const r = await agent.addKnowledge(line, {
          type: 'best_practice',
          language: 'general',
          tags: ['github', repo.split('/')[1]],
          source: 'github:' + repo
        });
        if (r.success) added++;
      }
    }
    
    console.log(c('  ✓ 成功导入 ' + added + ' 条知识', 'green'));
    await waitEnter();
  } catch (error) {
    console.log(c('  ✗ 导入失败: ' + error.message, 'red'));
    await waitEnter();
  }
}

async function importFromUrl() {
  const url = await ask('  请输入URL地址: ');
  if (url === '__CANCEL__') return;
  if (url.toLowerCase() === 'q' || url.toLowerCase() === 'quit') return;
  if (!url) return;
  
  console.log(c('  正在从URL获取内容...', 'cyan'));
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(c('  ✗ 获取失败: ' + response.statusText, 'red'));
      await waitEnter();
      return;
    }
    
    const content = await response.text();
    const lines = content.split('\n').filter(l => l.trim().length > 20 && !l.trim().startsWith('<'));
    let added = 0;
    
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i].trim();
      if (line.length > 10 && line.length < 200) {
        const r = await agent.addKnowledge(line, {
          type: 'best_practice',
          language: 'general',
          tags: ['url-import'],
          source: url
        });
        if (r.success) added++;
      }
    }
    
    console.log(c('  ✓ 成功导入 ' + added + ' 条知识', 'green'));
    await waitEnter();
  } catch (error) {
    console.log(c('  ✗ 导入失败: ' + error.message, 'red'));
    await waitEnter();
  }
}

async function importFromFile() {
  const filePath = await ask('  请输入文件路径: ');
  if (filePath === '__CANCEL__') return;
  if (filePath.toLowerCase() === 'q' || filePath.toLowerCase() === 'quit') return;
  if (!filePath) return;
  
  if (!fs.existsSync(filePath)) {
    console.log(c('  ✗ 文件不存在: ' + filePath, 'red'));
    await waitEnter();
    return;
  }
  
  console.log(c('  正在读取并导入...', 'cyan'));
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 20);
    let added = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length > 10 && line.length < 300) {
        const r = await agent.addKnowledge(line, {
          type: 'best_practice',
          language: 'general',
          tags: ['file-import'],
          source: filePath
        });
        if (r.success) added++;
      }
    }
    
    console.log(c('  ✓ 成功导入 ' + added + ' 条知识', 'green'));
    await waitEnter();
  } catch (error) {
    console.log(c('  ✗ 导入失败: ' + error.message, 'red'));
    await waitEnter();
  }
}

async function addKnowledge() {
  const content = await ask('  请输入知识内容: ');
  if (content === '__CANCEL__') return;
  if (content.toLowerCase() === 'q' || content.toLowerCase() === 'quit') return;
  if (!content) return;
  
  const type = await ask('  类型 (best_practice/case/pattern) [best_practice]: ') || 'best_practice';
  if (type === '__CANCEL__') return;
  if (type.toLowerCase() === 'q' || type.toLowerCase() === 'quit') return;
  
  const language = await ask('  语言 [general]: ') || 'general';
  if (language === '__CANCEL__') return;
  if (language.toLowerCase() === 'q' || language.toLowerCase() === 'quit') return;
  
  const result = await agent.addKnowledge(content, {
    type,
    language,
    tags: ['manual'],
    source: 'manual'
  });
  
  console.log(c(result.success ? '  ✓ ' + result.message : '  ✗ ' + result.message, result.success ? 'green' : 'red'));
  await waitEnter();
}

async function showKnowledgeStats() {
  const stats = agent.getStatus().engine.knowledgeBase;
  console.log();
  console.log(c('  (๑•̀ㅂ•́)و✧ 知识库统计', 'cyan'));
  console.log(c('  总条目: ' + stats.totalEntries, 'white'));
  console.log(c('  总案例: ' + stats.totalCases, 'white'));
  
  if (stats.typeStats && stats.typeStats.length > 0) {
    console.log(c('  按类型:', 'blue'));
    stats.typeStats.forEach(t => {
      console.log(c('    ' + t.content_type + ': ' + t.count, 'white'));
    });
  }
  
  if (stats.languageStats && stats.languageStats.length > 0) {
    console.log(c('  按语言:', 'blue'));
    stats.languageStats.forEach(l => {
      console.log(c('    ' + l.language + ': ' + l.count, 'white'));
    });
  }
  
  console.log();
  await waitEnter();
}

async function checkDuplicateEntries() {
  console.log();
  console.log(c('  (✧ω✧) 检测重复知识条目', 'cyan'));
  console.log(c('  ─────────────────────────────────────────', 'dim'));
  
  try {
    const result = await agent.findDuplicateEntries();
    
    if (result.entries.length === 0 && result.cases.length === 0) {
      console.log(c('  (◕ᴗ◕✿) 未发现重复条目', 'green'));
      await waitEnter();
      return;
    }
    
    console.log(c('  (✧∇✧)╯ 发现重复条目:', 'yellow'));
    
    if (result.entries.length > 0) {
      console.log(c(`  知识条目: ${result.entries.length} 组重复`, 'white'));
      result.entries.slice(0, 5).forEach((item, index) => {
        console.log(c(`    ${index + 1}. ${item.content.substring(0, 50)}...`, 'dim'));
      });
      if (result.entries.length > 5) {
        console.log(c(`    ...还有 ${result.entries.length - 5} 组重复`, 'dim'));
      }
    }
    
    if (result.cases.length > 0) {
      console.log(c(`  优化案例: ${result.cases.length} 组重复`, 'white'));
      result.cases.slice(0, 5).forEach((item, index) => {
        console.log(c(`    ${index + 1}. ${item.original_code.substring(0, 50)}...`, 'dim'));
      });
      if (result.cases.length > 5) {
        console.log(c(`    ...还有 ${result.cases.length - 5} 组重复`, 'dim'));
      }
    }
    
    console.log();
    const confirm = await ask('  是否删除重复条目？(y/N): ');
    
    if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
      console.log(c('  正在删除重复条目...', 'cyan'));
      const removeResult = await agent.removeDuplicates();
      
      if (removeResult.success) {
        console.log(c('  (◕ᴗ◕✿) ' + removeResult.message, 'green'));
      } else {
        console.log(c('  ✗ 删除失败: ' + removeResult.message, 'red'));
      }
    } else {
      console.log(c('  已取消删除', 'yellow'));
    }
    
  } catch (error) {
    console.log(c('  ✗ 检测失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function modeMenu() {
  clearScreen();
  printBanner();
  console.log(c("  (っ'-')╮  切换工作模式", 'bright cyan'));
  console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const status = agent.getStatus();
  console.log(c('  当前配置模式: ' + status.config.mode, 'white'));
  console.log(c('  实际运行模式: ' + status.engine.actualMode, status.engine.actualMode === 'online' ? 'green' : 'yellow'));
  console.log();
  
  console.log(c('  可选模式:', 'cyan'));
  console.log(c('    1) 离线模式 (offline) - 仅使用本地AST检测+RAG知识库', 'white'));
  console.log(c('    2) 在线模式 (online) - AST检测+云端大模型+RAG增强', 'white'));
  console.log(c('    3) 自动模式 (auto) - 智能判断，自动切换最优模式', 'white'));
  console.log(c('    0) 返回主菜单 (back)', 'dim'));
  console.log();
  
  const choice = await ask('  请选择模式: ');
  
  if (choice === '__CANCEL__') return;
  if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
    return;
  }
  
  let mode = null;
  if (choice === '1' || choice === 'offline') mode = 'offline';
  else if (choice === '2' || choice === 'online') mode = 'online';
  else if (choice === '3' || choice === 'auto') mode = 'auto';
  
  if (mode) {
    const result = agent.setMode(mode);
    console.log(c('  ✓ 模式已切换: ' + result.mode + ' (实际: ' + result.actualMode + ')', 'green'));
    await waitEnter();
  } else {
    console.log(c('  无效的选择，请重新输入', 'yellow'));
    await waitEnter();
  }
}

async function showStatus() {
  clearScreen();
  printBanner();
  console.log(c('  (๑•̀ㅂ•́)و✧  系统状态', 'bright cyan'));
  console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
  console.log(c('─'.repeat(70), 'dim'));
  
  const status = agent.getStatus();
  
  console.log(c('  Agent 状态:', 'cyan'));
  console.log(c('    状态: ' + status.state, 'white'));
  console.log(c('    配置模式: ' + status.config.mode, 'white'));
  console.log(c('    实际模式: ' + status.engine.actualMode, status.engine.actualMode === 'online' ? 'green' : 'yellow'));
  console.log(c('    引擎初始化: ' + (status.engine.initialized ? '是' : '否'), 'white'));
  console.log(c('    任务历史: ' + status.historyCount + ' 条', 'white'));
  console.log();
  
  console.log(c('  LLM提供商:', 'cyan'));
  status.engine.providers.forEach(p => {
    const color = p.available ? 'green' : 'red';
    const marker = p.available ? '✓' : '✗';
    console.log(c('    [' + marker + '] ' + p.name + ' (' + p.model + ')', color));
  });
  console.log();
  
  console.log(c('  知识库:', 'cyan'));
  const kb = status.engine.knowledgeBase;
  console.log(c('    条目数: ' + kb.totalEntries, 'white'));
  console.log(c('    案例数: ' + kb.totalCases, 'white'));
  console.log();
  
  console.log(c('  系统健康:', 'cyan'));
  const health = status.health;
  if (health) {
    const statusColor = health.overallStatus === 'healthy' ? 'green' : health.overallStatus === 'warning' ? 'yellow' : 'red';
    const statusText = health.overallStatus === 'healthy' ? '健康' : health.overallStatus === 'warning' ? '警告' : '错误';
    console.log(c('    状态: ' + statusText, statusColor));
    
    if (health.details) {
      Object.entries(health.details).forEach(([name, detail]) => {
        const detailColor = detail.status === 'healthy' ? 'green' : detail.status === 'warning' ? 'yellow' : 'red';
        const detailMarker = detail.status === 'healthy' ? '✓' : detail.status === 'warning' ? '!' : '✗';
        console.log(c('    [' + detailMarker + '] ' + name + ': ' + detail.message, detailColor));
      });
    }
    
    if (health.issues && health.issues.length > 0) {
      console.log(c('    问题: ' + health.issues.join(', '), 'red'));
    }
    if (health.warnings && health.warnings.length > 0) {
      console.log(c('    警告: ' + health.warnings.join(', '), 'yellow'));
    }
  } else {
    console.log(c('    状态: 未知', 'dim'));
  }
  console.log();
  
  console.log(c('  配置:', 'cyan'));
  console.log(c('    自动保存: ' + (status.config.autoSave ? '是' : '否'), 'white'));
  console.log(c('    最大问题数/文件: ' + status.config.maxIssuesPerFile, 'white'));
  console.log();
  
  await waitEnter();
}

async function healthCheckMenu() {
  while (true) {
    clearScreen();
    printBanner();
    console.log(c('  (´･ω･`)  健康检查', 'bright cyan'));
    console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) 立即执行健康检查', 'white'));
    console.log(c('    2) 查看健康状态', 'white'));
    console.log(c('    3) 查看历史记录', 'white'));
    console.log(c('    0) 返回主菜单', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice === '0') {
      return;
    }
    
    switch (choice) {
      case '1':
        await runHealthCheck();
        break;
      case '2':
        await showHealthStatus();
        break;
      case '3':
        await showHealthHistory();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
        await waitEnter();
    }
  }
}

async function runHealthCheck() {
  console.log();
  console.log(c('  正在执行健康检查...', 'cyan'));
  
  try {
    const status = await agent.runHealthCheck();
    
    const statusColor = status.overallStatus === 'healthy' ? 'green' : status.overallStatus === 'warning' ? 'yellow' : 'red';
    const statusText = status.overallStatus === 'healthy' ? '健康' : status.overallStatus === 'warning' ? '警告' : '错误';
    
    console.log();
    console.log(c('  检查结果: ' + statusText, statusColor));
    console.log();
    
    if (status.details) {
      Object.entries(status.details).forEach(([name, detail]) => {
        const detailColor = detail.status === 'healthy' ? 'green' : detail.status === 'warning' ? 'yellow' : 'red';
        const detailMarker = detail.status === 'healthy' ? '✓' : detail.status === 'warning' ? '!' : '✗';
        console.log(c('    [' + detailMarker + '] ' + name + ': ' + detail.message, detailColor));
        
        if (detail.details) {
          Object.entries(detail.details).forEach(([key, value]) => {
            console.log(c('       ' + key + ': ' + value, 'dim'));
          });
        }
      });
    }
    
    if (status.issues && status.issues.length > 0) {
      console.log();
      console.log(c('  🚨 发现问题:', 'red'));
      status.issues.forEach((issue, index) => {
        console.log(c('    ' + (index + 1) + '. ' + issue, 'red'));
      });
    }
    
    if (status.warnings && status.warnings.length > 0) {
      console.log();
      console.log(c("  (´･ω･`) 警告:", 'yellow'));
      status.warnings.forEach((warning, index) => {
        console.log(c('    ' + (index + 1) + '. ' + warning, 'yellow'));
      });
    }
    
    if (status.overallStatus === 'healthy') {
      console.log();
      console.log(c('  (◕ᴗ◕✿) 系统运行正常', 'green'));
    }
    
  } catch (error) {
    console.log(c('  ✗ 健康检查失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function showHealthStatus() {
  console.log();
  const status = agent.getHealthStatus();
  
  const statusColor = status.overallStatus === 'healthy' ? 'green' : status.overallStatus === 'warning' ? 'yellow' : 'red';
  const statusText = status.overallStatus === 'healthy' ? '健康' : status.overallStatus === 'warning' ? '警告' : '错误';
  
  console.log(c('  当前健康状态: ' + statusText, statusColor));
  console.log(c('  检查时间: ' + new Date(status.timestamp).toLocaleString(), 'dim'));
  console.log();
  
  if (status.details) {
    Object.entries(status.details).forEach(([name, detail]) => {
      const detailColor = detail.status === 'healthy' ? 'green' : detail.status === 'warning' ? 'yellow' : 'red';
      const detailMarker = detail.status === 'healthy' ? '✓' : detail.status === 'warning' ? '!' : '✗';
      console.log(c('    [' + detailMarker + '] ' + name + ': ' + detail.message, detailColor));
    });
  }
  
  await waitEnter();
}

async function showHealthHistory() {
  console.log();
  const history = agent.getHealthHistory();
  
  if (history.length === 0) {
    console.log(c('  暂无健康检查历史记录', 'dim'));
    await waitEnter();
    return;
  }
  
  console.log(c('  健康检查历史 (最近10次):', 'cyan'));
  console.log(c('  ─────────────────────────────────────────', 'dim'));
  
  const recentHistory = history.slice(-10).reverse();
  recentHistory.forEach((status, index) => {
    const statusColor = status.overallStatus === 'healthy' ? 'green' : status.overallStatus === 'warning' ? 'yellow' : 'red';
    const statusText = status.overallStatus === 'healthy' ? '健康' : status.overallStatus === 'warning' ? '警告' : '错误';
    const time = new Date(status.timestamp).toLocaleTimeString();
    
    console.log(c('    ' + time + ' - ' + statusText, statusColor));
    if (status.issues && status.issues.length > 0) {
      console.log(c('       问题: ' + status.issues.length + '个', 'red'));
    }
  });
  
  await waitEnter();
}

async function sustainMenu() {
  while (true) {
    clearScreen();
    printBanner();
    console.log(c('  (≧∀≦)  AI自持引擎', 'bright cyan'));
    console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    const status = agent.getSustainStatus();
    const statusText = status.isRunning ? c('● 运行中', 'green') : c('○ 已停止', 'red');
    
    console.log(c('  引擎状态: ' + statusText, 'white'));
    console.log(c('  当前周期: ' + status.currentCycle, 'white'));
    console.log(c('  历史周期: ' + status.totalCycles, 'white'));
    console.log();
    
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) 查看仪表盘', 'white'));
    console.log(c('    2) 启动自持引擎', 'white'));
    console.log(c('    3) 停止自持引擎', 'white'));
    console.log(c('    4) 触发AI分析', 'white'));
    console.log(c('    5) 规则管理', 'white'));
    console.log(c('    6) 遥测数据', 'white'));
    console.log(c('    7) 验证统计', 'white'));
    console.log(c('    0) 返回主菜单', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice === '0') {
      return;
    }
    
    switch (choice) {
      case '1':
        await showSustainDashboard();
        break;
      case '2':
        agent.startSelfSustain();
        console.log(c('  ✓ AI自持引擎已启动', 'green'));
        await waitEnter();
        break;
      case '3':
        agent.stopSelfSustain();
        console.log(c('  ✓ AI自持引擎已停止', 'yellow'));
        await waitEnter();
        break;
      case '4':
        await triggerAnalysisMenu();
        break;
      case '5':
        await rulesMenu();
        break;
      case '6':
        await showTelemetry();
        break;
      case '7':
        await showValidationStats();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
        await waitEnter();
    }
  }
}

async function showSustainDashboard() {
  console.log();
  console.log(c('  (๑•̀ㅂ•́)و✧ AI自持引擎仪表盘', 'bright cyan'));
  console.log(c('  ─────────────────────────────────────────', 'dim'));
  
  const dashboard = await agent.getSustainDashboard();
  
  console.log(c('  引擎状态:', 'cyan'));
  console.log(c('    运行中: ' + (dashboard.engineStatus.isRunning ? '是' : '否'), 'white'));
  console.log(c('    当前周期: ' + dashboard.engineStatus.currentCycle, 'white'));
  console.log(c('    周期间隔: ' + (dashboard.engineStatus.cycleInterval / 60000) + '分钟', 'white'));
  console.log();
  
  console.log(c('  系统健康:', 'cyan'));
  const health = dashboard.health;
  if (health && health.overallStatus) {
    const statusColor = health.overallStatus === 'healthy' ? 'green' : health.overallStatus === 'warning' ? 'yellow' : 'red';
    console.log(c('    状态: ' + health.overallStatus, statusColor));
  }
  console.log();
  
  console.log(c('  统计数据:', 'cyan'));
  const stats = dashboard.stats;
  console.log(c('    运行时间: ' + Math.floor(stats.uptime / 60000) + '分钟', 'white'));
  console.log(c('    规则数量: ' + stats.rules.totalRules, 'white'));
  console.log(c('    分析次数: ' + (stats.analysis.total || 0), 'white'));
  console.log(c('    验证总数: ' + (stats.validation.total || 0), 'white'));
  console.log(c('    验证成功率: ' + (stats.validation.successRate || 0) + '%', 'white'));
  console.log();
  
  console.log(c('  关键指标:', 'cyan'));
  const m = stats.metrics;
  console.log(c('    优化成功率: ' + (m.optimizationSuccessRate || 0) + '%', 'white'));
  console.log(c('    知识命中率: ' + (m.knowledgeHitRate || 0) + '%', 'white'));
  console.log(c('    提供商失败率: ' + (m.providerFailureRate || 0) + '%', 'white'));
  console.log(c('    修复成功率: ' + (m.repairSuccessRate || 0) + '%', 'white'));
  
  await waitEnter();
}

async function triggerAnalysisMenu() {
  console.log();
  console.log(c('  (✧ω✧) 触发AI分析', 'cyan'));
  console.log(c('  分析焦点:', 'white'));
  console.log(c('    1) 通用分析', 'white'));
  console.log(c('    2) 优化质量', 'white'));
  console.log(c('    3) 系统稳定性', 'white'));
  console.log(c('    4) 性能分析', 'white'));
  console.log(c('    5) 知识库分析', 'white'));
  console.log(c('    6) 提供商可靠性', 'white'));
  console.log();
  
  const choice = await ask('  请选择分析焦点: ');
  const focusMap = {
    '1': 'general',
    '2': 'optimization_quality',
    '3': 'system_stability',
    '4': 'performance',
    '5': 'knowledge_base',
    '6': 'provider_reliability'
  };
  
  const focus = focusMap[choice] || 'general';
  console.log(c('  正在执行AI分析...', 'cyan'));
  
  try {
    const result = await agent.triggerAIAnalysis(focus);
    if (result.success) {
      console.log(c('  ✓ AI分析完成', 'green'));
      console.log(c('  摘要: ' + result.analysis.summary, 'white'));
      if (result.analysis.issues && result.analysis.issues.length > 0) {
        console.log(c('  发现问题:', 'yellow'));
        result.analysis.issues.forEach((issue, i) => {
          console.log(c('    ' + (i + 1) + '. [' + issue.severity + '] ' + issue.description, 'yellow'));
        });
      }
      if (result.analysis.suggestions && result.analysis.suggestions.length > 0) {
        console.log(c('  改进建议:', 'green'));
        result.analysis.suggestions.forEach((s, i) => {
          console.log(c('    ' + (i + 1) + '. [' + s.priority + '] ' + s.title, 'green'));
        });
      }
    } else {
      console.log(c('  ✗ AI分析失败: ' + result.error, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 执行失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function rulesMenu() {
  while (true) {
    console.log();
    console.log(c('  (✧∇✧)╯  规则管理', 'bright cyan'));
    const rules = agent.getRules();
    console.log(c('  共 ' + rules.length + ' 条规则:', 'white'));
    console.log();
    
    rules.forEach((rule, i) => {
      const enabledText = rule.enabled !== false ? c('✓', 'green') : c('✗', 'red');
      console.log(c('    ' + (i + 1) + '. ' + enabledText + ' [' + rule.priority + '] ' + rule.name, 'white'));
      console.log(c('       ID: ' + rule.id, 'dim'));
      console.log(c('       动作: ' + rule.action, 'dim'));
    });
    
    console.log();
    console.log(c('  操作: 1=查看历史 2=禁用规则 0=返回', 'dim'));
    const choice = await ask('  请选择: ');
    
    if (choice === '0' || choice.toLowerCase() === 'q') break;
    
    if (choice === '1') {
      const history = agent.getRuleHistory();
      console.log(c('  规则执行历史 (最近10次):', 'cyan'));
      const recent = history.slice(-10).reverse();
      recent.forEach(h => {
        const color = h.success ? 'green' : 'red';
        const time = new Date(h.timestamp).toLocaleTimeString();
        console.log(c('    ' + time + ' ' + h.ruleName + ' -> ' + (h.success ? '成功' : '失败'), color));
      });
      await waitEnter();
    } else if (choice === '2') {
      const ruleId = await ask('  输入要禁用的规则ID: ');
      if (agent.removeRule(ruleId)) {
        console.log(c('  ✓ 规则已禁用', 'green'));
      } else {
        console.log(c('  ✗ 规则不存在', 'red'));
      }
      await waitEnter();
    }
  }
}

async function showTelemetry() {
  console.log();
  console.log(c('  📈 遥测数据', 'cyan'));
  console.log(c('  ─────────────────────────────────────────', 'dim'));
  
  const data = agent.getTelemetry();
  
  console.log(c('  系统信息:', 'cyan'));
  console.log(c('    平台: ' + data.system.platform, 'white'));
  console.log(c('    架构: ' + data.system.arch, 'white'));
  console.log(c('    CPU核心: ' + data.system.cpuCount, 'white'));
  console.log(c('    Node版本: ' + data.system.nodeVersion, 'white'));
  console.log();
  
  console.log(c('  运行指标:', 'cyan'));
  const m = data.metrics;
  console.log(c('    运行时间: ' + Math.floor(data.uptime / 60000) + '分钟', 'white'));
  console.log(c('    优化请求: ' + m.optimizationRequests, 'white'));
  console.log(c('    优化成功: ' + m.optimizationSuccesses, 'white'));
  console.log(c('    优化失败: ' + m.optimizationFailures, 'white'));
  console.log(c('    优化成功率: ' + (m.optimizationSuccessRate || 0) + '%', 'white'));
  console.log(c('    知识查询: ' + m.knowledgeQueries, 'white'));
  console.log(c('    知识命中: ' + m.knowledgeHits, 'white'));
  console.log(c('    知识命中率: ' + (m.knowledgeHitRate || 0) + '%', 'white'));
  console.log(c('    提供商调用: ' + m.providerCalls, 'white'));
  console.log(c('    提供商失败: ' + m.providerFailures, 'white'));
  console.log(c('    修复尝试: ' + m.repairAttempts, 'white'));
  console.log(c('    修复成功: ' + m.repairSuccesses, 'white'));
  console.log(c('    更新尝试: ' + m.updateAttempts, 'white'));
  console.log(c('    更新成功: ' + m.updateSuccesses, 'white'));
  
  await waitEnter();
}

async function showValidationStats() {
  console.log();
  console.log(c('  (◕ᴗ◕✿) 验证统计', 'cyan'));
  console.log(c('  ─────────────────────────────────────────', 'dim'));
  
  const stats = await agent.getValidationStats();
  console.log(c('    验证总数: ' + stats.total, 'white'));
  console.log(c('    成功数量: ' + stats.successful, 'white'));
  console.log(c('    成功率: ' + stats.successRate + '%', 'white'));
  console.log(c('    平均改进分数: ' + (stats.avgImprovement || 0).toFixed(2), 'white'));
  
  await waitEnter();
}

async function showHelp() {
  clearScreen();
  printBanner();
  console.log(c('  (´･ω･`)  帮助文档', 'bright cyan'));
  console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
  console.log(c('─'.repeat(70), 'dim'));

  console.log(c('  快捷键:', 'cyan'));
  console.log(c('    ↑↓        上下选择菜单项', 'white'));
  console.log(c('    Enter     执行选中的命令', 'white'));
  console.log(c('    /         搜索/过滤命令', 'white'));
  console.log(c('    Esc       取消搜索/返回', 'white'));
  console.log(c('    q         返回上级菜单', 'white'));
  console.log(c('    字母键    快捷键快速执行', 'white'));
  console.log();

  console.log(c('  功能说明:', 'cyan'));
  console.log(c('    (✧ω✧) 文件分析   分析单个代码文件，检测缺陷并给出优化建议', 'white'));
  console.log(c('    (✧ω✧) 项目扫描   扫描整个项目，批量分析所有代码文件', 'white'));
  console.log(c('    (◕ᴗ◕✿) 代码优化   交互式输入代码，获取优化建议', 'white'));
  console.log(c("    (´･ω･`) 提供商管理 配置云端大模型，支持多种API", 'white'));
  console.log(c('    (≧∀≦) 知识库管理 搜索、导入、扩充本地RAG知识库', 'white'));
  console.log(c("    (っ'-')╮ 模式切换   离线/在线/自动 三种工作模式", 'white'));
  console.log(c('    (๑•̀ㅂ•́)و✧ 系统状态   查看系统运行状态和配置信息', 'white'));
  console.log();
  
  console.log(c('  工作模式:', 'cyan'));
  console.log(c('    离线模式  使用本地AST检测 + RAG知识库优化，无需联网', 'white'));
  console.log(c('    在线模式  AST检测 + 云端大模型 + RAG增强，效果更好', 'white'));
  console.log(c('    自动模式  自动判断可用资源，选择最优模式', 'white'));
  console.log();
  
  await waitEnter();
}

async function updateMenu() {
  while (true) {
    clearScreen();
    printBanner();
    console.log(c('  (✧∇✧)╯  自更新管理', 'bright cyan'));
    console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) AI智能更新      (ai)', 'white'));
    console.log(c('    2) 创建更新        (create)', 'white'));
    console.log(c('    3) 执行更新        (execute)', 'white'));
    console.log(c('    4) 查看更新记录    (history)', 'white'));
    console.log(c('    5) 回滚更新        (rollback)', 'white'));
    console.log(c('    6) 按版本回滚      (version)', 'white'));
    console.log(c('    7) 创建备份        (backup)', 'white'));
    console.log(c('    8) 查看备份        (backups)', 'white'));
    console.log(c('    9) 合并历史记录    (all)', 'white'));
    console.log(c('    0) 返回主菜单      (back)', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
      return;
    }
    
    switch (choice) {
      case '1':
      case 'ai':
        await aiUpdate();
        break;
      case '2':
      case 'create':
        await createUpdate();
        break;
      case '3':
      case 'execute':
        await executeUpdate();
        break;
      case '4':
      case 'history':
        await listUpdates();
        break;
      case '5':
      case 'rollback':
        await rollbackUpdate();
        break;
      case '6':
      case 'version':
        await rollbackToVersion();
        break;
      case '7':
      case 'backup':
        await createBackup();
        break;
      case '8':
      case 'backups':
        await listBackups();
        break;
      case '9':
      case 'all':
        await listBootstrapHistory();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
        await waitEnter();
    }
  }
}

async function aiUpdate() {
  const suggestion = await ask('  请输入您的更新想法或需求: ');
  
  if (suggestion === '__CANCEL__') return;
  if (suggestion.toLowerCase() === 'q' || suggestion.toLowerCase() === 'quit') return;
  if (!suggestion) {
    console.log(c('  请输入更新想法', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log();
  
  const progressBar = new ProgressBar({
    total: 100,
    description: 'AI智能更新',
    showPercent: true,
    showETA: true,
    width: 40
  });

  progressBar.startAnimation();

  try {
    const result = await agent.executeTool('update_from_ai', {
      suggestion,
      autoConfirm: false,
      onProgress: (p) => {
        if (p.status === 'info') {
          console.log();
          console.log(c('  ┌─ 更新详情 ──────────────────────────────────────────────', 'bright'));
          console.log(c('  更新ID: ' + p.details.updateId.substring(0, 8) + '...', 'white'));
          console.log(c('  更新类型: ' + p.details.updateType, 'cyan'));
          console.log(c('  当前版本: ' + p.details.currentVersion, 'white'));
          console.log(c('  目标版本: ' + p.details.targetVersion, 'green'));
          console.log(c('  来源: ' + p.details.source, 'dim'));
          console.log(c('  更新内容预览:', 'yellow'));
          console.log(c('    ' + p.details.contentPreview.replace(/\n/g, '\n    '), 'white'));
          console.log(c('  └────────────────────────────────────────────────────────', 'bright'));
          console.log();
          progressBar.startTime = Date.now();
        } else if (p.status === 'success') {
          progressBar.complete('更新完成', `${p.elapsedMs}ms`);
        } else if (p.status === 'failed') {
          progressBar.fail('更新失败', p.details.error);
        } else if (p.status === 'cancelled') {
          progressBar.fail('已取消', p.description);
        } else if (p.status === 'error') {
          progressBar.fail('更新异常', p.details.error);
        } else if (p.status === 'confirming') {
          progressBar.stopAnimation();
          process.stdout.write('\r' + ' '.repeat(100) + '\r\n');
        } else {
          progressBar.update(p.progress, { 
            description: p.stepName || p.description,
            status: p.details ? (p.details.filePath || p.details.type || '') : ''
          });
        }
      }
    });
    
    if (result.success) {
      console.log(c('  ✓ 更新成功！', 'green'));
      console.log(c('    更新ID: ' + result.updateId, 'white'));
      console.log(c('    更新类型: ' + result.updateType, 'white'));
      if (result.versionBump) {
        console.log(c('    版本迭代: ' + result.versionBump.oldVersion + ' -> ' + result.versionBump.newVersion, 'cyan'));
      }
    } else {
      console.log(c('  ✗ 更新失败: ' + result.error, 'red'));
    }
  } catch (error) {
    progressBar.fail('更新失败', error.message);
    console.log(c('  ✗ 更新失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function createUpdate() {
  const type = await ask('  更新类型 (code/config/knowledge/dependency): ');
  
  if (type === '__CANCEL__') return;
  if (type.toLowerCase() === 'q' || type.toLowerCase() === 'quit') return;
  if (!type) {
    console.log(c('  请输入更新类型', 'yellow'));
    await waitEnter();
    return;
  }
  
  const content = await ask('  更新内容 (JSON格式): ');
  
  if (content === '__CANCEL__') return;
  if (content.toLowerCase() === 'q' || content.toLowerCase() === 'quit') return;
  if (!content) {
    console.log(c('  请输入更新内容', 'yellow'));
    await waitEnter();
    return;
  }
  
  let contentObj;
  try {
    contentObj = JSON.parse(content);
  } catch {
    console.log(c('  ✗ JSON格式错误', 'red'));
    await waitEnter();
    return;
  }
  
  console.log();
  
  const progressBar = new ProgressBar({
    total: 100,
    description: '创建并执行更新',
    showPercent: true,
    showETA: true,
    width: 40
  });

  progressBar.startAnimation();

  try {
    const result = await agent.executeTool('self_update', {
      updateType: type,
      content: contentObj,
      autoConfirm: false,
      onProgress: (p) => {
        if (p.status === 'info') {
          console.log();
          console.log(c('  ┌─ 更新详情 ──────────────────────────────────────────────', 'bright'));
          console.log(c('  更新ID: ' + p.details.updateId.substring(0, 8) + '...', 'white'));
          console.log(c('  更新类型: ' + p.details.updateType, 'cyan'));
          console.log(c('  当前版本: ' + p.details.currentVersion, 'white'));
          console.log(c('  目标版本: ' + p.details.targetVersion, 'green'));
          console.log(c('  来源: ' + p.details.source, 'dim'));
          console.log(c('  更新内容预览:', 'yellow'));
          console.log(c('    ' + p.details.contentPreview.replace(/\n/g, '\n    '), 'white'));
          console.log(c('  └────────────────────────────────────────────────────────', 'bright'));
          console.log();
          progressBar.startTime = Date.now();
        } else if (p.status === 'success') {
          progressBar.complete('更新完成', `${p.elapsedMs}ms`);
        } else if (p.status === 'failed') {
          progressBar.fail('更新失败', p.details.error);
        } else if (p.status === 'cancelled') {
          progressBar.fail('已取消', p.description);
        } else if (p.status === 'error') {
          progressBar.fail('更新异常', p.details.error);
        } else if (p.status === 'confirming') {
          progressBar.stopAnimation();
          process.stdout.write('\r' + ' '.repeat(100) + '\r\n');
        } else {
          progressBar.update(p.progress, { 
            description: p.stepName || p.description,
            status: p.details ? (p.details.filePath || p.details.type || '') : ''
          });
        }
      }
    });
    
    if (result.success) {
      console.log(c('  ✓ 更新已创建并执行！', 'green'));
      console.log(c('    更新ID: ' + result.updateId, 'white'));
      if (result.versionBump) {
        console.log(c('    版本迭代: ' + result.versionBump.oldVersion + ' -> ' + result.versionBump.newVersion, 'cyan'));
      }
    } else {
      console.log(c('  ✗ 更新失败: ' + result.error, 'red'));
    }
  } catch (error) {
    progressBar.fail('更新失败', error.message);
    console.log(c('  ✗ 更新失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function executeUpdate() {
  const updateId = await ask('  请输入更新ID: ');
  
  if (updateId === '__CANCEL__') return;
  if (updateId.toLowerCase() === 'q' || updateId.toLowerCase() === 'quit') return;
  if (!updateId) {
    console.log(c('  请输入更新ID', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log();
  
  const progressBar = new ProgressBar({
    total: 100,
    description: '执行更新',
    showPercent: true,
    showETA: true,
    width: 40
  });

  progressBar.startAnimation();

  try {
    const result = await agent.executeTool('self_update', {
      updateId,
      autoConfirm: false,
      onProgress: (p) => {
        if (p.status === 'info') {
          console.log();
          console.log(c('  ┌─ 更新详情 ──────────────────────────────────────────────', 'bright'));
          console.log(c('  更新ID: ' + p.details.updateId.substring(0, 8) + '...', 'white'));
          console.log(c('  更新类型: ' + p.details.updateType, 'cyan'));
          console.log(c('  当前版本: ' + p.details.currentVersion, 'white'));
          console.log(c('  目标版本: ' + p.details.targetVersion, 'green'));
          console.log(c('  来源: ' + p.details.source, 'dim'));
          console.log(c('  更新内容预览:', 'yellow'));
          console.log(c('    ' + p.details.contentPreview.replace(/\n/g, '\n    '), 'white'));
          console.log(c('  └────────────────────────────────────────────────────────', 'bright'));
          console.log();
          progressBar.startTime = Date.now();
        } else if (p.status === 'success') {
          progressBar.complete('更新完成', `${p.elapsedMs}ms`);
        } else if (p.status === 'failed') {
          progressBar.fail('更新失败', p.details.error);
        } else if (p.status === 'cancelled') {
          progressBar.fail('已取消', p.description);
        } else if (p.status === 'error') {
          progressBar.fail('更新异常', p.details.error);
        } else if (p.status === 'confirming') {
          progressBar.stopAnimation();
          process.stdout.write('\r' + ' '.repeat(100) + '\r\n');
        } else {
          progressBar.update(p.progress, { 
            description: p.stepName || p.description,
            status: p.details ? (p.details.filePath || p.details.type || '') : ''
          });
        }
      }
    });
    
    if (result.success) {
      console.log(c('  ✓ 更新执行成功！', 'green'));
      if (result.versionBump) {
        console.log(c('    版本迭代: ' + result.versionBump.oldVersion + ' -> ' + result.versionBump.newVersion, 'cyan'));
      }
    } else {
      console.log(c('  ✗ 更新失败: ' + result.error, 'red'));
    }
  } catch (error) {
    progressBar.fail('执行失败', error.message);
    console.log(c('  ✗ 执行失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function listUpdates() {
  const status = await ask('  状态过滤 (可选，直接回车显示全部): ');
  
  if (status === '__CANCEL__') return;
  if (status.toLowerCase() === 'q' || status.toLowerCase() === 'quit') return;
  
  try {
    const result = await agent.executeTool('list_updates', {
      status: status || null,
      limit: 20
    });
    
    if (result.success && result.updates) {
      console.log();
      console.log(c('  (✧∇✧)╯ 更新记录', 'cyan'));
      console.log(c('─'.repeat(70), 'dim'));
      
      if (result.updates.length === 0) {
        console.log(c('  暂无更新记录', 'yellow'));
      } else {
        result.updates.forEach((update, i) => {
          const statusColor = update.status === 'applied' ? 'green' : 
                             update.status === 'failed' ? 'red' : 
                             update.status === 'rolled_back' ? 'yellow' : 'blue';
          console.log(c('  ' + (i + 1) + '. [' + update.status + '] ' + update.updateType, statusColor));
          console.log(c('     ID: ' + update.id.substring(0, 8) + '...', 'dim'));
          console.log(c('     版本: ' + update.currentVersion + ' -> ' + update.targetVersion, 'white'));
          console.log(c('     来源: ' + update.updateSource, 'dim'));
          console.log(c('     创建时间: ' + new Date(update.createdAt).toLocaleString(), 'dim'));
          if (update.errorMessage) {
            console.log(c('     错误: ' + update.errorMessage, 'red'));
          }
          console.log();
        });
      }
    }
  } catch (error) {
    console.log(c('  ✗ 查询失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function rollbackUpdate() {
  const updateId = await ask('  请输入要回滚的更新ID: ');
  
  if (updateId === '__CANCEL__') return;
  if (updateId.toLowerCase() === 'q' || updateId.toLowerCase() === 'quit') return;
  if (!updateId) {
    console.log(c('  请输入更新ID', 'yellow'));
    await waitEnter();
    return;
  }
  
  try {
    const { rollbackManager } = require('../services/bootstrap/rollback');
    const result = await rollbackManager.rollbackUpdate(updateId);
    
    if (result.success) {
      console.log(c('  ✓ 回滚成功！', 'green'));
      console.log(c('    备份ID: ' + (result.backupUsed || 'N/A'), 'white'));
    } else {
      console.log(c('  ✗ 回滚失败: ' + result.error, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 回滚失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function rollbackToVersion() {
  const version = await ask('  请输入要回滚到的版本号: ');
  
  if (version === '__CANCEL__') return;
  if (version.toLowerCase() === 'q' || version.toLowerCase() === 'quit') return;
  if (!version) {
    console.log(c('  请输入版本号', 'yellow'));
    await waitEnter();
    return;
  }
  
  try {
    const { rollbackManager } = require('../services/bootstrap/rollback');
    const result = await rollbackManager.rollbackToVersion(version);
    
    if (result.success) {
      console.log(c('  ✓ 按版本回滚成功！', 'green'));
      console.log(c('    更新ID: ' + result.updateId, 'white'));
    } else {
      console.log(c('  ✗ 回滚失败: ' + result.error, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 回滚失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function createBackup() {
  const type = await ask('  备份类型 (system/update/repair/database): ');
  
  if (type === '__CANCEL__') return;
  if (type.toLowerCase() === 'q' || type.toLowerCase() === 'quit') return;
  if (!type) {
    console.log(c('  请输入备份类型', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log(c('  正在创建备份...', 'cyan'));
  console.log();
  
  try {
    let progressBar = null;
    let lastProgress = -1;
    
    const onProgress = (info) => {
      const { progress, status, description, currentFile } = info;
      
      if (progress !== null && progress !== lastProgress) {
        lastProgress = progress;
        
        if (!progressBar) {
          progressBar = require('../utils/progress').ProgressBar;
          progressBar = new progressBar({ total: 100 });
        }
        
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        
        let statusColor = 'cyan';
        if (status === 'success') statusColor = 'green';
        if (status === 'failed') statusColor = 'red';
        
        const bar = progressBar.render(progress);
        const statusText = c(`${description}`, statusColor);
        const fileText = currentFile ? c(` (${currentFile})`, 'dim') : '';
        
        process.stdout.write(`  ${bar} ${progress}% ${statusText}${fileText}`);
        
        if (status === 'success' || status === 'failed') {
          process.stdout.write('\n');
        }
      }
    };
    
    const requestPermission = async (permissionInfo) => {
      console.log();
      console.log(c("  (´･ω･`) " + permissionInfo.title, 'yellow'));
      console.log(c('    ' + permissionInfo.message, 'white'));
      
      if (permissionInfo.details) {
        if (permissionInfo.details.currentPath) {
          console.log(c('    当前路径: ' + permissionInfo.details.currentPath, 'dim'));
        }
        if (permissionInfo.details.availableSpace) {
          console.log(c('    可用空间: ' + permissionInfo.details.availableSpace, 'dim'));
        }
        if (permissionInfo.details.requiredSpace) {
          console.log(c('    所需空间: ' + permissionInfo.details.requiredSpace, 'dim'));
        }
      }
      
      if (permissionInfo.type === 'change_backup_location' && permissionInfo.details.alternatives) {
        console.log();
        console.log(c('    可用的备用位置:', 'cyan'));
        permissionInfo.details.alternatives.forEach((alt, index) => {
          console.log(c(`      ${index + 1}. ${alt.path} (${alt.available})`, 'white'));
        });
        console.log();
        
        const choice = await ask('    请选择备用位置 (输入序号) 或输入自定义路径: ');
        
        if (choice === '__CANCEL__') return { granted: false };
        
        const numChoice = parseInt(choice);
        if (!isNaN(numChoice) && numChoice > 0 && numChoice <= permissionInfo.details.alternatives.length) {
          return { granted: true, path: permissionInfo.details.alternatives[numChoice - 1].path };
        } else if (choice.trim()) {
          return { granted: true, path: choice.trim() };
        }
        
        return { granted: false };
      } else {
        const confirm = await ask('    是否允许继续? (y/n): ');
        return { granted: confirm.toLowerCase() === 'y' };
      }
    };
    
    const result = await agent.executeTool('create_backup', { 
      backupType: type,
      onProgress,
      requestPermission
    });
    
    console.log();
    
    if (result.success) {
      console.log(c('  ✓ 备份成功！', 'green'));
      console.log(c('    备份ID: ' + result.backupId, 'white'));
      console.log(c('    备份类型: ' + result.backupType, 'white'));
      console.log(c('    文件数: ' + result.filesCount + ' 个', 'white'));
      if (result.size) {
        console.log(c('    大小: ' + (result.size / 1024 / 1024).toFixed(2) + ' MB', 'dim'));
      }
    } else {
      console.log(c('  ✗ 备份失败: ' + result.error, 'red'));
    }
  } catch (error) {
    console.log();
    console.log(c('  ✗ 备份失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function listBackups() {
  const type = await ask('  备份类型过滤 (可选，直接回车显示全部): ');
  
  if (type === '__CANCEL__') return;
  if (type.toLowerCase() === 'q' || type.toLowerCase() === 'quit') return;
  
  try {
    const result = await agent.executeTool('list_backups', {
      backupType: type || null,
      limit: 20
    });
    
    if (result.success && result.backups) {
      console.log();
      console.log(c('  💾 备份列表', 'cyan'));
      console.log(c('─'.repeat(70), 'dim'));
      
      if (result.backups.length === 0) {
        console.log(c('  暂无备份记录', 'yellow'));
      } else {
        result.backups.forEach((backup, i) => {
          console.log(c('  ' + (i + 1) + '. [' + backup.backupType + ']', 'white'));
          console.log(c('     ID: ' + backup.id.substring(0, 8) + '...', 'dim'));
          console.log(c('     状态: ' + backup.status, backup.status === 'applied' ? 'green' : 'yellow'));
          console.log(c('     时间: ' + new Date(backup.timestamp).toLocaleString(), 'dim'));
          console.log();
        });
      }
    }
  } catch (error) {
    console.log(c('  ✗ 查询失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function listBootstrapHistory() {
  const typeFilter = await ask('  类型过滤 (update/repair，直接回车显示全部): ');
  const statusFilter = await ask('  状态过滤 (可选，直接回车显示全部): ');
  
  if (typeFilter === '__CANCEL__') return;
  if (typeFilter.toLowerCase() === 'q' || typeFilter.toLowerCase() === 'quit') return;
  
  try {
    const result = await agent.executeTool('list_bootstrap_history', {
      type: typeFilter || null,
      status: statusFilter || null,
      limit: 20
    });
    
    if (result.success && result.records) {
      console.log();
      console.log(c('  (✧∇✧)╯ 更新与修复合并历史记录', 'cyan'));
      console.log(c('─'.repeat(70), 'dim'));
      
      if (result.records.length === 0) {
        console.log(c('  暂无记录', 'yellow'));
      } else {
        result.records.forEach((record, i) => {
          const typeLabel = record.type === 'update' ? '(✧∇✧)╯ 更新' : '(◕ᴗ◕✿) 修复';
          const typeColor = record.type === 'update' ? 'blue' : 'magenta';
          
          let statusColor;
          switch (record.status) {
            case 'success':
            case 'applied':
              statusColor = 'green';
              break;
            case 'failed':
            case 'error':
              statusColor = 'red';
              break;
            case 'rolled_back':
              statusColor = 'yellow';
              break;
            default:
              statusColor = 'gray';
          }
          
          console.log(c('  ' + (i + 1) + '. ' + typeLabel + ' [' + record.status + ']', typeColor));
          console.log(c('     ID: ' + record.id.substring(0, 8) + '...', 'dim'));
          
          if (record.type === 'update') {
            console.log(c('     类型: ' + record.updateType, 'white'));
            console.log(c('     版本: ' + record.currentVersion + ' -> ' + record.targetVersion, 'white'));
            console.log(c('     来源: ' + record.updateSource, 'dim'));
          } else {
            console.log(c('     错误类型: ' + record.errorType, 'white'));
            console.log(c('     组件: ' + record.affectedComponent, 'dim'));
          }
          
          console.log(c('     时间: ' + new Date(record.createdAt).toLocaleString(), 'dim'));
          
          if (record.errorMessage) {
            console.log(c('     错误: ' + record.errorMessage, 'red'));
          }
          
          if (record.rollbackAt) {
            console.log(c('     回滚时间: ' + new Date(record.rollbackAt).toLocaleString(), 'yellow'));
          }
          
          console.log();
        });
      }
    }
  } catch (error) {
    console.log(c('  ✗ 查询失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function repairMenu() {
  while (true) {
    clearScreen();
    printBanner();
    console.log(c('  (◕ᴗ◕✿)  自修复管理', 'bright cyan'));
    console.log(c('  输入 q 返回主菜单，Esc 返回', 'dim'));
    console.log(c('─'.repeat(70), 'dim'));
    
    console.log(c('  操作:', 'cyan'));
    console.log(c('    1) AI智能修复      (ai)', 'white'));
    console.log(c('    2) 执行自修复      (repair)', 'white'));
    console.log(c('    3) 查看修复记录    (history)', 'white'));
    console.log(c('    4) 回滚修复        (rollback)', 'white'));
    console.log(c('    0) 返回主菜单      (back)', 'dim'));
    console.log();
    
    const choice = await ask('  请选择操作: ');
    
    if (choice === '__CANCEL__') return;
    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice === '0' || choice.toLowerCase() === 'back') {
      return;
    }
    
    switch (choice) {
      case '1':
      case 'ai':
        await aiRepair();
        break;
      case '2':
      case 'repair':
        await executeSelfRepair();
        break;
      case '3':
      case 'history':
        await listRepairs();
        break;
      case '4':
      case 'rollback':
        await rollbackRepair();
        break;
      default:
        console.log(c('  无效的选择，请重新输入', 'yellow'));
        await waitEnter();
    }
  }
}

async function aiRepair() {
  const errorMessage = await ask('  请输入错误信息: ');
  
  if (errorMessage === '__CANCEL__') return;
  if (errorMessage.toLowerCase() === 'q' || errorMessage.toLowerCase() === 'quit') return;
  if (!errorMessage) {
    console.log(c('  请输入错误信息', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log();
  console.log(c('  (◕ᴗ◕✿) AI正在分析错误并尝试修复...', 'cyan'));
  
  try {
    const result = await agent.executeTool('repair_from_ai', {
      errorMessage,
      autoConfirm: false
    });
    
    if (result.success) {
      console.log(c('  ✓ 修复成功！', 'green'));
      console.log(c('    策略: ' + result.strategy, 'white'));
      console.log(c('    操作数: ' + result.actions, 'white'));
    } else {
      console.log(c('  ✗ 修复失败: ' + result.error, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 修复失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function executeSelfRepair() {
  const errorType = await ask('  错误类型 (database/network/file_system/dependency/configuration/runtime): ');
  
  if (errorType === '__CANCEL__') return;
  if (errorType.toLowerCase() === 'q' || errorType.toLowerCase() === 'quit') return;
  if (!errorType) {
    console.log(c('  请输入错误类型', 'yellow'));
    await waitEnter();
    return;
  }
  
  const errorMessage = await ask('  错误信息: ');
  
  if (errorMessage === '__CANCEL__') return;
  if (errorMessage.toLowerCase() === 'q' || errorMessage.toLowerCase() === 'quit') return;
  if (!errorMessage) {
    console.log(c('  请输入错误信息', 'yellow'));
    await waitEnter();
    return;
  }
  
  console.log(c('  正在尝试自修复...', 'cyan'));
  
  try {
    const result = await agent.executeTool('self_repair', {
      errorType,
      errorMessage,
      autoConfirm: false
    });
    
    if (result.success) {
      console.log(c('  ✓ 修复成功！', 'green'));
      console.log(c('    策略: ' + result.strategy, 'white'));
      console.log(c('    消息: ' + result.message, 'white'));
    } else {
      console.log(c('  ✗ 修复失败: ' + result.error, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 修复失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function listRepairs() {
  const status = await ask('  状态过滤 (可选，直接回车显示全部): ');
  
  if (status === '__CANCEL__') return;
  if (status.toLowerCase() === 'q' || status.toLowerCase() === 'quit') return;
  
  try {
    const result = await agent.executeTool('list_repairs', {
      status: status || null,
      limit: 20
    });
    
    if (result.success && result.repairs) {
      console.log();
      console.log(c('  (◕ᴗ◕✿) 修复记录', 'cyan'));
      console.log(c('─'.repeat(70), 'dim'));
      
      if (result.repairs.length === 0) {
        console.log(c('  暂无修复记录', 'yellow'));
      } else {
        result.repairs.forEach((repair, i) => {
          const statusColor = repair.status === 'success' ? 'green' : 
                             repair.status === 'failed' ? 'red' : 
                             repair.status === 'rolled_back' ? 'yellow' : 'blue';
          console.log(c('  ' + (i + 1) + '. [' + repair.status + '] ' + repair.errorType, statusColor));
          console.log(c('     错误: ' + repair.errorMessage.substring(0, 60), 'white'));
          if (repair.repairStrategy) {
            console.log(c('     策略: ' + repair.repairStrategy, 'dim'));
          }
          console.log(c('     创建时间: ' + new Date(repair.createdAt).toLocaleString(), 'dim'));
          console.log();
        });
      }
    }
  } catch (error) {
    console.log(c('  ✗ 查询失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

async function rollbackRepair() {
  const repairId = await ask('  请输入要回滚的修复ID: ');
  
  if (repairId === '__CANCEL__') return;
  if (repairId.toLowerCase() === 'q' || repairId.toLowerCase() === 'quit') return;
  if (!repairId) {
    console.log(c('  请输入修复ID', 'yellow'));
    await waitEnter();
    return;
  }
  
  try {
    const { selfRepairManager } = require('../services/bootstrap/selfRepairManager');
    const result = await selfRepairManager.rollbackRepair(repairId);
    
    if (result.success) {
      console.log(c('  ✓ 回滚成功！', 'green'));
    } else {
      console.log(c('  ✗ 回滚失败: ' + result.error, 'red'));
    }
  } catch (error) {
    console.log(c('  ✗ 回滚失败: ' + error.message, 'red'));
  }
  
  await waitEnter();
}

function waitEnter() {
  return ask(c('  按 Enter 或 q 返回...', 'dim'));
}

async function showNotification(message) {
  return new Promise((resolve) => {
    process.stdout.write('\n\n');
    process.stdout.write(c('─'.repeat(60), 'bright magenta') + '\n');
    
    if (message.type === 'update') {
      process.stdout.write(c('  (✧∇✧)╯  更新提示', 'bright cyan') + '\n');
    } else if (message.type === 'repair') {
      process.stdout.write(c('  (๑•̀ㅂ•́)و✧  修复提示', 'bright green') + '\n');
    } else {
      process.stdout.write(c('  (◕ᴗ◕✿)  系统提示', 'bright yellow') + '\n');
    }
    
    process.stdout.write(c('─'.repeat(60), 'bright magenta') + '\n');
    process.stdout.write('\n');
    
    if (message.title) {
      process.stdout.write(c('  📌 ' + message.title, 'white') + '\n');
    }
    
    if (message.content) {
      const lines = message.content.split('\n');
      lines.forEach(line => {
        process.stdout.write(c('  ' + line, 'gray') + '\n');
      });
    }
    
    if (message.data) {
      if (message.data.version) {
        process.stdout.write(c('  📦 版本: ' + message.data.version, 'cyan') + '\n');
      }
      if (message.data.type) {
        process.stdout.write(c('  🔧 类型: ' + message.data.type, 'cyan') + '\n');
      }
    }
    
    process.stdout.write('\n');
    
    if (message.type === 'update' || message.type === 'repair') {
      process.stdout.write(c('  1) 立即执行', 'green') + '\n');
      process.stdout.write(c('  2) 稍后处理', 'yellow') + '\n');
      process.stdout.write(c('  0) 忽略', 'red') + '\n');
      process.stdout.write('\n');
      
      const handleKey = (chunk, key) => {
        process.stdin.removeListener('keypress', handleKey);
        process.stdout.write('\n');
        
        if (chunk === '1') {
          resolve({ confirmed: true, action: 'execute', message });
        } else if (chunk === '2') {
          resolve({ confirmed: false, action: 'later', message });
        } else {
          resolve({ confirmed: false, action: 'ignore', message });
        }
      };
      
      process.stdin.once('keypress', handleKey);
      process.stdout.write(c('  请选择操作 (1/2/0): ', 'white'));
    } else {
      process.stdout.write(c('  按任意键继续...', 'dim') + '\n');
      
      const handleKey = () => {
        process.stdin.removeListener('keypress', handleKey);
        process.stdout.write('\n');
        resolve({ confirmed: true, message });
      };
      
      process.stdin.once('keypress', handleKey);
    }
  });
}

async function startCLI() {
  await agent.init();
  
  if (process.env.OPENAI_API_KEY) {
    await agent.registerProvider('openai', { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4' });
  }
  if (process.env.CLAUDE_API_KEY) {
    await agent.registerProvider('claude', { apiKey: process.env.CLAUDE_API_KEY, model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229' });
  }
  if (process.env.GEMINI_API_KEY) {
    await agent.registerProvider('gemini', { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-1.5-pro' });
  }
  if (process.env.TONGYI_API_KEY) {
    await agent.registerProvider('tongyi', { apiKey: process.env.TONGYI_API_KEY, model: process.env.TONGYI_MODEL || 'qwen-plus' });
  }
  if (process.env.DOUBAO_API_KEY) {
    await agent.registerProvider('doubao', { apiKey: process.env.DOUBAO_API_KEY, model: process.env.DOUBAO_MODEL || 'Doubao-7B' });
  }
  if (process.env.WENXIN_API_KEY && process.env.WENXIN_SECRET_KEY) {
    await agent.registerProvider('wenxin', { apiKey: process.env.WENXIN_API_KEY, secretKey: process.env.WENXIN_SECRET_KEY, model: process.env.WENXIN_MODEL || 'ernie-3.5' });
  }
  
  await agent.registerProvider('ollama', { baseURL: process.env.OLLAMA_URL || 'http://localhost:11434', model: process.env.OLLAMA_MODEL || 'codellama' });
  
  // 注册后刷新一次提供商状态
  try {
    await agent.refreshProviders();
  } catch (e) {
    // 忽略刷新错误
  }
  
  initInput();
  
  notificationSystem.start(showNotification);
  
  while (true) {
    notificationSystem.recordActivity();
    const choice = await showMenu();
    
    if (choice === '__BACK__') continue;
    
    switch (choice) {
      case 'analyze':
        await analyzeFile();
        break;
      case 'scan':
        await scanProject();
        break;
      case 'optimize':
        await optimizeCode();
        break;
      case 'provider':
        await providerMenu();
        break;
      case 'knowledge':
        await knowledgeMenu();
        break;
      case 'update':
        await updateMenu();
        break;
      case 'repair':
        await repairMenu();
        break;
      case 'mode':
        await modeMenu();
        break;
      case 'status':
        await showStatus();
        break;
      case 'health':
        await healthCheckMenu();
        break;
      case 'sustain':
        await sustainMenu();
        break;
      case 'help':
        await showHelp();
        break;
      case 'clear':
        clearScreen();
        break;
      case 'exit':
        clearScreen();
        printBanner();
        console.log(c('  👋 感谢使用 Code Optimizer Agent！', 'green'));
        console.log(c('  再见！', 'green'));
        console.log();
        process.exit(0);
      default:
        break;
    }
  }
}

module.exports = { startCLI };

if (require.main === module) {
  startCLI();
}
