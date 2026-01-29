"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { useAtomValue } from "jotai";
import { extractTickers, type TickerType } from "@/lib/ticker/utils";
import { TickerPreview } from "./TickerPreview";
import type { TickerPriceData } from "@/app/api/ticker-price/route";
import { customNicknamesAtom } from "@/stores/nicknames";
import { getCachedUsername } from "@/lib/username/service";
import { useUsername } from "@/hooks/useUsername";
import { Avatar } from "@/components/ui/Avatar";
import {
  searchEmojis,
  findEmojiByShortcode,
  type EmojiMatch,
} from "@/lib/emoji/utils";
import { EmojiSuggestion } from "./EmojiSuggestion";

export interface MemberPreview {
  inboxId: string;
  address: string;
}

interface HighlightedInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  onTickerClick?: (
    symbol: string,
    type: TickerType,
    data: TickerPriceData,
  ) => void;
  /** Members for @mention autocomplete (group chats) */
  members?: MemberPreview[];
  /** Current user's inbox ID (to exclude from suggestions) */
  currentInboxId?: string;
}

export interface HighlightedInputRef {
  focus: () => void;
  blur: () => void;
}

// Regex to match tickers ($ for crypto, # for stocks)
// Note: Use separate regex for test vs exec to avoid lastIndex issues with global flag
const TICKER_PATTERN = /([#$])([A-Za-z]{1,10})\b/g;
const TICKER_TEST_PATTERN = /([#$])([A-Za-z]{1,10})\b/;

// Single member suggestion row
function MemberSuggestion({
  member,
  nickname,
  isSelected,
  onClick,
}: {
  member: MemberPreview;
  nickname?: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { displayName: username, profilePicture } = useUsername(member.address);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
        isSelected ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"
      }`}
    >
      <Avatar
        address={member.address}
        size="sm"
        className="w-8 h-8"
        imageUrl={profilePicture || undefined}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)] truncate">
          {nickname || username}
        </div>
        {nickname && (
          <div className="text-xs text-[var(--text-tertiary)] truncate">
            @{username}
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Textarea with highlighted ticker symbols
 * Uses overlay technique: invisible text in textarea, visible highlighted text behind
 */
export const HighlightedInput = forwardRef<
  HighlightedInputRef,
  HighlightedInputProps
>(
  (
    {
      value,
      onChange,
      onKeyDown,
      placeholder,
      disabled,
      onTickerClick,
      members,
      currentInboxId,
    },
    ref,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const customNicknames = useAtomValue(customNicknamesAtom);

    // Ticker preview popup state
    const [tickerPopup, setTickerPopup] = useState<{
      symbol: string;
      type: TickerType;
      position: { x: number; y: number };
    } | null>(null);

    // Unified autocomplete state (only one can be active at a time)
    type AutocompleteState = {
      type: "mention" | "emoji";
      query: string;
      startIndex: number;
      selectedIndex: number;
    } | null;
    const [autocomplete, setAutocomplete] = useState<AutocompleteState>(null);

    // Filter members based on mention query (excluding self)
    const filteredMembers = useMemo(() => {
      if (autocomplete?.type !== "mention" || !members) return [];

      const query = autocomplete.query.toLowerCase();
      return members
        .filter((m) => m.inboxId !== currentInboxId) // Exclude self
        .filter((m) => {
          if (!query) return true; // Show all if just "@"

          // Check nickname
          const nickname = customNicknames[m.address.toLowerCase()];
          if (nickname?.toLowerCase().includes(query)) return true;

          // Check cached username
          const cached = getCachedUsername(m.address);
          if (cached?.username?.toLowerCase().includes(query)) return true;

          // Check address
          if (m.address.toLowerCase().includes(query)) return true;

          return false;
        })
        .slice(0, 5); // Limit to 5 suggestions
    }, [members, autocomplete, currentInboxId, customNicknames]);

    // Filter emojis based on emoji query
    const filteredEmojis = useMemo(() => {
      if (autocomplete?.type !== "emoji" || autocomplete.query.length < 2)
        return [];
      return searchEmojis(autocomplete.query, 5);
    }, [autocomplete]);

    // Detect @ trigger while typing
    const detectMention = useCallback((text: string, cursorPos: number) => {
      // Look backwards from cursor to find @
      let atIndex = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const char = text[i];
        if (char === "@") {
          // Check if this @ is at start or preceded by whitespace
          if (i === 0 || /\s/.test(text[i - 1])) {
            atIndex = i;
            break;
          }
        }
        // Stop if we hit whitespace (no @ in this word)
        if (/\s/.test(char)) break;
      }

      if (atIndex >= 0) {
        const query = text.slice(atIndex + 1, cursorPos);
        // Only show if query doesn't contain spaces
        if (!query.includes(" ")) {
          setAutocomplete({
            type: "mention",
            query,
            startIndex: atIndex,
            selectedIndex: 0,
          });
          return;
        }
      }

      // No valid mention trigger - only clear if we were showing mention
      setAutocomplete((prev) => (prev?.type === "mention" ? null : prev));
    }, []);

    // Handle mention selection
    const handleMentionSelect = useCallback(
      (member: MemberPreview) => {
        if (autocomplete?.type !== "mention") return;

        const cached = getCachedUsername(member.address);
        const username = cached?.username || member.address.slice(0, 10);

        // Replace @query with @username
        const before = value.slice(0, autocomplete.startIndex);
        const after = value.slice(
          autocomplete.startIndex + 1 + autocomplete.query.length,
        );
        const newValue = `${before}@${username} ${after}`;

        onChange(newValue);
        setAutocomplete(null);

        // Focus and set cursor after the inserted mention
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const newCursorPos = before.length + username.length + 2; // +2 for @ and space
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      },
      [value, autocomplete, onChange],
    );

    // Detect :emoji trigger while typing
    const detectEmoji = useCallback((text: string, cursorPos: number) => {
      // Look backwards from cursor to find :
      let colonIndex = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const char = text[i];
        if (char === ":") {
          // Valid if at start or preceded by whitespace
          if (i === 0 || /\s/.test(text[i - 1])) {
            colonIndex = i;
            break;
          }
        }
        // Stop if we hit whitespace or another colon (no : in this word)
        if (/\s/.test(char)) break;
      }

      if (colonIndex >= 0) {
        const query = text.slice(colonIndex + 1, cursorPos);
        // Only show if query is alphanumeric/underscore and no spaces
        if (/^[A-Za-z0-9_+-]+$/.test(query) && query.length >= 2) {
          setAutocomplete({
            type: "emoji",
            query,
            startIndex: colonIndex,
            selectedIndex: 0,
          });
          return;
        }
      }

      // No valid emoji trigger - only clear if we were showing emoji
      setAutocomplete((prev) => (prev?.type === "emoji" ? null : prev));
    }, []);

    // Handle emoji selection
    const handleEmojiSelect = useCallback(
      (emoji: EmojiMatch) => {
        if (autocomplete?.type !== "emoji") return;

        // Replace :query with emoji character
        const before = value.slice(0, autocomplete.startIndex);
        const after = value.slice(
          autocomplete.startIndex + 1 + autocomplete.query.length,
        );
        const newValue = `${before}${emoji.native}${after}`;

        onChange(newValue);
        setAutocomplete(null);

        // Focus and set cursor after the inserted emoji
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const newCursorPos = before.length + emoji.native.length;
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      },
      [value, autocomplete, onChange],
    );

    // Auto-convert complete :shortcode: to emoji
    const autoConvertEmoji = useCallback((text: string): string | null => {
      // Match :shortcode: pattern (with closing colon)
      const match = text.match(/:([A-Za-z0-9_+-]+):$/);
      if (!match) return null;

      const shortcode = match[1];
      const emoji = findEmojiByShortcode(shortcode);
      if (!emoji) return null;

      // Replace the :shortcode: with the emoji
      return text.slice(0, -match[0].length) + emoji.native;
    }, []);

    // Expose focus/blur methods
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      blur: () => textareaRef.current?.blur(),
    }));

    // Sync scroll between textarea and overlay
    const syncScroll = useCallback(() => {
      if (textareaRef.current && overlayRef.current) {
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
      }
    }, []);

    // Auto-resize textarea
    const autoResize = useCallback(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 128) + "px";
      }
    }, []);

    useEffect(() => {
      autoResize();
    }, [value, autoResize]);

    // Handle ticker click in overlay
    const handleTickerClick = useCallback(
      (e: React.MouseEvent, symbol: string, type: TickerType) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();

        if (containerRect) {
          setTickerPopup({
            symbol,
            type,
            position: {
              x: rect.left - containerRect.left + rect.width / 2,
              y: rect.top - containerRect.top - 8, // Position above the ticker
            },
          });
        }
      },
      [],
    );

    // Close popup when clicking outside
    useEffect(() => {
      if (!tickerPopup) return;

      const handleClick = () => setTickerPopup(null);
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }, [tickerPopup]);

    // Render highlighted text with clickable tickers
    const renderHighlightedText = useCallback(() => {
      if (!value) return null;

      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;
      const regex = new RegExp(TICKER_PATTERN.source, "g");

      while ((match = regex.exec(value)) !== null) {
        // Add text before ticker
        if (match.index > lastIndex) {
          parts.push(
            <span key={`text-${lastIndex}`}>
              {value.slice(lastIndex, match.index)}
            </span>,
          );
        }

        // Add highlighted ticker
        const prefix = match[1] as "$" | "#";
        const symbol = match[2].toUpperCase();
        const type: TickerType = prefix === "$" ? "crypto" : "stock";

        parts.push(
          <span
            key={`ticker-${match.index}`}
            className="text-[var(--accent-blue)] cursor-pointer hover:underline pointer-events-auto"
            onClick={(e) => handleTickerClick(e, symbol, type)}
          >
            {match[0]}
          </span>,
        );

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < value.length) {
        parts.push(
          <span key={`text-${lastIndex}`}>{value.slice(lastIndex)}</span>,
        );
      }

      return parts;
    }, [value, handleTickerClick]);

    const hasTickers = TICKER_TEST_PATTERN.test(value);

    return (
      <div ref={containerRef} className="relative flex-1 min-w-0 mt-[6px]">
        {/* Actual textarea - at the bottom layer for typing */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            let newValue = e.target.value;
            const cursorPos = e.target.selectionStart;

            // Check for auto-convert :shortcode: to emoji
            const converted = autoConvertEmoji(newValue);
            if (converted !== null) {
              newValue = converted;
              setAutocomplete(null);
            }

            onChange(newValue);
            autoResize();

            // Detect @mention trigger
            if (members && members.length > 0) {
              detectMention(newValue, cursorPos);
            }

            // Detect :emoji trigger (only if not auto-converted)
            if (converted === null) {
              detectEmoji(newValue, cursorPos);
            }
          }}
          onKeyDown={(e) => {
            // Handle autocomplete keyboard navigation
            const items =
              autocomplete?.type === "emoji" ? filteredEmojis : filteredMembers;
            if (autocomplete && items.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAutocomplete((prev) =>
                  prev
                    ? {
                        ...prev,
                        selectedIndex:
                          prev.selectedIndex < items.length - 1
                            ? prev.selectedIndex + 1
                            : 0,
                      }
                    : null,
                );
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setAutocomplete((prev) =>
                  prev
                    ? {
                        ...prev,
                        selectedIndex:
                          prev.selectedIndex > 0
                            ? prev.selectedIndex - 1
                            : items.length - 1,
                      }
                    : null,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (autocomplete.type === "emoji") {
                  handleEmojiSelect(filteredEmojis[autocomplete.selectedIndex]);
                } else {
                  handleMentionSelect(
                    filteredMembers[autocomplete.selectedIndex],
                  );
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setAutocomplete(null);
                return;
              }
            }
            // Pass through to parent handler
            onKeyDown(e);
          }}
          onScroll={syncScroll}
          placeholder={hasTickers ? "" : placeholder}
          rows={1}
          disabled={disabled}
          className={`relative w-full px-4 py-2.5 bg-[var(--bubble-incoming)] rounded-[20px] outline-none resize-none leading-[1.4] transition-all scrollbar-hide ${
            hasTickers
              ? "text-transparent caret-[var(--text-primary)]"
              : "text-[var(--text-primary)] placeholder-[var(--text-quaternary)]"
          }`}
          style={{ minHeight: "44px", maxHeight: "128px" }}
        />

        {/* Highlighted overlay - on top for display and ticker clicks */}
        {hasTickers && (
          <div
            ref={overlayRef}
            className="absolute inset-0 px-4 py-2.5 rounded-[20px] text-[var(--text-primary)] leading-[1.4] overflow-hidden pointer-events-none whitespace-pre-wrap break-words"
            style={{ minHeight: "44px", maxHeight: "128px" }}
            aria-hidden="true"
          >
            {renderHighlightedText()}
          </div>
        )}

        {/* Ticker preview popup */}
        {tickerPopup && (
          <div
            className="absolute z-50 transform -translate-x-1/2"
            style={{
              left: tickerPopup.position.x,
              bottom: "100%",
              marginBottom: "8px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <TickerPreview
              symbol={tickerPopup.symbol}
              type={tickerPopup.type}
              onOpenModal={(symbol, type, data) => {
                setTickerPopup(null);
                onTickerClick?.(symbol, type, data);
              }}
            />
          </div>
        )}

        {/* @mention autocomplete dropdown */}
        {autocomplete?.type === "mention" && filteredMembers.length > 0 && (
          <div
            className="absolute left-0 right-0 z-50 bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border-subtle)] py-1 max-h-[200px] overflow-y-auto"
            style={{
              bottom: "100%",
              marginBottom: "8px",
            }}
          >
            {filteredMembers.map((member, index) => (
              <MemberSuggestion
                key={member.inboxId}
                member={member}
                nickname={customNicknames[member.address.toLowerCase()]}
                isSelected={index === autocomplete.selectedIndex}
                onClick={() => handleMentionSelect(member)}
              />
            ))}
          </div>
        )}

        {/* :emoji autocomplete dropdown */}
        {autocomplete?.type === "emoji" && filteredEmojis.length > 0 && (
          <div
            className="absolute left-0 right-0 z-50 bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border-subtle)] py-1 max-h-[200px] overflow-y-auto"
            style={{
              bottom: "100%",
              marginBottom: "8px",
            }}
          >
            {filteredEmojis.map((emoji, index) => (
              <EmojiSuggestion
                key={emoji.id}
                emoji={emoji}
                query={autocomplete.query}
                isSelected={index === autocomplete.selectedIndex}
                onClick={() => handleEmojiSelect(emoji)}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

HighlightedInput.displayName = "HighlightedInput";
