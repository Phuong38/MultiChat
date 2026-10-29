import type { MainToIsolatedEvent } from '../shared/types';

export function installRafGovernor(
  targetWin: Window & typeof globalThis,
  idleIntervalMs = 500
): { setThrottled(throttled: boolean): void; isThrottled(): boolean } {
  const origRaf = targetWin.requestAnimationFrame.bind(targetWin);
  const origCaf = targetWin.cancelAnimationFrame.bind(targetWin);
  let throttled = false;
  let syntheticIdSeq = 900_000_000;
  const timerByHandle = new Map<number, number>();

  targetWin.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
    if (!throttled) {
      return origRaf(callback);
    }
    syntheticIdSeq += 1;
    const handle = syntheticIdSeq;
    const timerId = targetWin.setTimeout(() => {
      timerByHandle.delete(handle);
      const now = targetWin.performance ? targetWin.performance.now() : Date.now();
      callback(now);
    }, idleIntervalMs);
    timerByHandle.set(handle, timerId);
    return handle;
  }) as typeof targetWin.requestAnimationFrame;

  targetWin.cancelAnimationFrame = ((handle: number): void => {
    const timerId = timerByHandle.get(handle);
    if (timerId !== undefined) {
      targetWin.clearTimeout(timerId);
      timerByHandle.delete(handle);
      return;
    }
    origCaf(handle);
  }) as typeof targetWin.cancelAnimationFrame;

  return {
    setThrottled(next: boolean): void {
      throttled = next;
    },
    isThrottled(): boolean {
      return throttled;
    }
  };
}

interface StoredNotifyTarget {
  onclick: ((this: Notification, ev: Event) => unknown) | null;
  dispatchEvent: (ev: Event) => boolean;
}

export function installNotificationHook(
  targetWin: Window & typeof globalThis,
  onRawNotify: (ev: MainToIsolatedEvent) => void
): { triggerClick(notifToken: string): boolean } {
  const instances = new Map<string, StoredNotifyTarget>();
  let tokenSeq = 0;

  class DiaNotificationProxy extends EventTarget {
    static permission: NotificationPermission = 'granted';
    static maxActions = 2;

    static requestPermission(
      deprecatedCallback?: NotificationPermissionCallback
    ): Promise<NotificationPermission> {
      deprecatedCallback?.('granted');
      return Promise.resolve('granted');
    }

    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly icon: string;
    readonly data: unknown;
    onclick: ((this: Notification, ev: Event) => unknown) | null = null;
    onclose: ((this: Notification, ev: Event) => unknown) | null = null;
    onerror: ((this: Notification, ev: Event) => unknown) | null = null;
    onshow: ((this: Notification, ev: Event) => unknown) | null = null;

    constructor(title: string, options: NotificationOptions = {}) {
      super();
      this.title = String(title ?? '');
      this.body = String(options.body ?? '');
      this.tag = String(options.tag ?? '');
      this.icon = String(options.icon ?? '');
      this.data = options.data ?? null;

      tokenSeq += 1;
      const notifToken = `nt-${Date.now()}-${tokenSeq}`;
      instances.set(notifToken, this);
      if (instances.size > 50) {
        const oldest = instances.keys().next().value;
        if (oldest) instances.delete(oldest);
      }

      onRawNotify({
        type: 'RAW_NOTIFY',
        title: this.title,
        body: this.body,
        tag: this.tag || undefined,
        notifToken
      });
    }

    close(): void {
      const ev = new Event('close');
      this.onclose?.call(this as unknown as Notification, ev);
      this.dispatchEvent(ev);
    }
  }

  Object.defineProperty(targetWin, 'Notification', {
    value: DiaNotificationProxy,
    configurable: true,
    writable: true
  });

  return {
    triggerClick(notifToken: string): boolean {
      const target = instances.get(notifToken);
      if (!target) return false;
      const ev = new Event('click');
      target.onclick?.call(target as unknown as Notification, ev);
      target.dispatchEvent(ev);
      return true;
    }
  };
}
