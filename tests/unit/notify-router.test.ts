import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyRouter } from '../../src/background/notify-router';
import type { RuntimeMessage } from '../../src/shared/types';

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

  it('deduplicates by tag, avoids duplicate provider title prefix, and notifies when browser window is unfocused', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const router = new NotifyRouter(create, 'icon.png');

    router.setFocusState({ windowFocused: false, focusedProvider: 'discord' });
    const unfocusedId = await router.handleIncoming(
      { providerId: 'discord', title: 'Discord - #ops', body: '', tag: 'thread-1' },
      1000
    );
    expect(unfocusedId).toBeTruthy();
    expect(create).toHaveBeenLastCalledWith(
      unfocusedId,
      expect.objectContaining({
        title: 'Discord - #ops',
        message: 'Tin nhan moi',
        priority: 2
      })
    );

    const sameTagId = await router.handleIncoming(
      { providerId: 'discord', title: 'Discord - #ops', body: 'Updated body', tag: 'thread-1' },
      2000
    );
    expect(sameTagId).toBeNull();

    const distinctTagId = await router.handleIncoming(
      { providerId: 'discord', title: 'Discord - #ops', body: '', tag: 'thread-2' },
      2000
    );
    expect(distinctTagId).toBeTruthy();
  });

  it('recovers click target after MV3 router cold restart and rejects invalid notification IDs', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const routerBeforeSleep = new NotifyRouter(create, 'icon.png');

    const notifId = await routerBeforeSleep.handleIncoming(
      {
        providerId: 'telegram',
        title: 'Ops',
        body: 'Deploy complete',
        notifToken: 'tok:special/1'
      },
      9000
    );
    expect(notifId).toBeTruthy();

    const routerAfterRestart = new NotifyRouter(create, 'icon.png');
    expect(routerAfterRestart.parseNotificationClick(notifId!)).toEqual({
      providerId: 'telegram',
      notifToken: 'tok:special/1'
    });
    expect(routerAfterRestart.parseNotificationClick('dia-chat:zalo:9000:1')).toEqual({
      providerId: 'zalo'
    });
    expect(routerAfterRestart.parseNotificationClick('dia-test:9000')).toBeNull();
    expect(routerAfterRestart.parseNotificationClick('dia-chat:toString:9000:1')).toBeNull();
    expect(routerAfterRestart.parseNotificationClick('dia-chat:unknown:9000:1')).toBeNull();
  });

  it('rolls back dedup fingerprint when createNotification rejects so immediate retry succeeds', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('OS notification failure'))
      .mockResolvedValueOnce(undefined);
    const router = new NotifyRouter(create, 'icon.png');

    await expect(
      router.handleIncoming({ providerId: 'zalo', title: 'A', body: 'Retry me' }, 1000)
    ).rejects.toThrow('OS notification failure');

    const retryId = await router.handleIncoming(
      { providerId: 'zalo', title: 'A', body: 'Retry me' },
      1200
    );
    expect(retryId).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(2);
  });
});

type ListenerFn<T extends unknown[]> = (...args: T) => unknown;

function createEventHook<T extends unknown[]>() {
  const listeners: ListenerFn<T>[] = [];
  return {
    addListener: vi.fn((fn: ListenerFn<T>) => {
      listeners.push(fn);
    }),
    emit: (...args: T) => listeners.map((fn) => fn(...args)),
    listeners
  };
}

function createChromeMock(sharedSessionStore: Record<string, unknown> = {}) {
  const onInstalled = createEventHook<[]>();
  const onStartup = createEventHook<[]>();
  const onActionClicked = createEventHook<[]>();
  const onCookieChanged = createEventHook<
    [{ cookie: chrome.cookies.Cookie; cause: string; removed: boolean }]
  >();
  const onTabUpdated = createEventHook<[number, chrome.tabs.TabChangeInfo]>();
  const onTabRemoved = createEventHook<[number]>();
  const onWindowRemoved = createEventHook<[number]>();
  const onNotificationClicked = createEventHook<[string]>();
  const onMessage = createEventHook<
    [RuntimeMessage, chrome.runtime.MessageSender, (res?: unknown) => void]
  >();

  const notificationsCreate = vi.fn(
    (
      id: string,
      _opts: chrome.notifications.NotificationOptions<true>,
      cb?: (notificationId: string) => void
    ) => {
      cb?.(id);
    }
  );
  const notificationsClear = vi.fn((_id: string, cb?: (wasCleared: boolean) => void) => {
    cb?.(true);
  });

  const tabsQuery = vi.fn().mockResolvedValue([]);
  const tabsUpdate = vi.fn().mockResolvedValue({});
  const tabsCreate = vi.fn().mockResolvedValue({ id: 77 });
  const tabsRemove = vi.fn().mockResolvedValue(undefined);
  const tabsSendMessage = vi.fn(
    (_tabId: number, _msg: RuntimeMessage, cb?: (res?: unknown) => void) => {
      cb?.();
    }
  );

  const windowsUpdate = vi.fn().mockResolvedValue({});
  const windowsCreate = vi.fn().mockResolvedValue({ id: 501 });

  const cookiesGetAll = vi.fn().mockResolvedValue([]);
  const cookiesSet = vi.fn().mockResolvedValue({});
  const updateEnabledRulesets = vi.fn().mockResolvedValue(undefined);
  const runtimeSendMessage = vi.fn().mockResolvedValue(undefined);

  const sessionStorage = {
    get: vi.fn(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in sharedSessionStore) out[k] = sharedSessionStore[k];
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(sharedSessionStore, items);
    })
  };

  const chromeMock = {
    runtime: {
      getURL: (path: string) => `chrome-extension://ext-id/${path}`,
      sendMessage: runtimeSendMessage,
      onInstalled,
      onStartup,
      onMessage,
      lastError: undefined
    },
    action: {
      onClicked: onActionClicked
    },
    cookies: {
      getAll: cookiesGetAll,
      set: cookiesSet,
      onChanged: onCookieChanged
    },
    tabs: {
      query: tabsQuery,
      update: tabsUpdate,
      create: tabsCreate,
      remove: tabsRemove,
      sendMessage: tabsSendMessage,
      onUpdated: onTabUpdated,
      onRemoved: onTabRemoved
    },
    windows: {
      update: windowsUpdate,
      create: windowsCreate,
      onRemoved: onWindowRemoved
    },
    notifications: {
      create: notificationsCreate,
      clear: notificationsClear,
      onClicked: onNotificationClicked
    },
    declarativeNetRequest: {
      updateEnabledRulesets
    },
    storage: {
      session: sessionStorage
    }
  };

  const dispatchMessage = (
    msg: RuntimeMessage,
    sender: chrome.runtime.MessageSender = {} as chrome.runtime.MessageSender
  ): Promise<unknown> =>
    new Promise((resolve) => {
      onMessage.emit(msg, sender, (res) => resolve(res));
    });

  return {
    chromeMock,
    hooks: {
      onInstalled,
      onStartup,
      onActionClicked,
      onCookieChanged,
      onTabUpdated,
      onTabRemoved,
      onWindowRemoved,
      onNotificationClicked,
      onMessage
    },
    dispatchMessage
  };
}

describe('MV3 background service-worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('routes notification clicks, duplicate-tab commands, and preserves prefs + reauth state across SW restart', async () => {
    const sharedSession: Record<string, unknown> = {};

    // First service worker lifecycle
    const env1 = createChromeMock(sharedSession);
    vi.stubGlobal('chrome', env1.chromeMock);
    await import('../../src/background/service-worker');

    const syncRes = await env1.dispatchMessage({
      type: 'SYNC_PREFS',
      prefs: { dnd: false, hidePreview: true, liteMedia: true }
    });
    expect(syncRes).toEqual({ ok: true });
    expect(env1.chromeMock.declarativeNetRequest.updateEnabledRulesets).toHaveBeenCalledWith({
      enableRulesetIds: ['lite_media'],
      disableRulesetIds: []
    });

    const reauthRes = await env1.dispatchMessage({
      type: 'OPEN_REAUTH',
      providerId: 'messenger'
    });
    expect(reauthRes).toEqual({ ok: true });
    expect(env1.chromeMock.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.messenger.com/login/',
        type: 'popup'
      })
    );

    const chatRes1 = (await env1.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId: 'zalo',
        title: 'Alice',
        body: 'Top secret',
        notifToken: 'click-tok-9'
      }
    })) as { notifId: string | null };
    expect(chatRes1.notifId).toBeTruthy();

    // Simulate MV3 service worker termination and cold wake-up
    vi.resetModules();
    const env2 = createChromeMock(sharedSession);
    env2.chromeMock.tabs.query.mockImplementation(async (queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo && queryInfo.url) {
        return [{ id: 15, windowId: 3, url: 'chrome-extension://ext-id/workspace.html' }];
      }
      return [
        { id: 15, url: 'chrome-extension://ext-id/workspace.html' },
        { id: 22, url: 'https://discord.com/channels/@me' }
      ];
    });
    vi.stubGlobal('chrome', env2.chromeMock);
    await import('../../src/background/service-worker');

    // Hydrated hidePreview must mask incoming notification even before workspace re-sends SYNC_PREFS
    const chatRes2 = (await env2.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId: 'telegram',
        title: 'Private Sender',
        body: 'Confidential text'
      }
    })) as { notifId: string | null };
    expect(chatRes2.notifId).toBeTruthy();
    expect(env2.chromeMock.notifications.create).toHaveBeenCalledWith(
      chatRes2.notifId,
      expect.objectContaining({
        title: 'Telegram',
        message: 'Co tin nhan moi'
      }),
      expect.any(Function)
    );

    // Notification created before SW sleep still routes click + notifToken to workspace after restart
    env2.hooks.onNotificationClicked.emit(chatRes1.notifId!);
    await vi.waitFor(() => {
      expect(env2.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
        15,
        {
          type: 'TRIGGER_NOTIFY_CLICK',
          providerId: 'zalo',
          notifToken: 'click-tok-9'
        },
        expect.any(Function)
      );
    });
    expect(env2.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'FOCUS_PROVIDER',
      providerId: 'zalo'
    });

    // Reauth popup opened before SW sleep still syncs cookies and reloads provider when closed
    env2.hooks.onWindowRemoved.emit(501);
    await vi.waitFor(() => {
      expect(env2.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'RELOAD_PROVIDER',
        providerId: 'messenger'
      });
    });

    // Duplicate tab detection and close commands
    const dupRes = await env2.dispatchMessage({ type: 'GET_DUP_TABS' });
    expect(dupRes).toEqual({
      tabs: [{ tabId: 22, providerId: 'discord', url: 'https://discord.com/channels/@me' }]
    });

    const closeRes = await env2.dispatchMessage({ type: 'CLOSE_DUP_TABS' });
    expect(closeRes).toEqual({ closed: 1 });
    expect(env2.chromeMock.tabs.remove).toHaveBeenCalledWith([22]);
  });

  it('clears focus suppression when workspace tab closes and wires lifecycle, cookie, unread, and test-notify events', async () => {
    const env = createChromeMock({});
    vi.stubGlobal('chrome', env.chromeMock);
    await import('../../src/background/service-worker');

    env.hooks.onInstalled.emit();
    expect(env.chromeMock.cookies.getAll).toHaveBeenCalled();

    env.hooks.onActionClicked.emit();
    await vi.waitFor(() => {
      expect(env.chromeMock.tabs.create).toHaveBeenCalledWith({
        url: 'chrome-extension://ext-id/workspace.html',
        active: true,
        pinned: true
      });
    });

    env.hooks.onCookieChanged.emit({
      removed: false,
      cause: 'explicit',
      cookie: {
        name: 'c_user',
        value: '123',
        domain: '.messenger.com',
        hostOnly: false,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        session: false,
        expirationDate: 1900000000,
        storeId: '0'
      }
    });
    expect(env.chromeMock.cookies.set).toHaveBeenCalledTimes(1);

    const unreadRes = await env.dispatchMessage({
      type: 'UNREAD_UPDATE',
      providerId: 'discord',
      count: 4
    });
    expect(unreadRes).toEqual({ ok: true });
    expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'UNREAD_UPDATE',
      providerId: 'discord',
      count: 4
    });

    const testNotif = (await env.dispatchMessage({ type: 'TEST_NOTIFY' })) as { notifId: string };
    expect(testNotif.notifId).toMatch(/^dia-test:/);

    // Workspace tab 77 reports active focus on discord
    await env.dispatchMessage(
      {
        type: 'WORKSPACE_FOCUS_STATE',
        windowFocused: true,
        focusedProvider: 'discord'
      },
      { tab: { id: 77 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    const suppressed = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'discord', title: 'Mod', body: 'Hello' }
    })) as { notifId: string | null };
    expect(suppressed.notifId).toBeNull();

    // Closing workspace tab 77 clears focus suppression so external notifications resume
    env.hooks.onTabRemoved.emit(77);
    const afterClose = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'discord', title: 'Mod', body: 'Hello after close' }
    })) as { notifId: string | null };
    expect(afterClose.notifId).toBeTruthy();
  });
});
