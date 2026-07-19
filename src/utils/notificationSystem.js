const { logger } = require('./logger');

class NotificationSystem {
  constructor() {
    this.messageQueue = [];
    this.lastActivityTime = Date.now();
    this.idleThreshold = 120000;
    this.checkInterval = 5000;
    this.isProcessing = false;
    this._checkTimer = null;
    this.onShowNotification = null;
  }

  start(onShowNotification) {
    this.onShowNotification = onShowNotification;
    this._checkTimer = setInterval(() => {
      this._checkIdleAndShow();
    }, this.checkInterval);
    logger.debug('消息提示系统已启动');
  }

  stop() {
    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }
    logger.debug('消息提示系统已停止');
  }

  recordActivity() {
    this.lastActivityTime = Date.now();
  }

  addMessage(message) {
    this.messageQueue.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: message.type || 'info',
      title: message.title || '',
      content: message.content || '',
      data: message.data || {},
      timestamp: Date.now(),
      confirmed: false
    });
    logger.debug(`消息已加入队列: ${message.title}`);
  }

  hasPendingMessages() {
    return this.messageQueue.length > 0;
  }

  _checkIdleAndShow() {
    if (this.isProcessing) return;
    
    const now = Date.now();
    const idleTime = now - this.lastActivityTime;
    
    if (idleTime >= this.idleThreshold && this.messageQueue.length > 0) {
      this._processNextMessage();
    }
  }

  async _processNextMessage() {
    this.isProcessing = true;
    
    try {
      const message = this.messageQueue.shift();
      if (!message) {
        this.isProcessing = false;
        return;
      }

      if (this.onShowNotification) {
        const result = await this.onShowNotification(message);
        message.confirmed = result?.confirmed || false;
        
        if (message.type === 'update' && !message.confirmed) {
          this.messageQueue.unshift(message);
        }
      }
    } catch (error) {
      logger.error(`处理消息失败: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  clearMessages() {
    this.messageQueue = [];
  }

  getPendingMessages() {
    return [...this.messageQueue];
  }
}

const notificationSystem = new NotificationSystem();

module.exports = {
  NotificationSystem,
  notificationSystem
};