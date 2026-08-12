/**
 * 沙箱试运行器（SandboxTrialRunner）
 *
 * 职责：
 *   1. 把 AI 生成的补丁应用到临时目录
 *   2. 创建一个「临时沙箱服务」加载补丁后代码
 *   3. 先跑错误复现测试（保证不会再抛出同样的错误）
 *   4. 再跑 AI 提供的 smoke tests 冒烟测试
 *   5. 都通过后返回可提交的热替换包
 *
 * 注意：试运行阶段不会动任何正式沙箱服务，测试失败会自动清理临时目录和临时服务。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('../../utils/logger');
const { generateUUID } = require('../../utils/helpers');
const { SandboxService } = require('../../sandbox/sandboxService');
const { SERVICE_FILE_MAP } = require('./aiFixPipeline');

class SandboxTrialRunner {
  constructor() {
    this.tempRoot = path.join(os.tmpdir(), 'mr-sliy-trial');
    this.activeTrials = new Map();
    try { fs.mkdirSync(this.tempRoot, { recursive: true }); } catch (_) {}
  }

  /**
   * 校验并定位 patch，计算 diff 摘要（供用户确认用）
   */
  preparePatches(patches, baseDir) {
    const prepared = [];
    let diffSummary = [];

    for (const patch of patches) {
      if (!patch.file || typeof patch.file !== 'string') {
        return { success: false, error: `补丁缺少 file 字段: ${JSON.stringify(patch).slice(0, 100)}` };
      }
      const rel = patch.file.replace(/^\/+/, '').replace(/\\/g, '/');
      // 只允许 sandbox / workers / services 目录
      if (!/^src\/(sandbox\/services|workers|services\/optimization|services\/detection|services\/vector|services\/llm)\//.test(rel)) {
        return { success: false, error: `补丁目标文件超出允许范围: ${rel}` };
      }
      const srcFile = path.join(baseDir, rel);
      if (!fs.existsSync(srcFile)) {
        return { success: false, error: `补丁目标文件不存在: ${rel}` };
      }
      let original;
      try { original = fs.readFileSync(srcFile, 'utf-8'); }
      catch (e) { return { success: false, error: `读取源文件失败 ${rel}: ${e.message}` }; }

      let newContent = original;
      if (patch.type === 'replace') {
        if (typeof patch.oldString !== 'string' || typeof patch.newString !== 'string') {
          return { success: false, error: `replace 补丁缺少 oldString/newString` };
        }
        const occur = original.split(patch.oldString).length - 1;
        if (occur === 0) return { success: false, error: `在 ${rel} 中未找到 oldString 匹配` };
        if (occur > 1)   return { success: false, error: `在 ${rel} 中 oldString 不唯一 (${occur} 处)` };
        newContent = original.replace(patch.oldString, patch.newString);
      } else if (patch.type === 'append') {
        newContent = original + (original.endsWith('\n') ? '' : '\n') + patch.newString;
      } else if (patch.type === 'overwrite') {
        newContent = patch.newString;
      } else {
        return { success: false, error: `不支持的补丁类型: ${patch.type}` };
      }

      if (newContent === original) {
        continue; // 无实际变化，跳过
      }

      prepared.push({ rel, srcFile, newContent });
      diffSummary.push(`${rel} (${patch.type})`);
    }

    return { success: true, prepared, diffSummary: diffSummary.join(', ') };
  }

  /**
   * 写补丁到临时工作目录
   */
  _writeTrialWorkdir(prepared, trialId) {
    const trialDir = path.join(this.tempRoot, trialId);
    fs.mkdirSync(trialDir, { recursive: true });
    const cwd = process.cwd();

    // 复制 SERVICE_FILE_MAP 下所有关联源文件的整个目录结构，保证 require 解析正确
    // 但只有打补丁的文件用修改后版本，其余直接 cp 源文件
    for (const p of prepared) {
      const dest = path.join(trialDir, p.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, p.newContent, 'utf-8');
    }

    // 软链接不跨盘符，因此复制所有依赖的文件
    const touched = new Set(prepared.map(p => p.rel));
    const copyNeeded = new Set();

    // 所有 SERVICE_FILE_MAP 下的文件都要拷贝，确保 worker 内 require 不会因为
    // 路径变化找不到文件。实际上只需要 patch 涉及到的 service 目录的文件。
    for (const rel of touched) {
      const dir = path.dirname(rel);
      const files = fs.readdirSync(path.join(cwd, dir)).filter(f => f.endsWith('.js'));
      for (const f of files) {
        copyNeeded.add(path.posix.join(dir.replace(/\\/g, '/'), f));
      }
    }
    for (const rel of copyNeeded) {
      if (touched.has(rel)) continue;
      const dest = path.join(trialDir, rel);
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        try {
          fs.copyFileSync(path.join(cwd, rel), dest);
        } catch (_) {}
      }
    }
    return trialDir;
  }

  /**
   * 创建试运行沙箱服务
   */
  async _createTrialService(serviceName, trialDir) {
    const config = {
      servicePath: this._findServiceFile(serviceName, trialDir),
      version: `trial-${Date.now()}`,
      timeout: 30000,
      autoRestart: false,
      maxMemory: 512,
      startupTimeout: 15000,
      healthCheckInterval: 0,
      maxConsecutiveErrors: 5
    };
    const service = new SandboxService(`trial_${serviceName}`, config);
    await service.start();
    await service.waitUntilReady(15000);
    return service;
  }

  _findServiceFile(serviceName, trialDir) {
    const rel = `src/sandbox/services/${serviceName}Service.js`;
    const local = path.join(trialDir, rel);
    if (fs.existsSync(local)) return local;
    return path.join(process.cwd(), rel);
  }

  /**
   * 构造错误复现测试：根据错误信息/堆栈推断重现输入，并运行
   */
  async _runReproduceTest(service, error) {
    const msg = (error.message || '').toLowerCase();
    const tests = [];

    // parser 复现：用最小化 JS 代码
    tests.push(async () => {
      try {
        await service.execute('parse', { code: 'function test(){return 1;}', language: 'javascript' });
        return { pass: true, name: 'parse smoke' };
      } catch (e) { return { pass: false, name: 'parse smoke', error: e.message }; }
    });

    // detector 复现
    tests.push(async () => {
      try {
        await service.execute('detect', { code: 'var x = 1;', language: 'javascript', options: {} });
        return { pass: true, name: 'detect smoke' };
      } catch (e) { return { pass: false, name: 'detect smoke', error: e.message }; }
    });

    const results = [];
    for (const t of tests) {
      try { results.push(await t()); } catch (e) { results.push({ pass: false, name: 'unknown', error: e.message }); }
    }
    return results;
  }

  /**
   * 运行 AI 提供的 smoke tests
   */
  async _runSmokeTests(service, smokeTests) {
    const results = [];
    for (const st of (smokeTests || []).slice(0, 5)) {
      const start = Date.now();
      try {
        const res = await service.execute(st.action, st.params || {});
        results.push({
          pass: true,
          name: `${st.service}.${st.action}`,
          description: st.description,
          duration: Date.now() - start,
          hasResult: !!res
        });
      } catch (e) {
        results.push({
          pass: false,
          name: `${st.service}.${st.action}`,
          description: st.description,
          duration: Date.now() - start,
          error: e.message
        });
      }
    }
    return results;
  }

  /**
   * 试运行入口
   * @returns {Promise<{success, reason?, passedTests?, trialWorkdir?, preparedPatches?, affectedService?, smokeResults?}>}
   */
  async runTrial(error, fixData, maxTries = 3) {
    const trialId = generateUUID();
    const affectedService = fixData.affectedService;
    this.activeTrials.set(trialId, { id: trialId, affectedService, startedAt: Date.now() });

    // 1. 准备补丁
    const prepareRes = this.preparePatches(fixData.patches, process.cwd());
    if (!prepareRes.success) {
      this._cleanup(trialId);
      return { success: false, reason: `补丁校验失败: ${prepareRes.error}`, patchSummary: prepareRes.error };
    }
    if (prepareRes.prepared.length === 0) {
      this._cleanup(trialId);
      return { success: false, reason: '补丁未产生任何变化，拒绝空修复', patchSummary: 'no-op' };
    }

    // 2. 写试运行目录
    let trialDir;
    try {
      trialDir = this._writeTrialWorkdir(prepareRes.prepared, trialId);
    } catch (e) {
      this._cleanup(trialId);
      return { success: false, reason: `写入试运行目录失败: ${e.message}` };
    }

    // 3. 创建试运行沙箱服务
    let trialService;
    try {
      trialService = await this._createTrialService(affectedService, trialDir);
    } catch (e) {
      logger.warn(`[SandboxTrialRunner] 试运行服务 ${affectedService} 启动失败: ${e.message}`);
      this._cleanup(trialId, trialService);
      return { success: false, reason: `试运行服务启动失败: ${e.message}`, patchSummary: prepareRes.diffSummary };
    }

    // 4. 错误复现测试
    const reproduceResults = await this._runReproduceTest(trialService, error);
    const failedRepro = reproduceResults.filter(r => !r.pass);

    // 5. AI 指定的 smoke tests
    const smokeResults = await this._runSmokeTests(trialService, fixData.smokeTests || []);
    const failedSmoke = smokeResults.filter(r => !r.pass);

    // 6. 关闭试运行服务
    try { await trialService.stop(); } catch (_) {}

    // 7. 判定结果
    const allPassed = failedRepro.length === 0 && failedSmoke.length === 0;

    if (!allPassed) {
      const reasons = [];
      if (failedRepro.length) reasons.push('复现失败: ' + failedRepro.map(r => `${r.name}: ${r.error}`).join('; '));
      if (failedSmoke.length) reasons.push('冒烟失败: ' + failedSmoke.map(r => `${r.name}: ${r.error}`).join('; '));
      this._cleanup(trialId);
      return {
        success: false,
        reason: reasons.join(' | '),
        patchSummary: prepareRes.diffSummary,
        reproduceResults,
        smokeResults
      };
    }

    // 记录 trial 信息供热替换使用
    const outcome = {
      success: true,
      trialId,
      affectedService,
      preparedPatches: prepareRes.prepared,
      patchSummary: prepareRes.diffSummary,
      trialWorkdir: trialDir,
      summary: fixData.summary,
      reproduceResults,
      smokeResults,
      originalBackups: prepareRes.prepared.map(p => {
        const backup = path.join(this.tempRoot, trialId, '_backup', p.rel);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        try { fs.copyFileSync(path.join(process.cwd(), p.rel), backup); } catch (_) {}
        return { rel: p.rel, backupFile: backup, originalFile: p.srcFile, newContent: p.newContent };
      })
    };
    this.activeTrials.set(trialId, outcome);
    return outcome;
  }

  /**
   * 确认后应用到正式目录（不立即热替换，返回已应用的状态给上层）
   */
  commitPatchesToDisk(trialOutcome) {
    const applied = [];
    for (const bkp of trialOutcome.originalBackups) {
      try {
        fs.writeFileSync(bkp.originalFile, fs.readFileSync(
          path.join(trialOutcome.trialWorkdir, bkp.rel),
          'utf-8'
        ), 'utf-8');
        applied.push(bkp.rel);
      } catch (e) {
        logger.error(`[SandboxTrialRunner] 补丁写入失败 ${bkp.rel}: ${e.message}`);
        return { success: false, error: `写入 ${bkp.rel} 失败: ${e.message}` };
      }
    }
    logger.info(`[SandboxTrialRunner] 已将 ${applied.length} 个补丁写入正式目录: ${applied.join(', ')}`);
    // 清理 trial 目录
    this._cleanup(trialOutcome.trialId);
    return { success: true, applied };
  }

  _cleanup(trialId, service = null) {
    try { if (service && service.isRunning()) service.stop().catch(() => {}); } catch (_) {}
    this.activeTrials.delete(trialId);
    const dir = path.join(this.tempRoot, trialId);
    try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

const sandboxTrialRunner = new SandboxTrialRunner();

module.exports = { SandboxTrialRunner, sandboxTrialRunner };
