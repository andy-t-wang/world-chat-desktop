/**
 * Conversation State Store
 * Manages conversations with granular subscriptions using atomFamily
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Conversation } from '@xmtp/browser-sdk';
import type { ConversationWithMetadata, ConsentState } from '@/types/xmtp';

/**
 * Individual conversation atoms - granular updates
 * Each conversation has its own atom for O(1) updates
 */
export const conversationAtomFamily = atomFamily((conversationId: string) =>
  atom<Conversation | null>(null)
);

/**
 * Conversation metadata (last message preview, unread count, etc.)
 */
export const conversationMetadataAtom = atomFamily((conversationId: string) =>
  atom<ConversationMetadata>({
    lastMessagePreview: null,
    lastActivityNs: 0n,
    unreadCount: 0,
    peerAddress: '',
    peerInboxId: '',
    isActive: true,
  })
);

interface ConversationMetadata {
  lastMessagePreview: string | null;
  lastActivityNs: bigint;
  unreadCount: number;
  /** Display only - NOT for operations */
  peerAddress: string;
  /** Primary identifier - use for all operations */
  peerInboxId: string;
  /** Whether conversation is active (false after history import until reactivated) */
  isActive: boolean;
}

/**
 * List of all conversation IDs
 * Only stores IDs, not full conversation objects
 */
export const conversationIdsAtom = atom<string[]>([]);

/**
 * Whether conversations are currently loading
 */
export const isLoadingConversationsAtom = atom<boolean>(false);

/**
 * Whether initial network sync is in progress
 * This is separate from isLoading - we show local cache immediately,
 * then sync with network in background
 */
export const isSyncingConversationsAtom = atom<boolean>(false);

/**
 * Version counter for conversation metadata - increments when any metadata changes
 * Used to trigger re-renders in components that depend on metadata
 */
export const conversationMetadataVersionAtom = atom<number>(0);

/**
 * Error state for conversations
 */
export const conversationsErrorAtom = atom<Error | null>(null);

/**
 * Derived: sorted conversation IDs by last activity
 * Most recent conversations appear first
 */
export const sortedConversationIdsAtom = atom((get) => {
  const ids = get(conversationIdsAtom);
  return [...ids].sort((a, b) => {
    const metaA = get(conversationMetadataAtom(a));
    const metaB = get(conversationMetadataAtom(b));
    // Sort descending by last activity
    return Number(metaB.lastActivityNs - metaA.lastActivityNs);
  });
});

/**
 * Derived: conversations with unread messages
 */
export const unreadConversationIdsAtom = atom((get) => {
  const ids = get(conversationIdsAtom);
  return ids.filter((id) => {
    const meta = get(conversationMetadataAtom(id));
    return meta.unreadCount > 0;
  });
});

/**
 * Derived: total unread count across all conversations
 */
export const totalUnreadCountAtom = atom((get) => {
  const ids = get(conversationIdsAtom);
  return ids.reduce((total, id) => {
    const meta = get(conversationMetadataAtom(id));
    return total + meta.unreadCount;
  }, 0);
});

/**
 * Consent state per conversation
 */
export const conversationConsentAtom = atomFamily((conversationId: string) =>
  atom<ConsentState>('unknown')
);

/**
 * Conversations grouped by consent state
 */
export const conversationsByConsentAtom = atom((get) => {
  const ids = get(conversationIdsAtom);
  const allowed: string[] = [];
  const denied: string[] = [];
  const unknown: string[] = [];

  for (const id of ids) {
    const consent = get(conversationConsentAtom(id));
    switch (consent) {
      case 'allowed':
        allowed.push(id);
        break;
      case 'denied':
        denied.push(id);
        break;
      default:
        unknown.push(id);
    }
  }

  return { allowed, denied, unknown };
});

/**
 * Search/filter state for conversations
 */
export const conversationSearchQueryAtom = atom<string>('');

/**
 * Filtered conversation IDs based on search query
 */
export const filteredConversationIdsAtom = atom((get) => {
  const sortedIds = get(sortedConversationIdsAtom);
  const query = get(conversationSearchQueryAtom).toLowerCase().trim();

  if (!query) return sortedIds;

  return sortedIds.filter((id) => {
    const meta = get(conversationMetadataAtom(id));
    // Search by peer address or last message preview
    return (
      meta.peerAddress.toLowerCase().includes(query) ||
      (meta.lastMessagePreview?.toLowerCase().includes(query) ?? false)
    );
  });
});

/**
 * Pagination state for conversations list
 */
export const conversationsPaginationAtom = atom({
  hasMore: true,
  isLoading: false,
  cursor: null as string | null,
});

/**
 * Get a conversation with its metadata
 */
export const conversationWithMetadataAtom = atomFamily((conversationId: string) =>
  atom((get): ConversationWithMetadata | null => {
    const conversation = get(conversationAtomFamily(conversationId));
    if (!conversation) return null;

    const meta = get(conversationMetadataAtom(conversationId));
    return {
      conversation,
      lastMessagePreview: meta.lastMessagePreview,
      lastActivityNs: meta.lastActivityNs,
      unreadCount: meta.unreadCount,
      peerInboxId: meta.peerInboxId,
      peerAddress: meta.peerAddress,
      isActive: meta.isActive,
    };
  })
);
