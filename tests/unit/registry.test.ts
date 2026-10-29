// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROVIDER_ORDER,
  PROVIDERS,
  extractUnreadFromDom,
  matchProviderByUrl,
  parseUnreadFromTitle
} from '../../src/providers/registry';

describe('ProviderRegistry', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('enforces Telegram WebK (/k/) and defines all 4 MVP providers', () => {
    expect(PROVIDER_ORDER).toEqual(['zalo', 'messenger', 'telegram', 'discord']);
    expect(PROVIDERS.telegram.embedUrl).toBe('https://web.telegram.org/k/');
    expect(PROVIDERS.zalo.embedUrl).toBe('https://chat.zalo.me/');
    expect(PROVIDERS.messenger.embedUrl).toBe('https://www.messenger.com/');
    expect(PROVIDERS.discord.embedUrl).toBe('https://discord.com/app');

    expect(PROVIDERS.zalo.shortcutIndex).toBe(1);
    expect(PROVIDERS.messenger.shortcutIndex).toBe(2);
    expect(PROVIDERS.telegram.shortcutIndex).toBe(3);
    expect(PROVIDERS.discord.shortcutIndex).toBe(4);
  });

  it('parses unread counts from document titles accurately while rejecting non-badge parentheticals', () => {
    expect(parseUnreadFromTitle('zalo', '(5) Zalo')).toBe(5);
    expect(parseUnreadFromTitle('messenger', '(12) Messenger')).toBe(12);
    expect(parseUnreadFromTitle('discord', '• (3) Discord | #general')).toBe(3);
    expect(parseUnreadFromTitle('messenger', '* (8) Messenger')).toBe(8);
    expect(parseUnreadFromTitle('telegram', 'Telegram (2)')).toBe(2);
    expect(parseUnreadFromTitle('zalo', '(99+) Zalo')).toBe(99);
    expect(parseUnreadFromTitle('zalo', 'Sprint Plan (2026)')).toBe(0);
    expect(parseUnreadFromTitle('telegram', 'Sprint Plan (2026)')).toBe(0);
    expect(parseUnreadFromTitle('discord', 'Call (10:30)')).toBe(0);
    expect(parseUnreadFromTitle('messenger', 'Call (10:30)')).toBe(0);
    expect(parseUnreadFromTitle('zalo', '(0) Zalo')).toBe(0);
    expect(parseUnreadFromTitle('zalo', 'Zalo')).toBe(0);
    expect(parseUnreadFromTitle('telegram', '')).toBe(0);
  });

  it('extracts unread sum from provider badge DOM elements without concatenating row timestamps or double-counting nested badges', () => {
    document.body.innerHTML = `
      <div class="badge-unread">4</div>
      <div class="badge-unread">2</div>
      <div class="badge-unread unread">5</div>
      <div class="unread">•</div>
    `;
    expect(extractUnreadFromDom('telegram', document)).toBe(11);

    document.body.innerHTML = `
      <div aria-label="2 unread messages"><span>Hop luc 10:30</span><span>2m</span></div>
    `;
    expect(extractUnreadFromDom('messenger', document)).toBe(2);
    expect(extractUnreadFromDom('discord', document)).toBe(2);

    // Nested badge + outer aria-label container must not double-count
    document.body.innerHTML = `
      <div aria-label="2 unread messages">
        <span data-testid="mwthreadlist-item-unread-badge">2</span>
        <span>Hop luc 10:30</span>
        <span>2m</span>
      </div>
      <div aria-label="Unread conversation">
        <span>Hop luc 11:45</span>
        <span>5m</span>
      </div>
    `;
    expect(extractUnreadFromDom('messenger', document)).toBe(2);

    document.body.innerHTML = `
      <div aria-label="3 unread mentions">
        <span class="numberBadge-2s8kKX">3</span>
        <span>Sprint 10:30</span>
      </div>
    `;
    expect(extractUnreadFromDom('discord', document)).toBe(3);
  });

  it('matches external and local E2E URLs back to provider IDs', () => {
    expect(matchProviderByUrl('https://chat.zalo.me/?null')).toBe('zalo');
    expect(matchProviderByUrl('https://id.zalo.me/account')).toBe('zalo');
    expect(matchProviderByUrl('https://www.messenger.com/t/12345')).toBe('messenger');
    expect(matchProviderByUrl('https://messenger.com/login/')).toBe('messenger');
    expect(matchProviderByUrl('https://web.telegram.org/k/#@user')).toBe('telegram');
    expect(matchProviderByUrl('https://discord.com/channels/@me')).toBe('discord');
    expect(matchProviderByUrl('https://ptb.discord.com/channels/@me')).toBe('discord');

    expect(matchProviderByUrl('http://127.0.0.1:4173/zalo/index.html')).toBe('zalo');
    expect(matchProviderByUrl('http://localhost:3000/telegram')).toBe('telegram');
    expect(matchProviderByUrl('http://127.0.0.1:4173/unknown')).toBeNull();

    expect(matchProviderByUrl('https://notdiscord.com/app')).toBeNull();
    expect(matchProviderByUrl('https://google.com')).toBeNull();
    expect(matchProviderByUrl('not-a-valid-url')).toBeNull();
  });
});
