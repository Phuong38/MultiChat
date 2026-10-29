// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROVIDER_ORDER,
  PROVIDERS,
  extractUnreadFromDom,
  extractUnreadPreviewFromDom,
  hasMountedChatList,
  matchProviderByUrl,
  parseUnreadFromTitle,
  resolveProviderUnreadCount
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

  it('excludes muted chats, folder tabs, archive row, and gray badges on Telegram WebK/WebA and ignores muted document.title when chatlist DOM is mounted', () => {
    document.body.innerHTML = `
      <div class="menu-horizontal-div">
        <div class="menu-horizontal-div-item"><span>All</span><span class="badge-unread">28</span></div>
      </div>
      <ul class="chatlist">
        <a class="chatlist-chat" data-peer-id="0">
          <span class="peer-title">Archived Chats</span>
          <div class="dialog-subtitle-badge badge badge-24 dialog-subtitle-badge-unread badge-gray is-visible">15</div>
        </a>
        <a class="chatlist-chat is-muted" data-peer-id="-1001">
          <span class="peer-title">Muted Crypto Group</span>
          <div class="dialog-subtitle-badge badge badge-24 dialog-subtitle-badge-unread badge-gray is-visible">9</div>
        </a>
        <a class="chatlist-chat" data-peer-id="-1002">
          <span class="peer-title">Muted Dev Channel <span class="dialog-muted-icon"></span></span>
          <div class="dialog-subtitle-badge badge badge-24 dialog-subtitle-badge-unread is-visible">4</div>
        </a>
        <a class="chatlist-chat" data-peer-id="-1003">
          <span class="peer-title">Gray Theme Muted</span>
          <div id="computed-gray-badge" class="dialog-subtitle-badge badge-unread is-visible" style="background-color: rgb(113, 117, 121);">6</div>
        </a>
        <a class="chatlist-chat" data-peer-id="2001">
          <span class="peer-title">Read Hidden Badge</span>
          <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary hide">3</div>
        </a>
      </ul>
    `;

    expect(hasMountedChatList('telegram', document)).toBe(true);
    expect(extractUnreadFromDom('telegram', document)).toBe(0);
    // Telegram default cloud setting puts muted count (28) into document.title; mounted chatlist overrides it to 0!
    expect(resolveProviderUnreadCount('telegram', '(28) Telegram', document)).toBe(0);
    expect(extractUnreadPreviewFromDom('telegram', document)).toBeNull();

    // Now add 1 genuinely unmuted Telegram WebK chat and 1 unmuted WebA chat (plus 1 muted WebA chat)
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <a class="chatlist-chat" data-peer-id="3001">
        <div class="user-caption">
          <p class="dialog-title"><span class="peer-title">Nguyễn Minh Tuấn</span></p>
          <p class="dialog-subtitle">
            <span class="dialog-subtitle-span">Anh ơi chốt bản thiết kế chiều nay nhé!</span>
            <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary is-visible" style="background-color: rgb(51, 144, 236);">2</div>
          </p>
        </div>
      </a>
      <div class="ListItem Chat muted">
        <div class="ChatBadge unread muted">7</div>
      </div>
      <div class="ListItem Chat">
        <div class="title"><h3>Team Infra</h3></div>
        <div class="subtitle"><span class="last-message">Deploy xong prod</span><div class="ChatBadge unread">1</div></div>
      </div>
      `
    );

    expect(extractUnreadFromDom('telegram', document)).toBe(3);
    expect(resolveProviderUnreadCount('telegram', '(31) Telegram', document)).toBe(3);
    expect(extractUnreadPreviewFromDom('telegram', document)).toEqual({
      sender: 'Nguyễn Minh Tuấn',
      snippet: 'Anh ơi chốt bản thiết kế chiều nay nhé!'
    });
  });

  it('excludes muted conversation rows across Zalo, Messenger, and Discord and extracts Vietnamese sender + snippet from unmuted rows', () => {
    // Zalo: 1 muted group + 1 active unmuted contact
    document.body.innerHTML = `
      <div class="msg-item conv-item">
        <div class="conv-item-title__name">Nhóm Quảng Cáo</div>
        <i class="fa-Mute"></i>
        <div class="conv-item-body__main">Khuyến mãi cuối tuần</div>
        <div class="conv-item-title__unread">5</div>
      </div>
      <div class="msg-item conv-item">
        <div class="conv-item-title__name">Trần Thu Hà</div>
        <div class="conv-item-body__main">Gửi anh hợp đồng bản cuối ạ</div>
        <span class="conv-item-title__more">10:42</span>
        <div class="conv-item-title__unread">2</div>
      </div>
    `;
    expect(extractUnreadFromDom('zalo', document)).toBe(2);
    expect(extractUnreadPreviewFromDom('zalo', document)).toEqual({
      sender: 'Trần Thu Hà',
      snippet: 'Gửi anh hợp đồng bản cuối ạ'
    });

    // Messenger: muted threads (including nested <a href="/t/..."> inside role="row") + 1 unmuted thread
    document.body.innerHTML = `
      <div role="row">
        <span data-sender>Nhóm Đã Tắt Chuông</span>
        <svg aria-label="Muted"></svg>
        <span data-testid="mwthreadlist-item-unread-badge">4</span>
      </div>
      <div role="row">
        <a href="/t/123">
          <span data-sender>Nhóm Muted Anchor</span>
          <span data-testid="mwthreadlist-item-unread-badge">6</span>
        </a>
        <svg aria-label="Muted"></svg>
      </div>
      <div role="row">
        <a href="/t/456">
          <span data-sender>Lê Hoàng Nam</span>
          <span data-testid="mwthreadlist-item-unread-badge">1</span>
        </a>
        <span data-preview>Tối nay họp lúc 20h nha</span>
      </div>
    `;
    expect(extractUnreadFromDom('messenger', document)).toBe(1);
    expect(extractUnreadPreviewFromDom('messenger', document)).toEqual({
      sender: 'Lê Hoàng Nam',
      snippet: 'Tối nay họp lúc 20h nha'
    });

    // Discord: modeMuted channels (including nested <a href="/channels/..."> and wrapper without containerDefault) + 1 active channel
    document.body.innerHTML = `
      <li class="containerDefault modeMuted-3a2">
        <span class="name-3BUD">#random</span>
        <span class="numberBadge-2s8kKX">9</span>
      </li>
      <li class="containerDefault_1">
        <div class="modeMuted_1">
          <a href="/channels/1/2">
            <span class="name-3BUD">#muted-nested</span>
            <span class="numberBadge-2s8kKX">7</span>
          </a>
        </div>
      </li>
      <div class="modeMuted_2">
        <a href="/channels/1/3">
          <span class="name-3BUD">#muted-wrapper</span>
          <span class="numberBadge-2s8kKX">5</span>
        </a>
      </div>
      <li class="containerDefault">
        <a href="/channels/1/4">
          <span class="name-3BUD">#frontend-review</span>
          <span class="numberBadge-2s8kKX">3</span>
        </a>
        <span data-preview>@phuong PR #42 xanh hết rồi</span>
      </li>
    `;
    expect(extractUnreadFromDom('discord', document)).toBe(3);
    expect(extractUnreadPreviewFromDom('discord', document)).toEqual({
      sender: '#frontend-review',
      snippet: '@phuong PR #42 xanh hết rồi'
    });

    // Non-Telegram resolveProviderUnreadCount skips DOM scan when titleCount > 0
    const spyRoot = {
      querySelectorAll: () => {
        throw new Error('DOM should not be scanned when non-Telegram titleCount > 0');
      }
    } as unknown as ParentNode;
    expect(resolveProviderUnreadCount('messenger', '(4) Messenger', spyRoot)).toBe(4);
  });
});
