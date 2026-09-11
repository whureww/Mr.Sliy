/**
 * 从 gui/src/assets/logo.svg 生成桌面端全套图标:
 *   src-tauri/icons/icon.ico  (16/24/32/48/64/128/256,Windows exe 资源 + Inno SetupIconFile)
 * logo 更新后重跑:node scripts/gen-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'gui', 'src', 'assets', 'logo.svg');
const OUT_DIR = path.join(ROOT, 'src-tauri', 'icons');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 1024px 母版:SVG 声明 width=1024,sharp 直接按该尺寸栅格化
  const master = await sharp(SVG, { density: 96 })
    .resize(1024, 1024)
    .png()
    .toBuffer();

  // 各尺寸 PNG(ICO 内部层)
  const layers = [];
  for (const size of SIZES) {
    const png = await sharp(master).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
    layers.push({ size, png });
  }

  const ico = await pngToIco(layers.map((l) => l.png));
  const out = path.join(OUT_DIR, 'icon.ico');
  fs.writeFileSync(out, ico);
  console.log(`written ${out} (${ico.length} bytes, ${SIZES.length} layers)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
