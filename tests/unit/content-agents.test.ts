// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://web.telegram.org/k/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNotificationHook, installRafGovernor } from '../../src/content/raf-governor';
import { UnreadFallbackTracker, syncSubPaneDiet } from '../../src/content/unread-observer';
import type { RuntimeMessage } from '../../src/shared/types';

describe('MAIN world hooks (Notification & rAF Governor)', () => {
  let savedNotification: typeof window.Notification;
  let savedRaf: typeof window.requestAnimationFrame;
  let savedCaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    savedNotification = window.Notification;
    savedRaf = window.requestAnimationFrame;
    savedCaf = window.cancelAnimationFrame;
  });

  afterEach(() => {
    window.requestAnimationFrame = savedRaf;
    window.cancelAnimationFrame = savedCaf;
    Object.defineProperty(window, 'Notification', {
      value: savedNotification,
      configurable: true,
      writable: true
    });
    vi.useRealTimers();
  });

  it('intercepts window.Notification, forces granted permission, and routes click callbacks by token', async () => {
    const events: Array<{ title: string; body: string; tag?: string; notifToken: string }> = [];
    const hook = installNotificationHook(window, (ev) => events.push(ev));

    expect(window.Notification.permission).toBe('granted');
    const permCb = vi.fn();
    await expect(window.Notification.requestPermission(permCb)).resolves.toBe('granted');
    expect(permCb).toHaveBeenCalledWith('granted');

    const instance = new window.Notification('Tran B', { body: 'Gui file hop dong', tag: 't1' });
    const onClick = vi.fn();
    const onClickListener = vi.fn();
    const onClose = vi.fn();
    instance.onclick = onClick;
    instance.addEventListener('click', onClickListener);
    instance.onclose = onClose;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: 'Tran B', body: 'Gui file hop dong', tag: 't1' });

    const clicked = hook.triggerClick(events[0]!.notifToken);
    expect(clicked).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClickListener).toHaveBeenCalledTimes(1);
    expect(hook.triggerClick('nt-missing')).toBe(false);

    instance.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('caps stored Notification instances at 50 FIFO entries', () => {
    const tokens: string[] = [];
    const hook = installNotificationHook(window, (ev) => tokens.push(ev.notifToken));

    for (let i = 0; i < 52; i += 1) {
      const n = new window.Notification(`User ${i}`, { body: `Msg ${i}` });
      n.onclick = vi.fn();
    }

    expect(tokens).toHaveLength(52);
    expect(hook.triggerClick(tokens[0]!)).toBe(false);
    expect(hook.triggerClick(tokens[1]!)).toBe(false);
    expect(hook.triggerClick(tokens[2]!)).toBe(true);
    expect(hook.triggerClick(tokens[51]!)).toBe(true);
  });

  it('throttles requestAnimationFrame to 500ms (~2fps) when throttled, cancels cleanly, and restores native speed when unthrottled', () => {
    let nativeCalls = 0;
    const cancelledNativeHandles: number[] = [];
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      nativeCalls += 1;
      return window.setTimeout(() => cb(16), 16);
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
      cancelledNativeHandles.push(handle);
      window.clearTimeout(handle);
    }) as typeof window.cancelAnimationFrame;

    const gov = installRafGovernor(window, 500);
    expect(gov.isThrottled()).toBe(false);
    gov.setThrottled(true);
    expect(gov.isThrottled()).toBe(true);

    const tick = vi.fn();
    window.requestAnimationFrame(tick);
    vi.advanceTimersByTime(100);
    expect(tick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(420);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(nativeCalls).toBe(0);

    const cancelledTick = vi.fn();
    const throttledHandle = window.requestAnimationFrame(cancelledTick);
    vi.advanceTimersByTime(200);
    window.cancelAnimationFrame(throttledHandle);
    vi.advanceTimersByTime(500);
    expect(cancelledTick).not.toHaveBeenCalled();
    expect(cancelledNativeHandles).toHaveLength(0);

    // Pending throttled callback flushes immediately via native rAF (<16ms) when unthrottled
    const flushedTick = vi.fn();
    window.requestAnimationFrame(flushedTick);
    vi.advanceTimersByTime(50);
    expect(flushedTick).not.toHaveBeenCalled();

    gov.setThrottled(false);
    expect(gov.isThrottled()).toBe(false);
    expect(nativeCalls).toBe(1);
    vi.advanceTimersByTime(16);
    expect(flushedTick).toHaveBeenCalledTimes(1);

    window.requestAnimationFrame(tick);
    vi.advanceTimersByTime(20);
    expect(nativeCalls).toBe(2);
    expect(tick).toHaveBeenCalledTimes(2);

    const nativeCancelTick = vi.fn();
    const nativeHandle = window.requestAnimationFrame(nativeCancelTick);
    window.cancelAnimationFrame(nativeHandle);
    vi.advanceTimersByTime(50);
    expect(nativeCancelTick).not.toHaveBeenCalled();
    expect(cancelledNativeHandles).toEqual([nativeHandle]);
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

  it('suppresses duplicate fallback when RAW_NOTIFY precedes delayed unread DOM bump and cancels on zero or dispose', () => {
    const onFallback = vi.fn();
    const tracker = new UnreadFallbackTracker(1500, onFallback);

    // RAW_NOTIFY arrives 2500ms before 3000ms DOM unread poll catches badge update -> suppressed!
    tracker.onRawNotify();
    vi.advanceTimersByTime(2500);
    tracker.onUnreadCount(1);
    vi.advanceTimersByTime(1500);
    expect(onFallback).not.toHaveBeenCalled();

    // Next independent unread rise without RAW_NOTIFY still fires fallback
    tracker.onUnreadCount(2);
    vi.advanceTimersByTime(400);
    // User reads everything before 1500ms expires -> no stale fallback
    tracker.onUnreadCount(0);
    vi.advanceTimersByTime(1500);
    expect(onFallback).not.toHaveBeenCalled();

    // Dispose cancels pending fallback timer
    tracker.onUnreadCount(4);
    vi.advanceTimersByTime(300);
    tracker.dispose();
    vi.advanceTimersByTime(1500);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('injects and removes sub-pane diet stylesheet cleanly and pauses playing videos', () => {
    const video = document.createElement('video');
    let isPaused = false;
    Object.defineProperty(video, 'paused', {
      get: () => isPaused,
      configurable: true
    });
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {
      isPaused = true;
    });
    document.body.appendChild(video);

    syncSubPaneDiet(document, '.sidebar { display: none !important; }', true);
    expect(document.getElementById('dia-sub-diet')?.textContent).toContain('display: none');
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    syncSubPaneDiet(document, '.sidebar { display: none !important; }', false);
    expect(document.getElementById('dia-sub-diet')).toBeNull();
  });
});

describe('Content script entrypoints (notify-hook.main & frame-agent.isolated)', () => {
  let savedNotification: typeof window.Notification;
  let savedRaf: typeof window.requestAnimationFrame;
  let savedCaf: typeof window.cancelAnimationFrame;
  const initialTopDescriptor = Object.getOwnPropertyDescriptor(window, 'top');
  const initialParentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
  const initialReadyStateDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');
  const initialAncestorOriginsDescriptor = Object.getOwnPropertyDescriptor(
    window.location,
    'ancestorOrigins'
  );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    savedNotification = window.Notification;
    savedRaf = window.requestAnimationFrame;
    savedCaf = window.cancelAnimationFrame;
    document.title = 'Telegram';
    document.head.innerHTML = '<title>Telegram</title>';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    window.requestAnimationFrame = savedRaf;
    window.cancelAnimationFrame = savedCaf;
    Object.defineProperty(window, 'Notification', {
      value: savedNotification,
      configurable: true,
      writable: true
    });
    if (initialTopDescriptor) {
      Object.defineProperty(window, 'top', initialTopDescriptor);
    }
    if (initialParentDescriptor) {
      Object.defineProperty(window, 'parent', initialParentDescriptor);
    }
    if (initialAncestorOriginsDescriptor) {
      Object.defineProperty(window.location, 'ancestorOrigins', initialAncestorOriginsDescriptor);
    } else {
      Reflect.deleteProperty(window.location, 'ancestorOrigins');
    }
    if (initialReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', initialReadyStateDescriptor);
    } else {
      Reflect.deleteProperty(document, 'readyState');
    }
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
  });

  it('does nothing on normal top-level tabs when window === window.top', async () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { id: 'dia-ext-id', sendMessage, lastError: undefined }
    });

    await import('../../src/content/notify-hook.main');
    await import('../../src/content/frame-agent.isolated');

    expect(window.Notification).toBe(savedNotification);
    expect(window.requestAnimationFrame).toBe(savedRaf);
    expect(document.getElementById('dia-sub-diet')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing inside grandchild sub-iframes when window.parent !== window.top', async () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { id: 'dia-ext-id', sendMessage, lastError: undefined }
    });

    Object.defineProperty(window, 'top', {
      value: {} as Window,
      configurable: true
    });
    Object.defineProperty(window, 'parent', {
      value: {} as Window,
      configurable: true
    });

    await import('../../src/content/notify-hook.main');
    await import('../../src/content/frame-agent.isolated');

    expect(window.Notification).toBe(savedNotification);
    expect(window.requestAnimationFrame).toBe(savedRaf);
    expect(document.getElementById('dia-sub-diet')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing inside third-party web embeds when ancestorOrigins is not the extension origin', async () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { id: 'dia-ext-id', sendMessage, lastError: undefined }
    });

    const fakeTop = {} as Window;
    Object.defineProperty(window, 'top', {
      value: fakeTop,
      configurable: true
    });
    Object.defineProperty(window, 'parent', {
      value: fakeTop,
      configurable: true
    });
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: ['https://example.com'] as unknown as DOMStringList,
      configurable: true
    });

    await import('../../src/content/notify-hook.main');
    await import('../../src/content/frame-agent.isolated');

    expect(window.Notification).toBe(savedNotification);
    expect(window.requestAnimationFrame).toBe(savedRaf);
    expect(document.getElementById('dia-sub-diet')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();

    // Also reject another extension's origin in frame-agent.isolated when chrome.runtime.id is present
    vi.resetModules();
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: ['chrome-extension://other-ext-id'] as unknown as DOMStringList,
      configurable: true
    });
    await import('../../src/content/frame-agent.isolated');
    expect(document.getElementById('dia-sub-diet')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('bridges MAIN and ISOLATED worlds inside an iframe across DOMContentLoaded, slot mode, hover, notifications, and unread polling', async () => {
    const sentMessages: RuntimeMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'dia-ext-id',
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: () => void) => {
          sentMessages.push(msg);
          cb?.();
        }),
        lastError: undefined
      }
    });

    const parentPostSpy = vi.fn();
    const fakeWorkspaceWin = { postMessage: parentPostSpy } as unknown as Window;
    Object.defineProperty(window, 'top', {
      value: fakeWorkspaceWin,
      configurable: true
    });
    Object.defineProperty(window, 'parent', {
      value: fakeWorkspaceWin,
      configurable: true
    });
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: ['chrome-extension://dia-ext-id'] as unknown as DOMStringList,
      configurable: true
    });
    Object.defineProperty(document, 'readyState', {
      value: 'loading',
      configurable: true
    });

    let nativeRafCount = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      nativeRafCount += 1;
      return window.setTimeout(() => cb(16), 16);
    }) as typeof window.requestAnimationFrame;

    await import('../../src/content/notify-hook.main');
    await import('../../src/content/frame-agent.isolated');

    // Fire DOMContentLoaded: telegram defaults to sub-pane (throttled rAF + diet CSS + initial unread 0)
    Object.defineProperty(document, 'readyState', {
      value: 'interactive',
      configurable: true
    });
    window.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.getElementById('dia-sub-diet')).not.toBeNull();
    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 0
    });

    // Sub-pane rAF is throttled to 500ms
    const rafCb = vi.fn();
    window.requestAnimationFrame(rafCb);
    vi.advanceTimersByTime(100);
    expect(rafCb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(410);
    expect(rafCb).toHaveBeenCalledTimes(1);
    expect(nativeRafCount).toBe(0);

    // Hovering sub-pane temporarily unthrottles rAF while keeping CSS diet and notifies workspace topbar
    document.documentElement.dispatchEvent(new Event('mouseenter'));
    expect(parentPostSpy).toHaveBeenCalledWith(
      { source: 'dia-bento-frame', type: 'DIA_FRAME_HOVER' },
      'chrome-extension://dia-ext-id'
    );
    parentPostSpy.mockClear();
    document.documentElement.dispatchEvent(new Event('pointermove'));
    expect(parentPostSpy).not.toHaveBeenCalled();

    // DIA_TOPBAR_OPEN resets stuck hover state and next pointermove notifies parent once
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'chrome-extension://dia-ext-id',
        data: {
          source: 'dia-bento-workspace',
          type: 'DIA_TOPBAR_OPEN'
        }
      })
    );
    document.documentElement.dispatchEvent(new Event('pointermove'));
    expect(parentPostSpy).toHaveBeenCalledTimes(1);
    document.documentElement.dispatchEvent(new Event('pointermove'));
    expect(parentPostSpy).toHaveBeenCalledTimes(1);

    window.requestAnimationFrame(rafCb);
    vi.advanceTimersByTime(20);
    expect(nativeRafCount).toBe(1);
    expect(rafCb).toHaveBeenCalledTimes(2);
    expect(document.getElementById('dia-sub-diet')).not.toBeNull();

    // Leaving sub-pane re-throttles rAF
    document.documentElement.dispatchEvent(new Event('mouseleave'));
    window.requestAnimationFrame(rafCb);
    vi.advanceTimersByTime(50);
    expect(rafCb).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(460);
    expect(rafCb).toHaveBeenCalledTimes(3);

    // Untrusted non-extension postMessage origin cannot spoof DIA_SLOT_MODE
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://web.telegram.org',
        data: {
          source: 'dia-bento-workspace',
          type: 'DIA_SLOT_MODE',
          providerId: 'telegram',
          isMain: true
        }
      })
    );
    expect(document.getElementById('dia-sub-diet')).not.toBeNull();

    // Workspace promotes telegram to MAIN slot via postMessage
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'chrome-extension://dia-ext-id',
        data: {
          source: 'dia-bento-workspace',
          type: 'DIA_SLOT_MODE',
          providerId: 'telegram',
          isMain: true
        }
      })
    );
    expect(document.getElementById('dia-sub-diet')).toBeNull();
    window.requestAnimationFrame(rafCb);
    vi.advanceTimersByTime(20);
    expect(nativeRafCount).toBe(2);
    expect(rafCb).toHaveBeenCalledTimes(4);

    // MAIN world Notification proxies to ISOLATED -> background CHAT_NOTIFY and routes click back
    sentMessages.length = 0;
    const notif = new window.Notification('Minh', { body: 'Review PR #42', tag: 'tg-42' });
    const clickSpy = vi.fn();
    notif.onclick = clickSpy;

    expect(sentMessages).toHaveLength(1);
    const chatMsg = sentMessages[0]!;
    expect(chatMsg.type).toBe('CHAT_NOTIFY');
    if (chatMsg.type !== 'CHAT_NOTIFY') throw new Error('Expected CHAT_NOTIFY');
    expect(chatMsg.payload).toMatchObject({
      providerId: 'telegram',
      title: 'Minh',
      body: 'Review PR #42',
      tag: 'tg-42'
    });
    expect(chatMsg.payload.notifToken).toMatch(/^nt-/);

    // Empty-origin MessageEvent is strictly rejected when expectedExtensionOrigin is known
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: '',
        data: {
          type: 'DIA_CLICK_NOTIFY',
          notifToken: chatMsg.payload.notifToken
        }
      })
    );
    expect(clickSpy).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'chrome-extension://dia-ext-id',
        data: {
          type: 'DIA_CLICK_NOTIFY',
          notifToken: chatMsg.payload.notifToken
        }
      })
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Flush the 250ms post-RAW_NOTIFY unread check, then verify DOM badge rise 2500ms after RAW_NOTIFY does NOT double-notify
    vi.advanceTimersByTime(250);
    sentMessages.length = 0;
    new window.Notification('Minh', { body: 'DOM badge delayed', tag: 'tg-43' });
    expect(sentMessages.filter((m) => m.type === 'CHAT_NOTIFY')).toHaveLength(1);
    vi.advanceTimersByTime(2500);
    document.body.innerHTML = '<span class="badge-unread">1</span>';
    vi.advanceTimersByTime(3000); // next 3000ms poll observes DOM badge rise without duplicate fallback
    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 1
    });
    vi.advanceTimersByTime(2000);
    expect(sentMessages.filter((m) => m.type === 'CHAT_NOTIFY')).toHaveLength(1);
    document.body.innerHTML = '';
    vi.advanceTimersByTime(3000);

    // Capture-phase Alt+3 / macOS Option+3 inside iframe forwards FOCUS_PROVIDER to background and blocks page handlers
    sentMessages.length = 0;
    const bubbleKeySpy = vi.fn();
    window.addEventListener('keydown', bubbleKeySpy);
    const shortcutEv = new KeyboardEvent('keydown', {
      altKey: true,
      code: 'Digit3',
      key: '£',
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(shortcutEv);
    window.removeEventListener('keydown', bubbleKeySpy);
    expect(shortcutEv.defaultPrevented).toBe(true);
    expect(bubbleKeySpy).not.toHaveBeenCalled();
    expect(sentMessages).toContainEqual({
      type: 'FOCUS_PROVIDER',
      providerId: 'telegram'
    });

    // Capture-phase Alt+M / macOS Option+M inside iframe forwards TOGGLE_MAXIMIZE (ignores repeat, leaves Escape untouched)
    sentMessages.length = 0;
    const maxBubbleSpy = vi.fn();
    window.addEventListener('keydown', maxBubbleSpy);
    const maxShortcutEv = new KeyboardEvent('keydown', {
      altKey: true,
      code: 'KeyM',
      key: 'µ',
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(maxShortcutEv);
    const repeatMaxEv = new KeyboardEvent('keydown', {
      altKey: true,
      code: 'KeyM',
      key: 'µ',
      repeat: true,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(repeatMaxEv);
    window.removeEventListener('keydown', maxBubbleSpy);
    expect(maxShortcutEv.defaultPrevented).toBe(true);
    expect(repeatMaxEv.defaultPrevented).toBe(true);
    expect(maxBubbleSpy).not.toHaveBeenCalled();
    expect(sentMessages).toEqual([{ type: 'TOGGLE_MAXIMIZE', providerId: 'telegram' }]);

    sentMessages.length = 0;
    const escEv = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(escEv);
    expect(escEv.defaultPrevented).toBe(false);
    expect(sentMessages).toHaveLength(0);

    // Pointer/focus interaction inside iframe reports FRAME_FOCUSED with 800ms cooldown
    sentMessages.length = 0;
    window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    window.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(sentMessages.filter((m) => m.type === 'FRAME_FOCUSED')).toEqual([
      { type: 'FRAME_FOCUSED', providerId: 'telegram' }
    ]);
    vi.advanceTimersByTime(800);
    window.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(sentMessages.filter((m) => m.type === 'FRAME_FOCUSED')).toHaveLength(2);
    // Frame blur resets cooldown so returning within <800ms still reports FRAME_FOCUSED
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(sentMessages.filter((m) => m.type === 'FRAME_FOCUSED')).toHaveLength(3);

    // Title mutation fires MutationObserver immediately without waiting for 3000ms poll
    sentMessages.length = 0;
    document.title = '(7) Telegram';
    await Promise.resolve();
    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 7
    });
    // Cancel pending fallback via RAW_NOTIFY before testing silent DOM badge fallback
    new window.Notification('Bot', { body: 'Synced' });
    vi.advanceTimersByTime(1500);
    document.title = 'Telegram';
    await Promise.resolve();

    // Silent unread rise via DOM badge + polling triggers UNREAD_UPDATE and 1500ms fallback CHAT_NOTIFY
    sentMessages.length = 0;
    document.body.innerHTML = '<span class="badge-unread">3</span>';
    vi.advanceTimersByTime(3000);
    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 3
    });
    vi.advanceTimersByTime(1500);
    expect(sentMessages).toContainEqual({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId: 'telegram',
        title: 'Telegram',
        body: 'Bạn có 3 tin nhắn chưa đọc',
        tag: 'fallback-telegram'
      }
    });
  });

  it('boots immediately when injected after DOMContentLoaded (readyState complete)', async () => {
    const sentMessages: RuntimeMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: () => void) => {
          sentMessages.push(msg);
          cb?.();
        }),
        lastError: undefined
      }
    });

    const fakeWorkspaceWin = {} as Window;
    Object.defineProperty(window, 'top', {
      value: fakeWorkspaceWin,
      configurable: true
    });
    Object.defineProperty(window, 'parent', {
      value: fakeWorkspaceWin,
      configurable: true
    });
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      configurable: true
    });
    document.title = '(5) Telegram';

    await import('../../src/content/notify-hook.main');
    await import('../../src/content/frame-agent.isolated');

    expect(document.getElementById('dia-sub-diet')).not.toBeNull();
    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 5
    });
  });

  it('ignores muted Telegram chatlist updates even when document.title increments, and extracts Vietnamese sender + snippet via debounced body observer for unmuted chats', async () => {
    const sentMessages: RuntimeMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'dia-ext-id',
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: () => void) => {
          sentMessages.push(msg);
          cb?.();
        }),
        lastError: undefined
      }
    });

    const fakeWorkspaceWin = {} as Window;
    Object.defineProperty(window, 'top', { value: fakeWorkspaceWin, configurable: true });
    Object.defineProperty(window, 'parent', { value: fakeWorkspaceWin, configurable: true });
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: ['chrome-extension://dia-ext-id'] as unknown as DOMStringList,
      configurable: true
    });
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

    document.body.innerHTML = `
      <ul class="chatlist">
        <a class="chatlist-chat is-muted" data-peer-id="-999">
          <span class="peer-title">Nhóm Muted</span>
          <div class="dialog-subtitle-badge-unread badge-gray is-visible">12</div>
        </a>
      </ul>
    `;
    document.title = '(12) Telegram';

    await import('../../src/content/frame-agent.isolated');

    // Muted group reports 0 unread and triggers NO fallback notification
    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 0
    });
    vi.advanceTimersByTime(2000);
    expect(sentMessages.filter((m) => m.type === 'CHAT_NOTIFY')).toHaveLength(0);

    // Muted group receives another message -> still 0 unread and 0 notifications
    sentMessages.length = 0;
    document.querySelector('.badge-gray')!.textContent = '13';
    document.title = '(13) Telegram';
    await Promise.resolve();
    vi.advanceTimersByTime(2000);
    expect(sentMessages.filter((m) => m.type === 'UNREAD_UPDATE')).toHaveLength(0);
    expect(sentMessages.filter((m) => m.type === 'CHAT_NOTIFY')).toHaveLength(0);

    // Unmuted chat arrives in DOM -> 200ms debounced body observer catches it + 1500ms fallback sends Vietnamese sender & preview!
    document.querySelector('.chatlist')!.insertAdjacentHTML(
      'afterbegin',
      `
      <a class="chatlist-chat" data-peer-id="555">
        <span class="peer-title">Phạm Quốc Bảo</span>
        <span class="dialog-subtitle-span">Em vừa đẩy bản hotfix lên staging</span>
        <div class="dialog-subtitle-badge-unread badge-primary is-visible">1</div>
      </a>
      `
    );
    await Promise.resolve();
    vi.advanceTimersByTime(220);

    expect(sentMessages).toContainEqual({
      type: 'UNREAD_UPDATE',
      providerId: 'telegram',
      count: 1
    });

    vi.advanceTimersByTime(1500);
    expect(sentMessages).toContainEqual({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId: 'telegram',
        title: 'Phạm Quốc Bảo',
        body: 'Em vừa đẩy bản hotfix lên staging',
        tag: 'fallback-telegram-Phạm Quốc Bảo-Em vừa đẩy bản hotfix lê'
      }
    });
  });
});
