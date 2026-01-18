'use client';

import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, Smartphone, X, RefreshCw, KeyRound } from 'lucide-react';
import Image from 'next/image';
import { RemoteSigner, generateSessionId } from '@/lib/signing-relay';

// Your mini app ID from the World Developer Portal
const MINI_APP_ID = process.env.NEXT_PUBLIC_WORLD_MINI_APP_ID || 'app_your_app_id';

type LoginState =
  | 'generating'
  | 'waiting_for_scan'
  | 'mobile_connected'
  | 'authenticating'
  | 'signing'
  | 'success'
  | 'error';

interface QRLoginProps {
  onSuccess: (signer: ReturnType<RemoteSigner['getSigner']>) => void;
  onCancel?: () => void;
}

export function QRLogin({ onSuccess, onCancel }: QRLoginProps) {
  const [state, setState] = useState<LoginState>('generating');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [remoteSigner, setRemoteSigner] = useState<RemoteSigner | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate QR code URL for the mini app
  const qrUrl = sessionId
    ? `https://worldcoin.org/mini-app?app_id=${MINI_APP_ID}&path=${encodeURIComponent(`/sign?session=${sessionId}`)}`
    : null;

  const startSession = useCallback(async () => {
    setState('generating');
    setError(null);
    setConnectedAddress(null);

    try {
      const newSessionId = generateSessionId();
      setSessionId(newSessionId);

      const signer = new RemoteSigner(newSessionId, {
        onMobileConnected: (address) => {
          setConnectedAddress(address);
          setState('mobile_connected');
        },
        onAuthenticating: () => {
          setState('authenticating');
        },
        onAuthenticated: (address) => {
          setConnectedAddress(address);
          // Don't setState here - connect() resolves and we set success
        },
        onSigningRequest: () => {
          setState('signing');
        },
        onSigningComplete: () => {
          setState('success');
        },
        onError: (err) => {
          setError(err.message);
          setState('error');
        },
      });

      setRemoteSigner(signer);
      setState('waiting_for_scan');

      // Wait for mobile to connect and authenticate
      await signer.connect();

      // Mobile authenticated, provide signer to parent
      setState('success');
      onSuccess(signer.getSigner());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setState('error');
    }
  }, [onSuccess]);

  // Start session on mount
  useEffect(() => {
    startSession();

    return () => {
      remoteSigner?.cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    remoteSigner?.cleanup();
    startSession();
  };

  const handleCancel = () => {
    remoteSigner?.cleanup();
    onCancel?.();
  };

  return (
    <div className="flex flex-col items-center">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Smartphone className="w-6 h-6 text-[#005CFF]" />
        <h2 className="text-lg font-semibold text-[#181818]">
          Login with World App
        </h2>
      </div>

      {/* QR Code or Status */}
      <div className="w-64 h-64 flex items-center justify-center mb-6 bg-[#F5F5F5] rounded-xl">
        {state === 'generating' && (
          <Loader2 className="w-8 h-8 text-[#717680] animate-spin" />
        )}

        {state === 'waiting_for_scan' && qrUrl && (
          <QRCodeSVG
            value={qrUrl}
            size={240}
            level="M"
            includeMargin
            className="rounded-lg"
          />
        )}

        {state === 'mobile_connected' && (
          <div className="flex flex-col items-center gap-3">
            <Image
              src="/human-badge.svg"
              alt="Verified Human"
              width={64}
              height={64}
            />
            <p className="text-sm text-[#717680]">Mobile connected!</p>
          </div>
        )}

        {state === 'authenticating' && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-[#005CFF]/10 flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-[#005CFF]" />
            </div>
            <p className="text-sm text-[#717680] text-center">
              Verifying wallet...
              <br />
              <span className="text-xs text-[#9BA3AE]">Approve in World App</span>
            </p>
          </div>
        )}

        {state === 'signing' && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-[#005CFF] animate-spin" />
            <p className="text-sm text-[#717680]">Approve in World App...</p>
          </div>
        )}

        {state === 'success' && (
          <div className="flex flex-col items-center gap-3">
            <Image
              src="/human-badge.svg"
              alt="Verified Human"
              width={64}
              height={64}
            />
            <p className="text-sm text-[#717680]">Logged in!</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
              <X className="w-8 h-8 text-red-600" />
            </div>
            <p className="text-sm text-red-600 text-center px-4">{error}</p>
          </div>
        )}
      </div>

      {/* Address */}
      {connectedAddress && state !== 'error' && (
        <p className="text-xs text-[#9BA3AE] mb-4 font-mono">
          {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
        </p>
      )}

      {/* Instructions */}
      {state === 'waiting_for_scan' && (
        <p className="text-sm text-[#717680] text-center mb-4">
          Scan this QR code with World App to login
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 w-full">
        {state === 'error' && (
          <button
            onClick={handleRetry}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#005CFF] text-white rounded-lg hover:bg-[#0052E0] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        )}

        {onCancel && state !== 'success' && (
          <button
            onClick={handleCancel}
            className="flex-1 px-4 py-2 text-[#717680] border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
