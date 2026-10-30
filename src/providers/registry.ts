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
  messenger: [
    '[role="row"]',
    '[role="listitem"]',
    'a[href*="/t/"]',
    '[role="link"][href*="/t/"]',
    '[data-chat-item]'
  ],
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
  if (providerId === 'messenger' && el.closest('[role="main"]') !== null) {
    return null;
  }
  for (const sel of CHAT_LIST_ROW_SELECTORS[providerId]) {
    const row = el.closest(sel);
    if (row) {
      if (providerId === 'messenger' && row.closest('[role="main"]') !== null) {
        continue;
      }
      return row;
    }
  }
  return null;
}

const SENDER_SELECTORS: Record<ProviderId, string[]> = {
  zalo: ['.conv-item-title__name', '[data-sender]', '.truncate', '[class*="title__name"]'],
  messenger: [
    '[data-sender]',
    '[dir="auto"]',
    '[class*="x1lliihq"][class*="x6ikm8r"]',
    'h3',
    'h4',
    'strong'
  ],
  telegram: ['.peer-title', '.user-title', '.ListItem .title h3', '.ListItem .title', '[data-sender]'],
  discord: ['[data-sender]', '[class*="name-"]', '[class*="channelName"]', '[class*="username"]']
};

const SNIPPET_SELECTORS: Record<ProviderId, string[]> = {
  zalo: ['.conv-item-body__main', '.conv-message', '[data-preview]', '[class*="conv-item-body"]'],
  messenger: [
    '[data-preview]',
    '[data-testid="mwthreadlist-item-snippet"]',
    '[dir="auto"]',
    '[class*="x1lliihq"][class*="x6ikm8r"]'
  ],
  telegram: ['.dialog-subtitle-span', '.last-message', '.subtitle span', '[data-preview]'],
  discord: ['[data-preview]', '[class*="subtext"]', '[class*="activityText"]']
};

const NUMERIC_PILL_RE = /^(\d+)\+?$/;
const TIMESTAMP_ONLY_RE = /^(\d{1,2}:\d{2}(\s*[AP]M)?|\d+\s*(s|m|h|d|w|phút|giờ|ngày))$/i;
const ARIA_COUNT_BEFORE_UNREAD_RE = /\b(\d+)\+?\s+(?:unread|(?:tin\s+nhắn\s+)?chưa\s+đọc)\b/i;
const ARIA_COUNT_AFTER_UNREAD_RE =
  /\b(?:unread(?:\s+messages?)?|chưa\s+đọc)[\s:(-]+(\d+)\+?(?!\s*:\d)/i;
const RGB_COLOR_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i;

const MESSENGER_UNREAD_MARKER_SELECTOR = [
  '[data-testid="mwthreadlist-item-unread-badge"]',
  '[aria-label*="Đánh dấu là đã đọc" i]',
  '[aria-label*="Mark as read" i]',
  '[aria-label*="tin nhắn chưa đọc" i]',
  '[aria-label*="unread message" i]',
  '[aria-label="Chưa đọc" i]',
  '[aria-label="Unread" i]'
].join(', ');

const MESSENGER_UNREAD_SR_RE = /\b(?:chưa\s+đọc|unread)\b/i;
const MESSENGER_ONLINE_SR_RE =
  /^(?:đang\s+hoạt\s+động|active\s+now|online|(?:hoạt\s+động|active)\s+\d+)/i;
const MESSENGER_SEPARATOR_ONLY_RE = /^[·•|\-\u2013\u2014,:]+$/;
const MESSENGER_TIMESTAMP_TOKEN_RE =
  /^(?:vừa\s+xong|just\s+now|now|hôm\s+qua|yesterday|\d{1,2}:\d{2}(?:\s*[ap]m)?|\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|w|wk|y|yr|giây|phút|giờ|ngày|tuần|tháng|năm)(?:\s+trước|\s+ago)?)$/i;
const MESSENGER_TRAILING_TIMESTAMP_RE =
  /\s*[·•]\s*(?:vừa\s+xong|just\s+now|now|hôm\s+qua|yesterday|\d{1,2}:\d{2}(?:\s*[ap]m)?|\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|w|wk|y|yr|giây|phút|giờ|ngày|tuần|tháng|năm)(?:\s+trước|\s+ago)?)\s*$/i;
const MESSENGER_SR_LABEL_RE =
  /^(?:tin\s+nhắn\s+chưa\s+đọc:?|unread\s+messages?:?|chưa\s+đọc:?|unread:?|đang\s+hoạt\s+động|active\s+now|(?:hoạt\s+động|active)\s+\d+\s*(?:m|h|d|phút|giờ|ngày).*)$/i;
const SPEAKER_PREFIX_ONLY_RE = /^[^:]{1,40}:$/;
const LEADING_TITLE_COUNT_RE = /^\s*[•*]?\s*\(\d+\+?\)\s*/;
const TRAILING_TITLE_COUNT_RE = /\s*\(\d+\+?\)\s*$/;
const GENERIC_APP_TITLE_RE =
  /^(?:messenger|facebook(?:\s+messenger)?|zalo|telegram(?:\s+web)?|discord|tin\s+nhắn\s+mới|new\s+messages?)$/i;

const GENERIC_NOTIFY_BODY_PATTERNS: readonly RegExp[] = [
  /^(?:tin\s+nhắn\s+mới|có\s+tin\s+nhắn\s+mới|bạn\s+có\s+(?:\d+\s+)?tin\s+nhắn\s+(?:mới|chưa\s+đọc)|\d+\s+tin\s+nhắn\s+(?:mới|chưa\s+đọc))$/i,
  /^(?:new\s+messages?|you\s+have\s+(?:a|\d+)\s+(?:new|unread)\s+messages?|\d+\s+(?:new|unread)\s+messages?)$/i,
  /^(?:vừa\s+)?(?:đã\s+)?gửi(?:\s+cho\s+bạn)?(?:\s+một)?\s+tin\s+nhắn$/i,
  /^.+\s+(?:vừa\s+)?(?:đã\s+)?(?:gửi(?:\s+cho\s+bạn)?(?:\s+một)?\s+tin\s+nhắn|nhắn\s+tin\s+cho\s+bạn)$/i,
  /^(?:just\s+)?sent(?:\s+you)?\s+a\s+message$/i,
  /^.+\s+sent\s+you\s+a\s+message$/i
];

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

function isVisuallyHiddenSrElement(el: Element): boolean {
  const inlineStyle = (el.getAttribute('style') ?? '').toLowerCase();
  if (
    inlineStyle.includes('position') &&
    (inlineStyle.includes('absolute') || inlineStyle.includes('fixed')) &&
    (inlineStyle.includes('1px') || inlineStyle.includes('clip'))
  ) {
    return true;
  }
  const view = el.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === 'function') {
    try {
      const style = view.getComputedStyle(el);
      if (
        (style.position === 'absolute' || style.position === 'fixed') &&
        (style.width === '1px' ||
          style.height === '1px' ||
          style.clip === 'rect(0px, 0px, 0px, 0px)' ||
          style.clip === 'rect(0, 0, 0, 0)')
      ) {
        return true;
      }
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
        '[aria-label*="Muted" i], [aria-label*="Đã tắt thông báo" i], [aria-label*="tắt thông báo" i], [data-testid*="mute" i], svg.x1tzjh5l:not(.x1k90msu), path[d^="M29.676 7.746"]'
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
        '.menu-horizontal-div, #folders-tabs, #folders-sidebar, .folders-sidebar, .TabList, .Tab, [role="tablist"], [role="tab"], [data-peer-id="0"], .is-archive, #search-container, .sidebar-search, .sidebar-slider-item:not(.item-main), #folders-container > .tabs-tab:not(.active), .transition-item:not(.active), .Transition_slide-inactive'
      ) !== null
    ) {
      return true;
    }
    if (isNeutralGrayBackground(el)) {
      return true;
    }
  }

  if (
    providerId === 'messenger' &&
    el.closest('[role="main"], [role="tab"], [role="tablist"], [role="radio"]') !== null
  ) {
    return true;
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

function collectUnmutedMessengerRows(root: ParentNode): Element[] {
  const selector = CHAT_LIST_ROW_SELECTORS.messenger.join(', ');
  let rawNodes: NodeListOf<Element>;
  try {
    rawNodes = root.querySelectorAll(selector);
  } catch {
    return [];
  }
  const rows: Element[] = [];
  for (const node of rawNodes) {
    const row = findConversationRow('messenger', node);
    if (!row) continue;
    if (row.closest('[role="main"], [role="tab"], [role="tablist"], [role="radio"]') !== null) {
      continue;
    }
    if (isElementHidden(row)) continue;
    if (isMutedConversationRow('messenger', row)) continue;
    if (rows.some((prev) => prev === row || prev.contains(row) || row.contains(prev))) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

function findMessengerUnreadMarker(row: Element): Element | null {
  let markers: NodeListOf<Element>;
  try {
    markers = row.querySelectorAll(MESSENGER_UNREAD_MARKER_SELECTOR);
  } catch {
    markers = [] as unknown as NodeListOf<Element>;
  }
  for (const marker of markers) {
    if (marker.closest('[role="tab"], [role="tablist"], [role="radio"]') !== null) continue;
    if (isElementHidden(marker)) continue;
    return marker;
  }

  const srCandidates = row.querySelectorAll('span, div');
  for (const el of srCandidates) {
    if (el.childElementCount > 0) continue;
    if (isElementHidden(el)) continue;
    if (!isVisuallyHiddenSrElement(el)) continue;
    const srText = cleanPreviewText(el.textContent);
    if (!srText) continue;
    if (MESSENGER_ONLINE_SR_RE.test(srText)) continue;
    if (MESSENGER_UNREAD_SR_RE.test(srText) || el.parentElement?.classList.contains('html-span')) {
      return el;
    }
  }

  return null;
}

function collectUnmutedBadgeElements(
  providerId: ProviderId,
  root: ParentNode
): Array<{ element: Element; count: number }> {
  const selectors = PROVIDERS[providerId].badgeSelectors;
  const results: Array<{ element: Element; count: number }> = [];
  const seen = new Set<Element>();
  const seenPeerIds = new Set<string>();
  const counted: Element[] = [];
  const countedRows: Element[] = [];

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
      const row = findConversationRow(providerId, el);
      const peerId = row?.getAttribute('data-peer-id')?.trim();
      if (peerId && seenPeerIds.has(peerId)) {
        continue;
      }
      const num = parseUnreadFromElement(el);
      if (num > 0) {
        if (peerId) {
          seenPeerIds.add(peerId);
        }
        if (row) {
          countedRows.push(row);
        }
        counted.push(el);
        results.push({ element: el, count: num });
      }
    }
  }

  if (providerId === 'messenger') {
    for (const row of collectUnmutedMessengerRows(root)) {
      if (
        countedRows.some((prev) => prev === row || prev.contains(row) || row.contains(prev)) ||
        counted.some((prev) => prev.contains(row) || row.contains(prev))
      ) {
        continue;
      }
      const marker = findMessengerUnreadMarker(row);
      if (!marker) continue;
      countedRows.push(row);
      counted.push(marker);
      results.push({ element: marker, count: 1 });
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

function normalizeEmojiAlt(altRaw: string): string {
  const trimmed = altRaw.trim();
  if (trimmed === '(Y)' || trimmed === '(y)') return '👍';
  return altRaw;
}

function extractNodeTextWithEmoji(el: Element, badgeEl?: Element | null): string {
  let acc = '';
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      acc += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    if (badgeEl && (child === badgeEl || badgeEl.contains(child))) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'button') return;
    if (child.getAttribute('role') === 'button') return;
    if (isElementHidden(child) || isVisuallyHiddenSrElement(child)) return;
    if (tag === 'img') {
      const alt = child.getAttribute('alt');
      if (alt) acc += normalizeEmojiAlt(alt);
      return;
    }
    for (const sub of child.childNodes) {
      walk(sub);
    }
  };

  if (badgeEl && (el === badgeEl || badgeEl.contains(el))) return '';
  if (isElementHidden(el) || isVisuallyHiddenSrElement(el)) return '';
  for (const sub of el.childNodes) {
    walk(sub);
  }
  return cleanPreviewText(acc);
}

function stripTrailingMessengerTimestamp(text: string): string {
  return text.replace(MESSENGER_TRAILING_TIMESTAMP_RE, '').trim();
}

function isMessengerNoiseToken(rawToken: string): boolean {
  const token = cleanPreviewText(rawToken);
  if (!token) return true;
  if (NUMERIC_PILL_RE.test(token)) return true;
  if (MESSENGER_SEPARATOR_ONLY_RE.test(token)) return true;
  if (TIMESTAMP_ONLY_RE.test(token) || MESSENGER_TIMESTAMP_TOKEN_RE.test(token)) return true;
  if (MESSENGER_SR_LABEL_RE.test(token)) return true;
  return false;
}

function collectCleanLeafTokens(
  scope: Element,
  selector: string,
  badgeEl?: Element | null
): string[] {
  let rawNodes: NodeListOf<Element>;
  try {
    rawNodes = scope.querySelectorAll(selector);
  } catch {
    return [];
  }
  const validEls: Element[] = [];
  for (const el of rawNodes) {
    if (badgeEl && (el === badgeEl || badgeEl.contains(el))) continue;
    if (el.closest('button, [role="button"], svg') !== null) continue;
    if (isElementHidden(el) || isVisuallyHiddenSrElement(el)) continue;
    validEls.push(el);
  }
  const leafEls = validEls.filter(
    (el) => !validEls.some((other) => other !== el && el.contains(other))
  );
  const tokens: string[] = [];
  for (const el of leafEls) {
    const raw = extractNodeTextWithEmoji(el, badgeEl);
    const cleaned = stripTrailingMessengerTimestamp(raw);
    if (!cleaned || isMessengerNoiseToken(cleaned)) continue;
    if (tokens[tokens.length - 1] === cleaned) continue;
    tokens.push(cleaned);
  }
  return tokens;
}

function extractMessengerPreviewFromRow(
  row: Element,
  badgeEl?: Element | null
): UnreadPreview | null {
  const explicitSenderEl = row.querySelector('[data-sender]');
  const explicitSender = explicitSenderEl
    ? stripTrailingMessengerTimestamp(extractNodeTextWithEmoji(explicitSenderEl, badgeEl))
    : '';
  const explicitSnippetEl = row.querySelector(
    '[data-preview], [data-testid="mwthreadlist-item-snippet"]'
  );
  const explicitSnippet = explicitSnippetEl
    ? stripTrailingMessengerTimestamp(extractNodeTextWithEmoji(explicitSnippetEl, badgeEl))
    : '';

  if (explicitSender && explicitSnippet && !isMessengerNoiseToken(explicitSender)) {
    return {
      sender: explicitSender,
      snippet: isMessengerNoiseToken(explicitSnippet) ? '' : explicitSnippet
    };
  }

  let tokens = collectCleanLeafTokens(
    row,
    '[data-sender], [data-preview], [data-testid="mwthreadlist-item-snippet"], [dir="auto"], [class*="x1lliihq"][class*="x6ikm8r"], h3, h4, strong',
    badgeEl
  );
  if (tokens.length < 2) {
    const fallbackTokens = collectCleanLeafTokens(row, 'span, div[dir="auto"]', badgeEl);
    if (fallbackTokens.length > tokens.length) {
      tokens = fallbackTokens;
    }
  }

  const sender =
    explicitSender && !isMessengerNoiseToken(explicitSender) ? explicitSender : (tokens[0] ?? '');
  if (!sender) return null;

  if (explicitSnippet && !isMessengerNoiseToken(explicitSnippet) && explicitSnippet !== sender) {
    return { sender, snippet: explicitSnippet };
  }

  const senderIdx = tokens.indexOf(sender);
  const afterSender = (senderIdx >= 0 ? tokens.slice(senderIdx + 1) : tokens).filter(
    (t) => t !== sender
  );

  let snippet = '';
  if (
    afterSender.length >= 2 &&
    SPEAKER_PREFIX_ONLY_RE.test(afterSender[0]!) &&
    !SPEAKER_PREFIX_ONLY_RE.test(afterSender[1]!)
  ) {
    snippet = `${afterSender[0]} ${afterSender[1]}`;
  } else {
    snippet = afterSender[0] ?? '';
  }

  return { sender, snippet };
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

function matchesSenderHint(candidateSender: string, hint: string): boolean {
  const a = cleanPreviewText(candidateSender).toLowerCase();
  const b = cleanPreviewText(hint).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

function extractMessengerMainPanePreview(
  root: ParentNode,
  senderHint: string
): UnreadPreview | null {
  let mainPanes: NodeListOf<Element>;
  try {
    mainPanes = root.querySelectorAll('[role="main"]');
  } catch {
    return null;
  }
  for (const mainPane of mainPanes) {
    const headings = mainPane.querySelectorAll('h1, h2, h3, [role="heading"]');
    let matchedHeading = '';
    for (const h of headings) {
      if (isElementHidden(h) || isVisuallyHiddenSrElement(h)) continue;
      const hText = extractNodeTextWithEmoji(h);
      if (hText && matchesSenderHint(hText, senderHint)) {
        matchedHeading = hText;
        break;
      }
    }
    if (!matchedHeading) continue;

    const rawBubbles = mainPane.querySelectorAll('[dir="auto"]');
    const validEls: Element[] = [];
    for (const el of rawBubbles) {
      if (
        el.closest(
          'h1, h2, h3, [role="heading"], [role="textbox"], [contenteditable="true"], textarea, input, button, [role="button"]'
        ) !== null
      ) {
        continue;
      }
      if (isElementHidden(el) || isVisuallyHiddenSrElement(el)) continue;
      validEls.push(el);
    }
    const leafBubbles = validEls.filter(
      (el) => !validEls.some((other) => other !== el && el.contains(other))
    );
    const messages: string[] = [];
    for (const bubble of leafBubbles) {
      const text = stripTrailingMessengerTimestamp(extractNodeTextWithEmoji(bubble));
      if (!text || isMessengerNoiseToken(text) || text === matchedHeading) continue;
      messages.push(text);
    }
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      return { sender: matchedHeading, snippet: lastMessage };
    }
  }
  return null;
}

export function extractUnreadPreviewFromDom(
  providerId: ProviderId,
  root: ParentNode,
  senderHint?: string | null
): UnreadPreview | null {
  const normalizedHint = cleanPreviewText(senderHint);
  const badges = collectUnmutedBadgeElements(providerId, root);
  const unreadPreviews: UnreadPreview[] = [];

  for (const { element: badgeEl } of badges) {
    const row = findConversationRow(providerId, badgeEl);
    if (!row) continue;
    if (providerId === 'messenger') {
      const preview = extractMessengerPreviewFromRow(row, badgeEl);
      if (preview?.sender) {
        unreadPreviews.push(preview);
      }
      continue;
    }
    const sender = pickCleanText(row, SENDER_SELECTORS[providerId], badgeEl);
    if (!sender) continue;
    const snippet = pickCleanText(row, SNIPPET_SELECTORS[providerId], badgeEl, sender);
    unreadPreviews.push({ sender, snippet });
  }

  if (!normalizedHint) {
    return unreadPreviews[0] ?? null;
  }

  const hintLower = normalizedHint.toLowerCase();
  const exactUnread = unreadPreviews.find(
    (p) => cleanPreviewText(p.sender).toLowerCase() === hintLower && p.snippet.length > 0
  );
  if (exactUnread) return exactUnread;

  const matchedUnread = unreadPreviews.find(
    (p) =>
      (matchesSenderHint(p.sender, normalizedHint) ||
        p.snippet.toLowerCase().startsWith(`${hintLower}:`)) &&
      p.snippet.length > 0
  );
  if (matchedUnread) return matchedUnread;

  if (providerId === 'messenger') {
    for (const row of collectUnmutedMessengerRows(root)) {
      const preview = extractMessengerPreviewFromRow(row);
      if (
        preview?.sender &&
        preview.snippet &&
        (matchesSenderHint(preview.sender, normalizedHint) ||
          preview.snippet.toLowerCase().startsWith(`${hintLower}:`))
      ) {
        return preview;
      }
    }
    const mainPreview = extractMessengerMainPanePreview(root, normalizedHint);
    if (mainPreview) return mainPreview;
  }

  return unreadPreviews.find((p) => matchesSenderHint(p.sender, normalizedHint)) ?? null;
}

export function isGenericNotificationBody(body: string, _titleOrSender?: string): boolean {
  const cleaned = cleanPreviewText(body).replace(/[.!]+$/, '').trim();
  if (!cleaned) return true;
  return GENERIC_NOTIFY_BODY_PATTERNS.some((re) => re.test(cleaned));
}

export function extractSenderHintFromNotification(
  providerId: ProviderId,
  rawTitle: string,
  rawBody: string
): string | null {
  const cleanedTitle = cleanPreviewText(rawTitle)
    .replace(LEADING_TITLE_COUNT_RE, '')
    .replace(TRAILING_TITLE_COUNT_RE, '')
    .trim();

  if (
    cleanedTitle &&
    !GENERIC_APP_TITLE_RE.test(cleanedTitle) &&
    cleanedTitle.toLowerCase() !== PROVIDERS[providerId].name.toLowerCase()
  ) {
    const titleViMatch = /^(.+?)\s+(?:vừa\s+)?(?:đã\s+)?nhắn\s+tin\s+cho\s+bạn$/i.exec(
      cleanedTitle
    );
    if (titleViMatch?.[1]) return cleanPreviewText(titleViMatch[1]);
    const titleEnMatch = /^(.+?)\s+sent\s+you\s+a\s+message$/i.exec(cleanedTitle);
    if (titleEnMatch?.[1]) return cleanPreviewText(titleEnMatch[1]);
    return cleanedTitle;
  }

  const cleanedBody = cleanPreviewText(rawBody).replace(/[.!]+$/, '').trim();
  if (cleanedBody) {
    const viBodyMatch =
      /^(.+?)\s+(?:vừa\s+)?(?:đã\s+)?(?:gửi(?:\s+cho\s+bạn)?(?:\s+một)?\s+tin\s+nhắn|nhắn\s+tin\s+cho\s+bạn)$/i.exec(
        cleanedBody
      );
    const viSender = cleanPreviewText(viBodyMatch?.[1]);
    if (
      viSender &&
      !/^(?:vừa|đã|bạn)$/i.test(viSender) &&
      !GENERIC_APP_TITLE_RE.test(viSender)
    ) {
      return viSender;
    }

    const enBodyMatch = /^(.+?)\s+sent\s+you\s+a\s+message$/i.exec(cleanedBody);
    const enSender = cleanPreviewText(enBodyMatch?.[1]);
    if (enSender && !/^(?:just|you)$/i.test(enSender) && !GENERIC_APP_TITLE_RE.test(enSender)) {
      return enSender;
    }
  }

  return null;
}

function isFacebookHost(host: string): boolean {
  return host === 'facebook.com' || host.endsWith('.facebook.com');
}

function isFacebookMessagesPath(pathname: string): boolean {
  return pathname === '/messages' || pathname.startsWith('/messages/');
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
    if (pathname === '/facebook/messages' || pathname.startsWith('/facebook/messages/')) {
      return 'messenger';
    }
    for (const id of PROVIDER_ORDER) {
      if (pathname.includes(`/${id}`)) return id;
    }
  }
  if (isFacebookHost(host) && isFacebookMessagesPath(pathname)) {
    return 'messenger';
  }
  for (const id of PROVIDER_ORDER) {
    if (PROVIDERS[id].hostPatterns.some((h) => host === h || host.endsWith(`.${h}`))) {
      return id;
    }
  }
  return null;
}

export function matchFrameProviderByUrl(rawUrl: string): ProviderId | null {
  const direct = matchProviderByUrl(rawUrl);
  if (direct) return direct;
  let host: string;
  let pathname: string;
  try {
    const parsed = new URL(rawUrl);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (
    (host === '127.0.0.1' || host === 'localhost') &&
    (pathname === '/facebook' || pathname.startsWith('/facebook/'))
  ) {
    return 'messenger';
  }
  if (isFacebookHost(host)) {
    return 'messenger';
  }
  return null;
}
