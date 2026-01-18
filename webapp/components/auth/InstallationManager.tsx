"use client";

import { useState, useEffect } from "react";
import { Trash2, Monitor, Smartphone, RefreshCw, AlertCircle } from "lucide-react";
import type { Installation as XmtpInstallation, Signer } from "@xmtp/browser-sdk";

interface InstallationDisplay {
  bytes: Uint8Array;
  id: string;
  clientTimestampNs?: bigint;
}

interface InstallationManagerProps {
  inboxId: string;
  onRevokeComplete: () => void;
  onCancel: () => void;
  getSigner: () => Signer;
}

export function InstallationManager({
  inboxId,
  onRevokeComplete,
  onCancel,
  getSigner,
}: InstallationManagerProps) {
  const [installations, setInstallations] = useState<InstallationDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [revoking, setRevoking] = useState(false);

  // Fetch installations on mount
  useEffect(() => {
    fetchInstallations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchInstallations() {
    setLoading(true);
    setError(null);

    try {
      const { Client } = await import("@xmtp/browser-sdk");
      const inboxStates = await Client.fetchInboxStates([inboxId], "production");

      if (inboxStates.length === 0) {
        setError("No inbox state found");
        return;
      }

      const state = inboxStates[0];
      // installations has bytes (Uint8Array) and id (string)
      const installs: InstallationDisplay[] = (state.installations || []).map((inst: XmtpInstallation) => ({
        bytes: inst.bytes,
        id: inst.id,
        clientTimestampNs: inst.clientTimestampNs,
      }));

      setInstallations(installs);
    } catch (err) {
      console.error("Failed to fetch installations:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch installations");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleRevoke() {
    if (selectedIds.size === 0) return;

    setRevoking(true);
    setError(null);

    try {
      const { Client } = await import("@xmtp/browser-sdk");

      // Get the installation bytes to revoke (use bytes, not id)
      const toRevoke = installations
        .filter(inst => selectedIds.has(inst.id))
        .map(inst => inst.bytes);

      // Get the signer from props
      const signer = getSigner();

      await Client.revokeInstallations(signer, inboxId, toRevoke, "production");

      // Success - notify parent
      onRevokeComplete();
    } catch (err) {
      console.error("Failed to revoke installations:", err);
      setError(err instanceof Error ? err.message : "Failed to revoke installations");
      setRevoking(false);
    }
  }

  function handleSelectAll() {
    const allIds = new Set(installations.map(i => i.id));
    setSelectedIds(allIds);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <RefreshCw className="w-8 h-8 text-[var(--text-tertiary)] animate-spin mb-4" />
        <p className="text-[15px] text-[var(--text-secondary)]">Loading installations...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-6 bg-[var(--bg-primary)] rounded-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-[#FF9500]/10 flex items-center justify-center">
          <AlertCircle className="w-5 h-5 text-[#FF9500]" />
        </div>
        <div>
          <h2 className="text-[17px] font-semibold text-[var(--text-primary)]">
            Installation Limit Reached
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            {installations.length}/10 installations used
          </p>
        </div>
      </div>

      <p className="text-[14px] text-[var(--text-secondary)] mb-4">
        You&apos;ve reached the maximum of 10 XMTP installations. Select installations to revoke to make room for a new one.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-[#FF3B30]/10 rounded-lg">
          <p className="text-[13px] text-[#FF3B30]">{error}</p>
        </div>
      )}

      {/* Installations list */}
      <div className="mb-4 max-h-[300px] overflow-y-auto">
        {installations.map((inst) => (
          <button
            key={inst.id}
            onClick={() => toggleSelection(inst.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg mb-2 transition-colors ${
              selectedIds.has(inst.id)
                ? "bg-[#FF3B30]/10 border border-[#FF3B30]/30"
                : "bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]"
            }`}
          >
            <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
              {inst.id.length > 32 ? (
                <Monitor className="w-4 h-4 text-[var(--text-tertiary)]" />
              ) : (
                <Smartphone className="w-4 h-4 text-[var(--text-tertiary)]" />
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="text-[13px] font-mono text-[var(--text-primary)]">
                {inst.id.slice(0, 8)}...{inst.id.slice(-8)}
              </p>
              {inst.clientTimestampNs && (
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  Created: {new Date(Number(inst.clientTimestampNs / BigInt(1000000))).toLocaleDateString()}
                </p>
              )}
            </div>
            {selectedIds.has(inst.id) && (
              <Trash2 className="w-4 h-4 text-[#FF3B30]" />
            )}
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <button
        onClick={handleSelectAll}
        className="w-full mb-4 py-2 text-[13px] text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/5 rounded-lg transition-colors"
      >
        Select all ({installations.length})
      </button>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          disabled={revoking}
          className="flex-1 py-2.5 px-4 text-[14px] font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleRevoke}
          disabled={selectedIds.size === 0 || revoking}
          className="flex-1 py-2.5 px-4 text-[14px] font-medium text-white bg-[#FF3B30] hover:bg-[#FF3B30]/90 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {revoking ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Revoking...
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4" />
              Revoke ({selectedIds.size})
            </>
          )}
        </button>
      </div>
    </div>
  );
}
