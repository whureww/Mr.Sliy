/**
 * 输入验证模块
 * 提供统一的输入验证和Sanitization功能
 */

const { logger } = require('./logger');

/**
 * 验证规则定义
 */
const validationRules = {
  username: {
    minLength: 3,
    maxLength: 50,
    pattern: /^[a-zA-Z0-9_]+$/,
    message: '用户名只能包含字母、数字和下划线，长度3-50个字符'
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: '请输入有效的邮箱地址'
  },
  password: {
    minLength: 8,
    maxLength: 128,
    pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
    message: '密码至少8个字符，包含大小写字母和数字'
  },
  filePath: {
    pattern: /^[a-zA-Z0-9_./\\-]+$/,
    message: '文件路径包含非法字符'
  },
  tableName: {
    pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    message: '表名只能包含字母、数字和下划线，且必须以字母或下划线开头'
  },
  columnName: {
    pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    message: '列名只能包含字母、数字和下划线，且必须以字母或下划线开头'
  },
  language: {
    allowedValues: ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'bash', 'css', 'html', 'json', 'lua', 'yaml', 'toml', 'vue'],
    message: '不支持的语言类型'
  },
  mode: {
    allowedValues: ['offline', 'online', 'auto'],
    message: '无效的工作模式'
  },
  severity: {
    allowedValues: ['critical', 'high', 'medium', 'low'],
    message: '无效的严重程度'
  }
};

/**
 * 验证字符串长度
 */
function validateLength(value, minLength, maxLength, fieldName) {
  if (typeof value !== 'string') {
    return { valid: false, message: `${fieldName}必须是字符串` };
  }
  
  if (minLength && value.length < minLength) {
    return { valid: false, message: `${fieldName}长度不能少于${minLength}个字符` };
  }
  
  if (maxLength && value.length > maxLength) {
    return { valid: false, message: `${fieldName}长度不能超过${maxLength}个字符` };
  }
  
  return { valid: true };
}

/**
 * 验证正则表达式
 */
function validatePattern(value, pattern, fieldName, message) {
  if (typeof value !== 'string') {
    return { valid: false, message: `${fieldName}必须是字符串` };
  }
  
  if (!pattern.test(value)) {
    return { valid: false, message: message || `${fieldName}格式不正确` };
  }
  
  return { valid: true };
}

/**
 * 验证值是否在允许列表中
 */
function validateAllowedValues(value, allowedValues, fieldName, message) {
  if (!allowedValues.includes(value)) {
    return { valid: false, message: message || `${fieldName}值无效，允许的值: ${allowedValues.join(', ')}` };
  }
  
  return { valid: true };
}

/**
 * 验证非空
 */
function validateRequired(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return { valid: false, message: `${fieldName}不能为空` };
  }
  
  if (Array.isArray(value) && value.length === 0) {
    return { valid: false, message: `${fieldName}不能为空数组` };
  }
  
  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return { valid: false, message: `${fieldName}不能为空对象` };
  }
  
  return { valid: true };
}

/**
 * 验证数字范围
 */
function validateNumberRange(value, min, max, fieldName) {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numValue)) {
    return { valid: false, message: `${fieldName}必须是数字` };
  }
  
  if (min !== undefined && numValue < min) {
    return { valid: false, message: `${fieldName}不能小于${min}` };
  }
  
  if (max !== undefined && numValue > max) {
    return { valid: false, message: `${fieldName}不能大于${max}` };
  }
  
  return { valid: true };
}

/**
 * 验证表名（防SQL注入）
 */
function validateTableName(tableName, allowedTables = null) {
  const result = validatePattern(tableName, validationRules.tableName.pattern, '表名', validationRules.tableName.message);
  
  if (!result.valid) {
    return result;
  }
  
  if (allowedTables && !allowedTables.includes(tableName)) {
    return { valid: false, message: `不允许访问表: ${tableName}` };
  }
  
  return { valid: true };
}

/**
 * 验证列名（防SQL注入）
 */
function validateColumnName(columnName) {
  return validatePattern(columnName, validationRules.columnName.pattern, '列名', validationRules.columnName.message);
}

/**
 * 验证文件路径（防路径遍历攻击）
 */
function validateFilePath(filePath) {
  // 检查路径遍历攻击
  if (filePath.includes('..')) {
    return { valid: false, message: '文件路径不能包含路径遍历字符' };
  }
  
  return validatePattern(filePath, validationRules.filePath.pattern, '文件路径', validationRules.filePath.message);
}

/**
 * Sanitize字符串（移除危险字符）
 */
function sanitizeString(value, options = {}) {
  if (typeof value !== 'string') {
    return value;
  }
  
  let sanitized = value;
  
  if (options.stripHtml !== false) {
    sanitized = sanitized.replace(/<[^>]*>/g, '');
  }
  
  if (options.stripScript !== false) {
    sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*/gi, '');
  }
  
  if (options.trim !== false) {
    sanitized = sanitized.trim();
  }
  
  if (options.escapeHtml) {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    sanitized = sanitized.replace(/[&<>"']/g, char => entities[char]);
  }
  
  return sanitized;
}

/**
 * Sanitize文件名（防路径遍历）
 */
function sanitizeFileName(fileName) {
  if (typeof fileName !== 'string') {
    return fileName;
  }
  
  // 移除路径分隔符和危险字符
  return fileName
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*]/g, '')
    .trim();
}

/**
 * 综合验证函数
 */
function validate(fieldName, value, rules) {
  const results = [];
  
  if (rules.required) {
    const result = validateRequired(value, fieldName);
    if (!result.valid) {
      results.push(result);
      return results; // 必填项为空，直接返回
    }
  }
  
  if (rules.minLength || rules.maxLength) {
    const result = validateLength(value, rules.minLength, rules.maxLength, fieldName);
    if (!result.valid) {
      results.push(result);
    }
  }
  
  if (rules.pattern) {
    const result = validatePattern(value, rules.pattern, fieldName, rules.message);
    if (!result.valid) {
      results.push(result);
    }
  }
  
  if (rules.allowedValues) {
    const result = validateAllowedValues(value, rules.allowedValues, fieldName, rules.message);
    if (!result.valid) {
      results.push(result);
    }
  }
  
  if (rules.min || rules.max) {
    const result = validateNumberRange(value, rules.min, rules.max, fieldName);
    if (!result.valid) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * 批量验证
 */
function validateAll(data, validationSchema) {
  const errors = {};
  
  for (const [fieldName, rules] of Object.entries(validationSchema)) {
    const value = data[fieldName];
    const results = validate(fieldName, value, rules);
    
    if (results.length > 0) {
      errors[fieldName] = results.map(r => r.message);
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Express中间件：验证请求参数
 */
function validationMiddleware(validationSchema) {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query, ...req.params };
    const result = validateAll(data, validationSchema);
    
    if (!result.valid) {
      logger.warn('请求参数验证失败:', result.errors);
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        errors: result.errors
      });
    }
    
    next();
  };
}

module.exports = {
  validationRules,
  validateLength,
  validatePattern,
  validateAllowedValues,
  validateRequired,
  validateNumberRange,
  validateTableName,
  validateColumnName,
  validateFilePath,
  sanitizeString,
  sanitizeFileName,
  validate,
  validateAll,
  validationMiddleware
};
