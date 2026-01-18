"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Search, Loader2, UserPlus, AlertCircle, CheckCircle } from "lucide-react";
import { useAtomValue } from "jotai";
import { Avatar } from "@/components/ui/Avatar";
import { xmtpClientAtom } from "@/stores/client";
import { searchUsernames } from "@/lib/username/service";
import { useCanMessage } from "@/hooks/useXmtpClient";
import type { UsernameRecord } from "@/types/username";
import { IdentifierKind, type Identifier } from "@xmtp/browser-sdk";

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  existingMemberAddresses: string[];
  onMemberAdded: (address: string, displayName: string | null) => void;
}

export function AddMemberModal({
  isOpen,
  onClose,
  conversationId,
  existingMemberAddresses,
  onMemberAdded,
}: AddMemberModalProps) {
  const client = useAtomValue(xmtpClientAtom);
  const { canMessage } = useCanMessage();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UsernameRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [canMessageStatus, setCanMessageStatus] = useState<Record<string, boolean | "checking">>({});
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSearchResults([]);
      setError(null);
      setSelectedAddress(null);
      setCanMessageStatus({});
      // Focus input after a short delay
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Check if input is a valid Ethereum address
  const isValidAddress = (input: string) => /^0x[a-fA-F0-9]{40}$/.test(input);

  // Normalize addresses for comparison
  const normalizedExisting = existingMemberAddresses.map(a => a.toLowerCase());

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

  // Debounced auto-search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      handleSearch();
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, handleSearch]);

  // Add member to group
  const handleAddMember = useCallback(
    async (address: string, displayName: string | null) => {
      if (!client) {
        setError("XMTP client not initialized");
        return;
      }

      setIsAdding(true);
      setSelectedAddress(address);
      setError(null);

      try {
        // Get the conversation
        const conversation = await client.conversations.getConversationById(conversationId);

        if (!conversation || !('addMembersByIdentifiers' in conversation)) {
          throw new Error("Cannot add members to this conversation");
        }

        const group = conversation as unknown as {
          addMembersByIdentifiers: (identifiers: Identifier[]) => Promise<void>;
        };

        // Create identifier for the address
        const identifier: Identifier = {
          identifier: address.toLowerCase(),
          identifierKind: IdentifierKind.Ethereum,
        };

        // Add the member
        await group.addMembersByIdentifiers([identifier]);

        // Notify parent of success
        onMemberAdded(address, displayName);

        // Close the modal
        onClose();
      } catch (err) {
        console.error("Failed to add member:", err);
        setError(err instanceof Error ? err.message : "Failed to add member");
      } finally {
        setIsAdding(false);
        setSelectedAddress(null);
      }
    },
    [client, conversationId, onMemberAdded, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[var(--bg-primary)] rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-[17px] font-semibold text-[var(--text-primary)]">Add Member</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--text-quaternary)]" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-quaternary)]" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search username or enter address"
              className="w-full pl-10 pr-4 py-3 bg-[var(--bg-tertiary)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-quaternary)] outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/20"
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
          <div className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Search Results */}
        <div className="max-h-64 overflow-auto scrollbar-auto-hide">
          {searchResults.length > 0 ? (
            <div className="pb-4">
              {searchResults.map((result) => {
                const addressLower = result.address.toLowerCase();
                const messageStatus = canMessageStatus[addressLower];
                const canReceive = messageStatus === true;
                const isChecking = messageStatus === "checking";
                const isSelected = selectedAddress === result.address;
                const isExisting = normalizedExisting.includes(addressLower);

                return (
                  <button
                    key={result.address}
                    onClick={() => canReceive && !isExisting && handleAddMember(result.address, result.username || null)}
                    disabled={!canReceive || isAdding || isExisting}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] disabled:hover:bg-[var(--bg-primary)] disabled:cursor-not-allowed transition-colors"
                  >
                    <Avatar address={result.address} size="md" />
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-medium text-[15px] text-[var(--text-primary)] truncate">
                        {result.username || `${result.address.slice(0, 6)}...${result.address.slice(-4)}`}
                      </p>
                      {result.username && (
                        <p className="text-[13px] text-[var(--text-quaternary)] truncate font-mono">
                          {result.address.slice(0, 6)}...{result.address.slice(-4)}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {isExisting ? (
                        <span className="text-[13px] text-[var(--text-quaternary)]">Already member</span>
                      ) : isSelected && isAdding ? (
                        <Loader2 className="w-5 h-5 text-[var(--accent-blue)] animate-spin" />
                      ) : isChecking ? (
                        <Loader2 className="w-5 h-5 text-[var(--text-quaternary)] animate-spin" />
                      ) : canReceive ? (
                        <CheckCircle className="w-5 h-5 text-[var(--accent-green)]" />
                      ) : messageStatus === false ? (
                        <span className="text-[13px] text-[var(--text-quaternary)]">Not on XMTP</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : searchQuery && !isSearching ? (
            <div className="p-8 text-center">
              <UserPlus className="w-10 h-10 text-[var(--text-quaternary)] mx-auto mb-3" />
              <p className="text-[var(--text-primary)] font-medium">No users found</p>
              <p className="text-[13px] text-[var(--text-quaternary)] mt-1">
                Try a different username or enter an address
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
