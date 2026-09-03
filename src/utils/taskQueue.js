/**
 * 并发受限的异步任务队列工具。
 * 用于批量处理任务时限制并发数，避免压垮事件循环 / LLM API 限流 / 内存暴涨。
 */

/**
 * 以受限并发执行任务，结果按原始顺序返回。
 * @param {Array} items - 任务输入数组
 * @param {number} concurrency - 最大并发数
 * @param {function} worker - async (item, index) => result
 * @param {object} [options] - { onProgress }
 * @returns {Promise<Array>} 与 items 顺序一致的结果数组
 */
async function runWithConcurrency(items, concurrency, worker, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency || 1, items.length));
  const results = new Array(items.length);
  const { onProgress } = options;

  let nextIndex = 0;
  let completed = 0;

  async function runner() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { success: false, error: e.message, item: items[i] };
      }
      completed++;
      if (onProgress) {
        try { onProgress(completed, items.length, i); } catch (_) { /* 进度回调失败不影响主流程 */ }
      }
    }
  }

  const runners = [];
  for (let r = 0; r < limit; r++) {
    runners.push(runner());
  }
  await Promise.all(runners);
  return results;
}

/**
 * 简单的串行执行（concurrency=1 的语义糖，保留错误隔离）
 * @param {Array} items
 * @param {function} worker - async (item, index) => result
 * @returns {Promise<Array>}
 */
async function runSerial(items, worker) {
  return runWithConcurrency(items, 1, worker);
}

module.exports = { runWithConcurrency, runSerial };
