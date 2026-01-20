"use client";

import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import {
  ArrowLeft,
  Sun,
  Moon,
  Monitor,
  Link2,
  Link2Off,
  Volume2,
  VolumeX,
  UserPlus,
  UserX,
  MessageSquare,
  MessageSquareOff,
  RefreshCw,
  Share2,
  Check,
  LogOut,
  Settings,
  Languages,
  Loader2,
  History,
  Trash2,
  Download,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  linkPreviewEnabledAtom,
  soundMutedAtom,
  hideEmptyConversationsAtom,
  themePreferenceAtom,
  messageRequestNotificationsAtom,
  settingsPanelOpenAtom,
} from "@/stores/settings";
import { streamManager } from "@/lib/xmtp/StreamManager";
import { clearSession } from "@/lib/auth/session";
import {
  getSessionCache,
  clearSessionCache,
  deleteXmtpDatabase,
  deleteAllXmtpDatabases,
} from "@/lib/storage";

interface SettingsPanelProps {
  onClose: () => void;
}

// Toggle switch component for consistent styling
function Toggle({ enabled }: { enabled: boolean }) {
  return (
    <div
      role="switch"
      aria-checked={enabled}
      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
        enabled ? "bg-[var(--toggle-bg-on)]" : "bg-[var(--toggle-bg-off)]"
      }`}
    >
      <div
        className={`w-5 h-5 rounded-full bg-[var(--bg-primary)] shadow transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </div>
  );
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [linkPreviewEnabled, setLinkPreviewEnabled] = useAtom(linkPreviewEnabledAtom);
  const [soundMuted, setSoundMuted] = useAtom(soundMutedAtom);
  const [hideEmptyConversations, setHideEmptyConversations] = useAtom(hideEmptyConversationsAtom);
  const [themePreference, setThemePreference] = useAtom(themePreferenceAtom);
  const [messageRequestNotifications, setMessageRequestNotifications] = useAtom(messageRequestNotificationsAtom);

  const [version, setVersion] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isElectronEnv, setIsElectronEnv] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [translationAvailable, setTranslationAvailable] = useState(false);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);

  // Update state management
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded'>('idle');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number>(0);

  // Translation hook
  const { isAvailable, initialize, isInitializing, isInitialized, progress: translationProgress, error: translationError, deleteModels } = useTranslation();
  const [isDeletingModels, setIsDeletingModels] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Download link
  const BASE_URL = process.env.NEXT_PUBLIC_URL || "https://world-chat-web.vercel.app";
  const DOWNLOAD_URL = `${BASE_URL}/download`;

  // Fetch version and detect Electron
  useEffect(() => {
    const electronAPI = (window as { electronAPI?: { isElectron?: boolean; getVersion?: () => Promise<string> } }).electronAPI;
    if (electronAPI?.isElectron) {
      setIsElectronEnv(true);
    }
    if (electronAPI?.getVersion) {
      electronAPI.getVersion().then(setVersion).catch(() => {});
    }
    // Check translation availability
    isAvailable().then(setTranslationAvailable);
  }, [isAvailable]);

  // Listen for update events from Electron
  useEffect(() => {
    const electronAPI = (window as {
      electronAPI?: {
        onUpdateAvailable?: (callback: (info: { version: string }) => void) => void;
        onUpdateNotAvailable?: (callback: () => void) => void;
        onUpdateProgress?: (callback: (progress: { percent: number }) => void) => void;
        onUpdateDownloaded?: (callback: (info: { version: string }) => void) => void;
        onUpdateError?: (callback: (error: string) => void) => void;
      };
    }).electronAPI;

    if (!electronAPI) return;

    electronAPI.onUpdateAvailable?.((info) => {
      setUpdateState('available');
      setUpdateVersion(info.version);
    });

    electronAPI.onUpdateNotAvailable?.(() => {
      setUpdateState('idle');
    });

    electronAPI.onUpdateProgress?.((progress) => {
      setUpdateState('downloading');
      setUpdateProgress(Math.round(progress.percent));
    });

    electronAPI.onUpdateDownloaded?.((info) => {
      setUpdateState('downloaded');
      setUpdateVersion(info.version);
    });

    electronAPI.onUpdateError?.(() => {
      setUpdateState('idle');
    });
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      // Cleanup streams first
      streamManager.cleanup();

      // Clear session data
      clearSession();
      await clearSessionCache();

      // Set flag to delete database on next startup (before XMTP client is created)
      // This is necessary because WASM holds a file lock on the database
      localStorage.setItem('xmtp-pending-db-clear', 'true');
      console.log('[Logout] Set pending DB clear flag');

      // Redirect to login - database will be deleted on next startup
      window.location.href = "/";
    } catch (error) {
      console.error("Logout failed:", error);
      setIsLoggingOut(false);
    }
  };

  const handleUpdateAction = async () => {
    const electronAPI = (window as {
      electronAPI?: {
        checkForUpdates?: () => Promise<void>;
        downloadUpdate?: () => Promise<void>;
        installUpdate?: () => Promise<void>;
      };
    }).electronAPI;

    try {
      switch (updateState) {
        case 'idle':
          if (electronAPI?.checkForUpdates) {
            setUpdateState('checking');
            await electronAPI.checkForUpdates();
            // If no update available, event handler will set state back to idle
            // Give it a moment then reset if still checking
            setTimeout(() => {
              setUpdateState((prev) => prev === 'checking' ? 'idle' : prev);
            }, 5000);
          } else {
            window.location.reload();
          }
          break;

        case 'available':
          if (electronAPI?.downloadUpdate) {
            setUpdateState('downloading');
            setUpdateProgress(0);
            await electronAPI.downloadUpdate();
          }
          break;

        case 'downloaded':
          if (electronAPI?.installUpdate) {
            await electronAPI.installUpdate();
          }
          break;

        default:
          // checking or downloading - do nothing
          break;
      }
    } catch (error) {
      console.error("Update action failed:", error);
      setUpdateState('idle');
    }
  };

  const handleCopyDownloadLink = async () => {
    try {
      await navigator.clipboard.writeText(DOWNLOAD_URL);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy link:", error);
    }
  };

  const handleHistorySync = async () => {
    if (isSyncingHistory) return;
    setIsSyncingHistory(true);
    try {
      await streamManager.requestHistorySync();
    } catch (error) {
      console.error("History sync failed:", error);
    } finally {
      setIsSyncingHistory(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[var(--border-default)]">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
        </button>
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Settings</h2>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto scrollbar-auto-hide">
        {/* Appearance Section */}
        <div className="px-4 py-3">
          <h3 className="text-[12px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
            Appearance
          </h3>
          <div className="w-full flex items-center gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg">
            <button
              onClick={() => setThemePreference("light")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-[13px] font-medium transition-all ${
                themePreference === "light"
                  ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Sun className="w-4 h-4" />
              Light
            </button>
            <button
              onClick={() => setThemePreference("system")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-[13px] font-medium transition-all ${
                themePreference === "system"
                  ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Monitor className="w-4 h-4" />
              System
            </button>
            <button
              onClick={() => setThemePreference("dark")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-[13px] font-medium transition-all ${
                themePreference === "dark"
                  ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Moon className="w-4 h-4" />
              Dark
            </button>
          </div>
        </div>

        {/* Privacy Section */}
        <div className="py-3 border-t border-[var(--border-subtle)]">
          <h3 className="px-4 text-[12px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Privacy
          </h3>

          {/* Rich Previews */}
          <button
            onClick={() => setLinkPreviewEnabled(!linkPreviewEnabled)}
            className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors"
          >
            {linkPreviewEnabled ? (
              <Link2 className="w-5 h-5 text-[var(--accent-green)]" />
            ) : (
              <Link2Off className="w-5 h-5 text-[var(--text-tertiary)]" />
            )}
            <div className="flex-1 text-left">
              <p className="text-[14px] text-[var(--text-primary)]">Rich Previews</p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {linkPreviewEnabled ? "Show link & ticker previews" : "No link or ticker previews"}
              </p>
            </div>
            <Toggle enabled={linkPreviewEnabled} />
          </button>

          {/* Notification Sounds */}
          <button
            onClick={() => setSoundMuted(!soundMuted)}
            className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors"
          >
            {soundMuted ? (
              <VolumeX className="w-5 h-5 text-[var(--text-tertiary)]" />
            ) : (
              <Volume2 className="w-5 h-5 text-[var(--accent-green)]" />
            )}
            <div className="flex-1 text-left">
              <p className="text-[14px] text-[var(--text-primary)]">Notification Sounds</p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {soundMuted ? "Sounds are muted" : "Play sound on new messages"}
              </p>
            </div>
            <Toggle enabled={!soundMuted} />
          </button>

          {/* Request Notifications */}
          <button
            onClick={() => setMessageRequestNotifications(!messageRequestNotifications)}
            className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors"
          >
            {messageRequestNotifications ? (
              <UserPlus className="w-5 h-5 text-[var(--accent-green)]" />
            ) : (
              <UserX className="w-5 h-5 text-[var(--text-tertiary)]" />
            )}
            <div className="flex-1 text-left">
              <p className="text-[14px] text-[var(--text-primary)]">Request Notifications</p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {messageRequestNotifications ? "Notify for new message requests" : "No request notifications"}
              </p>
            </div>
            <Toggle enabled={messageRequestNotifications} />
          </button>
        </div>

        {/* Display Section */}
        <div className="py-3 border-t border-[var(--border-subtle)]">
          <h3 className="px-4 text-[12px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Display
          </h3>

          <button
            onClick={() => setHideEmptyConversations(!hideEmptyConversations)}
            className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors"
          >
            {hideEmptyConversations ? (
              <MessageSquareOff className="w-5 h-5 text-[var(--accent-green)]" />
            ) : (
              <MessageSquare className="w-5 h-5 text-[var(--text-tertiary)]" />
            )}
            <div className="flex-1 text-left">
              <p className="text-[14px] text-[var(--text-primary)]">Hide Empty Chats</p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {hideEmptyConversations ? "Chats with no messages hidden" : "Showing all chats"}
              </p>
            </div>
            <Toggle enabled={hideEmptyConversations} />
          </button>
        </div>

        {/* Extensions Section */}
        <div className="py-3 border-t border-[var(--border-subtle)]">
          <h3 className="px-4 text-[12px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Extensions
          </h3>

          {/* Private Translations Extension */}
          <div className="py-3 px-4">
            <div className="flex items-center gap-3">
              {translationAvailable ? (
                // Electron version - fully functional
                <>
                  {isInitializing ? (
                    <Loader2 className="w-5 h-5 text-[var(--accent-blue)] animate-spin" />
                  ) : isDeletingModels ? (
                    <Loader2 className="w-5 h-5 text-[var(--text-tertiary)] animate-spin" />
                  ) : (
                    <Languages className={`w-5 h-5 ${isInitialized ? "text-[var(--accent-green)]" : "text-[var(--text-tertiary)]"}`} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[var(--text-primary)]">Private Translations</p>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      {isInitializing
                        ? translationProgress?.timeEstimate || "Downloading..."
                        : isDeletingModels
                        ? "Removing..."
                        : isInitialized
                        ? "Local"
                        : "On-device"}
                    </p>
                    {/* Progress bar with percent */}
                    {isInitializing && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 bg-[var(--bg-tertiary)] rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-[var(--accent-blue)] transition-all duration-300 ease-out"
                            style={{ width: `${translationProgress?.progress || 0}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-[var(--text-secondary)] tabular-nums w-8 text-right">
                          {Math.round(translationProgress?.progress || 0)}%
                        </span>
                      </div>
                    )}
                    {translationError && (
                      <p className="text-[12px] text-[#FF3B30] mt-1">{translationError}</p>
                    )}
                  </div>
                  {isInitialized ? (
                    isDeletingModels ? (
                      <Loader2 className="w-4 h-4 text-[var(--text-tertiary)] animate-spin" />
                    ) : (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-[var(--text-tertiary)]" />
                      </button>
                    )
                  ) : isInitializing ? null : (
                    <button
                      onClick={() => initialize()}
                      className="text-[12px] text-[var(--accent-blue)] hover:text-blue-600 font-medium"
                    >
                      Download
                    </button>
                  )}
                </>
              ) : (
                // Web version - prompt to download Mac app
                <>
                  <Languages className="w-5 h-5 text-[var(--text-quaternary)]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[var(--text-tertiary)]">Private Translations</p>
                    <p className="text-[12px] text-[var(--text-quaternary)]">
                      Requires Mac app
                    </p>
                  </div>
                  <a
                    href={DOWNLOAD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-[var(--accent-blue)] hover:text-blue-600 font-medium"
                  >
                    Get App
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sync Section */}
        <div className="py-3 border-t border-[var(--border-subtle)]">
          <h3 className="px-4 text-[12px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Sync
          </h3>

          <button
            onClick={handleHistorySync}
            disabled={isSyncingHistory}
            className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          >
            {isSyncingHistory ? (
              <Loader2 className="w-5 h-5 text-[var(--accent-blue)] animate-spin" />
            ) : (
              <History className="w-5 h-5 text-[var(--text-tertiary)]" />
            )}
            <div className="flex-1 text-left">
              <p className="text-[14px] text-[var(--text-primary)]">
                {isSyncingHistory ? "Syncing..." : "History Sync"}
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Pull message history from other devices
              </p>
            </div>
          </button>
        </div>

        {/* Updates Section */}
        <div className="py-3 border-t border-[var(--border-subtle)]">
          <h3 className="px-4 text-[12px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
            Updates
          </h3>

          <button
            onClick={handleUpdateAction}
            disabled={updateState === 'checking' || updateState === 'downloading'}
            className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          >
            {updateState === 'checking' || updateState === 'downloading' ? (
              <Loader2 className="w-5 h-5 text-[var(--accent-blue)] animate-spin" />
            ) : updateState === 'available' ? (
              <Download className="w-5 h-5 text-[var(--accent-blue)]" />
            ) : updateState === 'downloaded' ? (
              <RotateCcw className="w-5 h-5 text-[var(--accent-green)]" />
            ) : (
              <RefreshCw className="w-5 h-5 text-[var(--accent-blue)]" />
            )}
            <div className="flex-1 text-left">
              <p className="text-[14px] text-[var(--text-primary)]">
                {updateState === 'checking'
                  ? "Checking..."
                  : updateState === 'available'
                  ? `Download Update${updateVersion ? ` (v${updateVersion})` : ""}`
                  : updateState === 'downloading'
                  ? `Downloading... ${updateProgress}%`
                  : updateState === 'downloaded'
                  ? "Restart to Update"
                  : "Check for Updates"}
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {updateState === 'downloaded'
                  ? `Version ${updateVersion} ready to install`
                  : updateState === 'available'
                  ? "New version available"
                  : updateState === 'downloading'
                  ? "Please wait..."
                  : isElectronEnv
                  ? "Download and install updates"
                  : "Refresh to get latest version"}
              </p>
              {/* Download progress bar */}
              {updateState === 'downloading' && (
                <div className="mt-2 bg-[var(--bg-tertiary)] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-blue)] transition-all duration-300 ease-out"
                    style={{ width: `${updateProgress}%` }}
                  />
                </div>
              )}
            </div>
          </button>

          <button
            onClick={handleCopyDownloadLink}
            className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[var(--bg-hover)] transition-colors"
          >
            {linkCopied ? (
              <Check className="w-5 h-5 text-[var(--accent-green)]" />
            ) : (
              <Share2 className="w-5 h-5 text-[var(--text-tertiary)]" />
            )}
            <div className="flex-1 text-left">
              <p className="text-[14px] text-[var(--text-primary)]">
                {linkCopied ? "Link Copied!" : "Share Download Link"}
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Copy the macOS app download link
              </p>
            </div>
          </button>
        </div>

        {/* Version */}
        {version && (
          <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
            <p className="text-[12px] text-[var(--text-tertiary)] text-center">
              World Chat v{version}
            </p>
          </div>
        )}
      </div>

      {/* Footer - Logout Button */}
      <div className="shrink-0 px-4 pt-3 pb-6 border-t border-[var(--border-default)]">
        <button
          onClick={() => setShowLogoutConfirm(true)}
          disabled={isLoggingOut}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors disabled:opacity-50"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[14px] font-medium">
            {isLoggingOut ? "Logging out..." : "Log Out"}
          </span>
        </button>
      </div>

      {/* Delete Translation Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="p-4">
              <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-2">
                Delete Private Translations Extension?
              </h3>
              <p className="text-[14px] text-[var(--text-secondary)]">
                This will remove the translation models from your device. You can download them again anytime.
              </p>
            </div>
            <div className="flex border-t border-[var(--border-default)]">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 text-[14px] font-medium text-[var(--accent-blue)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowDeleteConfirm(false);
                  setIsDeletingModels(true);
                  await deleteModels();
                  setIsDeletingModels(false);
                }}
                className="flex-1 py-3 text-[14px] font-medium text-red-500 hover:bg-[var(--bg-hover)] transition-colors border-l border-[var(--border-default)]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="p-4">
              <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mb-2">
                Log out?
              </h3>
              <p className="text-[14px] text-[var(--text-secondary)]">
                Are you sure you want to log out of your account?
              </p>
            </div>
            <div className="flex border-t border-[var(--border-default)]">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 text-[14px] font-medium text-[var(--accent-blue)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLogoutConfirm(false);
                  handleLogout();
                }}
                className="flex-1 py-3 text-[14px] font-medium text-red-500 hover:bg-[var(--bg-hover)] transition-colors border-l border-[var(--border-default)]"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
