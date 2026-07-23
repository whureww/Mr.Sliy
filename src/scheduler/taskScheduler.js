const EventEmitter = require('events');

class TaskScheduler extends EventEmitter {
  constructor() {
    super();
    this.isIdle = true;
    this.taskQueue = [];
    this.timer = null;
    this.listener = null;
  }

  // 初始化监听器，接收请求
  startListening() {
    this.listener = (request) => {
      this.enqueueTask(request);
      if (this.isIdle) {
        this.transitionToWorking();
      }
    };
    this.on('request', this.listener);
  }

  // 将任务加入队列
  enqueueTask(task) {
    this.taskQueue.push(task);
  }

  // 从空闲状态过渡到工作状态
  transitionToWorking() {
    if (this.isIdle && this.taskQueue.length > 0) {
      this.isIdle = false;
      this.processNextTask();
    }
  }

  // 处理下一个任务
  processNextTask() {
    if (this.taskQueue.length === 0) {
      this.transitionToIdle();
      return;
    }
    const task = this.taskQueue.shift();
    // 模拟任务处理，实际可替换为具体逻辑
    this.executeTask(task);
  }

  // 执行具体任务
  executeTask(task) {
    console.log(`Processing task: ${task.id}`);
    // 任务完成后，继续处理下一个
    setImmediate(() => this.processNextTask());
  }

  // 从工作状态过渡到空闲状态
  transitionToIdle() {
    this.isIdle = true;
    console.log('Scheduler is now idle');
    // 可在此触发空闲事件
    this.emit('idle');
  }

  // 定时任务示例：定期检查队列状态
  startPeriodicCheck(intervalMs = 5000) {
    this.timer = setInterval(() => {
      if (this.isIdle && this.taskQueue.length > 0) {
        this.transitionToWorking();
      }
    }, intervalMs);
  }

  // 停止定时检查
  stopPeriodicCheck() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 销毁调度器
  destroy() {
    this.stopPeriodicCheck();
    this.removeAllListeners('request');
    this.taskQueue = [];
    this.isIdle = true;
  }
}

module.exports = TaskScheduler;