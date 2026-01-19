/**
 * XMTPStreamManager - Singleton that manages all XMTP streaming outside React lifecycle
 *
 * This decouples data management from React rendering:
 * - Single source of truth for all streams
 * - No duplicate loading or streams
 * - Survives component mount/unmount
 * - Updates Jotai atoms which React subscribes to
 */

import type { Dm, Group, Reply, Reaction } from '@xmtp/browser-sdk';
import { SortDirection, ConsentState, GroupMessageKind, IdentifierKind, ReactionAction, ReactionSchema, encodeText } from '@xmtp/browser-sdk';
import { ContentTypeReadReceipt } from '@xmtp/content-type-read-receipt';
import type { AnyClient } from '@/types/xmtp';
import {
  store,
  conversationIdsAtom,
  isLoadingConversationsAtom,
  isSyncingConversationsAtom,
  conversationsErrorAtom,
  conversationMetadataVersionAtom,
  allConversationMessageIdsAtom,
  allConversationPaginationAtom,
  messageCache,
  readReceiptsAtom,
  readReceiptVersionAtom,
  unreadVersionAtom,
  selectedConversationIdAtom,
  reactionsAtom,
  reactionsVersionAtom,
} from '@/stores';
import type { ReactionContent, StoredReaction } from '@/stores/messages';
import type { DecodedMessage } from '@xmtp/browser-sdk';
import type { PaginationState, DisplayReaction } from '@/types/messages';
import { extractReactions } from '@/types/messages';
import { showMessageNotification, requestNotificationPermission, updateTitleWithUnreadCount, isTabVisible, startTitleFlash, setCurrentChatName } from '@/lib/notifications';
import { getCachedUsername, getAvatarUrl, resolveAddress } from '@/lib/username/service';
import { isMentioned } from '@/lib/mentions/utils';
import { getSessionCache } from '@/lib/storage';
import { mutedConversationIdsAtom, messageRequestNotificationsAtom } from '@/stores/settings';
import { isPaymentRequest, type PaymentRequest } from '@/lib/xmtp/PaymentRequestCodec';
import { isPaymentFulfillment, type PaymentFulfillment } from '@/lib/xmtp/PaymentFulfillmentCodec';
import { formatTokenAmount } from '@/lib/xmtp/TransactionReferenceCodec';

// Conversation type
type Conversation = Dm | Group;

// Member preview for group avatars
interface MemberPreview {
  inboxId: string;
  address: string;
}

interface ConversationMetadata {
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
}

// Check if a conversation is a DM
function isDm(conv: unknown): conv is Dm & { peerInboxId(): Promise<string> } {
  return typeof (conv as { peerInboxId?: unknown }).peerInboxId === 'function';
}

// Content type IDs for special message types
const CONTENT_TYPE_READ_RECEIPT = 'readReceipt';
const CONTENT_TYPE_REACTION = 'reaction';
const CONTENT_TYPE_REPLY = 'reply';
const CONTENT_TYPE_REMOTE_ATTACHMENT = 'remoteAttachment';
const CONTENT_TYPE_REMOTE_STATIC_ATTACHMENT = 'remoteStaticAttachment'; // World App naming
const CONTENT_TYPE_MULTI_REMOTE_ATTACHMENT = 'multiRemoteAttachment';
const CONTENT_TYPE_MULTI_REMOTE_STATIC_ATTACHMENT = 'multiRemoteStaticAttachment'; // World App naming

// CDN URL for trusted image attachments
const TRUSTED_CDN_PATTERN = 'chat-assets.toolsforhumanity.com';

/**
 * Manually parse protobuf-encoded reaction from World App
 * World App uses a different protobuf field mapping than @xmtp/content-type-reaction:
 * - Field 1: reference (message ID)
 * - Field 3: action (1=added, 2=removed)
 * - Field 4: content (emoji)
 * - Field 5: schema (1=unicode)
 */
function parseProtobufReaction(bytes: Uint8Array): ReactionContent | null {
  try {
    let pos = 0;
    let reference: string | undefined;
    let action: 'added' | 'removed' = 'added';
    let content: string | undefined;

    while (pos < bytes.length) {
      const tag = bytes[pos++];
      const fieldNumber = tag >> 3;
      const wireType = tag & 0x07;

      if (wireType === 2) {
        // Length-delimited (string)
        const length = bytes[pos++];
        const value = new TextDecoder().decode(bytes.slice(pos, pos + length));
        pos += length;

        if (fieldNumber === 1) {
          reference = value;
        } else if (fieldNumber === 4) {
          content = value;
        }
      } else if (wireType === 0) {
        // Varint
        let value = 0;
        let shift = 0;
        while (pos < bytes.length) {
          const byte = bytes[pos++];
          value |= (byte & 0x7f) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7;
        }

        if (fieldNumber === 3) {
          action = value === 2 ? 'removed' : 'added';
        }
        // Field 5 is schema, but we just use 'custom' as default
      } else {
        // Unknown wire type, skip
        break;
      }
    }

    if (reference && content) {
      return { reference, action, content, schema: 'custom' };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to decode a raw reaction from encodedContent
 * This handles messages where the codec didn't properly decode
 */
async function tryDecodeReaction(msg: {
  content: unknown;
  contentType?: { typeId?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  encodedContent?: any;
}): Promise<ReactionContent | null> {
  // Check if content is already decoded and valid
  const content = msg.content as ReactionContent | undefined;
  if (content && typeof content === 'object' && 'reference' in content && 'content' in content) {
    return content;
  }

  // Try to decode from encodedContent
  if (!msg.encodedContent?.content) {
    return null;
  }

  const rawBytes = msg.encodedContent.content as Uint8Array;

  // Try manual protobuf parsing first (for World App messages)
  const protoResult = parseProtobufReaction(rawBytes);
  if (protoResult) {
    return protoResult;
  }

  // Try JSON fallback for older format
  try {
    const text = new TextDecoder().decode(rawBytes);
    const reaction = JSON.parse(text) as ReactionContent;
    if (reaction && reaction.reference && reaction.content) {
      return reaction;
    }
  } catch {
    // JSON parse failed, which is expected for protobuf data
  }

  // Try using the ReactionCodec as last resort
  try {
    const { ReactionCodec } = await import('@xmtp/content-type-reaction');
    const codec = new ReactionCodec();
    const decoded = codec.decode(msg.encodedContent) as ReactionContent;
    if (decoded && decoded.reference && decoded.content) {
      return decoded;
    }
  } catch {
    // Codec failed
  }

  return null;
}

/**
 * Try to decode a raw remote attachment from encodedContent
 * This handles messages that were synced before the codec was registered
 */
async function tryDecodeRawRemoteAttachment(msg: {
  content: unknown;
  contentType?: { typeId?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  encodedContent?: any;
}): Promise<boolean> {
  const typeId = msg.contentType?.typeId;
  const content = msg.content;

  // Check if this looks like a raw/undecoded remote attachment
  // It will be a string containing the CDN URL instead of a proper object
  const isRawRemoteAttachment =
    typeId === CONTENT_TYPE_REMOTE_ATTACHMENT &&
    typeof content === 'string' &&
    content.includes(TRUSTED_CDN_PATTERN);

  if (!isRawRemoteAttachment || !msg.encodedContent) {
    return false;
  }

  try {
    const { RemoteAttachmentCodec } = await import('@xmtp/content-type-remote-attachment');
    const codec = new RemoteAttachmentCodec();
    // encodedContent is the full EncodedContent object from XMTP
    const decoded = codec.decode(msg.encodedContent);

    // Mutate the message content to the decoded value
    (msg as { content: unknown }).content = decoded;
    return true;
  } catch (error) {
    console.error('[StreamManager] Failed to decode raw remote attachment:', error);
    return false;
  }
}

// Message loading limits
const BATCH_SIZE = 50;             // Messages to fetch per batch
const MIN_DISPLAYABLE_MESSAGES = 30; // Minimum displayable messages we want initially
const MIN_LOADMORE_MESSAGES = 20;   // Minimum displayable messages per "load more"
const MAX_FETCH_ITERATIONS = 5;     // Max iterations to prevent infinite loops
const BACKGROUND_REFRESH_LIMIT = 100; // Limit for background sync refreshes

// Stream restart configuration
const STREAM_RESTART_DELAY_MS = 2000;  // Wait before restarting crashed stream
const MAX_STREAM_RESTARTS = 5;          // Max restart attempts before giving up

// Timeout for XMTP operations to prevent hangs on forked groups
// Messages should load from local cache almost instantly - if it takes >3s something is wrong
const XMTP_OPERATION_TIMEOUT_MS = 3000; // 3 seconds max

/**
 * Wrap a promise with a timeout to prevent infinite hangs
 * Used for XMTP operations that may get stuck on epoch mismatch
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// localStorage key for persisting last-read timestamps
const LAST_READ_TIMESTAMPS_KEY = 'xmtp-last-read-timestamps';
const PEER_READ_RECEIPTS_KEY = 'xmtp-peer-read-receipts';
const MAX_MESSAGES_FOR_UNREAD_COUNT = 50; // Only count first N messages per conversation

// Helper to check if a typeId matches a content type (case-insensitive)
function matchesContentType(typeId: string | undefined, contentType: string): boolean {
  if (!typeId) return false;
  const lower = typeId.toLowerCase();
  const target = contentType.toLowerCase();
  return lower === target || lower.includes(target);
}

// Check if a message is a hidden type (shouldn't show ANY preview text)
function isSpecialContentType(message: { contentType?: { typeId?: string } }): boolean {
  const typeId = message.contentType?.typeId;
  // Only read receipts and reactions are completely hidden
  // Remote attachments show "Image" preview, so not included here
  return matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT) ||
         matchesContentType(typeId, CONTENT_TYPE_REACTION);
}

// Extract text content from a message
function extractMessageContent(message: { content: unknown; contentType?: { typeId?: string }; encodedContent?: { content?: Uint8Array } }): string {
  // Skip read receipts and reactions for preview
  if (isSpecialContentType(message)) {
    return '';
  }

  const typeId = message.contentType?.typeId;
  let content = message.content;

  // Handle multi-attachment types first (World App multi-image messages)
  const isMultiAttachment = typeId === CONTENT_TYPE_MULTI_REMOTE_ATTACHMENT ||
    typeId === CONTENT_TYPE_MULTI_REMOTE_STATIC_ATTACHMENT;
  if (isMultiAttachment) {
    return 'Multiple images';
  }

  // Handle remote attachments (images) - show preview text
  // Check both typeId AND content shape since typeId may not always be detected
  const contentAsObj = content as Record<string, unknown> | null;
  const hasImageShape = contentAsObj !== null && typeof contentAsObj === 'object' &&
    'contentDigest' in contentAsObj && 'url' in contentAsObj;
  const isRemoteAttachment = typeId === CONTENT_TYPE_REMOTE_ATTACHMENT ||
    typeId === CONTENT_TYPE_REMOTE_STATIC_ATTACHMENT || hasImageShape;

  if (isRemoteAttachment) {
    const attachmentContent = content as { filename?: string } | undefined;
    if (attachmentContent?.filename) {
      return `Image: ${attachmentContent.filename}`;
    }
    return 'Image';
  }

  // If content is undefined but we have a transaction type, try to decode from encodedContent
  if (typeId === 'transactionReference' && !content && message.encodedContent?.content) {
    try {
      const decoded = new TextDecoder().decode(message.encodedContent.content);
      content = JSON.parse(decoded);
    } catch {
      // Failed to decode, continue with undefined content
    }
  }

  // Handle transaction references - show payment preview (supports both formats)
  if (typeId === 'transactionReference' && content && typeof content === 'object') {
    // Our custom format
    if ('txHash' in content) {
      const txRef = content as { amount?: string; token?: { symbol?: string; decimals?: number }; type?: string };
      if (txRef.amount && txRef.token?.decimals !== undefined) {
        const value = BigInt(txRef.amount);
        const divisor = BigInt(10 ** txRef.token.decimals);
        const formatted = (Number(value) / Number(divisor)).toFixed(2);
        const symbol = txRef.token.symbol || 'Token';
        const prefix = txRef.type === 'request' ? 'Payment request' : 'Payment';
        return `${prefix}: ${formatted} ${symbol}`;
      }
      return 'Payment';
    }
    // XMTP standard format (from World App, etc.)
    if ('reference' in content && 'metadata' in content) {
      const txRef = content as { metadata?: { amount?: number; decimals?: number; currency?: string } };
      if (txRef.metadata?.amount !== undefined && txRef.metadata?.decimals !== undefined) {
        const value = BigInt(Math.floor(txRef.metadata.amount));
        const divisor = BigInt(10 ** txRef.metadata.decimals);
        const formatted = (Number(value) / Number(divisor)).toFixed(2);
        const symbol = txRef.metadata.currency || 'Token';
        return `Payment: ${formatted} ${symbol}`;
      }
      return 'Payment';
    }
  }

  // If content is undefined but we have a payment type, try to decode from encodedContent
  if ((typeId === 'paymentRequest' || typeId === 'paymentFulfillment') && !content && message.encodedContent?.content) {
    try {
      const decoded = new TextDecoder().decode(message.encodedContent.content);
      content = JSON.parse(decoded);
    } catch {
      // Failed to decode, continue with undefined content
    }
  }

  // Handle payment requests
  if (typeId === 'paymentRequest' && isPaymentRequest(content)) {
    const request = content as PaymentRequest;
    const formatted = formatTokenAmount(request.metadata.amount, request.metadata.decimals);
    return `Requested $${formatted}`;
  }

  // Handle payment fulfillments
  if (typeId === 'paymentFulfillment' && isPaymentFulfillment(content)) {
    const fulfillment = content as PaymentFulfillment;
    const formatted = formatTokenAmount(fulfillment.metadata.amount, fulfillment.metadata.decimals);
    return `Sent $${formatted}`;
  }

  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    // Handle text content
    if ('text' in content && typeof (content as { text?: unknown }).text === 'string') {
      return (content as { text: string }).text;
    }
    // Handle reply content (has nested content)
    if ('content' in content) {
      const nestedContent = (content as { content: unknown }).content;
      if (typeof nestedContent === 'string') return nestedContent;
      if (nestedContent && typeof nestedContent === 'object' && 'text' in nestedContent) {
        return (nestedContent as { text: string }).text;
      }
    }
  }
  return '';
}

class XMTPStreamManager {
  private client: AnyClient | null = null;
  private conversationStreamController: AbortController | null = null;
  private allMessagesStreamController: AbortController | null = null;

  // Cleanup function for shutdown listener
  private shutdownCleanup: (() => void) | null = null;

  constructor() {
    // Register for shutdown notification from Electron (before update install)
    // This gives us time to cleanup streams and let pending database writes complete
    if (typeof window !== 'undefined' && window.electronAPI?.onPrepareForShutdown) {
      console.log('[StreamManager] Registering for shutdown notification');
      this.shutdownCleanup = window.electronAPI.onPrepareForShutdown(() => {
        console.log('[StreamManager] Received shutdown notification, cleaning up...');
        this.cleanup();
      });
    }
  }

  // Track what's been loaded to prevent duplicates
  private conversationsLoaded = false;
  private loadedMessageConversations = new Set<string>();

  // Track conversations currently syncing (for groups that need to catch up on epochs)
  // Maps conversationId -> sync Promise so we can await completion
  private syncingConversations = new Map<string, Promise<void>>();

  // Store conversation metadata (not in atoms to avoid re-renders)
  private conversationMetadata = new Map<string, ConversationMetadata>();

  // Store conversation instances for reuse
  private conversations = new Map<string, Conversation>();

  // Stream restart attempt counters
  private conversationStreamRestarts = 0;
  private allMessagesStreamRestarts = 0;

  // Track when user last read each conversation (for unread counts)
  private lastReadTimestamps = new Map<string, bigint>();

  // Track messages received while tab is hidden (for tab title)
  private hiddenTabMessageCount = 0;

  // Cache of inboxId -> address for all members we've seen (persists even after removal)
  private memberAddressCache = new Map<string, string>();

  // Periodic history sync interval (to respond to new installation sync requests)
  private historySyncInterval: ReturnType<typeof setInterval> | null = null;

  // Current user's username (for @mention detection)
  private currentUserUsername: string | null = null;

  // Translation download in progress - syncs should be deferred
  private translationInProgress = false;

  // Track if database corruption was detected
  private databaseCorrupted = false;

  /**
   * Check if a heavy I/O operation (like translation download) is in progress
   * Sync operations should check this and defer if true
   */
  isHeavyOperationInProgress(): boolean {
    return this.translationInProgress;
  }

  /**
   * Set the translation-in-progress flag
   * Call this before starting translation download, clear when done
   */
  setTranslationInProgress(inProgress: boolean): void {
    console.log('[StreamManager] Translation in progress:', inProgress);
    this.translationInProgress = inProgress;
  }

  /**
   * Check if database sync is currently in progress
   * Translation should wait for this to complete before starting
   */
  isSyncing(): boolean {
    return store.get(isSyncingConversationsAtom);
  }

  /**
   * Check if database corruption has been detected
   */
  isDatabaseCorrupted(): boolean {
    return this.databaseCorrupted;
  }

  /**
   * Check if an error indicates database corruption
   * If so, set the flag and log for user guidance
   */
  private checkForDatabaseCorruption(error: unknown): boolean {
    const errorStr = String(error);
    if (errorStr.includes('database disk image is malformed') ||
        errorStr.includes('SQLITE_CORRUPT') ||
        errorStr.includes('SqlKeyStore') && errorStr.includes('malformed')) {
      console.error('[StreamManager] DATABASE CORRUPTION DETECTED');
      console.error('[StreamManager] The XMTP database has become corrupted.');
      console.error('[StreamManager] To fix: Clear site data for this app and re-login.');
      this.databaseCorrupted = true;
      return true;
    }
    return false;
  }

  /**
   * Wait for any in-progress sync to complete
   * Returns a promise that resolves when sync is done (or immediately if not syncing)
   */
  async waitForSyncComplete(timeoutMs: number = 30000): Promise<boolean> {
    if (!this.isSyncing()) return true;

    console.log('[StreamManager] Waiting for sync to complete...');
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkSync = () => {
        if (!this.isSyncing()) {
          console.log('[StreamManager] Sync completed, proceeding');
          resolve(true);
          return;
        }
        if (Date.now() - startTime > timeoutMs) {
          console.warn('[StreamManager] Sync wait timeout, proceeding anyway');
          resolve(false);
          return;
        }
        setTimeout(checkSync, 500);
      };
      checkSync();
    });
  }

  /**
   * Initialize the manager with an XMTP client
   *
   * Strategy:
   * 1. Load local data immediately (fast)
   * 2. Start streams for real-time updates
   * 3. Do ONE background sync to catch up
   * 4. Never sync again - rely on streams
   */
  async initialize(client: AnyClient): Promise<void> {
    console.log('[StreamManager] initialize() called, client inboxId:', client.inboxId);

    // Clean up any existing state
    this.cleanup();

    this.client = client;

    // Load persisted data from localStorage
    this.loadLastReadTimestamps();
    this.loadPeerReadReceipts();

    // Listen for tab visibility changes to reset hidden tab count
    this.setupVisibilityListener();

    // Request notification permission after delay (don't interrupt login flow)
    setTimeout(() => {
      requestNotificationPermission().catch(() => {
        // Ignore permission errors
      });
    }, 5000);

    // Fetch current user's username for @mention detection (async, non-blocking)
    this.fetchCurrentUserUsername();

    // Phase 1: Load from local cache (instant)
    console.log('[StreamManager] Phase 1: Loading conversations from cache...');
    const hasCachedConversations = await this.loadConversationsFromCache();
    console.log('[StreamManager] Phase 1 complete, hasCachedConversations:', hasCachedConversations);

    // Phase 2: Start streams for real-time updates
    this.startConversationStream();
    this.startAllMessagesStream();

    // Phase 3: Sync preferences (including history sync from other devices)
    // Note: We intentionally don't clear session on errors here - that's the auth layer's job
    // StreamManager should never clear session or redirect, just log errors
    this.client.preferences.sync().catch((error: unknown) => {
      console.error('[StreamManager] Preferences sync error:', error);
    });

    // Phase 4: One-time initial sync to catch up
    // For fresh installs (no cached conversations), await the sync so user sees their chats
    // For returning users, run in background to not block UI
    if (hasCachedConversations) {
      this.performInitialSync();
    } else {
      await this.performInitialSync();
    }

    // Phase 5: Periodic sync to upload history for other devices
    // This ensures we respond to history sync requests from new installations
    this.startPeriodicHistorySync();
  }

  /**
   * Fetch current user's username from session cache for @mention detection
   */
  private async fetchCurrentUserUsername(): Promise<void> {
    try {
      const session = await getSessionCache();
      if (session?.address) {
        const record = await resolveAddress(session.address);
        if (record?.username) {
          this.currentUserUsername = record.username;
          console.log('[StreamManager] Current user username:', this.currentUserUsername);
        }
      }
    } catch (error) {
      console.warn('[StreamManager] Failed to fetch current user username:', error);
    }
  }

  /**
   * Load last-read timestamps from localStorage
   */
  private loadLastReadTimestamps(): void {
    try {
      const stored = localStorage.getItem(LAST_READ_TIMESTAMPS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, string>;
        for (const [conversationId, timestampStr] of Object.entries(parsed)) {
          this.lastReadTimestamps.set(conversationId, BigInt(timestampStr));
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Load peer read receipts from localStorage
   */
  private loadPeerReadReceipts(): void {
    try {
      const stored = localStorage.getItem(PEER_READ_RECEIPTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, string>;
        const newMap = new Map<string, bigint>();
        for (const [conversationId, timestampStr] of Object.entries(parsed)) {
          newMap.set(conversationId, BigInt(timestampStr));
        }
        store.set(readReceiptsAtom, newMap);
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Save peer read receipts to localStorage
   */
  private savePeerReadReceipts(): void {
    try {
      const receipts = store.get(readReceiptsAtom);
      const data: Record<string, string> = {};
      for (const [conversationId, timestamp] of receipts) {
        data[conversationId] = timestamp.toString();
      }
      localStorage.setItem(PEER_READ_RECEIPTS_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Save last-read timestamps to localStorage
   */
  private saveLastReadTimestamps(): void {
    try {
      const data: Record<string, string> = {};
      for (const [conversationId, timestamp] of this.lastReadTimestamps) {
        data[conversationId] = timestamp.toString();
      }
      localStorage.setItem(LAST_READ_TIMESTAMPS_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Mark a conversation as read (user is viewing it)
   * Updates lastReadTimestamp to now and triggers UI update
   */
  markConversationAsRead(conversationId: string): void {
    const nowNs = BigInt(Date.now()) * 1_000_000n;
    this.lastReadTimestamps.set(conversationId, nowNs);
    this.saveLastReadTimestamps();

    // Update metadata to reflect 0 unread and clear mention flag
    const metadata = this.conversationMetadata.get(conversationId);
    if (metadata && (metadata.unreadCount > 0 || metadata.hasMention)) {
      metadata.unreadCount = 0;
      metadata.hasMention = false;
      // Batch both updates together to prevent multiple re-renders
      const unreadVersion = store.get(unreadVersionAtom);
      const metadataVersion = store.get(conversationMetadataVersionAtom);
      store.set(unreadVersionAtom, unreadVersion + 1);
      store.set(conversationMetadataVersionAtom, metadataVersion + 1);
      // Update tab title
      this.updateTabTitle();
    }

  }

  /**
   * Get unread count for a conversation
   */
  getUnreadCount(conversationId: string): number {
    const metadata = this.conversationMetadata.get(conversationId);
    return metadata?.unreadCount ?? 0;
  }

  /**
   * Get total unread count across accepted conversations only
   * (excludes message requests with unknown consent)
   */
  getTotalUnreadCount(): number {
    let total = 0;
    for (const metadata of this.conversationMetadata.values()) {
      // Only count unread from accepted conversations, not message requests
      if (metadata.consentState === 'allowed') {
        total += metadata.unreadCount ?? 0;
      }
    }
    return total;
  }

  /**
   * Update the browser tab title with unread count
   * Deferred to avoid React lifecycle conflicts
   */
  private updateTabTitle(): void {
    queueMicrotask(() => {
      // Use actual unread count from metadata (source of truth)
      const totalUnread = this.getTotalUnreadCount();
      updateTitleWithUnreadCount(totalUnread);
    });
  }

  /**
   * Reset hidden tab message count (call when tab becomes visible)
   */
  resetHiddenTabCount(): void {
    this.hiddenTabMessageCount = 0;
    this.updateTabTitle();
  }

  /**
   * Set up listener for tab visibility changes
   */
  private setupVisibilityListener(): void {
    if (typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible - reset hidden message count
        this.resetHiddenTabCount();
      }
    });
  }

  // Track if initial sync has been done
  private initialSyncDone = false;

  /**
   * Find an existing DM conversation by peer address
   */
  private findExistingDmByPeerAddress(peerAddress: string): { convId: string; peerInboxId: string } | null {
    if (!peerAddress) return null;
    const normalizedAddress = peerAddress.toLowerCase();

    for (const [convId, metadata] of this.conversationMetadata) {
      if (metadata.conversationType === 'dm' &&
          metadata.peerAddress?.toLowerCase() === normalizedAddress) {
        return { convId, peerInboxId: metadata.peerInboxId };
      }
    }
    return null;
  }

  /**
   * Load conversations from local cache (no network)
   * Uses two-phase loading for faster initial render:
   * Phase 1: Show conversation list immediately with minimal metadata
   * Phase 2: Build full metadata in parallel in background
   * @returns true if conversations were found in cache, false if empty (fresh install)
   */
  private async loadConversationsFromCache(): Promise<boolean> {
    if (!this.client || this.conversationsLoaded) return true;

    this.conversationsLoaded = true;
    store.set(isLoadingConversationsAtom, true);
    store.set(conversationsErrorAtom, null);

    try {
      // Load from local cache only (no network, instant)
      // Include both Allowed and Unknown so we don't miss conversations
      // that were Allowed on another device but haven't synced consent yet
      console.log('[StreamManager] Calling client.conversations.list()...');
      const localConversations = await this.client.conversations.list({
        consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      });
      console.log('[StreamManager] conversations.list() returned', localConversations.length, 'conversations');

      const ids: string[] = [];

      // PHASE 1: Store conversations immediately with placeholder metadata
      // This lets the UI render the list fast
      for (const conv of localConversations) {
        this.conversations.set(conv.id, conv);

        // Create placeholder metadata (fast, no async)
        // Get consent state synchronously to prevent request flicker
        const isConvDm = isDm(conv);
        let placeholderConsent: 'allowed' | 'denied' | 'unknown' = 'unknown';
        try {
          // consentState() is actually sync in the SDK despite returning Promise
          const rawConsent = await conv.consentState();
          if (rawConsent === ConsentState.Allowed) placeholderConsent = 'allowed';
          else if (rawConsent === ConsentState.Denied) placeholderConsent = 'denied';
        } catch {
          // Fall back to unknown
        }
        const placeholderMetadata: ConversationMetadata = {
          id: conv.id,
          conversationType: isConvDm ? 'dm' : 'group',
          peerAddress: '',
          peerInboxId: '',
          groupName: isConvDm ? undefined : (conv as Group).name,
          groupImageUrl: isConvDm ? undefined : (conv as Group).imageUrl,
          memberCount: undefined,
          memberPreviews: undefined,
          lastMessagePreview: '', // Will be populated in phase 2
          lastActivityNs: BigInt(0),
          unreadCount: 0,
          consentState: placeholderConsent,
          disappearingMessagesEnabled: false,
        };
        this.conversationMetadata.set(conv.id, placeholderMetadata);
        ids.push(conv.id);
      }

      // If no conversations found locally (fresh install), keep loading state
      // and let performInitialSync handle it
      const hasCachedConversations = ids.length > 0;

      // Show list immediately (fast first render)
      store.set(conversationIdsAtom, ids);
      if (hasCachedConversations) {
        store.set(isLoadingConversationsAtom, false);
      }
      this.incrementMetadataVersion();

      // PHASE 2: Build full metadata in parallel (background)
      // This runs after UI has rendered
      const metadataPromises = localConversations.map(async (conv) => {
        try {
          const metadata = await this.buildConversationMetadata(conv, false);
          this.conversationMetadata.set(conv.id, metadata);
          return { convId: conv.id, metadata };
        } catch (err) {
          console.error('[StreamManager] Failed to build metadata for', conv.id, err);
          return null;
        }
      });

      // Wait for all metadata to be built
      const results = await Promise.all(metadataPromises);

      // Track DMs by peer address to detect duplicates
      const dmsByPeerAddress = new Map<string, { convId: string; peerInboxId: string; createdAtNs?: bigint }[]>();

      // Filter and sort based on actual metadata
      const filteredIds: string[] = [];
      const selectedId = store.get(selectedConversationIdAtom);

      for (const result of results) {
        if (!result) continue;
        const { convId, metadata } = result;
        const conv = this.conversations.get(convId);

        // Log DM duplicates
        if (metadata.conversationType === 'dm' && metadata.peerAddress) {
          const normalizedAddress = metadata.peerAddress.toLowerCase();
          if (!dmsByPeerAddress.has(normalizedAddress)) {
            dmsByPeerAddress.set(normalizedAddress, []);
          }
          dmsByPeerAddress.get(normalizedAddress)!.push({
            convId,
            peerInboxId: metadata.peerInboxId,
            createdAtNs: (conv as unknown as { createdAtNs?: bigint })?.createdAtNs,
          });
        }

        // Only show conversations that have displayable messages
        if (metadata.lastMessagePreview || convId === selectedId) {
          filteredIds.push(convId);
        }
      }

      // Log any duplicate DMs (same peer address, multiple conversations)
      for (const [peerAddress, convs] of dmsByPeerAddress) {
        if (convs.length > 1) {
          console.warn('[StreamManager] DUPLICATE DMs detected for', peerAddress, convs.map(c => ({
            convId: c.convId,
            peerInboxId: c.peerInboxId,
            createdAtNs: c.createdAtNs?.toString(),
          })));
        }
      }

      // Sort by last activity (most recent first)
      filteredIds.sort((a, b) => {
        const metaA = this.conversationMetadata.get(a);
        const metaB = this.conversationMetadata.get(b);
        if (!metaA || !metaB) return 0;
        // Selected conversation with no messages goes to top
        if (a === selectedId && !metaA.lastMessagePreview) return -1;
        if (b === selectedId && !metaB.lastMessagePreview) return 1;
        return Number(metaB.lastActivityNs - metaA.lastActivityNs);
      });

      // Update with sorted/filtered list and trigger re-render
      store.set(conversationIdsAtom, filteredIds);
      this.incrementMetadataVersion();

      // Save any newly initialized lastReadTimestamps
      this.saveLastReadTimestamps();

      // Update badge with initial unread count
      this.updateTabTitle();

      // Schedule metadata version bumps to ensure React components
      // that mounted during the load will re-render with fresh data
      setTimeout(() => {
        this.incrementMetadataVersion();
      }, 100);
      setTimeout(() => {
        this.incrementMetadataVersion();
      }, 500);

      return hasCachedConversations;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[StreamManager] Failed to load conversations:', errorMsg);
      console.error('[StreamManager] Full error:', error);
      store.set(conversationsErrorAtom, error instanceof Error ? error : new Error('Failed to load'));
      store.set(isLoadingConversationsAtom, false);
      return false;
    }
  }

  /**
   * One-time initial sync - runs once after app load
   * After this, we rely entirely on streams for updates
   *
   * Strategy: Sync Allowed conversations first (priority), then Unknown
   * Individual conversation sync only happens when entering that conversation
   */
  private async performInitialSync(): Promise<void> {
    if (!this.client || this.initialSyncDone) return;

    this.initialSyncDone = true;
    store.set(isSyncingConversationsAtom, true);

    try {
      // Request message history from other devices (cross-device sync)
      await this.client.sendSyncRequest();

      // First sync preferences to pull in consent state from other devices
      await this.client.preferences.sync();

      // Sync conversation list from network
      await this.client.conversations.sync();

      // Priority 1: Sync Allowed conversations first (these are the important ones)
      await this.client.conversations.syncAll([ConsentState.Allowed]);

      // Priority 2: Sync Unknown conversations (message requests)
      await this.client.conversations.syncAll([ConsentState.Unknown]);

      // Trigger re-render after syncing requests (important for fresh installs)
      this.incrementMetadataVersion();

      // Re-list to get any new conversations
      const conversations = await this.client.conversations.list({
        consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      });

      const currentIds = store.get(conversationIdsAtom);
      const currentIdSet = new Set(currentIds);
      const allIds = [...currentIds];

      // Rebuild metadata from local DB (no per-conversation sync - too expensive)
      // Individual conversations sync when user opens them
      for (const conv of conversations) {
        this.conversations.set(conv.id, conv);

        // Build metadata from local DB only (shouldSync=false)
        const metadata = await this.buildConversationMetadata(conv, false);
        this.conversationMetadata.set(conv.id, metadata);

        // Add to list if it has messages and isn't already in the list
        const selectedId = store.get(selectedConversationIdAtom);
        if (!currentIdSet.has(conv.id) && (metadata.lastMessagePreview || conv.id === selectedId)) {
          allIds.push(conv.id);
          currentIdSet.add(conv.id);
        }
      }

      // Filter out any conversations without displayable messages (but keep selected)
      const selectedId = store.get(selectedConversationIdAtom);
      const filteredIds = allIds.filter(id => {
        const meta = this.conversationMetadata.get(id);
        return (meta && meta.lastMessagePreview) || id === selectedId;
      });

      // Sort and update
      filteredIds.sort((a, b) => {
        const metaA = this.conversationMetadata.get(a);
        const metaB = this.conversationMetadata.get(b);
        if (!metaA || !metaB) return 0;
        return Number(metaB.lastActivityNs - metaA.lastActivityNs);
      });

      store.set(conversationIdsAtom, filteredIds);
      store.set(isLoadingConversationsAtom, false);
      this.incrementMetadataVersion();
      this.saveLastReadTimestamps();

      // Update badge with synced unread counts
      this.updateTabTitle();

      // Refresh messages for any conversations that were already opened
      await this.refreshLoadedConversations();

      // Schedule metadata version bumps to ensure React components
      // that mounted after the sync started will re-render with fresh data
      // Multiple bumps at different intervals to catch components mounting at various times
      setTimeout(() => {
        this.incrementMetadataVersion();
      }, 100);
      setTimeout(() => {
        this.incrementMetadataVersion();
      }, 500);
      setTimeout(() => {
        this.incrementMetadataVersion();
      }, 1000);

      // Mark sync as complete
      store.set(isSyncingConversationsAtom, false);
    } catch (error) {
      console.error('[StreamManager] Initial sync error:', error);
      store.set(isLoadingConversationsAtom, false);
      store.set(isSyncingConversationsAtom, false);
      // Check for database corruption
      this.checkForDatabaseCorruption(error);
      // Note: We intentionally don't clear session on errors here - that's the auth layer's job
      // StreamManager should never clear session or redirect, just log errors
    }
  }

  // Track if requests have been synced
  private requestsSynced = false;

  /**
   * Sync message requests (Unknown consent conversations)
   * Call this when user opens the Requests tab to prioritize syncing those
   */
  async syncMessageRequests(): Promise<void> {
    if (!this.client || this.requestsSynced) return;

    this.requestsSynced = true;

    try {
      // Sync Unknown conversations specifically
      await this.client.conversations.syncAll([ConsentState.Unknown]);

      // Re-list Unknown conversations
      const unknownConversations = await this.client.conversations.list({
        consentStates: [ConsentState.Unknown],
      });

      // Rebuild metadata for these conversations
      for (const conv of unknownConversations) {
        this.conversations.set(conv.id, conv);
        const metadata = await this.buildConversationMetadata(conv, false);
        this.conversationMetadata.set(conv.id, metadata);

        // Add to list if not already there and has messages
        const currentIds = store.get(conversationIdsAtom);
        if (!currentIds.includes(conv.id) && metadata.lastMessagePreview) {
          store.set(conversationIdsAtom, [...currentIds, conv.id]);
        }
      }

      this.incrementMetadataVersion();
      this.resortConversations();

    } catch (error) {
      console.error('[StreamManager] Message requests sync error:', error);
    }
  }

  /**
   * Refresh messages for conversations that were already loaded
   * Called after sync to pick up any messages that were synced
   */
  private async refreshLoadedConversations(): Promise<void> {
    if (!this.client) return;

    const loadedIds = Array.from(this.loadedMessageConversations);
    if (loadedIds.length === 0) return;

    for (const conversationId of loadedIds) {
      try {
        const conv = this.conversations.get(conversationId);
        if (!conv) continue;

        // Fetch messages from local DB (sync already populated it)
        const messages = await conv.messages({
          limit: BigInt(BACKGROUND_REFRESH_LIMIT),
          direction: SortDirection.Descending,
        });

        // Find messages we don't have yet
        const currentIds = this.getMessageIds(conversationId);
        const currentIdSet = new Set(currentIds);
        const newMessageIds: string[] = [];

        for (const msg of messages) {
          const typeId = (msg as { contentType?: { typeId?: string } }).contentType?.typeId;

          // Handle read receipts
          if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT)) {
            if (msg.senderInboxId !== this.client?.inboxId) {
              // Peer read receipt - update to show "Read" on our sent messages
              this.updateReadReceipt(conversationId, msg.sentAtNs);
            } else {
              // Own read receipt from another device - sync our read state
              this.syncOwnReadReceipt(conversationId, msg.sentAtNs);
            }
            continue;
          }

          // Process reactions
          if (matchesContentType(typeId, CONTENT_TYPE_REACTION)) {
            await this.processReaction(msg as unknown as DecodedMessage);
            continue;
          }

          // Try to decode raw remote attachments
          if (typeId === CONTENT_TYPE_REMOTE_ATTACHMENT) {
            await tryDecodeRawRemoteAttachment(msg);
          }

          if (!currentIdSet.has(msg.id)) {
            messageCache.set(msg.id, msg as unknown as DecodedMessage);
            newMessageIds.push(msg.id);
          }
        }

        if (newMessageIds.length > 0) {
          // Messages from SDK are already in correct sequence order (MLS protocol order)
          // Don't re-sort by sentAtNs as device clocks may differ
          // Build ordered list from the messages we already fetched
          const orderedIds: string[] = [];
          for (const msg of messages) {
            const typeId = (msg as { contentType?: { typeId?: string } }).contentType?.typeId;
            if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT) || matchesContentType(typeId, CONTENT_TYPE_REACTION)) {
              continue;
            }
            orderedIds.push(msg.id);
          }
          this.setMessageIds(conversationId, orderedIds);
        }
      } catch {
        // Ignore refresh errors - messages will sync via stream
      }
    }
  }

  /**
   * Increment metadata version to trigger UI updates
   */
  private incrementMetadataVersion(): void {
    const current = store.get(conversationMetadataVersionAtom);
    store.set(conversationMetadataVersionAtom, current + 1);
  }

  /**
   * Ensure a conversation is visible in the list (e.g., newly created conversation)
   * Call this when selecting a conversation that might not have messages yet
   * @deprecated Use registerNewConversation instead for newly created conversations
   */
  ensureConversationVisible(conversationId: string): void {
    const currentIds = store.get(conversationIdsAtom);
    if (!currentIds.includes(conversationId)) {
      // Add to front of list
      store.set(conversationIdsAtom, [conversationId, ...currentIds]);
      this.incrementMetadataVersion();
    }
  }

  /**
   * Register a newly created conversation
   * Stores the conversation, builds metadata, and adds to visible list
   * Use this after creating a conversation with newDmWithIdentifier
   */
  async registerNewConversation(conversation: Conversation): Promise<void> {
    const conversationId = conversation.id;

    // Store the conversation object for future use
    this.conversations.set(conversationId, conversation);

    // Build metadata (don't sync since it's a new conversation)
    const metadata = await this.buildConversationMetadata(conversation, false);
    this.conversationMetadata.set(conversationId, metadata);

    // Add to visible list if not already there
    const currentIds = store.get(conversationIdsAtom);
    if (!currentIds.includes(conversationId)) {
      store.set(conversationIdsAtom, [conversationId, ...currentIds]);
    }

    this.incrementMetadataVersion();

    // If already loaded, streams will handle any new messages
  }

  /**
   * Refresh metadata for a conversation (e.g., after adding/removing members)
   * Rebuilds the metadata from the conversation object
   */
  async refreshConversationMetadata(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      console.warn(`[StreamManager] Cannot refresh metadata - conversation ${conversationId} not found`);
      return;
    }

    // Skip if this conversation is currently syncing
    if (this.syncingConversations.has(conversationId)) {
      console.warn(`[StreamManager] Skipping metadata refresh - conversation ${conversationId} is syncing`);
      return;
    }

    try {
      // Sync the conversation to get latest member list
      if ('sync' in conversation) {
        await (conversation as unknown as { sync: () => Promise<unknown> }).sync();
      }

      // Rebuild metadata
      const metadata = await this.buildConversationMetadata(conversation, false);
      this.conversationMetadata.set(conversationId, metadata);
      this.incrementMetadataVersion();
    } catch (error) {
      console.error(`[StreamManager] Failed to refresh conversation metadata:`, error);
    }
  }

  /**
   * Check if a conversation is currently syncing
   */
  isConversationSyncing(conversationId: string): boolean {
    return this.syncingConversations.has(conversationId);
  }

  /**
   * Retry loading a conversation (clears state and tries again)
   */
  async retryConversation(conversationId: string): Promise<void> {
    this.syncingConversations.delete(conversationId);
    this.loadedMessageConversations.delete(conversationId);
    await this.loadMessagesForConversation(conversationId);
  }

  /**
   * Re-sort conversation IDs based on lastActivityNs
   * Called when metadata changes to keep list properly ordered
   */
  private resortConversations(): void {
    const currentIds = store.get(conversationIdsAtom);
    if (currentIds.length === 0) return;

    const selectedId = store.get(selectedConversationIdAtom);
    const sortedIds = [...currentIds].sort((a, b) => {
      const metaA = this.conversationMetadata.get(a);
      const metaB = this.conversationMetadata.get(b);
      if (!metaA || !metaB) return 0;
      // Selected conversation with no messages goes to top
      if (a === selectedId && !metaA.lastMessagePreview) return -1;
      if (b === selectedId && !metaB.lastMessagePreview) return 1;
      return Number(metaB.lastActivityNs - metaA.lastActivityNs);
    });

    // Only update if order actually changed
    const orderChanged = sortedIds.some((id, i) => id !== currentIds[i]);
    if (orderChanged) {
      store.set(conversationIdsAtom, sortedIds);
    }
  }

  /**
   * Build metadata for a conversation
   * @param conv - The conversation
   * @param shouldSync - Whether to sync before fetching messages (false for fast local load)
   */
  private async buildConversationMetadata(conv: Conversation, shouldSync: boolean = true): Promise<ConversationMetadata> {
    let conversationType: 'dm' | 'group' = 'dm';
    let peerAddress = '';
    let peerInboxId = '';
    let groupName: string | undefined;
    let groupImageUrl: string | undefined;
    let memberCount: number | undefined;
    let memberPreviews: MemberPreview[] | undefined;
    let lastMessagePreview = '';
    let lastActivityNs = BigInt(0);
    let unreadCount = 0;
    let consentState: 'allowed' | 'denied' | 'unknown' = 'unknown';
    let disappearingMessagesEnabled = false;
    let disappearingMessagesDurationNs: bigint | undefined;

    try {
      const isConvDm = isDm(conv);
      conversationType = isConvDm ? 'dm' : 'group';

      // Sync first if requested (skip for fast local load)
      // Use timeout to prevent hanging on forked groups
      if (shouldSync) {
        await withTimeout(conv.sync(), XMTP_OPERATION_TIMEOUT_MS, 'buildMetadata.sync');
      }

      // Parallelize all async calls for much faster metadata building
      // Wrap with timeout to prevent hanging on problematic conversations
      const [rawConsentState, members, messages, dmPeerInboxId, disappearingEnabled, disappearingSettings] = await withTimeout(
        Promise.all([
          conv.consentState(),
          conv.members(),
          conv.messages({
            limit: BigInt(MAX_MESSAGES_FOR_UNREAD_COUNT),
            direction: SortDirection.Descending,
          }),
          isConvDm ? conv.peerInboxId() : Promise.resolve(''),
          conv.isMessageDisappearingEnabled(),
          conv.messageDisappearingSettings(),
        ]),
        XMTP_OPERATION_TIMEOUT_MS,
        'buildMetadata.fetch'
      );

      // Process disappearing messages settings
      disappearingMessagesEnabled = disappearingEnabled;
      if (disappearingSettings && 'inNs' in disappearingSettings) {
        disappearingMessagesDurationNs = BigInt((disappearingSettings as { inNs: bigint }).inNs);
      }

      // Process consent state
      if (rawConsentState === ConsentState.Allowed) {
        consentState = 'allowed';
      } else if (rawConsentState === ConsentState.Denied) {
        consentState = 'denied';
      } else {
        consentState = 'unknown';
      }

      if (isConvDm) {
        // DM: Get peer info from parallel results
        peerInboxId = dmPeerInboxId;
        for (const member of members) {
          if (member.inboxId === peerInboxId && member.accountIdentifiers?.length) {
            peerAddress = member.accountIdentifiers[0].identifier;
            break;
          }
        }
      } else {
        // Group: Get group info
        const group = conv as Group;
        groupName = group.name;
        groupImageUrl = group.imageUrl;
        memberCount = members.length;
        // Include ALL members so we can look up sender addresses for messages
        // Avatar component will only use first 2 for the preview display
        memberPreviews = members.map((m) => ({
          inboxId: m.inboxId,
          address: m.accountIdentifiers?.[0]?.identifier ?? '',
        }));
        // Cache all member addresses for future lookups (even after removal)
        for (const member of memberPreviews) {
          if (member.address) {
            this.memberAddressCache.set(member.inboxId, member.address);
          }
        }
      }

      // Get last read timestamp for this conversation using SDK's lastReadTimes()
      // This syncs across devices automatically
      const nowNs = BigInt(Date.now()) * 1_000_000n;
      const ownInboxId = this.client?.inboxId;
      let lastReadTs: bigint;

      try {
        // SDK v6: Query lastReadTimes to get our own last read timestamp
        // This is synced across devices, giving accurate unread counts
        const lastReadTimes = await conv.lastReadTimes();
        const sdkLastRead = ownInboxId ? lastReadTimes.get(ownInboxId) : undefined;

        // Also find our most recent sent message - if we sent from another device,
        // that effectively means we've read everything up to that point
        let ourLatestSentTs = BigInt(0);
        if (ownInboxId) {
          for (const msg of messages) {
            if (msg.senderInboxId === ownInboxId && msg.sentAtNs > ourLatestSentTs) {
              ourLatestSentTs = msg.sentAtNs;
              break; // Messages are sorted desc, so first match is most recent
            }
          }
        }

        // Use the most recent of: SDK read time, our latest sent message, or local cache
        const localTs = this.lastReadTimestamps.get(conv.id);
        const candidates = [
          sdkLastRead ?? BigInt(0),
          ourLatestSentTs,
          localTs ?? BigInt(0),
        ];
        const maxTs = candidates.reduce((a, b) => a > b ? a : b, BigInt(0));

        if (maxTs > BigInt(0)) {
          lastReadTs = maxTs;
          this.lastReadTimestamps.set(conv.id, maxTs);
        } else {
          // First time seeing this conversation - mark as read up to now
          lastReadTs = nowNs;
          this.lastReadTimestamps.set(conv.id, nowNs);
        }

        // Also update peer read receipt while we have the data
        for (const [inboxId, timestamp] of lastReadTimes) {
          if (inboxId !== ownInboxId && timestamp > BigInt(0)) {
            this.updateReadReceipt(conv.id, timestamp);
            break; // For DMs, there's only one peer
          }
        }
      } catch {
        // Fall back to local timestamp on error
        const localTs = this.lastReadTimestamps.get(conv.id);
        lastReadTs = localTs ?? nowNs;
        if (!localTs) {
          this.lastReadTimestamps.set(conv.id, nowNs);
        }
      }

      // Find displayable messages for preview + count unread
      // Track both: first message from others (for unread preview) and first message overall (fallback)
      let firstOtherPreview = '';
      let firstOtherActivityNs = BigInt(0);
      let firstAnyPreview = '';
      let firstAnyActivityNs = BigInt(0);
      let firstAnyIsOwn = false;
      let firstAnySentAtNs = BigInt(0);

      // Helper to get sender name for preview
      const getSenderName = async (senderInboxId: string, isOwn: boolean): Promise<string> => {
        if (isOwn) return 'You';
        if (conversationType === 'dm' && peerAddress) {
          const record = await resolveAddress(peerAddress);
          return record?.username || `${peerAddress.slice(0, 6)}...`;
        }
        if (memberPreviews) {
          const member = memberPreviews.find(m => m.inboxId === senderInboxId);
          if (member?.address) {
            const record = await resolveAddress(member.address);
            return record?.username || `${member.address.slice(0, 6)}...`;
          }
        }
        return 'Someone';
      };

      for (const msg of messages) {
        const typeId = (msg as { contentType?: { typeId?: string } }).contentType?.typeId;
        // Defensive: only mark as own message if we can properly identify (ownInboxId is set)
        const isOwnMessage = ownInboxId ? msg.senderInboxId === ownInboxId : false;

        // Skip read receipts entirely
        if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT)) continue;

        // Count unread: messages from others that are newer than lastReadTs
        // Only count if we can properly identify own messages (ownInboxId must be set)
        if (ownInboxId && !isOwnMessage && msg.sentAtNs > lastReadTs) {
          unreadCount++;
        }

        // Extract preview content for this message
        let previewText = '';
        let previewActivityNs = BigInt(0);

        if (matchesContentType(typeId, CONTENT_TYPE_REACTION)) {
          const reactionContent = await tryDecodeReaction(msg as unknown as {
            content: unknown;
            contentType?: { typeId?: string };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            encodedContent?: any;
          });
          if (reactionContent) {
            const reactorName = await getSenderName(msg.senderInboxId, isOwnMessage);
            previewText = `${reactorName} reacted ${reactionContent.content}`;
            previewActivityNs = msg.sentAtNs;
          }
        } else {
          const content = extractMessageContent(msg);
          if (content) {
            // Format image/multi-image previews with sender name
            if (content === 'Image' || content === 'Multiple images' || content.startsWith('Image:')) {
              const senderName = await getSenderName(msg.senderInboxId, isOwnMessage);
              previewText = content === 'Multiple images'
                ? `${senderName} sent images`
                : `${senderName} sent an image`;
            } else {
              previewText = content;
            }
            previewActivityNs = msg.sentAtNs;
          }
        }

        // Track first message from others (for unread preview)
        if (previewText && !isOwnMessage && !firstOtherPreview) {
          firstOtherPreview = previewText;
          firstOtherActivityNs = previewActivityNs;
        }

        // Track first message overall (fallback when no unreads)
        if (previewText && !firstAnyPreview) {
          firstAnyPreview = previewText;
          firstAnyActivityNs = previewActivityNs;
          firstAnyIsOwn = isOwnMessage;
          firstAnySentAtNs = msg.sentAtNs;
        }

        // Track activity time even without displayable content
        if (previewActivityNs > lastActivityNs) {
          lastActivityNs = previewActivityNs;
        }
      }

      // If the most recent message is our own (sent from any device), mark conversation as read
      // This handles the case where we sent a message from another installation
      if (firstAnyIsOwn && firstAnySentAtNs > BigInt(0)) {
        unreadCount = 0;
        // Update lastReadTs so future calculations are correct
        if (firstAnySentAtNs > lastReadTs) {
          this.lastReadTimestamps.set(conv.id, firstAnySentAtNs);
        }
      }

      // Always show the most recent message as preview
      // The unread count/badge is separate from the preview display
      // This ensures that if you sent a message (on any device), your message shows as preview
      if (firstAnyPreview) {
        lastMessagePreview = firstAnyPreview;
        lastActivityNs = firstAnyActivityNs;
      }
    } catch (error) {
      console.error('[StreamManager] Error building metadata for', conv.id, error);
    }

    return {
      id: conv.id,
      conversationType,
      peerAddress,
      peerInboxId,
      groupName,
      groupImageUrl,
      memberCount,
      memberPreviews,
      lastMessagePreview,
      lastActivityNs,
      unreadCount,
      consentState,
      disappearingMessagesEnabled,
      disappearingMessagesDurationNs,
    };
  }

  /**
   * Start streaming new conversations (only allowed ones)
   * Automatically restarts on crash with exponential backoff
   */
  private startConversationStream(): void {
    if (!this.client) return;

    // Abort existing stream if any
    this.conversationStreamController?.abort();
    this.conversationStreamController = new AbortController();
    const signal = this.conversationStreamController.signal;

    const stream = async () => {
      try {
        const streamProxy = await this.client!.conversations.stream();

        // Reset restart counter on successful connection
        this.conversationStreamRestarts = 0;

        for await (const conv of streamProxy as AsyncIterable<Conversation>) {
          if (signal.aborted) break;

          console.log('[StreamManager] Conversation stream received:', conv.id, isDm(conv) ? 'DM' : 'Group');

          // Check consent state - only show Allowed conversations in the list
          // But sync Unknown ones too in case consent changed on another device
          // Use timeout to prevent hanging on problematic conversations
          let consentState = ConsentState.Unknown;
          try {
            consentState = await withTimeout(
              conv.consentState(),
              XMTP_OPERATION_TIMEOUT_MS,
              'stream.consentState'
            );
          } catch {
            // Timeout or error - default to Unknown so user can see the conversation
            console.warn('[StreamManager] Consent check timed out for streamed conversation', conv.id);
          }

          // Store the conversation regardless of consent
          this.conversations.set(conv.id, conv);
          // New streamed conversations - sync to get initial messages
          const metadata = await this.buildConversationMetadata(conv, true);
          const isNewConversation = !this.conversationMetadata.has(conv.id);
          this.conversationMetadata.set(conv.id, metadata);

          // Always increment version for new conversations so message requests get picked up
          if (isNewConversation) {
            this.incrementMetadataVersion();
          }

          // Check for existing DM with same peer address
          if (metadata.conversationType === 'dm') {
            const existingDm = this.findExistingDmByPeerAddress(metadata.peerAddress);
            if (existingDm && existingDm.convId !== conv.id) {
              console.warn('[StreamManager] DUPLICATE DM detected in stream!', {
                newConvId: conv.id,
                existingConvId: existingDm.convId,
                peerAddress: metadata.peerAddress,
              });
            }
          }

          // Add to visible list if:
          // 1. Consent is Allowed or Unknown (show new conversations so user can respond)
          // 2. It has displayable messages or is selected
          const selectedId = store.get(selectedConversationIdAtom);
          const hasValidConsent = consentState === ConsentState.Allowed || consentState === ConsentState.Unknown;
          const shouldShow = hasValidConsent &&
            (metadata.lastMessagePreview || conv.id === selectedId);

          console.log('[StreamManager] Conversation stream decision:', {
            id: conv.id,
            hasValidConsent,
            lastMessagePreview: metadata.lastMessagePreview?.slice(0, 50),
            isSelected: conv.id === selectedId,
            shouldShow,
            isNewConversation,
          });

          if (shouldShow) {
            const currentIds = store.get(conversationIdsAtom);
            if (!currentIds.includes(conv.id)) {
              console.log('[StreamManager] Adding conversation to list:', conv.id);
              store.set(conversationIdsAtom, [conv.id, ...currentIds]);
              this.incrementMetadataVersion();
            }
          }
        }
      } catch (error) {
        if (signal.aborted) return; // Intentional abort, don't restart

        // Check for database corruption
        if (this.checkForDatabaseCorruption(error)) {
          console.error('[StreamManager] Conversation stream stopped due to database corruption');
          return; // Don't restart if database is corrupted
        }

        // Attempt restart if under limit
        if (this.conversationStreamRestarts < MAX_STREAM_RESTARTS) {
          this.conversationStreamRestarts++;
          const delay = STREAM_RESTART_DELAY_MS * this.conversationStreamRestarts;

          setTimeout(() => {
            if (!signal.aborted && this.client && !this.databaseCorrupted) {
              this.startConversationStream();
            }
          }, delay);
        }
      }
    };

    stream();
  }

  // Pending updates to batch together
  private pendingMessageUpdates = new Map<string, string[]>();
  private pendingPaginationUpdates = new Map<string, PaginationState>();
  private updateScheduled = false;

  /**
   * Flush all pending updates in a single batch
   */
  private flushUpdates(): void {
    if (!this.updateScheduled) return;
    this.updateScheduled = false;

    // Batch message ID updates
    if (this.pendingMessageUpdates.size > 0) {
      const current = store.get(allConversationMessageIdsAtom);
      const newMap = new Map(current);
      for (const [id, ids] of this.pendingMessageUpdates) {
        newMap.set(id, ids);
      }
      this.pendingMessageUpdates.clear();
      store.set(allConversationMessageIdsAtom, newMap);
    }

    // Batch pagination updates
    if (this.pendingPaginationUpdates.size > 0) {
      const current = store.get(allConversationPaginationAtom);
      const newMap = new Map(current);
      for (const [id, pagination] of this.pendingPaginationUpdates) {
        newMap.set(id, pagination);
      }
      this.pendingPaginationUpdates.clear();
      store.set(allConversationPaginationAtom, newMap);
    }
  }

  /**
   * Schedule updates to be flushed on next microtask
   */
  private scheduleFlush(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    queueMicrotask(() => this.flushUpdates());
  }

  /**
   * Helper to update message IDs in the Map-based atom (batched)
   */
  private setMessageIds(conversationId: string, ids: string[]): void {
    this.pendingMessageUpdates.set(conversationId, ids);
    this.scheduleFlush();
  }

  /**
   * Helper to update pagination in the Map-based atom (batched)
   */
  private setPagination(conversationId: string, pagination: PaginationState): void {
    this.pendingPaginationUpdates.set(conversationId, pagination);
    this.scheduleFlush();
  }

  /**
   * Helper to get pagination for a conversation
   */
  private getPagination(conversationId: string): PaginationState {
    const map = store.get(allConversationPaginationAtom);
    return map.get(conversationId) ?? { hasMore: true, oldestMessageNs: null, isLoading: false };
  }

  /**
   * Helper to get message IDs for a conversation
   */
  private getMessageIds(conversationId: string): string[] {
    const map = store.get(allConversationMessageIdsAtom);
    return map.get(conversationId) ?? [];
  }

  /**
   * Load messages for a conversation (called when user opens a conversation)
   *
   * Strategy:
   * 1. Try to load from local cache first (quick attempt)
   * 2. If that fails (epoch mismatch), start sync in background
   * 3. Show "syncing" state while sync runs
   * 4. When sync completes, reload messages
   * 5. Sync continues even if user switches conversations
   */
  async loadMessagesForConversation(conversationId: string): Promise<void> {
    if (!this.client) return;

    // Check if this conversation is already syncing in background
    const existingSync = this.syncingConversations.get(conversationId);
    if (existingSync) {
      console.log(`[StreamManager] Conversation ${conversationId} is already syncing, waiting...`);
      // Show syncing state
      this.setPagination(conversationId, {
        hasMore: true,
        oldestMessageNs: null,
        isLoading: false,
        isSyncing: true,
      });
      return;
    }

    // Check if already loaded
    if (this.loadedMessageConversations.has(conversationId)) {
      const currentIds = this.getMessageIds(conversationId);
      if (currentIds.length > 0) {
        return; // Already loaded with messages
      }
      this.loadedMessageConversations.delete(conversationId);
    }

    this.loadedMessageConversations.add(conversationId);

    try {
      const conv = this.conversations.get(conversationId)
        || await this.client.conversations.getConversationById(conversationId);

      if (!conv) {
        console.error('[StreamManager] Conversation not found:', conversationId);
        return;
      }

      this.conversations.set(conversationId, conv);

      // Try to load messages - this will fail quickly if epoch mismatch
      const loaded = await this.tryLoadMessages(conversationId, conv);

      if (!loaded) {
        // Messages couldn't load - need to sync first
        console.log(`[StreamManager] Starting background sync for ${conversationId}`);
        this.startBackgroundSync(conversationId, conv);
      }
    } catch (error) {
      console.error('[StreamManager] Failed to load messages:', error);
      this.setPagination(conversationId, {
        hasMore: false,
        oldestMessageNs: null,
        isLoading: false,
        error: 'Failed to load messages',
      });
    }
  }

  /**
   * Try to load messages from local cache (quick attempt)
   * Returns true if successful, false if sync needed
   */
  private async tryLoadMessages(conversationId: string, conv: Conversation): Promise<boolean> {
    const displayableIds: string[] = [];
    let oldestMessageNs: bigint | null = null;
    let hasMore = true;
    let iterations = 0;

    try {
      while (displayableIds.length < MIN_DISPLAYABLE_MESSAGES && hasMore && iterations < MAX_FETCH_ITERATIONS) {
        iterations++;

        // Quick timeout - if messages don't load fast, we need to sync
        const messagesPromise = conv.messages({
          limit: BigInt(BATCH_SIZE),
          sentBeforeNs: oldestMessageNs ?? undefined,
          direction: SortDirection.Descending,
        });
        const messages = await withTimeout(messagesPromise, XMTP_OPERATION_TIMEOUT_MS, 'conv.messages');

        if (messages.length === 0) {
          hasMore = false;
          break;
        }

        for (const msg of messages) {
          const typeId = (msg as { contentType?: { typeId?: string } }).contentType?.typeId;

          if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT)) {
            if (msg.senderInboxId !== this.client?.inboxId) {
              this.updateReadReceipt(conversationId, msg.sentAtNs);
            } else {
              this.syncOwnReadReceipt(conversationId, msg.sentAtNs);
            }
            continue;
          }

          if (matchesContentType(typeId, CONTENT_TYPE_REACTION)) {
            await this.processReaction(msg as unknown as DecodedMessage);
            continue;
          }

          if (typeId === CONTENT_TYPE_REMOTE_ATTACHMENT) {
            await tryDecodeRawRemoteAttachment(msg);
          }

          messageCache.set(msg.id, msg as unknown as DecodedMessage);
          displayableIds.push(msg.id);

          const msgWithReactions = msg as unknown as { reactions?: DecodedMessage<Reaction>[] };
          if (msgWithReactions.reactions && msgWithReactions.reactions.length > 0) {
            this.storeInlineReactions(msg.id, msgWithReactions.reactions);
          }
        }

        oldestMessageNs = messages[messages.length - 1].sentAtNs;
        hasMore = messages.length === BATCH_SIZE;
      }

      const version = store.get(reactionsVersionAtom);
      store.set(reactionsVersionAtom, version + 1);

      this.setMessageIds(conversationId, displayableIds);
      this.setPagination(conversationId, {
        hasMore,
        oldestMessageNs,
        isLoading: false,
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const needsSync = errorMessage.includes('timed out') || errorMessage.includes('epoch');

      if (needsSync) {
        console.log(`[StreamManager] Messages load failed, sync needed: ${errorMessage}`);
        return false;
      }

      // Other error - show error state
      this.setPagination(conversationId, {
        hasMore: false,
        oldestMessageNs: null,
        isLoading: false,
        error: errorMessage,
      });
      return true; // Don't retry sync for non-epoch errors
    }
  }

  /**
   * Start syncing a conversation in background
   * Continues even if user switches conversations
   */
  private startBackgroundSync(conversationId: string, conv: Conversation): void {
    // Show syncing state immediately
    this.setPagination(conversationId, {
      hasMore: true,
      oldestMessageNs: null,
      isLoading: false,
      isSyncing: true,
    });

    // Start sync and track the promise
    const syncPromise = (async () => {
      try {
        console.log(`[StreamManager] Syncing conversation ${conversationId}...`);

        // Let sync run without timeout - it needs to catch up on epochs
        await conv.sync();

        console.log(`[StreamManager] Sync complete for ${conversationId}, reloading messages`);

        // Sync complete - try loading messages again
        this.loadedMessageConversations.delete(conversationId);
        const loaded = await this.tryLoadMessages(conversationId, conv);

        if (!loaded) {
          // Still can't load after sync - show error
          this.setPagination(conversationId, {
            hasMore: false,
            oldestMessageNs: null,
            isLoading: false,
            isSyncing: false,
            error: 'Failed to load messages after sync',
          });
        }
      } catch (error) {
        console.error(`[StreamManager] Sync failed for ${conversationId}:`, error);
        this.setPagination(conversationId, {
          hasMore: false,
          oldestMessageNs: null,
          isLoading: false,
          isSyncing: false,
          error: 'Sync failed. Try leaving and rejoining the group.',
        });
      } finally {
        this.syncingConversations.delete(conversationId);
      }
    })();

    this.syncingConversations.set(conversationId, syncPromise);
  }

  /**
   * Load more (older) messages for a conversation
   * Keeps fetching until we have MIN_LOADMORE_MESSAGES displayable messages
   */
  async loadMoreMessages(conversationId: string): Promise<void> {
    const pagination = this.getPagination(conversationId);
    if (!this.client || pagination.isLoading || !pagination.hasMore) return;

    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    this.setPagination(conversationId, {
      ...pagination,
      isLoading: true,
    });

    try {
      const currentIds = this.getMessageIds(conversationId);
      const newDisplayableIds: string[] = [];
      let oldestMessageNs = pagination.oldestMessageNs;
      let hasMore = true;
      let iterations = 0;

      // Keep fetching until we have enough displayable messages
      while (newDisplayableIds.length < MIN_LOADMORE_MESSAGES && hasMore && iterations < MAX_FETCH_ITERATIONS) {
        iterations++;

        let messages;
        try {
          messages = await withTimeout(
            conv.messages({
              limit: BigInt(BATCH_SIZE),
              sentBeforeNs: oldestMessageNs ?? undefined,
              direction: SortDirection.Descending,
            }),
            XMTP_OPERATION_TIMEOUT_MS,
            'loadMore.messages'
          );
        } catch (error) {
          // Timeout - stop trying to load more
          console.warn('[StreamManager] Load more messages timed out for', conversationId);
          hasMore = false;
          break;
        }

        if (messages.length === 0) {
          hasMore = false;
          break;
        }

        for (const msg of messages) {
          const typeId = (msg as { contentType?: { typeId?: string } }).contentType?.typeId;

          // Process reactions (but don't display as messages)
          if (matchesContentType(typeId, CONTENT_TYPE_REACTION)) {
            await this.processReaction(msg as unknown as DecodedMessage);
            continue;
          }

          // Skip read receipts
          if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT)) {
            continue;
          }

          // Try to decode raw remote attachments
          if (typeId === CONTENT_TYPE_REMOTE_ATTACHMENT) {
            await tryDecodeRawRemoteAttachment(msg);
          }

          // This is a displayable message
          if (!messageCache.has(msg.id)) {
            messageCache.set(msg.id, msg as unknown as DecodedMessage);
            newDisplayableIds.push(msg.id);

            // Extract inline reactions from SDK v6.1.0 (message.reactions)
            const msgWithReactions = msg as unknown as { reactions?: DecodedMessage<Reaction>[] };
            if (msgWithReactions.reactions && msgWithReactions.reactions.length > 0) {
              this.storeInlineReactions(msg.id, msgWithReactions.reactions);
            }
          }
        }

        oldestMessageNs = messages[messages.length - 1].sentAtNs;
        hasMore = messages.length === BATCH_SIZE;
      }

      // Trigger reactions update if any were extracted
      const version = store.get(reactionsVersionAtom);
      store.set(reactionsVersionAtom, version + 1);

      // Append to end (older messages go after current ones in our descending list)
      this.setMessageIds(conversationId, [...currentIds, ...newDisplayableIds]);
      this.setPagination(conversationId, {
        hasMore,
        oldestMessageNs,
        isLoading: false,
      });
    } catch (error) {
      console.error('[StreamManager] Failed to load more messages:', error);
      this.setPagination(conversationId, {
        ...pagination,
        isLoading: false,
      });
    }
  }

  /**
   * Start streaming messages from ALL conversations
   * Uses streamAllMessages for efficiency instead of per-conversation streams
   */
  private startAllMessagesStream(): void {
    if (!this.client) return;

    // Abort existing stream if any
    this.allMessagesStreamController?.abort();
    this.allMessagesStreamController = new AbortController();
    const signal = this.allMessagesStreamController.signal;

    const stream = async () => {
      try {
        // Stream both Allowed AND Unknown - we'll handle consent inline
        // This catches conversations where consent changed on another device
        const streamProxy = await this.client!.conversations.streamAllMessages({
          consentStates: [ConsentState.Allowed, ConsentState.Unknown],
        });

        // Reset restart counter on successful connection
        this.allMessagesStreamRestarts = 0;

        for await (const msg of streamProxy as AsyncIterable<{ id: string; conversationId: string; content: unknown; sentAtNs: bigint; senderInboxId: string; contentType?: { typeId?: string; authorityId?: string }; kind?: string }>) {
          if (signal.aborted) break;

          const conversationId = msg.conversationId;
          const hasMetadata = this.conversationMetadata.has(conversationId);
          console.log('[StreamManager] Message stream received:', {
            msgId: msg.id.slice(0, 20),
            conversationId: conversationId.slice(0, 20),
            hasExistingMetadata: hasMetadata,
            isOwnMessage: msg.senderInboxId === this.client?.inboxId,
          });

          // Handle read receipts
          const typeId = msg.contentType?.typeId;

          if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT)) {
            if (msg.senderInboxId !== this.client?.inboxId) {
              // Peer read receipt - update to show "Read" on our sent messages
              this.updateReadReceipt(conversationId, msg.sentAtNs);
            } else {
              // Own read receipt from another device - sync our read state
              this.syncOwnReadReceipt(conversationId, msg.sentAtNs);
            }
            continue;
          }

          // Handle reaction messages
          if (matchesContentType(typeId, CONTENT_TYPE_REACTION)) {
            await this.processReaction(msg as unknown as DecodedMessage, true);
            continue;
          }

          // Handle membership change messages
          // Check for both numeric enum value (GroupMessageKind.MembershipChange = 1) and string
          // Cast to unknown first to handle the type mismatch
          const msgKind = msg.kind as unknown;
          const isMembershipChange =
            msgKind === GroupMessageKind.MembershipChange ||
            msgKind === 'membership_change' ||
            msgKind === 1;

          if (isMembershipChange) {
            await this.processMembershipChange(msg, conversationId);
            continue;
          }

          // Skip if we already have this message
          if (messageCache.has(msg.id)) continue;

          // Try to decode raw remote attachments (shouldn't be needed for streaming, but just in case)
          if (typeId === CONTENT_TYPE_REMOTE_ATTACHMENT) {
            await tryDecodeRawRemoteAttachment(msg);
          }

          messageCache.set(msg.id, msg as unknown as DecodedMessage);

          // Extract inline reactions from SDK v6.1.0 (message.reactions)
          const msgWithReactions = msg as unknown as { reactions?: DecodedMessage<Reaction>[] };
          if (msgWithReactions.reactions && msgWithReactions.reactions.length > 0) {
            this.storeInlineReactions(msg.id, msgWithReactions.reactions);
          }

          // Prepend to list
          const currentIds = this.getMessageIds(conversationId);
          if (!currentIds.includes(msg.id)) {
            this.setMessageIds(conversationId, [msg.id, ...currentIds]);
          }

          // Update conversation metadata
          let metadata = this.conversationMetadata.get(conversationId);

          // If we don't have metadata for this conversation, try to fetch and create it
          // This can happen when a message arrives before initial sync completes,
          // or for conversations that were filtered out due to consent state
          if (!metadata && this.client) {
            try {
              let conv = this.conversations.get(conversationId);

              if (!conv) {
                // Try to sync this specific conversation first (with timeout to prevent hangs)
                try {
                  await withTimeout(
                    this.client.conversations.sync(),
                    XMTP_OPERATION_TIMEOUT_MS,
                    'messageStream.conversationsSync'
                  );
                } catch {
                  // Sync failed or timed out, continue anyway
                }
                conv = await this.client.conversations.getConversationById(conversationId);
              }

              if (conv) {
                // Store the conversation for future use
                this.conversations.set(conversationId, conv);

                // Build metadata for this conversation
                metadata = await this.buildConversationMetadata(conv, false);
                this.conversationMetadata.set(conversationId, metadata);
              } else {
                // Couldn't get conversation, create minimal metadata from message
                metadata = {
                  id: conversationId,
                  conversationType: 'dm',
                  peerAddress: '',
                  peerInboxId: msg.senderInboxId,
                  lastMessagePreview: '',
                  lastActivityNs: msg.sentAtNs,
                  unreadCount: 0,
                  consentState: 'unknown',
                  disappearingMessagesEnabled: false,
                };
                this.conversationMetadata.set(conversationId, metadata);
              }
            } catch {
              // Still create minimal metadata so the conversation shows up
              metadata = {
                id: conversationId,
                conversationType: 'dm',
                peerAddress: '',
                peerInboxId: msg.senderInboxId,
                lastMessagePreview: '',
                lastActivityNs: msg.sentAtNs,
                unreadCount: 0,
                consentState: 'unknown',
                disappearingMessagesEnabled: false,
              };
              this.conversationMetadata.set(conversationId, metadata);
            }

            // Always increment version for new conversations so message requests get picked up
            this.incrementMetadataVersion();
          }

          // Extract message content for preview
          const content = extractMessageContent(msg);

          if (metadata) {
            // Only update preview if this message is newer than current
            // This prevents sync'd older messages from overwriting newer previews
            if (msg.sentAtNs >= metadata.lastActivityNs) {
              if (content) {
                // Format image previews with sender name
                if (content === 'Image' || content === 'Multiple images' || content.startsWith('Image:')) {
                  const isOwnMsg = msg.senderInboxId === this.client?.inboxId;
                  let senderName = 'Someone';
                  if (isOwnMsg) {
                    senderName = 'You';
                  } else if (metadata.conversationType === 'dm' && metadata.peerAddress) {
                    const cached = getCachedUsername(metadata.peerAddress);
                    senderName = cached?.username || `${metadata.peerAddress.slice(0, 6)}...`;
                  } else if (metadata.memberPreviews) {
                    const member = metadata.memberPreviews.find(m => m.inboxId === msg.senderInboxId);
                    if (member?.address) {
                      const cached = getCachedUsername(member.address);
                      senderName = cached?.username || `${member.address.slice(0, 6)}...`;
                    }
                  }
                  metadata.lastMessagePreview = content === 'Multiple images'
                    ? `${senderName} sent images`
                    : `${senderName} sent an image`;
                } else {
                  metadata.lastMessagePreview = content;
                }
              }
              metadata.lastActivityNs = msg.sentAtNs;
            }
          }

          // Add to conversation list if not already there
          // Check consent: only add if Allowed OR if it's our own message (responded on another device)
          const currentConvIds = store.get(conversationIdsAtom);
          const hasDisplayableContent = content || (metadata && metadata.lastMessagePreview);
          const isOwnMsg = msg.senderInboxId === this.client?.inboxId;

          // Re-check consent state from the conversation (it may have changed on another device)
          // Use timeout to prevent hanging on problematic conversations
          const conv = this.conversations.get(conversationId);
          let hasValidConsent = false;
          if (conv) {
            try {
              const rawConsentState = await withTimeout(
                conv.consentState(),
                XMTP_OPERATION_TIMEOUT_MS,
                'messageStream.consentState'
              );
              // Show Allowed and Unknown (so users can see and respond to new conversations)
              hasValidConsent = rawConsentState === ConsentState.Allowed || rawConsentState === ConsentState.Unknown;

              // Update metadata's consent state to match actual state (critical for badge count)
              if (metadata) {
                if (rawConsentState === ConsentState.Allowed) {
                  metadata.consentState = 'allowed';
                } else if (rawConsentState === ConsentState.Denied) {
                  metadata.consentState = 'denied';
                } else {
                  metadata.consentState = 'unknown';
                }
              }
            } catch {
              // If we can't check or timeout, assume allowed if it's our own message
              hasValidConsent = isOwnMsg;
            }
          } else {
            // If we don't have the conversation, allow our own messages
            hasValidConsent = isOwnMsg;
          }

          // Add to list if: has content AND (valid consent OR own message)
          const shouldAdd = hasDisplayableContent && (hasValidConsent || isOwnMsg);

          if (!currentConvIds.includes(conversationId) && shouldAdd) {
            store.set(conversationIdsAtom, [conversationId, ...currentConvIds]);
            // Trigger UI update even if we don't have full metadata
            this.incrementMetadataVersion();
          }

          // Re-sort conversations to move this one to top (if in list or just added)
          if (currentConvIds.includes(conversationId) || hasDisplayableContent) {
            this.resortConversations();
          }

          if (metadata) {
            // Handle unread count and notifications for peer messages
            // Defensive: only count as own message if client.inboxId is available
            const ownInboxId = this.client?.inboxId;
            const isOwnMessage = ownInboxId ? msg.senderInboxId === ownInboxId : false;
            const selectedId = store.get(selectedConversationIdAtom);
            const isSelected = selectedId === conversationId;
            const tabVisible = isTabVisible();

            // Only increment unread if we can properly identify own messages
            if (ownInboxId && !isOwnMessage) {
              // Check if this message mentions the current user
              const wasMentioned = isMentioned(content || '', this.currentUserUsername);

              // Increment unread only if not viewing this conversation
              if (!isSelected) {
                metadata.unreadCount = (metadata.unreadCount ?? 0) + 1;
                // Track if user was mentioned in any unread message
                if (wasMentioned) {
                  metadata.hasMention = true;
                }
                const version = store.get(unreadVersionAtom);
                store.set(unreadVersionAtom, version + 1);
              }

              // Check if this conversation is muted
              const mutedIds = store.get(mutedConversationIdsAtom);
              const isConversationMuted = mutedIds.includes(conversationId);

              // Check if this is a message request and if request notifications are enabled
              const isMessageRequest = metadata.consentState === 'unknown';
              const requestNotificationsEnabled = store.get(messageRequestNotificationsAtom);

              // Show notification and update title if tab not visible
              // @mentions bypass conversation mute to ensure users don't miss direct mentions
              // Message requests only notify if the setting is enabled
              const shouldNotify = (!tabVisible || wasMentioned)
                && (!isConversationMuted || wasMentioned)
                && (!isMessageRequest || requestNotificationsEnabled);

              if (shouldNotify) {
                // Track messages received while tab is hidden
                this.hiddenTabMessageCount++;

                // Resolve sender name asynchronously for better UX
                (async () => {
                  let notificationTitle: string;
                  let notificationBody: string = content || 'New message';
                  let avatarUrl: string | undefined = metadata.groupImageUrl;

                  if (metadata.conversationType === 'group') {
                    // For groups: title is group name, body includes sender
                    notificationTitle = metadata.groupName || 'Group';

                    // Try to find sender's address from member previews
                    const senderMember = metadata.memberPreviews?.find(m => m.inboxId === msg.senderInboxId);
                    let senderName = 'Someone';

                    if (senderMember?.address) {
                      try {
                        const usernameRecord = await resolveAddress(senderMember.address);
                        if (usernameRecord?.username) {
                          senderName = usernameRecord.username;
                        } else {
                          senderName = `${senderMember.address.slice(0, 6)}...${senderMember.address.slice(-4)}`;
                        }
                      } catch {
                        senderName = `${senderMember.address.slice(0, 6)}...${senderMember.address.slice(-4)}`;
                      }
                    }

                    notificationBody = `${senderName}: ${content || 'New message'}`;
                  } else if (metadata.peerAddress) {
                    // For DMs: title is sender name
                    try {
                      const usernameRecord = await resolveAddress(metadata.peerAddress);
                      if (usernameRecord?.username) {
                        notificationTitle = usernameRecord.username;
                        avatarUrl = getAvatarUrl(usernameRecord.username);
                      } else {
                        notificationTitle = `${metadata.peerAddress.slice(0, 6)}...${metadata.peerAddress.slice(-4)}`;
                      }
                    } catch {
                      notificationTitle = `${metadata.peerAddress.slice(0, 6)}...${metadata.peerAddress.slice(-4)}`;
                    }
                  } else {
                    notificationTitle = 'Someone';
                  }

                  showMessageNotification({
                    conversationId,
                    senderName: notificationTitle,
                    messagePreview: notificationBody,
                    avatarUrl,
                  });
                  this.updateTabTitle();

                  // Start flashing the tab title to get user's attention
                  // Pass wasMentioned to bypass mute for @mentions
                  startTitleFlash(notificationTitle, false, wasMentioned);
                })();
              } else if (!isSelected) {
                // Tab visible but different conversation - still update title
                this.updateTabTitle();
              }
            }

            this.incrementMetadataVersion();
          }
        }
      } catch (error) {
        if (signal.aborted) return;

        // Check for database corruption
        if (this.checkForDatabaseCorruption(error)) {
          console.error('[StreamManager] Message stream stopped due to database corruption');
          return; // Don't restart if database is corrupted
        }

        if (this.allMessagesStreamRestarts < MAX_STREAM_RESTARTS) {
          this.allMessagesStreamRestarts++;
          const delay = STREAM_RESTART_DELAY_MS * this.allMessagesStreamRestarts;

          setTimeout(() => {
            if (!signal.aborted && this.client && !this.databaseCorrupted) {
              this.startAllMessagesStream();
            }
          }, delay);
        }
      }
    };

    stream();
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(conversationId: string, content: string): Promise<string | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !content.trim()) return null;

    try {
      const sentAtNs = BigInt(Date.now()) * 1_000_000n;
      const messageId = await conv.sendText(content.trim());

      // Add message to cache immediately for optimistic display
      // This prevents the 30+ second delay waiting for stream round-trip
      const optimisticMessage = {
        id: messageId,
        conversationId,
        content: content.trim(),
        senderInboxId: this.client?.inboxId ?? '',
        sentAtNs,
        contentType: { typeId: 'text', authorityId: 'xmtp.org' },
      };
      messageCache.set(messageId, optimisticMessage as unknown as DecodedMessage);

      // Add to message list
      const currentIds = this.getMessageIds(conversationId);
      if (!currentIds.includes(messageId)) {
        this.setMessageIds(conversationId, [messageId, ...currentIds]);
      }

      // Update conversation metadata with preview
      const metadata = this.conversationMetadata.get(conversationId);
      if (metadata) {
        metadata.lastMessagePreview = content.trim();
        metadata.lastActivityNs = sentAtNs;
        this.incrementMetadataVersion();
        this.resortConversations();
      }

      // Update read timestamp - sending implies we've read everything up to now
      // This helps sync read state across devices
      this.lastReadTimestamps.set(conversationId, sentAtNs);
      this.saveLastReadTimestamps();

      return messageId;
    } catch (error) {
      console.error('[StreamManager] Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Sync a conversation and refresh messages to pick up any new messages
   * including membership change messages from XMTP
   * Call this after add/remove member operations
   */
  async syncAndRefreshMessages(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    // Skip if this conversation is currently syncing
    if (this.syncingConversations.has(conversationId)) {
      console.warn(`[StreamManager] Skipping sync - conversation ${conversationId} is already syncing`);
      return;
    }

    try {
      // Sync the conversation to get latest messages from network
      // Use timeout to prevent hanging on problematic conversations
      await withTimeout(conv.sync(), XMTP_OPERATION_TIMEOUT_MS, 'refresh.sync');

      // Fetch recent messages including membership changes
      const messages = await withTimeout(
        conv.messages({
          limit: BigInt(20),
          direction: SortDirection.Descending,
        }),
        XMTP_OPERATION_TIMEOUT_MS,
        'refresh.messages'
      );

      const currentIds = this.getMessageIds(conversationId);
      const currentIdSet = new Set(currentIds);
      const newMessageIds: string[] = [];

      for (const msg of messages) {
        const typeId = (msg as { contentType?: { typeId?: string } }).contentType?.typeId;
        const msgKind = (msg as { kind?: unknown }).kind;

        // Skip read receipts
        if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT)) continue;

        // Skip reactions (they're processed separately)
        if (matchesContentType(typeId, CONTENT_TYPE_REACTION)) continue;

        // Check if this is a membership change message
        const isMembershipChange =
          msgKind === GroupMessageKind.MembershipChange ||
          msgKind === 'membership_change' ||
          msgKind === 1;

        if (isMembershipChange) {
          // Process membership change - creates synthetic status messages
          await this.processMembershipChange(
            msg as { id: string; conversationId: string; content: unknown; sentAtNs: bigint; senderInboxId: string },
            conversationId
          );
          continue;
        }

        // Add regular messages we don't have yet
        if (!currentIdSet.has(msg.id)) {
          messageCache.set(msg.id, msg as unknown as DecodedMessage);
          newMessageIds.push(msg.id);
        }
      }

      if (newMessageIds.length > 0) {
        // Messages from SDK are already in correct sequence order (MLS protocol order)
        // Don't re-sort by sentAtNs as device clocks may differ
        const orderedIds: string[] = [];
        for (const msg of messages) {
          const typeId = (msg as { contentType?: { typeId?: string } }).contentType?.typeId;
          const msgKind = (msg as { kind?: unknown }).kind;
          // Skip non-displayable types
          if (matchesContentType(typeId, CONTENT_TYPE_READ_RECEIPT) || matchesContentType(typeId, CONTENT_TYPE_REACTION)) {
            continue;
          }
          // Skip membership changes (handled separately)
          const isMembershipChange =
            msgKind === GroupMessageKind.MembershipChange ||
            msgKind === 'membership_change' ||
            msgKind === 1;
          if (isMembershipChange) continue;

          orderedIds.push(msg.id);
        }
        this.setMessageIds(conversationId, orderedIds);
      }
    } catch (error) {
      console.error('[StreamManager] Failed to sync and refresh messages:', error);
    }
  }

  /**
   * Send a reply to a message
   */
  async sendReply(
    conversationId: string,
    replyToMessageId: string,
    content: string,
    originalSenderInboxId?: string
  ): Promise<string | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !content.trim()) return null;

    try {
      const sentAtNs = BigInt(Date.now()) * 1_000_000n;

      // Encode the text content for the reply
      const encodedContent = await encodeText(content.trim());

      // Construct the Reply object for v6 API
      const reply: Reply = {
        reference: replyToMessageId,
        referenceInboxId: originalSenderInboxId,
        content: encodedContent,
      };

      // Use new v6 sendReply API
      const messageId = await conv.sendReply(reply);

      // Add message to cache immediately for optimistic display
      const optimisticMessage = {
        id: messageId,
        conversationId,
        content: reply,
        senderInboxId: this.client?.inboxId ?? '',
        sentAtNs,
        contentType: { typeId: 'reply', authorityId: 'xmtp.org' },
      };
      messageCache.set(messageId, optimisticMessage as unknown as DecodedMessage);

      // Add to message list immediately
      const currentIds = this.getMessageIds(conversationId);
      if (!currentIds.includes(messageId)) {
        this.setMessageIds(conversationId, [messageId, ...currentIds]);
      }

      // Update conversation metadata with preview
      const metadata = this.conversationMetadata.get(conversationId);
      if (metadata) {
        metadata.lastMessagePreview = content.trim();
        metadata.lastActivityNs = sentAtNs;
        this.incrementMetadataVersion();
        this.resortConversations();
      }

      // Update read timestamp - sending implies we've read everything up to now
      this.lastReadTimestamps.set(conversationId, sentAtNs);
      this.saveLastReadTimestamps();

      return messageId;
    } catch (error) {
      console.error('[StreamManager] Failed to send reply:', error);
      throw error;
    }
  }

  /**
   * Send a read receipt for a conversation
   * Call this when the user views/opens a conversation
   * Note: Skips groups with more than 5 members to reduce noise
   */
  async sendReadReceipt(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    try {
      // For groups, skip if more than 5 members to reduce noise
      if (!isDm(conv)) {
        const members = await conv.members();
        if (members.length > 5) {
          return;
        }
      }

      // Use new v6 sendReadReceipt API
      await conv.sendReadReceipt();
    } catch {
      // Read receipt failures are non-critical
    }
  }

  /**
   * Update the read receipt timestamp for a conversation
   * Called when we receive a read receipt from the peer
   */
  private updateReadReceipt(conversationId: string, timestampNs: bigint): void {
    const current = store.get(readReceiptsAtom);
    const existingTs = current.get(conversationId);

    // Only update if this is a newer timestamp
    if (!existingTs || timestampNs > existingTs) {
      const newMap = new Map(current);
      newMap.set(conversationId, timestampNs);
      store.set(readReceiptsAtom, newMap);

      // Persist to localStorage
      this.savePeerReadReceipts();

      // Increment version to trigger UI re-renders
      const version = store.get(readReceiptVersionAtom);
      store.set(readReceiptVersionAtom, version + 1);
    }
  }

  /**
   * Sync our own read receipt from another device
   * Called when we receive a read receipt from our own inboxId (cross-device sync)
   */
  private syncOwnReadReceipt(conversationId: string, timestampNs: bigint): void {
    const existingTs = this.lastReadTimestamps.get(conversationId);

    // Only update if this is a newer timestamp
    if (!existingTs || timestampNs > existingTs) {
      this.lastReadTimestamps.set(conversationId, timestampNs);
      this.saveLastReadTimestamps();

      // Update metadata to reflect 0 unread and clear mention flag
      const metadata = this.conversationMetadata.get(conversationId);
      if (metadata && (metadata.unreadCount > 0 || metadata.hasMention)) {
        metadata.unreadCount = 0;
        metadata.hasMention = false;
        // Trigger UI updates
        const unreadVersion = store.get(unreadVersionAtom);
        const metadataVersion = store.get(conversationMetadataVersionAtom);
        store.set(unreadVersionAtom, unreadVersion + 1);
        store.set(conversationMetadataVersionAtom, metadataVersion + 1);
        // Update tab title
        this.updateTabTitle();
      }
    }
  }

  /**
   * Check if a message was read by the peer
   * A message is considered "read" if it was sent before the peer's last read receipt
   */
  isMessageRead(conversationId: string, messageSentAtNs: bigint): boolean {
    const receipts = store.get(readReceiptsAtom);
    const lastReadTs = receipts.get(conversationId);
    if (!lastReadTs) {
      return false;
    }
    return messageSentAtNs <= lastReadTs;
  }

  /**
   * Get the read receipt timestamp for a conversation
   */
  getReadReceiptTimestamp(conversationId: string): bigint | undefined {
    const receipts = store.get(readReceiptsAtom);
    return receipts.get(conversationId);
  }

  /**
   * Query the SDK for last read times of all members in a conversation
   * Uses the v6 SDK's lastReadTimes() method for accurate read status
   * Returns the peer's last read time for DMs, or undefined if not available
   */
  async fetchLastReadTimes(conversationId: string): Promise<bigint | undefined> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !this.client) return undefined;

    try {
      // SDK v6 provides lastReadTimes() which returns Map<inboxId, timestamp>
      const lastReadTimes = await conv.lastReadTimes();
      const ownInboxId = this.client.inboxId;

      // For DMs, find the peer's last read time
      // For groups, we could aggregate but for now return the most recent non-self read
      let peerLastRead: bigint | undefined;

      for (const [inboxId, timestamp] of lastReadTimes) {
        if (inboxId !== ownInboxId) {
          if (!peerLastRead || timestamp > peerLastRead) {
            peerLastRead = timestamp;
          }
        }
      }

      // Update our read receipts atom if we got a newer timestamp
      if (peerLastRead) {
        this.updateReadReceipt(conversationId, peerLastRead);
      }

      return peerLastRead;
    } catch (error) {
      console.error('[StreamManager] Failed to fetch last read times:', error);
      return undefined;
    }
  }

  /**
   * Get metadata for a conversation
   */
  getConversationMetadata(conversationId: string): ConversationMetadata | undefined {
    return this.conversationMetadata.get(conversationId);
  }

  /**
   * Get all conversation metadata as a Map
   */
  getAllConversationMetadata(): Map<string, ConversationMetadata> {
    return new Map(this.conversationMetadata);
  }

  /**
   * Get conversation IDs with Unknown consent state (message requests)
   */
  getRequestConversationIds(): string[] {
    const requestIds: string[] = [];
    for (const [id, metadata] of this.conversationMetadata) {
      if (metadata.consentState === 'unknown') {
        requestIds.push(id);
      }
    }
    // Sort by last activity (most recent first)
    requestIds.sort((a, b) => {
      const metaA = this.conversationMetadata.get(a);
      const metaB = this.conversationMetadata.get(b);
      if (!metaA || !metaB) return 0;
      return Number(metaB.lastActivityNs - metaA.lastActivityNs);
    });
    return requestIds;
  }

  /**
   * Get count of message requests (Unknown consent conversations)
   */
  getRequestCount(): number {
    let count = 0;
    for (const metadata of this.conversationMetadata.values()) {
      if (metadata.consentState === 'unknown') {
        count++;
      }
    }
    return count;
  }

  /**
   * Get address for an inbox ID, looking up from XMTP if not cached
   * This persists even after members are removed from groups
   */
  async getAddressFromInboxId(inboxId: string): Promise<string | null> {
    // Check cache first
    const cached = this.memberAddressCache.get(inboxId);
    if (cached) return cached;

    // Look up from XMTP
    if (!this.client) return null;

    try {
      // Use type assertion since AnyClient type doesn't expose this method directly
      const clientWithMethod = this.client as unknown as {
        inboxStateFromInboxIds: (ids: string[], refresh: boolean) => Promise<Array<{
          identifiers?: Array<{ identifier: string; identifierKind: IdentifierKind }>;
        }>>;
      };
      const inboxStates = await clientWithMethod.inboxStateFromInboxIds([inboxId], false);
      if (inboxStates.length > 0) {
        const state = inboxStates[0];
        // Get first Ethereum identifier
        const ethIdentifier = state.identifiers?.find(
          (id) => id.identifierKind === IdentifierKind.Ethereum
        );
        if (ethIdentifier?.identifier) {
          // Cache it
          this.memberAddressCache.set(inboxId, ethIdentifier.identifier);
          return ethIdentifier.identifier;
        }
      }
    } catch (error) {
      console.error('[StreamManager] Failed to look up inbox ID:', error);
    }

    return null;
  }

  /**
   * Get cached address for an inbox ID (synchronous, no XMTP lookup)
   */
  getCachedAddress(inboxId: string): string | null {
    return this.memberAddressCache.get(inboxId) ?? null;
  }

  /**
   * Accept a conversation (set consent to Allowed)
   * Moves conversation from requests to main chat list
   */
  async acceptConversation(conversationId: string): Promise<boolean> {
    const conv = this.conversations.get(conversationId);
    if (!conv) {
      console.error('[StreamManager] Conversation not found:', conversationId);
      return false;
    }

    try {
      // Update consent state via XMTP
      await conv.updateConsentState(ConsentState.Allowed);

      // Update local metadata
      const metadata = this.conversationMetadata.get(conversationId);
      if (metadata) {
        metadata.consentState = 'allowed';
      }

      // Add to main conversation list if not already there
      // This is important for conversations without messages that were only in requests
      const currentIds = store.get(conversationIdsAtom);
      if (!currentIds.includes(conversationId)) {
        // Add at the top of the list
        store.set(conversationIdsAtom, [conversationId, ...currentIds]);
      }

      // Trigger UI update
      this.incrementMetadataVersion();

      return true;
    } catch (error) {
      console.error('[StreamManager] Failed to accept conversation:', error);
      return false;
    }
  }

  /**
   * Reject a conversation (set consent to Denied)
   * Removes conversation from both requests and main list
   */
  async rejectConversation(conversationId: string): Promise<boolean> {
    const conv = this.conversations.get(conversationId);
    if (!conv) {
      console.error('[StreamManager] Conversation not found:', conversationId);
      return false;
    }

    try {
      // Update consent state via XMTP
      await conv.updateConsentState(ConsentState.Denied);

      // Remove from metadata (no longer visible anywhere)
      this.conversationMetadata.delete(conversationId);

      // Remove from conversation IDs list
      const currentIds = store.get(conversationIdsAtom);
      const newIds = currentIds.filter(id => id !== conversationId);
      store.set(conversationIdsAtom, newIds);

      // Clear selection if this was selected
      const selectedId = store.get(selectedConversationIdAtom);
      if (selectedId === conversationId) {
        store.set(selectedConversationIdAtom, null);
      }

      // Trigger UI update
      this.incrementMetadataVersion();

      return true;
    } catch (error) {
      console.error('[StreamManager] Failed to reject conversation:', error);
      return false;
    }
  }

  /**
   * Check if a conversation is a message request (Unknown consent)
   */
  isMessageRequest(conversationId: string): boolean {
    const metadata = this.conversationMetadata.get(conversationId);
    return metadata?.consentState === 'unknown';
  }

  /**
   * Remove a conversation from the list (e.g., after leaving a group)
   */
  removeConversation(conversationId: string): void {
    // Remove from metadata
    this.conversationMetadata.delete(conversationId);

    // Remove from conversation IDs list
    const currentIds = store.get(conversationIdsAtom);
    const newIds = currentIds.filter(id => id !== conversationId);
    store.set(conversationIdsAtom, newIds);

    // Clear selection if this was selected
    const selectedId = store.get(selectedConversationIdAtom);
    if (selectedId === conversationId) {
      store.set(selectedConversationIdAtom, null);
    }

    // Trigger UI update
    this.incrementMetadataVersion();
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.client !== null;
  }

  /**
   * Process a membership change message from XMTP
   * Stores the original message for the UI to render appropriately
   * @param msg - The membership change message
   * @param conversationId - The conversation ID
   */
  private async processMembershipChange(
    msg: { id: string; conversationId: string; content: unknown; sentAtNs: bigint; senderInboxId: string },
    conversationId: string
  ): Promise<void> {
    // Skip if we already have this message
    if (messageCache.has(msg.id)) return;

    // Store the original XMTP membership change message
    // The UI (MessagePanel) will detect and render it appropriately
    const membershipMessage = {
      ...msg,
      // Mark this as a membership change for the UI to detect
      kind: GroupMessageKind.MembershipChange,
      contentType: { typeId: 'group_updated', authorityId: 'xmtp.org' },
    };

    messageCache.set(msg.id, membershipMessage as unknown as DecodedMessage);

    // Add to message list
    const currentIds = this.getMessageIds(conversationId);
    if (!currentIds.includes(msg.id)) {
      this.setMessageIds(conversationId, [msg.id, ...currentIds]);
    }

    // Refresh conversation metadata to update member list
    await this.refreshConversationMetadata(conversationId);

    // Update metadata version to trigger re-render
    this.incrementMetadataVersion();
  }

  /**
   * Extract and store inline reactions from a message
   * SDK v6.1.0 provides message.reactions: DecodedMessage<Reaction>[]
   * This extracts those inline reactions and adds them to reactionsAtom
   */
  private storeInlineReactions(messageId: string, reactions: DecodedMessage<Reaction>[]): void {
    if (!reactions || reactions.length === 0) return;

    // Use the extractReactions helper from types/messages.ts
    const displayReactions = extractReactions(reactions);
    if (displayReactions.length === 0) return;

    // Convert DisplayReaction[] to StoredReaction[]
    const storedReactions: StoredReaction[] = displayReactions.map(r => ({
      emoji: r.emoji,
      senderInboxId: r.senderInboxId,
      messageId: r.messageId,
    }));

    // Add to reactionsAtom
    const currentReactions = store.get(reactionsAtom);
    const existingReactions = currentReactions.get(messageId) ?? [];

    // Merge, avoiding duplicates
    const merged = [...existingReactions];
    for (const newReaction of storedReactions) {
      const exists = merged.some(
        r => r.emoji === newReaction.emoji && r.senderInboxId === newReaction.senderInboxId
      );
      if (!exists) {
        merged.push(newReaction);
      }
    }

    if (merged.length > existingReactions.length) {
      const newMap = new Map(currentReactions);
      newMap.set(messageId, merged);
      store.set(reactionsAtom, newMap);
      // Trigger re-render for reactions
      store.set(reactionsVersionAtom, store.get(reactionsVersionAtom) + 1);
    }
  }

  /**
   * Process an incoming reaction message
   * @param msg - The reaction message
   * @param fromStream - Whether this is from the live stream (triggers notifications)
   */
  private async processReaction(msg: DecodedMessage, fromStream: boolean = false): Promise<void> {
    // Try to decode the reaction content (handles both pre-decoded and raw messages)
    const content = await tryDecodeReaction(msg as unknown as {
      content: unknown;
      contentType?: { typeId?: string };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      encodedContent?: any;
    });

    if (!content) {
      return;
    }

    const targetMessageId = content.reference;
    const emoji = content.content;
    const action = content.action || 'added';
    const senderInboxId = msg.senderInboxId;
    const conversationId = (msg as unknown as { conversationId: string }).conversationId;

    const currentReactions = store.get(reactionsAtom);
    const messageReactions = currentReactions.get(targetMessageId) ?? [];

    if (action === 'added') {
      // Check if this exact reaction already exists
      const exists = messageReactions.some(
        r => r.emoji === emoji && r.senderInboxId === senderInboxId
      );
      if (!exists) {
        const newReaction: StoredReaction = {
          emoji,
          senderInboxId,
          messageId: msg.id,
        };
        const newMap = new Map(currentReactions);
        newMap.set(targetMessageId, [...messageReactions, newReaction]);
        store.set(reactionsAtom, newMap);
      }
    } else if (action === 'removed') {
      // Remove the reaction
      const filtered = messageReactions.filter(
        r => !(r.emoji === emoji && r.senderInboxId === senderInboxId)
      );
      const newMap = new Map(currentReactions);
      if (filtered.length > 0) {
        newMap.set(targetMessageId, filtered);
      } else {
        newMap.delete(targetMessageId);
      }
      store.set(reactionsAtom, newMap);
    }

    // Trigger re-render for reactions
    const version = store.get(reactionsVersionAtom);
    store.set(reactionsVersionAtom, version + 1);

    // Handle notifications and preview updates for streamed reactions (not historical)
    if (fromStream && action === 'added' && conversationId) {
      const isOwnReaction = senderInboxId === this.client?.inboxId;

      // Update conversation metadata
      const metadata = this.conversationMetadata.get(conversationId);
      if (metadata) {
        // Get reactor name for preview (fetch if not cached)
        let reactorName = 'Someone';
        if (isOwnReaction) {
          reactorName = 'You';
        } else if (metadata.conversationType === 'dm' && metadata.peerAddress) {
          const record = await resolveAddress(metadata.peerAddress);
          reactorName = record?.username || `${metadata.peerAddress.slice(0, 6)}...`;
        } else if (metadata.memberPreviews) {
          const member = metadata.memberPreviews.find(m => m.inboxId === senderInboxId);
          if (member?.address) {
            const record = await resolveAddress(member.address);
            reactorName = record?.username || `${member.address.slice(0, 6)}...`;
          }
        }

        // Update preview to show who reacted
        metadata.lastMessagePreview = `${reactorName} reacted ${emoji}`;
        metadata.lastActivityNs = msg.sentAtNs;

        // Handle unread count and notifications for peer reactions to YOUR messages only
        if (!isOwnReaction) {
          // Check if the reaction is to a message you sent
          const targetMessage = messageCache.get(targetMessageId);
          const isReactionToOwnMessage = targetMessage?.senderInboxId === this.client?.inboxId;

          const selectedId = store.get(selectedConversationIdAtom);
          const isSelected = selectedId === conversationId;
          const tabVisible = isTabVisible();

          // Increment unread only if not viewing this conversation AND reaction is to your message
          if (!isSelected && isReactionToOwnMessage) {
            metadata.unreadCount = (metadata.unreadCount ?? 0) + 1;
            const unreadVersion = store.get(unreadVersionAtom);
            store.set(unreadVersionAtom, unreadVersion + 1);
          }

          // Check if this conversation is muted
          const mutedIds = store.get(mutedConversationIdsAtom);
          const isConversationMuted = mutedIds.includes(conversationId);

          // Show notification only if reaction is to your message, tab not visible, and not muted
          if (!tabVisible && isReactionToOwnMessage && !isConversationMuted) {
            this.hiddenTabMessageCount++;

            // Resolve reactor name asynchronously
            (async () => {
              let reactorName = 'Someone';
              let avatarUrl: string | undefined;

              // Find the reactor's address from member previews or peer address
              if (metadata.conversationType === 'group' && metadata.memberPreviews) {
                const reactorMember = metadata.memberPreviews.find(m => m.inboxId === senderInboxId);
                if (reactorMember?.address) {
                  try {
                    const usernameRecord = await resolveAddress(reactorMember.address);
                    if (usernameRecord?.username) {
                      reactorName = usernameRecord.username;
                      avatarUrl = getAvatarUrl(usernameRecord.username);
                    } else {
                      reactorName = `${reactorMember.address.slice(0, 6)}...${reactorMember.address.slice(-4)}`;
                    }
                  } catch {
                    reactorName = `${reactorMember.address.slice(0, 6)}...${reactorMember.address.slice(-4)}`;
                  }
                }
              } else if (metadata.peerAddress) {
                try {
                  const usernameRecord = await resolveAddress(metadata.peerAddress);
                  if (usernameRecord?.username) {
                    reactorName = usernameRecord.username;
                    avatarUrl = getAvatarUrl(usernameRecord.username);
                  } else {
                    reactorName = `${metadata.peerAddress.slice(0, 6)}...${metadata.peerAddress.slice(-4)}`;
                  }
                } catch {
                  reactorName = `${metadata.peerAddress.slice(0, 6)}...${metadata.peerAddress.slice(-4)}`;
                }
              }

              // For groups, show "Reactor reacted in Group"
              const notificationTitle = metadata.conversationType === 'group'
                ? metadata.groupName || 'Group'
                : reactorName;
              const notificationBody = metadata.conversationType === 'group'
                ? `${reactorName} reacted ${emoji} to your message`
                : `Reacted ${emoji} to your message`;

              showMessageNotification({
                conversationId,
                senderName: notificationTitle,
                messagePreview: notificationBody,
                avatarUrl: avatarUrl || metadata.groupImageUrl,
              });
              this.updateTabTitle();
              startTitleFlash(notificationTitle, false);
            })();
          } else if (!isSelected && isReactionToOwnMessage) {
            this.updateTabTitle();
          }
        }

        this.incrementMetadataVersion();
      }

      // Re-sort conversations
      this.resortConversations();
    }
  }

  // Track pending reactions to prevent double-clicks
  private pendingReactions = new Set<string>();

  /**
   * Send a reaction to a message
   * Uses optimistic updates for instant feedback
   */
  async sendReaction(
    conversationId: string,
    targetMessageId: string,
    emoji: string,
    action: 'added' | 'removed' = 'added'
  ): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !this.client?.inboxId) return;

    // Create a unique key for this reaction to prevent double-clicks
    const reactionKey = `${targetMessageId}:${emoji}:${this.client.inboxId}`;

    // If already pending, ignore the request
    if (this.pendingReactions.has(reactionKey)) {
      return;
    }

    // Mark as pending
    this.pendingReactions.add(reactionKey);

    // Store previous state for rollback on error
    const currentReactions = store.get(reactionsAtom);
    const previousReactions = currentReactions.get(targetMessageId) ?? [];
    const inboxId = this.client.inboxId;

    try {
      // OPTIMISTIC UPDATE: Update UI immediately before network call
      const messageReactions = [...previousReactions];

      if (action === 'added') {
        // Add reaction optimistically
        const exists = messageReactions.some(
          r => r.emoji === emoji && r.senderInboxId === inboxId
        );
        if (!exists) {
          const newReaction: StoredReaction = {
            emoji,
            senderInboxId: inboxId,
            messageId: `pending-${Date.now()}`,
          };
          const newMap = new Map(currentReactions);
          newMap.set(targetMessageId, [...messageReactions, newReaction]);
          store.set(reactionsAtom, newMap);
          store.set(reactionsVersionAtom, store.get(reactionsVersionAtom) + 1);
        }
      } else {
        // Remove reaction optimistically
        const filtered = messageReactions.filter(
          r => !(r.emoji === emoji && r.senderInboxId === inboxId)
        );
        const newMap = new Map(currentReactions);
        if (filtered.length > 0) {
          newMap.set(targetMessageId, filtered);
        } else {
          newMap.delete(targetMessageId);
        }
        store.set(reactionsAtom, newMap);
        store.set(reactionsVersionAtom, store.get(reactionsVersionAtom) + 1);
      }

      // Construct the Reaction object for v6 API
      const reaction: Reaction = {
        reference: targetMessageId,
        referenceInboxId: '', // SDK handles this internally for DMs
        action: action === 'added' ? ReactionAction.Added : ReactionAction.Removed,
        content: emoji,
        schema: ReactionSchema.Unicode,
      };

      // Use new v6 sendReaction API
      await conv.sendReaction(reaction);
    } catch (error) {
      // ROLLBACK: Restore previous state on error
      const rollbackMap = new Map(store.get(reactionsAtom));
      if (previousReactions.length > 0) {
        rollbackMap.set(targetMessageId, previousReactions);
      } else {
        rollbackMap.delete(targetMessageId);
      }
      store.set(reactionsAtom, rollbackMap);
      store.set(reactionsVersionAtom, store.get(reactionsVersionAtom) + 1);

      console.error('Failed to send reaction:', error);
      throw error;
    } finally {
      // Clear pending state
      this.pendingReactions.delete(reactionKey);
    }
  }

  /**
   * Get reactions for a message
   */
  getReactions(messageId: string): StoredReaction[] {
    const reactions = store.get(reactionsAtom);
    return reactions.get(messageId) ?? [];
  }

  /**
   * Cleanup all streams and state
   */
  cleanup(): void {

    // Abort all streams
    this.conversationStreamController?.abort();
    this.conversationStreamController = null;

    this.allMessagesStreamController?.abort();
    this.allMessagesStreamController = null;

    // Reset state
    this.client = null;
    this.conversationsLoaded = false;
    this.initialSyncDone = false;
    this.loadedMessageConversations.clear();
    this.conversationMetadata.clear();
    this.conversations.clear();

    // Reset restart counters
    this.conversationStreamRestarts = 0;
    this.allMessagesStreamRestarts = 0;

    // Clear history sync interval
    if (this.historySyncInterval) {
      clearInterval(this.historySyncInterval);
      this.historySyncInterval = null;
    }
  }

  /**
   * Manually request history sync from other devices
   * Call this to pull message history from other installations
   */
  async requestHistorySync(): Promise<void> {
    if (!this.client) {
      console.warn('[StreamManager] Cannot request history sync - no client');
      return;
    }

    // Don't sync if translation is in progress
    if (this.translationInProgress) {
      console.warn('[StreamManager] Cannot request history sync - translation in progress');
      return;
    }

    console.log('[StreamManager] Manually requesting history sync...');
    try {
      await this.client.sendSyncRequest();
      // Also sync conversations to pull in any new data
      await this.client.conversations.syncAll([ConsentState.Allowed, ConsentState.Unknown]);
      console.log('[StreamManager] History sync request completed');
    } catch (error) {
      console.error('[StreamManager] History sync request failed:', error);
      this.checkForDatabaseCorruption(error);
      throw error;
    }
  }

  /**
   * Start periodic history sync to respond to sync requests from other installations
   * This is minimal - the streams should handle real-time updates
   */
  private startPeriodicHistorySync(): void {
    if (this.historySyncInterval) {
      clearInterval(this.historySyncInterval);
    }

    // Sync every 5 minutes - just to respond to history sync requests
    const SYNC_INTERVAL_MS = 5 * 60 * 1000;

    this.historySyncInterval = setInterval(async () => {
      if (!this.client) return;

      // Skip sync if translation download is in progress to prevent I/O contention
      if (this.translationInProgress) {
        console.log('[StreamManager] Skipping periodic sync - translation in progress');
        return;
      }

      try {
        await this.client.conversations.syncAll([ConsentState.Allowed, ConsentState.Unknown]);
      } catch (error) {
        console.error('[StreamManager] Periodic history sync error:', error);
        this.checkForDatabaseCorruption(error);
      }
    }, SYNC_INTERVAL_MS);
  }
}

// Export singleton instance
export const streamManager = new XMTPStreamManager();
