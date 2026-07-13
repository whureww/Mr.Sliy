/**
 * Tree-sitter WASM下载脚本
 * 下载常用语言的Tree-sitter解析器WASM文件
 * 支持：JavaScript、TypeScript、Python、Java、Go、Rust、C、C++、C#、Ruby、PHP等
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const WASM_DIR = path.join(__dirname, '..', 'wasm');

const languageUrls = {
  javascript: 'https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.21.0/tree-sitter-javascript.wasm',
  typescript: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.21.0/tree-sitter-typescript.wasm',
  python: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.21.0/tree-sitter-python.wasm',
  java: 'https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.21.0/tree-sitter-java.wasm',
  go: 'https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.21.0/tree-sitter-go.wasm',
  rust: 'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.21.0/tree-sitter-rust.wasm',
  c: 'https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.21.0/tree-sitter-c.wasm',
  cpp: 'https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.21.0/tree-sitter-cpp.wasm',
  c_sharp: 'https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.21.0/tree-sitter-c_sharp.wasm',
  ruby: 'https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.21.0/tree-sitter-ruby.wasm',
  php: 'https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.21.0/tree-sitter-php.wasm',
  swift: 'https://github.com/tree-sitter/tree-sitter-swift/releases/download/v0.21.0/tree-sitter-swift.wasm',
  kotlin: 'https://github.com/tree-sitter/tree-sitter-kotlin/releases/download/v0.21.0/tree-sitter-kotlin.wasm',
  scala: 'https://github.com/tree-sitter/tree-sitter-scala/releases/download/v0.21.0/tree-sitter-scala.wasm'
};

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        resolve(downloadFile(response.headers.location, dest));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve(dest));
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
};

const downloadWithRetry = async (url, dest, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await downloadFile(url, dest);
    } catch (error) {
      console.log(`  下载失败 (${i + 1}/${retries}): ${error.message}`);
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
};

const downloadAllWasm = async (languages) => {
  if (!fs.existsSync(WASM_DIR)) {
    fs.mkdirSync(WASM_DIR, { recursive: true });
  }

  const langs = languages || Object.keys(languageUrls);
  let successCount = 0;
  let failCount = 0;

  for (const lang of langs) {
    const url = languageUrls[lang];
    if (!url) continue;

    const dest = path.join(WASM_DIR, `tree-sitter-${lang}.wasm`);

    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      if (size > 0) {
        successCount++;
        continue;
      }
    }

    try {
      await downloadWithRetry(url, dest);
      successCount++;
    } catch (error) {
      failCount++;
    }
  }

  return { success: successCount, fail: failCount };
};

const main = async () => {
  console.log('=== Tree-sitter WASM下载脚本 ===\n');

  if (!fs.existsSync(WASM_DIR)) {
    fs.mkdirSync(WASM_DIR, { recursive: true });
    console.log(`创建目录: ${WASM_DIR}\n`);
  }

  const args = process.argv.slice(2);
  const languages = args.length > 0 ? args : Object.keys(languageUrls);

  console.log(`准备下载 ${languages.length} 个语言解析器...\n`);

  let successCount = 0;
  let failCount = 0;

  for (const lang of languages) {
    const url = languageUrls[lang];
    if (!url) {
      console.log(`  ⚠️  不支持的语言: ${lang}`);
      continue;
    }

    const dest = path.join(WASM_DIR, `tree-sitter-${lang}.wasm`);

    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      if (size > 0) {
        console.log(`  ✅ ${lang} (已存在, ${(size / 1024).toFixed(1)} KB)`);
        successCount++;
        continue;
      }
    }

    try {
      process.stdout.write(`  📥 ${lang}... `);
      await downloadWithRetry(url, dest);
      const size = fs.statSync(dest).size;
      console.log(`完成 (${(size / 1024).toFixed(1)} KB)`);
      successCount++;
    } catch (error) {
      console.log(`失败: ${error.message}`);
      failCount++;
    }
  }

  console.log('\n=== 下载完成 ===');
  console.log(`成功: ${successCount}, 失败: ${failCount}`);

  const existingFiles = fs.readdirSync(WASM_DIR).filter(f => f.endsWith('.wasm'));
  if (existingFiles.length > 0) {
    console.log(`\n已安装的语言解析器:`);
    existingFiles.forEach(f => {
      const size = fs.statSync(path.join(WASM_DIR, f)).size;
      console.log(`  - ${f} (${(size / 1024).toFixed(1)} KB)`);
    });
  }
};

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { downloadAllWasm, downloadFile, downloadWithRetry, languageUrls, WASM_DIR };
