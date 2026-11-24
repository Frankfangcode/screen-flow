'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y, width, height);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([name, data])) >>> 0, 0);
  return Buffer.concat([len, name, data, crc]);
}

function iconPixel(x, y, w) {
  const px = x + 0.5;
  const py = y + 0.5;
  const m = w * 0.08;
  const radius = w * 0.18;
  const inside = rounded(px, py, m, m, w - m, w - m, radius);
  if (!inside) return [0, 0, 0, 0];
  const bar = py > w * 0.46 && py < w * 0.58 && px > w * 0.22 && px < w * 0.78;
  if (bar) return [230, 163, 34, 255];
  return [22, 20, 15, 255];
}

function trayPixel(x, y, w, h) {
  const px = (x + 0.5) / w;
  const py = (y + 0.5) / h;
  const inBar = py > 0.38 && py < 0.62 && px > 0.08 && px < 0.92;
  return inBar ? [0, 0, 0, 255] : [0, 0, 0, 0];
}

function rounded(x, y, l, t, r, b, radius) {
  if (x < l || x > r || y < t || y > b) return false;
  const tests = [
    [l + radius, t + radius],
    [r - radius, t + radius],
    [l + radius, b - radius],
    [r - radius, b - radius],
  ];
  const inCorner = (x < l + radius && y < t + radius)
    || (x > r - radius && y < t + radius)
    || (x < l + radius && y > b - radius)
    || (x > r - radius && y > b - radius);
  if (!inCorner) return true;
  return tests.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2);
}

fs.writeFileSync(path.join(__dirname, 'icon.png'), png(1024, 1024, iconPixel));
fs.writeFileSync(path.join(__dirname, 'trayTemplate.png'), png(32, 32, trayPixel));
console.log('wrote icon.png and trayTemplate.png');
