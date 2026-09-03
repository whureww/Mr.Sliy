/**
 * 安全工具集
 * - pathGuard: 路径遍历防护
 * - validateToolName: 工具白名单校验
 * - sanitizeCommandInput: 命令注入防护
 * - validateIdentifier: SQL 标识符校验（从 mysql.js 迁移复用）
 */

const path = require('path');
const { logger } = require('./logger');

// ==================== 路径遍历防护 ====================

const ALLOWED_ROOT_DIRS = [
  process.cwd(),
  path.join(process.cwd(), 'src'),
  path.join(process.cwd(), 'tests'),
  path.join(process.cwd(), 'examples')
];

// 允许读取的文件扩展名白名单（代码分析场景）
const ALLOWED_CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.java', '.py', '.go', '.rs', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue',
  '.svelte', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.xml', '.html',
  '.css', '.scss', '.less', '.sql', '.sh', '.bash', '.ps1', '.bat',
  '.md', '.txt', '.bak'
]);

// 禁止访问的敏感路径模式
const FORBIDDEN_PATH_PATTERNS = [
  /\.env/i,
  /\.enc$/i,
  /\.pem$/i,
  /\.key$/i,
  /\/\.git\//i,
  /\/node_modules\//i,
  /\/database\/.*\.db$/i,
  /database_connections\.json$/i,
  /\/\.cache\//i
];

/**
 * 校验路径安全性
 * @param {string} inputPath - 用户输入的路径
 * @param {object} options - { mustExist, allowWrite, allowedExtensions }
 * @returns {{ safe: boolean, resolvedPath?: string, error?: string }}
 */
function safeResolvePath(inputPath, options = {}) {
  if (!inputPath || typeof inputPath !== 'string') {
    return { safe: false, error: '路径不能为空' };
  }

  // 拒绝包含 null 字节的路径
  if (inputPath.indexOf('\0') !== -1) {
    return { safe: false, error: '路径包含非法字符' };
  }

  const resolvedPath = path.resolve(inputPath);
  const normalized = path.normalize(resolvedPath);

  // 检查是否在允许的根目录内
  const inAllowedDir = ALLOWED_ROOT_DIRS.some(dir => {
    const normalizedDir = path.normalize(dir);
    return normalized === normalizedDir || normalized.startsWith(normalizedDir + path.sep);
  });

  if (!inAllowedDir) {
    // 允许读取 cwd 外的代码文件，但必须是有代码扩展名的
    const ext = path.extname(normalized).toLowerCase();
    if (!ALLOWED_CODE_EXTENSIONS.has(ext)) {
      return { safe: false, error: `路径超出允许范围: ${normalized}` };
    }
  }

  // 检查是否匹配禁止路径模式
  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safe: false, error: `访问被禁止的敏感路径: ${normalized}` };
    }
  }

  // 扩展名校验
  if (options.allowedExtensions) {
    const ext = path.extname(normalized).toLowerCase();
    const allowed = Array.isArray(options.allowedExtensions)
      ? new Set(options.allowedExtensions.map(e => e.toLowerCase()))
      : options.allowedExtensions;
    if (!allowed.has(ext)) {
      return { safe: false, error: `不支持的文件类型: ${ext}` };
    }
  }

  return { safe: true, resolvedPath: normalized };
}

// ==================== 工具白名单 ====================

const TOOL_WHITELIST = new Set([
  // 分析类
  'analyze_file', 'scan_project', 'search_knowledge', 'get_skills',
  // 优化类
  'optimize_code', 'fix_file', 'apply_fix', 'clear_history',
  // 自持类
  'self_repair', 'repair_from_ai', 'self_update', 'list_repairs',
  'list_updates', 'list_bootstrap_history', 'rollback_update',
  'update_from_ai',
  // 备份类
  'create_backup', 'list_backups',
  // 配置类
  'switch_provider', 'get_providers',
  // 沙箱类
  'sandbox_status', 'sandbox_enable', 'sandbox_disable', 'sandbox_reload_service',
  // 状态类
  'get_status'
]);

/**
 * 校验工具名是否在白名单中
 */
function validateToolName(toolName) {
  if (!toolName || typeof toolName !== 'string') {
    return { valid: false, error: '工具名不能为空' };
  }
  // 拒绝包含特殊字符的工具名
  if (!/^[a-z_]+$/.test(toolName)) {
    return { valid: false, error: `工具名包含非法字符: ${toolName}` };
  }
  if (!TOOL_WHITELIST.has(toolName)) {
    return { valid: false, error: `未授权的工具: ${toolName}` };
  }
  return { valid: true };
}

// ==================== 命令注入防护 ====================

/**
 * 清理命令输入，防止命令注入
 * 拒绝包含 shell 元字符的输入
 */
function sanitizeCommandInput(input) {
  if (!input || typeof input !== 'string') {
    return { safe: false, error: '输入不能为空' };
  }
  // 危险字符：; | & $ ` ( ) < > \n \r
  const dangerousChars = /[;&|$`()<>\r\n]/;
  if (dangerousChars.test(input)) {
    return { safe: false, error: '输入包含危险字符' };
  }
  // 限制长度
  if (input.length > 500) {
    return { safe: false, error: '输入过长' };
  }
  return { safe: true, sanitized: input };
}

/**
 * 安全执行子进程命令（仅允许白名单命令）
 */
const ALLOWED_COMMANDS = new Set(['node', 'npm', 'git', 'tasklist']);

function isCommandAllowed(command) {
  if (!command || typeof command !== 'string') return false;
  const baseCmd = command.trim().split(/\s+/)[0].toLowerCase();
  // Windows 下可能带 .exe
  const baseName = baseCmd.replace(/\.exe$/i, '');
  return ALLOWED_COMMANDS.has(baseName);
}

// ==================== SQL 标识符防护 ====================

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 校验 SQL 标识符（表名/列名），防止通过标识符进行 SQL 注入。
 * 仅允许字母、数字、下划线，且不以数字开头。
 * @param {string} name - 待校验的标识符
 * @returns {string} 校验通过的标识符
 * @throws {Error} 标识符非法时抛出
 */
function validateIdentifier(name) {
  if (typeof name !== 'string' || !IDENTIFIER_RE.test(name)) {
    throw new Error(`无效的SQL标识符: ${name}`);
  }
  return name;
}

/**
 * 批量校验并返回安全的标识符数组
 * @param {string[]} names - 标识符数组
 * @returns {string[]} 校验通过的标识符数组
 */
function validateIdentifiers(names) {
  if (!Array.isArray(names)) {
    throw new Error('标识符列表必须为数组');
  }
  return names.map(validateIdentifier);
}

module.exports = {
  safeResolvePath,
  validateToolName,
  sanitizeCommandInput,
  isCommandAllowed,
  validateIdentifier,
  validateIdentifiers,
  TOOL_WHITELIST,
  ALLOWED_CODE_EXTENSIONS,
  ALLOWED_ROOT_DIRS
};
