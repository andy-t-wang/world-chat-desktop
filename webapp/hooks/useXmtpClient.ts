'use client';

import { useCallback } from 'react';
import { useAtom } from 'jotai';
import { IdentifierKind, type Client, type Identifier } from '@xmtp/browser-sdk';
import { clientLifecycleAtom, xmtpClientAtom, clientStateAtom } from '@/stores/client';
import { streamManager } from '@/lib/xmtp/StreamManager';
import { clearSession } from '@/lib/auth/session';

interface UseXmtpClientResult {
  client: Client | null;
  isInitializing: boolean;
  isReady: boolean;
  error: Error | null;
  disconnect: () => void;
}

/**
 * Hook to access XMTP client state
 * Client is initialized via QR login flow in useQRXmtpClient
 */
export function useXmtpClient(): UseXmtpClientResult {
  const [clientState] = useAtom(clientStateAtom);
  const client = clientState.client;
  const [, dispatch] = useAtom(clientLifecycleAtom);

  const disconnect = useCallback(() => {
    clearSession();
    streamManager.cleanup();
    dispatch({ type: 'DISCONNECT' });
  }, [dispatch]);

  return {
    client,
    isInitializing: clientState.isInitializing,
    isReady: client !== null && !clientState.isInitializing && !clientState.error,
    error: clientState.error,
    disconnect,
  };
}

/**
 * Hook to check if an address can receive XMTP messages
 */
export function useCanMessage() {
  const [client] = useAtom(xmtpClientAtom);

  const canMessage = useCallback(
    async (address: string): Promise<boolean> => {
      if (!client) return false;

      try {
        const identifier: Identifier = {
          identifier: address.toLowerCase(),
          identifierKind: IdentifierKind.Ethereum,
        };
        const result = await client.canMessage([identifier]);
        return result.get(address.toLowerCase()) ?? false;
      } catch (error) {
        console.error('Failed to check canMessage:', error);
        return false;
      }
    },
    [client]
  );

  return { canMessage };
}
