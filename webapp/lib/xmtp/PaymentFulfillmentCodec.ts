/**
 * PaymentFulfillmentCodec - XMTP Content Type for Payment Fulfillments
 *
 * This codec handles payment fulfillment messages that confirm a payment
 * was made in response to a PaymentRequest.
 */

import type { ContentCodec, EncodedContent, ContentTypeId } from '@xmtp/content-type-primitives';
import { formatTokenAmount } from './TransactionReferenceCodec';

// Content type identifier
export const ContentTypePaymentFulfillment: ContentTypeId = {
  authorityId: 'toolsforhumanity.com',
  typeId: 'paymentFulfillment',
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

/** Payment fulfillment metadata */
export interface PaymentFulfillmentMetadata {
  /** Token symbol (e.g., "USDC", "WLD", "ETH") */
  tokenSymbol: string;
  /** Contract address of the token (undefined for native ETH) */
  tokenAddress?: string;
  /** Amount in the token's smallest unit - as string to preserve precision */
  amount: string;
  /** Number of decimal places for the token */
  decimals: number;
  /** Address that sent the payment */
  fromAddress: string;
  /** Address that received the payment */
  toAddress: string;
}

/** Payment fulfillment content stored in XMTP message */
export interface PaymentFulfillment {
  /** UUID of the original payment request being fulfilled */
  requestId: string;
  /** Transaction hash of the on-chain payment */
  reference: string;
  /** Chain ID (480 for World Chain mainnet) */
  networkId: number;
  /** Payment details */
  metadata: PaymentFulfillmentMetadata;
}

/**
 * Codec for encoding/decoding payment fulfillments in XMTP messages
 */
export class PaymentFulfillmentCodec implements ContentCodec<PaymentFulfillment> {
  get contentType() {
    return ContentTypePaymentFulfillment;
  }

  encode(content: PaymentFulfillment): EncodedContent {
    return {
      type: ContentTypePaymentFulfillment,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
    };
  }

  decode(encodedContent: EncodedContent): PaymentFulfillment {
    const text = new TextDecoder().decode(encodedContent.content);
    const parsed = JSON.parse(text) as PaymentFulfillment;

    // Validate required fields
    if (!parsed.requestId || !parsed.reference || !parsed.networkId || !parsed.metadata) {
      throw new Error('Invalid payment fulfillment: missing required fields');
    }

    if (!parsed.metadata.tokenSymbol || !parsed.metadata.amount) {
      throw new Error('Invalid payment fulfillment metadata: missing required fields');
    }

    return parsed;
  }

  fallback(content: PaymentFulfillment): string {
    const formattedAmount = formatTokenAmount(content.metadata.amount, content.metadata.decimals);
    return `Paid ${formattedAmount} ${content.metadata.tokenSymbol}`;
  }

  // Payment fulfillments should trigger push notifications
  shouldPush(): boolean {
    return true;
  }
}

/**
 * Check if message content is a payment fulfillment
 */
export function isPaymentFulfillment(content: unknown): content is PaymentFulfillment {
  if (!content || typeof content !== 'object') return false;
  const fulfillment = content as Record<string, unknown>;

  return (
    typeof fulfillment.requestId === 'string' &&
    typeof fulfillment.reference === 'string' &&
    typeof fulfillment.networkId === 'number' &&
    fulfillment.metadata !== null &&
    fulfillment.metadata !== undefined &&
    typeof fulfillment.metadata === 'object' &&
    typeof (fulfillment.metadata as Record<string, unknown>).tokenSymbol === 'string' &&
    typeof (fulfillment.metadata as Record<string, unknown>).amount === 'string'
  );
}

/**
 * Create a payment fulfillment object
 */
export function createPaymentFulfillment(params: {
  requestId: string;
  reference: string;
  tokenSymbol: string;
  tokenAddress?: string;
  amount: string;
  decimals: number;
  fromAddress: string;
  toAddress: string;
  networkId?: number;
}): PaymentFulfillment {
  return {
    requestId: params.requestId,
    reference: params.reference,
    networkId: params.networkId ?? 480, // Default to World Chain
    metadata: {
      tokenSymbol: params.tokenSymbol,
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      decimals: params.decimals,
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
    },
  };
}

/**
 * Format payment fulfillment for display
 */
export function formatPaymentFulfillment(fulfillment: PaymentFulfillment): {
  amount: string;
  token: string;
  txHash: string;
} {
  return {
    amount: formatTokenAmount(fulfillment.metadata.amount, fulfillment.metadata.decimals),
    token: fulfillment.metadata.tokenSymbol,
    txHash: fulfillment.reference,
  };
}
