'use client';

import { useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import { useUsername } from '@/hooks/useUsername';

interface MemberPreview {
  inboxId: string;
  address: string;
}

interface AvatarProps {
  /** Display name for initials fallback */
  name?: string;
  /** Wallet address to lookup username/profile picture */
  address?: string | null;
  /** Direct image URL (overrides address lookup) */
  imageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Whether this is a group avatar */
  isGroup?: boolean;
  /** Group name for fallback initials */
  groupName?: string;
  /** Member previews for group stacked avatars */
  memberPreviews?: MemberPreview[];
  /** Whether to show disappearing messages timer icon */
  showDisappearingIcon?: boolean;
}

// Refined color palette - sophisticated, muted tones for secure messaging
const AVATAR_COLORS = [
  { bg: '#E8F0FE', text: '#1A73E8' }, // Calm blue
  { bg: '#E6F4EA', text: '#1E8E3E' }, // Sage green
  { bg: '#FEF7E0', text: '#F9AB00' }, // Warm amber
  { bg: '#FCE8E6', text: '#D93025' }, // Soft coral
  { bg: '#F3E8FD', text: '#8E24AA' }, // Muted purple
] as const;

/**
 * Get deterministic color based on name/address hash
 * Same input always produces same color
 */
function getColorFromName(name: string): (typeof AVATAR_COLORS)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Check if a profile picture URL is a default/placeholder image
 * Simple rule: if URL ends in .png, it's a default
 * Real profile pictures don't end in .png (they're UUIDs or other formats)
 */
function isDefaultProfilePicture(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.toLowerCase().endsWith('.png');
}

const SIZE_MAP = {
  sm: { container: 32, text: 14 },  // Small for message avatars (32px per Figma)
  md: { container: 44, text: 16 },  // Medium for conversation list
  lg: { container: 52, text: 22 },  // Large for headers
  xl: { container: 80, text: 28 },  // Extra large for profile panels
} as const;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Mini avatar for group stacked display
function MiniAvatar({ address, size }: { address: string; size: number }) {
  const { displayName, profilePicture } = useUsername(address);
  const [imgError, setImgError] = useState(false);
  const displayLabel = displayName ?? address.slice(0, 6);
  const initials = getInitials(displayLabel);
  const colors = getColorFromName(address); // Use address for consistent color

  // Don't show default profile pictures (URLs ending in .png)
  const hasValidPicture = profilePicture &&
    !imgError &&
    !isDefaultProfilePicture(profilePicture);

  if (hasValidPicture) {
    return (
      <div
        className="rounded-full overflow-hidden border-2 border-white"
        style={{ width: size, height: size }}
      >
        <img
          src={profilePicture}
          alt={displayLabel}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // No valid profile picture - use colored circle with initial
  return (
    <div
      className="rounded-full flex items-center justify-center border-2 border-white"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.bg,
      }}
    >
      <span
        className="font-light leading-none"
        style={{ color: colors.text, fontSize: size * 0.4 }}
      >
        {initials}
      </span>
    </div>
  );
}

// Timer icon overlay component
function DisappearingTimerIcon({ size }: { size: 'sm' | 'md' | 'lg' | 'xl' }) {
  const iconSizes = { sm: 12, md: 14, lg: 16, xl: 18 };
  const iconSize = iconSizes[size];

  return (
    <div
      className="absolute -bottom-0.5 -right-0.5 bg-[var(--bg-primary)] rounded-full p-0.5 shadow-sm"
      style={{ zIndex: 10 }}
    >
      <Timer
        className="text-[var(--text-secondary)]"
        size={iconSize}
        strokeWidth={2}
      />
    </div>
  );
}

// Group avatar with stacked member avatars or icon fallback
function GroupAvatar({
  groupName,
  groupImageUrl,
  memberPreviews,
  size,
  className,
  showDisappearingIcon,
}: {
  groupName?: string;
  groupImageUrl?: string;
  memberPreviews?: MemberPreview[];
  size: 'sm' | 'md' | 'lg' | 'xl';
  className: string;
  showDisappearingIcon?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const dimensions = SIZE_MAP[size];

  // If group has an image URL, use it
  if (groupImageUrl && !imgError) {
    return (
      <div
        className={`relative shrink-0 ${className}`}
        style={{ width: dimensions.container, height: dimensions.container }}
      >
        <div className="rounded-full overflow-hidden w-full h-full">
          <img
            src={groupImageUrl}
            alt={groupName ?? 'Group'}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        </div>
        {showDisappearingIcon && <DisappearingTimerIcon size={size} />}
      </div>
    );
  }

  // If we have member previews, show 2 overlapping avatars (like Figma design)
  if (memberPreviews && memberPreviews.length >= 2) {
    const displayMembers = memberPreviews.slice(0, 2);
    const miniSize = Math.round(dimensions.container * 0.7);

    return (
      <div
        className={`relative shrink-0 ${className}`}
        style={{
          width: dimensions.container,
          height: dimensions.container,
        }}
      >
        {/* Back avatar (second member) */}
        <div
          className="absolute"
          style={{
            right: 0,
            bottom: 0,
            zIndex: 1,
          }}
        >
          <MiniAvatar address={displayMembers[1].address} size={miniSize} />
        </div>
        {/* Front avatar (first member) */}
        <div
          className="absolute"
          style={{
            left: 0,
            top: 0,
            zIndex: 2,
          }}
        >
          <MiniAvatar address={displayMembers[0].address} size={miniSize} />
        </div>
        {showDisappearingIcon && <DisappearingTimerIcon size={size} />}
      </div>
    );
  }

  // Fallback: colored circle with initials
  const displayLabel = groupName ?? 'Group';
  const initials = getInitials(displayLabel);
  const colors = getColorFromName(displayLabel);

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{
        width: dimensions.container,
        height: dimensions.container,
      }}
    >
      <div
        className="rounded-full flex items-center justify-center w-full h-full"
        style={{ backgroundColor: colors.bg }}
      >
        <span
          className="font-light leading-none"
          style={{ color: colors.text, fontSize: dimensions.text }}
        >
          {initials}
        </span>
      </div>
      {showDisappearingIcon && <DisappearingTimerIcon size={size} />}
    </div>
  );
}

export function Avatar({
  name,
  address,
  imageUrl,
  size = 'md',
  className = '',
  isGroup = false,
  groupName,
  memberPreviews,
  showDisappearingIcon = false,
}: AvatarProps) {
  // Handle group avatars
  if (isGroup) {
    return (
      <GroupAvatar
        groupName={groupName}
        groupImageUrl={imageUrl ?? undefined}
        memberPreviews={memberPreviews}
        size={size}
        className={className}
        showDisappearingIcon={showDisappearingIcon}
      />
    );
  }

  // Standard single-person avatar
  const { displayName, profilePicture } = useUsername(address);
  const [imgError, setImgError] = useState(false);

  // Use provided name, or fall back to username/address from hook
  const displayLabel = name ?? displayName ?? '';
  const initials = useMemo(() => getInitials(displayLabel), [displayLabel]);
  // Use address for consistent color (doesn't change on reload)
  const colors = useMemo(() => getColorFromName(address ?? displayLabel), [address, displayLabel]);
  const dimensions = SIZE_MAP[size];

  // Priority: explicit imageUrl > profile picture from API
  // But skip default profile pictures (URLs ending in .png)
  const candidateUrl = imageUrl ?? (imgError ? null : profilePicture);
  const isDefault = isDefaultProfilePicture(candidateUrl);
  const avatarUrl = isDefault ? null : candidateUrl;

  if (avatarUrl) {
    return (
      <div
        className={`relative shrink-0 ${className}`}
        style={{ width: dimensions.container, height: dimensions.container }}
      >
        <div className="rounded-full overflow-hidden w-full h-full">
          <img
            src={avatarUrl}
            alt={displayLabel}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        </div>
        {showDisappearingIcon && <DisappearingTimerIcon size={size} />}
      </div>
    );
  }

  // No valid profile picture - use colored circle with initials
  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{
        width: dimensions.container,
        height: dimensions.container,
      }}
    >
      <div
        className="rounded-full flex items-center justify-center w-full h-full"
        style={{ backgroundColor: colors.bg }}
      >
        <span
          className="font-light leading-none"
          style={{
            color: colors.text,
            fontSize: dimensions.text,
          }}
        >
          {initials}
        </span>
      </div>
      {showDisappearingIcon && <DisappearingTimerIcon size={size} />}
    </div>
  );
}
