/**
 * Username Hook
 * React hook for fetching and displaying World App usernames
 *
 * Simplified implementation that:
 * 1. Uses localStorage-backed cache for persistence
 * 2. Uses React state only for the local component
 * 3. Avoids global Jotai state to prevent cascading re-renders
 */

'use client';

import { useState, useEffect } from 'react';
import { resolveAddress, getCachedUsername } from '@/lib/username/service';
import type { UsernameRecord } from '@/types/username';

interface UseUsernameResult {
  /** The username record if found */
  record: UsernameRecord | null;
  /** Whether the username is currently loading */
  isLoading: boolean;
  /** Any error that occurred during fetch */
  error: Error | null;
  /** Display name (username or truncated address) */
  displayName: string;
  /** Profile picture URL if available */
  profilePicture: string | null;
}

/**
 * MODULE-LEVEL tracking to prevent duplicate fetches
 */
const inFlightAddresses = new Set<string>();
const fetchPromises = new Map<string, Promise<UsernameRecord | null>>();

/**
 * Truncate an address to a display-friendly format
 */
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Hook to get username data for a single address
 *
 * Uses a simple pattern:
 * 1. Check cache synchronously on mount
 * 2. If not cached, fetch and update local state only
 * 3. No global state = no cascading re-renders
 */
export function useUsername(address: string | null | undefined): UseUsernameResult {
  const normalizedAddress = address?.toLowerCase() ?? '';

  // Initialize state from cache (synchronous, no re-render)
  const [state, setState] = useState<{
    record: UsernameRecord | null;
    isLoading: boolean;
    error: Error | null;
  }>(() => {
    if (!address) {
      return { record: null, isLoading: false, error: null };
    }
    // Check cache synchronously
    const cached = getCachedUsername(address);
    if (cached !== undefined) {
      return { record: cached, isLoading: false, error: null };
    }
    // Not cached, will need to fetch
    return { record: null, isLoading: true, error: null };
  });

  useEffect(() => {
    if (!address || !normalizedAddress) {
      setState({ record: null, isLoading: false, error: null });
      return;
    }

    // Check if already cached
    const cached = getCachedUsername(address);
    if (cached !== undefined) {
      setState({ record: cached, isLoading: false, error: null });
      return;
    }

    // Check if another component is already fetching this address
    const existingPromise = fetchPromises.get(normalizedAddress);
    if (existingPromise) {
      // Wait for the existing fetch
      existingPromise.then((record) => {
        setState({ record, isLoading: false, error: null });
      }).catch((error) => {
        setState({
          record: null,
          isLoading: false,
          error: error instanceof Error ? error : new Error('Failed to fetch'),
        });
      });
      return;
    }

    // Prevent duplicate fetches
    if (inFlightAddresses.has(normalizedAddress)) {
      return;
    }

    // Start the fetch
    inFlightAddresses.add(normalizedAddress);
    setState((prev) => ({ ...prev, isLoading: true }));

    const fetchPromise = resolveAddress(address);
    fetchPromises.set(normalizedAddress, fetchPromise);

    fetchPromise
      .then((record) => {
        setState({ record, isLoading: false, error: null });
      })
      .catch((error) => {
        setState({
          record: null,
          isLoading: false,
          error: error instanceof Error ? error : new Error('Failed to fetch'),
        });
      })
      .finally(() => {
        inFlightAddresses.delete(normalizedAddress);
        fetchPromises.delete(normalizedAddress);
      });
  }, [address, normalizedAddress]);

  return {
    record: state.record,
    isLoading: state.isLoading,
    error: state.error,
    displayName: state.record?.username ?? (address ? truncateAddress(address) : ''),
    profilePicture: state.record?.minimized_profile_picture_url ?? state.record?.profile_picture_url ?? null,
  };
}

/**
 * Get display name from a username record or address
 */
export function getDisplayName(record: UsernameRecord | null, address: string): string {
  return record?.username ?? truncateAddress(address);
}
