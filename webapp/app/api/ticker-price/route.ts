import { NextRequest, NextResponse } from 'next/server';
import { getCoinGeckoId, getStockConfig, type TickerConfig } from '@/config/tickers';

/**
 * Ticker price data returned by this API
 */
export interface TickerPriceData {
  symbol: string;
  name: string;
  currentPrice: number;
  priceChange24h: number;
  priceChangePercentage24h: number;
  /** Array of prices for 7-day sparkline chart */
  sparkline7d: number[];
  lastUpdated: string;
  /** Token icon URL */
  image?: string;
  /** Whether this is a stock or crypto */
  type: 'crypto' | 'stock';
  /** Market capitalization in USD */
  marketCap?: number;
}

// Server-side cache to minimize API calls
interface CacheEntry {
  data: TickerPriceData;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache
const STALE_TTL_MS = 5 * 60 * 1000; // Serve stale data up to 5 minutes

// Track rate limit state per provider
let coinGeckoRateLimitedUntil = 0;
let massiveRateLimitedUntil = 0;
const RATE_LIMIT_BACKOFF_MS = 60 * 1000; // 1 minute backoff on rate limit

// Support multiple API keys for higher rate limits
const MASSIVE_API_KEYS = [
  process.env.MASSIVE_API_KEY,
  process.env.MASSIVE_API_KEY_2,
].filter(Boolean) as string[];

// Track which key to use (round-robin)
let currentKeyIndex = 0;

function getMassiveApiKey(): string | null {
  if (MASSIVE_API_KEYS.length === 0) return null;
  return MASSIVE_API_KEYS[currentKeyIndex % MASSIVE_API_KEYS.length];
}

function rotateApiKey(): void {
  if (MASSIVE_API_KEYS.length > 1) {
    currentKeyIndex = (currentKeyIndex + 1) % MASSIVE_API_KEYS.length;
  }
}

/**
 * Fetch crypto price data from CoinGecko
 */
async function fetchCryptoPrice(symbol: string, coinGeckoId: string): Promise<TickerPriceData> {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coinGeckoId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true`,
    {
      headers: {
        Accept: 'application/json',
      },
      next: { revalidate: 60 },
    }
  );

  if (response.status === 429) {
    coinGeckoRateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('COIN_NOT_FOUND');
    }
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    symbol,
    name: data.name,
    currentPrice: data.market_data?.current_price?.usd ?? 0,
    priceChange24h: data.market_data?.price_change_24h ?? 0,
    priceChangePercentage24h: data.market_data?.price_change_percentage_24h ?? 0,
    sparkline7d: data.market_data?.sparkline_7d?.price ?? [],
    lastUpdated: data.market_data?.last_updated ?? new Date().toISOString(),
    image: data.image?.small,
    type: 'crypto',
    marketCap: data.market_data?.market_cap?.usd,
  };
}

/**
 * Fetch stock price data from Massive API (formerly Polygon)
 * Uses single aggregates call for price, change, and sparkline
 */
async function fetchStockPrice(symbol: string, config: TickerConfig): Promise<TickerPriceData> {
  const apiKey = getMassiveApiKey();
  if (!apiKey) {
    throw new Error('Massive API key not configured');
  }

  const baseUrl = 'https://api.massive.com';
  let currentApiKey = apiKey;

  // Calculate date range for 7-day hourly data (more precise than daily)
  const today = new Date();
  const toDate = today.toISOString().split('T')[0];
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = sevenDaysAgo.toISOString().split('T')[0];

  // Single API call: fetch 7-day hourly aggregates for price, change, AND sparkline
  let aggsResponse = await fetch(
    `${baseUrl}/v2/aggs/ticker/${config.id}/range/1/hour/${fromDate}/${toDate}?adjusted=true&sort=asc&apiKey=${currentApiKey}`,
    {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }
  );

  // Handle rate limiting with key rotation
  if (aggsResponse.status === 429) {
    if (MASSIVE_API_KEYS.length > 1) {
      rotateApiKey();
      const newKey = getMassiveApiKey();
      if (newKey && newKey !== currentApiKey) {
        currentApiKey = newKey;
        aggsResponse = await fetch(
          `${baseUrl}/v2/aggs/ticker/${config.id}/range/1/hour/${fromDate}/${toDate}?adjusted=true&sort=asc&apiKey=${currentApiKey}`,
          {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          }
        );
      }
    }
    if (aggsResponse.status === 429) {
      massiveRateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      throw new Error('RATE_LIMITED');
    }
  }

  if (!aggsResponse.ok) {
    if (aggsResponse.status === 404) {
      throw new Error('STOCK_NOT_FOUND');
    }
    throw new Error(`Massive API error: ${aggsResponse.status}`);
  }

  const aggsData = await aggsResponse.json();

  // Accept both 'OK' and 'DELAYED' status
  const validStatus = aggsData.status === 'OK' || aggsData.status === 'DELAYED';
  if (!validStatus || !aggsData.results || aggsData.results.length === 0) {
    throw new Error('STOCK_NOT_FOUND');
  }

  // Extract data from aggregates
  const bars = aggsData.results as Array<{ c: number; o: number; h: number; l: number }>;
  const latestBar = bars[bars.length - 1];
  // For 24h change, compare with bar from ~24 hours ago (24 bars back with hourly data)
  const twentyFourHoursAgoIndex = Math.max(0, bars.length - 25);
  const previousBar = bars[twentyFourHoursAgoIndex];

  const currentPrice = latestBar.c;
  const previousClose = previousBar.c;
  const priceChange = currentPrice - previousClose;
  const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;

  // Sparkline from all closing prices (7 days of hourly data)
  const sparkline7d = bars.map((bar) => bar.c);

  // Fetch ticker details for name, branding, and market cap
  let name = config.name || symbol;
  let image: string | undefined;
  let marketCap: number | undefined;

  try {
    const tickerResponse = await fetch(
      `${baseUrl}/v3/reference/tickers/${config.id}?apiKey=${currentApiKey}`,
      {
        headers: { Accept: 'application/json' },
        next: { revalidate: 3600 }, // Cache ticker info for 1 hour
      }
    );

    if (tickerResponse.ok) {
      const tickerData = await tickerResponse.json();
      if (tickerData.status === 'OK' && tickerData.results) {
        name = tickerData.results.name || name;
        marketCap = tickerData.results.market_cap;
        // Add API key to branding URL
        if (tickerData.results.branding?.icon_url) {
          image = `${tickerData.results.branding.icon_url}?apiKey=${currentApiKey}`;
        }
      }
    }
  } catch {
    // Ignore errors fetching ticker details, use fallback name
  }

  return {
    symbol,
    name,
    currentPrice,
    priceChange24h: priceChange,
    priceChangePercentage24h: priceChangePercent,
    sparkline7d,
    lastUpdated: new Date().toISOString(),
    image,
    type: 'stock',
    marketCap,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.toUpperCase();
  const tickerType = searchParams.get('type') as 'crypto' | 'stock' | null;

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol parameter required' }, { status: 400 });
  }

  if (!tickerType || (tickerType !== 'crypto' && tickerType !== 'stock')) {
    return NextResponse.json(
      { error: 'Type parameter required (crypto or stock)' },
      { status: 400 }
    );
  }

  const now = Date.now();
  const cacheKey = `${tickerType}:${symbol}`;

  // Check fresh cache first
  const cached = cache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'X-Cache': 'HIT',
      },
    });
  }

  // Check if we're rate limited for this provider
  const rateLimitedUntil = tickerType === 'crypto' ? coinGeckoRateLimitedUntil : massiveRateLimitedUntil;
  if (now < rateLimitedUntil) {
    // Return stale cache if available
    if (cached && now - cached.timestamp < STALE_TTL_MS) {
      return NextResponse.json(
        { ...cached.data, stale: true },
        {
          headers: {
            'Cache-Control': 'public, max-age=30',
            'X-Cache': 'STALE',
          },
        }
      );
    }

    // No cache available, return 429
    const retryAfter = Math.ceil((rateLimitedUntil - now) / 1000);
    return NextResponse.json(
      { error: 'Rate limited, please try again later' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
        },
      }
    );
  }

  try {
    let priceData: TickerPriceData;

    if (tickerType === 'crypto') {
      // Look up CoinGecko ID dynamically
      const coinGeckoId = await getCoinGeckoId(symbol);
      if (!coinGeckoId) {
        return NextResponse.json(
          { error: `Crypto symbol ${symbol} not found` },
          { status: 404 }
        );
      }
      priceData = await fetchCryptoPrice(symbol, coinGeckoId);
    } else {
      // For stocks, pass symbol directly - Massive API validates
      const config = getStockConfig(symbol);
      priceData = await fetchStockPrice(symbol, config);
    }

    // Update cache
    cache.set(cacheKey, { data: priceData, timestamp: now });

    return NextResponse.json(priceData, {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error(`[ticker-price] Error fetching ${tickerType}:${symbol}:`, error);

    // Handle specific errors
    if (error instanceof Error) {
      if (error.message === 'COIN_NOT_FOUND') {
        return NextResponse.json(
          { error: `Crypto symbol ${symbol} not found` },
          { status: 404 }
        );
      }
      if (error.message === 'STOCK_NOT_FOUND') {
        return NextResponse.json(
          { error: `Stock symbol ${symbol} not found or no data available` },
          { status: 404 }
        );
      }
      if (error.message === 'RATE_LIMITED') {
        if (cached) {
          return NextResponse.json(
            { ...cached.data, stale: true },
            {
              headers: {
                'Cache-Control': 'public, max-age=30',
                'X-Cache': 'STALE',
              },
            }
          );
        }

        return NextResponse.json(
          { error: 'Rate limited, please try again later' },
          {
            status: 429,
            headers: {
              'Retry-After': '60',
            },
          }
        );
      }
    }

    // Return stale cache on error if available
    if (cached) {
      return NextResponse.json(
        { ...cached.data, stale: true },
        {
          headers: {
            'Cache-Control': 'public, max-age=30',
            'X-Cache': 'STALE',
          },
        }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch price data' },
      { status: 502 }
    );
  }
}
