/**
 * Session utilities for auth state caching
 *
 * Uses the storage abstraction layer which supports both
 * localStorage (web) and encrypted storage (Electron).
 */

import { hasSessionSync, clearSessionCache } from '@/lib/storage';

/**
 * Check if there's an active QR login session (synchronous)
 *
 * Note: In Electron, this checks localStorage as a hint.
 * The actual session validation happens async in restoreSession().
 */
export function hasQRSession(): boolean {
  return hasSessionSync();
}

/**
 * Alias for hasQRSession for backwards compatibility
 */
export function wasConnected(): boolean {
  return hasQRSession();
}

/**
 * Clear all session data (logout)
 */
export function clearSession(): void {
  // Fire and forget - don't need to await
  clearSessionCache();
}
