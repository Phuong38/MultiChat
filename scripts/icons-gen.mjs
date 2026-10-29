import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowStride = 1 + size * 4;
  const raw = Buffer.alloc(size * rowStride);
  for (let y = 0; y < size; y += 1) {
    const rowOff = y * rowStride;
    raw[rowOff] = 0;
    const srcOff = y * size * 4;
    rgba.copy(raw, rowOff + 1, srcOff, srcOff + size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function mixRgb(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function inSquircle(u, v, cx, cy, rx, ry, exp = 4.6) {
  const dx = Math.abs(u - cx) / rx;
  const dy = Math.abs(v - cy) / ry;
  return dx ** exp + dy ** exp <= 1;
}

function inRoundedRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const qx = Math.max(x0 + r - u, 0, u - (x1 - r));
  const qy = Math.max(y0 + r - v, 0, v - (y1 - r));
  return qx * qx + qy * qy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq)) : 0;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function messengerGradient(u, v) {
  const t = Math.max(0, Math.min(1, u * 0.65 + (1 - v) * 0.55 - 0.1));
  if (t < 0.52) {
    return mixRgb([0, 148, 255], [160, 51, 255], t / 0.52);
  }
  return mixRgb([160, 51, 255], [255, 82, 128], (t - 0.52) / 0.48);
}

const TELEGRAM_PLANE_OUTER = [
  [0.21, 0.51],
  [0.78, 0.27],
  [0.67, 0.76],
  [0.49, 0.62],
  [0.4, 0.71],
  [0.41, 0.57]
];

const TELEGRAM_PLANE_FOLD = [
  [0.41, 0.57],
  [0.73, 0.31],
  [0.49, 0.62]
];

const MESSENGER_BOLT = [
  [0.3, 0.57],
  [0.47, 0.39],
  [0.55, 0.47],
  [0.7, 0.39],
  [0.53, 0.58],
  [0.45, 0.5]
];

function sampleBento(u, v) {
  if (!inSquircle(u, v, 0.5, 0.5, 0.455, 0.455)) return [0, 0, 0, 0];
  let rgb = mixRgb([24, 30, 44], [11, 14, 21], (u + v) * 0.5);
  if (!inSquircle(u, v, 0.5, 0.5, 0.435, 0.435)) {
    rgb = mixRgb(rgb, [75, 92, 128], 0.42);
  }

  // Left Main Focus pane (Zalo blue)
  if (inRoundedRect(u, v, 0.17, 0.17, 0.53, 0.83, 0.065)) {
    rgb = mixRgb([0, 104, 255], [45, 142, 255], (1 - v) * 0.7 + u * 0.3);
  }
  // Sub-1 (Messenger gradient)
  else if (inRoundedRect(u, v, 0.585, 0.17, 0.83, 0.36, 0.048)) {
    rgb = messengerGradient((u - 0.585) / 0.245, (v - 0.17) / 0.19);
  }
  // Sub-2 (Telegram cyan)
  else if (inRoundedRect(u, v, 0.585, 0.405, 0.83, 0.595, 0.048)) {
    rgb = mixRgb([42, 171, 238], [28, 142, 212], (v - 0.405) / 0.19);
  }
  // Sub-3 (Discord blurple)
  else if (inRoundedRect(u, v, 0.585, 0.64, 0.83, 0.83, 0.048)) {
    rgb = mixRgb([88, 101, 242], [71, 82, 196], (v - 0.64) / 0.19);
  }
  return [rgb[0], rgb[1], rgb[2], 255];
}

function sampleZalo(u, v) {
  if (!inSquircle(u, v, 0.5, 0.5, 0.455, 0.455)) return [0, 0, 0, 0];
  let rgb = mixRgb([10, 122, 255], [0, 86, 224], v * 0.8 + u * 0.2);
  const stroke = 0.052;
  const inZ =
    distToSegment(u, v, 0.31, 0.31, 0.69, 0.31) <= stroke ||
    distToSegment(u, v, 0.69, 0.31, 0.31, 0.69) <= stroke ||
    distToSegment(u, v, 0.31, 0.69, 0.69, 0.69) <= stroke;
  if (inZ) {
    rgb = [255, 255, 255];
  }
  return [rgb[0], rgb[1], rgb[2], 255];
}

function sampleMessenger(u, v) {
  if (!inSquircle(u, v, 0.5, 0.5, 0.455, 0.455)) return [0, 0, 0, 0];
  const bg = messengerGradient(u, v);
  const dx = (u - 0.5) / 0.285;
  const dy = (v - 0.475) / 0.255;
  const inBubbleBody = dx * dx + dy * dy <= 1;
  const inBubbleTail = pointInPolygon(u, v, [
    [0.33, 0.63],
    [0.32, 0.77],
    [0.46, 0.69]
  ]);
  if ((inBubbleBody || inBubbleTail) && !pointInPolygon(u, v, MESSENGER_BOLT)) {
    return [255, 255, 255, 255];
  }
  return [bg[0], bg[1], bg[2], 255];
}

function sampleTelegram(u, v) {
  if (!inSquircle(u, v, 0.5, 0.5, 0.455, 0.455)) return [0, 0, 0, 0];
  let rgb = mixRgb([46, 179, 244], [28, 144, 214], v);
  if (pointInPolygon(u, v, TELEGRAM_PLANE_OUTER)) {
    rgb = pointInPolygon(u, v, TELEGRAM_PLANE_FOLD) ? [212, 238, 252] : [255, 255, 255];
  }
  return [rgb[0], rgb[1], rgb[2], 255];
}

function sampleDiscord(u, v) {
  if (!inSquircle(u, v, 0.5, 0.5, 0.455, 0.455)) return [0, 0, 0, 0];
  const bg = mixRgb([96, 108, 246], [71, 82, 196], v);
  const inHead = inSquircle(u, v, 0.5, 0.51, 0.285, 0.21, 3.2);
  const leftEye = Math.hypot((u - 0.4) / 0.052, (v - 0.51) / 0.058) <= 1;
  const rightEye = Math.hypot((u - 0.6) / 0.052, (v - 0.51) / 0.058) <= 1;
  const topNotch = Math.hypot((u - 0.5) / 0.08, (v - 0.29) / 0.04) <= 1;
  const bottomCut = Math.hypot((u - 0.5) / 0.11, (v - 0.74) / 0.055) <= 1;
  if (inHead && !leftEye && !rightEye && !topNotch && !bottomCut) {
    return [255, 255, 255, 255];
  }
  return [bg[0], bg[1], bg[2], 255];
}

const SAMPLERS = {
  bento: sampleBento,
  zalo: sampleZalo,
  messenger: sampleMessenger,
  telegram: sampleTelegram,
  discord: sampleDiscord
};

export function renderIconPng(kind, size) {
  const sampler = SAMPLERS[kind];
  if (!sampler) {
    throw new Error(`Unknown icon kind: ${String(kind)}`);
  }
  const rgba = Buffer.alloc(size * size * 4);
  const grid = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;
      for (let sy = 0; sy < grid; sy += 1) {
        const v = (y + (sy + 0.5) / grid) / size;
        for (let sx = 0; sx < grid; sx += 1) {
          const u = (x + (sx + 0.5) / grid) / size;
          const [sr, sg, sb, sa] = sampler(u, v);
          const alphaFrac = sa / 255;
          rAcc += sr * alphaFrac;
          gAcc += sg * alphaFrac;
          bAcc += sb * alphaFrac;
          aAcc += sa;
        }
      }
      const samples = grid * grid;
      const finalA = Math.round(aAcc / samples);
      const px = (y * size + x) * 4;
      if (finalA <= 0) {
        rgba[px] = 0;
        rgba[px + 1] = 0;
        rgba[px + 2] = 0;
        rgba[px + 3] = 0;
      } else {
        const weight = aAcc / 255;
        rgba[px] = Math.max(0, Math.min(255, Math.round(rAcc / weight)));
        rgba[px + 1] = Math.max(0, Math.min(255, Math.round(gAcc / weight)));
        rgba[px + 2] = Math.max(0, Math.min(255, Math.round(bAcc / weight)));
        rgba[px + 3] = finalA;
      }
    }
  }
  return encodeRgbaPng(size, rgba);
}

export function generateAllIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  const specs = [
    ['icon-16.png', 'bento', 16],
    ['icon-32.png', 'bento', 32],
    ['icon-48.png', 'bento', 48],
    ['icon-128.png', 'bento', 128],
    ['provider-zalo-128.png', 'zalo', 128],
    ['provider-messenger-128.png', 'messenger', 128],
    ['provider-telegram-128.png', 'telegram', 128],
    ['provider-discord-128.png', 'discord', 128]
  ];
  const written = [];
  for (const [filename, kind, size] of specs) {
    const fullPath = resolve(outDir, filename);
    writeFileSync(fullPath, renderIconPng(kind, size));
    written.push(fullPath);
  }
  return written;
}
