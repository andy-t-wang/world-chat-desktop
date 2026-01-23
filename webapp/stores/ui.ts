/**
 * UI State Store
 * Manages UI-related state like selected conversation, modals, etc.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/**
 * Currently selected conversation ID
 */
export const selectedConversationIdAtom = atom<string | null>(null);

/**
 * Whether the message requests view is open
 */
export const showMessageRequestsAtom = atom<boolean>(false);

/**
 * Whether the sidebar is open (for mobile responsive design)
 */
export const isSidebarOpenAtom = atom<boolean>(true);

/**
 * Whether we're in mobile view
 */
export const isMobileViewAtom = atom<boolean>(false);

/**
 * Active modal state
 */
export type ModalType =
  | 'new-conversation'
  | 'settings'
  | 'profile'
  | 'consent-request'
  | null;

export const activeModalAtom = atom<ModalType>(null);

/**
 * Modal data (for modals that need additional context)
 */
export const modalDataAtom = atom<Record<string, unknown> | null>(null);

/**
 * Open a modal with optional data
 */
export const openModalAtom = atom(
  null,
  (get, set, modal: ModalType, data?: Record<string, unknown>) => {
    set(activeModalAtom, modal);
    set(modalDataAtom, data ?? null);
  }
);

/**
 * Close the current modal
 */
export const closeModalAtom = atom(null, (get, set) => {
  set(activeModalAtom, null);
  set(modalDataAtom, null);
});

/**
 * Message input draft per conversation
 * Persists input when switching between conversations
 */
export const messageInputDraftAtom = atomFamily((conversationId: string) =>
  atom<string>('')
);

/**
 * Whether the user is currently typing in a conversation
 */
export const isTypingAtom = atomFamily((conversationId: string) =>
  atom<boolean>(false)
);

/**
 * Other users typing in a conversation
 * Map of user address to timestamp
 */
export const othersTypingAtom = atomFamily((conversationId: string) =>
  atom<Map<string, number>>(new Map())
);

/**
 * Scroll position per conversation (for preserving scroll on switch)
 */
export const scrollPositionAtom = atomFamily((conversationId: string) =>
  atom<number>(0)
);

/**
 * Whether we should auto-scroll to bottom on new message
 */
export const autoScrollEnabledAtom = atomFamily((conversationId: string) =>
  atom<boolean>(true)
);

/**
 * Toast/notification state
 */
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

export const toastsAtom = atom<Toast[]>([]);

export const addToastAtom = atom(
  null,
  (get, set, toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newToast: Toast = { ...toast, id };
    set(toastsAtom, (prev) => [...prev, newToast]);

    // Auto-dismiss after duration
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }
);

export const removeToastAtom = atom(null, (get, set, id: string) => {
  set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
});

/**
 * Theme preference
 */
export type Theme = 'light' | 'dark' | 'system';
export const themeAtom = atom<Theme>('system');

/**
 * Resolved theme (accounts for system preference)
 */
export const resolvedThemeAtom = atom((get) => {
  const theme = get(themeAtom);
  if (theme !== 'system') return theme;

  // In a real implementation, this would check system preference
  // For now, default to light
  return 'light';
});

/**
 * Whether the app is in a loading state
 */
export const isAppLoadingAtom = atom<boolean>(true);

/**
 * Global error state
 */
export const globalErrorAtom = atom<Error | null>(null);

/**
 * Network connectivity status
 */
export const isOnlineAtom = atom<boolean>(true);

/**
 * Whether we're reconnecting after a disconnect
 */
export const isReconnectingAtom = atom<boolean>(false);

/**
 * Reply state - tracks the message being replied to
 */
export interface ReplyingTo {
  messageId: string;
  content: string;
  senderAddress: string;
}

export const replyingToAtom = atom<ReplyingTo | null>(null);

/**
 * Stream health status for XMTP connection monitoring
 */
export type StreamHealthStatus = 'healthy' | 'reconnecting' | 'degraded' | 'offline';
export const streamHealthAtom = atom<StreamHealthStatus>('healthy');

/**
 * Detailed stream status for debugging and UI feedback
 */
export interface StreamStatus {
  conversationStream: 'running' | 'stopped' | 'restarting';
  messagesStream: 'running' | 'stopped' | 'restarting';
  lastMessageReceivedAt: number | null;
  lastConversationReceivedAt: number | null;
  consecutiveFailures: number;
  fallbackSyncActive: boolean;
}

export const streamStatusAtom = atom<StreamStatus>({
  conversationStream: 'stopped',
  messagesStream: 'stopped',
  lastMessageReceivedAt: null,
  lastConversationReceivedAt: null,
  consecutiveFailures: 0,
  fallbackSyncActive: false,
});
