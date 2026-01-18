import type { NextConfig } from "next";

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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
