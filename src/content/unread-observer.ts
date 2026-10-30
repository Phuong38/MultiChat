const STYLE_ID = 'dia-sub-diet';

export class UnreadFallbackTracker {
  private prevCount = 0;
  private lastPreviewKey: string | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private recentRawNotifyAt: number | null = null;
  private suppressPreviewChangeUntil: number | null = null;

  constructor(
    private readonly fallbackDelayMs: number,
    private readonly onFallbackNotify: (unreadCount: number) => void
  ) {}

  onUnreadCount(nextCount: number, previewKey?: string | null): void {
    const normalizedPreview =
      typeof previewKey === 'string' && previewKey.length > 0 ? previewKey : null;
    const wasPositive = this.prevCount > 0;
    const increased = nextCount > this.prevCount;
    const previewChanged =
      nextCount > 0 &&
      !increased &&
      normalizedPreview !== null &&
      this.lastPreviewKey !== null &&
      normalizedPreview !== this.lastPreviewKey;

    this.prevCount = nextCount;
    if (nextCount <= 0) {
      this.lastPreviewKey = null;
      if (wasPositive) {
        this.recentRawNotifyAt = null;
      }
      this.suppressPreviewChangeUntil = null;
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      return;
    }

    if (!increased && !previewChanged) {
      if (normalizedPreview !== null && this.lastPreviewKey === null) {
        this.lastPreviewKey = normalizedPreview;
      }
      return;
    }

    if (normalizedPreview !== null) {
      this.lastPreviewKey = normalizedPreview;
    }

    const now = Date.now();
    if (
      previewChanged &&
      this.suppressPreviewChangeUntil !== null &&
      now < this.suppressPreviewChangeUntil
    ) {
      this.suppressPreviewChangeUntil = null;
      return;
    }

    if (this.recentRawNotifyAt !== null) {
      const elapsed = now - this.recentRawNotifyAt;
      const suppressionWindowMs = Math.max(this.fallbackDelayMs * 4, 6000);
      this.recentRawNotifyAt = null;
      if (elapsed >= 0 && elapsed < suppressionWindowMs) {
        if (increased) {
          this.suppressPreviewChangeUntil = now + 1000;
        }
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

  onRawNotify(previewKey?: string | null): void {
    if (typeof previewKey === 'string' && previewKey.length > 0) {
      this.lastPreviewKey = previewKey;
    }
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
      this.recentRawNotifyAt = null;
      return;
    }
    this.recentRawNotifyAt = Date.now();
  }

  recordNotifiedPreview(previewKey: string): void {
    if (previewKey.length > 0) {
      this.lastPreviewKey = previewKey;
    }
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
      this.recentRawNotifyAt = null;
    }
  }

  dispose(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.recentRawNotifyAt = null;
    this.suppressPreviewChangeUntil = null;
    this.lastPreviewKey = null;
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
