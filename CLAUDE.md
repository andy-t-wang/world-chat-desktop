# XMTP E2EE Chat Application

> Desktop-first web messaging app built on XMTP protocol with Telegram-style split-pane layout.

## Quick Start

```bash
pnpm install
pnpm dev        # http://localhost:3000 → redirects to /chat
pnpm exec tsc --noEmit  # Type check
```

XMTP docs: https://github.com/xmtp/docs-xmtp-org/blob/main/llms/llms-chat-apps.txt

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Next.js 16.1** | App framework (App Router) |
| **React 19.2** | UI library |
| **TypeScript 5** | Type safety (target: ES2020) |
| **Tailwind CSS 4** | Styling |
| **Jotai** | Atomic state management |
| **@tanstack/react-virtual** | List virtualization |
| **@xmtp/browser-sdk** | E2EE messaging protocol |
| **viem** | Ethereum utilities |
| **lucide-react** | Icons |
| **Supabase** | Signing relay (QR login) |

---

## XMTP Browser SDK Quick Reference

### Key APIs

| Operation | Method |
|-----------|--------|
| Create client | `Client.create(signer, { env: 'production', codecs })` |
| Sync conversations | `client.conversations.syncAll([ConsentState.Allowed])` |
| List conversations | `client.conversations.list({ consentStates: [ConsentState.Allowed] })` |
| Get conversation | `client.conversations.getConversationById(id)` |
| Create DM | `client.conversations.newDmWithIdentifier({ identifier, identifierKind: 'Ethereum' })` |
| Stream conversations | `client.conversations.stream()` → `for await` + `.end()` |
| Load messages | `conversation.messages({ limit: BigInt(30), direction: SortDirection.Descending })` |
| Send message | `conversation.send('Hello!')` → returns message ID |
| Stream messages | `conversation.stream()` → `for await` + `.end()` |
| Check if DM | `typeof conv.peerInboxId === 'function'` |
| Get peer inbox | `await dm.peerInboxId()` (async!) |

### Content Type Codecs

| Codec | Package |
|-------|---------|
| `ReactionCodec` | `@xmtp/content-type-reaction` |
| `ReplyCodec` | `@xmtp/content-type-reply` |
| `ReadReceiptCodec` | `@xmtp/content-type-read-receipt` |

### Important Notes

1. **Use Webpack, not Turbopack**: `pnpm dev` uses `--webpack` flag due to WASM issues
2. **All list/stream methods are async**: Always `await` them
3. **`peerInboxId()` is async**: Returns `Promise<string>`, only on `Dm` class
4. **Stream cleanup**: Call `stream.end()` not `stream.close()`
5. **Use `insertedAtNs` for pagination**: Provides stable ordering (not `sentAtNs`)
6. **Filter content types**: Hide read receipts, reactions from message display
7. **inboxId is primary identifier**: NOT wallet address

---

## Architecture

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│                        /chat                                 │
├──────────────────┬──────────────────────────────────────────┤
│    Sidebar       │           MessagePanel                   │
│   (320-380px)    │         (flex-1)                         │
│  ┌────────────┐  │  ┌────────────────────────────────────┐ │
│  │ Search     │  │  │ Header (name, avatar, status)      │ │
│  ├────────────┤  │  ├────────────────────────────────────┤ │
│  │ Convo List │  │  │ Messages Area (virtualized)        │ │
│  │ (virtual)  │  │  │ - Incoming: white bg, left         │ │
│  │            │  │  │ - Outgoing: blue bg, right         │ │
│  └────────────┘  │  ├────────────────────────────────────┤ │
│                  │  │ Input (text, send)                  │ │
│  Selected =      │  └────────────────────────────────────┘ │
│  blue bg #005CFF │  No selection = EmptyState              │
└──────────────────┴──────────────────────────────────────────┘
```

### State Management (Jotai)

| Atom | Purpose |
|------|---------|
| `selectedConversationIdAtom` | Currently selected conversation |
| `conversationIdsAtom` | List of conversation IDs |
| `messageAtomFamily(id)` | Individual message data (granular updates) |
| `clientStateAtom` | XMTP client state |

### Application Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  RENDERING LAYER                                                             │
│  ├─ Virtualized lists (only visible items in DOM)                           │
│  ├─ ~20-30 DOM nodes regardless of message count                            │
│  └─ Optimistic UI updates (pending messages shown immediately)              │
├─────────────────────────────────────────────────────────────────────────────┤
│  STATE LAYER (Jotai)                                                         │
│  ├─ atomFamily for individual messages (granular subscriptions, O(1))       │
│  ├─ Message ID lists per conversation (not full objects)                    │
│  ├─ Conversation metadata in Map (not atoms) for performance                │
│  └─ Metadata version atom triggers re-renders when needed                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  STREAMING LAYER (StreamManager singleton)                                   │
│  ├─ Lives outside React lifecycle (survives mount/unmount)                  │
│  ├─ Uses shared Jotai store directly (not React Provider)                   │
│  ├─ Batches updates via queueMicrotask()                                    │
│  └─ Single source of truth for all XMTP streams                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  PERSISTENCE LAYER                                                           │
│  ├─ XMTP libxmtp handles storage (SQLite in OPFS)                           │
│  ├─ Session cache in localStorage (address, inboxId)                        │
│  └─ Consent state synced via XMTP                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  XMTP PROTOCOL LAYER                                                         │
│  ├─ MLS-based E2EE (handled by libxmtp)                                     │
│  ├─ History sync across devices                                              │
│  └─ Consent management (Allowed/Unknown/Denied)                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

| Problem | Solution |
|---------|----------|
| New message re-renders entire list | `atomFamily` per message → O(1) update |
| React unmount kills streams | StreamManager singleton outside React |
| Metadata updates cause cascading renders | Store in Map, use version atom to trigger |
| Large lists slow to render | Virtualization (only ~20-30 DOM nodes) |
| User waits for send confirmation | Optimistic updates (show pending immediately) |

### StreamManager Singleton

`lib/xmtp/StreamManager.ts` manages XMTP streaming **outside React lifecycle**:

**Sync-Once + Streams Strategy:**
```
App Load:
1. Load from local cache (instant, no network)
2. Start streams for real-time updates
3. ONE background sync to catch up
4. Never sync again - rely on streams

On conversation open:
1. Load local messages (instant)
2. Start message stream (real-time)
3. NO sync - streams handle everything
```

**Key Features:**
- Loads conversations on init (with consent filtering)
- Streams new conversations and messages
- Stream restart on crash (up to 5 attempts with exponential backoff)
- Manages conversation metadata (preview, timestamp)
- Uses shared Jotai store (`stores/index.ts`)
- Batches updates via `queueMicrotask()`
- Tracks read receipts per conversation

---

## QR Login / Signing Relay

For World App wallets (Gnosis Safe), signing requests relay via Supabase Realtime.

### Flow

```
Desktop                    Supabase                   World App
   │  1. Show QR code         │                           │
   │  (worldcoin.org/mini-app?app_id=...&path=/sign?session=abc)
   │                          │     2. User scans QR      │
   │◀───── 4. mobile_connected ───────────────────────────│
   │──── 5. XMTP: sign msg ───▶                           │
   │                          │────── 6. sign_request ───▶│
   │                          │◀───── 7. signature ───────│
   │◀─── 8. signature ────────│                           │
   │  9. XMTP client ready!   │                           │
```

### Key Files

| File | Purpose |
|------|---------|
| `lib/signing-relay/remote-signer.ts` | Desktop: XMTP signer relaying to mobile |
| `lib/signing-relay/mobile-signer.ts` | Mobile: Handles signing requests |
| `components/auth/QRLogin.tsx` | QR code login component |
| `app/sign/page.tsx` | Signing helper page (runs in World App) |
| `hooks/useQRXmtpClient.ts` | Hook for XMTP client with remote signer |

### Session Restoration

Sessions are cached in localStorage (`xmtp-session-cache`) for page reloads:
- `restoreSession()` creates a cached signer with stored address
- `Client.create()` reuses existing XMTP installation from OPFS
- If signing needed (installation lost), redirects to QR login

---

## World App Username API

Resolves wallet addresses to usernames and profile pictures.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/{address}` | Single address lookup |
| `POST /api/v1/query` | Batch resolve addresses |
| `GET /api/v1/search/{prefix}` | Search usernames |

**Base URL**: `https://usernames.worldcoin.org`

**Key Files**: `lib/username/service.ts`, `hooks/useUsername.ts`

---

## Directory Structure

```
app/
├── layout.tsx          # Root layout + JotaiProvider
├── page.tsx            # Login page with QR
├── chat/page.tsx       # Sidebar + MessagePanel
└── sign/page.tsx       # Signing helper for World App

components/
├── auth/QRLogin.tsx    # QR code login
├── chat/               # Sidebar, ConversationList, MessagePanel, etc.
└── ui/                 # Avatar, VerificationBadge

stores/                 # Jotai atoms
├── client.ts           # XMTP client state
├── conversations.ts    # Conversation atoms
├── messages.ts         # Message atoms
└── ui.ts               # UI state (selection)

hooks/
├── useQRXmtpClient.ts  # XMTP client with remote signer
├── useConversations.ts # Conversation list
└── useMessages.ts      # Message loading

lib/
├── xmtp/StreamManager.ts    # Singleton for XMTP streaming
├── signing-relay/           # QR login signing relay
├── username/service.ts      # Username API client
└── auth/session.ts          # Session utilities
```

---

## Design System

### Colors

| Token | Hex | Usage |
|-------|-----|-------|
| Grey/900 | `#181818` | Primary text |
| Grey/500 | `#717680` | Secondary text |
| Grey/100 | `#F5F5F5` | Backgrounds |
| Info/600 | `#005CFF` | Selected state, links |
| Success/600 | `#00C230` | Online status |

### Sizing

| Element | Size |
|---------|------|
| Sidebar width | 320px (lg: 380px) |
| Avatar sm/md/lg | 36px / 52px / 72px |

---

## Security Notes

### What XMTP Provides
- E2E encryption via MLS
- Forward secrecy with key rotation
- Message integrity verification

### Browser Limitations
- IndexedDB is NOT encrypted (Browser SDK limitation)
- Same-origin policy is primary protection
- XMTP installations persist in OPFS - don't clear browser data

### QR Login Security (TODO before production)
- SEC-001: Add challenge-response auth for signing relay
- SEC-005: Require signed proof of wallet ownership on connect

---

## Key Implementation Decisions

1. **Jotai atomFamily** - O(1) message updates
2. **Virtualization** - @tanstack/react-virtual for large lists
3. **StreamManager singleton** - XMTP streaming outside React lifecycle
4. **Session caching** - localStorage for instant reconnection
5. **Consent filtering** - Only sync/list `Allowed` conversations
6. **Use `insertedAtNs`** - Stable pagination ordering
7. **Filter content types** - Hide read receipts, reactions from display
8. **Sync-once + streams** - Sync once on load, then rely entirely on streams
9. **Stream restart** - Auto-restart crashed streams with exponential backoff
10. **Read receipts** - Send when viewing (DMs and groups ≤5 members), show "Read" on sent messages
