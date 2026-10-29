import { describe, expect, it, vi } from 'vitest';
import {
  shouldUpgradeCookie,
  syncProviderCookies,
  toUpgradedCookieSetDetails
} from '../../src/background/cookie-bridge';
import {
  findExternalProviderTabs,
  openOrFocusWorkspace
} from '../../src/background/tab-coordinator';

const makeCookie = (overrides: Partial<chrome.cookies.Cookie> = {}): chrome.cookies.Cookie => ({
  name: 'zpw_sek',
  value: 'secret-token',
  domain: '.zalo.me',
  hostOnly: false,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  session: false,
  expirationDate: 1900000000,
  storeId: '0',
  ...overrides
});

describe('CookieBridge', () => {
  it('upgrades Lax/Strict provider cookies to SameSite=no_restriction and skips already-upgraded or overwrite events', () => {
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'lax' }), 'explicit')).toBe(true);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'strict' }), 'explicit')).toBe(true);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'unspecified' }), 'explicit')).toBe(true);
    expect(
      shouldUpgradeCookie(makeCookie({ sameSite: 'no_restriction', secure: false }), 'explicit')
    ).toBe(true);
    expect(
      shouldUpgradeCookie(makeCookie({ sameSite: 'no_restriction', secure: true }), 'explicit')
    ).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'lax' }), 'overwrite')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'lax' }), 'expired')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'lax' }), 'evicted')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ sameSite: 'lax' }), 'expired_overwrite')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ domain: '.example.org' }), 'explicit')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ domain: 'notzalo.me' }), 'explicit')).toBe(false);
    expect(shouldUpgradeCookie(makeCookie({ domain: 'login.facebook.com' }), 'explicit')).toBe(
      true
    );

    const details = toUpgradedCookieSetDetails(makeCookie({ domain: '.zalo.me', hostOnly: false }));
    expect(details).toMatchObject({
      url: 'https://zalo.me/',
      domain: '.zalo.me',
      name: 'zpw_sek',
      value: 'secret-token',
      sameSite: 'no_restriction',
      secure: true,
      httpOnly: true,
      expirationDate: 1900000000
    });
  });

  it('omits domain field for hostOnly cookies during sync', async () => {
    const getAll = vi.fn().mockResolvedValue([
      makeCookie({ domain: 'chat.zalo.me', hostOnly: true, sameSite: 'lax' })
    ]);
    const set = vi.fn().mockResolvedValue({});
    const count = await syncProviderCookies({ getAll, set }, ['zalo']);
    expect(count).toBe(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://chat.zalo.me/',
        sameSite: 'no_restriction',
        secure: true
      })
    );
    expect(set.mock.calls[0]?.[0]?.domain).toBeUndefined();
  });

  it('enforces __Host- cookie invariants, preserves partitionKey, and omits expirationDate for session cookies', () => {
    const hostCookieDetails = toUpgradedCookieSetDetails(
      makeCookie({
        name: '__Host-discord_session',
        domain: 'discord.com',
        hostOnly: false,
        path: '/app',
        session: true,
        expirationDate: 1900000000,
        partitionKey: { topLevelSite: 'https://discord.com', hasCrossSiteAncestor: false }
      })
    );
    expect(hostCookieDetails.url).toBe('https://discord.com/');
    expect(hostCookieDetails.path).toBe('/');
    expect(hostCookieDetails.domain).toBeUndefined();
    expect(hostCookieDetails.secure).toBe(true);
    expect(hostCookieDetails.sameSite).toBe('no_restriction');
    expect(hostCookieDetails.expirationDate).toBeUndefined();
    expect(hostCookieDetails.partitionKey).toEqual({
      topLevelSite: 'https://discord.com',
      hasCrossSiteAncestor: false
    });

    // Round-trip loop prevention: upgraded cookie must not re-trigger upgrade on subsequent explicit event
    const upgradedCookie = makeCookie({
      sameSite: hostCookieDetails.sameSite ?? 'unspecified',
      secure: Boolean(hostCookieDetails.secure)
    });
    expect(shouldUpgradeCookie(upgradedCookie, 'explicit')).toBe(false);
  });

  it('continues syncing remaining cookies when browser rejects or returns null for a protected cookie', async () => {
    const getAll = vi.fn().mockImplementation(async ({ domain }: { domain: string }) => {
      if (domain === 'discord.com') {
        return [
          makeCookie({
            name: '__Host-protected',
            domain: 'discord.com',
            hostOnly: true,
            sameSite: 'lax'
          }),
          makeCookie({
            name: '__Host-null',
            domain: 'discord.com',
            hostOnly: true,
            sameSite: 'lax'
          }),
          makeCookie({
            name: 'locale',
            domain: '.discord.com',
            hostOnly: false,
            sameSite: 'lax'
          }),
          makeCookie({
            name: 'already_ok',
            domain: '.discord.com',
            sameSite: 'no_restriction',
            secure: true
          })
        ];
      }
      return [];
    });
    const set = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to set __Host- cookie'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({});

    const count = await syncProviderCookies({ getAll, set });
    expect(count).toBe(1);
    expect(set).toHaveBeenCalledTimes(3);
  });
});

describe('TabCoordinator', () => {
  const wsUrl = 'chrome-extension://abc/workspace.html';

  it('focuses and pins existing workspace tab instead of creating duplicate', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42, windowId: 7, url: wsUrl }]);
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn();
    const winUpdate = vi.fn().mockResolvedValue({});

    const tabId = await openOrFocusWorkspace({ query, update, create }, { update: winUpdate }, wsUrl);
    expect(tabId).toBe(42);
    expect(query).toHaveBeenCalledWith({ url: `${wsUrl}*` });
    expect(winUpdate).toHaveBeenCalledWith(7, { focused: true });
    expect(update).toHaveBeenCalledWith(42, { active: true, pinned: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a pinned active workspace tab when none exists', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const update = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: 99 });
    const winUpdate = vi.fn();

    const tabId = await openOrFocusWorkspace({ query, update, create }, { update: winUpdate }, wsUrl);
    expect(tabId).toBe(99);
    expect(create).toHaveBeenCalledWith({ url: wsUrl, active: true, pinned: true });
    expect(update).not.toHaveBeenCalled();
    expect(winUpdate).not.toHaveBeenCalled();
  });

  it('detects standalone chat tabs outside workspace', () => {
    const dups = findExternalProviderTabs(
      [
        { id: 1, url: wsUrl } as chrome.tabs.Tab,
        { id: 5, url: `${wsUrl}#main` } as chrome.tabs.Tab,
        { id: 2, url: 'https://chat.zalo.me/' } as chrome.tabs.Tab,
        { id: 3, url: 'https://discord.com/channels/@me' } as chrome.tabs.Tab,
        { id: 4, url: 'https://news.ycombinator.com' } as chrome.tabs.Tab,
        { url: 'https://web.telegram.org/k/' } as chrome.tabs.Tab
      ],
      wsUrl
    );
    expect(dups).toEqual([
      { tabId: 2, providerId: 'zalo', url: 'https://chat.zalo.me/' },
      { tabId: 3, providerId: 'discord', url: 'https://discord.com/channels/@me' }
    ]);
  });
});
