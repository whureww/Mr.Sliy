const { knowledgeBase } = require('../../services/vector/knowledgeBase');

class KnowledgeService {
  constructor(context) {
    this.name = context.name;
    this.version = context.version;
    this.logger = context.logger;
    this.postMessage = context.postMessage;
    this.isInitialized = false;
    this.queryCount = 0;
    this.addCount = 0;
    this.errorCount = 0;
  }

  async init() {
    this.logger.info(`[${this.name}] 知识库服务初始化中...`);
    
    try {
      await knowledgeBase.init();
      knowledgeBase.seedDefaultKnowledge();
      
      this.isInitialized = true;
      
      const stats = knowledgeBase.getStats();
      this.logger.info(`[${this.name}] 知识库初始化完成: ${stats.totalEntries} 条目, ${stats.totalCases} 案例`);
    } catch (error) {
      this.logger.error(`[${this.name}] 知识库初始化失败: ${error.message}`);
      throw error;
    }
  }

  async search(params) {
    const { query, topK = 10, type = 'all' } = params;
    this.queryCount++;
    
    try {
      let results = [];
      
      if (type === 'entries' || type === 'all') {
        const entries = await knowledgeBase.searchEntries(query, { topK });
        results = results.concat(entries || []);
      }
      
      if (type === 'cases' || type === 'all') {
        const cases = await knowledgeBase.searchCases(query, { topK });
        results = results.concat(cases || []);
      }
      
      return { query, results, totalResults: results.length };
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 搜索失败: ${error.message}`);
      throw error;
    }
  }

  async addEntry(params) {
    const { content, type, language, tags, source } = params;
    this.addCount++;
    
    try {
      const id = knowledgeBase.addEntry(content, { type, language, tags, source });
      return { id, success: true };
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 添加条目失败: ${error.message}`);
      throw error;
    }
  }

  async addCase(params) {
    const { originalCode, optimizedCode, description, language, issueType } = params;
    this.addCount++;
    
    try {
      const id = knowledgeBase.addCase(originalCode, optimizedCode, description, {
        language,
        issueType
      });
      return { id, success: true };
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 添加案例失败: ${error.message}`);
      throw error;
    }
  }

  async getStats(params) {
    return knowledgeBase.getStats();
  }

  async exportKnowledge(params) {
    const { filePath } = params;
    return knowledgeBase.exportToFile(filePath);
  }

  async importKnowledge(params) {
    const { filePath, options } = params;
    return knowledgeBase.importFromFile(filePath, options || {});
  }

  async syncToCloud(params) {
    const { mode = 'merge' } = params || {};
    return knowledgeBase.syncToCloud(mode);
  }

  async syncFromCloud(params) {
    return knowledgeBase.syncFromCloud();
  }

  async resetKnowledge(params) {
    const { confirm = false } = params || {};
    return knowledgeBase.resetKnowledgeBase(confirm);
  }

  async findDuplicates(params) {
    return knowledgeBase.findDuplicateEntries();
  }

  async removeDuplicates(params) {
    return knowledgeBase.removeDuplicates();
  }

  async switchConnection(params) {
    const { connectionConfig } = params;
    return knowledgeBase.switchDatabaseConnection(connectionConfig);
  }

  async testCloudConnection(params) {
    return knowledgeBase.testCloudConnection();
  }

  getHealth() {
    const stats = knowledgeBase.getStats();
    return {
      status: 'ok',
      initialized: this.isInitialized,
      queryCount: this.queryCount,
      addCount: this.addCount,
      errorCount: this.errorCount,
      totalEntries: stats.totalEntries,
      totalCases: stats.totalCases,
      memory: process.memoryUsage()
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] 知识库服务关闭`);
    this.isInitialized = false;
  }

  async onHotReload(config) {
    this.logger.info(`[${this.name}] 热重载配置`);
  }
}

module.exports = KnowledgeService;
