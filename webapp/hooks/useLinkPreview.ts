import { useState, useEffect, useCallback } from 'react';
import type { LinkMetadata } from '@/components/chat/LinkPreview';
import { getDomainFromUrl, isWorldAppUrl, parseWorldAppUrl } from '@/components/chat/LinkPreview';

// In-memory cache for link previews (persists across component mounts)
const linkPreviewCache = new Map<string, LinkMetadata>();
const pendingRequests = new Map<string, Promise<LinkMetadata>>();

interface UseLinkPreviewResult {
  metadata: LinkMetadata | null;
  isLoading: boolean;
  error: string | null;
}

export function useLinkPreview(url: string | null): UseLinkPreviewResult {
  const [metadata, setMetadata] = useState<LinkMetadata | null>(() => {
    if (!url) return null;
    return linkPreviewCache.get(url) ?? null;
  });
  const [isLoading, setIsLoading] = useState(!metadata && !!url);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setMetadata(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Handle World App URLs locally (no network request needed)
    if (isWorldAppUrl(url)) {
      const worldAppMetadata = parseWorldAppUrl(url);
      if (worldAppMetadata) {
        linkPreviewCache.set(url, worldAppMetadata);
        setMetadata(worldAppMetadata);
        setIsLoading(false);
        return;
      }
    }

    // Check cache first
    const cached = linkPreviewCache.get(url);
    if (cached) {
      setMetadata(cached);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Check if there's already a pending request for this URL
    let fetchPromise = pendingRequests.get(url);

    if (!fetchPromise) {
      // Create new fetch request
      fetchPromise = fetchLinkMetadata(url);
      pendingRequests.set(url, fetchPromise);
    }

    fetchPromise
      .then((data) => {
        linkPreviewCache.set(url, data);
        setMetadata(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
        // Create minimal metadata on error
        const fallback: LinkMetadata = {
          url,
          domain: getDomainFromUrl(url),
        };
        setMetadata(fallback);
      })
      .finally(() => {
        pendingRequests.delete(url);
      });
  }, [url]);

  return { metadata, isLoading, error };
}

async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  const response = await fetch(
    `/api/link-preview?url=${encodeURIComponent(url)}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch link preview: ${response.status}`);
  }

  return response.json();
}

// Hook to handle multiple URLs in a message
export function useLinkPreviews(urls: string[]): Map<string, UseLinkPreviewResult> {
  const [results, setResults] = useState<Map<string, UseLinkPreviewResult>>(
    () => new Map()
  );

  useEffect(() => {
    if (urls.length === 0) {
      setResults(new Map());
      return;
    }

    // Initialize results with cached data or loading state
    const initialResults = new Map<string, UseLinkPreviewResult>();
    const urlsToFetch: string[] = [];

    for (const url of urls) {
      // Handle World App URLs locally
      if (isWorldAppUrl(url)) {
        const worldAppMetadata = parseWorldAppUrl(url);
        if (worldAppMetadata) {
          linkPreviewCache.set(url, worldAppMetadata);
          initialResults.set(url, { metadata: worldAppMetadata, isLoading: false, error: null });
          continue;
        }
      }

      const cached = linkPreviewCache.get(url);
      if (cached) {
        initialResults.set(url, { metadata: cached, isLoading: false, error: null });
      } else {
        initialResults.set(url, {
          metadata: { url, domain: getDomainFromUrl(url) },
          isLoading: true,
          error: null,
        });
        urlsToFetch.push(url);
      }
    }

    setResults(initialResults);

    // Fetch uncached URLs
    for (const url of urlsToFetch) {
      let fetchPromise = pendingRequests.get(url);

      if (!fetchPromise) {
        fetchPromise = fetchLinkMetadata(url);
        pendingRequests.set(url, fetchPromise);
      }

      fetchPromise
        .then((data) => {
          linkPreviewCache.set(url, data);
          setResults((prev) => {
            const next = new Map(prev);
            next.set(url, { metadata: data, isLoading: false, error: null });
            return next;
          });
        })
        .catch((err) => {
          const fallback: LinkMetadata = {
            url,
            domain: getDomainFromUrl(url),
          };
          setResults((prev) => {
            const next = new Map(prev);
            next.set(url, { metadata: fallback, isLoading: false, error: err.message });
            return next;
          });
        })
        .finally(() => {
          pendingRequests.delete(url);
        });
    }
  }, [urls.join(',')]);

  return results;
}

// Utility to clear the cache (useful for testing or memory management)
export function clearLinkPreviewCache(): void {
  linkPreviewCache.clear();
}
