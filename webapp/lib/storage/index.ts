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

    return JSON.parse(cached) as SessionCache;
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
 * Check if XMTP OPFS database exists for a given inboxId
 */
export async function checkXmtpDatabaseExists(inboxId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const root = await navigator.storage.getDirectory();
    const dbName = `xmtp-production-${inboxId}.db3`;

    // Try to get file handle - will throw if doesn't exist
    await root.getFileHandle(dbName);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all XMTP databases in OPFS (for debugging)
 */
export async function listXmtpDatabases(): Promise<string[]> {
  if (typeof window === 'undefined') return [];

  try {
    const root = await navigator.storage.getDirectory();
    const files: string[] = [];

    // @ts-ignore - entries() exists on FileSystemDirectoryHandle
    for await (const [name] of root.entries()) {
      if (name.startsWith('xmtp-') && name.endsWith('.db3')) {
        files.push(name);
      }
    }
    return files;
  } catch (error) {
    console.warn('[Storage] Failed to list OPFS files:', error);
    return [];
  }
}

/**
 * Delete XMTP OPFS database for a given inboxId
 * Call this when identity is uninitialized to prevent orphan installations
 */
export async function deleteXmtpDatabase(inboxId: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    // XMTP uses OPFS with file pattern: xmtp-{environment}-{inbox-id}.db3
    const root = await navigator.storage.getDirectory();
    const dbName = `xmtp-production-${inboxId}.db3`;

    console.log('[Storage] Attempting to delete XMTP database:', dbName);

    // Try to remove the file
    await root.removeEntry(dbName);
    console.log('[Storage] Successfully deleted XMTP database:', dbName);
    return true;
  } catch (error) {
    // File might not exist or other error
    console.warn('[Storage] Failed to delete XMTP database:', error);
    return false;
  }
}

/**
 * Delete ALL XMTP databases in OPFS
 * Use during logout to ensure clean state and allow recovery from corruption
 */
export async function deleteAllXmtpDatabases(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const root = await navigator.storage.getDirectory();
    const toDelete: string[] = [];

    // @ts-ignore - entries() exists on FileSystemDirectoryHandle
    for await (const [name] of root.entries()) {
      if (name.startsWith('xmtp-') && name.endsWith('.db3')) {
        toDelete.push(name);
      }
    }

    for (const name of toDelete) {
      try {
        await root.removeEntry(name);
        console.log('[Storage] Deleted XMTP database:', name);
      } catch (err) {
        console.warn('[Storage] Failed to delete:', name, err);
      }
    }

    if (toDelete.length > 0) {
      console.log('[Storage] Deleted', toDelete.length, 'XMTP database(s)');
    }
  } catch (error) {
    console.warn('[Storage] Failed to list/delete OPFS files:', error);
  }
}

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
      return true;
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
        onProgress: (callback: (progress: { status: string; progress: number; file?: string; timeEstimate?: string }) => void) => () => void;
        getProgress: () => Promise<{ isInitializing: boolean; progress: { status: string; progress: number; file?: string; timeEstimate?: string } | null }>;
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
