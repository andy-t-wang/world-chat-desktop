/**
 * Hook to calculate verified/unverified member counts for group chats
 * Verified = has profile picture (World ID verified human)
 * Unverified = no profile picture
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { resolveAddresses, getCachedUsername } from '@/lib/username/service';

interface MemberPreview {
  inboxId: string;
  address: string;
}

interface GroupVerificationStats {
  verifiedCount: number;
  unverifiedCount: number;
  isLoading: boolean;
}

/**
 * Hook to get verification stats for group members
 * Uses batch resolution for efficiency
 */
export function useGroupMemberVerification(
  memberPreviews: MemberPreview[] | undefined
): GroupVerificationStats {
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedVersion, setResolvedVersion] = useState(0);

  // Extract addresses from previews
  const addresses = useMemo(() => {
    if (!memberPreviews || memberPreviews.length === 0) return [];
    return memberPreviews.map(m => m.address).filter(Boolean);
  }, [memberPreviews]);

  // Fetch missing usernames
  useEffect(() => {
    if (addresses.length === 0) return;

    // Check which addresses need fetching
    const needsFetch = addresses.some(addr => getCachedUsername(addr) === undefined);

    if (!needsFetch) {
      return;
    }

    setIsLoading(true);

    resolveAddresses(addresses)
      .then(() => {
        setResolvedVersion(v => v + 1);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [addresses]);

  // Calculate counts from cache
  const stats = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _version = resolvedVersion; // Dependency to recalculate after fetch

    if (addresses.length === 0) {
      return { verifiedCount: 0, unverifiedCount: 0 };
    }

    let verified = 0;
    let unverified = 0;

    for (const address of addresses) {
      const record = getCachedUsername(address);
      // Verified = has profile picture
      if (record?.profile_picture_url || record?.minimized_profile_picture_url) {
        verified++;
      } else {
        unverified++;
      }
    }

    return { verifiedCount: verified, unverifiedCount: unverified };
  }, [addresses, resolvedVersion]);

  return {
    ...stats,
    isLoading,
  };
}
