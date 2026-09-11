/**
 * Jest 测试配置
 * - 仅扫描 tests/ 目录下的单元测试
 * - 排除 backups/（自更新回滚备份中的过期测试副本）、手动脚本、沙箱集成脚本
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/backups/',
    '/src/sandbox/test\\.js$'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/sandbox/test.js',
    '!**/node_modules/**'
  ],
  testTimeout: 15000,
  verbose: false
};
