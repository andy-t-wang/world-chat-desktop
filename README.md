# World Chat Desktop

Native macOS desktop application for World Chat with enhanced security.

## Features

- **Encrypted Storage**: Session data stored using macOS Keychain (safeStorage API)
- **Browser Isolation**: Chromium sandbox isolates from other apps
- **Single Instance**: Only one app instance allowed at a time
- **Native Title Bar**: macOS hiddenInset style with traffic lights

## Development

### Prerequisites

- Node.js 18+
- pnpm

### Setup

```bash
# Clone with submodule
git clone --recursive https://github.com/yourorg/world-chat-desktop
cd world-chat-desktop

# Or if already cloned, init submodule
git submodule update --init

# Install dependencies (also installs webapp deps)
pnpm install
```

### Running in Development

```bash
# Start both Next.js dev server and Electron
pnpm dev
```

Or manually:

```bash
# Terminal 1: Start Next.js dev server
cd webapp && pnpm dev

# Terminal 2: Start Electron (after dev server is ready)
pnpm exec tsc && pnpm exec electron dist/main.js
```

### Building for Production

```bash
# Build Next.js app and package Electron
pnpm package
```

Output will be in `release/` directory as DMG and ZIP.

## Architecture

```
world-chat-desktop/
├── electron/
│   ├── main.ts      # Main process (window, storage, Next.js server)
│   └── preload.ts   # Secure IPC bridge
├── webapp/          # Git submodule → world-chat-web
└── dist/            # Compiled Electron code
```

## Security

### Encrypted Storage

Uses Electron's `safeStorage` API which encrypts data using the OS keychain:
- **macOS**: Keychain Access
- **Windows**: DPAPI
- **Linux**: libsecret

Encrypted data:
- XMTP session cache (address, inboxId)
- Custom nicknames (if implemented)

### Browser Isolation

- Context isolation enabled
- Node integration disabled
- Sandbox enabled
- Preload script exposes only specific APIs

## Updating Web App

The web app is a git submodule. To update:

```bash
cd webapp
git pull origin main
cd ..
git add webapp
git commit -m "Update webapp submodule"
```
