const { Worker } = require('worker_threads');
const path = require('path');
const { logger } = require('../utils/logger');

class WorkerPool {
  constructor(workerPath, options = {}) {
    this.workerPath = workerPath;
    this.poolSize = options.poolSize || Math.max(2, Math.floor(require('os').cpus().length / 2));
    this.workers = [];
    this.taskQueue = [];
    this.idleWorkers = [];
    this.taskCounter = 0;
    this.taskCallbacks = new Map();
    this.isClosing = false;

    this._initialize();
  }

  _initialize() {
    for (let i = 0; i < this.poolSize; i++) {
      this._createWorker();
    }
    logger.info(`Worker线程池初始化完成，池大小: ${this.poolSize}`);
  }

  _createWorker() {
    const worker = new Worker(this.workerPath);

    worker.on('message', (message) => {
      const { id, result } = message;
      const callback = this.taskCallbacks.get(id);
      if (callback) {
        callback(null, result);
        this.taskCallbacks.delete(id);
      }
      this._markWorkerIdle(worker);
    });

    worker.on('error', (error) => {
      logger.error(`Worker错误: ${error.message}`);
      this._markWorkerIdle(worker);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        logger.error(`Worker异常退出，代码: ${code}`);
      }
      if (!this.isClosing) {
        this._replaceWorker(worker);
      }
    });

    this.workers.push(worker);
    this.idleWorkers.push(worker);
  }

  _replaceWorker(oldWorker) {
    const index = this.workers.indexOf(oldWorker);
    if (index !== -1) {
      this.workers.splice(index, 1);
    }
    const idleIndex = this.idleWorkers.indexOf(oldWorker);
    if (idleIndex !== -1) {
      this.idleWorkers.splice(idleIndex, 1);
    }
    oldWorker.terminate();
    this._createWorker();
  }

  _markWorkerIdle(worker) {
    if (!this.idleWorkers.includes(worker)) {
      this.idleWorkers.push(worker);
    }
    this._processQueue();
  }

  _processQueue() {
    while (this.taskQueue.length > 0 && this.idleWorkers.length > 0) {
      const task = this.taskQueue.shift();
      const worker = this.idleWorkers.shift();
      worker.postMessage(task);
    }
  }

  async execute(taskData) {
    return new Promise((resolve, reject) => {
      if (this.isClosing) {
        reject(new Error('Worker池已关闭'));
        return;
      }

      const taskId = ++this.taskCounter;
      const task = {
        id: taskId,
        ...taskData
      };

      this.taskCallbacks.set(taskId, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });

      if (this.idleWorkers.length > 0) {
        const worker = this.idleWorkers.shift();
        worker.postMessage(task);
      } else {
        this.taskQueue.push(task);
      }
    });
  }

  async parse(sourceCode, languageName) {
    return await this.execute({
      action: 'parse',
      sourceCode,
      languageName
    });
  }

  async close() {
    this.isClosing = true;
    logger.info('正在关闭Worker线程池...');

    for (const worker of this.workers) {
      worker.terminate();
    }

    this.workers = [];
    this.idleWorkers = [];
    this.taskQueue = [];
    this.taskCallbacks.clear();

    logger.info('Worker线程池关闭完成');
  }

  getPoolStats() {
    return {
      totalWorkers: this.workers.length,
      idleWorkers: this.idleWorkers.length,
      pendingTasks: this.taskQueue.length,
      inProgressTasks: this.taskCallbacks.size
    };
  }
}

const parserPool = new WorkerPool(path.join(__dirname, 'parser.js'), {
  poolSize: Math.max(2, Math.floor(require('os').cpus().length / 2))
});

process.on('exit', () => {
  parserPool.close();
});

process.on('SIGINT', () => {
  parserPool.close();
  process.exit(0);
});

module.exports = {
  WorkerPool,
  parserPool
};