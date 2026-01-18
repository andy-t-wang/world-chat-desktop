"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import type { PaymentRequest } from "@/lib/xmtp/PaymentRequestCodec";
import type { PaymentFulfillment } from "@/lib/xmtp/PaymentFulfillmentCodec";
import { formatTokenAmount } from "@/lib/xmtp/TransactionReferenceCodec";
import { assetMetadata } from "@/config/tokens";

// Get token metadata by symbol
function getTokenMetadata(symbol: string) {
  const normalizedSymbol = symbol.toUpperCase().replace(".", "");
  return assetMetadata.find(
    (token) =>
      token.symbol?.toUpperCase() === normalizedSymbol ||
      token.asset?.toUpperCase() === normalizedSymbol
  );
}

// Check if token is a USD stablecoin
function isUsdToken(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return upper === "USDC" || upper === "USDT" || upper === "USD" || upper === "USDCE";
}

// Format amount with proper prefix/suffix based on token
function formatDisplayAmount(amount: string, symbol: string): string {
  if (isUsdToken(symbol)) {
    return `$${amount}`;
  }
  return `${amount} ${symbol}`;
}

// Token icon component
function TokenIcon({
  symbol,
  size = "sm",
}: {
  symbol: string;
  size?: "sm" | "md";
}) {
  const metadata = getTokenMetadata(symbol);
  const iconUrl = metadata?.icon;

  const sizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
  };

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={symbol}
        className={`rounded-full ${sizeClasses[size]}`}
      />
    );
  }

  return <div className={`rounded-full bg-gray-300 ${sizeClasses[size]}`} />;
}

interface PaymentRequestMessageProps {
  request: PaymentRequest;
  isOwnMessage: boolean;
  /** All fulfillments in the conversation for tracking progress */
  fulfillments?: PaymentFulfillment[];
  /** Current user's address to check if they've paid */
  currentUserAddress?: string;
}

/**
 * Payment request message component
 * Shows request card with amount, note, and payment progress
 */
export function PaymentRequestMessage({
  request,
  isOwnMessage,
  fulfillments = [],
  currentUserAddress,
}: PaymentRequestMessageProps) {
  // Format amount
  const formattedAmount = formatTokenAmount(
    request.metadata.amount,
    request.metadata.decimals
  );

  // Calculate payment progress
  const { paidCount, totalRequested, hasCurrentUserPaid } = useMemo(() => {
    // Count fulfillments matching this request
    const matchingFulfillments = fulfillments.filter(
      (f) => f.requestId === request.requestId
    );
    const paidCount = matchingFulfillments.length;

    // Total requested people (or 1 for DM requests)
    const totalRequested = request.metadata.requestedAddresses?.length || 1;

    // Check if current user has paid
    const hasCurrentUserPaid = currentUserAddress
      ? matchingFulfillments.some(
          (f) =>
            f.metadata.fromAddress.toLowerCase() ===
            currentUserAddress.toLowerCase()
        )
      : false;

    return { paidCount, totalRequested, hasCurrentUserPaid };
  }, [request, fulfillments, currentUserAddress]);

  // Show progress text only if multiple people requested
  const showProgress = totalRequested > 1;

  // Display amount formatted for token type
  const displayAmount = formatDisplayAmount(formattedAmount, request.metadata.tokenSymbol);

  if (isOwnMessage) {
    // Sender view - blue card (matches outgoing bubble)
    return (
      <div className="rounded-[16px] p-3.5 w-[200px] bg-[var(--bubble-outgoing)]">
        {/* Header: White pill badge with token icon + Request */}
        <div className="inline-flex items-center gap-1 bg-white rounded-full px-2 py-0.5 mb-2">
          <TokenIcon symbol={request.metadata.tokenSymbol} size="sm" />
          <span className="text-[11px] font-semibold text-[#181818]">
            Request
          </span>
        </div>

        {/* Amount */}
        <div className="mb-1">
          <span className="text-[20px] font-normal text-white leading-none tabular-nums">
            {displayAmount}
          </span>
        </div>

        {/* Note */}
        {request.metadata.note && (
          <p className="text-[13px] text-white/90 leading-snug mb-1">
            {request.metadata.note}
          </p>
        )}

        {/* Progress */}
        {showProgress && (
          <p className="text-[12px] text-white/60">
            {paidCount} of {totalRequested} paid
          </p>
        )}
      </div>
    );
  }

  // Recipient view - matches incoming bubble
  return (
    <div className="bg-[var(--bubble-incoming)] rounded-[16px] p-3.5 w-[200px]">
      {/* Header: White pill badge with token icon + Request */}
      <div className="inline-flex items-center gap-1 bg-white rounded-full px-2 py-0.5 mb-2">
        <TokenIcon symbol={request.metadata.tokenSymbol} size="sm" />
        <span className="text-[11px] font-semibold text-[#181818]">
          Request
        </span>
      </div>

      {/* Amount */}
      <div className="mb-1">
        <span className="text-[20px] font-normal text-[var(--bubble-incoming-text)] leading-none tabular-nums">
          {displayAmount}
        </span>
      </div>

      {/* Note */}
      {request.metadata.note && (
        <p className="text-[13px] text-[var(--text-secondary)] leading-snug mb-1">
          {request.metadata.note}
        </p>
      )}

      {/* Progress */}
      {showProgress && (
        <p className="text-[12px] text-[var(--text-tertiary)] mb-2">
          {paidCount} of {totalRequested} paid
        </p>
      )}

      {/* Paid status */}
      {hasCurrentUserPaid && (
        <div className="flex items-center gap-1.5 text-[var(--accent-green)]">
          <Check className="w-3.5 h-3.5" />
          <span className="text-[12px] font-medium">Paid</span>
        </div>
      )}
    </div>
  );
}

interface PaymentFulfillmentMessageProps {
  fulfillment: PaymentFulfillment;
  isOwnMessage: boolean;
  /** To address for showing "To you" indicator */
  currentUserAddress?: string;
}

/**
 * Payment fulfillment message component
 * Shows sent/received payment card
 */
export function PaymentFulfillmentMessage({
  fulfillment,
  isOwnMessage,
  currentUserAddress,
}: PaymentFulfillmentMessageProps) {
  // Format amount
  const formattedAmount = formatTokenAmount(
    fulfillment.metadata.amount,
    fulfillment.metadata.decimals
  );

  // Check if payment was to current user
  const isToCurrentUser =
    currentUserAddress &&
    fulfillment.metadata.toAddress.toLowerCase() ===
      currentUserAddress.toLowerCase();

  // Display amount formatted for token type
  const displayAmount = formatDisplayAmount(formattedAmount, fulfillment.metadata.tokenSymbol);

  if (isOwnMessage) {
    // Sender view - matches outgoing bubble (Sent)
    return (
      <div className="rounded-[16px] p-3.5 w-[180px] bg-[var(--bubble-outgoing)]">
        {/* Header: White pill badge with token icon + Sent */}
        <div className="inline-flex items-center gap-1 bg-white rounded-full px-2 py-0.5 mb-2">
          <TokenIcon symbol={fulfillment.metadata.tokenSymbol} size="sm" />
          <span className="text-[11px] font-semibold text-[#181818]">
            Sent
          </span>
        </div>

        {/* Amount */}
        <span className="text-[20px] font-normal text-white leading-none tabular-nums">
          {displayAmount}
        </span>
      </div>
    );
  }

  // Recipient view - matches incoming bubble (Received)
  return (
    <div className="bg-[var(--bubble-incoming)] rounded-[16px] p-3.5 w-[180px]">
      {/* Header: White pill badge with token icon + Received */}
      <div className="inline-flex items-center gap-1 bg-white rounded-full px-2 py-0.5 mb-2">
        <TokenIcon symbol={fulfillment.metadata.tokenSymbol} size="sm" />
        <span className="text-[11px] font-semibold text-[#181818]">
          Received
        </span>
      </div>

      {/* Amount */}
      <div className="mb-1">
        <span className="text-[20px] font-normal text-[var(--bubble-incoming-text)] leading-none tabular-nums">
          {displayAmount}
        </span>
      </div>

      {/* To you indicator */}
      {isToCurrentUser && (
        <p className="text-[12px] text-[var(--text-tertiary)]">To you</p>
      )}
    </div>
  );
}

/**
 * Preview text for payment requests (conversation list)
 */
export function getPaymentRequestPreview(
  request: PaymentRequest,
  isOwnMessage: boolean
): string {
  const amount = formatTokenAmount(
    request.metadata.amount,
    request.metadata.decimals
  );
  const displayAmount = formatDisplayAmount(amount, request.metadata.tokenSymbol);
  return isOwnMessage
    ? `Requested ${displayAmount}`
    : `Payment request: ${displayAmount}`;
}

/**
 * Preview text for payment fulfillments (conversation list)
 */
export function getPaymentFulfillmentPreview(
  fulfillment: PaymentFulfillment,
  isOwnMessage: boolean
): string {
  const amount = formatTokenAmount(
    fulfillment.metadata.amount,
    fulfillment.metadata.decimals
  );
  const displayAmount = formatDisplayAmount(amount, fulfillment.metadata.tokenSymbol);
  return isOwnMessage ? `Sent ${displayAmount}` : `Received ${displayAmount}`;
}
