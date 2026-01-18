'use client';

import { useEffect, useRef } from 'react';
import { useUsername } from '@/hooks/useUsername';

interface ReactorNameProps {
  inboxId: string;
  address?: string;
  isYou?: boolean;
}

function ReactorName({ inboxId, address, isYou }: ReactorNameProps) {
  const { displayName } = useUsername(address);

  if (isYou) {
    return <span className="text-[var(--accent-blue)]">You</span>;
  }

  if (displayName) {
    return <span>{displayName}</span>;
  }

  // Fallback to shortened inboxId
  return <span>{inboxId.slice(0, 6)}...{inboxId.slice(-4)}</span>;
}

interface ReactionDetailsMenuProps {
  emoji: string;
  reactors: Array<{
    inboxId: string;
    address?: string;
    isYou?: boolean;
  }>;
  position: { x: number; y: number };
  onClose: () => void;
}

export function ReactionDetailsMenu({
  emoji,
  reactors,
  position,
  onClose,
}: ReactionDetailsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu on screen
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 200),
    y: Math.min(position.y, window.innerHeight - (reactors.length * 36 + 50)),
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-[var(--bg-primary)] rounded-xl shadow-lg border border-[var(--border-subtle)] py-2 min-w-[160px] max-w-[240px]"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {/* Header with emoji */}
      <div className="px-3 pb-2 mb-1 border-b border-[var(--border-subtle)]">
        <span className="text-xl">{emoji}</span>
        <span className="text-[13px] text-[var(--text-secondary)] ml-2">
          {reactors.length} {reactors.length === 1 ? 'reaction' : 'reactions'}
        </span>
      </div>

      {/* List of reactors */}
      <div className="max-h-[200px] overflow-y-auto">
        {reactors.map((reactor, index) => (
          <div
            key={`${reactor.inboxId}-${index}`}
            className="px-3 py-1.5 text-[14px] text-[var(--text-primary)]"
          >
            <ReactorName inboxId={reactor.inboxId} address={reactor.address} isYou={reactor.isYou} />
          </div>
        ))}
      </div>
    </div>
  );
}
