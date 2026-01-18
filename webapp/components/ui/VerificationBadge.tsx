'use client';

import Image from 'next/image';

interface VerificationBadgeProps {
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const SIZE_MAP = {
  xs: 14,
  sm: 16,
  md: 20,
} as const;

export function VerificationBadge({ size = 'sm', className = '' }: VerificationBadgeProps) {
  const dimension = SIZE_MAP[size];

  return (
    <Image
      src="/human-badge.svg"
      alt="Verified Human"
      width={dimension}
      height={dimension}
      className={`shrink-0 ${className}`}
    />
  );
}
