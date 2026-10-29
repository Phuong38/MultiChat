const STYLE_ID = 'dia-sub-diet';

export class UnreadFallbackTracker {
  private prevCount = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private recentRawNotifyAt: number | null = null;

  constructor(
    private readonly fallbackDelayMs: number,
    private readonly onFallbackNotify: (unreadCount: number) => void
  ) {}

  onUnreadCount(nextCount: number): void {
    const increased = nextCount > this.prevCount;
    this.prevCount = nextCount;
    if (nextCount <= 0) {
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      return;
    }
    if (!increased) return;

    if (this.recentRawNotifyAt !== null) {
      const elapsed = Date.now() - this.recentRawNotifyAt;
      this.recentRawNotifyAt = null;
      if (elapsed >= 0 && elapsed < this.fallbackDelayMs) {
        return;
      }
    }

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }
    this.timerId = setTimeout(() => {
      this.timerId = null;
      if (this.prevCount > 0) {
        this.onFallbackNotify(this.prevCount);
      }
    }, this.fallbackDelayMs);
  }

  onRawNotify(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
      this.recentRawNotifyAt = null;
      return;
    }
    this.recentRawNotifyAt = Date.now();
  }

  dispose(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.recentRawNotifyAt = null;
  }
}

export function syncSubPaneDiet(doc: Document, cssText: string, enabled: boolean): void {
  const existing = doc.getElementById(STYLE_ID);
  if (!enabled) {
    existing?.remove();
    return;
  }
  if (!existing) {
    const mountTarget = doc.head ?? doc.documentElement;
    if (mountTarget) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = cssText;
      mountTarget.appendChild(style);
    }
  } else if (existing.textContent !== cssText) {
    existing.textContent = cssText;
  }
  for (const video of doc.querySelectorAll('video')) {
    if (!video.paused) {
      try {
        video.pause();
      } catch {
        // Ignore unimplemented media pause in non-browser environments
      }
    }
  }
}
