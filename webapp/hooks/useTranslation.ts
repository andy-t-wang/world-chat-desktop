"use client";

import { useCallback, useEffect, useRef } from "react";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { isElectron } from "@/lib/storage";
import { streamManager } from "@/lib/xmtp/StreamManager";

// localStorage key for per-conversation auto-translate settings
const AUTO_TRANSLATE_KEY = "auto-translate-conversations";

// localStorage prefix for translation cache per conversation
const TRANSLATION_CACHE_PREFIX = "translation-cache-";

// localStorage prefix for original text cache (for outgoing translated messages)
const ORIGINAL_TEXT_CACHE_PREFIX = "original-text-cache-";

// Session-only cache for disappearing message conversations (in-memory, clears on refresh)
const sessionOriginalTextCache = new Map<string, string>();

// Key format for session cache
function getSessionCacheKey(conversationId: string, translatedContent: string): string {
  return `${conversationId}:${translatedContent}`;
}

interface TranslationResult {
  translatedText: string;
  from: string;
  to: string;
}

interface LanguageDetectionResult {
  language: string | null;
  confidence: number;
}

interface TranslationProgress {
  status: string;
  progress: number;
  file?: string;
  timeEstimate?: string;
}

// Shared atoms for translation state (so all components see the same state)
const translationInitializingAtom = atom(false);
const translationInitializedAtom = atom(false);
const translationProgressAtom = atom<TranslationProgress | null>(null);
const translationErrorAtom = atom<string | null>(null);

/**
 * Hook for on-device translation using Electron's Transformers.js + NLLB service
 * Only available in the Electron desktop app
 */
export function useTranslation() {
  const [isInitializing, setIsInitializing] = useAtom(translationInitializingAtom);
  const [isInitialized, setIsInitialized] = useAtom(translationInitializedAtom);
  const [error, setError] = useAtom(translationErrorAtom);
  const [progress, setProgress] = useAtom(translationProgressAtom);
  const cleanupRef = useRef<(() => void) | null>(null);
  const initAttemptedRef = useRef(false);

  // Always subscribe to progress updates when mounted (to catch ongoing initialization)
  useEffect(() => {
    if (!isElectron() || !window.electronAPI?.translation) return;

    // Query current progress state on mount (in case initialization is already in progress)
    const checkCurrentProgress = async () => {
      if (window.electronAPI?.translation?.getProgress) {
        try {
          const state = await window.electronAPI.translation.getProgress();
          if (state.isInitializing) {
            setIsInitializing(true);
            if (state.progress) {
              setProgress(state.progress);
            }
          }
        } catch (err) {
          console.error('[useTranslation] Failed to get current progress:', err);
        }
      }
    };
    checkCurrentProgress();

    // Subscribe to progress updates
    if (window.electronAPI.translation.onProgress) {
      const cleanup = window.electronAPI.translation.onProgress((p) => {
        setProgress(p);
        // If we're receiving progress, we're initializing
        if (p && p.progress < 100) {
          setIsInitializing(true);
        }
      });

      cleanupRef.current = cleanup;
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [setIsInitializing, setProgress]);

  // Check if translation was previously enabled and auto-initialize
  // IMPORTANT: This coordinates with XMTP sync to prevent database corruption
  useEffect(() => {
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    const checkAndRestore = async () => {
      if (!isElectron() || !window.electronAPI?.translation) return;

      try {
        // First check if already ready (models loaded in memory)
        const ready = await window.electronAPI.translation.isReady();
        if (ready) {
          setIsInitialized(true);
          return;
        }

        // Check if translation was previously enabled
        const wasEnabled = await window.electronAPI.translation.getEnabled();
        if (wasEnabled) {
          // Auto-initialize in background
          console.log("[useTranslation] Auto-initializing translation (was previously enabled)");

          // Wait for any in-progress XMTP sync to complete before starting
          // This prevents I/O contention that can cause database corruption
          if (streamManager.isSyncing()) {
            console.log("[useTranslation] Waiting for XMTP sync before auto-init...");
            setProgress({ status: 'waiting', progress: 0, timeEstimate: 'Waiting for sync...' });
            await streamManager.waitForSyncComplete(60000);
          }

          // Check for database corruption before proceeding
          if (streamManager.isDatabaseCorrupted()) {
            console.error("[useTranslation] Database corrupted, skipping auto-init");
            return;
          }

          setIsInitializing(true);

          try {
            // Tell StreamManager that translation is starting
            streamManager.setTranslationInProgress(true);

            await window.electronAPI.translation.initialize();
            setIsInitialized(true);
          } catch (err) {
            console.error("[useTranslation] Auto-initialize failed:", err);
            // Clear the enabled preference if auto-init fails
            await window.electronAPI.translation.setEnabled(false);
          } finally {
            // Always clear the translation flag
            streamManager.setTranslationInProgress(false);
            setIsInitializing(false);
            setProgress(null);
          }
        }
      } catch (err) {
        console.error("[useTranslation] Check and restore failed:", err);
      }
    };

    checkAndRestore();
  }, [setIsInitialized, setIsInitializing, setProgress]);

  /**
   * Check if translation is available (only in Electron)
   */
  const isAvailable = useCallback(async (): Promise<boolean> => {
    if (!isElectron()) return false;
    try {
      return await window.electronAPI?.translation?.isAvailable() ?? false;
    } catch {
      return false;
    }
  }, []);

  /**
   * Initialize translation service and download models
   * This may take a while on first run as it downloads models (~800MB total)
   * - Translation model: ~600MB (NLLB-200-distilled-600M)
   * - Language detection model: ~200MB (bert-base-multilingual-cased)
   *
   * IMPORTANT: This coordinates with XMTP sync to prevent database corruption.
   * The translation download and XMTP sync are both heavy I/O operations that
   * should not run concurrently.
   */
  const initialize = useCallback(async (): Promise<boolean> => {
    if (!isElectron() || !window.electronAPI?.translation) {
      setError("Translation only available in desktop app");
      return false;
    }

    // Check if already initialized
    if (isInitialized) return true;

    // Check if database is corrupted - don't start translation if so
    if (streamManager.isDatabaseCorrupted()) {
      setError("Database error detected. Please restart the app.");
      return false;
    }

    setIsInitializing(true);
    setError(null);

    try {
      // Wait for any in-progress XMTP sync to complete before starting translation
      // This prevents I/O contention that can cause database corruption
      if (streamManager.isSyncing()) {
        console.log("[useTranslation] Waiting for XMTP sync to complete...");
        setProgress({ status: 'waiting', progress: 0, timeEstimate: 'Waiting for sync...' });
        await streamManager.waitForSyncComplete(60000); // Wait up to 60 seconds
      }

      // Tell StreamManager that translation is starting - syncs will be deferred
      streamManager.setTranslationInProgress(true);

      await window.electronAPI.translation.initialize();
      setIsInitialized(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initialize translation";
      setError(message);
      return false;
    } finally {
      // Always clear the translation flag, even on error
      streamManager.setTranslationInProgress(false);
      setIsInitializing(false);
      setProgress(null);
    }
  }, [isInitialized, setError, setIsInitialized, setIsInitializing, setProgress]);

  /**
   * Translate text from one language to another
   */
  const translate = useCallback(async (
    text: string,
    from: string,
    to: string
  ): Promise<TranslationResult | null> => {
    if (!isElectron() || !window.electronAPI?.translation) {
      return null;
    }

    try {
      return await window.electronAPI.translation.translate(text, from, to);
    } catch (err) {
      console.error("[useTranslation] Translate failed:", err);
      return null;
    }
  }, []);

  /**
   * Detect the language of text
   */
  const detectLanguage = useCallback(async (text: string): Promise<LanguageDetectionResult | null> => {
    if (!isElectron() || !window.electronAPI?.translation) {
      return null;
    }

    try {
      return await window.electronAPI.translation.detectLanguage(text);
    } catch (err) {
      console.error("[useTranslation] Detect language failed:", err);
      return null;
    }
  }, []);

  /**
   * Stop the translation service to free memory
   */
  const dispose = useCallback(async (): Promise<void> => {
    if (!isElectron() || !window.electronAPI?.translation) return;

    try {
      await window.electronAPI.translation.dispose();
      setIsInitialized(false);
    } catch (err) {
      console.error("[useTranslation] Dispose failed:", err);
    }
  }, [setIsInitialized]);

  /**
   * Delete downloaded translation models to free disk space
   */
  const deleteModels = useCallback(async (): Promise<boolean> => {
    if (!isElectron() || !window.electronAPI?.translation) return false;

    try {
      await window.electronAPI.translation.deleteModels();
      setIsInitialized(false);
      return true;
    } catch (err) {
      console.error("[useTranslation] Delete models failed:", err);
      return false;
    }
  }, [setIsInitialized]);

  /**
   * Check if auto-translate is enabled for a conversation
   */
  const isAutoTranslateEnabled = useCallback((conversationId: string): boolean => {
    try {
      const stored = localStorage.getItem(AUTO_TRANSLATE_KEY);
      if (!stored) return false;
      const ids = JSON.parse(stored) as string[];
      return ids.includes(conversationId);
    } catch {
      return false;
    }
  }, []);

  /**
   * Enable or disable auto-translate for a conversation
   */
  const setAutoTranslate = useCallback((conversationId: string, enabled: boolean): void => {
    try {
      const stored = localStorage.getItem(AUTO_TRANSLATE_KEY);
      const ids: string[] = stored ? JSON.parse(stored) : [];

      if (enabled && !ids.includes(conversationId)) {
        ids.push(conversationId);
      } else if (!enabled) {
        const index = ids.indexOf(conversationId);
        if (index > -1) ids.splice(index, 1);
      }

      localStorage.setItem(AUTO_TRANSLATE_KEY, JSON.stringify(ids));
    } catch {
      // Ignore storage errors
    }
  }, []);

  /**
   * Get cached translation for a message
   * Returns null if not cached
   */
  const getCachedTranslation = useCallback((
    conversationId: string,
    messageId: string
  ): string | null => {
    try {
      const key = TRANSLATION_CACHE_PREFIX + conversationId;
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      const cache = JSON.parse(stored) as Record<string, string>;
      return cache[messageId] || null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Cache a translation for a message
   * Pass skipCache=true for disappearing message conversations
   */
  const cacheTranslation = useCallback((
    conversationId: string,
    messageId: string,
    translatedText: string,
    skipCache: boolean = false
  ): void => {
    if (skipCache) return; // Don't cache for disappearing message conversations
    try {
      const key = TRANSLATION_CACHE_PREFIX + conversationId;
      const stored = localStorage.getItem(key);
      const cache: Record<string, string> = stored ? JSON.parse(stored) : {};
      cache[messageId] = translatedText;
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      // Ignore storage errors
    }
  }, []);

  /**
   * Get cached original text for an outgoing translated message
   * Returns null if not cached
   * Pass checkSessionCache=true to also check in-memory session cache (for disappearing messages)
   */
  const getCachedOriginal = useCallback((
    conversationId: string,
    translatedContent: string,
    checkSessionCache: boolean = false
  ): string | null => {
    // First check session cache if requested (for disappearing messages)
    if (checkSessionCache) {
      const sessionKey = getSessionCacheKey(conversationId, translatedContent);
      const sessionCached = sessionOriginalTextCache.get(sessionKey);
      if (sessionCached) return sessionCached;
    }

    // Then check localStorage (for normal conversations)
    try {
      const key = ORIGINAL_TEXT_CACHE_PREFIX + conversationId;
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      const cache = JSON.parse(stored) as Record<string, string>;
      return cache[translatedContent] || null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Cache original text for an outgoing translated message
   * Keyed by translated content so we can look it up when rendering
   * Pass useSessionOnly=true for disappearing message conversations (in-memory only)
   */
  const cacheOriginal = useCallback((
    conversationId: string,
    translatedContent: string,
    originalText: string,
    useSessionOnly: boolean = false
  ): void => {
    if (useSessionOnly) {
      // For disappearing messages: use in-memory session cache only
      const key = getSessionCacheKey(conversationId, translatedContent);
      sessionOriginalTextCache.set(key, originalText);
      return;
    }
    // Normal conversations: persist to localStorage
    try {
      const key = ORIGINAL_TEXT_CACHE_PREFIX + conversationId;
      const stored = localStorage.getItem(key);
      const cache: Record<string, string> = stored ? JSON.parse(stored) : {};
      cache[translatedContent] = originalText;
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      // Ignore storage errors
    }
  }, []);

  return {
    isAvailable,
    initialize,
    translate,
    detectLanguage,
    dispose,
    deleteModels,
    isInitializing,
    isInitialized,
    progress,
    error,
    isAutoTranslateEnabled,
    setAutoTranslate,
    getCachedTranslation,
    cacheTranslation,
    getCachedOriginal,
    cacheOriginal,
  };
}
