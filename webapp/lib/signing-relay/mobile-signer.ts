/**
 * Mobile signer for the World App mini app
 * Connects to the signing session and handles signing requests
 *
 * Security features:
 * - Challenge-response authentication (SEC-001)
 * - Only accepts sign requests after authentication
 * - Timestamp validation for replay protection (SEC-004)
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, getChannelName } from './client';
import type { RelayMessage } from './types';
import { MAX_REQUEST_AGE_MS } from './types';

export interface MobileSignerCallbacks {
  onConnected?: () => void;
  onAuthChallenge?: (challenge: string) => void;
  onAuthenticated?: () => void;
  onAuthFailed?: (error: string) => void;
  onSignRequest?: (message: string) => void;
  onSessionComplete?: () => void;
  onError?: (error: Error) => void;
}

export class MobileSigner {
  private channel: RealtimeChannel | null = null;
  private callbacks: MobileSignerCallbacks;
  private isAuthenticated = false;

  constructor(
    private sessionId: string,
    private walletAddress: string,
    private signMessage: (message: string) => Promise<string>,
    callbacks: MobileSignerCallbacks = {}
  ) {
    this.callbacks = callbacks;
  }

  /**
   * Connect to the signing session channel
   */
  async connect(): Promise<void> {
    const channelName = getChannelName(this.sessionId);

    this.channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
      },
    });

    // Listen for messages from web client
    this.channel.on('broadcast', { event: 'relay' }, async ({ payload }) => {
      await this.handleMessage(payload as RelayMessage);
    });

    return new Promise((resolve, reject) => {
      this.channel!.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Notify web client that we're connected (triggers auth challenge)
          this.sendMessage({
            type: 'mobile_connected',
            address: this.walletAddress,
          });
          this.callbacks.onConnected?.();
          resolve();
        } else if (status === 'CHANNEL_ERROR') {
          reject(new Error('Failed to connect to signing channel'));
        }
      });
    });
  }

  /**
   * Handle incoming messages from web client
   */
  private async handleMessage(message: RelayMessage): Promise<void> {
    switch (message.type) {
      case 'auth_challenge':
        await this.handleAuthChallenge(message.challenge);
        break;

      case 'auth_success':
        this.isAuthenticated = true;
        this.callbacks.onAuthenticated?.();
        break;

      case 'auth_failed':
        this.isAuthenticated = false;
        console.error('[MobileSigner] Authentication failed:', message.error);
        this.callbacks.onAuthFailed?.(message.error);
        break;

      case 'sign_request':
        if (!this.isAuthenticated) {
          this.sendMessage({
            type: 'sign_error',
            requestId: message.requestId,
            error: 'Not authenticated',
          });
          return;
        }
        await this.handleSignRequest(message.requestId, message.message, message.timestamp);
        break;

      case 'session_complete':
        this.callbacks.onSessionComplete?.();
        this.cleanup();
        break;
    }
  }

  /**
   * Handle authentication challenge from web client
   */
  private async handleAuthChallenge(challenge: string): Promise<void> {
    this.callbacks.onAuthChallenge?.(challenge);

    try {
      // Sign the challenge to prove we own the address
      const signature = await this.signMessage(challenge);

      // Send signed challenge back
      this.sendMessage({
        type: 'auth_response',
        signature,
      });
    } catch (error) {
      console.error('[MobileSigner] Failed to sign auth challenge:', error);
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error('Failed to sign auth challenge')
      );
    }
  }

  /**
   * Handle a signing request (only after authentication)
   */
  private async handleSignRequest(
    requestId: string,
    message: string,
    timestamp: number
  ): Promise<void> {
    // Validate timestamp to prevent replay attacks (SEC-004)
    const now = Date.now();
    if (Math.abs(now - timestamp) > MAX_REQUEST_AGE_MS) {
      this.sendMessage({
        type: 'sign_error',
        requestId,
        error: 'Request expired',
      });
      return;
    }

    this.callbacks.onSignRequest?.(message);

    try {
      const signature = await this.signMessage(message);
      this.sendMessage({
        type: 'sign_response',
        requestId,
        signature,
      });
    } catch (error) {
      this.sendMessage({
        type: 'sign_error',
        requestId,
        error: error instanceof Error ? error.message : 'Signing failed',
      });
      this.callbacks.onError?.(error instanceof Error ? error : new Error('Signing failed'));
    }
  }

  /**
   * Send a message to the web client
   */
  private sendMessage(message: RelayMessage): void {
    if (this.channel) {
      this.channel.send({
        type: 'broadcast',
        event: 'relay',
        payload: message,
      });
    }
  }

  /**
   * Check if authenticated
   */
  isConnectedAndAuthenticated(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Clean up the channel connection
   */
  cleanup(): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.isAuthenticated = false;
  }
}
