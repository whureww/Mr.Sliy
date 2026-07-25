/**
 * JWT认证模块
 * 提供基于JSON Web Token的身份认证和授权功能
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { logger } = require('./logger');
const { config } = require('../config');

// 生成随机密钥（如果未配置）
function generateSecret() {
  return crypto.randomBytes(64).toString('hex');
}

// 获取JWT密钥
function getJwtSecret() {
  return process.env.JWT_SECRET || config.auth?.jwtSecret || generateSecret();
}

// JWT配置
const jwtConfig = {
  secret: getJwtSecret(),
  expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
};

/**
 * 生成访问令牌
 */
function generateAccessToken(payload) {
  return jwt.sign(payload, jwtConfig.secret, {
    expiresIn: jwtConfig.expiresIn
  });
}

/**
 * 生成刷新令牌
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, jwtConfig.secret, {
    expiresIn: jwtConfig.refreshExpiresIn
  });
}

/**
 * 验证令牌
 */
function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, jwtConfig.secret);
    return { valid: true, decoded };
  } catch (error) {
    logger.warn('JWT验证失败:', error.message);
    return { valid: false, error: error.message };
  }
}

/**
 * 解码令牌（不验证签名，用于获取过期令牌信息）
 */
function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
}

/**
 * 验证并刷新令牌
 */
function refreshToken(refreshToken) {
  const result = verifyToken(refreshToken);
  
  if (!result.valid) {
    return { success: false, message: '刷新令牌无效' };
  }
  
  const { userId, username, role } = result.decoded;
  
  const newAccessToken = generateAccessToken({ userId, username, role });
  const newRefreshToken = generateRefreshToken({ userId, username, role });
  
  return {
    success: true,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken
  };
}

/**
 * Express中间件：验证JWT令牌
 */
function authMiddleware(req, res, next) {
  // 从请求头获取令牌
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: '未提供认证令牌'
    });
  }
  
  const token = authHeader.substring(7);
  const result = verifyToken(token);
  
  if (!result.valid) {
    return res.status(401).json({
      success: false,
      message: '认证令牌无效或已过期'
    });
  }
  
  // 将用户信息附加到请求对象
  req.user = result.decoded;
  next();
}

/**
 * Express中间件：验证管理员权限
 */
function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: '无管理员权限'
    });
  }
  next();
}

/**
 * Express中间件：验证用户权限（允许管理员或当前用户）
 */
function userMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: '未认证'
    });
  }
  
  // 管理员可以访问所有资源
  if (req.user.role === 'admin') {
    return next();
  }
  
  // 普通用户只能访问自己的资源
  const userId = req.params.userId || req.body.userId;
  if (userId && userId !== req.user.userId) {
    return res.status(403).json({
      success: false,
      message: '无权访问该资源'
    });
  }
  
  next();
}

/**
 * 验证密码强度
 */
function validatePassword(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  
  if (password.length < minLength) {
    return { valid: false, message: `密码长度至少${minLength}个字符` };
  }
  
  if (!hasUpperCase) {
    return { valid: false, message: '密码必须包含大写字母' };
  }
  
  if (!hasLowerCase) {
    return { valid: false, message: '密码必须包含小写字母' };
  }
  
  if (!hasNumber) {
    return { valid: false, message: '密码必须包含数字' };
  }
  
  return { valid: true };
}

/**
 * 哈希密码
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * 验证密码
 */
function verifyPassword(password, hash) {
  const [salt, storedHash] = hash.split(':');
  const computedHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return computedHash === storedHash;
}

/**
 * 生成API密钥
 */
function generateApiKey(prefix = 'API') {
  const key = crypto.randomBytes(32).toString('hex');
  return `${prefix}_${key}`;
}

/**
 * 验证API密钥格式
 */
function validateApiKey(apiKey) {
  const pattern = /^[A-Z]+_[a-f0-9]{64}$/i;
  return pattern.test(apiKey);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  refreshToken,
  authMiddleware,
  adminMiddleware,
  userMiddleware,
  validatePassword,
  hashPassword,
  verifyPassword,
  generateApiKey,
  validateApiKey,
  jwtConfig
};
