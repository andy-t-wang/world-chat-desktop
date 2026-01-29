import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

// Link preview setting - persisted to localStorage
export const linkPreviewEnabledAtom = atomWithStorage('link-preview-enabled', true);

// Sound muted setting - persisted to localStorage
export const soundMutedAtom = atomWithStorage('sound-muted', false);

// Hide empty conversations setting - persisted to localStorage (default: true)
export const hideEmptyConversationsAtom = atomWithStorage('hide-empty-conversations', true);

// Settings panel open state
export const settingsPanelOpenAtom = atom(false);

// Theme setting - 'system' follows OS preference, 'light' or 'dark' for manual override
export type ThemePreference = 'system' | 'light' | 'dark';
export const themePreferenceAtom = atomWithStorage<ThemePreference>('theme', 'system');

// Timestamps when message requests were first seen - persisted to localStorage
// Used to show a "new" dot for 5 seconds after a request appears
export const requestFirstSeenAtom = atomWithStorage<Record<string, number>>('request-first-seen', {});

// Pinned conversation IDs - persisted to localStorage
export const pinnedConversationIdsAtom = atomWithStorage<string[]>('pinned-conversations', []);

// Muted conversation IDs - persisted to localStorage
// Muted conversations don't show notifications (except @mentions which bypass mute)
export const mutedConversationIdsAtom = atomWithStorage<string[]>('muted-conversations', []);

// Message request notifications - persisted to localStorage (default: true)
// When enabled, shows notifications for new messages from unknown contacts
export const messageRequestNotificationsAtom = atomWithStorage('message-request-notifications', true);

// Chat background style - 'solid' for Signal-like single color, 'pattern' for WhatsApp-like pattern
export type ChatBackgroundStyle = 'solid' | 'pattern';
export const chatBackgroundStyleAtom = atomWithStorage<ChatBackgroundStyle>('chat-background-style', 'solid');
