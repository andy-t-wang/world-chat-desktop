import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import {
  JotaiProvider,
  PrivyAuthProvider,
  ThemeProvider,
  themeScript,
} from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "World Chat",
  description: "End-to-end encrypted messaging",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <JotaiProvider>
          <PrivyAuthProvider appId={privyAppId}>
            <ThemeProvider>{children}</ThemeProvider>
          </PrivyAuthProvider>
        </JotaiProvider>
      </body>
    </html>
  );
}
