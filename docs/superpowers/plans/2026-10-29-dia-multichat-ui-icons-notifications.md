# Dia Multi-Chat Bento Phase 2 (UI, Icons & Notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nang cap toan dien bo Icon Retina, giao dien Workspace (Auto-Hide Top Drawer, 28px Matte Header, Tactile Splitter, Zero-Scroll-Loss Maximize 100%, tieng Viet UTF-8), thong bao macOS icon rieng tung app kem ten nguoi gui/preview, nhan dien focus khung thuc te, va loai bo triet de cac hoi thoai da tat thong bao (muted chats) tren Telegram cung 3 app con lai.

**Architecture:** Sinh PNG icon khử rang cua 4x4 SSAA bang Node thuần luc build (`scripts/icons-gen.mjs`), ket hop SVG vector inline (`src/workspace/icons.ts`) va `<canvas>` favicon dong (`src/workspace/favicon.ts`). Bo loc 3 lop trong `src/providers/registry.ts` va `src/content/frame-agent.isolated.ts` loai tru badge/row muted va trich xuat `sender + snippet` tieng Viet, dong bo qua `NotifyRouter` va `chrome.action.setBadgeText` trong MV3 Service Worker.

**Tech Stack:** TypeScript 5.6 (strict), Chrome Extension Manifest V3, esbuild, Vanilla CSS Grid + Inline SVG + Canvas 2D, Vitest + jsdom, Playwright (real Chromium).

## Global Constraints

- Tuyet doi GIU NGUYEN truong `"key"` trong `public/manifest.json` de Extension ID co dinh la `ndcplbpbnmkeikikgmpgkaaiefmecmjh` (khong lam mat phien dang nhap Zalo/Messenger/Telegram/Discord tren Dia Browser).
- Khong cai them bat ky runtime UI dependency hay native binary nao (`package.json` dependencies khong doi).
- Khong bao gio dung ky tu em-dash hoac en-dash trong code, UI copy, comment, Markdown, hay commit message; chi dung dau gach ngang ASCII `-` hoac dau cham giua `•` trong tieu de thong bao.
- Khi viet commit message, KHONG BAO GIO them `Co-Authored-By` ten agent.
- Toan bo chuoi hien thi cho nguoi dung tren UI va thong bao macOS phai dung tieng Viet UTF-8 co dau chuan xac.
- Tren Telegram, khi danh sach chat DOM (`.chatlist-chat` hoac `.ListItem.Chat`) da mount, bo qua `document.title` va chi dem/thong bao cac hoi thoai KHONG bi tat thong bao (loai tru `.badge-gray`, `.is-muted`, `.dialog-muted-icon`, `.tgico-mute`, `.icon-muted`, tab thu muc, Archive `data-peer-id="0"`, va badge mau xam trung tinh).

---

### Task 1: Build-Time 4x4 SSAA Retina PNG Icon Generator & Manifest Icon Wiring

**Files:**
- Create: `scripts/icons-gen.mjs`
- Modify: `scripts/build.mjs`
- Modify: `public/manifest.json`
- Create: `tests/unit/icons-gen.test.ts`
- Modify: `tests/unit/manifest-rules.test.ts`

**Interfaces:**
- Produces:
  - `renderIconPng(kind: 'bento' | 'zalo' | 'messenger' | 'telegram' | 'discord', size: number): Buffer` in `scripts/icons-gen.mjs`
  - `generateAllIcons(outDir: string): string[]` in `scripts/icons-gen.mjs`
  - Packaged PNG files in `dist/icons/`: `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`, `provider-zalo-128.png`, `provider-messenger-128.png`, `provider-telegram-128.png`, `provider-discord-128.png`

- [ ] **Step 1: Write the failing tests for Retina PNG icons and Manifest 32px icon wiring**

Create `tests/unit/icons-gen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
// @ts-expect-error ESM build helper module
import { generateAllIcons, renderIconPng } from '../../scripts/icons-gen.mjs';

function decodePngRgba(buf: Buffer): { width: number; height: number; pixels: Uint8Array } {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(buf.subarray(0, 8).equals(sig)).toBe(true);

  let offset = 8;
  let width = 0;
  let height = 0;
  const idatParts: Buffer[] = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    }
    offset += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = 1 + width * 4;
  expect(raw.length).toBe(height * stride);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = y * stride + 1 + x * 4;
      const dst = (y * width + x) * 4;
      pixels[dst] = raw[src]!;
      pixels[dst + 1] = raw[src + 1]!;
      pixels[dst + 2] = raw[src + 2]!;
      pixels[dst + 3] = raw[src + 3]!;
    }
  }
  return { width, height, pixels };
}

function pixelAt(
  img: { width: number; pixels: Uint8Array },
  x: number,
  y: number
): [number, number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [
    img.pixels[idx]!,
    img.pixels[idx + 1]!,
    img.pixels[idx + 2]!,
    img.pixels[idx + 3]!
  ];
}

describe('Retina 4x4 SSAA Icon Generator', () => {
  it('renders transparent-corner squircles with distinct multi-color Bento quadrants and brand glyphs', () => {
    const bento = decodePngRgba(renderIconPng('bento', 128));
    expect(bento.width).toBe(128);
    expect(bento.height).toBe(128);

    // Outer corner (0, 0) is transparent outside squircle mask
    expect(pixelAt(bento, 0, 0)[3]).toBe(0);
    // Left Bento pane (x=42, y=64) is Zalo blue (B > R + 120)
    const [zr, , zb, za] = pixelAt(bento, 42, 64);
    expect(za).toBe(255);
    expect(zb - zr).toBeGreaterThan(120);

    // Each provider 128px icon has distinct brand color and crisp white foreground glyph pixels
    const kinds = ['zalo', 'messenger', 'telegram', 'discord'] as const;
    const signatures = new Set<string>();
    for (const kind of kinds) {
      const png = renderIconPng(kind, 128);
      const decoded = decodePngRgba(png);
      expect(decoded.width).toBe(128);
      expect(pixelAt(decoded, 0, 0)[3]).toBe(0);

      let whitePixels = 0;
      for (let i = 0; i < decoded.pixels.length; i += 4) {
        if (
          decoded.pixels[i]! > 235 &&
          decoded.pixels[i + 1]! > 235 &&
          decoded.pixels[i + 2]! > 235 &&
          decoded.pixels[i + 3]! > 235
        ) {
          whitePixels += 1;
        }
      }
      expect(whitePixels).toBeGreaterThan(300);

      const bgSample = pixelAt(decoded, 24, 64).join(',');
      signatures.add(bgSample);
    }
    expect(signatures.size).toBe(4);
  });

  it('writes all 8 required app and provider PNG files to target directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dia-icons-test-'));
    try {
      const written = generateAllIcons(dir);
      expect(written).toHaveLength(8);
      for (const name of [
        'icon-16.png',
        'icon-32.png',
        'icon-48.png',
        'icon-128.png',
        'provider-zalo-128.png',
        'provider-messenger-128.png',
        'provider-telegram-128.png',
        'provider-discord-128.png'
      ]) {
        const buf = readFileSync(join(dir, name));
        expect(buf.length).toBeGreaterThan(150);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

Also update `tests/unit/manifest-rules.test.ts` inside the first `it(...)` test (right after `expect(derivedExtId).toMatch(/^[a-p]{32}$/);`) to lock the exact Extension ID and 16/32/48/128 icon entries:

```ts
    expect(derivedExtId).toBe('ndcplbpbnmkeikikgmpgkaaiefmecmjh');
    expect(manifest.icons).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/icons-gen.test.ts tests/unit/manifest-rules.test.ts`
Expected: FAIL because `scripts/icons-gen.mjs` does not exist yet and `manifest.icons['32']` is missing.

- [ ] **Step 3: Implement `scripts/icons-gen.mjs`, wire `scripts/build.mjs`, and add `32` icon to `public/manifest.json`**

Create `scripts/icons-gen.mjs`:

```js
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
```

Update `scripts/build.mjs` to replace the old `crc32`/`pngChunk`/`createSolidPng` block and solid blue loop with `generateAllIcons`:

```js
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateAllIcons } from './icons-gen.mjs';

const isTest = process.argv.includes('--test');
const root = process.cwd();
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, 'public'), dist, { recursive: true });

generateAllIcons(resolve(dist, 'icons'));

if (isTest) {
  const manifestPath = resolve(dist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');
  for (const cs of manifest.content_scripts) {
    cs.matches.push('http://127.0.0.1/*');
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const framingPath = resolve(dist, 'rules/framing.json');
  const framing = JSON.parse(readFileSync(framingPath, 'utf8'));
  framing[0].condition.requestDomains.push('127.0.0.1');
  writeFileSync(framingPath, JSON.stringify(framing, null, 2));
}

const entries = [
  { in: 'src/background/service-worker.ts', out: 'service-worker.js', format: 'esm' },
  { in: 'src/workspace/workspace.ts', out: 'workspace.js', format: 'iife' },
  { in: 'src/content/notify-hook.main.ts', out: 'notify-hook.main.js', format: 'iife' },
  { in: 'src/content/frame-agent.isolated.ts', out: 'frame-agent.isolated.js', format: 'iife' }
];

for (const entry of entries) {
  const inputPath = resolve(root, entry.in);
  if (!existsSync(inputPath)) continue;
  await build({
    entryPoints: [inputPath],
    outfile: resolve(dist, entry.out),
    bundle: true,
    format: entry.format,
    target: 'chrome124',
    sourcemap: isTest ? 'inline' : false,
    minify: !isTest
  });
}
```

Update `icons` and `action` in `public/manifest.json` while keeping `"key"` 100% untouched:

```json
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_title": "Mở Dia MultiChat Hub",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
```

- [ ] **Step 4: Run tests and build check to verify they pass**

Run: `npx vitest run tests/unit/icons-gen.test.ts tests/unit/manifest-rules.test.ts && npm run build && npm run typecheck`
Expected: PASS (`2` test files passed, `dist/icons/provider-*-128.png` and `dist/icons/icon-{16,32,48,128}.png` generated, `0` type errors).

- [ ] **Step 5: Commit**

```bash
git add scripts/icons-gen.mjs scripts/build.mjs public/manifest.json tests/unit/icons-gen.test.ts tests/unit/manifest-rules.test.ts
git commit -m "feat(icons): add 4x4 SSAA Retina Bento and provider PNG icon generator"
```

---

### Task 2: Muted-Chat Exclusion (Telegram 3-Layer + All Providers) & DOM Unread Preview Extractor

**Files:**
- Modify: `src/providers/registry.ts`
- Modify: `src/content/frame-agent.isolated.ts`
- Modify: `tests/unit/registry.test.ts`
- Modify: `tests/unit/content-agents.test.ts`

**Interfaces:**
- Produces in `src/providers/registry.ts`:
  - `export interface UnreadPreview { sender: string; snippet: string; }`
  - `export function hasMountedChatList(providerId: ProviderId, root: ParentNode): boolean`
  - `export function resolveProviderUnreadCount(providerId: ProviderId, title: string, root: ParentNode | null): number`
  - `export function extractUnreadPreviewFromDom(providerId: ProviderId, root: ParentNode): UnreadPreview | null`

- [ ] **Step 1: Write the failing unit tests for Telegram/provider muted-chat exclusion, real-time body observer, and Vietnamese DOM preview extraction**

Append the following tests to `tests/unit/registry.test.ts` (and import `extractUnreadPreviewFromDom`, `hasMountedChatList`, `resolveProviderUnreadCount` from `../../src/providers/registry`):

```ts
  it('excludes muted chats, folder tabs, archive row, and gray badges on Telegram WebK/WebA and ignores muted document.title when chatlist DOM is mounted', () => {
    document.body.innerHTML = `
      <div class="menu-horizontal-div">
        <div class="menu-horizontal-div-item"><span>All</span><span class="badge-unread">28</span></div>
      </div>
      <ul class="chatlist">
        <a class="chatlist-chat" data-peer-id="0">
          <span class="peer-title">Archived Chats</span>
          <div class="dialog-subtitle-badge badge badge-24 dialog-subtitle-badge-unread badge-gray is-visible">15</div>
        </a>
        <a class="chatlist-chat is-muted" data-peer-id="-1001">
          <span class="peer-title">Muted Crypto Group</span>
          <div class="dialog-subtitle-badge badge badge-24 dialog-subtitle-badge-unread badge-gray is-visible">9</div>
        </a>
        <a class="chatlist-chat" data-peer-id="-1002">
          <span class="peer-title">Muted Dev Channel <span class="dialog-muted-icon"></span></span>
          <div class="dialog-subtitle-badge badge badge-24 dialog-subtitle-badge-unread is-visible">4</div>
        </a>
        <a class="chatlist-chat" data-peer-id="-1003">
          <span class="peer-title">Gray Theme Muted</span>
          <div id="computed-gray-badge" class="dialog-subtitle-badge badge-unread is-visible" style="background-color: rgb(113, 117, 121);">6</div>
        </a>
        <a class="chatlist-chat" data-peer-id="2001">
          <span class="peer-title">Read Hidden Badge</span>
          <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary hide">3</div>
        </a>
      </ul>
    `;

    expect(hasMountedChatList('telegram', document)).toBe(true);
    expect(extractUnreadFromDom('telegram', document)).toBe(0);
    // Telegram default cloud setting puts muted count (28) into document.title; mounted chatlist overrides it to 0!
    expect(resolveProviderUnreadCount('telegram', '(28) Telegram', document)).toBe(0);
    expect(extractUnreadPreviewFromDom('telegram', document)).toBeNull();

    // Now add 1 genuinely unmuted Telegram WebK chat and 1 unmuted WebA chat (plus 1 muted WebA chat)
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <a class="chatlist-chat" data-peer-id="3001">
        <div class="user-caption">
          <p class="dialog-title"><span class="peer-title">Nguyễn Minh Tuấn</span></p>
          <p class="dialog-subtitle">
            <span class="dialog-subtitle-span">Anh ơi chốt bản thiết kế chiều nay nhé!</span>
            <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary is-visible" style="background-color: rgb(51, 144, 236);">2</div>
          </p>
        </div>
      </a>
      <div class="ListItem Chat muted">
        <div class="ChatBadge unread muted">7</div>
      </div>
      <div class="ListItem Chat">
        <div class="title"><h3>Team Infra</h3></div>
        <div class="subtitle"><span class="last-message">Deploy xong prod</span><div class="ChatBadge unread">1</div></div>
      </div>
      `
    );

    expect(extractUnreadFromDom('telegram', document)).toBe(3);
    expect(resolveProviderUnreadCount('telegram', '(31) Telegram', document)).toBe(3);
    expect(extractUnreadPreviewFromDom('telegram', document)).toEqual({
      sender: 'Nguyễn Minh Tuấn',
      snippet: 'Anh ơi chốt bản thiết kế chiều nay nhé!'
    });
  });

  it('excludes muted conversation rows across Zalo, Messenger, and Discord and extracts Vietnamese sender + snippet from unmuted rows', () => {
    // Zalo: 1 muted group + 1 active unmuted contact
    document.body.innerHTML = `
      <div class="msg-item conv-item">
        <div class="conv-item-title__name">Nhóm Quảng Cáo</div>
        <i class="fa-Mute"></i>
        <div class="conv-item-body__main">Khuyến mãi cuối tuần</div>
        <div class="conv-item-title__unread">5</div>
      </div>
      <div class="msg-item conv-item">
        <div class="conv-item-title__name">Trần Thu Hà</div>
        <div class="conv-item-body__main">Gửi anh hợp đồng bản cuối ạ</div>
        <span class="conv-item-title__more">10:42</span>
        <div class="conv-item-title__unread">2</div>
      </div>
    `;
    expect(extractUnreadFromDom('zalo', document)).toBe(2);
    expect(extractUnreadPreviewFromDom('zalo', document)).toEqual({
      sender: 'Trần Thu Hà',
      snippet: 'Gửi anh hợp đồng bản cuối ạ'
    });

    // Messenger: 1 muted thread + 1 unmuted thread
    document.body.innerHTML = `
      <div role="row">
        <span data-sender>Nhóm Đã Tắt Chuông</span>
        <svg aria-label="Muted"></svg>
        <span data-testid="mwthreadlist-item-unread-badge">4</span>
      </div>
      <div role="row">
        <span data-sender>Lê Hoàng Nam</span>
        <span data-preview>Tối nay họp lúc 20h nha</span>
        <span data-testid="mwthreadlist-item-unread-badge">1</span>
      </div>
    `;
    expect(extractUnreadFromDom('messenger', document)).toBe(1);
    expect(extractUnreadPreviewFromDom('messenger', document)).toEqual({
      sender: 'Lê Hoàng Nam',
      snippet: 'Tối nay họp lúc 20h nha'
    });

    // Discord: 1 modeMuted channel + 1 active channel
    document.body.innerHTML = `
      <li class="containerDefault modeMuted-3a2">
        <span class="name-3BUD">#random</span>
        <span class="numberBadge-2s8kKX">9</span>
      </li>
      <li class="containerDefault">
        <span class="name-3BUD">#frontend-review</span>
        <span data-preview>@phuong PR #42 xanh hết rồi</span>
        <span class="numberBadge-2s8kKX">3</span>
      </li>
    `;
    expect(extractUnreadFromDom('discord', document)).toBe(3);
    expect(extractUnreadPreviewFromDom('discord', document)).toEqual({
      sender: '#frontend-review',
      snippet: '@phuong PR #42 xanh hết rồi'
    });
  });
```

In `tests/unit/content-agents.test.ts`:
1. Update line 563 expected fallback body from `'Ban co 3 tin nhan chua doc'` to `'Bạn có 3 tin nhắn chưa đọc'`.
2. Add a new test inside `describe('Content script entrypoints ...')`:

```ts
  it('ignores muted Telegram chatlist updates even when document.title increments, and extracts Vietnamese sender + snippet via debounced body observer for unmuted chats', async () => {
    const sentMessages: RuntimeMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'dia-ext-id',
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: () => void) => {
          sentMessages.push(msg);
          cb?.();
        }),
        lastError: undefined
      }
    });

    const fakeWorkspaceWin = {} as Window;
    Object.defineProperty(window, 'top', { value: fakeWorkspaceWin, configurable: true });
    Object.defineProperty(window, 'parent', { value: fakeWorkspaceWin, configurable: true });
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: ['chrome-extension://dia-ext-id'] as unknown as DOMStringList,
      configurable: true
    });
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

    document.body.innerHTML = `
      <ul class="chatlist">
        <a class="chatlist-chat is-muted" data-peer-id="-999">
          <span class="peer-title">Nhóm Muted</span>
          <div class="dialog-subtitle-badge-unread badge-gray is-visible">12</div>
        </a>
      </ul>
    `;
    document.title = '(12) Telegram';

    await import('../../src/content/frame-agent.isolated');

    // Muted group reports 0 unread and triggers NO fallback notification
    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 0
    });
    vi.advanceTimersByTime(2000);
    expect(sentMessages.filter((m) => m.type === 'CHAT_NOTIFY')).toHaveLength(0);

    // Muted group receives another message -> still 0 unread and 0 notifications
    sentMessages.length = 0;
    document.querySelector('.badge-gray')!.textContent = '13';
    document.title = '(13) Telegram';
    await Promise.resolve();
    vi.advanceTimersByTime(2000);
    expect(sentMessages.filter((m) => m.type === 'UNREAD_UPDATE')).toHaveLength(0);
    expect(sentMessages.filter((m) => m.type === 'CHAT_NOTIFY')).toHaveLength(0);

    // Unmuted chat arrives in DOM -> 200ms debounced body observer catches it + 1500ms fallback sends Vietnamese sender & preview!
    document.querySelector('.chatlist')!.insertAdjacentHTML(
      'afterbegin',
      `
      <a class="chatlist-chat" data-peer-id="555">
        <span class="peer-title">Phạm Quốc Bảo</span>
        <span class="dialog-subtitle-span">Em vừa đẩy bản hotfix lên staging</span>
        <div class="dialog-subtitle-badge-unread badge-primary is-visible">1</div>
      </a>
      `
    );
    await Promise.resolve();
    vi.advanceTimersByTime(220);

    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 1
    });

    vi.advanceTimersByTime(1500);
    expect(sentMessages).toContainEqual({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId: 'telegram',
        title: 'Phạm Quốc Bảo',
        body: 'Em vừa đẩy bản hotfix lên staging',
        tag: 'fallback-telegram-Phạm Quốc Bảo-Em vừa đẩy bản hotfix lê'
      }
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/registry.test.ts tests/unit/content-agents.test.ts`
Expected: FAIL because `hasMountedChatList`, `resolveProviderUnreadCount`, and `extractUnreadPreviewFromDom` are not exported yet and muted Telegram badges are still counted.

- [ ] **Step 3: Implement muted-chat exclusion & DOM preview extraction in `src/providers/registry.ts` and debounced body observer in `src/content/frame-agent.isolated.ts`**

Replace `src/providers/registry.ts` with:

```ts
import type { ProviderConfig, ProviderId } from '../shared/types';

export interface UnreadPreview {
  sender: string;
  snippet: string;
}

export const PROVIDER_ORDER: readonly [ProviderId, ProviderId, ProviderId, ProviderId] = [
  'zalo',
  'messenger',
  'telegram',
  'discord'
];

const COMMON_SUB_DIET_CSS = `
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
`;

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  zalo: {
    id: 'zalo',
    name: 'Zalo',
    shortcutIndex: 1,
    embedUrl: 'https://chat.zalo.me/',
    loginUrl: 'https://chat.zalo.me/',
    hostPatterns: ['chat.zalo.me', 'id.zalo.me'],
    cookieDomains: ['.zalo.me', 'chat.zalo.me'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bZalo\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: ['.conv-item-title__unread', '.unread-red-dot-num', '[data-id*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      #chatInfo, .chat-info-container { display: none !important; }
    `
  },
  messenger: {
    id: 'messenger',
    name: 'Messenger',
    shortcutIndex: 2,
    embedUrl: 'https://www.messenger.com/',
    loginUrl: 'https://www.messenger.com/login/',
    hostPatterns: ['www.messenger.com', 'messenger.com'],
    cookieDomains: ['.messenger.com', '.facebook.com'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bMessenger\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: ['[data-testid="mwthreadlist-item-unread-badge"]', '[aria-label*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      [role="complementary"] { display: none !important; }
    `
  },
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    shortcutIndex: 3,
    embedUrl: 'https://web.telegram.org/k/',
    loginUrl: 'https://web.telegram.org/k/',
    hostPatterns: ['web.telegram.org'],
    cookieDomains: ['.telegram.org', 'web.telegram.org'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bTelegram(?:\s+Web)?\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: [
      '.dialog-subtitle-badge-unread',
      '.ChatBadge.unread',
      '.badge-unread',
      '.unread'
    ],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      .right-sidebar { display: none !important; }
    `
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    shortcutIndex: 4,
    embedUrl: 'https://discord.com/app',
    loginUrl: 'https://discord.com/login',
    hostPatterns: ['discord.com'],
    cookieDomains: ['.discord.com', 'discord.com'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bDiscord\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: ['[class*="numberBadge"]', '[aria-label*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      [class*="membersWrap"], [class*="nowPlayingColumn"] { display: none !important; }
    `
  }
};

const CHAT_LIST_ROW_SELECTORS: Record<ProviderId, string> = {
  zalo: '.conv-item, .msg-item, [data-chat-item]',
  messenger: '[role="row"], [role="listitem"], a[href*="/t/"], [data-chat-item]',
  telegram: '.chatlist-chat, .ListItem.Chat, [data-chat-item]',
  discord: '[class*="containerDefault"], [role="listitem"], li, a[href*="/channels/"], [data-chat-item]'
};

const SENDER_SELECTORS: Record<ProviderId, string[]> = {
  zalo: ['.conv-item-title__name', '[data-sender]', '.truncate', '[class*="title__name"]'],
  messenger: ['[data-sender]', '[dir="auto"] span', 'h3', 'h4', 'strong'],
  telegram: ['.peer-title', '.user-title', '.ListItem .title h3', '.ListItem .title', '[data-sender]'],
  discord: ['[data-sender]', '[class*="name-"]', '[class*="channelName"]', '[class*="username"]']
};

const SNIPPET_SELECTORS: Record<ProviderId, string[]> = {
  zalo: ['.conv-item-body__main', '.conv-message', '[data-preview]', '[class*="conv-item-body"]'],
  messenger: ['[data-preview]', '[data-testid="mwthreadlist-item-snippet"]', '[dir="auto"]'],
  telegram: ['.dialog-subtitle-span', '.last-message', '.subtitle span', '[data-preview]'],
  discord: ['[data-preview]', '[class*="subtext"]', '[class*="activityText"]']
};

const NUMERIC_PILL_RE = /^(\d+)\+?$/;
const TIMESTAMP_ONLY_RE = /^(\d{1,2}:\d{2}(\s*[AP]M)?|\d+\s*(s|m|h|d|w|phút|giờ|ngày))$/i;
const ARIA_COUNT_BEFORE_UNREAD_RE = /\b(\d+)\+?\s+unread\b/i;
const ARIA_COUNT_AFTER_UNREAD_RE = /\bunread(?:\s+messages?)?[\s:(-]+(\d+)\+?(?!\s*:\d)/i;
const RGB_COLOR_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i;

export function parseUnreadFromTitle(providerId: ProviderId, title: string): number {
  const match = PROVIDERS[providerId].titleUnreadRegex.exec(title);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isNeutralGrayBackground(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return false;
  let bg = '';
  try {
    bg = view.getComputedStyle(el).backgroundColor || '';
  } catch {
    return false;
  }
  const match = RGB_COLOR_RE.exec(bg.trim());
  if (!match) return false;
  const r = Number.parseInt(match[1] ?? '0', 10);
  const g = Number.parseInt(match[2] ?? '0', 10);
  const b = Number.parseInt(match[3] ?? '0', 10);
  const alpha = match[4] !== undefined ? Number.parseFloat(match[4]) : 1;
  if (!Number.isFinite(alpha) || alpha <= 0.1) return false;
  if (r === 0 && g === 0 && b === 0) return false;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return spread <= 15;
}

function isElementHidden(el: Element): boolean {
  if (
    el.classList.contains('hide') ||
    el.hasAttribute('hidden') ||
    el.closest('.hide, [hidden]') !== null
  ) {
    return true;
  }
  const view = el.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === 'function') {
    try {
      const style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch {
      // Ignore style lookup errors in detached trees
    }
  }
  return false;
}

function isMutedConversationRow(providerId: ProviderId, row: Element | null): boolean {
  if (!row) return false;
  if (
    row.classList.contains('is-muted') ||
    row.classList.contains('muted') ||
    row.getAttribute('data-muted') === 'true'
  ) {
    return true;
  }

  if (providerId === 'telegram') {
    if (row.getAttribute('data-peer-id') === '0' || row.classList.contains('is-archive')) {
      return true;
    }
    return (
      row.querySelector(
        '.dialog-muted-icon, .tgico-mute, .icon-muted, [class*="muted-icon" i], [data-icon="mute"]'
      ) !== null
    );
  }

  if (providerId === 'zalo') {
    return (
      row.querySelector(
        '.fa-Mute, [class*="ic-mute" i], [class*="icon-mute" i], .conv-item__mute, [class*="--mute" i], [data-muted="true"]'
      ) !== null
    );
  }

  if (providerId === 'messenger') {
    return (
      row.querySelector(
        '[aria-label*="Muted" i], [aria-label*="Đã tắt thông báo" i], [aria-label*="tắt thông báo" i], [data-testid*="mute" i]'
      ) !== null
    );
  }

  if (providerId === 'discord') {
    const cls = row.getAttribute('class') ?? '';
    if (/modeMuted/i.test(cls)) return true;
    const aria = row.getAttribute('aria-label') ?? '';
    if (/\bmuted\b/i.test(aria)) return true;
    return row.querySelector('[class*="modeMuted" i], [aria-label*="muted" i]') !== null;
  }

  return false;
}

function isMutedOrIgnoredBadge(providerId: ProviderId, el: Element): boolean {
  if (isElementHidden(el)) return true;
  if (
    el.classList.contains('badge-gray') ||
    el.classList.contains('muted') ||
    el.classList.contains('is-muted') ||
    el.getAttribute('data-muted') === 'true'
  ) {
    return true;
  }

  if (providerId === 'telegram') {
    if (
      el.closest(
        '.menu-horizontal-div, .tabs-tab, #folders-tabs, .ChatFolders, .Tab, [role="tablist"], [data-peer-id="0"], .is-archive'
      ) !== null
    ) {
      return true;
    }
    if (isNeutralGrayBackground(el)) {
      return true;
    }
  }

  const row = el.closest(CHAT_LIST_ROW_SELECTORS[providerId]);
  return isMutedConversationRow(providerId, row);
}

function parseUnreadFromElement(el: Element): number {
  const text = (el.textContent ?? '').trim();
  const pillMatch = NUMERIC_PILL_RE.exec(text);
  if (pillMatch?.[1]) {
    const parsed = Number.parseInt(pillMatch[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  const aria = el.getAttribute('aria-label') ?? '';
  if (aria) {
    const ariaMatch =
      ARIA_COUNT_BEFORE_UNREAD_RE.exec(aria) ?? ARIA_COUNT_AFTER_UNREAD_RE.exec(aria);
    if (ariaMatch?.[1]) {
      const parsed = Number.parseInt(ariaMatch[1], 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
  }

  return 0;
}

function collectUnmutedBadgeElements(
  providerId: ProviderId,
  root: ParentNode
): Array<{ element: Element; count: number }> {
  const selectors = PROVIDERS[providerId].badgeSelectors;
  const results: Array<{ element: Element; count: number }> = [];
  const seen = new Set<Element>();
  const counted: Element[] = [];

  for (const selector of selectors) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = root.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (isMutedOrIgnoredBadge(providerId, el)) continue;
      if (counted.some((prev) => prev.contains(el) || el.contains(prev))) {
        continue;
      }
      const num = parseUnreadFromElement(el);
      if (num > 0) {
        counted.push(el);
        results.push({ element: el, count: num });
      }
    }
  }
  return results;
}

export function extractUnreadFromDom(providerId: ProviderId, root: ParentNode): number {
  return collectUnmutedBadgeElements(providerId, root).reduce((sum, item) => sum + item.count, 0);
}

export function hasMountedChatList(providerId: ProviderId, root: ParentNode): boolean {
  try {
    return root.querySelector(CHAT_LIST_ROW_SELECTORS[providerId]) !== null;
  } catch {
    return false;
  }
}

export function resolveProviderUnreadCount(
  providerId: ProviderId,
  title: string,
  root: ParentNode | null
): number {
  const domCount = root ? extractUnreadFromDom(providerId, root) : 0;
  if (providerId === 'telegram' && root && hasMountedChatList('telegram', root)) {
    return domCount;
  }
  const titleCount = parseUnreadFromTitle(providerId, title);
  return titleCount > 0 ? titleCount : domCount;
}

function cleanPreviewText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

function pickCleanText(
  row: Element,
  selectors: readonly string[],
  badgeEl: Element,
  excludeText?: string
): string {
  for (const sel of selectors) {
    let candidates: NodeListOf<Element>;
    try {
      candidates = row.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const node of candidates) {
      if (node === badgeEl || node.contains(badgeEl) || badgeEl.contains(node)) continue;
      const text = cleanPreviewText(node.textContent);
      if (!text) continue;
      if (NUMERIC_PILL_RE.test(text) || TIMESTAMP_ONLY_RE.test(text)) continue;
      if (excludeText && text === excludeText) continue;
      return text;
    }
  }
  return '';
}

export function extractUnreadPreviewFromDom(
  providerId: ProviderId,
  root: ParentNode
): UnreadPreview | null {
  const badges = collectUnmutedBadgeElements(providerId, root);
  for (const { element: badgeEl } of badges) {
    const row = badgeEl.closest(CHAT_LIST_ROW_SELECTORS[providerId]);
    if (!row) continue;
    const sender = pickCleanText(row, SENDER_SELECTORS[providerId], badgeEl);
    if (!sender) continue;
    const snippet = pickCleanText(row, SNIPPET_SELECTORS[providerId], badgeEl, sender);
    return { sender, snippet };
  }
  return null;
}

export function matchProviderByUrl(rawUrl: string): ProviderId | null {
  let host: string;
  let pathname: string;
  try {
    const parsed = new URL(rawUrl);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (host === '127.0.0.1' || host === 'localhost') {
    for (const id of PROVIDER_ORDER) {
      if (pathname.includes(`/${id}`)) return id;
    }
  }
  for (const id of PROVIDER_ORDER) {
    if (PROVIDERS[id].hostPatterns.some((h) => host === h || host.endsWith(`.${h}`))) {
      return id;
    }
  }
  return null;
}
```

Now update `src/content/frame-agent.isolated.ts`:
1. Import `extractUnreadPreviewFromDom` and `resolveProviderUnreadCount` from `../providers/registry` (replacing `extractUnreadFromDom` and `parseUnreadFromTitle`).
2. Add `let bodyObserver: MutationObserver | null = null;` and `let bodyDebounceTimer: number | null = null;`.
3. Update `fallbackTracker` (lines 67-77) to extract Vietnamese sender + snippet from unmuted DOM rows:

```ts
  const fallbackTracker = new UnreadFallbackTracker(1500, (count) => {
    const preview = document.body ? extractUnreadPreviewFromDom(providerId, document) : null;
    const title = preview?.sender || PROVIDERS[providerId].name;
    const body = preview?.snippet || `Bạn có ${count} tin nhắn chưa đọc`;
    const tag = preview?.sender
      ? `fallback-${providerId}-${preview.sender}${preview.snippet ? `-${preview.snippet.slice(0, 24)}` : ''}`
      : `fallback-${providerId}`;
    sendToBackground({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId,
        title,
        body,
        tag
      }
    });
  });

  const evaluateUnread = (): void => {
    const count = resolveProviderUnreadCount(
      providerId,
      document.title || '',
      document.body ?? null
    );
    if (count !== lastReportedUnread) {
      lastReportedUnread = count;
      sendToBackground({ type: 'UNREAD_UPDATE', providerId, count });
    }
    fallbackTracker.onUnreadCount(count);
  };
```

4. Inside `bootDomObservers` in `src/content/frame-agent.isolated.ts`, observe `document.body` with a `200ms` debounce in addition to `observer` on `document.head`, and clean up `bodyObserver` + `bodyDebounceTimer` on `pagehide`:

```ts
    if (document.body) {
      bodyObserver = new MutationObserver(() => {
        if (bodyDebounceTimer !== null) return;
        bodyDebounceTimer = window.setTimeout(() => {
          bodyDebounceTimer = null;
          evaluateUnread();
        }, 200);
      });
      bodyObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
```

And inside the `pagehide` handler in `src/content/frame-agent.isolated.ts`, disconnect `bodyObserver` and clear `bodyDebounceTimer`:

```ts
      bodyObserver?.disconnect();
      bodyObserver = null;
      if (bodyDebounceTimer !== null) {
        window.clearTimeout(bodyDebounceTimer);
        bodyDebounceTimer = null;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/registry.test.ts tests/unit/content-agents.test.ts && npm run typecheck`
Expected: PASS (all registry & content-agent tests pass, `0` type errors).

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts src/content/frame-agent.isolated.ts tests/unit/registry.test.ts tests/unit/content-agents.test.ts
git commit -m "feat(unread): exclude muted chats on Telegram and all providers and extract DOM previews"
```

---

### Task 3: Per-Provider Notification Icons, UTF-8 Vietnamese Banner Formatting, Toolbar Action Badge & Real Active-Pane Focus Sync

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/background/notify-router.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/content/frame-agent.isolated.ts`
- Modify: `tests/unit/notify-router.test.ts`
- Modify: `tests/unit/content-agents.test.ts`

**Interfaces:**
- Consumes: `icons/provider-${providerId}-128.png` generated by Task 1
- Produces:
  - `RuntimeMessage` additions in `src/shared/types.ts`:
    - `{ type: 'SYNC_PREFS'; prefs: Pick<WorkspacePrefs, 'dnd' | 'hidePreview' | 'liteMedia'> & { paused?: Record<ProviderId, boolean> } }`
    - `{ type: 'FRAME_FOCUSED'; providerId: ProviderId }`
    - `{ type: 'ACTIVE_PROVIDER_CHANGED'; providerId: ProviderId }`
  - `formatNotificationContent(providerName: string, rawTitle: string, rawBody: string, hidePreview: boolean): { title: string; message: string }` in `src/background/notify-router.ts`
  - `NotifyRouter` constructor supporting `iconSource: string | ((providerId: ProviderId) => string)`

- [ ] **Step 1: Write the failing unit tests for per-provider icons, Vietnamese formatting, `chrome.action` unread badge, and `FRAME_FOCUSED` routing**

In `tests/unit/notify-router.test.ts`:
1. Update existing assertions on lines 72, 90, 91, and 383 for the new accented Vietnamese & `{App} • {Sender}` format:
   - Line 72: `message: 'Bạn có tin nhắn mới'`
   - Line 90-91: `title: 'Discord • #ops'`, `message: 'Tin nhắn mới'`
   - Line 383: `message: 'Bạn có tin nhắn mới'`
2. In `createChromeMock` (`tests/unit/notify-router.test.ts:241-243`), add mock spies on `action`:

```ts
    action: {
      onClicked: onActionClicked,
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setBadgeTextColor: vi.fn().mockResolvedValue(undefined)
    },
```

3. Add two new unit tests in `tests/unit/notify-router.test.ts`:
   - Inside `describe('NotifyRouter', ...)`:

```ts
  it('resolves per-provider 128px brand iconUrl and formats UTF-8 Vietnamese "{Provider} • {Sender}" titles cleanly', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const router = new NotifyRouter(
      create,
      (id) => `chrome-extension://ext-id/icons/provider-${id}-128.png`
    );

    await router.handleIncoming(
      {
        providerId: 'zalo',
        title: '(2) Nguyễn Minh Tuấn',
        body: 'Anh ơi gửi giúp em bản thiết kế nhé!'
      },
      1000
    );
    expect(create).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        iconUrl: 'chrome-extension://ext-id/icons/provider-zalo-128.png',
        title: 'Zalo • Nguyễn Minh Tuấn',
        message: 'Anh ơi gửi giúp em bản thiết kế nhé!'
      })
    );

    // Avoid duplicating provider name when raw title equals provider name ("Telegram" / "Telegram Web")
    await router.handleIncoming(
      {
        providerId: 'telegram',
        title: 'Telegram Web',
        body: 'Bạn có 1 tin nhắn chưa đọc'
      },
      2000
    );
    expect(create).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        iconUrl: 'chrome-extension://ext-id/icons/provider-telegram-128.png',
        title: 'Telegram',
        message: 'Bạn có 1 tin nhắn chưa đọc'
      })
    );
  });
```

   - Inside `describe('MV3 background service-worker', ...)`:

```ts
  it('syncs chrome.action unread badge across providers/pause/SW-restart and updates active focused pane via FRAME_FOCUSED', async () => {
    const sharedSession: Record<string, unknown> = {};
    const env = createChromeMock(sharedSession);
    env.chromeMock.tabs.query.mockResolvedValue([
      { id: 10, windowId: 1, active: true, url: 'chrome-extension://ext-id/workspace.html' }
    ]);
    env.chromeMock.windows.get.mockResolvedValue({ id: 1, focused: true });

    vi.stubGlobal('chrome', env.chromeMock);
    await import('../../src/background/service-worker');

    // Unread updates aggregate onto Dia toolbar action badge
    await env.dispatchMessage({ type: 'UNREAD_UPDATE', providerId: 'zalo', count: 3 });
    await env.dispatchMessage({ type: 'UNREAD_UPDATE', providerId: 'messenger', count: 98 });
    await vi.waitFor(() => {
      expect(env.chromeMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#EF4444'
      });
      expect(env.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '99+' });
    });

    // Pausing messenger via SYNC_PREFS zeroes messenger's contribution -> badge drops to '3'
    await env.dispatchMessage({
      type: 'SYNC_PREFS',
      prefs: {
        dnd: false,
        hidePreview: false,
        liteMedia: false,
        paused: { zalo: false, messenger: true, telegram: false, discord: false }
      }
    });
    await vi.waitFor(() => {
      expect(env.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '3' });
    });

    // Zalo starts as focusedProvider ('main'), then user clicks inside sub-pane Telegram (FRAME_FOCUSED)
    await env.dispatchMessage(
      { type: 'WORKSPACE_FOCUS_STATE', windowFocused: true, focusedProvider: 'zalo' },
      { tab: { id: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );
    await env.dispatchMessage({ type: 'FRAME_FOCUSED', providerId: 'telegram' });
    await vi.waitFor(() => {
      expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'ACTIVE_PROVIDER_CHANGED',
        providerId: 'telegram'
      });
    });

    // Now incoming Zalo notification MUST NOT be suppressed because user is actually typing in Telegram!
    const zaloNotif = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'zalo', title: 'Tuấn', body: 'Tin mới bên Zalo' }
    })) as { notifId: string | null };
    expect(zaloNotif.notifId).toBeTruthy();
    expect(env.chromeMock.notifications.create).toHaveBeenLastCalledWith(
      zaloNotif.notifId,
      expect.objectContaining({
        iconUrl: 'chrome-extension://ext-id/icons/provider-zalo-128.png',
        title: 'Zalo • Tuấn',
        message: 'Tin mới bên Zalo'
      }),
      expect.any(Function)
    );

    // Meanwhile incoming Telegram notification IS suppressed because user is focused in Telegram
    const tgSuppressed = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'telegram', title: 'Bot', body: 'Đang mở khung này' }
    })) as { notifId: string | null };
    expect(tgSuppressed.notifId).toBeNull();
  });
```

4. In `tests/unit/content-agents.test.ts`, inside the existing `'bridges MAIN and ISOLATED worlds...'` test (right after the `Alt+3` block), add a check that `pointerdown` inside the iframe sends `FRAME_FOCUSED` with `800ms` throttle:

```ts
    sentMessages.length = 0;
    window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    window.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(sentMessages.filter((m) => m.type === 'FRAME_FOCUSED')).toEqual([
      { type: 'FRAME_FOCUSED', providerId: 'telegram' }
    ]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/notify-router.test.ts tests/unit/content-agents.test.ts`
Expected: FAIL on `NotifyRouter` resolver signature, `FRAME_FOCUSED` message type, and `chrome.action.setBadgeText` assertions.

- [ ] **Step 3: Implement `types.ts`, `notify-router.ts`, `service-worker.ts`, and `frame-agent.isolated.ts` focus reporting**

Update `RuntimeMessage` in `src/shared/types.ts`:

```ts
export type RuntimeMessage =
  | { type: 'CHAT_NOTIFY'; payload: NotifyPayload }
  | { type: 'UNREAD_UPDATE'; providerId: ProviderId; count: number }
  | {
      type: 'WORKSPACE_FOCUS_STATE';
      windowFocused: boolean;
      focusedProvider: ProviderId | null;
    }
  | {
      type: 'SYNC_PREFS';
      prefs: Pick<WorkspacePrefs, 'dnd' | 'hidePreview' | 'liteMedia'> & {
        paused?: Record<ProviderId, boolean>;
      };
    }
  | { type: 'FRAME_FOCUSED'; providerId: ProviderId }
  | { type: 'ACTIVE_PROVIDER_CHANGED'; providerId: ProviderId }
  | { type: 'OPEN_REAUTH'; providerId: ProviderId }
  | { type: 'TEST_NOTIFY' }
  | { type: 'GET_DUP_TABS' }
  | { type: 'CLOSE_DUP_TABS' }
  | { type: 'CONSUME_PENDING_CLICK' }
  | { type: 'FOCUS_PROVIDER'; providerId: ProviderId }
  | { type: 'RELOAD_PROVIDER'; providerId: ProviderId }
  | { type: 'TRIGGER_NOTIFY_CLICK'; providerId: ProviderId; notifToken?: string }
  | { type: 'DUP_TABS_CHANGED'; tabs: ExternalProviderTab[] };
```

Update `src/background/notify-router.ts`:

```ts
import type { NotifyPayload, ProviderId } from '../shared/types';
import { PROVIDERS } from '../providers/registry';

export type CreateNotificationFn = (
  notificationId: string,
  options: chrome.notifications.NotificationOptions<true>
) => Promise<void>;

export type IconSource = string | ((providerId: ProviderId) => string);

const DEDUP_WINDOW_MS = 3000;
const MAX_STORED_TOKENS = 100;
const MAX_ENCODED_TOKEN_LEN = 256;
const LEADING_UNREAD_PREFIX_RE = /^\s*[•*]?\s*\(\d+\+?\)\s*/;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatNotificationContent(
  providerName: string,
  rawTitle: string,
  rawBody: string,
  hidePreview: boolean
): { title: string; message: string } {
  if (hidePreview) {
    return { title: providerName, message: 'Bạn có tin nhắn mới' };
  }
  const withoutCount = rawTitle.trim().replace(LEADING_UNREAD_PREFIX_RE, '').trim();
  const providerPrefixRe = new RegExp(
    `^${escapeRegExp(providerName)}(?:\\s+Web)?(?:\\s*[-•:|]\\s*|\\s*$)`,
    'i'
  );
  const senderRest = withoutCount.replace(providerPrefixRe, '').trim();
  const title = senderRest ? `${providerName} • ${senderRest}` : providerName;
  const message = rawBody.trim() || 'Tin nhắn mới';
  return { title, message };
}

export class NotifyRouter {
  private dnd = false;
  private hidePreview = false;
  private windowFocused = false;
  private focusedProvider: ProviderId | null = null;
  private recentFingerprints = new Map<string, number>();
  private tokenByNotifId = new Map<string, { providerId: ProviderId; notifToken?: string }>();
  private seq = 0;

  constructor(
    private readonly createNotification: CreateNotificationFn,
    private readonly iconSource: IconSource
  ) {}

  setPrefs(prefs: { dnd: boolean; hidePreview: boolean }): void {
    this.dnd = prefs.dnd;
    this.hidePreview = prefs.hidePreview;
  }

  setFocusState(state: { windowFocused: boolean; focusedProvider: ProviderId | null }): void {
    this.windowFocused = state.windowFocused;
    this.focusedProvider = state.focusedProvider;
  }

  private resolveIconUrl(providerId: ProviderId): string {
    return typeof this.iconSource === 'function' ? this.iconSource(providerId) : this.iconSource;
  }

  async handleIncoming(payload: NotifyPayload, nowMs = Date.now()): Promise<string | null> {
    if (!Object.hasOwn(PROVIDERS, payload.providerId)) return null;
    if (this.dnd) return null;
    if (this.windowFocused && this.focusedProvider === payload.providerId) {
      return null;
    }

    this.pruneOld(nowMs);
    const dedupKey = `${payload.providerId}:${payload.tag || `${payload.title}|${payload.body}`}`;
    const lastSeen = this.recentFingerprints.get(dedupKey);
    if (typeof lastSeen === 'number' && nowMs - lastSeen < DEDUP_WINDOW_MS) {
      return null;
    }
    this.recentFingerprints.set(dedupKey, nowMs);

    const providerName = PROVIDERS[payload.providerId].name;
    const { title, message } = formatNotificationContent(
      providerName,
      payload.title,
      payload.body,
      this.hidePreview
    );

    this.seq += 1;
    const rawEncoded = payload.notifToken ? encodeURIComponent(payload.notifToken) : '';
    const tokenSuffix =
      rawEncoded && rawEncoded.length <= MAX_ENCODED_TOKEN_LEN ? `:${rawEncoded}` : '';
    const notifId = `dia-chat:${payload.providerId}:${nowMs}:${this.seq}${tokenSuffix}`;
    const target: { providerId: ProviderId; notifToken?: string } =
      payload.notifToken !== undefined
        ? { providerId: payload.providerId, notifToken: payload.notifToken }
        : { providerId: payload.providerId };
    this.tokenByNotifId.set(notifId, target);
    if (this.tokenByNotifId.size > MAX_STORED_TOKENS) {
      const oldestKey = this.tokenByNotifId.keys().next().value;
      if (oldestKey) this.tokenByNotifId.delete(oldestKey);
    }

    try {
      await this.createNotification(notifId, {
        type: 'basic',
        iconUrl: this.resolveIconUrl(payload.providerId),
        title,
        message,
        priority: 2
      });
    } catch (err) {
      this.recentFingerprints.delete(dedupKey);
      this.tokenByNotifId.delete(notifId);
      throw err;
    }
    return notifId;
  }

  parseNotificationClick(
    notifId: string
  ): { providerId: ProviderId; notifToken?: string } | null {
    const stored = this.tokenByNotifId.get(notifId);
    if (stored) {
      this.tokenByNotifId.delete(notifId);
      return stored;
    }
    const parts = notifId.split(':');
    if (parts[0] === 'dia-chat' && parts[1] && Object.hasOwn(PROVIDERS, parts[1])) {
      const providerId = parts[1] as ProviderId;
      if (parts[4]) {
        try {
          return { providerId, notifToken: decodeURIComponent(parts[4]) };
        } catch {
          return { providerId };
        }
      }
      return { providerId };
    }
    return null;
  }

  private pruneOld(nowMs: number): void {
    for (const [key, ts] of this.recentFingerprints.entries()) {
      if (nowMs - ts >= DEDUP_WINDOW_MS) {
        this.recentFingerprints.delete(key);
      }
    }
  }
}
```

Update `src/background/service-worker.ts`:
1. Import `PROVIDER_ORDER` alongside `PROVIDERS` from `../providers/registry`.
2. Add `SW_UNREADS_KEY = '__dia_sw_unreads'` and `getProviderIconUrl = (providerId: ProviderId) => chrome.runtime.getURL(\`icons/provider-${providerId}-128.png\`)`, passing `getProviderIconUrl` to `new NotifyRouter(..., getProviderIconUrl)`.
3. Maintain `unreadsByProvider: Record<ProviderId, number>` and `pausedByProvider: Record<ProviderId, boolean>` (hydrated in `ensureHydrated` from `SW_UNREADS_KEY` when `!unreadsUpdatedInMemory`), plus `syncActionBadge()`:

```ts
function syncActionBadge(): void {
  let total = 0;
  for (const id of PROVIDER_ORDER) {
    if (!pausedByProvider[id]) {
      total += unreadsByProvider[id] || 0;
    }
  }
  const text = total <= 0 ? '' : total > 99 ? '99+' : String(total);
  try {
    if (total > 0) {
      void chrome.action?.setBadgeBackgroundColor?.({ color: '#EF4444' });
      void chrome.action?.setBadgeTextColor?.({ color: '#FFFFFF' });
    }
    void chrome.action?.setBadgeText?.({ text });
  } catch {
    // Ignore when action badge API is unavailable
  }
}
```

4. In `UNREAD_UPDATE` case:
```ts
    case 'UNREAD_UPDATE': {
      if (Object.hasOwn(PROVIDERS, rawMsg.providerId)) {
        const nextCount =
          typeof rawMsg.count === 'number' && Number.isFinite(rawMsg.count) && rawMsg.count > 0
            ? Math.floor(rawMsg.count)
            : 0;
        unreadsUpdatedInMemory = true;
        unreadsByProvider[rawMsg.providerId] = pausedByProvider[rawMsg.providerId] ? 0 : nextCount;
        syncActionBadge();
        void persistSession({
          [SW_UNREADS_KEY]: { unreads: { ...unreadsByProvider }, paused: { ...pausedByProvider } }
        });
      }
      void broadcastToWorkspace(rawMsg);
      sendResponse({ ok: true });
      return false;
    }
```

5. In `SYNC_PREFS` case, if `rawMsg.prefs.paused && typeof rawMsg.prefs.paused === 'object'`, update `pausedByProvider` for each `PROVIDER_ORDER`, zero `unreadsByProvider[id]` when `pausedByProvider[id]` is `true`, call `syncActionBadge()`, and persist `SW_UNREADS_KEY`.
6. Add `FRAME_FOCUSED` case:
```ts
    case 'FRAME_FOCUSED': {
      if (!Object.hasOwn(PROVIDERS, rawMsg.providerId)) {
        sendResponse({ ok: false });
        return false;
      }
      void (async () => {
        await ensureHydrated();
        focusUpdatedInMemory = true;
        currentFocusedProvider = rawMsg.providerId;
        const nextFocus = {
          windowFocused: currentWindowFocused,
          focusedProvider: currentFocusedProvider
        };
        router.setFocusState(nextFocus);
        await persistSession({ [SW_FOCUS_KEY]: { ...nextFocus, tabId: workspaceTabId } });
        await broadcastToWorkspace({
          type: 'ACTIVE_PROVIDER_CHANGED',
          providerId: rawMsg.providerId
        });
      })();
      sendResponse({ ok: true });
      return false;
    }
```

7. Update `TEST_NOTIFY` copy in `src/background/service-worker.ts` to accented Vietnamese:
   `title: 'Dia MultiChat'`, `message: 'Thông báo native macOS hoạt động tốt!'`.

8. In `src/content/frame-agent.isolated.ts`, add `let lastFocusSentAt = 0;` and `onFrameInteraction`:
```ts
  const onFrameInteraction = (): void => {
    const now = Date.now();
    if (now - lastFocusSentAt < 800) return;
    lastFocusSentAt = now;
    sendToBackground({ type: 'FRAME_FOCUSED', providerId });
  };
```
Attach `window.addEventListener('pointerdown', onFrameInteraction, true);` and `window.addEventListener('focusin', onFrameInteraction, true);` alongside `keydown`, and remove both in `pagehide`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/notify-router.test.ts tests/unit/content-agents.test.ts && npm run typecheck`
Expected: PASS (all tests in `notify-router.test.ts` and `content-agents.test.ts` pass, `0` type errors).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/background/notify-router.ts src/background/service-worker.ts src/content/frame-agent.isolated.ts tests/unit/notify-router.test.ts tests/unit/content-agents.test.ts
git commit -m "feat(notifications): add per-provider icons, Vietnamese formatting, action badge, and active-pane focus sync"
```

---

### Task 4: Workspace UI Polish - Approach A (Inline SVGs, Dynamic Favicon, Auto-Hide Top Drawer, 28px Matte Header, Maximize 100%, Tactile Splitter)

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/workspace/icons.ts`
- Create: `src/workspace/favicon.ts`
- Modify: `src/workspace/bento-state.ts`
- Modify: `public/workspace.html`
- Modify: `public/workspace.css`
- Modify: `src/workspace/workspace.ts`
- Modify: `tests/unit/bento-state.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_PROVIDER_CHANGED`, `SYNC_PREFS.paused`, `icons/icon-32.png`
- Produces:
  - `WorkspacePrefs.topbarPinned: boolean` (default `false`)
  - `createBrandIconSvg(providerId: ProviderId, size?: number): SVGSVGElement` and `createActionIconSvg(kind: ActionIconName, size?: number): SVGSVGElement` in `src/workspace/icons.ts`
  - `updateWorkspaceFavicon(doc: Document, totalUnread: number): void` in `src/workspace/favicon.ts`
  - `formatSplitRatio(mainWidthPct: number): string` and `isAltMaximizeShortcut(ev: ShortcutKeyInput): boolean` in `src/workspace/bento-state.ts`

- [ ] **Step 1: Write the failing unit tests for Approach A Workspace UI, Auto-Hide Top Drawer pin, SVG buttons, Maximize 100%, Splitter double-click reset, Active Focus dot, and Dynamic Favicon**

Update `tests/unit/bento-state.test.ts`:
1. Import `formatSplitRatio` and `isAltMaximizeShortcut` from `../../src/workspace/bento-state`.
2. In `sanitizes corrupted or partial WorkspacePrefs from storage` (`tests/unit/bento-state.test.ts:93`), include `topbarPinned: false` in `expect(dupOrder).toEqual({ ... })` and verify `topbarPinned: true` is preserved when boolean.
3. Add pure-function assertions for `formatSplitRatio(66)` (`'Chính 66% • Phụ 34%'`) and `isAltMaximizeShortcut` (`Alt+M` / macOS `Option+M` where `ev.code === 'KeyM'` and `ev.key === 'µ'`).
4. In `Workspace UI DOM integration` tests:
   - Update duplicate tab button text expectation (`lines 406 & 655`) to accented Vietnamese: `'Đóng 1 tab trùng'` and `'Đóng 2 tab trùng'`.
   - Update pane control button lookups to use `data-action` attributes:
     - `telegramPane.querySelector<HTMLButtonElement>('button[data-action="pause"]')!`
     - `telegramPane.querySelector<HTMLButtonElement>('button[data-action="reauth"]')!`
     - `telegramPane.querySelector<HTMLButtonElement>('button[data-action="maximize"]')!`
     - `telegramPane.querySelector<HTMLButtonElement>('button[data-action="reload"]')!`
   - Verify paused state updates `pauseBtn.dataset.paused === 'true'` and `pauseBtn.getAttribute('aria-label') === 'Mở lại khung'` instead of raw `'Resume'` text, and verify zero `Main 60fps` / `Sub 2fps` debug text exists anywhere in `.pane-header`.
   - Update `SYNC_PREFS` expectation (`line 535`) to include `paused: { zalo: false, messenger: false, telegram: false, discord: true }`.
   - Add a new test verifying **Auto-Hide Topbar Pin (`#btn-pin-topbar`)**, **Maximize 100% (`data-action="maximize"`, `Alt+M`, `Escape`)**, **Splitter `#resize-indicator` + `dblclick` reset to `66%`**, and **`ACTIVE_PROVIDER_CHANGED` / iframe focus active dot**:

```ts
  it('supports Auto-Hide Topbar pinning, Zero-Scroll-Loss Maximize 100% (button, Alt+M, Esc), splitter dblclick reset, and active-pane focus tracking', async () => {
    loadWorkspaceMarkup();

    const storedState: Record<string, unknown> = {};
    const sentRuntime: RuntimeMessage[] = [];
    const runtimeListeners: Array<(msg: RuntimeMessage) => void> = [];

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storedState[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storedState, items);
          })
        }
      },
      runtime: {
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: (res: unknown) => void) => {
          sentRuntime.push(msg);
          cb?.({});
        }),
        onMessage: {
          addListener: vi.fn((fn: (msg: RuntimeMessage) => void) => {
            runtimeListeners.push(fn);
          }),
          removeListener: vi.fn()
        },
        lastError: undefined
      }
    });

    await import('../../src/workspace/workspace');
    await flushMicrotasks();

    // 1) Topbar defaults to unpinned auto-hide, clicking #btn-pin-topbar pins and persists topbarPinned
    expect(document.body.classList.contains('topbar-pinned')).toBe(false);
    const pinBtn = document.getElementById('btn-pin-topbar')!;
    pinBtn.click();
    expect(document.body.classList.contains('topbar-pinned')).toBe(true);
    expect((storedState.dia_bento_prefs_v1 as WorkspacePrefs).topbarPinned).toBe(true);

    // 2) Brand SVG icon and 4 SVG action buttons exist in every header with zero debug fps text
    const msgrPane = document.querySelector<HTMLElement>('section.pane[data-provider="messenger"]')!;
    expect(msgrPane.querySelector('svg.brand-icon')).not.toBeNull();
    expect(msgrPane.querySelector('.pane-header')!.textContent).not.toContain('2fps');

    // 3) Maximize Messenger via button -> body[data-maximized="messenger"], Escape exits Maximize without DOM reparenting
    const msgrMaxBtn = msgrPane.querySelector<HTMLButtonElement>('button[data-action="maximize"]')!;
    msgrMaxBtn.click();
    expect(document.body.dataset.maximized).toBe('messenger');
    expect(msgrPane.dataset.maximized).toBe('true');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(document.body.dataset.maximized).toBeUndefined();
    expect(msgrPane.dataset.maximized).toBeUndefined();

    // Alt+M (macOS Option+M: code KeyM, key 'µ') toggles Maximize on currently active pane (zalo)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, code: 'KeyM', key: 'µ', cancelable: true })
    );
    expect(document.body.dataset.maximized).toBe('zalo');
    window.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, code: 'KeyM', key: 'µ', cancelable: true })
    );
    expect(document.body.dataset.maximized).toBeUndefined();

    // 4) Splitter drag updates #resize-indicator and double-click resets --main-width to 66%
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const resizer = document.getElementById('grid-resizer')!;
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 660, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 520 }));
    expect(document.getElementById('resize-indicator')!.textContent).toBe('Chính 52% • Phụ 48%');
    window.dispatchEvent(new MouseEvent('mouseup'));

    resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(document.documentElement.style.getPropertyValue('--main-width')).toBe('66%');
    expect((storedState.dia_bento_prefs_v1 as WorkspacePrefs).mainWidthPct).toBe(66);

    // 5) ACTIVE_PROVIDER_CHANGED moves data-active="true" to sub-pane without swapping slots
    runtimeListeners[0]?.({ type: 'ACTIVE_PROVIDER_CHANGED', providerId: 'telegram' });
    const tgPane = document.querySelector<HTMLElement>('section.pane[data-provider="telegram"]')!;
    const zaloPane = document.querySelector<HTMLElement>('section.pane[data-provider="zalo"]')!;
    expect(tgPane.dataset.active).toBe('true');
    expect(zaloPane.dataset.active).toBe('false');
    expect(zaloPane.dataset.slot).toBe('main');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/bento-state.test.ts`
Expected: FAIL because `src/workspace/icons.ts`, `src/workspace/favicon.ts`, `topbarPinned`, `formatSplitRatio`, and `isAltMaximizeShortcut` do not exist yet.

- [ ] **Step 3: Implement `types.ts`, `icons.ts`, `favicon.ts`, `bento-state.ts`, `workspace.html`, `workspace.css`, and `workspace.ts`**

1. In `src/shared/types.ts`, add `topbarPinned: boolean;` to `WorkspacePrefs`:

```ts
export interface WorkspacePrefs {
  slotOrder: [ProviderId, ProviderId, ProviderId, ProviderId];
  mainWidthPct: number;
  topbarPinned: boolean;
  dnd: boolean;
  hidePreview: boolean;
  liteMedia: boolean;
  paused: Record<ProviderId, boolean>;
}
```

2. Create `src/workspace/icons.ts`:

```ts
import type { ProviderId } from '../shared/types';

export type ActionIconName =
  | 'maximize'
  | 'restore'
  | 'pause'
  | 'play'
  | 'reload'
  | 'reauth'
  | 'pin';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

export function createBrandIconSvg(providerId: ProviderId, size = 15): SVGSVGElement {
  const svg = svgEl('svg', {
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    class: `brand-icon brand-icon-${providerId}`
  });

  if (providerId === 'zalo') {
    svg.append(
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: '#0068FF' }),
      svgEl('path', {
        d: 'M7.2 7.5h9.6L7.2 16.5h9.6',
        stroke: '#FFFFFF',
        'stroke-width': '2.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      })
    );
  } else if (providerId === 'messenger') {
    const gradId = `dia-msgr-grad-${Math.random().toString(36).slice(2, 8)}`;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '1', x2: '1', y2: '0' });
    grad.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#0099FF' }),
      svgEl('stop', { offset: '55%', 'stop-color': '#A033FF' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#FF5280' })
    );
    defs.appendChild(grad);
    svg.append(
      defs,
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: `url(#${gradId})` }),
      svgEl('path', {
        d: 'M5.5 14.6l4.4-4.7 2.5 2.4 4.4-4.7-4.4 6.8-2.5-2.4-4.4 2.6z',
        fill: '#FFFFFF'
      })
    );
  } else if (providerId === 'telegram') {
    svg.append(
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: '#2AABEE' }),
      svgEl('path', {
        d: 'M18.4 6.4L5.3 11.5c-.8.3-.8.8-.1 1l3.3 1 7.7-4.8c.4-.2.7-.1.4.2l-6.2 5.6-.2 3.3c.3 0 .5-.1.7-.3l1.7-1.6 3.4 2.5c.6.3 1.1.2 1.2-.6l2.2-10.5c.2-.8-.3-1.2-1-.9z',
        fill: '#FFFFFF'
      })
    );
  } else {
    svg.append(
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: '#5865F2' }),
      svgEl('path', {
        d: 'M17.5 8.2A11 11 0 0014.7 7.3l-.4.8a10 10 0 00-4.6 0l-.4-.8a11 11 0 00-2.8.9C4.7 10.9 4.2 13.5 4.5 16a11 11 0 003.4 1.7l.7-1.1c-.4-.2-.8-.4-1.1-.7l.3-.2a8 8 0 008.4 0l.3.2c-.3.3-.7.5-1.1.7l.7 1.1a11 11 0 003.4-1.7c.3-2.9-.5-5.5-2-7.8zM9.5 14.1c-.7 0-1.2-.6-1.2-1.3 0-.7.5-1.3 1.2-1.3s1.2.6 1.2 1.3c0 .7-.5 1.3-1.2 1.3zm5 0c-.7 0-1.2-.6-1.2-1.3 0-.7.5-1.3 1.2-1.3s1.2.6 1.2 1.3c0 .7-.5 1.3-1.2 1.3z',
        fill: '#FFFFFF'
      })
    );
  }

  return svg;
}

const ACTION_PATHS: Record<ActionIconName, string> = {
  maximize: 'M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6',
  restore: 'M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 6l10 6-10 6V6z',
  reload: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  reauth: 'M15 7a4 4 0 11-7.5 2L3 13.5V17h3.5v-2h2v-2l1.6-1.6A4 4 0 0115 7z',
  pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v5'
};

export function createActionIconSvg(kind: ActionIconName, size = 13): SVGSVGElement {
  const svg = svgEl('svg', {
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    class: `action-icon action-icon-${kind}`
  });
  svg.appendChild(
    svgEl('path', {
      d: ACTION_PATHS[kind],
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
  );
  return svg;
}
```

3. Create `src/workspace/favicon.ts`:

```ts
export function updateWorkspaceFavicon(doc: Document, totalUnread: number): void {
  let link = doc.querySelector<HTMLLinkElement>('link#workspace-favicon');
  if (!link) {
    link = doc.createElement('link');
    link.id = 'workspace-favicon';
    link.rel = 'icon';
    link.type = 'image/png';
    (doc.head ?? doc.documentElement)?.appendChild(link);
  }

  if (totalUnread <= 0) {
    link.href = 'icons/icon-32.png';
    return;
  }

  try {
    const canvas = doc.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      link.href = 'icons/icon-32.png';
      return;
    }

    // Dark squircle base
    ctx.fillStyle = '#0F131D';
    ctx.beginPath();
    ctx.roundRect(4, 4, 56, 56, 14);
    ctx.fill();

    // Bento 4-color quadrants
    ctx.fillStyle = '#0068FF';
    ctx.beginPath();
    ctx.roundRect(11, 11, 22, 42, 5);
    ctx.fill();

    ctx.fillStyle = '#A033FF';
    ctx.beginPath();
    ctx.roundRect(37, 11, 16, 12, 3.5);
    ctx.fill();

    ctx.fillStyle = '#2AABEE';
    ctx.beginPath();
    ctx.roundRect(37, 26, 16, 12, 3.5);
    ctx.fill();

    ctx.fillStyle = '#5865F2';
    ctx.beginPath();
    ctx.roundRect(37, 41, 16, 12, 3.5);
    ctx.fill();

    // Red unread counter badge
    const label = totalUnread > 9 ? '9+' : String(totalUnread);
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(48, 16, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0A0D14';
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 48, 17);

    link.href = canvas.toDataURL('image/png');
  } catch {
    link.href = 'icons/icon-32.png';
  }
}
```

4. Update `src/workspace/bento-state.ts`:
   - Add `topbarPinned: false` to `DEFAULT_PREFS` and `sanitizeWorkspacePrefs` (`const topbarPinned = typeof obj.topbarPinned === 'boolean' ? obj.topbarPinned : DEFAULT_PREFS.topbarPinned;`).
   - Export `formatSplitRatio(mainWidthPct: number): string`:
     ```ts
     export function formatSplitRatio(mainWidthPct: number): string {
       const main = clampMainWidth(mainWidthPct);
       return `Chính ${main}% • Phụ ${100 - main}%`;
     }
     ```
   - Export `isAltMaximizeShortcut`:
     ```ts
     export function isAltMaximizeShortcut(ev: {
       altKey: boolean;
       ctrlKey: boolean;
       metaKey: boolean;
       shiftKey: boolean;
       code: string;
       key: string;
     }): boolean {
       if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return false;
       return ev.code === 'KeyM' || (!ev.code && (ev.key === 'm' || ev.key === 'M'));
     }
     ```

5. Replace `public/workspace.html` with:

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dia Bento Chat Hub</title>
    <link id="workspace-favicon" rel="icon" type="image/png" href="icons/icon-32.png" />
    <link rel="stylesheet" href="workspace.css" />
  </head>
  <body>
    <div id="topbar-shell">
      <div id="topbar-sensor" aria-hidden="true">
        <div id="topbar-pill">
          <span class="pill-title">Dia MultiChat</span>
          <span id="pill-unread" class="badge hidden">0</span>
        </div>
      </div>

      <header id="topbar">
        <div class="topbar-left">
          <span class="brand">Dia MultiChat</span>
          <span id="total-unread" class="badge hidden">0</span>
          <button id="dup-tabs-btn" class="warn-btn hidden" type="button"></button>
        </div>
        <div class="topbar-right">
          <span class="hint">⌥1..4 đổi khung • ⌥M phóng to</span>
          <button
            id="btn-lite-media"
            class="toggle-btn"
            type="button"
            title="Chặn tự phát GIF nặng để giảm RAM"
          >
            Tiết kiệm Media
          </button>
          <button
            id="btn-hide-preview"
            class="toggle-btn"
            type="button"
            title="Ẩn tên người gửi và nội dung trên banner thông báo"
          >
            Ẩn nội dung
          </button>
          <button
            id="btn-dnd"
            class="toggle-btn"
            type="button"
            title="Tắt toàn bộ thông báo macOS"
          >
            Không làm phiền
          </button>
          <button id="btn-test-notify" class="action-btn" type="button">
            Thử thông báo
          </button>
          <button
            id="btn-pin-topbar"
            class="toggle-btn icon-only-btn"
            type="button"
            title="Ghim cố định thanh công cụ"
            aria-label="Ghim cố định thanh công cụ"
          ></button>
        </div>
      </header>
    </div>

    <main id="bento-grid">
      <div
        id="grid-resizer"
        title="Kéo để chỉnh độ rộng khung Chính / Phụ (Nháy đúp để khôi phục 66%)"
      >
        <span class="resizer-grip"></span>
      </div>
      <div id="resize-indicator" class="hidden" aria-live="polite"></div>
    </main>

    <script src="workspace.js"></script>
  </body>
</html>
```

6. Replace `public/workspace.css` with:

```css
:root {
  --main-width: 66%;
  --topbar-h: 34px;
  --bg: #0a0d14;
  --panel: #0e121b;
  --header: #131824;
  --header-main: #151e34;
  --border: #232a3b;
  --border-subtle: #1b2130;
  --accent: #3b82f6;
  --focus-cyan: #38bdf8;
  --text: #e2e8f0;
  --muted: #8b98ad;
  --danger: #ef4444;
  --warn: #f59e0b;
  --ok: #22c55e;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  font-size: 12px;
  -webkit-font-smoothing: antialiased;
}

.hidden {
  display: none !important;
}

/* Auto-Hide Top Drawer */
#topbar-shell {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  pointer-events: none;
}

#topbar-sensor {
  height: 5px;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  pointer-events: auto;
}

#topbar-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 10px 2px;
  border-radius: 0 0 9px 9px;
  background: rgba(19, 24, 36, 0.92);
  border: 1px solid var(--border);
  border-top: none;
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  opacity: 0.72;
  transition: opacity 0.14s ease;
}

body.has-unread #topbar-pill {
  opacity: 1;
  color: var(--text);
  border-color: rgba(239, 68, 68, 0.45);
}

#topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  background: rgba(15, 19, 29, 0.96);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  user-select: none;
  pointer-events: auto;
  transform: translateY(-105%);
  transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);
}

#topbar-shell:hover #topbar,
#topbar-shell:focus-within #topbar,
body.has-dup-tabs #topbar,
body.topbar-pinned #topbar {
  transform: translateY(0);
}

body.topbar-pinned #topbar-shell {
  position: relative;
  height: var(--topbar-h);
}

body.topbar-pinned #topbar-sensor {
  display: none;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.brand {
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.15px;
  color: #f8fafc;
  white-space: nowrap;
}

.hint {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  margin-right: 2px;
}

.badge {
  flex-shrink: 0;
  background: var(--danger);
  color: #ffffff;
  font-weight: 700;
  font-size: 10px;
  line-height: 14px;
  min-width: 16px;
  text-align: center;
  padding: 0 5px;
  border-radius: 999px;
  white-space: nowrap;
}

button {
  background: #1a2132;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: border-color 0.12s, background-color 0.12s, color 0.12s;
}

button:hover {
  border-color: var(--accent);
  background: #212a40;
}

.icon-only-btn {
  width: 24px;
  height: 24px;
  padding: 0;
}

.toggle-btn.active {
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(34, 197, 94, 0.55);
  color: #86efac;
}

.warn-btn {
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.55);
  color: #fde68a;
}

/* Bento Grid & Tactile Splitter */
#bento-grid {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: grid;
  grid-template-columns: var(--main-width) 6px 1fr;
  grid-template-rows: repeat(3, 1fr);
  grid-template-areas:
    "main resizer sub1"
    "main resizer sub2"
    "main resizer sub3";
  background: var(--bg);
}

body.topbar-pinned #bento-grid {
  height: calc(100vh - var(--topbar-h));
}

#grid-resizer {
  grid-area: resizer;
  cursor: col-resize;
  background: #121723;
  border-left: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.12s;
}

.resizer-grip {
  width: 2px;
  height: 28px;
  border-radius: 99px;
  background: #3b4761;
  transition: background-color 0.12s, height 0.12s;
}

#grid-resizer:hover,
body.resizing #grid-resizer {
  background: rgba(59, 130, 246, 0.18);
}

#grid-resizer:hover .resizer-grip,
body.resizing #grid-resizer .resizer-grip {
  background: var(--accent);
  height: 40px;
}

body.resizing iframe {
  pointer-events: none;
}

#resize-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 35;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(15, 19, 29, 0.94);
  border: 1px solid var(--accent);
  color: #f8fafc;
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

/* Panes & 28px Matte Headers */
.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.pane[data-slot="main"] {
  grid-area: main;
  border-bottom: none;
}

.pane[data-slot="sub-1"] {
  grid-area: sub1;
}

.pane[data-slot="sub-2"] {
  grid-area: sub2;
}

.pane[data-slot="sub-3"] {
  grid-area: sub3;
  border-bottom: none;
}

/* Zero-Scroll-Loss Maximize 100% Overlay */
body[data-maximized] #grid-resizer {
  visibility: hidden;
  pointer-events: none;
}

body[data-maximized] .pane:not([data-maximized="true"]) {
  visibility: hidden;
  pointer-events: none;
}

body[data-maximized] .pane[data-maximized="true"] {
  position: absolute;
  inset: 0;
  z-index: 25;
  border-bottom: none;
}

.pane-header {
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 7px 0 8px;
  background: var(--header);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.pane[data-slot="main"] .pane-header {
  background: var(--header-main);
}

.pane[data-active="true"] .pane-header {
  border-bottom-color: rgba(56, 189, 248, 0.65);
}

.pane-title-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  background: transparent;
  border: none;
  padding: 2px 4px 2px 0;
  font-weight: 600;
  font-size: 12px;
  color: var(--text);
}

.pane-title-btn:hover {
  background: transparent;
  color: #ffffff;
}

.brand-icon {
  flex-shrink: 0;
}

.pane-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.kbd-chip {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 0 4px;
  line-height: 14px;
}

.pane-focus-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--focus-cyan);
  box-shadow: 0 0 7px var(--focus-cyan);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.pane[data-active="true"] .pane-focus-dot {
  opacity: 1;
}

.pane-controls {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 3px;
}

.icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  color: #9aa7bd;
}

.icon-btn:hover {
  color: #f8fafc;
  background: #222b40;
  border-color: #364463;
}

.icon-btn.is-active {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
}

.pane-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--panel);
}

.pane-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--panel);
}

.paused-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
  background: var(--bg);
  color: var(--muted);
}

.paused-overlay button {
  padding: 5px 12px;
  font-weight: 600;
}
```

7. Replace `src/workspace/workspace.ts` with:

```ts
import type {
  ExternalProviderTab,
  PendingClickTarget,
  ProviderId,
  RuntimeMessage,
  SlotId,
  WorkspacePrefs,
  WorkspaceToFrameMessage
} from '../shared/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers/registry';
import {
  SLOT_IDS,
  clampMainWidth,
  extractAltShortcutDigit,
  formatSplitRatio,
  formatWorkspaceTitle,
  isAltMaximizeShortcut,
  resolveEmbedUrl,
  sanitizeWorkspacePrefs,
  swapProviderToMain
} from './bento-state';
import { createActionIconSvg, createBrandIconSvg } from './icons';
import { updateWorkspaceFavicon } from './favicon';

const STORAGE_KEY = 'dia_bento_prefs_v1';
const SANDBOX_FLAGS =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
const ALLOW_PERMS = 'clipboard-read; clipboard-write; microphone; camera';

interface PaneDom {
  section: HTMLElement;
  unreadBadge: HTMLElement;
  maximizeBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  pausedOverlay: HTMLElement;
  iframe: HTMLIFrameElement;
}

const searchParams = new URLSearchParams(window.location.search);
const testOrigin = searchParams.get('testOrigin');
const lifecycle = new AbortController();

let prefs: WorkspacePrefs = sanitizeWorkspacePrefs(null);
let activeProvider: ProviderId = prefs.slotOrder[0];
let maximizedProvider: ProviderId | null = null;

const unreads: Record<ProviderId, number> = {
  zalo: 0,
  messenger: 0,
  telegram: 0,
  discord: 0
};
const panes = new Map<ProviderId, PaneDom>();

function sendRuntime(msg: RuntimeMessage, cb?: (res: unknown) => void): void {
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      cb?.(res);
    });
  } catch {
    // Ignore outside extension context
  }
}

async function loadPrefs(): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    prefs = sanitizeWorkspacePrefs(stored?.[STORAGE_KEY]);
    activeProvider = prefs.slotOrder[0];
  } catch {
    prefs = sanitizeWorkspacePrefs(null);
    activeProvider = prefs.slotOrder[0];
  }
}

function savePrefs(): void {
  if (globalThis.chrome?.storage?.local) {
    void chrome.storage.local.set({ [STORAGE_KEY]: prefs });
  }
  sendRuntime({
    type: 'SYNC_PREFS',
    prefs: {
      dnd: prefs.dnd,
      hidePreview: prefs.hidePreview,
      liteMedia: prefs.liteMedia,
      paused: { ...prefs.paused }
    }
  });
}

function postSlotMode(providerId: ProviderId, isMain: boolean): void {
  const pane = panes.get(providerId);
  if (!pane || prefs.paused[providerId]) return;
  const msg: WorkspaceToFrameMessage = {
    source: 'dia-bento-workspace',
    type: 'DIA_SLOT_MODE',
    providerId,
    isMain
  };
  pane.iframe.contentWindow?.postMessage(msg, '*');
}

function updatePauseButtonIcon(btn: HTMLButtonElement, paused: boolean): void {
  btn.dataset.paused = paused ? 'true' : 'false';
  const label = paused ? 'Mở lại khung' : 'Tạm dừng khung (0 MB RAM)';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.classList.toggle('is-active', paused);
  btn.replaceChildren(createActionIconSvg(paused ? 'play' : 'pause'));
}

function updateMaximizeButtonIcon(btn: HTMLButtonElement, isMaximized: boolean): void {
  const label = isMaximized ? 'Thu về lưới Bento (Esc)' : 'Phóng to khung này (Alt+M)';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.classList.toggle('is-active', isMaximized);
  btn.replaceChildren(createActionIconSvg(isMaximized ? 'restore' : 'maximize'));
}

function isWorkspaceWindowFocused(): boolean {
  if (document.visibilityState !== 'visible') return false;
  return document.hasFocus() || document.activeElement instanceof HTMLIFrameElement;
}

function reportFocusState(): void {
  for (const [id, pane] of panes.entries()) {
    pane.section.dataset.active = id === activeProvider ? 'true' : 'false';
  }
  sendRuntime({
    type: 'WORKSPACE_FOCUS_STATE',
    windowFocused: isWorkspaceWindowFocused(),
    focusedProvider: activeProvider
  });
}

function applyLayout(): void {
  document.documentElement.style.setProperty('--main-width', `${prefs.mainWidthPct}%`);
  document.body.classList.toggle('topbar-pinned', prefs.topbarPinned);

  if (maximizedProvider && !prefs.paused[maximizedProvider]) {
    document.body.dataset.maximized = maximizedProvider;
  } else {
    maximizedProvider = null;
    delete document.body.dataset.maximized;
  }

  prefs.slotOrder.forEach((providerId, index) => {
    const slot: SlotId = SLOT_IDS[index] ?? 'sub-3';
    const pane = panes.get(providerId);
    if (!pane) return;
    pane.section.dataset.slot = slot;

    const isMax = maximizedProvider === providerId;
    if (isMax) {
      pane.section.dataset.maximized = 'true';
    } else {
      delete pane.section.dataset.maximized;
    }
    updateMaximizeButtonIcon(pane.maximizeBtn, isMax);

    const effectiveMain = maximizedProvider ? isMax : slot === 'main';
    postSlotMode(providerId, effectiveMain);
  });

  document.getElementById('btn-lite-media')?.classList.toggle('active', prefs.liteMedia);
  document.getElementById('btn-hide-preview')?.classList.toggle('active', prefs.hidePreview);
  document.getElementById('btn-dnd')?.classList.toggle('active', prefs.dnd);
  document.getElementById('btn-pin-topbar')?.classList.toggle('active', prefs.topbarPinned);

  reportFocusState();
}

function updateUnreadUi(): void {
  let total = 0;
  for (const id of PROVIDER_ORDER) {
    const count = unreads[id] || 0;
    total += count;
    const pane = panes.get(id);
    if (!pane) continue;
    pane.unreadBadge.textContent = String(count);
    pane.unreadBadge.classList.toggle('hidden', count <= 0);
  }
  for (const badgeId of ['total-unread', 'pill-unread']) {
    const el = document.getElementById(badgeId);
    if (el) {
      el.textContent = String(total);
      el.classList.toggle('hidden', total <= 0);
    }
  }
  document.body.classList.toggle('has-unread', total > 0);
  document.title = formatWorkspaceTitle(unreads);
  updateWorkspaceFavicon(document, total);
}

function setPausedDom(providerId: ProviderId, paused: boolean): void {
  const pane = panes.get(providerId);
  if (!pane) return;
  prefs.paused[providerId] = paused;
  updatePauseButtonIcon(pane.pauseBtn, paused);
  if (paused) {
    if (maximizedProvider === providerId) {
      maximizedProvider = null;
    }
    pane.iframe.src = 'about:blank';
    pane.pausedOverlay.classList.remove('hidden');
    unreads[providerId] = 0;
    updateUnreadUi();
  } else {
    pane.pausedOverlay.classList.add('hidden');
    pane.iframe.src = resolveEmbedUrl(providerId, testOrigin);
  }
}

function focusProvider(providerId: ProviderId): void {
  if (prefs.paused[providerId]) {
    setPausedDom(providerId, false);
  }
  activeProvider = providerId;
  if (maximizedProvider && maximizedProvider !== providerId) {
    maximizedProvider = providerId;
  }
  prefs.slotOrder = swapProviderToMain(prefs.slotOrder, providerId);
  applyLayout();
  savePrefs();
  if (!prefs.paused[providerId]) {
    panes.get(providerId)?.iframe.focus();
  }
}

function toggleMaximize(targetProvider?: ProviderId): void {
  const candidate = targetProvider ?? activeProvider ?? prefs.slotOrder[0];
  if (maximizedProvider === candidate) {
    maximizedProvider = null;
  } else {
    if (prefs.paused[candidate]) {
      setPausedDom(candidate, false);
      savePrefs();
    }
    maximizedProvider = candidate;
    activeProvider = candidate;
  }
  applyLayout();
  if (maximizedProvider && !prefs.paused[maximizedProvider]) {
    panes.get(maximizedProvider)?.iframe.focus();
  }
}

function togglePause(providerId: ProviderId, nextPaused?: boolean): void {
  if (!panes.has(providerId)) return;
  const paused = nextPaused ?? !prefs.paused[providerId];
  setPausedDom(providerId, paused);
  applyLayout();
  savePrefs();
}

function reloadProvider(providerId: ProviderId): void {
  const pane = panes.get(providerId);
  if (!pane) return;
  if (prefs.paused[providerId]) {
    togglePause(providerId, false);
    return;
  }
  pane.iframe.src = resolveEmbedUrl(providerId, testOrigin);
}

function mountPanes(): void {
  const grid = document.getElementById('bento-grid');
  if (!grid) return;

  const pinBtn = document.getElementById('btn-pin-topbar');
  pinBtn?.replaceChildren(createActionIconSvg('pin'));

  for (const providerId of PROVIDER_ORDER) {
    const cfg = PROVIDERS[providerId];
    const section = document.createElement('section');
    section.className = 'pane';
    section.dataset.provider = providerId;
    section.dataset.slot = 'sub-3';

    const header = document.createElement('div');
    header.className = 'pane-header';

    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = 'pane-title-btn';
    titleBtn.title = `Đưa ${cfg.name} lên khung chính (⌥${cfg.shortcutIndex})`;
    titleBtn.addEventListener('click', () => focusProvider(providerId));

    const brandSvg = createBrandIconSvg(providerId, 15);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'pane-name';
    nameSpan.textContent = cfg.name;

    const unreadBadge = document.createElement('span');
    unreadBadge.className = 'badge hidden';
    unreadBadge.textContent = '0';

    const kbdChip = document.createElement('span');
    kbdChip.className = 'kbd-chip';
    kbdChip.textContent = `⌥${cfg.shortcutIndex}`;

    const focusDot = document.createElement('span');
    focusDot.className = 'pane-focus-dot';
    focusDot.title = 'Khung đang tương tác';

    titleBtn.append(brandSvg, nameSpan, unreadBadge, kbdChip, focusDot);

    const controls = document.createElement('div');
    controls.className = 'pane-controls';

    const maximizeBtn = document.createElement('button');
    maximizeBtn.type = 'button';
    maximizeBtn.className = 'icon-btn';
    maximizeBtn.dataset.action = 'maximize';
    updateMaximizeButtonIcon(maximizeBtn, false);
    maximizeBtn.addEventListener('click', () => toggleMaximize(providerId));

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'icon-btn';
    pauseBtn.dataset.action = 'pause';
    updatePauseButtonIcon(pauseBtn, prefs.paused[providerId]);
    pauseBtn.addEventListener('click', () => togglePause(providerId));

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'icon-btn';
    reloadBtn.dataset.action = 'reload';
    reloadBtn.title = 'Tải lại khung này';
    reloadBtn.setAttribute('aria-label', 'Tải lại khung này');
    reloadBtn.appendChild(createActionIconSvg('reload'));
    reloadBtn.addEventListener('click', () => reloadProvider(providerId));

    const reauthBtn = document.createElement('button');
    reauthBtn.type = 'button';
    reauthBtn.className = 'icon-btn';
    reauthBtn.dataset.action = 'reauth';
    reauthBtn.title = 'Đăng nhập lại (Mở cửa sổ xác thực)';
    reauthBtn.setAttribute('aria-label', 'Đăng nhập lại');
    reauthBtn.appendChild(createActionIconSvg('reauth'));
    reauthBtn.addEventListener('click', () =>
      sendRuntime({ type: 'OPEN_REAUTH', providerId })
    );

    controls.append(maximizeBtn, pauseBtn, reloadBtn, reauthBtn);
    header.append(titleBtn, controls);

    const body = document.createElement('div');
    body.className = 'pane-body';

    const iframe = document.createElement('iframe');
    iframe.className = 'pane-iframe';
    iframe.setAttribute('sandbox', SANDBOX_FLAGS);
    iframe.setAttribute('allow', ALLOW_PERMS);
    iframe.src = prefs.paused[providerId] ? 'about:blank' : resolveEmbedUrl(providerId, testOrigin);
    iframe.addEventListener('load', () => {
      const effectiveMain = maximizedProvider
        ? maximizedProvider === providerId
        : prefs.slotOrder[0] === providerId;
      postSlotMode(providerId, effectiveMain);
    });

    const pausedOverlay = document.createElement('div');
    pausedOverlay.className = `paused-overlay ${prefs.paused[providerId] ? '' : 'hidden'}`.trim();
    const pausedLogo = createBrandIconSvg(providerId, 28);
    const pausedLabel = document.createElement('span');
    pausedLabel.textContent = `${cfg.name} đang tạm dừng (0 MB RAM)`;
    const wakeBtn = document.createElement('button');
    wakeBtn.type = 'button';
    wakeBtn.textContent = 'Mở lại ngay';
    wakeBtn.addEventListener('click', () => togglePause(providerId, false));
    pausedOverlay.append(pausedLogo, pausedLabel, wakeBtn);

    body.append(iframe, pausedOverlay);
    section.append(header, body);
    grid.appendChild(section);

    panes.set(providerId, {
      section,
      unreadBadge,
      maximizeBtn,
      pauseBtn,
      pausedOverlay,
      iframe
    });
  }
}

function updateDupTabsBanner(tabs: ExternalProviderTab[]): void {
  const btn = document.getElementById('dup-tabs-btn') as HTMLButtonElement | null;
  if (!btn) return;
  document.body.classList.toggle('has-dup-tabs', tabs.length > 0);
  if (tabs.length === 0) {
    btn.classList.add('hidden');
    return;
  }
  btn.textContent = `Đóng ${tabs.length} tab trùng`;
  btn.classList.remove('hidden');
}

function applyNotificationClickTarget(target: PendingClickTarget): void {
  if (!Object.hasOwn(PROVIDERS, target.providerId)) return;
  focusProvider(target.providerId);
  if (typeof target.notifToken === 'string' && target.notifToken) {
    panes.get(target.providerId)?.iframe.contentWindow?.postMessage(
      { type: 'DIA_CLICK_NOTIFY', notifToken: target.notifToken },
      '*'
    );
  }
}

function onRuntimeMessage(
  msg: RuntimeMessage,
  _sender?: chrome.runtime.MessageSender,
  sendResponse?: (res?: unknown) => void
): void {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
  if (msg.type === 'UNREAD_UPDATE') {
    if (!Object.hasOwn(PROVIDERS, msg.providerId)) return;
    if (prefs.paused[msg.providerId]) return;
    const nextCount =
      typeof msg.count === 'number' && Number.isFinite(msg.count) && msg.count > 0
        ? Math.floor(msg.count)
        : 0;
    unreads[msg.providerId] = nextCount;
    updateUnreadUi();
  } else if (msg.type === 'ACTIVE_PROVIDER_CHANGED') {
    if (Object.hasOwn(PROVIDERS, msg.providerId) && !prefs.paused[msg.providerId]) {
      activeProvider = msg.providerId;
      reportFocusState();
    }
  } else if (msg.type === 'FOCUS_PROVIDER') {
    if (Object.hasOwn(PROVIDERS, msg.providerId)) {
      focusProvider(msg.providerId);
    }
  } else if (msg.type === 'RELOAD_PROVIDER') {
    if (Object.hasOwn(PROVIDERS, msg.providerId)) {
      reloadProvider(msg.providerId);
    }
  } else if (msg.type === 'TRIGGER_NOTIFY_CLICK') {
    if (!Object.hasOwn(PROVIDERS, msg.providerId)) return;
    applyNotificationClickTarget(msg);
    sendResponse?.({ handled: true });
  } else if (msg.type === 'DUP_TABS_CHANGED') {
    if (Array.isArray(msg.tabs)) {
      updateDupTabsBanner(msg.tabs);
    }
  }
}

function detectFocusedIframeOnBlur(): void {
  const activeEl = document.activeElement;
  if (activeEl instanceof HTMLIFrameElement) {
    for (const [id, pane] of panes.entries()) {
      if (pane.iframe === activeEl && !prefs.paused[id]) {
        activeProvider = id;
        break;
      }
    }
  }
  reportFocusState();
}

function bindEvents(): void {
  const { signal } = lifecycle;

  document.getElementById('btn-lite-media')?.addEventListener('click', () => {
    prefs.liteMedia = !prefs.liteMedia;
    applyLayout();
    savePrefs();
  });

  document.getElementById('btn-hide-preview')?.addEventListener('click', () => {
    prefs.hidePreview = !prefs.hidePreview;
    applyLayout();
    savePrefs();
  });

  document.getElementById('btn-dnd')?.addEventListener('click', () => {
    prefs.dnd = !prefs.dnd;
    applyLayout();
    savePrefs();
  });

  document.getElementById('btn-pin-topbar')?.addEventListener('click', () => {
    prefs.topbarPinned = !prefs.topbarPinned;
    applyLayout();
    savePrefs();
  });

  document.getElementById('btn-test-notify')?.addEventListener('click', () => {
    sendRuntime({ type: 'TEST_NOTIFY' });
  });

  document.getElementById('dup-tabs-btn')?.addEventListener('click', () => {
    sendRuntime({ type: 'CLOSE_DUP_TABS' }, () => updateDupTabsBanner([]));
  });

  window.addEventListener(
    'keydown',
    (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      if (ev.key === 'Escape' && maximizedProvider !== null) {
        ev.preventDefault();
        maximizedProvider = null;
        applyLayout();
        return;
      }
      if (isAltMaximizeShortcut(ev)) {
        ev.preventDefault();
        toggleMaximize();
        return;
      }
      const digit = extractAltShortcutDigit(ev);
      if (digit !== null) {
        ev.preventDefault();
        const target = PROVIDER_ORDER[digit - 1];
        if (target) focusProvider(target);
      }
    },
    { signal }
  );

  window.addEventListener('focus', () => reportFocusState(), { signal });
  window.addEventListener('blur', () => detectFocusedIframeOnBlur(), { signal });
  document.addEventListener('visibilitychange', () => reportFocusState(), { signal });

  const resizer = document.getElementById('grid-resizer');
  const indicator = document.getElementById('resize-indicator');

  resizer?.addEventListener('dblclick', () => {
    prefs.mainWidthPct = 66;
    document.documentElement.style.setProperty('--main-width', '66%');
    savePrefs();
  });

  resizer?.addEventListener('mousedown', (startEv) => {
    startEv.preventDefault();
    document.body.classList.add('resizing');
    if (indicator) {
      indicator.textContent = formatSplitRatio(prefs.mainWidthPct);
      indicator.classList.remove('hidden');
    }
    let ended = false;
    const onMove = (moveEv: MouseEvent) => {
      if (window.innerWidth <= 0) return;
      const pct = (moveEv.clientX / window.innerWidth) * 100;
      prefs.mainWidthPct = clampMainWidth(pct);
      document.documentElement.style.setProperty('--main-width', `${prefs.mainWidthPct}%`);
      if (indicator) {
        indicator.textContent = formatSplitRatio(prefs.mainWidthPct);
      }
    };
    const onUp = () => {
      if (ended) return;
      ended = true;
      document.body.classList.remove('resizing');
      indicator?.classList.add('hidden');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
      savePrefs();
    };
    window.addEventListener('mousemove', onMove, { signal });
    window.addEventListener('mouseup', onUp, { signal });
    window.addEventListener('blur', onUp, { signal });
  });

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }
}

void (async () => {
  if (!document.getElementById('bento-grid')) return;
  window.addEventListener(
    'pagehide',
    (ev: Event) => {
      if (!(ev as PageTransitionEvent).persisted) {
        document.body.classList.remove('resizing');
        lifecycle.abort();
        globalThis.chrome?.runtime?.onMessage?.removeListener?.(onRuntimeMessage);
      }
    },
    { signal: lifecycle.signal }
  );
  await loadPrefs();
  if (lifecycle.signal.aborted) return;
  mountPanes();
  bindEvents();
  applyLayout();
  savePrefs();
  updateUnreadUi();
  sendRuntime({ type: 'CONSUME_PENDING_CLICK' }, (res) => {
    if (lifecycle.signal.aborted) return;
    const data = res as { target?: PendingClickTarget | null } | undefined;
    if (data?.target && typeof data.target === 'object') {
      applyNotificationClickTarget(data.target);
    }
  });
  sendRuntime({ type: 'GET_DUP_TABS' }, (res) => {
    if (lifecycle.signal.aborted) return;
    const data = res as { tabs?: ExternalProviderTab[] } | undefined;
    if (Array.isArray(data?.tabs)) updateDupTabsBanner(data.tabs);
  });
})();
```

- [ ] **Step 4: Run full unit test suite and typecheck to verify everything passes**

Run: `npm test && npm run typecheck`
Expected: PASS (all 7 unit test suites pass, `0` type errors).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/workspace/icons.ts src/workspace/favicon.ts src/workspace/bento-state.ts src/workspace/workspace.ts public/workspace.html public/workspace.css tests/unit/bento-state.test.ts
git commit -m "feat(ui): polish Workspace with Auto-Hide Top Drawer, SVG icons, dynamic favicon, Maximize 100%, and tactile splitter"
```

---

### Task 5: Real-Chromium Playwright E2E Pixel, Maximize Scroll-Preservation, Action Badge & Telegram Muted-Chat Verification

**Files:**
- Modify: `tests/e2e/extension.spec.ts`

**Interfaces:**
- Consumes: Complete Phase 2 Workspace UI, Retina icons, `chrome.action` badge sync, and Telegram muted-chat exclusion built in Tasks 1-4.
- Produces: End-to-end verified production `dist/` ready for reloading in Dia Browser.

- [ ] **Step 1: Upgrade `tests/e2e/extension.spec.ts` for Phase 2 pixel-perfection, Auto-Hide Top Drawer, Maximize 100% scroll preservation, Splitter double-click reset, Action Badge, and Telegram muted-chat silence**

Update `tests/e2e/extension.spec.ts`:
1. In the mock provider HTML (`res.end(...)` around line 34), include a tall scrollable `#chat-scroll` box so E2E can verify `scrollTop` preservation across Maximize 100%:

```html
          <div id="chat-scroll" style="height: 160px; overflow-y: auto;">
            <div style="height: 900px;">Scrollable messages</div>
          </div>
```

2. Update geometry assertions (`lines 138-195`):
   - Default unpinned Auto-Hide Top Drawer:
     - `#bento-grid` occupies full `1440x900` (`mainBox.x === 0`, `mainBox.y === 0`, `mainBox.height === 900`, `resizerBox.width === 6`, `sub1Box.y === 0`, `Math.round(sub3Box.y + sub3Box.height) === 900`).
     - `#topbar` is tucked above viewport (`topbarBox.y + topbarBox.height <= 0`).
     - Hovering `#topbar-sensor` smoothly reveals `#topbar` (`y === 0`, `height === 34`), clicking `#btn-pin-topbar` pins it (`mainBox.y === 34`, `mainBox.height === 866`), and clicking `#btn-pin-topbar` again unpins back to `mainBox.height === 900`!
   - Verify crisp UI visuals inside every `.pane-header` (including narrow sub-panes):
     - Height is `28px`, contains visible `svg.brand-icon` (`15x15`) and 4 visible `button.icon-btn` (`22x22`) with zero horizontal overflow (`header.scrollWidth <= header.clientWidth + 1`).
     - `.pane-iframe` computed `backgroundColor` is `rgb(14, 18, 27)` (dark matte, no `#fff` flash).
3. Add **Splitter Drag + Double-Click Reset** E2E verification:
   - Drag `#grid-resizer` from `x = 950` to `x = 760`, verify `#resize-indicator` appears during drag and `mainBox.width` changes to ~`760px`, then `dblclick()` on `#grid-resizer` and verify `Math.abs(mainBox.width - 1440 * 0.66) <= 2`.
4. Add **Zero-Scroll-Loss Maximize 100%** E2E verification:
   - Set `#chat-scroll` `scrollTop = 240` inside `zalo` frame and `scrollTop = 180` inside `discord` frame.
   - Click `section[data-provider="telegram"] button[data-action="maximize"]`.
   - Verify `section[data-provider="telegram"]` boundingBox is `{ x: 0, y: 0, width: 1440, height: 900 }`.
   - Press `Escape` to exit Maximize -> verify all 4 boot nonces are unchanged AND `zalo` `#chat-scroll` `scrollTop === 240` and `discord` `#chat-scroll` `scrollTop === 180`!
5. Add **Telegram Muted-Chat Exclusion & Dia Toolbar Action Badge** E2E verification:
   - Reset `discord` unread back to `0` (`document.title = 'Discord'`).
   - Inside `telegramFrame`, inject muted Telegram WebK chatlist (`<a class="chatlist-chat is-muted"><span class="peer-title">Muted Group</span><div class="dialog-subtitle-badge-unread badge-gray is-visible">19</div></a>`) AND set `document.title = '(19) Telegram'`.
   - Wait `400ms` and assert `section[data-provider="telegram"] .pane-title-btn .badge` is hidden (`0`), `#total-unread` is hidden, and `await sw.evaluate(() => chrome.action.getBadgeText({}))` is `''`!
   - Now insert an unmuted Telegram WebK chat row (`<a class="chatlist-chat"><span class="peer-title">Nguyễn Minh Tuấn</span><span class="dialog-subtitle-span">Chốt bản release nhé</span><div class="dialog-subtitle-badge-unread badge-primary is-visible" style="background-color: rgb(51, 144, 236);">2</div></a>`).
   - Assert `section[data-provider="telegram"] .pane-title-btn .badge` becomes `'2'`, `#total-unread` becomes `'2'`, and `await sw.evaluate(() => chrome.action.getBadgeText({}))` becomes `'2'`!

- [ ] **Step 2: Run E2E test suite in real Chromium**

Run: `npm run test:e2e`
Expected: PASS (`1 passed` in real Chromium with `0` page errors).

- [ ] **Step 3: Run full verification gate and clean production build**

Run: `npm test && npm run typecheck && npm run test:e2e && npm run build`
Expected:
- `npm test`: all 7 unit test suites pass
- `npm run typecheck`: `0` errors
- `npm run test:e2e`: `1 passed`
- `npm run build`: clean production `dist/` with all 8 PNG icons and zero `127.0.0.1` entries in `dist/manifest.json` or `dist/rules/framing.json`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/extension.spec.ts
git commit -m "test(e2e): verify Phase 2 Auto-Hide UI, Maximize scroll preservation, action badge, and Telegram muted-chat exclusion"
```
