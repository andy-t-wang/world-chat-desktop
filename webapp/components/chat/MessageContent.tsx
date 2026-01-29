'use client';

import { useMemo, type ReactNode } from 'react';
import { LinkPreview, extractUrls } from './LinkPreview';
import { useLinkPreview } from '@/hooks/useLinkPreview';
import type { TickerType } from '@/lib/ticker/utils';

interface MessageTextProps {
  text: string;
  isOwnMessage: boolean;
  /** Callback when a ticker symbol is clicked */
  onTickerClick?: (symbol: string, type: TickerType) => void;
  /** Callback when a @mention is clicked */
  onMentionClick?: (username: string) => void;
}

// Regex patterns
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
const TICKER_PATTERN = /([#$])([A-Za-z]{1,10})\b/g; // $ for crypto, # for stocks/commodities
const MENTION_PATTERN = /@([A-Za-z0-9_\.]+)/g; // @username mentions

// Component to render just the text content with clickable links and tickers
export function MessageText({ text, isOwnMessage, onTickerClick, onMentionClick }: MessageTextProps) {
  // Render text with clickable links and highlighted tickers
  const formattedText = useMemo(() => {
    // Find all URLs, tickers, and mentions with their positions
    const matches: Array<{
      type: 'url' | 'ticker' | 'mention';
      match: string;
      symbol?: string;
      tickerType?: TickerType;
      username?: string;
      start: number;
      end: number;
    }> = [];

    // Find URLs
    let urlMatch;
    const urlRegex = new RegExp(URL_PATTERN.source, 'gi');
    while ((urlMatch = urlRegex.exec(text)) !== null) {
      matches.push({
        type: 'url',
        match: urlMatch[0],
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length,
      });
    }

    // Find tickers ($ for crypto, # for stocks)
    let tickerMatch;
    const tickerRegex = new RegExp(TICKER_PATTERN.source, 'g');
    while ((tickerMatch = tickerRegex.exec(text)) !== null) {
      const prefix = tickerMatch[1]; // $ or #
      const symbol = tickerMatch[2].toUpperCase(); // Normalize to uppercase
      const tickerType: TickerType = prefix === '$' ? 'crypto' : 'stock';
      matches.push({
        type: 'ticker',
        match: tickerMatch[0],
        symbol,
        tickerType,
        start: tickerMatch.index,
        end: tickerMatch.index + tickerMatch[0].length,
      });
    }

    // Find @mentions
    let mentionMatch;
    const mentionRegex = new RegExp(MENTION_PATTERN.source, 'g');
    while ((mentionMatch = mentionRegex.exec(text)) !== null) {
      matches.push({
        type: 'mention',
        match: mentionMatch[0],
        username: mentionMatch[1],
        start: mentionMatch.index,
        end: mentionMatch.index + mentionMatch[0].length,
      });
    }

    // If no matches, return plain text
    if (matches.length === 0) return text;

    // Sort by position
    matches.sort((a, b) => a.start - b.start);

    // Build parts array
    const parts: ReactNode[] = [];
    let lastIndex = 0;

    for (const m of matches) {
      // Skip if this match overlaps with previous (e.g., ticker inside URL)
      if (m.start < lastIndex) continue;

      // Add text before this match
      if (m.start > lastIndex) {
        parts.push(text.slice(lastIndex, m.start));
      }

      if (m.type === 'url') {
        // Render URL as link
        parts.push(
          <a
            key={`url-${m.start}`}
            href={m.match}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline break-all ${
              isOwnMessage
                ? 'text-white hover:text-white/80'
                : 'text-[var(--accent-blue)] hover:opacity-80'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {m.match}
          </a>
        );
      } else if (m.type === 'ticker' && m.symbol && m.tickerType) {
        // Render ticker as clickable highlighted span
        parts.push(
          <span
            key={`ticker-${m.start}`}
            role="button"
            tabIndex={0}
            className={`font-medium cursor-pointer ${
              isOwnMessage
                ? 'text-white/90 hover:text-white underline decoration-white/40'
                : 'text-[var(--accent-blue)] hover:opacity-80'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onTickerClick?.(m.symbol!, m.tickerType!);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTickerClick?.(m.symbol!, m.tickerType!);
              }
            }}
          >
            {m.match}
          </span>
        );
      } else if (m.type === 'mention' && m.username) {
        // Render @mention as bold text
        parts.push(
          <span
            key={`mention-${m.start}`}
            role="button"
            tabIndex={0}
            className={`font-semibold cursor-pointer ${
              isOwnMessage
                ? 'text-white hover:underline'
                : 'text-[var(--text-primary)] hover:underline'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onMentionClick?.(m.username!);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onMentionClick?.(m.username!);
              }
            }}
          >
            {m.match}
          </span>
        );
      }

      lastIndex = m.end;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  }, [text, isOwnMessage, onTickerClick, onMentionClick]);

  return (
    <p
      className={`text-[16px] leading-[1.4] whitespace-pre-wrap break-words ${
        isOwnMessage ? 'text-white' : 'text-[var(--text-primary)]'
      }`}
    >
      {formattedText}
    </p>
  );
}

interface MessageLinkPreviewProps {
  text: string;
  isOwnMessage: boolean;
}

// Component to render link preview for a message (renders outside the bubble)
export function MessageLinkPreview({ text, isOwnMessage }: MessageLinkPreviewProps) {
  // Extract URLs from text
  const urls = useMemo(() => extractUrls(text), [text]);

  // Only show preview for the first URL to avoid cluttering
  const firstUrl = urls[0] ?? null;
  const { metadata, isLoading } = useLinkPreview(firstUrl);

  if (!firstUrl) return null;

  return (
    <LinkPreview
      metadata={metadata}
      isLoading={isLoading}
      isOwnMessage={isOwnMessage}
    />
  );
}

// Legacy export for backward compatibility
interface MessageContentProps {
  text: string;
  isOwnMessage: boolean;
}

export function MessageContent({ text, isOwnMessage }: MessageContentProps) {
  return (
    <div>
      <MessageText text={text} isOwnMessage={isOwnMessage} />
      <MessageLinkPreview text={text} isOwnMessage={isOwnMessage} />
    </div>
  );
}
