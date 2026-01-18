"use client";

import { useState, useCallback } from "react";
import { X, MessageCircle, Loader2, Pencil, Timer, Check, ChevronRight, ArrowLeft } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { Avatar } from "@/components/ui/Avatar";
import { VerificationBadge } from "@/components/ui/VerificationBadge";
import { useDisplayName } from "@/hooks/useDisplayName";
import { customNicknamesAtom } from "@/stores/nicknames";
import { IdentifierKind } from "@xmtp/browser-sdk";
import { xmtpClientAtom } from "@/stores/client";
import { selectedConversationIdAtom } from "@/stores/ui";
import { streamManager } from "@/lib/xmtp/StreamManager";

// Disappearing messages duration options
const DISAPPEARING_DURATIONS = [
  { label: "Off", value: null },
  { label: "4 weeks", value: BigInt(4 * 7 * 24 * 60 * 60) * BigInt(1_000_000_000) },
  { label: "1 week", value: BigInt(7 * 24 * 60 * 60) * BigInt(1_000_000_000) },
  { label: "1 day", value: BigInt(24 * 60 * 60) * BigInt(1_000_000_000) },
  { label: "8 hours", value: BigInt(8 * 60 * 60) * BigInt(1_000_000_000) },
  { label: "1 hour", value: BigInt(60 * 60) * BigInt(1_000_000_000) },
  { label: "5 minutes", value: BigInt(5 * 60) * BigInt(1_000_000_000) },
  { label: "30 seconds", value: BigInt(30) * BigInt(1_000_000_000) },
];

// Format duration for display
function formatDuration(durationNs: bigint | undefined): string {
  if (!durationNs || durationNs === BigInt(0)) return "Off";

  const seconds = Number(durationNs / BigInt(1_000_000_000));

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

interface MemberProfilePanelProps {
  address: string;
  inboxId: string;
  onClose: () => void;
  // Disappearing messages (only shown for DM context)
  conversationId?: string;
  disappearingMessagesEnabled?: boolean;
  disappearingMessagesDurationNs?: bigint;
  onDisappearingMessagesChange?: (durationNs: bigint | null) => Promise<void>;
}

export function MemberProfilePanel({
  address,
  inboxId,
  onClose,
  conversationId,
  disappearingMessagesEnabled,
  disappearingMessagesDurationNs,
  onDisappearingMessagesChange,
}: MemberProfilePanelProps) {
  const client = useAtomValue(xmtpClientAtom);
  const setSelectedConversationId = useSetAtom(selectedConversationIdAtom);
  const { displayName, worldName, profilePicture, customNickname, hasCustomNickname } = useDisplayName(address);
  const setCustomNicknames = useSetAtom(customNicknamesAtom);
  const [isStartingDm, setIsStartingDm] = useState(false);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState(customNickname || "");
  const [view, setView] = useState<"profile" | "disappearing">("profile");
  const [isUpdatingDisappearing, setIsUpdatingDisappearing] = useState(false);

  // Show disappearing messages option only for DM context (when conversationId is provided)
  const showDisappearingOption = Boolean(conversationId && onDisappearingMessagesChange);

  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const name = displayName || shortAddress;
  const isVerified = Boolean(profilePicture);

  // Save nickname
  const handleSaveNickname = useCallback(() => {
    const trimmed = nicknameInput.trim();
    const normalizedAddress = address.toLowerCase();

    if (trimmed) {
      setCustomNicknames((prev) => ({
        ...prev,
        [normalizedAddress]: trimmed,
      }));
    } else {
      // Remove nickname if empty
      setCustomNicknames((prev) => {
        const next = { ...prev };
        delete next[normalizedAddress];
        return next;
      });
    }
    setIsEditingNickname(false);
  }, [address, nicknameInput, setCustomNicknames]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setNicknameInput(customNickname || "");
    setIsEditingNickname(false);
  }, [customNickname]);

  // Start editing
  const handleStartEdit = useCallback(() => {
    setNicknameInput(customNickname || "");
    setIsEditingNickname(true);
  }, [customNickname]);

  // Check if this is the current user
  const isOwnProfile = client?.inboxId === inboxId;

  // Handle starting/going to DM
  const handleMessageUser = useCallback(async () => {
    if (!client || isOwnProfile) return;

    setIsStartingDm(true);

    try {
      // Check if we already have a DM with this person
      const allMetadata = streamManager.getAllConversationMetadata();
      let existingDmId: string | null = null;

      for (const [id, metadata] of allMetadata) {
        if (
          metadata.conversationType === "dm" &&
          metadata.peerInboxId === inboxId
        ) {
          existingDmId = id;
          break;
        }
      }

      if (existingDmId) {
        // Go to existing DM
        setSelectedConversationId(existingDmId);
        onClose();
      } else {
        // Create new DM
        const conversation = await client.conversations.createDmWithIdentifier({
          identifier: address.toLowerCase(),
          identifierKind: IdentifierKind.Ethereum,
        });

        if (conversation) {
          // Register the new conversation so it appears in the list
          await streamManager.registerNewConversation(conversation);
          setSelectedConversationId(conversation.id);
          onClose();
        }
      }
    } catch (error) {
      console.error("Failed to start DM:", error);
    } finally {
      setIsStartingDm(false);
    }
  }, [
    client,
    inboxId,
    address,
    isOwnProfile,
    setSelectedConversationId,
    onClose,
  ]);

  // Handle disappearing messages change
  const handleDisappearingChange = useCallback(async (durationNs: bigint | null) => {
    if (!onDisappearingMessagesChange || isUpdatingDisappearing) return;

    setIsUpdatingDisappearing(true);
    try {
      await onDisappearingMessagesChange(durationNs);
      setView("profile");
    } catch (error) {
      console.error("Failed to update disappearing messages:", error);
    } finally {
      setIsUpdatingDisappearing(false);
    }
  }, [onDisappearingMessagesChange, isUpdatingDisappearing]);

  // Check if a duration option is selected
  const isSelected = (value: bigint | null) => {
    if (value === null) {
      return !disappearingMessagesDurationNs || disappearingMessagesDurationNs === BigInt(0);
    }
    return disappearingMessagesDurationNs === value;
  };

  // Disappearing messages view
  if (view === "disappearing") {
    return (
      <div className="w-[320px] shrink-0 h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] flex flex-col">
        {/* Header */}
        <div className="shrink-0 h-16 px-4 flex items-center gap-3 border-b border-[var(--border-subtle)]">
          <button
            onClick={() => setView("profile")}
            disabled={isUpdatingDisappearing}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--text-primary)]" />
          </button>
          <span className="text-[17px] font-semibold text-[var(--text-primary)]">Disappearing messages</span>
          {isUpdatingDisappearing && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-quaternary)]" />}
        </div>

        {/* Description */}
        <div className="px-4 py-4 border-b border-[var(--border-subtle)]">
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">
            When enabled, new messages sent and received in this conversation will disappear after a duration.
          </p>
        </div>

        {/* Options */}
        <div className="flex-1 overflow-y-auto scrollbar-auto-hide">
          {DISAPPEARING_DURATIONS.map((option) => (
            <button
              key={option.label}
              onClick={() => handleDisappearingChange(option.value)}
              disabled={isUpdatingDisappearing}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
            >
              <span className="text-[15px] text-[var(--text-primary)]">{option.label}</span>
              {isSelected(option.value) && (
                <Check className="w-5 h-5 text-[var(--text-primary)]" />
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[320px] shrink-0 h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] flex flex-col">
      {/* Header */}
      <div className="shrink-0 h-16 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
        <span className="text-[17px] font-semibold text-[var(--text-primary)]">
          Profile
        </span>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X className="w-5 h-5 text-[var(--text-quaternary)]" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Profile Section */}
        <div className="flex flex-col items-center pt-8 pb-6 px-4">
          {/* Large avatar */}
          <Avatar address={address} size="xl" />

          {/* Name & Nickname editing */}
          {isEditingNickname ? (
            <div className="flex flex-col items-center gap-2 mt-4 w-full max-w-[200px]">
              <input
                type="text"
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                placeholder="Enter nickname"
                autoFocus
                className="w-full px-3 py-2 text-center text-[17px] bg-[var(--bg-tertiary)] rounded-lg border-none outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveNickname();
                  if (e.key === "Escape") handleCancelEdit();
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveNickname}
                  className="px-3 py-1.5 text-[13px] font-medium text-[var(--text-inverse)] bg-[var(--text-primary)] rounded-lg hover:opacity-90 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Display name with edit button */}
              <div className="flex items-center gap-1.5 mt-4">
                <h2 className="text-[22px] font-semibold text-[var(--text-primary)] text-center">
                  {name}
                </h2>
                <button
                  onClick={handleStartEdit}
                  className="p-1 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                  title="Edit nickname"
                >
                  <Pencil className="w-4 h-4 text-[var(--text-quaternary)]" />
                </button>
              </div>

              {/* World username - show below if we have a custom nickname */}
              {hasCustomNickname && worldName && (
                <span className="text-[15px] text-[var(--text-quaternary)] mt-0.5">
                  @{worldName.toLowerCase().replace(/\s+/g, "")}
                </span>
              )}

              {/* Username - show if no custom nickname but has a world username */}
              {!hasCustomNickname && worldName && worldName !== shortAddress && (
                <span className="text-[15px] text-[var(--text-quaternary)] mt-0.5">
                  @{worldName.toLowerCase().replace(/\s+/g, "")}
                </span>
              )}

              {/* Verification badge - show below name */}
              {isVerified && (
                <div className="flex items-center gap-1.5 mt-2">
                  <VerificationBadge size="sm" />
                  <span className="text-[14px] text-[var(--text-secondary)]">Verified human</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Message Button */}
        {!isOwnProfile && (
          <div className="px-4 pb-4">
            <button
              onClick={handleMessageUser}
              disabled={isStartingDm}
              className="w-full h-10 flex items-center justify-center gap-2 rounded-full bg-[var(--text-primary)] text-[14px] font-medium text-[var(--text-inverse)] hover:opacity-90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isStartingDm ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <MessageCircle className="w-4 h-4" />
                  Message
                </>
              )}
            </button>
          </div>
        )}

        {/* Disappearing Messages Option (only in DM context) */}
        {showDisappearingOption && (
          <div className="border-t border-[var(--border-subtle)]">
            <button
              onClick={() => setView("disappearing")}
              className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <span className="w-5 h-5 flex items-center justify-center text-[var(--text-quaternary)]">
                <Timer className="w-5 h-5" />
              </span>
              <span className="flex-1 text-left text-[15px]">Disappearing messages</span>
              <span className="text-[15px] text-[var(--text-quaternary)] mr-1">
                {formatDuration(disappearingMessagesDurationNs)}
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
