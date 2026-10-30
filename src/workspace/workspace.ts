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
const ALLOW_PERMS =
  'clipboard-read; clipboard-write; microphone; camera; display-capture; publickey-credentials-get';

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
  return document.visibilityState === 'visible' && document.hasFocus();
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

  const syncToggleBtn = (id: string, active: boolean): HTMLElement | null => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    return el;
  };
  syncToggleBtn('btn-lite-media', prefs.liteMedia);
  syncToggleBtn('btn-hide-preview', prefs.hidePreview);
  syncToggleBtn('btn-dnd', prefs.dnd);
  const pinBtn = syncToggleBtn('btn-pin-topbar', prefs.topbarPinned);
  if (pinBtn) {
    const pinLabel = prefs.topbarPinned
      ? 'Bỏ ghim thanh công cụ'
      : 'Ghim cố định thanh công cụ';
    pinBtn.title = pinLabel;
    pinBtn.setAttribute('aria-label', pinLabel);
  }

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
  const totalBadge = document.getElementById('total-unread');
  if (totalBadge) {
    totalBadge.textContent = String(total);
    totalBadge.classList.toggle('hidden', total <= 0);
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
    pane.iframe.setAttribute('sandbox', '');
    pane.iframe.src = 'about:blank';
    pane.pausedOverlay.classList.remove('hidden');
    unreads[providerId] = 0;
    updateUnreadUi();
  } else {
    pane.pausedOverlay.classList.add('hidden');
    pane.iframe.setAttribute('sandbox', SANDBOX_FLAGS);
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

function toggleMaximize(targetProvider?: ProviderId, focusFrame = true): void {
  const candidate = targetProvider ?? activeProvider ?? prefs.slotOrder[0];
  let wasPaused = false;
  if (maximizedProvider === candidate) {
    maximizedProvider = null;
  } else {
    if (prefs.paused[candidate]) {
      wasPaused = true;
      setPausedDom(candidate, false);
      savePrefs();
    }
    maximizedProvider = candidate;
    activeProvider = candidate;
  }
  applyLayout();
  if (focusFrame && maximizedProvider && !prefs.paused[maximizedProvider]) {
    const targetIframe = panes.get(maximizedProvider)?.iframe;
    if (targetIframe && (wasPaused || document.activeElement !== targetIframe)) {
      targetIframe.focus();
    }
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
    maximizeBtn.addEventListener('click', () => toggleMaximize(providerId, false));

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

    const isPaused = prefs.paused[providerId];
    const iframe = document.createElement('iframe');
    iframe.className = 'pane-iframe';
    iframe.setAttribute('sandbox', isPaused ? '' : SANDBOX_FLAGS);
    iframe.setAttribute('allow', ALLOW_PERMS);
    iframe.src = isPaused ? 'about:blank' : resolveEmbedUrl(providerId, testOrigin);
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
  sender?: chrome.runtime.MessageSender,
  sendResponse?: (res?: unknown) => void
): void {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
  if (msg.type === 'UNREAD_UPDATE') {
    if (sender?.tab) return;
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
    if (sender?.tab) return;
    if (Object.hasOwn(PROVIDERS, msg.providerId)) {
      focusProvider(msg.providerId);
    }
  } else if (msg.type === 'TOGGLE_MAXIMIZE') {
    if (sender?.tab) return;
    toggleMaximize(
      msg.providerId && Object.hasOwn(PROVIDERS, msg.providerId) ? msg.providerId : undefined
    );
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

  const topbarShell = document.getElementById('topbar-shell');
  let isTopbarHovered = false;
  const setTopbarHovered = (hovered: boolean): void => {
    if (isTopbarHovered === hovered) return;
    isTopbarHovered = hovered;
    topbarShell?.classList.toggle('is-hovered', hovered);
    if (hovered) {
      const msg: WorkspaceToFrameMessage = {
        source: 'dia-bento-workspace',
        type: 'DIA_TOPBAR_OPEN'
      };
      for (const [id, pane] of panes.entries()) {
        if (!prefs.paused[id]) {
          pane.iframe.contentWindow?.postMessage(msg, '*');
        }
      }
    }
  };
  topbarShell?.addEventListener('mouseenter', () => setTopbarHovered(true), { signal });
  topbarShell?.addEventListener('mousemove', () => setTopbarHovered(true), { signal });
  topbarShell?.addEventListener('mouseleave', () => setTopbarHovered(false), { signal });
  document.documentElement?.addEventListener('mouseleave', () => setTopbarHovered(false), {
    signal
  });
  window.addEventListener(
    'message',
    (ev: MessageEvent) => {
      const data = ev.data as { source?: unknown; type?: unknown } | null;
      if (
        data &&
        typeof data === 'object' &&
        data.source === 'dia-bento-frame' &&
        data.type === 'DIA_FRAME_HOVER' &&
        Array.from(panes.values()).some((p) => p.iframe.contentWindow === ev.source)
      ) {
        setTopbarHovered(false);
      }
    },
    { signal }
  );

  document.getElementById('btn-lite-media')?.addEventListener(
    'click',
    () => {
      prefs.liteMedia = !prefs.liteMedia;
      applyLayout();
      savePrefs();
    },
    { signal }
  );

  document.getElementById('btn-hide-preview')?.addEventListener(
    'click',
    () => {
      prefs.hidePreview = !prefs.hidePreview;
      applyLayout();
      savePrefs();
    },
    { signal }
  );

  document.getElementById('btn-dnd')?.addEventListener(
    'click',
    () => {
      prefs.dnd = !prefs.dnd;
      applyLayout();
      savePrefs();
    },
    { signal }
  );

  document.getElementById('btn-pin-topbar')?.addEventListener(
    'click',
    () => {
      prefs.topbarPinned = !prefs.topbarPinned;
      applyLayout();
      savePrefs();
    },
    { signal }
  );

  document.getElementById('btn-test-notify')?.addEventListener(
    'click',
    () => {
      sendRuntime({ type: 'TEST_NOTIFY' });
    },
    { signal }
  );

  document.getElementById('dup-tabs-btn')?.addEventListener(
    'click',
    () => {
      sendRuntime({ type: 'CLOSE_DUP_TABS' }, () => updateDupTabsBanner([]));
    },
    { signal }
  );

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

  resizer?.addEventListener(
    'dblclick',
    () => {
      prefs.mainWidthPct = 66;
      document.documentElement.style.setProperty('--main-width', '66%');
      savePrefs();
    },
    { signal }
  );

  resizer?.addEventListener(
    'mousedown',
    (startEv) => {
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
    },
    { signal }
  );

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
