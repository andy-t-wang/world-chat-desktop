'use client';

import { useState, useEffect } from 'react';
import { X, Download } from 'lucide-react';
import { isElectron } from '@/lib/storage';

const STORAGE_KEY = 'download-banner-dismissed-at';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function DownloadAppBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only show on web, not in Electron
    if (isElectron()) {
      return;
    }

    // Check if user has dismissed the banner and if it's expired
    const dismissedAt = localStorage.getItem(STORAGE_KEY);
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      const now = Date.now();
      // Show again if more than 1 week has passed
      if (now - dismissedTime > ONE_WEEK_MS) {
        localStorage.removeItem(STORAGE_KEY);
        setIsVisible(true);
      }
    } else {
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    setIsVisible(false);
  };

  const handleDownload = () => {
    const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://world-chat-web.vercel.app';
    window.open(`${BASE_URL}/download`, '_blank');
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="shrink-0 mx-3 my-2 p-3 bg-gradient-to-r from-[var(--accent-blue)]/10 to-[var(--accent-blue)]/5 rounded-xl border border-[var(--accent-blue)]/20">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent-blue)]/20 flex items-center justify-center shrink-0">
          <Download className="w-4 h-4 text-[var(--accent-blue)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">
            Get the Mac App
          </p>
          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
            More secure & faster performance
          </p>
          <button
            onClick={handleDownload}
            className="mt-2 text-[12px] font-medium text-[var(--accent-blue)] hover:underline"
          >
            Download for macOS
          </button>
        </div>
        <button
          onClick={handleDismiss}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] transition-colors shrink-0"
        >
          <X className="w-4 h-4 text-[var(--text-tertiary)]" />
        </button>
      </div>
    </div>
  );
}
