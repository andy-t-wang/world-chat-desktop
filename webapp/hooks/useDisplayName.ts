'use client';

import { useAtomValue } from 'jotai';
import { useUsername } from './useUsername';
import { customNicknamesAtom } from '@/stores/nicknames';
import type { UsernameRecord } from '@/types/username';

interface UseDisplayNameResult {
  /** The name to display (custom nickname > world username > truncated address) */
  displayName: string;
  /** Custom nickname if set by user */
  customNickname: string | undefined;
  /** World username (without custom nickname override) */
  worldName: string;
  /** Profile picture URL if available */
  profilePicture: string | null;
  /** The full username record from World API */
  record: UsernameRecord | null;
  /** Whether user has set a custom nickname for this address */
  hasCustomNickname: boolean;
  /** Whether the username is currently loading */
  isLoading: boolean;
}

/**
 * Hook to get the display name for an address
 *
 * Priority: Custom nickname > World username > Truncated address
 *
 * Use this hook when displaying names in the UI to respect user's custom nicknames.
 */
export function useDisplayName(address: string | null | undefined): UseDisplayNameResult {
  const { displayName: worldName, profilePicture, record, isLoading } = useUsername(address);
  const customNicknames = useAtomValue(customNicknamesAtom);

  const normalizedAddress = address?.toLowerCase();
  const customNickname = normalizedAddress
    ? customNicknames[normalizedAddress]
    : undefined;

  return {
    displayName: customNickname || worldName,
    customNickname,
    worldName,
    profilePicture,
    record,
    hasCustomNickname: Boolean(customNickname),
    isLoading,
  };
}
