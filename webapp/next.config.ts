import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  `connect-src 'self' https: wss:${isDev ? " http: ws:" : ""}`,
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' https:",
].join("; ");

const nextConfig: NextConfig = {
  // Allow ngrok domain for dev mode HMR (prevents reload issues when /sign page loads via ngrok)
  allowedDevOrigins: [
    '*.ngrok-free.app',
    '*.ngrok.io',
  ],

  // Disable Fast Refresh to debug reload issues
  reactStrictMode: false,
  devIndicators: false,

  // Required for XMTP browser SDK - exclude WASM packages from server bundling
  serverExternalPackages: [
    "@xmtp/wasm-bindings",
    "@xmtp/browser-sdk",
  ],

  // Webpack configuration for WASM
  webpack: (config, { isServer }) => {
    // Enable async WebAssembly experiments
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (isServer) {
      // Server-side WASM path
      config.output = {
        ...config.output,
        webassemblyModuleFilename: './../static/wasm/[modulehash].wasm',
      };
    } else {
      // Client-side WASM path
      config.output = {
        ...config.output,
        webassemblyModuleFilename: 'static/wasm/[modulehash].wasm',
      };
    }

    // Resolve fallbacks for Node.js modules
    config.resolve = {
      ...config.resolve,
      fallback: {
        ...config.resolve?.fallback,
        fs: false,
        path: false,
        crypto: false,
      },
    };

    return config;
  },

  // Required headers for XMTP SDK (SharedArrayBuffer support)
  // Note: COOP/COEP disabled for Privy compatibility - XMTP works without SharedArrayBuffer (slower but functional)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
          // COOP/COEP commented out for Privy embedded wallet compatibility
          // XMTP will fall back to non-SharedArrayBuffer mode
          // {
          //   key: 'Cross-Origin-Opener-Policy',
          //   value: 'same-origin-allow-popups',
          // },
          // {
          //   key: 'Cross-Origin-Embedder-Policy',
          //   value: 'credentialless',
          // },
        ],
      },
    ];
  },
};

export default nextConfig;
