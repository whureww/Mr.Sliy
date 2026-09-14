/**
 * 安装包下载服务
 * 从远程(GitHub Releases 等)下载新版本安装包到 ~/.mr-sliy/updates/，
 * 供"检查更新 → 自动下载 → 一键安装"流程使用。
 *
 * 设计要点:
 * - 仅允许 https;GitHub Releases 资产会 302 到 objects.githubusercontent.com,需跟随重定向(上限 5 跳)
 * - 直连失败(连接超时/被重置/5xx/龟速)时自动回退镜像加速前缀重试(仅对 github.com 资产生效);
 *   回退下载完成后用 GitHub API 提供的 sha256 digest 校验完整性,不匹配则删除并报错
 * - 空闲(无数据流动)超过 STALL_TIMEOUT 判定网络停滞;开跑 SLOW_AFTER 后平均速度低于
 *   SLOW_SPEED 判定为龟速不可用(直连 GitHub CDN 常见),两者都会主动中止并切换下一候选源
 * - 写 .part 临时文件,完成后 rename 为 .exe;失败删除 .part,不做断点续传
 * - 版本号来自远程清单,文件名拼接前做白名单校验(防路径穿越)
 * - 500MB 大小上限;模块内保存单例下载状态,进度由 /api/update-download/status 轮询获取
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { logger } = require('../../utils/logger');
const { compareVersions } = require('./versionCheck');

const UPDATES_DIR = path.join(os.homedir(), '.mr-sliy', 'updates');
const MAX_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_REDIRECTS = 5;
const STALL_TIMEOUT = 30 * 1000; // 空闲 30s 无数据视为停滞
const SLOW_AFTER = 45 * 1000; // 开跑 45s 后开始评估平均速度
// 平均速度阈值 100KB/s。注意单位:下方比较式是 received(bytes)/elapsed(ms),而
// bytes/ms 数值上恰好等于 KB/s,故这里写 100(曾误写 100*1024,等效 100MB/s,
// 导致任何下载在 45s 时必然被误杀——安装包才 ~50MB,全部下完 ratio 也只有 ~1100)
const SLOW_SPEED = 100;
const VERSION_RE = /^[0-9A-Za-z._-]+$/;
/** 镜像加速前缀(按顺序尝试);仅对 github.com 直链生效,配合 sha256 校验保证完整性 */
const MIRROR_PREFIXES = ['https://ghfast.top/', 'https://mirror.ghproxy.com/'];

/** @type {{status:'downloading'|'done'|'error', version, url, received, total, percent, filePath, error, via, req}|null} */
let current = null;
let scanned = false; // 是否已做过一次已完成安装包恢复扫描

function installerName(version) {
  return `MRSLIY-Setup-${version}.exe`;
}

/** 规范化 digest:"sha256:hex" 或裸 hex → 小写 hex;非法返回空串 */
function normalizeDigest(digest) {
  const d = String(digest || '').trim().toLowerCase();
  const m = d.match(/^(?:sha256:)?([0-9a-f]{64})$/);
  return m ? m[1] : '';
}

/** 该 URL 是否属于 GitHub Releases 资产(镜像回退仅对此类地址启用) */
function isGithubAsset(url) {
  try {
    const u = new URL(url);
    return (u.hostname === 'github.com' || u.hostname.endsWith('.githubusercontent.com')) && u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 启动下载;已有下载进行中时抛错(路由层转 409) */
function startDownload(url, version, digest) {
  const target = String(url || '');
  const ver = String(version || '').trim();
  const expectHash = normalizeDigest(digest);
  if (!/^https:\/\//i.test(target)) {
    throw new Error('安装包地址必须以 https:// 开头');
  }
  if (!VERSION_RE.test(ver)) {
    throw new Error('版本号包含非法字符');
  }
  if (current && current.status === 'downloading') {
    const e = new Error('已有下载任务进行中');
    e.code = 'BUSY';
    throw e;
  }

  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  const finalPath = path.join(UPDATES_DIR, installerName(ver));
  const partPath = `${finalPath}.part`;

  const state = {
    status: 'downloading',
    version: ver,
    url: target,
    received: 0,
    total: 0,
    percent: 0,
    filePath: finalPath,
    error: '',
    via: '',
    req: null
  };
  current = state;

  logger.info(`开始下载更新安装包: v${ver} <- ${target}${expectHash ? ' (带 sha256 校验)' : ''}`);

  const file = fs.createWriteStream(partPath);
  let hash = expectHash ? crypto.createHash('sha256') : null; // 切换下载源时必须重建(重置已哈希的部分数据)
  let settled = false;
  const finish = (ok, errMsg) => {
    if (settled) return;
    settled = true;
    try {
      file.end();
    } catch (e2) {
      /* ignore */
    }
    if (ok) {
      try {
        // 完整性校验:digest 由检查更新阶段从 GitHub API 获取,镜像源也必须匹配
        if (hash) {
          const actual = hash.digest('hex');
          if (actual !== expectHash) {
            try { fs.unlinkSync(partPath); } catch (e3) { /* ignore */ }
            state.status = 'error';
            state.error = '安装包校验失败(sha256 不匹配),已删除,请重试或前往下载页手动下载';
            logger.warn(`更新包校验失败: expected=${expectHash} actual=${actual}`);
            state.req = null;
            return;
          }
        }
        fs.renameSync(partPath, finalPath);
        state.status = 'done';
        state.percent = 100;
        logger.info(`更新安装包下载完成: ${finalPath} (${((state.total || state.received) / 1024 / 1024).toFixed(1)} MB, via ${state.via || 'direct'})`);
      } catch (e) {
        state.status = 'error';
        state.error = `保存安装包失败: ${e.message}`;
        logger.warn(state.error);
      }
    } else {
      try {
        fs.unlinkSync(partPath);
      } catch (e) {
        /* ignore */
      }
      state.status = 'error';
      state.error = errMsg || '下载失败';
      logger.warn(`更新下载失败: ${state.error}`);
    }
    state.req = null;
  };

  /** 候选地址序列:直链在前,github 资产失败后追加镜像前缀 */
  const buildCandidates = () => {
    const list = [target];
    if (isGithubAsset(target)) {
      for (const p of MIRROR_PREFIXES) list.push(p + target);
    }
    return list;
  };

  const request = (targetUrl, redirects, candidates) => {
    // 网络级失败后的回退入口:弹出下一个候选(直链 → 镜像1 → 镜像2)
    const failover = (reason) => {
      const next = candidates.shift();
      if (next) {
        logger.warn(`下载源失败(${reason}),切换源: ${next.slice(0, 80)}...`);
        state.via = next !== target ? 'mirror' : '';
        request(next, 0, candidates);
      } else {
        finish(false, reason);
      }
    };

    const req = https.get(
      targetUrl,
      {
        headers: { 'User-Agent': 'MRSliy-Desktop-Updater' },
        timeout: STALL_TIMEOUT // 连接建立超时;建立后由 socket 空闲超时接管
      },
      (res) => {
        // 重定向跟随(GitHub Releases 资产 302 到 CDN)
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
          res.resume();
          const loc = res.headers.location;
          if (!loc || redirects >= MAX_REDIRECTS) {
            return failover(loc ? '重定向次数过多' : '重定向缺少目标地址');
          }
          const next = new URL(loc, targetUrl).toString();
          if (!/^https:\/\//i.test(next)) {
            return failover('重定向目标非 https,已中止');
          }
          return request(next, redirects + 1, candidates);
        }
        // 源站侧失败:镜像通常能绕过限流/区域阻断
        if ((res.statusCode || 0) >= 500 || res.statusCode === 403 || res.statusCode === 429) {
          res.resume();
          return failover(`服务器返回 HTTP ${res.statusCode}`);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return finish(false, `服务器返回 HTTP ${res.statusCode}`);
        }
        const len = parseInt(res.headers['content-length'] || '', 10);
        // 新一轮响应(重定向后的最终体/切换源):重置进度与哈希,避免跨源累加
        state.received = 0;
        state.total = Number.isFinite(len) && len > 0 ? len : 0;
        state.percent = 0;
        if (hash) hash = crypto.createHash('sha256');
        // 空闲停滞/低速看门狗:传输中 30s 无数据,或开跑 45s 后平均速度低于阈值(涓涓细流式
        // 的直连 GitHub CDN 连接),都判定为不可用,主动中止并切换下一候选源
        const startedAt = Date.now();
        res.on('data', (c) => {
          res.setTimeout(STALL_TIMEOUT);
          state.received += c.length;
          if (hash) hash.update(c);
          if (state.received > MAX_SIZE) {
            req.destroy(new Error('安装包超过 500MB 上限'));
            return;
          }
          const elapsed = Date.now() - startedAt;
          if (elapsed > SLOW_AFTER && state.received / elapsed < SLOW_SPEED) {
            req.destroy(new Error('下载速度过慢(直连源不可用)'));
            return;
          }
          if (state.total > 0) {
            state.percent = Math.min(99, Math.floor((state.received / state.total) * 100));
          }
        });
        res.pipe(file);
        file.on('finish', () => finish(true));
      }
    );
    req.on('timeout', () => {
      // 覆盖连接超时与传输停滞两种情况
      req.destroy(new Error('网络连接超时(无法直连下载源)'));
    });
    req.on('error', (e) => {
      // 连接被重置/超时等网络级错误 → 尝试下一候选源
      failover(e.message || '网络错误');
    });
    state.req = req;
  };

  request(target, 0, buildCandidates().slice(1));
  return snapshot(state);
}

function snapshot(state) {
  if (!state) return { status: 'idle' };
  return {
    status: state.status,
    version: state.version,
    url: state.url,
    received: state.received,
    total: state.total,
    percent: state.percent,
    filePath: state.status === 'done' || state.status === 'error' ? state.filePath : '',
    error: state.error,
    via: state.via
  };
}

/** 查询状态;首次调用时扫描更新目录,恢复"已下载完成但未安装"的状态。
 *  currentVersion(可选,GUI 上报自身版本):恢复时仅采纳比它更新的安装包——
 *  否则历史残留的同版/旧版安装包会被恢复成"可安装",用户点检查更新后一键装回同版本。 */
function getStatus(currentVersion) {
  if (!current && !scanned) {
    scanned = true;
    try {
      // 门控版本非法时视为未传(保持旧行为),正常只有 GUI 调用且始终携带合法版本
      const gate =
        typeof currentVersion === 'string' && /^\d+(\.\d+){1,3}/.test(currentVersion.trim())
          ? currentVersion.trim()
          : '';
      const files = fs
        .readdirSync(UPDATES_DIR)
        .filter((f) => /^MRSLIY-Setup-.+\.exe$/i.test(f))
        .map((f) => {
          const p = path.join(UPDATES_DIR, f);
          const m = f.match(/^MRSLIY-Setup-(.+)\.exe$/i);
          return { p, version: m ? m[1] : '', mtime: fs.statSync(p).mtimeMs };
        })
        .filter((x) => !gate || compareVersions(x.version, gate) > 0)
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) {
        current = {
          status: 'done',
          version: files[0].version,
          url: '',
          received: 0,
          total: 0,
          percent: 100,
          filePath: files[0].p,
          error: '',
          via: '',
          req: null
        };
      }
    } catch (e) {
      /* 目录不存在等情况视为无记录 */
    }
  }
  return snapshot(current);
}

/** 取消下载(仅下载中有效) */
function cancelDownload() {
  if (current && current.status === 'downloading' && current.req) {
    const req = current.req;
    current.req = null;
    req.destroy(new Error('已取消'));
    return true;
  }
  return false;
}

module.exports = { startDownload, getStatus, cancelDownload, UPDATES_DIR };
