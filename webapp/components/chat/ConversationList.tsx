'use client';

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import { ConversationItem, type ConversationItemProps } from './ConversationItem';
import { ChatRequestsBanner } from './ChatRequestsBanner';
import { selectedConversationIdAtom } from '@/stores/ui';
import { xmtpClientAtom } from '@/stores/client';
import { isSyncingConversationsAtom } from '@/stores/conversations';
import { hideEmptyConversationsAtom, pinnedConversationIdsAtom, mutedConversationIdsAtom } from '@/stores/settings';
import { customNicknamesAtom } from '@/stores/nicknames';
import { VIRTUALIZATION } from '@/config/constants';
import { useConversations } from '@/hooks/useConversations';
import { Loader2, SearchX, Pin, PinOff, Bell, BellOff, MessageCirclePlus, MessageSquare, Users } from 'lucide-react';
import { getCachedUsername, searchUsernames } from '@/lib/username/service';
import { streamManager } from '@/lib/xmtp/StreamManager';
import { Avatar } from '@/components/ui/Avatar';
import { IdentifierKind, type Identifier } from '@xmtp/browser-sdk';
import type { UsernameRecord } from '@/types/username';

interface ConversationListProps {
  requestCount?: number;
  newRequestCount?: number;
  onRequestsClick?: () => void;
  searchQuery?: string;
  bottomPadding?: number;
}

export function ConversationList({
  requestCount = 0,
  newRequestCount = 0,
  onRequestsClick,
  searchQuery = '',
  bottomPadding = 0,
}: ConversationListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selectedId = useAtomValue(selectedConversationIdAtom);
  const setSelectedId = useSetAtom(selectedConversationIdAtom);
  const client = useAtomValue(xmtpClientAtom);
  const hideEmptyConversations = useAtomValue(hideEmptyConversationsAtom);
  const isSyncing = useAtomValue(isSyncingConversationsAtom);
  const customNicknames = useAtomValue(customNicknamesAtom);
  const [pinnedIds, setPinnedIds] = useAtom(pinnedConversationIdsAtom);
  const [mutedIds, setMutedIds] = useAtom(mutedConversationIdsAtom);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    conversationId: string;
  } | null>(null);

  // Username search state for "Start new conversation" section
  const [usernameSearchResults, setUsernameSearchResults] = useState<UsernameRecord[]>([]);
  const [isSearchingUsernames, setIsSearchingUsernames] = useState(false);
  const [creatingConversationWith, setCreatingConversationWith] = useState<string | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Use conversations hook - it handles all loading and provides metadata
  const { conversationIds, metadata, isLoading } = useConversations();

  // Memoize pinned and muted sets for O(1) lookups
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const mutedSet = useMemo(() => new Set(mutedIds), [mutedIds]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Pin/unpin handlers
  const togglePin = useCallback((conversationId: string) => {
    setPinnedIds(prev => {
      if (prev.includes(conversationId)) {
        return prev.filter(id => id !== conversationId);
      }
      return [...prev, conversationId];
    });
    setContextMenu(null);
  }, [setPinnedIds]);

  // Mute/unmute handlers
  const toggleMute = useCallback((conversationId: string) => {
    setMutedIds(prev => {
      if (prev.includes(conversationId)) {
        return prev.filter(id => id !== conversationId);
      }
      return [...prev, conversationId];
    });
    setContextMenu(null);
  }, [setMutedIds]);

  const handleContextMenu = useCallback((e: React.MouseEvent, conversationId: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      conversationId,
    });
  }, []);

  // Track username cache for search
  const [usernameCacheVersion, setUsernameCacheVersion] = useState(0);

  // Refresh username cache periodically when searching
  useEffect(() => {
    if (!searchQuery) return;
    // Trigger a re-render to pick up newly cached usernames
    const interval = setInterval(() => {
      setUsernameCacheVersion(v => v + 1);
    }, 500);
    return () => clearInterval(interval);
  }, [searchQuery]);

  // Search usernames API when query changes (debounced)
  useEffect(() => {
    // Clear previous timeout
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    // Clear results if query is empty or too short
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setUsernameSearchResults([]);
      setIsSearchingUsernames(false);
      return;
    }

    // Debounce the search
    setIsSearchingUsernames(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchUsernames(searchQuery.trim());
        setUsernameSearchResults(results);
      } catch (error) {
        console.error('Failed to search usernames:', error);
        setUsernameSearchResults([]);
      } finally {
        setIsSearchingUsernames(false);
      }
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery]);

  // Get addresses that already have conversations
  const existingPeerAddresses = useMemo(() => {
    const addresses = new Set<string>();
    for (const [, data] of metadata) {
      if (data.peerAddress) {
        addresses.add(data.peerAddress.toLowerCase());
      }
    }
    return addresses;
  }, [metadata]);

  // Filter username search results to exclude existing conversations
  const newConversationResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return usernameSearchResults.filter(
      result => !existingPeerAddresses.has(result.address.toLowerCase())
    );
  }, [usernameSearchResults, existingPeerAddresses, searchQuery]);

  // Handle starting a new conversation from search results
  const handleStartConversation = useCallback(async (result: UsernameRecord) => {
    if (!client || creatingConversationWith) return;

    setCreatingConversationWith(result.address);

    try {
      const identifier: Identifier = {
        identifier: result.address.toLowerCase(),
        identifierKind: IdentifierKind.Ethereum,
      };

      // Create or find existing DM
      const conversation = await client.conversations.createDmWithIdentifier(identifier);

      // Register with StreamManager
      await streamManager.registerNewConversation(conversation);

      // Select the conversation
      setSelectedId(conversation.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    } finally {
      setCreatingConversationWith(null);
    }
  }, [client, creatingConversationWith, setSelectedId]);

  // Filter conversations based on search query, consent state, and empty state
  // Main list only shows Allowed conversations (Unknown go to requests)
  // Pinned conversations are sorted to the top
  const filteredIds = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _version = usernameCacheVersion; // Dependency to trigger re-filter

    // First filter out Unknown consent (message requests) and optionally empty conversations
    let allowedIds = conversationIds.filter((id) => {
      const data = metadata.get(id);
      // Only show allowed conversations in main list
      if (!data || data.consentState === 'unknown') return false;

      // Filter out empty conversations if setting is enabled
      if (hideEmptyConversations) {
        const isEmpty = !data.lastMessagePreview && data.lastActivityNs === BigInt(0);
        if (isEmpty && !data.isDisabled) return false;
      }

      return true;
    });

    // Apply search filter if present
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();

      // Get addresses from username search results (for group member matching)
      const searchedAddresses = new Set(
        usernameSearchResults.map(r => r.address.toLowerCase())
      );

      allowedIds = allowedIds.filter((id) => {
        const data = metadata.get(id);
        if (!data) return false;

        // For groups, search by group name OR by member addresses matching searched usernames
        if (data.conversationType === 'group') {
          const groupName = data.groupName?.toLowerCase() ?? '';
          if (groupName.includes(query)) return true;

          // Also show groups that contain any of the searched users
          if (searchedAddresses.size > 0 && data.memberPreviews) {
            for (const member of data.memberPreviews) {
              if (searchedAddresses.has(member.address.toLowerCase())) {
                return true;
              }
            }
          }
          return false;
        }

        // For DMs, search by nickname, username (from cache), or address
        if (data.peerAddress) {
          const address = data.peerAddress.toLowerCase();
          // Check if address matches
          if (address.includes(query)) return true;

          // Check if custom nickname matches
          const nickname = customNicknames[address];
          if (nickname?.toLowerCase().includes(query)) return true;

          // Check if cached username matches
          const cached = getCachedUsername(data.peerAddress);
          if (cached?.username?.toLowerCase().includes(query)) return true;
        }

        return false;
      });
    }

    // Sort: pinned first (in pin order), then others by last activity
    const pinned = allowedIds.filter(id => pinnedIds.includes(id));
    const unpinned = allowedIds.filter(id => !pinnedIds.includes(id));

    // Sort pinned by their order in pinnedIds
    pinned.sort((a, b) => pinnedIds.indexOf(a) - pinnedIds.indexOf(b));

    return [...pinned, ...unpinned];
  }, [conversationIds, metadata, searchQuery, usernameCacheVersion, hideEmptyConversations, pinnedIds, customNicknames, usernameSearchResults]);

  // Split filtered results into DMs and Groups for sectioned search view
  const { filteredDmIds, filteredGroupIds } = useMemo(() => {
    if (!searchQuery.trim()) {
      return { filteredDmIds: [], filteredGroupIds: [] };
    }
    const dms: string[] = [];
    const groups: string[] = [];
    for (const id of filteredIds) {
      const data = metadata.get(id);
      if (data?.conversationType === 'group') {
        groups.push(id);
      } else {
        dms.push(id);
      }
    }
    return { filteredDmIds: dms, filteredGroupIds: groups };
  }, [filteredIds, metadata, searchQuery]);

  // Format timestamp for display - relative for today, then Yesterday, then date
  const formatTimestamp = (ns: bigint): string => {
    if (ns === BigInt(0)) return '';
    const date = new Date(Number(ns / BigInt(1_000_000)));
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    // Under 1 day: show relative time (e.g., "5m", "2h")
    if (diffMins < 60) {
      return diffMins < 1 ? 'now' : `${diffMins}m`;
    }
    if (diffHours < 24 && date.toDateString() === now.toDateString()) {
      return `${diffHours}h`;
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }

    // Older: show date
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Build conversation props from data
  const getConversationProps = (id: string): ConversationItemProps | null => {
    const data = metadata.get(id);
    if (!data) return null;

    // Base props common to all conversation types
    const baseProps = {
      id: data.id,
      conversationType: data.conversationType,
      lastMessage: data.lastMessagePreview ?? undefined,
      timestamp: formatTimestamp(data.lastActivityNs),
      unreadCount: data.unreadCount ?? 0,
      hasDisappearingMessages: data.disappearingMessagesEnabled ?? false,
      hasMention: data.hasMention ?? false,
      isPinned: pinnedSet.has(id),
      isMuted: mutedSet.has(id),
      isDisabled: data.isDisabled ?? false,
      disabledReason: data.disabledReason,
    };

    // Add type-specific props
    if (data.conversationType === 'group') {
      return {
        ...baseProps,
        groupName: data.groupName,
        memberCount: data.memberCount,
        memberPreviews: data.memberPreviews,
        avatarUrl: data.groupImageUrl,
      };
    }

    // DM props - isVerified is derived from useUsername in ConversationItem
    return {
      ...baseProps,
      peerAddress: data.peerAddress,
    };
  };

  const virtualizer = useVirtualizer({
    count: filteredIds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => VIRTUALIZATION.CONVERSATION_ITEM_HEIGHT,
    overscan: VIRTUALIZATION.OVERSCAN_COUNT,
  });

  // Show loading state
  if (isLoading && conversationIds.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="w-6 h-6 text-[var(--accent-blue)] animate-spin" />
        <p className="text-sm text-[var(--text-secondary)] mt-2">Loading conversations...</p>
      </div>
    );
  }

  // Show empty state (no conversations at all) - but still show requests banner if there are requests
  if (!isLoading && conversationIds.length === 0 && requestCount === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6 text-center">
        <p className="text-[var(--text-secondary)]">No conversations yet</p>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">Start a new conversation to begin chatting</p>
      </div>
    );
  }

  // Show only requests banner when no allowed conversations but there are requests
  if (!isLoading && conversationIds.length === 0 && requestCount > 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 border-b border-[var(--border-subtle)] pl-2 pr-1">
          <ChatRequestsBanner count={requestCount} newCount={newRequestCount} onClick={onRequestsClick} />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-[var(--text-secondary)]">No conversations yet</p>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">Accept a chat request or start a new conversation</p>
        </div>
      </div>
    );
  }

  // Show no search results state - but still show username search results if available
  if (searchQuery && filteredIds.length === 0 && newConversationResults.length === 0 && !isSearchingUsernames) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6 text-center">
        <SearchX className="w-10 h-10 text-[var(--text-tertiary)] mb-3" />
        <p className="text-[var(--text-secondary)]">No results found</p>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">Try a different search term</p>
      </div>
    );
  }

  // Show sectioned search results (DMs, Groups, New conversations)
  if (searchQuery && (filteredIds.length > 0 || newConversationResults.length > 0 || isSearchingUsernames)) {
    return (
      <div className="relative flex flex-col h-full">
        <div className="flex-1 overflow-auto scrollbar-auto-hide pl-2 pr-1">
          {/* DMs Section */}
          {filteredDmIds.length > 0 && (
            <>
              <div className="px-2 py-2">
                <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-[12px] font-medium uppercase tracking-wide">Direct Messages</span>
                </div>
              </div>
              {filteredDmIds.map((id) => {
                const props = getConversationProps(id);
                if (!props) return null;
                return (
                  <div key={id} onContextMenu={(e) => handleContextMenu(e, id)}>
                    <ConversationItem
                      {...props}
                      isSelected={selectedId === id}
                      onClick={() => setSelectedId(id)}
                    />
                  </div>
                );
              })}
            </>
          )}

          {/* Groups Section */}
          {filteredGroupIds.length > 0 && (
            <>
              <div className={`px-2 py-2 ${filteredDmIds.length > 0 ? 'mt-2 border-t border-[var(--border-subtle)]' : ''}`}>
                <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
                  <Users className="w-4 h-4" />
                  <span className="text-[12px] font-medium uppercase tracking-wide">Groups</span>
                </div>
              </div>
              {filteredGroupIds.map((id) => {
                const props = getConversationProps(id);
                if (!props) return null;
                return (
                  <div key={id} onContextMenu={(e) => handleContextMenu(e, id)}>
                    <ConversationItem
                      {...props}
                      isSelected={selectedId === id}
                      onClick={() => setSelectedId(id)}
                    />
                  </div>
                );
              })}
            </>
          )}

          {/* New Conversations Section */}
          {(newConversationResults.length > 0 || isSearchingUsernames) && (
            <>
              <div className={`px-2 py-2 ${filteredIds.length > 0 ? 'mt-2 border-t border-[var(--border-subtle)]' : ''}`}>
                <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
                  <MessageCirclePlus className="w-4 h-4" />
                  <span className="text-[12px] font-medium uppercase tracking-wide">Start new conversation</span>
                  {isSearchingUsernames && <Loader2 className="w-3 h-3 animate-spin" />}
                </div>
              </div>
              {newConversationResults.map((result) => (
                <button
                  key={result.address}
                  onClick={() => handleStartConversation(result)}
                  disabled={creatingConversationWith === result.address}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
                >
                  <Avatar address={result.address} size="sm" />
                  <p className="flex-1 text-left font-medium text-[var(--text-primary)] truncate">
                    {result.username || `${result.address.slice(0, 6)}...${result.address.slice(-4)}`}
                  </p>
                  {creatingConversationWith === result.address && (
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-blue)]" />
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* Syncing Indicator - floats on top of conversation list */}
      {isSyncing && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-full shadow-sm">
            <Loader2 className="w-3 h-3 text-[var(--text-secondary)] animate-spin" />
            <span className="text-xs text-[var(--text-secondary)] font-medium">Syncing</span>
          </div>
        </div>
      )}

      {/* Chat Requests Banner */}
      {requestCount > 0 && (
        <div className="shrink-0 border-b border-[var(--border-subtle)] pl-2 pr-1">
          <ChatRequestsBanner count={requestCount} newCount={newRequestCount} onClick={onRequestsClick} />
        </div>
      )}

      {/* Virtualized Conversation List */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto scrollbar-auto-hide pl-2 pr-1"
      >
        <div
          style={{
            height: virtualizer.getTotalSize() + bottomPadding,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const id = filteredIds[virtualRow.index];
            const props = getConversationProps(id);

            // Skip rendering if data not loaded yet
            if (!props) {
              return (
                <div
                  key={id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex items-center px-4"
                >
                  <div className="w-10 h-10 rounded-full bg-[var(--bg-hover)] animate-pulse" />
                  <div className="ml-3 flex-1">
                    <div className="h-4 w-24 bg-[var(--bg-hover)] rounded animate-pulse" />
                    <div className="h-3 w-32 bg-[var(--bg-hover)] rounded animate-pulse mt-1" />
                  </div>
                </div>
              );
            }

            return (
              <div
                key={id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onContextMenu={(e) => handleContextMenu(e, id)}
              >
                <ConversationItem
                  {...props}
                  isSelected={selectedId === id}
                  onClick={() => setSelectedId(id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border-subtle)] py-1 min-w-[160px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => togglePin(contextMenu.conversationId)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[15px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {pinnedSet.has(contextMenu.conversationId) ? (
              <>
                <PinOff className="w-5 h-5 text-[var(--text-quaternary)]" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="w-5 h-5 text-[var(--text-quaternary)]" />
                Pin
              </>
            )}
          </button>
          <button
            onClick={() => toggleMute(contextMenu.conversationId)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[15px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {mutedSet.has(contextMenu.conversationId) ? (
              <>
                <Bell className="w-5 h-5 text-[var(--text-quaternary)]" />
                Unmute
              </>
            ) : (
              <>
                <BellOff className="w-5 h-5 text-[var(--text-quaternary)]" />
                Mute
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
