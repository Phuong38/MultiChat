import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const isTest = process.argv.includes('--test');
const root = process.cwd();
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, 'public'), dist, { recursive: true });

// Minimal valid 1x1 blue PNG for extension icon sizes
const ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
mkdirSync(resolve(dist, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(resolve(dist, `icons/icon-${size}.png`), Buffer.from(ICON_PNG_BASE64, 'base64'));
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
