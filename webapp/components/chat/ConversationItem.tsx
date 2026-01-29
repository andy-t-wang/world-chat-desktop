'use client';

import { Pin, BellOff, Image, Video, Ban } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { VerificationBadge } from '@/components/ui/VerificationBadge';
import { useDisplayName } from '@/hooks/useDisplayName';

interface MemberPreview {
  inboxId: string;
  address: string;
}

export interface ConversationItemProps {
  id: string;
  /** Type of conversation */
  conversationType: 'dm' | 'group';
  /** Peer's wallet address - used for DMs */
  peerAddress?: string;
  /** Override display name (if not using username lookup) */
  name?: string;
  /** Override avatar URL (if not using profile picture lookup) */
  avatarUrl?: string | null;
  /** Group name - for groups */
  groupName?: string;
  /** Number of members - for groups */
  memberCount?: number;
  /** Member previews for group avatars */
  memberPreviews?: MemberPreview[];
  lastMessage?: string | null;
  lastMessageType?: 'text' | 'image' | 'video' | 'deleted' | 'reaction';
  reactionEmoji?: string;
  reactionTarget?: string;
  isTyping?: boolean;
  typingUser?: string;
  timestamp?: string;
  unreadCount?: number;
  isPinned?: boolean;
  isMuted?: boolean;
  isSelected?: boolean;
  /** Whether this is a new/unseen message request */
  isNewRequest?: boolean;
  /** Whether disappearing messages are enabled for this conversation */
  hasDisappearingMessages?: boolean;
  /** Whether user was @mentioned in unread messages */
  hasMention?: boolean;
  onClick?: () => void;
}

function formatPreview(props: ConversationItemProps): React.ReactNode {
  const { isTyping, typingUser, lastMessageType, lastMessage, reactionEmoji, reactionTarget } = props;

  if (isTyping) {
    return (
      <span className="italic">
        {typingUser ? `${typingUser} is typing...` : 'typing...'}
      </span>
    );
  }

  if (lastMessageType === 'deleted') {
    return (
      <span className="flex items-center gap-1">
        <Ban className="w-3.5 h-3.5" />
        You deleted this message
      </span>
    );
  }

  if (lastMessageType === 'reaction' && reactionEmoji) {
    return (
      <span>
        You reacted {reactionEmoji} to "{reactionTarget}"
      </span>
    );
  }

  if (lastMessageType === 'image') {
    return (
      <span className="flex items-center gap-1">
        <Image className="w-3.5 h-3.5" />
        {lastMessage || '1 photo'}
      </span>
    );
  }

  if (lastMessageType === 'video') {
    return (
      <span className="flex items-center gap-1">
        <Video className="w-3.5 h-3.5" />
        {lastMessage || '1 video'}
      </span>
    );
  }

  return <span>{lastMessage || 'New conversation'}</span>;
}

export function ConversationItem(props: ConversationItemProps) {
  const {
    conversationType,
    peerAddress,
    name: nameOverride,
    avatarUrl,
    groupName,
    memberCount,
    memberPreviews,
    timestamp,
    unreadCount = 0,
    isPinned = false,
    isMuted = false,
    isSelected = false,
    isNewRequest = false,
    hasDisappearingMessages = false,
    hasMention = false,
    onClick,
  } = props;

  // For DMs: Fetch display name (custom nickname > world username > address) and profile picture
  const { displayName, profilePicture } = useDisplayName(conversationType === 'dm' ? peerAddress : null);

  // User is verified if they have a profile_picture_url (even if it's a default one)
  const isVerified = conversationType === 'dm' && profilePicture !== null;

  // Determine display name based on conversation type
  const name = conversationType === 'group'
    ? (groupName || 'Group Chat')
    : (nameOverride ?? displayName);

  // Subtitle for groups (member count)
  const subtitle = conversationType === 'group' && memberCount
    ? `${memberCount} members`
    : undefined;

  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left
        ${isSelected
          ? 'bg-[var(--bg-selected)]'
          : 'hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]'
        }
      `}
    >
      {/* Avatar */}
      {conversationType === 'group' ? (
        <Avatar
          isGroup
          groupName={groupName}
          imageUrl={avatarUrl}
          memberPreviews={memberPreviews}
          size="md"
          showDisappearingIcon={hasDisappearingMessages}
        />
      ) : (
        <Avatar address={peerAddress} name={nameOverride} imageUrl={avatarUrl} size="md" showDisappearingIcon={hasDisappearingMessages} />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        {/* User/Group Info */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          {/* Name Row */}
          {/* Unread: bold name, Read: semibold */}
          <div className="flex items-center gap-1">
            <span className={`text-[15px] truncate max-w-[160px] ${
              isSelected
                ? 'text-[var(--text-selected)] font-semibold'
                : unreadCount > 0
                  ? 'text-[var(--text-primary)] font-bold'
                  : 'text-[var(--text-primary)] font-semibold'
            }`}>
              {name}
            </span>
            {isVerified && conversationType === 'dm' && <VerificationBadge size="sm" />}
          </div>

          {/* Preview Row - show subtitle for groups if no last message, otherwise show preview */}
          {/* Unread: dark text + semibold, Read: lighter text + normal weight */}
          <div className={`text-[14px] leading-[1.3] truncate ${
            isSelected
              ? 'text-[var(--text-selected-secondary)]'
              : unreadCount > 0
                ? 'text-[var(--text-primary)] font-semibold'
                : 'text-[var(--text-secondary)]'
          }`}>
            {props.lastMessage ? formatPreview(props) : (subtitle || formatPreview(props))}
          </div>
        </div>

        {/* Right Side */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* Timestamp */}
          {timestamp && (
            <span className={`text-[13px] leading-[1.3] ${isSelected ? 'text-[var(--text-selected-secondary)]' : 'text-[var(--text-tertiary)]'}`}>
              {timestamp}
            </span>
          )}

          {/* Indicators */}
          <div className="flex items-center gap-1.5">
            {isMuted && (
              <BellOff className={`w-4 h-4 ${isSelected ? 'text-[var(--text-selected-secondary)]' : 'text-[var(--text-tertiary)]'}`} />
            )}
            {isPinned && (
              <Pin className={`w-4 h-4 ${isSelected ? 'text-[var(--text-selected-secondary)]' : 'text-[var(--text-tertiary)]'}`} />
            )}
            {isNewRequest && (
              <span className={`w-2.5 h-2.5 rounded-full ${
                isSelected ? 'bg-[var(--text-selected)]' : 'bg-[var(--accent-blue)]'
              }`} />
            )}
            {/* Mention indicator - @ symbol */}
            {hasMention && !isNewRequest && (
              <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                isSelected ? 'bg-[var(--text-selected)] text-[var(--bg-selected)]' : 'bg-[var(--accent-blue)] text-white'
              }`}>
                @
              </span>
            )}
            {unreadCount > 0 && !isNewRequest && !hasMention && (
              <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium flex items-center justify-center ${
                isSelected ? 'bg-[var(--text-selected)] text-[var(--bg-selected)]' : 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
              }`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
