import type { IsolatedToMainEvent, MainToIsolatedEvent } from '../shared/types';
import { installNotificationHook, installRafGovernor } from './raf-governor';

(() => {
  if (window === window.top) return;

  const MAIN_TO_ISO = '__dia_main_to_iso__';
  const ISO_TO_MAIN = '__dia_iso_to_main__';

  const governor = installRafGovernor(window, 500);
  const notifyHook = installNotificationHook(window, (payload: MainToIsolatedEvent) => {
    window.dispatchEvent(
      new CustomEvent<string>(MAIN_TO_ISO, { detail: JSON.stringify(payload) })
    );
  });

  const onIsoToMain = (rawEv: Event): void => {
    const detail = (rawEv as CustomEvent<string>).detail;
    if (typeof detail !== 'string' || !detail) return;
    let cmd: IsolatedToMainEvent;
    try {
      cmd = JSON.parse(detail) as IsolatedToMainEvent;
    } catch {
      return;
    }
    if (!cmd || typeof cmd !== 'object') return;
    if (cmd.type === 'SET_THROTTLE' && typeof cmd.throttled === 'boolean') {
      governor.setThrottled(cmd.throttled);
    } else if (cmd.type === 'CLICK_NOTIFY' && typeof cmd.notifToken === 'string') {
      notifyHook.triggerClick(cmd.notifToken);
    }
  };

  window.addEventListener(ISO_TO_MAIN, onIsoToMain);
  window.addEventListener('pagehide', (ev: Event) => {
    if (!(ev as PageTransitionEvent).persisted) {
      window.removeEventListener(ISO_TO_MAIN, onIsoToMain);
    }
  });
})();
