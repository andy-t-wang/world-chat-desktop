/**
 * Message-related Types
 * Types for messages, pending messages, and message operations
 */

import type { DecodedMessage, Reaction, EnrichedReply } from '@xmtp/browser-sdk';
import { ReactionAction } from '@xmtp/browser-sdk';

/**
 * Content type categories for filtering and display
 */
export type ContentTypeCategory =
  | 'text'
  | 'reaction'
  | 'reply'
  | 'readReceipt'
  | 'attachment'
  | 'remoteAttachment'
  | 'groupUpdated'
  | 'transactionReference'
  | 'unknown';

/**
 * Simplified reaction for UI display
 * Extracted from DecodedMessage<Reaction>.reactions
 */
export interface DisplayReaction {
  emoji: string;
  senderInboxId: string;
  messageId: string; // The reaction message ID (for removal)
}

/**
 * Reply context for UI display
 * Extracted from EnrichedReply.inReplyTo
 */
export interface ReplyContext {
  messageId: string;
  content: string;
  senderInboxId: string;
}

/**
 * Message with all context needed for UI display
 * This unifies DecodedMessage with UI-specific state
 *
 * SDK v6.1.0 provides:
 * - message.reactions: DecodedMessage<Reaction>[] (inline reactions)
 * - message.numReplies: bigint (reply count)
 * - For replies: message.content.inReplyTo (original message)
 */
export interface EnrichedMessage {
  // Core message data (from DecodedMessage)
  id: string;
  conversationId: string;
  content: unknown;
  contentType: ContentTypeCategory;
  senderInboxId: string;
  sentAtNs: bigint;

  // Reactions (extracted from message.reactions)
  reactions: DisplayReaction[];

  // Reply context (for reply messages, from EnrichedReply.inReplyTo)
  replyTo?: ReplyContext;

  // Reply count (from message.numReplies)
  numReplies: number;

  // Read status
  isRead: boolean;

  // Delivery status
  deliveryStatus: 'unpublished' | 'published' | 'failed';

  // UI state for pending messages
  isPending: boolean;
  isFailed: boolean;

  // Disappearing message support
  expiresAtNs?: bigint;
}

/**
 * Helper to extract DisplayReactions from SDK's DecodedMessage<Reaction>[]
 */
export function extractReactions(reactionMessages: DecodedMessage<Reaction>[]): DisplayReaction[] {
  const reactions: DisplayReaction[] = [];

  for (const msg of reactionMessages) {
    const reaction = msg.content;
    if (reaction && reaction.action === ReactionAction.Added) {
      reactions.push({
        emoji: reaction.content,
        senderInboxId: msg.senderInboxId,
        messageId: msg.id,
      });
    }
  }

  return reactions;
}

/**
 * Helper to extract ReplyContext from EnrichedReply
 */
export function extractReplyContext(content: EnrichedReply): ReplyContext | undefined {
  if (!content.inReplyTo) return undefined;

  const original = content.inReplyTo;
  let textContent = '';

  // Extract text content from the original message
  if (typeof original.content === 'string') {
    textContent = original.content;
  } else if (original.content && typeof original.content === 'object') {
    // Handle reply or other nested content
    const c = original.content as { content?: unknown };
    if (typeof c.content === 'string') {
      textContent = c.content;
    }
  }

  return {
    messageId: content.referenceId,
    content: textContent,
    senderInboxId: original.senderInboxId,
  };
}

/**
 * Helper to determine content type category from DecodedMessage
 */
export function getContentTypeCategory(message: DecodedMessage): ContentTypeCategory {
  const typeId = message.contentType?.typeId?.toLowerCase() ?? '';

  if (typeId.includes('text')) return 'text';
  if (typeId.includes('reaction')) return 'reaction';
  if (typeId.includes('reply')) return 'reply';
  if (typeId.includes('readreceipt') || typeId.includes('read-receipt')) return 'readReceipt';
  if (typeId.includes('remoteattachment') || typeId.includes('remote-attachment')) return 'remoteAttachment';
  if (typeId.includes('attachment')) return 'attachment';
  if (typeId.includes('groupupdated') || typeId.includes('group-updated')) return 'groupUpdated';
  if (typeId.includes('transactionreference') || typeId.includes('transaction-reference')) return 'transactionReference';

  return 'unknown';
}

/** Pending message for optimistic updates */
export interface PendingMessage {
  id: string;
  conversationId: string;
  content: string;
  status: 'sending' | 'failed';
  sentAtNs: bigint;
  retryCount: number;
}

/** Message pagination state */
export interface PaginationState {
  hasMore: boolean;
  oldestMessageNs: bigint | null;
  isLoading: boolean;
  /** Whether the conversation is syncing (catching up on epochs) */
  isSyncing?: boolean;
  /** Error message if sync fails completely */
  error?: string;
}

/** Cached message for LRU storage */
export interface CachedMessage {
  id: string;
  conversationId: string;
  senderInboxId: string;
  senderAddress: string;
  content: unknown;
  contentType: string;
  sentAtNs: bigint;
  insertedAtNs: bigint;
}

/** Message list item - can be either a real or pending message */
export type MessageListItem =
  | { type: 'message'; data: DecodedMessage }
  | { type: 'pending'; data: PendingMessage };

/** Options for loading messages */
export interface LoadMessagesOptions {
  limit?: number;
  beforeNs?: bigint;
  afterNs?: bigint;
  direction?: 'ascending' | 'descending';
}

/** Result of a message send operation */
export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: Error;
}

/** Message grouping for UI (by date/sender) */
export interface MessageGroup {
  id: string;
  senderId: string;
  messageIds: string[];
  startTime: bigint;
}

/** Message search filters */
export interface MessageSearchFilters {
  query?: string;
  conversationId?: string;
  startDate?: Date;
  endDate?: Date;
  senderAddress?: string;
}

/** Typing indicator state */
export interface TypingIndicator {
  conversationId: string;
  senderAddress: string;
  timestamp: number;
}
