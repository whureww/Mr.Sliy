const fs = require('fs');
const path = require('path');
const { knowledgeBase } = require('./src/services/vector/knowledgeBase');

async function expandKnowledgeBase() {
  try {
    console.log('开始扩充知识库...');
    console.log('初始化知识库...');
    
    await knowledgeBase.init();
    
    const entries = [];
    const cases = [];
    
    console.log('\n生成 JavaScript 知识条目...');
    for (let i = 0; i < 120; i++) {
      const topics = [
        'ES6+最佳实践', '异步处理标准', 'React代码审查规则', '前端性能指标', 
        '模块导入规范', '错误边界处理', '日志规范', '第三方依赖安全校验',
        '打包体积优化', '类型兼容规范', '前端内存治理', 'CSP安全配置',
        '表单输入校验规范', 'DOM操作优化', '事件委托模式', '防抖节流实现',
        '闭包内存泄漏', '原型链污染', '代码分割策略', '懒加载实现'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `JavaScript ${topic}：遵循现代前端开发标准，${topic.toLowerCase().replace('规范', '').replace('实现', '')}相关的最佳实践和注意事项。`,
        type: 'best_practice',
        language: 'javascript',
        tags: ['javascript', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 TypeScript 知识条目...');
    for (let i = 0; i < 110; i++) {
      const topics = [
        '静态类型规范', '泛型最佳实践', '类型守卫', '枚举使用规范',
        '接口重构', '类型兼容规范', 'never类型使用', 'unknown类型',
        '条件类型', '映射类型', '类型别名', '模块声明',
        '命名空间', '装饰器使用', '编译选项配置', 'Lint规则',
        '类型体操', '类型推断', '类型断言', '类型声明文件'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `TypeScript ${topic}：严格遵循类型安全原则，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'type_safety',
        language: 'typescript',
        tags: ['typescript', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Python 知识条目...');
    for (let i = 0; i < 105; i++) {
      const topics = [
        'PEP8编码规范', '类型提示最佳实践', '异步asyncio标准', '数据处理性能',
        '爬虫安全编码', '数据库连接池规范', '异常分层捕获', '测试用例编写',
        '缓存使用策略', '大文件读写标准', '循环性能优化', '第三方库安全审计',
        'Pythonic重构原则', '列表推导式', '生成器表达式', '装饰器模式',
        '上下文管理器', '多线程安全', '进程池使用', '内存优化技巧'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Python ${topic}：遵循PEP8规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'python',
        tags: ['python', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Java 知识条目...');
    for (let i = 0; i < 95; i++) {
      const topics = [
        '阿里Java开发手册', 'JVM内存优化', 'Spring框架最佳实践', '并发安全编码',
        '数据库事务规范', '异常处理层级', '单元测试标准', '日志分级规范',
        '接口参数校验', '敏感数据脱敏', '反射性能优化', '线程安全编码',
        '依赖注入规范', '代码整洁之道', '设计模式应用', '集合框架使用',
        'IO流优化', 'NIO编程', 'Lambda表达式', 'Stream API'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Java ${topic}：遵循企业级开发标准，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'java',
        tags: ['java', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Go 知识条目...');
    for (let i = 0; i < 90; i++) {
      const topics = [
        'Go官方编码规范', '并发安全模型', 'GC内存调优', 'HTTP服务性能',
        'GRPC最佳实践', '错误分层处理', '资源生命周期管理', '切片安全操作',
        'Map安全操作', '单元测试规范', '依赖注入编码', '内存泄漏排查',
        '接口设计原则', '包管理规范', 'defer使用规范', 'panic/recover',
        'context使用', 'channel模式', 'select用法', 'goroutine安全'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Go ${topic}：遵循Go官方编码规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'go',
        tags: ['go', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 C++ 知识条目...');
    for (let i = 0; i < 70; i++) {
      const topics = [
        'C++17/20现代编码', '内存安全准则', 'STL容器性能', '并发锁使用',
        'RAII资源管理', '类型安全强校验', '编译期常量优化', '内存泄漏检测',
        'IO缓冲优化', '模板简化规范', '智能指针使用', '移动语义',
        '完美转发', 'lambda表达式', 'range-for循环', 'constexpr优化',
        'concepts约束', 'coroutines', 'modules', 'span视图'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `C++ ${topic}：遵循现代C++编码规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'c++',
        tags: ['c++', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 C# 知识条目...');
    for (let i = 0; i < 65; i++) {
      const topics = [
        '.NET官方编码规范', 'GC内存优化', 'ASP.NET安全编码', '异步处理标准',
        '值类型引用类型区分', '异常捕获分层', '依赖注入规范', 'ORM性能优化',
        'XSS/CSRF防护', '单元测试xUnit', '内存碎片治理', 'LINQ性能优化',
        '泛型使用规范', '扩展方法', 'async/await', 'Task并行',
        '不可变类型', '记录类型', '顶层语句', '文件范围命名空间'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `C# ${topic}：遵循.NET官方编码规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'c#',
        tags: ['c#', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Rust 知识条目...');
    for (let i = 0; i < 60; i++) {
      const topics = [
        '所有权安全规范', '零成本抽象', '异步tokio编码', '内存无泄漏准则',
        '错误处理分层', '容器性能优化', '并发安全模型', 'unsafe块最小化',
        '单元测试标准', '编译期校验', '生命周期标注', '借用检查规则',
        '智能指针', '迭代器模式', '模式匹配', '错误传播',
        '宏使用规范', 'Trait实现', '类型安全', '内存安全'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Rust ${topic}：遵循所有权安全原则，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'rust',
        tags: ['rust', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Swift 知识条目...');
    for (let i = 0; i < 50; i++) {
      const topics = [
        'Swift API设计规范', 'iOS内存治理', '异步Combine', '可选类型安全',
        'UI渲染性能', '敏感数据加密', '单元测试Quick', '循环渲染复用',
        '内存泄漏排查', '协议扩展', '泛型约束', '错误处理',
        '可选链', 'guard语句', 'defer使用', '自动引用计数',
        '闭包捕获', '枚举关联值', '结构体值语义', '类引用语义'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Swift ${topic}：遵循Swift API设计规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'swift',
        tags: ['swift', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Kotlin 知识条目...');
    for (let i = 0; i < 50; i++) {
      const topics = [
        'Kotlin官方编码规范', 'Android性能优化', '协程异步标准', '空安全强制',
        'ViewModel内存治理', 'SQL注入防护', '单元测试JUnit', 'UI列表复用',
        '全局状态封装', '空安全操作符', '集合操作', '数据类',
        '扩展函数', '高阶函数', '懒加载', '密封类',
        '枚举类', '委托属性', 'DSL构建', '协程上下文'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Kotlin ${topic}：遵循Kotlin官方编码规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'kotlin',
        tags: ['kotlin', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 PHP 知识条目...');
    for (let i = 0; i < 45; i++) {
      const topics = [
        'PSR-1/PSR-12编码规范', 'Laravel最佳实践', 'PHP内存优化', 'XSS/CSRF防护',
        '数据库连接池', '异常分层捕获', '异步队列性能', '敏感输入过滤',
        '循环IO优化', 'Composer依赖', '命名空间', '接口设计',
        'Trait使用', '魔术方法', '类型声明', '返回类型',
        '空合并操作', '太空船操作符', '匿名类', '生成器'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `PHP ${topic}：遵循PSR编码规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'php',
        tags: ['php', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Ruby 知识条目...');
    for (let i = 0; i < 40; i++) {
      const topics = [
        'Ruby社区编码规范', 'Rails性能优化', '内存泄漏排查', '异步Sidekiq',
        'SQL注入防护', '单元测试RSpec', '循环批量处理', '敏感数据过滤',
        'ActiveRecord优化', 'Gem依赖管理', '块操作', '符号使用',
        '哈希语法', '字符串处理', '正则表达式', '异常处理',
        '模块包含', '类继承', '单例方法', '元编程'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Ruby ${topic}：遵循Ruby社区编码规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'ruby',
        tags: ['ruby', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 Scala 知识条目...');
    for (let i = 0; i < 35; i++) {
      const topics = [
        'Scala函数式编码', 'Spark大数据性能', 'Akka并发安全', 'Option空类型',
        '内存GC调优', '数据库批量操作', '测试ScalaTest', '模式匹配',
        '集合操作', '隐式转换', '类型类', '高阶函数',
        '协程', 'Future异步', 'Actor模型', '依赖注入'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `Scala ${topic}：遵循函数式编程规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'best_practice',
        language: 'scala',
        tags: ['scala', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 SQL 知识条目...');
    for (let i = 0; i < 45; i++) {
      const topics = [
        'MySQL性能规范', 'PostgreSQL性能规范', '索引设计标准', '事务隔离级别',
        'SQL注入防护', '分库分表最佳实践', '慢查询治理', '大表批量更新',
        '锁竞争优化', '数据脱敏存储', '查询优化', 'JOIN优化',
        '子查询优化', '视图使用', '存储过程', '触发器',
        '临时表', '执行计划', '分区表', '读写分离'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `SQL ${topic}：遵循数据库性能优化规范，${topic.toLowerCase()}相关的最佳实践。`,
        type: 'performance',
        language: 'sql',
        tags: ['sql', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('生成 General 通用知识条目...');
    for (let i = 0; i < 100; i++) {
      const topics = [
        '代码审查通用标准', '安全编码基础准则', '性能优化通用思路', '测试用例通用要求',
        '版本控制Git规范', '圈复杂度控制', '内存泄漏通用排查', '输入校验通用规则',
        '注释编写标准', '日志分级通用规范', '避免全局变量', '分层架构设计',
        '异常统一处理模板', '代码可读性', '代码可维护性', '错误处理最佳实践',
        '安全编码原则', '性能优化策略', '代码质量指标', '代码重构技巧',
        '设计模式应用', '代码模块化', '接口设计原则', '代码复用',
        '代码风格统一', '命名规范', '文档编写', '测试覆盖率'
      ];
      const topic = topics[i % topics.length];
      entries.push({
        content: `通用规范：${topic}，所有编程语言都应遵循的基本准则。`,
        type: 'best_practice',
        language: 'general',
        tags: ['general', topic.toLowerCase().replace(/[\s+]/g, '_')],
        source: 'expanded'
      });
    }
    
    console.log('\n生成 JavaScript 优化案例...');
    for (let i = 0; i < 85; i++) {
      const patterns = [
        { original: 'for(let i=0;i<arr.length;i++){res.push(arr[i])}', optimized: 'const res = arr.map(x=>x)', issue: 'loop_optimization', desc: '使用Array.map替代for循环' },
        { original: 'if(a!==null&&a!==undefined){fn(a)}', optimized: 'a&&fn(a)', issue: 'null_check', desc: '使用短路求值简化空值检查' },
        { original: 'var x=1;var y=2', optimized: 'const x=1;const y=2', issue: 'code_style', desc: '使用const替代var' },
        { original: 'let name=user.name?user.name:\"default\"', optimized: 'const name=user.name??\"default\"', issue: 'code_style', desc: '使用空值合并运算符' },
        { original: 'function(a,b,c){return a+b+c}', optimized: 'const fn=({a,b,c})=>a+b+c', issue: 'function_design', desc: '使用对象参数' },
        { original: 'if(cond){return a}else{return b}', optimized: 'return cond?a:b', issue: 'unnecessary_else', desc: '使用三元表达式' },
        { original: 'for(let i=0;i<10;i++){console.log(i)}', optimized: 'Array.from({length:10},(_,i)=>console.log(i))', issue: 'loop_optimization', desc: '使用Array.from生成序列' },
        { original: 'const copy=Object.assign({},obj)', optimized: 'const copy={...obj}', issue: 'code_style', desc: '使用扩展运算符' },
        { original: 'setTimeout(()=>{fn()},1000)', optimized: 'setTimeout(fn,1000)', issue: 'code_style', desc: '简化回调' },
        { original: 'if(arr&&arr.length>0){}', optimized: 'if(arr?.length){}', issue: 'null_check', desc: '使用可选链' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，提升代码简洁性和可读性`,
        language: 'javascript',
        issueType: p.issue
      });
    }
    
    console.log('生成 TypeScript 优化案例...');
    for (let i = 0; i < 75; i++) {
      const patterns = [
        { original: 'function fn(x){return x}', optimized: 'function fn<T>(x:T):T{return x}', issue: 'type_safe', desc: '添加泛型类型' },
        { original: 'const x:any=getValue()', optimized: 'const x:ReturnType<typeof getValue>=getValue()', issue: 'type_safe', desc: '使用ReturnType推断类型' },
        { original: 'interface A{a:string;b:string}', optimized: 'type A={a:string;b:string}', issue: 'code_style', desc: '使用type替代interface' },
        { original: 'type Fn=(a:string)=>void', optimized: 'type Fn=(a:string)=>void', issue: 'type_safe', desc: '类型别名优化' },
        { original: 'function isStr(x):x is string{return typeof x===\"string\"}', optimized: 'function isStr(x:x is string):boolean{return typeof x===\"string\"}', issue: 'type_safe', desc: '类型守卫优化' },
        { original: 'enum Color{Red,Green}', optimized: 'const enum Color{Red,Green}', issue: 'performance', desc: '使用const enum' },
        { original: 'const x=val??\"default\"', optimized: 'const x:string=val??\"default\"', issue: 'type_safe', desc: '显式类型标注' },
        { original: 'type P={[k:string]:number}', optimized: 'type P=Record<string,number>', issue: 'code_style', desc: '使用Record类型' },
        { original: 'type A=B extends C?D:E', optimized: 'type A=B extends C?D:E', issue: 'type_safe', desc: '条件类型优化' },
        { original: 'function fn(...args:any[]){}', optimized: 'function fn<T extends unknown[]>(...args:T){}', issue: 'type_safe', desc: '剩余参数类型约束' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，提升TypeScript类型安全性`,
        language: 'typescript',
        issueType: p.issue
      });
    }
    
    console.log('生成 Python 优化案例...');
    for (let i = 0; i < 70; i++) {
      const patterns = [
        { original: 'res=[]\nfor x in arr:\n    res.append(x*2)', optimized: 'res=[x*2 for x in arr]', issue: 'loop_optimization', desc: '列表推导式' },
        { original: 'f=open(\"a.txt\")\nf.read()\nf.close()', optimized: 'with open(\"a.txt\") as f:\n    f.read()', issue: 'resource_leak', desc: '使用with语句' },
        { original: 'if x>0:\n    r=\"p\"\nelse:\n    r=\"n\"', optimized: 'r=\"p\" if x>0 else \"n\"', issue: 'code_style', desc: '三元表达式' },
        { original: 'def fn(a,b,c,d):pass', optimized: 'def fn(a,b,c,d=0):pass', issue: 'function_design', desc: '默认参数' },
        { original: 'for i in range(len(arr)):\n    print(arr[i])', optimized: 'for x in arr:\n    print(x)', issue: 'loop_optimization', desc: '直接遍历' },
        { original: 'if k in d:\n    v=d[k]\nelse:\n    v=0', optimized: 'v=d.get(k,0)', issue: 'code_style', desc: '字典get方法' },
        { original: 'from re import search\nfor _ in range(10):\n    search(pat,s)', optimized: 'import re\npat=re.compile(pat)\nfor _ in range(10):\n    pat.search(s)', issue: 'performance', desc: '正则预编译' },
        { original: 'class A:\n    def __init__(self,x):\n        self.x=x', optimized: '@dataclass\nclass A:\n    x:int', issue: 'code_style', desc: '使用dataclass' },
        { original: 'def fn():\n    if cond:\n        return a\n    else:\n        return b', optimized: 'def fn():\n    return a if cond else b', issue: 'unnecessary_else', desc: '消除else' },
        { original: 'lst=[]\nfor x in data:\n    if x.valid:\n        lst.append(x)', optimized: 'lst=[x for x in data if x.valid]', issue: 'loop_optimization', desc: '带条件的列表推导' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合Pythonic风格`,
        language: 'python',
        issueType: p.issue
      });
    }
    
    console.log('生成 Java 优化案例...');
    for (let i = 0; i < 65; i++) {
      const patterns = [
        { original: 'FileInputStream fis=new FileInputStream(\"a.txt\");\nfis.read();\nfis.close();', optimized: 'try(FileInputStream fis=new FileInputStream(\"a.txt\")){\n    fis.read();\n}', issue: 'resource_leak', desc: 'try-with-resources' },
        { original: 'List<String> list=new ArrayList<>();\nfor(User u:users){\n    list.add(u.getName());\n}', optimized: 'List<String> list=users.stream().map(User::getName).collect(toList());', issue: 'loop_optimization', desc: 'Stream API' },
        { original: 'if(user!=null&&user.getName()!=null){s=user.getName();}', optimized: 's=Optional.ofNullable(user).map(User::getName).orElse(null);', issue: 'null_check', desc: 'Optional空安全' },
        { original: 'button.addActionListener(new ActionListener(){public void actionPerformed(ActionEvent e){}});', optimized: 'button.addActionListener(e->{});', issue: 'code_style', desc: 'Lambda表达式' },
        { original: 'String s=\"a\"+\"b\"+\"c\";', optimized: 'String s=String.join(\"\", \"a\",\"b\",\"c\");', issue: 'performance', desc: '字符串拼接优化' },
        { original: 'public static final int MAX=100;', optimized: 'public enum Limit{MAX(100)}', issue: 'code_style', desc: '使用枚举' },
        { original: 'if(flag){return true;}else{return false;}', optimized: 'return flag;', issue: 'unnecessary_else', desc: '直接返回' },
        { original: 'new Thread(new Runnable(){public void run(){}}).start();', optimized: 'new Thread(()->{}).start();', issue: 'code_style', desc: 'Lambda线程' },
        { original: 'List<String> l=new ArrayList<>();', optimized: 'List<String> l=new ArrayList<>(100);', issue: 'performance', desc: '预分配容量' },
        { original: 'String sql=\"SELECT * FROM t WHERE id=\"+id;', optimized: 'String sql=\"SELECT * FROM t WHERE id=?\";', issue: 'security_risk', desc: '参数化查询' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，提升Java代码质量`,
        language: 'java',
        issueType: p.issue
      });
    }
    
    console.log('生成 Go 优化案例...');
    for (let i = 0; i < 60; i++) {
      const patterns = [
        { original: 'f,err:=os.Open(\"a.txt\")\nif err!=nil{return}\nf.Read(buf)\nf.Close()', optimized: 'f,err:=os.Open(\"a.txt\")\nif err!=nil{return}\ndefer f.Close()\nf.Read(buf)', issue: 'resource_leak', desc: '使用defer' },
        { original: 'var arr []int\nfor i:=0;i<100;i++{\n    arr=append(arr,i)\n}', optimized: 'arr:=make([]int,0,100)\nfor i:=0;i<100;i++{\n    arr=append(arr,i)\n}', issue: 'performance', desc: '预分配切片容量' },
        { original: 'for i:=0;i<len(arr);i++{\n    fmt.Println(arr[i])\n}', optimized: 'for _,v:=range arr{\n    fmt.Println(v)\n}', issue: 'code_style', desc: 'range循环' },
        { original: 'if err!=nil{\n    return err\n}else{\n    return nil\n}', optimized: 'return err', issue: 'unnecessary_else', desc: '直接返回错误' },
        { original: 'var s string\nfor _,c:=range str{\n    s+=string(c)\n}', optimized: 'var b strings.Builder\nfor _,c:=range str{\n    b.WriteRune(c)\n}\ns=b.String()', issue: 'performance', desc: 'strings.Builder' },
        { original: 'if arr==nil{\n    arr=[]int{}\n}', optimized: 'if arr==nil{\n    arr=make([]int,0)\n}', issue: 'code_style', desc: 'nil切片处理' },
        { original: 'go func(){fn()}()', optimized: 'go fn()', issue: 'code_style', desc: '简化goroutine' },
        { original: 'if x!=nil&&x.y!=nil{return x.y}', optimized: 'if x==nil||x.y==nil{return nil}\nreturn x.y', issue: 'null_check', desc: '提前返回' },
        { original: 'type Config struct{\n    Host string\n    Port int\n}', optimized: 'type Config struct{\n    Host string `json:\"host\"`\n    Port int    `json:\"port\"`\n}', issue: 'code_style', desc: '结构体标签' },
        { original: 'var m sync.Mutex\nfor i:=0;i<10;i++{\n    m.Lock()\n    // do\n    m.Unlock()\n}', optimized: 'var m sync.RWMutex\nfor i:=0;i<10;i++{\n    m.RLock()\n    // read\n    m.RUnlock()\n}', issue: 'performance', desc: '读写锁优化' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合Go编码规范`,
        language: 'go',
        issueType: p.issue
      });
    }
    
    console.log('生成 C++ 优化案例...');
    for (let i = 0; i < 45; i++) {
      const patterns = [
        { original: 'int* p=new int[10];\n// use\n// forgot delete', optimized: 'std::unique_ptr<int[]> p(new int[10]);', issue: 'memory_optimize', desc: '智能指针' },
        { original: 'std::vector<int> v;\nfor(int i=0;i<100;i++){v.push_back(i);}', optimized: 'std::vector<int> v(100);\nfor(int i=0;i<100;i++){v[i]=i;}', issue: 'performance', desc: '预分配容器' },
        { original: 'for(std::vector<int>::iterator it=v.begin();it!=v.end();++it){}', optimized: 'for(auto& x:v){}', issue: 'code_style', desc: 'range-for' },
        { original: 'int x=100;', optimized: 'constexpr int x=100;', issue: 'performance', desc: '编译期常量' },
        { original: 'std::string s=\"a\"+\n            \"b\"+\n            \"c\";', optimized: 'std::string s=\"abc\";', issue: 'performance', desc: '字符串拼接优化' },
        { original: 'void fn(int x){x=1;}', optimized: 'void fn(const int x){}', issue: 'code_style', desc: 'const修饰' },
        { original: 'std::string f(){std::string s=\"a\";return s;}', optimized: 'std::string f(){return \"a\";}', issue: 'performance', desc: '返回值优化' },
        { original: 'if(ptr!=nullptr){ptr->fn();}', optimized: 'ptr&&ptr->fn();', issue: 'null_check', desc: '短路求值' },
        { original: 'class A{\npublic:\n    A(){}\n    ~A(){}\n};', optimized: 'class A{};', issue: 'code_style', desc: '简化类定义' },
        { original: 'std::shared_ptr<A> p(new A());', optimized: 'auto p=std::make_shared<A>();', issue: 'code_style', desc: 'make_shared' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，现代C++最佳实践`,
        language: 'c++',
        issueType: p.issue
      });
    }
    
    console.log('生成 C# 优化案例...');
    for (let i = 0; i < 40; i++) {
      const patterns = [
        { original: 'FileStream fs=new FileStream(\"a.txt\",FileMode.Open);\nfs.Read(buf);\nfs.Close();', optimized: 'using(FileStream fs=new FileStream(\"a.txt\",FileMode.Open)){\n    fs.Read(buf);\n}', issue: 'resource_leak', desc: 'using语句' },
        { original: 'List<int> res=new List<int>();\nforeach(int x in arr){\n    if(x%2==0) res.Add(x);\n}', optimized: 'var res=arr.Where(x=>x%2==0).ToList();', issue: 'loop_optimization', desc: 'LINQ查询' },
        { original: 'if(user!=null&&user.Name!=null){s=user.Name;}', optimized: 's=user?.Name;', issue: 'null_check', desc: '空条件运算符' },
        { original: 'string s=\"Hello \"+name+\"!\";', optimized: 'string s=$\"Hello {name}!\";', issue: 'code_style', desc: '字符串插值' },
        { original: 'public void Fn(){Task.Run(()=>{DoWork();});}', optimized: 'public async Task Fn(){await Task.Run(DoWork);}', issue: 'async_optimization', desc: 'async/await' },
        { original: 'public int X=100;', optimized: 'public const int X=100;', issue: 'code_style', desc: '只读常量' },
        { original: 'if(cond){return true;}else{return false;}', optimized: 'return cond;', issue: 'unnecessary_else', desc: '直接返回' },
        { original: 'List<int> lst=new List<int>();', optimized: 'List<int> lst=new List<int>(100);', issue: 'performance', desc: '预分配容量' },
        { original: 'string sql=\"SELECT * FROM t WHERE id=\"+id;', optimized: 'string sql=\"SELECT * FROM t WHERE id=@id\";', issue: 'security_risk', desc: '参数化查询' },
        { original: 'public class A<T,U,V>{public T X;public U Y;public V Z;}', optimized: 'public record A<T,U,V>(T X,U Y,V Z);', issue: 'code_style', desc: '记录类型' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合C#编码规范`,
        language: 'c#',
        issueType: p.issue
      });
    }
    
    console.log('生成 Rust 优化案例...');
    for (let i = 0; i < 35; i++) {
      const patterns = [
        { original: 'fn get_x(o:Option<i32>)->i32{\n    match o{\n        Some(x)=>x,\n        None=>0\n    }\n}', optimized: 'fn get_x(o:Option<i32>)->i32{\n    o.unwrap_or(0)\n}', issue: 'code_style', desc: 'Option方法' },
        { original: 'for i in 0..10{\n    println!(\"{}\",i);\n}', optimized: 'for i in 0..10{\n    println!(\"{}\",i);\n}', issue: 'code_style', desc: '范围循环' },
        { original: 'let mut v:Vec<i32>=Vec::new();\nfor i in 0..100{\n    v.push(i);\n}', optimized: 'let mut v:Vec<i32>=Vec::with_capacity(100);\nfor i in 0..100{\n    v.push(i);\n}', issue: 'performance', desc: '预分配容量' },
        { original: 'fn read_file()->Result<String,std::io::Error>{\n    let f=std::fs::read_to_string(\"a.txt\");\n    match f{\n        Ok(s)=>Ok(s),\n        Err(e)=>Err(e)\n    }\n}', optimized: 'fn read_file()->Result<String,std::io::Error>{\n    std::fs::read_to_string(\"a.txt\")\n}', issue: 'code_style', desc: '直接返回Result' },
        { original: 'if x.is_some(){\n    x.unwrap()\n}else{\n    0\n}', optimized: 'x.unwrap_or(0)', issue: 'unnecessary_else', desc: '消除else' },
        { original: 'let s1=String::from(\"a\");\nlet s2=s1.clone();', optimized: 'let s1=String::from(\"a\");\nlet s2=s1;', issue: 'code_style', desc: '移动语义' },
        { original: 'const MAX:i32=100;', optimized: 'const MAX:i32=100;', issue: 'code_style', desc: '常量定义' },
        { original: 'let mut m=std::collections::HashMap::new();\nm.insert(\"a\",1);', optimized: 'let mut m:std::collections::HashMap<_,_>=std::collections::HashMap::new();\nm.insert(\"a\",1);', issue: 'type_safe', desc: '类型标注' },
        { original: 'fn calc(a:i32,b:i32)->i32{a+b}', optimized: 'fn calc(a:i32,b:i32)->i32{a+b}', issue: 'code_style', desc: '简单函数' },
        { original: 'for i in v.iter(){\n    println!(\"{}\",i);\n}', optimized: 'v.iter().for_each(|x|println!(\"{}\",x));', issue: 'code_style', desc: '迭代器方法' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合Rust编码规范`,
        language: 'rust',
        issueType: p.issue
      });
    }
    
    console.log('生成 Swift 优化案例...');
    for (let i = 0; i < 30; i++) {
      const patterns = [
        { original: 'if user!=nil&&user!.name!=nil{print(user!.name!)}', optimized: 'if let name=user?.name{print(name)}', issue: 'null_check', desc: '可选绑定' },
        { original: 'if cond{\n    return a\n}else{\n    // more\n}', optimized: 'guard cond else{return a}\n// more', issue: 'unnecessary_else', desc: 'guard语句' },
        { original: 'for i in 0..<arr.count{\n    print(arr[i])\n}', optimized: 'for x in arr{\n    print(x)\n}', issue: 'loop_optimization', desc: 'for-in遍历' },
        { original: 'var x=10', optimized: 'let x=10', issue: 'code_style', desc: 'let常量' },
        { original: '\"Hello \" + name + \"!\"', optimized: '\"Hello \\(name)!\"', issue: 'code_style', desc: '字符串插值' },
        { original: 'let f=FileHandle(forReadingAtPath:\"a.txt\")!\nf.readDataToEndOfFile()\nf.closeFile()', optimized: 'if let f=FileHandle(forReadingAtPath:\"a.txt\"){\n    f.readDataToEndOfFile()\n}', issue: 'resource_leak', desc: '自动释放' },
        { original: 'let res=arr.filter{$0>0}.map{$0*2}', optimized: 'let res=arr.filter{$0>0}.map{$0*2}', issue: 'loop_optimization', desc: '链式调用' },
        { original: 'let max=100', optimized: 'enum Limit{static let max=100}', issue: 'code_style', desc: '枚举常量' },
        { original: 'if x>0{\n    return true\n}else{\n    return false\n}', optimized: 'return x>0', issue: 'unnecessary_else', desc: '直接返回' },
        { original: 'var arr=[Int]()\nfor i in 0..<100{\n    arr.append(i)\n}', optimized: 'let arr=(0..<100).map{$0}', issue: 'loop_optimization', desc: '范围映射' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合Swift编码规范`,
        language: 'swift',
        issueType: p.issue
      });
    }
    
    console.log('生成 Kotlin 优化案例...');
    for (let i = 0; i < 30; i++) {
      const patterns = [
        { original: 'if(user!=null&&user.name!=null){print(user.name)}', optimized: 'user?.name?.let{print(it)}', issue: 'null_check', desc: '空安全操作' },
        { original: 'val res=ArrayList<String>()\nfor(s in list){\n    if(s.isNotEmpty()) res.add(s)\n}', optimized: 'val res=list.filter{it.isNotEmpty()}', issue: 'loop_optimization', desc: '集合过滤' },
        { original: 'if(x>0) return \"p\"\nelse if(x<0) return \"n\"\nelse return \"z\"', optimized: 'return when{\n    x>0->\"p\"\n    x<0->\"n\"\n    else->\"z\"\n}', issue: 'code_style', desc: 'when表达式' },
        { original: 'class User(val name:String,val age:Int)', optimized: 'data class User(val name:String,val age:Int)', issue: 'code_style', desc: '数据类' },
        { original: 'val x:String by lazy{expensive()}', optimized: 'val x:String by lazy{expensive()}', issue: 'performance', desc: '懒加载' },
        { original: 'with(obj){\n    a=1\n    b=2\n}', optimized: 'obj.apply{\n    a=1\n    b=2\n}', issue: 'code_style', desc: 'apply函数' },
        { original: 'val arr=IntArray(100)', optimized: 'val arr=IntArray(100){it}', issue: 'code_style', desc: '数组初始化' },
        { original: 'val max=100', optimized: 'const val MAX=100', issue: 'code_style', desc: '常量定义' },
        { original: 'if(cond) return true else return false', optimized: 'return cond', issue: 'unnecessary_else', desc: '直接返回' },
        { original: 'val s=listOf(1,2,3).joinToString()', optimized: 'val s=listOf(1,2,3).joinToString()', issue: 'code_style', desc: '集合方法' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合Kotlin编码规范`,
        language: 'kotlin',
        issueType: p.issue
      });
    }
    
    console.log('生成 PHP 优化案例...');
    for (let i = 0; i < 25; i++) {
      const patterns = [
        { original: 'if($user!==null&&$user->name!==null){echo $user->name;}', optimized: 'echo $user?->name??\"\";', issue: 'null_check', desc: '空安全操作符' },
        { original: '$res=array();\nforeach($arr as $x){\n    if($x>0) $res[]=$x;\n}', optimized: '$res=array_filter($arr,fn($x)=>$x>0);', issue: 'loop_optimization', desc: 'array_filter' },
        { original: '$sql=\"SELECT * FROM t WHERE id=\" . $id;', optimized: '$sql=\"SELECT * FROM t WHERE id=?\";', issue: 'security_risk', desc: '参数化查询' },
        { original: 'if($x){\n    return true;\n}else{\n    return false;\n}', optimized: 'return (bool)$x;', issue: 'unnecessary_else', desc: '直接返回' },
        { original: 'define(\"MAX\",100);', optimized: 'const MAX=100;', issue: 'code_style', desc: '常量定义' },
        { original: '$f=fopen(\"a.txt\",\"r\");\nfread($f,1024);\nfclose($f);', optimized: '$content=file_get_contents(\"a.txt\");', issue: 'resource_leak', desc: '文件函数' },
        { original: 'for($i=0;$i<count($arr);$i++){}', optimized: '$len=count($arr);\nfor($i=0;$i<$len;$i++){}', issue: 'performance', desc: '缓存长度' },
        { original: '$a=$b??$c??\"default\";', optimized: '$a=$b??$c??\"default\";', issue: 'code_style', desc: '空合并操作符' },
        { original: 'function fn($a,$b,$c){}', optimized: 'function fn($a,$b,$c=0){}', issue: 'function_design', desc: '默认参数' },
        { original: '$arr=array(1,2,3);', optimized: '$arr=[1,2,3];', issue: 'code_style', desc: '短数组语法' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合PHP编码规范`,
        language: 'php',
        issueType: p.issue
      });
    }
    
    console.log('生成 Ruby 优化案例...');
    for (let i = 0; i < 20; i++) {
      const patterns = [
        { original: 'res=[]\narr.each{|x|\n    res<<x*2\n}', optimized: 'res=arr.map{|x|x*2}', issue: 'loop_optimization', desc: 'map方法' },
        { original: 'if x>0\n    \"p\"\nelse\n    \"n\"\nend', optimized: 'x>0 ? \"p\" : \"n\"', issue: 'code_style', desc: '三元表达式' },
        { original: 'def fn(a,b,c,d)\nend', optimized: 'def fn(a:,b:,c:,d:0)\nend', issue: 'function_design', desc: '关键字参数' },
        { original: 'user && user.name', optimized: 'user&.name', issue: 'null_check', desc: '安全导航操作符' },
        { original: 'MAX=100', optimized: 'MAX=100.freeze', issue: 'code_style', desc: '冻结常量' },
        { original: 'File.open(\"a.txt\"){|f|\n    f.read\n}', optimized: 'File.read(\"a.txt\")', issue: 'resource_leak', desc: '文件读取' },
        { original: 'if cond\n    return true\nelse\n    return false\nend', optimized: 'cond', issue: 'unnecessary_else', desc: '直接返回' },
        { original: 'users.includes(:posts)', optimized: 'users.eager_load(:posts)', issue: 'performance', desc: '预加载优化' },
        { original: 'arr.each{|x|\n    if x.valid?\n        res<<x\n    end\n}', optimized: 'res=arr.select(&:valid?)', issue: 'loop_optimization', desc: 'select方法' },
        { original: 'def fn\n    # long code\nend', optimized: 'def fn\n    short_code\nend', issue: 'complexity_reduce', desc: '方法拆分' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合Ruby编码规范`,
        language: 'ruby',
        issueType: p.issue
      });
    }
    
    console.log('生成 Scala 优化案例...');
    for (let i = 0; i < 20; i++) {
      const patterns = [
        { original: 'val res=new ArrayBuffer[Int]()\nfor(x<-arr){\n    if(x>0) res+=x\n}', optimized: 'val res=arr.filter(_>0)', issue: 'loop_optimization', desc: 'filter方法' },
        { original: 'user match{\n    case Some(u)=>u.name\n    case None=>\"\"\n}', optimized: 'user.map(_.name).getOrElse(\"\")', issue: 'code_style', desc: 'Option方法' },
        { original: 'val x=if(cond) \"p\" else \"n\"', optimized: 'val x=if(cond) \"p\" else \"n\"', issue: 'code_style', desc: 'if表达式' },
        { original: 'var x=10', optimized: 'val x=10', issue: 'code_style', desc: 'val不可变' },
        { original: 'for(i<-1 to 10; j<-1 to 10) yield i*j', optimized: 'for{i<-1 to 10; j<-1 to 10} yield i*j', issue: 'code_style', desc: 'for推导式' },
        { original: 'lazy val x=expensive()', optimized: 'lazy val x=expensive()', issue: 'performance', desc: '懒求值' },
        { original: 'val source=scala.io.Source.fromFile(\"a.txt\")\ntry{\n    source.mkString\n}finally{\n    source.close()\n}', optimized: 'scala.io.Source.fromFile(\"a.txt\").mkString', issue: 'resource_leak', desc: '自动关闭' },
        { original: 'val max=100', optimized: 'val MAX=100', issue: 'code_style', desc: '常量命名' },
        { original: 'if(cond) true else false', optimized: 'cond', issue: 'unnecessary_else', desc: '直接返回' },
        { original: 'arr.foreach(println)', optimized: 'arr.foreach(println)', issue: 'code_style', desc: '高阶函数' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，符合Scala编码规范`,
        language: 'scala',
        issueType: p.issue
      });
    }
    
    console.log('生成 SQL 优化案例...');
    for (let i = 0; i < 30; i++) {
      const patterns = [
        { original: 'SELECT * FROM user WHERE age>18;', optimized: 'SELECT id,name FROM user WHERE age>18;', issue: 'performance', desc: '禁止SELECT *' },
        { original: 'SELECT * FROM a WHERE id IN (SELECT id FROM b);', optimized: 'SELECT a.* FROM a JOIN b ON a.id=b.id;', issue: 'performance', desc: 'JOIN替代子查询' },
        { original: 'SELECT name FROM user ORDER BY id LIMIT 10;', optimized: 'SELECT name FROM user ORDER BY id LIMIT 10;', issue: 'performance', desc: 'LIMIT分页' },
        { original: 'SELECT * FROM log WHERE date>\'2026-01-01\';', optimized: 'SELECT * FROM log FORCE INDEX(idx_date) WHERE date>\'2026-01-01\';', issue: 'performance', desc: '使用索引' },
        { original: 'UPDATE user SET status=1 WHERE id=1;', optimized: 'UPDATE user SET status=1 WHERE id=1 LIMIT 1;', issue: 'performance', desc: 'LIMIT更新' },
        { original: 'SELECT * FROM t WHERE name="' + '\\$name' + '";', optimized: 'SELECT * FROM t WHERE name=?;', issue: 'security_risk', desc: '参数化查询' },
        { original: 'SELECT * FROM t ORDER BY id;', optimized: 'SELECT * FROM t;', issue: 'performance', desc: '删除冗余ORDER BY' },
        { original: 'BEGIN;\n-- long transaction\nCOMMIT;', optimized: 'BEGIN;\n-- short transaction\nCOMMIT;', issue: 'performance', desc: '事务拆分' },
        { original: 'CREATE TEMP TABLE tmp AS SELECT * FROM t;', optimized: 'CREATE TEMP TABLE tmp AS SELECT id,name FROM t;', issue: 'performance', desc: '临时表优化' },
        { original: 'SELECT * FROM t WHERE CAST(id AS CHAR)=\'123\';', optimized: 'SELECT * FROM t WHERE id=123;', issue: 'performance', desc: '避免隐式转换' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，提升SQL性能`,
        language: 'sql',
        issueType: p.issue
      });
    }
    
    console.log('生成 General 通用优化案例...');
    for (let i = 0; i < 20; i++) {
      const patterns = [
        { original: 'const x=100;', optimized: 'const MAX_VALUE=100;', issue: 'bad_naming', desc: '语义化命名' },
        { original: 'function big(){/* 500 lines */}', optimized: 'function small1(){}function small2(){}', issue: 'complexity_reduce', desc: '函数拆分' },
        { original: 'if(x){if(y){fn()}}', optimized: 'if(x&&y){fn()}', issue: 'complexity_reduce', desc: '条件合并' },
        { original: 'let unused=1;', optimized: '', issue: 'code_style', desc: '删除未使用变量' },
        { original: 'for(i=0;i<10;i++){write(data[i])}', optimized: 'batchWrite(data)', issue: 'io_optimize', desc: '批量操作' },
        { original: 'fn();fn();fn();', optimized: 'fn();', issue: 'duplicate_code', desc: '消除重复调用' },
        { original: 'let a=1;let b=2;', optimized: 'const a=1;const b=2;', issue: 'code_style', desc: '常量声明' },
        { original: 'let arr=[];for(i=0;i<100;i++){arr.push(i)}', optimized: 'let arr=new Array(100);for(i=0;i<100;i++){arr[i]=i}', issue: 'performance', desc: '预分配数组' },
        { original: 'f=open();use();', optimized: 'f=open();try{use();}finally{close();}', issue: 'resource_leak', desc: '资源释放' },
        { original: 'if(obj==null){return}fn(obj)', optimized: 'if(obj==null){return}fn(obj)', issue: 'null_check', desc: '提前返回' }
      ];
      const p = patterns[i % patterns.length];
      cases.push({
        originalCode: p.original,
        optimizedCode: p.optimized,
        explanation: `${p.desc}，通用代码优化`,
        language: 'general',
        issueType: p.issue
      });
    }
    
    console.log(`\n开始添加知识条目（${entries.length}条）...`);
    let entryCount = 0;
    for (const entry of entries) {
      try {
        await knowledgeBase.addEntry(entry.content, {
          type: entry.type,
          language: entry.language,
          tags: entry.tags,
          source: entry.source
        });
        entryCount++;
        if (entryCount % 100 === 0) {
          console.log(`已添加 ${entryCount} 条知识条目...`);
        }
      } catch (e) {
        console.warn(`添加条目失败: ${e.message}`);
      }
    }
    
    console.log(`\n开始添加优化案例（${cases.length}条）...`);
    let caseCount = 0;
    for (const c of cases) {
      try {
        await knowledgeBase.addCase(c.originalCode, c.optimizedCode, c.explanation, {
          language: c.language,
          issueType: c.issueType
        });
        caseCount++;
        if (caseCount % 50 === 0) {
          console.log(`已添加 ${caseCount} 条优化案例...`);
        }
      } catch (e) {
        console.warn(`添加案例失败: ${e.message}`);
      }
    }
    
    console.log(`\n扩充完成！添加了 ${entryCount} 条知识条目和 ${caseCount} 条优化案例`);
    
    const stats = await knowledgeBase.getStats();
    console.log('更新后的知识库统计:');
    console.log(JSON.stringify(stats, null, 2));
    
    console.log('\n导出SQL备份文件...');
    await exportSQL();
    
  } catch (error) {
    console.error('扩充知识库失败:', error);
    process.exit(1);
  }
}

async function exportSQL() {
  try {
    const fs = require('fs');
    const path = require('path');
    const mysql = require('mysql2/promise');
    const Database = require('better-sqlite3');
    
    const CONFIG_FILE = path.join(__dirname, 'data', 'database_connections.json');
    let entries = [];
    let cases = [];
    
    if (fs.existsSync(CONFIG_FILE)) {
      const connConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const defaultConnId = connConfig.defaultConnection;
      const defaultConn = connConfig.connections[defaultConnId];
      
      if (defaultConn && defaultConn.enabled && defaultConn.host) {
        console.log(`从MySQL导出...`);
        
        const pool = mysql.createPool({
          host: defaultConn.host,
          port: defaultConn.port,
          user: defaultConn.user,
          password: defaultConn.password,
          database: defaultConn.database,
          connectionLimit: defaultConn.connectionLimit
        });
        
        const [entriesResult] = await pool.query('SELECT * FROM kb_entries');
        const [casesResult] = await pool.query('SELECT * FROM kb_cases');
        
        entries = entriesResult;
        cases = casesResult;
        
        await pool.end();
      } else {
        console.log('从SQLite导出...');
        
        const dbPath = './database/code_optimizer.db';
        const absPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(path.join(__dirname, dbPath));
        const sqliteDb = new Database(absPath);
        
        entries = sqliteDb.prepare('SELECT * FROM kb_entries').all();
        cases = sqliteDb.prepare('SELECT * FROM kb_cases').all();
        
        sqliteDb.close();
      }
    } else {
      console.log('从SQLite导出...');
      
      const dbPath = './database/code_optimizer.db';
      const absPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(path.join(__dirname, dbPath));
      const sqliteDb = new Database(absPath);
      
      entries = sqliteDb.prepare('SELECT * FROM kb_entries').all();
      cases = sqliteDb.prepare('SELECT * FROM kb_cases').all();
      
      sqliteDb.close();
    }
    
    let sql = '-- === kb_entries ===\n';
    entries.forEach(e => {
      const content = e.content ? e.content.replace(/'/g, "''") : '';
      const tags = e.tags ? (typeof e.tags === 'string' ? e.tags.replace(/'/g, "''") : JSON.stringify(e.tags).replace(/'/g, "''")) : '[]';
      const source = e.source ? e.source.replace(/'/g, "''") : '';
      sql += `INSERT INTO kb_entries (id, content, content_type, language, tags, source, vector_json, created_at) VALUES ('${e.id}', '${content}', '${e.content_type}', '${e.language}', '${tags}', '${source}', '${e.vector_json || ''}', '${e.created_at}');\n`;
    });
    
    sql += '\n-- === kb_cases ===\n';
    cases.forEach(c => {
      const originalCode = c.original_code ? c.original_code.replace(/'/g, "''") : '';
      const optimizedCode = c.optimized_code ? c.optimized_code.replace(/'/g, "''") : '';
      const explanation = c.explanation ? c.explanation.replace(/'/g, "''") : '';
      sql += `INSERT INTO kb_cases (id, original_code, optimized_code, explanation, language, issue_type, vector_json, usage_count, rating, created_at) VALUES ('${c.id}', '${originalCode}', '${optimizedCode}', '${explanation}', '${c.language}', '${c.issue_type}', '${c.vector_json || ''}', ${c.usage_count || 0}, ${c.rating || 0}, '${c.created_at}');\n`;
    });
    
    fs.writeFileSync('knowledge_backup_v2.sql', sql, 'utf-8');
    console.log(`SQL备份完成！共 ${entries.length} 条知识条目，${cases.length} 条优化案例`);
  } catch (error) {
    console.error('导出SQL失败:', error);
  }
}

expandKnowledgeBase();