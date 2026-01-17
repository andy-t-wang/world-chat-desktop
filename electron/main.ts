import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

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
  // Translation Service
  // =========================================================================

  ipcMain.handle('translation:isAvailable', () => {
    return true; // Translation is available in Electron
  });

  ipcMain.handle('translation:initialize', async (_, userLanguage: string) => {
    try {
      return await translationService.initialize(userLanguage);
    } catch (error) {
      console.error('[Translation] Initialize failed:', error);
      throw error;
    }
  });

  ipcMain.handle('translation:detectLanguage', async (_, text: string) => {
    try {
      return await translationService.detectLanguage(text);
    } catch (error) {
      console.error('[Translation] Detect language failed:', error);
      return { language: null, confidence: 0 };
    }
  });

  ipcMain.handle('translation:translate', async (_, text: string, from: string, to: string) => {
    try {
      return await translationService.translate(text, from, to);
    } catch (error) {
      console.error('[Translation] Translate failed:', error);
      throw error;
    }
  });

  ipcMain.handle('translation:dispose', async () => {
    try {
      await translationService.stop();
      return { success: true };
    } catch (error) {
      console.error('[Translation] Dispose failed:', error);
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
// Translation Service
// ============================================================================

class TranslationService {
  private process: ChildProcess | null = null;
  private isReady = false;
  private idleTimeout: NodeJS.Timeout | null = null;
  private pendingRequests: Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }> = new Map();
  private requestId = 0;
  private buffer = '';

  /** Spawn the Python translation subprocess */
  async start(): Promise<void> {
    if (this.process) return;

    // Find Python executable
    const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'translation', 'translate.py')
      : path.join(__dirname, '..', 'resources', 'translation', 'translate.py');

    return new Promise((resolve, reject) => {
      this.process = spawn(pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('[Translation] stderr:', data.toString());
      });

      this.process.on('error', (err) => {
        console.error('[Translation] Process error:', err);
        this.cleanup();
        reject(err);
      });

      this.process.on('exit', (code) => {
        console.log('[Translation] Process exited with code:', code);
        this.cleanup();
      });

      // Wait for ready signal
      const timeout = setTimeout(() => {
        reject(new Error('Translation service startup timeout'));
      }, 30000);

      const checkReady = () => {
        if (this.isReady) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);

        // Check for ready signal
        if (data.status === 'ready') {
          this.isReady = true;
          continue;
        }

        // Check for progress update - send to renderer
        if (data.progress !== undefined) {
          mainWindow?.webContents.send('translation:progress', data);
          continue;
        }

        // Route response to pending request (simple sequential model)
        const [firstKey] = this.pendingRequests.keys();
        if (firstKey !== undefined) {
          const pending = this.pendingRequests.get(firstKey);
          this.pendingRequests.delete(firstKey);
          if (data.error) {
            pending?.reject(new Error(data.error));
          } else {
            pending?.resolve(data);
          }
        }
      } catch (e) {
        console.error('[Translation] Failed to parse:', line);
      }
    }
  }

  private cleanup(): void {
    this.process = null;
    this.isReady = false;
    this.buffer = '';
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Translation service terminated'));
    }
    this.pendingRequests.clear();
  }

  /** Send command to subprocess and wait for response */
  private async sendCommand(cmd: Record<string, unknown>): Promise<unknown> {
    if (!this.process || !this.isReady) {
      throw new Error('Translation service not running');
    }

    // Reset idle timeout
    this.resetIdleTimeout();

    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Translation request timeout'));
      }, 60000);

      this.process?.stdin?.write(JSON.stringify(cmd) + '\n', (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  /** Initialize translation models */
  async initialize(userLanguage: string): Promise<{ success: boolean; installed: string[] }> {
    await this.start();
    return this.sendCommand({ cmd: 'init', userLanguage }) as Promise<{ success: boolean; installed: string[] }>;
  }

  /** Detect language of text */
  async detectLanguage(text: string): Promise<{ language: string | null; confidence: number }> {
    if (!this.isReady) {
      return { language: null, confidence: 0 };
    }
    return this.sendCommand({ cmd: 'detect', text }) as Promise<{ language: string | null; confidence: number }>;
  }

  /** Translate text */
  async translate(text: string, from: string, to: string): Promise<{ translatedText: string; from: string; to: string }> {
    if (!this.isReady) {
      throw new Error('Translation service not initialized');
    }
    return this.sendCommand({ cmd: 'translate', text, from, to }) as Promise<{ translatedText: string; from: string; to: string }>;
  }

  /** Stop the translation service */
  async stop(): Promise<void> {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    if (this.process && this.isReady) {
      try {
        await this.sendCommand({ cmd: 'quit' });
      } catch {
        // Ignore errors during shutdown
      }
    }

    if (this.process) {
      this.process.kill();
      this.cleanup();
    }
  }

  /** Reset idle timeout - stop service after 5 minutes of inactivity */
  private resetIdleTimeout(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }
    this.idleTimeout = setTimeout(() => {
      console.log('[Translation] Idle timeout, stopping service');
      this.stop();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /** Check if service is available */
  isAvailable(): boolean {
    return this.isReady;
  }
}

// Singleton translation service
const translationService = new TranslationService();

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
app.on('before-quit', async () => {
  isQuitting = true;
  // Stop translation service
  await translationService.stop();
});

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows closed (app stays in dock)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
