/**
 * Types for the signing relay between desktop web client and World App mini app
 */

export interface SigningSession {
  id: string;
  address: string;
  createdAt: number;
}

export type RelayMessage =
  // Mobile announces connection (unverified until auth completes)
  | { type: 'mobile_connected'; address: string }
  // Desktop sends auth challenge to verify address ownership
  | { type: 'auth_challenge'; challenge: string }
  // Mobile responds with signed challenge
  | { type: 'auth_response'; signature: string }
  // Desktop confirms auth succeeded
  | { type: 'auth_success' }
  // Auth failed
  | { type: 'auth_failed'; error: string }
  // Signing requests (only after auth)
  | { type: 'sign_request'; requestId: string; message: string; timestamp: number }
  | { type: 'sign_response'; requestId: string; signature: string }
  | { type: 'sign_error'; requestId: string; error: string }
  | { type: 'session_complete' };

export interface PendingSignRequest {
  requestId: string;
  message: string;
  timestamp: number;
  resolve: (signature: string) => void;
  reject: (error: Error) => void;
}

// Signing request timeout (5 minutes - XMTP may need multiple signatures)
export const SIGN_TIMEOUT_MS = 300000;

// Auth challenge timeout (2 minutes)
export const AUTH_TIMEOUT_MS = 120000;

// Maximum age for signing request timestamps (prevents replay)
export const MAX_REQUEST_AGE_MS = 300000;
