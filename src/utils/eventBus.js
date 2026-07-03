class EventBus {
  constructor() {
    this.listeners = new Map();
    this.maxListeners = 100;
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    const listeners = this.listeners.get(event);
    if (listeners.length >= this.maxListeners) {
      console.warn(`EventBus: 事件 "${event}" 的监听器数量已达上限`);
      return;
    }
    listeners.push(listener);
  }

  off(event, listener) {
    if (!this.listeners.has(event)) return;
    const listeners = this.listeners.get(event);
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  once(event, listener) {
    const onceListener = (...args) => {
      listener(...args);
      this.off(event, onceListener);
    };
    this.on(event, onceListener);
  }

  emit(event, ...args) {
    if (!this.listeners.has(event)) return;
    const listeners = this.listeners.get(event);
    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`EventBus: 事件 "${event}" 的监听器执行失败`, error);
      }
    }
  }

  async emitAsync(event, ...args) {
    if (!this.listeners.has(event)) return [];
    const listeners = this.listeners.get(event);
    const results = [];
    for (const listener of listeners) {
      try {
        const result = await listener(...args);
        results.push(result);
      } catch (error) {
        console.error(`EventBus: 事件 "${event}" 的监听器执行失败`, error);
        results.push({ error: error.message });
      }
    }
    return results;
  }

  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event) {
    return this.listeners.has(event) ? this.listeners.get(event).length : 0;
  }

  getEvents() {
    return Array.from(this.listeners.keys());
  }
}

const eventBus = new EventBus();

module.exports = {
  EventBus,
  eventBus
};