// 一次性工具：生成 32x32 琥珀橙圆角方块 ICO（dev 阶段用，release 前替换品牌 icon）
const fs = require('fs');
const path = require('path');

const SIZE = 32;
const RADIUS = 9;
// #E8870A -> BGRA
const B = 0x0a, G = 0x87, R = 0xe8;

function inCorner(x, y) {
  // 圆角判断：四角距圆心
  const corners = [
    [RADIUS, RADIUS], [SIZE - 1 - RADIUS, RADIUS],
    [RADIUS, SIZE - 1 - RADIUS], [SIZE - 1 - RADIUS, SIZE - 1 - RADIUS]
  ];
  for (const [cx, cy] of corners) {
    const nearX = (x < RADIUS || x > SIZE - 1 - RADIUS);
    const nearY = (y < RADIUS || y > SIZE - 1 - RADIUS);
    if (nearX && nearY) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > RADIUS * RADIUS) return true;
    }
  }
  return false;
}

// XOR 像素：自下而上
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let row = 0; row < SIZE; row++) {
  for (let col = 0; col < SIZE; col++) {
    const y = SIZE - 1 - row; // 翻转
    const off = (row * SIZE + col) * 4;
    if (inCorner(col, y)) { pixels[off + 3] = 0; }
    else { pixels[off] = B; pixels[off + 1] = G; pixels[off + 2] = R; pixels[off + 3] = 255; }
  }
}

// AND mask：1bpp，每行 4 字节（全 0 = 不透明由 alpha 决定）
const mask = Buffer.alloc(SIZE * 4);

const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);          // biSize
bmpHeader.writeInt32LE(SIZE, 4);         // biWidth
bmpHeader.writeInt32LE(SIZE * 2, 8);     // biHeight (XOR+AND)
bmpHeader.writeUInt16LE(1, 12);          // biPlanes
bmpHeader.writeUInt16LE(32, 14);         // biBitCount

const imageData = Buffer.concat([bmpHeader, pixels, mask]);

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);   // type: icon
dir.writeUInt16LE(1, 4);   // count

const entry = Buffer.alloc(16);
entry[0] = SIZE; entry[1] = SIZE;
entry.writeUInt16LE(1, 4);                 // planes
entry.writeUInt16LE(32, 6);                // bpp
entry.writeUInt32LE(imageData.length, 8);  // bytesInRes
entry.writeUInt32LE(22, 12);               // offset = 6 + 16

const out = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([dir, entry, imageData]));
console.log('written:', out);
