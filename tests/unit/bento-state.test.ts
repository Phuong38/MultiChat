// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/workspace.html" }
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId, RuntimeMessage, WorkspacePrefs } from '../../src/shared/types';
import {
  DEFAULT_PREFS,
  SLOT_IDS,
  clampMainWidth,
  extractAltShortcutDigit,
  formatWorkspaceTitle,
  resolveEmbedUrl,
  sanitizeWorkspacePrefs,
  swapProviderToMain
} from '../../src/workspace/bento-state';

describe('BentoState pure functions', () => {
  it('swaps selected sub-pane with current main pane while keeping other sub-panes stable', () => {
    const initial = DEFAULT_PREFS.slotOrder;
    expect(SLOT_IDS).toEqual(['main', 'sub-1', 'sub-2', 'sub-3']);
    expect(initial).toEqual(['zalo', 'messenger', 'telegram', 'discord']);

    const swapped = swapProviderToMain(initial, 'telegram');
    expect(swapped).toEqual(['telegram', 'messenger', 'zalo', 'discord']);
    expect(initial).toEqual(['zalo', 'messenger', 'telegram', 'discord']);
    expect(swapProviderToMain(swapped, 'telegram')).toEqual(swapped);
  });

  it('clamps main column width between 45% and 80%', () => {
    expect(clampMainWidth(20)).toBe(45);
    expect(clampMainWidth(66)).toBe(66);
    expect(clampMainWidth(66.4)).toBe(66);
    expect(clampMainWidth(95)).toBe(80);
    expect(clampMainWidth(Number.NaN)).toBe(66);
    expect(clampMainWidth(Number.POSITIVE_INFINITY)).toBe(66);
  });

  it('formats workspace document title with aggregated unread count', () => {
    expect(
      formatWorkspaceTitle({ zalo: 0, messenger: 0, telegram: 0, discord: 0 })
    ).toBe('Dia Bento Chat Hub');
    expect(
      formatWorkspaceTitle({ zalo: 2, messenger: 1, telegram: 0, discord: 4 })
    ).toBe('(7) Dia Bento Chat Hub');
  });

  it('resolves production embed URL or validated local E2E testOrigin override', () => {
    expect(resolveEmbedUrl('telegram', null)).toBe('https://web.telegram.org/k/');
    expect(resolveEmbedUrl('telegram', 'http://127.0.0.1:4321')).toBe(
      'http://127.0.0.1:4321/telegram'
    );
    expect(resolveEmbedUrl('zalo', 'http://127.0.0.1:4321/')).toBe(
      'http://127.0.0.1:4321/zalo'
    );
    expect(resolveEmbedUrl('discord', 'http://localhost:9876')).toBe(
      'http://localhost:9876/discord'
    );

    // Reject untrusted external, non-http, credentialed, path-injected, or malformed testOrigin values
    expect(resolveEmbedUrl('telegram', 'https://evil.example.com')).toBe(
      'https://web.telegram.org/k/'
    );
    expect(resolveEmbedUrl('telegram', 'http://127.0.0.1.evil.com:4321')).toBe(
      'https://web.telegram.org/k/'
    );
    expect(resolveEmbedUrl('telegram', 'http://user@127.0.0.1:4321')).toBe(
      'https://web.telegram.org/k/'
    );
    expect(resolveEmbedUrl('telegram', 'http://127.0.0.1:4321/evil')).toBe(
      'https://web.telegram.org/k/'
    );
    expect(resolveEmbedUrl('telegram', 'javascript:alert(1)')).toBe(
      'https://web.telegram.org/k/'
    );
    expect(resolveEmbedUrl('telegram', 'not a url')).toBe('https://web.telegram.org/k/');
  });

  it('sanitizes corrupted or partial WorkspacePrefs from storage', () => {
    expect(sanitizeWorkspacePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizeWorkspacePrefs('corrupted')).toEqual(DEFAULT_PREFS);
    expect(sanitizeWorkspacePrefs(['zalo'])).toEqual(DEFAULT_PREFS);

    // Duplicate or incomplete slotOrder falls back to DEFAULT_PREFS.slotOrder
    const dupOrder = sanitizeWorkspacePrefs({
      slotOrder: ['zalo', 'zalo', 'telegram', 'discord'],
      mainWidthPct: 99,
      dnd: true,
      hidePreview: 'yes',
      liteMedia: 1,
      paused: { telegram: true, discord: 'invalid' }
    });
    expect(dupOrder).toEqual({
      slotOrder: ['zalo', 'messenger', 'telegram', 'discord'],
      mainWidthPct: 80,
      dnd: true,
      hidePreview: false,
      liteMedia: false,
      paused: {
        zalo: false,
        messenger: false,
        telegram: true,
        discord: false
      }
    });

    const partialOrder = sanitizeWorkspacePrefs({
      slotOrder: ['discord', 'zalo']
    });
    expect(partialOrder.slotOrder).toEqual(['zalo', 'messenger', 'telegram', 'discord']);

    const unknownOrder = sanitizeWorkspacePrefs({
      slotOrder: ['discord', 'zalo', 'messenger', 'slack']
    });
    expect(unknownOrder.slotOrder).toEqual(['zalo', 'messenger', 'telegram', 'discord']);

    // Valid permutation is preserved and decoupled from DEFAULT_PREFS
    const valid = sanitizeWorkspacePrefs({
      slotOrder: ['discord', 'zalo', 'messenger', 'telegram'],
      mainWidthPct: 55
    });
    expect(valid.slotOrder).toEqual(['discord', 'zalo', 'messenger', 'telegram']);
    expect(valid.mainWidthPct).toBe(55);
    valid.slotOrder[0] = 'zalo';
    expect(DEFAULT_PREFS.slotOrder).toEqual(['zalo', 'messenger', 'telegram', 'discord']);
  });

  it('extracts Alt/Option+1..4 shortcut digits across Playwright and macOS hardware keyboards', () => {
    // Playwright Alt+2 (key = '2', code = 'Digit2')
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'Digit2',
        key: '2'
      })
    ).toBe(2);

    // macOS Option+1..4 produces special characters in ev.key ('¡', '™', '£', '¢') with Digit1..4 in ev.code
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'Digit1',
        key: '¡'
      })
    ).toBe(1);
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'Digit3',
        key: '£'
      })
    ).toBe(3);
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'Digit4',
        key: '¢'
      })
    ).toBe(4);

    // Synthetic event with empty code falls back to ev.key
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: '',
        key: '4'
      })
    ).toBe(4);

    // Reject extra modifiers or non-1..4 keys
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        code: 'Digit2',
        key: '2'
      })
    ).toBeNull();
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        code: 'Digit2',
        key: '2'
      })
    ).toBeNull();
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        code: 'Digit2',
        key: '2'
      })
    ).toBeNull();
    expect(
      extractAltShortcutDigit({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'Digit2',
        key: '2'
      })
    ).toBeNull();
    expect(
      extractAltShortcutDigit({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'Digit5',
        key: '∞'
      })
    ).toBeNull();
  });
});

describe('Workspace UI DOM integration (zero-reload Bento swap, pause, controls, runtime messages)', () => {
  const workspaceHtmlPath = resolve(process.cwd(), 'public/workspace.html');

  function loadWorkspaceMarkup(): void {
    const html = readFileSync(workspaceHtmlPath, 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.title = parsed.title;
    document.body.className = '';
    document.body.innerHTML = parsed.body.innerHTML;
    document.body.querySelector('script[src="workspace.js"]')?.remove();
  }

  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    window.history.replaceState(null, '', '/workspace.html');
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('mounts 4 panes once and swaps slots via data-slot without re-parenting or reloading iframes', async () => {
    loadWorkspaceMarkup();

    const storedState: Record<string, unknown> = {};
    const sentRuntime: RuntimeMessage[] = [];
    const runtimeListeners: Array<(msg: RuntimeMessage) => void> = [];

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storedState[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storedState, items);
          })
        }
      },
      runtime: {
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: (res: unknown) => void) => {
          sentRuntime.push(msg);
          if (msg.type === 'GET_DUP_TABS') {
            cb?.({
              tabs: [{ tabId: 77, providerId: 'telegram', url: 'https://web.telegram.org/k/' }]
            });
          } else {
            cb?.({ ok: true });
          }
        }),
        onMessage: {
          addListener: vi.fn((fn: (msg: RuntimeMessage) => void) => {
            runtimeListeners.push(fn);
          }),
          removeListener: vi.fn()
        },
        lastError: undefined
      }
    });

    await import('../../src/workspace/workspace');
    await flushMicrotasks();

    const grid = document.getElementById('bento-grid')!;
    const paneNodes = Array.from(grid.querySelectorAll<HTMLElement>('section.pane'));
    expect(paneNodes).toHaveLength(4);

    const byProvider = new Map<ProviderId, HTMLElement>();
    const iframeByProvider = new Map<ProviderId, HTMLIFrameElement>();
    const postSpyByProvider = new Map<ProviderId, ReturnType<typeof vi.fn>>();

    for (const section of paneNodes) {
      const id = section.dataset.provider as ProviderId;
      const iframe = section.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;
      expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
      expect(iframe.getAttribute('allow')).toContain('microphone');
      const postSpy = vi.fn();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postSpy },
        configurable: true
      });
      byProvider.set(id, section);
      iframeByProvider.set(id, iframe);
      postSpyByProvider.set(id, postSpy);
    }

    expect(byProvider.get('zalo')?.dataset.slot).toBe('main');
    expect(byProvider.get('messenger')?.dataset.slot).toBe('sub-1');
    expect(byProvider.get('telegram')?.dataset.slot).toBe('sub-2');
    expect(byProvider.get('discord')?.dataset.slot).toBe('sub-3');

    const initialSrcs = new Map<ProviderId, string>();
    for (const [id, iframe] of iframeByProvider) {
      initialSrcs.set(id, iframe.src);
    }

    // Observe #bento-grid childList to prove ZERO DOM re-parenting during swaps
    let childListMutations = 0;
    const gridObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') childListMutations += 1;
      }
    });
    gridObserver.observe(grid, { childList: true });

    // 1) Click Telegram header title button -> swaps Telegram to main, Zalo to sub-2
    byProvider.get('telegram')!.querySelector<HTMLButtonElement>('.pane-title-btn')!.click();
    expect(byProvider.get('telegram')?.dataset.slot).toBe('main');
    expect(byProvider.get('messenger')?.dataset.slot).toBe('sub-1');
    expect(byProvider.get('zalo')?.dataset.slot).toBe('sub-2');
    expect(byProvider.get('discord')?.dataset.slot).toBe('sub-3');

    // 2) Playwright Alt+2 -> swaps Messenger to main
    window.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, code: 'Digit2', key: '2', cancelable: true })
    );
    expect(byProvider.get('messenger')?.dataset.slot).toBe('main');
    expect(byProvider.get('telegram')?.dataset.slot).toBe('sub-1');

    // 3) macOS hardware Option+4 (ev.key = '¢', ev.code = 'Digit4') -> swaps Discord to main
    window.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, code: 'Digit4', key: '¢', cancelable: true })
    );
    expect(byProvider.get('discord')?.dataset.slot).toBe('main');
    expect(byProvider.get('messenger')?.dataset.slot).toBe('sub-3');

    // 4) Runtime FOCUS_PROVIDER message -> swaps Zalo back to main
    runtimeListeners[0]?.({ type: 'FOCUS_PROVIDER', providerId: 'zalo' });
    expect(byProvider.get('zalo')?.dataset.slot).toBe('main');
    expect(byProvider.get('discord')?.dataset.slot).toBe('sub-2');

    await flushMicrotasks();
    gridObserver.disconnect();

    expect(childListMutations).toBe(0);
    const afterPaneNodes = Array.from(grid.querySelectorAll<HTMLElement>('section.pane'));
    expect(afterPaneNodes).toEqual(paneNodes);
    for (const [id, iframe] of iframeByProvider) {
      expect(iframe.src).toBe(initialSrcs.get(id));
    }

    expect(postSpyByProvider.get('zalo')).toHaveBeenLastCalledWith(
      {
        source: 'dia-bento-workspace',
        type: 'DIA_SLOT_MODE',
        providerId: 'zalo',
        isMain: true
      },
      '*'
    );
    expect(postSpyByProvider.get('discord')).toHaveBeenLastCalledWith(
      {
        source: 'dia-bento-workspace',
        type: 'DIA_SLOT_MODE',
        providerId: 'discord',
        isMain: false
      },
      '*'
    );

    // Duplicate external tab banner populated on startup and clears on click
    const dupBtn = document.getElementById('dup-tabs-btn')!;
    expect(dupBtn.classList.contains('hidden')).toBe(false);
    expect(dupBtn.textContent).toBe('Dong 1 tab chat trung ben ngoai');
    dupBtn.click();
    expect(sentRuntime).toContainEqual({ type: 'CLOSE_DUP_TABS' });
    expect(dupBtn.classList.contains('hidden')).toBe(true);
  });

  it('supports Pause/Resume RAM zeroing, topbar toggles, resizer drag, unread badges, and TRIGGER_NOTIFY_CLICK', async () => {
    window.history.replaceState(
      null,
      '',
      '/workspace.html?testOrigin=http%3A%2F%2F127.0.0.1%3A4321'
    );
    loadWorkspaceMarkup();

    // Seed corrupted slotOrder + valid paused flag to verify storage recovery
    const storedState: Record<string, unknown> = {
      dia_bento_prefs_v1: {
        slotOrder: ['zalo', 'zalo'],
        mainWidthPct: 60,
        dnd: false,
        hidePreview: false,
        liteMedia: false,
        paused: { discord: true }
      }
    };
    const sentRuntime: RuntimeMessage[] = [];
    const runtimeListeners: Array<(msg: RuntimeMessage) => void> = [];

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storedState[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storedState, items);
          })
        }
      },
      runtime: {
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: (res: unknown) => void) => {
          sentRuntime.push(msg);
          cb?.({});
        }),
        onMessage: {
          addListener: vi.fn((fn: (msg: RuntimeMessage) => void) => {
            runtimeListeners.push(fn);
          }),
          removeListener: vi.fn()
        },
        lastError: undefined
      }
    });

    await import('../../src/workspace/workspace');
    await flushMicrotasks();

    const grid = document.getElementById('bento-grid')!;
    const telegramPane = grid.querySelector<HTMLElement>('section.pane[data-provider="telegram"]')!;
    const discordPane = grid.querySelector<HTMLElement>('section.pane[data-provider="discord"]')!;
    const telegramIframe = telegramPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;
    const discordIframe = discordPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;

    // Local testOrigin applied to active pane, while pre-paused Discord starts at about:blank
    expect(telegramIframe.src).toBe('http://127.0.0.1:4321/telegram');
    expect(discordIframe.src).toBe('about:blank');
    expect(
      discordPane.querySelector('.paused-overlay')!.classList.contains('hidden')
    ).toBe(false);

    // Pause Telegram -> about:blank + overlay shown
    const tgControls = telegramPane.querySelectorAll<HTMLButtonElement>('.pane-controls button');
    const tgReauthBtn = tgControls[0]!;
    const tgPauseBtn = tgControls[1]!;
    tgPauseBtn.click();
    expect(telegramIframe.src).toBe('about:blank');
    expect(tgPauseBtn.textContent).toBe('Resume');
    expect(
      telegramPane.querySelector('.paused-overlay')!.classList.contains('hidden')
    ).toBe(false);

    // Re-Auth sends OPEN_REAUTH
    tgReauthBtn.click();
    expect(sentRuntime).toContainEqual({ type: 'OPEN_REAUTH', providerId: 'telegram' });

    // TRIGGER_NOTIFY_CLICK auto-resumes paused Telegram, promotes to main, and forwards DIA_CLICK_NOTIFY
    const tgPostSpy = vi.fn();
    Object.defineProperty(telegramIframe, 'contentWindow', {
      value: { postMessage: tgPostSpy },
      configurable: true
    });
    runtimeListeners[0]?.({
      type: 'TRIGGER_NOTIFY_CLICK',
      providerId: 'telegram',
      notifToken: 'nt-99'
    });
    expect(telegramIframe.src).toBe('http://127.0.0.1:4321/telegram');
    expect(telegramPane.dataset.slot).toBe('main');
    expect(tgPostSpy).toHaveBeenCalledWith(
      { type: 'DIA_CLICK_NOTIFY', notifToken: 'nt-99' },
      '*'
    );

    // UNREAD_UPDATE updates per-pane badge, total badge, and document.title
    runtimeListeners[0]?.({ type: 'UNREAD_UPDATE', providerId: 'telegram', count: 3 });
    runtimeListeners[0]?.({ type: 'UNREAD_UPDATE', providerId: 'zalo', count: 2 });
    const totalBadge = document.getElementById('total-unread')!;
    expect(totalBadge.textContent).toBe('5');
    expect(totalBadge.classList.contains('hidden')).toBe(false);
    expect(document.title).toBe('(5) Dia Bento Chat Hub');

    // Topbar toggles sync prefs to background service worker
    sentRuntime.length = 0;
    document.getElementById('btn-lite-media')!.click();
    document.getElementById('btn-hide-preview')!.click();
    document.getElementById('btn-dnd')!.click();
    document.getElementById('btn-test-notify')!.click();

    expect(sentRuntime).toContainEqual({
      type: 'SYNC_PREFS',
      prefs: { dnd: true, hidePreview: true, liteMedia: true }
    });
    expect(sentRuntime).toContainEqual({ type: 'TEST_NOTIFY' });

    // Resizer drag updates --main-width clamped to 45%..80% and cleans up body.resizing on mouseup
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const resizer = document.getElementById('grid-resizer')!;
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 600, bubbles: true }));
    expect(document.body.classList.contains('resizing')).toBe(true);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
    expect(document.documentElement.style.getPropertyValue('--main-width')).toBe('80%');
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(document.body.classList.contains('resizing')).toBe(false);
    expect((storedState.dia_bento_prefs_v1 as WorkspacePrefs).mainWidthPct).toBe(80);
  });

  it('ignores malicious testOrigin query params, posts DIA_SLOT_MODE on iframe load, handles wake/reload, and clears resizer on blur', async () => {
    window.history.replaceState(
      null,
      '',
      '/workspace.html?testOrigin=https%3A%2F%2Fevil.example.com'
    );
    loadWorkspaceMarkup();

    const runtimeListeners: Array<(msg: RuntimeMessage) => void> = [];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => {
            throw new Error('transient storage error');
          }),
          set: vi.fn(async () => {})
        }
      },
      runtime: {
        sendMessage: vi.fn((_msg: RuntimeMessage, cb?: (res: unknown) => void) => cb?.({})),
        onMessage: {
          addListener: vi.fn((fn: (msg: RuntimeMessage) => void) => {
            runtimeListeners.push(fn);
          }),
          removeListener: vi.fn()
        },
        lastError: undefined
      }
    });

    await import('../../src/workspace/workspace');
    await flushMicrotasks();

    const grid = document.getElementById('bento-grid')!;
    const zaloPane = grid.querySelector<HTMLElement>('section.pane[data-provider="zalo"]')!;
    const messengerPane = grid.querySelector<HTMLElement>(
      'section.pane[data-provider="messenger"]'
    )!;
    const zaloIframe = zaloPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;
    const messengerIframe = messengerPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;

    // Malicious testOrigin rejected -> production embedUrl loaded even when storage.get rejected
    expect(zaloIframe.src).toBe('https://chat.zalo.me/');
    expect(messengerIframe.src).toBe('https://www.messenger.com/');

    // Iframe load event posts current DIA_SLOT_MODE
    const zaloPostSpy = vi.fn();
    const messengerPostSpy = vi.fn();
    Object.defineProperty(zaloIframe, 'contentWindow', {
      value: { postMessage: zaloPostSpy },
      configurable: true
    });
    Object.defineProperty(messengerIframe, 'contentWindow', {
      value: { postMessage: messengerPostSpy },
      configurable: true
    });
    zaloIframe.dispatchEvent(new Event('load'));
    messengerIframe.dispatchEvent(new Event('load'));
    expect(zaloPostSpy).toHaveBeenCalledWith(
      {
        source: 'dia-bento-workspace',
        type: 'DIA_SLOT_MODE',
        providerId: 'zalo',
        isMain: true
      },
      '*'
    );
    expect(messengerPostSpy).toHaveBeenCalledWith(
      {
        source: 'dia-bento-workspace',
        type: 'DIA_SLOT_MODE',
        providerId: 'messenger',
        isMain: false
      },
      '*'
    );

    // Pause Messenger, then wake via overlay button ("Mo lai ngay")
    const msgControls = messengerPane.querySelectorAll<HTMLButtonElement>('.pane-controls button');
    msgControls[1]!.click();
    expect(messengerIframe.src).toBe('about:blank');
    messengerPane
      .querySelector<HTMLButtonElement>('.paused-overlay button')!
      .click();
    expect(messengerIframe.src).toBe('https://www.messenger.com/');

    // Pause Messenger again, then RELOAD_PROVIDER wakes it back up
    msgControls[1]!.click();
    expect(messengerIframe.src).toBe('about:blank');
    runtimeListeners[0]?.({ type: 'RELOAD_PROVIDER', providerId: 'messenger' });
    expect(messengerIframe.src).toBe('https://www.messenger.com/');

    // DUP_TABS_CHANGED toggles banner visibility
    const dupBtn = document.getElementById('dup-tabs-btn')!;
    runtimeListeners[0]?.({
      type: 'DUP_TABS_CHANGED',
      tabs: [
        { tabId: 1, providerId: 'zalo', url: 'https://chat.zalo.me/' },
        { tabId: 2, providerId: 'discord', url: 'https://discord.com/app' }
      ]
    });
    expect(dupBtn.classList.contains('hidden')).toBe(false);
    expect(dupBtn.textContent).toBe('Dong 2 tab chat trung ben ngoai');
    runtimeListeners[0]?.({ type: 'DUP_TABS_CHANGED', tabs: [] });
    expect(dupBtn.classList.contains('hidden')).toBe(true);

    // Resizer clears body.resizing if window blurs mid-drag
    const resizer = document.getElementById('grid-resizer')!;
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    expect(document.body.classList.contains('resizing')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(document.body.classList.contains('resizing')).toBe(false);
  });
});
