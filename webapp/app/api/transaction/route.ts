import { NextRequest, NextResponse } from 'next/server';
import type { TransactionStatus } from '@/lib/xmtp/TransactionReferenceCodec';
import { WORLD_CHAIN_ID } from '@/lib/xmtp/TransactionReferenceCodec';

// Alchemy API base URL for World Chain
const ALCHEMY_BASE_URL = `https://worldchain-mainnet.g.alchemy.com/v2`;

/**
 * ERC-4337 User Operation response from eth_getUserOperationByHash
 */
interface UserOperationResponse {
  userOperation: {
    sender: string;
    nonce: string;
    callData: string;
    // ... other fields
  };
  entryPoint: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
}

/**
 * ERC-4337 User Operation Receipt from eth_getUserOperationReceipt
 */
interface UserOperationReceipt {
  userOpHash: string;
  entryPoint: string;
  sender: string;
  nonce: string;
  paymaster: string;
  actualGasCost: string;
  actualGasUsed: string;
  success: boolean;
  logs: unknown[];
  receipt: {
    transactionHash: string;
    transactionIndex: string;
    blockHash: string;
    blockNumber: string;
    from: string;
    to: string;
    gasUsed: string;
    status: string;
  };
}

/**
 * Determine status from User Operation receipt
 */
function getUserOpStatus(
  userOp: UserOperationResponse | null,
  receipt: UserOperationReceipt | null
): TransactionStatus {
  // If we have a receipt, check success field
  if (receipt) {
    return receipt.success ? 'confirmed' : 'failed';
  }

  // If we have userOp with blockHash, it's been included
  if (userOp?.blockHash) {
    return 'confirmed';
  }

  // Otherwise still pending
  return 'pending';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get('txHash'); // This is actually userOpHash
  const chainId = searchParams.get('chainId');

  if (!txHash) {
    return NextResponse.json(
      { error: 'txHash parameter is required' },
      { status: 400 }
    );
  }

  // Validate chain ID (only support World Chain)
  const chain = chainId ? parseInt(chainId) : WORLD_CHAIN_ID;
  if (chain !== WORLD_CHAIN_ID) {
    return NextResponse.json(
      { error: 'Only World Chain (480) is supported' },
      { status: 400 }
    );
  }

  // Validate hash format
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return NextResponse.json(
      { error: 'Invalid hash format' },
      { status: 400 }
    );
  }

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Alchemy API key not configured' },
      { status: 500 }
    );
  }

  try {
    const alchemyUrl = `${ALCHEMY_BASE_URL}/${apiKey}`;

    // Try ERC-4337 User Operation APIs first (World Chain uses Account Abstraction)
    const [userOpResponse, userOpReceiptResponse] = await Promise.all([
      fetch(alchemyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getUserOperationByHash',
          params: [txHash],
        }),
      }),
      fetch(alchemyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getUserOperationReceipt',
          params: [txHash],
        }),
      }),
    ]);

    const [userOpData, userOpReceiptData] = await Promise.all([
      userOpResponse.json(),
      userOpReceiptResponse.json(),
    ]);

    const userOp: UserOperationResponse | null = userOpData.result;
    const userOpReceipt: UserOperationReceipt | null = userOpReceiptData.result;

    // Get status from User Operation data
    const status = getUserOpStatus(userOp, userOpReceipt);

    // If UserOp found, return the status
    if (userOp || userOpReceipt) {
      const blockNumber = userOpReceipt?.receipt?.blockNumber
        ? parseInt(userOpReceipt.receipt.blockNumber, 16)
        : userOp?.blockNumber
          ? parseInt(userOp.blockNumber, 16)
          : undefined;

      return NextResponse.json(
        {
          txHash,
          chainId: WORLD_CHAIN_ID,
          status,
          blockNumber,
          // Include actual transaction hash if available (different from userOpHash)
          actualTxHash: userOpReceipt?.receipt?.transactionHash || userOp?.transactionHash,
          gasUsed: userOpReceipt?.actualGasUsed,
        },
        {
          headers: {
            'Cache-Control':
              status === 'confirmed'
                ? 'public, max-age=86400, s-maxage=604800'
                : 'public, max-age=5, s-maxage=10',
          },
        }
      );
    }

    // UserOp not found in Bundler - try regular transaction lookup as fallback
    // This handles cases where:
    // 1. The hash is an actual transaction hash (not userOpHash)
    // 2. The userOp has been pruned from the Bundler index
    const txResponse = await fetch(alchemyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });

    const txData = await txResponse.json();
    const receipt = txData.result;

    if (receipt) {
      // Found as regular transaction
      const isConfirmed = receipt.status === '0x1';
      return NextResponse.json(
        {
          txHash,
          chainId: WORLD_CHAIN_ID,
          status: isConfirmed ? 'confirmed' : 'failed',
          blockNumber: receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : undefined,
          actualTxHash: txHash,
          gasUsed: receipt.gasUsed,
        },
        {
          headers: {
            'Cache-Control': isConfirmed
              ? 'public, max-age=86400, s-maxage=604800'
              : 'public, max-age=5, s-maxage=10',
          },
        }
      );
    }

    // Not found anywhere - return pending
    return NextResponse.json(
      {
        txHash,
        chainId: WORLD_CHAIN_ID,
        status: 'pending',
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=5, s-maxage=10',
        },
      }
    );
  } catch (error) {
    console.error('Transaction fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transaction' },
      { status: 502 }
    );
  }
}
