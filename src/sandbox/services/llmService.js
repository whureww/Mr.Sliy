const { providerManager } = require('../../services/llm/providers');

class LLMService {
  constructor(context) {
    this.name = context.name;
    this.version = context.version;
    this.logger = context.logger;
    this.postMessage = context.postMessage;
    this.isInitialized = false;
    this.chatCount = 0;
    this.errorCount = 0;
  }

  async init() {
    this.logger.info(`[${this.name}] LLM调用服务初始化中...`);
    
    try {
      await providerManager.refreshProviderStatus();
      this.isInitialized = true;
      this.logger.info(`[${this.name}] LLM调用服务初始化完成`);
    } catch (error) {
      this.logger.warn(`[${this.name}] LLM服务初始化警告: ${error.message}`);
      this.isInitialized = true;
    }
  }

  async chat(params) {
    const { messages, options, providerName } = params;
    this.chatCount++;
    
    try {
      let provider;
      
      if (providerName) {
        const result = await providerManager.setActiveProvider(providerName);
        if (!result.success) {
          throw new Error(`切换提供商失败: ${result.message}`);
        }
      }
      
      provider = providerManager.getActiveProvider();
      if (!provider) {
        throw new Error('未配置活跃的LLM提供商');
      }
      
      const result = await provider.chat(messages, options || {});
      return result;
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 聊天调用失败: ${error.message}`);
      throw error;
    }
  }

  async streamChat(params) {
    const { messages, options, providerName, onChunk } = params;
    this.chatCount++;
    
    try {
      let provider;
      
      if (providerName) {
        await providerManager.setActiveProvider(providerName);
      }
      
      provider = providerManager.getActiveProvider();
      if (!provider) {
        throw new Error('未配置活跃的LLM提供商');
      }
      
      const result = await provider.chat(messages, {
        ...(options || {}),
        stream: true,
        onChunk: (chunk) => {
          if (onChunk) {
            onChunk(chunk);
          }
          this.postMessage?.('chunk', chunk);
        }
      });
      
      return result;
    } catch (error) {
      this.errorCount++;
      this.logger.error(`[${this.name}] 流式聊天失败: ${error.message}`);
      throw error;
    }
  }

  async getProviders(params) {
    return providerManager.getAvailableProviders();
  }

  async getActiveProvider(params) {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      return null;
    }
    return {
      name: provider.name,
      model: provider.config?.model,
      baseURL: provider.config?.baseURL
    };
  }

  async setActiveProvider(params) {
    const { providerName } = params;
    
    try {
      const result = await providerManager.setActiveProvider(providerName);
      return result;
    } catch (error) {
      this.errorCount++;
      throw error;
    }
  }

  async registerProvider(params) {
    const { name, config } = params;
    
    try {
      const result = await providerManager.register(name, config);
      return { success: true, provider: name };
    } catch (error) {
      this.errorCount++;
      throw error;
    }
  }

  async updateProviderConfig(params) {
    const { name, config } = params;
    
    try {
      providerManager.updateProviderConfig(name, config);
      return { success: true };
    } catch (error) {
      this.errorCount++;
      throw error;
    }
  }

  async refreshStatus(params) {
    try {
      await providerManager.refreshProviderStatus();
      return { success: true };
    } catch (error) {
      this.errorCount++;
      throw error;
    }
  }

  getHealth() {
    const activeProvider = providerManager.getActiveProvider();
    return {
      status: 'ok',
      initialized: this.isInitialized,
      chatCount: this.chatCount,
      errorCount: this.errorCount,
      activeProvider: activeProvider?.name || null,
      availableProviders: providerManager.getAvailableProviders().length,
      memory: process.memoryUsage()
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] LLM调用服务关闭`);
    this.isInitialized = false;
  }

  async onHotReload(config) {
    this.logger.info(`[${this.name}] 热重载配置`);
  }
}

module.exports = LLMService;
