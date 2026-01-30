"use client";

import { useEffect, useCallback, useState } from "react";
import { X, Users, Image, Pencil, Bell, Pin, LogOut, ChevronRight, Loader2, ArrowLeft, UserPlus, UserMinus, Timer, Check } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { VerificationBadge } from "@/components/ui/VerificationBadge";
import { useUsername } from "@/hooks/useUsername";
import { AddMemberModal } from "./AddMemberModal";

interface MemberPreview {
  inboxId: string;
  address: string;
}

interface GroupDetailsPanelProps {
  onClose: () => void;
  groupName: string;
  memberPreviews?: MemberPreview[];
  verifiedCount?: number;
  unverifiedCount?: number;
  avatarUrl?: string | null;
  conversationId: string;
  onLeaveGroup: () => Promise<void>;
  isLeavingGroup: boolean;
  ownInboxId?: string;
  onMemberAdded?: (address: string, displayName: string | null) => void;
  onMemberRemoved?: (inboxId: string, address: string, displayName: string | null) => Promise<void>;
  onMemberClick?: (address: string, inboxId: string) => void;
  // Disappearing messages
  disappearingMessagesEnabled?: boolean;
  disappearingMessagesDurationNs?: bigint;
  onDisappearingMessagesChange?: (durationNs: bigint | null) => Promise<void>;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick?: () => void;
  variant?: "default" | "danger";
  isLoading?: boolean;
}

function MenuItem({ icon, label, value, onClick, variant = "default", isLoading }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={`w-full flex items-center gap-3 px-4 py-3 transition-colors disabled:opacity-50 ${
        variant === "danger"
          ? "text-[var(--accent-red)] hover:bg-[var(--accent-red-light)]"
          : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      <span className={`w-5 h-5 flex items-center justify-center ${
        variant === "danger" ? "text-[var(--accent-red)]" : "text-[var(--text-quaternary)]"
      }`}>
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
      </span>
      <span className="flex-1 text-left text-[15px]">{label}</span>
      {value && (
        <span className="text-[15px] text-[var(--text-quaternary)] mr-1">{value}</span>
      )}
      {variant !== "danger" && !isLoading && (
        <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
      )}
    </button>
  );
}

// Member row component with username lookup
function MemberRow({
  address,
  inboxId,
  isYou,
  isAdmin,
  isPending,
  isRemoving,
  onRemove,
  onAvatarClick,
}: {
  address: string;
  inboxId: string;
  isYou: boolean;
  isAdmin?: boolean;
  isPending?: boolean;
  isRemoving?: boolean;
  onRemove?: (inboxId: string, address: string, displayName: string | null) => void;
  onAvatarClick?: (address: string, inboxId: string) => void;
}) {
  const { displayName, profilePicture } = useUsername(address);
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const name = isYou ? "You" : (displayName || shortAddress);
  const username = displayName ? `@${displayName.toLowerCase().replace(/\s+/g, '')}` : shortAddress;
  const isVerified = Boolean(profilePicture);

  const handleRemove = () => {
    if (onRemove && !isYou && !isPending && !isRemoving) {
      onRemove(inboxId, address, displayName);
    }
  };

  const handleAvatarClick = () => {
    if (onAvatarClick && !isYou) {
      onAvatarClick(address, inboxId);
    }
  };

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors ${isPending || isRemoving ? 'opacity-60' : ''}`}>
      <button
        onClick={handleAvatarClick}
        disabled={isYou || !onAvatarClick}
        className={`shrink-0 ${!isYou && onAvatarClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      >
        <Avatar address={address} size="md" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-[15px] text-[var(--text-primary)] truncate">{name}</span>
          {isVerified && <VerificationBadge size="xs" />}
          {isPending && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-quaternary)]" />}
          {isRemoving && <Loader2 className="w-3 h-3 animate-spin text-[var(--accent-red)]" />}
        </div>
        {!isYou && (
          <span className="text-[13px] text-[var(--text-quaternary)] truncate block">{username}</span>
        )}
      </div>
      {isAdmin && (
        <span className="text-[13px] text-[var(--text-quaternary)]">Admin</span>
      )}
      {!isYou && !isPending && onRemove && (
        <button
          onClick={handleRemove}
          disabled={isRemoving}
          className="w-8 h-8 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-[var(--accent-red-light)] text-[var(--text-quaternary)] hover:text-[var(--accent-red)] transition-all disabled:opacity-50"
          title="Remove from group"
        >
          {isRemoving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <UserMinus className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}

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

// Disappearing messages settings view
function DisappearingMessagesView({
  currentDurationNs,
  onSelect,
  onBack,
  isUpdating,
}: {
  currentDurationNs: bigint | undefined;
  onSelect: (durationNs: bigint | null) => void;
  onBack: () => void;
  isUpdating: boolean;
}) {
  // Find which option is currently selected
  const isSelected = (value: bigint | null) => {
    if (value === null) {
      return !currentDurationNs || currentDurationNs === BigInt(0);
    }
    return currentDurationNs === value;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 h-16 px-4 flex items-center gap-3 border-b border-[var(--border-subtle)]">
        <button
          onClick={onBack}
          disabled={isUpdating}
          className="electron-no-drag w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--text-primary)]" />
        </button>
        <span className="text-[17px] font-semibold text-[var(--text-primary)]">Disappearing messages</span>
        {isUpdating && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-quaternary)]" />}
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
            onClick={() => onSelect(option.value)}
            disabled={isUpdating}
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

// Group members view
function GroupMembersView({
  memberPreviews,
  optimisticMembers,
  removingMembers,
  ownInboxId,
  onBack,
  onAddNew,
  onRemoveMember,
  onMemberClick,
}: {
  memberPreviews: MemberPreview[];
  optimisticMembers: MemberPreview[];
  removingMembers: Set<string>;
  ownInboxId?: string;
  onBack: () => void;
  onAddNew: () => void;
  onRemoveMember: (inboxId: string, address: string, displayName: string | null) => void;
  onMemberClick?: (address: string, inboxId: string) => void;
}) {
  // Get set of real member addresses for deduplication
  const realMemberAddresses = new Set(memberPreviews.map(m => m.address.toLowerCase()));

  // Filter optimistic members to exclude those already in real list
  const pendingOptimistic = optimisticMembers.filter(
    m => !realMemberAddresses.has(m.address.toLowerCase())
  );

  // Combine confirmed and pending optimistic members
  const allMembers = [...memberPreviews, ...pendingOptimistic];

  // Sort: You first, then others
  const sortedMembers = [...allMembers].sort((a, b) => {
    if (a.inboxId === ownInboxId) return -1;
    if (b.inboxId === ownInboxId) return 1;
    return 0;
  });

  // Track which members are still pending (optimistic and not yet in real list)
  const optimisticAddresses = new Set(pendingOptimistic.map(m => m.address.toLowerCase()));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 h-16 px-4 flex items-center gap-3 border-b border-[var(--border-subtle)]">
        <button
          onClick={onBack}
          className="electron-no-drag w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--text-primary)]" />
        </button>
        <span className="text-[17px] font-semibold text-[var(--text-primary)]">Group members</span>
      </div>

      {/* Members list */}
      <div className="flex-1 overflow-y-auto scrollbar-auto-hide">
        {sortedMembers.map((member) => (
          <MemberRow
            key={member.inboxId || member.address}
            address={member.address}
            inboxId={member.inboxId}
            isYou={member.inboxId === ownInboxId}
            isAdmin={member.inboxId === ownInboxId}
            isPending={optimisticAddresses.has(member.address.toLowerCase())}
            isRemoving={removingMembers.has(member.inboxId)}
            onRemove={onRemoveMember}
            onAvatarClick={onMemberClick}
          />
        ))}
      </div>

      {/* Add new button at bottom */}
      <div className="shrink-0 p-4 border-t border-[var(--border-subtle)]">
        <button
          onClick={onAddNew}
          className="w-full h-12 flex items-center justify-center gap-2 rounded-full bg-[var(--text-primary)] text-[15px] font-medium text-[var(--text-inverse)] hover:opacity-90 transition-colors"
        >
          <UserPlus className="w-5 h-5" />
          Add new
        </button>
      </div>
    </div>
  );
}

export function GroupDetailsPanel({
  onClose,
  groupName,
  memberPreviews = [],
  verifiedCount = 0,
  unverifiedCount = 0,
  avatarUrl,
  conversationId,
  onLeaveGroup,
  isLeavingGroup,
  ownInboxId,
  onMemberAdded,
  onMemberRemoved,
  onMemberClick,
  disappearingMessagesEnabled,
  disappearingMessagesDurationNs,
  onDisappearingMessagesChange,
}: GroupDetailsPanelProps) {
  const [view, setView] = useState<"details" | "members" | "disappearing">("details");
  const [showAddModal, setShowAddModal] = useState(false);
  const [optimisticMembers, setOptimisticMembers] = useState<MemberPreview[]>([]);
  const [removingMembers, setRemovingMembers] = useState<Set<string>>(new Set());
  const [isUpdatingDisappearing, setIsUpdatingDisappearing] = useState(false);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAddModal) {
          setShowAddModal(false);
        } else if (view === "members" || view === "disappearing") {
          setView("details");
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose, view, showAddModal]);

  const handleComingSoon = useCallback(() => {
    alert("Coming soon!");
  }, []);

  // Handle disappearing messages change
  const handleDisappearingChange = useCallback(async (durationNs: bigint | null) => {
    if (!onDisappearingMessagesChange || isUpdatingDisappearing) return;

    setIsUpdatingDisappearing(true);
    try {
      await onDisappearingMessagesChange(durationNs);
      setView("details");
    } catch (error) {
      console.error("Failed to update disappearing messages:", error);
    } finally {
      setIsUpdatingDisappearing(false);
    }
  }, [onDisappearingMessagesChange, isUpdatingDisappearing]);

  // Handle member added - optimistic update
  const handleMemberAdded = useCallback((address: string, displayName: string | null) => {
    // Add to optimistic list immediately
    const optimisticMember: MemberPreview = {
      inboxId: `optimistic-${address}`,
      address: address,
    };
    setOptimisticMembers(prev => [...prev, optimisticMember]);

    // Notify parent (which will send system message and refresh metadata)
    onMemberAdded?.(address, displayName);

    // Remove from optimistic list after a delay (real data should have arrived)
    setTimeout(() => {
      setOptimisticMembers(prev => prev.filter(m => m.address.toLowerCase() !== address.toLowerCase()));
    }, 3000);
  }, [onMemberAdded]);

  // Handle member removal
  const handleRemoveMember = useCallback(async (inboxId: string, address: string, displayName: string | null) => {
    if (!onMemberRemoved || removingMembers.has(inboxId)) return;

    // Mark as removing
    setRemovingMembers(prev => new Set(prev).add(inboxId));

    try {
      await onMemberRemoved(inboxId, address, displayName);
    } catch (error) {
      console.error('Failed to remove member:', error);
      // Show error to user
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to remove member: ${errorMessage}`);
    } finally {
      // Remove from removing set
      setRemovingMembers(prev => {
        const next = new Set(prev);
        next.delete(inboxId);
        return next;
      });
    }
  }, [onMemberRemoved, removingMembers]);

  // Build member count string
  const totalMembers = memberPreviews.length + optimisticMembers.length;
  const memberCountText = (() => {
    if (verifiedCount > 0 && unverifiedCount > 0) {
      return `${verifiedCount} ${verifiedCount === 1 ? "human" : "humans"}, ${unverifiedCount} not verified`;
    }
    if (verifiedCount > 0) {
      return `${verifiedCount} ${verifiedCount === 1 ? "human" : "humans"}`;
    }
    if (unverifiedCount > 0) {
      return `${unverifiedCount} not verified`;
    }
    return `${totalMembers} ${totalMembers === 1 ? "member" : "members"}`;
  })();

  // Get existing member addresses for the modal
  const existingMemberAddresses = memberPreviews.map(m => m.address);

  // Members view
  if (view === "members") {
    return (
      <div className="w-[320px] shrink-0 h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] flex flex-col">
        <GroupMembersView
          memberPreviews={memberPreviews}
          optimisticMembers={optimisticMembers}
          removingMembers={removingMembers}
          ownInboxId={ownInboxId}
          onBack={() => setView("details")}
          onAddNew={() => setShowAddModal(true)}
          onRemoveMember={handleRemoveMember}
          onMemberClick={onMemberClick}
        />

        {/* Add Member Modal */}
        <AddMemberModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          conversationId={conversationId}
          existingMemberAddresses={existingMemberAddresses}
          onMemberAdded={handleMemberAdded}
        />
      </div>
    );
  }

  // Disappearing messages view
  if (view === "disappearing") {
    return (
      <div className="w-[320px] shrink-0 h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] flex flex-col">
        <DisappearingMessagesView
          currentDurationNs={disappearingMessagesDurationNs}
          onSelect={handleDisappearingChange}
          onBack={() => setView("details")}
          isUpdating={isUpdatingDisappearing}
        />
      </div>
    );
  }

  // Details view
  return (
    <div className="w-[320px] shrink-0 h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] flex flex-col">
      {/* Header */}
      <div className="shrink-0 h-16 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
        <span className="text-[17px] font-semibold text-[var(--text-primary)]">Group Info</span>
        <button
          onClick={onClose}
          className="electron-no-drag w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X className="w-5 h-5 text-[var(--text-quaternary)]" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-auto-hide">
        {/* Group Avatar & Name Section */}
        <div className="flex flex-col items-center pt-8 pb-6 px-4">
          {/* Large group avatar */}
          <Avatar
            isGroup
            groupName={groupName}
            imageUrl={avatarUrl}
            memberPreviews={memberPreviews}
            size="lg"
          />

          {/* Group name */}
          <h2 className="mt-4 text-[22px] font-semibold text-[var(--text-primary)] text-center">
            {groupName || "Group Chat"}
          </h2>

          {/* Member count with verification badge */}
          <div className="flex items-center gap-1.5 mt-1">
            {verifiedCount > 0 && <VerificationBadge size="sm" />}
            <span className="text-[15px] text-[var(--text-quaternary)]">{memberCountText}</span>
          </div>
        </div>

        {/* Menu Items */}
        <div>
          <MenuItem
            icon={<Users className="w-5 h-5" />}
            label="Group members"
            onClick={() => setView("members")}
          />
          <MenuItem
            icon={<Image className="w-5 h-5" />}
            label="Media, Links and Mini Apps"
            onClick={handleComingSoon}
          />
          <MenuItem
            icon={<Pencil className="w-5 h-5" />}
            label="Group name"
            onClick={handleComingSoon}
          />
          <MenuItem
            icon={<Bell className="w-5 h-5" />}
            label="Notifications"
            value="On"
            onClick={handleComingSoon}
          />
          <MenuItem
            icon={<Timer className="w-5 h-5" />}
            label="Disappearing messages"
            value={formatDuration(disappearingMessagesDurationNs)}
            onClick={() => setView("disappearing")}
          />
          <MenuItem
            icon={<Pin className="w-5 h-5" />}
            label="Pin"
            onClick={handleComingSoon}
          />
        </div>
      </div>

      {/* Leave Group - fixed at bottom */}
      <div className="shrink-0 border-t border-[#E5E5EA]">
        <MenuItem
          icon={<LogOut className="w-5 h-5" />}
          label="Leave chat"
          onClick={onLeaveGroup}
          variant="danger"
          isLoading={isLeavingGroup}
        />
      </div>
    </div>
  );
}
