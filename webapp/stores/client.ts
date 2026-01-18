/**
 * XMTP Client State Store
 * Manages the XMTP client instance and initialization state
 */

import { atom } from 'jotai';
import type { XMTPClientState, AnyClient } from '@/types/xmtp';

/** The XMTP client instance */
export const xmtpClientAtom = atom<AnyClient | null>(null);

/** Client initialization state */
export const clientStateAtom = atom<XMTPClientState>({
  client: null,
  isInitializing: false,
  error: null,
});

/** Whether the client is ready for use */
export const isClientReadyAtom = atom((get) => {
  const state = get(clientStateAtom);
  return state.client !== null && !state.isInitializing && !state.error;
});

/** Current user's inbox ID from the client */
export const currentInboxIdAtom = atom<string | null>((get) => {
  const client = get(xmtpClientAtom);
  return client?.inboxId ?? null;
});

/** Current user's account identifier from the client */
export const currentAccountIdentifierAtom = atom((get) => {
  const client = get(xmtpClientAtom);
  return client?.accountIdentifier ?? null;
});

/** Writable atom for managing client lifecycle */
export const clientLifecycleAtom = atom(
  (get) => get(clientStateAtom),
  (get, set, action: ClientAction) => {
    switch (action.type) {
      case 'INIT_START':
        set(clientStateAtom, {
          client: null,
          isInitializing: true,
          error: null,
        });
        break;
      case 'INIT_SUCCESS':
        set(xmtpClientAtom, action.client);
        set(clientStateAtom, {
          client: action.client,
          isInitializing: false,
          error: null,
        });
        break;
      case 'INIT_ERROR':
        set(clientStateAtom, {
          client: null,
          isInitializing: false,
          error: action.error,
        });
        break;
      case 'DISCONNECT':
        set(xmtpClientAtom, null);
        set(clientStateAtom, {
          client: null,
          isInitializing: false,
          error: null,
        });
        break;
    }
  }
);

/** Actions for client state management */
type ClientAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_SUCCESS'; client: AnyClient }
  | { type: 'INIT_ERROR'; error: Error }
  | { type: 'DISCONNECT' };
