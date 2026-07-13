/**
 * 检测规则索引
 * 所有检测规则的统一入口
 */

const { config } = require('../../../config');

const rules = {
  unused_variables: require('./unused-variables'),
  unused_imports: require('./unused-imports'),
  unused_functions: require('./unused-functions'),
  magic_numbers: require('./magic-numbers'),
  long_functions: require('./long-functions'),
  high_complexity: require('./high-complexity'),
  deep_nesting: require('./deep-nesting'),
  null_check: require('./null-check'),
  unnecessary_else: require('./unnecessary-else'),
  console_log: require('./console-log'),
  duplicate_code: require('./duplicate-code'),
  missing_comment: require('./missing-comment')
};

function getRuleConfig(ruleId) {
  const ruleConfigMap = {
    unused_variables: { enabled: config.detection.unusedVariables, severity: 'medium' },
    unused_imports: { enabled: config.detection.unusedImports, severity: 'low' },
    unused_functions: { enabled: config.detection.unusedFunctions, severity: 'high' },
    magic_numbers: { enabled: config.detection.magicNumbers, severity: 'low' },
    long_functions: { enabled: true, severity: 'medium', threshold: config.detection.maxFunctionLines },
    high_complexity: { enabled: true, severity: 'medium', threshold: config.detection.maxCyclomaticComplexity },
    deep_nesting: { enabled: config.detection.enableDeepNestingCheck, severity: 'medium', threshold: config.detection.maxNestingDepth },
    null_check: { enabled: config.detection.enableNullCheck, severity: 'high' },
    unnecessary_else: { enabled: true, severity: 'low' },
    console_log: { enabled: config.detection.enableConsoleLogCheck, severity: 'low' },
    duplicate_code: { enabled: config.detection.enableDuplicateCodeCheck, severity: 'medium' },
    missing_comment: { enabled: config.detection.enableCommentCheck, severity: 'low' }
  };
  
  return ruleConfigMap[ruleId] || { enabled: false, severity: 'low' };
}

function getAllRules() {
  return Object.entries(rules).map(([id, rule]) => ({
    id,
    ...rule.meta,
    config: getRuleConfig(id)
  }));
}

function getEnabledRules() {
  return getAllRules().filter(rule => rule.config.enabled);
}

module.exports = {
  rules,
  getRuleConfig,
  getAllRules,
  getEnabledRules
};
