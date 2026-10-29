// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_ORDER,
  PROVIDERS,
  extractUnreadFromDom,
  matchProviderByUrl,
  parseUnreadFromTitle
} from '../../src/providers/registry';

describe('ProviderRegistry', () => {
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

  it('parses unread counts from document titles accurately', () => {
    expect(parseUnreadFromTitle('zalo', '(5) Zalo')).toBe(5);
    expect(parseUnreadFromTitle('messenger', '(12) Messenger')).toBe(12);
    expect(parseUnreadFromTitle('discord', '• (3) Discord | #general')).toBe(3);
    expect(parseUnreadFromTitle('telegram', 'Telegram (2)')).toBe(2);
    expect(parseUnreadFromTitle('zalo', '(99+) Zalo')).toBe(99);
    expect(parseUnreadFromTitle('zalo', '(0) Zalo')).toBe(0);
    expect(parseUnreadFromTitle('zalo', 'Zalo')).toBe(0);
    expect(parseUnreadFromTitle('telegram', '')).toBe(0);
  });

  it('extracts unread sum from provider badge DOM elements and deduplicates overlapping selectors', () => {
    document.body.innerHTML = `
      <div class="badge-unread">4</div>
      <div class="badge-unread">2</div>
      <div class="badge-unread unread">5</div>
      <div class="unread">•</div>
    `;
    expect(extractUnreadFromDom('telegram', document)).toBe(11);
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
