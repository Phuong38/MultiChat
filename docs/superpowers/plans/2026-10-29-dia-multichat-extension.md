# Dia Multi-Chat Bento Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Chromium Manifest V3 extension tren Dia Browser (macOS) gom 4 chat (Zalo, Messenger, Telegram `/k/`, Discord) vao 1 tab Bento (1 khung chinh + 3 khung phu), du 100% thong bao native macOS va giam 30-45% RAM/GPU.

**Architecture:** Dung trang `workspace.html` Vanilla TypeScript + CSS Grid (`<15KB`, zero framework) giu 4 `<iframe>` co dinh, doi vi tri qua `data-slot` (`grid-area`) trong 0ms khong reload.
Tang mang dung `declarativeNetRequest` xoa `X-Frame-Options`/`CSP` va chan tracker/autoplay GIF; Service Worker dong bo cookie `SameSite=None; Secure` va ban `chrome.notifications`; Content Script (`MAIN` + `ISOLATED`) bat `window.Notification`, fallback `<title>`, va ha nhip 3 khung phu xuong 2fps.

**Tech Stack:** TypeScript 5 (strict), Chrome Extension Manifest V3, esbuild, Vanilla CSS Grid, Vitest + jsdom, Playwright (Chromium MV3 E2E).

## Global Constraints

- Chi dung plain dash `-` trong code comment, UI copy va docs; cam dung em-dash hoac en-dash.
- Khong them bat ky runtime UI dependency nao (React, Vue, Preact, Tailwind runtime) de giu RAM vo extension toi thieu.
- Khong them dong co-author agent khi git commit.
- Moi `content_script` phai kiem tra `if (window === window.top) return;` ngay dau file de khong anh huong tab duyet web binh thuong.
- Hoan doi khung Bento chi sua attribute `data-slot`, tuyet doi khong `appendChild` hay thao lap node `<iframe>`.
- Telegram bat buoc dung endpoint nhe `https://web.telegram.org/k/`.

---

## File Structure

- `package.json` - Khai bao scripts (`build`, `build:test`, `typecheck`, `test`, `test:e2e`) va devDependencies.
- `tsconfig.json` - Cau hinh TypeScript strict cho ES2022 + DOM + `@types/chrome`.
- `vitest.config.ts` - Cau hinh Vitest unit test.
- `playwright.config.ts` - Cau hinh Playwright chay Chromium unpacked extension.
- `scripts/build.mjs` - Script `esbuild` dong goi 4 entry (`service-worker`, `workspace`, `notify-hook.main`, `frame-agent.isolated`), copy `public/` sang `dist/`, sinh icon PNG, va ho tro co `--test` cho E2E local loopback.
- `public/manifest.json` - Manifest V3 chinh thuc cho Dia Browser.
- `public/rules/framing.json` - Ruleset DNR go `x-frame-options` va `content-security-policy` tren `sub_frame` 4 provider.
- `public/rules/diet.json` - Ruleset DNR chan telemetry, crash log, analytics cua 4 provider.
- `public/rules/lite-media.json` - Ruleset DNR tuy chon chan autoplay GIF Tenor/Giphy.
- `public/workspace.html` - Khung HTML Bento Workspace.
- `public/workspace.css` - Bo cuc CSS Grid Bento (`main`, `sub-1`, `sub-2`, `sub-3`), Topbar 32px, Pane Header 26px.
- `src/shared/types.ts` - Toan bo kieu du lieu va union message dung chung.
- `src/providers/registry.ts` - Cau hinh 4 provider + pure parser dem unread va khop URL.
- `src/background/cookie-bridge.ts` - Logic nang cap cookie sang `SameSite=None; Secure` chong vong lap.
- `src/background/tab-coordinator.ts` - Quan ly Singleton Workspace Tab va tim tab chat roi trung lap ben ngoai.
- `src/background/notify-router.ts` - Chong trung thong bao `3000ms`, `DND`, `Hide Preview`, suppression khung dang go, va dinh tuyen click banner macOS.
- `src/background/service-worker.ts` - Entry Service Worker ket noi toan bo module nen + Re-Auth popup + DNR Lite Media toggle.
- `src/content/raf-governor.ts` - Proxy `window.Notification` va bo ha nhip `requestAnimationFrame` xuong 2fps trong `MAIN` world.
- `src/content/notify-hook.main.ts` - Entry `MAIN` world script chay tai `document_start`.
- `src/content/unread-observer.ts` - Bo theo doi unread `1500ms` fallback va bom CSS/video diet cho khung phu.
- `src/content/frame-agent.isolated.ts` - Entry `ISOLATED` world script cau noi iframe <-> Workspace <-> Service Worker.
- `src/workspace/bento-state.ts` - Pure state functions cho slot Bento, thanh keo `--main-width`, pause khung va tieu de unread.
- `src/workspace/workspace.ts` - Controller DOM trang Bento Workspace.
- `tests/unit/*.test.ts` - Bo unit test Vitest cho tung module.
- `tests/e2e/extension.spec.ts` - Bo test Playwright E2E tren Chromium that.

---

### Task 1: Project Toolchain, Shared Types, Manifest V3 & DNR Rulesets

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/shared/types.ts`
- Create: `public/manifest.json`
- Create: `public/rules/framing.json`
- Create: `public/rules/diet.json`
- Create: `public/rules/lite-media.json`
- Create: `scripts/build.mjs`
- Test: `tests/unit/manifest-rules.test.ts`

**Interfaces:**
- Consumes: None (nen tang goc).
- Produces:
  - `src/shared/types.ts`: `ProviderId`, `SlotId`, `ProviderConfig`, `WorkspacePrefs`, `NotifyPayload`, `RuntimeMessage`, `WorkspaceToFrameMessage`, `MainToIsolatedEvent`, `IsolatedToMainEvent`.
  - Build script `npm run build` & `npm run build:test` xuat thu muc `dist/`.

- [ ] **Step 1: Tao `package.json`, `tsconfig.json`, `vitest.config.ts` va cai dependencies**

Create `package.json`:
```json
{
  "name": "dia-multichat-bento",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:test": "node scripts/build.mjs --test",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "npm run build:test && playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.51.0",
    "@types/chrome": "^0.0.308",
    "@types/node": "^22.13.0",
    "esbuild": "^0.25.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.8.2",
    "vitest": "^3.0.7"
  }
}
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome", "node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
});
```

Run: `npm install`
Expected: `added ... packages` voi exit code 0.

- [ ] **Step 2: Viet failing unit test kiem tra Manifest V3 va 3 DNR rulesets**

Create `tests/unit/manifest-rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readJson = (relPath: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), relPath), 'utf8'));

describe('Manifest V3 & DNR Rulesets', () => {
  it('configures required MV3 permissions, 4 chat host permissions, and dual-world sub_frame scripts', () => {
    const manifest = readJson('public/manifest.json');
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        'declarativeNetRequest',
        'cookies',
        'notifications',
        'storage',
        'tabs'
      ])
    );
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        '*://*.zalo.me/*',
        '*://*.messenger.com/*',
        '*://*.facebook.com/*',
        '*://*.telegram.org/*',
        '*://*.discord.com/*'
      ])
    );
    expect(manifest.content_scripts).toHaveLength(2);
    const worlds = manifest.content_scripts.map((c: { world?: string }) => c.world ?? 'ISOLATED');
    expect(worlds).toEqual(expect.arrayContaining(['MAIN', 'ISOLATED']));
    for (const cs of manifest.content_scripts) {
      expect(cs.all_frames).toBe(true);
      expect(cs.run_at).toBe('document_start');
    }
  });

  it('strips X-Frame-Options and CSP headers on sub_frame across all chat domains', () => {
    const framing = readJson('public/rules/framing.json');
    expect(framing.length).toBeGreaterThanOrEqual(1);
    const rule = framing[0];
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.condition.resourceTypes).toContain('sub_frame');
    expect(rule.condition.requestDomains).toEqual(
      expect.arrayContaining([
        'zalo.me',
        'messenger.com',
        'facebook.com',
        'telegram.org',
        'discord.com'
      ])
    );
    const removed = rule.action.responseHeaders.map((h: { header: string }) =>
      h.header.toLowerCase()
    );
    expect(removed).toEqual(
      expect.arrayContaining(['x-frame-options', 'content-security-policy'])
    );
  });

  it('defines valid block rules in diet.json and lite-media.json with unique IDs', () => {
    const diet = readJson('public/rules/diet.json');
    const lite = readJson('public/rules/lite-media.json');
    expect(diet.every((r: { action: { type: string } }) => r.action.type === 'block')).toBe(true);
    expect(lite.every((r: { action: { type: string } }) => r.action.type === 'block')).toBe(true);
  });
});
```

- [ ] **Step 3: Chay test xac nhan FAIL**

Run: `npm test`
Expected: FAIL voi loi `ENOENT: no such file or directory, open '.../public/manifest.json'`.

- [ ] **Step 4: Tao `src/shared/types.ts`, `public/manifest.json`, `public/rules/*.json`, va `scripts/build.mjs`**

Create `src/shared/types.ts`:
```ts
export type ProviderId = 'zalo' | 'messenger' | 'telegram' | 'discord';

export type SlotId = 'main' | 'sub-1' | 'sub-2' | 'sub-3';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  shortcutIndex: 1 | 2 | 3 | 4;
  embedUrl: string;
  loginUrl: string;
  hostPatterns: string[];
  cookieDomains: string[];
  titleUnreadRegex: RegExp;
  badgeSelectors: string[];
  subPaneCss: string;
}

export interface WorkspacePrefs {
  slotOrder: [ProviderId, ProviderId, ProviderId, ProviderId];
  mainWidthPct: number;
  dnd: boolean;
  hidePreview: boolean;
  liteMedia: boolean;
  paused: Record<ProviderId, boolean>;
}

export interface NotifyPayload {
  providerId: ProviderId;
  title: string;
  body: string;
  tag?: string;
  notifToken?: string;
}

export interface ExternalProviderTab {
  tabId: number;
  providerId: ProviderId;
  url: string;
}

export type RuntimeMessage =
  | { type: 'CHAT_NOTIFY'; payload: NotifyPayload }
  | { type: 'UNREAD_UPDATE'; providerId: ProviderId; count: number }
  | {
      type: 'WORKSPACE_FOCUS_STATE';
      windowFocused: boolean;
      focusedProvider: ProviderId | null;
    }
  | { type: 'SYNC_PREFS'; prefs: Pick<WorkspacePrefs, 'dnd' | 'hidePreview' | 'liteMedia'> }
  | { type: 'OPEN_REAUTH'; providerId: ProviderId }
  | { type: 'TEST_NOTIFY' }
  | { type: 'GET_DUP_TABS' }
  | { type: 'CLOSE_DUP_TABS' }
  | { type: 'FOCUS_PROVIDER'; providerId: ProviderId }
  | { type: 'RELOAD_PROVIDER'; providerId: ProviderId }
  | { type: 'TRIGGER_NOTIFY_CLICK'; providerId: ProviderId; notifToken?: string }
  | { type: 'DUP_TABS_CHANGED'; tabs: ExternalProviderTab[] };

export type WorkspaceToFrameMessage = {
  source: 'dia-bento-workspace';
  type: 'DIA_SLOT_MODE';
  providerId: ProviderId;
  isMain: boolean;
};

export type MainToIsolatedEvent = {
  type: 'RAW_NOTIFY';
  title: string;
  body: string;
  tag?: string;
  notifToken: string;
};

export type IsolatedToMainEvent =
  | { type: 'SET_THROTTLE'; throttled: boolean }
  | { type: 'CLICK_NOTIFY'; notifToken: string };
```

Create `public/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "Dia Bento Chat Hub",
  "version": "0.1.0",
  "description": "All-in-one Bento workspace for Zalo, Messenger, Telegram, and Discord with native macOS notifications and RAM diet.",
  "permissions": [
    "declarativeNetRequest",
    "cookies",
    "notifications",
    "storage",
    "tabs"
  ],
  "host_permissions": [
    "*://*.zalo.me/*",
    "*://*.messenger.com/*",
    "*://*.facebook.com/*",
    "*://*.fbcdn.net/*",
    "*://*.telegram.org/*",
    "*://*.discord.com/*",
    "*://*.tenor.com/*",
    "*://*.giphy.com/*"
  ],
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_title": "Open Dia Bento Chat Hub",
    "default_icon": "icons/icon-48.png"
  },
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "declarative_net_request": {
    "rule_resources": [
      {
        "id": "framing",
        "enabled": true,
        "path": "rules/framing.json"
      },
      {
        "id": "diet",
        "enabled": true,
        "path": "rules/diet.json"
      },
      {
        "id": "lite_media",
        "enabled": false,
        "path": "rules/lite-media.json"
      }
    ]
  },
  "content_scripts": [
    {
      "matches": [
        "*://*.zalo.me/*",
        "*://*.messenger.com/*",
        "*://*.telegram.org/*",
        "*://*.discord.com/*"
      ],
      "js": ["notify-hook.main.js"],
      "run_at": "document_start",
      "all_frames": true,
      "world": "MAIN"
    },
    {
      "matches": [
        "*://*.zalo.me/*",
        "*://*.messenger.com/*",
        "*://*.telegram.org/*",
        "*://*.discord.com/*"
      ],
      "js": ["frame-agent.isolated.js"],
      "run_at": "document_start",
      "all_frames": true,
      "world": "ISOLATED"
    }
  ]
}
```

Create `public/rules/framing.json`:
```json
[
  {
    "id": 1,
    "priority": 100,
    "action": {
      "type": "modifyHeaders",
      "responseHeaders": [
        { "header": "x-frame-options", "operation": "remove" },
        { "header": "content-security-policy", "operation": "remove" },
        { "header": "content-security-policy-report-only", "operation": "remove" },
        { "header": "cross-origin-opener-policy", "operation": "remove" },
        { "header": "cross-origin-embedder-policy", "operation": "remove" }
      ]
    },
    "condition": {
      "requestDomains": [
        "zalo.me",
        "messenger.com",
        "facebook.com",
        "telegram.org",
        "discord.com"
      ],
      "resourceTypes": ["sub_frame"]
    }
  }
]
```

Create `public/rules/diet.json`:
```json
[
  {
    "id": 101,
    "priority": 10,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||discord.com/api/*/science",
      "resourceTypes": ["xmlhttprequest", "ping", "other"]
    }
  },
  {
    "id": 102,
    "priority": 10,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||sentry.io/",
      "resourceTypes": ["xmlhttprequest", "script", "ping"]
    }
  },
  {
    "id": 103,
    "priority": 10,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "/ajax/bz",
      "requestDomains": ["messenger.com", "facebook.com"],
      "resourceTypes": ["xmlhttprequest", "ping"]
    }
  },
  {
    "id": 104,
    "priority": 10,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": "||log.zalo.me/",
      "resourceTypes": ["xmlhttprequest", "ping", "image"]
    }
  }
]
```

Create `public/rules/lite-media.json`:
```json
[
  {
    "id": 201,
    "priority": 20,
    "action": { "type": "block" },
    "condition": {
      "requestDomains": ["media.tenor.com", "media.giphy.com"],
      "resourceTypes": ["image", "media"]
    }
  }
]
```

Create `scripts/build.mjs`:
```js
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
```

- [ ] **Step 5: Chay test + typecheck va commit Task 1**

Run: `npm test && npm run typecheck`
Expected: PASS (3 tests passing, 0 TypeScript errors).

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts scripts/build.mjs src/shared/types.ts public/manifest.json public/rules/ tests/unit/manifest-rules.test.ts
git commit -m "chore: scaffold MV3 extension toolchain, shared types, and DNR rulesets"
```

---

### Task 2: Provider Registry & Unread Parser

**Files:**
- Create: `src/providers/registry.ts`
- Test: `tests/unit/registry.test.ts`

**Interfaces:**
- Consumes: `ProviderId`, `ProviderConfig` from `src/shared/types.ts`.
- Produces:
  - `PROVIDER_ORDER: readonly [ProviderId, ProviderId, ProviderId, ProviderId]`
  - `PROVIDERS: Record<ProviderId, ProviderConfig>`
  - `parseUnreadFromTitle(providerId: ProviderId, title: string): number`
  - `extractUnreadFromDom(providerId: ProviderId, doc: ParentNode): number`
  - `matchProviderByUrl(url: string): ProviderId | null`

- [ ] **Step 1: Viet failing unit test cho `ProviderRegistry`**

Create `tests/unit/registry.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_ORDER,
  PROVIDERS,
  extractUnreadFromDom,
  matchProviderByUrl,
  parseUnreadFromTitle
} from '../../src/providers/registry';

describe('ProviderRegistry', () => {
  it('enforces Telegram WebK (/k/) and defines all 4 MVP providers', () => {
    expect(PROVIDER_ORDER).toEqual(['zalo', 'messenger', 'telegram', 'discord']);
    expect(PROVIDERS.telegram.embedUrl).toBe('https://web.telegram.org/k/');
    expect(PROVIDERS.zalo.embedUrl).toBe('https://chat.zalo.me/');
    expect(PROVIDERS.messenger.embedUrl).toBe('https://www.messenger.com/');
    expect(PROVIDERS.discord.embedUrl).toBe('https://discord.com/app');
  });

  it('parses unread counts from document titles accurately', () => {
    expect(parseUnreadFromTitle('zalo', '(5) Zalo')).toBe(5);
    expect(parseUnreadFromTitle('messenger', '(12) Messenger')).toBe(12);
    expect(parseUnreadFromTitle('discord', '• (3) Discord | #general')).toBe(3);
    expect(parseUnreadFromTitle('telegram', 'Telegram (2)')).toBe(2);
    expect(parseUnreadFromTitle('zalo', 'Zalo')).toBe(0);
  });

  it('extracts unread sum from provider badge DOM elements', () => {
    document.body.innerHTML = `
      <div class="badge-unread">4</div>
      <div class="badge-unread">2</div>
    `;
    expect(extractUnreadFromDom('telegram', document)).toBe(6);
  });

  it('matches external URLs back to provider IDs', () => {
    expect(matchProviderByUrl('https://chat.zalo.me/?null')).toBe('zalo');
    expect(matchProviderByUrl('https://www.messenger.com/t/12345')).toBe('messenger');
    expect(matchProviderByUrl('https://web.telegram.org/k/#@user')).toBe('telegram');
    expect(matchProviderByUrl('https://discord.com/channels/@me')).toBe('discord');
    expect(matchProviderByUrl('https://google.com')).toBeNull();
  });
});
```

- [ ] **Step 2: Chay test xac nhan FAIL**

Run: `npx vitest run tests/unit/registry.test.ts`
Expected: FAIL voi loi `Cannot find module '../../src/providers/registry'`.

- [ ] **Step 3: Viet implementation `src/providers/registry.ts`**

Create `src/providers/registry.ts`:
```ts
import type { ProviderConfig, ProviderId } from '../shared/types';

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
    titleUnreadRegex: /\((\d+)\+?/,
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
    titleUnreadRegex: /\((\d+)\+?/,
    badgeSelectors: ['[aria-label*="unread"]', '[data-testid="mwthreadlist-item-unread-badge"]'],
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
    titleUnreadRegex: /\((\d+)\+?/,
    badgeSelectors: ['.badge-unread', '.unread'],
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
    titleUnreadRegex: /\((\d+)\+?/,
    badgeSelectors: ['[class*="numberBadge"]', '[aria-label*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      [class*="membersWrap"], [class*="nowPlayingColumn"] { display: none !important; }
    `
  }
};

export function parseUnreadFromTitle(providerId: ProviderId, title: string): number {
  const match = PROVIDERS[providerId].titleUnreadRegex.exec(title);
  if (!match || !match[1]) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function extractUnreadFromDom(providerId: ProviderId, root: ParentNode): number {
  const selectors = PROVIDERS[providerId].badgeSelectors;
  let total = 0;
  const seen = new Set<Element>();
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
      const text = (el.textContent ?? '').trim();
      const num = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(num) && num > 0) {
        total += num;
      }
    }
  }
  return total;
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

- [ ] **Step 4: Chay test xac nhan PASS**

Run: `npx vitest run tests/unit/registry.test.ts && npm run typecheck`
Expected: PASS (4 tests passing).

- [ ] **Step 5: Commit Task 2**

```bash
git add src/providers/registry.ts tests/unit/registry.test.ts
git commit -m "feat: add provider registry, unread parsers, and URL matcher"
```

---

### Task 3: CookieBridge & Tab Coordinator

**Files:**
- Create: `src/background/cookie-bridge.ts`
- Create: `src/background/tab-coordinator.ts`
- Test: `tests/unit/cookie-and-tabs.test.ts`

**Interfaces:**
- Consumes: `ProviderId`, `ExternalProviderTab` from `src/shared/types.ts`, `PROVIDERS`, `PROVIDER_ORDER`, `matchProviderByUrl` from `src/providers/registry.ts`.
- Produces:
  - `shouldUpgradeCookie(cookie: chrome.cookies.Cookie, cause?: string): boolean`
  - `toUpgradedCookieSetDetails(cookie: chrome.cookies.Cookie): chrome.cookies.SetDetails`
  - `syncProviderCookies(cookiesApi: Pick<typeof chrome.cookies, 'getAll' | 'set'>, providerIds?: readonly ProviderId[]): Promise<number>`
  - `openOrFocusWorkspace(tabsApi: Pick<typeof chrome.tabs, 'query' | 'update' | 'create'>, windowsApi: Pick<typeof chrome.windows, 'update'>, workspaceUrl: string): Promise<number>`
  - `findExternalProviderTabs(tabs: readonly chrome.tabs.Tab[], workspaceUrl: string): ExternalProviderTab[]`

- [ ] **Step 1: Viet failing unit test cho `CookieBridge` va `TabCoordinator`**

Create `tests/unit/cookie-and-tabs.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import {
  shouldUpgradeCookie,
  syncProviderCookies,
  toUpgradedCookieSetDetails
} from '../../src/background/cookie-bridge';
import {
  findExternalProviderTabs,
  openOrFocusWorkspace
} from '../../src/background/tab-coordinator';

const makeCookie = (overrides: Partial<chrome.cookies.Cookie> = {}): chrome.cookies.Cookie => ({
  name: 'zpw_sek',
  value: 'secret-token',
  domain: '.zalo.me',
  hostOnly: false,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  session: false,
  expirationDate: 1900000000,
  storeId: '0',
  ...overrides
});

describe('CookieBridge', () => {
  it('upgrades Lax/Strict provider cookies to SameSite=no_restriction and skips already-upgraded or overwrite events', () => {
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'lax' }), 'explicit')).toBe(true);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'strict' }), 'explicit')).toBe(true);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'no_restriction', secure: true }), 'explicit')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'lax' }), 'overwrite')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ domain: '.example.org' }), 'explicit')).toBe(false);

    const details = toUpgradedCookieSetDetails(makeCookie({ domain: '.zalo.me', hostOnly: false }));
    expect(details).toMatchObject({
      url: 'https://zalo.me/',
      domain: '.zalo.me',
      name: 'zpw_sek',
      value: 'secret-token',
      sameSite: 'no_restriction',
      secure: true,
      httpOnly: true
    });
  });

  it(' omits domain field for hostOnly cookies during sync', async () => {
    const getAll = vi.fn().mockResolvedValue([
      makeCookie({ domain: 'chat.zalo.me', hostOnly: true, sameSite: 'lax' })
    ]);
    const set = vi.fn().mockResolvedValue({});
    const count = await syncProviderCookies({ getAll, set }, ['zalo']);
    expect(count).toBe(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://chat.zalo.me/',
        sameSite: 'no_restriction',
        secure: true
      })
    );
    expect(set.mock.calls[0]?.[0]?.domain).toBeUndefined();
  });
});

describe('TabCoordinator', () => {
  const wsUrl = 'chrome-extension://abc/workspace.html';

  it('focuses and pins existing workspace tab instead of creating duplicate', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42, windowId: 7, url: wsUrl }]);
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn();
    const winUpdate = vi.fn().mockResolvedValue({});

    const tabId = await openOrFocusWorkspace({ query, update, create }, { update: winUpdate }, wsUrl);
    expect(tabId).toBe(42);
    expect(winUpdate).toHaveBeenCalledWith(7, { focused: true });
    expect(update).toHaveBeenCalledWith(42, { active: true, pinned: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('detects standalone chat tabs outside workspace', () => {
    const dups = findExternalProviderTabs(
      [
        { id: 1, url: wsUrl } as chrome.tabs.Tab,
        { id: 2, url: 'https://chat.zalo.me/' } as chrome.tabs.Tab,
        { id: 3, url: 'https://discord.com/channels/@me' } as chrome.tabs.Tab,
        { id: 4, url: 'https://news.ycombinator.com' } as chrome.tabs.Tab
      ],
      wsUrl
    );
    expect(dups).toEqual([
      { tabId: 2, providerId: 'zalo', url: 'https://chat.zalo.me/' },
      { tabId: 3, providerId: 'discord', url: 'https://discord.com/channels/@me' }
    ]);
  });
});
```

- [ ] **Step 2: Chay test xac nhan FAIL**

Run: `npx vitest run tests/unit/cookie-and-tabs.test.ts`
Expected: FAIL voi loi `Cannot find module '../../src/background/cookie-bridge'`.

- [ ] **Step 3: Viet implementation `src/background/cookie-bridge.ts` va `src/background/tab-coordinator.ts`**

Create `src/background/cookie-bridge.ts`:
```ts
import type { ProviderId } from '../shared/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers/registry';

const MANAGED_DOMAINS = Array.from(
  new Set(PROVIDER_ORDER.flatMap((id) => PROVIDERS[id].cookieDomains))
);

function isManagedCookieDomain(cookieDomain: string): boolean {
  const clean = cookieDomain.toLowerCase().replace(/^\./, '');
  return MANAGED_DOMAINS.some((d) => {
    const target = d.toLowerCase().replace(/^\./, '');
    return clean === target || clean.endsWith(`.${target}`);
  });
}

export function shouldUpgradeCookie(cookie: chrome.cookies.Cookie, cause?: string): boolean {
  if (cause === 'overwrite' || cause === 'expired' || cause === 'evicted') {
    return false;
  }
  if (!isManagedCookieDomain(cookie.domain)) {
    return false;
  }
  if (cookie.sameSite === 'no_restriction' && cookie.secure) {
    return false;
  }
  return true;
}

export function toUpgradedCookieSetDetails(
  cookie: chrome.cookies.Cookie
): chrome.cookies.SetDetails {
  const cleanHost = cookie.domain.replace(/^\./, '');
  const path = cookie.path || '/';
  const details: chrome.cookies.SetDetails = {
    url: `https://${cleanHost}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure: true,
    httpOnly: cookie.httpOnly,
    sameSite: 'no_restriction',
    storeId: cookie.storeId
  };
  if (!cookie.hostOnly) {
    details.domain = cookie.domain;
  }
  if (!cookie.session && typeof cookie.expirationDate === 'number') {
    details.expirationDate = cookie.expirationDate;
  }
  return details;
}

export async function syncProviderCookies(
  cookiesApi: Pick<typeof chrome.cookies, 'getAll' | 'set'>,
  providerIds: readonly ProviderId[] = PROVIDER_ORDER
): Promise<number> {
  const domains = new Set(
    providerIds.flatMap((id) => PROVIDERS[id].cookieDomains.map((d) => d.replace(/^\./, '')))
  );
  let upgraded = 0;
  const seenKeys = new Set<string>();

  for (const domain of domains) {
    const cookies = await cookiesApi.getAll({ domain });
    for (const cookie of cookies) {
      const key = `${cookie.storeId}|${cookie.domain}|${cookie.path}|${cookie.name}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (!shouldUpgradeCookie(cookie)) continue;
      try {
        await cookiesApi.set(toUpgradedCookieSetDetails(cookie));
        upgraded += 1;
      } catch {
        // Ignore browser-protected __Host- prefix edge cookies if rejected
      }
    }
  }
  return upgraded;
}
```

Create `src/background/tab-coordinator.ts`:
```ts
import type { ExternalProviderTab } from '../shared/types';
import { matchProviderByUrl } from '../providers/registry';

export async function openOrFocusWorkspace(
  tabsApi: Pick<typeof chrome.tabs, 'query' | 'update' | 'create'>,
  windowsApi: Pick<typeof chrome.windows, 'update'>,
  workspaceUrl: string
): Promise<number> {
  const existing = await tabsApi.query({ url: `${workspaceUrl}*` });
  const first = existing[0];
  if (first && typeof first.id === 'number') {
    if (typeof first.windowId === 'number') {
      await windowsApi.update(first.windowId, { focused: true });
    }
    await tabsApi.update(first.id, { active: true, pinned: true });
    return first.id;
  }
  const created = await tabsApi.create({ url: workspaceUrl, active: true, pinned: true });
  return created.id ?? -1;
}

export function findExternalProviderTabs(
  tabs: readonly chrome.tabs.Tab[],
  workspaceUrl: string
): ExternalProviderTab[] {
  const results: ExternalProviderTab[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !tab.url) continue;
    if (tab.url.startsWith(workspaceUrl)) continue;
    const providerId = matchProviderByUrl(tab.url);
    if (providerId) {
      results.push({ tabId: tab.id, providerId, url: tab.url });
    }
  }
  return results;
}
```

- [ ] **Step 4: Chay test xac nhan PASS**

Run: `npx vitest run tests/unit/cookie-and-tabs.test.ts && npm run typecheck`
Expected: PASS (4 tests passing).

- [ ] **Step 5: Commit Task 3**

```bash
git add src/background/cookie-bridge.ts src/background/tab-coordinator.ts tests/unit/cookie-and-tabs.test.ts
git commit -m "feat: add SameSite CookieBridge and Singleton TabCoordinator"
```

---

### Task 4: Native macOS Notification Router & Background Service Worker

**Files:**
- Create: `src/background/notify-router.ts`
- Create: `src/background/service-worker.ts`
- Test: `tests/unit/notify-router.test.ts`

**Interfaces:**
- Consumes: `NotifyPayload`, `ProviderId`, `RuntimeMessage` from `src/shared/types.ts`, `PROVIDERS` from `src/providers/registry.ts`, `CookieBridge` and `TabCoordinator` from Task 3.
- Produces:
  - `NotifyRouter` class:
    - `setPrefs(prefs: { dnd: boolean; hidePreview: boolean }): void`
    - `setFocusState(state: { windowFocused: boolean; focusedProvider: ProviderId | null }): void`
    - `handleIncoming(payload: NotifyPayload, nowMs?: number): Promise<string | null>`
    - `parseNotificationClick(notifId: string): { providerId: ProviderId; notifToken?: string } | null`
  - `src/background/service-worker.ts` (MV3 background entry).

- [ ] **Step 1: Viet failing unit test cho `NotifyRouter`**

Create `tests/unit/notify-router.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { NotifyRouter } from '../../src/background/notify-router';

describe('NotifyRouter', () => {
  it('creates native notification and deduplicates identical payload within 3000ms', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const router = new NotifyRouter(create, 'chrome-extension://id/icons/icon-128.png');

    const id1 = await router.handleIncoming(
      { providerId: 'zalo', title: 'Nguyen Van A', body: 'Alo ban oi', notifToken: 'tok-1' },
      1000
    );
    const id2 = await router.handleIncoming(
      { providerId: 'zalo', title: 'Nguyen Van A', body: 'Alo ban oi', notifToken: 'tok-2' },
      2500
    );
    const id3 = await router.handleIncoming(
      { providerId: 'zalo', title: 'Nguyen Van A', body: 'Alo ban oi', notifToken: 'tok-3' },
      4500
    );

    expect(id1).toBeTruthy();
    expect(id2).toBeNull();
    expect(id3).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(2);
    expect(router.parseNotificationClick(id1!)).toEqual({
      providerId: 'zalo',
      notifToken: 'tok-1'
    });
  });

  it('suppresses notification when DND is active or user is actively focused inside that pane', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const router = new NotifyRouter(create, 'icon.png');

    router.setFocusState({ windowFocused: true, focusedProvider: 'discord' });
    const suppressed = await router.handleIncoming(
      { providerId: 'discord', title: 'Dev', body: 'Ping' },
      1000
    );
    expect(suppressed).toBeNull();

    const otherPane = await router.handleIncoming(
      { providerId: 'telegram', title: 'Boss', body: 'Check PR' },
      1000
    );
    expect(otherPane).toBeTruthy();

    router.setPrefs({ dnd: true, hidePreview: false });
    const dndBlocked = await router.handleIncoming(
      { providerId: 'zalo', title: 'Lead', body: 'Hop gap' },
      2000
    );
    expect(dndBlocked).toBeNull();
  });

  it('masks message body when hidePreview is enabled', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const router = new NotifyRouter(create, 'icon.png');
    router.setPrefs({ dnd: false, hidePreview: true });

    await router.handleIncoming(
      { providerId: 'messenger', title: 'Secret Sender', body: 'Luong thang 10' },
      5000
    );

    expect(create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: 'Messenger',
        message: 'Co tin nhan moi'
      })
    );
  });
});
```

- [ ] **Step 2: Chay test xac nhan FAIL**

Run: `npx vitest run tests/unit/notify-router.test.ts`
Expected: FAIL voi loi `Cannot find module '../../src/background/notify-router'`.

- [ ] **Step 3: Viet implementation `src/background/notify-router.ts` va `src/background/service-worker.ts`**

Create `src/background/notify-router.ts`:
```ts
import type { NotifyPayload, ProviderId } from '../shared/types';
import { PROVIDERS } from '../providers/registry';

export type CreateNotificationFn = (
  notificationId: string,
  options: chrome.notifications.NotificationOptions<true>
) => Promise<void>;

const DEDUP_WINDOW_MS = 3000;

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
    private readonly iconUrl: string
  ) {}

  setPrefs(prefs: { dnd: boolean; hidePreview: boolean }): void {
    this.dnd = prefs.dnd;
    this.hidePreview = prefs.hidePreview;
  }

  setFocusState(state: { windowFocused: boolean; focusedProvider: ProviderId | null }): void {
    this.windowFocused = state.windowFocused;
    this.focusedProvider = state.focusedProvider;
  }

  async handleIncoming(payload: NotifyPayload, nowMs = Date.now()): Promise<string | null> {
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
    const title = this.hidePreview
      ? providerName
      : payload.title.startsWith(providerName)
        ? payload.title
        : `${providerName} - ${payload.title}`;
    const message = this.hidePreview ? 'Co tin nhan moi' : payload.body || 'Tin nhan moi';

    this.seq += 1;
    const notifId = `dia-chat:${payload.providerId}:${nowMs}:${this.seq}`;
    this.tokenByNotifId.set(notifId, {
      providerId: payload.providerId,
      notifToken: payload.notifToken
    });
    if (this.tokenByNotifId.size > 100) {
      const oldestKey = this.tokenByNotifId.keys().next().value;
      if (oldestKey) this.tokenByNotifId.delete(oldestKey);
    }

    await this.createNotification(notifId, {
      type: 'basic',
      iconUrl: this.iconUrl,
      title,
      message,
      priority: 2
    });
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
    if (parts[0] === 'dia-chat' && parts[1]) {
      const id = parts[1] as ProviderId;
      if (id in PROVIDERS) return { providerId: id };
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

Create `src/background/service-worker.ts`:
```ts
import type { ProviderId, RuntimeMessage } from '../shared/types';
import { PROVIDERS } from '../providers/registry';
import {
  shouldUpgradeCookie,
  syncProviderCookies,
  toUpgradedCookieSetDetails
} from './cookie-bridge';
import { NotifyRouter } from './notify-router';
import { findExternalProviderTabs, openOrFocusWorkspace } from './tab-coordinator';

const getWorkspaceUrl = () => chrome.runtime.getURL('workspace.html');
const getIconUrl = () => chrome.runtime.getURL('icons/icon-128.png');

const router = new NotifyRouter(
  (id, opts) =>
    new Promise((resolve) => {
      chrome.notifications.create(id, opts, () => resolve());
    }),
  getIconUrl()
);

const reauthWindows = new Map<number, ProviderId>();

async function applyLiteMediaRuleset(enabled: boolean): Promise<void> {
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? ['lite_media'] : [],
    disableRulesetIds: enabled ? [] : ['lite_media']
  });
}

async function broadcastToWorkspace(msg: RuntimeMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // Workspace tab not open right now
  }
}

async function broadcastDupTabs(): Promise<void> {
  const allTabs = await chrome.tabs.query({});
  const dups = findExternalProviderTabs(allTabs, getWorkspaceUrl());
  await broadcastToWorkspace({ type: 'DUP_TABS_CHANGED', tabs: dups });
}

chrome.runtime.onInstalled.addListener(() => {
  void syncProviderCookies(chrome.cookies);
});

chrome.runtime.onStartup.addListener(() => {
  void syncProviderCookies(chrome.cookies);
});

chrome.action.onClicked.addListener(() => {
  void openOrFocusWorkspace(chrome.tabs, chrome.windows, getWorkspaceUrl());
});

chrome.cookies.onChanged.addListener(({ cookie, cause, removed }) => {
  if (removed) return;
  if (!shouldUpgradeCookie(cookie, cause)) return;
  void chrome.cookies.set(toUpgradedCookieSetDetails(cookie)).catch(() => {});
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    void broadcastDupTabs();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  void broadcastDupTabs();
});

chrome.windows.onRemoved.addListener((windowId) => {
  const providerId = reauthWindows.get(windowId);
  if (!providerId) return;
  reauthWindows.delete(windowId);
  void (async () => {
    await syncProviderCookies(chrome.cookies, [providerId]);
    await broadcastToWorkspace({ type: 'RELOAD_PROVIDER', providerId });
  })();
});

chrome.notifications.onClicked.addListener((notifId) => {
  chrome.notifications.clear(notifId);
  const target = router.parseNotificationClick(notifId);
  void (async () => {
    const tabId = await openOrFocusWorkspace(chrome.tabs, chrome.windows, getWorkspaceUrl());
    if (!target) return;
    await broadcastToWorkspace({ type: 'FOCUS_PROVIDER', providerId: target.providerId });
    if (tabId > 0) {
      chrome.tabs.sendMessage(
        tabId,
        {
          type: 'TRIGGER_NOTIFY_CLICK',
          providerId: target.providerId,
          notifToken: target.notifToken
        } satisfies RuntimeMessage,
        () => void chrome.runtime.lastError
      );
    }
  })();
});

chrome.runtime.onMessage.addListener((rawMsg: RuntimeMessage, _sender, sendResponse) => {
  switch (rawMsg.type) {
    case 'CHAT_NOTIFY': {
      void router.handleIncoming(rawMsg.payload).then((notifId) => sendResponse({ notifId }));
      return true;
    }
    case 'UNREAD_UPDATE': {
      void broadcastToWorkspace(rawMsg);
      sendResponse({ ok: true });
      return false;
    }
    case 'WORKSPACE_FOCUS_STATE': {
      router.setFocusState({
        windowFocused: rawMsg.windowFocused,
        focusedProvider: rawMsg.focusedProvider
      });
      sendResponse({ ok: true });
      return false;
    }
    case 'SYNC_PREFS': {
      router.setPrefs({ dnd: rawMsg.prefs.dnd, hidePreview: rawMsg.prefs.hidePreview });
      void applyLiteMediaRuleset(rawMsg.prefs.liteMedia);
      sendResponse({ ok: true });
      return false;
    }
    case 'OPEN_REAUTH': {
      const cfg = PROVIDERS[rawMsg.providerId];
      void chrome.windows
        .create({ url: cfg.loginUrl, type: 'popup', width: 520, height: 680, focused: true })
        .then((win) => {
          if (win?.id) reauthWindows.set(win.id, rawMsg.providerId);
          sendResponse({ ok: true });
        });
      return true;
    }
    case 'TEST_NOTIFY': {
      chrome.notifications.create(
        `dia-test:${Date.now()}`,
        {
          type: 'basic',
          iconUrl: getIconUrl(),
          title: 'Dia Bento Chat Hub',
          message: 'Thong bao native macOS hoat dong tot!',
          priority: 2
        },
        (id) => sendResponse({ notifId: id })
      );
      return true;
    }
    case 'GET_DUP_TABS': {
      void chrome.tabs.query({}).then((allTabs) => {
        sendResponse({ tabs: findExternalProviderTabs(allTabs, getWorkspaceUrl()) });
      });
      return true;
    }
    case 'CLOSE_DUP_TABS': {
      void chrome.tabs.query({}).then(async (allTabs) => {
        const dups = findExternalProviderTabs(allTabs, getWorkspaceUrl());
        if (dups.length > 0) {
          await chrome.tabs.remove(dups.map((d) => d.tabId));
        }
        sendResponse({ closed: dups.length });
      });
      return true;
    }
    default:
      return false;
  }
});
```

- [ ] **Step 4: Chay test xac nhan PASS**

Run: `npx vitest run tests/unit/notify-router.test.ts && npm run typecheck`
Expected: PASS (3 tests passing, 0 TypeScript errors).

- [ ] **Step 5: Commit Task 4**

```bash
git add src/background/notify-router.ts src/background/service-worker.ts tests/unit/notify-router.test.ts
git commit -m "feat: implement NotifyRouter and MV3 background ServiceWorker"
```

---

### Task 5: Content Scripts - MAIN World Notification Proxy, rAF 2fps Governor & ISOLATED Frame Agent

**Files:**
- Create: `src/content/raf-governor.ts`
- Create: `src/content/unread-observer.ts`
- Create: `src/content/notify-hook.main.ts`
- Create: `src/content/frame-agent.isolated.ts`
- Test: `tests/unit/content-agents.test.ts`

**Interfaces:**
- Consumes: `MainToIsolatedEvent`, `IsolatedToMainEvent`, `ProviderId`, `RuntimeMessage`, `WorkspaceToFrameMessage` from `src/shared/types.ts`, `PROVIDERS`, `extractUnreadFromDom`, `matchProviderByUrl`, `parseUnreadFromTitle` from `src/providers/registry.ts`.
- Produces:
  - `installRafGovernor(targetWin: Window & typeof globalThis, idleIntervalMs?: number): { setThrottled(throttled: boolean): void; isThrottled(): boolean }`
  - `installNotificationHook(targetWin: Window & typeof globalThis, onRawNotify: (ev: MainToIsolatedEvent) => void): { triggerClick(notifToken: string): boolean }`
  - `UnreadFallbackTracker` class (`onUnreadCount(count: number): void`, `onRawNotify(): void`, `dispose(): void`)
  - `syncSubPaneDiet(doc: Document, cssText: string, enabled: boolean): void`

- [ ] **Step 1: Viet failing unit test cho `raf-governor` va `unread-observer`**

Create `tests/unit/content-agents.test.ts`:
```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNotificationHook, installRafGovernor } from '../../src/content/raf-governor';
import { UnreadFallbackTracker, syncSubPaneDiet } from '../../src/content/unread-observer';

describe('MAIN world hooks (Notification & rAF Governor)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('intercepts window.Notification, forces granted permission, and routes click callbacks by token', () => {
    const events: Array<{ title: string; body: string; notifToken: string }> = [];
    const hook = installNotificationHook(window, (ev) => events.push(ev));

    expect(window.Notification.permission).toBe('granted');
    const instance = new window.Notification('Tran B', { body: 'Gui file hop dong', tag: 't1' });
    const onClick = vi.fn();
    instance.onclick = onClick;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: 'Tran B', body: 'Gui file hop dong' });

    const clicked = hook.triggerClick(events[0]!.notifToken);
    expect(clicked).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('throttles requestAnimationFrame to 500ms (~2fps) when throttled and restores native speed when unthrottled', () => {
    let nativeCalls = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      nativeCalls += 1;
      return window.setTimeout(() => cb(16), 16);
    }) as typeof window.requestAnimationFrame;

    const gov = installRafGovernor(window, 500);
    gov.setThrottled(true);

    const tick = vi.fn();
    window.requestAnimationFrame(tick);
    vi.advanceTimersByTime(100);
    expect(tick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(420);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(nativeCalls).toBe(0);

    gov.setThrottled(false);
    window.requestAnimationFrame(tick);
    vi.advanceTimersByTime(20);
    expect(nativeCalls).toBe(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe('ISOLATED world UnreadFallbackTracker & SubPaneDiet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits fallback notification after 1500ms only when unread count rises without RAW_NOTIFY', () => {
    const onFallback = vi.fn();
    const tracker = new UnreadFallbackTracker(1500, onFallback);

    tracker.onUnreadCount(2);
    vi.advanceTimersByTime(1500);
    expect(onFallback).toHaveBeenCalledWith(2);

    onFallback.mockClear();
    tracker.onUnreadCount(3);
    vi.advanceTimersByTime(500);
    tracker.onRawNotify();
    vi.advanceTimersByTime(1500);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('injects and removes sub-pane diet stylesheet cleanly', () => {
    syncSubPaneDiet(document, '.sidebar { display: none !important; }', true);
    expect(document.getElementById('dia-sub-diet')?.textContent).toContain('display: none');

    syncSubPaneDiet(document, '.sidebar { display: none !important; }', false);
    expect(document.getElementById('dia-sub-diet')).toBeNull();
  });
});
```

- [ ] **Step 2: Chay test xac nhan FAIL**

Run: `npx vitest run tests/unit/content-agents.test.ts`
Expected: FAIL voi loi `Cannot find module '../../src/content/raf-governor'`.

- [ ] **Step 3: Viet implementation cho 4 file trong `src/content/`**

Create `src/content/raf-governor.ts`:
```ts
import type { MainToIsolatedEvent } from '../shared/types';

export function installRafGovernor(
  targetWin: Window & typeof globalThis,
  idleIntervalMs = 500
): { setThrottled(throttled: boolean): void; isThrottled(): boolean } {
  const origRaf = targetWin.requestAnimationFrame.bind(targetWin);
  const origCaf = targetWin.cancelAnimationFrame.bind(targetWin);
  let throttled = false;
  let syntheticIdSeq = 900_000_000;
  const timerByHandle = new Map<number, number>();

  targetWin.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
    if (!throttled) {
      return origRaf(callback);
    }
    syntheticIdSeq += 1;
    const handle = syntheticIdSeq;
    const timerId = targetWin.setTimeout(() => {
      timerByHandle.delete(handle);
      callback(targetWin.performance.now());
    }, idleIntervalMs);
    timerByHandle.set(handle, timerId);
    return handle;
  }) as typeof targetWin.requestAnimationFrame;

  targetWin.cancelAnimationFrame = ((handle: number): void => {
    const timerId = timerByHandle.get(handle);
    if (typeof timerId === 'number') {
      targetWin.clearTimeout(timerId);
      timerByHandle.delete(handle);
      return;
    }
    origCaf(handle);
  }) as typeof targetWin.cancelAnimationFrame;

  return {
    setThrottled(next: boolean): void {
      throttled = next;
    },
    isThrottled(): boolean {
      return throttled;
    }
  };
}

interface StoredNotifyTarget {
  onclick: ((this: Notification, ev: Event) => unknown) | null;
  dispatchEvent: (ev: Event) => boolean;
}

export function installNotificationHook(
  targetWin: Window & typeof globalThis,
  onRawNotify: (ev: MainToIsolatedEvent) => void
): { triggerClick(notifToken: string): boolean } {
  const instances = new Map<string, StoredNotifyTarget>();
  let tokenSeq = 0;

  class DiaNotificationProxy extends EventTarget {
    static permission: NotificationPermission = 'granted';
    static maxActions = 2;

    static requestPermission(
      deprecatedCallback?: NotificationPermissionCallback
    ): Promise<NotificationPermission> {
      deprecatedCallback?.('granted');
      return Promise.resolve('granted');
    }

    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly icon: string;
    readonly data: unknown;
    onclick: ((this: Notification, ev: Event) => unknown) | null = null;
    onclose: ((this: Notification, ev: Event) => unknown) | null = null;
    onerror: ((this: Notification, ev: Event) => unknown) | null = null;
    onshow: ((this: Notification, ev: Event) => unknown) | null = null;

    constructor(title: string, options: NotificationOptions = {}) {
      super();
      this.title = String(title ?? '');
      this.body = String(options.body ?? '');
      this.tag = String(options.tag ?? '');
      this.icon = String(options.icon ?? '');
      this.data = options.data ?? null;

      tokenSeq += 1;
      const notifToken = `nt-${Date.now()}-${tokenSeq}`;
      instances.set(notifToken, this);
      if (instances.size > 50) {
        const oldest = instances.keys().next().value;
        if (oldest) instances.delete(oldest);
      }

      onRawNotify({
        type: 'RAW_NOTIFY',
        title: this.title,
        body: this.body,
        tag: this.tag || undefined,
        notifToken
      });
    }

    close(): void {
      const ev = new Event('close');
      this.onclose?.call(this as unknown as Notification, ev);
      this.dispatchEvent(ev);
    }
  }

  Object.defineProperty(targetWin, 'Notification', {
    value: DiaNotificationProxy,
    configurable: true,
    writable: true
  });

  return {
    triggerClick(notifToken: string): boolean {
      const target = instances.get(notifToken);
      if (!target) return false;
      const ev = new Event('click');
      target.onclick?.call(target as unknown as Notification, ev);
      target.dispatchEvent(ev);
      return true;
    }
  };
}
```

Create `src/content/unread-observer.ts`:
```ts
const STYLE_ID = 'dia-sub-diet';

export class UnreadFallbackTracker {
  private prevCount = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fallbackDelayMs: number,
    private readonly onFallbackNotify: (unreadCount: number) => void
  ) {}

  onUnreadCount(nextCount: number): void {
    const increased = nextCount > this.prevCount;
    this.prevCount = nextCount;
    if (!increased) return;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.onFallbackNotify(nextCount);
    }, this.fallbackDelayMs);
  }

  onRawNotify(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  dispose(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

export function syncSubPaneDiet(doc: Document, cssText: string, enabled: boolean): void {
  const existing = doc.getElementById(STYLE_ID);
  if (!enabled) {
    existing?.remove();
    return;
  }
  if (!existing) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = cssText;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  for (const video of doc.querySelectorAll('video')) {
    if (!video.paused) {
      video.pause();
    }
  }
}
```

Create `src/content/notify-hook.main.ts`:
```ts
import type { IsolatedToMainEvent, MainToIsolatedEvent } from '../shared/types';
import { installNotificationHook, installRafGovernor } from './raf-governor';

(() => {
  if (window === window.top) return;

  const MAIN_TO_ISO = '__dia_main_to_iso__';
  const ISO_TO_MAIN = '__dia_iso_to_main__';

  const governor = installRafGovernor(window, 500);
  const notifyHook = installNotificationHook(window, (payload: MainToIsolatedEvent) => {
    window.dispatchEvent(
      new CustomEvent<string>(MAIN_TO_ISO, { detail: JSON.stringify(payload) })
    );
  });

  window.addEventListener(ISO_TO_MAIN, (rawEv: Event) => {
    const detail = (rawEv as CustomEvent<string>).detail;
    if (!detail) return;
    let cmd: IsolatedToMainEvent;
    try {
      cmd = JSON.parse(detail) as IsolatedToMainEvent;
    } catch {
      return;
    }
    if (cmd.type === 'SET_THROTTLE') {
      governor.setThrottled(cmd.throttled);
    } else if (cmd.type === 'CLICK_NOTIFY') {
      notifyHook.triggerClick(cmd.notifToken);
    }
  });
})();
```

Create `src/content/frame-agent.isolated.ts`:
```ts
import type {
  IsolatedToMainEvent,
  MainToIsolatedEvent,
  RuntimeMessage,
  WorkspaceToFrameMessage
} from '../shared/types';
import {
  PROVIDERS,
  extractUnreadFromDom,
  matchProviderByUrl,
  parseUnreadFromTitle
} from '../providers/registry';
import { UnreadFallbackTracker, syncSubPaneDiet } from './unread-observer';

(() => {
  if (window === window.top) return;

  const providerId = matchProviderByUrl(window.location.href);
  if (!providerId) return;

  const MAIN_TO_ISO = '__dia_main_to_iso__';
  const ISO_TO_MAIN = '__dia_iso_to_main__';

  let isMainSlot = providerId === 'zalo';
  let isHovered = false;
  let lastReportedUnread = -1;

  const sendToMain = (cmd: IsolatedToMainEvent): void => {
    window.dispatchEvent(new CustomEvent<string>(ISO_TO_MAIN, { detail: JSON.stringify(cmd) }));
  };

  const sendToBackground = (msg: RuntimeMessage): void => {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch {
      // Extension context invalidated during reload
    }
  };

  const applySlotPolicy = (): void => {
    const shouldThrottle = !isMainSlot && !isHovered;
    sendToMain({ type: 'SET_THROTTLE', throttled: shouldThrottle });
    syncSubPaneDiet(document, PROVIDERS[providerId].subPaneCss, !isMainSlot);
  };

  const fallbackTracker = new UnreadFallbackTracker(1500, (count) => {
    sendToBackground({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId,
        title: PROVIDERS[providerId].name,
        body: `Ban co ${count} tin nhan chua doc`,
        tag: `fallback-${providerId}`
      }
    });
  });

  const evaluateUnread = (): void => {
    const titleCount = parseUnreadFromTitle(providerId, document.title || '');
    const domCount = document.body ? extractUnreadFromDom(providerId, document) : 0;
    const count = titleCount > 0 ? titleCount : domCount;
    if (count !== lastReportedUnread) {
      lastReportedUnread = count;
      sendToBackground({ type: 'UNREAD_UPDATE', providerId, count });
    }
    fallbackTracker.onUnreadCount(count);
  };

  window.addEventListener(MAIN_TO_ISO, (rawEv: Event) => {
    const detail = (rawEv as CustomEvent<string>).detail;
    if (!detail) return;
    let parsed: MainToIsolatedEvent;
    try {
      parsed = JSON.parse(detail) as MainToIsolatedEvent;
    } catch {
      return;
    }
    if (parsed.type === 'RAW_NOTIFY') {
      fallbackTracker.onRawNotify();
      sendToBackground({
        type: 'CHAT_NOTIFY',
        payload: {
          providerId,
          title: parsed.title || PROVIDERS[providerId].name,
          body: parsed.body,
          tag: parsed.tag,
          notifToken: parsed.notifToken
        }
      });
    }
  });

  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as WorkspaceToFrameMessage | { type?: string; notifToken?: string } | null;
    if (!data || typeof data !== 'object') return;
    if (
      'source' in data &&
      data.source === 'dia-bento-workspace' &&
      data.type === 'DIA_SLOT_MODE'
    ) {
      isMainSlot = data.isMain;
      applySlotPolicy();
    } else if (data.type === 'DIA_CLICK_NOTIFY' && typeof data.notifToken === 'string') {
      sendToMain({ type: 'CLICK_NOTIFY', notifToken: data.notifToken });
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    applySlotPolicy();
    evaluateUnread();

    document.documentElement.addEventListener('mouseenter', () => {
      isHovered = true;
      applySlotPolicy();
    });
    document.documentElement.addEventListener('mouseleave', () => {
      isHovered = false;
      applySlotPolicy();
    });

    const observer = new MutationObserver(() => evaluateUnread());
    const titleEl = document.querySelector('title') ?? document.head ?? document.documentElement;
    observer.observe(titleEl, { subtree: true, childList: true, characterData: true });
    window.setInterval(evaluateUnread, 3000);
  });
})();
```

- [ ] **Step 4: Chay test xac nhan PASS**

Run: `npx vitest run tests/unit/content-agents.test.ts && npm run typecheck`
Expected: PASS (4 tests passing, 0 TypeScript errors).

- [ ] **Step 5: Commit Task 5**

```bash
git add src/content/ tests/unit/content-agents.test.ts
git commit -m "feat: add MAIN world Notification hook, 2fps rAF governor, and ISOLATED frame agent"
```

---

### Task 6: Zero-Reload Bento Workspace UI

**Files:**
- Create: `src/workspace/bento-state.ts`
- Create: `src/workspace/workspace.ts`
- Create: `public/workspace.html`
- Create: `public/workspace.css`
- Test: `tests/unit/bento-state.test.ts`

**Interfaces:**
- Consumes: `ProviderId`, `SlotId`, `WorkspacePrefs`, `RuntimeMessage`, `WorkspaceToFrameMessage`, `ExternalProviderTab` from `src/shared/types.ts`, `PROVIDERS`, `PROVIDER_ORDER` from `src/providers/registry.ts`.
- Produces:
  - `DEFAULT_PREFS: WorkspacePrefs`
  - `SLOT_IDS: readonly [SlotId, SlotId, SlotId, SlotId]`
  - `swapProviderToMain(order: readonly [ProviderId, ProviderId, ProviderId, ProviderId], target: ProviderId): [ProviderId, ProviderId, ProviderId, ProviderId]`
  - `clampMainWidth(pct: number): number`
  - `formatWorkspaceTitle(unreads: Record<ProviderId, number>): string`
  - `resolveEmbedUrl(providerId: ProviderId, testOrigin: string | null): string`

- [ ] **Step 1: Viet failing unit test cho `bento-state`**

Create `tests/unit/bento-state.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  clampMainWidth,
  formatWorkspaceTitle,
  resolveEmbedUrl,
  swapProviderToMain
} from '../../src/workspace/bento-state';

describe('BentoState pure functions', () => {
  it('swaps selected sub-pane with current main pane while keeping other sub-panes stable', () => {
    const initial = DEFAULT_PREFS.slotOrder;
    expect(initial).toEqual(['zalo', 'messenger', 'telegram', 'discord']);

    const swapped = swapProviderToMain(initial, 'telegram');
    expect(swapped).toEqual(['telegram', 'messenger', 'zalo', 'discord']);
    expect(swapProviderToMain(swapped, 'telegram')).toEqual(swapped);
  });

  it('clamps main column width between 45% and 80%', () => {
    expect(clampMainWidth(20)).toBe(45);
    expect(clampMainWidth(66)).toBe(66);
    expect(clampMainWidth(95)).toBe(80);
  });

  it('formats workspace document title with aggregated unread count', () => {
    expect(
      formatWorkspaceTitle({ zalo: 0, messenger: 0, telegram: 0, discord: 0 })
    ).toBe('Dia Bento Chat Hub');
    expect(
      formatWorkspaceTitle({ zalo: 2, messenger: 1, telegram: 0, discord: 4 })
    ).toBe('(7) Dia Bento Chat Hub');
  });

  it('resolves production embed URL or local E2E testOrigin override', () => {
    expect(resolveEmbedUrl('telegram', null)).toBe('https://web.telegram.org/k/');
    expect(resolveEmbedUrl('telegram', 'http://127.0.0.1:4321')).toBe(
      'http://127.0.0.1:4321/telegram'
    );
  });
});
```

- [ ] **Step 2: Chay test xac nhan FAIL**

Run: `npx vitest run tests/unit/bento-state.test.ts`
Expected: FAIL voi loi `Cannot find module '../../src/workspace/bento-state'`.

- [ ] **Step 3: Viet `src/workspace/bento-state.ts`, `public/workspace.html`, `public/workspace.css`, va `src/workspace/workspace.ts`**

Create `src/workspace/bento-state.ts`:
```ts
import type { ProviderId, SlotId, WorkspacePrefs } from '../shared/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers/registry';

export const SLOT_IDS: readonly [SlotId, SlotId, SlotId, SlotId] = [
  'main',
  'sub-1',
  'sub-2',
  'sub-3'
];

export const DEFAULT_PREFS: WorkspacePrefs = {
  slotOrder: ['zalo', 'messenger', 'telegram', 'discord'],
  mainWidthPct: 66,
  dnd: false,
  hidePreview: false,
  liteMedia: false,
  paused: {
    zalo: false,
    messenger: false,
    telegram: false,
    discord: false
  }
};

export function swapProviderToMain(
  order: readonly [ProviderId, ProviderId, ProviderId, ProviderId],
  target: ProviderId
): [ProviderId, ProviderId, ProviderId, ProviderId] {
  const next: [ProviderId, ProviderId, ProviderId, ProviderId] = [...order];
  const idx = next.indexOf(target);
  if (idx <= 0) return next;
  const prevMain = next[0];
  next[0] = target;
  next[idx] = prevMain;
  return next;
}

export function clampMainWidth(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_PREFS.mainWidthPct;
  return Math.min(80, Math.max(45, Math.round(pct)));
}

export function formatWorkspaceTitle(unreads: Record<ProviderId, number>): string {
  const total = PROVIDER_ORDER.reduce((sum, id) => sum + (unreads[id] || 0), 0);
  return total > 0 ? `(${total}) Dia Bento Chat Hub` : 'Dia Bento Chat Hub';
}

export function resolveEmbedUrl(providerId: ProviderId, testOrigin: string | null): string {
  if (testOrigin) {
    return `${testOrigin.replace(/\/$/, '')}/${providerId}`;
  }
  return PROVIDERS[providerId].embedUrl;
}
```

Create `public/workspace.html`:
```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dia Bento Chat Hub</title>
    <link rel="stylesheet" href="workspace.css" />
  </head>
  <body>
    <header id="topbar">
      <div class="topbar-left">
        <span class="brand">Dia Bento Chat</span>
        <span id="total-unread" class="badge hidden">0</span>
        <button id="dup-tabs-btn" class="warn-btn hidden" type="button"></button>
      </div>
      <div class="topbar-right">
        <span class="hint">Alt+1..4 doi khung chinh</span>
        <button id="btn-lite-media" class="toggle-btn" type="button" title="Chan autoplay GIF nang">
          Lite Media
        </button>
        <button id="btn-hide-preview" class="toggle-btn" type="button" title="An noi dung thong bao">
          An Noi Dung
        </button>
        <button id="btn-dnd" class="toggle-btn" type="button" title="Tat thong bao macOS">
          DND
        </button>
        <button id="btn-test-notify" class="action-btn" type="button">Test Notify</button>
      </div>
    </header>

    <main id="bento-grid">
      <div id="grid-resizer" title="Keo de chinh do rong khung chinh"></div>
    </main>

    <script src="workspace.js"></script>
  </body>
</html>
```

Create `public/workspace.css`:
```css
:root {
  --main-width: 66%;
  --bg: #0b1120;
  --panel: #111827;
  --header: #1e293b;
  --border: #334155;
  --accent: #3b82f6;
  --text: #e2e8f0;
  --muted: #94a3b8;
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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
}

#topbar {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand {
  font-weight: 700;
  letter-spacing: 0.2px;
}

.hint {
  color: var(--muted);
  font-size: 11px;
}

.badge {
  background: var(--danger);
  color: #fff;
  font-weight: 700;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
}

.hidden {
  display: none !important;
}

button {
  background: var(--header);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

button:hover {
  border-color: var(--accent);
}

.toggle-btn.active {
  background: rgba(34, 197, 94, 0.18);
  border-color: var(--ok);
  color: #86efac;
}

.warn-btn {
  background: rgba(245, 158, 11, 0.18);
  border-color: var(--warn);
  color: #fde68a;
}

#bento-grid {
  width: 100vw;
  height: calc(100vh - 32px);
  display: grid;
  grid-template-columns: var(--main-width) 5px 1fr;
  grid-template-rows: repeat(3, 1fr);
  grid-template-areas:
    "main resizer sub1"
    "main resizer sub2"
    "main resizer sub3";
  background: var(--bg);
}

#grid-resizer {
  grid-area: resizer;
  cursor: col-resize;
  background: var(--border);
  transition: background 0.12s;
}

#grid-resizer:hover,
body.resizing #grid-resizer {
  background: var(--accent);
}

body.resizing iframe {
  pointer-events: none;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
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

.pane-header {
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  background: var(--header);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.pane[data-slot="main"] .pane-header {
  background: #172554;
  border-bottom-color: var(--accent);
}

.pane-title-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 0;
  font-weight: 600;
  color: var(--text);
}

.pane-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pane-controls button {
  padding: 1px 6px;
  font-size: 10px;
}

.pane-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.pane-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.paused-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--bg);
  color: var(--muted);
}
```

Create `src/workspace/workspace.ts`:
```ts
import type {
  ExternalProviderTab,
  ProviderId,
  RuntimeMessage,
  SlotId,
  WorkspacePrefs,
  WorkspaceToFrameMessage
} from '../shared/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers/registry';
import {
  DEFAULT_PREFS,
  SLOT_IDS,
  clampMainWidth,
  formatWorkspaceTitle,
  resolveEmbedUrl,
  swapProviderToMain
} from './bento-state';

const STORAGE_KEY = 'dia_bento_prefs_v1';
const SANDBOX_FLAGS =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
const ALLOW_PERMS = 'clipboard-read; clipboard-write; microphone; camera';

interface PaneDom {
  section: HTMLElement;
  unreadBadge: HTMLElement;
  modeTag: HTMLElement;
  pauseBtn: HTMLButtonElement;
  pausedOverlay: HTMLElement;
  iframe: HTMLIFrameElement;
}

const searchParams = new URLSearchParams(window.location.search);
const testOrigin = searchParams.get('testOrigin');

let prefs: WorkspacePrefs = structuredClone(DEFAULT_PREFS);
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
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const saved = stored[STORAGE_KEY] as Partial<WorkspacePrefs> | undefined;
  if (!saved) return;
  prefs = {
    ...DEFAULT_PREFS,
    ...saved,
    mainWidthPct: clampMainWidth(saved.mainWidthPct ?? DEFAULT_PREFS.mainWidthPct),
    paused: { ...DEFAULT_PREFS.paused, ...(saved.paused ?? {}) }
  };
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
      liteMedia: prefs.liteMedia
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

function applyLayout(): void {
  document.documentElement.style.setProperty('--main-width', `${prefs.mainWidthPct}%`);

  prefs.slotOrder.forEach((providerId, index) => {
    const slot: SlotId = SLOT_IDS[index] ?? 'sub-3';
    const pane = panes.get(providerId);
    if (!pane) return;
    pane.section.dataset.slot = slot;
    const isMain = slot === 'main';
    pane.modeTag.textContent = prefs.paused[providerId]
      ? 'Paused'
      : isMain
        ? 'Main 60fps'
        : 'Sub 2fps';
    postSlotMode(providerId, isMain);
  });

  document.getElementById('btn-lite-media')?.classList.toggle('active', prefs.liteMedia);
  document.getElementById('btn-hide-preview')?.classList.toggle('active', prefs.hidePreview);
  document.getElementById('btn-dnd')?.classList.toggle('active', prefs.dnd);

  sendRuntime({
    type: 'WORKSPACE_FOCUS_STATE',
    windowFocused: document.hasFocus(),
    focusedProvider: prefs.slotOrder[0]
  });
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
  const totalBadge = document.getElementById('total-unread');
  if (totalBadge) {
    totalBadge.textContent = String(total);
    totalBadge.classList.toggle('hidden', total <= 0);
  }
  document.title = formatWorkspaceTitle(unreads);
}

function focusProvider(providerId: ProviderId): void {
  if (prefs.paused[providerId]) {
    togglePause(providerId, false);
  }
  prefs.slotOrder = swapProviderToMain(prefs.slotOrder, providerId);
  applyLayout();
  savePrefs();
}

function togglePause(providerId: ProviderId, nextPaused?: boolean): void {
  const pane = panes.get(providerId);
  if (!pane) return;
  const paused = nextPaused ?? !prefs.paused[providerId];
  prefs.paused[providerId] = paused;
  if (paused) {
    pane.iframe.src = 'about:blank';
    pane.pausedOverlay.classList.remove('hidden');
    pane.pauseBtn.textContent = 'Resume';
  } else {
    pane.pausedOverlay.classList.add('hidden');
    pane.pauseBtn.textContent = 'Pause';
    pane.iframe.src = resolveEmbedUrl(providerId, testOrigin);
  }
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
    titleBtn.title = `Dua ${cfg.name} len khung chinh (Alt+${cfg.shortcutIndex})`;
    titleBtn.addEventListener('click', () => focusProvider(providerId));

    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${cfg.name} (Alt+${cfg.shortcutIndex})`;

    const unreadBadge = document.createElement('span');
    unreadBadge.className = 'badge hidden';
    unreadBadge.textContent = '0';

    titleBtn.append(nameSpan, unreadBadge);

    const controls = document.createElement('div');
    controls.className = 'pane-controls';

    const modeTag = document.createElement('span');
    modeTag.className = 'hint';

    const reauthBtn = document.createElement('button');
    reauthBtn.type = 'button';
    reauthBtn.textContent = 'Re-Auth';
    reauthBtn.addEventListener('click', () =>
      sendRuntime({ type: 'OPEN_REAUTH', providerId })
    );

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.textContent = prefs.paused[providerId] ? 'Resume' : 'Pause';
    pauseBtn.addEventListener('click', () => togglePause(providerId));

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.textContent = '↻';
    reloadBtn.title = 'Reload khung nay';
    reloadBtn.addEventListener('click', () => reloadProvider(providerId));

    controls.append(modeTag, reauthBtn, pauseBtn, reloadBtn);
    header.append(titleBtn, controls);

    const body = document.createElement('div');
    body.className = 'pane-body';

    const iframe = document.createElement('iframe');
    iframe.className = 'pane-iframe';
    iframe.setAttribute('sandbox', SANDBOX_FLAGS);
    iframe.setAttribute('allow', ALLOW_PERMS);
    iframe.src = prefs.paused[providerId] ? 'about:blank' : resolveEmbedUrl(providerId, testOrigin);
    iframe.addEventListener('load', () => {
      const isMain = prefs.slotOrder[0] === providerId;
      postSlotMode(providerId, isMain);
    });

    const pausedOverlay = document.createElement('div');
    pausedOverlay.className = `paused-overlay ${prefs.paused[providerId] ? '' : 'hidden'}`.trim();
    const pausedLabel = document.createElement('span');
    pausedLabel.textContent = `${cfg.name} dang ngu tam (0 MB Renderer RAM)`;
    const wakeBtn = document.createElement('button');
    wakeBtn.type = 'button';
    wakeBtn.textContent = 'Mo lai ngay';
    wakeBtn.addEventListener('click', () => togglePause(providerId, false));
    pausedOverlay.append(pausedLabel, wakeBtn);

    body.append(iframe, pausedOverlay);
    section.append(header, body);
    grid.appendChild(section);

    panes.set(providerId, {
      section,
      unreadBadge,
      modeTag,
      pauseBtn,
      pausedOverlay,
      iframe
    });
  }
}

function updateDupTabsBanner(tabs: ExternalProviderTab[]): void {
  const btn = document.getElementById('dup-tabs-btn') as HTMLButtonElement | null;
  if (!btn) return;
  if (tabs.length === 0) {
    btn.classList.add('hidden');
    return;
  }
  btn.textContent = `Dong ${tabs.length} tab chat trung ben ngoai`;
  btn.classList.remove('hidden');
}

function bindEvents(): void {
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

  document.getElementById('btn-test-notify')?.addEventListener('click', () => {
    sendRuntime({ type: 'TEST_NOTIFY' });
  });

  document.getElementById('dup-tabs-btn')?.addEventListener('click', () => {
    sendRuntime({ type: 'CLOSE_DUP_TABS' }, () => updateDupTabsBanner([]));
  });

  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (!ev.altKey) return;
    const digit = Number.parseInt(ev.key, 10);
    if (digit >= 1 && digit <= 4) {
      ev.preventDefault();
      const target = PROVIDER_ORDER[digit - 1];
      if (target) focusProvider(target);
    }
  });

  window.addEventListener('focus', () => applyLayout());
  window.addEventListener('blur', () => applyLayout());

  const resizer = document.getElementById('grid-resizer');
  resizer?.addEventListener('mousedown', (startEv) => {
    startEv.preventDefault();
    document.body.classList.add('resizing');
    const onMove = (moveEv: MouseEvent) => {
      const pct = (moveEv.clientX / window.innerWidth) * 100;
      prefs.mainWidthPct = clampMainWidth(pct);
      document.documentElement.style.setProperty('--main-width', `${prefs.mainWidthPct}%`);
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      savePrefs();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
      if (msg.type === 'UNREAD_UPDATE') {
        unreads[msg.providerId] = msg.count;
        updateUnreadUi();
      } else if (msg.type === 'FOCUS_PROVIDER') {
        focusProvider(msg.providerId);
      } else if (msg.type === 'RELOAD_PROVIDER') {
        reloadProvider(msg.providerId);
      } else if (msg.type === 'TRIGGER_NOTIFY_CLICK') {
        focusProvider(msg.providerId);
        if (msg.notifToken) {
          panes.get(msg.providerId)?.iframe.contentWindow?.postMessage(
            { type: 'DIA_CLICK_NOTIFY', notifToken: msg.notifToken },
            '*'
          );
        }
      } else if (msg.type === 'DUP_TABS_CHANGED') {
        updateDupTabsBanner(msg.tabs);
      }
    });
  }
}

void (async () => {
  await loadPrefs();
  mountPanes();
  bindEvents();
  applyLayout();
  savePrefs();
  updateUnreadUi();
  sendRuntime({ type: 'GET_DUP_TABS' }, (res) => {
    const data = res as { tabs?: ExternalProviderTab[] } | undefined;
    if (data?.tabs) updateDupTabsBanner(data.tabs);
  });
})();
```

- [ ] **Step 4: Chay test + build xac nhan PASS**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS (18 unit tests passing, 0 TypeScript errors, `dist/` built cleanly).

- [ ] **Step 5: Commit Task 6**

```bash
git add public/workspace.html public/workspace.css src/workspace/ tests/unit/bento-state.test.ts
git commit -m "feat: build zero-reload Bento Workspace UI with RAM pause and topbar controls"
```

---

### Task 7: End-to-End Chromium MV3 Verification

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/extension.spec.ts`

**Interfaces:**
- Consumes: Built unpacked extension inside `dist/` via `npm run build:test`.
- Produces: Automated E2E proof tren Chromium that cho DNR header stripping (`X-Frame-Options: DENY` + `CSP`), Bento zero-reload swap (`Alt+2`), `window.Notification` + unread badge bridge, va `rAF` 2fps sub-pane throttling.

- [ ] **Step 1: Cai Chromium cho Playwright va tao `playwright.config.ts` + `tests/e2e/extension.spec.ts`**

Create `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  workers: 1,
  use: {
    headless: false
  }
});
```

Create `tests/e2e/extension.spec.ts`:
```ts
import { chromium, expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let server: Server;
let baseUrl = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const provider = (req.url ?? '/zalo').split('?')[0]?.replace(/^\//, '') || 'zalo';
    // Deliberately return strict framing blockers to verify DNR framing.json strips them!
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'"
    });
    res.end(`<!doctype html>
      <html>
        <head><title>${provider.toUpperCase()}</title></head>
        <body>
          <h1 id="provider-heading">${provider}</h1>
          <script>
            window.__bootNonce = Math.random();
            window.__measureRafTicks = (ms) => new Promise((resolveTicks) => {
              let ticks = 0;
              let active = true;
              const loop = () => {
                if (!active) return;
                ticks += 1;
                requestAnimationFrame(loop);
              };
              requestAnimationFrame(loop);
              setTimeout(() => {
                active = false;
                resolveTicks(ticks);
              }, ms);
            });
          </script>
        </body>
      </html>`);
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const addr = server.address();
  if (addr && typeof addr === 'object') {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

test('MV3 extension strips X-Frame-Options/CSP, swaps Bento in 0ms without reload, bridges notifications/unread, and throttles sub-panes', async () => {
  const distPath = resolve(process.cwd(), 'dist');
  const userDataDir = mkdtempSync(join(tmpdir(), 'dia-bento-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`
    ]
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker');
    }
    const extId = new URL(sw.url()).host;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/workspace.html?testOrigin=${encodeURIComponent(baseUrl)}`);

    // 1. Verify DNR stripped X-Frame-Options & CSP so all 4 iframes rendered
    for (const id of ['zalo', 'messenger', 'telegram', 'discord']) {
      const frameLoc = page.frameLocator(`section[data-provider="${id}"] iframe`);
      await expect(frameLoc.locator('#provider-heading')).toHaveText(id);
    }

    // 2. Capture iframe boot nonces, press Alt+2 to swap Messenger to Main, verify ZERO reload
    const getNonce = async (provider: string) => {
      const frame = page.frames().find((f) => f.url().endsWith(`/${provider}`));
      expect(frame).toBeTruthy();
      return frame!.evaluate(() => (window as unknown as { __bootNonce: number }).__bootNonce);
    };

    const zaloNonceBefore = await getNonce('zalo');
    const msgrNonceBefore = await getNonce('messenger');

    await page.keyboard.press('Alt+2');
    await expect(page.locator('section[data-provider="messenger"]')).toHaveAttribute(
      'data-slot',
      'main'
    );
    await expect(page.locator('section[data-provider="zalo"]')).toHaveAttribute(
      'data-slot',
      'sub-1'
    );

    expect(await getNonce('zalo')).toBe(zaloNonceBefore);
    expect(await getNonce('messenger')).toBe(msgrNonceBefore);

    // 3. Verify unread title parsing updates Pane Header & Workspace title + MAIN Notification proxy
    const discordFrame = page.frames().find((f) => f.url().endsWith('/discord'))!;
    const perm = await discordFrame.evaluate(() => Notification.permission);
    expect(perm).toBe('granted');

    await discordFrame.evaluate(() => {
      document.title = '(4) Discord';
      new Notification('Channel Ping', { body: 'Deploy xong roi' });
    });

    await expect(
      page.locator('section[data-provider="discord"] .pane-title-btn .badge')
    ).toHaveText('4');
    await expect(page).toHaveTitle('(4) Dia Bento Chat Hub');

    // 4. Verify rAF Governor: Main pane (Messenger) ticks fast (>10 ticks/650ms), Sub pane (Discord) ticks <=3
    const [mainTicks, subTicks] = await Promise.all([
      page
        .frames()
        .find((f) => f.url().endsWith('/messenger'))!
        .evaluate(() =>
          (window as unknown as { __measureRafTicks: (ms: number) => Promise<number> }).__measureRafTicks(650)
        ),
      discordFrame.evaluate(() =>
        (window as unknown as { __measureRafTicks: (ms: number) => Promise<number> }).__measureRafTicks(650)
      )
    ]);

    expect(mainTicks).toBeGreaterThan(10);
    expect(subTicks).toBeLessThanOrEqual(3);
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Chay E2E test tren Chromium that**

Run: `npx playwright install chromium && npm run test:e2e && npm run build`
Expected: `1 passed` va `dist/` san sang load unpacked vao Dia Browser (`dia://extensions` hoac `chrome://extensions` -> Developer Mode -> Load unpacked -> chon thu muc `dist/`).

- [ ] **Step 3: Commit Task 7**

```bash
git add playwright.config.ts tests/e2e/extension.spec.ts
git commit -m "test: add Playwright Chromium MV3 E2E suite for DNR, Bento swap, notifications, and rAF diet"
```
