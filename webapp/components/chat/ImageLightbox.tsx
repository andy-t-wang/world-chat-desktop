'use client';

import { useEffect, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/**
 * Full-screen image lightbox
 * Works in both web and Electron
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      // Fetch the image as blob to handle CORS and Electron
      const response = await fetch(src);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = alt || 'image.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      // Fallback: open in new tab
      window.open(src, '_blank');
    }
  }, [src, alt]);

  const content = (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop - click to close */}
      <div
        className="absolute inset-0 bg-black/90"
        onClick={onClose}
      />

      {/* Controls - separate from backdrop, with no-drag for Electron */}
      <div className="absolute top-4 right-4 flex gap-2 z-[10001]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Download button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleDownload(); }}
          className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors cursor-pointer"
          aria-label="Download"
        >
          <Download className="w-6 h-6 text-white" />
        </button>

        {/* Close button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Image - centered */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <img
          src={src}
          alt={alt || 'Full size image'}
          className="max-w-[90vw] max-h-[90vh] object-contain pointer-events-auto"
        />
      </div>
    </div>
  );

  // Use portal to render at document root
  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return null;
}
