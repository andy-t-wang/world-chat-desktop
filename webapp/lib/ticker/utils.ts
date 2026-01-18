/**
 * Ticker Symbol Utilities
 * Detects and extracts ticker symbols from message text:
 * - $SYMBOL for crypto (e.g., $BTC, $ETH, $WLD)
 * - #SYMBOL for stocks (e.g., #AAPL, #TSLA, #MSTR)
 */

export type TickerType = 'crypto' | 'stock';

// Regex to match ticker symbols:
// $ followed by 1-10 letters = crypto
// # followed by 1-10 letters = stock/commodity (e.g., #PALLADIUM)
const TICKER_REGEX = /([#$])([A-Za-z]{1,10})\b/g;

export interface TickerMatch {
  /** Symbol without prefix, normalized to uppercase (e.g., "WLD", "AAPL") */
  symbol: string;
  /** Full match including prefix (e.g., "$WLD", "#AAPL") */
  fullMatch: string;
  /** The prefix character ($ or #) */
  prefix: '$' | '#';
  /** Type of ticker based on prefix */
  type: TickerType;
  /** Position in text */
  index: number;
}

/**
 * Extract all ticker symbols from text
 * Returns unique tickers (deduped by symbol+type)
 */
export function extractTickers(text: string): TickerMatch[] {
  const matches: TickerMatch[] = [];
  let match;

  // Reset regex state
  TICKER_REGEX.lastIndex = 0;

  while ((match = TICKER_REGEX.exec(text)) !== null) {
    const prefix = match[1] as '$' | '#';
    const symbol = match[2].toUpperCase();

    matches.push({
      symbol,
      fullMatch: match[0],
      prefix,
      type: prefix === '$' ? 'crypto' : 'stock',
      index: match.index,
    });
  }

  // Deduplicate by symbol+type (keep first occurrence)
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.type}:${m.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Check if text contains any ticker symbols
 */
export function hasTickers(text: string): boolean {
  TICKER_REGEX.lastIndex = 0;
  return TICKER_REGEX.test(text);
}

/**
 * Get the first ticker symbol from text, if any
 */
export function getFirstTicker(text: string): TickerMatch | null {
  const tickers = extractTickers(text);
  return tickers.length > 0 ? tickers[0] : null;
}

/**
 * Format a ticker for display (with appropriate prefix)
 */
export function formatTicker(symbol: string, type: TickerType): string {
  return type === 'crypto' ? `$${symbol}` : `#${symbol}`;
}
