import type { ExternalProviderTab } from '../shared/types';
import { matchProviderByUrl } from '../providers/registry';

export async function openOrFocusWorkspace(
  tabsApi: Pick<typeof chrome.tabs, 'query' | 'update' | 'create'>,
  windowsApi: Pick<typeof chrome.windows, 'update'>,
  workspaceUrl: string
): Promise<number> {
  const existing = await tabsApi.query({ url: `${workspaceUrl}*` });
  const first = existing.find(
    (tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number' && tab.id >= 0
  );
  if (first) {
    if (typeof first.windowId === 'number' && first.windowId >= 0) {
      await windowsApi.update(first.windowId, { focused: true });
    }
    await tabsApi.update(first.id, { active: true, pinned: true });
    return first.id;
  }
  const created = await tabsApi.create({ url: workspaceUrl, active: true, pinned: true });
  return created.id ?? -1;
}

export function findExternalProviderTabs(
  tabs: readonly chrome.tabs.Tab[],
  workspaceUrl: string
): ExternalProviderTab[] {
  const results: ExternalProviderTab[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || tab.id < 0 || !tab.url) continue;
    if (tab.url.startsWith(workspaceUrl)) continue;
    const providerId = matchProviderByUrl(tab.url);
    if (providerId) {
      results.push({ tabId: tab.id, providerId, url: tab.url });
    }
  }
  return results;
}
