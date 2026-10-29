import type { ProviderId, RuntimeMessage } from '../shared/types';
import { PROVIDERS } from '../providers/registry';
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

const getWorkspaceUrl = () => chrome.runtime.getURL('workspace.html');
const getIconUrl = () => chrome.runtime.getURL('icons/icon-128.png');

const router = new NotifyRouter(
  (id, opts) =>
    new Promise((resolve) => {
      chrome.notifications.create(id, opts, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    }),
  getIconUrl()
);

const reauthWindows = new Map<number, ProviderId>();
let workspaceTabId: number | null = null;
let prefsUpdatedInMemory = false;
let focusUpdatedInMemory = false;
let hydrationPromise: Promise<void> | null = null;

function getSessionStorage(): Pick<chrome.storage.StorageArea, 'get' | 'set'> | null {
  return chrome.storage?.session ?? null;
}

function ensureHydrated(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const session = getSessionStorage();
      if (!session) return;
      try {
        const data = await session.get([SW_PREFS_KEY, SW_FOCUS_KEY, SW_REAUTH_KEY]);
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
      const clearedFocus = { windowFocused: false, focusedProvider: null };
      router.setFocusState(clearedFocus);
      await persistSession({ [SW_FOCUS_KEY]: { ...clearedFocus, tabId: null } });
    }
    await broadcastDupTabs();
  })();
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    await ensureHydrated();
    const providerId = reauthWindows.get(windowId);
    if (!providerId) return;
    reauthWindows.delete(windowId);
    await persistReauthWindows();
    await syncProviderCookies(chrome.cookies, [providerId]);
    await broadcastToWorkspace({ type: 'RELOAD_PROVIDER', providerId });
  })();
});

chrome.notifications.onClicked.addListener((notifId) => {
  chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
  const target = router.parseNotificationClick(notifId);
  void (async () => {
    try {
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
        chrome.tabs.sendMessage(tabId, clickMsg, () => void chrome.runtime.lastError);
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
      sendResponse({ ok: true });
      return false;
    }
    case 'WORKSPACE_FOCUS_STATE': {
      focusUpdatedInMemory = true;
      if (typeof sender.tab?.id === 'number') {
        workspaceTabId = sender.tab.id;
      }
      const nextFocus = {
        windowFocused: rawMsg.windowFocused,
        focusedProvider: rawMsg.focusedProvider
      };
      router.setFocusState(nextFocus);
      void persistSession({ [SW_FOCUS_KEY]: { ...nextFocus, tabId: workspaceTabId } });
      sendResponse({ ok: true });
      return false;
    }
    case 'SYNC_PREFS': {
      prefsUpdatedInMemory = true;
      const nextPrefs = { dnd: rawMsg.prefs.dnd, hidePreview: rawMsg.prefs.hidePreview };
      router.setPrefs(nextPrefs);
      void persistSession({ [SW_PREFS_KEY]: nextPrefs });
      void applyLiteMediaRuleset(rawMsg.prefs.liteMedia);
      sendResponse({ ok: true });
      return false;
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
          title: 'Dia Bento Chat Hub',
          message: 'Thong bao native macOS hoat dong tot!',
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
