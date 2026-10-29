// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/workspace.html" }
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId, RuntimeMessage, WorkspacePrefs } from '../../src/shared/types';
import {
  DEFAULT_PREFS,
  SLOT_IDS,
  type ShortcutKeyInput,
  clampMainWidth,
  extractAltShortcutDigit,
  formatSplitRatio,
  formatWorkspaceTitle,
  isAltMaximizeShortcut,
  resolveEmbedUrl,
  sanitizeWorkspacePrefs,
  swapProviderToMain
} from '../../src/workspace/bento-state';
import {
  isAltMaximizeShortcut as sharedIsAltMaximizeShortcut,
  type ShortcutKeyInput as SharedShortcutKeyInput
} from '../../src/shared/shortcuts';
import { updateWorkspaceFavicon } from '../../src/workspace/favicon';
import { createActionIconSvg, createBrandIconSvg } from '../../src/workspace/icons';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

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
    ).toBe('MultiChat Hub');
    expect(
      formatWorkspaceTitle({ zalo: 2, messenger: 1, telegram: 0, discord: 4 })
    ).toBe('(7) MultiChat Hub');
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
      topbarPinned: 'yes',
      dnd: true,
      hidePreview: 'yes',
      liteMedia: 1,
      paused: { telegram: true, discord: 'invalid' }
    });
    expect(dupOrder).toEqual({
      slotOrder: ['zalo', 'messenger', 'telegram', 'discord'],
      mainWidthPct: 80,
      topbarPinned: false,
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

    // Valid permutation and boolean topbarPinned are preserved and decoupled from DEFAULT_PREFS
    const valid = sanitizeWorkspacePrefs({
      slotOrder: ['discord', 'zalo', 'messenger', 'telegram'],
      mainWidthPct: 55,
      topbarPinned: true
    });
    expect(valid.slotOrder).toEqual(['discord', 'zalo', 'messenger', 'telegram']);
    expect(valid.mainWidthPct).toBe(55);
    expect(valid.topbarPinned).toBe(true);
    valid.slotOrder[0] = 'zalo';
    expect(DEFAULT_PREFS.slotOrder).toEqual(['zalo', 'messenger', 'telegram', 'discord']);
  });

  it('formats split ratio label with clamped main and sub percentages', () => {
    expect(formatSplitRatio(66)).toBe('Chính 66% • Phụ 34%');
    expect(formatSplitRatio(52)).toBe('Chính 52% • Phụ 48%');
    expect(formatSplitRatio(20)).toBe('Chính 45% • Phụ 55%');
    expect(formatSplitRatio(95)).toBe('Chính 80% • Phụ 20%');
  });

  it('detects Alt+M and macOS Option+M maximize shortcut', () => {
    const sample: ShortcutKeyInput & SharedShortcutKeyInput = {
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      code: 'KeyM',
      key: 'm'
    };
    expect(isAltMaximizeShortcut).toBe(sharedIsAltMaximizeShortcut);
    expect(isAltMaximizeShortcut(sample)).toBe(true);
    // macOS Option+M produces 'µ' in ev.key with 'KeyM' in ev.code
    expect(
      isAltMaximizeShortcut({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'KeyM',
        key: 'µ'
      })
    ).toBe(true);
    // Synthetic event with empty code falls back to ev.key
    expect(
      isAltMaximizeShortcut({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: '',
        key: 'm'
      })
    ).toBe(true);
    expect(
      isAltMaximizeShortcut({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: '',
        key: 'M'
      })
    ).toBe(true);

    // Reject missing altKey, extra modifiers, or non-M keys
    expect(
      isAltMaximizeShortcut({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'KeyM',
        key: 'm'
      })
    ).toBe(false);
    expect(
      isAltMaximizeShortcut({
        altKey: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        code: 'KeyM',
        key: 'm'
      })
    ).toBe(false);
    expect(
      isAltMaximizeShortcut({
        altKey: true,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        code: 'KeyM',
        key: 'm'
      })
    ).toBe(false);
    expect(
      isAltMaximizeShortcut({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        code: 'KeyM',
        key: 'M'
      })
    ).toBe(false);
    expect(
      isAltMaximizeShortcut({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        code: 'KeyN',
        key: 'n'
      })
    ).toBe(false);
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

  it('updates dynamic workspace favicon for unread=0, mocked 2D canvas badge, and null getContext fallback', () => {
    // 1) totalUnread = 0 creates link#workspace-favicon pointing to icons/icon-32.png
    updateWorkspaceFavicon(document, 0);
    const link = document.querySelector<HTMLLinkElement>('link#workspace-favicon')!;
    expect(link).not.toBeNull();
    expect(link.rel).toBe('icon');
    expect(link.type).toBe('image/png');
    expect(link.getAttribute('href')).toBe('icons/icon-32.png');

    // 2) Clean fallback when getContext('2d') returns null in jsdom
    link.href = 'data:image/png;base64,stale';
    updateWorkspaceFavicon(document, 3);
    expect(link.getAttribute('href')).toBe('icons/icon-32.png');

    // 3) Draws Bento quadrants + red unread badge onto mocked 2D canvas context when totalUnread > 0
    const fillText = vi.fn();
    const roundRect = vi.fn();
    const arc = vi.fn();
    const mockCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      beginPath: vi.fn(),
      roundRect,
      fill: vi.fn(),
      arc,
      stroke: vi.fn(),
      fillText
    } as unknown as CanvasRenderingContext2D;

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockCtx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,bW9ja2Zhdmljb24='
    );

    updateWorkspaceFavicon(document, 4);
    expect(roundRect).toHaveBeenCalledTimes(5);
    expect(arc).toHaveBeenCalledTimes(1);
    expect(fillText).toHaveBeenCalledWith('4', 48, 17);
    expect(link.getAttribute('href')).toBe('data:image/png;base64,bW9ja2Zhdmljb24=');

    getContextSpy.mockClear();
    updateWorkspaceFavicon(document, 3.9);
    updateWorkspaceFavicon(document, 3);
    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(fillText).toHaveBeenLastCalledWith('3', 48, 17);

    updateWorkspaceFavicon(document, 14);
    expect(fillText).toHaveBeenLastCalledWith('9+', 48, 17);
    expect(link.href.startsWith('data:image/png')).toBe(true);

    // 4) Resetting totalUnread to 0, negative, NaN, or Infinity restores static 32px icon
    updateWorkspaceFavicon(document, Number.NaN);
    expect(link.getAttribute('href')).toBe('icons/icon-32.png');
    link.href = 'data:image/png;base64,stale';
    updateWorkspaceFavicon(document, Number.POSITIVE_INFINITY);
    expect(link.getAttribute('href')).toBe('icons/icon-32.png');
    link.href = 'data:image/png;base64,stale';
    updateWorkspaceFavicon(document, 0);
    expect(link.getAttribute('href')).toBe('icons/icon-32.png');
  });

  it('creates inline brand and action SVGs in the SVG namespace without external assets', () => {
    for (const id of ['zalo', 'messenger', 'telegram', 'discord'] as const) {
      const svg = createBrandIconSvg(id);
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('width')).toBe('15');
      expect(svg.classList.contains(`brand-icon-${id}`)).toBe(true);
    }
    for (const kind of [
      'maximize',
      'restore',
      'pause',
      'play',
      'reload',
      'reauth',
      'pin'
    ] as const) {
      const svg = createActionIconSvg(kind);
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('width')).toBe('13');
      expect(svg.classList.contains(`action-icon-${kind}`)).toBe(true);
    }
  });
});

describe('Workspace UI DOM integration (zero-reload Bento swap, pause, controls, runtime messages)', () => {
  const workspaceHtmlPath = resolve(process.cwd(), 'public/workspace.html');

  function loadWorkspaceMarkup(): void {
    const html = readFileSync(workspaceHtmlPath, 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.title = parsed.title;
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.className = '';
    document.body.removeAttribute('data-maximized');
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
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.body.className = '';
    document.body.removeAttribute('data-maximized');
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
    expect(dupBtn.textContent).toBe('Đóng 1 tab trùng');
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
    const runtimeListeners: Array<
      (msg: RuntimeMessage, sender?: chrome.runtime.MessageSender) => void
    > = [];

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
          addListener: vi.fn(
            (fn: (msg: RuntimeMessage, sender?: chrome.runtime.MessageSender) => void) => {
              runtimeListeners.push(fn);
            }
          ),
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

    // Verify all 4 SVG action buttons exist via data-action and zero debug fps text in headers
    const tgPauseBtn = telegramPane.querySelector<HTMLButtonElement>(
      'button[data-action="pause"]'
    )!;
    const tgReauthBtn = telegramPane.querySelector<HTMLButtonElement>(
      'button[data-action="reauth"]'
    )!;
    const tgMaximizeBtn = telegramPane.querySelector<HTMLButtonElement>(
      'button[data-action="maximize"]'
    )!;
    const tgReloadBtn = telegramPane.querySelector<HTMLButtonElement>(
      'button[data-action="reload"]'
    )!;
    expect(tgMaximizeBtn).not.toBeNull();
    expect(tgReloadBtn).not.toBeNull();
    for (const header of grid.querySelectorAll('.pane-header')) {
      expect(header.textContent).not.toContain('Main 60fps');
      expect(header.textContent).not.toContain('Sub 2fps');
    }

    // Pause Telegram -> about:blank + overlay shown + aria-label & data-paused updated
    tgPauseBtn.click();
    expect(telegramIframe.src).toBe('about:blank');
    expect(tgPauseBtn.dataset.paused).toBe('true');
    expect(tgPauseBtn.getAttribute('aria-label')).toBe('Mở lại khung');
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
    expect(document.title).toBe('(5) MultiChat Hub');

    // Pausing Telegram resets its unread count to 0 immediately
    tgPauseBtn.click();
    expect(totalBadge.textContent).toBe('2');
    expect(document.title).toBe('(2) MultiChat Hub');

    // Focusing paused Telegram wakes + swaps in a single savePrefs/applyLayout pass and focuses iframe
    sentRuntime.length = 0;
    const focusSpy = vi.spyOn(telegramIframe, 'focus');
    runtimeListeners[0]?.({ type: 'FOCUS_PROVIDER', providerId: 'telegram' });
    expect(telegramIframe.src).toBe('http://127.0.0.1:4321/telegram');
    expect(sentRuntime.filter((m) => m.type === 'SYNC_PREFS')).toHaveLength(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Topbar toggles sync prefs (including paused map) to background service worker
    sentRuntime.length = 0;
    document.getElementById('btn-lite-media')!.click();
    document.getElementById('btn-hide-preview')!.click();
    document.getElementById('btn-dnd')!.click();
    document.getElementById('btn-test-notify')!.click();

    expect(sentRuntime).toContainEqual({
      type: 'SYNC_PREFS',
      prefs: {
        dnd: true,
        hidePreview: true,
        liteMedia: true,
        paused: { zalo: false, messenger: false, telegram: false, discord: true }
      }
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

    // Pause Messenger, then wake via overlay button ("Mở lại ngay")
    const msgPauseBtn = messengerPane.querySelector<HTMLButtonElement>(
      'button[data-action="pause"]'
    )!;
    const msgReloadBtn = messengerPane.querySelector<HTMLButtonElement>(
      'button[data-action="reload"]'
    )!;
    msgPauseBtn.click();
    expect(messengerIframe.src).toBe('about:blank');
    messengerPane
      .querySelector<HTMLButtonElement>('.paused-overlay button')!
      .click();
    expect(messengerIframe.src).toBe('https://www.messenger.com/');

    // Pause Messenger again, then RELOAD_PROVIDER wakes it back up
    msgPauseBtn.click();
    expect(messengerIframe.src).toBe('about:blank');
    runtimeListeners[0]?.({ type: 'RELOAD_PROVIDER', providerId: 'messenger' });
    expect(messengerIframe.src).toBe('https://www.messenger.com/');

    // Reload button also wakes a paused pane directly
    msgPauseBtn.click();
    expect(messengerIframe.src).toBe('about:blank');
    msgReloadBtn.click();
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
    expect(dupBtn.textContent).toBe('Đóng 2 tab trùng');
    runtimeListeners[0]?.({ type: 'DUP_TABS_CHANGED', tabs: [] });
    expect(dupBtn.classList.contains('hidden')).toBe(true);

    // Resizer clears body.resizing if window blurs mid-drag
    const resizer = document.getElementById('grid-resizer')!;
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    expect(document.body.classList.contains('resizing')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(document.body.classList.contains('resizing')).toBe(false);
  });

  it('consumes pending cold-boot notification click target, reports visibilitychange focus state, and aborts cleanly on early pagehide', async () => {
    loadWorkspaceMarkup();
    const sentRuntime: RuntimeMessage[] = [];

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {})
        }
      },
      runtime: {
        sendMessage: vi.fn((msg: RuntimeMessage, cb?: (res: unknown) => void) => {
          sentRuntime.push(msg);
          if (msg.type === 'CONSUME_PENDING_CLICK') {
            cb?.({ target: { providerId: 'discord' } });
          } else {
            cb?.({});
          }
        }),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        },
        lastError: undefined
      }
    });

    await import('../../src/workspace/workspace');
    await flushMicrotasks();

    const grid = document.getElementById('bento-grid')!;
    const discordPane = grid.querySelector<HTMLElement>('section.pane[data-provider="discord"]')!;
    expect(discordPane.dataset.slot).toBe('main');

    // Tab switch (visibilityState -> hidden) immediately reports windowFocused: false
    const origVis = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true
    });
    sentRuntime.length = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sentRuntime).toContainEqual({
      type: 'WORKSPACE_FOCUS_STATE',
      windowFocused: false,
      focusedProvider: 'discord'
    });
    if (origVis) {
      Object.defineProperty(document, 'visibilityState', origVis);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }

    // Verify pagehide before loadPrefs resolves aborts boot cleanly without mounting panes
    window.dispatchEvent(new Event('pagehide'));
    vi.resetModules();
    loadWorkspaceMarkup();

    let resolveStorage!: (val: Record<string, unknown>) => void;
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(
            () =>
              new Promise<Record<string, unknown>>((r) => {
                resolveStorage = r;
              })
          ),
          set: vi.fn(async () => {})
        }
      },
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        lastError: undefined
      }
    });

    await import('../../src/workspace/workspace');
    window.dispatchEvent(new Event('pagehide'));
    resolveStorage({});
    await flushMicrotasks();
    expect(document.querySelectorAll('section.pane')).toHaveLength(0);
  });

  it('supports Auto-Hide Topbar pinning, Zero-Scroll-Loss Maximize 100% (button, Alt+M, Esc), splitter dblclick reset, and active-pane focus tracking', async () => {
    loadWorkspaceMarkup();

    const storedState: Record<string, unknown> = {};
    const sentRuntime: RuntimeMessage[] = [];
    const runtimeListeners: Array<
      (msg: RuntimeMessage, sender?: chrome.runtime.MessageSender) => void
    > = [];

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
          addListener: vi.fn(
            (fn: (msg: RuntimeMessage, sender?: chrome.runtime.MessageSender) => void) => {
              runtimeListeners.push(fn);
            }
          ),
          removeListener: vi.fn()
        },
        lastError: undefined
      }
    });

    await import('../../src/workspace/workspace');
    await flushMicrotasks();

    // 1) Topbar defaults to unpinned auto-hide with zero hanging text pill or "Dia" branding, clicking #btn-pin-topbar pins
    expect(document.body.classList.contains('topbar-pinned')).toBe(false);
    expect(document.getElementById('topbar-pill')).toBeNull();
    expect(document.getElementById('topbar-sensor')!.textContent?.trim()).toBe('');
    expect(document.body.textContent).not.toMatch(/\bdia\b/i);
    expect(document.querySelector('.brand')!.textContent).toBe('MultiChat Hub');
    const pinBtn = document.getElementById('btn-pin-topbar')!;
    const liteBtn = document.getElementById('btn-lite-media')!;
    const hideBtn = document.getElementById('btn-hide-preview')!;
    const dndBtn = document.getElementById('btn-dnd')!;
    expect(liteBtn.getAttribute('aria-pressed')).toBe('false');
    expect(hideBtn.getAttribute('aria-pressed')).toBe('false');
    expect(dndBtn.getAttribute('aria-pressed')).toBe('false');
    expect(pinBtn.getAttribute('aria-pressed')).toBe('false');
    expect(pinBtn.getAttribute('aria-label')).toBe('Ghim cố định thanh công cụ');
    expect(pinBtn.title).toBe('Ghim cố định thanh công cụ');

    pinBtn.click();
    expect(document.body.classList.contains('topbar-pinned')).toBe(true);
    expect(pinBtn.getAttribute('aria-pressed')).toBe('true');
    expect(pinBtn.getAttribute('aria-label')).toBe('Bỏ ghim thanh công cụ');
    expect(pinBtn.title).toBe('Bỏ ghim thanh công cụ');
    expect((storedState.dia_bento_prefs_v1 as WorkspacePrefs).topbarPinned).toBe(true);

    liteBtn.click();
    expect(liteBtn.getAttribute('aria-pressed')).toBe('true');

    // 2) Brand SVG icon and 4 SVG action buttons exist in every header with zero debug fps text
    const msgrPane = document.querySelector<HTMLElement>('section.pane[data-provider="messenger"]')!;
    const msgrIframe = msgrPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;
    expect(msgrPane.querySelector('svg.brand-icon')).not.toBeNull();
    expect(msgrPane.querySelector('.pane-header')!.textContent).not.toContain('2fps');

    // 3) Maximize Messenger via button keeps parent focus (does NOT call iframe.focus()) so Escape exits Maximize immediately
    const msgrFocusSpy = vi.spyOn(msgrIframe, 'focus');
    const msgrMaxBtn = msgrPane.querySelector<HTMLButtonElement>('button[data-action="maximize"]')!;
    msgrMaxBtn.click();
    expect(document.body.dataset.maximized).toBe('messenger');
    expect(msgrPane.dataset.maximized).toBe('true');
    expect(msgrFocusSpy).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(document.body.dataset.maximized).toBeUndefined();
    expect(msgrPane.dataset.maximized).toBeUndefined();

    // Note: maximizing Messenger set activeProvider = 'messenger'; focus Zalo first so active pane is 'zalo'
    runtimeListeners[0]?.({ type: 'ACTIVE_PROVIDER_CHANGED', providerId: 'zalo' });
    const zaloPane = document.querySelector<HTMLElement>('section.pane[data-provider="zalo"]')!;
    const zaloIframe = zaloPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;
    const zaloFocusSpy = vi.spyOn(zaloIframe, 'focus');

    // Alt+M (macOS Option+M: code KeyM, key 'µ') toggles Maximize on currently active pane (zalo) and focuses iframe
    window.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, code: 'KeyM', key: 'µ', cancelable: true })
    );
    expect(document.body.dataset.maximized).toBe('zalo');
    expect(zaloFocusSpy).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, code: 'KeyM', key: 'µ', cancelable: true })
    );
    expect(document.body.dataset.maximized).toBeUndefined();

    // Runtime TOGGLE_MAXIMIZE forwarded from service worker toggles Maximize once; direct content-script fan-out (sender.tab defined) is ignored to prevent double-toggle
    const tgPane = document.querySelector<HTMLElement>('section.pane[data-provider="telegram"]')!;
    const tgIframe = tgPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;
    const tgFocusSpy = vi.spyOn(tgIframe, 'focus');
    const tabSender = { tab: { id: 10 } } as unknown as chrome.runtime.MessageSender;
    runtimeListeners[0]?.({ type: 'TOGGLE_MAXIMIZE', providerId: 'telegram' }, tabSender);
    expect(document.body.dataset.maximized).toBeUndefined();
    runtimeListeners[0]?.({ type: 'TOGGLE_MAXIMIZE', providerId: 'telegram' });
    expect(document.body.dataset.maximized).toBe('telegram');
    expect(tgFocusSpy).toHaveBeenCalledTimes(1);
    runtimeListeners[0]?.({ type: 'TOGGLE_MAXIMIZE', providerId: 'telegram' }, tabSender);
    expect(document.body.dataset.maximized).toBe('telegram');
    runtimeListeners[0]?.({ type: 'TOGGLE_MAXIMIZE', providerId: 'telegram' });
    expect(document.body.dataset.maximized).toBeUndefined();

    // Auto-Hide Topbar hover handshake notifies mounted iframes on open and clears .is-hovered on DIA_FRAME_HOVER
    const topbarShell = document.getElementById('topbar-shell')!;
    const tgPostSpy = vi.fn();
    const fakeTgWin = { postMessage: tgPostSpy } as unknown as Window;
    Object.defineProperty(tgIframe, 'contentWindow', {
      value: fakeTgWin,
      configurable: true
    });
    topbarShell.dispatchEvent(new MouseEvent('mouseenter'));
    expect(topbarShell.classList.contains('is-hovered')).toBe(true);
    expect(tgPostSpy).toHaveBeenCalledWith(
      { source: 'dia-bento-workspace', type: 'DIA_TOPBAR_OPEN' },
      '*'
    );
    // Untrusted source window cannot clear .is-hovered
    window.dispatchEvent(
      new MessageEvent('message', {
        source: {} as Window,
        data: { source: 'dia-bento-frame', type: 'DIA_FRAME_HOVER' }
      })
    );
    expect(topbarShell.classList.contains('is-hovered')).toBe(true);
    // Mounted pane iframe window clears .is-hovered immediately
    window.dispatchEvent(
      new MessageEvent('message', {
        source: fakeTgWin,
        data: { source: 'dia-bento-frame', type: 'DIA_FRAME_HOVER' }
      })
    );
    expect(topbarShell.classList.contains('is-hovered')).toBe(false);

    // 4) Splitter drag updates #resize-indicator and double-click resets --main-width to 66%
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const resizer = document.getElementById('grid-resizer')!;
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 660, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 520 }));
    expect(document.getElementById('resize-indicator')!.textContent).toBe('Chính 52% • Phụ 48%');
    window.dispatchEvent(new MouseEvent('mouseup'));

    resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(document.documentElement.style.getPropertyValue('--main-width')).toBe('66%');
    expect((storedState.dia_bento_prefs_v1 as WorkspacePrefs).mainWidthPct).toBe(66);

    // 5) ACTIVE_PROVIDER_CHANGED moves data-active="true" to sub-pane without swapping slots
    runtimeListeners[0]?.({ type: 'ACTIVE_PROVIDER_CHANGED', providerId: 'telegram' });
    expect(tgPane.dataset.active).toBe('true');
    expect(zaloPane.dataset.active).toBe('false');
    expect(zaloPane.dataset.slot).toBe('main');

    // Window blur while Discord iframe is document.activeElement updates active pane to Discord AND reports windowFocused: false
    const discordPane = document.querySelector<HTMLElement>(
      'section.pane[data-provider="discord"]'
    )!;
    const discordIframe = discordPane.querySelector<HTMLIFrameElement>('iframe.pane-iframe')!;
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const origActiveEl = Object.getOwnPropertyDescriptor(document, 'activeElement');
    Object.defineProperty(document, 'activeElement', {
      value: discordIframe,
      configurable: true
    });
    sentRuntime.length = 0;
    window.dispatchEvent(new Event('blur'));
    if (origActiveEl) {
      Object.defineProperty(document, 'activeElement', origActiveEl);
    } else {
      Reflect.deleteProperty(document, 'activeElement');
    }
    expect(discordPane.dataset.active).toBe('true');
    expect(tgPane.dataset.active).toBe('false');
    expect(sentRuntime).toContainEqual({
      type: 'WORKSPACE_FOCUS_STATE',
      windowFocused: false,
      focusedProvider: 'discord'
    });
  });
});
