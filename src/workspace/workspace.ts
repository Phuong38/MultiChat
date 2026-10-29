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
  formatWorkspaceTitle,
  resolveEmbedUrl,
  sanitizeWorkspacePrefs,
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
const lifecycle = new AbortController();

let prefs: WorkspacePrefs = sanitizeWorkspacePrefs(null);
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
  } catch {
    prefs = sanitizeWorkspacePrefs(null);
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
    windowFocused: document.visibilityState === 'visible' && document.hasFocus(),
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

function setPausedDom(providerId: ProviderId, paused: boolean): void {
  const pane = panes.get(providerId);
  if (!pane) return;
  prefs.paused[providerId] = paused;
  if (paused) {
    pane.iframe.src = 'about:blank';
    pane.pausedOverlay.classList.remove('hidden');
    pane.pauseBtn.textContent = 'Resume';
    unreads[providerId] = 0;
    updateUnreadUi();
  } else {
    pane.pausedOverlay.classList.add('hidden');
    pane.pauseBtn.textContent = 'Pause';
    pane.iframe.src = resolveEmbedUrl(providerId, testOrigin);
  }
}

function focusProvider(providerId: ProviderId): void {
  if (prefs.paused[providerId]) {
    setPausedDom(providerId, false);
  }
  prefs.slotOrder = swapProviderToMain(prefs.slotOrder, providerId);
  applyLayout();
  savePrefs();
  if (!prefs.paused[providerId]) {
    panes.get(providerId)?.iframe.focus();
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
      const digit = extractAltShortcutDigit(ev);
      if (digit !== null) {
        ev.preventDefault();
        const target = PROVIDER_ORDER[digit - 1];
        if (target) focusProvider(target);
      }
    },
    { signal }
  );

  window.addEventListener('focus', () => applyLayout(), { signal });
  window.addEventListener('blur', () => applyLayout(), { signal });
  document.addEventListener('visibilitychange', () => applyLayout(), { signal });

  const resizer = document.getElementById('grid-resizer');
  resizer?.addEventListener('mousedown', (startEv) => {
    startEv.preventDefault();
    document.body.classList.add('resizing');
    let ended = false;
    const onMove = (moveEv: MouseEvent) => {
      if (window.innerWidth <= 0) return;
      const pct = (moveEv.clientX / window.innerWidth) * 100;
      prefs.mainWidthPct = clampMainWidth(pct);
      document.documentElement.style.setProperty('--main-width', `${prefs.mainWidthPct}%`);
    };
    const onUp = () => {
      if (ended) return;
      ended = true;
      document.body.classList.remove('resizing');
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
