'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TickerPriceData } from '@/app/api/ticker-price/route';
import type { TickerType } from '@/lib/ticker/utils';

/**
 * In-memory cache for ticker price data
 * Survives component remounts, shared across all instances
 */
interface CacheEntry {
  data: TickerPriceData;
  timestamp: number;
  isStale?: boolean;
}

const tickerCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<TickerPriceData>>();

// Simple event system for cache updates
const cacheListeners = new Map<string, Set<() => void>>();

function subscribeToCacheUpdates(cacheKey: string, callback: () => void): () => void {
  if (!cacheListeners.has(cacheKey)) {
    cacheListeners.set(cacheKey, new Set());
  }
  cacheListeners.get(cacheKey)!.add(callback);
  return () => {
    cacheListeners.get(cacheKey)?.delete(callback);
  };
}

function notifyCacheUpdate(cacheKey: string): void {
  cacheListeners.get(cacheKey)?.forEach((cb) => cb());
}

// Client-side cache TTL (use cached data for 2 minutes before refetching)
const CACHE_TTL_MS = 2 * 60 * 1000;

// Retry configuration
const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 5000; // 5 seconds default
const MAX_RETRY_DELAY = 30000; // Cap at 30 seconds (don't wait full 60s)

export interface UseTickerPriceResult {
  data: TickerPriceData | null;
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
  /** Status message during loading (e.g., "Retrying...") */
  status: string | null;
  retry: () => void;
}

/**
 * Fetch ticker price with retry logic
 */
async function fetchTickerPrice(
  symbol: string,
  type: TickerType,
  attempt = 0,
  onStatus?: (status: string | null) => void
): Promise<TickerPriceData> {
  const response = await fetch(
    `/api/ticker-price?symbol=${encodeURIComponent(symbol)}&type=${type}`
  );

  if (response.status === 429) {
    // Rate limited - check if we should retry
    if (attempt < MAX_RETRIES) {
      const retryAfter = response.headers.get('Retry-After');
      // Use server's retry-after but cap it at MAX_RETRY_DELAY
      const serverDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : DEFAULT_RETRY_DELAY;
      const delay = Math.min(serverDelay, MAX_RETRY_DELAY);

      // Update status so user knows we're retrying
      const waitSeconds = Math.ceil(delay / 1000);
      onStatus?.(`Rate limited, retrying in ${waitSeconds}s...`);

      await new Promise((resolve) => setTimeout(resolve, delay));
      onStatus?.(null);
      return fetchTickerPrice(symbol, type, attempt + 1, onStatus);
    }
    throw new Error('Rate limited - please try again later');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch price: ${response.status}`);
  }

  return response.json();
}

/**
 * Hook to fetch and cache ticker price data
 * @param symbol Ticker symbol without prefix (e.g., "WLD", "BTC", "AAPL")
 * @param type Ticker type - 'crypto' for $ prefix, 'stock' for # prefix
 */
export function useTickerPrice(
  symbol: string | null,
  type: TickerType = 'crypto'
): UseTickerPriceResult {
  const cacheKey = symbol ? `${type}:${symbol}` : '';

  // Initialize from cache if available
  const [data, setData] = useState<TickerPriceData | null>(() => {
    if (!cacheKey) return null;
    const cached = tickerCache.get(cacheKey);
    return cached?.data ?? null;
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (!cacheKey) return false;
    const cached = tickerCache.get(cacheKey);
    // Loading if no cache or cache is expired
    return !cached || Date.now() - cached.timestamp > CACHE_TTL_MS;
  });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(() => {
    if (!cacheKey) return false;
    const cached = tickerCache.get(cacheKey);
    return cached?.isStale ?? false;
  });

  const fetchData = useCallback(async (sym: string, tickerType: TickerType, force = false) => {
    const key = `${tickerType}:${sym}`;

    // Check cache (unless forcing refresh)
    if (!force) {
      const cached = tickerCache.get(key);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setData(cached.data);
        setIsStale(cached.isStale ?? false);
        setIsLoading(false);
        setError(null);
        setStatus(null);
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    setStatus(null);

    // Deduplicate concurrent requests
    let fetchPromise = pendingRequests.get(key);
    if (!fetchPromise) {
      fetchPromise = fetchTickerPrice(sym, tickerType, 0, setStatus);
      pendingRequests.set(key, fetchPromise);
    }

    try {
      const priceData = await fetchPromise;
      const stale = 'stale' in priceData && (priceData as { stale?: boolean }).stale === true;

      // Update cache
      tickerCache.set(key, {
        data: priceData,
        timestamp: Date.now(),
        isStale: stale,
      });

      setData(priceData);
      setIsStale(stale);
      setError(null);
      setStatus(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch price';
      setError(errorMessage);
      setStatus(null);

      // Keep showing stale data if available
      const cached = tickerCache.get(key);
      if (cached) {
        setData(cached.data);
        setIsStale(true);
      }
    } finally {
      setIsLoading(false);
      pendingRequests.delete(key);
    }
  }, []);

  // Fetch on mount or symbol/type change
  useEffect(() => {
    if (!symbol) {
      setData(null);
      setIsLoading(false);
      setError(null);
      setIsStale(false);
      setStatus(null);
      return;
    }

    fetchData(symbol, type);
  }, [symbol, type, fetchData]);

  // Subscribe to external cache updates (e.g., when modal refreshes)
  useEffect(() => {
    if (!cacheKey) return;

    const unsubscribe = subscribeToCacheUpdates(cacheKey, () => {
      const cached = tickerCache.get(cacheKey);
      if (cached) {
        setData(cached.data);
        setIsStale(cached.isStale ?? false);
        setError(null);
      }
    });

    return unsubscribe;
  }, [cacheKey]);

  // Retry function for manual refresh
  const retry = useCallback(() => {
    if (symbol) {
      fetchData(symbol, type, true);
    }
  }, [symbol, type, fetchData]);

  return { data, isLoading, error, isStale, status, retry };
}

/**
 * Clear the ticker price cache (useful for testing)
 */
export function clearTickerCache(): void {
  tickerCache.clear();
  pendingRequests.clear();
}

/**
 * Update the cache with new data (used when modal refreshes)
 * Also notifies any listening hooks to update
 */
export function updateTickerCache(
  symbol: string,
  type: TickerType,
  data: TickerPriceData
): void {
  const cacheKey = `${type}:${symbol}`;
  tickerCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    isStale: false,
  });
  notifyCacheUpdate(cacheKey);
}
