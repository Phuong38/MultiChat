import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyRouter, formatNotificationContent } from '../../src/background/notify-router';
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
        message: 'Bạn có tin nhắn mới'
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
        title: 'Discord • #ops',
        message: 'Tin nhắn mới',
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

  it('resolves per-provider 128px brand iconUrl and formats UTF-8 Vietnamese "{Provider} • {Sender}" titles cleanly', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const router = new NotifyRouter(
      create,
      (id) => `chrome-extension://ext-id/icons/provider-${id}-128.png`
    );

    await router.handleIncoming(
      {
        providerId: 'zalo',
        title: '(2) Nguyễn Minh Tuấn',
        body: 'Anh ơi gửi giúp em bản thiết kế nhé!'
      },
      1000
    );
    expect(create).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        iconUrl: 'chrome-extension://ext-id/icons/provider-zalo-128.png',
        title: 'Zalo • Nguyễn Minh Tuấn',
        message: 'Anh ơi gửi giúp em bản thiết kế nhé!'
      })
    );

    // Avoid duplicating provider name when raw title equals provider name ("Telegram" / "Telegram Web")
    await router.handleIncoming(
      {
        providerId: 'telegram',
        title: 'Telegram Web',
        body: 'Bạn có 1 tin nhắn chưa đọc'
      },
      2000
    );
    expect(create).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        iconUrl: 'chrome-extension://ext-id/icons/provider-telegram-128.png',
        title: 'Telegram',
        message: 'Bạn có 1 tin nhắn chưa đọc'
      })
    );

    expect(
      formatNotificationContent('Zalo', 'ZaloPay', 'Thanh toán thành công', false)
    ).toEqual({
      title: 'Zalo • ZaloPay',
      message: 'Thanh toán thành công'
    });
    expect(
      formatNotificationContent('Messenger', '• (9+) Messenger | Nhóm Thiết Kế', '   ', false)
    ).toEqual({
      title: 'Messenger • Nhóm Thiết Kế',
      message: 'Tin nhắn mới'
    });
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
  const onTabActivated = createEventHook<[chrome.tabs.TabActiveInfo]>();
  const onWindowRemoved = createEventHook<[number]>();
  const onWindowFocusChanged = createEventHook<[number]>();
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

  const windowsGet = vi.fn().mockResolvedValue({ id: 1, focused: true });
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
      onClicked: onActionClicked,
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setBadgeTextColor: vi.fn().mockResolvedValue(undefined)
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
      onRemoved: onTabRemoved,
      onActivated: onTabActivated
    },
    windows: {
      WINDOW_ID_NONE: -1,
      get: windowsGet,
      update: windowsUpdate,
      create: windowsCreate,
      onRemoved: onWindowRemoved,
      onFocusChanged: onWindowFocusChanged
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
      onTabActivated,
      onWindowRemoved,
      onWindowFocusChanged,
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
        message: 'Bạn có tin nhắn mới'
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
    expect(env.chromeMock.notifications.create).toHaveBeenLastCalledWith(
      testNotif.notifId,
      expect.objectContaining({
        title: 'Dia MultiChat',
        message: 'Thông báo native macOS hoạt động tốt!'
      }),
      expect.any(Function)
    );

    // Workspace tab 77 reports active focus on discord
    env.chromeMock.tabs.query.mockResolvedValue([
      { id: 77, windowId: 1, active: true, url: 'chrome-extension://ext-id/workspace.html' }
    ]);
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
    env.chromeMock.tabs.query.mockResolvedValue([]);
    env.hooks.onTabRemoved.emit(77);
    const afterClose = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'discord', title: 'Mod', body: 'Hello after close' }
    })) as { notifId: string | null };
    expect(afterClose.notifId).toBeTruthy();
  });

  it('delivers main-pane notifications on tab switch or window blur despite stale WORKSPACE_FOCUS_STATE, isolates reauth cookie errors, rolls back lastError notifications, and queues cold-workspace clicks', async () => {
    const sharedSession: Record<string, unknown> = {};
    const env = createChromeMock(sharedSession);
    let wsTabActive = true;
    let browserWinFocused = true;

    env.chromeMock.tabs.query.mockImplementation(async () => [
      { id: 10, windowId: 1, active: wsTabActive, url: 'chrome-extension://ext-id/workspace.html' }
    ]);
    env.chromeMock.windows.get.mockImplementation(async () => ({
      id: 1,
      focused: browserWinFocused
    }));

    vi.stubGlobal('chrome', env.chromeMock);
    await import('../../src/background/service-worker');

    // Workspace reports windowFocused: true with zalo in slotOrder[0]
    await env.dispatchMessage(
      {
        type: 'WORKSPACE_FOCUS_STATE',
        windowFocused: true,
        focusedProvider: 'zalo'
      },
      { tab: { id: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    const suppressedWhileActive = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'zalo', title: 'Binh', body: 'Still looking', tag: 'z-1' }
    })) as { notifId: string | null };
    expect(suppressedWhileActive.notifId).toBeNull();

    // 1) User switches away from Workspace tab after OOPIF focus (no blur fired on workspace.html)
    wsTabActive = false;
    env.hooks.onTabActivated.emit({ tabId: 99, windowId: 1 });
    const deliveredOnTabSwitch = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'zalo', title: 'Binh', body: 'Switched tab', tag: 'z-2' }
    })) as { notifId: string | null };
    expect(deliveredOnTabSwitch.notifId).toBeTruthy();

    // 2) User switches back to Workspace tab, then Cmd+Tabs to another macOS app (window unfocused)
    wsTabActive = true;
    browserWinFocused = true;
    const suppressedAgain = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'zalo', title: 'Binh', body: 'Back on tab', tag: 'z-3' }
    })) as { notifId: string | null };
    expect(suppressedAgain.notifId).toBeNull();

    browserWinFocused = false;
    env.hooks.onWindowFocusChanged.emit(-1);
    const deliveredOnAppBlur = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId: 'zalo',
        title: 'Binh',
        body: 'Browser unfocused',
        tag: 'z-4',
        notifToken: 'cold-tok-1'
      }
    })) as { notifId: string | null };
    expect(deliveredOnAppBlur.notifId).toBeTruthy();

    // 3) FOCUS_PROVIDER and TOGGLE_MAXIMIZE from iframe content script forward to workspace
    const focusRes = await env.dispatchMessage({
      type: 'FOCUS_PROVIDER',
      providerId: 'telegram'
    });
    expect(focusRes).toEqual({ ok: true });
    expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'FOCUS_PROVIDER',
      providerId: 'telegram'
    });

    const maxRes = await env.dispatchMessage({
      type: 'TOGGLE_MAXIMIZE',
      providerId: 'telegram'
    });
    expect(maxRes).toEqual({ ok: true });
    expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'TOGGLE_MAXIMIZE',
      providerId: 'telegram'
    });

    const maxDefaultRes = await env.dispatchMessage({ type: 'TOGGLE_MAXIMIZE' });
    expect(maxDefaultRes).toEqual({ ok: true });
    expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'TOGGLE_MAXIMIZE'
    });

    const invalidMaxRes = await env.dispatchMessage({
      type: 'TOGGLE_MAXIMIZE',
      providerId: 'invalid' as never
    });
    expect(invalidMaxRes).toEqual({ ok: false });

    // 4) chrome.notifications.create setting runtime.lastError rolls back dedup entry so retry succeeds
    env.chromeMock.notifications.create.mockImplementationOnce((id, _opts, cb) => {
      (env.chromeMock.runtime as { lastError?: { message: string } }).lastError = {
        message: 'Notification center busy'
      };
      cb?.(id);
      (env.chromeMock.runtime as { lastError?: { message: string } }).lastError = undefined;
    });
    const failedNotif = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'discord', title: 'Ops', body: 'Retryable alert', tag: 'd-retry' }
    })) as { notifId: string | null };
    expect(failedNotif.notifId).toBeNull();

    const retriedNotif = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'discord', title: 'Ops', body: 'Retryable alert', tag: 'd-retry' }
    })) as { notifId: string | null };
    expect(retriedNotif.notifId).toBeTruthy();

    // 5) Reauth window close isolates syncProviderCookies error and STILL broadcasts RELOAD_PROVIDER
    await env.dispatchMessage({ type: 'OPEN_REAUTH', providerId: 'telegram' });
    env.chromeMock.cookies.getAll.mockRejectedValueOnce(new Error('Cookie store locked'));
    env.hooks.onWindowRemoved.emit(501);
    await vi.waitFor(() => {
      expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'RELOAD_PROVIDER',
        providerId: 'telegram'
      });
    });

    // 6) Cold-workspace notification click stores pendingClickTarget in session storage for CONSUME_PENDING_CLICK
    env.chromeMock.tabs.query.mockResolvedValue([]);
    env.hooks.onNotificationClicked.emit(deliveredOnAppBlur.notifId!);
    await vi.waitFor(() => {
      expect(env.chromeMock.tabs.create).toHaveBeenCalledWith({
        url: 'chrome-extension://ext-id/workspace.html',
        active: true,
        pinned: true
      });
    });

    // Simulate SW restart before cold-booted workspace tab finishes loading workspace.js
    vi.resetModules();
    const envCold = createChromeMock(sharedSession);
    vi.stubGlobal('chrome', envCold.chromeMock);
    await import('../../src/background/service-worker');

    const consumed1 = await envCold.dispatchMessage({ type: 'CONSUME_PENDING_CLICK' });
    expect(consumed1).toEqual({
      target: {
        providerId: 'zalo',
        notifToken: 'cold-tok-1'
      }
    });
    const consumed2 = await envCold.dispatchMessage({ type: 'CONSUME_PENDING_CLICK' });
    expect(consumed2).toEqual({ target: null });
  });

  it('syncs chrome.action unread badge across providers/pause/SW-restart and updates active focused pane via FRAME_FOCUSED', async () => {
    const sharedSession: Record<string, unknown> = {};
    const env = createChromeMock(sharedSession);
    env.chromeMock.tabs.query.mockResolvedValue([
      { id: 10, windowId: 1, active: true, url: 'chrome-extension://ext-id/workspace.html' }
    ]);
    env.chromeMock.windows.get.mockResolvedValue({ id: 1, focused: true });

    vi.stubGlobal('chrome', env.chromeMock);
    await import('../../src/background/service-worker');

    // Unread updates aggregate onto Dia toolbar action badge
    await env.dispatchMessage({ type: 'UNREAD_UPDATE', providerId: 'zalo', count: 3 });
    await env.dispatchMessage({ type: 'UNREAD_UPDATE', providerId: 'messenger', count: 98 });
    await vi.waitFor(() => {
      expect(env.chromeMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
        color: '#EF4444'
      });
      expect(env.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '99+' });
    });

    // Pausing messenger via SYNC_PREFS zeroes messenger's contribution -> badge drops to '3'
    await env.dispatchMessage({
      type: 'SYNC_PREFS',
      prefs: {
        dnd: false,
        hidePreview: false,
        liteMedia: false,
        paused: { zalo: false, messenger: true, telegram: false, discord: false }
      }
    });
    await vi.waitFor(() => {
      expect(env.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '3' });
    });

    // Zalo starts as focusedProvider ('main'), then user clicks inside sub-pane Telegram (FRAME_FOCUSED)
    await env.dispatchMessage(
      { type: 'WORKSPACE_FOCUS_STATE', windowFocused: true, focusedProvider: 'zalo' },
      { tab: { id: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );
    await env.dispatchMessage({ type: 'FRAME_FOCUSED', providerId: 'telegram' });
    await vi.waitFor(() => {
      expect(env.chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'ACTIVE_PROVIDER_CHANGED',
        providerId: 'telegram'
      });
    });

    // Now incoming Zalo notification MUST NOT be suppressed because user is actually typing in Telegram!
    const zaloNotif = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'zalo', title: 'Tuấn', body: 'Tin mới bên Zalo' }
    })) as { notifId: string | null };
    expect(zaloNotif.notifId).toBeTruthy();
    expect(env.chromeMock.notifications.create).toHaveBeenLastCalledWith(
      zaloNotif.notifId,
      expect.objectContaining({
        iconUrl: 'chrome-extension://ext-id/icons/provider-zalo-128.png',
        title: 'Zalo • Tuấn',
        message: 'Tin mới bên Zalo'
      }),
      expect.any(Function)
    );

    // Meanwhile incoming Telegram notification IS suppressed because user is focused in Telegram
    const tgSuppressed = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'telegram', title: 'Bot', body: 'Đang mở khung này' }
    })) as { notifId: string | null };
    expect(tgSuppressed.notifId).toBeNull();

    // Simulate MV3 service worker cold wake-up where UNREAD_UPDATE arrives BEFORE session.get finishes
    vi.resetModules();
    const envRestart = createChromeMock(sharedSession);
    const rawSessionGet = envRestart.chromeMock.storage.session.get;
    envRestart.chromeMock.storage.session.get = vi.fn(async (keys: string[]) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return rawSessionGet(keys);
    });
    vi.stubGlobal('chrome', envRestart.chromeMock);
    await import('../../src/background/service-worker');

    // Discord reports 4 unreads immediately on cold wake-up; Zalo's 3 unreads and Messenger's paused state must survive!
    await envRestart.dispatchMessage({ type: 'UNREAD_UPDATE', providerId: 'discord', count: 4 });
    expect(envRestart.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '7' });

    // Simulate a second cold wake-up where SYNC_PREFS arrives BEFORE session.get finishes
    vi.resetModules();
    const envRestart2 = createChromeMock(sharedSession);
    const rawSessionGet2 = envRestart2.chromeMock.storage.session.get;
    envRestart2.chromeMock.storage.session.get = vi.fn(async (keys: string[]) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return rawSessionGet2(keys);
    });
    vi.stubGlobal('chrome', envRestart2.chromeMock);
    await import('../../src/background/service-worker');

    await envRestart2.dispatchMessage({
      type: 'SYNC_PREFS',
      prefs: {
        dnd: false,
        hidePreview: false,
        liteMedia: false,
        paused: { zalo: false, messenger: true, telegram: false, discord: true }
      }
    });
    expect(envRestart2.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '3' });

    // Clearing Zalo unreads drops toolbar badge to empty string
    await envRestart2.dispatchMessage({ type: 'UNREAD_UPDATE', providerId: 'zalo', count: 0 });
    expect(envRestart2.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('preserves FIFO focus ordering between FRAME_FOCUSED and WORKSPACE_FOCUS_STATE during cold SW hydration, validates focusedProvider, and swallows badge API rejections', async () => {
    const sharedSession: Record<string, unknown> = {
      __dia_sw_focus: { windowFocused: true, focusedProvider: 'discord', tabId: 10 }
    };
    const env = createChromeMock(sharedSession);
    env.chromeMock.tabs.query.mockResolvedValue([
      { id: 10, windowId: 1, active: true, url: 'chrome-extension://ext-id/workspace.html' }
    ]);
    env.chromeMock.windows.get.mockResolvedValue({ id: 1, focused: true });

    let resolveHydration!: () => void;
    const rawSessionGet = env.chromeMock.storage.session.get;
    env.chromeMock.storage.session.get = vi.fn(async (keys: string[]) => {
      await new Promise<void>((resolve) => {
        resolveHydration = resolve;
      });
      return rawSessionGet(keys);
    });

    vi.stubGlobal('chrome', env.chromeMock);
    await import('../../src/background/service-worker');

    // Back-to-back FRAME_FOCUSED ('telegram') followed by WORKSPACE_FOCUS_STATE ('zalo') while session.get is pending
    const frameFocusedPromise = env.dispatchMessage(
      { type: 'FRAME_FOCUSED', providerId: 'telegram' },
      { tab: { id: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );
    const workspaceFocusPromise = env.dispatchMessage(
      { type: 'WORKSPACE_FOCUS_STATE', windowFocused: true, focusedProvider: 'zalo' },
      { tab: { id: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );

    resolveHydration();
    const [res1, res2] = await Promise.all([frameFocusedPromise, workspaceFocusPromise]);
    expect(res1).toEqual({ ok: true });
    expect(res2).toEqual({ ok: true });

    // 'zalo' arrived second so it MUST win (not clobbered by earlier 'telegram' or stale 'discord')
    const zaloSuppressed = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'zalo', title: 'Zalo Contact', body: 'In focused pane' }
    })) as { notifId: string | null };
    expect(zaloSuppressed.notifId).toBeNull();

    const tgDelivered = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'telegram', title: 'TG Contact', body: 'Should notify' }
    })) as { notifId: string | null };
    expect(tgDelivered.notifId).toBeTruthy();

    // Invalid focusedProvider is sanitized to null
    await env.dispatchMessage(
      {
        type: 'WORKSPACE_FOCUS_STATE',
        windowFocused: true,
        focusedProvider: 'unknown_provider' as never
      },
      { tab: { id: 10 } as chrome.tabs.Tab } as chrome.runtime.MessageSender
    );
    const zaloAfterInvalid = (await env.dispatchMessage({
      type: 'CHAT_NOTIFY',
      payload: { providerId: 'zalo', title: 'Zalo Contact', body: 'No valid focused pane' }
    })) as { notifId: string | null };
    expect(zaloAfterInvalid.notifId).toBeTruthy();

    // Rejected chrome.action badge promises during SW shutdown do not surface as unhandled rejections
    env.chromeMock.action.setBadgeBackgroundColor.mockRejectedValueOnce(new Error('SW shutting down'));
    env.chromeMock.action.setBadgeTextColor.mockRejectedValueOnce(new Error('SW shutting down'));
    env.chromeMock.action.setBadgeText.mockRejectedValueOnce(new Error('SW shutting down'));
    const unreadRes = await env.dispatchMessage({
      type: 'UNREAD_UPDATE',
      providerId: 'zalo',
      count: 5
    });
    expect(unreadRes).toEqual({ ok: true });
  });
});
