/**
 * 安装包下载服务
 * 从远程(GitHub Releases 等)下载新版本安装包到 ~/.mr-sliy/updates/，
 * 供"检查更新 → 自动下载 → 一键安装"流程使用。
 *
 * 设计要点:
 * - 仅允许 https;GitHub Releases 资产会 302 到 objects.githubusercontent.com,需跟随重定向(上限 5 跳)
 * - 写 .part 临时文件,完成后 rename 为 .exe;失败删除 .part,不做断点续传
 * - 版本号来自远程清单,文件名拼接前做白名单校验(防路径穿越)
 * - 500MB 大小上限;模块内保存单例下载状态,进度由 /api/update-download/status 轮询获取
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { logger } = require('../../utils/logger');

const UPDATES_DIR = path.join(os.homedir(), '.mr-sliy', 'updates');
const MAX_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_REDIRECTS = 5;
const VERSION_RE = /^[0-9A-Za-z._-]+$/;

/** @type {{status:'downloading'|'done'|'error', version, url, received, total, percent, filePath, error, req}|null} */
let current = null;
let scanned = false; // 是否已做过一次已完成安装包恢复扫描

function installerName(version) {
  return `MRSLIY-Setup-${version}.exe`;
}

/** 启动下载;已有下载进行中时抛错(路由层转 409) */
function startDownload(url, version) {
  const target = String(url || '');
  const ver = String(version || '').trim();
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
    req: null
  };
  current = state;

  logger.info(`开始下载更新安装包: v${ver} <- ${target}`);

  const file = fs.createWriteStream(partPath);
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
        fs.renameSync(partPath, finalPath);
        state.status = 'done';
        state.percent = 100;
        logger.info(`更新安装包下载完成: ${finalPath} (${(state.total / 1024 / 1024).toFixed(1)} MB)`);
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

  const request = (targetUrl, redirects) => {
    const req = https.get(
      targetUrl,
      { headers: { 'User-Agent': 'MRSliy-Desktop-Updater' } },
      (res) => {
        // 重定向跟随(GitHub Releases 资产 302 到 CDN)
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
          res.resume();
          const loc = res.headers.location;
          if (!loc || redirects >= MAX_REDIRECTS) {
            return finish(false, loc ? '重定向次数过多' : '重定向缺少目标地址');
          }
          const next = new URL(loc, targetUrl).toString();
          if (!/^https:\/\//i.test(next)) {
            return finish(false, '重定向目标非 https,已中止');
          }
          return request(next, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return finish(false, `服务器返回 HTTP ${res.statusCode}`);
        }
        const len = parseInt(res.headers['content-length'] || '', 10);
        if (Number.isFinite(len) && len > 0) state.total = len;
        res.on('data', (c) => {
          state.received += c.length;
          if (state.received > MAX_SIZE) {
            req.destroy(new Error('安装包超过 500MB 上限'));
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
    req.on('error', (e) => finish(false, e.message || '网络错误'));
    state.req = req;
  };

  request(target, 0);
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
    error: state.error
  };
}

/** 查询状态;首次调用时扫描更新目录,恢复"已下载完成但未安装"的状态 */
function getStatus() {
  if (!current && !scanned) {
    scanned = true;
    try {
      const files = fs
        .readdirSync(UPDATES_DIR)
        .filter((f) => /^MRSLIY-Setup-.+\.exe$/i.test(f))
        .map((f) => {
          const p = path.join(UPDATES_DIR, f);
          return { p, mtime: fs.statSync(p).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) {
        const name = path.basename(files[0].p);
        const m = name.match(/^MRSLIY-Setup-(.+)\.exe$/i);
        current = {
          status: 'done',
          version: m ? m[1] : '',
          url: '',
          received: 0,
          total: 0,
          percent: 100,
          filePath: files[0].p,
          error: '',
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
