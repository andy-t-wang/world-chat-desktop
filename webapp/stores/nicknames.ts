import { atomWithStorage } from 'jotai/utils';

/**
 * Custom nicknames store
 * Maps lowercase wallet addresses to user-defined nicknames
 * Stored in localStorage for persistence
 */
export const customNicknamesAtom = atomWithStorage<Record<string, string>>(
  'custom-nicknames',
  {}
);
