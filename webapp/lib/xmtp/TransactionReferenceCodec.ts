/**
 * TransactionReferenceCodec - XMTP Content Type for On-Chain Payment References
 *
 * This codec handles transaction references for on-chain payments on World Chain.
 * It stores the transaction hash and optional metadata, allowing the UI to fetch
 * full transaction details from the blockchain.
 */

import type { ContentCodec, EncodedContent, ContentTypeId } from '@xmtp/content-type-primitives';

// Content type identifier with sameAs method for XMTP compatibility
export const ContentTypeTransactionReference: ContentTypeId = {
  authorityId: 'world.chat',
  typeId: 'transactionReference',
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

/** Status of a transaction */
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

/** Type of payment message */
export type PaymentType = 'send' | 'receive' | 'request';

/** Token information */
export interface TokenInfo {
  symbol: string;
  decimals: number;
  address?: string; // Contract address for ERC20, undefined for native token
}

/** Transaction reference content stored in XMTP message */
export interface TransactionReference {
  /** The transaction hash on World Chain */
  txHash: string;
  /** Chain ID (480 for World Chain mainnet) */
  chainId: number;
  /** Amount in the token's smallest unit (wei for ETH, etc.) */
  amount: string;
  /** Token information */
  token: TokenInfo;
  /** Recipient address */
  to: string;
  /** Sender address */
  from: string;
  /** Optional description/memo */
  description?: string;
  /** Timestamp when the transaction was initiated */
  timestamp: number;
  /** Payment type */
  type: PaymentType;
}

/** Fetched transaction details from blockchain */
export interface TransactionDetails extends TransactionReference {
  /** Current status of the transaction */
  status: TransactionStatus;
  /** Block number if confirmed */
  blockNumber?: number;
  /** Gas used */
  gasUsed?: string;
  /** Effective gas price */
  gasPrice?: string;
  /** USD value at time of transaction (if available) */
  usdValue?: number;
  /** Actual transaction hash (for ERC-4337, different from userOpHash) */
  actualTxHash?: string;
}

/**
 * Codec for encoding/decoding transaction references in XMTP messages
 */
export class TransactionReferenceCodec implements ContentCodec<TransactionReference> {
  get contentType() {
    return ContentTypeTransactionReference;
  }

  encode(content: TransactionReference): EncodedContent {
    return {
      type: ContentTypeTransactionReference,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
    };
  }

  decode(encodedContent: EncodedContent): TransactionReference {
    const text = new TextDecoder().decode(encodedContent.content);
    const parsed = JSON.parse(text) as TransactionReference;

    // Validate required fields
    if (!parsed.txHash || !parsed.chainId || !parsed.amount || !parsed.token) {
      throw new Error('Invalid transaction reference: missing required fields');
    }

    return parsed;
  }

  fallback(content: TransactionReference): string {
    const formattedAmount = formatTokenAmount(content.amount, content.token.decimals);
    const direction = content.type === 'send' ? 'Sent' : content.type === 'receive' ? 'Received' : 'Requested';
    return `${direction} ${formattedAmount} ${content.token.symbol}${content.description ? `: ${content.description}` : ''}`;
  }

  // Payment messages should trigger push notifications
  shouldPush(): boolean {
    return true;
  }
}

/**
 * Format token amount from smallest unit to human readable
 * Accepts both string and number (World App sends numbers)
 */
export function formatTokenAmount(amount: string | number, decimals: number): string {
  // Convert number to string, handling large integers
  let amountStr: string;
  if (typeof amount === 'number') {
    // Use toLocaleString to avoid scientific notation for large numbers
    amountStr = amount.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  } else {
    amountStr = amount;
    // Handle scientific notation in amount string
    if (amount.includes('e') || amount.includes('E')) {
      const num = parseFloat(amount);
      if (Number.isFinite(num)) {
        amountStr = num.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
      } else {
        return '0';
      }
    }
  }

  try {
    const value = BigInt(amountStr);
    const divisor = BigInt(10 ** decimals);
    const integerPart = value / divisor;
    const fractionalPart = value % divisor;

    if (fractionalPart === 0n) {
      return integerPart.toString();
    }

    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    // Trim trailing zeros but keep at least 2 decimal places for USD
    const trimmed = fractionalStr.replace(/0+$/, '').slice(0, 2).padEnd(2, '0');
    return `${integerPart}.${trimmed}`;
  } catch (e) {
    console.error('[formatTokenAmount] Failed to parse amount:', amount, e);
    return '0';
  }
}

/**
 * Format token amount with full precision (for tooltips)
 */
export function formatFullTokenAmount(amount: string, decimals: number): string {
  // Handle scientific notation in amount string
  let amountStr = amount;
  if (amount.includes('e') || amount.includes('E')) {
    const num = parseFloat(amount);
    if (Number.isFinite(num)) {
      amountStr = num.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
    } else {
      return '0';
    }
  }

  try {
    const value = BigInt(amountStr);
    const divisor = BigInt(10 ** decimals);
    const integerPart = value / divisor;
    const fractionalPart = value % divisor;

    if (fractionalPart === 0n) {
      return integerPart.toString();
    }

    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    // Show all significant digits (trim only trailing zeros)
    const trimmed = fractionalStr.replace(/0+$/, '');
    return `${integerPart}.${trimmed}`;
  } catch (e) {
    return '0';
  }
}

/**
 * Format amount as USD display string
 */
export function formatUsdAmount(amount: string, decimals: number): string {
  const formatted = formatTokenAmount(amount, decimals);
  const num = parseFloat(formatted);
  return `$${num.toFixed(2)}`;
}

/**
 * XMTP's actual transaction reference format (from other clients like World App)
 */
export interface XMTPTransactionReference {
  networkId: string;
  reference: string; // txHash
  metadata: {
    transactionType: string;
    currency: string;
    amount: number;
    decimals: number;
    fromAddress: string;
    toAddress: string;
  };
}

/**
 * Check if a message content is a transaction reference (supports both formats)
 */
export function isTransactionReference(content: unknown): content is TransactionReference | XMTPTransactionReference {
  if (!content || typeof content !== 'object') return false;
  const ref = content as Record<string, unknown>;

  // Check for our custom format
  if (
    typeof ref.txHash === 'string' &&
    typeof ref.chainId === 'number' &&
    typeof ref.amount === 'string' &&
    typeof ref.token === 'object' &&
    ref.token !== null
  ) {
    return true;
  }

  // Check for XMTP standard format (from World App, etc.)
  if (
    typeof ref.networkId === 'string' &&
    typeof ref.reference === 'string' &&
    ref.metadata &&
    typeof ref.metadata === 'object'
  ) {
    return true;
  }

  return false;
}

/**
 * Check if content is XMTP standard format
 */
export function isXMTPTransactionFormat(content: unknown): content is XMTPTransactionReference {
  if (!content || typeof content !== 'object') return false;
  const ref = content as Record<string, unknown>;
  return (
    typeof ref.networkId === 'string' &&
    typeof ref.reference === 'string' &&
    ref.metadata !== null &&
    ref.metadata !== undefined &&
    typeof ref.metadata === 'object'
  );
}

/**
 * Convert a number (possibly in scientific notation) to a BigInt-safe string
 * Handles cases like 1.6213998842320482e+21
 */
function toBigIntString(value: number | string): string {
  if (typeof value === 'string') {
    // Already a string, but might still be in scientific notation
    if (!value.includes('e') && !value.includes('E')) {
      return value;
    }
    value = parseFloat(value);
  }

  // Handle scientific notation by using toLocaleString with no grouping
  // This converts 1.6213998842320482e+21 to "1621399884232048200000"
  if (Number.isFinite(value)) {
    // For very large numbers, use toLocaleString to avoid scientific notation
    // Note: This may lose precision for numbers > Number.MAX_SAFE_INTEGER
    // but that's inherent to JavaScript's number type
    return value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  }

  return '0';
}

/**
 * Convert XMTP format to our internal format
 */
export function normalizeTransactionReference(content: TransactionReference | XMTPTransactionReference): TransactionReference {
  if (isXMTPTransactionFormat(content)) {
    return {
      txHash: content.reference,
      chainId: parseInt(content.networkId, 10),
      amount: toBigIntString(content.metadata.amount),
      token: {
        symbol: content.metadata.currency,
        decimals: content.metadata.decimals,
      },
      from: content.metadata.fromAddress,
      to: content.metadata.toAddress,
      type: 'send', // Default, can be determined by context
      timestamp: Date.now(),
    };
  }
  return content as TransactionReference;
}

// World Chain mainnet chain ID
export const WORLD_CHAIN_ID = 480;

// Common tokens on World Chain
export const WORLD_CHAIN_TOKENS = {
  // Native token (ETH on World Chain)
  ETH: {
    symbol: 'ETH',
    decimals: 18,
    address: undefined,
  },
  // USDC on World Chain
  USDC: {
    symbol: 'USDC',
    decimals: 6,
    address: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', // World Chain USDC
  },
  // WLD token
  WLD: {
    symbol: 'WLD',
    decimals: 18,
    address: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', // World Chain WLD
  },
} as const;
