/**
 * Code Optimizer Agent 核心
 * 智能体主逻辑：状态管理、任务调度、结果处理
 */

const { engine } = require('../engine/dualModeEngine');
const { providerManager } = require('../services/llm/providers');
const { knowledgeBase } = require('../services/vector/knowledgeBase');
const { logger } = require('../utils/logger');
const { getDatabase } = require('../utils/database');
const { generateUUID, getFileLanguage } = require('../utils/helpers');
const { skillManager } = require('../skills');

/**
 * Agent状态
 */
const AgentState = {
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  OPTIMIZING: 'optimizing',
  LEARNING: 'learning',
  ERROR: 'error'
};

/**
 * 代码优化智能体
 */
class CodeOptimizerAgent {
  constructor() {
    this.state = AgentState.IDLE;
    this.currentTask = null;
    this.taskHistory = [];
    this.chatHistory = [];
    this.config = {
      mode: 'auto',
      autoSave: true,
      maxIssuesPerFile: 100
    };
    this.tools = this._initTools();
  }

  /**
   * 初始化可用工具列表
   */
  _initTools() {
    return {
      analyze_file: {
        name: 'analyze_file',
        description: '分析单个文件的代码缺陷和问题',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: '要分析的文件路径'
            }
          },
          required: ['filePath']
        }
      },
      scan_project: {
        name: 'scan_project',
        description: '扫描整个项目目录，检测代码问题',
        parameters: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: '项目目录路径'
            },
            maxFiles: {
              type: 'number',
              description: '最大扫描文件数，默认100'
            }
          },
          required: ['projectPath']
        }
      },
      optimize_code: {
        name: 'optimize_code',
        description: '优化给定的代码片段，提供优化后的代码和说明',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: '要优化的代码'
            },
            language: {
              type: 'string',
              description: '代码语言，如javascript、python、java等'
            }
          },
          required: ['code']
        }
      },
      search_knowledge: {
        name: 'search_knowledge',
        description: '搜索知识库中的相关知识和最佳实践',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词'
            },
            limit: {
              type: 'number',
              description: '返回结果数量，默认10'
            }
          },
          required: ['query']
        }
      },
      get_status: {
        name: 'get_status',
        description: '获取智能体当前状态和配置信息',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      get_providers: {
        name: 'get_providers',
        description: '获取所有可用的LLM提供商列表',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      switch_provider: {
        name: 'switch_provider',
        description: '切换当前使用的LLM提供商',
        parameters: {
          type: 'object',
          properties: {
            providerName: {
              type: 'string',
              description: '提供商名称，如deepseek、zhipu、openai等'
            }
          },
          required: ['providerName']
        }
      },
      clear_history: {
        name: 'clear_history',
        description: '清空聊天历史记录',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      get_skills: {
        name: 'get_skills',
        description: '获取所有可用的技能列表',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      fix_file: {
        name: 'fix_file',
        description: '分析文件问题并自动修复，将优化后的代码直接写入文件',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: '要修复的文件路径'
            },
            createBackup: {
              type: 'boolean',
              description: '是否创建备份文件，默认true'
            }
          },
          required: ['filePath']
        }
      },
      apply_fix: {
        name: 'apply_fix',
        description: '将优化后的代码应用到指定文件，直接替换原内容',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: '文件路径'
            },
            optimizedCode: {
              type: 'string',
              description: '优化后的完整代码内容'
            },
            createBackup: {
              type: 'boolean',
              description: '是否创建备份，默认true'
            }
          },
          required: ['filePath', 'optimizedCode']
        }
      }
    };
  }

  /**
   * 执行工具调用
   */
  async executeTool(toolName, params = {}) {
    try {
      const p = { ...params };
      Object.keys(p).forEach(key => {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (camelKey !== key && p[camelKey] === undefined) {
          p[camelKey] = p[key];
        }
      });

      switch (toolName) {
        case 'analyze_file': {
          const filePath = p.filePath || p.path;
          if (!filePath || typeof filePath !== 'string') {
            return { success: false, message: '文件路径不能为空' };
          }
          const fs = require('fs');
          const path = require('path');
          const resolvedPath = path.resolve(filePath);
          
          if (!fs.existsSync(resolvedPath)) {
            const altPath = resolvedPath + '.java';
            if (fs.existsSync(altPath)) {
              return await this.analyzeFile(altPath);
            }
            const dirPath = path.dirname(resolvedPath);
            const fileName = path.basename(resolvedPath);
            const files = fs.readdirSync(dirPath).filter(f => 
              f.toLowerCase().includes(fileName.toLowerCase().replace('.java', ''))
            );
            if (files.length > 0) {
              const matchedPath = path.join(dirPath, files[0]);
              return await this.analyzeFile(matchedPath);
            }
            return { success: false, message: `文件不存在: ${resolvedPath}` };
          }
          return await this.analyzeFile(resolvedPath);
        }
        
        case 'scan_project': {
          const projectPath = p.projectPath || p.path || p.dir;
          if (!projectPath || typeof projectPath !== 'string') {
            return { success: false, message: '项目路径不能为空' };
          }
          const fs = require('fs');
          const path = require('path');
          const resolvedPath = path.resolve(projectPath);
          
          if (!fs.existsSync(resolvedPath)) {
            return { success: false, message: `项目路径不存在: ${resolvedPath}` };
          }
          return await this.analyzeProject(resolvedPath, {
            maxFiles: p.maxFiles || p.limit || 100
          });
        }
        
        case 'optimize_code':
          if (!p.code || typeof p.code !== 'string') {
            return { success: false, message: '代码内容不能为空' };
          }
          return await this.optimize(p.code, p.language || 'javascript');
        
        case 'search_knowledge':
          if (!p.query || typeof p.query !== 'string') {
            return { success: false, message: '搜索关键词不能为空' };
          }
          return await this.searchKnowledge(p.query, {
            limit: p.limit || 10
          });
        
        case 'get_status':
          return this.getStatus();
        
        case 'get_providers':
          return { providers: this.getProviders() };
        
        case 'switch_provider':
          const providerName = p.providerName || p.name;
          if (!providerName) {
            return { success: false, message: '提供商名称不能为空' };
          }
          return await this.switchProvider(providerName);
        
        case 'clear_history':
          this.clearChatHistory();
          return { success: true, message: '聊天历史已清空' };
        
        case 'get_skills':
          return { skills: this.getSkills() };
        
        case 'fix_file': {
          const fs = require('fs');
          const path = require('path');
          const filePath = p.filePath || p.path;
          if (!filePath || typeof filePath !== 'string') {
            return { success: false, message: '文件路径不能为空' };
          }
          
          const resolvedPath = path.resolve(filePath);
          if (!fs.existsSync(resolvedPath)) {
            return { success: false, message: `文件不存在: ${resolvedPath}` };
          }
          
          const originalCode = fs.readFileSync(resolvedPath, 'utf-8');
          const language = getFileLanguage(resolvedPath);
          
          const analyzeResult = await this.analyzeFile(resolvedPath);
          if (!analyzeResult.success) {
            return analyzeResult;
          }
          
          if (analyzeResult.issues && analyzeResult.issues.length === 0) {
            return { success: true, message: '文件没有发现问题，无需修复', filePath: resolvedPath };
          }
          
          const provider = providerManager.getActiveProvider();
          if (!provider) {
            return { success: false, message: '未配置活跃的LLM提供商' };
          }
          
          const optimizePrompt = `请根据以下问题列表，对代码进行修复和优化。直接返回优化后的完整代码，不要返回任何解释或建议。

文件路径: ${resolvedPath}
语言: ${language}

原始代码:
\`\`\`${language}
${originalCode}
\`\`\`

发现的问题:
${JSON.stringify(analyzeResult.issues, null, 2)}

要求:
1. 直接修复所有问题
2. 保持代码结构和功能不变
3. 只返回优化后的完整代码，不要任何解释`;

          const optimizeResult = await provider.chat([
            { role: 'user', content: optimizePrompt }
          ]);
          
          const optimizedCode = optimizeResult.content
            .replace(/\`\`\`[a-z]*\n?/gi, '')
            .replace(/\`\`\`/g, '')
            .trim();
          
          const createBackup = p.createBackup !== false;
          if (createBackup) {
            const backupPath = resolvedPath + '.bak';
            fs.writeFileSync(backupPath, originalCode, 'utf-8');
          }
          
          fs.writeFileSync(resolvedPath, optimizedCode, 'utf-8');
          
          return {
            success: true,
            message: '文件已修复并保存',
            filePath: resolvedPath,
            issuesFixed: analyzeResult.issues.length,
            issues: analyzeResult.issues,
            backupCreated: createBackup
          };
        }
        
        case 'apply_fix': {
          const fs = require('fs');
          const path = require('path');
          const filePath = p.filePath || p.path;
          const optimizedCode = p.optimizedCode || p.code;
          
          if (!filePath || typeof filePath !== 'string') {
            return { success: false, message: '文件路径不能为空' };
          }
          if (!optimizedCode || typeof optimizedCode !== 'string') {
            return { success: false, message: '优化后的代码不能为空' };
          }
          
          const resolvedPath = path.resolve(filePath);
          if (!fs.existsSync(resolvedPath)) {
            return { success: false, message: `文件不存在: ${resolvedPath}` };
          }
          
          const originalCode = fs.readFileSync(resolvedPath, 'utf-8');
          const createBackup = p.createBackup !== false;
          
          if (createBackup) {
            const backupPath = resolvedPath + '.bak';
            fs.writeFileSync(backupPath, originalCode, 'utf-8');
          }
          
          fs.writeFileSync(resolvedPath, optimizedCode, 'utf-8');
          
          return {
            success: true,
            message: '代码已应用到文件',
            filePath: resolvedPath,
            backupCreated: createBackup,
            backupPath: createBackup ? resolvedPath + '.bak' : null
          };
        }
        
        default:
          return { success: false, message: `未知工具: ${toolName}` };
      }
    } catch (error) {
      logger.error(`工具调用失败 [${toolName}]:`, error);
      return { success: false, message: error.message, error: error.stack };
    }
  }

  /**
   * 初始化Agent
   */
  async init() {
    await engine.init();
    await providerManager.init();
    await skillManager.init();
    logger.info('Code Optimizer Agent 初始化完成');
    return this.getStatus();
  }

  /**
   * 配置Agent
   */
  configure(options) {
    Object.assign(this.config, options);
    
    if (options.mode) {
      engine.setMode(options.mode);
    }
    
    // 配置LLM提供商
    if (options.providers) {
      Object.entries(options.providers).forEach(([name, config]) => {
        providerManager.register(name, config);
      });
    }
    
    // 设置活跃提供商
    if (options.activeProvider) {
      providerManager.setActiveProvider(options.activeProvider);
    }
    
    logger.info('Agent配置已更新');
    return this.getStatus();
  }

  /**
   * 分析单个文件
   */
  async analyzeFile(filePath, options = {}) {
    this.setState(AgentState.ANALYZING);
    this.currentTask = { type: 'analyze_file', filePath, id: generateUUID() };
    
    try {
      const result = await engine.analyzeFile(filePath, options);
      
      if (result.success && this.config.autoSave) {
        this.saveTaskResult(this.currentTask, result);
      }
      
      this.addToHistory(this.currentTask, result);
      this.setState(AgentState.IDLE);
      
      return result;
    } catch (error) {
      this.setState(AgentState.ERROR);
      logger.error('分析文件失败:', error);
      throw error;
    }
  }

  /**
   * 分析代码片段
   */
  async analyzeSnippet(code, language = 'javascript', options = {}) {
    this.setState(AgentState.ANALYZING);
    this.currentTask = { type: 'analyze_snippet', language, id: generateUUID() };
    
    try {
      const result = await engine.analyzeSnippet(code, language, options);
      
      this.addToHistory(this.currentTask, result);
      this.setState(AgentState.IDLE);
      
      return result;
    } catch (error) {
      this.setState(AgentState.ERROR);
      logger.error('分析代码片段失败:', error);
      throw error;
    }
  }

  /**
   * 分析整个项目
   */
  async analyzeProject(projectPath, options = {}) {
    this.setState(AgentState.ANALYZING);
    this.currentTask = { type: 'analyze_project', projectPath, id: generateUUID() };
    
    try {
      const result = await engine.analyzeProject(projectPath, options);
      
      if (result.success && this.config.autoSave) {
        this.saveTaskResult(this.currentTask, result);
      }
      
      this.addToHistory(this.currentTask, result);
      this.setState(AgentState.IDLE);
      
      return result;
    } catch (error) {
      this.setState(AgentState.ERROR);
      logger.error('分析项目失败:', error);
      throw error;
    }
  }

  /**
   * 优化单个代码片段（直接优化）
   */
  async optimize(code, language = 'javascript', context = {}) {
    this.setState(AgentState.OPTIMIZING);
    this.currentTask = { type: 'optimize', language, id: generateUUID() };
    
    try {
      const issue = {
        codeSnippet: code,
        language,
        issueType: context.issueType || 'general',
        message: context.message || '代码优化'
      };
      
      const mode = engine.getActualMode();
      const result = await engine.optimizeIssue(issue, code, mode);
      
      this.addToHistory(this.currentTask, result);
      this.setState(AgentState.IDLE);
      
      return result;
    } catch (error) {
      this.setState(AgentState.ERROR);
      logger.error('优化失败:', error);
      throw error;
    }
  }

  /**
   * 添加知识到本地知识库
   */
  async learn(content, options = {}) {
    this.setState(AgentState.LEARNING);
    
    try {
      let id;
      if (options.type === 'case' && options.originalCode && options.optimizedCode) {
        id = knowledgeBase.addCase(
          options.originalCode,
          options.optimizedCode,
          content,
          {
            language: options.language,
            issueType: options.issueType
          }
        );
      } else {
        id = knowledgeBase.addEntry(content, {
          type: options.type || 'general',
          language: options.language,
          tags: options.tags,
          source: options.source
        });
      }
      
      this.setState(AgentState.IDLE);
      return { success: true, id, message: '知识已添加到本地知识库' };
    } catch (error) {
      this.setState(AgentState.ERROR);
      logger.error('学习失败:', error);
      throw error;
    }
  }

  /**
   * 查询知识库
   */
  queryKnowledge(query, options = {}) {
    const cases = knowledgeBase.searchCases(query, {
      language: options.language,
      issueType: options.issueType,
      topK: options.topK || 5
    });
    
    const entries = knowledgeBase.searchEntries(query, {
      language: options.language,
      topK: options.topK || 5
    });
    
    return {
      cases,
      entries,
      total: cases.length + entries.length
    };
  }

  /**
   * 切换LLM提供商
   */
  async switchProvider(providerName) {
    try {
      await providerManager.setActiveProvider(providerName);
      return {
        success: true,
        provider: providerName,
        message: `已切换至 ${providerName} 提供商`
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 搜索知识库
   */
  async searchKnowledge(query, options = {}) {
    const entries = knowledgeBase.searchEntries(query, options);
    const cases = knowledgeBase.searchCases(query, options);
    return [...entries, ...cases].slice(0, options.limit || 10);
  }

  /**
   * 获取知识库统计
   */
  getKnowledgeStats() {
    return knowledgeBase.getStats();
  }

  /**
   * 导出知识库
   */
  exportKnowledge(filePath) {
    const path = require('path');
    const exportPath = filePath || path.join(__dirname, '../../data/knowledge-export.json');
    return knowledgeBase.exportToFile(exportPath);
  }

  /**
   * 导入知识库
   */
  importKnowledge(filePath, options = {}) {
    return knowledgeBase.importFromFile(filePath, options);
  }

  /**
   * 同步知识库到云端
   */
  async syncKnowledgeToCloud() {
    return await knowledgeBase.syncToCloud();
  }

  /**
   * 从云端同步知识库
   */
  async syncKnowledgeFromCloud() {
    return await knowledgeBase.syncFromCloud();
  }

  /**
   * 测试云端连接
   */
  async testCloudConnection() {
    return await knowledgeBase.testCloudConnection();
  }

  /**
   * 获取可用提供商列表
   */
  getProviders() {
    return providerManager.getAvailableProviders();
  }

  /**
   * 刷新提供商状态
   */
  async refreshProviders() {
    return await providerManager.refreshProviderStatus();
  }

  /**
   * 注册新的LLM提供商（存入数据库）
   */
  async registerProvider(name, config) {
    try {
      // 将 API Key 存入数据库
      if (config && config.apiKey) {
        const { execute, queryOne } = require('../utils/database');
        
        // 检查是否已存在
        const existing = await queryOne(
          'SELECT id FROM llm_api_keys WHERE provider_name = ?',
          [name.toLowerCase()]
        );
        
        if (existing) {
          // 更新现有记录
          await execute(
            'UPDATE llm_api_keys SET api_key = ?, api_url = ?, model_name = ?, is_active = 1 WHERE provider_name = ?',
            [config.apiKey, config.baseURL || null, config.model || null, name.toLowerCase()]
          );
        } else {
          // 插入新记录
          await execute(
            'INSERT INTO llm_api_keys (provider_name, api_key, api_url, model_name, is_active, priority) VALUES (?, ?, ?, ?, 1, 10)',
            [name.toLowerCase(), config.apiKey, config.baseURL || null, config.model || null]
          );
        }
        
        // 清除缓存，强制重新读取
        const provider = providerManager.providers.get(name.toLowerCase());
        if (provider) {
          provider.cachedKey = null;
        }
        
        // 刷新提供商状态缓存
        await providerManager.refreshProviderStatus();
        
        return {
          success: true,
          provider: name,
          message: `已注册 ${name} 提供商并保存 API Key`
        };
      }
      
      // 只注册不存 Key
      providerManager.register(name, {});
      
      // 刷新提供商状态缓存
      await providerManager.refreshProviderStatus();
      
      return {
        success: true,
        provider: name,
        message: `已注册 ${name} 提供商`
      };
    } catch (error) {
      logger.error('注册提供商失败:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 更新提供商配置（如API Key）
   */
  async updateProviderConfig(name, config) {
    try {
      // 如果更新 API Key，存入数据库
      if (config && config.apiKey) {
        const { execute } = require('../utils/database');
        
        await execute(
          'UPDATE llm_api_keys SET api_key = ?, api_url = ?, model_name = ? WHERE provider_name = ?',
          [config.apiKey, config.baseURL || null, config.model || null, name.toLowerCase()]
        );
        
        // 清除缓存
        const provider = providerManager.providers.get(name.toLowerCase());
        if (provider) {
          provider.cachedKey = null;
        }
      }
      
      providerManager.updateProviderConfig(name, config);
      
      // 刷新提供商状态缓存
      await providerManager.refreshProviderStatus();
      
      return {
        success: true,
        message: `已更新 ${name} 配置`
      };
    } catch (error) {
      logger.error('更新配置失败:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 设置工作模式
   */
  setMode(mode) {
    engine.setMode(mode);
    this.config.mode = mode;
    return {
      success: true,
      mode,
      actualMode: engine.getActualMode()
    };
  }

  /**
   * 获取所有可用技能
   */
  getSkills() {
    return skillManager.getAllSkills();
  }

  /**
   * 获取已启用的技能
   */
  getEnabledSkills() {
    return skillManager.getEnabledSkills();
  }

  /**
   * 执行技能
   */
  async executeSkill(skillName, context = {}) {
    return await skillManager.executeSkill(skillName, context);
  }

  /**
   * 启用技能
   */
  enableSkill(skillName) {
    return skillManager.enableSkill(skillName);
  }

  /**
   * 禁用技能
   */
  disableSkill(skillName) {
    return skillManager.disableSkill(skillName);
  }

  /**
   * 获取Agent状态
   */
  getStatus() {
    return {
      state: this.state,
      currentTask: this.currentTask,
      config: this.config,
      engine: engine.getStatus(),
      historyCount: this.taskHistory.length
    };
  }

  /**
   * 获取任务历史
   */
  getHistory(limit = 10) {
    return this.taskHistory.slice(-limit);
  }

  /**
   * 与AI聊天（支持工具调用）
   */
  async chat(message, options = {}) {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      throw new Error('未配置活跃的LLM提供商，请先在提供商管理中配置');
    }

    this.chatHistory.push({ role: 'user', content: message });

    const toolsList = Object.values(this.tools).map(t => 
      `- ${t.name}: ${t.description}`
    ).join('\n');

    const systemPrompt = `你是一个专业的代码优化助手，精通多种编程语言和代码优化技术。
你可以：
1. 回答代码相关的问题
2. 提供代码优化建议
3. 根据用户需求调用智能体的功能

可用功能列表：
${toolsList}

当用户需要调用功能时，请使用以下格式输出：
<function_call>
{
  "function": "功能名称",
  "params": {参数对象}
}
</function_call>

如果不需要调用功能，直接回答用户问题即可。
调用工具后，我会返回工具执行结果，你可以根据结果继续回答。
一次可以调用多个工具，每个工具用一个 <function_call> 块。`;

    const maxIterations = options.maxIterations || 5;
    const onProgress = options.onProgress;
    let iteration = 0;
    let finalResult = null;
    let toolCalls = [];

    if (onProgress) {
      onProgress({ phase: 'thinking', iteration: 0, maxIterations, status: '开始分析用户请求...' });
    }

    while (iteration < maxIterations) {
      iteration++;
      
      if (onProgress) {
        onProgress({ phase: 'thinking', iteration, maxIterations, status: `正在思考第 ${iteration}/${maxIterations} 轮...` });
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        ...this.chatHistory.slice(-20)
      ];

      const result = await provider.chat(messages, options);
      const content = result.content;

      const functionCalls = this._parseFunctionCalls(content);

      if (functionCalls.length === 0) {
        if (onProgress) {
          onProgress({ phase: 'done', iteration, maxIterations, status: '回答完成' });
        }
        this.chatHistory.push({ role: 'assistant', content });
        finalResult = result;
        break;
      }

      this.chatHistory.push({ role: 'assistant', content });

      if (onProgress) {
        onProgress({ phase: 'tools', iteration, maxIterations, status: `执行 ${functionCalls.length} 个工具调用...`, toolCount: functionCalls.length });
      }

      for (let i = 0; i < functionCalls.length; i++) {
        const call = functionCalls[i];
        toolCalls.push(call);
        
        if (onProgress) {
          onProgress({ phase: 'tool', iteration, maxIterations, status: `执行工具: ${call.function}`, toolIndex: i + 1, toolCount: functionCalls.length });
        }
        
        const toolResult = await this.executeTool(call.function, call.params);
        
        const toolMessage = {
          role: 'user',
          content: `工具执行结果 [${call.function}]:\n${JSON.stringify(toolResult, null, 2)}`
        };
        
        this.chatHistory.push(toolMessage);
      }

      if (iteration >= maxIterations) {
        if (onProgress) {
          onProgress({ phase: 'done', iteration, maxIterations, status: '已达到最大迭代次数' });
        }
        finalResult = result;
        break;
      }
    }

    return {
      ...finalResult,
      toolCalls: toolCalls,
      iterations: iteration
    };
  }

  /**
   * 解析函数调用
   */
  _parseFunctionCalls(content) {
    const calls = [];
    const regex = /<function_call>\s*([\s\S]*?)\s*<\/function_call>/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);
        calls.push({
          function: parsed.function,
          params: parsed.params || {}
        });
      } catch (e) {
        logger.debug('解析函数调用失败:', e.message);
      }
    }

    return calls;
  }

  /**
   * 清空聊天历史
   */
  clearChatHistory() {
    this.chatHistory = [];
  }

  /**
   * 设置状态
   */
  setState(state) {
    this.state = state;
    logger.info(`Agent状态: ${state}`);
  }

  /**
   * 添加任务到历史
   */
  addToHistory(task, result) {
    this.taskHistory.push({
      task,
      result: {
        success: result.success,
        totalIssues: result.totalIssues,
        mode: result.mode,
        durationMs: result.durationMs
      },
      timestamp: new Date().toISOString()
    });
    
    // 限制历史记录数量
    if (this.taskHistory.length > 100) {
      this.taskHistory = this.taskHistory.slice(-50);
    }
  }

  /**
   * 保存任务结果到数据库
   */
  saveTaskResult(task, result) {
    try {
      const db = getDatabase();
      
      // 创建扫描任务记录
      const taskStmt = db.prepare(`
        INSERT INTO scan_task (project_id, task_name, scan_mode, scan_type, 
                               target_path, file_count, issue_count, duration_ms, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const taskResult = taskStmt.run(
        null,
        task.type,
        result.mode,
        task.type === 'analyze_project' ? 'full_project' : 'single_file',
        task.filePath || task.projectPath || 'snippet',
        result.totalFiles || 1,
        result.totalIssues || 0,
        result.durationMs || 0,
        'completed'
      );
      
      const taskId = taskResult.lastInsertRowid;
      
      // 保存代码缺陷
      if (result.issues && result.issues.length > 0) {
        const issueStmt = db.prepare(`
          INSERT INTO code_issue (task_id, file_path, file_name, language, issue_type,
                                  severity, message, suggestion, line_start, code_snippet)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        result.issues.forEach(issue => {
          issueStmt.run(
            taskId,
            issue.filePath || 'snippet',
            issue.fileName || 'snippet',
            issue.language || 'unknown',
            issue.issueType,
            issue.severity,
            issue.message,
            issue.suggestion || '',
            issue.lineStart || 1,
            issue.codeSnippet || ''
          );
        });
      }
      
      logger.info(`任务结果已保存: ${taskId}`);
    } catch (error) {
      logger.error('保存任务结果失败:', error);
    }
  }
}

// 单例实例
const agent = new CodeOptimizerAgent();

module.exports = {
  CodeOptimizerAgent,
  agent,
  AgentState
};
