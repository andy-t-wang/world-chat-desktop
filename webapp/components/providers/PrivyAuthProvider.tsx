"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";

interface PrivyAuthProviderProps {
  appId?: string | null;
  children: ReactNode;
}

export function PrivyAuthProvider({
  appId,
  children,
}: PrivyAuthProviderProps) {
  if (!appId) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "all-users",
          },
        },
        appearance: {
          theme: "light",
          accentColor: "#005CFF",
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
