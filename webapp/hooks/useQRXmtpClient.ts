"use client";

import { useCallback, useRef } from "react";
import { useSetAtom, useAtom } from "jotai";
import type { Client, Signer } from "@xmtp/browser-sdk";
import { clientLifecycleAtom, clientStateAtom } from "@/stores/client";
import { streamManager } from "@/lib/xmtp/StreamManager";
import { clearSession } from "@/lib/auth/session";
import {
  isLockedByAnotherTab,
  acquireTabLock,
  releaseTabLock,
} from "@/lib/tab-lock";
import {
  getSessionCache,
  setSessionCache,
  deleteXmtpDatabase,
  deleteAllXmtpDatabases,
} from "@/lib/storage";

// Module cache for faster subsequent loads
let cachedModules: Awaited<ReturnType<typeof loadAllModules>> | null = null;
let moduleLoadPromise: Promise<
  Awaited<ReturnType<typeof loadAllModules>>
> | null = null;
const PENDING_DB_CLEAR_KEY = "xmtp-pending-db-clear";

function isDatabaseCorruptionError(errorMessage: string): boolean {
  const errorLower = errorMessage.toLowerCase();
  return (
    errorLower.includes("database disk image is malformed") ||
    errorLower.includes("sqlite_corrupt") ||
    (errorLower.includes("sqlkeystore") && errorLower.includes("malformed")) ||
    (errorLower.includes("welcome error") &&
      errorLower.includes("querying storage"))
  );
}

/**
 * Load all XMTP modules in parallel (cached)
 */
async function loadAllModules() {
  // v6 has built-in send methods (sendText, sendReaction, sendReply, sendReadReceipt)
  // so we only need codecs for custom types and attachments
  const [
    xmtpModule,
    remoteAttachmentModule,
    transactionRefModule,
    paymentReqModule,
    paymentFulfillModule,
    removeMessageModule,
  ] = await Promise.all([
    import("@xmtp/browser-sdk"),
    import("@xmtp/content-type-remote-attachment"),
    import("@/lib/xmtp/TransactionReferenceCodec"),
    import("@/lib/xmtp/PaymentRequestCodec"),
    import("@/lib/xmtp/PaymentFulfillmentCodec"),
    import("@/lib/xmtp/RemoveMessageCodec"),
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
    RemoveMessageCodec: removeMessageModule.RemoveMessageCodec,
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
  initializeWithRemoteSigner: (signer: Signer) => Promise<void>;
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

    // Check if we need to clear the database (set by corruption recovery path)
    // This must happen BEFORE any XMTP client operations
    const pendingClear = localStorage.getItem(PENDING_DB_CLEAR_KEY);
    if (pendingClear === "true") {
      const result = await deleteAllXmtpDatabases();
      if (!result.success) {
        console.error(
          "[useQRXmtpClient] Failed pending DB clear:",
          result.error || result.failedFiles.join(", "),
        );
        return false;
      }
      localStorage.removeItem(PENDING_DB_CLEAR_KEY);
      clearSession();
      return false;
    }

    const cachedSession = await getSessionCache();
    if (!cachedSession) {
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
        RemoveMessageCodec,
      } = await getModules();

      // Use Client.build() for faster session restoration
      // This skips signer initialization since the client is already registered
      const xmtpClient = await Client.build(
        {
          identifier: cachedSession.address.toLowerCase(),
          identifierKind: IdentifierKind.Ethereum,
        },
        {
          env: "production",
          appVersion: "WorldChat/1.0.0",
          loggingLevel: LogLevel.Off,
          historySyncUrl: "https://message-history.production.ephemera.network",
          codecs: [
            new AttachmentCodec(),
            new RemoteAttachmentCodec(),
            new TransactionReferenceCodec(),
            new PaymentRequestCodec(),
            new PaymentFulfillmentCodec(),
            new RemoveMessageCodec(),
          ],
        },
      );

      // Verify identity is registered before proceeding
      try {
        await xmtpClient.preferences.sync();
      } catch (verifyError) {
        const verifyMsg =
          verifyError instanceof Error
            ? verifyError.message
            : String(verifyError);

        // Check for database lock conflict
        if (
          verifyMsg.includes("Access Handle") ||
          verifyMsg.includes("SyncAccessHandle") ||
          verifyMsg.includes("createSyncAccessHandle")
        ) {
          releaseTabLock();
          throw new Error("TAB_LOCKED");
        }

        if (
          verifyMsg.includes("Uninitialized identity") ||
          verifyMsg.includes("register_identity")
        ) {
          releaseTabLock();
          if (cachedSession.inboxId) {
            await deleteXmtpDatabase(cachedSession.inboxId);
          }
          clearSession();
          dispatch({
            type: "INIT_ERROR",
            error: new Error(
              "Identity registration incomplete. Please login again.",
            ),
          });
          return false;
        }

        if (isDatabaseCorruptionError(verifyMsg)) {
          try {
            localStorage.setItem(PENDING_DB_CLEAR_KEY, "true");
          } catch {
            // Ignore localStorage write errors
          }
          throw new Error("DATABASE_CORRUPTED");
        }
        // Other errors might be transient, continue
      }

      if (xmtpClient.inboxId) {
        setSessionCache(cachedSession.address, xmtpClient.inboxId);
      }

      dispatch({ type: "INIT_SUCCESS", client: xmtpClient });

      // Initialize StreamManager in background
      streamManager.initialize(xmtpClient).catch(() => {});

      return true;
    } catch (error) {
      releaseTabLock();

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage === "TAB_LOCKED") {
        throw error;
      }

      // Detect OPFS database lock conflict
      if (
        errorMessage.includes("Access Handle") ||
        errorMessage.includes("SyncAccessHandle") ||
        errorMessage.includes("createSyncAccessHandle")
      ) {
        throw new Error("TAB_LOCKED");
      }

      if (
        errorMessage === "DATABASE_CORRUPTED" ||
        isDatabaseCorruptionError(errorMessage)
      ) {
        try {
          localStorage.setItem(PENDING_DB_CLEAR_KEY, "true");
        } catch {
          // Ignore localStorage write errors
        }
        dispatch({
          type: "INIT_ERROR",
          error: new Error(
            "Local message database is corrupted. Reload to repair.",
          ),
        });
        return false;
      }

      // Only clear session if OPFS database is truly gone
      const isDbGone =
        errorMessage.toLowerCase().includes("no local database") ||
        errorMessage.toLowerCase().includes("database not found") ||
        errorMessage.toLowerCase().includes("not found");

      if (isDbGone) {
        clearSession();
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
    async (signer: Signer) => {
      // Prevent double initialization
      if (initializingRef.current) {
        console.log("[useQRXmtpClient] Already initializing, skipping");
        return;
      }

      // If client already exists, skip initialization
      if (client) {
        console.log("[useQRXmtpClient] Client already exists, skipping");
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

      const identifier = await Promise.resolve(signer.getIdentifier());
      const address = identifier.identifier;

      try {
        const existingSession = await getSessionCache();

        const {
          Client,
          IdentifierKind,
          LogLevel,
          RemoteAttachmentCodec,
          AttachmentCodec,
          TransactionReferenceCodec,
          PaymentRequestCodec,
          PaymentFulfillmentCodec,
          RemoveMessageCodec,
        } = await getModules();

        const clientOptions = {
          env: "production" as const,
          appVersion: "WorldChat/1.0.0",
          loggingLevel: LogLevel.Off,
          historySyncUrl: "https://message-history.production.ephemera.network",
          codecs: [
            new AttachmentCodec(),
            new RemoteAttachmentCodec(),
            new TransactionReferenceCodec(),
            new PaymentRequestCodec(),
            new PaymentFulfillmentCodec(),
            new RemoveMessageCodec(),
          ],
        };

        let xmtpClient;

        // Check if we have an existing session for THIS specific address
        const hasSessionForThisAddress =
          existingSession?.address?.toLowerCase() === address.toLowerCase();

        if (hasSessionForThisAddress) {
          // Reuse existing installation
          xmtpClient = await Client.build(
            {
              identifier: address.toLowerCase(),
              identifierKind: IdentifierKind.Ethereum,
            },
            clientOptions,
          );
        } else {
          // Fresh login
          xmtpClient = await Client.create(signer, clientOptions);
        }

        // Verify identity is registered before caching session
        try {
          await xmtpClient.preferences.sync();
        } catch (verifyError) {
          const verifyMsg =
            verifyError instanceof Error
              ? verifyError.message
              : String(verifyError);

          if (
            verifyMsg.includes("Access Handle") ||
            verifyMsg.includes("SyncAccessHandle") ||
            verifyMsg.includes("createSyncAccessHandle")
          ) {
            releaseTabLock();
            throw new Error("TAB_LOCKED");
          }

          if (
            verifyMsg.includes("Uninitialized identity") ||
            verifyMsg.includes("register_identity")
          ) {
            if (xmtpClient.inboxId) {
              await deleteXmtpDatabase(xmtpClient.inboxId);
            }
            releaseTabLock();
            clearSession();
            dispatch({
              type: "INIT_ERROR",
              error: new Error(
                "Identity registration failed. Please try again.",
              ),
            });
            throw new Error("Identity registration incomplete");
          }
          // Other errors might be transient, continue
        }

        if (xmtpClient.inboxId) {
          setSessionCache(address, xmtpClient.inboxId);
        }

        dispatch({ type: "INIT_SUCCESS", client: xmtpClient });

        // Initialize StreamManager in background
        streamManager.initialize(xmtpClient).catch(() => {});
      } catch (error) {
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
    [client, dispatch],
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
