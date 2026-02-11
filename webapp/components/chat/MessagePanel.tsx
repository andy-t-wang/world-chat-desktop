"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useLayoutEffect,
} from "react";
import { useAtomValue, useAtom } from "jotai";
import { GroupMessageKind } from "@xmtp/browser-sdk";
import {
  Paperclip,
  Send,
  Loader2,
  AlertCircle,
  RotateCcw,
  Lock,
  LogOut,
  Clock,
  SmilePlus,
  ChevronLeft,
  Reply,
  Timer,
  Globe,
  Languages,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { VerificationBadge } from "@/components/ui/VerificationBadge";
import { MessageText, MessageLinkPreview } from "./MessageContent";
import { MessageTickerPreview } from "./TickerPreview";
import { TickerChartModal } from "./TickerChartModal";
import { HighlightedInput, type HighlightedInputRef } from "./HighlightedInput";
import type { TickerPriceData } from "@/app/api/ticker-price/route";
import { updateTickerCache } from "@/hooks/useTickerPrice";
import { hasTickers, type TickerType } from "@/lib/ticker/utils";
import { isJustUrl, extractUrls } from "./LinkPreview";
import { PaymentMessage } from "./PaymentMessage";
import { ImageMessage } from "./ImageMessage";
import { ImageGrid } from "./ImageGrid";
import { MultiAttachmentMessage } from "./MultiAttachmentMessage";
import { MessageRequestBanner } from "./RequestActionBar";
import { MessageContextMenu } from "./MessageContextMenu";
import { ReplyPreview } from "./ReplyPreview";
import { ReplyBubble } from "./ReplyBubble";
import { ReactionDetailsMenu } from "./ReactionDetailsMenu";
import {
  chatBackgroundStylePattern,
  chatBackgroundStylePatternDark,
  chatBackgroundStyleSolid,
  chatBackgroundStyleSolidDark,
} from "./ChatBackground";
import { replyingToAtom, messageInputDraftAtom } from "@/stores/ui";
import {
  isTransactionReference,
  normalizeTransactionReference,
  type TransactionReference,
} from "@/lib/xmtp/TransactionReferenceCodec";
import { isPaymentRequest, type PaymentRequest } from "@/lib/xmtp/PaymentRequestCodec";
import { isPaymentFulfillment, type PaymentFulfillment } from "@/lib/xmtp/PaymentFulfillmentCodec";
import { PaymentRequestMessage, PaymentFulfillmentMessage } from "./PaymentRequestMessage";
import type { RemoteAttachmentContent } from "@/types/attachments";
import {
  isMultiAttachment,
  isSingleAttachment,
  isMultiAttachmentWrapper,
  extractAttachments,
} from "@/types/attachments";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useTranslation } from "@/hooks/useTranslation";
import { resolveUsername } from "@/lib/username/service";
import { useMessages } from "@/hooks/useMessages";
import { xmtpClientAtom } from "@/stores/client";
import {
  readReceiptVersionAtom,
  reactionsAtom,
  reactionsVersionAtom,
  messageCache,
} from "@/stores/messages";
import { linkPreviewEnabledAtom, chatBackgroundStyleAtom } from "@/stores/settings";
import { streamManager } from "@/lib/xmtp/StreamManager";
import type { DecodedMessage } from "@xmtp/browser-sdk";
import type { PendingMessage } from "@/types/messages";

// Common reaction emojis
const REACTION_EMOJIS = ["❤️", "👍", "👎", "😂", "😮", "😢"];

// Languages for outgoing message translation
const TRANSLATE_LANGUAGES = [
  { code: "es", name: "Spanish", abbr: "ES", flag: "🇪🇸" },
  { code: "fr", name: "French", abbr: "FR", flag: "🇫🇷" },
  { code: "de", name: "German", abbr: "DE", flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", abbr: "PT", flag: "🇵🇹" },
  { code: "zh", name: "Chinese", abbr: "ZH", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", abbr: "JA", flag: "🇯🇵" },
  { code: "ko", name: "Korean", abbr: "KO", flag: "🇰🇷" },
  { code: "ar", name: "Arabic", abbr: "AR", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", abbr: "HI", flag: "🇮🇳" },
  { code: "th", name: "Thai", abbr: "TH", flag: "🇹🇭" },
  { code: "id", name: "Indonesian", abbr: "ID", flag: "🇮🇩" },
  { code: "ru", name: "Russian", abbr: "RU", flag: "🇷🇺" },
];

// Status message patterns - these are system messages shown as centered pills
const STATUS_MESSAGE_PATTERNS = [
  /^.+ was added to the group$/,
  /^.+ was removed from the group$/,
  /^You added .+$/,
  /^You removed .+$/,
  /^.+ left the group$/,
  /^.+ joined the group$/,
  /^Group name changed to .+$/,
  /^.+ changed the group name to .+$/,
];

// Check if a message is a status/system message
function isStatusMessage(text: string): boolean {
  if (!text) return false;
  return STATUS_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

// Status message component - centered pill style
function StatusMessage({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-2">
      <div className="bg-[var(--bg-secondary)] px-3 py-1 rounded-lg max-w-[80%]">
        <p className="text-[13px] text-[var(--text-secondary)] leading-[1.2] text-center">
          {text}
        </p>
      </div>
    </div>
  );
}

// Message timestamp with optional timer icon for disappearing messages
function MessageTimestamp({
  timeString,
  isOwnMessage,
  hasTimer = false,
  className = "",
}: {
  timeString: string;
  isOwnMessage: boolean;
  hasTimer?: boolean;
  className?: string;
}) {
  const baseClass = `text-[11px] font-medium ${
    isOwnMessage ? "text-[var(--text-quaternary)]" : "text-[var(--text-secondary)]"
  }`;

  return (
    <span className={`inline-flex items-center gap-1 ${baseClass} ${className}`}>
      {hasTimer && (
        <Timer
          size={11}
          className={isOwnMessage ? "text-[var(--text-quaternary)]" : "text-[var(--text-secondary)]"}
        />
      )}
      {timeString}
    </span>
  );
}

// Membership change content structure from XMTP
interface MembershipChangeContent {
  initiatedByInboxId?: string;
  addedInboxes?: Array<{ inboxId: string }>;
  removedInboxes?: Array<{ inboxId: string }>;
  metadataFieldChanges?: Array<{ fieldName: string; oldValue?: string; newValue?: string }>;
}

const REMOVE_MESSAGE_TYPE = "remove_message";
const TOOLS_FOR_HUMANITY_AUTHORITY = "toolsforhumanity.com";
const SLOW_DISPLAY_BUILD_WARN_MS = 120;
const SLOW_DISPLAY_MESSAGE_COUNT = 300;
const LARGE_FALLBACK_DECODE_WARN_BYTES = 128 * 1024;
const LARGE_FALLBACK_DECODE_SKIP_BYTES = 512 * 1024;
const PERF_LOG_COOLDOWN_MS = 5000;
const MAIN_THREAD_STALL_CHECK_INTERVAL_MS = 1000;
const MAIN_THREAD_STALL_WARN_MS = 800;
const FALLBACK_DECODE_TYPE_IDS = new Set([
  "text",
  "reply",
  "transactionreference",
  "paymentrequest",
  "paymentfulfillment",
  "remoteattachment",
  "remotestaticattachment",
  "multiremoteattachment",
  "multiremotestaticattachment",
  "group_updated",
  "membershipchange",
]);

function isRemoveMessageControlType(message: {
  contentType?: { typeId?: string; authorityId?: string };
}): boolean {
  const typeId = message.contentType?.typeId?.toLowerCase();
  if (!typeId) return false;

  if (typeId === REMOVE_MESSAGE_TYPE || typeId === "removemessage") {
    return true;
  }

  if (typeId.includes(REMOVE_MESSAGE_TYPE)) {
    return true;
  }

  const authorityId = message.contentType?.authorityId?.toLowerCase();
  return authorityId === TOOLS_FOR_HUMANITY_AUTHORITY &&
    typeId.includes("remove") &&
    typeId.includes("message");
}

function shouldAttemptFallbackDecode(typeId?: string): boolean {
  if (!typeId) return true;
  return FALLBACK_DECODE_TYPE_IDS.has(typeId.toLowerCase());
}

function summarizeTopContentTypes(
  counts: Record<string, number>,
  limit = 6,
): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

// Check if a message is an XMTP membership change message
function isMembershipChangeMessage(message: {
  kind?: unknown;
  contentType?: { typeId?: string };
}): boolean {
  const kind = message.kind as unknown;
  const typeId = message.contentType?.typeId;

  return (
    kind === GroupMessageKind.MembershipChange ||
    kind === 1 ||
    kind === 'membership_change' ||
    typeId === 'membershipChange' ||
    typeId === 'group_updated'  // XMTP uses this typeId for membership changes
  );
}

// Component to resolve a single member's name
function MemberName({
  inboxId,
  memberPreviews
}: {
  inboxId: string;
  memberPreviews?: Array<{ inboxId: string; address: string }>;
}) {
  // First try to get address from current member previews
  const preview = memberPreviews?.find((m) => m.inboxId === inboxId);

  // If not in current members, check the StreamManager cache (for removed members)
  const cachedAddress = preview?.address || streamManager.getCachedAddress(inboxId);

  // State for async lookup result
  const [lookedUpAddress, setLookedUpAddress] = useState<string | null>(null);

  // If we don't have an address yet, trigger async lookup
  useEffect(() => {
    if (cachedAddress || lookedUpAddress) return;

    let cancelled = false;
    streamManager.getAddressFromInboxId(inboxId).then((address) => {
      if (!cancelled && address) {
        setLookedUpAddress(address);
      }
    });

    return () => { cancelled = true; };
  }, [inboxId, cachedAddress, lookedUpAddress]);

  // Use the best available address
  const address = cachedAddress || lookedUpAddress;
  const { displayName } = useDisplayName(address || null);

  if (displayName) return <>{displayName}</>;
  if (address) return <>{`${address.slice(0, 6)}...${address.slice(-4)}`}</>;
  return <>{`${inboxId.slice(0, 6)}...${inboxId.slice(-4)}`}</>;
}

// Grouped membership change message - renders multiple changes as a single pill
function GroupedMembershipChangeMessage({
  changes,
  memberPreviews,
}: {
  changes: Array<{ type: 'added' | 'removed'; inboxIds: string[] }>;
  memberPreviews?: Array<{ inboxId: string; address: string }>;
}) {
  // Collect all added and removed members
  const addedInboxIds: string[] = [];
  const removedInboxIds: string[] = [];

  for (const change of changes) {
    if (change.type === 'added') {
      addedInboxIds.push(...change.inboxIds);
    } else {
      removedInboxIds.push(...change.inboxIds);
    }
  }

  // Deduplicate
  const uniqueAdded = [...new Set(addedInboxIds)];
  const uniqueRemoved = [...new Set(removedInboxIds)];

  if (uniqueAdded.length === 0 && uniqueRemoved.length === 0) return null;

  return (
    <>
      {uniqueAdded.length > 0 && (
        <div className="flex items-center justify-center py-2">
          <div className="bg-[var(--bg-secondary)] px-3 py-1 rounded-lg max-w-[80%]">
            <p className="text-[13px] text-[var(--text-secondary)] leading-[1.2] text-center">
              {uniqueAdded.map((inboxId, i) => (
                <span key={inboxId}>
                  {i > 0 && (i === uniqueAdded.length - 1 ? ' and ' : ', ')}
                  <MemberName inboxId={inboxId} memberPreviews={memberPreviews} />
                </span>
              ))}
              {' '}joined the group
            </p>
          </div>
        </div>
      )}
      {uniqueRemoved.length > 0 && (
        <div className="flex items-center justify-center py-2">
          <div className="bg-[var(--bg-secondary)] px-3 py-1 rounded-lg max-w-[80%]">
            <p className="text-[13px] text-[var(--text-secondary)] leading-[1.2] text-center">
              {uniqueRemoved.map((inboxId, i) => (
                <span key={inboxId}>
                  {i > 0 && (i === uniqueRemoved.length - 1 ? ' and ' : ', ')}
                  <MemberName inboxId={inboxId} memberPreviews={memberPreviews} />
                </span>
              ))}
              {' '}left the group
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// Format disappearing messages duration for display
function formatDisappearingDuration(durationNs: bigint): string {
  const totalSeconds = Number(durationNs / BigInt(1_000_000_000));

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

// Membership change message component - renders XMTP membership changes as status pills
function MembershipChangeMessage({
  content,
  memberPreviews,
}: {
  content: MembershipChangeContent;
  memberPreviews?: Array<{ inboxId: string; address: string }>;
}) {
  const addedInboxIds = content.addedInboxes?.map(m => m.inboxId) || [];
  const removedInboxIds = content.removedInboxes?.map(m => m.inboxId) || [];

  // Handle metadata changes
  const metadataTexts: string[] = [];
  if (content.metadataFieldChanges?.length) {
    for (const change of content.metadataFieldChanges) {
      if (change.fieldName === 'group_name' && change.newValue) {
        metadataTexts.push(`Group name changed to "${change.newValue}"`);
      }
      // Handle disappearing messages changes
      // Only match the duration field (message_disappear_in_ns), NOT the timestamp field (message_disappear_from_ns)
      if (change.fieldName === 'message_disappear_in_ns' ||
          change.fieldName === 'disappear_in_ns' ||
          change.fieldName === 'retention_duration_ns') {
        if (change.newValue && change.newValue !== '0') {
          try {
            const durationNs = BigInt(change.newValue);
            if (durationNs > BigInt(0)) {
              const duration = formatDisappearingDuration(durationNs);
              metadataTexts.push(`Disappearing messages turned on. Messages will be deleted after ${duration}.`);
            }
          } catch {
            metadataTexts.push('Disappearing messages turned on');
          }
        } else if (!change.newValue || change.newValue === '0' || change.newValue === '') {
          if (change.oldValue && change.oldValue !== '0') {
            metadataTexts.push('Disappearing messages turned off');
          }
        }
      }
    }
  }

  if (addedInboxIds.length === 0 && removedInboxIds.length === 0 && metadataTexts.length === 0) {
    return null;
  }

  return (
    <>
      {addedInboxIds.length > 0 && (
        <div className="flex items-center justify-center py-2">
          <div className="bg-[var(--bg-secondary)] px-3 py-1 rounded-lg max-w-[80%]">
            <p className="text-[13px] text-[var(--text-secondary)] leading-[1.2] text-center">
              {addedInboxIds.map((inboxId, i) => (
                <span key={inboxId}>
                  {i > 0 && (i === addedInboxIds.length - 1 ? ' and ' : ', ')}
                  <MemberName inboxId={inboxId} memberPreviews={memberPreviews} />
                </span>
              ))}
              {' '}joined the group
            </p>
          </div>
        </div>
      )}
      {removedInboxIds.length > 0 && (
        <div className="flex items-center justify-center py-2">
          <div className="bg-[var(--bg-secondary)] px-3 py-1 rounded-lg max-w-[80%]">
            <p className="text-[13px] text-[var(--text-secondary)] leading-[1.2] text-center">
              {removedInboxIds.map((inboxId, i) => (
                <span key={inboxId}>
                  {i > 0 && (i === removedInboxIds.length - 1 ? ' and ' : ', ')}
                  <MemberName inboxId={inboxId} memberPreviews={memberPreviews} />
                </span>
              ))}
              {' '}left the group
            </p>
          </div>
        </div>
      )}
      {metadataTexts.map((text, index) => (
        <StatusMessage key={`meta-${index}`} text={text} />
      ))}
    </>
  );
}

// Reaction picker component
interface ReactionPickerProps {
  position: { x: number; y: number };
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

function ReactionPicker({ position, onSelect, onClose }: ReactionPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [EmojiPicker, setEmojiPicker] = useState<React.ComponentType<{
    data: unknown;
    onEmojiSelect: (emoji: { native: string }) => void;
    theme: string;
    previewPosition: string;
    skinTonePosition: string;
  }> | null>(null);
  const [emojiData, setEmojiData] = useState<unknown>(null);

  // Lazy load emoji-mart only when full picker is opened
  useEffect(() => {
    if (showFullPicker && !EmojiPicker) {
      Promise.all([
        import("@emoji-mart/react"),
        import("@emoji-mart/data"),
      ]).then(([pickerModule, dataModule]) => {
        setEmojiPicker(() => pickerModule.default);
        setEmojiData(dataModule.default);
      });
    }
  }, [showFullPicker, EmojiPicker]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showFullPicker) {
          setShowFullPicker(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose, showFullPicker]);

  const handleEmojiSelect = (emoji: { native: string }) => {
    onSelect(emoji.native);
  };

  // Full emoji picker view
  if (showFullPicker) {
    return (
      <div
        ref={pickerRef}
        className="fixed z-50"
        style={{ left: position.x - 100, top: position.y - 350 }}
      >
        {EmojiPicker && emojiData ? (
          <EmojiPicker
            data={emojiData}
            onEmojiSelect={handleEmojiSelect}
            theme="light"
            previewPosition="none"
            skinTonePosition="search"
          />
        ) : (
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border-default)] p-8 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        )}
      </div>
    );
  }

  // Quick reaction bar
  return (
    <div
      ref={pickerRef}
      className="fixed z-50 bg-[var(--bg-primary)] rounded-full shadow-lg border border-[var(--border-default)] px-1.5 py-1 flex items-center"
      style={{ left: position.x, top: position.y }}
    >
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-2xl"
        >
          {emoji}
        </button>
      ))}
      {/* Divider */}
      <div className="w-px h-6 bg-gray-200 mx-1" />
      {/* Open full emoji picker */}
      <button
        onClick={() => setShowFullPicker(true)}
        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
        title="More emojis"
      >
        <SmilePlus className="w-5 h-5" />
      </button>
    </div>
  );
}

// Wrapper component that shows reaction and reply buttons on hover (like Messenger)
interface MessageWrapperProps {
  children: React.ReactNode;
  isOwnMessage: boolean;
  messageId: string;
  onReactionClick: (messageId: string, position: { x: number; y: number }) => void;
  onReplyClick?: (messageId: string) => void;
  onTranslateClick?: (messageId: string) => void;
  isTranslated?: boolean;
  isTranslating?: boolean;
  translationEnabled?: boolean;
}

function MessageWrapper({
  children,
  isOwnMessage,
  messageId,
  onReactionClick,
  onReplyClick,
  onTranslateClick,
  isTranslated,
  isTranslating,
  translationEnabled,
}: MessageWrapperProps) {
  const handleReactionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // Position picker centered above the button
    const pickerWidth = 280; // Approximate width of picker
    onReactionClick(messageId, {
      x: rect.left + rect.width / 2 - pickerWidth / 2,
      y: rect.top - 48,
    });
  };

  const handleReplyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReplyClick?.(messageId);
  };

  const handleTranslateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTranslateClick?.(messageId);
  };

  return (
    <div className="group/msg relative flex items-center gap-0.5">
      {/* Action buttons - left side for outgoing messages */}
      {isOwnMessage && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          {/* Translate button for outgoing messages */}
          {translationEnabled && (
            <button
              onClick={handleTranslateClick}
              disabled={isTranslating}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors shrink-0 ${
                isTranslated
                  ? "text-[var(--accent-blue)] hover:bg-[var(--bg-hover)]"
                  : isTranslating
                  ? "text-[var(--text-quaternary)] cursor-wait"
                  : "hover:bg-[var(--bg-hover)] text-[var(--text-quaternary)] hover:text-[var(--text-primary)]"
              }`}
              title={isTranslated ? "Hide translation" : isTranslating ? "Translating..." : "Translate"}
            >
              {isTranslating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Languages className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={handleReplyClick}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-quaternary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            title="Reply"
          >
            <Reply className="w-4 h-4" />
          </button>
          <button
            onClick={handleReactionClick}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-quaternary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            title="Add reaction"
          >
            <SmilePlus className="w-4 h-4" />
          </button>
        </div>
      )}

      {children}

      {/* Action buttons - right side for incoming messages */}
      {!isOwnMessage && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          {/* Translate button - only show if translation is enabled */}
          {translationEnabled && (
            <button
              onClick={handleTranslateClick}
              disabled={isTranslating}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors shrink-0 ${
                isTranslated
                  ? "text-[var(--accent-blue)] hover:bg-[var(--bg-hover)]"
                  : isTranslating
                  ? "text-[var(--text-quaternary)] cursor-wait"
                  : "hover:bg-[var(--bg-hover)] text-[var(--text-quaternary)] hover:text-[var(--text-primary)]"
              }`}
              title={isTranslated ? "Hide translation" : isTranslating ? "Translating..." : "Translate"}
            >
              {isTranslating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Languages className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={handleReactionClick}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-quaternary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            title="Add reaction"
          >
            <SmilePlus className="w-4 h-4" />
          </button>
          <button
            onClick={handleReplyClick}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-quaternary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            title="Reply"
          >
            <Reply className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// Display reactions below a message (overlapping style per Figma)
interface MessageReactionsProps {
  messageId: string;
  conversationId: string;
  isOwnMessage: boolean;
  memberPreviews?: MemberPreview[];
  peerAddress?: string;
  ownInboxId?: string;
  onReactionToggle?: () => void;
}

function MessageReactions({
  messageId,
  conversationId,
  isOwnMessage,
  memberPreviews,
  peerAddress,
  ownInboxId,
  onReactionToggle,
}: MessageReactionsProps) {
  const allReactions = useAtomValue(reactionsAtom);
  const reactions = allReactions.get(messageId) ?? [];
  const [reactionMenu, setReactionMenu] = useState<{
    emoji: string;
    reactors: Array<{ inboxId: string; address?: string; isYou?: boolean }>;
    position: { x: number; y: number };
  } | null>(null);

  if (reactions.length === 0) return null;

  // Group reactions by emoji with sender info
  const grouped = reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) {
      acc[r.emoji] = [];
    }
    // Look up address from inboxId
    const isYou = r.senderInboxId === ownInboxId;
    let address: string | undefined;
    if (isYou) {
      address = undefined; // Will show "You"
    } else if (memberPreviews) {
      address = memberPreviews.find(
        (m) => m.inboxId === r.senderInboxId
      )?.address;
    } else {
      address = peerAddress;
    }
    acc[r.emoji].push({ inboxId: r.senderInboxId, address, isYou });
    return acc;
  }, {} as Record<string, Array<{ inboxId: string; address?: string; isYou?: boolean }>>);

  // Handle click to toggle own reaction
  const handleClick = async (
    e: React.MouseEvent,
    emoji: string,
    reactors: Array<{ inboxId: string; address?: string; isYou?: boolean }>
  ) => {
    e.stopPropagation();

    // Check if current user has reacted with this emoji
    const hasOwnReaction = reactors.some(r => r.isYou);

    try {
      await streamManager.sendReaction(
        conversationId,
        messageId,
        emoji,
        hasOwnReaction ? 'removed' : 'added'
      );
      // Scroll after reaction toggle (reactions can shift content)
      onReactionToggle?.();
    } catch (error) {
      console.error("Failed to toggle reaction:", error);
    }
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    emoji: string,
    reactors: Array<{ inboxId: string; address?: string; isYou?: boolean }>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setReactionMenu({
      emoji,
      reactors,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  return (
    <>
      <div
        className={`flex gap-1 -mt-2 relative z-10 ${
          isOwnMessage ? "justify-end pr-1" : "justify-start pl-1"
        }`}
      >
        {Object.entries(grouped).map(([emoji, reactors]) => {
          const hasOwnReaction = reactors.some(r => r.isYou);
          return (
            <div
              key={emoji}
              className="inline-flex items-center h-[22px] px-1.5 bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-full text-[15px] cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
              onContextMenu={(e) => handleContextMenu(e, emoji, reactors)}
              onClick={(e) => handleClick(e, emoji, reactors)}
              title={hasOwnReaction ? "Click to remove your reaction" : "Click to add this reaction"}
            >
              <span>{emoji}</span>
              {reactors.length > 1 && (
                <span className="text-[11px] font-medium ml-0.5 text-[var(--text-secondary)]">
                  {reactors.length}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {reactionMenu && (
        <ReactionDetailsMenu
          emoji={reactionMenu.emoji}
          reactors={reactionMenu.reactors}
          position={reactionMenu.position}
          onClose={() => setReactionMenu(null)}
        />
      )}
    </>
  );
}

interface MemberPreview {
  inboxId: string;
  address: string;
}

// Helper component to display sender name above messages
function SenderName({ address }: { address: string | undefined }) {
  const { displayName } = useDisplayName(address);
  const name =
    displayName ??
    (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Unknown");

  return (
    <span className="text-[13px] text-[var(--text-secondary)] mb-1 ml-1 block">{name}</span>
  );
}

// Telegram-style message sending animation - satisfying pop and slide
function AnimatedMessageWrapper({
  children,
  className = "",
  isSending = false,
}: {
  children: React.ReactNode;
  className?: string;
  isSending?: boolean;
}) {
  const [animationPhase, setAnimationPhase] = useState<'initial' | 'pop' | 'settle'>('initial');

  useEffect(() => {
    // Phase 1: Quick pop up with slight overshoot
    const popFrame = requestAnimationFrame(() => {
      setAnimationPhase('pop');
    });

    // Phase 2: Settle into final position
    const settleTimer = setTimeout(() => {
      setAnimationPhase('settle');
    }, 150);

    return () => {
      cancelAnimationFrame(popFrame);
      clearTimeout(settleTimer);
    };
  }, []);

  const getTransform = () => {
    switch (animationPhase) {
      case 'initial':
        return 'translateY(16px) scale(0.98)';
      case 'pop':
        return 'translateY(-2px) scale(1)';
      case 'settle':
        return 'translateY(0) scale(1)';
    }
  };

  return (
    <div
      className={`${className}`}
      style={{
        opacity: animationPhase === 'initial' ? 0 : 1,
        transform: getTransform(),
        transition: animationPhase === 'pop'
          ? 'all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)'
          : 'all 0.1s ease-out',
      }}
    >
      {children}
    </div>
  );
}

// Pending message bubble with send animation
interface PendingMessageBubbleProps {
  pending: PendingMessage;
  onRetry: (id: string) => void;
  isVerified?: boolean;
  isFirstInGroup?: boolean;
}

function PendingMessageBubble({
  pending,
  onRetry,
  isVerified = false,
  isFirstInGroup = true,
}: PendingMessageBubbleProps) {
  // Format current time for the timestamp
  const timeString = new Date().toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  // Darker blue for pending verified, gray for unverified
  const bubbleBg =
    pending.status === "failed"
      ? "bg-red-100"
      : isVerified
      ? "bg-[var(--bubble-pending)]"
      : "bg-[var(--bubble-unverified)]";

  // Match the radius logic from sent messages
  const senderRadius = isFirstInGroup
    ? "rounded-[18px] rounded-br-[6px]"
    : "rounded-[18px] rounded-tr-[6px] rounded-br-[6px]";

  return (
    <AnimatedMessageWrapper className={`flex flex-col items-end ${isFirstInGroup ? "mt-3" : "mt-0.5"}`}>
      <div className="max-w-[300px]">
        <div
          className={`px-3 py-2 ${senderRadius} ${bubbleBg}`}
        >
          <p
            className={`text-[16px] leading-[1.4] whitespace-pre-wrap break-words ${
              pending.status === "failed" ? "text-red-800" : "text-white"
            }`}
          >
            {pending.content}
          </p>
        </div>
      </div>
      {/* Always show timestamp row - matches sent message layout exactly */}
      <div className="flex justify-end items-center gap-1.5 mt-1 pr-1">
        <span className="text-[11px] text-[var(--text-quaternary)] font-medium">
          {timeString}
        </span>
        {pending.status === "sending" && (
          <Clock className="w-3 h-3 text-[var(--text-quaternary)]" />
        )}
        {pending.status === "failed" && (
          <>
            <AlertCircle className="w-3 h-3 text-red-500" />
            <button
              onClick={() => onRetry(pending.id)}
              className="text-[11px] text-[var(--accent-blue)] hover:underline flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          </>
        )}
      </div>
    </AnimatedMessageWrapper>
  );
}

// Display item types for rendering
type DisplayItem =
  | { type: "date-separator"; date: string; id: string }
  | {
      type: "message";
      id: string;
      isFirstInGroup: boolean;
      isLastInGroup: boolean;
      showAvatar: boolean;
    }
  | { type: "pending"; id: string }
  | {
      type: "membership-change-group";
      id: string;
      changes: Array<{ type: 'added' | 'removed'; inboxIds: string[] }>;
    };

interface MessagePanelProps {
  conversationId: string;
  conversationType: "dm" | "group";
  peerAddress?: string;
  peerInboxId?: string;
  name?: string;
  avatarUrl?: string | null;
  isVerified?: boolean;
  subtitle?: string;
  groupName?: string;
  memberCount?: number;
  verifiedCount?: number;
  unverifiedCount?: number;
  memberPreviews?: MemberPreview[];
  isMessageRequest?: boolean;
  hasDisappearingMessages?: boolean;
  onOpenGroupDetails?: () => void;
  onMemberAvatarClick?: (address: string, inboxId: string) => void;
  onOpenPeerProfile?: () => void;
  onBack?: () => void;
}

export function MessagePanel({
  conversationId,
  conversationType,
  peerAddress,
  peerInboxId,
  name: nameOverride,
  avatarUrl,
  isVerified = false,
  subtitle,
  groupName,
  memberCount,
  verifiedCount,
  unverifiedCount,
  memberPreviews,
  isMessageRequest = false,
  hasDisappearingMessages = false,
  onOpenGroupDetails,
  onMemberAvatarClick,
  onOpenPeerProfile,
  onBack,
}: MessagePanelProps) {
  const [message, setMessage] = useAtom(messageInputDraftAtom(conversationId));
  const [isSending, setIsSending] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HighlightedInputRef>(null);
  const languageSelectorRef = useRef<HTMLDivElement>(null);

  // Reaction picker state
  const [reactionPicker, setReactionPicker] = useState<{
    messageId: string;
    position: { x: number; y: number };
  } | null>(null);

  // Context menu state (for Reply/Copy)
  const [contextMenu, setContextMenu] = useState<{
    messageId: string;
    content: string;
    senderAddress: string;
    position: { x: number; y: number };
  } | null>(null);

  // Ticker chart modal state
  const [tickerModal, setTickerModal] = useState<{
    symbol: string;
    type: TickerType;
    data: TickerPriceData;
  } | null>(null);
  const [tickerModalLoading, setTickerModalLoading] = useState(false);

  // Handler to open ticker modal (passed to MessageText)
  const handleTickerClick = useCallback((symbol: string, type: TickerType, data: TickerPriceData) => {
    setTickerModal({ symbol, type, data });
  }, []);

  // Handler to refresh ticker data in modal
  const handleTickerRefresh = useCallback(async () => {
    if (!tickerModal) return;
    setTickerModalLoading(true);
    try {
      const response = await fetch(`/api/ticker-price?symbol=${encodeURIComponent(tickerModal.symbol)}&type=${tickerModal.type}`);
      if (response.ok) {
        const data = await response.json();
        setTickerModal({ symbol: tickerModal.symbol, type: tickerModal.type, data });
        // Also update the client cache so inline preview updates
        updateTickerCache(tickerModal.symbol, tickerModal.type, data);
      }
    } catch (e) {
      console.error('Failed to refresh ticker:', e);
    } finally {
      setTickerModalLoading(false);
    }
  }, [tickerModal]);

  // Handler to scroll to bottom when dynamic content loads (e.g., ticker preview)
  const handleContentLoad = useCallback(() => {
    if (parentRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
      // Only auto-scroll if we're already near the bottom (within 150px)
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
      if (isNearBottom) {
        parentRef.current.scrollTop = scrollHeight;
      }
    }
  }, []);

  // Scroll to bottom callback for reactions (reactions can shift content)
  const handleScrollToBottom = useCallback(() => {
    // Use double RAF to ensure layout is complete after content changes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (parentRef.current) {
          parentRef.current.scrollTop = parentRef.current.scrollHeight;
        }
      });
    });
  }, []);

  // Handler for @mention clicks - opens the user's profile
  const handleMentionClick = useCallback(async (username: string) => {
    if (!onMemberAvatarClick) return;

    try {
      // Remove @ prefix if present
      const cleanUsername = username.startsWith('@') ? username.slice(1) : username;

      // Resolve username to get address
      const record = await resolveUsername(cleanUsername);
      if (!record?.address) return;

      const address = record.address.toLowerCase();

      // For DMs, check if it's the peer
      if (conversationType === 'dm' && peerAddress?.toLowerCase() === address && peerInboxId) {
        onMemberAvatarClick(address, peerInboxId);
        return;
      }

      // For groups, find the member in memberPreviews
      if (memberPreviews) {
        const member = memberPreviews.find(m => m.address.toLowerCase() === address);
        if (member) {
          onMemberAvatarClick(member.address, member.inboxId);
        }
      }
    } catch (error) {
      console.error('Failed to handle mention click:', error);
    }
  }, [onMemberAvatarClick, conversationType, peerAddress, peerInboxId, memberPreviews]);

  // Reply state
  const [replyingTo, setReplyingTo] = useAtom(replyingToAtom);

  // Clear reply state when switching conversations
  useEffect(() => {
    setReplyingTo(null);
  }, [conversationId, setReplyingTo]);

  // Group leave state (used by parent via callback)
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);

  // Dark mode detection for chat background
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Initialize with actual value if available (client-side)
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();

    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const { displayName } = useDisplayName(
    conversationType === "dm" ? peerAddress : null
  );
  const name =
    conversationType === "group"
      ? groupName || "Group Chat"
      : nameOverride ?? displayName;

  // Build group subtitle with verified/unverified counts
  const groupSubtitle:
    | { verified: number; unverified: number }
    | { total: number }
    | undefined =
    conversationType === "group"
      ? verifiedCount !== undefined && unverifiedCount !== undefined
        ? { verified: verifiedCount, unverified: unverifiedCount }
        : memberCount
        ? { total: memberCount }
        : undefined
      : undefined;

  const client = useAtomValue(xmtpClientAtom);
  const _readReceiptVersion = useAtomValue(readReceiptVersionAtom);
  const linkPreviewEnabled = useAtomValue(linkPreviewEnabledAtom);
  const chatBgStyle = useAtomValue(chatBackgroundStyleAtom);

  const {
    messageIds,
    pendingMessages,
    isLoading,
    isInitialLoading,
    hasMore,
    isSyncing,
    error: conversationError,
    loadMore,
    sendMessage,
    retryMessage,
    getMessage,
    retryConversation,
  } = useMessages(conversationId);

  const ownInboxId = client?.inboxId ?? "";
  const lastDisplayPerfLogAtRef = useRef(0);
  const lastMainThreadStallLogAtRef = useRef(0);
  const fallbackDecodeLogKeysRef = useRef<Set<string>>(new Set());
  const textDecoderRef = useRef<TextDecoder | null>(null);
  const perfSnapshotRef = useRef({
    messageCount: 0,
    displayItemCount: 0,
    pendingCount: 0,
    isLoading: false,
    isInitialLoading: false,
    isSyncing: false,
  });

  const getTextDecoder = useCallback((): TextDecoder => {
    if (!textDecoderRef.current) {
      textDecoderRef.current = new TextDecoder();
    }
    return textDecoderRef.current;
  }, []);

  const decodeFallbackContent = useCallback((
    msg: DecodedMessage,
    typeId: string | undefined,
    decodeContext: string,
  ): unknown => {
    const encodedContent = (
      msg as { encodedContent?: { content?: Uint8Array } }
    ).encodedContent;
    const rawBytes = encodedContent?.content;
    if (!rawBytes) return undefined;

    const byteLength = rawBytes.byteLength;
    if (byteLength >= LARGE_FALLBACK_DECODE_WARN_BYTES) {
      const warnKey = `${decodeContext}:${msg.id}`;
      if (!fallbackDecodeLogKeysRef.current.has(warnKey)) {
        fallbackDecodeLogKeysRef.current.add(warnKey);
        console.warn("[MessagePanel] Large fallback decode payload", {
          conversationId,
          messageId: msg.id,
          typeId: typeId ?? "unknown",
          decodeContext,
          bytes: byteLength,
        });
      }
    }

    if (byteLength >= LARGE_FALLBACK_DECODE_SKIP_BYTES) {
      return undefined;
    }

    try {
      const decoded = getTextDecoder().decode(rawBytes);
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    } catch {
      return undefined;
    }
  }, [conversationId, getTextDecoder]);

  useEffect(() => {
    fallbackDecodeLogKeysRef.current.clear();
  }, [conversationId]);

  // Translation state
  const { translate, isInitialized: translationEnabled, isAutoTranslateEnabled, setAutoTranslate, getCachedTranslation, cacheTranslation, getCachedOriginal, cacheOriginal } = useTranslation();
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());

  // Auto-translate state for this conversation
  const [autoTranslate, setAutoTranslateState] = useState(false);

  // Outgoing message translation state
  const [outgoingTranslateTo, setOutgoingTranslateToState] = useState<string | null>(null);
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [translationPreview, setTranslationPreview] = useState<{
    original: string;
    translated: string;
    targetLang: string;
  } | null>(null);
  const [isTranslatingOutgoing, setIsTranslatingOutgoing] = useState(false);

  // Wrapper to persist outgoing translation language
  const setOutgoingTranslateTo = useCallback((lang: string | null) => {
    setOutgoingTranslateToState(lang);
    try {
      const key = `outgoing-translate-${conversationId}`;
      if (lang) {
        localStorage.setItem(key, lang);
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage errors
    }
  }, [conversationId]);

  // Load auto-translate preference and outgoing language on conversation change
  useEffect(() => {
    if (conversationId && translationEnabled) {
      setAutoTranslateState(isAutoTranslateEnabled(conversationId));
      // Restore outgoing translation language
      try {
        const savedLang = localStorage.getItem(`outgoing-translate-${conversationId}`);
        setOutgoingTranslateToState(savedLang);
      } catch {
        setOutgoingTranslateToState(null);
      }
    } else {
      setOutgoingTranslateToState(null);
    }
    // Reset auto-translated tracking when conversation changes
    autoTranslatedRef.current = new Set();
  }, [conversationId, translationEnabled, isAutoTranslateEnabled]);

  // Close language selector when clicking outside
  useEffect(() => {
    if (!showLanguageSelector) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (languageSelectorRef.current && !languageSelectorRef.current.contains(e.target as Node)) {
        setShowLanguageSelector(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showLanguageSelector]);

  // Restore cached translations when conversation changes (skip for disappearing message conversations)
  useEffect(() => {
    if (!conversationId || !translationEnabled || hasDisappearingMessages) {
      // Clear translations when switching conversations or if disappearing messages
      setTranslations({});
      return;
    }

    // Restore cached translations
    const restoredTranslations: Record<string, string> = {};
    for (const msgId of messageIds) {
      const cached = getCachedTranslation(conversationId, msgId);
      if (cached) {
        restoredTranslations[msgId] = cached;
      }
    }
    if (Object.keys(restoredTranslations).length > 0) {
      setTranslations(prev => ({ ...prev, ...restoredTranslations }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, translationEnabled, hasDisappearingMessages, getCachedTranslation]);

  // Toggle auto-translate for this conversation
  const handleAutoTranslateToggle = useCallback(() => {
    if (!conversationId) return;
    const newValue = !autoTranslate;
    setAutoTranslateState(newValue);
    setAutoTranslate(conversationId, newValue);
  }, [conversationId, autoTranslate, setAutoTranslate]);

  // Track which messages we've already auto-translated
  const autoTranslatedRef = useRef<Set<string>>(new Set());

  // Auto-translate incoming messages when enabled
  useEffect(() => {
    if (!autoTranslate || !translationEnabled || !messageIds.length) return;

    const translateNewMessages = async () => {
      // Process recent messages (last 10) to avoid overwhelming
      const recentIds = messageIds.slice(0, 10);

      for (const msgId of recentIds) {
        const msg = getMessage(msgId);
        if (!msg) continue;

        // Skip own messages
        if (msg.senderInboxId === ownInboxId) continue;
        // Skip already translated
        if (translations[msgId] || autoTranslatedRef.current.has(msgId)) continue;
        // Skip if already translating
        if (translatingIds.has(msgId)) continue;

        // Get text content
        const content = msg.content;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (content && typeof content === "object" && "text" in content) {
          text = (content as { text: string }).text;
        } else if (content && typeof content === "object" && "content" in content) {
          const nested = (content as { content: unknown }).content;
          if (typeof nested === "string") text = nested;
          else if (nested && typeof nested === "object" && "text" in nested) {
            text = (nested as { text: string }).text;
          }
        }

        // Skip empty or very short messages
        if (!text || text.length < 3) continue;

        // Mark as being processed
        autoTranslatedRef.current.add(msgId);
        setTranslatingIds(prev => new Set(prev).add(msgId));

        try {
          // Use "auto" to auto-detect source language
          const result = await translate(text, "auto", "en");
          const trimmedText = result?.translatedText?.trim();
          // Skip if translation was skipped (same language) or unchanged
          if (trimmedText && trimmedText !== text && !result?.skipped) {
            setTranslations(prev => ({
              ...prev,
              [msgId]: trimmedText,
            }));
            // Cache translation (skip for disappearing message conversations)
            cacheTranslation(conversationId, msgId, trimmedText, hasDisappearingMessages);
          }
        } catch {
          // Ignore translation errors for auto-translate
        } finally {
          setTranslatingIds(prev => {
            const next = new Set(prev);
            next.delete(msgId);
            return next;
          });
        }
      }
    };

    translateNewMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, translationEnabled, messageIds.join(","), ownInboxId, translate, conversationId, hasDisappearingMessages, cacheTranslation]);

  // Handle translate button click
  const handleTranslateClick = useCallback(async (messageId: string, text: string) => {
    // If already translated, toggle off
    if (translations[messageId]) {
      setTranslations(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      return;
    }

    // Start translating
    setTranslatingIds(prev => new Set(prev).add(messageId));

    try {
      // Use "auto" to auto-detect source language, translate to English
      const result = await translate(text, "auto", "en");
      const trimmedText = result?.translatedText?.trim();
      // Show translation if we have text and it wasn't skipped (same language)
      if (trimmedText && !result?.skipped) {
        setTranslations(prev => ({
          ...prev,
          [messageId]: trimmedText,
        }));
        // Cache translation (skip for disappearing message conversations)
        cacheTranslation(conversationId, messageId, trimmedText, hasDisappearingMessages);
      }
    } catch (error) {
      console.error("[Translation] Failed to translate:", error);
    } finally {
      setTranslatingIds(prev => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  }, [translate, translations, conversationId, hasDisappearingMessages, cacheTranslation]);

  // Check if message should be displayed
  const shouldDisplayMessage = useCallback((msg: DecodedMessage): boolean => {
    const contentType = msg.contentType as { typeId?: string; authorityId?: string } | undefined;
    const typeId = contentType?.typeId;
    if (typeId === "readReceipt") return false;
    if (isRemoveMessageControlType({ contentType })) return false;
    // Transaction references are displayed as payment cards
    if (typeId === "transactionReference") return true;
    // Payment requests and fulfillments are displayed as cards
    if (typeId === "paymentRequest" || typeId === "paymentFulfillment") return true;
    // Remote attachments (images) are displayed as image cards - single or multi
    // Handle both old and new naming conventions
    if (
      typeId === "remoteAttachment" ||
      typeId === "remoteStaticAttachment" ||
      typeId === "multiRemoteAttachment" ||
      typeId === "multiRemoteStaticAttachment"
    )
      return true;
    return true;
  }, []);

  // Extract message text content
  const getMessageText = useCallback((msg: DecodedMessage): string | null => {
    const contentType = msg.contentType as { typeId?: string; authorityId?: string } | undefined;
    const typeId = contentType?.typeId;
    if (typeId === "readReceipt") return null;
    if (isRemoveMessageControlType({ contentType })) return null;
    // Transaction references render as payment cards, not text
    if (typeId === "transactionReference") return null;
    // Payment requests and fulfillments render as cards, not text
    if (typeId === "paymentRequest" || typeId === "paymentFulfillment") return null;
    // Remote attachments render as image cards, not text (handle both old and new naming)
    if (
      typeId === "remoteAttachment" ||
      typeId === "remoteStaticAttachment" ||
      typeId === "multiRemoteAttachment" ||
      typeId === "multiRemoteStaticAttachment"
    )
      return null;
    // Also check content shape for remote attachments (single or multi)
    if (isSingleAttachment(msg.content) || isMultiAttachment(msg.content))
      return null;
    if (typeId === "reaction") {
      const content = msg.content as { content?: string } | undefined;
      return content?.content ? `Reacted ${content.content}` : null;
    }

    let content = msg.content;

    // If content is undefined, try to decode from encodedContent
    if ((content === undefined || content === null) && shouldAttemptFallbackDecode(typeId)) {
      const decodedFallback = decodeFallbackContent(
        msg,
        typeId,
        "getMessageText",
      );
      if (decodedFallback !== undefined) {
        content = decodedFallback;
      }
    }

    // Check for raw image attachment data (undecoded) - don't display as text
    if (typeof content === "string") {
      // If it looks like raw remote attachment data (contains CDN URL), don't display
      if (content.includes("chat-assets.toolsforhumanity.com")) {
        return null;
      }
      return content;
    }
    if (content && typeof content === "object") {
      if (
        "text" in content &&
        typeof (content as { text?: unknown }).text === "string"
      ) {
        return (content as { text: string }).text;
      }
      if ("content" in content) {
        const nested = (content as { content: unknown }).content;
        if (typeof nested === "string") return nested;
        if (nested && typeof nested === "object" && "text" in nested) {
          return (nested as { text: string }).text;
        }
      }
    }

    // Fallback: try to get fallback text from the message
    const fallback = (msg as { fallback?: string }).fallback;
    if (fallback && typeof fallback === "string") {
      return fallback;
    }

    return null;
  }, [decodeFallbackContent]);

  // Format date for separator following: Today → Yesterday → Day of week → Calendar date
  const formatDateSeparator = useCallback((ns: bigint): string => {
    const date = new Date(Number(ns / BigInt(1_000_000)));
    const now = new Date();

    // Reset time parts for accurate day comparison
    const dateOnly = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffDays = Math.floor(
      (nowOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";

    // Within the last week, show day of week
    if (diffDays < 7) {
      return date.toLocaleDateString(undefined, { weekday: "long" });
    }

    // Older than a week, show full date
    return date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  // Get date key for grouping
  const getDateKey = useCallback((ns: bigint): string => {
    const date = new Date(Number(ns / BigInt(1_000_000)));
    return date.toDateString();
  }, []);

  // Build grouped display items with date separators
  // Note: We build a simplified structure here and compute details at render time
  // to avoid getMessage instability in dependencies
  const displayItems = useMemo((): DisplayItem[] => {
    const buildStartMs = performance.now();
    const items: DisplayItem[] = [];
    const contentTypeCounts: Record<string, number> = {};
    let fallbackDecodeAttempts = 0;
    let fallbackDecodeSuccesses = 0;

    // First, collect valid message data
    const reversedIds = [...messageIds].reverse();
    const messageData: Array<{
      id: string;
      senderId: string;
      dateKey: string;
      sentAtNs: bigint;
      isMembershipChange?: boolean;
      membershipContent?: MembershipChangeContent;
    }> = [];

    for (const id of reversedIds) {
      const msg = getMessage(id);
      if (!msg) continue;

      const contentType = msg.contentType as { typeId?: string; authorityId?: string } | undefined;
      const typeId = contentType?.typeId;
      const typeKey = (typeId ?? "unknown").toLowerCase();
      contentTypeCounts[typeKey] = (contentTypeCounts[typeKey] ?? 0) + 1;

      if (typeId === "readReceipt") continue;
      if (isRemoveMessageControlType({ contentType })) continue;

      // Check if has displayable content
      let content = msg.content;

      // If content is undefined, try to decode from encodedContent
      if ((content === undefined || content === null) && shouldAttemptFallbackDecode(typeId)) {
        fallbackDecodeAttempts++;
        const decodedFallback = decodeFallbackContent(
          msg,
          typeId,
          "displayItems",
        );
        if (decodedFallback !== undefined) {
          content = decodedFallback;
          fallbackDecodeSuccesses++;
        }
      }

      let hasDisplayableContent = false;

      // String content (basic text messages)
      if (typeof content === "string" && content.length > 0) {
        hasDisplayableContent = true;
      } else if (content && typeof content === "object") {
        // Text content in object form
        if ("text" in content) hasDisplayableContent = true;
        // Reply content (nested)
        else if ("content" in content) hasDisplayableContent = true;
        // Transaction references - our format
        else if ("txHash" in content) hasDisplayableContent = true;
        // Transaction references - XMTP format (World App)
        else if ("reference" in content) hasDisplayableContent = true;
        // Remote attachments (images) - single or multi
        else if (isSingleAttachment(content) || isMultiAttachment(content))
          hasDisplayableContent = true;
      }

      // Always show reactions, transaction references, payments, and images by typeId
      if (typeId === "reaction") hasDisplayableContent = true;
      if (typeId === "transactionReference") hasDisplayableContent = true;
      if (typeId === "paymentRequest" || typeId === "paymentFulfillment") hasDisplayableContent = true;
      // Handle both old and new attachment type naming
      if (
        typeId === "remoteAttachment" ||
        typeId === "remoteStaticAttachment" ||
        typeId === "multiRemoteAttachment" ||
        typeId === "multiRemoteStaticAttachment"
      )
        hasDisplayableContent = true;
      // Membership change messages (group updates)
      if (typeId === "group_updated") hasDisplayableContent = true;

      if (!hasDisplayableContent) continue;

      const date = new Date(Number(msg.sentAtNs / BigInt(1_000_000)));
      const isMembershipChange = typeId === "group_updated" || isMembershipChangeMessage(msg as { kind?: unknown; contentType?: { typeId?: string } });

      messageData.push({
        id,
        senderId: msg.senderInboxId,
        dateKey: date.toDateString(),
        sentAtNs: msg.sentAtNs,
        isMembershipChange,
        membershipContent: isMembershipChange ? content as MembershipChangeContent : undefined,
      });
    }

    // Build display items with grouping
    const fiveMinutesNs = BigInt(5 * 60) * BigInt(1_000_000_000);
    const oneMinuteNs = BigInt(60) * BigInt(1_000_000_000);

    // Group consecutive membership changes within 1 minute
    let i = 0;
    while (i < messageData.length) {
      const curr = messageData[i];
      const prev = i > 0 ? messageData[i - 1] : null;

      // Add date separator if date changed
      if (!prev || prev.dateKey !== curr.dateKey) {
        items.push({
          type: "date-separator",
          date: formatDateSeparator(curr.sentAtNs),
          id: `date-${curr.dateKey}-${i}`,
        });
      }

      // Check if this is a membership change that can be grouped
      if (curr.isMembershipChange && curr.membershipContent) {
        const content = curr.membershipContent;

        // Check if this is a metadata-only change (like disappearing messages)
        const hasMetadataChanges = content.metadataFieldChanges && content.metadataFieldChanges.length > 0;
        const hasMemberChanges = (content.addedInboxes && content.addedInboxes.length > 0) ||
                                  (content.removedInboxes && content.removedInboxes.length > 0);

        // Handle metadata-only changes as individual items (don't group them)
        if (hasMetadataChanges && !hasMemberChanges) {
          items.push({
            type: "message",
            id: curr.id,
            isFirstInGroup: true,
            isLastInGroup: true,
            showAvatar: false,
          });
          i++;
          continue;
        }

        // Collect consecutive membership changes within 1 minute
        const groupedChanges: Array<{ type: 'added' | 'removed'; inboxIds: string[] }> = [];
        const groupedIds: string[] = [];
        let j = i;

        while (j < messageData.length) {
          const msg = messageData[j];

          // Stop if not a membership change
          if (!msg.isMembershipChange || !msg.membershipContent) break;

          // Stop if time gap > 1 minute (except for first message)
          if (j > i && msg.sentAtNs - messageData[j - 1].sentAtNs > oneMinuteNs) break;

          // Stop if date changed
          if (msg.dateKey !== curr.dateKey) break;

          // Add this message's changes to the group (skip metadata-only changes)
          const msgContent = msg.membershipContent;
          const msgHasMemberChanges = (msgContent.addedInboxes && msgContent.addedInboxes.length > 0) ||
                                       (msgContent.removedInboxes && msgContent.removedInboxes.length > 0);

          if (!msgHasMemberChanges) {
            // Metadata-only change - stop grouping here
            break;
          }

          if (msgContent.addedInboxes?.length) {
            groupedChanges.push({
              type: 'added',
              inboxIds: msgContent.addedInboxes.map(m => m.inboxId),
            });
          }
          if (msgContent.removedInboxes?.length) {
            groupedChanges.push({
              type: 'removed',
              inboxIds: msgContent.removedInboxes.map(m => m.inboxId),
            });
          }
          groupedIds.push(msg.id);
          j++;
        }

        // If we grouped multiple changes, output a single grouped item
        if (groupedChanges.length > 0) {
          items.push({
            type: "membership-change-group",
            id: `membership-group-${groupedIds.join('-')}`,
            changes: groupedChanges,
          });
        } else {
          // Defensive: if no groupable membership changes were found, force progress.
          // Some malformed/empty membership events can otherwise cause an infinite loop.
          console.warn("[MessagePanel] Non-groupable membership change encountered", {
            conversationId,
            messageId: curr.id,
          });
          items.push({
            type: "message",
            id: curr.id,
            isFirstInGroup: true,
            isLastInGroup: true,
            showAvatar: false,
          });
          i++;
          continue;
        }

        i = j; // Skip past all grouped messages
        continue;
      }

      // Regular message handling
      const next = i < messageData.length - 1 ? messageData[i + 1] : null;

      // Determine if first/last in group
      const isFirstInGroup =
        !prev ||
        prev.senderId !== curr.senderId ||
        prev.dateKey !== curr.dateKey ||
        curr.sentAtNs - prev.sentAtNs > fiveMinutesNs ||
        (prev.isMembershipChange ?? false); // Break group after membership changes

      const isLastInGroup =
        !next ||
        next.senderId !== curr.senderId ||
        next.dateKey !== curr.dateKey ||
        next.sentAtNs - curr.sentAtNs > fiveMinutesNs ||
        (next.isMembershipChange ?? false); // Break group before membership changes

      const isOwnMessage = curr.senderId === ownInboxId;

      items.push({
        type: "message",
        id: curr.id,
        isFirstInGroup,
        isLastInGroup,
        showAvatar: isFirstInGroup && !isOwnMessage,
      });

      i++;
    }

    // Add pending messages at the end, but skip if a matching real message exists
    // This prevents the "jump" when both pending and real message briefly coexist
    for (const pending of pendingMessages) {
      // Check if any recent message matches this pending content
      const recentMessageIds = messageIds.slice(0, 5); // Check first 5 (newest)
      const matchingRealMessage = recentMessageIds.some((msgId) => {
        const msg = getMessage(msgId);
        if (!msg) return false;
        // Check if content matches and it's an own message
        const msgContent = typeof msg.content === "string" ? msg.content : "";
        return (
          msgContent === pending.content && msg.senderInboxId === ownInboxId
        );
      });

      if (!matchingRealMessage) {
        items.push({ type: "pending", id: pending.id });
      }
    }

    const buildDurationMs = performance.now() - buildStartMs;
    const shouldLogSlowBuild =
      buildDurationMs >= SLOW_DISPLAY_BUILD_WARN_MS ||
      messageIds.length >= SLOW_DISPLAY_MESSAGE_COUNT;

    if (shouldLogSlowBuild) {
      const now = Date.now();
      if (now - lastDisplayPerfLogAtRef.current >= PERF_LOG_COOLDOWN_MS) {
        console.warn("[MessagePanel] displayItems build performance", {
          conversationId,
          durationMs: Number(buildDurationMs.toFixed(1)),
          messageCount: messageIds.length,
          pendingCount: pendingMessages.length,
          displayItemCount: items.length,
          fallbackDecodeAttempts,
          fallbackDecodeSuccesses,
          topContentTypes: summarizeTopContentTypes(contentTypeCounts),
        });
        lastDisplayPerfLogAtRef.current = now;
      }
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, decodeFallbackContent, messageIds.join(","), pendingMessages.length, ownInboxId]);

  useEffect(() => {
    perfSnapshotRef.current = {
      messageCount: messageIds.length,
      displayItemCount: displayItems.length,
      pendingCount: pendingMessages.length,
      isLoading,
      isInitialLoading,
      isSyncing,
    };
  }, [displayItems.length, isInitialLoading, isLoading, isSyncing, messageIds.length, pendingMessages.length]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let expected = performance.now() + MAIN_THREAD_STALL_CHECK_INTERVAL_MS;

    const checkMainThreadLag = () => {
      const now = performance.now();
      const lagMs = now - expected;

      if (lagMs >= MAIN_THREAD_STALL_WARN_MS) {
        const nowTs = Date.now();
        if (nowTs - lastMainThreadStallLogAtRef.current >= PERF_LOG_COOLDOWN_MS) {
          const snapshot = perfSnapshotRef.current;
          console.warn("[MessagePanel] Main thread stall detected", {
            conversationId,
            lagMs: Number(lagMs.toFixed(1)),
            messageCount: snapshot.messageCount,
            displayItemCount: snapshot.displayItemCount,
            pendingCount: snapshot.pendingCount,
            isLoading: snapshot.isLoading,
            isInitialLoading: snapshot.isInitialLoading,
            isSyncing: snapshot.isSyncing,
          });
          lastMainThreadStallLogAtRef.current = nowTs;
        }
      }

      expected = performance.now() + MAIN_THREAD_STALL_CHECK_INTERVAL_MS;
      timer = setTimeout(checkMainThreadLag, MAIN_THREAD_STALL_CHECK_INTERVAL_MS);
    };

    timer = setTimeout(checkMainThreadLag, MAIN_THREAD_STALL_CHECK_INTERVAL_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [conversationId]);

  // Track if user is near bottom (for smart scroll behavior)
  const isNearBottomRef = useRef(true);
  const updateNearBottom = useCallback(() => {
    if (parentRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 150;
    }
  }, []);

  // Scroll to bottom on new messages (only if already near bottom)
  const prevDisplayCountRef = useRef(0);
  useLayoutEffect(() => {
    if (parentRef.current && displayItems.length > 0) {
      // Only auto-scroll if user was near bottom, or this is initial load
      if (isNearBottomRef.current || prevDisplayCountRef.current === 0) {
        // Use double RAF to ensure DOM has fully rendered and layout is calculated
        // This fixes the issue where timestamp gets cut off when sending messages
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (parentRef.current) {
              parentRef.current.scrollTop = parentRef.current.scrollHeight;
            }
          });
        });
      }
    }
    prevDisplayCountRef.current = displayItems.length;
  }, [displayItems.length]);

  // Scroll to bottom when translations change (messages get taller)
  const translationCount = Object.keys(translations).length;
  const prevTranslationCountRef = useRef(0);
  useLayoutEffect(() => {
    // Only run when translations are added (not removed or initial)
    if (translationCount <= prevTranslationCountRef.current) {
      prevTranslationCountRef.current = translationCount;
      return;
    }
    prevTranslationCountRef.current = translationCount;

    if (parentRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
      // Only auto-scroll if already near the bottom (within 200px to account for translation height)
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
      if (isNearBottom) {
        // Use requestAnimationFrame to wait for DOM to update with new translation
        requestAnimationFrame(() => {
          if (parentRef.current) {
            parentRef.current.scrollTop = parentRef.current.scrollHeight;
          }
        });
      }
    }
  }, [translationCount]);

  // Mark conversation as read - only run once when messages first load
  // Track which conversation was marked to handle conversation switches correctly
  const markedConversationRef = useRef<string | null>(null);
  const hasMessages = messageIds.length > 0;

  useEffect(() => {
    // Only mark if we have a conversation with messages, and haven't already marked THIS conversation
    if (!conversationId || !hasMessages) return;
    if (markedConversationRef.current === conversationId) return;

    // Mark this conversation as read
    markedConversationRef.current = conversationId;

    // Use queueMicrotask to batch with other updates and avoid mid-render state changes
    queueMicrotask(() => {
      streamManager.markConversationAsRead(conversationId);
    });

    const timer = setTimeout(() => {
      streamManager.sendReadReceipt(conversationId);
    }, 500);

    return () => clearTimeout(timer);
  }, [conversationId, hasMessages]);

  // Telegram-style: capture keyboard input and redirect to textarea
  // No visible focus indicator, but typing works immediately
  useEffect(() => {
    if (!conversationId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if already focused on an input/textarea
      const activeEl = document.activeElement;
      if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA') {
        return;
      }

      // Ignore modifier keys alone, function keys, navigation keys
      if (
        e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' ||
        e.key === 'Tab' || e.key === 'Escape' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown' ||
        e.key.startsWith('F') && e.key.length > 1 // F1-F12
      ) {
        return;
      }

      // Ignore keyboard shortcuts (Cmd/Ctrl + key)
      if (e.metaKey || e.ctrlKey) {
        return;
      }

      // Focus input and let the key event flow through
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [conversationId]);

  // Load more when scrolling to top + track near-bottom state
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    const { scrollTop } = parentRef.current;
    if (scrollTop < 100 && hasMore && !isLoading) {
      loadMore();
    }
    // Update near-bottom tracking for smart scroll behavior
    updateNearBottom();
  }, [hasMore, isLoading, loadMore, updateNearBottom]);

  const handleSend = async () => {
    if (!message.trim() || isSending) return;
    const content = message.trim();
    const replyToId = replyingTo?.messageId;
    setMessage("");
    setReplyingTo(null); // Clear reply state
    setIsSending(true);
    // Always scroll to bottom when sending your own message
    isNearBottomRef.current = true;
    try {
      await sendMessage(content, replyToId);
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsSending(false);
    }
  };

  // Show translation preview before sending
  const handleShowTranslationPreview = async () => {
    if (!message.trim() || !outgoingTranslateTo || isTranslatingOutgoing) return;

    setIsTranslatingOutgoing(true);
    try {
      const result = await translate(message.trim(), "en", outgoingTranslateTo);
      const trimmedText = result?.translatedText?.trim();
      if (trimmedText) {
        setTranslationPreview({
          original: message.trim(),
          translated: trimmedText,
          targetLang: outgoingTranslateTo,
        });
      } else {
        // Translation returned empty, send original
        handleSend();
      }
    } catch (error) {
      console.error("Translation failed:", error);
      // Fall back to sending original
      handleSend();
    } finally {
      setIsTranslatingOutgoing(false);
    }
  };

  // Send the translated message
  const handleSendTranslated = async () => {
    if (!translationPreview || isSending) return;

    const content = translationPreview.translated;
    const originalText = translationPreview.original;
    const replyToId = replyingTo?.messageId;

    setMessage("");
    setTranslationPreview(null);
    setReplyingTo(null);
    setIsSending(true);
    // Always scroll to bottom when sending your own message
    isNearBottomRef.current = true;

    try {
      await sendMessage(content, replyToId);
      // Cache the original text so we can display it alongside the translation
      // Skip caching for disappearing message conversations
      cacheOriginal(conversationId, content, originalText, hasDisappearingMessages);

      // Scroll to bottom after DOM updates with the original text
      // (the message bubble is now taller with original text shown)
      if (!hasDisappearingMessages) {
        requestAnimationFrame(() => {
          if (parentRef.current) {
            parentRef.current.scrollTop = parentRef.current.scrollHeight;
          }
        });
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsSending(false);
    }
  };

  const handleRetry = async (pendingId: string) => {
    try {
      await retryMessage(pendingId);
    } catch (error) {
      console.error("Failed to retry message:", error);
    }
  };

  // Unified send handler that respects translation settings
  const handleSendWithTranslation = () => {
    // If preview is showing, send the translated message
    if (translationPreview) {
      handleSendTranslated();
      return;
    }

    // If outgoing translation is enabled, show preview first
    if (outgoingTranslateTo && message.trim()) {
      handleShowTranslationPreview();
      return;
    }

    // Normal send
    handleSend();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape or Backspace cancels translation preview
    if ((e.key === "Escape" || e.key === "Backspace") && translationPreview) {
      e.preventDefault();
      setTranslationPreview(null);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendWithTranslation();
    }
  };

  const formatTime = (ns: bigint): string => {
    const date = new Date(Number(ns / BigInt(1_000_000)));
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // Handle right-click to show context menu
  const handleMessageContextMenu = useCallback(
    (
      e: React.MouseEvent,
      messageId: string,
      content: string,
      senderAddress: string
    ) => {
      e.preventDefault();
      setContextMenu({
        messageId,
        content,
        senderAddress,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    []
  );

  // Handle reply from context menu
  const handleReply = useCallback(() => {
    if (!contextMenu) return;
    setReplyingTo({
      messageId: contextMenu.messageId,
      content: contextMenu.content,
      senderAddress: contextMenu.senderAddress,
    });
    setContextMenu(null);
    // Focus the input immediately
    inputRef.current?.focus();
    // Keep scrolling to bottom during the reply preview animation (200ms)
    const startTime = performance.now();
    const scrollDuringAnimation = () => {
      if (parentRef.current) {
        parentRef.current.scrollTop = parentRef.current.scrollHeight;
      }
      if (performance.now() - startTime < 220) {
        requestAnimationFrame(scrollDuringAnimation);
      }
    };
    requestAnimationFrame(scrollDuringAnimation);
  }, [contextMenu, setReplyingTo]);

  // Handle quick reply from hover button
  const handleQuickReply = useCallback(
    (messageId: string) => {
      const msg = messageCache.get(messageId);
      if (!msg) return;

      // Get message content and sender
      const content = getMessageText(msg) ?? "";
      const senderInboxId = msg.senderInboxId;

      // Find sender address from member previews or use peer address for DMs
      let senderAddress = "";
      if (conversationType === "dm") {
        // In DM, sender is either us or the peer
        senderAddress = senderInboxId === client?.inboxId ? "" : (peerAddress ?? "");
      } else {
        // In group, find the member
        const member = memberPreviews?.find((m) => m.inboxId === senderInboxId);
        senderAddress = member?.address ?? "";
      }

      setReplyingTo({
        messageId,
        content,
        senderAddress,
      });
      // Focus the input immediately
      inputRef.current?.focus();
      // Keep scrolling to bottom during the reply preview animation (200ms)
      const startTime = performance.now();
      const scrollDuringAnimation = () => {
        if (parentRef.current) {
          parentRef.current.scrollTop = parentRef.current.scrollHeight;
        }
        if (performance.now() - startTime < 220) {
          requestAnimationFrame(scrollDuringAnimation);
        }
      };
      requestAnimationFrame(scrollDuringAnimation);
    },
    [conversationType, peerAddress, memberPreviews, client?.inboxId, setReplyingTo, getMessageText]
  );

  // Handle copy from context menu
  const handleCopy = useCallback(() => {
    if (!contextMenu) return;
    navigator.clipboard.writeText(contextMenu.content);
    setContextMenu(null);
  }, [contextMenu]);

  // Handle reaction button click (from MessageWrapper hover button)
  const handleReactionButtonClick = useCallback(
    (messageId: string, position: { x: number; y: number }) => {
      setReactionPicker({ messageId, position });
    },
    []
  );

  // Handle reaction selection (toggle - add if not present, remove if already reacted)
  const handleReactionSelect = useCallback(
    async (emoji: string) => {
      if (!reactionPicker || !client?.inboxId) return;
      try {
        // Check if user already has this reaction
        const existingReactions = streamManager.getReactions(reactionPicker.messageId);
        const hasReaction = existingReactions.some(
          r => r.emoji === emoji && r.senderInboxId === client.inboxId
        );

        // Toggle: remove if exists, add if not
        await streamManager.sendReaction(
          conversationId,
          reactionPicker.messageId,
          emoji,
          hasReaction ? 'removed' : 'added'
        );

        // Scroll to bottom after reaction is added (reactions can shift content)
        // Use double RAF to ensure layout is complete
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (parentRef.current) {
              parentRef.current.scrollTop = parentRef.current.scrollHeight;
            }
          });
        });
      } catch (error) {
        console.error("Failed to send reaction:", error);
      }
      setReactionPicker(null);
    },
    [conversationId, reactionPicker, client?.inboxId]
  );

  // Handle leave group
  const handleLeaveGroup = useCallback(async () => {
    if (
      !client ||
      !client.inboxId ||
      conversationType !== "group" ||
      isLeavingGroup
    )
      return;

    setIsLeavingGroup(true);

    try {
      const conversation = await client.conversations.getConversationById(
        conversationId
      );
      if (conversation && "removeMembers" in conversation) {
        // Remove self from group using removeMembers with own inboxId
        const group = conversation as {
          removeMembers: (ids: string[]) => Promise<void>;
        };
        await group.removeMembers([client.inboxId]);
        // Remove from local conversation list
        streamManager.removeConversation(conversationId);
      }
    } catch (error) {
      console.error("Failed to leave group:", error);
    } finally {
      setIsLeavingGroup(false);
    }
  }, [client, conversationType, conversationId, isLeavingGroup]);

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] relative overflow-hidden">
      {/* Header - draggable for Electron window */}
      <header className="electron-drag shrink-0 h-16 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          {/* Back button - mobile only */}
          {onBack && (
            <button
              onClick={onBack}
              className="electron-no-drag md:hidden w-9 h-9 -ml-2 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors relative z-20"
              aria-label="Back to conversations"
            >
              <ChevronLeft className="w-6 h-6 text-[var(--accent-blue)]" />
            </button>
          )}
          <div
            className={`electron-no-drag relative z-20 flex items-center gap-3 ${
              (conversationType === "group" && onOpenGroupDetails) || (conversationType === "dm" && onOpenPeerProfile)
                ? "cursor-pointer hover:bg-[var(--bg-hover)] -ml-2 pl-2 -my-1 py-1 pr-3 rounded-xl transition-colors"
                : ""
            }`}
            onClick={() => {
              if (conversationType === "group") {
                onOpenGroupDetails?.();
              } else if (conversationType === "dm") {
                onOpenPeerProfile?.();
              }
            }}
          >
          {conversationType === "group" ? (
            <Avatar
              isGroup
              groupName={groupName}
              imageUrl={avatarUrl}
              memberPreviews={memberPreviews}
              size="md"
              showDisappearingIcon={hasDisappearingMessages}
            />
          ) : (
            <Avatar
              address={peerAddress}
              name={nameOverride}
              imageUrl={avatarUrl}
              size="md"
              showDisappearingIcon={hasDisappearingMessages}
            />
          )}
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[var(--text-primary)]">{name}</span>
              {isVerified && conversationType === "dm" && (
                <VerificationBadge size="sm" />
              )}
            </div>
            {subtitle && (
              <span className="text-sm text-[var(--text-quaternary)]">{subtitle}</span>
            )}
            {!subtitle && groupSubtitle && (
              <div className="flex items-center gap-1 text-sm text-[var(--text-quaternary)]">
                {"verified" in groupSubtitle ? (
                  <>
                    <VerificationBadge size="xs" />
                    <span>
                      {groupSubtitle.verified}{" "}
                      {groupSubtitle.verified === 1 ? "human" : "humans"}
                      {groupSubtitle.unverified > 0 &&
                        `, ${groupSubtitle.unverified} not verified`}
                    </span>
                  </>
                ) : (
                  <span>{groupSubtitle.total} members</span>
                )}
              </div>
            )}
          </div>
        </div>
        </div>

        {/* Right side actions */}
        <div className="electron-no-drag flex items-center gap-1">
          {/* Placeholder for future header actions */}
        </div>
      </header>

      {/* Messages Area */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto flex flex-col scrollbar-auto-hide relative bg-[var(--chat-bg)]"
        style={
          chatBgStyle === 'pattern'
            ? (isDarkMode ? chatBackgroundStylePatternDark : chatBackgroundStylePattern)
            : (isDarkMode ? chatBackgroundStyleSolidDark : chatBackgroundStyleSolid)
        }
      >
        {/* Message Request Banner - floating at top */}
        {isMessageRequest && (
          <MessageRequestBanner
            conversationId={conversationId}
            peerAddress={peerAddress}
          />
        )}
        {conversationError ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl p-4 text-center max-w-[320px]">
              <div className="text-[15px] text-[var(--text-primary)] mb-2 font-medium">
                Unable to load messages
              </div>
              <p className="text-[13px] text-[var(--text-secondary)] mb-3">
                {conversationError}
              </p>
              <button
                onClick={retryConversation}
                className="px-4 py-2 text-[14px] font-medium text-white bg-[var(--accent-blue)] rounded-lg hover:opacity-90 transition-opacity"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : isSyncing ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl p-4 text-center max-w-[320px]">
              <Loader2 className="w-8 h-8 text-[var(--accent-blue)] animate-spin mx-auto mb-3" />
              <div className="text-[15px] text-[var(--text-primary)] mb-1 font-medium">
                Syncing group...
              </div>
              <p className="text-[13px] text-[var(--text-secondary)]">
                This group needs to catch up. You can switch to other chats while it syncs.
              </p>
            </div>
          </div>
        ) : isInitialLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-[var(--accent-blue)] animate-spin" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-full">
            {/* Spacer to push messages to bottom */}
            <div className="flex-1" />

            {/* Load more indicator */}
            {isLoading && hasMore && (
              <div className="flex justify-center py-3">
                <Loader2 className="w-5 h-5 text-[var(--accent-blue)] animate-spin" />
              </div>
            )}

            {/* Messages list */}
            <div className="px-4 pb-4">
              {/* E2EE Banner for empty state (no messages yet) */}
              {displayItems.length === 0 && (
                <div className="flex items-center justify-center py-8">
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-center max-w-[286px]">
                    <div className="flex items-center justify-center gap-0.5 mb-0.5">
                      <Lock className="w-[11px] h-[11px] text-[var(--text-primary)]" />
                      <span className="text-[13px] text-[var(--text-primary)] leading-[1.3]">
                        Messages are end-to-end encrypted
                      </span>
                    </div>
                    <p className="text-[13px] text-[var(--text-primary)] leading-[1.3]">
                      and only visible within this chat.
                    </p>
                    <p className="text-[13px] text-[var(--text-primary)] leading-[1.2]">
                      Secured by XMTP.
                    </p>
                  </div>
                </div>
              )}
              {/* Find the last own message to only show status there */}
              {(() => {
                // Find the last own message ID (excluding pending)
                const lastOwnMessageId = displayItems.reduce<string | null>(
                  (acc, item) => {
                    if (item.type === "message") {
                      const msg = getMessage(item.id);
                      if (msg && msg.senderInboxId === ownInboxId) {
                        return item.id;
                      }
                    }
                    return acc;
                  },
                  null
                );

                return displayItems.map((item, index) => {
                  // Date separator - show encryption banner after first date separator
                  if (item.type === "date-separator") {
                    const isFirstDateSeparator =
                      displayItems.findIndex(
                        (i) => i.type === "date-separator"
                      ) === index;
                    return (
                      <div key={item.id}>
                        <div className="flex items-center justify-center py-4">
                          <span className="px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-secondary)] font-medium">
                            {item.date}
                          </span>
                        </div>
                        {/* E2EE Banner - shown after first date separator */}
                        {isFirstDateSeparator && (
                          <div className="flex items-center justify-center pb-4">
                            <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-center max-w-[286px]">
                              <div className="flex items-center justify-center gap-0.5 mb-0.5">
                                <Lock className="w-[11px] h-[11px] text-[var(--text-primary)]" />
                                <span className="text-[13px] text-[var(--text-primary)] leading-[1.3]">
                                  Messages are end-to-end encrypted
                                </span>
                              </div>
                              <p className="text-[13px] text-[var(--text-primary)] leading-[1.3]">
                                and only visible within this chat.
                              </p>
                              <p className="text-[13px] text-[var(--text-primary)] leading-[1.2]">
                                Secured by XMTP.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Pending message - matches layout of sent messages exactly
                  if (item.type === "pending") {
                    const pending = pendingMessages.find(
                      (p) => p.id === item.id
                    );
                    if (!pending) return null;

                    // Check if previous item was an own message to determine grouping
                    const prevItem = index > 0 ? displayItems[index - 1] : null;
                    let isPendingFirstInGroup = true;
                    if (prevItem && prevItem.type === "message") {
                      const prevMsg = getMessage(prevItem.id);
                      if (prevMsg && prevMsg.senderInboxId === ownInboxId) {
                        // Previous message was from us, so this continues the group
                        isPendingFirstInGroup = false;
                      }
                    } else if (prevItem && prevItem.type === "pending") {
                      // Previous item is also a pending message from us
                      isPendingFirstInGroup = false;
                    }

                    return (
                      <PendingMessageBubble
                        key={item.id}
                        pending={pending}
                        onRetry={handleRetry}
                        isVerified={isVerified}
                        isFirstInGroup={isPendingFirstInGroup}
                      />
                    );
                  }

                  // Grouped membership changes
                  if (item.type === "membership-change-group") {
                    return (
                      <GroupedMembershipChangeMessage
                        key={item.id}
                        changes={item.changes}
                        memberPreviews={memberPreviews}
                      />
                    );
                  }

                  // Regular message
                  const msg = getMessage(item.id);
                  if (!msg) return null;

                  // Check if this is an XMTP membership change message (fallback for ungrouped)
                  const isMemberChange = isMembershipChangeMessage(msg as { kind?: unknown; contentType?: { typeId?: string } });
                  if (isMemberChange) {
                    return (
                      <MembershipChangeMessage
                        key={item.id}
                        content={msg.content as MembershipChangeContent}
                        memberPreviews={memberPreviews}
                      />
                    );
                  }

                  const isOwnMessage = msg.senderInboxId === ownInboxId;
                  const text = getMessageText(msg);
                  const { isFirstInGroup, isLastInGroup, showAvatar } = item;

                  // Check if this is a status/system message (e.g., "X was added to the group")
                  if (text && isStatusMessage(text)) {
                    return <StatusMessage key={item.id} text={text} />;
                  }

                  // Check if this is a transaction reference (payment message)
                  const typeId = (msg.contentType as { typeId?: string })
                    ?.typeId;

                  // Try to get transaction content - may need to decode from fallback
                  let txContent = msg.content;

                  // If content is undefined but we have a transaction type, try to decode from fallback/encodedContent
                  if (typeId === "transactionReference" && !txContent) {
                    const decodedFallback = decodeFallbackContent(
                      msg,
                      typeId,
                      "render.transactionReference",
                    );
                    if (decodedFallback !== undefined) {
                      txContent = decodedFallback;
                    }
                  }

                  const isPayment =
                    typeId === "transactionReference" &&
                    isTransactionReference(txContent);

                  // For payment messages, render PaymentMessage component
                  if (isPayment) {
                    const txRef = normalizeTransactionReference(
                      txContent as TransactionReference
                    );
                    return (
                      <div
                        key={item.id}
                        className={`flex ${
                          isOwnMessage ? "justify-end" : "items-start gap-3"
                        } ${isFirstInGroup ? "mt-3" : "mt-0.5"}`}
                      >
                        {/* Avatar for incoming payment */}
                        {!isOwnMessage && (
                          <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                            {isLastInGroup && (
                              <Avatar
                                address={
                                  conversationType === "group"
                                    ? memberPreviews?.find(
                                        (m) => m.inboxId === msg.senderInboxId
                                      )?.address
                                    : peerAddress
                                }
                                size="sm"
                              />
                            )}
                          </div>
                        )}
                        <div className="flex flex-col">
                          {/* Sender name for incoming */}
                          {!isOwnMessage && isFirstInGroup && (
                            <SenderName
                              address={
                                conversationType === "group"
                                  ? memberPreviews?.find(
                                      (m) => m.inboxId === msg.senderInboxId
                                    )?.address
                                  : peerAddress
                              }
                            />
                          )}
                          <PaymentMessage
                            txRef={txRef}
                            isOwnMessage={isOwnMessage}
                            sentAtNs={msg.sentAtNs}
                          />
                          {isLastInGroup && (
                            <MessageTimestamp
                              timeString={formatTime(msg.sentAtNs)}
                              isOwnMessage={isOwnMessage}
                              hasTimer={!!msg.expiresAtNs}
                              className={`mt-1 ${isOwnMessage ? "text-right pr-1" : "ml-1"}`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  // Check for payment request/fulfillment content
                  let paymentContent = msg.content;

                  if ((typeId === "paymentRequest" || typeId === "paymentFulfillment") && !paymentContent) {
                    const decodedFallback = decodeFallbackContent(
                      msg,
                      typeId,
                      "render.payment",
                    );
                    if (decodedFallback !== undefined) {
                      paymentContent = decodedFallback;
                    }
                  }

                  // For payment request messages
                  if (typeId === "paymentRequest" && isPaymentRequest(paymentContent)) {
                    return (
                      <div
                        key={item.id}
                        className={`flex ${
                          isOwnMessage ? "justify-end" : "items-start gap-3"
                        } ${isFirstInGroup ? "mt-3" : "mt-0.5"}`}
                      >
                        {!isOwnMessage && (
                          <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                            {isLastInGroup && (
                              <Avatar
                                address={
                                  conversationType === "group"
                                    ? memberPreviews?.find(
                                        (m) => m.inboxId === msg.senderInboxId
                                      )?.address
                                    : peerAddress
                                }
                                size="sm"
                              />
                            )}
                          </div>
                        )}
                        <div className={`flex flex-col ${isOwnMessage ? "items-end" : ""}`}>
                          {!isOwnMessage && isFirstInGroup && (
                            <SenderName
                              address={
                                conversationType === "group"
                                  ? memberPreviews?.find(
                                      (m) => m.inboxId === msg.senderInboxId
                                    )?.address
                                  : peerAddress
                              }
                            />
                          )}
                          <PaymentRequestMessage
                            request={paymentContent as PaymentRequest}
                            isOwnMessage={isOwnMessage}
                          />
                        </div>
                      </div>
                    );
                  }

                  // For payment fulfillment messages
                  if (typeId === "paymentFulfillment" && isPaymentFulfillment(paymentContent)) {
                    return (
                      <div
                        key={item.id}
                        className={`flex ${
                          isOwnMessage ? "justify-end" : "items-start gap-3"
                        } ${isFirstInGroup ? "mt-3" : "mt-0.5"}`}
                      >
                        {!isOwnMessage && (
                          <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                            {isLastInGroup && (
                              <Avatar
                                address={
                                  conversationType === "group"
                                    ? memberPreviews?.find(
                                        (m) => m.inboxId === msg.senderInboxId
                                      )?.address
                                    : peerAddress
                                }
                                size="sm"
                              />
                            )}
                          </div>
                        )}
                        <div className={`flex flex-col ${isOwnMessage ? "items-end" : ""}`}>
                          {!isOwnMessage && isFirstInGroup && (
                            <SenderName
                              address={
                                conversationType === "group"
                                  ? memberPreviews?.find(
                                      (m) => m.inboxId === msg.senderInboxId
                                    )?.address
                                  : peerAddress
                              }
                            />
                          )}
                          <PaymentFulfillmentMessage
                            fulfillment={paymentContent as PaymentFulfillment}
                            isOwnMessage={isOwnMessage}
                          />
                        </div>
                      </div>
                    );
                  }

                  // For image messages, render ImageMessage or ImageGrid component
                  // Check for various attachment formats
                  let attachmentContent = msg.content;

                  // For multi-attachment types, try to extract and render the images
                  const isMultiType =
                    typeId === "multiRemoteStaticAttachment" ||
                    typeId === "multiRemoteAttachment";

                  // If content is undefined but we have a multi-attachment type, try to decode from encodedContent
                  if (isMultiType && (!attachmentContent || Object.keys(attachmentContent).length === 0)) {
                    const decodedFallback = decodeFallbackContent(
                      msg,
                      typeId,
                      "render.multiAttachment",
                    );
                    if (decodedFallback !== undefined) {
                      attachmentContent = decodedFallback;
                    }
                  }

                  const hasMultiAttachments =
                    isMultiAttachment(attachmentContent);
                  const hasMultiWrapper =
                    isMultiAttachmentWrapper(attachmentContent);
                  const hasSingleAttachment =
                    isSingleAttachment(attachmentContent);
                  const attachments = extractAttachments(attachmentContent);

                  // Check for raw/undecoded content (string with CDN URL embedded)
                  const contentStr =
                    typeof msg.content === "string" ? msg.content : "";
                  const hasRawCdnUrl = contentStr.includes(
                    "chat-assets.toolsforhumanity.com"
                  );

                  const hasAnyAttachment =
                    hasSingleAttachment ||
                    hasMultiAttachments ||
                    hasMultiWrapper;
                  // Handle single and multi attachment types
                  const isAttachmentType =
                    typeId === "remoteAttachment" ||
                    typeId === "remoteStaticAttachment";
                  // Consider it an image if: type indicates attachment OR content has attachment structure
                  const isImage =
                    (isAttachmentType || isMultiType || hasAnyAttachment) && attachmentContent;
                  const isRawImageData =
                    isAttachmentType && hasRawCdnUrl && !hasAnyAttachment;

                  // For raw undecoded image data, show a placeholder instead of gibberish
                  if (isRawImageData) {
                    return (
                      <div
                        key={item.id}
                        className={`flex ${
                          isOwnMessage ? "justify-end" : "items-start gap-3"
                        } ${isFirstInGroup ? "mt-3" : "mt-0.5"}`}
                      >
                        {!isOwnMessage && (
                          <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                            {isLastInGroup && (
                              <Avatar
                                address={
                                  conversationType === "group"
                                    ? memberPreviews?.find(
                                        (m) => m.inboxId === msg.senderInboxId
                                      )?.address
                                    : peerAddress
                                }
                                size="sm"
                              />
                            )}
                          </div>
                        )}
                        <div className="flex flex-col">
                          {!isOwnMessage && isFirstInGroup && (
                            <SenderName
                              address={
                                conversationType === "group"
                                  ? memberPreviews?.find(
                                      (m) => m.inboxId === msg.senderInboxId
                                    )?.address
                                  : peerAddress
                              }
                            />
                          )}
                          <div className="bg-[var(--bg-secondary)] border border-[rgba(0,0,0,0.1)] rounded-[16px] px-4 py-3 text-[var(--text-secondary)] text-sm">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-4 h-4" />
                              <span>Image unavailable - reload required</span>
                            </div>
                          </div>
                          {isLastInGroup && (
                            <MessageTimestamp
                              timeString={formatTime(msg.sentAtNs)}
                              isOwnMessage={isOwnMessage}
                              hasTimer={!!msg.expiresAtNs}
                              className={`mt-1 ${isOwnMessage ? "text-right pr-1" : "ml-1"}`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (isImage) {
                    return (
                      <div
                        key={item.id}
                        className={`flex ${
                          isOwnMessage ? "justify-end" : "items-start gap-3"
                        } ${isFirstInGroup ? "mt-3" : "mt-0.5"}`}
                      >
                        {/* Avatar for incoming image */}
                        {!isOwnMessage && (
                          <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                            {isLastInGroup && (
                              <Avatar
                                address={
                                  conversationType === "group"
                                    ? memberPreviews?.find(
                                        (m) => m.inboxId === msg.senderInboxId
                                      )?.address
                                    : peerAddress
                                }
                                size="sm"
                              />
                            )}
                          </div>
                        )}
                        <div className="flex flex-col">
                          {/* Sender name for incoming */}
                          {!isOwnMessage && isFirstInGroup && (
                            <SenderName
                              address={
                                conversationType === "group"
                                  ? memberPreviews?.find(
                                      (m) => m.inboxId === msg.senderInboxId
                                    )?.address
                                  : peerAddress
                              }
                            />
                          )}
                          {/* Render ImageGrid for multiple attachments, ImageMessage for single */}
                          <div
                            onContextMenu={(e) =>
                              handleMessageContextMenu(
                                e,
                                item.id,
                                "[Image]",
                                isOwnMessage
                                  ? ""
                                  : conversationType === "group"
                                    ? memberPreviews?.find(
                                        (m) => m.inboxId === msg.senderInboxId
                                      )?.address || ""
                                    : peerAddress || ""
                              )
                            }
                          >
                            {attachments && attachments.length > 1 ? (
                              <ImageGrid
                                attachments={attachments}
                                isOwnMessage={isOwnMessage}
                              />
                            ) : attachments && attachments.length === 1 ? (
                              <ImageMessage
                                remoteAttachment={attachments[0]}
                                isOwnMessage={isOwnMessage}
                              />
                            ) : isMultiType ? (
                              // Multi-attachment type but couldn't extract - show placeholder
                              <MultiAttachmentMessage isOwnMessage={isOwnMessage} />
                            ) : (
                              <ImageMessage
                                remoteAttachment={
                                  attachmentContent as RemoteAttachmentContent
                                }
                                isOwnMessage={isOwnMessage}
                              />
                            )}
                          </div>
                          <MessageReactions
                            messageId={item.id}
                            conversationId={conversationId}
                            isOwnMessage={isOwnMessage}
                            memberPreviews={memberPreviews}
                            peerAddress={peerAddress}
                            ownInboxId={ownInboxId}
                            onReactionToggle={handleScrollToBottom}
                          />
                          {isLastInGroup && (
                            <MessageTimestamp
                              timeString={formatTime(msg.sentAtNs)}
                              isOwnMessage={isOwnMessage}
                              hasTimer={!!msg.expiresAtNs}
                              className={`mt-1 ${isOwnMessage ? "text-right pr-1" : "ml-1"}`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  // Check if this is a reply message
                  const isReply = typeId === "reply";

                  // Skip if text is null (non-displayable content types)
                  // Replies are handled specially below and may have EncodedContent
                  if (text === null && !isReply) return null;
                  if (isReply) {
                    // Extract reply content structure
                    // SDK v6.1.0 Reply format: { content: string | EncodedContent, reference?: string, referenceId?: string, inReplyTo?: DecodedMessage }
                    const replyContent = msg.content as
                      | {
                          content?: string | { content?: string };
                          reference?: string;
                          referenceId?: string;
                          inReplyTo?: {
                            content?: unknown;
                            senderInboxId?: string;
                          };
                        }
                      | undefined;

                    // Extract reply text - handle both string and EncodedContent formats
                    let replyText = "";
                    if (typeof replyContent?.content === "string") {
                      replyText = replyContent.content;
                    } else if (replyContent?.content && typeof replyContent.content === "object") {
                      // EncodedContent format - content can be Uint8Array or nested string
                      const encodedContent = replyContent.content as { content?: Uint8Array | string };
                      if (encodedContent.content instanceof Uint8Array) {
                        // Decode the Uint8Array to get the text
                        try {
                          replyText = new TextDecoder().decode(encodedContent.content);
                        } catch {
                          replyText = "";
                        }
                      } else if (typeof encodedContent.content === "string") {
                        replyText = encodedContent.content;
                      }
                    }

                    // Get referenced message ID - try both formats
                    const referencedMessageId = replyContent?.reference ?? replyContent?.referenceId;

                    // Look up the original message
                    let quotedContent = "";
                    let quotedSenderAddress = "";
                    let quotedSenderInboxId = "";

                    // First try to get from inReplyTo (SDK v6.1.0 enriched format)
                    if (replyContent?.inReplyTo) {
                      const original = replyContent.inReplyTo;
                      quotedSenderInboxId = original.senderInboxId ?? "";
                      // Extract content from original message
                      if (typeof original.content === "string") {
                        quotedContent = original.content;
                      } else if (original.content && typeof original.content === "object") {
                        const c = original.content as { content?: string; text?: string; url?: string; urls?: unknown[] };
                        quotedContent = c.content ?? c.text ?? "";
                        // Check if it's an image attachment (has url or urls property)
                        if (!quotedContent && (c.url || c.urls)) {
                          quotedContent = "[Photo]";
                        }
                      }
                    }

                    // Fall back to looking up the message if inReplyTo didn't have content
                    if (!quotedContent && referencedMessageId) {
                      const originalMsg = getMessage(referencedMessageId);
                      if (originalMsg) {
                        quotedContent = getMessageText(originalMsg) ?? "";
                        quotedSenderInboxId = originalMsg.senderInboxId;
                        // Check if the original message was an image/attachment
                        const originalTypeId = (originalMsg.contentType as { typeId?: string })?.typeId;
                        if (!quotedContent && (
                          originalTypeId === "remoteAttachment" ||
                          originalTypeId === "remoteStaticAttachment" ||
                          originalTypeId === "multiRemoteAttachment" ||
                          originalTypeId === "multiRemoteStaticAttachment" ||
                          isSingleAttachment(originalMsg.content) ||
                          isMultiAttachment(originalMsg.content)
                        )) {
                          quotedContent = "[Photo]";
                        }
                      }
                    }

                    // Final fallback: if we still have no quoted content, show placeholder
                    if (!quotedContent) {
                      quotedContent = "[Message]";
                    }

                    // Resolve sender address from inboxId
                    if (quotedSenderInboxId) {
                      quotedSenderAddress =
                        conversationType === "group"
                          ? memberPreviews?.find(
                              (m) => m.inboxId === quotedSenderInboxId
                            )?.address ?? ""
                          : quotedSenderInboxId === ownInboxId
                          ? ""
                          : peerAddress ?? "";
                    }

                    // Get sender address for current message
                    const replySenderAddress =
                      conversationType === "group"
                        ? memberPreviews?.find(
                            (m) => m.inboxId === msg.senderInboxId
                          )?.address
                        : peerAddress;

                    return (
                      <div
                        key={item.id}
                        className={`flex ${
                          isOwnMessage ? "justify-end" : "items-start gap-3"
                        } ${isFirstInGroup ? "mt-3" : "mt-0.5"}`}
                      >
                        {/* Avatar for incoming replies */}
                        {!isOwnMessage && (
                          <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                            {isLastInGroup && (
                              conversationType === "group" && onMemberAvatarClick && replySenderAddress ? (
                                <button
                                  onClick={() => onMemberAvatarClick(replySenderAddress, msg.senderInboxId)}
                                  className="cursor-pointer hover:opacity-80 transition-opacity"
                                >
                                  <Avatar address={replySenderAddress} size="sm" />
                                </button>
                              ) : conversationType === "dm" && onOpenPeerProfile ? (
                                <button
                                  onClick={onOpenPeerProfile}
                                  className="cursor-pointer hover:opacity-80 transition-opacity"
                                >
                                  <Avatar address={replySenderAddress} size="sm" />
                                </button>
                              ) : (
                                <Avatar address={replySenderAddress} size="sm" />
                              )
                            )}
                          </div>
                        )}
                        <div
                          className={`flex flex-col ${isOwnMessage ? "items-end" : ""}`}
                        >
                          {/* Sender name for incoming */}
                          {!isOwnMessage && isFirstInGroup && (
                            <SenderName address={replySenderAddress} />
                          )}
                          <MessageWrapper
                            isOwnMessage={isOwnMessage}
                            messageId={item.id}
                            onReactionClick={handleReactionButtonClick}
                            onReplyClick={handleQuickReply}
                            onTranslateClick={(id) => handleTranslateClick(id, replyText)}
                            isTranslated={!!translations[item.id]}
                            isTranslating={translatingIds.has(item.id)}
                            translationEnabled={translationEnabled}
                          >
                            <div
                              onContextMenu={(e) =>
                                handleMessageContextMenu(
                                  e,
                                  item.id,
                                  replyText,
                                  replySenderAddress ?? ""
                                )
                              }
                            >
                              <ReplyBubble
                                quotedContent={quotedContent}
                                quotedSenderAddress={quotedSenderAddress}
                                replyContent={replyText}
                                isOwnMessage={isOwnMessage}
                                isFirstInGroup={isFirstInGroup}
                                isLastInGroup={isLastInGroup}
                                isVerified={isVerified}
                                translatedContent={translations[item.id]}
                                originalText={isOwnMessage ? getCachedOriginal(conversationId, replyText, hasDisappearingMessages) ?? undefined : undefined}
                                reactions={
                                  <MessageReactions
                                    messageId={item.id}
                                    conversationId={conversationId}
                                    isOwnMessage={isOwnMessage}
                                    memberPreviews={memberPreviews}
                                    peerAddress={peerAddress}
                                    ownInboxId={ownInboxId}
                                    onReactionToggle={handleScrollToBottom}
                                  />
                                }
                              />
                            </div>
                          </MessageWrapper>
                          {/* Link preview for reply messages */}
                          {linkPreviewEnabled && extractUrls(replyText).length > 0 && (
                            <div className="mt-2">
                              <MessageLinkPreview
                                text={replyText}
                                isOwnMessage={isOwnMessage}
                              />
                            </div>
                          )}
                          {/* Ticker preview for reply messages */}
                          {linkPreviewEnabled && hasTickers(replyText) && (
                            <div className={`mt-2 flex ${isOwnMessage ? "justify-end" : "justify-start"}`}>
                              <MessageTickerPreview
                                text={replyText}
                                onOpenModal={handleTickerClick}
                                onLoad={handleContentLoad}
                              />
                            </div>
                          )}
                          {/* Timestamp for reply messages */}
                          {isLastInGroup && (
                            <MessageTimestamp
                              timeString={formatTime(msg.sentAtNs)}
                              isOwnMessage={isOwnMessage}
                              hasTimer={!!msg.expiresAtNs}
                              className={`mt-1 ${isOwnMessage ? "text-right pr-1" : "ml-1"}`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  // For non-reply messages, text should never be null at this point
                  // (we returned early if text was null and it wasn't a reply)
                  if (text === null) return null;

                  // Outgoing message (sender)
                  if (isOwnMessage) {
                    const isRead = streamManager.isMessageRead(
                      conversationId,
                      msg.sentAtNs
                    );
                    const isUrlOnly = linkPreviewEnabled && isJustUrl(text);

                    // Sender bubble: 18px corners, slightly smaller on bottom-right
                    const senderRadius =
                      isFirstInGroup && isLastInGroup
                        ? "rounded-[18px] rounded-br-[6px]"
                        : isFirstInGroup
                        ? "rounded-[18px] rounded-br-[6px]"
                        : isLastInGroup
                        ? "rounded-[18px] rounded-tr-[6px] rounded-br-[6px]"
                        : "rounded-[18px] rounded-tr-[6px] rounded-br-[6px]";

                    // URL-only message: link preview IS the bubble
                    if (isUrlOnly) {
                      return (
                        <div
                          key={item.id}
                          className={`flex flex-col items-end ${
                            isFirstInGroup ? "mt-3" : "mt-0.5"
                          }`}
                        >
                          <MessageWrapper
                            isOwnMessage={true}
                            messageId={item.id}
                            onReactionClick={handleReactionButtonClick}
                            onReplyClick={handleQuickReply}
                          >
                            <div
                              onContextMenu={(e) =>
                                handleMessageContextMenu(e, item.id, text, "")
                              }
                            >
                              <MessageLinkPreview
                                text={text}
                                isOwnMessage={true}
                              />
                              <MessageReactions
                                messageId={item.id}
                                conversationId={conversationId}
                                isOwnMessage={true}
                                memberPreviews={memberPreviews}
                                peerAddress={peerAddress}
                                ownInboxId={ownInboxId}
                                onReactionToggle={handleScrollToBottom}
                              />
                            </div>
                          </MessageWrapper>
                          {/* Hide timestamp if there's a pending message after this - prevents jump on send */}
                          {isLastInGroup && !(displayItems[index + 1]?.type === "pending") && (
                            <div className="flex justify-end items-center gap-1.5 mt-1 pr-1">
                              <MessageTimestamp
                                timeString={formatTime(msg.sentAtNs)}
                                isOwnMessage={true}
                                hasTimer={!!msg.expiresAtNs}
                              />
                              {item.id === lastOwnMessageId &&
                                (isRead ? (
                                  <span className="text-[11px] text-[var(--accent-green)] font-medium">
                                    Read
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-[var(--text-quaternary)]">
                                    Sent
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.id}
                        className={`flex flex-col items-end ${
                          isFirstInGroup ? "mt-3" : "mt-0.5"
                        }`}
                      >
                        <MessageWrapper
                          isOwnMessage={true}
                          messageId={item.id}
                          onReactionClick={handleReactionButtonClick}
                          onReplyClick={handleQuickReply}
                          onTranslateClick={(id) => handleTranslateClick(id, text)}
                          isTranslated={!!translations[item.id]}
                          isTranslating={translatingIds.has(item.id)}
                          translationEnabled={translationEnabled}
                        >
                          <div className="max-w-[300px]">
                            <div
                              className={`${isVerified ? "bg-[var(--bubble-outgoing)] shadow-sm shadow-[var(--accent-blue)]/20" : "bg-[var(--bubble-unverified)]"} px-3 py-2 ${senderRadius}`}
                              onContextMenu={(e) =>
                                handleMessageContextMenu(e, item.id, text, "")
                              }
                            >
                              <MessageText text={text} isOwnMessage={true} onMentionClick={handleMentionClick} />
                              {/* Show translation or original text for outgoing messages */}
                              {(() => {
                                // First check for on-demand translation (clicked translate button)
                                const onDemandTranslation = translations[item.id];
                                if (onDemandTranslation) {
                                  return (
                                    <div className="mt-1.5 pt-1.5 border-t border-white/20">
                                      <p className="text-[15px] text-white/70 italic leading-[1.4]">
                                        {onDemandTranslation}
                                      </p>
                                    </div>
                                  );
                                }
                                // Otherwise show cached original text (from when you sent a translated message)
                                // Pass hasDisappearingMessages to check session cache for disappearing convos
                                const originalText = getCachedOriginal(conversationId, text, hasDisappearingMessages);
                                if (!originalText) return null;
                                return (
                                  <div className="mt-1.5 pt-1.5 border-t border-white/20">
                                    <p className="text-[15px] text-white/70 italic leading-[1.4]">
                                      {originalText}
                                    </p>
                                  </div>
                                );
                              })()}
                            </div>
                            <MessageReactions
                              messageId={item.id}
                              conversationId={conversationId}
                              isOwnMessage={true}
                              memberPreviews={memberPreviews}
                              peerAddress={peerAddress}
                              ownInboxId={ownInboxId}
                              onReactionToggle={handleScrollToBottom}
                            />
                          </div>
                        </MessageWrapper>
                        {/* Link preview outside the bubble for messages with text + URL */}
                        {linkPreviewEnabled && extractUrls(text).length > 0 && (
                          <div className="mt-2">
                            <MessageLinkPreview
                              text={text}
                              isOwnMessage={true}
                            />
                          </div>
                        )}
                        {/* Ticker preview outside the bubble */}
                        {linkPreviewEnabled && hasTickers(text) && (
                          <div className="mt-2 flex justify-end">
                            <MessageTickerPreview
                              text={text}
                              onOpenModal={handleTickerClick}
                              onLoad={handleContentLoad}
                            />
                          </div>
                        )}
                        {/* Hide timestamp if there's a pending message after this - prevents jump on send */}
                        {isLastInGroup && !(displayItems[index + 1]?.type === "pending") && (
                          <div className="flex justify-end items-center gap-1.5 mt-1 pr-1">
                            <MessageTimestamp
                              timeString={formatTime(msg.sentAtNs)}
                              isOwnMessage={true}
                              hasTimer={!!msg.expiresAtNs}
                            />
                            {/* Only show Sent/Read on the very last own message */}
                            {item.id === lastOwnMessageId &&
                              (isRead ? (
                                <span className="text-[11px] text-[var(--accent-green)] font-medium">
                                  Read
                                </span>
                              ) : (
                                <span className="text-[11px] text-[var(--text-quaternary)]">
                                  Sent
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Incoming message (recipient)
                  // For group chats, look up address from memberPreviews
                  // For DMs, use the peerAddress
                  const senderAddress =
                    conversationType === "group"
                      ? memberPreviews?.find(
                          (m) => m.inboxId === msg.senderInboxId
                        )?.address
                      : peerAddress;

                  const isUrlOnly = linkPreviewEnabled && isJustUrl(text);

                  // Recipient bubble: 18px corners, slightly smaller on bottom-left
                  const recipientRadius =
                    isFirstInGroup && isLastInGroup
                      ? "rounded-[18px] rounded-bl-[6px]"
                      : isFirstInGroup
                      ? "rounded-[18px] rounded-bl-[6px]"
                      : isLastInGroup
                      ? "rounded-[18px] rounded-tl-[6px] rounded-bl-[6px]"
                      : "rounded-[18px] rounded-tl-[6px] rounded-bl-[6px]";

                  // URL-only incoming message: link preview IS the bubble
                  if (isUrlOnly) {
                    return (
                      <div
                        key={item.id}
                        className={`flex items-start gap-3 ${
                          isFirstInGroup ? "mt-3" : "mt-0.5"
                        }`}
                      >
                        <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                          {isLastInGroup && (
                            conversationType === "group" && onMemberAvatarClick && senderAddress ? (
                              <button
                                onClick={() => onMemberAvatarClick(senderAddress, msg.senderInboxId)}
                                className="cursor-pointer hover:opacity-80 transition-opacity"
                              >
                                <Avatar address={senderAddress} size="sm" />
                              </button>
                            ) : (
                              <Avatar address={senderAddress} size="sm" />
                            )
                          )}
                        </div>
                        <div className="flex flex-col">
                          {isFirstInGroup && (
                            <SenderName address={senderAddress} />
                          )}
                          <MessageWrapper
                            isOwnMessage={false}
                            messageId={item.id}
                            onReactionClick={handleReactionButtonClick}
                            onReplyClick={handleQuickReply}
                            onTranslateClick={(id) => handleTranslateClick(id, text)}
                            isTranslated={!!translations[item.id]}
                            isTranslating={translatingIds.has(item.id)}
                            translationEnabled={translationEnabled}
                          >
                            <div
                              onContextMenu={(e) =>
                                handleMessageContextMenu(
                                  e,
                                  item.id,
                                  text,
                                  senderAddress ?? ""
                                )
                              }
                            >
                              <MessageLinkPreview
                                text={text}
                                isOwnMessage={false}
                              />
                              {translations[item.id] && (
                                <div className="mt-1 pt-1 border-t border-[var(--border-subtle)]">
                                  <p className="text-[13px] text-[var(--text-secondary)] italic">
                                    {translations[item.id]}
                                  </p>
                                </div>
                              )}
                              <MessageReactions
                                messageId={item.id}
                                conversationId={conversationId}
                                isOwnMessage={false}
                                memberPreviews={memberPreviews}
                                peerAddress={peerAddress}
                                ownInboxId={ownInboxId}
                                onReactionToggle={handleScrollToBottom}
                              />
                            </div>
                          </MessageWrapper>
                          {isLastInGroup && (
                            <MessageTimestamp
                              timeString={formatTime(msg.sentAtNs)}
                              isOwnMessage={false}
                              hasTimer={!!msg.expiresAtNs}
                              className="mt-1 ml-1"
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 ${
                        isFirstInGroup ? "mt-3" : "mt-0.5"
                      }`}
                    >
                      {/* Avatar - only show on last message of group, otherwise spacer */}
                      <div className="w-8 h-8 shrink-0 flex items-end mt-auto">
                        {isLastInGroup && (
                          conversationType === "group" && onMemberAvatarClick && senderAddress ? (
                            <button
                              onClick={() => onMemberAvatarClick(senderAddress, msg.senderInboxId)}
                              className="cursor-pointer hover:opacity-80 transition-opacity"
                            >
                              <Avatar address={senderAddress} size="sm" />
                            </button>
                          ) : (
                            <Avatar address={senderAddress} size="sm" />
                          )
                        )}
                      </div>
                      <div className="flex flex-col">
                        {/* Sender name - show on first message in group for all incoming messages */}
                        {isFirstInGroup && (
                          <SenderName address={senderAddress} />
                        )}
                        <MessageWrapper
                          isOwnMessage={false}
                          messageId={item.id}
                          onReactionClick={handleReactionButtonClick}
                          onReplyClick={handleQuickReply}
                          onTranslateClick={(id) => handleTranslateClick(id, text)}
                          isTranslated={!!translations[item.id]}
                          isTranslating={translatingIds.has(item.id)}
                          translationEnabled={translationEnabled}
                        >
                          <div className="max-w-[300px]">
                            <div
                              className={`bg-[var(--bubble-incoming)] px-3 py-2 ${recipientRadius}`}
                              onContextMenu={(e) =>
                                handleMessageContextMenu(
                                  e,
                                  item.id,
                                  text,
                                  senderAddress ?? ""
                                )
                              }
                            >
                              <MessageText text={text} isOwnMessage={false} onMentionClick={handleMentionClick} />
                              {translations[item.id] && (
                                <div className="mt-1.5 pt-1.5 border-t border-[rgba(0,0,0,0.08)]">
                                  <p className="text-[15px] text-[var(--text-secondary)] italic leading-[1.4]">
                                    {translations[item.id]}
                                  </p>
                                </div>
                              )}
                            </div>
                            <MessageReactions
                              messageId={item.id}
                              conversationId={conversationId}
                              isOwnMessage={false}
                              memberPreviews={memberPreviews}
                              peerAddress={peerAddress}
                              ownInboxId={ownInboxId}
                              onReactionToggle={handleScrollToBottom}
                            />
                          </div>
                        </MessageWrapper>
                        {/* Link preview outside the bubble for messages with text + URL */}
                        {linkPreviewEnabled && extractUrls(text).length > 0 && (
                          <div className="mt-2">
                            <MessageLinkPreview
                              text={text}
                              isOwnMessage={false}
                            />
                          </div>
                        )}
                        {/* Ticker preview for incoming messages */}
                        {linkPreviewEnabled && hasTickers(text) && (
                          <div className="mt-2 flex justify-start">
                            <MessageTickerPreview
                              text={text}
                              onOpenModal={handleTickerClick}
                              onLoad={handleContentLoad}
                            />
                          </div>
                        )}
                        {isLastInGroup && (
                          <MessageTimestamp
                            timeString={formatTime(msg.sentAtNs)}
                            isOwnMessage={false}
                            hasTimer={!!msg.expiresAtNs}
                            className="mt-1 ml-1"
                          />
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Reply Preview */}
      {replyingTo && !isMessageRequest && (
        <ReplyPreview
          senderAddress={replyingTo.senderAddress}
          content={replyingTo.content}
          onDismiss={() => setReplyingTo(null)}
        />
      )}

      {/* Translation Preview */}
      {translationPreview && !isMessageRequest && (
        <div className="shrink-0 px-4 py-2 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] text-[var(--text-tertiary)] flex items-center gap-1">
              <span>{TRANSLATE_LANGUAGES.find(l => l.code === translationPreview.targetLang)?.flag}</span>
              <span>{TRANSLATE_LANGUAGES.find(l => l.code === translationPreview.targetLang)?.abbr || translationPreview.targetLang}</span>
            </span>
            <span className="text-[11px] text-[var(--text-quaternary)]">
              Enter to send
            </span>
          </div>
          <div className="text-[14px] text-[var(--text-primary)]">{translationPreview.translated}</div>
        </div>
      )}

      {/* Input Area */}
      {isMessageRequest ? (
        <div className="shrink-0 px-4 py-3 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-center gap-2 py-1">
            <Lock className="w-4 h-4 text-[var(--text-quaternary)]" />
            <span className="text-[14px] text-[var(--text-quaternary)]">Accept the request above to send a message</span>
          </div>
        </div>
      ) : (
        <div className="shrink-0 px-4 py-2 border-t border-[var(--border-default)] bg-[var(--bg-primary)] relative">
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                alert("Coming soon! Ping Takis to work on this 📎")
              }
              className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] transition-colors shrink-0"
            >
              <Paperclip className="w-5 h-5 text-[var(--text-quaternary)]" />
            </button>

            {/* Translation settings button - only show when translation is available */}
            {translationEnabled && (
              <div ref={languageSelectorRef} className="relative shrink-0">
                <button
                  onClick={() => setShowLanguageSelector(!showLanguageSelector)}
                  className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors shrink-0 ${
                    outgoingTranslateTo || autoTranslate
                      ? "bg-[var(--accent-blue)]/10"
                      : "hover:bg-[var(--bg-hover)] text-[var(--text-quaternary)]"
                  }`}
                  title="Translation settings"
                >
                  {isTranslatingOutgoing ? (
                    <Loader2 className="w-5 h-5 animate-spin text-[var(--accent-blue)]" />
                  ) : outgoingTranslateTo ? (
                    <span className="text-[14px] h-5 flex items-center justify-center gap-0.5">
                      <span>🇺🇸</span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">→</span>
                      <span>{TRANSLATE_LANGUAGES.find(l => l.code === outgoingTranslateTo)?.flag}</span>
                    </span>
                  ) : autoTranslate ? (
                    <Languages className="w-5 h-5 text-[var(--accent-blue)]" />
                  ) : (
                    <Languages className="w-5 h-5" />
                  )}
                </button>

                {/* Translation Settings Dropdown */}
                {showLanguageSelector && (
                  <div className="absolute bottom-14 left-0 bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border-default)] p-2 z-50" style={{ width: '220px' }}>
                    {/* Incoming Messages Section */}
                    <div className="mb-3">
                      <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide px-1 mb-1.5">
                        Incoming messages
                      </div>
                      <button
                        onClick={handleAutoTranslateToggle}
                        className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <span className="text-[13px] text-[var(--text-primary)]">Auto-translate to English</span>
                        <div className={`w-9 h-5 rounded-full transition-colors relative ${autoTranslate ? 'bg-[var(--accent-blue)]' : 'bg-[var(--border-default)]'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoTranslate ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </div>
                      </button>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-[var(--border-default)] mb-3" />

                    {/* Outgoing Messages Section */}
                    <div>
                      <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide px-1 mb-1.5">
                        Outgoing messages (🇺🇸→)
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {TRANSLATE_LANGUAGES.map(lang => (
                          <button
                            key={lang.code}
                            onClick={() => {
                              setOutgoingTranslateTo(outgoingTranslateTo === lang.code ? null : lang.code);
                            }}
                            className={`w-[46px] h-[46px] rounded-lg text-[11px] hover:bg-[var(--bg-hover)] transition-colors flex flex-col items-center justify-center gap-0.5 ${
                              outgoingTranslateTo === lang.code ? "bg-[var(--accent-blue)]/10" : ""
                            }`}
                            title={lang.name}
                          >
                            <span className="text-[22px] leading-none">{lang.flag}</span>
                            <span className={`font-medium ${outgoingTranslateTo === lang.code ? "text-[var(--accent-blue)]" : "text-[var(--text-tertiary)]"}`}>{lang.abbr}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <HighlightedInput
              ref={inputRef}
              value={message}
              onChange={setMessage}
              onKeyDown={handleKeyDown}
              placeholder="Write a message..."
              onTickerClick={handleTickerClick}
              members={memberPreviews}
              currentInboxId={client?.inboxId}
            />
            <button
              onClick={handleSendWithTranslation}
              disabled={!message.trim() || isSending}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-[var(--bubble-outgoing)] hover:bg-[var(--accent-blue-hover)] disabled:bg-[var(--border-default)] disabled:cursor-not-allowed transition-colors shrink-0 active:scale-95"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : (
                <Send className="w-5 h-5 text-white" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <MessageContextMenu
          position={contextMenu.position}
          onReply={handleReply}
          onCopy={handleCopy}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Reaction Picker (still available for emoji reactions) */}
      {reactionPicker && (
        <ReactionPicker
          position={reactionPicker.position}
          onSelect={handleReactionSelect}
          onClose={() => setReactionPicker(null)}
        />
      )}

      {/* Ticker Chart Modal */}
      {tickerModal && (
        <TickerChartModal
          symbol={tickerModal.symbol}
          data={tickerModal.data}
          onClose={() => setTickerModal(null)}
          onRetry={handleTickerRefresh}
          isLoading={tickerModalLoading}
        />
      )}
    </div>
  );
}
