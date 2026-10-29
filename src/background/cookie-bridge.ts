import type { ProviderId } from '../shared/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers/registry';

const MANAGED_DOMAINS = Array.from(
  new Set(PROVIDER_ORDER.flatMap((id) => PROVIDERS[id].cookieDomains))
);

const HOST_COOKIE_PREFIX = /^__host-/i;

function isManagedCookieDomain(cookieDomain: string): boolean {
  const clean = cookieDomain.toLowerCase().replace(/^\./, '');
  return MANAGED_DOMAINS.some((d) => {
    const target = d.toLowerCase().replace(/^\./, '');
    return clean === target || clean.endsWith(`.${target}`);
  });
}

export function shouldUpgradeCookie(cookie: chrome.cookies.Cookie, cause?: string): boolean {
  if (
    cause === 'overwrite' ||
    cause === 'expired' ||
    cause === 'evicted' ||
    cause === 'expired_overwrite'
  ) {
    return false;
  }
  if (!isManagedCookieDomain(cookie.domain)) {
    return false;
  }
  if (cookie.sameSite === 'no_restriction' && cookie.secure) {
    return false;
  }
  return true;
}

export function toUpgradedCookieSetDetails(
  cookie: chrome.cookies.Cookie
): chrome.cookies.SetDetails {
  const isHostPrefix = HOST_COOKIE_PREFIX.test(cookie.name);
  const cleanHost = cookie.domain.replace(/^\./, '');
  const rawPath = cookie.path || '/';
  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const path = isHostPrefix ? '/' : normalizedPath;
  const details: chrome.cookies.SetDetails = {
    url: `https://${cleanHost}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure: true,
    httpOnly: cookie.httpOnly,
    sameSite: 'no_restriction',
    storeId: cookie.storeId
  };
  if (!cookie.hostOnly && !isHostPrefix) {
    details.domain = cookie.domain;
  }
  if (!cookie.session && typeof cookie.expirationDate === 'number') {
    details.expirationDate = cookie.expirationDate;
  }
  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }
  return details;
}

export async function syncProviderCookies(
  cookiesApi: Pick<typeof chrome.cookies, 'getAll' | 'set'>,
  providerIds: readonly ProviderId[] = PROVIDER_ORDER
): Promise<number> {
  const domains = new Set(
    providerIds.flatMap((id) => PROVIDERS[id].cookieDomains.map((d) => d.replace(/^\./, '')))
  );
  let upgraded = 0;
  const seenKeys = new Set<string>();

  for (const domain of domains) {
    const cookies = await cookiesApi.getAll({ domain });
    for (const cookie of cookies) {
      const partition = cookie.partitionKey
        ? `${cookie.partitionKey.topLevelSite ?? ''}:${String(cookie.partitionKey.hasCrossSiteAncestor ?? '')}`
        : '';
      const key = `${cookie.storeId}|${cookie.domain}|${cookie.path}|${cookie.name}|${partition}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (!shouldUpgradeCookie(cookie)) continue;
      try {
        const result = await cookiesApi.set(toUpgradedCookieSetDetails(cookie));
        if (result !== null) {
          upgraded += 1;
        }
      } catch {
        // Ignore browser-protected __Host- prefix edge cookies if rejected
      }
    }
  }
  return upgraded;
}
