/**
 * State Store Exports
 * Central export point for all Jotai atoms
 */

import { createStore } from 'jotai';

/**
 * Shared Jotai store instance
 * Used by both React Provider and StreamManager to avoid multiple instance issues
 */
export const store = createStore();

// Client state
export {
  xmtpClientAtom,
  clientStateAtom,
  isClientReadyAtom,
  currentInboxIdAtom,
  currentAccountIdentifierAtom,
  clientLifecycleAtom,
  identityInvalidAtom,
} from './client';

// Message state
export {
  messageAtomFamily,
  conversationMessageIdsAtom,
  conversationPaginationAtom,
  pendingMessagesAtom,
  allMessageIdsAtom,
  messageCountAtom,
  messageCache,
  addMessageToStore,
  createPendingMessage,
  hasPendingMessagesAtom,
  hasFailedMessagesAtom,
  // New Map-based atoms
  allConversationMessageIdsAtom,
  allConversationPaginationAtom,
  allPendingMessagesAtom,
  getMessageIds,
  getPagination,
  getPendingMessages,
  // Read receipt tracking
  readReceiptsAtom,
  readReceiptVersionAtom,
  // Unread tracking
  unreadVersionAtom,
  // Reactions
  reactionsAtom,
  reactionsVersionAtom,
} from './messages';

// Conversation state
export {
  conversationAtomFamily,
  conversationMetadataAtom,
  conversationIdsAtom,
  isLoadingConversationsAtom,
  isSyncingConversationsAtom,
  conversationMetadataVersionAtom,
  conversationsErrorAtom,
  sortedConversationIdsAtom,
  unreadConversationIdsAtom,
  totalUnreadCountAtom,
  conversationConsentAtom,
  conversationsByConsentAtom,
  conversationSearchQueryAtom,
  filteredConversationIdsAtom,
  conversationsPaginationAtom,
  conversationWithMetadataAtom,
} from './conversations';

// UI state
export {
  selectedConversationIdAtom,
  isSidebarOpenAtom,
  isMobileViewAtom,
  activeModalAtom,
  modalDataAtom,
  openModalAtom,
  closeModalAtom,
  messageInputDraftAtom,
  isTypingAtom,
  othersTypingAtom,
  scrollPositionAtom,
  autoScrollEnabledAtom,
  toastsAtom,
  addToastAtom,
  removeToastAtom,
  themeAtom,
  resolvedThemeAtom,
  isAppLoadingAtom,
  globalErrorAtom,
  isOnlineAtom,
  isReconnectingAtom,
} from './ui';
export type { ModalType, Toast, Theme } from './ui';
