/**
 * 版本号迭代脚本
 *
 * 规则:版本号三段式 major.minor.patch,每一段最大不超过 10;
 * 任一段超过 10 时自动向上迭代(patch 溢出进 minor,minor 溢出进 major)。
 *   例:0.0.9 -> 0.0.10 -> 0.1.0 -> 0.1.1 ... 0.10.10 -> 1.0.0
 *
 * 用法:
 *   node scripts/bump-version.js          # 迭代 CLI 版本(root package.json)
 *   node scripts/bump-version.js gui      # 迭代桌面 GUI 版本(gui/package.json + tauri.conf + Cargo.toml + iss)
 *   node scripts/bump-version.js gui 0.0.2  # 直接指定版本号(同样校验 <=10 规则)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = {
  cli: [path.join(ROOT, 'package.json')],
  gui: [
    path.join(ROOT, 'gui', 'package.json'),
    path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
    path.join(ROOT, 'src-tauri', 'Cargo.toml'),
    path.join(ROOT, 'installer', 'mrsliy.iss')
  ]
};

/** 校验:每一段都必须是 1~10 之间的整数(0 允许为 0) */
function validate(v) {
  const parts = String(v).split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`版本号必须是三段式数字: ${v}`);
  }
  const [ma, mi, pa] = parts.map(Number);
  for (const [name, n] of [['major', ma], ['minor', mi], ['patch', pa]]) {
    if (n > 10) throw new Error(`${name} 段不能超过 10(当前 ${n}),请向上迭代`);
  }
  return `${ma}.${mi}.${pa}`;
}

/** 迭代:patch+1;patch 超过 10 进位到 minor;minor 超过 10 进位到 major */
function nextVersion(v) {
  let [ma, mi, pa] = String(v).split('.').map(Number);
  pa += 1;
  if (pa > 10) { pa = 0; mi += 1; }
  if (mi > 10) { mi = 0; ma += 1; }
  return validate(`${ma}.${mi}.${pa}`);
}

function apply(files, newVersion) {
  for (const f of files) {
    const isJson = f.endsWith('.json');
    if (isJson) {
      const obj = JSON.parse(fs.readFileSync(f, 'utf-8'));
      obj.version = newVersion;
      fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
    } else if (f.endsWith('.toml')) {
      const text = fs.readFileSync(f, 'utf-8');
      fs.writeFileSync(f, text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${newVersion}"`));
    } else if (f.endsWith('.iss')) {
      const text = fs.readFileSync(f, 'utf-8');
      fs.writeFileSync(f, text.replace(/#define MyAppVersion\s*"[^"]*"/, `#define MyAppVersion "${newVersion}"`));
    }
  }
}

const target = process.argv[2] === 'gui' ? 'gui' : 'cli';
const files = FILES[target];
const current = JSON.parse(fs.readFileSync(files[0], 'utf-8')).version;

let updated;
if (process.argv[3]) {
  updated = validate(process.argv[3]);
} else {
  updated = nextVersion(current);
}

apply(files, updated);
console.log(`${target} 版本: ${current} -> ${updated}`);
