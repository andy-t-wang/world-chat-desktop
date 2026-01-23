'use client';

import { useAtomValue } from 'jotai';
import { RefreshCw, WifiOff, AlertTriangle } from 'lucide-react';
import { streamHealthAtom, streamStatusAtom } from '@/stores';
import { streamManager } from '@/lib/xmtp/StreamManager';

export function ReconnectionBanner() {
  const health = useAtomValue(streamHealthAtom);
  const status = useAtomValue(streamStatusAtom);

  // Don't show banner when healthy
  if (health === 'healthy') {
    return null;
  }

  const handleRetry = () => {
    streamManager.manualReconnect();
  };

  // Different banner styles based on health status
  if (health === 'reconnecting') {
    return (
      <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
          <span className="text-sm text-blue-700 dark:text-blue-300">
            Reconnecting...
          </span>
        </div>
      </div>
    );
  }

  if (health === 'degraded') {
    return (
      <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-700 dark:text-amber-300">
              Connection unstable
              {status.fallbackSyncActive && ' - using backup sync'}
            </span>
          </div>
          <button
            onClick={handleRetry}
            className="text-sm font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (health === 'offline') {
    return (
      <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-700 dark:text-red-300">
              Connection lost
            </span>
          </div>
          <button
            onClick={handleRetry}
            className="text-sm font-medium text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}
