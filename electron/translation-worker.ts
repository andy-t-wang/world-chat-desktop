/**
 * Translation Worker - Runs as standalone Node.js process
 *
 * This worker runs in system Node.js (not Electron) to avoid SIGTRAP crashes
 * that occur when running onnxruntime-node in Electron's Node.js build.
 *
 * Communication with main process happens via child_process IPC.
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure cache directory (passed as command line argument from main process)
const cacheDir = process.argv[2];
if (cacheDir) {
  env.cacheDir = cacheDir;
}

// NLLB language codes mapping
const LANGUAGE_MAP: Record<string, string> = {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let translator: any = null;
let isInitializing = false;
let pendingInitCallbacks: Array<{ id: string }> = [];

// Track download progress across multiple files
const fileProgress: Map<string, number> = new Map();
const MODEL_FILE_COUNT = 6; // Approximate number of model files
let lastReportedProgress = -1;

interface WorkerMessage {
  id: string;
  type: 'initialize' | 'translate' | 'isReady' | 'dispose';
  payload?: {
    text?: string;
    from?: string;
    to?: string;
  };
}

// Helper to send messages back to main process
function send(msg: object): void {
  if (process.send) {
    process.send(msg);
  }
}

// Handle messages from main process (child_process IPC)
process.on('message', async (msg: WorkerMessage) => {
  const { id, type, payload } = msg;

  console.log('[TranslationWorker] Received message:', type);

  try {
    switch (type) {
      case 'initialize': {
        if (translator) {
          send({ id, type: 'result', payload: { success: true } });
          return;
        }

        if (isInitializing) {
          // Queue this request to be notified when initialization completes
          pendingInitCallbacks.push({ id });
          console.log('[TranslationWorker] Already initializing, queued callback:', id);
          return;
        }

        isInitializing = true;
        console.log('[TranslationWorker] Initializing NLLB model...');

        // Send immediate progress so UI doesn't show 0% stuck
        send({
          type: 'progress',
          payload: {
            status: 'loading',
            progress: 2,
            file: 'Preparing model...',
          },
        });

        translator = await pipeline(
          'translation',
          'Xenova/nllb-200-distilled-600M',
          {
            dtype: 'fp32',
            device: 'cpu',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            progress_callback: (progress: any) => {
              const fileName = progress.file || progress.name || '';
              const currentFileProgress = progress.progress || 0;

              // Track progress per file
              if (fileName) {
                fileProgress.set(fileName, progress.status === 'done' ? 100 : currentFileProgress);
              }

              // Calculate overall progress from all tracked files
              let totalProgress = 0;
              fileProgress.forEach((p) => { totalProgress += p; });
              const overallProgress = Math.floor((totalProgress / MODEL_FILE_COUNT));

              // Only report if progress increased (prevents flickering)
              if (overallProgress > lastReportedProgress) {
                lastReportedProgress = overallProgress;
                send({
                  type: 'progress',
                  payload: {
                    status: progress.status || 'downloading',
                    progress: Math.min(99, overallProgress), // Cap at 99 until fully done
                    file: fileName,
                    loaded: progress.loaded,
                    total: progress.total,
                  },
                });
              }
            },
          }
        );

        isInitializing = false;
        console.log('[TranslationWorker] Model loaded successfully');
        send({ id, type: 'result', payload: { success: true } });

        // Notify all queued callbacks
        for (const pending of pendingInitCallbacks) {
          send({ id: pending.id, type: 'result', payload: { success: true } });
        }
        pendingInitCallbacks = [];
        break;
      }

      case 'translate': {
        if (!translator) {
          send({ id, type: 'error', payload: 'Not initialized' });
          return;
        }

        const { text, from, to } = payload || {};
        if (!text || !from || !to) {
          send({ id, type: 'error', payload: 'Missing text, from, or to' });
          return;
        }

        const srcLang = LANGUAGE_MAP[from] || from;
        const tgtLang = LANGUAGE_MAP[to] || to;

        console.log('[TranslationWorker] Translating from', srcLang, 'to', tgtLang);

        const result = await translator(text, {
          src_lang: srcLang,
          tgt_lang: tgtLang,
          max_new_tokens: 256,
        });

        console.log('[TranslationWorker] Translation complete');
        send({
          id,
          type: 'result',
          payload: {
            translatedText: result[0]?.translation_text || text,
            from,
            to,
          },
        });
        break;
      }

      case 'isReady': {
        send({
          id,
          type: 'result',
          payload: !!translator && !isInitializing,
        });
        break;
      }

      case 'dispose': {
        translator = null;
        isInitializing = false;
        console.log('[TranslationWorker] Disposed');
        send({ id, type: 'result', payload: { success: true } });
        break;
      }

      default:
        send({ id, type: 'error', payload: `Unknown message type: ${type}` });
    }
  } catch (error) {
    console.error('[TranslationWorker] Error:', error);
    isInitializing = false;
    send({
      id,
      type: 'error',
      payload: error instanceof Error ? error.message : String(error),
    });
  }
});

// Signal that worker is ready
console.log('[TranslationWorker] Worker started, cache dir:', cacheDir);
send({ type: 'ready' });
