/**
 * 多LLM提供商管理模块
 * 支持OpenAI、Claude、Ollama、Azure OpenAI等云端大模型
 * API密钥从数据库读取，不暴露在代码或环境变量中
 */

const { logger } = require('../../utils/logger');
const { queryOne } = require('../../utils/database');

/**
 * 从数据库获取LLM API密钥
 */
async function getLLMKeyFromDB(providerName) {
  try {
    const key = await queryOne(
      'SELECT api_key, api_url, model_name FROM llm_api_keys WHERE provider_name = ? AND is_active = 1 ORDER BY priority DESC LIMIT 1',
      [providerName]
    );
    return key;
  } catch (error) {
    logger.debug(`从数据库获取${providerName}密钥失败: ${error.message}`);
    return null;
  }
}

/**
 * LLM提供商基类
 */
class LLMProvider {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.cachedKey = null;
    this.cacheTime = 0;
  }

  async getKeyFromDB() {
    const now = Date.now();
    if (this.cachedKey && now - this.cacheTime < 300000) {
      return this.cachedKey;
    }
    
    const key = await getLLMKeyFromDB(this.name);
    if (key) {
      this.cachedKey = key;
      this.cacheTime = now;
    }
    return key;
  }

  async chat(messages, options = {}) {
    throw new Error('子类必须实现chat方法');
  }

  async optimizeCode(codeSnippet, context, options = {}) {
    const prompt = this.buildOptimizationPrompt(codeSnippet, context);
    const messages = [
      { role: 'system', content: '你是一个专业的代码优化专家，擅长代码重构、性能优化和最佳实践建议。' },
      { role: 'user', content: prompt }
    ];
    return this.chat(messages, options);
  }

  buildOptimizationPrompt(codeSnippet, context) {
    return `请分析以下代码片段并提供优化建议。

代码语言: ${context.language || '未知'}
问题类型: ${context.issueType || '一般优化'}
问题描述: ${context.message || ''}

原始代码:
\`\`\`${context.language || ''}
${codeSnippet}
\`\`\`

请提供以下内容：
1. 优化后的代码（完整可运行的代码）
2. 优化说明（为什么这样优化，解决了什么问题）
3. 最佳实践建议（通用的编码建议）

请以JSON格式返回：
{
  "optimizedCode": "优化后的完整代码",
  "explanation": "优化说明",
  "suggestions": ["建议1", "建议2"]
}`;
  }
}

/**
 * OpenAI提供商
 */
class OpenAIProvider extends LLMProvider {
  constructor(config) {
    super('openai', config);
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('OpenAI API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const url = (dbKey.api_url || this.baseURL) + '/chat/completions';
    const body = {
      model: options.model || dbKey.model_name || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000,
      top_p: options.topP || 1,
      stream: options.stream || false
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';
      
      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('OpenAI调用失败:', error);
      throw error;
    }
  }
}

/**
 * Claude (Anthropic) 提供商
 */
class ClaudeProvider extends LLMProvider {
  constructor(config) {
    super('claude', config);
    this.baseURL = config.baseURL || 'https://api.anthropic.com/v1';
    this.model = config.model || 'claude-3-sonnet-20240229';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('Claude API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const url = (dbKey.api_url || this.baseURL) + '/messages';

    // 转换消息格式
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const userMessages = messages.filter(m => m.role !== 'system');

    const body = {
      model: options.model || dbKey.model_name || this.model,
      max_tokens: options.maxTokens || 2000,
      temperature: options.temperature ?? 0.7,
      system: systemMessage,
      messages: userMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Claude API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('Claude调用失败:', error);
      throw error;
    }
  }
}

/**
 * Ollama (本地大模型) 提供商
 */
class OllamaProvider extends LLMProvider {
  constructor(config) {
    super('ollama', config);
    this.baseURL = config.baseURL || 'http://localhost:11434';
    this.model = config.model || 'codellama';
  }

  async isAvailable() {
    // Ollama不需要API Key，但需要本地服务运行
    // 尝试连接本地服务验证可用性
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseURL}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  async chat(messages, options = {}) {
    const url = `${this.baseURL}/api/chat`;
    const body = {
      model: options.model || this.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens || 2000
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Ollama服务错误: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.message?.content || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.eval_count || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('Ollama调用失败:', error);
      throw error;
    }
  }
}

/**
 * Google Gemini 提供商
 */
class GeminiProvider extends LLMProvider {
  constructor(config) {
    super('gemini', config);
    this.baseURL = config.baseURL || 'https://generativelanguage.googleapis.com/v1beta';
    this.model = config.model || 'gemini-1.5-pro';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('Gemini API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = dbKey.api_url || this.baseURL;
    const model = options.model || dbKey.model_name || this.model;
    const url = `${baseUrl}/models/${model}:generateContent`;
    
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }]
    }));

    const body = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens || 2000,
        topP: options.topP || 1
      }
    };

    try {
      const response = await fetch(`${url}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.usageMetadata?.totalTokenCount || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('Gemini调用失败:', error);
      throw error;
    }
  }
}

/**
 * 阿里通义千问 提供商
 */
class TongyiProvider extends LLMProvider {
  constructor(config) {
    super('tongyi', config);
    this.baseURL = config.baseURL || 'https://dashscope.aliyuncs.com/api/v1';
    this.model = config.model || 'qwen-plus';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('通义千问 API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = dbKey.api_url || this.baseURL;
    const url = `${baseUrl}/services/aigc/text-generation/generation`;
    const body = {
      model: options.model || dbKey.model_name || this.model,
      input: {
        messages
      },
      parameters: {
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 2000
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`通义千问错误: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.output?.text || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('通义千问调用失败:', error);
      throw error;
    }
  }
}

/**
 * 字节豆包 提供商
 */
class DoubaoProvider extends LLMProvider {
  constructor(config) {
    super('doubao', config);
    this.baseURL = config.baseURL || 'https://api.doubao.com/v1';
    this.model = config.model || 'Doubao-7B';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('豆包 API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = dbKey.api_url || this.baseURL;
    const url = `${baseUrl}/chat/completions`;
    const body = {
      model: options.model || dbKey.model_name || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`豆包 API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('豆包调用失败:', error);
      throw error;
    }
  }
}

/**
 * 百度文心一言 提供商
 */
class WenxinProvider extends LLMProvider {
  constructor(config) {
    super('wenxin', config);
    this.baseURL = config.baseURL || 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat';
    this.accessToken = null;
    this.tokenExpireTime = 0;
    this.model = config.model || 'ernie-3.5';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    if (!key || !key.api_key) return false;
    // 文心一言需要apiKey和secretKey，存储格式为JSON或分隔符
    try {
      const keyData = JSON.parse(key.api_key);
      return !!keyData.apiKey && !!keyData.secretKey;
    } catch (e) {
      // 如果不是JSON，尝试分隔符格式 "apiKey|secretKey"
      const parts = key.api_key.split('|');
      return parts.length === 2 && parts[0] && parts[1];
    }
  }

  async getAccessToken(apiKey, secretKey) {
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }

    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    this.accessToken = data.access_token;
    this.tokenExpireTime = Date.now() + (data.expires_in - 60) * 1000;
    
    return this.accessToken;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('文心一言 API Key未配置');
    }

    let apiKey, secretKey;
    try {
      const keyData = JSON.parse(dbKey.api_key);
      apiKey = keyData.apiKey;
      secretKey = keyData.secretKey;
    } catch (e) {
      const parts = dbKey.api_key.split('|');
      apiKey = parts[0];
      secretKey = parts[1];
    }

    if (!apiKey || !secretKey) {
      throw new Error('文心一言 API Key或Secret Key未配置');
    }

    const accessToken = await this.getAccessToken(apiKey, secretKey);
    const baseUrl = dbKey.api_url || this.baseURL;
    const model = options.model || dbKey.model_name || this.model;
    const url = `${baseUrl}/${model}?access_token=${accessToken}`;

    const body = {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`文心一言错误: ${errorData.error_msg || response.statusText}`);
      }

      const data = await response.json();
      const content = data.result || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: model
      };
    } catch (error) {
      logger.error('文心一言调用失败:', error);
      throw error;
    }
  }
}

/**
 * Azure OpenAI 提供商
 */
class AzureOpenAIProvider extends LLMProvider {
  constructor(config) {
    super('azure', config);
    this.apiVersion = config.apiVersion || '2024-02-01';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    if (!key || !key.api_key) return false;
    // Azure需要endpoint和apiKey，endpoint存储在api_url
    return !!key.api_url && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key || !dbKey.api_url) {
      throw new Error('Azure OpenAI配置不完整');
    }

    const apiKey = dbKey.api_key;
    const endpoint = dbKey.api_url;
    const deploymentName = dbKey.model_name || 'gpt-4';
    const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${this.apiVersion}`;
    const body = {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Azure OpenAI错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      let parsed = null;
      try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch (e) {}

      return {
        content: parsed || content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('Azure OpenAI调用失败:', error);
      throw error;
    }
  }
}

/**
 * DeepSeek 提供商
 */
class DeepSeekProvider extends LLMProvider {
  constructor(config) {
    super('deepseek', config);
    this.baseURL = config.baseURL || 'https://api.deepseek.com/v1';
    this.model = config.model || 'deepseek-chat';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('DeepSeek API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const url = (dbKey.api_url || this.baseURL) + '/chat/completions';
    const body = {
      model: options.model || dbKey.model_name || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000,
      top_p: options.topP || 1,
      stream: options.stream || false
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`DeepSeek错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      return {
        content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('DeepSeek调用失败:', error);
      throw error;
    }
  }
}

/**
 * 智谱AI (ChatGLM) 提供商
 */
class ZhipuProvider extends LLMProvider {
  constructor(config) {
    super('zhipu', config);
    this.baseURL = config.baseURL || 'https://open.bigmodel.cn/api/paas/v4';
    this.model = config.model || 'glm-4';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('智谱AI API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const url = (dbKey.api_url || this.baseURL) + '/chat/completions';
    const body = {
      model: options.model || dbKey.model_name || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000,
      top_p: options.topP || 1,
      stream: options.stream || false
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`智谱AI错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      return {
        content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('智谱AI调用失败:', error);
      throw error;
    }
  }
}

/**
 * Moonshot AI (Kimi) 提供商
 */
class MoonshotProvider extends LLMProvider {
  constructor(config) {
    super('moonshot', config);
    this.baseURL = config.baseURL || 'https://api.moonshot.cn/v1';
    this.model = config.model || 'moonshot-v1-8k';
  }

  async isAvailable() {
    const key = await this.getKeyFromDB();
    return !!key && !!key.api_key;
  }

  async chat(messages, options = {}) {
    const dbKey = await this.getKeyFromDB();
    if (!dbKey || !dbKey.api_key) {
      throw new Error('Moonshot API Key未配置');
    }

    const apiKey = dbKey.api_key;
    const baseUrl = dbKey.api_url || this.baseURL;
    const url = `${baseUrl}/chat/completions`;
    const body = {
      model: options.model || dbKey.model_name || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2000,
      top_p: options.topP || 1,
      stream: options.stream || false
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Moonshot错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      return {
        content,
        rawContent: content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model
      };
    } catch (error) {
      logger.error('Moonshot调用失败:', error);
      throw error;
    }
  }
}

/**
 * LLM提供商管理器
 */
class LLMProviderManager {
  constructor() {
    this.providers = new Map();
    this.activeProvider = null;
    this._cachedProviders = [];
    
    this.register('openai', {});
    this.register('deepseek', {});
    this.register('zhipu', {});
    this.register('tongyi', {});
    this.register('moonshot', {});
    this.register('ollama', {});
  }
  
  async init() {
    await this.refreshProviderStatus();
    await this.restoreActiveProvider();
  }
  
  async restoreActiveProvider() {
    try {
      const { queryOne } = require('../../utils/database');
      const config = await queryOne('SELECT config_value FROM sys_config WHERE config_key = ?', ['active_llm_provider']);
      
      if (config && config.config_value) {
        const savedProvider = config.config_value.toLowerCase();
        const provider = this.providers.get(savedProvider);
        
        if (provider) {
          try {
            if (await provider.isAvailable()) {
              this.activeProvider = provider;
              logger.info(`已恢复上次使用的提供商: ${savedProvider}`);
              return;
            } else {
              logger.warn(`上次使用的提供商 ${savedProvider} 不可用，正在自动检测...`);
            }
          } catch (e) {
            logger.warn(`检查提供商 ${savedProvider} 失败: ${e.message}`);
          }
        }
      }
      
      await this.autoDetectAvailableProvider();
    } catch (error) {
      logger.warn('恢复活跃提供商失败:', error.message);
      await this.autoDetectAvailableProvider();
    }
  }
  
  async refreshProviderStatus() {
    const providers = [];
    for (const [name, provider] of this.providers) {
      let isAvail = false;
      try {
        isAvail = await provider.isAvailable();
      } catch (e) {
        isAvail = false;
      }
      providers.push({
        name,
        available: isAvail,
        model: provider.model || provider.deploymentName
      });
    }
    this._cachedProviders = providers;
    return providers;
  }
  
  async autoDetectAvailableProvider() {
    for (const [name, provider] of this.providers) {
      try {
        if (await provider.isAvailable()) {
          this.activeProvider = provider;
          logger.info(`自动检测到可用提供商: ${name}`);
          return;
        }
      } catch (error) {
        logger.debug(`检测提供商 ${name} 失败: ${error.message}`);
      }
    }
    logger.warn('未检测到可用的LLM提供商，请在数据库中配置API密钥');
  }

  /**
   * 注册提供商
   */
  register(name, config) {
    let provider;
    switch (name.toLowerCase()) {
      case 'openai':
        provider = new OpenAIProvider(config);
        break;
      case 'claude':
      case 'anthropic':
        provider = new ClaudeProvider(config);
        break;
      case 'ollama':
        provider = new OllamaProvider(config);
        break;
      case 'azure':
      case 'azureopenai':
        provider = new AzureOpenAIProvider(config);
        break;
      case 'gemini':
      case 'google':
        provider = new GeminiProvider(config);
        break;
      case 'tongyi':
      case 'qwen':
        provider = new TongyiProvider(config);
        break;
      case 'doubao':
      case 'bytedance':
        provider = new DoubaoProvider(config);
        break;
      case 'wenxin':
      case 'ernie':
      case 'baidu':
        provider = new WenxinProvider(config);
        break;
      case 'deepseek':
        provider = new DeepSeekProvider(config);
        break;
      case 'zhipu':
      case 'chatglm':
      case 'glm':
        provider = new ZhipuProvider(config);
        break;
      case 'moonshot':
      case 'kimi':
        provider = new MoonshotProvider(config);
        break;
      default:
        throw new Error(`不支持的提供商: ${name}`);
    }

    this.providers.set(name.toLowerCase(), provider);
    logger.info(`注册LLM提供商: ${name}`);
    return provider;
  }

  /**
   * 设置活跃提供商
   */
  async setActiveProvider(name) {
    const provider = this.providers.get(name.toLowerCase());
    if (!provider) {
      throw new Error(`未找到提供商: ${name}`);
    }
    if (!(await provider.isAvailable())) {
      throw new Error(`提供商 ${name} 不可用，请检查数据库配置`);
    }
    this.activeProvider = provider;
    logger.info(`切换活跃LLM提供商: ${name}`);
    
    // 保存到数据库
    try {
      const { execute } = require('../../utils/database');
      await execute(
        'INSERT OR REPLACE INTO sys_config (config_key, config_value, config_type, description, is_public) VALUES (?, ?, ?, ?, ?)',
        ['active_llm_provider', name.toLowerCase(), 'string', '当前活跃的LLM提供商', 0]
      );
    } catch (error) {
      logger.warn('保存活跃提供商失败:', error.message);
    }
    
    return provider;
  }

  /**
   * 获取活跃提供商
   */
  getActiveProvider() {
    return this.activeProvider;
  }

  /**
   * 获取所有可用提供商（同步返回缓存结果）
   */
  getAvailableProviders() {
    if (this._cachedProviders && this._cachedProviders.length > 0) {
      return this._cachedProviders;
    }
    // 如果缓存为空，返回所有provider但available为false
    const result = [];
    this.providers.forEach((provider, name) => {
      result.push({
        name,
        available: false,
        model: provider.model || provider.deploymentName
      });
    });
    return result;
  }

  /**
   * 获取所有已注册提供商
   */
  getAllProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * 使用活跃提供商发送请求
   */
  async chat(messages, options = {}) {
    if (!this.activeProvider) {
      throw new Error('未设置活跃LLM提供商');
    }
    return this.activeProvider.chat(messages, options);
  }

  /**
   * 使用活跃提供商优化代码
   */
  async optimizeCode(codeSnippet, context, options = {}) {
    if (!this.activeProvider) {
      throw new Error('未设置活跃LLM提供商');
    }
    return this.activeProvider.optimizeCode(codeSnippet, context, options);
  }

  /**
   * 更新提供商配置
   */
  updateProviderConfig(name, config) {
    const provider = this.providers.get(name.toLowerCase());
    if (provider) {
      Object.assign(provider.config, config);
      if (config.baseURL) provider.baseURL = config.baseURL;
      if (config.model) provider.model = config.model;
      if (config.endpoint) provider.endpoint = config.endpoint;
      if (config.deploymentName) provider.deploymentName = config.deploymentName;
      if (config.secretKey) provider.secretKey = config.secretKey;
      if (config.apiVersion) provider.apiVersion = config.apiVersion;
      provider.cachedKey = null;
      logger.info(`更新提供商配置: ${name}`);
    }
  }
}

// 单例实例
const providerManager = new LLMProviderManager();

module.exports = {
  LLMProviderManager,
  OpenAIProvider,
  ClaudeProvider,
  OllamaProvider,
  AzureOpenAIProvider,
  GeminiProvider,
  TongyiProvider,
  DoubaoProvider,
  WenxinProvider,
  providerManager
};
