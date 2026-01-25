"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { IdentifierKind, type Signer } from "@xmtp/browser-sdk";
import { toBytes } from "viem";
import { Mail } from "lucide-react";

interface EmailLoginProps {
  onInitialize: (signer: Signer) => Promise<void>;
  onLoginStart?: () => void;
  label?: string;
  buttonClassName?: string;
  showIcon?: boolean;
}

type EmailLoginStatus = "idle" | "authenticating" | "initializing" | "error";

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "TAB_LOCKED") {
    return "Chat is open in another tab.";
  }
  return message || "Email sign-in failed.";
}

function createPrivySigner(
  address: string,
  signMessageFn: (message: string) => Promise<string>,
): Signer {
  return {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string): Promise<Uint8Array> => {
      console.log("[EmailLogin] signMessage called with:", {
        message,
        length: message?.length,
      });
      if (!message || message.length === 0) {
        throw new Error("Cannot sign empty message");
      }
      const signature = await signMessageFn(message);
      console.log(
        "[EmailLogin] Got signature:",
        signature?.slice(0, 20) + "...",
      );
      return toBytes(signature);
    },
  };
}

export function EmailLogin({
  onInitialize,
  onLoginStart,
  label = "Continue with email",
  buttonClassName,
  showIcon = true,
}: EmailLoginProps) {
  const router = useRouter();
  const { login, authenticated, ready, signMessage, createWallet, user } =
    usePrivy();
  const { wallets } = useWallets();
  const [status, setStatus] = useState<EmailLoginStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loginRequested, setLoginRequested] = useState(false);
  const initializingRef = useRef(false);
  const walletCreationAttempted = useRef(false);

  // Find the embedded wallet from the wallets list
  const embeddedWallet = wallets.find(
    (wallet) => wallet.walletClientType === "privy",
  );

  const handleLogin = async () => {
    if (!ready) return;

    onLoginStart?.();
    setError(null);
    setLoginRequested(true);
    walletCreationAttempted.current = false;

    if (authenticated) {
      // Already authenticated, the useEffect will handle initialization
      return;
    }

    setStatus("authenticating");

    try {
      await login();
    } catch (err) {
      setError(formatError(err));
      setStatus("error");
      setLoginRequested(false);
    }
  };

  const initializeXmtp = useCallback(async () => {
    if (!embeddedWallet || initializingRef.current) return;

    console.log("[EmailLogin] Embedded wallet ready:", embeddedWallet.address);
    initializingRef.current = true;
    setStatus("initializing");

    try {
      const signer = createPrivySigner(
        embeddedWallet.address,
        async (message: string) => {
          console.log(
            "[EmailLogin] Signing message via Privy:",
            message?.slice(0, 50),
          );
          // Pass everything in a single config object
          const result = await signMessage(
            {
              message,
            },
            {
              uiOptions: {
                title: "Enable end-to-end encryption",
                description:
                  "This creates your private encryption keys. Only you can read your messages.",
                buttonText: "Sign",
              },
            },
          );
          console.log(
            "[EmailLogin] Got signature:",
            result.signature?.slice(0, 20),
          );
          return result.signature;
        },
      );
      console.log("[EmailLogin] Signer created, calling onInitialize...");
      await onInitialize(signer);
      console.log("[EmailLogin] XMTP initialized, navigating to chat...");
      router.push("/chat");
    } catch (err) {
      console.error("[EmailLogin] Initialization failed:", err);
      setError(formatError(err));
      setStatus("error");
      setLoginRequested(false);
    } finally {
      initializingRef.current = false;
    }
  }, [embeddedWallet, onInitialize, router, signMessage]);

  useEffect(() => {
    if (!loginRequested || !ready || !authenticated) {
      return;
    }

    if (!embeddedWallet) {
      // No embedded wallet yet - try to create one explicitly
      console.log(
        "[EmailLogin] Authenticated but no embedded wallet, attempting to create...",
        {
          ready,
          authenticated,
          walletsCount: wallets.length,
          walletTypes: wallets.map((w) => w.walletClientType),
          hasCreateWallet: !!createWallet,
          user: user,
        },
      );

      // Try to create wallet if we haven't attempted yet
      if (!walletCreationAttempted.current && createWallet) {
        walletCreationAttempted.current = true;
        console.log("[EmailLogin] Calling createWallet()...");
        createWallet()
          .then((wallet) => {
            console.log("[EmailLogin] Wallet created:", wallet);
          })
          .catch((err) => {
            console.error("[EmailLogin] Failed to create wallet:", err);
            setError(
              "Failed to create wallet: " +
                (err instanceof Error ? err.message : String(err)),
            );
            setStatus("error");
            setLoginRequested(false);
          });
      }
      return;
    }

    initializeXmtp();
  }, [
    authenticated,
    loginRequested,
    ready,
    embeddedWallet,
    wallets,
    initializeXmtp,
    createWallet,
    user,
  ]);

  const isBusy = status === "authenticating" || status === "initializing";
  const statusMessage =
    status === "authenticating"
      ? "Check your email to continue"
      : status === "initializing"
        ? "Setting up secure messaging..."
        : error;
  const buttonClasses =
    buttonClassName ||
    "flex items-center gap-2 px-5 py-2.5 text-[15px] font-medium text-[var(--text-primary)] border border-[var(--border-default)] rounded-full hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50";

  // When busy, show status message instead of button
  if (isBusy) {
    return (
      <p className="text-[14px] text-[var(--text-tertiary)]">{statusMessage}</p>
    );
  }

  // Show error state
  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-[14px] text-[#FF3B30]">
          {error || "Email sign-in failed."}
        </p>
        <button type="button" onClick={handleLogin} className={buttonClasses}>
          Try again
        </button>
      </div>
    );
  }

  // Default: show login button
  return (
    <button
      type="button"
      onClick={handleLogin}
      disabled={!ready}
      className={buttonClasses}
    >
      {showIcon ? <Mail className="w-4 h-4" /> : null}
      {label}
    </button>
  );
}
