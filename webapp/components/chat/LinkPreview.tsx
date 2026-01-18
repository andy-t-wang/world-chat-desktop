'use client';

import { useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  domain: string;
  // Type-specific fields
  type?: 'twitter' | 'worldapp' | 'generic';
  author?: string;
  authorUsername?: string;
  // World App specific
  appId?: string;
}

interface LinkPreviewProps {
  metadata: LinkMetadata | null;
  isLoading: boolean;
  isOwnMessage: boolean;
}

// X/Twitter logo SVG
function XLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// World App logo
function WorldLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}

export function LinkPreview({ metadata, isLoading, isOwnMessage }: LinkPreviewProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Loading state
  if (isLoading || !metadata) {
    const domain = metadata?.domain ?? 'Loading...';
    return (
      <div className="bg-[var(--bg-tertiary)] rounded-2xl overflow-hidden w-[340px]">
        <div className="flex flex-col gap-2 items-center justify-center px-8 py-10">
          <Loader2 className="w-5 h-5 text-[var(--text-tertiary)] animate-spin" />
          <span className="text-[11px] text-[var(--text-tertiary)] truncate max-w-full">
            {domain}
          </span>
        </div>
      </div>
    );
  }

  const { url, title, description, image, domain, type, author, authorUsername, appId } = metadata;
  const hasImage = image && !imageError;
  const isTwitter = type === 'twitter';
  const isWorldApp = type === 'worldapp';

  const handleClick = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Twitter/X card design
  if (isTwitter) {
    return (
      <div
        onClick={handleClick}
        className="cursor-pointer overflow-hidden rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] w-[340px] hover:bg-[var(--bg-tertiary)] transition-colors group"
      >
        {/* Header with X logo and author */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <XLogo className="w-4 h-4 text-[var(--text-primary)]" />
          </div>
          {author ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[14px] font-semibold text-[var(--text-primary)] truncate">
                {author}
              </span>
              {authorUsername && (
                <span className="text-[14px] text-[var(--text-secondary)] truncate">
                  @{authorUsername}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[14px] font-medium text-[var(--text-secondary)]">
              X (formerly Twitter)
            </span>
          )}
        </div>

        {/* Tweet text */}
        {title && (
          <div className="px-4 pb-3">
            <p className="text-[15px] text-[var(--text-primary)] leading-[1.4] line-clamp-4 whitespace-pre-wrap">
              {title}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 pb-3 flex items-center gap-1.5">
          <span className="text-[13px] text-[var(--accent-blue)]">
            View on X
          </span>
          <ExternalLink className="w-3.5 h-3.5 text-[var(--accent-blue)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    );
  }

  // World App mini-app card design
  if (isWorldApp) {
    return (
      <div
        onClick={handleClick}
        className="cursor-pointer overflow-hidden rounded-2xl bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] border border-[#333] w-[280px] hover:border-[#555] transition-colors group"
      >
        {/* Header with World logo */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
            <WorldLogo className="w-6 h-6 text-black" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-white truncate">
              {title || 'World App Mini-App'}
            </p>
            <p className="text-[13px] text-[#888] truncate">
              {description || 'Open in World App'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-3 flex items-center gap-1.5">
          <span className="text-[13px] text-[#00D632] font-medium">
            Open in World App
          </span>
          <ExternalLink className="w-3.5 h-3.5 text-[#00D632] opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    );
  }

  // Generic link preview - iMessage style: big image, title, domain
  return (
    <div
      onClick={handleClick}
      className="cursor-pointer overflow-hidden rounded-2xl w-[340px] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors"
    >
      {/* Large image */}
      {hasImage && (
        <div className="relative h-[180px] bg-[var(--bg-hover)]">
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-[var(--text-tertiary)] animate-spin" />
            </div>
          )}
          <img
            src={image}
            alt={title || domain}
            className={`w-full h-full object-cover transition-opacity ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </div>
      )}

      {/* Content area */}
      <div className="px-3 py-2.5">
        {/* Domain - small gray text at top if no image */}
        {!hasImage && (
          <p className="text-[11px] text-[var(--text-tertiary)] mb-1 truncate">
            {domain}
          </p>
        )}

        {/* Title */}
        {title && (
          <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-[1.3] line-clamp-2">
            {title}
          </p>
        )}

        {/* Description - show when no image for richer preview */}
        {!hasImage && description && (
          <p className="text-[12px] text-[var(--text-tertiary)] leading-[1.4] line-clamp-3 mt-1">
            {description}
          </p>
        )}

        {/* Domain - small gray text at bottom if has image */}
        {hasImage && (
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate">
            {domain}
          </p>
        )}
      </div>
    </div>
  );
}

// Helper to extract URLs from text (including worldapp:// deep links)
export function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/|worldapp:\/\/)[^\s<>"{}|\\^`[\]]+/gi;
  const matches = text.match(urlRegex);
  return matches ? [...new Set(matches)] : [];
}

// Check if URL is a World App deep link
export function isWorldAppUrl(url: string): boolean {
  return url.startsWith('worldapp://');
}

// Parse World App URL into metadata
export function parseWorldAppUrl(url: string): LinkMetadata | null {
  if (!isWorldAppUrl(url)) return null;

  try {
    // Parse worldapp://mini-app?app_id=xxx&path=xxx
    const withoutProtocol = url.replace('worldapp://', '');
    const [action, queryString] = withoutProtocol.split('?');
    const params = new URLSearchParams(queryString || '');

    const appId = params.get('app_id') || undefined;
    const path = params.get('path') ? decodeURIComponent(params.get('path')!) : undefined;

    // Known app mappings (can be extended)
    const knownApps: Record<string, { title: string; description: string }> = {
      'app_460a0688154a51506f447288981d6493': {
        title: 'World App Mini-App',
        description: 'Open in World App'
      },
    };

    const appInfo = appId ? knownApps[appId] : undefined;

    return {
      url,
      domain: 'worldapp',
      type: 'worldapp',
      appId,
      title: appInfo?.title ?? 'World App Mini-App',
      description: appInfo?.description ?? 'Open in World App',
    };
  } catch {
    return {
      url,
      domain: 'worldapp',
      type: 'worldapp',
      title: 'World App',
      description: 'Open in World App',
    };
  }
}

// Check if text is just a single URL (with optional whitespace)
export function isJustUrl(text: string): boolean {
  const trimmed = text.trim();
  const urlRegex = /^(https?:\/\/|worldapp:\/\/)[^\s<>"{}|\\^`[\]]+$/i;
  return urlRegex.test(trimmed);
}

// Helper to get domain from URL
export function getDomainFromUrl(url: string): string {
  // Handle worldapp:// URLs specially
  if (url.startsWith('worldapp://')) {
    return 'World App';
  }
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
