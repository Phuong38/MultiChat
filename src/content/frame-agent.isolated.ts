import type {
  IsolatedToMainEvent,
  MainToIsolatedEvent,
  RuntimeMessage,
  WorkspaceToFrameMessage
} from '../shared/types';
import { extractAltShortcutDigit, isAltMaximizeShortcut } from '../shared/shortcuts';
import {
  PROVIDER_ORDER,
  PROVIDERS,
  extractUnreadPreviewFromDom,
  matchProviderByUrl,
  resolveProviderUnreadCount
} from '../providers/registry';
import { UnreadFallbackTracker, syncSubPaneDiet } from './unread-observer';

(() => {
  if (window === window.top) return;
  if (window.parent !== window.top) return;
  const runtimeId = globalThis.chrome?.runtime?.id;
  const expectedExtensionOrigin =
    typeof runtimeId === 'string' && runtimeId.length > 0
      ? `chrome-extension://${runtimeId}`
      : null;
  const ancestors = window.location.ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    const parentOrigin = ancestors[0];
    if (expectedExtensionOrigin) {
      if (parentOrigin !== expectedExtensionOrigin) return;
    } else if (!parentOrigin?.startsWith('chrome-extension://')) {
      return;
    }
  }

  const providerId = matchProviderByUrl(window.location.href);
  if (!providerId) return;

  const MAIN_TO_ISO = '__dia_main_to_iso__';
  const ISO_TO_MAIN = '__dia_iso_to_main__';

  let isMainSlot = providerId === 'zalo';
  let isHovered = false;
  let lastReportedUnread = -1;
  let lastFocusSentAt = -Infinity;
  let domBooted = false;
  let observer: MutationObserver | null = null;
  let bodyObserver: MutationObserver | null = null;
  let bodyDebounceTimer: number | null = null;
  let pollTimer: number | null = null;
  let rawNotifySyncTimer: number | null = null;

  const sendToMain = (cmd: IsolatedToMainEvent): void => {
    window.dispatchEvent(new CustomEvent<string>(ISO_TO_MAIN, { detail: JSON.stringify(cmd) }));
  };

  const sendToBackground = (msg: RuntimeMessage): void => {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch {
      // Extension context invalidated during reload
    }
  };

  const applySlotPolicy = (): void => {
    const shouldThrottle = !isMainSlot && !isHovered;
    sendToMain({ type: 'SET_THROTTLE', throttled: shouldThrottle });
    syncSubPaneDiet(document, PROVIDERS[providerId].subPaneCss, !isMainSlot);
  };

  const fallbackTracker = new UnreadFallbackTracker(1500, (count) => {
    const preview = document.body ? extractUnreadPreviewFromDom(providerId, document.body) : null;
    const title = preview?.sender || PROVIDERS[providerId].name;
    const body = preview?.snippet || `Bạn có ${count} tin nhắn chưa đọc`;
    const tag = preview?.sender
      ? `fallback-${providerId}-${preview.sender}${preview.snippet ? `-${preview.snippet.slice(0, 24)}` : ''}`
      : `fallback-${providerId}`;
    sendToBackground({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId,
        title,
        body,
        tag
      }
    });
  });

  const evaluateUnread = (): void => {
    const count = resolveProviderUnreadCount(
      providerId,
      document.title || '',
      document.body ?? null
    );
    if (count !== lastReportedUnread) {
      lastReportedUnread = count;
      sendToBackground({ type: 'UNREAD_UPDATE', providerId, count });
    }
    fallbackTracker.onUnreadCount(count);
  };

  const onMainToIso = (rawEv: Event): void => {
    const detail = (rawEv as CustomEvent<string>).detail;
    if (typeof detail !== 'string' || !detail) return;
    let parsed: MainToIsolatedEvent;
    try {
      parsed = JSON.parse(detail) as MainToIsolatedEvent;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.type === 'RAW_NOTIFY') {
      fallbackTracker.onRawNotify();
      if (rawNotifySyncTimer !== null) {
        window.clearTimeout(rawNotifySyncTimer);
      }
      rawNotifySyncTimer = window.setTimeout(() => {
        rawNotifySyncTimer = null;
        evaluateUnread();
      }, 250);
      const title =
        typeof parsed.title === 'string' && parsed.title
          ? parsed.title
          : PROVIDERS[providerId].name;
      const body = typeof parsed.body === 'string' ? parsed.body : '';
      const tag = typeof parsed.tag === 'string' && parsed.tag ? parsed.tag : undefined;
      const notifToken =
        typeof parsed.notifToken === 'string' && parsed.notifToken ? parsed.notifToken : undefined;
      sendToBackground({
        type: 'CHAT_NOTIFY',
        payload: {
          providerId,
          title,
          body,
          tag,
          notifToken
        }
      });
    }
  };

  const onWindowMessage = (ev: MessageEvent): void => {
    if (expectedExtensionOrigin) {
      if (ev.origin !== expectedExtensionOrigin) return;
    } else if (!ev.origin || !ev.origin.startsWith('chrome-extension://')) {
      return;
    }
    const data = ev.data as
      | WorkspaceToFrameMessage
      | { source?: unknown; type?: unknown; providerId?: unknown; isMain?: unknown; notifToken?: unknown }
      | null;
    if (!data || typeof data !== 'object') return;
    if (
      'source' in data &&
      data.source === 'dia-bento-workspace' &&
      data.type === 'DIA_SLOT_MODE' &&
      typeof data.isMain === 'boolean'
    ) {
      if (typeof data.providerId === 'string' && data.providerId !== providerId) {
        return;
      }
      isMainSlot = data.isMain;
      applySlotPolicy();
    } else if (data.type === 'DIA_CLICK_NOTIFY' && typeof data.notifToken === 'string') {
      sendToMain({ type: 'CLICK_NOTIFY', notifToken: data.notifToken });
    }
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (isAltMaximizeShortcut(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.repeat) return;
      sendToBackground({ type: 'TOGGLE_MAXIMIZE', providerId });
      return;
    }
    const digit = extractAltShortcutDigit(ev);
    if (digit === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.repeat) return;
    const target = PROVIDER_ORDER[digit - 1];
    if (target) {
      sendToBackground({ type: 'FOCUS_PROVIDER', providerId: target });
    }
  };

  const onFrameInteraction = (): void => {
    const now = Date.now();
    if (now - lastFocusSentAt < 800) return;
    lastFocusSentAt = now;
    sendToBackground({ type: 'FRAME_FOCUSED', providerId });
  };

  const onMouseEnter = (): void => {
    isHovered = true;
    applySlotPolicy();
  };

  const onMouseLeave = (): void => {
    isHovered = false;
    applySlotPolicy();
  };

  const bootDomObservers = (): void => {
    if (domBooted) return;
    domBooted = true;
    applySlotPolicy();
    evaluateUnread();

    document.documentElement?.addEventListener('mouseenter', onMouseEnter);
    document.documentElement?.addEventListener('mouseleave', onMouseLeave);

    observer = new MutationObserver(() => evaluateUnread());
    const observeRoot = document.head ?? document.documentElement;
    if (observeRoot) {
      observer.observe(observeRoot, { subtree: true, childList: true, characterData: true });
    }
    const titleEl = document.querySelector('title');
    if (titleEl && (!observeRoot || !observeRoot.contains(titleEl))) {
      observer.observe(titleEl, { subtree: true, childList: true, characterData: true });
    }
    if (document.body) {
      bodyObserver = new MutationObserver(() => {
        if (bodyDebounceTimer !== null) return;
        bodyDebounceTimer = window.setTimeout(() => {
          bodyDebounceTimer = null;
          evaluateUnread();
        }, 200);
      });
      bodyObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
    pollTimer = window.setInterval(evaluateUnread, 3000);
  };

  window.addEventListener(MAIN_TO_ISO, onMainToIso);
  window.addEventListener('message', onWindowMessage);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onFrameInteraction, true);
  window.addEventListener('focusin', onFrameInteraction, true);

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootDomObservers, { once: true });
  } else {
    bootDomObservers();
  }

  window.addEventListener('pagehide', (ev: Event) => {
    if (!(ev as PageTransitionEvent).persisted) {
      window.removeEventListener(MAIN_TO_ISO, onMainToIso);
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onFrameInteraction, true);
      window.removeEventListener('focusin', onFrameInteraction, true);
      window.removeEventListener('DOMContentLoaded', bootDomObservers);
      document.documentElement?.removeEventListener('mouseenter', onMouseEnter);
      document.documentElement?.removeEventListener('mouseleave', onMouseLeave);
      observer?.disconnect();
      observer = null;
      bodyObserver?.disconnect();
      bodyObserver = null;
      if (bodyDebounceTimer !== null) {
        window.clearTimeout(bodyDebounceTimer);
        bodyDebounceTimer = null;
      }
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      if (rawNotifySyncTimer !== null) {
        window.clearTimeout(rawNotifySyncTimer);
        rawNotifySyncTimer = null;
      }
      fallbackTracker.dispose();
    }
  });
})();
