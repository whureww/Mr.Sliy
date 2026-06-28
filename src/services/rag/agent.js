/**
 * RAG代码优化Agent服务
 * 基于检索增强生成技术的代码智能优化
 */

const { config, isOnlineMode } = require('../../config');
const { logger } = require('../../utils/logger');
const { generateUUID, retry } = require('../../utils/helpers');
const { getDatabase } = require('../../utils/database');

// 代码片段向量存储（简化版）
const codeVectorStore = new Map();

// 优化历史记录缓存
const optimizationHistory = [];

/**
 * AI API客户端（模拟实现）
 * 实际项目中应使用真实的AI API客户端
 */
class AIClient {
  constructor() {
    this.apiUrl = config.ai.apiUrl;
    this.apiKey = config.ai.apiKey;
    this.model = config.ai.model;
    this.timeout = config.ai.timeout;
  }
  
  /**
   * 调用AI API进行代码优化
   */
  async optimizeCode(codeSnippet, context) {
    if (!isOnlineMode()) {
      return {
        success: false,
        message: '离线模式，无法使用AI优化功能'
      };
    }
    
    try {
      // 这里是模拟的AI调用，实际项目需要调用真实的API
      // 例如：OpenAI, Claude, 或本地部署的LLM
      
      const prompt = this.buildOptimizationPrompt(codeSnippet, context);
      
      // 模拟AI响应（实际项目中应调用真实API）
      const mockResponse = await this.mockAIResponse(prompt);
      
      return {
        success: true,
        optimizedCode: mockResponse.optimizedCode,
        explanation: mockResponse.explanation,
        suggestions: mockResponse.suggestions,
        tokensUsed: mockResponse.tokensUsed
      };
    } catch (error) {
      logger.error('AI优化调用失败:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }
  
  /**
   * 构建优化提示词
   */
  buildOptimizationPrompt(codeSnippet, context) {
    return `
你是一个代码优化专家。请分析以下代码片段并提供优化建议。

代码语言: ${context.language}
代码类型: ${context.issueType}
问题描述: ${context.message}

原始代码:
\`\`\`${context.language}
${codeSnippet}
\`\`\`

请提供以下内容：
1. 优化后的代码
2. 优化说明（为什么这样优化）
3. 最佳实践建议

请以JSON格式返回：
{
  "optimizedCode": "...",
  "explanation": "...",
  "suggestions": ["...", "..."]
}
`;
  }
  
  /**
   * 模拟AI响应（用于演示）
   */
  async mockAIResponse(prompt) {
    // 模拟API延迟
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 返回模拟的优化结果
    return {
      optimizedCode: '// 优化后的代码\nconst optimized = true;',
      explanation: '这是一个模拟的优化建议，实际项目中应调用真实的AI API',
      suggestions: [
        '建议使用更清晰的变量名',
        '考虑添加适当的注释',
        '遵循代码规范和最佳实践'
      ],
      tokensUsed: 100
    };
  }
}

const aiClient = new AIClient();

/**
 * 代码片段索引（简化版向量存储）
 */
function indexCodeSnippet(snippet, metadata) {
  const id = generateUUID();
  
  // 简化的特征提取（实际应使用embedding模型）
  const features = extractFeatures(snippet);
  
  codeVectorStore.set(id, {
    id,
    snippet,
    features,
    metadata,
    indexedAt: new Date()
  });
  
  logger.info(`索引代码片段: ${id}`);
  return id;
}

/**
 * 提取代码特征（简化版）
 */
function extractFeatures(code) {
  const features = {
    length: code.length,
    lines: code.split('\n').length,
    keywords: extractKeywords(code),
    complexity: calculateComplexity(code)
  };
  
  return features;
}

/**
 * 提取关键词
 */
function extractKeywords(code) {
  const keywords = [];
  const patterns = [
    /\b(function|const|let|var|if|else|for|while|return|class|import|export)\b/g,
    /\b(async|await|try|catch|throw|new|this)\b/g
  ];
  
  patterns.forEach(pattern => {
    const matches = code.match(pattern);
    if (matches) {
      keywords.push(...matches);
    }
  });
  
  return keywords;
}

/**
 * 计算代码复杂度（简化版）
 */
function calculateComplexity(code) {
  let complexity = 1;
  
  // 计算控制流语句
  const controlPatterns = [
    /\bif\b/g,
    /\belse\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bswitch\b/g,
    /\bcatch\b/g
  ];
  
  controlPatterns.forEach(pattern => {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  });
  
  return complexity;
}

/**
 * 检索相似代码片段
 */
function retrieveSimilarSnippets(querySnippet, topK = 5) {
  const queryFeatures = extractFeatures(querySnippet);
  const results = [];
  
  codeVectorStore.forEach((value, id) => {
    const similarity = calculateSimilarity(queryFeatures, value.features);
    results.push({
      id,
      snippet: value.snippet,
      similarity,
      metadata: value.metadata
    });
  });
  
  // 按相似度排序
  results.sort((a, b) => b.similarity - a.similarity);
  
  return results.slice(0, topK);
}

/**
 * 计算相似度（简化版）
 */
function calculateSimilarity(features1, features2) {
  let similarity = 0;
  
  // 长度相似度
  const lengthSim = 1 - Math.abs(features1.length - features2.length) / Math.max(features1.length, features2.length);
  similarity += lengthSim * 0.3;
  
  // 关键词相似度
  const keywordIntersection = features1.keywords.filter(k => features2.keywords.includes(k));
  const keywordSim = keywordIntersection.length / Math.max(features1.keywords.length, features2.keywords.length);
  similarity += keywordSim * 0.4;
  
  // 复杂度相似度
  const complexitySim = 1 - Math.abs(features1.complexity - features2.complexity) / Math.max(features1.complexity, features2.complexity);
  similarity += complexitySim * 0.3;
  
  return similarity;
}

/**
 * RAG优化流程
 */
async function optimizeWithRAG(issue, context) {
  const startTime = Date.now();
  
  try {
    // 1. 检索相似代码片段
    const similarSnippets = retrieveSimilarSnippets(issue.codeSnippet, 3);
    
    // 2. 构建增强上下文
    const enhancedContext = {
      ...context,
      similarExamples: similarSnippets.map(s => ({
        snippet: s.snippet,
        similarity: s.similarity
      }))
    };
    
    // 3. 调用AI进行优化
    const aiResult = await retry(
      () => aiClient.optimizeCode(issue.codeSnippet, enhancedContext),
      3,
      1000
    );
    
    if (!aiResult.success) {
      return aiResult;
    }
    
    // 4. 记录优化历史
    const optimizationRecord = {
      id: generateUUID(),
      issueId: issue.id,
      taskId: context.taskId,
      originalCode: issue.codeSnippet,
      optimizedCode: aiResult.optimizedCode,
      explanation: aiResult.explanation,
      suggestions: aiResult.suggestions,
      similarSnippetsCount: similarSnippets.length,
      tokensUsed: aiResult.tokensUsed,
      durationMs: Date.now() - startTime,
      createdAt: new Date()
    };
    
    // 存储到数据库
    saveOptimizationRecord(optimizationRecord);
    
    // 索引优化后的代码
    indexCodeSnippet(aiResult.optimizedCode, {
      type: 'optimized',
      issueType: context.issueType,
      language: context.language
    });
    
    logger.info(`RAG优化完成: ${optimizationRecord.id}`);
    
    return {
      success: true,
      optimizationId: optimizationRecord.id,
      optimizedCode: aiResult.optimizedCode,
      explanation: aiResult.explanation,
      suggestions: aiResult.suggestions,
      similarSnippets: similarSnippets,
      tokensUsed: aiResult.tokensUsed,
      durationMs: Date.now() - startTime
    };
  } catch (error) {
    logger.error('RAG优化失败:', error);
    return {
      success: false,
      message: error.message,
      durationMs: Date.now() - startTime
    };
  }
}

/**
 * 存储优化记录到数据库
 */
function saveOptimizationRecord(record) {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO ai_optimize_record
      (id, issue_id, task_id, original_code, optimized_code, explanation,
       optimization_type, ai_model, tokens_used, api_latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      record.id,
      record.issueId,
      record.taskId,
      record.originalCode,
      record.optimizedCode,
      record.explanation,
      'refactor',
      config.ai.model,
      record.tokensUsed,
      record.durationMs
    );
    
    optimizationHistory.push(record);
  } catch (error) {
    logger.error('存储优化记录失败:', error);
  }
}

/**
 * 获取优化历史
 */
function getOptimizationHistory(limit = 10) {
  return optimizationHistory.slice(0, limit);
}

/**
 * 清空向量存储
 */
function clearVectorStore() {
  codeVectorStore.clear();
  logger.info('向量存储已清空');
}

module.exports = {
  indexCodeSnippet,
  retrieveSimilarSnippets,
  optimizeWithRAG,
  getOptimizationHistory,
  clearVectorStore,
  AIClient
};