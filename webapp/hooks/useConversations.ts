'use client';

import { useAtomValue, useSetAtom } from 'jotai';
import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import {
  conversationIdsAtom,
  isLoadingConversationsAtom,
  conversationsErrorAtom,
  conversationMetadataVersionAtom,
} from '@/stores/conversations';
import { unreadVersionAtom } from '@/stores/messages';
import { requestFirstSeenAtom } from '@/stores/settings';
import { streamManager } from '@/lib/xmtp/StreamManager';

/**
 * Member preview for group avatars
 */
export interface MemberPreview {
  inboxId: string;
  address: string;
}

/**
 * Conversation metadata returned by the hook
 */
export interface ConversationMetadata {
  id: string;
  conversationType: 'dm' | 'group';
  // For DMs
  peerAddress: string;
  peerInboxId: string;
  // For Groups
  groupName?: string;
  groupImageUrl?: string;
  memberCount?: number;
  memberPreviews?: MemberPreview[];
  // Common
  lastMessagePreview: string;
  lastActivityNs: bigint;
  unreadCount: number;
  // Consent state for message requests
  consentState: 'allowed' | 'denied' | 'unknown';
  // Disappearing messages
  disappearingMessagesEnabled: boolean;
  disappearingMessagesDurationNs?: bigint;
  // Mention tracking - true if user was @mentioned in unread messages
  hasMention?: boolean;
  // Disabled conversations can be viewed but not sent to (requires re-add/recreate)
  isDisabled?: boolean;
  disabledReason?: string;
}

/**
 * Hook to access conversations list
 *
 * This is a simple subscription hook - all data loading is handled by StreamManager.
 * Components using this hook will automatically re-render when conversations change.
 */
export function useConversations() {
  const conversationIds = useAtomValue(conversationIdsAtom);
  const isLoading = useAtomValue(isLoadingConversationsAtom);
  const error = useAtomValue(conversationsErrorAtom);
  // Subscribe to metadata version to re-render when any metadata changes
  const metadataVersion = useAtomValue(conversationMetadataVersionAtom);
  // Subscribe to unread version to re-render when unread counts change
  const unreadVersion = useAtomValue(unreadVersionAtom);

  // Cache metadata reference to avoid creating new Map on every render
  const metadataRef = useRef<Map<string, ConversationMetadata>>(new Map());

  const metadata = useMemo(() => {
    // Get fresh metadata from StreamManager
    metadataRef.current = streamManager.getAllConversationMetadata();
    return metadataRef.current;
  }, [conversationIds, metadataVersion, unreadVersion]); // Refresh when list, metadata, or unread changes

  return {
    conversationIds,
    metadata,
    isLoading,
    error,
  };
}

/**
 * Hook to get metadata for a single conversation
 * Uses conversationIds subscription to detect when to re-check metadata
 */
export function useConversationMetadata(conversationId: string | null): ConversationMetadata | null {
  // Subscribe to conversationIds to know when conversations are loaded
  const conversationIds = useAtomValue(conversationIdsAtom);
  // Subscribe to metadata version to re-render when metadata changes
  const metadataVersion = useAtomValue(conversationMetadataVersionAtom);

  // Memoize the result to prevent unnecessary re-renders
  const metadata = useMemo(() => {
    if (!conversationId) return null;
    // Check if the conversation exists in allowed list OR is a message request
    const isInAllowed = conversationIds.includes(conversationId);
    const isRequest = streamManager.isMessageRequest(conversationId);
    if (!isInAllowed && !isRequest) {
      // Also check if metadata exists directly (for edge cases)
      const directMetadata = streamManager.getConversationMetadata(conversationId);
      if (!directMetadata) return null;
    }
    return streamManager.getConversationMetadata(conversationId) ?? null;
  }, [conversationId, conversationIds, metadataVersion]);

  return metadata;
}

// Duration to show the "new" dot (5 seconds)
const NEW_DOT_DURATION_MS = 5000;

/**
 * Hook to access message requests (Unknown consent conversations)
 *
 * Returns conversation IDs and metadata for conversations where
 * the user hasn't accepted or rejected the contact yet.
 * Shows a dot for 5 seconds after a request first appears via streaming.
 */
export function useMessageRequests() {
  // Subscribe to metadata version to re-render when metadata changes
  const metadataVersion = useAtomValue(conversationMetadataVersionAtom);
  // Subscribe to unread version for consistency
  const unreadVersion = useAtomValue(unreadVersionAtom);
  // Get first-seen timestamps from storage
  const firstSeenMap = useAtomValue(requestFirstSeenAtom);
  const setFirstSeenMap = useSetAtom(requestFirstSeenAtom);

  // Track if initial load is done - only show dot for requests added after initial load
  const initialLoadDoneRef = useRef(false);
  const initialRequestIdsRef = useRef<Set<string>>(new Set());

  // Force re-render to update dot visibility as time passes
  const [, forceUpdate] = useState(0);

  // Get request conversation IDs and metadata
  const { requestIds, metadata, requestCount } = useMemo(() => {
    const ids = streamManager.getRequestConversationIds();
    const meta = streamManager.getAllConversationMetadata();
    const count = ids.length;
    return {
      requestIds: ids,
      metadata: meta,
      requestCount: count,
    };
  }, [metadataVersion, unreadVersion]);

  // On first render, mark all existing requests as "old" (timestamp = 0)
  // Only requests that appear after this will get a real timestamp
  useEffect(() => {
    if (!initialLoadDoneRef.current && requestIds.length > 0) {
      initialLoadDoneRef.current = true;
      initialRequestIdsRef.current = new Set(requestIds);

      // Mark all initial requests with timestamp 0 (won't show dot)
      const initialMarks: Record<string, number> = {};
      for (const id of requestIds) {
        if (!firstSeenMap[id]) {
          initialMarks[id] = 0; // 0 = old request, won't show dot
        }
      }
      if (Object.keys(initialMarks).length > 0) {
        setFirstSeenMap(prev => ({ ...prev, ...initialMarks }));
      }
    }
  }, [requestIds, firstSeenMap, setFirstSeenMap]);

  // Track NEW requests (ones that appear after initial load) with current timestamp
  useEffect(() => {
    if (!initialLoadDoneRef.current) return; // Wait for initial load

    const now = Date.now();
    const updates: Record<string, number> = {};
    let hasUpdates = false;

    for (const id of requestIds) {
      // Only set timestamp for truly new requests (not in initial set, not yet tracked)
      if (!initialRequestIdsRef.current.has(id) && !firstSeenMap[id]) {
        updates[id] = now;
        hasUpdates = true;
      }
    }

    if (hasUpdates) {
      setFirstSeenMap(prev => ({ ...prev, ...updates }));
    }
  }, [requestIds, firstSeenMap, setFirstSeenMap]);

  // Set up timer to hide dots after 5 seconds
  useEffect(() => {
    const now = Date.now();
    let earliestExpiry = Infinity;

    for (const id of requestIds) {
      const firstSeen = firstSeenMap[id];
      if (firstSeen && firstSeen > 0) { // Only consider real timestamps (not 0)
        const expiresAt = firstSeen + NEW_DOT_DURATION_MS;
        if (expiresAt > now && expiresAt < earliestExpiry) {
          earliestExpiry = expiresAt;
        }
      }
    }

    if (earliestExpiry !== Infinity) {
      const timeUntilExpiry = earliestExpiry - now;
      const timer = setTimeout(() => {
        forceUpdate(n => n + 1);
      }, timeUntilExpiry + 50); // Small buffer
      return () => clearTimeout(timer);
    }
  }, [requestIds, firstSeenMap]);

  // Check if a specific request should show the dot (seen less than 5 seconds ago)
  const isNewRequest = useCallback((id: string) => {
    const firstSeen = firstSeenMap[id];
    if (!firstSeen || firstSeen === 0) return false; // 0 = old request
    return Date.now() - firstSeen < NEW_DOT_DURATION_MS;
  }, [firstSeenMap]);

  // Count requests with unread messages (for persistent indicator)
  const newRequestCount = useMemo(() => {
    return requestIds.filter(id => {
      const meta = metadata.get(id);
      return meta && (meta.unreadCount ?? 0) > 0;
    }).length;
  }, [requestIds, metadata]);

  return {
    requestIds,
    metadata,
    requestCount,
    newRequestCount,
    isNewRequest,
  };
}

/**
 * Hook to check if a conversation is a message request
 */
export function useIsMessageRequest(conversationId: string | null): boolean {
  // Subscribe to metadata version to re-render when consent state changes
  const metadataVersion = useAtomValue(conversationMetadataVersionAtom);

  return useMemo(() => {
    if (!conversationId) return false;
    return streamManager.isMessageRequest(conversationId);
  }, [conversationId, metadataVersion]);
}
