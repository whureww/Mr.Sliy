/**
 * 远程版本检查服务
 * 拉取版本清单 JSON 与本地 package.json 版本比对，供"检查更新"功能使用。
 *
 * 版本清单格式（托管在 Gitee/GitHub/自有服务器均可）：
 *   { "version": "3.16.0", "notes": "更新说明文本", "url": "下载页地址" }
 *
 * 更新源地址持久化在 ~/.mr-sliy/update_source.json（{ "url": "..." }），
 * 未配置时返回 checked:false 与原因，前端据此展示提示。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const pkg = require('../../../package.json');

const SOURCE_FILE = path.join(os.homedir(), '.mr-sliy', 'update_source.json');
const REQUEST_TIMEOUT = 8000;
const CURRENT_VERSION = pkg.version;

function getUpdateSourceUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));
    const url = String(cfg.url || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
  } catch (e) {
    /* 文件不存在或非法内容视为未配置 */
  }
  return '';
}

function saveUpdateSourceUrl(url) {
  const t = String(url || '').trim();
  if (t && !/^https?:\/\//i.test(t)) {
    throw new Error('更新源地址必须以 http:// 或 https:// 开头');
  }
  fs.mkdirSync(path.dirname(SOURCE_FILE), { recursive: true });
  fs.writeFileSync(SOURCE_FILE, JSON.stringify({ url: t }, null, 2), 'utf-8');
  return t;
}

/** 以 HTTP GET 拉取 JSON（最长等待 REQUEST_TIMEOUT;跟随 301/302/307/308 重定向,最多 5 跳） */
function fetchJson(target, timeoutMs = REQUEST_TIMEOUT, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (!settled) {
        settled = true;
        fn(val);
      }
    };
    try {
      const req = (target.startsWith('https:') ? https : http).get(
        target,
        { headers: { 'User-Agent': 'MRSliy-Desktop-Updater' } },
        (res) => {
          // 仓库迁移/地址变更时 GitHub 会 301(如 Mr.Sliy → Mr.Sliy--AI_Agent),
          // Node 原生请求不自动跟随,必须手动重发到 Location,否则永远 "HTTP 301"
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (maxRedirects <= 0) return done(reject, new Error('重定向次数过多'));
            const next = new URL(res.headers.location, target).toString();
            if (!/^https?:\/\//i.test(next)) return done(reject, new Error(`非法重定向地址: ${next}`));
            return done(resolve, fetchJson(next, timeoutMs, maxRedirects - 1));
          }
          if (res.statusCode !== 200) {
            res.resume();
            return done(reject, new Error(`HTTP ${res.statusCode}`));
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              done(resolve, JSON.parse(Buffer.concat(chunks).toString('utf-8')));
            } catch (e) {
              done(reject, new Error('清单不是有效 JSON'));
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', (e) => done(reject, e));
    } catch (e) {
      done(reject, e);
    }
  });
}

/** 语义化版本比较：返回 >0 / 0 / <0；忽略前缀 v 与预发布段 */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// 仓库已迁移至 Mr.Sliy--AI_Agent(旧名 Mr.Sliy 会 301;fetchJson 现可跟随重定向,双保险)
const GITHUB_LATEST_API = 'https://api.github.com/repos/whureww/Mr.Sliy--AI_Agent/releases/latest';
const INSTALLER_ASSET_RE = /^MRSLIY-Setup-.*\.exe$/i;

/** 从资产对象提取安装包信息:{ url, digest, size };无资产返回空对象 */
function pickInstallerAsset(assets) {
  const hit = (Array.isArray(assets) ? assets : []).find((a) => INSTALLER_ASSET_RE.test(String(a.name || '')));
  if (!hit) return { url: '', digest: '', size: 0 };
  // GitHub API 资产自带 sha256 摘要("sha256:hex"),供下载后完整性校验(镜像回退也靠它保证可信)
  const digest = String(hit.digest || '').toLowerCase();
  return {
    url: /^https:\/\//i.test(String(hit.browser_download_url || '')) ? String(hit.browser_download_url) : '',
    digest: /^(?:sha256:)?[0-9a-f]{64}$/.test(digest) ? digest : '',
    size: Number(hit.size) || 0
  };
}

/** 清理 release 正文用于横幅/卡片单行展示:去 Markdown 符号、压平空白 */
function cleanNotes(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*>\s]+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter(Boolean)
    .join('; ')
    .slice(0, 160);
}

/** 从 GitHub Releases 解析最新安装包资产直链；任何异常静默返回空串（不阻塞检查流程） */
async function resolveGithubReleaseAsset() {
  try {
    const release = await fetchJson(GITHUB_LATEST_API);
    const assets = Array.isArray(release && release.assets) ? release.assets : [];
    const hit = assets.find((a) => INSTALLER_ASSET_RE.test(String(a.name || '')));
    const url = String((hit && hit.browser_download_url) || '');
    return /^https:\/\//i.test(url) ? url : '';
  } catch (e) {
    return '';
  }
}

/**
 * 执行一次远程检查。
 * 默认直接对比 GitHub Releases 最新版本与本程序版本（无需用户配置任何地址），
 * 桌面端会显式上报自身版本（explicitVersion），避免误用根 package.json 的 CLI 版本号。
 * 资产名匹配 MRSLIY-Setup-*.exe 即为安装包直链。
 * 仍支持高级用法：配置了更新源清单 URL 时以清单为准（version/notes/download 字段）。
 * 返回 { checked, currentVersion, latestVersion?, updateAvailable?, notes?, url?, download?, reason? }
 */
async function checkRemoteUpdate(explicitVersion) {
  const valid = typeof explicitVersion === 'string' && /^\d+(\.\d+){1,3}/.test(explicitVersion.trim())
    ? explicitVersion.trim()
    : '';
  const currentVersion = valid || pkg.version;
  const manifestUrl = getUpdateSourceUrl();

  // 高级模式：用户配置了清单地址,以清单为准
  if (manifestUrl) {
    try {
      const manifest = await fetchJson(manifestUrl);
      const latestVersion = String((manifest && manifest.version) || '').trim();
      if (!/^\d+(\.\d+){1,3}/.test(latestVersion)) {
        return { checked: false, currentVersion, reason: '清单中的版本号无效' };
      }
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
      let download = String((manifest && manifest.download) || '');
      let digest = String((manifest && manifest.digest) || '');
      if (updateAvailable && !/^https:\/\//i.test(download)) {
        const asset = pickInstallerAsset((await fetchJson(GITHUB_LATEST_API).catch(() => null))?.assets);
        download = asset.url;
        digest = asset.digest;
      }
      return {
        checked: true,
        currentVersion,
        latestVersion,
        updateAvailable,
        notes: String((manifest && manifest.notes) || ''),
        url: String((manifest && manifest.url) || ''),
        download: /^https:\/\//i.test(download) ? download : '',
        digest
      };
    } catch (e) {
      return { checked: false, currentVersion, reason: `无法连接更新源（${e.message}）` };
    }
  }

  // 默认模式:直接读 GitHub Releases,零配置
  try {
    const release = await fetchJson(GITHUB_LATEST_API);
    const latestVersion = String((release && release.tag_name) || '').replace(/^v/i, '').trim();
    if (!/^\d+(\.\d+){1,3}/.test(latestVersion)) {
      return { checked: false, currentVersion, reason: 'GitHub Releases 版本号无效' };
    }
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    let download = '';
    let digest = '';
    if (updateAvailable) {
      const asset = pickInstallerAsset(release.assets);
      download = asset.url;
      digest = asset.digest;
    }
    return {
      checked: true,
      currentVersion,
      latestVersion,
      updateAvailable,
      notes: cleanNotes(release && release.body),
      url: String((release && release.html_url) || ''),
      download,
      digest
    };
  } catch (e) {
    return { checked: false, currentVersion, reason: `无法连接 GitHub（${e.message}）` };
  }
}

module.exports = { checkRemoteUpdate, compareVersions, getUpdateSourceUrl, saveUpdateSourceUrl, SOURCE_FILE, CURRENT_VERSION };
