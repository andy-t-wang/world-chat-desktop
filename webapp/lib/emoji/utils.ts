import data from '@emoji-mart/data';

export interface EmojiMatch {
  id: string;
  name: string;
  native: string;
  keywords: string[];
}

// Emoji data structure from @emoji-mart/data
interface EmojiData {
  emojis: Record<string, {
    id: string;
    name: string;
    keywords?: string[];
    skins: Array<{ native: string }>;
  }>;
}

const emojiData = data as EmojiData;

// Build a flat list for searching
let emojiList: EmojiMatch[] | null = null;

function getEmojiList(): EmojiMatch[] {
  if (emojiList) return emojiList;

  emojiList = Object.values(emojiData.emojis).map((emoji) => ({
    id: emoji.id,
    name: emoji.name,
    native: emoji.skins[0]?.native || '',
    keywords: emoji.keywords || [],
  })).filter((e) => e.native); // Only include emojis with native representation

  return emojiList;
}

/**
 * Search emojis by query using tiered matching
 */
export function searchEmojis(query: string, limit = 5): EmojiMatch[] {
  if (!query) return [];

  const q = query.toLowerCase();
  const list = getEmojiList();
  const results: EmojiMatch[] = [];

  // Tier 1: shortcode starts with query (most relevant)
  for (const e of list) {
    if (e.id.toLowerCase().startsWith(q)) results.push(e);
    if (results.length >= limit) return results;
  }

  // Tier 2: name/keyword starts with query
  for (const e of list) {
    if (results.includes(e)) continue;
    const name = e.name.toLowerCase();
    if (name.startsWith(q) || name.split(' ').some((w) => w.startsWith(q)) ||
        e.keywords.some((kw) => kw.toLowerCase().startsWith(q))) {
      results.push(e);
    }
    if (results.length >= limit) return results;
  }

  // Tier 3: contains query (fallback)
  for (const e of list) {
    if (results.includes(e)) continue;
    if (e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)) {
      results.push(e);
    }
    if (results.length >= limit) return results;
  }

  return results;
}

/**
 * Find emoji by exact shortcode
 * Used for auto-convert when typing :shortcode:
 */
export function findEmojiByShortcode(shortcode: string): EmojiMatch | null {
  const emoji = emojiData.emojis[shortcode.toLowerCase()];
  if (!emoji || !emoji.skins[0]?.native) return null;

  return {
    id: emoji.id,
    name: emoji.name,
    native: emoji.skins[0].native,
    keywords: emoji.keywords || [],
  };
}
