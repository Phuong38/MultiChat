// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROVIDER_ORDER,
  PROVIDERS,
  extractSenderHintFromNotification,
  extractUnreadFromDom,
  extractUnreadPreviewFromDom,
  hasMountedChatList,
  isGenericNotificationBody,
  matchFrameProviderByUrl,
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
    expect(matchProviderByUrl('https://www.facebook.com/messages')).toBe('messenger');
    expect(matchProviderByUrl('https://www.facebook.com/messages/e2ee/t/987654')).toBe('messenger');
    expect(matchProviderByUrl('https://facebook.com/messages/t/12345')).toBe('messenger');
    // Normal Facebook feed/groups outside /messages must NOT be treated as external duplicate Messenger tabs
    expect(matchProviderByUrl('https://www.facebook.com/')).toBeNull();
    expect(matchProviderByUrl('https://www.facebook.com/groups/123')).toBeNull();
    // Embedded workspace iframe matching maps any facebook.com auth/redirect URL to messenger
    expect(matchFrameProviderByUrl('https://www.facebook.com/login.php?next=%2Fmessages')).toBe(
      'messenger'
    );
    expect(matchFrameProviderByUrl('http://127.0.0.1:4173/facebook/messages/t/1')).toBe(
      'messenger'
    );
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
      <div id="column-left" class="tabs-tab chatlist-container">
        <div class="sidebar-slider">
          <div class="tabs-tab sidebar-slider-item item-main active">
            <div id="folders-tabs" class="menu-horizontal-div">
              <div class="menu-horizontal-div-item"><span>All</span><span class="badge-unread">28</span></div>
            </div>
            <div id="search-container" class="sidebar-search">
              <a class="chatlist-chat" data-peer-id="9991">
                <span class="peer-title">Search Hit</span>
                <div class="dialog-subtitle-badge-unread badge-primary is-visible">5</div>
              </a>
            </div>
            <div id="chatlist-container" class="transition-item active">
              <div id="folders-container">
                <div class="tabs-tab chatlist-parts active" id="webk-active-folder">
                  <ul class="chatlist" id="webk-active-list">
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
                </div>
                <div class="tabs-tab chatlist-parts">
                  <ul class="chatlist">
                    <a class="chatlist-chat" data-peer-id="4001">
                      <span class="peer-title">Inactive Folder Unmuted</span>
                      <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary is-visible" style="background-color: rgb(51, 144, 236);">8</div>
                    </a>
                  </ul>
                </div>
              </div>
            </div>
            <div class="transition-item">
              <ul class="chatlist">
                <a class="chatlist-chat" data-peer-id="4002">
                  <span class="peer-title">Inactive Transition Unmuted</span>
                  <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary is-visible">7</div>
                </a>
              </ul>
            </div>
          </div>
          <div class="tabs-tab sidebar-slider-item app-sidebar-archive active">
            <ul class="chatlist">
              <a class="chatlist-chat" data-peer-id="5001">
                <span class="peer-title">Secondary Archive Slider</span>
                <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary is-visible" style="background-color: rgb(51, 144, 236);">11</div>
              </a>
            </ul>
          </div>
        </div>
      </div>
    `;

    expect(hasMountedChatList('telegram', document)).toBe(true);
    expect(extractUnreadFromDom('telegram', document)).toBe(0);
    // Telegram default cloud setting puts muted count (28) into document.title; mounted chatlist overrides it to 0!
    expect(resolveProviderUnreadCount('telegram', '(28) Telegram', document)).toBe(0);
    expect(extractUnreadPreviewFromDom('telegram', document)).toBeNull();

    // Add 1 genuinely unmuted WebK chat AND a second .active transition folder panel with the SAME data-peer-id="3001"
    document.getElementById('webk-active-list')!.insertAdjacentHTML(
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
      `
    );
    document.getElementById('folders-container')!.insertAdjacentHTML(
      'beforeend',
      `
      <div class="tabs-tab chatlist-parts active">
        <ul class="chatlist">
          <a class="chatlist-chat" data-peer-id="3001">
            <div class="user-caption">
              <p class="dialog-title"><span class="peer-title">Nguyễn Minh Tuấn</span></p>
              <p class="dialog-subtitle">
                <span class="dialog-subtitle-span">Anh ơi chốt bản thiết kế chiều nay nhé!</span>
                <div class="dialog-subtitle-badge dialog-subtitle-badge-unread badge-primary is-visible" style="background-color: rgb(51, 144, 236);">2</div>
              </p>
            </div>
          </a>
        </ul>
      </div>
      `
    );

    expect(extractUnreadFromDom('telegram', document)).toBe(2);
    expect(resolveProviderUnreadCount('telegram', '(30) Telegram', document)).toBe(2);
    expect(extractUnreadPreviewFromDom('telegram', document)).toEqual({
      sender: 'Nguyễn Minh Tuấn',
      snippet: 'Anh ơi chốt bản thiết kế chiều nay nhé!'
    });

    // Realistic Telegram WebA hierarchy (.ChatFolders wrapping .TabList + .Transition slides)
    document.body.innerHTML = `
      <div class="ChatFolders">
        <div class="TabList">
          <div class="Tab">
            <span>All</span>
            <span class="badge">19</span>
            <span class="ChatBadge unread">19</span>
          </div>
        </div>
        <div class="Transition">
          <div class="Transition_slide Transition_slide-active">
            <div class="ChatList">
              <div class="ListItem Chat muted">
                <div class="title"><h3>Muted Group</h3></div>
                <div class="ChatBadge unread muted">7</div>
              </div>
              <div class="ListItem Chat">
                <div class="title"><h3>Team Infra</h3></div>
                <div class="subtitle">
                  <span class="last-message">Deploy xong prod</span>
                  <div class="ChatBadge unread">3</div>
                </div>
              </div>
            </div>
          </div>
          <div class="Transition_slide Transition_slide-inactive">
            <div class="ChatList">
              <div class="ListItem Chat">
                <div class="title"><h3>Inactive Slide Chat</h3></div>
                <div class="subtitle">
                  <span class="last-message">Old folder slide</span>
                  <div class="ChatBadge unread">5</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    expect(hasMountedChatList('telegram', document)).toBe(true);
    expect(extractUnreadFromDom('telegram', document)).toBe(3);
    expect(resolveProviderUnreadCount('telegram', '(29) Telegram', document)).toBe(3);
    expect(extractUnreadPreviewFromDom('telegram', document)).toEqual({
      sender: 'Team Infra',
      snippet: 'Deploy xong prod'
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

  it('extracts unread count and decrypted previews from real Comet Messenger / facebook.com/messages DOM (1x1 .html-span SR markers, blue dots, emojis, group prefixes, muted bell SVGs, and [role="main"] exclusion/fallback)', () => {
    document.body.innerHTML = `
      <div role="banner">Facebook Top Header</div>
      <div role="navigation">
        <div>
          <div role="tab" aria-label="Chưa đọc">Chưa đọc</div>
        </div>
        <div role="grid" aria-label="Đoạn chat">
          <!-- 1) Muted Comet thread with language-independent muted bell SVG (no aria-label) -->
          <div role="row">
            <div role="gridcell">
              <a role="link" href="/messages/t/111/">
                <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft">Nhóm Tắt Chuông SVG</span>
                <span class="html-span">
                  <span style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Tin nhắn chưa đọc:</span>
                </span>
                <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft">Spam khuyến mãi</span>
                <svg class="x1tzjh5l"><path d="M10 10" /></svg>
              </a>
            </div>
          </div>

          <!-- 2) Unmuted unread Comet E2EE thread (1x1 .html-span SR marker + online SR marker + emoji img + timestamp) -->
          <div role="row">
            <div role="gridcell">
              <a role="link" href="/messages/e2ee/t/222/">
                <div>
                  <span style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Đang hoạt động</span>
                </div>
                <div>
                  <span class="html-span">
                    <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft" dir="auto">Nguyễn Văn A</span>
                  </span>
                  <span class="html-span">
                    <span style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Tin nhắn chưa đọc:</span>
                  </span>
                  <span class="html-span">
                    <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft" dir="auto">Chốt 7h tối nhé <img alt="(Y)" src="thumb.png" /></span>
                  </span>
                  <span> · </span>
                  <span>Vừa xong</span>
                </div>
                <div role="button" aria-label="Menu"></div>
              </a>
            </div>
          </div>

          <!-- 3) Unmuted unread group chat marked via "Đánh dấu là đã đọc" button with split speaker prefix -->
          <div role="row">
            <div role="gridcell">
              <a role="link" href="/messages/t/333/">
                <span dir="auto">Team Sản Phẩm</span>
                <span dir="auto">Hùng:</span>
                <span dir="auto">Đã lên bản build mới · 2 phút</span>
                <div role="button" aria-label="Đánh dấu là đã đọc"></div>
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Open conversation history in [role="main"] must NOT be counted as unread sidebar threads,
           but CAN provide snippet fallback when senderHint matches the open heading and sidebar is collapsed -->
      <div role="main">
        <h2 dir="auto">Phạm Minh Đức</h2>
        <div role="grid">
          <div role="row"><div dir="auto">Tin cũ buổi sáng</div></div>
          <div role="row"><div dir="auto">Anh vừa gửi hợp đồng qua mail nhé</div></div>
        </div>
        <div role="textbox" contenteditable="true" dir="auto">Nháp đang gõ dở</div>
      </div>
    `;

    // 2 unmuted unread threads (row #1 muted via svg.x1tzjh5l:not(.x1k90msu), [role="tab"] & [role="main"] ignored)
    expect(extractUnreadFromDom('messenger', document)).toBe(2);
    // Title flashing to "Nguyễn Văn A đã nhắn tin cho bạn" falls back to DOM unread count = 2 instead of dropping to 0
    expect(
      resolveProviderUnreadCount('messenger', 'Nguyễn Văn A đã nhắn tin cho bạn', document)
    ).toBe(2);

    // Default top unread preview extracts clean sender + decrypted message + thumbs-up emoji (stripping SR labels & timestamp)
    expect(extractUnreadPreviewFromDom('messenger', document)).toEqual({
      sender: 'Nguyễn Văn A',
      snippet: 'Chốt 7h tối nhé 👍'
    });

    // Targeted senderHint matches the 2nd unread group row and joins speaker prefix + message while stripping trailing " · 2 phút"
    expect(extractUnreadPreviewFromDom('messenger', document, 'Team Sản Phẩm')).toEqual({
      sender: 'Team Sản Phẩm',
      snippet: 'Hùng: Đã lên bản build mới'
    });

    // Targeted senderHint for currently-open chat in [role="main"] (e.g., narrow collapsed sidebar) reads last incoming bubble, ignoring composer draft
    expect(extractUnreadPreviewFromDom('messenger', document, 'Phạm Minh Đức')).toEqual({
      sender: 'Phạm Minh Đức',
      snippet: 'Anh vừa gửi hợp đồng qua mail nhé'
    });
  });

  it('detects generic/empty E2EE notification bodies while preserving real messages and attachment descriptions', () => {
    expect(isGenericNotificationBody('', 'Nguyễn Văn A')).toBe(true);
    expect(isGenericNotificationBody('   ', 'Messenger')).toBe(true);
    expect(isGenericNotificationBody('Tin nhắn mới', 'Nguyễn Văn A')).toBe(true);
    expect(isGenericNotificationBody('Bạn có tin nhắn mới', 'Messenger')).toBe(true);
    expect(isGenericNotificationBody('Bạn có 2 tin nhắn chưa đọc', 'Messenger')).toBe(true);
    expect(isGenericNotificationBody('Đã gửi một tin nhắn', 'Nguyễn Văn A')).toBe(true);
    expect(isGenericNotificationBody('Đã gửi cho bạn một tin nhắn.', 'Nguyễn Văn A')).toBe(true);
    expect(
      isGenericNotificationBody('Nguyễn Văn A đã gửi cho bạn một tin nhắn', 'Messenger')
    ).toBe(true);
    expect(isGenericNotificationBody('Sent you a message', 'Alice')).toBe(true);
    expect(isGenericNotificationBody('Alice sent you a message.', 'Messenger')).toBe(true);
    expect(isGenericNotificationBody('New message', 'Messenger')).toBe(true);

    // Real messages and media/sticker attachment previews MUST NOT be treated as generic placeholders
    expect(isGenericNotificationBody('Đã gửi một ảnh', 'Nguyễn Văn A')).toBe(false);
    expect(isGenericNotificationBody('Sent a photo', 'Alice')).toBe(false);
    expect(isGenericNotificationBody('Đã gửi một nhãn dán', 'Nguyễn Văn A')).toBe(false);
    expect(isGenericNotificationBody('Tối nay 7h đi ăn nhé', 'Nguyễn Văn A')).toBe(false);

    expect(
      extractSenderHintFromNotification('messenger', '(1) Nguyễn Văn A', '')
    ).toBe('Nguyễn Văn A');
    expect(
      extractSenderHintFromNotification(
        'messenger',
        'Messenger',
        'Trần Thu Hà đã gửi cho bạn một tin nhắn'
      )
    ).toBe('Trần Thu Hà');
    expect(
      extractSenderHintFromNotification('messenger', 'Facebook', 'Alice sent you a message.')
    ).toBe('Alice');
    expect(extractSenderHintFromNotification('messenger', 'Messenger', 'Tin nhắn mới')).toBeNull();
  });
});
