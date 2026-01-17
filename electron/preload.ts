/**
 * Preload script - Secure bridge between main process and renderer
 *
 * This script runs in a sandboxed context with access to a limited set of
 * Electron APIs. It exposes a safe API to the renderer via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Session cache type
interface SessionCache {
  address: string;
  inboxId: string;
  timestamp: number;
}

// Expose secure APIs to the renderer (window.electronAPI)
contextBridge.exposeInMainWorld('electronAPI', {
  // =========================================================================
  // Platform Detection
  // =========================================================================

  /** Indicates this is running in Electron */
  isElectron: true,

  // =========================================================================
  // Session Storage (encrypted)
  // =========================================================================

  /** Get cached XMTP session */
  getSessionCache: (): Promise<SessionCache | null> => {
    return ipcRenderer.invoke('storage:getSessionCache');
  },

  /** Save XMTP session to encrypted storage */
  setSessionCache: (data: SessionCache): Promise<void> => {
    return ipcRenderer.invoke('storage:setSessionCache', data);
  },

  /** Clear session from encrypted storage */
  clearSession: (): Promise<void> => {
    return ipcRenderer.invoke('storage:clearSession');
  },

  /** Check if user was previously connected */
  isConnected: (): Promise<boolean> => {
    return ipcRenderer.invoke('storage:isConnected');
  },

  // =========================================================================
  // Custom Nicknames (encrypted)
  // =========================================================================

  /** Get all custom nicknames */
  getNicknames: (): Promise<Record<string, string>> => {
    return ipcRenderer.invoke('storage:getNicknames');
  },

  /** Set a custom nickname for an address */
  setNickname: (address: string, nickname: string): Promise<void> => {
    return ipcRenderer.invoke('storage:setNickname', address, nickname);
  },

  /** Remove a custom nickname */
  removeNickname: (address: string): Promise<void> => {
    return ipcRenderer.invoke('storage:removeNickname', address);
  },

  // =========================================================================
  // App Info
  // =========================================================================

  /** Get app version */
  getVersion: (): Promise<string> => {
    return ipcRenderer.invoke('app:getVersion');
  },

  /** Get platform (darwin, win32, linux) */
  getPlatform: (): Promise<string> => {
    return ipcRenderer.invoke('app:getPlatform');
  },

  /** Set dock badge count (macOS) */
  setBadgeCount: (count: number): Promise<void> => {
    return ipcRenderer.invoke('app:setBadgeCount', count);
  },

  /** Focus the app window */
  focusWindow: (): Promise<void> => {
    return ipcRenderer.invoke('app:focusWindow');
  },

  // =========================================================================
  // Auto-Updater
  // =========================================================================

  /** Check for updates */
  checkForUpdates: (): Promise<void> => {
    return ipcRenderer.invoke('update:check');
  },

  /** Download available update */
  downloadUpdate: (): Promise<void> => {
    return ipcRenderer.invoke('update:download');
  },

  /** Install downloaded update (quits and restarts app) */
  installUpdate: (): Promise<void> => {
    return ipcRenderer.invoke('update:install');
  },

  /** Listen for update available event */
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string }) => void): void => {
    ipcRenderer.on('update-available', (_, info) => callback(info));
  },

  /** Listen for download progress */
  onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void): void => {
    ipcRenderer.on('update-progress', (_, progress) => callback(progress));
  },

  /** Listen for update downloaded event */
  onUpdateDownloaded: (callback: (info: { version: string }) => void): void => {
    ipcRenderer.on('update-downloaded', (_, info) => callback(info));
  },

  /** Listen for update errors */
  onUpdateError: (callback: (error: string) => void): void => {
    ipcRenderer.on('update-error', (_, error) => callback(error));
  },

  // =========================================================================
  // Translation Service
  // =========================================================================

  translation: {
    /** Check if translation is available (only in Electron) */
    isAvailable: (): Promise<boolean> => {
      return ipcRenderer.invoke('translation:isAvailable');
    },

    /** Initialize translation service and download models */
    initialize: (userLanguage: string): Promise<{ success: boolean; installed: string[] }> => {
      return ipcRenderer.invoke('translation:initialize', userLanguage);
    },

    /** Listen for progress updates during initialization */
    onProgress: (callback: (progress: { progress: number; total: number; message: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { progress: number; total: number; message: string }) => {
        callback(data);
      };
      ipcRenderer.on('translation:progress', handler);
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('translation:progress', handler);
      };
    },

    /** Detect language of text */
    detectLanguage: (text: string): Promise<{ language: string | null; confidence: number }> => {
      return ipcRenderer.invoke('translation:detectLanguage', text);
    },

    /** Translate text from one language to another */
    translate: (text: string, from: string, to: string): Promise<{ translatedText: string; from: string; to: string }> => {
      return ipcRenderer.invoke('translation:translate', text, from, to);
    },

    /** Stop translation service and free memory */
    dispose: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('translation:dispose');
    },
  },
});

// TypeScript declaration for window.electronAPI
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
      setBadgeCount: (count: number) => Promise<void>;
      focusWindow: () => Promise<void>;
      // Auto-updater
      checkForUpdates: () => Promise<void>;
      downloadUpdate: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateAvailable: (callback: (info: { version: string; releaseDate: string }) => void) => void;
      onUpdateProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => void;
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => void;
      onUpdateError: (callback: (error: string) => void) => void;
      // Translation
      translation: {
        isAvailable: () => Promise<boolean>;
        initialize: (userLanguage: string) => Promise<{ success: boolean; installed: string[] }>;
        onProgress: (callback: (progress: { progress: number; total: number; message: string }) => void) => () => void;
        detectLanguage: (text: string) => Promise<{ language: string | null; confidence: number }>;
        translate: (text: string, from: string, to: string) => Promise<{ translatedText: string; from: string; to: string }>;
        dispose: () => Promise<{ success: boolean }>;
      };
    };
  }
}
