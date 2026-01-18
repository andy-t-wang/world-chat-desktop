/**
 * Ticker Symbol Configuration
 *
 * Crypto ($): Uses CoinGecko API - fetches coin list dynamically
 * Stocks (#): Uses Massive API - accepts any valid ticker symbol
 */

export type TickerType = 'crypto' | 'stock';

export interface TickerConfig {
  type: TickerType;
  /** CoinGecko ID for crypto, stock symbol for stocks */
  id: string;
  /** Display name (optional, fetched from API if not provided) */
  name?: string;
}

/**
 * Fallback mapping for common crypto symbols → CoinGecko IDs
 * Used when the dynamic coin list isn't loaded yet or as a fast path
 */
const COMMON_CRYPTO_IDS: Record<string, string> = {
  // World ecosystem
  WLD: 'worldcoin-wld',

  // Major cryptocurrencies
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  ATOM: 'cosmos',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',

  // Stablecoins
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',

  // DeFi
  UNI: 'uniswap',
  AAVE: 'aave',
  MKR: 'maker',

  // Exchange tokens
  BNB: 'binancecoin',

  // Other popular
  TON: 'the-open-network',
  TRX: 'tron',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  SUI: 'sui',
};

/**
 * CoinGecko coin list cache
 * Maps symbol (uppercase) → CoinGecko ID
 */
interface CoinGeckoCache {
  symbolToId: Map<string, string>;
  lastFetched: number;
}

let coinGeckoCache: CoinGeckoCache | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let fetchPromise: Promise<void> | null = null;

/**
 * Fetch CoinGecko coin list and cache it
 * This is called lazily on first crypto lookup
 */
async function fetchCoinGeckoList(): Promise<void> {
  // Avoid duplicate fetches
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/list',
        {
          headers: { Accept: 'application/json' },
          next: { revalidate: 86400 }, // Cache for 24 hours
        }
      );

      if (!response.ok) {
        console.warn('[tickers] Failed to fetch CoinGecko list:', response.status);
        return;
      }

      const coins = await response.json() as Array<{ id: string; symbol: string; name: string }>;

      // Build symbol → ID map (uppercase symbols)
      // Note: Some symbols map to multiple coins, we take the first (usually most popular)
      const symbolToId = new Map<string, string>();
      for (const coin of coins) {
        const symbol = coin.symbol.toUpperCase();
        if (!symbolToId.has(symbol)) {
          symbolToId.set(symbol, coin.id);
        }
      }

      coinGeckoCache = {
        symbolToId,
        lastFetched: Date.now(),
      };

      console.log(`[tickers] Loaded ${symbolToId.size} coins from CoinGecko`);
    } catch (error) {
      console.warn('[tickers] Error fetching CoinGecko list:', error);
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * Check if cache is valid
 */
function isCacheValid(): boolean {
  return coinGeckoCache !== null &&
    Date.now() - coinGeckoCache.lastFetched < CACHE_TTL_MS;
}

/**
 * Get CoinGecko ID for a crypto symbol
 * First checks fallback map, then dynamic cache
 */
export async function getCoinGeckoId(symbol: string): Promise<string | null> {
  const upperSymbol = symbol.toUpperCase();

  // Check fallback map first (instant)
  if (upperSymbol in COMMON_CRYPTO_IDS) {
    return COMMON_CRYPTO_IDS[upperSymbol];
  }

  // Check cache
  if (isCacheValid() && coinGeckoCache) {
    return coinGeckoCache.symbolToId.get(upperSymbol) ?? null;
  }

  // Fetch and retry
  await fetchCoinGeckoList();

  if (coinGeckoCache) {
    return coinGeckoCache.symbolToId.get(upperSymbol) ?? null;
  }

  return null;
}

/**
 * Get CoinGecko ID synchronously (fallback map only)
 * Used when we can't await
 */
export function getCoinGeckoIdSync(symbol: string): string | null {
  const upperSymbol = symbol.toUpperCase();

  // Check fallback map
  if (upperSymbol in COMMON_CRYPTO_IDS) {
    return COMMON_CRYPTO_IDS[upperSymbol];
  }

  // Check cache if available
  if (coinGeckoCache) {
    return coinGeckoCache.symbolToId.get(upperSymbol) ?? null;
  }

  return null;
}

/**
 * Get ticker configuration for crypto
 * Returns config with CoinGecko ID, or null if not found
 */
export async function getCryptoConfig(symbol: string): Promise<TickerConfig | null> {
  const coinGeckoId = await getCoinGeckoId(symbol);
  if (!coinGeckoId) return null;

  return {
    type: 'crypto',
    id: coinGeckoId,
  };
}

/**
 * Common commodity symbol mappings → Polygon/Massive API format
 * Users can type friendly names like #SILVER or use raw tickers like #C:XAGUSD
 */
const COMMODITY_MAPPINGS: Record<string, { id: string; name: string }> = {
  // Precious metals (ETFs)
  SILVER: { id: 'SLV', name: 'iShares Silver Trust' },
  SLV: { id: 'SLV', name: 'iShares Silver Trust' },
  GOLD: { id: 'GLD', name: 'SPDR Gold Trust' },
  GLD: { id: 'GLD', name: 'SPDR Gold Trust' },
  PLATINUM: { id: 'PPLT', name: 'Physical Platinum Shares' },
  PPLT: { id: 'PPLT', name: 'Physical Platinum Shares' },
  PALLADIUM: { id: 'PALL', name: 'Physical Palladium Shares' },
  PALL: { id: 'PALL', name: 'Physical Palladium Shares' },
  // Industrial metals (ETFs)
  COPPER: { id: 'COPX', name: 'Copper Miners ETF' },
  COPX: { id: 'COPX', name: 'Copper Miners ETF' },
  // Oil & Energy (ETFs)
  OIL: { id: 'USO', name: 'United States Oil Fund' },
  USO: { id: 'USO', name: 'United States Oil Fund' },
  CRUDE: { id: 'USO', name: 'United States Oil Fund' },
  NATGAS: { id: 'UNG', name: 'United States Natural Gas Fund' },
  UNG: { id: 'UNG', name: 'United States Natural Gas Fund' },
  GAS: { id: 'UNG', name: 'United States Natural Gas Fund' },
  // Agriculture (Teucrium ETFs)
  WHEAT: { id: 'WEAT', name: 'Teucrium Wheat Fund' },
  WEAT: { id: 'WEAT', name: 'Teucrium Wheat Fund' },
  CORN: { id: 'CORN', name: 'Teucrium Corn Fund' },
  SOYBEAN: { id: 'SOYB', name: 'Teucrium Soybean Fund' },
  SOYB: { id: 'SOYB', name: 'Teucrium Soybean Fund' },
  SOY: { id: 'SOYB', name: 'Teucrium Soybean Fund' },
};

/**
 * Get ticker configuration for stock
 * Always returns a config - Massive API will validate
 * Also supports commodities via friendly names or raw C: format
 */
export function getStockConfig(symbol: string): TickerConfig {
  const upperSymbol = symbol.toUpperCase();

  // Check commodity mappings first
  if (upperSymbol in COMMODITY_MAPPINGS) {
    return {
      type: 'stock',
      id: COMMODITY_MAPPINGS[upperSymbol].id,
      name: COMMODITY_MAPPINGS[upperSymbol].name,
    };
  }

  // Pass through raw tickers (including C:XAGUSD format)
  return {
    type: 'stock',
    id: upperSymbol,
  };
}

/**
 * Check if a crypto symbol is likely supported
 * Returns true for known symbols, unknown for others
 */
export function isCryptoSupported(symbol: string): boolean {
  const upperSymbol = symbol.toUpperCase();

  // Check fallback map
  if (upperSymbol in COMMON_CRYPTO_IDS) return true;

  // Check cache if available
  if (coinGeckoCache) {
    return coinGeckoCache.symbolToId.has(upperSymbol);
  }

  // Unknown - might be supported, let API decide
  return true;
}

/**
 * Prefetch CoinGecko list (call on app init for faster lookups)
 */
export function prefetchCoinGeckoList(): void {
  if (!isCacheValid()) {
    fetchCoinGeckoList().catch(() => {
      // Ignore errors, will retry on demand
    });
  }
}

// Legacy exports for compatibility
export function isSupportedTicker(): boolean {
  // All tickers are potentially supported now
  return true;
}

export function getTickerConfig(symbol: string): TickerConfig | null {
  // Legacy: assume crypto, check fallback map
  const coinGeckoId = getCoinGeckoIdSync(symbol);
  if (coinGeckoId) {
    return { type: 'crypto', id: coinGeckoId };
  }
  return null;
}
