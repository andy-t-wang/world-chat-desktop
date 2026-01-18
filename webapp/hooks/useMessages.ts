'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import {
  allConversationMessageIdsAtom,
  allConversationPaginationAtom,
  allPendingMessagesAtom,
  messageCache,
} from '@/stores/messages';
import { streamManager } from '@/lib/xmtp/StreamManager';
import type { DecodedMessage } from '@xmtp/browser-sdk';
import type { PendingMessage, PaginationState } from '@/types/messages';

const DEFAULT_PAGINATION: PaginationState = {
  hasMore: true,
  oldestMessageNs: null,
  isLoading: false,
};

// Stable empty arrays to prevent new references
const EMPTY_MESSAGE_IDS: string[] = [];
const EMPTY_PENDING_MESSAGES: PendingMessage[] = [];

/**
 * MODULE-LEVEL guard to prevent duplicate loads across component instances
 * Similar to the pattern used in useUsername
 */
const loadingConversations = new Set<string>();
const loadedConversations = new Set<string>();

/**
 * Hook to access and manage messages for a conversation
 *
 * This hook:
 * - Subscribes to Map-based atoms (avoids atomFamily multi-instance issues)
 * - Triggers StreamManager to load/stream messages on mount
 * - Provides send/retry actions that delegate to StreamManager
 */
export function useMessages(conversationId: string | null) {
  // Subscribe to the full Maps - React will only re-render when Maps change
  const messageIdsMap = useAtomValue(allConversationMessageIdsAtom);
  const paginationMap = useAtomValue(allConversationPaginationAtom);
  const [pendingMessagesMap, setPendingMessagesMap] = useAtom(allPendingMessagesAtom);

  // Derive values for this specific conversation - use stable empty arrays
  const messageIds = useMemo(
    () => (conversationId ? messageIdsMap.get(conversationId) ?? EMPTY_MESSAGE_IDS : EMPTY_MESSAGE_IDS),
    [messageIdsMap, conversationId]
  );

  const pagination = useMemo(
    () => (conversationId ? paginationMap.get(conversationId) ?? DEFAULT_PAGINATION : DEFAULT_PAGINATION),
    [paginationMap, conversationId]
  );

  const pendingMessages = useMemo(
    () => (conversationId ? pendingMessagesMap.get(conversationId) ?? EMPTY_PENDING_MESSAGES : EMPTY_PENDING_MESSAGES),
    [pendingMessagesMap, conversationId]
  );

  // Helper to update pending messages for this conversation
  const setPendingMessages = useCallback(
    (updater: (prev: PendingMessage[]) => PendingMessage[]) => {
      if (!conversationId) return;
      setPendingMessagesMap((prevMap) => {
        const newMap = new Map(prevMap);
        const current = prevMap.get(conversationId) ?? [];
        newMap.set(conversationId, updater(current));
        return newMap;
      });
    },
    [conversationId, setPendingMessagesMap]
  );

  // Track initial loading state - derived from module-level guards
  const [isInitialLoading, setIsInitialLoading] = useState(() => {
    // If already loaded or loading, don't show loading state
    if (!conversationId) return false;
    return !loadedConversations.has(conversationId) && !loadingConversations.has(conversationId);
  });

  // Load messages when conversation opens
  useEffect(() => {
    if (!conversationId) {
      setIsInitialLoading(false);
      return;
    }

    // If we think it's loaded but there are no messages, force a reload
    // This handles cases where state got out of sync
    const hasMessages = messageIds.length > 0;
    const markedAsLoaded = loadedConversations.has(conversationId);

    if (markedAsLoaded && hasMessages) {
      setIsInitialLoading(false);
      return;
    }

    // If marked as loaded but no messages, clear the flag to allow reload
    if (markedAsLoaded && !hasMessages) {
      loadedConversations.delete(conversationId);
    }

    if (loadingConversations.has(conversationId)) {
      // Another instance is already loading, just wait
      return;
    }

    // Mark as loading
    loadingConversations.add(conversationId);
    setIsInitialLoading(true);

    // Tell StreamManager to load messages for this conversation
    streamManager.loadMessagesForConversation(conversationId).finally(() => {
      loadingConversations.delete(conversationId);
      loadedConversations.add(conversationId);
      setIsInitialLoading(false);
    });
  }, [conversationId, messageIds.length]);

  // Load more (older) messages
  const loadMore = useCallback(async () => {
    if (!conversationId || pagination.isLoading || !pagination.hasMore) return;
    await streamManager.loadMoreMessages(conversationId);
  }, [conversationId, pagination.isLoading, pagination.hasMore]);

  // Send a message (optionally as a reply)
  const sendMessage = useCallback(
    async (content: string, replyToMessageId?: string): Promise<boolean> => {
      if (!conversationId || !content.trim()) return false;

      // Create pending message for optimistic UI
      const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const pending: PendingMessage = {
        id: pendingId,
        conversationId,
        content: content.trim(),
        status: 'sending',
        sentAtNs: BigInt(Date.now()) * 1_000_000n,
        retryCount: 0,
      };

      setPendingMessages((prev) => [pending, ...prev]);

      try {
        // Send as reply or regular message
        if (replyToMessageId) {
          await streamManager.sendReply(conversationId, replyToMessageId, content);
        } else {
          await streamManager.sendMessage(conversationId, content);
        }
        // Remove pending on success (stream will add the real message)
        setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
        return true;
      } catch (error) {
        console.error('Failed to send message:', error);
        // Mark as failed
        setPendingMessages((prev) =>
          prev.map((p) =>
            p.id === pendingId ? { ...p, status: 'failed' as const } : p
          )
        );
        return false;
      }
    },
    [conversationId, setPendingMessages]
  );

  // Retry a failed message
  const retryMessage = useCallback(
    async (pendingId: string): Promise<boolean> => {
      const pending = pendingMessages.find((p) => p.id === pendingId);
      if (!pending || pending.status !== 'failed' || !conversationId) return false;

      // Mark as sending
      setPendingMessages((prev) =>
        prev.map((p) =>
          p.id === pendingId
            ? { ...p, status: 'sending' as const, retryCount: p.retryCount + 1 }
            : p
        )
      );

      try {
        await streamManager.sendMessage(conversationId, pending.content);
        setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
        return true;
      } catch (error) {
        console.error('Failed to retry message:', error);
        setPendingMessages((prev) =>
          prev.map((p) =>
            p.id === pendingId ? { ...p, status: 'failed' as const } : p
          )
        );
        return false;
      }
    },
    [conversationId, pendingMessages, setPendingMessages]
  );

  // Get a message from cache
  const getMessage = useCallback((messageId: string): DecodedMessage | null => {
    return messageCache.get(messageId) ?? null;
  }, []);

  // Retry loading a conversation
  const retryConversation = useCallback(async () => {
    if (!conversationId) return;
    loadingConversations.delete(conversationId);
    loadedConversations.delete(conversationId);
    setIsInitialLoading(true);
    await streamManager.retryConversation(conversationId);
    setIsInitialLoading(false);
  }, [conversationId]);

  return {
    messageIds,
    pendingMessages,
    isLoading: pagination.isLoading,
    isInitialLoading,
    hasMore: pagination.hasMore,
    /** Whether the conversation is syncing (catching up on epochs) */
    isSyncing: pagination.isSyncing ?? false,
    /** Error message if sync fails */
    error: pagination.error,
    loadMore,
    sendMessage,
    retryMessage,
    getMessage,
    /** Retry loading the conversation */
    retryConversation,
  };
}

/**
 * Hook to get a single message by ID
 */
export function useMessage(messageId: string | null) {
  const message = messageId ? messageCache.get(messageId) : null;
  return message;
}
