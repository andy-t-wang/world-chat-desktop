/**
 * Message State Store
 * Simplified approach using Maps instead of atomFamily to avoid multi-instance issues
 */

import { atom } from 'jotai';
import type { DecodedMessage } from '@xmtp/browser-sdk';
import type { PendingMessage, PaginationState } from '@/types/messages';
import { LRUCache } from '@/lib/utils/lru';
import { CACHE } from '@/config/constants';

/**
 * Message IDs per conversation
 * Map from conversationId -> array of message IDs
 */
export const allConversationMessageIdsAtom = atom<Map<string, string[]>>(new Map());

/**
 * Pagination state per conversation
 * Map from conversationId -> pagination state
 */
export const allConversationPaginationAtom = atom<Map<string, PaginationState>>(new Map());

/**
 * Pending messages per conversation
 * Map from conversationId -> pending messages
 */
export const allPendingMessagesAtom = atom<Map<string, PendingMessage[]>>(new Map());

/**
 * Read receipt timestamps per conversation
 * Map from conversationId -> timestamp (bigint ns) when peer last read our messages
 * A message is "read" if its sentAtNs <= this timestamp
 */
export const readReceiptsAtom = atom<Map<string, bigint>>(new Map());

/**
 * Version counter to trigger re-renders when read receipts change
 */
export const readReceiptVersionAtom = atom<number>(0);

/**
 * Version counter to trigger re-renders when unread counts change
 */
export const unreadVersionAtom = atom<number>(0);

/**
 * Reaction content type structure from XMTP
 */
export interface ReactionContent {
  /** The emoji reaction */
  content: string;
  /** Action: 'added' or 'removed' */
  action: 'added' | 'removed';
  /** Reference to the message being reacted to */
  reference: string;
  /** Schema for the reference */
  schema: 'custom' | 'messageid';
}

/**
 * Stored reaction with sender info
 */
export interface StoredReaction {
  emoji: string;
  senderInboxId: string;
  messageId: string; // The reaction message ID (for removal)
}

/**
 * Reactions per message
 * Map from targetMessageId -> array of reactions
 */
export const reactionsAtom = atom<Map<string, StoredReaction[]>>(new Map());

/**
 * Version counter to trigger re-renders when reactions change
 */
export const reactionsVersionAtom = atom<number>(0);

/**
 * Helper function to get message IDs for a conversation
 */
export function getMessageIds(messageIdsMap: Map<string, string[]>, conversationId: string): string[] {
  return messageIdsMap.get(conversationId) ?? [];
}

/**
 * Helper function to get pagination for a conversation
 */
export function getPagination(paginationMap: Map<string, PaginationState>, conversationId: string): PaginationState {
  return paginationMap.get(conversationId) ?? {
    hasMore: true,
    oldestMessageNs: null,
    isLoading: false,
  };
}

/**
 * Helper function to get pending messages for a conversation
 */
export function getPendingMessages(pendingMap: Map<string, PendingMessage[]>, conversationId: string): PendingMessage[] {
  return pendingMap.get(conversationId) ?? [];
}

/**
 * LRU cache for messages in memory
 */
export const messageCache = new LRUCache<string, DecodedMessage>(
  CACHE.MAX_MESSAGES_IN_MEMORY
);

/**
 * Create a pending message for optimistic updates
 */
export function createPendingMessage(
  conversationId: string,
  content: string
): PendingMessage {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    conversationId,
    content,
    status: 'sending',
    sentAtNs: BigInt(Date.now()) * 1_000_000n,
    retryCount: 0,
  };
}

// Legacy exports for compatibility (these are now no-ops or simple wrappers)
// TODO: Remove these after updating all consumers

import { atomFamily } from 'jotai/utils';

// Keep atomFamily for now but they're secondary to the Map-based approach
export const messageAtomFamily = atomFamily((messageId: string) =>
  atom<DecodedMessage | null>(null)
);

export const conversationMessageIdsAtom = atomFamily((conversationId: string) =>
  atom<string[]>([])
);

export const conversationPaginationAtom = atomFamily((conversationId: string) =>
  atom<PaginationState>({
    hasMore: true,
    oldestMessageNs: null,
    isLoading: false,
  })
);

export const pendingMessagesAtom = atomFamily((conversationId: string) =>
  atom<PendingMessage[]>([])
);

export const allMessageIdsAtom = atomFamily((conversationId: string) =>
  atom((get) => {
    const confirmedIds = get(conversationMessageIdsAtom(conversationId));
    const pending = get(pendingMessagesAtom(conversationId));
    const pendingIds = pending.map((p) => p.id);
    return [...pendingIds, ...confirmedIds];
  })
);

export const messageCountAtom = atomFamily((conversationId: string) =>
  atom((get) => {
    return get(allMessageIdsAtom(conversationId)).length;
  })
);

export const hasPendingMessagesAtom = atomFamily((conversationId: string) =>
  atom((get) => {
    const pending = get(pendingMessagesAtom(conversationId));
    return pending.length > 0;
  })
);

export const hasFailedMessagesAtom = atomFamily((conversationId: string) =>
  atom((get) => {
    const pending = get(pendingMessagesAtom(conversationId));
    return pending.some((p) => p.status === 'failed');
  })
);

export function addMessageToStore(
  message: DecodedMessage,
  conversationId: string,
  setMessageIds: (updater: (prev: string[]) => string[]) => void
): void {
  messageCache.set(message.id, message);
  setMessageIds((prev) => {
    if (prev.includes(message.id)) return prev;
    return [message.id, ...prev];
  });
}

export function resetConversationMessages(conversationId: string): void {
  // No-op for now
}
