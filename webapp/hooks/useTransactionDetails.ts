'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TransactionDetails, TransactionReference } from '@/lib/xmtp/TransactionReferenceCodec';

// In-memory cache for transaction details
const transactionCache = new Map<string, TransactionDetails>();
const pendingRequests = new Map<string, Promise<TransactionDetails | null>>();

// 5 seconds in nanoseconds
const CONFIRM_AFTER_NS = BigInt(5 * 1000) * 1_000_000n;

/**
 * Hook to fetch and cache transaction details
 * @param txRef - Transaction reference from the message
 * @param sentAtNs - Message sent timestamp in nanoseconds (optional)
 *                   If provided and message is > 5 seconds old, assumes confirmed
 */
export function useTransactionDetails(txRef: TransactionReference | null, sentAtNs?: bigint) {
  const [details, setDetails] = useState<TransactionDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetails = useCallback(async (ref: TransactionReference): Promise<TransactionDetails | null> => {
    const cacheKey = `${ref.chainId}:${ref.txHash}`;

    // Check cache first
    const cached = transactionCache.get(cacheKey);
    if (cached) {
      // If confirmed, use cached data
      if (cached.status === 'confirmed') {
        return cached;
      }
      // If pending, check again but return cached for now
      // (we'll refetch below)
    }

    // Check if there's already a pending request
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    // Create new request
    const request = (async () => {
      try {
        const response = await fetch(
          `/api/transaction?txHash=${ref.txHash}&chainId=${ref.chainId}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch transaction: ${response.status}`);
        }

        const data: TransactionDetails = await response.json();

        // Merge with API data - preserve original message metadata (token, amount, etc.)
        // Only take status-related fields from the API
        const merged: TransactionDetails = {
          ...ref,
          status: data.status,
          blockNumber: data.blockNumber,
          gasUsed: data.gasUsed,
          gasPrice: data.gasPrice,
          usdValue: data.usdValue,
          actualTxHash: data.actualTxHash,
        };

        // Cache the result
        transactionCache.set(cacheKey, merged);

        return merged;
      } catch (err) {
        console.error('Failed to fetch transaction details:', err);
        // Return a synthetic "pending" result on error with original data
        return {
          ...ref,
          status: 'pending' as const,
        };
      } finally {
        // Clean up pending request
        pendingRequests.delete(cacheKey);
      }
    })();

    pendingRequests.set(cacheKey, request);
    return request;
  }, []);

  useEffect(() => {
    if (!txRef) {
      setDetails(null);
      return;
    }

    // If message is older than 5 minutes, assume confirmed without fetching
    if (sentAtNs) {
      const nowNs = BigInt(Date.now()) * 1_000_000n;
      const ageNs = nowNs - sentAtNs;
      if (ageNs > CONFIRM_AFTER_NS) {
        setDetails({
          ...txRef,
          status: 'confirmed',
        });
        setIsLoading(false);
        return;
      }
    }

    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const fetchAndMaybeStartPolling = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchDetails(txRef);
        if (!cancelled && result) {
          setDetails(result);

          // If pending, start polling every 5 seconds
          if (result.status === 'pending' && !pollInterval) {
            pollInterval = setInterval(async () => {
              const cacheKey = `${txRef.chainId}:${txRef.txHash}`;
              transactionCache.delete(cacheKey);
              const updated = await fetchDetails(txRef);
              if (!cancelled && updated) {
                setDetails(updated);
                // Stop polling once confirmed or failed
                if (updated.status !== 'pending' && pollInterval) {
                  clearInterval(pollInterval);
                  pollInterval = null;
                }
              }
            }, 5000);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchAndMaybeStartPolling();

    return () => {
      cancelled = true;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [txRef, sentAtNs, fetchDetails]);

  // Refresh function for pending transactions
  const refresh = useCallback(() => {
    if (txRef) {
      const cacheKey = `${txRef.chainId}:${txRef.txHash}`;
      transactionCache.delete(cacheKey);
      fetchDetails(txRef).then(setDetails);
    }
  }, [txRef, fetchDetails]);

  return { details, isLoading, error, refresh };
}

/**
 * Prefetch transaction details (for list optimization)
 */
export function prefetchTransactionDetails(txRef: TransactionReference): void {
  const cacheKey = `${txRef.chainId}:${txRef.txHash}`;
  if (!transactionCache.has(cacheKey) && !pendingRequests.has(cacheKey)) {
    fetch(`/api/transaction?txHash=${txRef.txHash}&chainId=${txRef.chainId}`)
      .then((res) => res.json())
      .then((data) => {
        transactionCache.set(cacheKey, { ...txRef, ...data });
      })
      .catch(() => {
        // Ignore prefetch errors
      });
  }
}
