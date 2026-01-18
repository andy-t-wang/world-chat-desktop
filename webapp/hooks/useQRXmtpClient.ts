"use client";

import { useCallback, useRef, useEffect } from "react";
import { useSetAtom, useAtom } from "jotai";
import type { Client } from "@xmtp/browser-sdk";
import { toBytes } from "viem";
import { clientLifecycleAtom, clientStateAtom } from "@/stores/client";
import { streamManager } from "@/lib/xmtp/StreamManager";
import { RemoteSigner } from "@/lib/signing-relay";
import { clearSession } from "@/lib/auth/session";
import {
  isLockedByAnotherTab,
  acquireTabLock,
  releaseTabLock,
} from "@/lib/tab-lock";
import { getSessionCache, setSessionCache, isElectron, deleteXmtpDatabase, checkXmtpDatabaseExists, listXmtpDatabases } from "@/lib/storage";

// Module cache for faster subsequent loads
let cachedModules: Awaited<ReturnType<typeof loadAllModules>> | null = null;
let moduleLoadPromise: Promise<
  Awaited<ReturnType<typeof loadAllModules>>
> | null = null;

/**
 * Load all XMTP modules in parallel (cached)
 */
async function loadAllModules() {
  // v6 has built-in send methods (sendText, sendReaction, sendReply, sendReadReceipt)
  // so we only need codecs for custom types and attachments
  const [xmtpModule, remoteAttachmentModule, transactionRefModule, paymentReqModule, paymentFulfillModule] =
    await Promise.all([
      import("@xmtp/browser-sdk"),
      import("@xmtp/content-type-remote-attachment"),
      import("@/lib/xmtp/TransactionReferenceCodec"),
      import("@/lib/xmtp/PaymentRequestCodec"),
      import("@/lib/xmtp/PaymentFulfillmentCodec"),
    ]);

  return {
    Client: xmtpModule.Client,
    IdentifierKind: xmtpModule.IdentifierKind,
    LogLevel: xmtpModule.LogLevel,
    RemoteAttachmentCodec: remoteAttachmentModule.RemoteAttachmentCodec,
    AttachmentCodec: remoteAttachmentModule.AttachmentCodec,
    TransactionReferenceCodec: transactionRefModule.TransactionReferenceCodec,
    PaymentRequestCodec: paymentReqModule.PaymentRequestCodec,
    PaymentFulfillmentCodec: paymentFulfillModule.PaymentFulfillmentCodec,
  };
}

/**
 * Get cached modules or load them (deduplicates concurrent requests)
 */
async function getModules() {
  if (cachedModules) return cachedModules;

  if (!moduleLoadPromise) {
    moduleLoadPromise = loadAllModules().then((modules) => {
      cachedModules = modules;
      return modules;
    });
  }

  return moduleLoadPromise;
}

/**
 * Pre-load modules in background (call early to warm cache)
 */
export function preloadXmtpModules() {
  if (typeof window === "undefined") return;
  // Start loading modules in background
  getModules().catch(() => {
    // Ignore errors - will retry when actually needed
  });
}

// Auto-preload on module import (starts loading immediately when this file is imported)
if (typeof window !== "undefined") {
  // Use requestIdleCallback to load during idle time, fallback to setTimeout
  const schedulePreload =
    window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1));
  schedulePreload(() => preloadXmtpModules());
}

interface UseQRXmtpClientResult {
  client: Client | null;
  isInitializing: boolean;
  isReady: boolean;
  error: Error | null;
  initializeWithRemoteSigner: (
    signer: ReturnType<RemoteSigner["getSigner"]>
  ) => Promise<void>;
  restoreSession: () => Promise<boolean>;
}

/**
 * Hook to create XMTP client using a remote signer (QR login flow)
 *
 * XMTP installations are persisted in OPFS (browser storage).
 * Client.create() will reuse existing installations for the same address.
 */
export function useQRXmtpClient(): UseQRXmtpClientResult {
  const [clientState] = useAtom(clientStateAtom);
  const client = clientState.client;
  const dispatch = useSetAtom(clientLifecycleAtom);
  const initializingRef = useRef(false);
  const restoringRef = useRef(false);

  /**
   * Try to restore session from cache (for page reloads)
   * Returns true if successful, false if QR login is needed
   * Throws 'TAB_LOCKED' error if another tab has the XMTP client
   */
  const restoreSession = useCallback(async (): Promise<boolean> => {
    if (restoringRef.current || initializingRef.current || client) {
      return !!client;
    }

    const cachedSession = await getSessionCache();
    console.log('[QRXmtpClient] Cached session:', cachedSession ? { address: cachedSession.address, inboxId: cachedSession.inboxId, age: Date.now() - cachedSession.timestamp } : null);
    if (!cachedSession) {
      console.log('[QRXmtpClient] No cached session, need QR login');
      return false;
    }

    // Check if another tab has the XMTP client
    if (isLockedByAnotherTab()) {
      throw new Error("TAB_LOCKED");
    }

    // Try to acquire the lock
    if (!acquireTabLock()) {
      throw new Error("TAB_LOCKED");
    }

    restoringRef.current = true;
    dispatch({ type: "INIT_START" });

    try {
      // Use cached modules for faster load
      const {
        Client,
        IdentifierKind,
        LogLevel,
        RemoteAttachmentCodec,
        AttachmentCodec,
        TransactionReferenceCodec,
        PaymentRequestCodec,
        PaymentFulfillmentCodec,
      } = await getModules();

      // Use Client.build() for faster session restoration
      // This skips signer initialization since the client is already registered
      console.log('[QRXmtpClient] Attempting Client.build() for session restore...');
      const xmtpClient = await Client.build(
        {
          identifier: cachedSession.address.toLowerCase(),
          identifierKind: IdentifierKind.Ethereum,
        },
        {
          env: "production",
          appVersion: "WorldChat/1.0.0",
          loggingLevel: LogLevel.Off,
          // Explicitly set history sync URL for cross-device message sync
          historySyncUrl: "https://message-history.ephemera.network",
          // v6 has built-in send methods - only need codecs for attachments and custom types
          codecs: [
            new AttachmentCodec(),
            new RemoteAttachmentCodec(),
            new TransactionReferenceCodec(),
            new PaymentRequestCodec(),
            new PaymentFulfillmentCodec(),
          ],
        }
      );

      console.log('[QRXmtpClient] Client.build() succeeded, inboxId:', xmtpClient.inboxId);

      // Verify identity is actually registered before proceeding
      // Client.build() can succeed but identity may not be registered if previous login was interrupted
      // Use preferences.sync() which requires network access and registered identity
      try {
        console.log('[QRXmtpClient] Verifying identity is registered (calling preferences.sync())...');
        await xmtpClient.preferences.sync();
        console.log('[QRXmtpClient] Identity verified - sync succeeded');
      } catch (verifyError) {
        const verifyMsg = verifyError instanceof Error ? verifyError.message : String(verifyError);
        console.error('[QRXmtpClient] Identity verification failed:', verifyMsg);

        // Check if this is actually a database lock conflict, not true uninitialized identity
        // OPFS SyncAccessHandle Pool VFS doesn't support multiple connections
        // Error looks like: "Failed to execute 'createSyncAccessHandle'...Access Handles cannot be created if there is another open Access Handle"
        if (verifyMsg.includes('Access Handle') || verifyMsg.includes('SyncAccessHandle') || verifyMsg.includes('createSyncAccessHandle')) {
          console.error('[QRXmtpClient] Database locked by another tab/window - NOT clearing session');
          releaseTabLock();
          throw new Error("TAB_LOCKED");
        }

        if (verifyMsg.includes('Uninitialized identity') || verifyMsg.includes('register_identity')) {
          console.error('[QRXmtpClient] Identity not registered, clearing database and session for re-login');
          releaseTabLock();
          // Delete the OPFS database to prevent orphan installations from accumulating
          if (cachedSession.inboxId) {
            await deleteXmtpDatabase(cachedSession.inboxId);
          }
          clearSession();
          dispatch({ type: "INIT_ERROR", error: new Error("Identity registration incomplete. Please login again.") });
          return false;
        }
        // Other errors - might be transient network issues, continue anyway
        console.warn('[QRXmtpClient] Identity verification had non-fatal error, continuing');
      }

      // Update cache timestamp (async, don't await)
      if (xmtpClient.inboxId) {
        setSessionCache(cachedSession.address, xmtpClient.inboxId);
      }

      dispatch({ type: "INIT_SUCCESS", client: xmtpClient });

      // Initialize StreamManager in background (don't block UI)
      console.log('[QRXmtpClient] Starting StreamManager.initialize()...');
      streamManager.initialize(xmtpClient).catch((error) => {
        console.error(
          "[QRXmtpClient] StreamManager initialization error:",
          error
        );
      });

      return true;
    } catch (error) {
      console.error("[QRXmtpClient] Failed to restore session:", error);
      console.error("[QRXmtpClient] Error details:", error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error);

      // Release the tab lock on failure
      releaseTabLock();

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Re-throw TAB_LOCKED so caller can handle it
      if (errorMessage === "TAB_LOCKED") {
        throw error;
      }

      // Detect OPFS database lock conflict from Client.build() failure
      // OPFS SyncAccessHandle Pool VFS doesn't support multiple connections
      if (errorMessage.includes('Access Handle') || errorMessage.includes('SyncAccessHandle') || errorMessage.includes('createSyncAccessHandle')) {
        console.error('[QRXmtpClient] Database locked by another tab/window');
        throw new Error("TAB_LOCKED");
      }

      // Only clear session cache if OPFS database is truly gone
      // Be VERY conservative - XMTP has installation limits (10 max, 250 changes)
      // "Uninitialized identity" can be transient - don't auto-clear on that
      // For other errors (network, temporary), keep session so user can retry
      const isDbGone =
        errorMessage.toLowerCase().includes("no local database") ||
        errorMessage.toLowerCase().includes("database not found") ||
        errorMessage.toLowerCase().includes("not found");

      if (isDbGone) {
        console.warn("[QRXmtpClient] Local DB is gone, clearing stale session cache");
        clearSession();
      } else {
        // Keep session for other errors - user can retry or manually logout
        console.warn("[QRXmtpClient] Keeping session despite error (may be temporary):", errorMessage);
      }

      dispatch({
        type: "INIT_ERROR",
        error:
          error instanceof Error
            ? error
            : new Error("Failed to restore session"),
      });
      return false;
    } finally {
      restoringRef.current = false;
    }
  }, [client, dispatch]);

  const initializeWithRemoteSigner = useCallback(
    async (signer: ReturnType<RemoteSigner["getSigner"]>) => {
      if (initializingRef.current) {
        return;
      }

      // Check if another tab has the XMTP client
      if (isLockedByAnotherTab()) {
        throw new Error("TAB_LOCKED");
      }

      // Try to acquire the lock
      if (!acquireTabLock()) {
        throw new Error("TAB_LOCKED");
      }

      initializingRef.current = true;
      dispatch({ type: "INIT_START" });

      const address = signer.getIdentifier().identifier;
      console.log('[QRXmtpClient] ========== INITIALIZE WITH REMOTE SIGNER ==========');
      console.log('[QRXmtpClient] Signer address:', address);

      try {
        // Log current state BEFORE doing anything
        const existingSession = await getSessionCache();
        const allDatabases = await listXmtpDatabases();
        console.log('[QRXmtpClient] Existing session cache:', existingSession ? {
          address: existingSession.address,
          inboxId: existingSession.inboxId,
          age: Date.now() - existingSession.timestamp
        } : null);
        console.log('[QRXmtpClient] OPFS databases found:', allDatabases);

        // Check if DB exists for this session's inboxId
        if (existingSession?.inboxId) {
          const dbExists = await checkXmtpDatabaseExists(existingSession.inboxId);
          console.log('[QRXmtpClient] DB exists for cached inboxId?', dbExists);
        }

        // Use cached modules for faster load
        const {
          Client,
          IdentifierKind,
          LogLevel,
          RemoteAttachmentCodec,
          AttachmentCodec,
          TransactionReferenceCodec,
          PaymentRequestCodec,
          PaymentFulfillmentCodec,
        } = await getModules();

        const clientOptions = {
          env: "production" as const,
          appVersion: "WorldChat/1.0.0",
          loggingLevel: LogLevel.Off,
          // Explicitly set history sync URL for cross-device message sync
          historySyncUrl: "https://message-history.ephemera.network",
          // v6 has built-in send methods - only need codecs for attachments and custom types
          codecs: [
            new AttachmentCodec(),
            new RemoteAttachmentCodec(),
            new TransactionReferenceCodec(),
            new PaymentRequestCodec(),
            new PaymentFulfillmentCodec(),
          ],
        };

        let xmtpClient;

        // Check if we have an existing session for THIS specific address
        // Only try build() if session exists - otherwise it might fail due to
        // DB existing for a different address
        const hasSessionForThisAddress =
          existingSession?.address?.toLowerCase() === address.toLowerCase();

        console.log('[QRXmtpClient] Has session for this address?', hasSessionForThisAddress);

        if (hasSessionForThisAddress) {
          // We have a session for this address - use build() to reuse installation
          // Don't create new installation if build fails
          console.log("[QRXmtpClient] Using Client.build() to reuse existing installation...");
          try {
            xmtpClient = await Client.build(
              {
                identifier: address.toLowerCase(),
                identifierKind: IdentifierKind.Ethereum,
              },
              clientOptions
            );
            console.log("[QRXmtpClient] Client.build() succeeded, inboxId:", xmtpClient.inboxId);
          } catch (buildError) {
            // Session exists but build failed - something is wrong
            // Don't auto-create, let user see the error and retry
            console.error("[QRXmtpClient] Client.build() failed for existing session:", buildError);
            throw buildError;
          }
        } else {
          // No session for this address - this is a fresh login, use create()
          console.log("[QRXmtpClient] No existing session - using Client.create() for fresh login...");
          console.log("[QRXmtpClient] Starting Client.create() at:", new Date().toISOString());

          try {
            xmtpClient = await Client.create(signer, clientOptions);
            console.log("[QRXmtpClient] Client.create() succeeded at:", new Date().toISOString());
            console.log("[QRXmtpClient] New client inboxId:", xmtpClient.inboxId);
          } catch (createError) {
            console.error("[QRXmtpClient] Client.create() FAILED:", createError);
            console.error("[QRXmtpClient] Create error details:", createError instanceof Error ? {
              name: createError.name,
              message: createError.message,
              stack: createError.stack
            } : createError);

            // Log state after failure
            const dbsAfterFail = await listXmtpDatabases();
            console.error("[QRXmtpClient] OPFS databases after create failure:", dbsAfterFail);
            throw createError;
          }
        }

        // Verify identity is registered BEFORE caching session
        console.log('[QRXmtpClient] Verifying identity registration with preferences.sync()...');
        try {
          await xmtpClient.preferences.sync();
          console.log('[QRXmtpClient] Identity verification PASSED - sync succeeded');
        } catch (verifyError) {
          const verifyMsg = verifyError instanceof Error ? verifyError.message : String(verifyError);
          console.error('[QRXmtpClient] Identity verification FAILED:', verifyMsg);

          // Check if this is actually a database lock conflict, not true uninitialized identity
          if (verifyMsg.includes('Access Handle') || verifyMsg.includes('SyncAccessHandle') || verifyMsg.includes('createSyncAccessHandle')) {
            console.error('[QRXmtpClient] Database locked by another tab/window - NOT clearing session');
            releaseTabLock();
            throw new Error("TAB_LOCKED");
          }

          if (verifyMsg.includes('Uninitialized identity') || verifyMsg.includes('register_identity')) {
            console.error('[QRXmtpClient] CRITICAL: Client created but identity not registered!');
            console.error('[QRXmtpClient] This means registration was interrupted');

            // Clean up the corrupted state
            if (xmtpClient.inboxId) {
              await deleteXmtpDatabase(xmtpClient.inboxId);
            }
            releaseTabLock();
            clearSession();
            dispatch({ type: "INIT_ERROR", error: new Error("Identity registration failed. Please try again.") });
            throw new Error("Identity registration incomplete");
          }
          // Other errors might be transient, continue
          console.warn('[QRXmtpClient] Non-fatal verification error, continuing');
        }

        // Cache session for page reloads
        console.log('[QRXmtpClient] Caching session for address:', address, 'inboxId:', xmtpClient.inboxId);
        if (xmtpClient.inboxId) {
          setSessionCache(address, xmtpClient.inboxId);
        }

        // Log final state
        const finalDbs = await listXmtpDatabases();
        console.log('[QRXmtpClient] OPFS databases after success:', finalDbs);
        console.log('[QRXmtpClient] ========== INITIALIZATION COMPLETE ==========');

        dispatch({ type: "INIT_SUCCESS", client: xmtpClient });

        // Initialize StreamManager in background (don't block UI)
        streamManager.initialize(xmtpClient).catch((error) => {
          console.error(
            "[QRXmtpClient] StreamManager initialization error:",
            error
          );
        });
      } catch (error) {
        console.error(
          "Failed to initialize XMTP client with remote signer:",
          error
        );
        // Release the tab lock on failure
        releaseTabLock();
        dispatch({
          type: "INIT_ERROR",
          error:
            error instanceof Error
              ? error
              : new Error("Failed to initialize XMTP"),
        });
        throw error;
      } finally {
        initializingRef.current = false;
      }
    },
    [dispatch]
  );

  return {
    client,
    isInitializing: clientState.isInitializing,
    isReady:
      client !== null && !clientState.isInitializing && !clientState.error,
    error: clientState.error,
    initializeWithRemoteSigner,
    restoreSession,
  };
}
