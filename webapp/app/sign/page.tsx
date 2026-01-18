'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Check, Smartphone, X, Shield, KeyRound } from 'lucide-react';
import { MiniKit } from '@worldcoin/minikit-js';
import { MobileSigner } from '@/lib/signing-relay';

type SignState =
  | 'initializing'
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'signing'
  | 'success'
  | 'error';

function SignPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  const [state, setState] = useState<SignState>('initializing');
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [signCount, setSignCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const signerRef = useRef<MobileSigner | null>(null);

  // Sign message using MiniKit
  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!MiniKit.isInstalled()) {
      throw new Error('Please open this page in World App');
    }

    const { finalPayload } = await MiniKit.commandsAsync.signMessage({
      message,
    });

    if (finalPayload.status !== 'success') {
      throw new Error('User rejected signing');
    }

    // Get wallet address from the signature response
    if (finalPayload.address && !walletAddress) {
      setWalletAddress(finalPayload.address);
    }

    return finalPayload.signature;
  }, [walletAddress]);

  // Initialize MiniKit and connect
  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      setState('error');
      return;
    }

    // Install MiniKit
    MiniKit.install();

    // Wait a moment for MiniKit to initialize
    const initTimer = setTimeout(async () => {
      if (!MiniKit.isInstalled()) {
        setError('Please open this link in World App');
        setState('error');
        return;
      }

      // Get wallet address first using wallet auth
      setState('authenticating');
      try {
        const nonce = crypto.randomUUID();
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
          nonce,
          statement: 'Sign in to World Chat',
          expirationTime: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
        });

        if (finalPayload.status !== 'success' || !finalPayload.address) {
          setError('Wallet authentication cancelled');
          setState('error');
          return;
        }

        const address = finalPayload.address;

        setWalletAddress(address);
        connectToSession(address);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Wallet auth failed');
        setState('error');
      }
    }, 500);

    async function connectToSession(address: string) {
      setState('connecting');

      try {
        const mobileSigner = new MobileSigner(
          sessionId!,
          address,
          async (message) => {
            setCurrentMessage(message);
            const signature = await signMessage(message);
            setSignCount((c) => c + 1);
            setCurrentMessage(null);
            return signature;
          },
          {
            onConnected: () => {
              setState('authenticating');
            },
            onAuthChallenge: (challenge) => {
              setCurrentMessage(challenge);
              setState('authenticating');
            },
            onAuthenticated: () => {
              setState('ready');
              setCurrentMessage(null);
            },
            onAuthFailed: (err) => {
              setError(`Authentication failed: ${err}`);
              setState('error');
            },
            onSignRequest: (message) => {
              setCurrentMessage(message);
              setState('signing');
            },
            onSessionComplete: () => {
              setState('success');
            },
            onError: (err) => {
              setError(err.message);
              setState('error');
            },
          }
        );

        signerRef.current = mobileSigner;
        await mobileSigner.connect();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setState('error');
      }
    }

    return () => {
      clearTimeout(initTimer);
      signerRef.current?.cleanup();
    };
  }, [sessionId, signMessage]);

  // No session ID
  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-4">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
          <X className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-[#181818] mb-2">Invalid Link</h1>
          <p className="text-sm text-[#717680]">
            This link is missing the session ID. Please scan the QR code again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-[#005CFF]/10 flex items-center justify-center">
            <Shield className="w-6 h-6 text-[#005CFF]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#181818]">
              Web Login
            </h1>
            <p className="text-sm text-[#717680]">
              World Chat
            </p>
          </div>
        </div>

        {/* Status */}
        <div className="bg-[#F5F5F5] rounded-xl p-6 mb-6">
          {state === 'initializing' && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-[#005CFF] animate-spin" />
              <p className="text-sm text-[#717680]">Initializing...</p>
            </div>
          )}

          {state === 'connecting' && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-[#005CFF] animate-spin" />
              <p className="text-sm text-[#717680]">Connecting to web client...</p>
            </div>
          )}

          {state === 'authenticating' && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-[#005CFF]/10 flex items-center justify-center">
                <KeyRound className="w-8 h-8 text-[#005CFF]" />
              </div>
              <p className="text-sm text-[#717680] text-center">
                Verifying your wallet...
                <br />
                Approve the signature to continue.
              </p>
            </div>
          )}

          {state === 'ready' && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <p className="text-sm text-[#717680] text-center">
                Connected! Keep this page open.
                <br />
                Approve signing requests as they appear.
              </p>
              {walletAddress && (
                <p className="text-xs text-[#9BA3AE] font-mono">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </p>
              )}
              {signCount > 0 && (
                <p className="text-xs text-[#9BA3AE]">
                  Signed {signCount} message{signCount !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {state === 'signing' && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-[#005CFF] animate-spin" />
              <p className="text-sm text-[#717680] text-center">
                Approve the signature request...
              </p>
              {currentMessage && (
                <div className="w-full mt-2 p-3 bg-white rounded-lg">
                  <p className="text-xs text-[#9BA3AE] mb-1">Message to sign:</p>
                  <p className="text-xs text-[#181818] font-mono break-all line-clamp-3">
                    {currentMessage.slice(0, 100)}...
                  </p>
                </div>
              )}
            </div>
          )}

          {state === 'success' && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <p className="text-sm text-[#717680] text-center">
                Login complete!
                <br />
                You can close this page.
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <X className="w-8 h-8 text-red-600" />
              </div>
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex items-start gap-2 text-xs text-[#9BA3AE]">
          <Smartphone className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            This page securely connects your World App wallet to the web client.
            All messages are verified before signing.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
          <Loader2 className="w-8 h-8 text-[#005CFF] animate-spin" />
        </div>
      }
    >
      <SignPageContent />
    </Suspense>
  );
}
