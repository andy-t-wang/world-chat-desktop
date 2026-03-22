"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Smartphone,
  Archive,
} from "lucide-react";
import { streamManager } from "@/lib/xmtp/StreamManager";

type SyncState =
  | "idle"
  | "requesting"
  | "waiting_for_archives"
  | "importing"
  | "complete"
  | "error";

interface ArchiveInfo {
  pin: string;
  metadata: {
    backupVersion: number;
    elements: string[];
    exportedAtNs: bigint;
    startNs?: bigint;
    endNs?: bigint;
  };
  sentByInstallation: Uint8Array;
}

interface HistorySyncFlowProps {
  onClose: () => void;
  onComplete: () => void;
  isModal?: boolean;
}

function formatInstallationId(bytes: Uint8Array): string {
  const hex = Array.from(bytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex}...`;
}

function formatNsTimestamp(ns: bigint): string {
  const ms = Number(ns / BigInt(1_000_000));
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElements(elements: string[]): string {
  if (!elements || elements.length === 0) return "All data";
  return elements
    .map((e) => {
      const s = String(e);
      if (s.toLowerCase().includes("message")) return "Messages";
      if (s.toLowerCase().includes("consent")) return "Consent";
      return s;
    })
    .join(" & ");
}

export function HistorySyncFlow({
  onClose,
  onComplete,
  isModal = false,
}: HistorySyncFlowProps) {
  const [state, setState] = useState<SyncState>("idle");
  const [archives, setArchives] = useState<ArchiveInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const fetchArchives = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await streamManager.refreshDeviceSyncGroups();
      const result = await streamManager.getAvailableArchives(30);
      // Sort by export date, newest first
      const sorted = (result as ArchiveInfo[]).sort((a, b) => {
        const aTime = a.metadata?.exportedAtNs ?? BigInt(0);
        const bTime = b.metadata?.exportedAtNs ?? BigInt(0);
        if (bTime > aTime) return 1;
        if (bTime < aTime) return -1;
        return 0;
      });
      setArchives(sorted);
    } catch (err) {
      console.error("[HistorySyncFlow] Failed to fetch archives:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    // Initial fetch
    fetchArchives();
    // Poll every 15 seconds
    pollIntervalRef.current = setInterval(fetchArchives, 15000);
  }, [fetchArchives, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleStartSync = async () => {
    setState("requesting");
    setError(null);
    try {
      await streamManager.sendHistorySyncRequest();
      setState("waiting_for_archives");
      startPolling();
    } catch (err) {
      console.error("[HistorySyncFlow] Sync request failed:", err);
      setError(err instanceof Error ? err.message : "Failed to send sync request");
      setState("error");
    }
  };

  const handleImport = async (pin: string) => {
    stopPolling();
    setState("importing");
    setError(null);
    try {
      await streamManager.processArchive(pin);
      setState("complete");
    } catch (err) {
      console.error("[HistorySyncFlow] Archive import failed:", err);
      setError(err instanceof Error ? err.message : "Failed to import archive");
      setState("error");
    }
  };

  const handleRetry = () => {
    setError(null);
    setState("waiting_for_archives");
    startPolling();
  };

  // Idle: show start button
  if (state === "idle") {
    return (
      <div className={isModal ? "" : "py-2"}>
        {isModal && (
          <div className="text-center mb-4">
            <Archive className="w-10 h-10 text-[var(--accent-blue)] mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">
              Sync Message History
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Import your conversations from another device
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleStartSync}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue-hover)] transition-colors text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Sync from another device
          </button>
          {isModal && (
            <button
              onClick={onClose}
              className="py-2.5 px-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors text-sm"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    );
  }

  // Requesting: sending sync request
  if (state === "requesting") {
    return (
      <div className="flex flex-col items-center py-6 gap-3">
        <Loader2 className="w-8 h-8 text-[var(--accent-blue)] animate-spin" />
        <p className="text-sm text-[var(--text-secondary)]">
          Sending sync request...
        </p>
      </div>
    );
  }

  // Waiting for archives: polling + archive list
  if (state === "waiting_for_archives") {
    return (
      <div className={isModal ? "" : "py-2"}>
        {/* Prompt to open other device */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)] mb-4">
          <Smartphone className="w-5 h-5 text-[var(--accent-blue)] shrink-0" />
          <p className="text-sm text-[var(--text-primary)]">
            Open the device you want to sync messages from
          </p>
        </div>

        {/* Archive list header */}
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Available Archives
          </h4>
          <button
            onClick={fetchArchives}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:text-[var(--accent-blue-hover)] disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {/* Archive list */}
        {archives.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-[var(--text-secondary)]">
              {isRefreshing
                ? "Checking for archives..."
                : "No archives found yet. Waiting for other device..."}
            </p>
            {!isRefreshing && (
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Checking automatically every 15 seconds
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {archives.map((archive) => (
              <div
                key={archive.pin}
                className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {archive.pin}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {archive.metadata?.exportedAtNs
                      ? formatNsTimestamp(archive.metadata.exportedAtNs)
                      : "Unknown date"}
                    {" — "}
                    {formatElements(archive.metadata?.elements?.map(String) ?? [])}
                  </p>
                  {archive.sentByInstallation &&
                    archive.sentByInstallation.length > 0 && (
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                        From: {formatInstallationId(archive.sentByInstallation)}
                      </p>
                    )}
                </div>
                <button
                  onClick={() => handleImport(archive.pin)}
                  className="ml-3 shrink-0 px-3 py-1.5 bg-[var(--accent-blue)] text-white text-xs font-medium rounded-md hover:bg-[var(--accent-blue-hover)] transition-colors"
                >
                  Import
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end mt-4">
          <button
            onClick={() => {
              stopPolling();
              onClose();
            }}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {isModal ? "Skip" : "Cancel"}
          </button>
        </div>
      </div>
    );
  }

  // Importing
  if (state === "importing") {
    return (
      <div className="flex flex-col items-center py-6 gap-3">
        <Loader2 className="w-8 h-8 text-[var(--accent-blue)] animate-spin" />
        <p className="text-sm text-[var(--text-primary)] font-medium">
          Importing archive...
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          This may take a moment
        </p>
      </div>
    );
  }

  // Complete
  if (state === "complete") {
    return (
      <div className="flex flex-col items-center py-6 gap-3">
        <CheckCircle className="w-10 h-10 text-[var(--success-600)]" />
        <p className="text-sm text-[var(--text-primary)] font-medium">
          Import complete!
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          Your messages have been synced
        </p>
        <button
          onClick={onComplete}
          className="mt-2 px-6 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue-hover)] transition-colors text-sm font-medium"
        >
          Continue
        </button>
      </div>
    );
  }

  // Error
  return (
    <div className="flex flex-col items-center py-6 gap-3">
      <AlertCircle className="w-10 h-10 text-red-500" />
      <p className="text-sm text-[var(--text-primary)] font-medium">
        Sync failed
      </p>
      <p className="text-xs text-[var(--text-secondary)] text-center max-w-xs">
        {error || "An unexpected error occurred"}
      </p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleRetry}
          className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue-hover)] transition-colors text-sm"
        >
          Retry
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors text-sm"
        >
          {isModal ? "Skip" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
