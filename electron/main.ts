import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
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

  // Auto-updater IPC handlers
  ipcMain.handle('update:check', () => {
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle('update:download', () => {
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
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
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// macOS: Set quitting flag so close handler knows to actually quit
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows closed (app stays in dock)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
