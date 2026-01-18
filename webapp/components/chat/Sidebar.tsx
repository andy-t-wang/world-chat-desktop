'use client';

import { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { Search, SquarePen, X, Settings, CheckCircle } from 'lucide-react';
import { ConversationList } from './ConversationList';
import { MessageRequestsView } from './MessageRequestsView';
import { SettingsPanel } from './SettingsPanel';
import { NotificationBanner } from './NotificationBanner';
import { DownloadAppBanner } from './DownloadAppBanner';
import { UpdateBanner } from './UpdateBanner';
import { settingsPanelOpenAtom } from '@/stores/settings';
import { showMessageRequestsAtom } from '@/stores/ui';
import { useMessageRequests } from '@/hooks/useConversations';
import { useTranslation } from '@/hooks/useTranslation';

interface SidebarProps {
  onNewChat?: () => void;
  className?: string;
  width?: number;
}

export function Sidebar({ onNewChat, className, width }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [showRequests, setShowRequests] = useAtom(showMessageRequestsAtom);
  const [showSettings, setShowSettings] = useAtom(settingsPanelOpenAtom);
  const { requestCount, newRequestCount } = useMessageRequests();

  // Translation toast
  const { isInitializing, isInitialized, progress } = useTranslation();
  const [showTranslationToast, setShowTranslationToast] = useState(false);
  const wasInitializingRef = useRef(false);

  // Show toast when translation finishes (and settings is not open)
  useEffect(() => {
    if (isInitializing) {
      wasInitializingRef.current = true;
    } else if (wasInitializingRef.current && isInitialized && !showSettings) {
      wasInitializingRef.current = false;
      setShowTranslationToast(true);
      const timer = setTimeout(() => setShowTranslationToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isInitializing, isInitialized, showSettings]);

  // Debounce search query - 250ms after user stops typing
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedQuery('');
  };

  // Show SettingsPanel when toggled
  if (showSettings) {
    return (
      <aside
        className={`h-full bg-[var(--bg-primary)] border-r border-[var(--border-default)] flex flex-col shrink-0 ${className || ''}`}
        style={{ width: width || 320 }}
      >
        {/* Electron drag region */}
        <div className="electron-drag h-8 shrink-0" />
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </aside>
    );
  }

  // Show MessageRequestsView when toggled
  if (showRequests) {
    return (
      <aside
        className={`h-full bg-[var(--bg-primary)] border-r border-[var(--border-default)] flex flex-col shrink-0 ${className || ''}`}
        style={{ width: width || 320 }}
      >
        {/* Electron drag region */}
        <div className="electron-drag h-8 shrink-0" />
        <MessageRequestsView onBack={() => setShowRequests(false)} />
      </aside>
    );
  }

  return (
    <aside
      className={`h-full bg-[var(--bg-primary)] border-r border-[var(--border-default)] flex flex-col shrink-0 ${className || ''}`}
      style={{ width: width || 320 }}
    >
      {/* Electron drag region */}
      <div className="electron-drag h-8 shrink-0" />
      {/* Header */}
      <header className="shrink-0 px-4 pb-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Chats</h1>
          <button
            onClick={onNewChat}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            aria-label="New chat"
          >
            <SquarePen className="w-5 h-5 text-[var(--text-primary)]" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="
              w-full h-10 pl-9 pr-9
              bg-[var(--bg-tertiary)] rounded-lg
              text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)]
              outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/20
              transition-shadow
            "
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Notification Permission Banner */}
      <NotificationBanner />

      {/* Download App Banner (web only) */}
      <DownloadAppBanner />

      {/* Conversation List - with bottom padding for pinned settings */}
      <div className="flex-1 overflow-hidden relative">
        <ConversationList
          searchQuery={debouncedQuery}
          bottomPadding={64}
          requestCount={requestCount}
          newRequestCount={newRequestCount}
          onRequestsClick={() => setShowRequests(true)}
        />

        {/* Floating Update Button (Electron only) */}
        <UpdateBanner />

        {/* Pinned Settings Footer */}
        <div className="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)] to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 pointer-events-auto flex justify-end">
          <button
            onClick={() => setShowSettings(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5 text-[var(--text-primary)]" />
          </button>
        </div>
      </div>

      {/* Translation Success Toast */}
      {showTranslationToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border-default)]">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="text-[14px] text-[var(--text-primary)]">Private Translations installed</span>
          </div>
        </div>
      )}
    </aside>
  );
}
