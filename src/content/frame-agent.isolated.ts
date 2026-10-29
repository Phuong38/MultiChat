import type {
  IsolatedToMainEvent,
  MainToIsolatedEvent,
  RuntimeMessage,
  WorkspaceToFrameMessage
} from '../shared/types';
import {
  PROVIDERS,
  extractUnreadFromDom,
  matchProviderByUrl,
  parseUnreadFromTitle
} from '../providers/registry';
import { UnreadFallbackTracker, syncSubPaneDiet } from './unread-observer';

(() => {
  if (window === window.top) return;

  const providerId = matchProviderByUrl(window.location.href);
  if (!providerId) return;

  const MAIN_TO_ISO = '__dia_main_to_iso__';
  const ISO_TO_MAIN = '__dia_iso_to_main__';

  let isMainSlot = providerId === 'zalo';
  let isHovered = false;
  let lastReportedUnread = -1;
  let domBooted = false;
  let observer: MutationObserver | null = null;
  let pollTimer: number | null = null;

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
    sendToBackground({
      type: 'CHAT_NOTIFY',
      payload: {
        providerId,
        title: PROVIDERS[providerId].name,
        body: `Ban co ${count} tin nhan chua doc`,
        tag: `fallback-${providerId}`
      }
    });
  });

  const evaluateUnread = (): void => {
    const titleCount = parseUnreadFromTitle(providerId, document.title || '');
    const domCount = document.body ? extractUnreadFromDom(providerId, document) : 0;
    const count = titleCount > 0 ? titleCount : domCount;
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
    pollTimer = window.setInterval(evaluateUnread, 3000);
  };

  window.addEventListener(MAIN_TO_ISO, onMainToIso);
  window.addEventListener('message', onWindowMessage);

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootDomObservers, { once: true });
  } else {
    bootDomObservers();
  }

  window.addEventListener('pagehide', (ev: Event) => {
    if (!(ev as PageTransitionEvent).persisted) {
      window.removeEventListener(MAIN_TO_ISO, onMainToIso);
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('DOMContentLoaded', bootDomObservers);
      document.documentElement?.removeEventListener('mouseenter', onMouseEnter);
      document.documentElement?.removeEventListener('mouseleave', onMouseLeave);
      observer?.disconnect();
      observer = null;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      fallbackTracker.dispose();
    }
  });
})();
