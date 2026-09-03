const { EventEmitter } = require('events');
const { logger } = require('../utils/logger');

/**
 * 服务实例池
 * 支持单服务多实例 + 基于最少连接数的负载均衡路由
 *
 * 设计目标：
 *  - 默认单实例（低资源占用），可通过 config.instances 扩展为多实例
 *  - 请求路由到 pendingRequests 最少的就绪实例（least-connections）
 *  - 跳过未就绪/重启中/关闭中的实例，全部不可用时抛错
 *  - 对外暴露与 SandboxService 一致的接口，便于 ServiceRegistry 透明替换
 */
class ServicePool extends EventEmitter {
  constructor(serviceName, config) {
    super();
    this.serviceName = serviceName;
    this.config = config;
    this.instances = [];
    // 轮询起点（当所有就绪实例 pending 相同时，轮询避免单一实例被集中命中）
    this._rrIndex = 0;
  }

  async _createInstance() {
    const { SandboxService } = require('./sandboxService');
    const inst = new SandboxService(this.serviceName, this.config);

    // 聚合实例事件到池
    inst.on('event', (event, payload) => this.emit('event', event, payload));
    inst.on('ready', (payload) => this.emit('ready', payload));
    inst.on('error', (err) => this.emit('error', err));

    await inst.start();
    return inst;
  }

  async start() {
    const count = Math.max(1, this.config.instances || 1);
    for (let i = 0; i < count; i++) {
      const inst = await this._createInstance();
      this.instances.push(inst);
    }
  }

  async waitUntilReady(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (const inst of this.instances) {
      const remain = Math.max(0, deadline - Date.now());
      await inst.waitUntilReady(remain);
    }
  }

  /**
   * 选择就绪且 pending 最少的实例（least-connections）
   * 若所有实例均不可用，返回 null
   */
  _selectInstance() {
    const ready = this.instances.filter(i => i.isReady());
    if (ready.length === 0) return null;

    let best = null;
    let bestPending = Infinity;
    let bestIdx = -1;

    // 先按 pending 最少筛选；并列时用轮询打散
    const minPending = Math.min(...ready.map(i => i.getStatus().pendingRequests));
    const tied = ready.filter(i => i.getStatus().pendingRequests === minPending);

    if (tied.length === 1) {
      return tied[0];
    }

    // 并列 → 轮询
    this._rrIndex = (this._rrIndex + 1) % tied.length;
    return tied[this._rrIndex];
  }

  async execute(action, params = {}) {
    const inst = this._selectInstance();
    if (!inst) {
      throw new Error(`服务 ${this.serviceName} 不可用（无就绪实例）`);
    }
    return inst.execute(action, params);
  }

  getPendingRequests() {
    const requests = [];
    for (const inst of this.instances) {
      requests.push(...inst.getPendingRequests());
    }
    return requests;
  }

  takeoverRequests(pendingRequests) {
    // 交接给第一个就绪实例；无就绪实例时入队等待任意实例恢复后由调用方重试
    const target = this._selectInstance() || this.instances[0];
    if (target) {
      target.takeoverRequests(pendingRequests);
    }
  }

  async gracefulShutdown() {
    await Promise.all(this.instances.map(i => i.gracefulShutdown().catch(() => {})));
  }

  async stop() {
    await Promise.all(this.instances.map(i => i.stop().catch(() => {})));
    this.instances = [];
  }

  isReady() {
    return this.instances.some(i => i.isReady());
  }

  isRunning() {
    return this.instances.some(i => i.isRunning());
  }

  /**
   * 聚合状态：单实例直接返回，多实例返回汇总
   */
  getStatus() {
    if (this.instances.length === 1) {
      return this.instances[0].getStatus();
    }
    return {
      name: this.serviceName,
      version: this.config.version || '1.0.0',
      ready: this.isReady(),
      running: this.isRunning(),
      instances: this.instances.length,
      readyInstances: this.instances.filter(i => i.isReady()).length,
      pendingRequests: this.instances.reduce((s, i) => s + i.getStatus().pendingRequests, 0),
      restartCount: this.instances.reduce((s, i) => s + i.getStatus().restartCount, 0),
      consecutiveErrors: this.instances.reduce((s, i) => s + i.getStatus().consecutiveErrors, 0),
      status: this.isReady() ? 'running' : 'stopped'
    };
  }

  /**
   * 热替换单个实例（保持池对外可用性）
   * 策略：创建新实例 → 就绪 → 流量切换 → 优雅关闭旧实例
   */
  async hotReloadInstance(index, newConfig) {
    const oldInst = this.instances[index];
    if (!oldInst) {
      throw new Error(`实例 ${this.serviceName}[${index}] 不存在`);
    }

    const mergedConfig = { ...this.config, ...newConfig };
    const newInst = await this._createInstance();
    await newInst.waitUntilReady(mergedConfig.startupTimeout || 15000);

    // 交接未完成请求
    const pending = oldInst.getPendingRequests();
    newInst.takeoverRequests(pending);

    await oldInst.gracefulShutdown().catch(() => {});
    this.instances[index] = newInst;

    return {
      oldVersion: oldInst.version,
      newVersion: newInst.version
    };
  }

  /**
   * 热替换整个池（默认替换实例 0，兼容旧接口）
   */
  async hotReload(newConfig) {
    return this.hotReloadInstance(0, newConfig);
  }

  get version() {
    return this.config.version || '1.0.0';
  }
}

module.exports = { ServicePool };
