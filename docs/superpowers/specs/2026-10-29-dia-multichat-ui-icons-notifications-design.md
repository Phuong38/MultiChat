# Dia Multi-Chat Bento Extension - Phase 2 Design Spec (UI, Icons & Notifications)

**Date:** 2026-10-29
**Target Platform:** Dia Browser (Chromium Manifest V3) on macOS
**Base Commit:** `3294e16` (Phase 1 MVP Live on Dia)

## 1. Problem & Goals

Phase 1 da chay on dinh tren Dia Browser voi 4 khung chat live va tiết kiem RAM.
Trải nghiem thuc te tren Dia lo ro 4 nhom van de can nang cap o Phase 2:
- **Icon:** App icon va notification icon hien chi la o vuong xanh don sac, thieu logo rieng cua Zalo, Messenger, Telegram, Discord va thieu badge dem tin chua doc tren thanh cong cu Dia / tab favicon.
- **UI Workspace:** Thanh Topbar chiem 32px chieu doc co dinh, nhan tieng Viet khong dau, nut chu tho (`Re-Auth`, `Pause`, `Main 60fps`), vach ngan keo tha kho nhan dien, thieu che do Phong to 1 khung (`Maximize 100%`), va nen `#fff` cua iframe gay chop trang khi tai.
- **Chat luong Thong bao macOS:** Banner macOS dung chung icon xanh, fallback notification cua Zalo/Messenger chi bao chu khong dau chung chung ma khong trich xuat ten nguoi gui + noi dung tin nhan, va logic chan thong bao dang gan cung cho khung `main` thay vi khung user thuc su dang go.
- **Nhieu tin tu Chat da tat thong bao (Telegram & cac app):** Tren Telegram WebK, cac nhom/kenh da tat thong báo (muted) van bi dem vao badge chua doc va kich hoat thong bao fallback cua Hub.

Muc tieu Phase 2:
- Thiet ke bo icon Retina sac net (Bento App Icon + 4 Provider Squircle PNG 128px + Inline SVG vector) va dong bo badge chua doc tren thanh cong cu Dia + favicon tab Workspace.
- Nang cap UI theo **Huong A**: Auto-Hide Top Drawer + 28px Matte Pane Header + Tactile Resizable Splitter + Zero-Scroll-Loss Maximize 100% + 100% tieng Viet co dau.
- Hien thi icon rieng tung app + ten nguoi gui & preview tieng Viet co dau tren banner macOS, nhan dien dung khung dang click/go thuc te.
- Loai bo triet de cac hoi thoai/nhom da tat thong bao (muted chats) khoi bo dem unread va luong thong bao tren Telegram cung nhu Zalo, Messenger, Discord.

## 2. Hard Invariants & Non-Goals

- **Giu nguyen `key` co dinh trong `public/manifest.json`:** Tuyet doi khong thay doi Extension ID `ndcplbpbnmkeikikgmpgkaaiefmecmjh` de bao toan toan bo phien dang nhap va IndexedDB (Messenger E2EE PIN, Telegram WebK, Zalo, Discord) user da nap tren Dia.
- **Zero Runtime Bloat:** Khong them React/Vue hay thu vien icon ngoai; toan bo UI giu Vanilla TS + CSS + inline SVG (`<35KB` bundle).
- **Zero Build Dependency Bloat:** Generator PNG icon chay bang Node thuần (`node:zlib`) voi thuat toan 4x4 Supersampled Anti-Aliasing (SSAA), khong cai native binary nhu `canvas` hay `sharp`.

## 3. Architecture & Component Changes

```
scripts/
 ├── icons-gen.mjs            (NEW: 4x4 SSAA vector-to-PNG rasterizer cho App Icon & 4 Provider 128px Icons)
 └── build.mjs                (UPDATED: goi icons-gen.mjs sinh icon-16/32/48/128 + provider-*-128.png)
public/
 ├── manifest.json            (UPDATED: them icon 32px, GIU NGUYEN key RSA)
 ├── workspace.html           (UPDATED: Auto-Hide Top Drawer + Ratio Pill + Tieng Viet UTF-8 + Favicon link)
 └── workspace.css            (UPDATED: Matte Dark Dia theme, 28px header, tactile splitter, maximize overlay)
src/
 ├── shared/types.ts          (UPDATED: WorkspacePrefs.topbarPinned, SYNC_PREFS.paused, FRAME_FOCUSED, ACTIVE_PROVIDER_CHANGED)
 ├── providers/registry.ts    (UPDATED: Muted-chat exclusion + DOM sender/snippet preview extractor)
 ├── background/
 │    ├── notify-router.ts    (UPDATED: Per-provider iconUrl + UTF-8 "{App} • {Sender}" formatting)
 │    └── service-worker.ts   (UPDATED: chrome.action badge counter + live activeProvider focus sync)
 ├── content/
 │    └── frame-agent.isolated.ts (UPDATED: Debounced body observer + preview fallback + pointerdown/focusin)
 └── workspace/
      ├── icons.ts            (NEW: Crisp inline SVG brand logos & 22x22 UI control icons)
      ├── favicon.ts          (NEW: Dynamic 64x64 <canvas> favicon badge renderer)
      ├── bento-state.ts      (UPDATED: topbarPinned, formatRatioLabel, active/maximize helpers)
      └── workspace.ts        (UPDATED: Auto-hide drawer, SVG buttons, Maximize 100%, splitter pill & dblclick)
```

## 4. Detailed Design

### 4.1. Retina Icon System & Live Unread Badges

1. **Build-Time 4x4 SSAA PNG Generator (`scripts/icons-gen.mjs`):**
   - Render Signed-Distance-Field (SDF) squircle + vector shapes o do phan giai gap 4 lan roi downsample trung binh 16 mau/pixel, xuat PNG RGBA 8-bit sac net:
     - `dist/icons/icon-{16,32,48,128}.png`: Squircle nen `#0F131D` vien sang nhe, ben trong la luoi Bento 4 o bo goc theo dung mau Zalo (`#0068FF`), Messenger (gradient `#0099FF -> #A033FF -> #FF5280`), Telegram (`#2AABEE`), Discord (`#5865F2`).
     - `dist/icons/provider-zalo-128.png`: Squircle xanh `#0068FF` voi ky hieu chu `Z` trang sac net.
     - `dist/icons/provider-messenger-128.png`: Squircle gradient Messenger voi tia set trang.
     - `dist/icons/provider-telegram-128.png`: Squircle xanh `#2AABEE` voi may bay giay trang.
     - `dist/icons/provider-discord-128.png`: Squircle tim `#5865F2` voi bieu tuong tay cam Clyde trang.
2. **Inline SVG System (`src/workspace/icons.ts`):**
   - Cung cap SVG DOM helper an toan (khong dung `innerHTML` voi du lieu dong) cho 4 logo hang (`15x15`) va bo icon dieu khien (`maximize`, `restore`, `pause`, `play`, `reload`, `reauth`, `pin`, `bolt`, `eyeOff`, `bellOff`, `bellRing`, `layers`).
3. **Triple-Surface Unread Badge Sync:**
   - **Dia Toolbar Action Badge (`service-worker.ts`):** Luu bang dem `unreadsByProvider` va `pausedByProvider` trong memory + `chrome.storage.session`.
     Moi khi nhan `UNREAD_UPDATE` hoac `SYNC_PREFS` (cap nhat `paused`), tinh tong tin chua doc cua cac khung khong pause:
     - `total > 0`: `chrome.action.setBadgeBackgroundColor({ color: '#EF4444' })`, `chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' })`, `chrome.action.setBadgeText({ text: total > 99 ? '99+' : String(total) })`.
     - `total === 0`: `chrome.action.setBadgeText({ text: '' })`.
   - **Workspace Tab Favicon (`src/workspace/favicon.ts`):** Ve squircle Bento len `<canvas width="64" height="64">`, phu badge tron do `#EF4444` goc phai tren khi `total > 0`, cap nhat `<link id="workspace-favicon" rel="icon">`.
   - **Top Drawer Trigger Pill & Pane Header Badges:** Cap nhat tuc thoi theo cung state `unreads`.

### 4.2. Workspace UI Polish (Approach A)

1. **Auto-Hide Top Drawer (`#topbar-shell`):**
   - Mặc dinh (`prefs.topbarPinned === false`): `#bento-grid` chiem `100vh` (tru `4px` dai cam bien sat mep tren `#topbar-sensor`).
   - Giua mep tren co pill nho `#topbar-pill` hien `Dia MultiChat` kem badge do tong tin chua doc (khi `total === 0` pill thu thanh vach mảnh tinh te, khong che noi dung khung chat).
   - Khi user re chuot vao `#topbar-sensor` / `#topbar-pill`, hoac focus ban phim vao nut trong `#topbar`, hoac khi dang co tab chat trung ben ngoai (`dupTabs.length > 0`), thanh `#topbar` cao `34px` truot muot xuong bang `transform: translateY(0)` (`z-index: 40`).
   - Khi user bam nut **Ghim (`#btn-pin-topbar`)**, `prefs.topbarPinned = true` duoc luu vao `chrome.storage.local`: `#topbar` co dinh o tren va `#bento-grid` cao `calc(100vh - 34px)`.
   - Toan bo nhan nut tren Topbar dung tieng Viet UTF-8 chuan:
     - `Đóng N tab trùng`
     - `Tiết kiệm Media`
     - `Ẩn nội dung`
     - `Không làm phiền`
     - `Thử thông báo`
     - `Ghim thanh công cụ`
2. **28px Matte Pane Header & Dark Iframe Surface:**
   - Moi khung co `.pane-header` cao `28px`, nen `#121622`, vien mảnh `#232A3B`.
   - Khung `main` va khung dang go thuc te (`data-active="true"`) co diem nhan mau rieng (cham sang xanh `#38BDF8` + duong vien duoi sac net).
   - Cum trai (`.pane-title-btn`): Logo SVG hang `15x15` + Ten hang + Badge chua doc + Chip phim tat `⌥1..4` + Cham active focus.
   - Cum phai (`.pane-controls`): 4 nut icon SVG `22x22` kem `title` va `aria-label` tieng Viet co dau:
     1. `Phóng to khung này (Alt+M)` / `Thu về lưới Bento (Esc)`
     2. `Tạm dừng khung (0 MB RAM)` / `Mở lại khung`
     3. `Tải lại khung`
     4. `Đăng nhập lại`
   - Xoa bo hoan toan nhan text ky thuat `Main 60fps` / `Sub 2fps`.
   - Doi `background` cua `.pane-iframe` tu `#fff` sang `#0E121B` de triet tieu hien tuong chop trang khi tai dark mode chat.
   - Man cho `paused-overlay` hien logo SVG hang, dong trang thai `"{Tên app} đang tạm dừng (0 MB RAM)"` va nut `"Mở lại ngay"`.
3. **Zero-Scroll-Loss Maximize 100%:**
   - State tam thoi `maximizedProvider: ProviderId | null` trong `workspace.ts` (khong luu qua lan khoi dong lai de luon mo len o Bento 4 khung quen thuoc).
   - Bat/tat qua nut `⤢` tren header khung, phim tat `Alt+M` (`Option+M` - phong to khung dang active hoac thu nho neu dang phong to), hoac phim `Escape` de thoat Maximize.
   - Click tieu de khung hoac nhan `Alt+1..4` khi dang Maximize: neu chon khung khac thi chuyen Maximize sang khung do + dua len `main`; neu nhan `Escape` hoac bam lai `⤡` thi tra ve Bento 4 khung.
   - **Ky thuat CSS chong mat vi tri cuon:** `#bento-grid` dat `position: relative`.
     Khi `body[data-maximized]` bat, khung `.pane[data-maximized="true"]` dung `position: absolute; inset: 0; z-index: 25` phu kin 100% `#bento-grid` va nhan `DIA_SLOT_MODE { isMain: true }` (`60fps`).
     3 khung con lai giu nguyen kich thuoc grid ben duoi voi `visibility: hidden; pointer-events: none` va `isMain: false` (`2fps`), nho do virtual scroll cua Discord/Telegram/Messenger/Zalo khong bao gio bi co ve `0x0`.
4. **Tactile Resizable Splitter (`#grid-resizer`):**
   - Tang vung bat chuot len `6px` voi thanh grip pill `2px x 28px` o tam, sang mau `#3B82F6` khi hover/keo.
   - Khi dang keo (`body.resizing`), hien thi pill noi `#resize-indicator` o giua man hinh (`Chính 66% • Phụ 34%`).
   - Double-click vao `#grid-resizer` reset `prefs.mainWidthPct` ve `66%` va luu ngay.

### 4.3. Notification Intelligence, Muted-Chat Exclusion & Real Focus Tracking

1. **Per-Provider Brand Icons & UTF-8 Vietnamese Banner Formatting (`NotifyRouter`):**
   - `NotifyRouter` nhan callback `resolveIconUrl: (providerId: ProviderId) => string` tra ve `chrome.runtime.getURL('icons/provider-${providerId}-128.png')`.
   - `TEST_NOTIFY` dung `icons/icon-128.png` (Bento App Icon) voi noi dung `"Thông báo native macOS hoạt động tốt!"`.
   - Ham `formatNotificationText(providerName, rawTitle, rawBody, hidePreview)`:
     - Don sach prefix so dem o dau `rawTitle` (vi du `(3) Nguyễn Minh Tuấn` -> `Nguyễn Minh Tuấn`).
     - Neu `hidePreview === true`: `title = providerName`, `message = 'Bạn có tin nhắn mới'`.
     - Neu `cleanedTitle` rong hoac trung ten app (`Zalo`, `Telegram`, `Telegram Web`, `Messenger`, `Discord`): `title = providerName`.
     - Neu `cleanedTitle` da bat dau bang `${providerName} •` hoac `${providerName} -`: chuan hoa thanh `${providerName} • ${rest}`.
     - Nguoc lai: `title = '${providerName} • ${cleanedTitle}'`.
     - `message = rawBody.trim() || 'Tin nhắn mới'`.
2. **Triet tieu Thong bao & Dem Unread tu Chat da Tat Thong Bao (Muted-Chat Exclusion):**
   - **Nguyen nhan goc tren Telegram:** Telegram WebK gan `.badge-unread` cho ca nhom da tat thong bao (kem `.badge-gray` / `.is-muted` / `.dialog-muted-icon` / `.tgico-mute`) va cho ca tab thu muc (`.menu-horizontal-div`), dong thoi mac dinh Telegram van cong nhom muted vao `document.title`.
     Khi nhom muted co tin moi, Telegram khong goi `new Notification`, nhung Phase 1 dem luon `.badge-gray` / `document.title` nen tang `count` va ban nham thong bao fallback.
   - **Giai phap 3 lop trong `src/providers/registry.ts` va `src/content/frame-agent.isolated.ts`:**
     - **Lop 1 - Loc phan tu Muted & Non-Chat Badges (`isMutedOrIgnoredBadge(providerId, badgeEl)`):**
       - Bo qua badge dang an (`.hide`, `[hidden]`, `aria-hidden="true"` tren container an, hoac `display === 'none'`).
       - Tren **Telegram** (ho tro ca WebK `/k/` va WebA `/a/`):
         - Bo qua moi badge nam trong thanh tab thu muc / filter (`.menu-horizontal-div`, `.tabs-tab`, `#folders-tabs`, `.ChatFolders`, `[class*="Tab"]`) hoac dong Archive (`[data-peer-id="0"]`, `.is-archive`).
         - Bo qua badge co class `.badge-gray`, `.muted`, `.is-muted`.
         - Bo qua dong hoi thoai (`.chatlist-chat`, `.ListItem.Chat`) co class `.is-muted`, `.muted`, hoac chua icon tat chuong (`.dialog-muted-icon`, `.tgico-mute`, `.icon-muted`, `[class*="muted-icon"]`, `[data-icon="mute"]`).
         - Trong moi truong trinh duyet thuc, neu `getComputedStyle(badgeEl).backgroundColor` tra ve mau RGB co `alpha > 0.1` va do bao hoa mau `max(r,g,b) - min(r,g,b) <= 15` (mau xam trung tinh cua muted badge tren moi theme Telegram), lap tuc loai bo.
       - Tren **Zalo, Messenger, Discord:**
         - Tim dong hoi thoai chua badge (`.conv-item`, `.msg-item`, `[role="row"]`, `[role="listitem"]`, `li`, `a`) va loai bo neu dong do co dau hieu muted:
           - Zalo: `.fa-Mute`, `[class*="ic-mute" i]`, `[class*="icon-mute" i]`, `.conv-item__mute`, `[class*="--mute" i]`, `[data-muted="true"]`.
           - Messenger: `[aria-label*="Muted" i]`, `[aria-label*="Đã tắt thông báo" i]`, `[data-testid*="mute" i]`.
           - Discord: `[class*="modeMuted"]`, `[aria-label*="muted" i]`.
     - **Lop 2 - Uu tien Unmuted DOM Count khi danh sach chat da mount (`resolveProviderUnreadCount`):**
       - Ham `hasMountedChatList(providerId, doc)` kiem tra xem danh sach hoi thoai da render trong DOM chua (vi du Telegram co `.chatlist-chat, .ListItem.Chat`).
       - Khi `hasMountedChatList('telegram', doc) === true`, `evaluateUnread()` **chi dung ket qua `extractUnreadFromDom('telegram', doc)`** (da loc sach chat muted), **bo qua `parseUnreadFromTitle`** de tranh viec Telegram cong don kenh muted vao `<title>`.
       - Chi khi danh sach chat chua mount (hoac tren trang mock don gian chi co `<title>`) moi fallback sang `titleCount`.
     - **Lop 3 - Chan Fallback Notification sai tren Telegram:**
       - Vi `UnreadFallbackTracker` chi nhan `unmutedCount`, moi tin nhan do vao nhom/kenh muted tren Telegram giu `unmutedCount` khong doi -> khong tang badge va **khong bao gio** kich hoat `UnreadFallbackTracker`.
3. **DOM Sender & Preview Extractor (`extractUnreadPreviewFromDom`):**
   - Trong `frame-agent.isolated.ts`, tach `MutationObserver` thanh:
     - Observer tuc thoi tren `<head>` / `<title>`.
     - Observer debounce `200ms` tren `document.body` (`childList: true, subtree: true, characterData: true`) de bat ngay tin moi trong sidebar Zalo/Messenger ma khong gay giat CPU.
   - Khi `UnreadFallbackTracker` kich hoat (chi cho tin **chua tat thong bao** ma app khong ban `window.Notification` trong `1200ms`):
     - Goi `extractUnreadPreviewFromDom(providerId, document)`: tim badge chua doc dau tien **khong bi muted**, leo len row hoi thoai, trich xuat `sender` (`.conv-item-title__name`, `.peer-title`, `[data-sender]`, heading/title span) va `snippet` (`.conv-item-body__main`, `.conv-message`, `.dialog-subtitle-span`, `[data-preview]`, subtitle span - loai tru badge so va moc thoi gian).
     - Neu trich xuat duoc: gui `title: sender`, `body: snippet`, `tag: 'fallback-${providerId}-${sender}-${snippet.slice(0, 32)}'`.
     - Neu chi co `sender`: gui `title: sender`, `body: 'Bạn có ${count} tin nhắn chưa đọc'`.
     - Neu DOM dang thu gon/ma hoa chua co text: gui `title: PROVIDERS[providerId].name`, `body: 'Bạn có ${count} tin nhắn chưa đọc'`.
4. **Real Active-Pane Focus Tracking (`FRAME_FOCUSED`):**
   - `frame-agent.isolated.ts` lang nghe `pointerdown` va `focusin` (throttle `800ms`), gui `{ type: 'FRAME_FOCUSED', providerId }` ve Service Worker.
   - `service-worker.ts` cap nhat `currentFocusedProvider = providerId`, dong bo vao `NotifyRouter` + `chrome.storage.session`, va broadcast `{ type: 'ACTIVE_PROVIDER_CHANGED', providerId }` ve `workspace.html` de chuyen cham active xanh sang dung khung user vua click.
   - Tren `workspace.ts`, khi `window` nhan su kien `blur`, kiem tra `document.activeElement`: neu la `pane.iframe` cua 1 provider thi cap nhat ngay `activeProvider` sang provider do va giu `windowFocused = document.visibilityState === 'visible'` (khong bao sai `windowFocused: false` khi focus nhay vao OOPIF con).

## 5. Error Handling & Testing Strategy

- **Unit Tests (Vitest + jsdom):**
  - `tests/unit/icons-gen.test.ts`: Kiem tra PNG signature, kich thuoc IHDR (`16, 32, 48, 128`), do phan biet mau giua 4 icon hang va Bento icon (khong con solid-blue).
  - `tests/unit/registry.test.ts`: Test ky luong **Telegram muted chats** (`.badge-gray`, `.chatlist-chat.is-muted`, `.tgico-mute`, `.dialog-muted-icon`, folder tab `.menu-horizontal-div`, Archive `data-peer-id="0"`, WebA `.ChatBadge.muted`, computed gray RGB) + muted rows tren Zalo/Messenger/Discord + `hasMountedChatList` bo qua `<title>` chua muted count + `extractUnreadPreviewFromDom` tieng Viet UTF-8.
  - `tests/unit/notify-router.test.ts`: Test routing icon rieng `icons/provider-{id}-128.png`, format `{App} • {Người gửi}` tieng Viet co dau, `hidePreview` (`Bạn có tin nhắn mới`), va chan thong bao theo `activeProvider` thuc te (dang go o khung `sub-1` thi tin toi khung `main` van hien banner).
  - `tests/unit/bento-state.test.ts`: Test `topbarPinned`, `formatRatioLabel`, sanitize prefs tuong thich nguoc voi du lieu `dia_bento_prefs_v1` cu tren Dia.
- **End-to-End Tests (Playwright Real Chromium):**
  - Kiem tra pixel-perfection: zero horizontal/vertical overflow, Auto-Hide Top Drawer mo khi hover & co dinh khi ghim, SVG brand icons render dung kich thuoc trong 28px header, Tactile Resizable Splitter keo muot + double-click reset 66%, Maximize 100% phu kin `#bento-grid` khong reload va giu nguyen `scrollTop` cua 3 khung nen, badge `chrome.action.getBadgeText` cap nhat dung va bo qua chat muted tren Telegram!
