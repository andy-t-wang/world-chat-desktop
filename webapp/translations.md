# On-Device Translation Feature

> Private, offline translation powered by Meta's NLLB-200 model running locally in the Electron desktop app.

## Overview

Translation runs entirely on-device using [Transformers.js](https://huggingface.co/docs/transformers.js) with the [NLLB-200-distilled-600M](https://huggingface.co/Xenova/nllb-200-distilled-600M) model. No text is ever sent to external servers - all translation happens locally, preserving end-to-end encryption guarantees.

**Desktop only** - This feature requires Electron's Node.js environment for ONNX runtime. Not available in web browsers.

---

## User Experience

### Installing the Extension

1. User opens **Settings** panel
2. Under **Extensions**, clicks **"Download"** next to Translation
3. Model downloads (~600MB) with progress indicator
4. Once complete, shows "Installed · ~600MB"

After installation, the extension is available app-wide and loads automatically on app launch.

### Removing the Extension

1. User opens **Settings** panel
2. Under **Extensions**, clicks **"Delete"** next to Translation
3. Model files are removed from disk (~600MB freed)
4. Extension returns to "Download" state

### Per-Conversation Usage

Each conversation has an independent **"Enable translation"** button in the chat header:

| State | Button Text | Behavior |
|-------|-------------|----------|
| Off | "Enable translation" | Blue outline button |
| On | "Auto-translate on" | Solid blue button |

When enabled for a conversation:
- Incoming messages are automatically translated (Spanish → English)
- Translation appears below original message text
- Manual translate button (Languages icon) available on each message

### Manual Translation

Users can translate individual messages by clicking the **Languages** icon (A文) in the message action bar. Clicking again hides the translation.

---

## Privacy & Security

### E2E Encryption Preserved

- Original encrypted messages are never modified
- Translations are computed locally from decrypted content
- No translation data is sent over the network

### Translation Caching

Translations are cached in `localStorage` to avoid re-translating on every conversation visit:

```
localStorage key: translation-cache-{conversationId}
value: { messageId: translatedText, ... }
```

**Disappearing Messages Exception**: If a conversation has disappearing messages enabled, translations are **NOT cached**. This ensures ephemeral conversations remain ephemeral - no translation artifacts persist after messages auto-delete.

### Data Storage Locations

| Data | Location | Persistence |
|------|----------|-------------|
| NLLB model files | `~/Library/Application Support/world-chat-desktop/translation-models/` | Until deleted via Settings |
| Translation cache | `localStorage` per conversation | Until browser data cleared |
| Auto-translate preferences | `localStorage` (`auto-translate-conversations`) | Until browser data cleared |
| Translation enabled flag | Electron store | Cleared when extension deleted |

---

## Architecture

### Why a Separate Process?

Running `onnxruntime-node` in Electron's main process causes SIGTRAP crashes due to incompatibilities with Electron's custom Node.js build. Solution: spawn a standalone Node.js process using the system's Node installation.

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  - Finds system Node.js (nvm, homebrew, etc.)           ││
│  │  - Spawns translation-worker.js as child process        ││
│  │  - Relays IPC between renderer and worker               ││
│  └─────────────────────────────────────────────────────────┘│
│                            ↕ child_process IPC               │
├─────────────────────────────────────────────────────────────┤
│              System Node.js Process (Isolated)               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  translation-worker.ts                                   ││
│  │  - Loads @huggingface/transformers                       ││
│  │  - Downloads/caches NLLB-200 model                       ││
│  │  - Handles translate requests                            ││
│  │  - ~500MB memory footprint (isolated from UI)            ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                     Renderer Process                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  useTranslation() hook                                   ││
│  │  - initialize(), translate(), dispose()                  ││
│  │  - Caching: getCachedTranslation(), cacheTranslation()   ││
│  │  - Per-conversation: isAutoTranslateEnabled()            ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `electron/translation-worker.ts` | Standalone Node.js worker process |
| `electron/main.ts` | Child process management, IPC relay |
| `hooks/useTranslation.ts` | React hook for translation API |
| `components/chat/MessagePanel.tsx` | UI integration, auto-translate logic |
| `components/chat/SettingsPanel.tsx` | Global enable toggle, download progress |

---

## Supported Languages

Currently hardcoded to Spanish → English. The NLLB-200 model supports 200 languages.

NLLB language codes used:

```typescript
const LANGUAGE_MAP = {
  en: 'eng_Latn',
  es: 'spa_Latn',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  pt: 'por_Latn',
  zh: 'zho_Hans',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
  ar: 'arb_Arab',
  hi: 'hin_Deva',
};
```

---

## Technical Details

### Model Specifications

- **Model**: `Xenova/nllb-200-distilled-600M`
- **Size**: ~600MB download, ~500MB memory when loaded
- **Precision**: FP32 (required for stability with onnxruntime-node)
- **Max tokens**: 256 per translation

### IPC Protocol

Messages between main process and translation worker:

```typescript
// Request
{ id: string, type: 'initialize' | 'translate' | 'isReady' | 'dispose', payload?: any }

// Response
{ id: string, type: 'result' | 'error', payload: any }

// Progress (during model download)
{ type: 'progress', payload: { status: string, progress: number, file?: string } }
```

### Error Handling

- If translation worker crashes, it can be respawned without restarting the app
- Translation failures are logged but don't block the UI
- Auto-translate silently skips messages that fail to translate

---

## Future Improvements

- [ ] Language detection (auto-detect source language)
- [ ] User-configurable source/target language pair
- [ ] Batch translation for conversation history
- [ ] Web browser support via WebGPU/WASM (when stable)
- [x] ~~Ability to uninstall/delete downloaded model~~ (implemented)
