import type { PendingClickTarget, ProviderId, RuntimeMessage } from '../shared/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers/registry';
import {
  shouldUpgradeCookie,
  syncProviderCookies,
  toUpgradedCookieSetDetails
} from './cookie-bridge';
import { NotifyRouter } from './notify-router';
import { findExternalProviderTabs, openOrFocusWorkspace } from './tab-coordinator';

const SW_PREFS_KEY = '__dia_sw_prefs';
const SW_FOCUS_KEY = '__dia_sw_focus';
const SW_REAUTH_KEY = '__dia_sw_reauth';
const SW_PENDING_CLICK_KEY = '__dia_sw_pending_click';
const SW_UNREADS_KEY = '__dia_sw_unreads';

const getWorkspaceUrl = () => chrome.runtime.getURL('workspace.html');
const getIconUrl = () => chrome.runtime.getURL('icons/icon-128.png');
const getProviderIconUrl = (providerId: ProviderId) =>
  chrome.runtime.getURL(`icons/provider-${providerId}-128.png`);

const router = new NotifyRouter(
  (id, opts) =>
    new Promise((resolve, reject) => {
      chrome.notifications.create(id, opts, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || 'Failed to create notification'));
          return;
        }
        resolve();
      });
    }),
  getProviderIconUrl
);

const reauthWindows = new Map<number, ProviderId>();
const unreadsByProvider: Record<ProviderId, number> = {
  zalo: 0,
  messenger: 0,
  telegram: 0,
  discord: 0
};
const pausedByProvider: Record<ProviderId, boolean> = {
  zalo: false,
  messenger: false,
  telegram: false,
  discord: false
};
let workspaceTabId: number | null = null;
let currentWindowFocused = false;
let currentFocusedProvider: ProviderId | null = null;
let pendingClickTarget: PendingClickTarget | null = null;
let pendingClickUpdatedInMemory = false;
let prefsUpdatedInMemory = false;
let focusUpdatedInMemory = false;
let unreadsUpdatedInMemory = false;
let hydrationPromise: Promise<void> | null = null;

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
      void Promise.resolve(
        chrome.action?.setBadgeBackgroundColor?.({ color: '#EF4444' })
      ).catch(() => {});
      void Promise.resolve(chrome.action?.setBadgeTextColor?.({ color: '#FFFFFF' })).catch(
        () => {}
      );
    }
    void Promise.resolve(chrome.action?.setBadgeText?.({ text })).catch(() => {});
  } catch {
    // Ignore when action badge API is unavailable
  }
}

function getSessionStorage(): Pick<chrome.storage.StorageArea, 'get' | 'set'> | null {
  return chrome.storage?.session ?? null;
}

function ensureHydrated(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const session = getSessionStorage();
      if (!session) return;
      try {
        const data = await session.get([
          SW_PREFS_KEY,
          SW_FOCUS_KEY,
          SW_REAUTH_KEY,
          SW_PENDING_CLICK_KEY,
          SW_UNREADS_KEY
        ]);
        if (!prefsUpdatedInMemory && data[SW_PREFS_KEY]) {
          const p = data[SW_PREFS_KEY] as { dnd?: unknown; hidePreview?: unknown };
          if (typeof p.dnd === 'boolean' && typeof p.hidePreview === 'boolean') {
            router.setPrefs({ dnd: p.dnd, hidePreview: p.hidePreview });
          }
        }
        if (!focusUpdatedInMemory && data[SW_FOCUS_KEY]) {
          const f = data[SW_FOCUS_KEY] as {
            windowFocused?: unknown;
            focusedProvider?: unknown;
            tabId?: unknown;
          };
          if (typeof f.windowFocused === 'boolean') {
            const focusedProvider =
              typeof f.focusedProvider === 'string' && Object.hasOwn(PROVIDERS, f.focusedProvider)
                ? (f.focusedProvider as ProviderId)
                : null;
            workspaceTabId = typeof f.tabId === 'number' ? f.tabId : null;
            currentWindowFocused = f.windowFocused;
            currentFocusedProvider = focusedProvider;
            router.setFocusState({ windowFocused: f.windowFocused, focusedProvider });
          }
        }
        if (data[SW_REAUTH_KEY] && typeof data[SW_REAUTH_KEY] === 'object') {
          const rawMap = data[SW_REAUTH_KEY] as Record<string, unknown>;
          for (const [winKey, prov] of Object.entries(rawMap)) {
            const winId = Number.parseInt(winKey, 10);
            if (
              Number.isFinite(winId) &&
              typeof prov === 'string' &&
              Object.hasOwn(PROVIDERS, prov) &&
              !reauthWindows.has(winId)
            ) {
              reauthWindows.set(winId, prov as ProviderId);
            }
          }
        }
        if (
          !pendingClickUpdatedInMemory &&
          data[SW_PENDING_CLICK_KEY] &&
          typeof data[SW_PENDING_CLICK_KEY] === 'object'
        ) {
          const rawClick = data[SW_PENDING_CLICK_KEY] as {
            providerId?: unknown;
            notifToken?: unknown;
          };
          if (
            typeof rawClick.providerId === 'string' &&
            Object.hasOwn(PROVIDERS, rawClick.providerId)
          ) {
            pendingClickTarget =
              typeof rawClick.notifToken === 'string' && rawClick.notifToken
                ? {
                    providerId: rawClick.providerId as ProviderId,
                    notifToken: rawClick.notifToken
                  }
                : { providerId: rawClick.providerId as ProviderId };
          }
        }
        if (
          !unreadsUpdatedInMemory &&
          data[SW_UNREADS_KEY] &&
          typeof data[SW_UNREADS_KEY] === 'object'
        ) {
          const rawState = data[SW_UNREADS_KEY] as {
            unreads?: Record<string, unknown>;
            paused?: Record<string, unknown>;
          };
          const rawPaused =
            rawState.paused && typeof rawState.paused === 'object' ? rawState.paused : null;
          const rawUnreads =
            rawState.unreads && typeof rawState.unreads === 'object' ? rawState.unreads : null;
          for (const id of PROVIDER_ORDER) {
            const isPaused = rawPaused ? Boolean(rawPaused[id]) : false;
            pausedByProvider[id] = isPaused;
            const rawCount = rawUnreads ? rawUnreads[id] : 0;
            const sanitizedCount =
              typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0
                ? Math.floor(rawCount)
                : 0;
            unreadsByProvider[id] = isPaused ? 0 : sanitizedCount;
          }
          syncActionBadge();
        }
      } catch {
        // Ignore transient session storage errors
      }
    })();
  }
  return hydrationPromise;
}

async function persistSession(items: Record<string, unknown>): Promise<void> {
  const session = getSessionStorage();
  if (!session) return;
  try {
    await session.set(items);
  } catch {
    // Ignore transient session storage errors
  }
}

async function persistReauthWindows(): Promise<void> {
  const serialized: Record<string, ProviderId> = {};
  for (const [winId, providerId] of reauthWindows.entries()) {
    serialized[String(winId)] = providerId;
  }
  await persistSession({ [SW_REAUTH_KEY]: serialized });
}

async function setWindowFocusedState(windowFocused: boolean): Promise<void> {
  focusUpdatedInMemory = true;
  currentWindowFocused = windowFocused;
  const nextFocus = {
    windowFocused: currentWindowFocused,
    focusedProvider: currentFocusedProvider
  };
  router.setFocusState(nextFocus);
  await persistSession({ [SW_FOCUS_KEY]: { ...nextFocus, tabId: workspaceTabId } });
}

async function refreshLiveFocusState(): Promise<void> {
  if (typeof chrome.tabs?.query !== 'function' || typeof chrome.windows?.get !== 'function') {
    return;
  }
  try {
    const wsTabs = await chrome.tabs.query({ url: `${getWorkspaceUrl()}*` });
    let isWorkspaceActivelyViewed = false;
    for (const tab of wsTabs) {
      if (tab.active && typeof tab.windowId === 'number' && tab.windowId >= 0) {
        const win = await chrome.windows.get(tab.windowId);
        if (win?.focused) {
          isWorkspaceActivelyViewed = true;
          if (typeof tab.id === 'number') {
            workspaceTabId = tab.id;
          }
          break;
        }
      }
    }
    if (isWorkspaceActivelyViewed !== currentWindowFocused) {
      await setWindowFocusedState(isWorkspaceActivelyViewed);
    } else {
      router.setFocusState({
        windowFocused: isWorkspaceActivelyViewed,
        focusedProvider: currentFocusedProvider
      });
    }
  } catch {
    // Fall back cleanly to reported focus state if tab/window query fails
  }
}

async function applyLiteMediaRuleset(enabled: boolean): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? ['lite_media'] : [],
      disableRulesetIds: enabled ? [] : ['lite_media']
    });
  } catch {
    // Ignore transient DNR update collisions
  }
}

async function broadcastToWorkspace(msg: RuntimeMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // Workspace tab not open right now
  }
}

async function broadcastDupTabs(): Promise<void> {
  try {
    const allTabs = await chrome.tabs.query({});
    const dups = findExternalProviderTabs(allTabs, getWorkspaceUrl());
    await broadcastToWorkspace({ type: 'DUP_TABS_CHANGED', tabs: dups });
  } catch {
    // Ignore transient tab query errors
  }
}

void ensureHydrated();

chrome.runtime.onInstalled.addListener(() => {
  void syncProviderCookies(chrome.cookies).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void syncProviderCookies(chrome.cookies).catch(() => {});
});

chrome.action.onClicked.addListener(() => {
  void openOrFocusWorkspace(chrome.tabs, chrome.windows, getWorkspaceUrl()).catch(() => {});
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

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await ensureHydrated();
    if (workspaceTabId !== null && tabId === workspaceTabId) {
      workspaceTabId = null;
      focusUpdatedInMemory = true;
      currentWindowFocused = false;
      currentFocusedProvider = null;
      const clearedFocus = { windowFocused: false, focusedProvider: null };
      router.setFocusState(clearedFocus);
      await persistSession({ [SW_FOCUS_KEY]: { ...clearedFocus, tabId: null } });
    }
    await broadcastDupTabs();
  })();
});

chrome.tabs?.onActivated?.addListener(() => {
  void (async () => {
    await ensureHydrated();
    await refreshLiveFocusState();
  })();
});

chrome.windows?.onFocusChanged?.addListener((windowId) => {
  void (async () => {
    await ensureHydrated();
    const noneId = chrome.windows?.WINDOW_ID_NONE ?? -1;
    if (windowId === noneId) {
      await setWindowFocusedState(false);
      return;
    }
    await refreshLiveFocusState();
  })();
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    await ensureHydrated();
    const providerId = reauthWindows.get(windowId);
    if (!providerId) return;
    reauthWindows.delete(windowId);
    await persistReauthWindows();
    try {
      await syncProviderCookies(chrome.cookies, [providerId]);
    } catch {
      // Isolate cookie sync errors so provider reload always runs
    }
    await broadcastToWorkspace({ type: 'RELOAD_PROVIDER', providerId });
  })();
});

chrome.notifications.onClicked.addListener((notifId) => {
  chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
  const target = router.parseNotificationClick(notifId);
  void (async () => {
    try {
      await ensureHydrated();
      if (target) {
        const nextPending: PendingClickTarget =
          target.notifToken !== undefined
            ? { providerId: target.providerId, notifToken: target.notifToken }
            : { providerId: target.providerId };
        pendingClickUpdatedInMemory = true;
        pendingClickTarget = nextPending;
        await persistSession({ [SW_PENDING_CLICK_KEY]: nextPending });
      }
      const tabId = await openOrFocusWorkspace(chrome.tabs, chrome.windows, getWorkspaceUrl());
      if (!target) return;
      await broadcastToWorkspace({ type: 'FOCUS_PROVIDER', providerId: target.providerId });
      if (tabId >= 0) {
        const clickMsg: RuntimeMessage =
          target.notifToken !== undefined
            ? {
                type: 'TRIGGER_NOTIFY_CLICK',
                providerId: target.providerId,
                notifToken: target.notifToken
              }
            : {
                type: 'TRIGGER_NOTIFY_CLICK',
                providerId: target.providerId
              };
        chrome.tabs.sendMessage(tabId, clickMsg, (res) => {
          void chrome.runtime.lastError;
          if (
            res &&
            typeof res === 'object' &&
            (res as { handled?: unknown }).handled === true &&
            pendingClickTarget?.providerId === target.providerId &&
            pendingClickTarget?.notifToken === target.notifToken
          ) {
            pendingClickUpdatedInMemory = true;
            pendingClickTarget = null;
            void persistSession({ [SW_PENDING_CLICK_KEY]: null });
          }
        });
      }
    } catch {
      // Ignore transient tab focus errors
    }
  })();
});

chrome.runtime.onMessage.addListener((rawMsg: RuntimeMessage, sender, sendResponse) => {
  if (!rawMsg || typeof rawMsg !== 'object' || !('type' in rawMsg)) {
    return false;
  }
  switch (rawMsg.type) {
    case 'CHAT_NOTIFY': {
      void (async () => {
        try {
          await ensureHydrated();
          await refreshLiveFocusState();
          const notifId = await router.handleIncoming(rawMsg.payload);
          sendResponse({ notifId });
        } catch {
          sendResponse({ notifId: null });
        }
      })();
      return true;
    }
    case 'UNREAD_UPDATE': {
      void broadcastToWorkspace(rawMsg);
      void (async () => {
        try {
          await ensureHydrated();
          if (Object.hasOwn(PROVIDERS, rawMsg.providerId)) {
            const nextCount =
              typeof rawMsg.count === 'number' &&
              Number.isFinite(rawMsg.count) &&
              rawMsg.count > 0
                ? Math.floor(rawMsg.count)
                : 0;
            unreadsUpdatedInMemory = true;
            unreadsByProvider[rawMsg.providerId] = pausedByProvider[rawMsg.providerId]
              ? 0
              : nextCount;
            syncActionBadge();
            await persistSession({
              [SW_UNREADS_KEY]: {
                unreads: { ...unreadsByProvider },
                paused: { ...pausedByProvider }
              }
            });
          }
        } finally {
          sendResponse({ ok: true });
        }
      })();
      return true;
    }
    case 'FOCUS_PROVIDER': {
      if (!Object.hasOwn(PROVIDERS, rawMsg.providerId)) {
        sendResponse({ ok: false });
        return false;
      }
      void broadcastToWorkspace({ type: 'FOCUS_PROVIDER', providerId: rawMsg.providerId });
      sendResponse({ ok: true });
      return false;
    }
    case 'TOGGLE_MAXIMIZE': {
      if (
        rawMsg.providerId !== undefined &&
        (typeof rawMsg.providerId !== 'string' || !Object.hasOwn(PROVIDERS, rawMsg.providerId))
      ) {
        sendResponse({ ok: false });
        return false;
      }
      void broadcastToWorkspace(
        rawMsg.providerId !== undefined
          ? { type: 'TOGGLE_MAXIMIZE', providerId: rawMsg.providerId }
          : { type: 'TOGGLE_MAXIMIZE' }
      );
      sendResponse({ ok: true });
      return false;
    }
    case 'CONSUME_PENDING_CLICK': {
      void (async () => {
        try {
          await ensureHydrated();
          const target = pendingClickTarget;
          pendingClickUpdatedInMemory = true;
          pendingClickTarget = null;
          await persistSession({ [SW_PENDING_CLICK_KEY]: null });
          sendResponse({ target });
        } catch {
          sendResponse({ target: null });
        }
      })();
      return true;
    }
    case 'WORKSPACE_FOCUS_STATE': {
      const validProvider =
        typeof rawMsg.focusedProvider === 'string' &&
        Object.hasOwn(PROVIDERS, rawMsg.focusedProvider)
          ? rawMsg.focusedProvider
          : null;
      const validWindowFocused = Boolean(rawMsg.windowFocused);
      void (async () => {
        try {
          await ensureHydrated();
          focusUpdatedInMemory = true;
          if (typeof sender.tab?.id === 'number') {
            workspaceTabId = sender.tab.id;
          }
          currentWindowFocused = validWindowFocused;
          currentFocusedProvider = validProvider;
          const nextFocus = {
            windowFocused: currentWindowFocused,
            focusedProvider: currentFocusedProvider
          };
          router.setFocusState(nextFocus);
          await persistSession({ [SW_FOCUS_KEY]: { ...nextFocus, tabId: workspaceTabId } });
        } finally {
          sendResponse({ ok: true });
        }
      })();
      return true;
    }
    case 'SYNC_PREFS': {
      prefsUpdatedInMemory = true;
      const nextPrefs = { dnd: rawMsg.prefs.dnd, hidePreview: rawMsg.prefs.hidePreview };
      router.setPrefs(nextPrefs);
      void applyLiteMediaRuleset(rawMsg.prefs.liteMedia);
      void (async () => {
        try {
          await ensureHydrated();
          await persistSession({ [SW_PREFS_KEY]: nextPrefs });
          if (rawMsg.prefs.paused && typeof rawMsg.prefs.paused === 'object') {
            unreadsUpdatedInMemory = true;
            for (const id of PROVIDER_ORDER) {
              pausedByProvider[id] = Boolean(rawMsg.prefs.paused[id]);
              if (pausedByProvider[id]) {
                unreadsByProvider[id] = 0;
              }
            }
            syncActionBadge();
            await persistSession({
              [SW_UNREADS_KEY]: {
                unreads: { ...unreadsByProvider },
                paused: { ...pausedByProvider }
              }
            });
          }
        } finally {
          sendResponse({ ok: true });
        }
      })();
      return true;
    }
    case 'FRAME_FOCUSED': {
      if (!Object.hasOwn(PROVIDERS, rawMsg.providerId)) {
        sendResponse({ ok: false });
        return false;
      }
      void (async () => {
        try {
          await ensureHydrated();
          focusUpdatedInMemory = true;
          if (typeof sender.tab?.id === 'number') {
            workspaceTabId = sender.tab.id;
          }
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
        } finally {
          sendResponse({ ok: true });
        }
      })();
      return true;
    }
    case 'OPEN_REAUTH': {
      if (!Object.hasOwn(PROVIDERS, rawMsg.providerId)) {
        sendResponse({ ok: false });
        return false;
      }
      const cfg = PROVIDERS[rawMsg.providerId];
      void (async () => {
        try {
          await ensureHydrated();
          const win = await chrome.windows.create({
            url: cfg.loginUrl,
            type: 'popup',
            width: 520,
            height: 680,
            focused: true
          });
          if (typeof win?.id === 'number') {
            reauthWindows.set(win.id, rawMsg.providerId);
            await persistReauthWindows();
          }
          sendResponse({ ok: true });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }
    case 'TEST_NOTIFY': {
      chrome.notifications.create(
        `dia-test:${Date.now()}`,
        {
          type: 'basic',
          iconUrl: getIconUrl(),
          title: 'MultiChat Hub',
          message: 'Thông báo native macOS hoạt động tốt!',
          priority: 2
        },
        (id) => {
          void chrome.runtime.lastError;
          sendResponse({ notifId: id });
        }
      );
      return true;
    }
    case 'GET_DUP_TABS': {
      void chrome.tabs
        .query({})
        .then((allTabs) => {
          sendResponse({ tabs: findExternalProviderTabs(allTabs, getWorkspaceUrl()) });
        })
        .catch(() => {
          sendResponse({ tabs: [] });
        });
      return true;
    }
    case 'CLOSE_DUP_TABS': {
      void chrome.tabs
        .query({})
        .then(async (allTabs) => {
          const dups = findExternalProviderTabs(allTabs, getWorkspaceUrl());
          if (dups.length > 0) {
            await chrome.tabs.remove(dups.map((d) => d.tabId));
          }
          sendResponse({ closed: dups.length });
        })
        .catch(() => {
          sendResponse({ closed: 0 });
        });
      return true;
    }
    default:
      return false;
  }
});
