/**
 * Translation Worker - Runs as standalone Node.js process
 *
 * This worker runs in system Node.js (not Electron) to avoid SIGTRAP crashes
 * that occur when running onnxruntime-node in Electron's Node.js build.
 *
 * Communication with main process happens via child_process IPC.
 *
 * NOTE: We use dynamic imports for @huggingface/transformers to avoid
 * blocking worker startup (the import is slow due to WASM loading).
 */

// Configure cache directory (passed as command line argument from main process)
const cacheDir = process.argv[2];

// NLLB language codes mapping (short code -> NLLB code)
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
  id: 'ind_Latn',
  it: 'ita_Latn',
  nl: 'nld_Latn',
  pl: 'pol_Latn',
  ru: 'rus_Cyrl',
  tr: 'tur_Latn',
  vi: 'vie_Latn',
  th: 'tha_Thai',
  el: 'ell_Grek',
  bg: 'bul_Cyrl',
  ur: 'urd_Arab',
  sw: 'swh_Latn',
};

// Language detection model label -> short code mapping
// qmaru/language_detection outputs NLLB-style codes like "eng_Latn", "fra_Latn"
const LANG_DETECT_MAP: Record<string, string> = {
  eng_latn: 'en',
  spa_latn: 'es',
  fra_latn: 'fr',
  deu_latn: 'de',
  por_latn: 'pt',
  zho_hans: 'zh',
  zho_hant: 'zh',
  jpn_jpan: 'ja',
  kor_hang: 'ko',
  arb_arab: 'ar',
  hin_deva: 'hi',
  ind_latn: 'id',
  ita_latn: 'it',
  nld_latn: 'nl',
  pol_latn: 'pl',
  rus_cyrl: 'ru',
  tur_latn: 'tr',
  vie_latn: 'vi',
  tha_thai: 'th',
  ell_grek: 'el',
  bul_cyrl: 'bg',
  urd_arab: 'ur',
  swh_latn: 'sw',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let translator: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let langDetector: any = null;
let isInitializing = false;
let pendingInitCallbacks: Array<{ id: string }> = [];

// Track download progress across multiple files
const fileProgress: Map<string, number> = new Map();
const fileSizes: Map<string, { loaded: number; total: number }> = new Map();
const MODEL_FILE_COUNT = 12; // Approximate number of model files (translation + language detection)
let lastReportedProgress = -1;
let downloadStartTime = 0;
let lastProgressTime = 0;
let lastTotalLoaded = 0;

interface WorkerMessage {
  id: string;
  type: 'initialize' | 'translate' | 'detectLanguage' | 'isReady' | 'dispose';
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
        if (translator && langDetector) {
          send({ id, type: 'result', payload: { success: true } });
          return;
        }

        // If translator is ready but langDetector isn't, we can still return success
        // and load langDetector in the background (translation will fall back to English)
        if (translator && !langDetector && !isInitializing) {
          console.log('[TranslationWorker] Translator ready, loading language detector in background...');
          // Return success immediately so translation can work
          send({ id, type: 'result', payload: { success: true } });

          // Load langDetector in background (don't await, don't block)
          (async () => {
            try {
              const { pipeline, env } = await import('@huggingface/transformers');
              if (cacheDir) env.cacheDir = cacheDir;
              langDetector = await pipeline(
                'text-classification',
                'qmaru/language_detection',
                { device: 'cpu' }
              );
              console.log('[TranslationWorker] Language detector loaded in background');
            } catch (err) {
              console.error('[TranslationWorker] Failed to load language detector:', err);
            }
          })();
          return;
        }

        if (isInitializing) {
          // Queue this request to be notified when initialization completes
          pendingInitCallbacks.push({ id });
          console.log('[TranslationWorker] Already initializing, queued callback:', id);
          return;
        }

        isInitializing = true;
        console.log('[TranslationWorker] Initializing models...');

        // Send immediate progress so UI doesn't show 0% stuck
        send({
          type: 'progress',
          payload: {
            status: 'loading',
            progress: 1,
            file: 'Loading transformers library...',
          },
        });

        // Dynamic import to avoid blocking worker startup
        console.log('[TranslationWorker] Loading @huggingface/transformers...');
        const { pipeline, env } = await import('@huggingface/transformers');

        // Configure cache directory
        if (cacheDir) {
          env.cacheDir = cacheDir;
        }

        console.log('[TranslationWorker] Transformers loaded, starting model download...');
        downloadStartTime = Date.now();
        lastProgressTime = downloadStartTime;
        lastTotalLoaded = 0;

        // Track if we're downloading or loading from cache
        let isDownloading = false;
        let cachedFileCount = 0;
        let downloadingFileCount = 0;

        send({
          type: 'progress',
          payload: {
            status: 'loading',
            progress: 2,
            file: 'Checking for cached models...',
          },
        });

        // Progress callback shared by both models
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const progressCallback = (progress: any) => {
          const fileName = progress.file || progress.name || '';
          const currentFileProgress = progress.progress || 0;
          const status = progress.status || '';

          console.log('[TranslationWorker] Progress:', status, fileName, currentFileProgress, progress.loaded, progress.total);

          // Detect if we're downloading or loading from cache
          if (status === 'download' || status === 'downloading') {
            isDownloading = true;
            downloadingFileCount++;
          } else if (status === 'ready' || (status === 'done' && !isDownloading)) {
            cachedFileCount++;
          }

          // Track progress and sizes per file
          if (fileName) {
            fileProgress.set(fileName, status === 'done' || status === 'ready' ? 100 : currentFileProgress);
            if (progress.loaded !== undefined && progress.total !== undefined) {
              fileSizes.set(fileName, { loaded: progress.loaded, total: progress.total });
            }
          }

          // Calculate total bytes loaded and total size across all files
          let totalLoaded = 0;
          let totalSize = 0;
          fileSizes.forEach(({ loaded, total }) => {
            totalLoaded += loaded;
            totalSize += total;
          });

          // Calculate overall progress based on bytes (more accurate than file count)
          // Reserve 0-85% for translation model, 85-95% for lang detection model
          let overallProgress: number;
          if (totalSize > 0 && isDownloading) {
            // Downloading: use byte-based progress, cap at 95% (5% for model loading)
            overallProgress = Math.min(95, Math.floor((totalLoaded / totalSize) * 95));
          } else {
            // Loading from cache: show loading progress, cap at 95%
            let fileProgressSum = 0;
            fileProgress.forEach((p) => { fileProgressSum += p; });
            overallProgress = Math.min(95, Math.floor((fileProgressSum / MODEL_FILE_COUNT) * 0.95));
          }

          // Calculate time estimate (only meaningful when downloading)
          const now = Date.now();
          const elapsedMs = now - downloadStartTime;
          let estimatedSecondsRemaining: number | null = null;

          if (isDownloading && totalLoaded > 0 && totalSize > 0 && elapsedMs > 2000) {
            const bytesPerMs = totalLoaded / elapsedMs;
            const remainingBytes = totalSize - totalLoaded;
            estimatedSecondsRemaining = Math.ceil(remainingBytes / bytesPerMs / 1000);
          }

          // Only report if progress increased (prevents flickering)
          if (overallProgress > lastReportedProgress) {
            lastReportedProgress = overallProgress;

            // Format status message
            let timeEstimate: string | undefined;
            let statusMessage: string;

            if (overallProgress >= 90) {
              // Near completion - show initializing message
              statusMessage = 'Initializing models...';
            } else if (isDownloading) {
              // Downloading new models
              if (estimatedSecondsRemaining !== null && estimatedSecondsRemaining > 0) {
                if (estimatedSecondsRemaining < 60) {
                  timeEstimate = `${estimatedSecondsRemaining}s remaining`;
                } else {
                  const mins = Math.ceil(estimatedSecondsRemaining / 60);
                  timeEstimate = `${mins} min remaining`;
                }
              }
              statusMessage = timeEstimate || 'Downloading models...';
            } else {
              // Loading from cache
              statusMessage = 'Loading from cache...';
            }

            send({
              type: 'progress',
              payload: {
                status: progress.status || 'loading',
                progress: overallProgress,
                file: fileName,
                loaded: totalLoaded,
                total: totalSize,
                timeEstimate: statusMessage,
              },
            });
          }
        };

        // Load translation model (larger, ~600MB)
        console.log('[TranslationWorker] Loading translation model...');
        translator = await pipeline(
          'translation',
          'Xenova/nllb-200-distilled-600M',
          {
            dtype: 'fp32',
            device: 'cpu',
            progress_callback: progressCallback,
          }
        );

        // Load language detection model (smaller, ~1GB but shared layers)
        console.log('[TranslationWorker] Loading language detection model...');
        send({
          type: 'progress',
          payload: {
            status: 'loading',
            progress: 90,
            file: 'Loading language detection...',
            timeEstimate: 'Almost ready...',
          },
        });

        langDetector = await pipeline(
          'text-classification',
          'qmaru/language_detection',
          {
            device: 'cpu',
            progress_callback: progressCallback,
          }
        );

        // Send 100% when fully loaded
        send({
          type: 'progress',
          payload: {
            status: 'done',
            progress: 100,
            file: 'Models ready',
            timeEstimate: 'Ready',
          },
        });

        isInitializing = false;
        console.log('[TranslationWorker] All models loaded successfully');
        send({ id, type: 'result', payload: { success: true } });

        // Notify all queued callbacks
        for (const pending of pendingInitCallbacks) {
          send({ id: pending.id, type: 'result', payload: { success: true } });
        }
        pendingInitCallbacks = [];
        break;
      }

      case 'detectLanguage': {
        if (!langDetector) {
          send({ id, type: 'error', payload: 'Language detector not initialized' });
          return;
        }

        const { text } = payload || {};
        if (!text) {
          send({ id, type: 'error', payload: 'Missing text' });
          return;
        }

        console.log('[TranslationWorker] Detecting language for:', text.slice(0, 50) + '...');

        const result = await langDetector(text, { topk: 1 });
        const detected = result[0];

        // Map the full language name to short code
        const langLabel = (detected?.label || '').toLowerCase();
        const langCode = LANG_DETECT_MAP[langLabel] || langLabel;
        const confidence = detected?.score || 0;

        console.log('[TranslationWorker] Detected language:', langLabel, '->', langCode, 'confidence:', confidence);

        send({
          id,
          type: 'result',
          payload: {
            language: langCode,
            confidence,
          },
        });
        break;
      }

      case 'translate': {
        if (!translator) {
          send({ id, type: 'error', payload: 'Not initialized' });
          return;
        }

        let { text, from, to } = payload || {};
        if (!text || !to) {
          send({ id, type: 'error', payload: 'Missing text or to' });
          return;
        }

        // Auto-detect source language if "auto" is passed or from is missing
        if (!from || from === 'auto') {
          if (!langDetector) {
            // Language detector not loaded yet - fall back to English as source
            // This allows translation to work while the detection model downloads
            console.log('[TranslationWorker] Language detector not ready, falling back to English source');
            from = 'en';
          } else {
            console.log('[TranslationWorker] Auto-detecting source language...');
            const detectResult = await langDetector(text, { topk: 1 });
            const detected = detectResult[0];
            const langLabel = (detected?.label || '').toLowerCase();
            const mappedLang = LANG_DETECT_MAP[langLabel];
            const confidence = detected?.score || 0;
            from = mappedLang || 'en';
            console.log('[TranslationWorker] Auto-detected:', langLabel, '->', from, 'mapped:', !!mappedLang, 'confidence:', confidence);

            // Only skip if HIGH confidence (>0.8) detection matches target language
            // Low confidence or unmapped languages should still attempt translation
            if (mappedLang && mappedLang === to && confidence > 0.8) {
              console.log('[TranslationWorker] Source and target are the same (high confidence), skipping');
              send({
                id,
                type: 'result',
                payload: {
                  translatedText: text,
                  from,
                  to,
                  skipped: true,
                },
              });
              return;
            }
          }
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

        // Clean up translation: remove leading punctuation that models sometimes add
        let translatedText = result[0]?.translation_text || text;
        // Remove leading punctuation (ASCII and common Unicode punctuation)
        translatedText = translatedText.replace(/^[\s,，.。;；:：!！?？、·…—–\-'"'"「」『』【】()（）[\]]+/, '').trim();

        send({
          id,
          type: 'result',
          payload: {
            translatedText,
            from,
            to,
          },
        });
        break;
      }

      case 'isReady': {
        // Return true if translator is ready (translation works even without langDetector)
        // langDetector is optional - translation falls back to English source if not available
        send({
          id,
          type: 'result',
          payload: !!translator && !isInitializing,
        });
        break;
      }

      case 'dispose': {
        translator = null;
        langDetector = null;
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

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorLower = errorMessage.toLowerCase();

    // Detect corrupted cache errors and auto-clear (case-insensitive)
    const isCorruptedCache =
      errorLower.includes('protobuf parsing failed') ||
      errorLower.includes('failed to parse') ||
      errorLower.includes('invalid model') ||
      errorLower.includes('corrupted') ||
      errorLower.includes('unexpected end of');

    if (isCorruptedCache && cacheDir) {
      console.log('[TranslationWorker] Detected corrupted cache, clearing and will retry...');

      // Clear the cache directory
      try {
        const fs = await import('fs');
        const path = await import('path');

        // Delete all files in cache directory
        if (fs.existsSync(cacheDir)) {
          const files = fs.readdirSync(cacheDir);
          for (const file of files) {
            const filePath = path.join(cacheDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
              } else {
                fs.unlinkSync(filePath);
              }
            } catch (e) {
              console.error('[TranslationWorker] Failed to delete:', filePath, e);
            }
          }
          console.log('[TranslationWorker] Cache cleared, please retry initialization');
        }
      } catch (clearError) {
        console.error('[TranslationWorker] Failed to clear cache:', clearError);
      }

      // Send error with clear instruction
      send({
        id,
        type: 'error',
        payload: 'Model cache was corrupted and has been cleared. Please try again.',
      });

      // Exit worker after fatal error - main process will clean up
      console.log('[TranslationWorker] Exiting after fatal error (corrupted cache)');
      process.exit(1);
    } else {
      send({
        id,
        type: 'error',
        payload: errorMessage,
      });

      // Exit worker after initialization failure - don't leave in bad state
      if (type === 'initialize') {
        console.log('[TranslationWorker] Exiting after initialization failure');
        process.exit(1);
      }
    }
  }
});

// Signal that worker is ready
console.log('[TranslationWorker] Worker started, cache dir:', cacheDir);
send({ type: 'ready' });
