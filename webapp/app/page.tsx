"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useQRXmtpClient } from "@/hooks/useQRXmtpClient";
import { RemoteSigner, generateSessionId } from "@/lib/signing-relay";
import { RefreshCw, Check } from "lucide-react";
import { InstallationManager } from "@/components/auth/InstallationManager";
import { getSessionCache } from "@/lib/storage";

// Pre-compile /sign route in dev mode to prevent HMR reload issues
// when mini app loads the page via ngrok
if (typeof window !== "undefined") {
  fetch("/sign?precompile=1", { method: "HEAD" }).catch(() => {});
}

const MINI_APP_ID =
  process.env.NEXT_PUBLIC_WORLD_MINI_APP_ID || "app_your_app_id";

type LoginState =
  | "initializing"
  | "waiting_for_scan"
  | "mobile_connected"
  | "authenticating"
  | "initializing_xmtp"
  | "signing"
  | "success"
  | "error"
  | "installation_limit";

// Subtle pulsing loader - Apple style
function PulseLoader() {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-2 h-2 rounded-full bg-[var(--text-quaternary)]"
          style={{
            animation: "pulse-fade 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>("initializing");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false); // Only true once we know we need QR login
  const [showStagingWarning, setShowStagingWarning] = useState(false);
  const [cachedInboxId, setCachedInboxId] = useState<string | null>(null);
  const signerRef = useRef<RemoteSigner | null>(null);
  const { initializeWithRemoteSigner, restoreSession } = useQRXmtpClient();

  const qrUrl = sessionId
    ? `https://worldcoin.org/mini-app?app_id=${MINI_APP_ID}&path=${encodeURIComponent(
        `/sign?session=${sessionId}`
      )}`
    : null;

  const startSession = async (isInitial = false) => {
    signerRef.current?.cleanup();

    setError(null);
    setConnectedAddress(null);

    try {
      const newSessionId = generateSessionId();
      setSessionId(newSessionId);

      const signer = new RemoteSigner(newSessionId, {
        onMobileConnected: (address) => {
          setConnectedAddress(address);
          setState("mobile_connected");
        },
        onAuthenticating: () => {
          setState("authenticating");
        },
        onAuthenticated: (address) => {
          setConnectedAddress(address);
        },
        onSigningRequest: () => {
          setState("signing");
        },
        onSigningComplete: () => {},
        onError: (err) => {
          setError(err.message);
          setState("error");
        },
      });

      signerRef.current = signer;
      setState("waiting_for_scan");

      // Only set ready (trigger animations) on initial load, not retries
      if (isInitial) {
        setIsReady(true);
      }

      await signer.connect();
      setState("initializing_xmtp");

      try {
        await initializeWithRemoteSigner(signer.getSigner());
        // Notify mobile that login is complete
        await signer.complete();
        setState("success");
        setTimeout(() => {
          router.push("/chat");
        }, 500);
      } catch (xmtpError) {
        console.error("XMTP initialization failed:", xmtpError);
        const errorMessage = xmtpError instanceof Error ? xmtpError.message : String(xmtpError);

        // Check for installation limit error
        if (errorMessage.toLowerCase().includes("installation") &&
            (errorMessage.includes("10/10") || errorMessage.toLowerCase().includes("revoke"))) {
          // Try to extract inboxId from error message first
          // Error format: "...InboxID <hex_id> has already registered..."
          const inboxIdMatch = errorMessage.match(/InboxID\s+([a-f0-9]{64})/i);
          let inboxId = inboxIdMatch?.[1];

          // Fall back to session cache if not found in error
          if (!inboxId) {
            const session = await getSessionCache();
            inboxId = session?.inboxId;
          }

          if (inboxId) {
            setCachedInboxId(inboxId);
            setState("installation_limit");
            return;
          }
        }

        setError(errorMessage);
        setState("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setState("error");
    }
  };

  const handleRetry = () => {
    signerRef.current?.cleanup();
    startSession();
  };

  const handleInstallationRevokeComplete = () => {
    // After revoking, restart the full QR login flow
    // The signing session may have expired, so we need a fresh connection
    setCachedInboxId(null);
    signerRef.current?.cleanup();
    startSession();
  };

  const handleInstallationCancel = () => {
    setCachedInboxId(null);
    setError("Installation limit reached. Please try again.");
    setState("error");
  };

  useEffect(() => {
    // Try to restore existing session first
    restoreSession()
      .then((restored) => {
        if (restored) {
          // Session restored, redirect to chat
          router.push("/chat");
        } else {
          // No session, start QR flow
          startSession(true);
        }
      })
      .catch((error) => {
        // Check if another tab has the session
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (errorMessage === "TAB_LOCKED") {
          // Redirect to chat page which will show the "open in another tab" message
          router.push("/chat");
        } else {
          // Other error, start QR flow
          startSession(true);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show staging app warning after 10 seconds of waiting for scan
  useEffect(() => {
    if (state !== "waiting_for_scan") {
      setShowStagingWarning(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowStagingWarning(true);
    }, 10000);

    return () => clearTimeout(timer);
  }, [state]);

  const getStatusText = () => {
    switch (state) {
      case "initializing":
        return ""; // Don't show text while checking session
      case "waiting_for_scan":
        return "Scan with your Phone Camera";
      case "mobile_connected":
        return "Connected";
      case "authenticating":
        return "Approve in World App";
      case "signing":
        return "Approve in World App";
      case "initializing_xmtp":
        return "Setting up...";
      case "success":
        return "Welcome";
      case "error":
        return error || "Something went wrong";
      case "installation_limit":
        return ""; // InstallationManager has its own UI
      default:
        return "";
    }
  };

  const isLoading = [
    "initializing",
    "mobile_connected",
    "authenticating",
    "signing",
    "initializing_xmtp",
  ].includes(state);

  const showQR = state === "waiting_for_scan" && qrUrl;
  const showInstallationManager = state === "installation_limit" && cachedInboxId;

  // Show minimal loading while checking session
  if (!isReady) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-6">
        <PulseLoader />
      </div>
    );
  }

  return (
    <>
      {/* Keyframe animations */}
      <style jsx global>{`
        @keyframes pulse-fade {
          0%,
          100% {
            opacity: 0.4;
            transform: scale(0.95);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
        .animate-scale-in {
          animation: scale-in 0.3s ease-out forwards;
        }
        .stagger-1 {
          animation-delay: 0.1s;
          opacity: 0;
        }
        .stagger-2 {
          animation-delay: 0.2s;
          opacity: 0;
        }
        .stagger-3 {
          animation-delay: 0.3s;
          opacity: 0;
        }
      `}</style>

      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-6">
        {showInstallationManager ? (
          <InstallationManager
            inboxId={cachedInboxId}
            onRevokeComplete={handleInstallationRevokeComplete}
            onCancel={handleInstallationCancel}
            getSigner={() => signerRef.current!.getSigner()}
          />
        ) : (
        <div className="w-full max-w-sm flex flex-col items-center">
          {/* Title */}
          <h1 className="text-[32px] font-semibold text-[var(--text-primary)] tracking-[-0.02em] mb-2 animate-fade-in">
            World Chat
          </h1>

          {/* Subtitle */}
          <p className="text-[15px] text-[var(--text-quaternary)] mb-10 animate-fade-in stagger-1">
            Scan to sign in
          </p>

          {/* QR Code Card */}
          <div className="relative mb-8 animate-fade-in stagger-2">
            <div className="relative w-[280px] h-[280px] rounded-2xl flex items-center justify-center bg-[var(--bg-tertiary)]">
              {showQR ? (
                <div className="relative animate-scale-in p-5 bg-white rounded-xl">
                  <QRCodeSVG
                    value={qrUrl}
                    size={200}
                    level="M"
                    includeMargin={false}
                    bgColor="white"
                    fgColor="#1D1D1F"
                  />
                </div>
              ) : state === "error" ? (
                <div className="animate-scale-in w-16 h-16 rounded-full bg-[#FF3B30]/10 flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-[#FF3B30]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
              ) : state === "success" ? (
                <div className="animate-scale-in w-16 h-16 rounded-full bg-[#34C759]/10 flex items-center justify-center">
                  <Check className="w-7 h-7 text-[#34C759]" strokeWidth={2.5} />
                </div>
              ) : (
                <PulseLoader />
              )}
            </div>
          </div>

          {/* Status */}
          {state !== "waiting_for_scan" && (
            <p
              className={`text-[15px] font-medium mb-3 transition-all duration-200 animate-fade-in ${
                state === "error"
                  ? "text-[#FF3B30]"
                  : state === "success"
                  ? "text-[#34C759]"
                  : "text-[var(--text-primary)]"
              }`}
            >
              {getStatusText()}
            </p>
          )}

          {/* Address */}
          {connectedAddress && state !== "error" && (
            <p className="text-[13px] text-[var(--text-quaternary)] font-mono mb-4 animate-fade-in">
              {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
            </p>
          )}

          {/* Retry */}
          {state === "error" && (
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 px-5 py-2.5 text-[15px] font-medium text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/5 active:bg-[var(--accent-blue)]/10 rounded-full transition-all duration-200"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          )}

          {/* Loading hint */}
          {isLoading && state !== "initializing" && (
            <p className="text-[13px] text-[var(--text-quaternary)] animate-fade-in">
              Keep World App open
            </p>
          )}

          {/* Staging app warning - shown after 10 seconds */}
          {showStagingWarning && state === "waiting_for_scan" && (
            <p className="text-[12px] text-[#FF9500] text-center max-w-[280px] animate-fade-in mt-2">
              If you have the staging World App installed, the deep link will
              not work. Make sure to delete it.
            </p>
          )}

          {/* Footer */}
          <div className="mt-10 flex flex-col items-center gap-4 animate-fade-in stagger-3">
            {/* Trust signals */}
            <p className="text-[13px] text-[var(--text-quaternary)]">
              End-to-end encrypted · Secured by XMTP · World ID verified
            </p>

            <div className="flex items-center gap-4">
              <a
                href="https://world.org/download"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-[var(--accent-blue)] hover:underline"
              >
                Get World App
              </a>
              <span className="text-[var(--text-tertiary)]">·</span>
              <a
                href="/download"
                className="text-[13px] text-[var(--accent-blue)] hover:underline"
              >
                Download for Mac
              </a>
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  );
}
