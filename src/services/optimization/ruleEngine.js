const { logger } = require('../../utils/logger');

const optimizationRules = [
  {
    id: 'remove-debug-log',
    name: '移除调试日志',
    type: 'cleanup',
    category: 'javascript',
    risk: 'low',
    pattern: /console\.(log|debug|info|warn|error|trace)\([^)]*\);?/g,
    replacement: '',
    explanation: '移除调试日志语句，生产代码不应包含调试输出'
  },
  {
    id: 'var-to-const',
    name: 'var转const',
    type: 'modernize',
    category: 'javascript',
    risk: 'medium',
    pattern: /\bvar\s+(\w+)\s*=\s*(?!function|new|this)/g,
    replacement: 'const $1 =',
    explanation: '将var替换为const，提升代码安全性'
  },
  {
    id: 'var-to-let',
    name: 'var转let',
    type: 'modernize',
    category: 'javascript',
    risk: 'medium',
    pattern: /\bvar\s+(\w+)\s*=\s*(?!function|new|this)/g,
    replacement: 'let $1 =',
    explanation: '将var替换为let，限制变量作用域'
  },
  {
    id: 'arrow-function',
    name: '箭头函数简化',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /function\s*\(\s*\)\s*\{/g,
    replacement: '() => {',
    explanation: '使用箭头函数简化代码'
  },
  {
    id: 'arrow-function-single',
    name: '单参数箭头函数',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /function\s*\(\s*(\w+)\s*\)\s*\{/g,
    replacement: '$1 => {',
    explanation: '单参数函数可省略括号'
  },
  {
    id: 'template-literals',
    name: '模板字符串',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(["'])\+\s*(\w+)\s*\+\s*(["'])/g,
    replacement: '`${$2}`',
    explanation: '使用模板字符串替代字符串拼接'
  },
  {
    id: 'template-literals-complex',
    name: '复杂模板字符串',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(["'])\+\s*([^;]+?)\s*\+\s*(["'])/g,
    replacement: '`${$2}`',
    explanation: '使用模板字符串替代复杂字符串拼接'
  },
  {
    id: 'object-shorthand',
    name: '对象属性简写',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*:\s*(\w+)\s*(?=,|})/g,
    replacement: '$1',
    explanation: '使用对象属性简写'
  },
  {
    id: 'object-method-shorthand',
    name: '对象方法简写',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*:\s*function\s*\(/g,
    replacement: '$1(',
    explanation: '使用对象方法简写'
  },
  {
    id: 'short-circuit-assignment',
    name: '短路赋值',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /if\s*\(\s*(!)?\s*(\w+)\s*\)\s*\{?\s*\2\s*=\s*(.+?)\s*;?\s*\}?/g,
    replacement: '$2 = $2 || $3;',
    explanation: '使用短路赋值简化条件判断'
  },
  {
    id: 'nullish-coalescing',
    name: '空值合并运算符',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*\|\|\s*([^;]+)/g,
    replacement: '$1 ?? $2',
    explanation: '使用空值合并运算符替代逻辑或'
  },
  {
    id: 'optional-chaining',
    name: '可选链操作符',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*\&\&\s*\1\.(\w+)/g,
    replacement: '$1?.$2',
    explanation: '使用可选链操作符简化空值检查'
  },
  {
    id: 'destructuring-assignment',
    name: '解构赋值',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*=\s*(\w+)\.(\w+)/g,
    replacement: 'const { $3: $1 } = $2;',
    explanation: '使用解构赋值简化对象属性提取'
  },
  {
    id: 'spread-operator',
    name: '展开运算符',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /Object\.assign\(\s*(\w+)\s*,\s*(\w+)\s*\)/g,
    replacement: '{ ...$1, ...$2 }',
    explanation: '使用展开运算符替代Object.assign'
  },
  {
    id: 'array-from',
    name: 'Array.from',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /Array\.prototype\.slice\.call\(\s*(\w+)\s*\)/g,
    replacement: 'Array.from($1)',
    explanation: '使用Array.from替代slice.call'
  },
  {
    id: 'const-instead-of-let',
    name: 'let转const',
    type: 'optimization',
    category: 'javascript',
    risk: 'medium',
    pattern: /\blet\s+(\w+)\s*=\s*(?!function|new|this)/g,
    replacement: 'const $1 =',
    explanation: '将不变的let替换为const'
  },
  {
    id: 'remove-unused-var',
    name: '移除未使用变量',
    type: 'cleanup',
    category: 'javascript',
    risk: 'low',
    pattern: /^(?:const|let|var)\s+\w+\s*=\s*undefined;?$/gm,
    replacement: '',
    explanation: '移除未使用的变量声明'
  },
  {
    id: 'remove-empty-block',
    name: '移除空代码块',
    type: 'cleanup',
    category: 'javascript',
    risk: 'low',
    pattern: /\{\s*\}/g,
    replacement: '{}',
    explanation: '移除空代码块'
  },
  {
    id: 'remove-empty-function',
    name: '移除空函数',
    type: 'cleanup',
    category: 'javascript',
    risk: 'low',
    pattern: /function\s+\w+\s*\(\s*\)\s*\{\s*\}/g,
    replacement: '() => {}',
    explanation: '简化空函数'
  },
  {
    id: 'double-bang-to-bool',
    name: '双重取反转布尔',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /!!(\w+)/g,
    replacement: 'Boolean($1)',
    explanation: '使用Boolean构造函数替代双重取反'
  },
  {
    id: 'number-to-parseInt',
    name: '数字转换优化',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*\*\s*1/g,
    replacement: 'parseInt($1)',
    explanation: '使用parseInt替代乘1转换'
  },
  {
    id: 'string-to-number',
    name: '字符串转数字',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*\+\s*0/g,
    replacement: 'Number($1)',
    explanation: '使用Number构造函数替代加0转换'
  },
  {
    id: 'for-to-foreach',
    name: 'for循环转forEach',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /for\s*\(\s*var\s+i\s*=\s*0\s*;\s*i\s*<\s*(\w+)\.length\s*;\s*i\+\+\s*\)\s*\{/g,
    replacement: '$1.forEach(function(item, i) {',
    explanation: '使用forEach替代传统for循环'
  },
  {
    id: 'for-of',
    name: 'for...of循环',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*(\w+)\.length\s*;\s*i\+\+\s*\)\s*\{/g,
    replacement: 'for (const item of $1) {',
    explanation: '使用for...of替代传统for循环'
  },
  {
    id: 'reduce-sum',
    name: 'reduce求和',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /let\s+(\w+)\s*=\s*0\s*;\s*for\s*\([^)]+\)\s*\{?\s*\1\s*\+=\s*[^;]+;/g,
    replacement: 'const $1 = arr.reduce((a, b) => a + b, 0);',
    explanation: '使用reduce替代循环求和'
  },
  {
    id: 'filter-map',
    name: '链式调用',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.filter\([^)]+\)\s*\.\s*map\([^)]+\)/g,
    replacement: '$1.filter().map()',
    explanation: '使用链式调用简化数组操作'
  },
  {
    id: 'find-instead-of-filter',
    name: 'find替代filter',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.filter\([^)]+\)\[0\]/g,
    replacement: '$1.find()',
    explanation: '使用find替代filter[0]'
  },
  {
    id: 'includes-instead-of-indexOf',
    name: 'includes替代indexOf',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.indexOf\([^)]+\)\s*!==\s*-1/g,
    replacement: '$1.includes()',
    explanation: '使用includes替代indexOf !== -1'
  },
  {
    id: 'startsWith-instead-of-indexOf',
    name: 'startsWith替代indexOf',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.indexOf\([^)]+\)\s*===\s*0/g,
    replacement: '$1.startsWith()',
    explanation: '使用startsWith替代indexOf === 0'
  },
  {
    id: 'endsWith-instead-of-lastIndexOf',
    name: 'endsWith替代lastIndexOf',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.lastIndexOf\([^)]+\)\s*===\s*\1\.length\s*-\s*\d+/g,
    replacement: '$1.endsWith()',
    explanation: '使用endsWith替代lastIndexOf判断'
  },
  {
    id: 'trim-instead-of-replace',
    name: 'trim替代replace',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.replace\(\s*\/^\s+|\s+$\s*\/g\s*\)/g,
    replacement: '$1.trim()',
    explanation: '使用trim替代replace去除首尾空格'
  },
  {
    id: 'trimStart-instead-of-replace',
    name: 'trimStart替代replace',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.replace\(\s*\/^\s+\s*\/g\s*\)/g,
    replacement: '$1.trimStart()',
    explanation: '使用trimStart替代replace去除开头空格'
  },
  {
    id: 'trimEnd-instead-of-replace',
    name: 'trimEnd替代replace',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.replace\(\s*\/\s+$\s*\/g\s*\)/g,
    replacement: '$1.trimEnd()',
    explanation: '使用trimEnd替代replace去除结尾空格'
  },
  {
    id: 'concat-to-spread',
    name: 'concat转展开',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.concat\(\s*(\w+)\s*\)/g,
    replacement: '[...$1, ...$2]',
    explanation: '使用展开运算符替代concat'
  },
  {
    id: 'push-to-spread',
    name: 'push转展开',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.push\(\s*(\w+)\s*\)/g,
    replacement: '$1 = [...$1, $2]',
    explanation: '使用展开运算符替代push'
  },
  {
    id: 'slice-to-spread',
    name: 'slice转展开',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.slice\(\)/g,
    replacement: '[...$1]',
    explanation: '使用展开运算符替代slice复制数组'
  },
  {
    id: 'entries-instead-of-keys',
    name: 'entries替代keys',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /Object\.keys\(\s*(\w+)\s*\)\.map\(\s*function\(\s*key\s*\)\s*\{/g,
    replacement: 'Object.entries($1).map(([key, value]) => {',
    explanation: '使用entries替代keys+map'
  },
  {
    id: 'values-instead-of-keys',
    name: 'values替代keys',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /Object\.keys\(\s*(\w+)\s*\)\.map\(\s*function\(\s*key\s*\)\s*\{\s*return\s*\1\[key\]/g,
    replacement: 'Object.values($1)',
    explanation: '使用values替代keys+map取值'
  },
  {
    id: 'fromEntries-instead-of-reduce',
    name: 'fromEntries替代reduce',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.reduce\(\s*function\(\s*acc\s*,\s*item\s*\)\s*\{\s*acc\[item\.\w+\]\s*=\s*item\.\w+\s*;\s*return\s*acc\s*;\s*\}\s*,\s*\{\}\s*\)/g,
    replacement: 'Object.fromEntries($1.map(item => [item.key, item.value]))',
    explanation: '使用fromEntries替代reduce构建对象'
  },
  {
    id: 'sort-with-comparator',
    name: '排序优化',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.sort\(\s*function\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s*a\s*-\s*b\s*\}\s*\)/g,
    replacement: '$1.sort((a, b) => a - b)',
    explanation: '使用箭头函数简化排序比较器'
  },
  {
    id: 'sort-string',
    name: '字符串排序',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.sort\(\s*function\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s*a\.localeCompare\(\s*b\s*\)\s*\}\s*\)/g,
    replacement: '$1.sort((a, b) => a.localeCompare(b))',
    explanation: '使用箭头函数简化字符串排序'
  },
  {
    id: 'every-instead-of-for',
    name: 'every替代for循环',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /for\s*\([^)]+\)\s*\{?\s*if\s*\(![^)]+\)\s*\{?\s*return\s*false\s*;?\s*\}?\s*\}?\s*return\s*true/g,
    replacement: 'arr.every(item => condition)',
    explanation: '使用every替代for循环检查所有元素'
  },
  {
    id: 'some-instead-of-for',
    name: 'some替代for循环',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /for\s*\([^)]+\)\s*\{?\s*if\s*\([^)]+\)\s*\{?\s*return\s*true\s*;?\s*\}?\s*\}?\s*return\s*false/g,
    replacement: 'arr.some(item => condition)',
    explanation: '使用some替代for循环检查存在元素'
  },
  {
    id: 'flat-instead-of-concat',
    name: 'flat替代concat',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.reduce\(\s*function\(\s*acc\s*,\s*item\s*\)\s*\{\s*return\s*acc\.concat\(\s*item\s*\)\s*\}\s*,\s*\[\]\s*\)/g,
    replacement: '$1.flat()',
    explanation: '使用flat替代reduce+concat扁平化数组'
  },
  {
    id: 'flatMap-instead-of-map-flat',
    name: 'flatMap替代map+flat',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.map\([^)]+\)\.flat\(\)/g,
    replacement: '$1.flatMap()',
    explanation: '使用flatMap替代map+flat'
  },
  {
    id: 'replaceAll-instead-of-replace',
    name: 'replaceAll替代replace',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.replace\(\s*\/([^/]+)\s*\/g\s*\)/g,
    replacement: '$1.replaceAll($2)',
    explanation: '使用replaceAll替代全局replace'
  },
  {
    id: 'at-instead-of-bracket',
    name: 'at替代括号',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\[(\w+)\.length\s*-\s*(\d+)\]/g,
    replacement: '$1.at(-$3)',
    explanation: '使用at方法替代负数索引'
  },
  {
    id: 'hasOwn-instead-of-hasOwnProperty',
    name: 'hasOwn替代hasOwnProperty',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\.hasOwnProperty\(\s*(\w+)\s*\)/g,
    replacement: 'Object.hasOwn($1, $2)',
    explanation: '使用Object.hasOwn替代hasOwnProperty'
  },
  {
    id: 'structuredClone-instead-of-JSON',
    name: 'structuredClone替代JSON',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /JSON\.parse\(\s*JSON\.stringify\(\s*(\w+)\s*\)\s*\)/g,
    replacement: 'structuredClone($1)',
    explanation: '使用structuredClone替代JSON深拷贝'
  },
  {
    id: 'Date-now-instead-of-new-Date',
    name: 'Date.now替代new Date',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /new\s+Date\(\)\.getTime\(\)/g,
    replacement: 'Date.now()',
    explanation: '使用Date.now()替代new Date().getTime()'
  },
  {
    id: 'Math-floor-instead-of-parseInt',
    name: 'Math.floor替代parseInt',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /parseInt\(\s*(\w+)\s*,\s*10\s*\)/g,
    replacement: 'Math.floor($1)',
    explanation: '使用Math.floor替代parseInt取整'
  },
  {
    id: 'exponentiation-operator',
    name: '指数运算符',
    type: 'modernize',
    category: 'javascript',
    risk: 'low',
    pattern: /Math\.pow\(\s*(\w+)\s*,\s*(\w+)\s*\)/g,
    replacement: '$1 ** $2',
    explanation: '使用指数运算符替代Math.pow'
  },
  {
    id: 'abs-instead-of-condition',
    name: 'Math.abs替代条件判断',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*<\s*0\s*\?\s*-\1\s*:\s*\1/g,
    replacement: 'Math.abs($1)',
    explanation: '使用Math.abs替代条件判断取绝对值'
  },
  {
    id: 'min-max-instead-of-condition',
    name: 'Math.min/max替代条件判断',
    type: 'optimization',
    category: 'javascript',
    risk: 'low',
    pattern: /(\w+)\s*>\s*(\w+)\s*\?\s*\2\s*:\s*\1/g,
    replacement: 'Math.min($1, $2)',
    explanation: '使用Math.min替代条件判断取最小值'
  }
];

class RuleEngine {
  constructor() {
    this.rules = optimizationRules;
  }

  optimize(code, context = {}) {
    let optimizedCode = code;
    const appliedRules = [];
    const category = context.language || 'javascript';

    const applicableRules = this.rules.filter(rule => {
      return rule.category === category || rule.category === 'all';
    });

    for (const rule of applicableRules) {
      const originalCode = optimizedCode;
      optimizedCode = optimizedCode.replace(rule.pattern, rule.replacement);
      
      if (optimizedCode !== originalCode) {
        appliedRules.push({
          ruleId: rule.id,
          ruleName: rule.name,
          explanation: rule.explanation,
          type: rule.type,
          risk: rule.risk
        });
      }
    }

    return {
      success: appliedRules.length > 0,
      optimizedCode: optimizedCode,
      appliedRules: appliedRules,
      explanation: appliedRules.length > 0 
        ? `应用了${appliedRules.length}个优化规则` 
        : '未找到可应用的优化规则',
      suggestions: appliedRules.map(r => r.explanation)
    };
  }

  getRulesByCategory(category) {
    return this.rules.filter(rule => rule.category === category || rule.category === 'all');
  }

  getRulesByType(type) {
    return this.rules.filter(rule => rule.type === type);
  }

  getRuleById(id) {
    return this.rules.find(rule => rule.id === id);
  }

  getStats() {
    const stats = {
      totalRules: this.rules.length,
      byCategory: {},
      byType: {},
      byRisk: {}
    };

    this.rules.forEach(rule => {
      stats.byCategory[rule.category] = (stats.byCategory[rule.category] || 0) + 1;
      stats.byType[rule.type] = (stats.byType[rule.type] || 0) + 1;
      stats.byRisk[rule.risk] = (stats.byRisk[rule.risk] || 0) + 1;
    });

    return stats;
  }
}

const ruleEngine = new RuleEngine();

module.exports = {
  RuleEngine,
  ruleEngine,
  optimizationRules
};