/**
 * Auto Fix Coordinator - 双层混合自动修复协调器
 *
 * 错误发生 -> 分类 -> 第一层（预定义快策略） -> 失败则进入第二层（AI修复管道）
 * AI 修复管道 -> generateFix() -> sandboxTrialRunner.runTrial() -> 门控 -> 写文件 -> 热替换
 *
 * 包含错误去重和修复循环保护
 */

const { logger } = require('../../utils/logger');
const { eventBus, SYSTEM_EVENTS } = require('../../utils/eventBus');
const { aiFixPipeline } = require('./aiFixPipeline');
const { sandboxTrialRunner } = require('./sandboxTrialRunner');
const { notificationSystem } = require('../../utils/notificationSystem');
const { confirmationGate } = require('./confirmationGate');

class AutoFixCoordinator {
  constructor() {
    this.errorDedupWindow = 45_000;          // 45s 内同一错误只触发一次
    this.repairLoopProtectionWindow = 180_000; // 3 分钟内同一错误最多修 3 次
    this.maxLoopRepairCount = 3;
    this.maxAIIterations = 5;

    this.recentErrors = new Map(); // errorKey -> {last, count}
    this.activeAIRepairs = new Set();
  }

  _errorKey(error) {
    const msg = (error.message || '').replace(/\d+/g, 'N');
    const firstStack = (error.stack || '').split('\n')[1] || '';
    return `${error.name || 'Error'}::${msg.substring(0, 80)}::${firstStack.substring(0, 60)}`;
  }

  _shouldTriggerRepair(error) {
    const key = this._errorKey(error);
    const now = Date.now();
    const rec = this.recentErrors.get(key) || { last: 0, count: 0, windowStart: now };

    // 窗口内去重：45s 内同一错误只处理一次
    if (now - rec.last < this.errorDedupWindow && rec.last > 0) {
      return { trigger: false, key, reason: 'dedup_window' };
    }
    // 修复循环保护：3分钟窗口内同一错误最多 3 次修复尝试
    if (now - rec.windowStart > this.repairLoopProtectionWindow) {
      rec.windowStart = now;
      rec.count = 0;
    }
    if (rec.count >= this.maxLoopRepairCount) {
      return { trigger: false, key, reason: 'loop_protection' };
    }
    rec.last = now;
    rec.count += 1;
    this.recentErrors.set(key, rec);
    return { trigger: true, key };
  }

  /**
   * 双层混合路由入口
   * - 由 autoRepairHandler 直接调用
   * - 不阻塞主进程，任何内部错误都吞掉，绝不二次抛出
   */
  async trigger(error, context = {}) {
    try {
      const guard = this._shouldTriggerRepair(error);
      if (!guard.trigger) {
        logger.debug(`[AutoFix] 跳过 [${guard.reason}]: ${error.message.substring(0, 60)}`);
        return { skipped: true, reason: guard.reason };
      }

      const errorType = context.errorType || this._classify(error);
      logger.info(`[AutoFix] 双层混合路由启动 [${errorType}]: ${error.message.substring(0, 80)}`);

      // 第一层：快速类错误（database/network/file_system）走预定义策略
      if (['database', 'network', 'file_system', 'memory'].includes(errorType)) {
        logger.debug(`[AutoFix] 走第一层：预定义快策略`);
        return { layer: 'fast-policy', errorType };
      }

      // 第二层：AI 修复管道（runtime/dependency/configuration -> 直接进入；其他是第一层失败后兜底）
      const canAI = this._canUseAI();
      if (!canAI.ok) {
        logger.warn(`[AutoFix] AI 修复不可用: ${canAI.reason}`);
        return { layer: 'ai-pipeline', skipped: true, reason: canAI.reason };
      }

      // 并发保护：同一时间只跑一个 AI 修复
      if (this.activeAIRepairs.has(guard.key)) {
        return { skipped: true, reason: 'concurrent' };
      }

      this.activeAIRepairs.add(guard.key);
      try {
        const outcome = await this._runAIPipelineWithLoop(error, guard.key);
        return outcome;
      } finally {
        this.activeAIRepairs.delete(guard.key);
      }

    } catch (e) {
      logger.error(`[AutoFix] 协调器内部异常: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  _canUseAI() {
    try {
      const { providerManager } = require('../llm/providers');
      const active = providerManager.getActiveProvider();
      if (!active) return { ok: false, reason: 'LLM 未配置/无活跃提供商' };
      if (!providerManager.checkProviderStatus?.(active.name)) return { ok: false, reason: 'LLM 状态不可用' };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `providerManager 异常: ${e.message}` };
    }
  }

  async _runAIPipelineWithLoop(error, key) {
    const affectedInfo = aiFixPipeline.detectAffectedServices(error);
    logger.debug(`[AutoFix] 定位受影响服务: ${affectedInfo.services.join(', ')}`);

    let lastFailure = null;
    let iteration = 0;
    let trialOutcome = null;

    while (iteration < this.maxAIIterations) {
      iteration += 1;
      logger.info(`[AutoFix] AI 修复迭代 ${iteration}/${this.maxAIIterations}`);

      // Step 1: AI 生成修复方案
      const fixGen = await aiFixPipeline.generateFix(error, affectedInfo, lastFailure, iteration);
      if (!fixGen.success) {
        lastFailure = { reason: `AI生成失败: ${fixGen.error}`, patchSummary: '' };
        continue;
      }
      const fixData = fixGen.data;

      // Step 2: 沙箱试运行
      logger.debug(`[AutoFix] 开始沙箱试运行，补丁: ${fixData.patches.length} 个`);
      const trial = await sandboxTrialRunner.runTrial(error, fixData);

      if (trial.success) {
        trialOutcome = trial;
        logger.info(`[AutoFix] 沙箱试运行通过！补丁: ${trial.patchSummary}`);
        break;
      } else {
        lastFailure = { reason: trial.reason || '试运行失败', patchSummary: trial.patchSummary || '' };
        logger.warn(`[AutoFix] 沙箱试运行失败 (#${iteration}): ${trial.reason?.substring(0, 120) || '未知'}`);
      }
    }

    if (!trialOutcome) {
      const msg = `AI 修复 ${this.maxAIIterations} 轮均未通过沙箱测试，最后原因: ${lastFailure?.reason || '未知'}`;
      logger.error(`[AutoFix] ${msg}`);
      this._sendNotification('error', msg);
      return { success: false, layer: 'ai-pipeline', iterations: iteration, error: msg };
    }

    // Step 3: 门控确认
    const gateResult = await this._requestUserGate(error, trialOutcome);
    if (!gateResult.confirmed) {
      logger.warn(`[AutoFix] 用户拒绝或门控超时，已放弃: ${gateResult.reason}`);
      return { success: false, layer: 'ai-pipeline', iterations: iteration, gated: true, gateReason: gateResult.reason };
    }

    // Step 4: 写入正式文件 + 热替换
    logger.info(`[AutoFix] 用户已确认，开始执行补丁写入 + 热替换`);
    const commitRes = sandboxTrialRunner.commitPatchesToDisk(trialOutcome);
    if (!commitRes.success) {
      return { success: false, layer: 'ai-pipeline', iterations: iteration, error: commitRes.error };
    }

    const hotReplace = await this._executeHotReload(trialOutcome.affectedService);
    if (!hotReplace.success) {
      logger.error(`[AutoFix] 热替换失败: ${hotReplace.error}，但文件补丁已写入，需要手动重启`);
      this._sendNotification('warn', `补丁已写入但热替换失败: ${hotReplace.error}`);
      return {
        success: false,
        layer: 'ai-pipeline',
        iterations: iteration,
        committed: commitRes.applied,
        hotReplaceError: hotReplace.error,
        needManualRestart: true
      };
    }

    const message = `自动修复完成 (${iteration} 轮 AI) -> 沙箱通过 -> 用户确认 -> 热替换成功: ${trialOutcome.patchSummary}`;
    logger.info(`[AutoFix] ${message}`);
    this._sendNotification('info', message);

    eventBus.emit(SYSTEM_EVENTS?.SYSTEM_RECOVER || 'system.recover', {
      error: error.message,
      strategy: 'ai-fix-gated-hot-reload'
    });

    return {
      success: true,
      layer: 'ai-pipeline',
      iterations: iteration,
      summary: trialOutcome.summary,
      affectedService: trialOutcome.affectedService,
      patches: commitRes.applied,
      hotReplace: hotReplace
    };
  }

  async _requestUserGate(error, trialOutcome) {
    // 构造门控详情（供用户展示）
    const reproTests = (trialOutcome.reproduceResults || []).map(r => `- ${r.pass ? '✓' : '✗'} ${r.name}${r.error ? ' (' + r.error + ')' : ''}`).join('\n');
    const smokeTests = (trialOutcome.smokeResults || []).map(r => `- ${r.pass ? '✓' : '✗'} ${r.name}${r.error ? ' (' + r.error + ')' : ''}`).join('\n');
    const details =
`## 错误摘要
  类型: ${this._classify(error)}
  信息: ${(error.message || '').substring(0, 300)}

## AI 修复分析
  ${trialOutcome.summary || '无'}

## 补丁内容
  ${trialOutcome.patchSummary || '无'}
  受影响服务: ${trialOutcome.affectedService}

## 试运行测试结果
  错误复现测试:
${reproTests || '  无'}
  冒烟测试:
${smokeTests || '  无'}

## 后续动作
  1. 将补丁写入正式目录
  2. 对 ${trialOutcome.affectedService} 执行沙箱热替换
  3. 自动保留备份文件用于回滚`;

    const request = {
      operationType: 'hot_reload_fix',
      description: `AI 生成修复补丁，沙箱试运行通过，请求热替换 [${trialOutcome.affectedService}]`,
      riskLevel: 'medium',
      impact: `替换服务 ${trialOutcome.affectedService} 的 Worker，请求不会中断`,
      filesAffected: (trialOutcome.preparedPatches || []).map(p => p.rel),
      backupAvailable: true,
      rollbackPossible: true,
      details
    };

    try {
      const result = await confirmationGate.requestConfirmation(request);
      return { confirmed: !!result.confirmed, reason: result.reason || (result.confirmed ? 'confirmed' : 'user_reject') };
    } catch (e) {
      logger.error(`[AutoFix] 门控异常: ${e.message}`);
      return { confirmed: false, reason: `gate_exception: ${e.message}` };
    }
  }

  async _executeHotReload(serviceName) {
    try {
      const mod = require('../../sandbox/sandboxManager');
      const sb = (mod.sandboxManager || mod.default?.sandboxManager || new (mod.SandboxManager || mod.default || (() => ({})))());
      if (!sb.bootstrap) return { success: false, error: 'sandboxManager 未初始化' };
      const result = await sb.bootstrap.hotReloadService(serviceName, `auto-fix-${Date.now()}`);
      if (result && result.success) return { success: true, result };
      return { success: false, error: result?.error || '未知原因' };
    } catch (e) {
      return { success: false, error: `hotReload 异常: ${e.message}` };
    }
  }

  _sendNotification(level, message) {
    try {
      notificationSystem.notify({
        user_id: 0,
        message_type: `auto_fix_${level}`,
        title: `AI 自动修复 [${level === 'info' ? '成功' : level === 'warn' ? '警告' : '失败'}]`,
        content: message,
        action: level === 'info' ? 'view_history' : 'manual_review'
      }).catch(() => {});
    } catch (_) {}
  }

  _classify(error) {
    const cat = {
      database: ['SQLITE_ERROR', 'SQLITE_CORRUPT', 'connection_error', 'table_not_found', 'column_not_found'],
      network: ['ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'],
      file_system: ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EMFILE'],
      memory: ['ENOMEM'],
      dependency: ['MODULE_NOT_FOUND', 'require failed'],
      configuration: ['config_error', 'missing_config', 'invalid_config'],
      runtime: ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError']
    };
    const msg = error.message || '';
    const code = error.code || '';
    const name = error.name || '';
    for (const [k, ps] of Object.entries(cat)) {
      for (const p of ps) if (code.includes(p) || msg.includes(p) || name.includes(p)) return k;
    }
    return 'runtime';
  }
}

const autoFixCoordinator = new AutoFixCoordinator();

module.exports = { AutoFixCoordinator, autoFixCoordinator };
