'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUsername } from '@/hooks/useUsername';

interface ReplyPreviewProps {
  senderAddress: string;
  content: string;
  onDismiss: () => void;
}

export function ReplyPreview({
  senderAddress,
  content,
  onDismiss,
}: ReplyPreviewProps) {
  const { displayName } = useUsername(senderAddress);
  const [isVisible, setIsVisible] = useState(false);

  // Trigger animation on mount
  useEffect(() => {
    // Small delay to ensure the initial state is rendered first
    const frame = requestAnimationFrame(() => {
      setIsVisible(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="overflow-hidden w-full"
      style={{
        maxHeight: isVisible ? '80px' : '0px',
        transition: 'max-height 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div
        className="flex items-center px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]"
        style={{
          transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
          opacity: isVisible ? 1 : 0,
          transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), opacity 150ms ease-out',
        }}
      >
        {/* Blue accent bar on the left */}
        <div className="w-[3px] h-10 bg-[var(--accent-blue)] rounded-full mr-3 shrink-0" />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
          <span className="text-[14px] font-semibold text-[var(--accent-blue)] truncate">
            {displayName || 'You'}
          </span>
          <p className="text-[14px] text-[var(--text-secondary)] truncate">
            {content}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="ml-3 p-1.5 rounded-full hover:bg-[var(--bg-hover)] transition-colors shrink-0 active:scale-95"
          aria-label="Cancel reply"
        >
          <X className="w-5 h-5 text-[var(--text-tertiary)]" />
        </button>
      </div>
    </div>
  );
}
