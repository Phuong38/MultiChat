import type { ProviderConfig, ProviderId } from '../shared/types';

export interface UnreadPreview {
  sender: string;
  snippet: string;
}

export const PROVIDER_ORDER: readonly [ProviderId, ProviderId, ProviderId, ProviderId] = [
  'zalo',
  'messenger',
  'telegram',
  'discord'
];

const COMMON_SUB_DIET_CSS = `
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
`;

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  zalo: {
    id: 'zalo',
    name: 'Zalo',
    shortcutIndex: 1,
    embedUrl: 'https://chat.zalo.me/',
    loginUrl: 'https://chat.zalo.me/',
    hostPatterns: ['chat.zalo.me', 'id.zalo.me'],
    cookieDomains: ['.zalo.me', 'chat.zalo.me'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bZalo\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: ['.conv-item-title__unread', '.unread-red-dot-num', '[data-id*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      #chatInfo, .chat-info-container { display: none !important; }
    `
  },
  messenger: {
    id: 'messenger',
    name: 'Messenger',
    shortcutIndex: 2,
    embedUrl: 'https://www.messenger.com/',
    loginUrl: 'https://www.messenger.com/login/',
    hostPatterns: ['www.messenger.com', 'messenger.com'],
    cookieDomains: ['.messenger.com', '.facebook.com'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bMessenger\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: ['[data-testid="mwthreadlist-item-unread-badge"]', '[aria-label*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      [role="complementary"] { display: none !important; }
    `
  },
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    shortcutIndex: 3,
    embedUrl: 'https://web.telegram.org/k/',
    loginUrl: 'https://web.telegram.org/k/',
    hostPatterns: ['web.telegram.org'],
    cookieDomains: ['.telegram.org', 'web.telegram.org'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bTelegram(?:\s+Web)?\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: [
      '.dialog-subtitle-badge-unread',
      '.ChatBadge.unread',
      '.badge-unread',
      '.unread'
    ],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      .right-sidebar { display: none !important; }
    `
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    shortcutIndex: 4,
    embedUrl: 'https://discord.com/app',
    loginUrl: 'https://discord.com/login',
    hostPatterns: ['discord.com'],
    cookieDomains: ['.discord.com', 'discord.com'],
    titleUnreadRegex: /^\s*[•*]?\s*\((\d+)\+?\)(?=\s|$)|\bDiscord\s*\((\d+)\+?\)\s*$/i,
    badgeSelectors: ['[class*="numberBadge"]', '[aria-label*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      [class*="membersWrap"], [class*="nowPlayingColumn"] { display: none !important; }
    `
  }
};

const CHAT_LIST_ROW_SELECTORS: Record<ProviderId, readonly string[]> = {
  zalo: ['.conv-item', '.msg-item', '[data-chat-item]'],
  messenger: ['[role="row"]', '[role="listitem"]', 'a[href*="/t/"]', '[data-chat-item]'],
  telegram: ['.chatlist-chat', '.ListItem.Chat', '[data-chat-item]'],
  discord: [
    '[class*="containerDefault"]',
    '[role="listitem"]',
    'li',
    'a[href*="/channels/"]',
    '[data-chat-item]'
  ]
};

function findConversationRow(providerId: ProviderId, el: Element): Element | null {
  for (const sel of CHAT_LIST_ROW_SELECTORS[providerId]) {
    const row = el.closest(sel);
    if (row) return row;
  }
  return null;
}

const SENDER_SELECTORS: Record<ProviderId, string[]> = {
  zalo: ['.conv-item-title__name', '[data-sender]', '.truncate', '[class*="title__name"]'],
  messenger: ['[data-sender]', '[dir="auto"] span', 'h3', 'h4', 'strong'],
  telegram: ['.peer-title', '.user-title', '.ListItem .title h3', '.ListItem .title', '[data-sender]'],
  discord: ['[data-sender]', '[class*="name-"]', '[class*="channelName"]', '[class*="username"]']
};

const SNIPPET_SELECTORS: Record<ProviderId, string[]> = {
  zalo: ['.conv-item-body__main', '.conv-message', '[data-preview]', '[class*="conv-item-body"]'],
  messenger: ['[data-preview]', '[data-testid="mwthreadlist-item-snippet"]', '[dir="auto"]'],
  telegram: ['.dialog-subtitle-span', '.last-message', '.subtitle span', '[data-preview]'],
  discord: ['[data-preview]', '[class*="subtext"]', '[class*="activityText"]']
};

const NUMERIC_PILL_RE = /^(\d+)\+?$/;
const TIMESTAMP_ONLY_RE = /^(\d{1,2}:\d{2}(\s*[AP]M)?|\d+\s*(s|m|h|d|w|phút|giờ|ngày))$/i;
const ARIA_COUNT_BEFORE_UNREAD_RE = /\b(\d+)\+?\s+unread\b/i;
const ARIA_COUNT_AFTER_UNREAD_RE = /\bunread(?:\s+messages?)?[\s:(-]+(\d+)\+?(?!\s*:\d)/i;
const RGB_COLOR_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i;

export function parseUnreadFromTitle(providerId: ProviderId, title: string): number {
  const match = PROVIDERS[providerId].titleUnreadRegex.exec(title);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isNeutralGrayBackground(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return false;
  let bg = '';
  try {
    bg = view.getComputedStyle(el).backgroundColor || '';
  } catch {
    return false;
  }
  const match = RGB_COLOR_RE.exec(bg.trim());
  if (!match) return false;
  const r = Number.parseInt(match[1] ?? '0', 10);
  const g = Number.parseInt(match[2] ?? '0', 10);
  const b = Number.parseInt(match[3] ?? '0', 10);
  const alpha = match[4] !== undefined ? Number.parseFloat(match[4]) : 1;
  if (!Number.isFinite(alpha) || alpha <= 0.1) return false;
  if (r === 0 && g === 0 && b === 0) return false;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return spread <= 15;
}

function isElementHidden(el: Element): boolean {
  if (
    el.classList.contains('hide') ||
    el.hasAttribute('hidden') ||
    el.closest('.hide, [hidden]') !== null
  ) {
    return true;
  }
  const view = el.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === 'function') {
    try {
      const style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch {
      // Ignore style lookup errors in detached trees
    }
  }
  return false;
}

function isMutedConversationRow(providerId: ProviderId, row: Element | null): boolean {
  if (!row) return false;
  if (
    row.classList.contains('is-muted') ||
    row.classList.contains('muted') ||
    row.getAttribute('data-muted') === 'true'
  ) {
    return true;
  }

  if (providerId === 'telegram') {
    if (row.getAttribute('data-peer-id') === '0' || row.classList.contains('is-archive')) {
      return true;
    }
    return (
      row.querySelector(
        '.dialog-muted-icon, .tgico-mute, .icon-muted, [class*="muted-icon" i], [data-icon="mute"]'
      ) !== null
    );
  }

  if (providerId === 'zalo') {
    return (
      row.querySelector(
        '.fa-Mute, [class*="ic-mute" i], [class*="icon-mute" i], .conv-item__mute, [class*="--mute" i], [data-muted="true"]'
      ) !== null
    );
  }

  if (providerId === 'messenger') {
    return (
      row.querySelector(
        '[aria-label*="Muted" i], [aria-label*="Đã tắt thông báo" i], [aria-label*="tắt thông báo" i], [data-testid*="mute" i]'
      ) !== null
    );
  }

  if (providerId === 'discord') {
    const cls = row.getAttribute('class') ?? '';
    if (/modeMuted/i.test(cls)) return true;
    const aria = row.getAttribute('aria-label') ?? '';
    if (/\bmuted\b/i.test(aria)) return true;
    return row.querySelector('[class*="modeMuted" i], [aria-label*="muted" i]') !== null;
  }

  return false;
}

function isMutedOrIgnoredBadge(providerId: ProviderId, el: Element): boolean {
  if (isElementHidden(el)) return true;
  if (
    el.classList.contains('badge-gray') ||
    el.classList.contains('muted') ||
    el.classList.contains('is-muted') ||
    el.getAttribute('data-muted') === 'true'
  ) {
    return true;
  }

  if (providerId === 'telegram') {
    if (
      el.closest(
        '.menu-horizontal-div, .tabs-tab, #folders-tabs, .ChatFolders, .Tab, [role="tablist"], [data-peer-id="0"], .is-archive'
      ) !== null
    ) {
      return true;
    }
    if (isNeutralGrayBackground(el)) {
      return true;
    }
  }

  if (
    providerId === 'discord' &&
    el.closest('[class*="modeMuted" i], [aria-label*="muted" i]') !== null
  ) {
    return true;
  }

  const row = findConversationRow(providerId, el);
  return isMutedConversationRow(providerId, row);
}

function parseUnreadFromElement(el: Element): number {
  const text = (el.textContent ?? '').trim();
  const pillMatch = NUMERIC_PILL_RE.exec(text);
  if (pillMatch?.[1]) {
    const parsed = Number.parseInt(pillMatch[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  const aria = el.getAttribute('aria-label') ?? '';
  if (aria) {
    const ariaMatch =
      ARIA_COUNT_BEFORE_UNREAD_RE.exec(aria) ?? ARIA_COUNT_AFTER_UNREAD_RE.exec(aria);
    if (ariaMatch?.[1]) {
      const parsed = Number.parseInt(ariaMatch[1], 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
  }

  return 0;
}

function collectUnmutedBadgeElements(
  providerId: ProviderId,
  root: ParentNode
): Array<{ element: Element; count: number }> {
  const selectors = PROVIDERS[providerId].badgeSelectors;
  const results: Array<{ element: Element; count: number }> = [];
  const seen = new Set<Element>();
  const counted: Element[] = [];

  for (const selector of selectors) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = root.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (isMutedOrIgnoredBadge(providerId, el)) continue;
      if (counted.some((prev) => prev.contains(el) || el.contains(prev))) {
        continue;
      }
      const num = parseUnreadFromElement(el);
      if (num > 0) {
        counted.push(el);
        results.push({ element: el, count: num });
      }
    }
  }
  return results;
}

export function extractUnreadFromDom(providerId: ProviderId, root: ParentNode): number {
  return collectUnmutedBadgeElements(providerId, root).reduce((sum, item) => sum + item.count, 0);
}

export function hasMountedChatList(providerId: ProviderId, root: ParentNode): boolean {
  return CHAT_LIST_ROW_SELECTORS[providerId].some((sel) => {
    try {
      return root.querySelector(sel) !== null;
    } catch {
      return false;
    }
  });
}

export function resolveProviderUnreadCount(
  providerId: ProviderId,
  title: string,
  root: ParentNode | null
): number {
  if (providerId === 'telegram' && root && hasMountedChatList('telegram', root)) {
    return extractUnreadFromDom('telegram', root);
  }
  const titleCount = parseUnreadFromTitle(providerId, title);
  if (titleCount > 0) return titleCount;
  return root ? extractUnreadFromDom(providerId, root) : 0;
}

function cleanPreviewText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

function pickCleanText(
  row: Element,
  selectors: readonly string[],
  badgeEl: Element,
  excludeText?: string
): string {
  for (const sel of selectors) {
    let candidates: NodeListOf<Element>;
    try {
      candidates = row.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const node of candidates) {
      if (node === badgeEl || node.contains(badgeEl) || badgeEl.contains(node)) continue;
      const text = cleanPreviewText(node.textContent);
      if (!text) continue;
      if (NUMERIC_PILL_RE.test(text) || TIMESTAMP_ONLY_RE.test(text)) continue;
      if (excludeText && text === excludeText) continue;
      return text;
    }
  }
  return '';
}

export function extractUnreadPreviewFromDom(
  providerId: ProviderId,
  root: ParentNode
): UnreadPreview | null {
  const badges = collectUnmutedBadgeElements(providerId, root);
  for (const { element: badgeEl } of badges) {
    const row = findConversationRow(providerId, badgeEl);
    if (!row) continue;
    const sender = pickCleanText(row, SENDER_SELECTORS[providerId], badgeEl);
    if (!sender) continue;
    const snippet = pickCleanText(row, SNIPPET_SELECTORS[providerId], badgeEl, sender);
    return { sender, snippet };
  }
  return null;
}

export function matchProviderByUrl(rawUrl: string): ProviderId | null {
  let host: string;
  let pathname: string;
  try {
    const parsed = new URL(rawUrl);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (host === '127.0.0.1' || host === 'localhost') {
    for (const id of PROVIDER_ORDER) {
      if (pathname.includes(`/${id}`)) return id;
    }
  }
  for (const id of PROVIDER_ORDER) {
    if (PROVIDERS[id].hostPatterns.some((h) => host === h || host.endsWith(`.${h}`))) {
      return id;
    }
  }
  return null;
}
