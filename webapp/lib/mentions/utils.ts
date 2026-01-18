/**
 * Mention detection utilities
 * Handles @username mentions in messages
 */

// Pattern to match @mentions - usernames can contain letters, numbers, underscores, and dots
// Must be at word boundary or start of string
export const MENTION_PATTERN = /(?:^|[^@\w])@([A-Za-z0-9_\.]+)/g;

// Non-global version for testing
const MENTION_TEST_PATTERN = /(?:^|[^@\w])@([A-Za-z0-9_\.]+)/;

/**
 * Extract all @mentions from text
 * Returns array of usernames (without the @ prefix)
 */
export function extractMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = new RegExp(MENTION_PATTERN.source, 'g');
  let match;

  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }

  return [...new Set(mentions)]; // Remove duplicates
}

/**
 * Check if text contains any @mentions
 */
export function hasMentions(text: string): boolean {
  return MENTION_TEST_PATTERN.test(text);
}

/**
 * Check if a specific user is mentioned in text
 * Handles variations like @username, @Username, @username.123
 * @param text - Message text to search
 * @param username - Username to check for (without @ prefix)
 */
export function isMentioned(text: string, username: string | null | undefined): boolean {
  if (!username || !text) return false;

  const mentions = extractMentions(text);
  const normalizedUsername = username.toLowerCase();

  // Check for exact match or match without trailing numbers (e.g., "alice" matches "@alice.1234")
  return mentions.some(mention => {
    // Exact match
    if (mention === normalizedUsername) return true;

    // Match base username (before any dots)
    const mentionBase = mention.split('.')[0];
    const usernameBase = normalizedUsername.split('.')[0];
    return mentionBase === usernameBase;
  });
}

/**
 * Get match info for all mentions in text (for rendering)
 */
export function getMentionMatches(text: string): Array<{
  username: string;
  fullMatch: string;
  start: number;
  end: number;
}> {
  const matches: Array<{
    username: string;
    fullMatch: string;
    start: number;
    end: number;
  }> = [];

  // Use a different approach - find @ symbols and extract usernames
  const regex = /@([A-Za-z0-9_\.]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      username: match[1],
      fullMatch: match[0], // includes the @
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return matches;
}
