/**
 * XMTP Type Extensions
 * Extended types for XMTP client and conversations
 */

import type { Client, Conversation, DecodedMessage } from '@xmtp/browser-sdk';

/** XMTP environment configuration */
export type XMTPEnv = 'production' | 'dev' | 'local';

/** Options for creating an XMTP client */
export interface XMTPClientOptions {
  env?: XMTPEnv;
  appVersion?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = Client<any>;

/** Client state for tracking initialization */
export interface XMTPClientState {
  client: AnyClient | null;
  isInitializing: boolean;
  error: Error | null;
}

/** Extended conversation metadata for UI */
export interface ConversationWithMetadata {
  conversation: Conversation;
  lastMessagePreview: string | null;
  lastActivityNs: bigint;
  unreadCount: number;
  /** Primary identifier - use for all operations */
  peerInboxId: string;
  /** Display only - NOT for operations */
  peerAddress?: string;
  /** Whether conversation is active (false after history import until reactivated) */
  isActive: boolean;
}

/** Message content types supported by the app */
export type MessageContentType = 'text' | 'attachment' | 'reaction' | 'reply';

/** Extended message with UI-specific metadata */
export interface MessageWithMetadata {
  message: DecodedMessage;
  isOwn: boolean;
  status: MessageStatus;
  reactions: MessageReaction[];
  replyTo: DecodedMessage | null;
}

/** Message delivery status */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';

/** Message reaction structure */
export interface MessageReaction {
  emoji: string;
  senderInboxId: string;
  senderAddress: string;
  timestamp: bigint;
}

/** Consent state for conversations */
export type ConsentState = 'allowed' | 'denied' | 'unknown';

/** Stream subscription handle */
export interface StreamSubscription {
  unsubscribe: () => void;
}

/** Signer interface for wallet integration */
export interface WalletSigner {
  getAddress: () => Promise<string>;
  signMessage: (message: string) => Promise<string>;
}

// Re-export commonly used XMTP types
export type { Client, Conversation, DecodedMessage } from '@xmtp/browser-sdk';
