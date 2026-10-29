import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function createSolidPng(size, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  const rowStride = 1 + size * 4;
  const raw = Buffer.alloc(size * rowStride);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * rowStride;
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const px = rowOffset + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const isTest = process.argv.includes('--test');
const root = process.cwd();
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, 'public'), dist, { recursive: true });

mkdirSync(resolve(dist, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) {
  const iconPath = resolve(dist, `icons/icon-${size}.png`);
  if (!existsSync(iconPath)) {
    writeFileSync(iconPath, createSolidPng(size, 0x3b, 0x82, 0xf6));
  }
}

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
