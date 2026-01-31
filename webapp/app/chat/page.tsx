"use client";

import { useEffect, useState, memo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAtomValue, useSetAtom } from "jotai";
import { Sidebar, MessagePanel, EmptyState, GroupDetailsPanel, MemberProfilePanel, ResizableDivider } from "@/components/chat";
import { NewConversationModal } from "@/components/chat/NewConversationModal";
import { selectedConversationIdAtom } from "@/stores/ui";
import { clientStateAtom } from "@/stores/client";
import { xmtpClientAtom } from "@/stores/client";
import { useConversationMetadata, useIsMessageRequest } from "@/hooks/useConversations";
import { useQRXmtpClient } from "@/hooks/useQRXmtpClient";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useGroupMemberVerification } from "@/hooks/useGroupMemberVerification";
import { hasQRSession } from "@/lib/auth/session";
import { isElectron } from "@/lib/storage";
import { setCurrentChatName } from "@/lib/notifications";
import { streamManager } from "@/lib/xmtp/StreamManager";
import { Loader2, MessageCircle, AlertCircle, Monitor } from "lucide-react";

// Memoized MessagePanel wrapper to prevent unnecessary re-renders
const MemoizedMessagePanel = memo(MessagePanel);

export default function ChatPage() {
  const router = useRouter();
  const clientState = useAtomValue(clientStateAtom);
  const client = useAtomValue(xmtpClientAtom);
  const { restoreSession } = useQRXmtpClient();
  const selectedId = useAtomValue(selectedConversationIdAtom);
  const setSelectedId = useSetAtom(selectedConversationIdAtom);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restorationAttempted, setRestorationAttempted] = useState(false);
  const [restorationFailed, setRestorationFailed] = useState(false);
  const [isLockedByOtherTab, setIsLockedByOtherTab] = useState(false);
  const [showGroupDetails, setShowGroupDetails] = useState(false);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<{
    address: string;
    inboxId: string;
  } | null>(null);
  const restorationRef = useRef(false);

  // Sidebar width (resizable)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar-width');
      return saved ? parseInt(saved, 10) : 320;
    }
    return 320;
  });
  const MIN_SIDEBAR_WIDTH = 260;
  const MAX_SIDEBAR_WIDTH = 500;

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(prev => {
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, prev + delta));
      return newWidth;
    });
  }, []);

  const handleSidebarResizeEnd = useCallback(() => {
    localStorage.setItem('sidebar-width', sidebarWidth.toString());
  }, [sidebarWidth]);

  const hasXmtpClient = clientState.client !== null;

  // Get conversation metadata from StreamManager (no loading needed)
  const conversationMetadata = useConversationMetadata(selectedId);
  const isMessageRequest = useIsMessageRequest(selectedId);

  // Check if peer is verified (has profile picture = World ID verified) for DMs
  // - Profile picture present → verified human
  // - Username but no profile picture → unverified
  // - Resolution failed (no record) → not verified
  const peerAddress = conversationMetadata?.conversationType === 'dm' ? conversationMetadata.peerAddress : null;
  const peerInboxId = conversationMetadata?.conversationType === 'dm' ? conversationMetadata.peerInboxId : null;
  const { record: peerRecord, displayName: peerDisplayName } = useDisplayName(peerAddress);
  const isPeerVerified = Boolean(peerRecord?.profile_picture_url || peerRecord?.minimized_profile_picture_url);

  // Update browser tab title with current chat name
  useEffect(() => {
    if (!selectedId || !conversationMetadata) {
      setCurrentChatName(null);
      return;
    }

    if (conversationMetadata.conversationType === 'group') {
      setCurrentChatName(conversationMetadata.groupName || 'Group Chat');
    } else {
      // For DMs, use the peer's display name
      const chatName = peerDisplayName || (peerAddress ? `${peerAddress.slice(0, 6)}...${peerAddress.slice(-4)}` : 'Chat');
      setCurrentChatName(chatName);
    }
  }, [selectedId, conversationMetadata, peerDisplayName, peerAddress]);

  // Get group member verification stats
  const groupMemberPreviews = conversationMetadata?.conversationType === 'group' ? conversationMetadata.memberPreviews : undefined;
  const { verifiedCount, unverifiedCount } = useGroupMemberVerification(groupMemberPreviews);
  // Group is considered verified only if all members are verified
  const isGroupVerified = verifiedCount > 0 && unverifiedCount === 0;

  // Close side panels when conversation changes
  useEffect(() => {
    setShowGroupDetails(false);
    setSelectedMemberProfile(null);
  }, [selectedId]);

  // Handle member avatar click in group chat
  const handleMemberAvatarClick = useCallback((address: string, inboxId: string) => {
    setShowGroupDetails(false); // Close group details if open
    setSelectedMemberProfile({ address, inboxId });
  }, []);

  // Handle opening peer profile in DM
  const handleOpenPeerProfile = useCallback(() => {
    if (peerAddress && peerInboxId) {
      setSelectedMemberProfile({ address: peerAddress, inboxId: peerInboxId });
    }
  }, [peerAddress, peerInboxId]);

  // Handle back button (for mobile view)
  const handleBack = useCallback(() => {
    setSelectedId(null);
  }, [setSelectedId]);

  // Handle leave group
  const handleLeaveGroup = useCallback(async () => {
    if (!client || !client.inboxId || !selectedId || isLeavingGroup) return;
    if (conversationMetadata?.conversationType !== 'group') return;

    setIsLeavingGroup(true);
    setShowGroupDetails(false);

    try {
      const conversation = await client.conversations.getConversationById(selectedId);
      if (conversation && 'removeMembers' in conversation) {
        const group = conversation as { removeMembers: (ids: string[]) => Promise<void> };
        await group.removeMembers([client.inboxId]);
        streamManager.removeConversation(selectedId);
      }
    } catch (error) {
      console.error('Failed to leave group:', error);
    } finally {
      setIsLeavingGroup(false);
    }
  }, [client, selectedId, conversationMetadata?.conversationType, isLeavingGroup]);

  // Handle member added to group - sync to get XMTP's membership change message
  const handleMemberAdded = useCallback(async (_address: string, _displayName: string | null) => {
    if (!selectedId) return;

    try {
      // Sync and refresh to get XMTP's built-in membership change message
      // XMTP automatically creates these when members are added
      await streamManager.syncAndRefreshMessages(selectedId);
      await streamManager.refreshConversationMetadata(selectedId);
    } catch (error) {
      console.error('Failed to handle member added:', error);
    }
  }, [selectedId]);

  // Handle member removed from group - remove member, sync to get XMTP's membership change message
  const handleMemberRemoved = useCallback(async (inboxId: string, _address: string, _displayName: string | null) => {
    if (!client || !selectedId) return;

    try {
      // Get the conversation
      const conversation = await client.conversations.getConversationById(selectedId);
      if (!conversation || !('removeMembers' in conversation)) {
        throw new Error('Cannot remove members from this conversation');
      }

      const group = conversation as unknown as {
        removeMembers: (inboxIds: string[]) => Promise<void>;
        sync: () => Promise<void>;
      };

      // Sync the group first to ensure we have the latest state
      await group.sync();

      // Remove the member
      await group.removeMembers([inboxId]);

      // Sync and refresh to get XMTP's built-in membership change message
      // XMTP automatically creates these when members are removed
      await streamManager.syncAndRefreshMessages(selectedId);
      await streamManager.refreshConversationMetadata(selectedId);
    } catch (error) {
      console.error('Failed to remove member:', error);
      throw error;
    }
  }, [client, selectedId]);

  // Handle disappearing messages change
  const handleDisappearingMessagesChange = useCallback(async (durationNs: bigint | null) => {
    if (!client || !selectedId) return;

    try {
      const conversation = await client.conversations.getConversationById(selectedId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Type cast to access the disappearing messages methods
      const conv = conversation as unknown as {
        updateMessageDisappearingSettings: (fromNs: bigint, inNs: bigint) => Promise<void>;
        removeMessageDisappearingSettings: () => Promise<void>;
      };

      if (durationNs === null) {
        // Turn off disappearing messages
        await conv.removeMessageDisappearingSettings();
      } else {
        // Update to new duration
        // fromNs is the starting timestamp (now), inNs is the retention duration
        const nowNs = BigInt(Date.now()) * BigInt(1_000_000);
        await conv.updateMessageDisappearingSettings(nowNs, durationNs);
      }

      // Sync and refresh to get the updated settings and any system messages
      await streamManager.syncAndRefreshMessages(selectedId);
      await streamManager.refreshConversationMetadata(selectedId);
    } catch (error) {
      console.error('Failed to update disappearing messages:', error);
      throw error;
    }
  }, [client, selectedId]);

  // Try to restore session on mount if we have a cached session but no client
  const attemptRestore = useCallback(async () => {
    if (hasXmtpClient) {
      setRestorationAttempted(true);
      return;
    }

    // Check session on each attempt (might have been cleared)
    // In Electron, skip sync check since we need async IPC - let restoreSession() handle it
    if (!isElectron() && !hasQRSession()) {
      setRestorationAttempted(true);
      router.push("/");
      return;
    }

    setIsRestoring(true);
    setRestorationFailed(false);
    setIsLockedByOtherTab(false);

    try {
      const success = await restoreSession();

      if (!success) {
        // No valid session - redirect to login
        router.push("/");
      }
    } catch (error) {
      console.error("[ChatPage] Session restoration error:", error);

      // Check if it's a tab lock error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage === "TAB_LOCKED") {
        setIsLockedByOtherTab(true);
      } else if (!isElectron() && !hasQRSession()) {
        router.push("/");
      } else {
        setRestorationFailed(true);
      }
    } finally {
      setIsRestoring(false);
      setRestorationAttempted(true);
    }
  }, [hasXmtpClient, restoreSession, router]);

  // Initial restoration attempt
  useEffect(() => {
    if (restorationRef.current) return;
    restorationRef.current = true;
    attemptRestore();
  }, [attemptRestore]);

  // Show skeleton UI while restoring or initializing (feels faster than spinner)
  if (isRestoring || clientState.isInitializing || !restorationAttempted) {
    return (
      <div className="flex w-full h-screen overflow-hidden">
        {/* Skeleton Sidebar - full width on mobile, no border */}
        <div className="w-full md:w-[320px] lg:w-[380px] md:border-r md:border-[var(--border-default)] bg-[var(--bg-primary)] flex flex-col flex-shrink-0">
          {/* Electron drag region */}
          <div className="electron-drag h-8 shrink-0" />
          {/* Header skeleton */}
          <div className="px-4 py-3 border-b border-[var(--border-default)]">
            <div className="h-8 w-32 bg-[var(--bg-hover)] rounded-lg animate-pulse" />
          </div>
          {/* Search skeleton */}
          <div className="px-3 py-2">
            <div className="h-9 bg-[var(--bg-hover)] rounded-lg animate-pulse" />
          </div>
          {/* Conversation list skeleton */}
          <div className="flex-1 px-2 py-1 space-y-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-xl">
                <div className="w-[52px] h-[52px] rounded-full bg-[var(--bg-hover)] animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-4 w-24 bg-[var(--bg-hover)] rounded animate-pulse" />
                  <div className="h-3 w-40 bg-[var(--bg-hover)] rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Skeleton Message Panel - hidden on mobile */}
        <div className="hidden md:flex flex-1 flex-col bg-[var(--bg-tertiary)]">
          {/* Header skeleton */}
          <div className="h-16 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-hover)] animate-pulse" />
            <div className="h-5 w-32 bg-[var(--bg-hover)] rounded animate-pulse" />
          </div>
          {/* Messages area skeleton */}
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-[var(--text-quaternary)] animate-spin" />
              <span className="text-[13px] text-[var(--text-quaternary)]">Loading messages...</span>
            </div>
          </div>
          {/* Input skeleton */}
          <div className="h-16 border-t border-[var(--border-default)] bg-[var(--bg-primary)] px-4 flex items-center">
            <div className="flex-1 h-10 bg-[var(--bg-hover)] rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // Show UI when another tab has the XMTP lock
  if (isLockedByOtherTab) {
    return (
      <div className="flex w-full h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent-blue)]/10 flex items-center justify-center">
            <Monitor className="w-8 h-8 text-[var(--accent-blue)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Chat Open in Another Tab
          </h2>
          <p className="text-[var(--text-secondary)]">
            World Chat is already open in another browser tab. Please close the
            other tab or use it instead.
          </p>
          <button
            onClick={() => {
              restorationRef.current = false;
              setIsLockedByOtherTab(false);
              attemptRestore();
            }}
            className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue-hover)] transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Show retry UI if restoration failed but session still exists
  if (restorationFailed || clientState.error) {
    return (
      <div className="flex w-full h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Connection Failed
          </h2>
          <p className="text-[var(--text-secondary)]">
            {clientState.error?.message ||
              "Failed to restore session. Please try again."}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                restorationRef.current = false;
                setRestorationFailed(false);
                attemptRestore();
              }}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue-hover)] transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            >
              Login Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not connected and no error - should redirect (handled by attemptRestore)
  if (!hasXmtpClient) {
    return (
      <div className="flex w-full h-full items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--accent-blue)] animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full h-full">
        {/* Left Sidebar - hidden on mobile when conversation selected */}
        <Sidebar
          onNewChat={() => setIsNewChatOpen(true)}
          className={selectedId ? "hidden md:flex" : "flex"}
          width={sidebarWidth}
        />

        {/* Resizable Divider */}
        <ResizableDivider
          onResize={handleSidebarResize}
          onResizeEnd={handleSidebarResizeEnd}
        />

        {/* Message Panel - full width on mobile */}
        {selectedId && conversationMetadata ? (
          conversationMetadata.conversationType === "group" ? (
            <MemoizedMessagePanel
              key={selectedId}
              conversationId={selectedId}
              conversationType="group"
              groupName={conversationMetadata.groupName}
              memberCount={conversationMetadata.memberCount}
              memberPreviews={conversationMetadata.memberPreviews}
              avatarUrl={conversationMetadata.groupImageUrl}
              isMessageRequest={isMessageRequest}
              isVerified={isGroupVerified}
              verifiedCount={verifiedCount}
              unverifiedCount={unverifiedCount}
              hasDisappearingMessages={conversationMetadata.disappearingMessagesEnabled}
              onOpenGroupDetails={() => setShowGroupDetails(prev => !prev)}
              onMemberAvatarClick={handleMemberAvatarClick}
              onBack={handleBack}
            />
          ) : (
            <MemoizedMessagePanel
              key={selectedId}
              conversationId={selectedId}
              conversationType="dm"
              peerAddress={conversationMetadata.peerAddress}
              peerInboxId={conversationMetadata.peerInboxId}
              isVerified={isPeerVerified}
              isMessageRequest={isMessageRequest}
              hasDisappearingMessages={conversationMetadata.disappearingMessagesEnabled}
              onOpenPeerProfile={handleOpenPeerProfile}
              onBack={handleBack}
            />
          )
        ) : (
          <EmptyState className="hidden md:flex" />
        )}

        {/* Group Details Panel - inline on large screens, overlay on small */}
        {selectedId && conversationMetadata?.conversationType === "group" && (
          <>
            {/* Backdrop for small screens - animated opacity */}
            <div
              className={`lg:hidden fixed inset-0 bg-black/20 z-40 transition-opacity duration-300 ease-out ${
                showGroupDetails ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              onClick={() => setShowGroupDetails(false)}
            />
            {/* Panel wrapper - animated slide from right on mobile, instant on desktop */}
            <div
              className={`
                fixed lg:relative right-0 top-0 bottom-0 z-50 lg:z-auto
                transition-transform duration-300 ease-out lg:transition-none
                ${showGroupDetails
                  ? "translate-x-0 w-[320px]"
                  : "translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden"
                }
              `}
            >
              <GroupDetailsPanel
                onClose={() => setShowGroupDetails(false)}
                groupName={conversationMetadata.groupName || "Group Chat"}
                memberPreviews={conversationMetadata.memberPreviews}
                verifiedCount={verifiedCount}
                unverifiedCount={unverifiedCount}
                avatarUrl={conversationMetadata.groupImageUrl}
                conversationId={selectedId}
                onLeaveGroup={handleLeaveGroup}
                isLeavingGroup={isLeavingGroup}
                ownInboxId={client?.inboxId}
                onMemberAdded={handleMemberAdded}
                onMemberRemoved={handleMemberRemoved}
                onMemberClick={handleMemberAvatarClick}
                disappearingMessagesEnabled={conversationMetadata.disappearingMessagesEnabled}
                disappearingMessagesDurationNs={conversationMetadata.disappearingMessagesDurationNs}
                onDisappearingMessagesChange={handleDisappearingMessagesChange}
              />
            </div>
          </>
        )}

        {/* Member Profile Panel - inline on large screens, overlay on small */}
        {selectedMemberProfile && (
          <>
            {/* Backdrop for small screens - fade in */}
            <div
              className="lg:hidden fixed inset-0 bg-black/20 z-40 animate-fade-in"
              onClick={() => setSelectedMemberProfile(null)}
            />
            {/* Panel wrapper - slide in from right */}
            <div className="fixed lg:relative right-0 top-0 bottom-0 z-50 lg:z-auto w-[320px] animate-slide-in-right">
              <MemberProfilePanel
                address={selectedMemberProfile.address}
                inboxId={selectedMemberProfile.inboxId}
                onClose={() => setSelectedMemberProfile(null)}
                // Pass disappearing messages props only for DM conversations viewing the peer
                {...(conversationMetadata?.conversationType === 'dm' &&
                     conversationMetadata.peerInboxId === selectedMemberProfile.inboxId && selectedId ? {
                  conversationId: selectedId,
                  disappearingMessagesEnabled: conversationMetadata.disappearingMessagesEnabled,
                  disappearingMessagesDurationNs: conversationMetadata.disappearingMessagesDurationNs,
                  onDisappearingMessagesChange: handleDisappearingMessagesChange,
                } : {})}
              />
            </div>
          </>
        )}
      </div>

      {/* New Conversation Modal */}
      <NewConversationModal
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
      />
    </>
  );
}
