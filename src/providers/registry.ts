import type { ProviderConfig, ProviderId } from '../shared/types';

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
    titleUnreadRegex: /\((\d+)\+?/,
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
    titleUnreadRegex: /\((\d+)\+?/,
    badgeSelectors: ['[aria-label*="unread"]', '[data-testid="mwthreadlist-item-unread-badge"]'],
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
    titleUnreadRegex: /\((\d+)\+?/,
    badgeSelectors: ['.badge-unread', '.unread'],
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
    titleUnreadRegex: /\((\d+)\+?/,
    badgeSelectors: ['[class*="numberBadge"]', '[aria-label*="unread"]'],
    subPaneCss: `
      ${COMMON_SUB_DIET_CSS}
      [class*="membersWrap"], [class*="nowPlayingColumn"] { display: none !important; }
    `
  }
};

export function parseUnreadFromTitle(providerId: ProviderId, title: string): number {
  const match = PROVIDERS[providerId].titleUnreadRegex.exec(title);
  if (!match || !match[1]) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function extractUnreadFromDom(providerId: ProviderId, root: ParentNode): number {
  const selectors = PROVIDERS[providerId].badgeSelectors;
  let total = 0;
  const seen = new Set<Element>();
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
      const text = (el.textContent ?? '').trim();
      const num = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(num) && num > 0) {
        total += num;
      }
    }
  }
  return total;
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
