export type ProviderId = 'zalo' | 'messenger' | 'telegram' | 'discord';

export type SlotId = 'main' | 'sub-1' | 'sub-2' | 'sub-3';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  shortcutIndex: 1 | 2 | 3 | 4;
  embedUrl: string;
  loginUrl: string;
  hostPatterns: string[];
  cookieDomains: string[];
  titleUnreadRegex: RegExp;
  badgeSelectors: string[];
  subPaneCss: string;
}

export interface WorkspacePrefs {
  slotOrder: [ProviderId, ProviderId, ProviderId, ProviderId];
  mainWidthPct: number;
  topbarPinned: boolean;
  dnd: boolean;
  hidePreview: boolean;
  liteMedia: boolean;
  paused: Record<ProviderId, boolean>;
}

export interface NotifyPayload {
  providerId: ProviderId;
  title: string;
  body: string;
  tag?: string;
  notifToken?: string;
}

export interface ExternalProviderTab {
  tabId: number;
  providerId: ProviderId;
  url: string;
}

export interface PendingClickTarget {
  providerId: ProviderId;
  notifToken?: string;
}

export type RuntimeMessage =
  | { type: 'CHAT_NOTIFY'; payload: NotifyPayload }
  | { type: 'UNREAD_UPDATE'; providerId: ProviderId; count: number }
  | {
      type: 'WORKSPACE_FOCUS_STATE';
      windowFocused: boolean;
      focusedProvider: ProviderId | null;
    }
  | {
      type: 'SYNC_PREFS';
      prefs: Pick<WorkspacePrefs, 'dnd' | 'hidePreview' | 'liteMedia'> & {
        paused?: Record<ProviderId, boolean>;
      };
    }
  | { type: 'FRAME_FOCUSED'; providerId: ProviderId }
  | { type: 'ACTIVE_PROVIDER_CHANGED'; providerId: ProviderId }
  | { type: 'OPEN_REAUTH'; providerId: ProviderId }
  | { type: 'TEST_NOTIFY' }
  | { type: 'GET_DUP_TABS' }
  | { type: 'CLOSE_DUP_TABS' }
  | { type: 'CONSUME_PENDING_CLICK' }
  | { type: 'FOCUS_PROVIDER'; providerId: ProviderId }
  | { type: 'RELOAD_PROVIDER'; providerId: ProviderId }
  | { type: 'TRIGGER_NOTIFY_CLICK'; providerId: ProviderId; notifToken?: string }
  | { type: 'DUP_TABS_CHANGED'; tabs: ExternalProviderTab[] };

export type WorkspaceToFrameMessage = {
  source: 'dia-bento-workspace';
  type: 'DIA_SLOT_MODE';
  providerId: ProviderId;
  isMain: boolean;
};

export type MainToIsolatedEvent = {
  type: 'RAW_NOTIFY';
  title: string;
  body: string;
  tag?: string;
  notifToken: string;
};

export type IsolatedToMainEvent =
  | { type: 'SET_THROTTLE'; throttled: boolean }
  | { type: 'CLICK_NOTIFY'; notifToken: string };
