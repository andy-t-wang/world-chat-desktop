'use client';

import { useUsername } from '@/hooks/useUsername';

interface ReplyBubbleProps {
  /** The text being replied to */
  quotedContent: string;
  /** Address of the original message sender */
  quotedSenderAddress: string;
  /** The reply message content */
  replyContent: string;
  /** Whether this is the current user's message */
  isOwnMessage: boolean;
  /** Whether this is the first message in a group */
  isFirstInGroup: boolean;
  /** Whether this is the last message in a group */
  isLastInGroup: boolean;
  /** Whether the conversation is verified (for bubble color) */
  isVerified?: boolean;
  /** Translated text to show below original (only for incoming) */
  translatedContent?: string;
  /** Reactions component to render (positioned for correct overlap) */
  reactions?: React.ReactNode;
}

export function ReplyBubble({
  quotedContent,
  quotedSenderAddress,
  replyContent,
  isOwnMessage,
  isFirstInGroup,
  isLastInGroup,
  isVerified = false,
  translatedContent,
  reactions,
}: ReplyBubbleProps) {
  const { displayName } = useUsername(quotedSenderAddress);

  // Dynamic border radius based on position in group
  const getReplyRadius = () => {
    if (isOwnMessage) {
      // Outgoing: rounded except bottom-right for last, all rounded for first
      if (isFirstInGroup && isLastInGroup) {
        return 'rounded-tl-[16px] rounded-tr-[16px] rounded-bl-[16px] rounded-br-[4px]';
      }
      if (isFirstInGroup) {
        return 'rounded-tl-[16px] rounded-tr-[16px] rounded-bl-[16px] rounded-br-[16px]';
      }
      if (isLastInGroup) {
        return 'rounded-tl-[16px] rounded-tr-[16px] rounded-bl-[16px] rounded-br-[4px]';
      }
      return 'rounded-[16px]';
    } else {
      // Incoming: rounded except bottom-left for last
      if (isFirstInGroup && isLastInGroup) {
        return 'rounded-tl-[16px] rounded-tr-[16px] rounded-bl-[4px] rounded-br-[16px]';
      }
      if (isFirstInGroup) {
        return 'rounded-[16px]';
      }
      if (isLastInGroup) {
        return 'rounded-tl-[16px] rounded-tr-[16px] rounded-bl-[4px] rounded-br-[16px]';
      }
      return 'rounded-[16px]';
    }
  };

  // Bubble background color
  const bubbleBg = isOwnMessage
    ? (isVerified ? 'bg-[var(--bubble-outgoing)]' : 'bg-[var(--bubble-unverified)]')
    : 'bg-[var(--bubble-incoming)]';

  const textColor = isOwnMessage ? 'text-white' : 'text-[var(--bubble-incoming-text)]';

  return (
    <div className={`flex flex-col gap-[2px] ${isOwnMessage ? 'items-end' : 'items-start'}`}>
      {/* Replied to label */}
      <div className={`flex items-center gap-1 px-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
        <span className="text-[13px] text-[var(--text-tertiary)]">
          Replied to {displayName}
        </span>
      </div>

      {/* Quoted message with connector bar */}
      <div className={`flex gap-2 items-stretch ${isOwnMessage ? 'flex-row' : 'flex-row-reverse'}`}>
        {/* Quoted message bubble */}
        <div className="max-w-[300px] px-3 py-[7px] bg-[var(--bg-secondary)] rounded-[16px]">
          <p className="text-[15px] text-[var(--text-tertiary)] leading-[1.3] line-clamp-2 break-words">
            {quotedContent}
          </p>
        </div>
        {/* Vertical connector bar */}
        <div className="w-1 bg-[var(--border-subtle)] rounded-full self-stretch" />
      </div>

      {/* Reply message bubble */}
      <div className={`max-w-[300px] px-3 py-[7px] ${bubbleBg} ${getReplyRadius()}`}>
        <p className={`text-[15px] leading-[1.3] break-words ${textColor} ${isOwnMessage ? 'opacity-90' : ''}`}>
          {replyContent}
        </p>
        {translatedContent && !isOwnMessage && (
          <div className="mt-1.5 pt-1.5 border-t border-[rgba(0,0,0,0.08)]">
            <p className="text-[15px] text-[var(--text-secondary)] italic leading-[1.4]">
              {translatedContent}
            </p>
          </div>
        )}
      </div>

      {/* Reactions - positioned to overlap with reply bubble */}
      {reactions}
    </div>
  );
}
