"use client";

import { Loader2, ArrowUpRight, XCircle, Check } from "lucide-react";
import type {
  TransactionReference,
  TransactionStatus,
  PaymentType,
} from "@/lib/xmtp/TransactionReferenceCodec";
import {
  formatTokenAmount,
  formatFullTokenAmount,
} from "@/lib/xmtp/TransactionReferenceCodec";
import { useTransactionDetails } from "@/hooks/useTransactionDetails";
import { assetMetadata } from "@/config/tokens";

// Get token metadata by symbol
function getTokenMetadata(symbol: string) {
  // Normalize symbol for lookup (handle USDC.e -> USDCE, etc.)
  const normalizedSymbol = symbol.toUpperCase().replace(".", "");

  return assetMetadata.find(
    (token) =>
      token.symbol?.toUpperCase() === normalizedSymbol ||
      token.asset?.toUpperCase() === normalizedSymbol
  );
}

// Token icon component with size variants
function TokenIcon({
  symbol,
  size = "md",
}: {
  symbol: string;
  size?: "sm" | "md" | "lg";
}) {
  const metadata = getTokenMetadata(symbol);
  const iconUrl = metadata?.icon;

  const sizeClasses = {
    sm: "w-5 h-5",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  };

  const pixelSize = { sm: 20, md: 32, lg: 40 };

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={symbol}
        className={`rounded-full ${sizeClasses[size]}`}
        width={pixelSize[size]}
        height={pixelSize[size]}
      />
    );
  }

  return <div className={`rounded-full bg-gray-300 ${sizeClasses[size]}`} />;
}

interface PaymentMessageProps {
  txRef: TransactionReference;
  isOwnMessage: boolean;
  sentAtNs?: bigint;
  onViewTransaction?: () => void;
}

/**
 * Payment message bubble component
 * Displays transaction details with status, amount, and optional description
 */
export function PaymentMessage({
  txRef,
  isOwnMessage,
  sentAtNs,
}: PaymentMessageProps) {
  const { details, isLoading } = useTransactionDetails(txRef, sentAtNs);

  // Use fetched details or fall back to reference data
  const status: TransactionStatus = details?.status || "pending";
  const amount = details?.amount || txRef.amount;
  const token = details?.token || txRef.token;
  const description = details?.description || txRef.description;
  const type = txRef.type;

  // Format amount for display (number only, symbol separate)
  const formattedAmount = formatTokenAmount(amount, token.decimals);
  const fullAmount = formatFullTokenAmount(amount, token.decimals);

  // Explorer URL for World Chain - use actual tx hash if available (for ERC-4337 userOps)
  const txHashForExplorer = details?.actualTxHash || txRef.txHash;
  const explorerUrl = `https://worldchain-mainnet.explorer.alchemy.com/tx/${txHashForExplorer}`;

  // Get token metadata for styling
  const tokenMetadata = getTokenMetadata(token.symbol);
  const primaryColor = tokenMetadata?.primaryColor || "#005CFF";
  const tokenName = tokenMetadata?.name || token.symbol;

  if (isOwnMessage) {
    return (
      <SenderPaymentBubble
        status={status}
        amount={formattedAmount}
        fullAmount={fullAmount}
        tokenSymbol={token.symbol}
        tokenName={tokenName}
        description={description}
        isLoading={isLoading}
        explorerUrl={explorerUrl}
        primaryColor={primaryColor}
      />
    );
  }

  return (
    <RecipientPaymentBubble
      status={status}
      amount={formattedAmount}
      fullAmount={fullAmount}
      tokenSymbol={token.symbol}
      tokenName={tokenName}
      description={description}
      type={type}
      isLoading={isLoading}
      explorerUrl={explorerUrl}
      primaryColor={primaryColor}
    />
  );
}

interface SenderPaymentBubbleProps {
  status: TransactionStatus;
  amount: string;
  fullAmount: string;
  tokenSymbol: string;
  tokenName: string;
  description?: string;
  isLoading: boolean;
  explorerUrl: string;
  primaryColor: string;
}

/**
 * Sender payment bubble - refined design with token branding
 */
function SenderPaymentBubble({
  status,
  amount,
  fullAmount,
  tokenSymbol,
  tokenName,
  description,
  isLoading,
  explorerUrl,
  primaryColor,
}: SenderPaymentBubbleProps) {
  const isFailed = status === "failed";
  const isPending = status === "pending" || isLoading;
  const isConfirmed = status === "confirmed";

  return (
    <div
      className="rounded-[20px] p-3.5 w-[200px] relative overflow-hidden"
      style={{ backgroundColor: primaryColor }}
    >
      {/* Subtle gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

      <div className="relative">
        {/* Header: Token icon + status */}
        <div className="flex items-center justify-between mb-2">
          <TokenIcon symbol={tokenSymbol} size="md" />
          <div className="flex items-center gap-1">
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 text-white/70 animate-spin" />
            ) : isFailed ? (
              <XCircle className="w-3.5 h-3.5 text-white/70" />
            ) : (
              <Check className="w-3.5 h-3.5 text-white/70" />
            )}
            <span className="text-[11px] text-white/70 font-medium uppercase tracking-wide">
              {isPending ? "Pending" : isFailed ? "Failed" : "Sent"}
            </span>
          </div>
        </div>

        {/* Amount display - number prominent, symbol subtle */}
        <div className={`mb-1 ${isFailed ? "opacity-50" : ""}`}>
          <div
            className="flex items-baseline gap-1.5 cursor-default"
            title={`${fullAmount} ${tokenSymbol}`}
          >
            <span
              className={`text-[28px] font-semibold text-white leading-none tracking-tight tabular-nums ${
                isFailed ? "line-through" : ""
              }`}
            >
              {amount}
            </span>
            <span className="text-[14px] font-medium text-white/80">
              {tokenSymbol}
            </span>
          </div>
          <p className="text-[12px] font-bold text-white/60 mt-0.5">{tokenName}</p>
        </div>

        {/* Description if present */}
        {description && (
          <p className="text-[13px] text-white/80 leading-snug mt-2 line-clamp-2">
            {description}
          </p>
        )}

        {/* Explorer link for confirmed */}
        {isConfirmed && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-white/70 hover:text-white transition-colors mt-3 group"
          >
            <span className="text-[12px] font-medium">View transaction</span>
            <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </a>
        )}
      </div>
    </div>
  );
}

interface RecipientPaymentBubbleProps {
  status: TransactionStatus;
  amount: string;
  fullAmount: string;
  tokenSymbol: string;
  tokenName: string;
  description?: string;
  type: PaymentType;
  isLoading: boolean;
  explorerUrl: string;
  primaryColor: string;
}

/**
 * Recipient payment bubble - clean white card with token accent
 */
function RecipientPaymentBubble({
  status,
  amount,
  fullAmount,
  tokenSymbol,
  tokenName,
  description,
  type,
  isLoading,
  explorerUrl,
  primaryColor,
}: RecipientPaymentBubbleProps) {
  const isPending = status === "pending" || isLoading;
  const isConfirmed = status === "confirmed";
  const isRequest = type === "request";

  return (
    <div className="bg-white rounded-[20px] p-4 w-[200px] shadow-sm border border-gray-100">
      {/* Header: Token icon + status */}
      <div className="flex items-center justify-between mb-2">
        <TokenIcon symbol={tokenSymbol} size="md" />
        <div className="flex items-center gap-1">
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 text-[#9BA3AE] animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5 text-[#00C230]" />
          )}
          <span className="text-[11px] text-[#717680] font-medium uppercase tracking-wide">
            {isPending ? "Pending" : isRequest ? "Request" : "Received"}
          </span>
        </div>
      </div>

      {/* Amount display */}
      <div className="mb-1">
        <div
          className="flex items-baseline gap-1.5 cursor-default"
          title={`${fullAmount} ${tokenSymbol}`}
        >
          <span className="text-[28px] font-semibold text-[#181818] leading-none tracking-tight tabular-nums">
            {amount}
          </span>
          <span className="text-[14px] font-medium text-[#717680]">
            {tokenSymbol}
          </span>
        </div>
        <p className="text-[12px] text-[#9BA3AE] mt-0.5">{tokenName}</p>
      </div>

      {/* Description if present */}
      {description && (
        <p className="text-[13px] text-[#717680] leading-snug mt-2 line-clamp-2">
          {description}
        </p>
      )}

      {/* Action button for payment requests */}
      {isRequest && !isConfirmed && (
        <button
          className="w-full h-9 text-white text-[13px] font-semibold rounded-full hover:opacity-90 transition-opacity mt-3"
          style={{ backgroundColor: primaryColor }}
        >
          Pay Now
        </button>
      )}

      {/* Explorer link for confirmed */}
      {isConfirmed && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#717680] hover:text-[#181818] transition-colors mt-3 group"
        >
          <span className="text-[12px] font-medium">View transaction</span>
          <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </a>
      )}
    </div>
  );
}

/**
 * Compact payment preview for conversation list
 */
export function PaymentPreview({
  txRef,
  isOwnMessage,
}: {
  txRef: TransactionReference;
  isOwnMessage: boolean;
}) {
  const formattedAmount = `${formatTokenAmount(
    txRef.amount,
    txRef.token.decimals
  )} ${txRef.token.symbol}`;
  const prefix = isOwnMessage
    ? txRef.type === "request"
      ? "Requested"
      : "Sent"
    : txRef.type === "request"
    ? "Payment request"
    : "Received";

  return (
    <span className="text-[14px] text-[#717680]">
      {prefix} {formattedAmount}
    </span>
  );
}
