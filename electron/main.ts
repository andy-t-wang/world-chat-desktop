import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { ChildProcess, spawn } from 'child_process';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';

// Paths
const STORAGE_FILE = path.join(app.getPath('userData'), 'secure-storage.enc');
const DEV_SERVER_URL = 'http://localhost:3000';
const PRODUCTION_URL = 'https://world-chat-web.vercel.app';

// State
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// ============================================================================
// Single Instance Lock
// ============================================================================

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  console.log('Another instance is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the main window if user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

// ============================================================================
// Encrypted Storage
// ============================================================================

interface SecureData {
  sessionCache?: {
    address: string;
    inboxId: string;
    timestamp: number;
  };
  connected?: boolean;
  customNicknames?: Record<string, string>;
  translationEnabled?: boolean;
}

let storageCache: SecureData | null = null;

function getSecureData(): SecureData {
  if (storageCache) return storageCache;

  if (!fs.existsSync(STORAGE_FILE)) {
    storageCache = {};
    return storageCache;
  }

  try {
    const encrypted = fs.readFileSync(STORAGE_FILE);
    const decrypted = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(decrypted) as SecureData | null;
    const result: SecureData = parsed ?? {};
    storageCache = result;
    return result;
  } catch (error) {
    console.error('Failed to read secure storage:', error);
    const empty: SecureData = {};
    storageCache = empty;
    return empty;
  }
}

function setSecureData(data: Partial<SecureData>): void {
  storageCache = { ...getSecureData(), ...data };

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('Encryption not available, storing unencrypted');
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(storageCache));
    return;
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(storageCache));
  fs.writeFileSync(STORAGE_FILE, encrypted);
}

function clearSecureData(): void {
  storageCache = {};
  if (fs.existsSync(STORAGE_FILE)) {
    fs.unlinkSync(STORAGE_FILE);
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

function setupIpcHandlers() {
  // Session cache
  ipcMain.handle('storage:getSessionCache', () => {
    const data = getSecureData();
    return data.sessionCache || null;
  });

  ipcMain.handle('storage:setSessionCache', (_, sessionData: SecureData['sessionCache']) => {
    setSecureData({ sessionCache: sessionData, connected: true });
  });

  ipcMain.handle('storage:clearSession', () => {
    const data = getSecureData();
    delete data.sessionCache;
    data.connected = false;
    setSecureData(data);
  });

  ipcMain.handle('storage:isConnected', () => {
    const data = getSecureData();
    return data.connected || false;
  });

  // Custom nicknames
  ipcMain.handle('storage:getNicknames', () => {
    const data = getSecureData();
    return data.customNicknames || {};
  });

  ipcMain.handle('storage:setNickname', (_, address: string, nickname: string) => {
    const data = getSecureData();
    const nicknames = data.customNicknames || {};
    nicknames[address.toLowerCase()] = nickname;
    setSecureData({ customNicknames: nicknames });
  });

  ipcMain.handle('storage:removeNickname', (_, address: string) => {
    const data = getSecureData();
    const nicknames = data.customNicknames || {};
    delete nicknames[address.toLowerCase()];
    setSecureData({ customNicknames: nicknames });
  });

  // App info
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getPlatform', () => {
    return process.platform;
  });

  // Dock badge (macOS)
  ipcMain.handle('app:setBadgeCount', (_, count: number) => {
    if (process.platform === 'darwin' && app.dock) {
      if (count > 0) {
        app.dock.setBadge(count.toString());
      } else {
        app.dock.setBadge('');
      }
    }
  });

  // Focus window (for notification clicks)
  ipcMain.handle('app:focusWindow', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Auto-updater IPC handlers
  ipcMain.handle('update:check', () => {
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle('update:download', () => {
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle('update:install', () => {
    // Force quit and install - destroy window first to avoid macOS hide behavior
    isQuitting = true;

    // Remove all listeners that might prevent quit
    app.removeAllListeners('window-all-closed');
    app.removeAllListeners('before-quit');

    // Destroy the window explicitly (bypass the close handler)
    if (mainWindow) {
      mainWindow.destroy();
      mainWindow = null;
    }

    // Now quit and install
    autoUpdater.quitAndInstall(false, true);
  });

  // =========================================================================
  // Translation Service (Utility Process)
  // =========================================================================

  ipcMain.handle('translation:isAvailable', () => {
    return true; // Translation is available in Electron desktop
  });

  ipcMain.handle('translation:isReady', async () => {
    if (!translationProcess) return false;
    try {
      return await sendToWorker<boolean>('isReady');
    } catch {
      return false;
    }
  });

  ipcMain.handle('translation:initialize', async () => {
    try {
      translationInitializing = true;
      lastTranslationProgress = null;
      // Start the utility process if not running
      await startTranslationProcess();
      // Initialize the translation model in the worker
      const result = await sendToWorker<{ success: boolean }>('initialize');
      translationReady = true;
      translationInitializing = false;
      lastTranslationProgress = null;
      // Save enabled preference on successful initialization
      setSecureData({ translationEnabled: true });
      return result;
    } catch (error) {
      console.error('[Translation] Initialize failed:', error);
      translationInitializing = false;
      lastTranslationProgress = null;
      throw error;
    }
  });

  ipcMain.handle('translation:getProgress', () => {
    return {
      isInitializing: translationInitializing,
      progress: lastTranslationProgress,
    };
  });

  ipcMain.handle('translation:detectLanguage', async () => {
    // Language detection not implemented - user specifies source language
    return { language: null, confidence: 0 };
  });

  ipcMain.handle('translation:translate', async (_, text: string, from: string, to: string) => {
    try {
      if (!translationProcess || !translationReady) {
        throw new Error('Translation service not initialized');
      }
      return await sendToWorker<{ translatedText: string; from: string; to: string }>(
        'translate',
        { text, from, to }
      );
    } catch (error) {
      console.error('[Translation] Translate failed:', error);
      throw error;
    }
  });

  ipcMain.handle('translation:dispose', async () => {
    try {
      if (translationProcess) {
        await sendToWorker('dispose');
        stopTranslationProcess();
      }
      translationReady = false;
      // Clear the enabled preference when disposing
      setSecureData({ translationEnabled: false });
      return { success: true };
    } catch (error) {
      console.error('[Translation] Dispose failed:', error);
      // Force stop even if dispose fails
      stopTranslationProcess();
      setSecureData({ translationEnabled: false });
      return { success: true };
    }
  });

  ipcMain.handle('translation:getEnabled', () => {
    const data = getSecureData();
    return data.translationEnabled ?? false;
  });

  ipcMain.handle('translation:setEnabled', (_, enabled: boolean) => {
    setSecureData({ translationEnabled: enabled });
  });

  ipcMain.handle('translation:deleteModels', async () => {
    try {
      // Stop the translation process if running
      if (translationProcess) {
        try {
          await sendToWorker('dispose');
        } catch {
          // Ignore errors during dispose
        }
        stopTranslationProcess();
      }
      translationReady = false;

      // Clear the enabled preference
      setSecureData({ translationEnabled: false });

      // Delete the translation models directory
      const cacheDir = path.join(app.getPath('userData'), 'translation-models');
      const fs = await import('fs/promises');
      try {
        await fs.rm(cacheDir, { recursive: true, force: true });
        console.log('[Translation] Deleted models directory:', cacheDir);
      } catch (err) {
        console.error('[Translation] Failed to delete models:', err);
        // Don't throw - the directory might not exist
      }

      return { success: true };
    } catch (error) {
      console.error('[Translation] Delete models failed:', error);
      throw error;
    }
  });
}

// ============================================================================
// Auto-Updater
// ============================================================================

function setupAutoUpdater() {
  // Don't check for updates in development
  if (!app.isPackaged) return;

  // Configure auto-updater
  autoUpdater.autoDownload = false; // Manual download control
  autoUpdater.autoInstallOnAppQuit = true;

  // Forward events to renderer
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (error) => {
    mainWindow?.webContents.send('update-error', error.message);
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently ignore update check errors
    });
  }, 3000);

  // Check for updates periodically (every 30 minutes)
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently ignore update check errors
    });
  }, 30 * 60 * 1000);
}

// ============================================================================
// Translation Service (System Node.js Process)
// ============================================================================

let translationProcess: ChildProcess | null = null;
let pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let requestId = 0;
let translationReady = false;
let translationInitializing = false;
let lastTranslationProgress: { status: string; progress: number; file?: string } | null = null;
let messageBuffer = '';

// Find system Node.js (not Electron's)
function findSystemNode(): string | null {
  const { execSync } = require('child_process');
  const possiblePaths = [
    '/opt/homebrew/bin/node',  // macOS ARM Homebrew
    '/usr/local/bin/node',     // macOS Intel Homebrew
    '/usr/bin/node',           // Linux system
  ];

  // Try 'which node' first
  try {
    const nodePath = execSync('which node', { encoding: 'utf8' }).trim();
    if (nodePath && !nodePath.includes('Electron')) {
      return nodePath;
    }
  } catch {
    // Ignore
  }

  // Try common paths
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

function startTranslationProcess(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (translationProcess) {
      resolve();
      return;
    }

    const nodePath = findSystemNode();
    if (!nodePath) {
      reject(new Error('System Node.js not found. Please install Node.js.'));
      return;
    }

    console.log('[Translation] Starting process with system Node.js:', nodePath);
    const cacheDir = path.join(app.getPath('userData'), 'translation-models');
    const workerPath = path.join(__dirname, 'translation-worker.js');

    // Spawn using system Node.js with IPC
    translationProcess = spawn(nodePath, [workerPath, cacheDir], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });

    // Handle stdout (for logs)
    translationProcess.stdout?.on('data', (data) => {
      console.log('[TranslationWorker]', data.toString().trim());
    });

    // Handle stderr
    translationProcess.stderr?.on('data', (data) => {
      console.error('[TranslationWorker Error]', data.toString().trim());
    });

    // Handle IPC messages
    translationProcess.on('message', (msg: { id?: string; type: string; payload?: unknown }) => {
      if (msg.type === 'ready') {
        console.log('[Translation] Process ready');
        resolve();
        return;
      }

      if (msg.type === 'progress') {
        lastTranslationProgress = msg.payload as { status: string; progress: number; file?: string };
        mainWindow?.webContents.send('translation:progress', msg.payload);
        return;
      }

      if (msg.id && (msg.type === 'result' || msg.type === 'error')) {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          if (msg.type === 'error') {
            pending.reject(new Error(msg.payload as string));
          } else {
            pending.resolve(msg.payload);
          }
          pendingRequests.delete(msg.id);
        }
      }
    });

    translationProcess.on('exit', (code) => {
      console.log('[Translation] Process exited with code:', code);
      translationProcess = null;
      translationReady = false;
      for (const [id, { reject: rej }] of pendingRequests) {
        rej(new Error('Translation process exited'));
        pendingRequests.delete(id);
      }
    });

    translationProcess.on('error', (error) => {
      console.error('[Translation] Process error:', error);
      reject(error);
    });

    // Timeout
    setTimeout(() => {
      if (translationProcess && !translationReady) {
        // Don't reject if we're still initializing the model
      }
    }, 10000);
  });
}

function sendToWorker<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!translationProcess) {
      reject(new Error('Translation process not running'));
      return;
    }

    const id = String(++requestId);
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject
    });
    translationProcess.send({ id, type, payload });

    const timeout = type === 'initialize' ? 300000 : 60000; // 5min for init, 1min for translate
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Translation request timed out: ${type}`));
      }
    }, timeout);
  });
}

function stopTranslationProcess(): void {
  if (translationProcess) {
    console.log('[Translation] Stopping process...');
    translationProcess.kill();
    translationProcess = null;
    translationReady = false;
  }
}

// ============================================================================
// Window Management
// ============================================================================

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true, // Center window on screen like Signal
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // In development, connect to local dev server
  // In production, load the deployed web app
  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(PRODUCTION_URL);
  }

  // macOS: Hide window instead of closing (like Telegram/Signal)
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow internal navigation (both dev and production URLs)
    if (url.startsWith(DEV_SERVER_URL) || url.startsWith(PRODUCTION_URL)) {
      return { action: 'allow' };
    }
    // Open external links in default browser
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    // macOS: Show hidden window or re-create if needed
    if (mainWindow) {
      mainWindow.show();
      // Check for updates when window is shown
      if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch(() => {});
      }
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// macOS: Set quitting flag so close handler knows to actually quit
app.on('before-quit', () => {
  isQuitting = true;
  // Stop translation utility process
  stopTranslationProcess();
});

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows closed (app stays in dock)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
