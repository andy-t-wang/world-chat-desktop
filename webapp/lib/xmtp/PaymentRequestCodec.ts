/**
 * PaymentRequestCodec - XMTP Content Type for Payment Requests
 *
 * This codec handles payment requests in group or DM chats.
 * It allows users to request payments from specific members with
 * token, amount, and optional note information.
 */

import type { ContentCodec, EncodedContent, ContentTypeId } from '@xmtp/content-type-primitives';
import { formatTokenAmount } from './TransactionReferenceCodec';

// Content type identifier
export const ContentTypePaymentRequest: ContentTypeId = {
  authorityId: 'toolsforhumanity.com',
  typeId: 'paymentRequest',
  versionMajor: 1,
  versionMinor: 0,
  sameAs(id: ContentTypeId): boolean {
    return (
      this.authorityId === id.authorityId &&
      this.typeId === id.typeId &&
      this.versionMajor === id.versionMajor
    );
  },
};

/** Payment request metadata */
export interface PaymentRequestMetadata {
  /** Token symbol (e.g., "USDC", "WLD", "ETH") */
  tokenSymbol: string;
  /** Contract address of the token (undefined for native ETH) */
  tokenAddress?: string;
  /** Amount in the token's smallest unit (wei, etc.) - World App sends as number, we accept both */
  amount: string | number;
  /** Number of decimal places for the token */
  decimals: number;
  /** Address to receive the payment */
  toAddress: string;
  /** Optional note/description for the request */
  note?: string;
  /** Addresses of people being requested to pay (for group requests) */
  requestedAddresses?: string[];
}

/** Payment request content stored in XMTP message */
export interface PaymentRequest {
  /** Unique identifier for this request (UUID v4) */
  requestId: string;
  /** Chain ID (480 for World Chain mainnet) */
  networkId: number;
  /** Payment request details */
  metadata: PaymentRequestMetadata;
  /** Timestamp when request was created */
  timestamp: number;
  /** Address of the requester */
  fromAddress: string;
}

/** Status of a payment request for a specific payer */
export type PaymentRequestStatus = 'pending' | 'paid' | 'declined' | 'expired';

/** Payment status for a single requested address */
export interface PayerStatus {
  address: string;
  status: PaymentRequestStatus;
  txHash?: string;
  paidAt?: number;
}

/**
 * Codec for encoding/decoding payment requests in XMTP messages
 */
export class PaymentRequestCodec implements ContentCodec<PaymentRequest> {
  get contentType() {
    return ContentTypePaymentRequest;
  }

  encode(content: PaymentRequest): EncodedContent {
    return {
      type: ContentTypePaymentRequest,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
    };
  }

  decode(encodedContent: EncodedContent): PaymentRequest {
    const text = new TextDecoder().decode(encodedContent.content);
    const parsed = JSON.parse(text) as PaymentRequest;

    // Validate required fields
    if (!parsed.requestId || !parsed.networkId || !parsed.metadata) {
      throw new Error('Invalid payment request: missing required fields');
    }

    if (!parsed.metadata.tokenSymbol || !parsed.metadata.amount || !parsed.metadata.toAddress) {
      throw new Error('Invalid payment request metadata: missing required fields');
    }

    return parsed;
  }

  fallback(content: PaymentRequest): string {
    const formattedAmount = formatTokenAmount(content.metadata.amount, content.metadata.decimals);
    const note = content.metadata.note ? ` - "${content.metadata.note}"` : '';
    const requestedCount = content.metadata.requestedAddresses?.length;
    const requestedText = requestedCount && requestedCount > 1
      ? ` from ${requestedCount} people`
      : '';

    return `Requested ${formattedAmount} ${content.metadata.tokenSymbol}${requestedText}${note}`;
  }

  // Payment requests should trigger push notifications
  shouldPush(): boolean {
    return true;
  }
}

/**
 * Generate a UUID v4 for request IDs
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a payment request object
 */
export function createPaymentRequest(params: {
  tokenSymbol: string;
  tokenAddress?: string;
  amount: string;
  decimals: number;
  toAddress: string;
  fromAddress: string;
  note?: string;
  requestedAddresses?: string[];
  networkId?: number;
}): PaymentRequest {
  return {
    requestId: generateRequestId(),
    networkId: params.networkId ?? 480, // Default to World Chain
    timestamp: Date.now(),
    fromAddress: params.fromAddress,
    metadata: {
      tokenSymbol: params.tokenSymbol,
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      decimals: params.decimals,
      toAddress: params.toAddress,
      note: params.note,
      requestedAddresses: params.requestedAddresses,
    },
  };
}

/**
 * Check if message content is a payment request
 */
export function isPaymentRequest(content: unknown): content is PaymentRequest {
  if (!content || typeof content !== 'object') {
    return false;
  }
  const req = content as Record<string, unknown>;
  const metadata = req.metadata as Record<string, unknown> | undefined;
  const amountType = typeof metadata?.amount;

  return (
    typeof req.requestId === 'string' &&
    typeof req.networkId === 'number' &&
    req.metadata !== null &&
    req.metadata !== undefined &&
    typeof req.metadata === 'object' &&
    typeof metadata?.tokenSymbol === 'string' &&
    // World App sends amount as number, we accept both string and number
    (amountType === 'string' || amountType === 'number') &&
    typeof metadata?.toAddress === 'string'
  );
}

/**
 * Check if the current user is one of the requested payers
 */
export function isRequestedToPay(request: PaymentRequest, userAddress: string): boolean {
  if (!request.metadata.requestedAddresses?.length) {
    // If no specific addresses, everyone in the conversation is requested
    return true;
  }
  return request.metadata.requestedAddresses.some(
    (addr) => addr.toLowerCase() === userAddress.toLowerCase()
  );
}

/**
 * Format payment request for display
 */
export function formatPaymentRequest(request: PaymentRequest): {
  amount: string;
  token: string;
  note?: string;
  requestedCount?: number;
} {
  return {
    amount: formatTokenAmount(request.metadata.amount, request.metadata.decimals),
    token: request.metadata.tokenSymbol,
    note: request.metadata.note,
    requestedCount: request.metadata.requestedAddresses?.length,
  };
}
