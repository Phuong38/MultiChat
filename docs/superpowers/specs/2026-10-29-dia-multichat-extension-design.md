# Dia Multi-Chat Bento Extension - Design Spec & Proposal

**Date:** 2026-10-29
**Target Platform:** Dia Browser (Chromium Manifest V3) on macOS
**MVP Providers:** Zalo (`chat.zalo.me`), Messenger (`www.messenger.com`), Telegram (`web.telegram.org/k/`), Discord (`discord.com/app`)

## 1. Problem & Goals

Nguoi dung dung 4 chat app tren nhieu tab Dia Browser moi ngay.
Tab roi rac gay mat tap trung, thieu thong bao native macOS on dinh, ngong RAM cao.

Muc tieu he thong:
- Gom 4 chat provider vao 1 tab Workspace duy nhat theo bo cuc Bento (1 khung chinh 66% + 3 khung phu 34%).
- Giu ca 4 khung mo song 100% de xem tin real-time va nhan thong bao tuc thoi.
- Dam bao 100% tin nhan moi hien banner native macOS (`chrome.notifications`), click banner nhay thang vao khung chat do.
- Cat giam 30-45% RAM/GPU so voi mo 4 tab thuong nho chan tracker/media nang, ep Telegram `/k/`, va ha nhip 3 khung phu xuong 2fps.

## 2. Non-Goals (YAGNI)

- Khong ho tro dang nhap nhieu tai khoan trung 1 provider trong cung profile trinh duyet.
- Khong dung framework UI nang (React/Vue) cho trang Workspace.
- Khong tu viet lai giao dien client chat qua private API (tranh khoa nick Zalo/Discord/Meta).

## 3. Architecture Overview

He thong gom 5 module tach biet, giao tiep qua typed message bus.

```
chrome-extension://<id>/workspace.html (Vanilla TS + CSS Grid <15KB)
 ├── NetRulesEngine (declarativeNetRequest: framing.json + diet.json + lite-media.json)
 ├── ServiceWorker (SingletonTab + CookieBridge + NotifyRouter + DupTabDetector)
 ├── ProviderRegistry (Declarative metadata cho Zalo, Messenger, Telegram, Discord)
 └── 4x <iframe sandbox="...">
      ├── notify-hook.main.ts (MAIN world: window.Notification proxy + rAF governor)
      └── frame-agent.isolated.ts (ISOLATED world: DOM unread fallback + Sub-pane CSS)
```

### 3.1. `ProviderRegistry` (`src/providers/registry.ts`)

Chua cau hinh tinh va ham parse thuần (pure functions) cho 4 provider:
- `zalo`: `https://chat.zalo.me/`, cookie domain `.zalo.me`, title regex `/^\((\d+)\)/`, unread badge selector.
- `messenger`: `https://www.messenger.com/`, cookie domains `.messenger.com` va `.facebook.com`, title regex `/^\((\d+)\)/`.
- `telegram`: `https://web.telegram.org/k/`, cookie domain `.telegram.org`, title regex `/^\((\d+)\)/` hoac badge `.badge-unread`.
- `discord`: `https://discord.com/app`, cookie domain `.discord.com`, title regex `/^\((\d+)\)/`.

### 3.2. `NetRulesEngine` (`public/rules/framing.json` & `public/rules/diet.json`)

Dung `chrome.declarativeNetRequest`:
- **`framing.json` (luon bat):** Tren `resourceTypes: ["sub_frame"]` cua `zalo.me`, `messenger.com`, `facebook.com`, `telegram.org`, `discord.com`, xoa response headers `x-frame-options`, `content-security-policy`, `content-security-policy-report-only`, `cross-origin-opener-policy`, `cross-origin-embedder-policy`.
- **`diet.json` (bat mac dinh, co nut tat/mo):** Block request analytics/telemetry/crash log (`*/science` cua Discord, `sentry.io`, `/ajax/bz` cua Meta, log tracker Zalo).
- **Dynamic Lite-Media Ruleset (`lite-media.json`, toggleable):** Chan autoplay GIF stream tu `media.tenor.com`, `media.giphy.com` khi bat che do Lite Media.

### 3.3. `BentoWorkspace` (`src/workspace/`)

Trang HTML/CSS/Vanilla TS hien thi:
- **Topbar cao 32px:** Ten Workspace, badge tong tin chua doc, nut `[Lite Media]`, `[DND]`, `[Hide Preview]`, `[Test Notify]`, va canh bao tab trung ben ngoai (neu co).
- **Bento Grid Zero-Reload:**
  - 4 phan tu `<section class="pane" data-provider="..." data-slot="main|sub-1|sub-2|sub-3">` nam co dinh trong `#bento-grid`.
  - Swap khung phu len khung chinh (qua click thanh tieu de khung, phim tat `Alt+1..4`, hoac click macOS notification) chi cap nhat attribute `data-slot`.
  - CSS `grid-area` sap xep lai khung trong 0ms ma khong thao lap DOM, dam bao `<iframe>` khong bao gio reload.
  - Thanh vach ngan doc keo tha thay doi bien CSS `--main-width` (luu vao `chrome.storage.local`, mac dinh `66%`, gioi han `45%` - `80%`).
- **Pane Header cao 26px:** Ten app, cham unread count, phim tat `Alt+N`, nut `[Re-Auth]` (mo popup login goc), nut `[Pause/Resume]` (`about:blank` thu cong khi can cat 100% RAM 1 app), nut `[Reload]` (`↻`).
- **Iframe Sandbox:**
  - `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"`
  - `allow="clipboard-read; clipboard-write; microphone; camera"`
  - Chan tuyet doi script pha khung `window.top.location = ...` nhung giu nguyen mo link ngoai sang tab Dia sach, copy/paste anh, gui file, goi thoai.

### 3.4. `ServiceWorker` (`src/background/`)

Chay 4 nhiem vu nen:
1. **`SingletonTab`:** Click icon extension -> tim tab `workspace.html` dang mo, focus cua so + active + pin tab do; chua co moi tao tab moi.
2. **`CookieBridge`:** Quet khi khoi dong va lang nghe `chrome.cookies.onChanged` tren domain cua 4 provider.
   Neu cookie co `sameSite !== "no_restriction"`, ghi de lai voi `sameSite: "no_restriction"` va `secure: true` (giu nguyen `httpOnly`, `domain`, `path`, `expirationDate`).
   Bo qua ngay neu cookie da mang `sameSite === "no_restriction"` hoac `cause === "overwrite"` de chong vong lap vo tan.
3. **`NotifyRouter`:** Nhan message `CHAT_NOTIFY` tu `FrameAgent`.
   Bo qua neu `dndEnabled === true` hoac user dang focus truc tiep khung do (`diaWindowFocused && workspaceActive && focusedProvider === providerId`).
   Chong trung tin theo khoa `providerId + ":" + (tag || title + "|" + body)` trong cua so `3000ms`.
   Neu `hidePreview === true`, thay `message` bang `"Co tin nhan moi"`.
   Goi `chrome.notifications.create(notifId, { type: "basic", iconUrl, title, message, priority: 2 })`.
   Khi user click banner (`chrome.notifications.onClicked`), focus cua so Dia + active tab Workspace + gui `FOCUS_PROVIDER` de swap khung do len `main` + kich hoat `NOTIFICATION_CLICKED` trong iframe.
4. **`DupTabDetector`:** Theo doi `chrome.tabs` tim tab web roi cua `chat.zalo.me`, `messenger.com`, `web.telegram.org`, `discord.com` mo ngoai Workspace -> bao len Topbar nut 1-click dong tab trung (dac biet quan trong voi Zalo Web von chi cho 1 tab active).

### 3.5. `FrameAgent` (`src/content/`)

Chi chay khi `window !== window.top` (ben trong sub_frame):
- **`notify-hook.main.ts` (`world: "MAIN"`, `run_at: "document_start"`):**
  - Ghi de `window.Notification`: ep `Notification.permission === "granted"`, `Notification.requestPermission()` tra ve `Promise.resolve("granted")`.
  - Khi web app goi `new Notification(title, options)`, luu callback `.onclick` theo `notifToken` va ban `window.postMessage({ source: "dia-main-hook", type: "RAW_NOTIFY", payload })` sang `ISOLATED` world.
  - Bo dieu toc `rAF Governor`: boc `window.requestAnimationFrame`.
    Khi nhan lenh `SET_THROTTLE(true)` (khung dang o slot phu va khong co chuot hover), gom callback rAF chay qua `setTimeout(..., 500)` (~2fps).
    Khi `SET_THROTTLE(false)` (o slot `main` hoac `mouseenter`), goi `origRAF` goc 60fps tuc thi.
- **`frame-agent.isolated.ts` (`world: "ISOLATED"`, `run_at: "document_start"`):**
  - Cau noi `window.postMessage` <-> `chrome.runtime.sendMessage`.
  - **Fallback Unread Observer:** Theo doi `<title>` va selector unread DOM.
    Khi `unreadCount > prevUnreadCount`: cap nhat badge so tren Pane Header ngay, va dat hen `1500ms`.
    Neu trong `1500ms` khong co `RAW_NOTIFY` tu Lop 1, tu ban `CHAT_NOTIFY` fallback de khong sot tin Zalo/Messenger.
  - **Sub-Pane CSS & Media Diet:** Khi o slot `sub-1..3`, gan `<style id="dia-sub-diet">` tat CSS `animation`/`transition`, an sidebar phu (member list Discord, right info Messenger), `pause()` the `<video>` autoplay.

## 4. Data Flow

1. **Swap Khung:** User bam `Alt+2` -> `BentoWorkspace` doi `messenger` sang `data-slot="main"`, khung chinh cu sang `sub-1` -> gui `postMessage({ type: "DIA_SLOT_MODE", isMain })` xuong 2 iframe -> `FrameAgent` bat 60fps tren `messenger` va bat 2fps + CSS diet tren khung vua xuong `sub-1`.
2. **Nhan Tin & Click Banner:** Tin moi den Discord (dang o `sub-3`) -> `new Notification` bi `notify-hook.main.ts` bat -> qua `frame-agent.isolated.ts` -> `ServiceWorker.NotifyRouter` -> `chrome.notifications.create` hien banner macOS -> User click banner -> Dia focus tab Workspace, swap Discord len `main`, goi `onclick()` mo dung kenh chat.
3. **Re-Auth Popup:** User bam `[Re-Auth]` tren Messenger -> Service Worker mo popup `https://www.messenger.com/login` -> User dang nhap/2FA xong dong popup -> `CookieBridge.syncDomains([".facebook.com", ".messenger.com"])` -> gui lenh reload iframe Messenger.

## 5. Error Handling & Edge Cases

- **Zalo bi da session do mo tab ngoai:** `DupTabDetector` hien thanh canh bao vang tren Topbar, 1 click dong tat ca tab chat roi ben ngoai.
- **Messenger E2EE PIN:** Luu ben vung trong IndexedDB partition `(messenger.com, chrome-extension://<id>)`, chi nhap 1 lan dau.
- **macOS tat quyen thong bao cua Dia:** Nut `[Test Notify]` ban banner thu va hien huong dan bat `System Settings -> Notifications -> Dia -> Allow Notifications (Banners)` neu can.
- **Khung bi trang/treo mang:** Nut `↻` reload doc lap tung iframe; nut `⏸` dua iframe ve `about:blank` giai phong 100% RAM tien trinh khi can.

## 6. Testing Strategy

- **Unit Tests (Vitest):**
  - `ProviderRegistry`: test parse unread count tu title/DOM cua ca 4 provider.
  - `CookieBridge`: test bien doi `SameSite` sang `no_restriction` + `secure: true` va chong loop.
  - `NotifyRouter`: test dedup `3000ms`, `DND`, `Hide Preview`, va suppression khi khung dang active.
  - `BentoState`: test hoan doi `data-slot` cho 4 khung, luu/tai ti le `--main-width` va trang thai `paused`.
- **E2E Extension Tests (Playwright Chromium MV3):**
  - Xac minh `framing.json` xoa `X-Frame-Options` & `CSP` tren `sub_frame`.
  - Xac minh swap Bento `Alt+1..4` khong phat sinh reload `<iframe>`.
  - Xac minh `window.Notification` proxy + fallback `<title>` kich hoat `chrome.notifications` va click notification dua provider len slot `main`.
  - Xac minh `rAF Governor` ha khung phu xuong ~2fps va tra ve 60fps khi len `main` hoac `mouseenter`.
