import type { NotifyPayload, ProviderId } from '../shared/types';
import { PROVIDERS } from '../providers/registry';

export type CreateNotificationFn = (
  notificationId: string,
  options: chrome.notifications.NotificationOptions<true>
) => Promise<void>;

const DEDUP_WINDOW_MS = 3000;
const MAX_STORED_TOKENS = 100;
const MAX_ENCODED_TOKEN_LEN = 256;

export class NotifyRouter {
  private dnd = false;
  private hidePreview = false;
  private windowFocused = false;
  private focusedProvider: ProviderId | null = null;
  private recentFingerprints = new Map<string, number>();
  private tokenByNotifId = new Map<string, { providerId: ProviderId; notifToken?: string }>();
  private seq = 0;

  constructor(
    private readonly createNotification: CreateNotificationFn,
    private readonly iconUrl: string
  ) {}

  setPrefs(prefs: { dnd: boolean; hidePreview: boolean }): void {
    this.dnd = prefs.dnd;
    this.hidePreview = prefs.hidePreview;
  }

  setFocusState(state: { windowFocused: boolean; focusedProvider: ProviderId | null }): void {
    this.windowFocused = state.windowFocused;
    this.focusedProvider = state.focusedProvider;
  }

  async handleIncoming(payload: NotifyPayload, nowMs = Date.now()): Promise<string | null> {
    if (!Object.hasOwn(PROVIDERS, payload.providerId)) return null;
    if (this.dnd) return null;
    if (this.windowFocused && this.focusedProvider === payload.providerId) {
      return null;
    }

    this.pruneOld(nowMs);
    const dedupKey = `${payload.providerId}:${payload.tag || `${payload.title}|${payload.body}`}`;
    const lastSeen = this.recentFingerprints.get(dedupKey);
    if (typeof lastSeen === 'number' && nowMs - lastSeen < DEDUP_WINDOW_MS) {
      return null;
    }
    this.recentFingerprints.set(dedupKey, nowMs);

    const providerName = PROVIDERS[payload.providerId].name;
    const trimmedTitle = payload.title.trim();
    const title =
      this.hidePreview || !trimmedTitle
        ? providerName
        : trimmedTitle.startsWith(providerName)
          ? trimmedTitle
          : `${providerName} - ${trimmedTitle}`;
    const message = this.hidePreview ? 'Co tin nhan moi' : payload.body || 'Tin nhan moi';

    this.seq += 1;
    const rawEncoded = payload.notifToken ? encodeURIComponent(payload.notifToken) : '';
    const tokenSuffix =
      rawEncoded && rawEncoded.length <= MAX_ENCODED_TOKEN_LEN ? `:${rawEncoded}` : '';
    const notifId = `dia-chat:${payload.providerId}:${nowMs}:${this.seq}${tokenSuffix}`;
    const target: { providerId: ProviderId; notifToken?: string } =
      payload.notifToken !== undefined
        ? { providerId: payload.providerId, notifToken: payload.notifToken }
        : { providerId: payload.providerId };
    this.tokenByNotifId.set(notifId, target);
    if (this.tokenByNotifId.size > MAX_STORED_TOKENS) {
      const oldestKey = this.tokenByNotifId.keys().next().value;
      if (oldestKey) this.tokenByNotifId.delete(oldestKey);
    }

    try {
      await this.createNotification(notifId, {
        type: 'basic',
        iconUrl: this.iconUrl,
        title,
        message,
        priority: 2
      });
    } catch (err) {
      this.recentFingerprints.delete(dedupKey);
      this.tokenByNotifId.delete(notifId);
      throw err;
    }
    return notifId;
  }

  parseNotificationClick(
    notifId: string
  ): { providerId: ProviderId; notifToken?: string } | null {
    const stored = this.tokenByNotifId.get(notifId);
    if (stored) {
      this.tokenByNotifId.delete(notifId);
      return stored;
    }
    const parts = notifId.split(':');
    if (parts[0] === 'dia-chat' && parts[1] && Object.hasOwn(PROVIDERS, parts[1])) {
      const providerId = parts[1] as ProviderId;
      if (parts[4]) {
        try {
          return { providerId, notifToken: decodeURIComponent(parts[4]) };
        } catch {
          return { providerId };
        }
      }
      return { providerId };
    }
    return null;
  }

  private pruneOld(nowMs: number): void {
    for (const [key, ts] of this.recentFingerprints.entries()) {
      if (nowMs - ts >= DEDUP_WINDOW_MS) {
        this.recentFingerprints.delete(key);
      }
    }
  }
}
