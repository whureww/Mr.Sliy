/**
 * JWT认证模块测试
 */

const {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  refreshToken,
  validatePassword,
  hashPassword,
  verifyPassword,
  generateApiKey,
  validateApiKey
} = require('../../src/utils/auth');

describe('auth', () => {
  const testPayload = { userId: '123', username: 'testuser', role: 'admin' };

  describe('generateAccessToken', () => {
    test('should generate a valid JWT token', () => {
      const token = generateAccessToken(testPayload);
      expect(typeof token).toBe('string');
      expect(token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
    });
  });

  describe('generateRefreshToken', () => {
    test('should generate a valid refresh token', () => {
      const token = generateRefreshToken(testPayload);
      expect(typeof token).toBe('string');
      expect(token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
    });
  });

  describe('verifyToken', () => {
    test('should verify a valid token', () => {
      const token = generateAccessToken(testPayload);
      const result = verifyToken(token);
      expect(result.valid).toBe(true);
      expect(result.decoded.userId).toBe('123');
      expect(result.decoded.username).toBe('testuser');
    });

    test('should reject an invalid token', () => {
      const result = verifyToken('invalid.token.here');
      expect(result.valid).toBe(false);
    });
  });

  describe('decodeToken', () => {
    test('should decode a valid token', () => {
      const token = generateAccessToken(testPayload);
      const decoded = decodeToken(token);
      expect(decoded.userId).toBe('123');
    });

    test('should return null for invalid token', () => {
      expect(decodeToken('invalid')).toBeNull();
    });
  });

  describe('refreshToken', () => {
    test('should refresh a valid token', () => {
      const token = generateRefreshToken(testPayload);
      const result = refreshToken(token);
      expect(result.success).toBe(true);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    test('should reject an invalid refresh token', () => {
      const result = refreshToken('invalid');
      expect(result.success).toBe(false);
    });
  });

  describe('validatePassword', () => {
    test('should return valid for strong password', () => {
      expect(validatePassword('Password123')).toEqual({ valid: true });
    });

    test('should return invalid for weak password (too short)', () => {
      expect(validatePassword('Pass1')).toEqual({ valid: false, message: '密码长度至少8个字符' });
    });

    test('should return invalid for password without uppercase', () => {
      expect(validatePassword('password123')).toEqual({ valid: false, message: '密码必须包含大写字母' });
    });

    test('should return invalid for password without lowercase', () => {
      expect(validatePassword('PASSWORD123')).toEqual({ valid: false, message: '密码必须包含小写字母' });
    });

    test('should return invalid for password without number', () => {
      expect(validatePassword('Password')).toEqual({ valid: false, message: '密码必须包含数字' });
    });
  });

  describe('hashPassword and verifyPassword', () => {
    test('should hash and verify password correctly', () => {
      const password = 'Password123';
      const hash = hashPassword(password);
      expect(typeof hash).toBe('string');
      expect(hash.includes(':')).toBe(true);
      expect(verifyPassword(password, hash)).toBe(true);
    });

    test('should reject incorrect password', () => {
      const hash = hashPassword('Password123');
      expect(verifyPassword('WrongPassword', hash)).toBe(false);
    });
  });

  describe('generateApiKey', () => {
    test('should generate a valid API key', () => {
      const key = generateApiKey('API');
      expect(typeof key).toBe('string');
      expect(key.startsWith('API_')).toBe(true);
      expect(key.length).toBe(67); // API_ + 64 hex chars
    });

    test('should generate unique API keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('validateApiKey', () => {
    test('should validate a valid API key', () => {
      const key = generateApiKey('API');
      expect(validateApiKey(key)).toBe(true);
    });

    test('should reject invalid API key', () => {
      expect(validateApiKey('invalid_key')).toBe(false);
    });
  });
});