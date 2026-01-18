'use client';

import { useState } from 'react';
import { ImageMessage } from './ImageMessage';
import type { RemoteAttachmentContent } from '@/types/attachments';

interface ImageGridProps {
  attachments: RemoteAttachmentContent[];
  isOwnMessage: boolean;
}

/**
 * WhatsApp-style image grid for multiple attachments
 * Layout patterns:
 * - 1 image: full width
 * - 2 images: side by side
 * - 3 images: 1 large + 2 small stacked
 * - 4 images: 2x2 grid
 * - 5+ images: 2x2 grid with +N overlay on last
 */
export function ImageGrid({ attachments, isOwnMessage }: ImageGridProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const count = attachments.length;

  if (count === 0) return null;

  // Single image - use regular ImageMessage
  if (count === 1) {
    return (
      <ImageMessage
        remoteAttachment={attachments[0]}
        isOwnMessage={isOwnMessage}
      />
    );
  }

  // Calculate grid layout
  const getGridClass = () => {
    switch (count) {
      case 2:
        return 'grid-cols-2';
      case 3:
        return 'grid-cols-2';
      case 4:
        return 'grid-cols-2';
      default:
        return 'grid-cols-2';
    }
  };

  // For 3 images, first one spans both columns
  const getItemClass = (index: number) => {
    if (count === 3 && index === 0) {
      return 'col-span-2';
    }
    return '';
  };

  // Show max 4 images, with +N overlay on the 4th if more
  const visibleCount = Math.min(count, 4);
  const remainingCount = count - 4;

  return (
    <div className="overflow-hidden rounded-[16px] border border-[rgba(0,0,0,0.1)]">
      <div className={`grid ${getGridClass()} gap-0.5 bg-[rgba(0,0,0,0.1)]`}>
        {attachments.slice(0, visibleCount).map((attachment, index) => (
          <div
            key={attachment.contentDigest}
            className={`relative ${getItemClass(index)}`}
          >
            <GridImage
              attachment={attachment}
              isOwnMessage={isOwnMessage}
              showOverlay={index === 3 && remainingCount > 0}
              overlayCount={remainingCount}
              onClick={() => setExpandedIndex(index)}
            />
          </div>
        ))}
      </div>

      {/* Lightbox for expanded view */}
      {expandedIndex !== null && (
        <ImageLightbox
          attachments={attachments}
          initialIndex={expandedIndex}
          onClose={() => setExpandedIndex(null)}
        />
      )}
    </div>
  );
}

interface GridImageProps {
  attachment: RemoteAttachmentContent;
  isOwnMessage: boolean;
  showOverlay?: boolean;
  overlayCount?: number;
  onClick?: () => void;
}

function GridImage({ attachment, isOwnMessage, showOverlay, overlayCount, onClick }: GridImageProps) {
  return (
    <div className="relative cursor-pointer" onClick={onClick}>
      <div className="aspect-square overflow-hidden">
        <ImageMessage
          remoteAttachment={attachment}
          isOwnMessage={isOwnMessage}
          compact
        />
      </div>
      {showOverlay && overlayCount && overlayCount > 0 && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <span className="text-white text-2xl font-semibold">+{overlayCount}</span>
        </div>
      )}
    </div>
  );
}

interface ImageLightboxProps {
  attachments: RemoteAttachmentContent[];
  initialIndex: number;
  onClose: () => void;
}

function ImageLightbox({ attachments, initialIndex, onClose }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const goNext = () => {
    setCurrentIndex((prev) => (prev + 1) % attachments.length);
  };

  const goPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + attachments.length) % attachments.length);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
        onClick={onClose}
      >
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Navigation arrows */}
      {attachments.length > 1 && (
        <>
          <button
            className="absolute left-4 text-white/80 hover:text-white p-2"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            className="absolute right-4 text-white/80 hover:text-white p-2"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {/* Image */}
      <div
        className="max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <ImageMessage
          remoteAttachment={attachments[currentIndex]}
          isOwnMessage={false}
          fullSize
        />
      </div>

      {/* Counter */}
      {attachments.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm">
          {currentIndex + 1} / {attachments.length}
        </div>
      )}
    </div>
  );
}
