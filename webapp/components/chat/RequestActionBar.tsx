"use client";

import { useState } from "react";
import { useSetAtom } from "jotai";
import { Loader2, Check, X } from "lucide-react";
import { streamManager } from "@/lib/xmtp/StreamManager";
import { selectedConversationIdAtom } from "@/stores/ui";
import { useUsername } from "@/hooks/useUsername";

interface RequestActionBarProps {
  conversationId: string;
  peerAddress?: string;
  senderName?: string;
}

/**
 * Compact banner for message requests - appears at top of conversation
 */
export function MessageRequestBanner({
  conversationId,
  peerAddress,
  senderName,
}: RequestActionBarProps) {
  // Get display name from address if not provided
  const { displayName } = useUsername(peerAddress);
  const name = senderName || displayName || (peerAddress ? `${peerAddress.slice(0, 6)}...${peerAddress.slice(-4)}` : "Someone");
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const setSelectedId = useSetAtom(selectedConversationIdAtom);

  const handleAccept = async () => {
    if (isAccepting || isDeleting) return;
    setIsAccepting(true);

    try {
      await streamManager.acceptConversation(conversationId);
    } catch (error) {
      console.error("Failed to accept conversation:", error);
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDelete = async () => {
    if (isAccepting || isDeleting) return;
    setIsDeleting(true);

    try {
      const success = await streamManager.rejectConversation(conversationId);
      if (success) {
        setSelectedId(null);
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const isLoading = isAccepting || isDeleting;

  return (
    <div className="sticky top-4 z-10 flex justify-center pointer-events-none">
      <div className="bg-[var(--bg-primary)] rounded-2xl shadow-lg border border-[var(--border-default)] px-4 py-3 pointer-events-auto max-w-[320px]">
        {/* Disclaimer text */}
        <p className="text-[13px] text-[var(--text-secondary)] text-center mb-3 leading-snug">
          <span className="font-medium text-[var(--text-primary)]">{name}</span> wants to message you. If you don&apos;t recognize them, you can decline or block the chat.
        </p>

        <div className="flex items-center gap-1">
          {/* Reject button */}
          <button
            onClick={handleDelete}
            disabled={isLoading}
            className="flex-1 h-10 px-4 flex items-center justify-center gap-2 rounded-xl bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-[14px] font-medium hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4 text-[var(--accent-red)]" />
            )}
            <span>Reject</span>
          </button>

          {/* Accept button */}
          <button
            onClick={handleAccept}
            disabled={isLoading}
            className="flex-1 h-10 px-4 flex items-center justify-center gap-2 rounded-xl bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-[14px] font-medium hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          >
            {isAccepting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4 text-[var(--accent-green)]" />
            )}
            <span>Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Keep old export for backwards compatibility
export function RequestActionBar(props: RequestActionBarProps) {
  return <MessageRequestBanner {...props} />;
}
