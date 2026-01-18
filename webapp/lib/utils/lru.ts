/**
 * LRU (Least Recently Used) Cache Implementation
 * Memory-efficient cache with automatic eviction for message management
 */

export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;
  private onEvict?: (key: K, value: V) => void;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  /**
   * Get a value from the cache
   * Moves the item to the end (most recently used) if found
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Set a value in the cache
   * Evicts the oldest item if cache is at capacity
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const firstValue = this.cache.get(firstKey)!;
        this.cache.delete(firstKey);
        this.onEvict?.(firstKey, firstValue);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Check if a key exists in the cache
   * Does NOT update recency
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Check if a key exists and update its recency
   */
  touch(key: K): boolean {
    if (this.cache.has(key)) {
      const value = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, value);
      return true;
    }
    return false;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys in the cache (oldest to newest)
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get all values in the cache (oldest to newest)
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /**
   * Get all entries in the cache (oldest to newest)
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  /**
   * Iterate over all items in the cache
   */
  forEach(callback: (value: V, key: K, map: Map<K, V>) => void): void {
    this.cache.forEach(callback);
  }

  /**
   * Evict items until we're at the target size
   * Useful for batch eviction
   */
  evictTo(targetSize: number): number {
    let evicted = 0;
    while (this.cache.size > targetSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;

      const firstValue = this.cache.get(firstKey)!;
      this.cache.delete(firstKey);
      this.onEvict?.(firstKey, firstValue);
      evicted++;
    }
    return evicted;
  }

  /**
   * Get the oldest key in the cache
   */
  getOldestKey(): K | undefined {
    return this.cache.keys().next().value;
  }

  /**
   * Get the newest key in the cache
   */
  getNewestKey(): K | undefined {
    let lastKey: K | undefined;
    for (const key of this.cache.keys()) {
      lastKey = key;
    }
    return lastKey;
  }
}
