/**
 * World App Username Service
 * Fetches and caches username records from the World App Username API
 *
 * Uses a two-layer cache:
 * 1. In-memory LRU cache for fast access
 * 2. localStorage for persistence across page reloads
 */

import { USERNAME_API } from '@/config/constants';
import { LRUCache } from '@/lib/utils/lru';
import type { Address, UsernameRecord, QueryMultiplePayload } from '@/types/username';

interface CacheEntry {
  record: UsernameRecord | null;
  timestamp: number;
}

const STORAGE_KEY = 'worldchat_usernames';
const STORAGE_VERSION = 1;

interface StorageData {
  version: number;
  entries: Record<string, CacheEntry>;
}

/** Singleton cache for username records */
const usernameCache = new LRUCache<string, CacheEntry>(USERNAME_API.MAX_CACHE_SIZE);

/** Pending requests to deduplicate concurrent fetches */
const pendingRequests = new Map<string, Promise<UsernameRecord | null>>();

/** Flag to track if we've loaded from localStorage */
let storageLoaded = false;

/**
 * Load cached usernames from localStorage on first access
 */
function loadFromStorage(): void {
  if (storageLoaded || typeof window === 'undefined') return;
  storageLoaded = true;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const data: StorageData = JSON.parse(stored);
    if (data.version !== STORAGE_VERSION) {
      // Clear outdated cache format
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const now = Date.now();

    for (const [address, entry] of Object.entries(data.entries)) {
      // Only load entries that haven't expired
      // Use shorter TTL for null results
      const ttl = entry.record ? USERNAME_API.CACHE_TTL_MS : USERNAME_API.NULL_CACHE_TTL_MS;
      if (now - entry.timestamp < ttl) {
        usernameCache.set(address, entry);
      }
    }
  } catch (error) {
    console.error('[Username] Failed to load from storage:', error);
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Save current cache to localStorage (debounced)
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function saveToStorage(): void {
  if (typeof window === 'undefined') return;

  // Debounce saves to avoid excessive writes
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const entries: Record<string, CacheEntry> = {};
      const now = Date.now();

      // Only save valid entries (shorter TTL for null results)
      usernameCache.forEach((entry, address) => {
        const ttl = entry.record ? USERNAME_API.CACHE_TTL_MS : USERNAME_API.NULL_CACHE_TTL_MS;
        if (now - entry.timestamp < ttl) {
          entries[address] = entry;
        }
      });

      const data: StorageData = {
        version: STORAGE_VERSION,
        entries,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('[Username] Failed to save to storage:', error);
    }
  }, 1000); // Save after 1 second of no activity
}

/**
 * Normalize address to lowercase for cache key consistency
 */
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Check if a cache entry is still valid
 * Uses shorter TTL for null results so new usernames are found faster
 */
function isCacheValid(entry: CacheEntry): boolean {
  const ttl = entry.record ? USERNAME_API.CACHE_TTL_MS : USERNAME_API.NULL_CACHE_TTL_MS;
  return Date.now() - entry.timestamp < ttl;
}

/**
 * Resolve a single address to a username record
 */
export async function resolveAddress(address: string): Promise<UsernameRecord | null> {
  // Ensure localStorage cache is loaded
  loadFromStorage();

  const normalizedAddress = normalizeAddress(address);

  // Check cache first
  const cached = usernameCache.get(normalizedAddress);
  if (cached && isCacheValid(cached)) {
    return cached.record;
  }

  // Deduplicate concurrent requests for the same address
  const pending = pendingRequests.get(normalizedAddress);
  if (pending) {
    return pending;
  }

  const fetchPromise = (async () => {
    try {
      const response = await fetch(`${USERNAME_API.BASE_URL}/api/v1/${address}`);

      if (response.status === 404) {
        // Cache null result for addresses without usernames
        usernameCache.set(normalizedAddress, { record: null, timestamp: Date.now() });
        saveToStorage();
        return null;
      }

      if (response.status === 301) {
        // Handle redirect for renamed usernames
        const newUrl = response.headers.get('Location');
        if (newUrl) {
          const redirectResponse = await fetch(newUrl);
          if (redirectResponse.ok) {
            const record = await redirectResponse.json() as UsernameRecord;
            usernameCache.set(normalizedAddress, { record, timestamp: Date.now() });
            saveToStorage();
            return record;
          }
        }
        return null;
      }

      if (!response.ok) {
        throw new Error(`Username API error: ${response.status}`);
      }

      const record = await response.json() as UsernameRecord;
      usernameCache.set(normalizedAddress, { record, timestamp: Date.now() });
      saveToStorage();
      return record;
    } catch (error) {
      console.error(`Failed to resolve address ${address}:`, error);
      return null;
    } finally {
      pendingRequests.delete(normalizedAddress);
    }
  })();

  pendingRequests.set(normalizedAddress, fetchPromise);
  return fetchPromise;
}

/**
 * Resolve multiple addresses in a single batch request
 * More efficient for conversation lists
 */
export async function resolveAddresses(addresses: string[]): Promise<Map<string, UsernameRecord | null>> {
  // Ensure localStorage cache is loaded
  loadFromStorage();

  const results = new Map<string, UsernameRecord | null>();
  const uncachedAddresses: Address[] = [];

  // Check cache for each address
  for (const address of addresses) {
    const normalizedAddress = normalizeAddress(address);
    const cached = usernameCache.get(normalizedAddress);

    if (cached && isCacheValid(cached)) {
      results.set(normalizedAddress, cached.record);
    } else {
      uncachedAddresses.push(address as Address);
    }
  }

  // If all addresses were cached, return immediately
  if (uncachedAddresses.length === 0) {
    return results;
  }

  // Batch fetch uncached addresses
  try {
    const payload: QueryMultiplePayload = {
      addresses: uncachedAddresses.slice(0, USERNAME_API.MAX_BATCH_SIZE),
    };

    const response = await fetch(`${USERNAME_API.BASE_URL}/api/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Username batch query failed: ${response.status}`);
    }

    const records = await response.json() as UsernameRecord[];

    // Create a map of address -> record for quick lookup
    const recordMap = new Map<string, UsernameRecord>();
    for (const record of records) {
      recordMap.set(normalizeAddress(record.address), record);
    }

    // Update cache and results for all queried addresses
    // Only cache addresses that were explicitly returned by the API
    // Don't cache null for missing addresses - they might have usernames
    // that the batch API didn't return (rate limiting, timing, etc.)
    for (const address of uncachedAddresses) {
      const normalizedAddress = normalizeAddress(address);
      const record = recordMap.get(normalizedAddress);

      if (record) {
        // Only cache successful lookups from batch
        usernameCache.set(normalizedAddress, { record, timestamp: Date.now() });
        results.set(normalizedAddress, record);
      } else {
        // Don't cache null - let individual fetch verify if user has no username
        results.set(normalizedAddress, null);
      }
    }

    // Persist to localStorage
    saveToStorage();
  } catch (error) {
    console.error('Failed to batch resolve addresses:', error);

    // Don't cache errors - let them be retried
    for (const address of uncachedAddresses) {
      results.set(normalizeAddress(address), null);
    }
  }

  return results;
}

/**
 * Resolve a username directly to get the full record
 * This is useful when you know the exact username
 */
export async function resolveUsername(username: string): Promise<UsernameRecord | null> {
  if (!username || username.length < 1 || username.length > 14) {
    return null;
  }

  try {
    const response = await fetch(
      `${USERNAME_API.BASE_URL}/api/v1/${encodeURIComponent(username)}`
    );

    if (!response.ok) {
      return null;
    }

    const record = await response.json() as UsernameRecord;

    // Cache the result
    usernameCache.set(normalizeAddress(record.address), {
      record,
      timestamp: Date.now(),
    });
    saveToStorage();

    return record;
  } catch {
    return null;
  }
}

/**
 * Search for usernames by prefix
 * Uses both the search endpoint AND tries to resolve the exact username
 * to ensure we don't miss any matches
 */
export async function searchUsernames(query: string): Promise<UsernameRecord[]> {
  if (!query || query.length < 1 || query.length > 14) {
    return [];
  }

  try {
    // Run both searches in parallel:
    // 1. Prefix search (returns up to 10 results)
    // 2. Exact username resolution (in case search misses it)
    const [searchResults, exactResult] = await Promise.all([
      // Prefix search
      fetch(`${USERNAME_API.BASE_URL}/api/v1/search/${encodeURIComponent(query)}`)
        .then(async (response) => {
          if (!response.ok) return [];
          return (await response.json()) as UsernameRecord[];
        })
        .catch(() => [] as UsernameRecord[]),

      // Exact username resolution
      resolveUsername(query),
    ]);

    // Deduplicate by address (lowercase)
    const seen = new Set<string>();
    const results: UsernameRecord[] = [];

    // Add exact match first if found (prioritize exact matches)
    if (exactResult) {
      const addr = normalizeAddress(exactResult.address);
      if (!seen.has(addr)) {
        seen.add(addr);
        results.push(exactResult);
      }
    }

    // Add search results
    for (const record of searchResults) {
      const addr = normalizeAddress(record.address);
      if (!seen.has(addr)) {
        seen.add(addr);
        results.push(record);
      }
    }

    // Cache each result
    for (const record of results) {
      usernameCache.set(normalizeAddress(record.address), {
        record,
        timestamp: Date.now(),
      });
    }
    saveToStorage();

    return results;
  } catch (error) {
    console.error('Failed to search usernames:', error);
    return [];
  }
}

/**
 * Get the avatar URL for a username, with optional fallback
 */
export function getAvatarUrl(username: string, options?: { minimized?: boolean; fallback?: string }): string {
  const params = new URLSearchParams();
  if (options?.minimized) params.set('minimized', 'true');
  if (options?.fallback) params.set('fallback', options.fallback);

  const queryString = params.toString();
  return `${USERNAME_API.BASE_URL}/api/v1/avatar/${encodeURIComponent(username)}${queryString ? `?${queryString}` : ''}`;
}

/**
 * Clear the username cache (useful for testing or logout)
 */
export function clearUsernameCache(): void {
  usernameCache.clear();
  pendingRequests.clear();
  storageLoaded = false;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Get a cached username record without fetching
 */
export function getCachedUsername(address: string): UsernameRecord | null | undefined {
  // Ensure localStorage cache is loaded
  loadFromStorage();

  const cached = usernameCache.get(normalizeAddress(address));
  if (cached && isCacheValid(cached)) {
    return cached.record;
  }
  return undefined;
}
