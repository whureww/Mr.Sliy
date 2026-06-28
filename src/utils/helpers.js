/**
 * 通用工具函数模块
 */

const crypto = require('crypto');
const path = require('path');

/**
 * 生成UUID
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 深拷贝对象
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 格式化日期时间
 */
function formatDateTime(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化持续时间
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}min`;
  return `${(ms / 3600000).toFixed(2)}h`;
}

/**
 * 获取文件扩展名
 */
function getFileExtension(filename) {
  return path.extname(filename).toLowerCase();
}

/**
 * 获取文件语言类型
 */
function getFileLanguage(filename) {
  const ext = getFileExtension(filename);
  const languageMap = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala'
  };
  
  return languageMap[ext] || 'unknown';
}

/**
 * 检查文件是否为支持的扫描类型
 */
function isSupportedFile(filename, extensions) {
  const ext = getFileExtension(filename);
  return extensions.includes(ext);
}

/**
 * 检查路径是否在排除目录中
 */
function isExcludedPath(filePath, excludeDirs, excludeFiles) {
  const parts = filePath.split(/[/\\]/);
  
  // 检查排除目录
  for (const dir of excludeDirs) {
    if (parts.includes(dir)) {
      return true;
    }
  }
  
  // 检查排除文件
  const filename = parts[parts.length - 1];
  for (const file of excludeFiles) {
    if (filename.includes(file)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 计算代码行数
 */
function countLines(code) {
  if (!code) return 0;
  return code.split('\n').length;
}

/**
 * 安全解析JSON
 */
function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 安全字符串化JSON
 */
function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 批量处理数组（分块）
 */
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * 重试函数
 */
async function retry(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}

/**
 * 简单哈希函数
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

module.exports = {
  generateUUID,
  sleep,
  deepClone,
  formatDateTime,
  formatFileSize,
  formatDuration,
  getFileExtension,
  getFileLanguage,
  isSupportedFile,
  isExcludedPath,
  countLines,
  safeJsonParse,
  safeJsonStringify,
  chunk,
  retry,
  simpleHash
};