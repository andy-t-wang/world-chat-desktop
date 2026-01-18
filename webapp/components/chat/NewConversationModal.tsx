"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  X,
  Search,
  Loader2,
  UserPlus,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { useAtom } from "jotai";
import { Avatar } from "@/components/ui/Avatar";
import { xmtpClientAtom } from "@/stores/client";
import { selectedConversationIdAtom } from "@/stores/ui";
import { searchUsernames } from "@/lib/username/service";
import { useCanMessage } from "@/hooks/useXmtpClient";
import { streamManager } from "@/lib/xmtp/StreamManager";
import type { UsernameRecord } from "@/types/username";
import { IdentifierKind, type Identifier } from "@xmtp/browser-sdk";

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewConversationModal({
  isOpen,
  onClose,
}: NewConversationModalProps) {
  const [client] = useAtom(xmtpClientAtom);
  const [, setSelectedConversationId] = useAtom(selectedConversationIdAtom);
  const { canMessage } = useCanMessage();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UsernameRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [canMessageStatus, setCanMessageStatus] = useState<
    Record<string, boolean | "checking">
  >({});
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Check if input is a valid Ethereum address
  const isValidAddress = (input: string) => /^0x[a-fA-F0-9]{40}$/.test(input);

  // Search for usernames or validate address
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      if (isValidAddress(searchQuery)) {
        // Direct address input - create a synthetic result
        setSearchResults([
          {
            address: searchQuery as `0x${string}`,
            username: "",
            profile_picture_url: null,
            minimized_profile_picture_url: null,
          },
        ]);
        // Check if this address can receive messages
        setCanMessageStatus((prev) => ({
          ...prev,
          [searchQuery.toLowerCase()]: "checking",
        }));
        const canReceive = await canMessage(searchQuery);
        setCanMessageStatus((prev) => ({
          ...prev,
          [searchQuery.toLowerCase()]: canReceive,
        }));
      } else {
        // Search by username
        const results = await searchUsernames(searchQuery);
        setSearchResults(results);

        // Check canMessage for all results
        for (const result of results) {
          setCanMessageStatus((prev) => ({
            ...prev,
            [result.address.toLowerCase()]: "checking",
          }));
          const canReceive = await canMessage(result.address);
          setCanMessageStatus((prev) => ({
            ...prev,
            [result.address.toLowerCase()]: canReceive,
          }));
        }
      }
    } catch (err) {
      console.error("Search error:", err);
      setError("Failed to search. Please try again.");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, canMessage]);

  // Debounced auto-search - triggers 250ms after user stops typing
  useEffect(() => {
    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Clear results if query is empty
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setError(null);
      return;
    }

    // Set new timeout for search
    debounceRef.current = setTimeout(() => {
      handleSearch();
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, handleSearch]);

  // Create a new DM conversation
  const handleCreateConversation = useCallback(
    async (address: string) => {
      if (!client) {
        setError("XMTP client not initialized");
        return;
      }

      setIsCreating(true);
      setSelectedAddress(address);
      setError(null);

      try {
        const identifier: Identifier = {
          identifier: address.toLowerCase(),
          identifierKind: IdentifierKind.Ethereum,
        };

        // Create or find existing DM using identifier
        const conversation = await client.conversations.createDmWithIdentifier(
          identifier
        );

        // Register the conversation with StreamManager (stores it, builds metadata)
        await streamManager.registerNewConversation(conversation);

        // Select the new conversation
        setSelectedConversationId(conversation.id);

        // Close the modal
        onClose();
      } catch (err) {
        console.error("Failed to create conversation:", err);
        setError(
          err instanceof Error ? err.message : "Failed to create conversation"
        );
      } finally {
        setIsCreating(false);
        setSelectedAddress(null);
      }
    },
    [client, setSelectedConversationId, onClose]
  );

  // Handle key press in search input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[var(--bg-primary)] rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            New Conversation
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search username or enter address (0x...)"
              className="w-full pl-10 pr-4 py-3 bg-[var(--bg-tertiary)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/20"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--accent-blue)] animate-spin" />
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Search Results */}
        <div className="max-h-64 overflow-auto">
          {searchResults.length > 0 ? (
            <div className="pb-4">
              {searchResults.map((result) => {
                const addressLower = result.address.toLowerCase();
                const messageStatus = canMessageStatus[addressLower];
                const canReceive = messageStatus === true;
                const isChecking = messageStatus === "checking";
                const isSelected = selectedAddress === result.address;

                return (
                  <button
                    key={result.address}
                    onClick={() =>
                      canReceive && handleCreateConversation(result.address)
                    }
                    disabled={!canReceive || isCreating}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] disabled:hover:bg-[var(--bg-primary)] disabled:cursor-not-allowed transition-colors"
                  >
                    <Avatar address={result.address} size="sm" />
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-medium text-[var(--text-primary)] truncate">
                        {result.username ||
                          `${result.address.slice(
                            0,
                            6
                          )}...${result.address.slice(-4)}`}
                      </p>
                      {result.username && (
                        <p className="text-sm text-[var(--text-secondary)] truncate font-mono">
                          {result.address.slice(0, 6)}...
                          {result.address.slice(-4)}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {isSelected && isCreating ? (
                        <Loader2 className="w-5 h-5 text-[var(--accent-blue)] animate-spin" />
                      ) : isChecking ? (
                        <Loader2 className="w-5 h-5 text-[var(--text-tertiary)] animate-spin" />
                      ) : canReceive ? (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      ) : messageStatus === false ? (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          Cannot message
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : searchQuery && !isSearching ? (
            <div className="p-8 text-center">
              <UserPlus className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--text-secondary)]">No users found</p>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">
                Try a different username or enter an address
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer hint */}
        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <p className="text-xs text-[var(--text-tertiary)] text-center">
            Only DM creation is supported for now.
          </p>
        </div>
      </div>
    </div>
  );
}
