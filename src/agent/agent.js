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
const { selfUpdateManager } = require('../services/bootstrap/selfUpdateManager');
const { selfRepairManager } = require('../services/bootstrap/selfRepairManager');
const { rollbackManager } = require('../services/bootstrap/rollback');
const { systemMonitor } = require('../utils/systemMonitor');
const { selfSustainEngine } = require('../services/bootstrap/selfSustainEngine');
const { telemetry } = require('../utils/telemetry');
const { ruleEngine } = require('../services/bootstrap/ruleEngine');
const { analysisEngine } = require('../services/bootstrap/analysisEngine');
const { validator } = require('../services/bootstrap/validator');
const { sandboxManager } = require('../sandbox/sandboxManager');
const { safeResolvePath, validateToolName, sanitizeCommandInput, isCommandAllowed } = require('../utils/securityGuard');
const { getToolDefinitions } = require('./toolDefinitions');
const { createToolHandlers } = require('./toolHandlers');

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
      maxIssuesPerFile: 100,
      useSandbox: true
    };
    this.tools = this._initTools();
    this._toolHandlers = createToolHandlers(this);
    this.sandboxStatus = { mode: 'inactive' };
  }

  /**
   * 初始化可用工具列表
   */
  _initTools() {
    return getToolDefinitions();
  }

  /**
   * 执行工具调用
   */
  async executeTool(toolName, params = {}) {
    try {
      // 工具白名单校验
      const toolCheck = validateToolName(toolName);
      if (!toolCheck.valid) {
        return { success: false, message: toolCheck.error };
      }

      // 参数归一化：snake_case → camelCase 兼容
      const p = { ...params };
      Object.keys(p).forEach(key => {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (camelKey !== key && p[camelKey] === undefined) {
          p[camelKey] = p[key];
        }
      });

      const handler = this._toolHandlers[toolName];
      if (!handler) {
        return { success: false, message: `未知工具: ${toolName}` };
      }
      return await handler(p);
    } catch (error) {
      logger.error(`工具调用失败 [${toolName}]:`, error);
      return { success: false, message: error.message, error: error.stack };
    }
  }

  /**
   * 初始化Agent
   * @param {function} onSandboxProgress 沙箱服务启动进度回调 (serviceName, success, completed, total)
   */
  async init(onSandboxProgress) {
    if (this.config.useSandbox) {
      try {
        const result = await sandboxManager.init(onSandboxProgress);
        this.sandboxStatus = result;
        logger.info(`沙箱架构已启动，工作模式: ${result.mode}`);
      } catch (error) {
        logger.warn('沙箱架构初始化失败，使用传统模式:', error.message);
        this.sandboxStatus = { mode: 'fallback', error: error.message };
      }
    }

    await engine.init();
    await providerManager.init();
    await skillManager.init();
    systemMonitor.start();
    analysisEngine.start();
    selfSustainEngine.start();
    telemetry.recordEvent('agent_initialized', 'agent', { sandboxMode: this.sandboxStatus.mode }, 'info');
    logger.info(`Code Optimizer Agent 初始化完成 (沙箱模式: ${this.sandboxStatus.mode}, AI自持引擎已启动)`);
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
  async queryKnowledge(query, options = {}) {
    const cases = await knowledgeBase.searchCases(query, {
      language: options.language,
      issueType: options.issueType,
      topK: options.topK || 5
    }) || [];
    
    const entries = await knowledgeBase.searchEntries(query, {
      language: options.language,
      topK: options.topK || 5
    }) || [];
    
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
    const entries = await knowledgeBase.searchEntries(query, options) || [];
    const cases = await knowledgeBase.searchCases(query, options) || [];
    const results = [...entries, ...cases].slice(0, options.limit || 10);
    return { success: true, results };
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
   * @param {string} mode - 同步模式: 'merge'(默认)合并更新, 'overwrite'覆盖, 'append'追加
   */
  async syncKnowledgeToCloud(mode = 'merge') {
    return await knowledgeBase.syncToCloud(mode);
  }

  /**
   * 从云端同步知识库
   */
  async syncKnowledgeFromCloud() {
    return await knowledgeBase.syncFromCloud();
  }

  /**
   * 查找重复的知识条目
   */
  async findDuplicateEntries() {
    return await knowledgeBase.findDuplicateEntries();
  }

  /**
   * 删除重复的知识条目
   */
  async removeDuplicates() {
    return await knowledgeBase.removeDuplicates();
  }

  /**
   * 重置知识库
   * @param {boolean} confirm - 确认重置操作
   */
  async resetKnowledge(confirm = false) {
    return await knowledgeBase.resetKnowledgeBase(confirm);
  }

  /**
   * 测试云端连接
   */
  async testCloudConnection() {
    return await knowledgeBase.testCloudConnection();
  }

  /**
   * 切换到指定数据库连接
   */
  async switchDatabaseConnection(connectionConfig) {
    return await knowledgeBase.switchDatabaseConnection(connectionConfig);
  }

  /**
   * 使用自定义配置测试连接
   */
  async testConnectionWithConfig(connectionConfig) {
    return await knowledgeBase.testConnectionWithConfig(connectionConfig);
  }

  /**
   * 获取当前数据库连接ID
   */
  getCurrentDatabaseConnectionId() {
    return knowledgeBase.getCurrentConnectionId();
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
      historyCount: this.taskHistory.length,
      health: systemMonitor.getHealthStatus(),
      sandbox: sandboxManager.getStatus()
    };
  }

  getSandboxStatus() {
    return sandboxManager.getStatus();
  }

  async enableSandbox() {
    const result = await sandboxManager.enableSandbox();
    this.config.useSandbox = sandboxManager.isSandboxAvailable();
    return result;
  }

  async disableSandbox() {
    const result = await sandboxManager.disableSandbox();
    this.config.useSandbox = false;
    return result;
  }

  async hotReloadService(serviceName, newVersion) {
    return await sandboxManager.hotReloadService(serviceName, newVersion);
  }

  getServiceStatus(serviceName) {
    return sandboxManager.getServiceStatus(serviceName);
  }

  getHealthStatus() {
    return systemMonitor.getHealthStatus();
  }

  getHealthHistory() {
    return systemMonitor.getHealthHistory();
  }

  async runHealthCheck() {
    await systemMonitor.runHealthCheck();
    return systemMonitor.getHealthStatus();
  }

  /**
   * AI自持引擎控制
   */
  startSelfSustain() {
    selfSustainEngine.start();
    telemetry.recordEvent('self_sustain_started', 'agent', {}, 'info');
    return selfSustainEngine.getStatus();
  }

  stopSelfSustain() {
    selfSustainEngine.stop();
    telemetry.recordEvent('self_sustain_stopped', 'agent', {}, 'info');
    return selfSustainEngine.getStatus();
  }

  getSustainStatus() {
    return selfSustainEngine.getStatus();
  }

  getSustainDashboard() {
    return selfSustainEngine.getDashboard();
  }

  getSustainStats() {
    return selfSustainEngine.getStats();
  }

  async triggerAIAnalysis(focus = 'general') {
    return await selfSustainEngine.triggerManualAnalysis(focus);
  }

  getRules() {
    return ruleEngine.getRules();
  }

  getRuleHistory() {
    return ruleEngine.getRuleHistory();
  }

  addRule(rule) {
    return ruleEngine.addRule(rule);
  }

  removeRule(ruleId) {
    return ruleEngine.removeRule(ruleId);
  }

  getTelemetry() {
    return telemetry.collect();
  }

  getTelemetryMetrics() {
    return telemetry.getMetrics();
  }

  getValidationStats() {
    return validator.getValidationStats();
  }

  getAnalysisHistory() {
    return analysisEngine.getAnalysisHistory();
  }

  getCycleHistory() {
    return selfSustainEngine.getCycleHistory();
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
1. 与用户自然友好地交流：问候、闲聊都可以正常回应，语气亲切简洁
2. 回答代码相关的问题
3. 提供代码优化建议
4. 根据用户需求调用智能体的功能
5. 用户的话题明显超出代码与技术范围时，用一两句话友好回应，说明这不在你的擅长范围内，并自然地把话题引导回代码相关方向（例如请他描述遇到的报错或想优化的代码），不展开超范围话题的实质内容

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
      const { getDatabase } = require('../utils/database');
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

async function autoRepairHandler(error) {
  const errorType = selfRepairManager.classifyError(error);

  if (errorType === 'runtime') {
    const isCodeIssue = error.message.includes('未使用') ||
                       error.message.includes('缺少注释') ||
                       error.message.includes('魔法数字') ||
                       error.message.includes('深度嵌套') ||
                       error.message.includes('函数过长') ||
                       error.message.includes('重复代码');
    if (isCodeIssue) {
      logger.debug('代码分析问题，不触发自动修复:', error.message);
      return;
    }

    const harmlessErrors = [
      'process.stdout.flush is not a function',
      'process.stderr.flush is not a function',
      'stdout.flush is not a function',
      'stderr.flush is not a function',
      'Cannot read properties of undefined',
      'Cannot read properties of null'
    ];

    if (harmlessErrors.some(h => error.message.includes(h))) {
      logger.debug('无害的运行时错误，不触发自动修复:', error.message);
      return;
    }
  }

  logger.warn(`检测到系统错误 [${errorType}]: ${error.message}`);

  // 第一层：快策略（database / network / file_system / memory）走原有 detectAndRepair
  const fastCategories = ['database', 'network', 'file_system', 'memory'];
  if (fastCategories.includes(errorType)) {
    try {
      const repairResult = await selfRepairManager.detectAndRepair(error, {
        autoConfirm: true,
        skipSandbox: true
      });
      if (repairResult.success) {
        logger.info(`自动修复成功(快策略): ${repairResult.strategy || repairResult.message || ''}`);
        return;
      }
      logger.warn(`快策略失败，降级到 AI 修复管道: ${repairResult.error}`);
      // 失败则继续往下走第二层
    } catch (repairError) {
      logger.error(`快策略过程出错，降级到 AI 修复管道: ${repairError.message}`);
    }
  }

  // 第二层：AI 修复管道（runtime/dependency/configuration + 兜底快策略失败）
  // 包含：AI 生成修复 → 沙箱试运行 → 门控确认 → 补丁写入 → 热替换
  try {
    const { autoFixCoordinator } = require('../services/bootstrap/autoFixCoordinator');
    const coordResult = await autoFixCoordinator.trigger(error, { errorType });
    if (coordResult.success) {
      logger.info(`AI修复管道成功: 服务=${coordResult.affectedService}, 迭代=${coordResult.iterations}轮, ${coordResult.summary || ''}`);
    } else if (!coordResult.skipped) {
      logger.warn(`AI修复管道未成功: ${coordResult.error || coordResult.reason || coordResult.gateReason || '未知'}`);
    }
  } catch (pipelineError) {
    logger.error(`AI修复管道异常: ${pipelineError.message}`);
  }
}

process.on('uncaughtException', async (error) => {
  logger.error('未捕获异常:', error);
  await autoRepairHandler(error);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason);
  if (reason instanceof Error) {
    await autoRepairHandler(reason);
  }
});

module.exports = {
  CodeOptimizerAgent,
  agent,
  AgentState,
  autoRepairHandler
};
