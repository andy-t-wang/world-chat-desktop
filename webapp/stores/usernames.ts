/**
 * Username State Store
 * Jotai atoms for managing username lookups with Map-based approach
 * (avoids atomFamily multi-instance issues)
 */

import { atom } from 'jotai';
import type { UsernameRecord } from '@/types/username';
import { store } from './index';

export interface UsernameState {
  record: UsernameRecord | null;
  isLoading: boolean;
  error: Error | null;
}

const DEFAULT_USERNAME_STATE: UsernameState = {
  record: null,
  isLoading: false,
  error: null,
};

/**
 * Map of address -> username state
 * Using Map-based approach to avoid atomFamily multi-instance issues
 */
export const allUsernameStatesAtom = atom<Map<string, UsernameState>>(new Map());

/**
 * Helper to get username state for an address
 */
export function getUsernameState(
  stateMap: Map<string, UsernameState>,
  address: string
): UsernameState {
  return stateMap.get(address.toLowerCase()) ?? DEFAULT_USERNAME_STATE;
}

// Batching mechanism for username state updates
let pendingUsernameUpdates = new Map<string, UsernameState>();
let usernameUpdateScheduled = false;

function flushUsernameUpdates(): void {
  if (!usernameUpdateScheduled) return;
  usernameUpdateScheduled = false;

  if (pendingUsernameUpdates.size > 0) {
    const current = store.get(allUsernameStatesAtom);
    const newMap = new Map(current);
    for (const [address, state] of pendingUsernameUpdates) {
      newMap.set(address, state);
    }
    pendingUsernameUpdates = new Map();
    store.set(allUsernameStatesAtom, newMap);
  }
}

/**
 * Batch update username state - defers actual atom update to next microtask
 */
export function batchUpdateUsernameState(address: string, state: UsernameState): void {
  pendingUsernameUpdates.set(address.toLowerCase(), state);
  if (!usernameUpdateScheduled) {
    usernameUpdateScheduled = true;
    queueMicrotask(flushUsernameUpdates);
  }
}

/**
 * Batch loading state for conversation list optimization
 */
export const isLoadingUsernamesAtom = atom<boolean>(false);

/**
 * Addresses that have been queried (to avoid re-fetching)
 */
export const queriedAddressesAtom = atom<Set<string>>(new Set<string>());
