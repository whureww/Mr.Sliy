/**
 * 输入验证模块测试
 */

const {
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
  validateAll
} = require('../../src/utils/validator');

describe('validator', () => {
  describe('validateLength', () => {
    test('should return valid for string within length range', () => {
      expect(validateLength('test', 3, 10, 'field')).toEqual({ valid: true });
    });

    test('should return invalid for string too short', () => {
      expect(validateLength('ab', 3, 10, 'field')).toEqual({ valid: false, message: 'field长度不能少于3个字符' });
    });

    test('should return invalid for string too long', () => {
      expect(validateLength('abcdefghijk', 3, 10, 'field')).toEqual({ valid: false, message: 'field长度不能超过10个字符' });
    });
  });

  describe('validatePattern', () => {
    test('should return valid for matching pattern', () => {
      expect(validatePattern('test_user', /^[a-zA-Z0-9_]+$/, 'username')).toEqual({ valid: true });
    });

    test('should return invalid for non-matching pattern', () => {
      expect(validatePattern('test user', /^[a-zA-Z0-9_]+$/, 'username')).toEqual({ valid: false, message: 'username格式不正确' });
    });
  });

  describe('validateAllowedValues', () => {
    test('should return valid for allowed value', () => {
      expect(validateAllowedValues('offline', ['offline', 'online', 'auto'], 'mode')).toEqual({ valid: true });
    });

    test('should return invalid for disallowed value', () => {
      expect(validateAllowedValues('invalid', ['offline', 'online', 'auto'], 'mode')).toEqual({ valid: false, message: 'mode值无效，允许的值: offline, online, auto' });
    });
  });

  describe('validateRequired', () => {
    test('should return valid for non-empty string', () => {
      expect(validateRequired('test', 'field')).toEqual({ valid: true });
    });

    test('should return invalid for empty string', () => {
      expect(validateRequired('', 'field')).toEqual({ valid: false, message: 'field不能为空' });
    });

    test('should return invalid for null', () => {
      expect(validateRequired(null, 'field')).toEqual({ valid: false, message: 'field不能为空' });
    });

    test('should return invalid for undefined', () => {
      expect(validateRequired(undefined, 'field')).toEqual({ valid: false, message: 'field不能为空' });
    });
  });

  describe('validateNumberRange', () => {
    test('should return valid for number within range', () => {
      expect(validateNumberRange(5, 1, 10, 'count')).toEqual({ valid: true });
    });

    test('should return invalid for number below min', () => {
      expect(validateNumberRange(0, 1, 10, 'count')).toEqual({ valid: false, message: 'count不能小于1' });
    });

    test('should return invalid for number above max', () => {
      expect(validateNumberRange(11, 1, 10, 'count')).toEqual({ valid: false, message: 'count不能大于10' });
    });
  });

  describe('validateTableName', () => {
    test('should return valid for valid table name', () => {
      expect(validateTableName('sys_user')).toEqual({ valid: true });
    });

    test('should return invalid for table name with special characters', () => {
      expect(validateTableName('sys-user')).toEqual({ valid: false, message: '表名只能包含字母、数字和下划线，且必须以字母或下划线开头' });
    });

    test('should return invalid for disallowed table', () => {
      expect(validateTableName('secret_table', ['sys_user', 'sys_config'])).toEqual({ valid: false, message: '不允许访问表: secret_table' });
    });
  });

  describe('validateFilePath', () => {
    test('should return valid for valid file path', () => {
      expect(validateFilePath('/path/to/file.js')).toEqual({ valid: true });
    });

    test('should return invalid for path traversal', () => {
      expect(validateFilePath('../../etc/passwd')).toEqual({ valid: false, message: '文件路径不能包含路径遍历字符' });
    });
  });

  describe('sanitizeString', () => {
    test('should strip HTML tags', () => {
      expect(sanitizeString('<div>test</div>')).toBe('test');
    });

    test('should escape HTML entities', () => {
      expect(sanitizeString('<test>', { escapeHtml: true })).toBe('&lt;test&gt;');
    });
  });

  describe('sanitizeFileName', () => {
    test('should replace path separators', () => {
      expect(sanitizeFileName('path/to/file.js')).toBe('path_to_file.js');
    });

    test('should remove invalid characters', () => {
      expect(sanitizeFileName('file<>:|"')).toBe('file');
    });
  });

  describe('validateAll', () => {
    test('should return valid for valid data', () => {
      const schema = {
        username: { required: true, minLength: 3, maxLength: 50 },
        email: { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        mode: { required: true, allowedValues: ['offline', 'online'] }
      };
      const data = {
        username: 'testuser',
        email: 'test@example.com',
        mode: 'online'
      };
      expect(validateAll(data, schema)).toEqual({ valid: true, errors: {} });
    });

    test('should return invalid for invalid data', () => {
      const schema = {
        username: { required: true, minLength: 3 },
        email: { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
      };
      const data = {
        username: 'ab',
        email: 'invalid'
      };
      const result = validateAll(data, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.username).toBeDefined();
      expect(result.errors.email).toBeDefined();
    });
  });
});