'use client';

import type { EmojiMatch } from '@/lib/emoji/utils';

interface EmojiSuggestionProps {
  emoji: EmojiMatch;
  query: string;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Highlight the matching query text in the shortcode
 */
function HighlightedShortcode({ shortcode, query }: { shortcode: string; query: string }) {
  if (!query) {
    return <span>:{shortcode}:</span>;
  }

  const lowerShortcode = shortcode.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerShortcode.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return <span>:{shortcode}:</span>;
  }

  const before = shortcode.slice(0, matchIndex);
  const match = shortcode.slice(matchIndex, matchIndex + query.length);
  const after = shortcode.slice(matchIndex + query.length);

  return (
    <span>
      :{before}
      <span className="text-[#F59E0B] font-medium">{match}</span>
      {after}:
    </span>
  );
}

export function EmojiSuggestion({ emoji, query, isSelected, onClick }: EmojiSuggestionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
        isSelected ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
    >
      <span className="text-xl flex-shrink-0 w-6 text-center">{emoji.native}</span>
      <span className="text-sm text-[var(--text-primary)] truncate">
        <HighlightedShortcode shortcode={emoji.id} query={query} />
      </span>
    </button>
  );
}
