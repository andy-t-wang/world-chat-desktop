import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';
import { ChildProcess, spawn, execSync } from 'child_process';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';

// Paths
const STORAGE_FILE = path.join(app.getPath('userData'), 'secure-storage.enc');
const DEBUG_LOG_FILE = path.join(app.getPath('userData'), 'debug.log');
const DEV_SERVER_URL = 'http://localhost:3000';
const PRODUCTION_URL = 'https://world-chat-web.vercel.app';
const ALTERNATE_PRODUCTION_URL = 'https://chat.world.app';

// Debug logging - persists to file for debugging across restarts
function debugLog(source: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${source}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;

  // Also log to console
  console.log(logLine.trim());

  // Append to file (keep last 500 lines to avoid huge files)
  try {
    let existing = '';
    if (fs.existsSync(DEBUG_LOG_FILE)) {
      existing = fs.readFileSync(DEBUG_LOG_FILE, 'utf8');
      const lines = existing.split('\n');
      if (lines.length > 500) {
        existing = lines.slice(-250).join('\n') + '\n';
      }
    }
    fs.writeFileSync(DEBUG_LOG_FILE, existing + logLine);
  } catch (e) {
    console.error('Failed to write debug log:', e);
  }
}

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

  // Debug logging - persists to file for debugging across restarts
  ipcMain.handle('app:debugLog', (_, source: string, message: string, data?: unknown) => {
    debugLog(source, message, data);
  });

  // Get debug log contents
  ipcMain.handle('app:getDebugLog', () => {
    try {
      if (fs.existsSync(DEBUG_LOG_FILE)) {
        return fs.readFileSync(DEBUG_LOG_FILE, 'utf8');
      }
    } catch (e) {
      console.error('Failed to read debug log:', e);
    }
    return '';
  });

  // Download file (for saving images from blob URLs)
  ipcMain.handle('app:downloadFile', async (_, data: { buffer: number[]; filename: string; mimeType: string }) => {
    if (!mainWindow) return { success: false, error: 'No window' };

    // Determine file extension from mime type if not in filename
    let defaultPath = data.filename;
    if (!defaultPath.includes('.')) {
      const ext = data.mimeType.split('/')[1] || 'bin';
      defaultPath = `${defaultPath}.${ext}`;
    }

    // Determine file filters based on mime type
    let filters: { name: string; extensions: string[] }[] = [];
    if (data.mimeType.startsWith('image/')) {
      const ext = data.mimeType.split('/')[1] || 'png';
      filters = [{ name: 'Images', extensions: [ext] }];
    } else if (data.mimeType.startsWith('video/')) {
      const ext = data.mimeType.split('/')[1] || 'mp4';
      filters = [{ name: 'Videos', extensions: [ext] }];
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: filters.length > 0 ? filters : undefined,
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    try {
      // Convert number array back to Buffer and write to file
      const buffer = Buffer.from(data.buffer);
      fs.writeFileSync(result.filePath, buffer);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      console.error('Failed to save file:', error);
      return { success: false, error: String(error) };
    }
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

  // Shutdown acknowledgment promise resolver
  let shutdownAcknowledgeResolve: (() => void) | null = null;

  ipcMain.handle('app:acknowledgeShutdown', () => {
    debugLog('Update', 'Received shutdown acknowledgment from renderer');
    if (shutdownAcknowledgeResolve) {
      shutdownAcknowledgeResolve();
      shutdownAcknowledgeResolve = null;
    }
  });

  ipcMain.handle('update:install', async () => {
    // Graceful shutdown before update to prevent database corruption
    isQuitting = true;
    debugLog('Update', 'Starting graceful shutdown before install', {
      translationReady,
      translationInitializing,
      hasTranslationProcess: !!translationProcess,
    });

    // 1. Stop translation worker first (frees resources)
    if (translationProcess) {
      debugLog('Update', 'Stopping translation worker...');
      try {
        translationProcess.kill('SIGTERM');
        translationProcess = null;
        translationReady = false;
      } catch (e) {
        debugLog('Update', 'Error stopping translation worker', { error: String(e) });
      }
    }

    // 2. Notify renderer to prepare for shutdown and wait for acknowledgment
    if (mainWindow && !mainWindow.isDestroyed()) {
      debugLog('Update', 'Notifying renderer to prepare for shutdown');
      mainWindow.webContents.send('app:prepareForShutdown');

      // Wait for renderer to acknowledge cleanup is complete (with 10s timeout)
      const SHUTDOWN_TIMEOUT = 10000;
      const acknowledgmentPromise = new Promise<void>((resolve) => {
        shutdownAcknowledgeResolve = resolve;
      });
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          debugLog('Update', 'Shutdown acknowledgment timeout - proceeding anyway');
          resolve();
        }, SHUTDOWN_TIMEOUT);
      });

      debugLog('Update', 'Waiting for shutdown acknowledgment (10s timeout)...');
      await Promise.race([acknowledgmentPromise, timeoutPromise]);
      shutdownAcknowledgeResolve = null;
    }

    // 3. Small additional delay to ensure any final writes complete
    debugLog('Update', 'Final 500ms delay for pending writes...');
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Now proceed with forced quit
    debugLog('Update', 'Proceeding with quit and install');

    // Remove all listeners that might prevent quit
    app.removeAllListeners('window-all-closed');
    app.removeAllListeners('before-quit');

    // Destroy the window explicitly (bypass the close handler)
    if (mainWindow && !mainWindow.isDestroyed()) {
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
    debugLog('Translation', 'Initialize started');
    try {
      translationInitializing = true;
      // Send immediate "starting" progress so UI doesn't show 0% stuck
      lastTranslationProgress = { status: 'starting', progress: 1, file: '' };
      mainWindow?.webContents.send('translation:progress', lastTranslationProgress);
      debugLog('Translation', 'Starting worker process...');
      // Start the utility process if not running
      await startTranslationProcess();
      debugLog('Translation', 'Worker started, loading models...');
      // Initialize the translation model in the worker
      const result = await sendToWorker<{ success: boolean }>('initialize');
      translationReady = true;
      translationInitializing = false;
      lastTranslationProgress = null;
      // Save enabled preference on successful initialization
      setSecureData({ translationEnabled: true });
      debugLog('Translation', 'Initialize completed successfully');
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      debugLog('Translation', 'Initialize FAILED - stopping worker', { error: errorMsg });

      // Stop the worker process completely on failure
      stopTranslationProcess();

      // Don't clear the enabled preference - let it auto-retry on next restart
      // Preference is only cleared when user explicitly deletes models or disposes

      translationInitializing = false;
      translationReady = false;
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

  ipcMain.handle('translation:detectLanguage', async (_, text: string) => {
    try {
      if (!translationProcess || !translationReady) {
        throw new Error('Translation service not initialized');
      }
      return await sendToWorker<{ language: string | null; confidence: number }>(
        'detectLanguage',
        { text }
      );
    } catch (error) {
      console.error('[Translation] Language detection failed:', error);
      return { language: null, confidence: 0 };
    }
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

// Node.js version to download (LTS)
const NODE_VERSION = 'v20.18.1';

// Find bundled Node.js in app data directory
function findBundledNode(): string | null {
  const appDataPath = app.getPath('userData');
  const platform = os.platform();

  // Windows uses node.exe, others use node
  const nodeBinary = platform === 'win32' ? 'node.exe' : 'node';
  // Windows has node.exe directly in the node folder, Unix has it in bin/
  const nodePath = platform === 'win32'
    ? path.join(appDataPath, 'node', nodeBinary)
    : path.join(appDataPath, 'node', 'bin', nodeBinary);

  if (fs.existsSync(nodePath)) {
    console.log('[Translation] Found bundled Node.js at:', nodePath);
    return nodePath;
  }
  return null;
}

// Find system Node.js as fallback (not Electron's)
function findSystemNode(): string | null {
  const platform = os.platform();

  if (platform === 'win32') {
    // Windows: Try 'where node' first
    try {
      const nodePath = execSync('where node', { encoding: 'utf8' }).trim().split('\n')[0];
      if (nodePath && !nodePath.includes('Electron')) {
        return nodePath;
      }
    } catch {
      // Ignore
    }

    // Try common Windows paths
    const windowsPaths = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      path.join(os.homedir(), 'AppData', 'Roaming', 'nvm', 'current', 'node.exe'),
    ];
    for (const p of windowsPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  } else {
    // macOS / Linux
    const possiblePaths = [
      '/opt/homebrew/bin/node',  // macOS ARM Homebrew
      '/usr/local/bin/node',     // macOS Intel Homebrew
      '/usr/bin/node',           // Linux system
      '/home/linuxbrew/.linuxbrew/bin/node', // Linux Homebrew
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
  }

  return null;
}

// Find Node.js - bundled first, then system
function findNodeJs(): string | null {
  return findBundledNode() || findSystemNode();
}

// Download and extract Node.js to app data directory
async function downloadNodeJs(onProgress?: (percent: number, status: string) => void): Promise<string> {
  const appDataPath = app.getPath('userData');
  const nodeDir = path.join(appDataPath, 'node');

  // Determine platform and architecture
  const platform = os.platform();
  const arch = os.arch();

  // Map to Node.js download naming conventions
  let nodePlatform: string;
  let nodeArch: string;
  let archiveExt: string;
  let nodeBinPath: string;

  switch (platform) {
    case 'darwin':
      nodePlatform = 'darwin';
      nodeArch = arch === 'arm64' ? 'arm64' : 'x64';
      archiveExt = 'tar.gz';
      nodeBinPath = path.join(nodeDir, 'bin', 'node');
      break;
    case 'win32':
      nodePlatform = 'win';
      nodeArch = arch === 'arm64' ? 'arm64' : 'x64';
      archiveExt = 'zip';
      nodeBinPath = path.join(nodeDir, 'node.exe');
      break;
    case 'linux':
      nodePlatform = 'linux';
      nodeArch = arch === 'arm64' ? 'arm64' : 'x64';
      archiveExt = 'tar.xz';
      nodeBinPath = path.join(nodeDir, 'bin', 'node');
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  const archiveName = `node-${NODE_VERSION}-${nodePlatform}-${nodeArch}.${archiveExt}`;
  const downloadUrl = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}`;

  console.log('[Translation] Downloading Node.js from:', downloadUrl);
  onProgress?.(0, 'Downloading Node.js runtime...');

  // Create temp directory for download
  const tempDir = path.join(appDataPath, 'temp');
  const tempFile = path.join(tempDir, archiveName);

  try {
    // Ensure directories exist
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(nodeDir, { recursive: true });

    // Download the archive
    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(tempFile);

      const request = https.get(downloadUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            https.get(redirectUrl, (redirectResponse) => {
              const totalSize = parseInt(redirectResponse.headers['content-length'] || '0', 10);
              let downloadedSize = 0;

              redirectResponse.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize > 0) {
                  const percent = Math.round((downloadedSize / totalSize) * 100);
                  onProgress?.(percent, `Downloading Node.js runtime... ${Math.round(downloadedSize / 1024 / 1024)}MB`);
                }
              });

              redirectResponse.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve();
              });
            }).on('error', reject);
          } else {
            reject(new Error('Redirect without location header'));
          }
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download Node.js: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            onProgress?.(percent, `Downloading Node.js runtime... ${Math.round(downloadedSize / 1024 / 1024)}MB`);
          }
        });

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        fs.unlink(tempFile, () => {}); // Delete incomplete file
        reject(err);
      });
    });

    console.log('[Translation] Download complete, extracting...');
    onProgress?.(100, 'Extracting Node.js...');

    // Extract to temp first, then move contents
    const extractDir = path.join(tempDir, 'node-extract');
    fs.mkdirSync(extractDir, { recursive: true });

    // Extract based on archive type
    if (platform === 'win32') {
      // Windows: Use PowerShell to extract zip
      execSync(
        `powershell -Command "Expand-Archive -Path '${tempFile}' -DestinationPath '${extractDir}' -Force"`,
        { encoding: 'utf8' }
      );
    } else if (platform === 'linux') {
      // Linux: Use tar for .tar.xz
      execSync(`tar -xJf "${tempFile}" -C "${extractDir}"`, { encoding: 'utf8' });
    } else {
      // macOS: Use tar for .tar.gz
      execSync(`tar -xzf "${tempFile}" -C "${extractDir}"`, { encoding: 'utf8' });
    }

    // Find the extracted directory (node-v20.x.x-<platform>-<arch>)
    const extractedDirs = fs.readdirSync(extractDir);
    const nodeExtractedDir = extractedDirs.find(d => d.startsWith('node-'));

    if (!nodeExtractedDir) {
      throw new Error('Failed to find extracted Node.js directory');
    }

    // Move contents to final location
    const srcDir = path.join(extractDir, nodeExtractedDir);

    // Remove existing node directory contents
    if (fs.existsSync(nodeDir)) {
      fs.rmSync(nodeDir, { recursive: true });
    }

    // Move extracted directory to final location
    fs.renameSync(srcDir, nodeDir);

    // Clean up
    fs.rmSync(tempDir, { recursive: true });

    // Make node binary executable (not needed on Windows)
    if (platform !== 'win32') {
      fs.chmodSync(nodeBinPath, 0o755);
    }

    console.log('[Translation] Node.js installed at:', nodeBinPath);
    return nodeBinPath;
  } catch (error) {
    // Clean up on error
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {}

    throw error;
  }
}

async function startTranslationProcess(): Promise<void> {
  if (translationProcess) {
    console.log('[Translation] Process already running');
    return;
  }

  // Check for Node.js (bundled first, then system)
  let nodePath = findNodeJs();

  if (!nodePath) {
    console.log('[Translation] Node.js not found, downloading...');

    // Send progress to renderer
    mainWindow?.webContents.send('translation:progress', {
      status: 'downloading',
      progress: 0,
      file: 'Downloading Node.js runtime...',
    });

    try {
      nodePath = await downloadNodeJs((percent, status) => {
        mainWindow?.webContents.send('translation:progress', {
          status: 'downloading',
          progress: Math.round(percent * 0.1), // Node.js is 10% of total progress
          file: status,
        });
      });
    } catch (error) {
      console.error('[Translation] Failed to download Node.js:', error);
      throw new Error('Failed to download Node.js runtime. Please check your internet connection.');
    }
  }

  console.log('[Translation] Starting process with Node.js:', nodePath);
  const cacheDir = path.join(app.getPath('userData'), 'translation-models');
  // In packaged app, worker is in app.asar.unpacked/dist/ (extracted from asar)
  const workerPath = app.isPackaged
    ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'translation-worker.js')
    : path.join(__dirname, 'translation-worker.js');
  console.log('[Translation] Worker path:', workerPath);
  console.log('[Translation] App is packaged:', app.isPackaged);
  console.log('[Translation] Cache dir:', cacheDir);

  return new Promise((resolve, reject) => {

    // Check if worker file exists
    const fs = require('fs');
    if (!fs.existsSync(workerPath)) {
      console.error('[Translation] Worker file not found at:', workerPath);
      reject(new Error('Translation worker file not found'));
      return;
    }

    // Add startup timeout - if worker doesn't respond in 30 seconds, fail
    const startupTimeout = setTimeout(() => {
      console.error('[Translation] Worker startup timeout - no ready message received');
      if (translationProcess && !translationReady) {
        translationProcess.kill();
        translationProcess = null;
      }
      reject(new Error('Translation worker startup timeout'));
    }, 30000);

    // Spawn using system Node.js with IPC
    // In packaged app, node_modules is unpacked to app.asar.unpacked/node_modules
    const nodeModulesPath = app.isPackaged
      ? path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', 'node_modules')
      : path.join(__dirname, '..', 'node_modules');
    console.log('[Translation] Node modules path:', nodeModulesPath);

    translationProcess = spawn(nodePath, [workerPath, cacheDir], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: nodeModulesPath,
      },
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
        clearTimeout(startupTimeout);
        resolve();
        return;
      }

      if (msg.type === 'progress') {
        const progressPayload = msg.payload as { status: string; progress: number; file?: string };
        console.log('[Translation] Progress:', progressPayload.progress + '%', progressPayload.status, progressPayload.file || '');
        lastTranslationProgress = progressPayload;
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
      clearTimeout(startupTimeout);
      console.error('[Translation] Process error:', error);
      reject(error);
    });
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
  // Platform-specific window options
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 980,
    height: 655,
    minWidth: 900,
    minHeight: 600,
    center: true, // Center window on screen like Signal
    // macOS-specific title bar styling
    ...(isMac && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    }),
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
    if (
      url.startsWith(DEV_SERVER_URL) ||
      url.startsWith(PRODUCTION_URL) ||
      url.startsWith(ALTERNATE_PRODUCTION_URL)
    ) {
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
