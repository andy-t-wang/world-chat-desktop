/**
 * Supabase client for the signing relay
 * Uses Supabase Realtime for WebSocket communication between web and mobile
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialized client to avoid errors during Next.js prerendering
let _supabase: SupabaseClient | null = null;

/**
 * Get the Supabase client (lazy-initialized)
 * This avoids errors during Next.js static generation
 */
export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase credentials not configured. QR login will not work.\n' +
      'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
    );
  }

  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return _supabase;
}

// For backwards compatibility - getter that lazy-initializes
// Only use this in runtime code, not during build
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getSupabase()[prop as keyof SupabaseClient];
  },
});

/**
 * Generate a unique session ID for the signing relay
 */
export function generateSessionId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Get the channel name for a session
 */
export function getChannelName(sessionId: string): string {
  return `signing-session-${sessionId}`;
}
