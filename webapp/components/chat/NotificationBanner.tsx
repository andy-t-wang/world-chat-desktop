'use client';

import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { requestNotificationPermission } from '@/lib/notifications';

type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function NotificationBanner() {
  const [permission, setPermission] = useState<PermissionState>('granted');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }

    // Only show on Electron desktop app
    const isElectron = !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
    if (!isElectron) {
      setPermission('unsupported'); // Hide on web
      return;
    }

    setPermission(Notification.permission as PermissionState);

    // Check if user previously dismissed this banner
    const wasDismissed = localStorage.getItem('notification-banner-dismissed');
    if (wasDismissed === 'true') {
      setDismissed(true);
    }
  }, []);

  const handleAllow = async () => {
    if (permission === 'default') {
      // Can request permission directly
      const granted = await requestNotificationPermission();
      setPermission(granted ? 'granted' : 'denied');
    } else if (permission === 'denied') {
      // Need to open system settings
      // Check if we're in Electron
      const isElectron = typeof window !== 'undefined' &&
        !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

      if (isElectron) {
        // On macOS Electron, open System Preferences > Notifications
        // Using shell.openExternal via a simple approach
        window.open('x-apple.systempreferences:com.apple.preference.notifications');
      } else {
        // On web, show instructions
        alert('Please enable notifications in your browser settings for this site.');
      }
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('notification-banner-dismissed', 'true');
  };

  // Don't show if granted, unsupported, or dismissed
  if (permission === 'granted' || permission === 'unsupported' || dismissed) {
    return null;
  }

  return (
    <div className="mx-3 mb-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-default)] shadow-sm overflow-hidden">
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div className="w-5 h-5 rounded-full bg-[var(--accent-red)] flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-white text-xs font-bold">!</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium text-[var(--text-primary)]">
              Allow Notifications
            </p>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
              Don&apos;t miss important messages from your family and friends.
            </p>
          </div>
        </div>
      </div>
      <div className="border-t border-[var(--border-subtle)]">
        <button
          onClick={handleAllow}
          className="w-full px-3 py-2.5 text-[14px] text-[var(--accent-blue)] font-medium hover:bg-[var(--bg-hover)] transition-colors text-left"
        >
          {permission === 'default' ? 'Allow Notifications' : 'Allow in System Settings'}
        </button>
      </div>
    </div>
  );
}
