'use client';

import { store, selectedConversationIdAtom } from '@/stores';
import { soundMutedAtom } from '@/stores/settings';

/**
 * Browser notification service for new messages
 * Shows notifications when the tab is not visible
 */

let permissionRequested = false;
let audioContext: AudioContext | null = null;

// Sound throttling - prevent multiple sounds stacking when many messages arrive at once
let lastSoundTime = 0;
const SOUND_THROTTLE_MS = 1000; // Only play sound once per second max

// Title state
let baseTitle = 'World Chat';
let currentChatName: string | null = null;
let flashInterval: ReturnType<typeof setInterval> | null = null;
let isFlashState = false;
let pendingNotification: { senderName: string; isCurrentChat: boolean } | null = null;

/**
 * Get or create AudioContext for notification sounds
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

/**
 * Play notification sound using Web Audio API
 *
 * Design principles (acoustic engineering + HCI):
 * - Rising pitch creates anticipation/excitement
 * - Soft attack feels friendly, not alarming
 * - Warm fundamentals (300-400Hz) feel welcoming
 * - Slight detuning creates organic warmth
 * - Two-note "pop-pop" pattern feels playful
 */
export function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.35, now);
  masterGain.connect(ctx.destination);

  // Two-note ascending pattern - creates anticipation
  // F4 (349Hz) → A4 (440Hz) = Major 3rd (pleasant, uplifting)
  const notes = [
    { freq: 349, time: 0, duration: 0.12 },
    { freq: 440, time: 0.08, duration: 0.18 },
  ];

  notes.forEach(({ freq, time, duration }) => {
    const startTime = now + time;

    // Main tone - sine for purity, no harshness
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Gentle low-pass removes any digital harshness
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, startTime);
    filter.Q.setValueAtTime(0.5, startTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    // Slight pitch rise within each note (excitement)
    osc.frequency.linearRampToValueAtTime(freq * 1.02, startTime + duration * 0.3);
    osc.frequency.linearRampToValueAtTime(freq, startTime + duration);

    // Soft attack, smooth decay (like a soft mallet on wood)
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.6, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.3, startTime + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);

    // Subtle octave undertone for body/warmth
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();

    subOsc.connect(subGain);
    subGain.connect(masterGain);

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(freq / 2, startTime);

    subGain.gain.setValueAtTime(0, startTime);
    subGain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.8);

    subOsc.start(startTime);
    subOsc.stop(startTime + duration);
  });
}

/**
 * Check if the browser tab is currently visible
 * In Electron, also check if window is focused
 */
export function isTabVisible(): boolean {
  if (typeof document === 'undefined') return true;

  // In Electron, check both visibility and focus
  const isElectron = typeof window !== 'undefined' &&
    !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

  if (isElectron) {
    // In Electron, only consider "visible" if document is visible AND window is focused
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  return document.visibilityState === 'visible';
}

/**
 * Request notification permission from the user
 * Only requests once per session
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  // Only request once per session
  if (permissionRequested) {
    return false;
  }

  permissionRequested = true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Show a browser notification for a new message
 */
export function showMessageNotification(options: {
  conversationId: string;
  senderName: string;
  messagePreview: string;
  avatarUrl?: string;
}): void {
  const { conversationId, senderName, messagePreview, avatarUrl } = options;

  // Don't show if tab is visible
  if (isTabVisible()) {
    return;
  }

  // Don't show if notifications not supported or not permitted
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  // Truncate long messages
  const truncatedPreview = messagePreview.length > 100
    ? messagePreview.slice(0, 100) + '...'
    : messagePreview;

  const notification = new Notification(senderName, {
    body: truncatedPreview,
    icon: avatarUrl || '/icon-192.png',
    tag: `message-${conversationId}`,
    silent: true, // We play our own sound
  });

  // Handle click - focus window and select conversation
  notification.onclick = () => {
    // Use Electron API to focus window if available
    const electronAPI = (window as { electronAPI?: { focusWindow?: () => Promise<void> } }).electronAPI;
    if (electronAPI?.focusWindow) {
      electronAPI.focusWindow();
    } else {
      window.focus();
    }
    store.set(selectedConversationIdAtom, conversationId);
    notification.close();
  };

  // Auto-close after 5 seconds
  setTimeout(() => {
    notification.close();
  }, 5000);
}

/**
 * Set the current chat name for tab title
 * Call this when selecting a conversation
 */
export function setCurrentChatName(chatName: string | null): void {
  currentChatName = chatName;
  updateTabTitleDisplay();
}

/**
 * Update the tab title display based on current state
 */
function updateTabTitleDisplay(): void {
  if (typeof document === 'undefined') return;

  if (pendingNotification) {
    // We have a pending notification - show notification state
    if (pendingNotification.isCurrentChat && currentChatName) {
      // On current chat: "<Chat Name> · messaged you"
      document.title = `${currentChatName} · messaged you`;
    } else if (isFlashState) {
      // Flashing state: show sender notification
      document.title = `${pendingNotification.senderName} messaged you`;
    } else if (currentChatName) {
      // Non-flash state: show chat name
      document.title = currentChatName;
    } else {
      document.title = baseTitle;
    }
  } else if (currentChatName) {
    // Normal state with chat selected: "<Chat Name> | World Chat"
    document.title = `${currentChatName} | World Chat`;
  } else {
    // No chat selected
    document.title = baseTitle;
  }
}

/**
 * Update the page title with unread count (legacy, now just updates display)
 */
export function updateTitleWithUnreadCount(unreadCount: number): void {
  if (unreadCount === 0) {
    // Clear notification state
    pendingNotification = null;
    stopTitleFlash();
  }
  updateTabTitleDisplay();

  // Update Electron dock badge if running in Electron
  updateElectronBadge(unreadCount);
}

/**
 * Update Electron dock badge count (macOS)
 */
export function updateElectronBadge(count: number): void {
  if (typeof window === 'undefined') return;

  const electronAPI = (window as { electronAPI?: { setBadgeCount?: (count: number) => Promise<void> } }).electronAPI;
  if (electronAPI?.setBadgeCount) {
    electronAPI.setBadgeCount(count).catch(() => {
      // Ignore errors - may not be on macOS or dock may not be available
    });
  }
}

/**
 * Start tab title notification for new message
 * @param senderName - Name of the person who sent the message
 * @param isCurrentChat - Whether the message is in the currently selected chat
 * @param hasMention - Whether the user was @mentioned (bypasses mute)
 */
export function startTitleFlash(senderName: string, isCurrentChat: boolean = false, hasMention: boolean = false): void {
  if (typeof document === 'undefined') return;

  // Don't change if tab is visible
  if (isTabVisible()) {
    stopTitleFlash();
    return;
  }

  pendingNotification = { senderName, isCurrentChat };

  // Play notification sound - throttled to prevent stacking
  // Additional focus check as final safeguard - don't play if user is actively using the app
  // Note: @mentions bypass the mute setting to ensure users don't miss direct mentions
  const isMuted = store.get(soundMutedAtom);
  const shouldBypassMute = hasMention;
  const hasFocus = typeof document !== 'undefined' && document.hasFocus();
  const now = Date.now();
  if ((!isMuted || shouldBypassMute) && !hasFocus && now - lastSoundTime >= SOUND_THROTTLE_MS) {
    lastSoundTime = now;
    playNotificationSound();
  }

  if (isCurrentChat) {
    // On current chat - just show static "<Chat Name> · messaged you"
    updateTabTitleDisplay();
  } else {
    // Different chat - flash between chat name and "{sender} messaged you"
    if (flashInterval) {
      // Already flashing, just update the sender
      return;
    }

    isFlashState = false;
    updateTabTitleDisplay();

    flashInterval = setInterval(() => {
      isFlashState = !isFlashState;
      updateTabTitleDisplay();
    }, 1500);
  }
}

/**
 * Stop flashing and restore normal title
 */
export function stopTitleFlash(): void {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  isFlashState = false;
  pendingNotification = null;
  updateTabTitleDisplay();
}

/**
 * Check if title is currently showing notification
 */
export function isTitleFlashing(): boolean {
  return pendingNotification !== null;
}

// Set up visibility change listener to restore title when tab becomes visible
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      stopTitleFlash();
    }
  });
}
