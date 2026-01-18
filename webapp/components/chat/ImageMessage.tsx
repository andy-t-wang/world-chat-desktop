'use client';

import { useState, useCallback } from 'react';
import { Loader2, ImageIcon, RotateCcw, AlertTriangle } from 'lucide-react';
import { useImageAttachment } from '@/hooks/useImageAttachment';
import { ImageLightbox } from './ImageLightbox';
import type { RemoteAttachmentContent } from '@/types/attachments';

interface ImageMessageProps {
  remoteAttachment: RemoteAttachmentContent;
  isOwnMessage: boolean;
  /** Compact mode for grid display - square aspect ratio, no border radius */
  compact?: boolean;
  /** Full size mode for lightbox - no size constraints */
  fullSize?: boolean;
}

/**
 * Image message component
 * Displays an image attachment with loading, error, and retry states
 * Matches Figma design: rounded corners, subtle border, no bubble background
 */
export function ImageMessage({ remoteAttachment, isOwnMessage, compact, fullSize }: ImageMessageProps) {
  const { status, blobUrl, error, isLoading, canRetry, retry, mimeType } = useImageAttachment(remoteAttachment);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Detect if this is a video based on MIME type
  const isVideo = mimeType?.startsWith('video/');

  // Retry handler that also resets imageError state
  const handleRetry = useCallback(async () => {
    setImageError(false);
    await retry();
  }, [retry]);

  // Handle image element load error
  const handleImageError = useCallback(() => {
    console.error('[ImageMessage] Image element failed to render:', {
      filename: remoteAttachment.filename,
      contentDigest: remoteAttachment.contentDigest,
      url: remoteAttachment.url,
      mimeType,
    });
    setImageError(true);
  }, [remoteAttachment, mimeType]);

  // Determine if image is vertical or horizontal for sizing
  const isVertical = imageDimensions ? imageDimensions.height > imageDimensions.width : true;

  // Container dimensions based on mode
  const getContainerStyle = () => {
    if (compact) {
      return { width: '100%', height: '100%' };
    }
    if (fullSize) {
      return {};
    }
    // Default sizing based on orientation (from Figma)
    return isVertical
      ? { width: 180, height: 232 }
      : { width: 250, height: 193 };
  };

  const containerStyle = getContainerStyle();

  // Loading state
  if (status === 'downloading' || isLoading) {
    return (
      <div
        className={`bg-[#F3F4F5] flex items-center justify-center ${
          compact ? 'w-full h-full' : 'border border-[rgba(0,0,0,0.1)] rounded-[16px]'
        }`}
        style={containerStyle}
      >
        <div className="flex flex-col items-center gap-2">
          <Loader2 className={`animate-spin text-[#9BA3AE] ${compact ? 'w-5 h-5' : 'w-6 h-6'}`} />
          {!compact && (
            <span className="text-[13px] text-[#717680]">
              Loading...
            </span>
          )}
        </div>
      </div>
    );
  }

  // Failed state
  if (status === 'failed' || imageError) {
    const isUntrusted = error === 'Untrusted CDN source';

    if (compact) {
      const showCompactRetry = canRetry || imageError;
      return (
        <div className="w-full h-full bg-[#F3F4F5] flex flex-col items-center justify-center gap-1">
          {isUntrusted ? (
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          ) : (
            <ImageIcon className="w-5 h-5 text-[#9BA3AE]" />
          )}
          {showCompactRetry && (
            <button
              onClick={handleRetry}
              className="p-1 rounded hover:bg-black/5"
              title="Retry"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#005CFF]" />
            </button>
          )}
        </div>
      );
    }

    // Show retry for download failures (canRetry) or render failures (imageError)
    const showRetry = canRetry || imageError;

    return (
      <div className="flex items-center gap-1.5">
        <div
          className="bg-[#F3F4F5] border border-[rgba(0,0,0,0.1)] rounded-[16px] flex items-center justify-center"
          style={containerStyle}
        >
          <div className="flex flex-col items-center gap-2">
            {isUntrusted ? (
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            ) : (
              <ImageIcon className="w-6 h-6 text-[#9BA3AE]" />
            )}
            {showRetry && (
              <button
                onClick={handleRetry}
                className="flex items-center gap-1 text-[13px] text-[#005CFF] hover:underline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </button>
            )}
          </div>
        </div>
        {/* Error indicator icon */}
        <div className="w-6 h-6 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8.33" fill="#F2280D"/>
            <path d="M10 6v4.5M10 13.5v.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    );
  }

  // Success state - show image or video
  if (blobUrl) {
    // Render video element for video MIME types
    if (isVideo) {
      if (compact) {
        return (
          <video
            src={blobUrl}
            className="w-full h-full object-cover"
            controls
            playsInline
            onError={handleImageError}
          />
        );
      }

      if (fullSize) {
        return (
          <video
            src={blobUrl}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            controls
            playsInline
            onError={handleImageError}
          />
        );
      }

      // Default video mode
      return (
        <div className="overflow-hidden rounded-[16px] border border-[rgba(0,0,0,0.1)]">
          <video
            src={blobUrl}
            className="block max-w-[250px] max-h-[300px] object-cover"
            controls
            playsInline
            onError={handleImageError}
          />
        </div>
      );
    }

    // Compact mode for grid (images)
    if (compact) {
      return (
        <img
          src={blobUrl}
          alt={remoteAttachment.filename || 'Image'}
          className="w-full h-full object-cover"
          onError={handleImageError}
        />
      );
    }

    // Full size mode for lightbox (images)
    if (fullSize) {
      return (
        <img
          src={blobUrl}
          alt={remoteAttachment.filename || 'Image'}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
          onError={handleImageError}
        />
      );
    }

    // Default image mode
    return (
      <>
        <div className="overflow-hidden rounded-[16px] border border-[rgba(0,0,0,0.1)]">
          <img
            src={blobUrl}
            alt={remoteAttachment.filename || 'Image'}
            className="block max-w-[250px] max-h-[300px] object-cover cursor-pointer"
            onLoad={(e) => {
              const img = e.target as HTMLImageElement;
              setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
            }}
            onError={handleImageError}
            onClick={() => setLightboxOpen(true)}
          />
        </div>
        {lightboxOpen && (
          <ImageLightbox
            src={blobUrl}
            alt={remoteAttachment.filename || 'Image'}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </>
    );
  }

  return null;
}
