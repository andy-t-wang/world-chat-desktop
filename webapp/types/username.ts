/**
 * World App Username API Types
 * Generated from OpenAPI spec at username-spec.json
 */

/** Checksummed wallet address (0x-prefixed, 40 hex chars) */
export type Address = `0x${string}`;

/** World App username record */
export interface UsernameRecord {
  /** Checksummed wallet address of the user */
  address: Address;
  /** The user's World App username */
  username: string;
  /** URL to the user's profile picture */
  profile_picture_url: string | null;
  /** URL to the user's minimized profile picture (for thumbnails) */
  minimized_profile_picture_url: string | null;
}

/** Payload for querying multiple addresses/usernames */
export interface QueryMultiplePayload {
  /** List of addresses to resolve */
  addresses?: Address[];
  /** List of usernames to resolve */
  usernames?: string[];
}

/** World ID verification level */
export type VerificationLevel = 'orb' | 'device';

/** API error response */
export interface UsernameAPIError {
  error: string;
}

/** Username lookup result with loading/error states */
export interface UsernameState {
  record: UsernameRecord | null;
  isLoading: boolean;
  error: Error | null;
}
