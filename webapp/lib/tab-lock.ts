/**
 * Tab Lock - Prevents multiple tabs from accessing XMTP simultaneously
 *
 * XMTP uses OPFS which has exclusive access requirements.
 * Only one tab can have an active XMTP client at a time.
 */

const TAB_LOCK_KEY = 'xmtp-tab-lock';
const HEARTBEAT_INTERVAL = 2000; // 2 seconds
const LOCK_TIMEOUT = 5000; // 5 seconds - if no heartbeat, lock is stale

interface TabLock {
  tabId: string;
  timestamp: number;
}

// Generate a unique ID for this tab
const TAB_ID = typeof window !== 'undefined'
  ? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  : '';

let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Check if another tab has an active lock
 */
export function isLockedByAnotherTab(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const lockData = localStorage.getItem(TAB_LOCK_KEY);
    if (!lockData) return false;

    const lock: TabLock = JSON.parse(lockData);

    // Check if it's our own lock
    if (lock.tabId === TAB_ID) return false;

    // Check if lock is stale (no heartbeat)
    const age = Date.now() - lock.timestamp;
    if (age > LOCK_TIMEOUT) {
      // Lock is stale, clear it
      localStorage.removeItem(TAB_LOCK_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the tab lock
 * Returns true if successful, false if another tab has it
 */
export function acquireTabLock(): boolean {
  if (typeof window === 'undefined') return true;

  // Check if another tab has an active lock
  if (isLockedByAnotherTab()) {
    return false;
  }

  try {
    // Set our lock
    const lock: TabLock = {
      tabId: TAB_ID,
      timestamp: Date.now(),
    };
    localStorage.setItem(TAB_LOCK_KEY, JSON.stringify(lock));

    // Start heartbeat
    startHeartbeat();

    return true;
  } catch {
    return false;
  }
}

/**
 * Release the tab lock
 */
export function releaseTabLock(): void {
  if (typeof window === 'undefined') return;

  stopHeartbeat();

  try {
    const lockData = localStorage.getItem(TAB_LOCK_KEY);
    if (lockData) {
      const lock: TabLock = JSON.parse(lockData);
      // Only release if it's our lock
      if (lock.tabId === TAB_ID) {
        localStorage.removeItem(TAB_LOCK_KEY);
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Start the heartbeat to keep the lock fresh
 */
function startHeartbeat(): void {
  stopHeartbeat();

  heartbeatInterval = setInterval(() => {
    try {
      const lockData = localStorage.getItem(TAB_LOCK_KEY);
      if (lockData) {
        const lock: TabLock = JSON.parse(lockData);
        if (lock.tabId === TAB_ID) {
          lock.timestamp = Date.now();
          localStorage.setItem(TAB_LOCK_KEY, JSON.stringify(lock));
        }
      }
    } catch {
      // Ignore errors
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop the heartbeat
 */
function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Release lock when tab is closed
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    releaseTabLock();
  });

  // Also release on visibility hidden (tab closed but beforeunload didn't fire)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Don't release immediately - might just be switching tabs
      // The heartbeat will stop and lock will become stale naturally
    }
  });
}
