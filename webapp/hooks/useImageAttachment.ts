'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { xmtpClientAtom } from '@/stores/client';
import { loadImage, retryImage, getCachedImage, isUntrustedError } from '@/lib/images/service';
import type { RemoteAttachmentContent, ImageLoadResult, ImageStatus } from '@/types/attachments';

interface UseImageAttachmentReturn {
  /** Current status of the image */
  status: ImageStatus;
  /** Blob URL for displaying the image (null if not downloaded) */
  blobUrl: string | null;
  /** Error message if download failed */
  error: string | null;
  /** Whether a download is in progress */
  isLoading: boolean;
  /** Whether retry is allowed (false for untrusted CDN errors) */
  canRetry: boolean;
  /** Retry the download */
  retry: () => Promise<void>;
  /** MIME type of the attachment */
  mimeType: string | null;
}

/**
 * Hook to load and manage an image attachment
 * Handles caching, loading states, and retry logic
 */
export function useImageAttachment(
  remoteAttachment: RemoteAttachmentContent | null
): UseImageAttachmentReturn {
  const client = useAtomValue(xmtpClientAtom);
  const [result, setResult] = useState<ImageLoadResult>({
    status: 'downloading',
    blobUrl: null,
  });
  const [isLoading, setIsLoading] = useState(false);

  // Check cache first on mount
  useEffect(() => {
    if (!remoteAttachment) {
      setResult({ status: 'failed', blobUrl: null, error: 'No attachment' });
      return;
    }

    const cached = getCachedImage(remoteAttachment.contentDigest);
    if (cached) {
      if (cached.status === 'downloaded' && cached.fileLocation) {
        setResult({
          status: 'downloaded',
          blobUrl: cached.fileLocation,
          filename: cached.filename,
          mimeType: cached.mimeType,
        });
      } else if (cached.status === 'failed') {
        setResult({
          status: 'failed',
          blobUrl: null,
          error: 'Cached failure',
        });
      }
    }
  }, [remoteAttachment?.contentDigest]);

  // Load image when attachment changes
  useEffect(() => {
    if (!remoteAttachment || !client) return;

    // Check if already loaded from cache
    const cached = getCachedImage(remoteAttachment.contentDigest);
    if (cached?.status === 'downloaded' && cached.fileLocation) {
      return; // Already have it
    }

    let mounted = true;
    setIsLoading(true);

    loadImage(remoteAttachment, client)
      .then((loadResult) => {
        if (mounted) {
          setResult(loadResult);
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [remoteAttachment?.contentDigest, client]);

  // Retry handler
  const retry = useCallback(async () => {
    if (!remoteAttachment || !client) return;

    setIsLoading(true);
    setResult({ status: 'downloading', blobUrl: null });

    try {
      const retryResult = await retryImage(
        remoteAttachment.contentDigest,
        remoteAttachment,
        client
      );
      setResult(retryResult);
    } finally {
      setIsLoading(false);
    }
  }, [remoteAttachment, client]);

  const canRetry = result.status === 'failed' && !isUntrustedError(result.error ?? undefined);

  return {
    status: result.status,
    blobUrl: result.blobUrl,
    error: result.error ?? null,
    isLoading,
    canRetry,
    retry,
    mimeType: result.mimeType ?? null,
  };
}
