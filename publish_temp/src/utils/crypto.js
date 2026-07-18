/**
 * 加密工具模块
 * 用于安全存储敏感配置数据（API Key、密码等）
 * 使用 AES-256-GCM 加密算法
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

/**
 * 生成机器唯一密钥（基于机器特征派生）
 * 这样每台机器的密钥不同，即使文件泄露也无法在其他机器解密
 */
function getMachineKey() {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const platform = os.platform();
  const release = os.release();
  const cpuCores = os.cpus().length;
  const totalMem = os.totalmem();
  
  const machineSeed = `${hostname}|${username}|${platform}|${release}|${cpuCores}|${totalMem}`;
  
  return crypto.createHash('sha256')
    .update(machineSeed)
    .digest();
}

/**
 * 加密数据
 */
function encrypt(plaintext, key = null) {
  if (!key) {
    key = getMachineKey();
  }
  
  if (typeof plaintext === 'object') {
    plaintext = JSON.stringify(plaintext);
  }
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(salt);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  const result = {
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    tag: tag.toString('hex'),
    encrypted: encrypted
  };
  
  return JSON.stringify(result);
}

/**
 * 解密数据
 */
function decrypt(encryptedData, key = null) {
  if (!key) {
    key = getMachineKey();
  }
  
  try {
    const data = typeof encryptedData === 'string' 
      ? JSON.parse(encryptedData) 
      : encryptedData;
    
    const iv = Buffer.from(data.iv, 'hex');
    const salt = Buffer.from(data.salt, 'hex');
    const tag = Buffer.from(data.tag, 'hex');
    const encrypted = data.encrypted;
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(salt);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  } catch (error) {
    throw new Error('解密失败：密钥不匹配或数据已损坏');
  }
}

/**
 * 加密存储到文件
 */
function encryptToFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const encrypted = encrypt(data);
  fs.writeFileSync(filePath, encrypted, 'utf8');
  
  return true;
}

/**
 * 从加密文件读取
 */
function decryptFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  const encryptedData = fs.readFileSync(filePath, 'utf8');
  return decrypt(encryptedData);
}

/**
 * 哈希数据（用于校验，不可逆）
 */
function hash(data, algorithm = 'sha256') {
  return crypto.createHash(algorithm)
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');
}

/**
 * 生成随机密钥
 */
function generateKey(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * 安全比较（防止时序攻击）
 */
function safeCompare(a, b) {
  return crypto.timingSafeEqual(
    Buffer.from(a),
    Buffer.from(b)
  );
}

/**
 * 密码哈希（使用 scrypt + salt）
 * 返回格式: scrypt$N$r$p$salt$hash
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384;
  const r = 8;
  const p = 1;
  const keyLength = 64;
  
  const derivedKey = crypto.scryptSync(password, salt, keyLength, { N, r, p });
  
  return `scrypt$${N}$${r}$${p}$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * 密码验证
 */
function verifyPassword(password, hashedPassword) {
  try {
    const parts = hashedPassword.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }
    
    const [, N, r, p, salt, hash] = parts;
    const keyLength = Buffer.from(hash, 'hex').length;
    
    const derivedKey = crypto.scryptSync(password, salt, keyLength, {
      N: parseInt(N),
      r: parseInt(r),
      p: parseInt(p)
    });
    
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      derivedKey
    );
  } catch (error) {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  encryptToFile,
  decryptFromFile,
  hash,
  generateKey,
  safeCompare,
  getMachineKey,
  hashPassword,
  verifyPassword
};
