import type { ProviderId, SlotId, WorkspacePrefs } from '../shared/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers/registry';

export const SLOT_IDS: readonly [SlotId, SlotId, SlotId, SlotId] = [
  'main',
  'sub-1',
  'sub-2',
  'sub-3'
];

export const DEFAULT_PREFS: WorkspacePrefs = {
  slotOrder: ['zalo', 'messenger', 'telegram', 'discord'],
  mainWidthPct: 66,
  dnd: false,
  hidePreview: false,
  liteMedia: false,
  paused: {
    zalo: false,
    messenger: false,
    telegram: false,
    discord: false
  }
};

function isProviderId(val: unknown): val is ProviderId {
  return typeof val === 'string' && Object.hasOwn(PROVIDERS, val);
}

function isValidSlotOrder(
  raw: unknown
): raw is [ProviderId, ProviderId, ProviderId, ProviderId] {
  if (!Array.isArray(raw) || raw.length !== 4) return false;
  const [a, b, c, d] = raw;
  if (!isProviderId(a) || !isProviderId(b) || !isProviderId(c) || !isProviderId(d)) {
    return false;
  }
  return new Set([a, b, c, d]).size === 4;
}

function normalizeLocalTestOrigin(testOrigin: string | null): string | null {
  if (typeof testOrigin !== 'string') return null;
  const trimmed = testOrigin.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:') return null;
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    if (parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function swapProviderToMain(
  order: readonly [ProviderId, ProviderId, ProviderId, ProviderId],
  target: ProviderId
): [ProviderId, ProviderId, ProviderId, ProviderId] {
  const next: [ProviderId, ProviderId, ProviderId, ProviderId] = [...order];
  const idx = next.indexOf(target);
  if (idx === 1 || idx === 2 || idx === 3) {
    const prevMain = next[0];
    next[0] = target;
    next[idx] = prevMain;
  }
  return next;
}

export function clampMainWidth(pct: number): number {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return DEFAULT_PREFS.mainWidthPct;
  return Math.min(80, Math.max(45, Math.round(pct)));
}

export function formatWorkspaceTitle(unreads: Record<ProviderId, number>): string {
  const total = PROVIDER_ORDER.reduce((sum, id) => {
    const val = unreads[id];
    const safe =
      typeof val === 'number' && Number.isFinite(val) && val > 0 ? Math.floor(val) : 0;
    return sum + safe;
  }, 0);
  return total > 0 ? `(${total}) Dia Bento Chat Hub` : 'Dia Bento Chat Hub';
}

export function resolveEmbedUrl(providerId: ProviderId, testOrigin: string | null): string {
  const safeOrigin = normalizeLocalTestOrigin(testOrigin);
  if (safeOrigin) {
    return `${safeOrigin}/${providerId}`;
  }
  return PROVIDERS[providerId].embedUrl;
}

export function sanitizeWorkspacePrefs(raw: unknown): WorkspacePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      slotOrder: [...DEFAULT_PREFS.slotOrder],
      mainWidthPct: DEFAULT_PREFS.mainWidthPct,
      dnd: DEFAULT_PREFS.dnd,
      hidePreview: DEFAULT_PREFS.hidePreview,
      liteMedia: DEFAULT_PREFS.liteMedia,
      paused: { ...DEFAULT_PREFS.paused }
    };
  }

  const obj = raw as Record<string, unknown>;
  const slotOrder: [ProviderId, ProviderId, ProviderId, ProviderId] = isValidSlotOrder(
    obj.slotOrder
  )
    ? [obj.slotOrder[0], obj.slotOrder[1], obj.slotOrder[2], obj.slotOrder[3]]
    : [...DEFAULT_PREFS.slotOrder];

  const mainWidthPct =
    typeof obj.mainWidthPct === 'number'
      ? clampMainWidth(obj.mainWidthPct)
      : DEFAULT_PREFS.mainWidthPct;

  const dnd = typeof obj.dnd === 'boolean' ? obj.dnd : DEFAULT_PREFS.dnd;
  const hidePreview =
    typeof obj.hidePreview === 'boolean' ? obj.hidePreview : DEFAULT_PREFS.hidePreview;
  const liteMedia =
    typeof obj.liteMedia === 'boolean' ? obj.liteMedia : DEFAULT_PREFS.liteMedia;

  const rawPaused =
    obj.paused && typeof obj.paused === 'object' && !Array.isArray(obj.paused)
      ? (obj.paused as Record<string, unknown>)
      : null;

  const paused: Record<ProviderId, boolean> = {
    zalo: typeof rawPaused?.zalo === 'boolean' ? rawPaused.zalo : DEFAULT_PREFS.paused.zalo,
    messenger:
      typeof rawPaused?.messenger === 'boolean'
        ? rawPaused.messenger
        : DEFAULT_PREFS.paused.messenger,
    telegram:
      typeof rawPaused?.telegram === 'boolean'
        ? rawPaused.telegram
        : DEFAULT_PREFS.paused.telegram,
    discord:
      typeof rawPaused?.discord === 'boolean' ? rawPaused.discord : DEFAULT_PREFS.paused.discord
  };

  return {
    slotOrder,
    mainWidthPct,
    dnd,
    hidePreview,
    liteMedia,
    paused
  };
}

export function extractAltShortcutDigit(
  ev: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>
): 1 | 2 | 3 | 4 | null {
  if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return null;
  const rawDigit = /^Digit([1-4])$/.exec(ev.code ?? '')?.[1] ?? ev.key;
  if (rawDigit === '1') return 1;
  if (rawDigit === '2') return 2;
  if (rawDigit === '3') return 3;
  if (rawDigit === '4') return 4;
  return null;
}
