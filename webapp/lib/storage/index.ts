/**
 * Storage abstraction layer
 *
 * Detects Electron environment and uses encrypted storage (safeStorage via IPC),
 * otherwise falls back to localStorage for web browsers.
 */

const XMTP_SESSION_KEY = 'xmtp-session-cache';
const WORLD_CHAT_CONNECTED_KEY = 'world-chat-connected';

export interface SessionCache {
  address: string;
  inboxId: string;
  timestamp: number;
}

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).electronAPI?.isElectron;
}

// ============================================================================
// Session Cache
// ============================================================================

/**
 * Get cached XMTP session
 */
export async function getSessionCache(): Promise<SessionCache | null> {
  if (typeof window === 'undefined') return null;

  try {
    // Use Electron encrypted storage if available
    if (isElectron()) {
      return await (window as any).electronAPI.getSessionCache();
    }

    // Fall back to localStorage
    const cached = localStorage.getItem(XMTP_SESSION_KEY);
    if (!cached) return null;

    const session: SessionCache = JSON.parse(cached);
    // Check if session is not too old (7 days)
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - session.timestamp < maxAge) {
      return session;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save XMTP session to storage
 */
export async function setSessionCache(
  address: string,
  inboxId: string
): Promise<void> {
  if (typeof window === 'undefined') return;

  const session: SessionCache = {
    address: address.toLowerCase(),
    inboxId,
    timestamp: Date.now(),
  };

  try {
    // Use Electron encrypted storage if available
    if (isElectron()) {
      await (window as any).electronAPI.setSessionCache(session);
      return;
    }

    // Fall back to localStorage
    localStorage.setItem(XMTP_SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(WORLD_CHAT_CONNECTED_KEY, 'true');
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear session from storage
 */
export async function clearSessionCache(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    // Use Electron encrypted storage if available
    if (isElectron()) {
      await (window as any).electronAPI.clearSession();
      return;
    }

    // Fall back to localStorage
    localStorage.removeItem(XMTP_SESSION_KEY);
    localStorage.removeItem(WORLD_CHAT_CONNECTED_KEY);
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// Session Check (sync version for quick checks)
// ============================================================================

/**
 * Quick synchronous check if there's likely a session
 * In Electron, returns false since we need async IPC - use getSessionCache() instead
 * Use getSessionCache() for accurate async check
 */
export function hasSessionSync(): boolean {
  if (typeof window === 'undefined') return false;

  // In Electron, we can't do sync IPC - must use async getSessionCache()
  // Return false to force proper async session check
  if (isElectron()) return false;

  try {
    const connected = localStorage.getItem(WORLD_CHAT_CONNECTED_KEY);
    if (connected === 'true') return true;

    const cached = localStorage.getItem(XMTP_SESSION_KEY);
    if (cached) {
      const session = JSON.parse(cached);
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      if (session.timestamp && Date.now() - session.timestamp < maxAge) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// TypeScript declarations for Electron API
// ============================================================================

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getSessionCache: () => Promise<SessionCache | null>;
      setSessionCache: (data: SessionCache) => Promise<void>;
      clearSession: () => Promise<void>;
      isConnected: () => Promise<boolean>;
      getNicknames: () => Promise<Record<string, string>>;
      setNickname: (address: string, nickname: string) => Promise<void>;
      removeNickname: (address: string) => Promise<void>;
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      // Translation API
      translation?: {
        isAvailable: () => Promise<boolean>;
        isReady: () => Promise<boolean>;
        initialize: () => Promise<{ success: boolean }>;
        onProgress: (callback: (progress: { status: string; progress: number; file?: string }) => void) => () => void;
        getProgress: () => Promise<{ isInitializing: boolean; progress: { status: string; progress: number; file?: string } | null }>;
        detectLanguage: (text: string) => Promise<{ language: string | null; confidence: number }>;
        translate: (text: string, from: string, to: string) => Promise<{ translatedText: string; from: string; to: string }>;
        dispose: () => Promise<{ success: boolean }>;
        getEnabled: () => Promise<boolean>;
        setEnabled: (enabled: boolean) => Promise<void>;
        deleteModels: () => Promise<{ success: boolean }>;
      };
    };
  }
}
