/**
 * Image Cache Service
 * Downloads, decrypts, and caches images from XMTP RemoteAttachments
 *
 * Uses a two-layer cache:
 * 1. In-memory LRU cache for blob URLs
 * 2. localStorage for metadata persistence (WorldChatImages table)
 */

import { LRUCache } from '@/lib/utils/lru';
import { IMAGE_CACHE } from '@/config/constants';
import type {
  WorldChatImage,
  RemoteAttachmentContent,
  ImageLoadResult,
  ImageStatus,
} from '@/types/attachments';

interface StorageData {
  version: number;
  entries: Record<string, WorldChatImage>;
}

/** Singleton cache for image metadata and blob URLs */
const imageCache = new LRUCache<string, WorldChatImage>(
  IMAGE_CACHE.MAX_CACHE_SIZE,
  (digest, entry) => {
    // Revoke blob URL when evicted to free memory
    if (entry.status === 'downloaded' && entry.fileLocation.startsWith('blob:')) {
      URL.revokeObjectURL(entry.fileLocation);
    }
  }
);

/** Pending downloads to deduplicate concurrent requests */
const pendingDownloads = new Map<string, Promise<ImageLoadResult>>();

/** Flag to track if we've loaded from localStorage */
let storageLoaded = false;

/**
 * Verify URL is from trusted CDN
 */
export function isTrustedCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const trusted = new URL(IMAGE_CACHE.TRUSTED_CDN);
    return parsed.origin === trusted.origin;
  } catch {
    return false;
  }
}

/**
 * Load cached images from localStorage on first access
 */
function loadFromStorage(): void {
  if (storageLoaded || typeof window === 'undefined') return;
  storageLoaded = true;

  try {
    const stored = localStorage.getItem(IMAGE_CACHE.STORAGE_KEY);
    if (!stored) return;

    const data: StorageData = JSON.parse(stored);
    if (data.version !== IMAGE_CACHE.STORAGE_VERSION) {
      localStorage.removeItem(IMAGE_CACHE.STORAGE_KEY);
      return;
    }

    const now = Date.now();
    for (const [digest, entry] of Object.entries(data.entries)) {
      // Only load entries that haven't expired
      if (now - entry.cachedAt < IMAGE_CACHE.CACHE_TTL_MS) {
        // Note: blob URLs are not persisted - they need to be recreated
        // Mark as needing re-download if it was a blob URL
        if (entry.fileLocation.startsWith('blob:')) {
          entry.status = 'downloading';
          entry.fileLocation = '';
        }
        imageCache.set(digest, entry);
      }
    }
  } catch {
    localStorage.removeItem(IMAGE_CACHE.STORAGE_KEY);
  }
}

/**
 * Save current cache metadata to localStorage (debounced)
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function saveToStorage(): void {
  if (typeof window === 'undefined') return;

  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const entries: Record<string, WorldChatImage> = {};
      const now = Date.now();

      imageCache.forEach((entry, digest) => {
        if (now - entry.cachedAt < IMAGE_CACHE.CACHE_TTL_MS) {
          entries[digest] = entry;
        }
      });

      const data: StorageData = {
        version: IMAGE_CACHE.STORAGE_VERSION,
        entries,
      };
      localStorage.setItem(IMAGE_CACHE.STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }, 1000);
}

/** Decrypted attachment shape from RemoteAttachmentCodec.load() */
interface LoadedAttachment {
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/**
 * Convert a value to Uint8Array if it's been serialized (e.g., through web workers)
 * Handles: Uint8Array, ArrayBuffer, Array, plain objects with numeric keys
 */
function toUint8Array(value: unknown): Uint8Array {
  // Already a Uint8Array
  if (value instanceof Uint8Array) {
    return value;
  }

  // ArrayBuffer
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  // Array of numbers
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }

  // Plain object with numeric keys (serialized Uint8Array from web worker)
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, number>;
    const keys = Object.keys(obj);
    // Check if it looks like a serialized array (keys are "0", "1", "2", etc.)
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      const arr = new Uint8Array(keys.length);
      for (const key of keys) {
        arr[parseInt(key, 10)] = obj[key];
      }
      return arr;
    }
  }

  // Fallback - try to create from the value
  return new Uint8Array(value as ArrayLike<number>);
}

/**
 * Normalize a RemoteAttachmentContent to ensure Uint8Array fields are proper Uint8Arrays
 * This is needed because web worker serialization can convert Uint8Arrays to plain objects
 */
function normalizeAttachment(attachment: RemoteAttachmentContent): RemoteAttachmentContent {
  return {
    ...attachment,
    salt: toUint8Array(attachment.salt),
    nonce: toUint8Array(attachment.nonce),
    secret: toUint8Array(attachment.secret),
  };
}

/**
 * Derive AES-256-GCM key from secret using HKDF
 */
async function deriveKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = window.crypto;
  const keyMaterial = await crypto.subtle.importKey('raw', secret.buffer as ArrayBuffer, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt.buffer as ArrayBuffer,
      info: new ArrayBuffer(0),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

/**
 * Decrypt ciphertext using AES-256-GCM
 */
async function decryptPayload(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: CryptoKey
): Promise<Uint8Array> {
  const crypto = window.crypto;
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );
  return new Uint8Array(decrypted);
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Download and decrypt an image manually
 * browser-sdk v6 doesn't have codecFor method, so we implement decryption ourselves
 */
async function downloadAndDecrypt(
  remoteAttachment: RemoteAttachmentContent,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _xmtpClient: unknown
): Promise<ImageLoadResult> {
  const { contentDigest, filename, url } = remoteAttachment;

  try {
    // Normalize the attachment to ensure Uint8Array fields are proper Uint8Arrays
    const normalizedAttachment = normalizeAttachment(remoteAttachment);
    const { salt, nonce, secret } = normalizedAttachment;

    // Rewrite URL to go through our proxy to avoid CORS issues
    const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;

    // Fetch encrypted content
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const encryptedData = new Uint8Array(await response.arrayBuffer());
    if (encryptedData.length === 0) {
      throw new Error('Empty payload');
    }

    // Verify content digest
    const crypto = window.crypto;
    const digestBuffer = await crypto.subtle.digest('SHA-256', encryptedData);
    const computedDigest = bytesToHex(new Uint8Array(digestBuffer));
    if (computedDigest !== contentDigest) {
      throw new Error('Content digest mismatch');
    }

    // Derive decryption key using HKDF
    const key = await deriveKey(secret, salt);

    // Decrypt the payload
    const decryptedData = await decryptPayload(encryptedData, nonce, key);

    // Decode the protobuf EncodedContent
    // Import proto module dynamically
    const { content: contentProto } = await import('@xmtp/proto');
    const encodedContent = contentProto.EncodedContent.decode(decryptedData);

    // The inner content should be an Attachment with data, filename, mimeType
    // The content is protobuf-encoded attachment data
    if (!encodedContent.content || encodedContent.content.length === 0) {
      throw new Error('No content in decoded payload');
    }

    // For attachment content type, the parameters contain filename and mimeType
    const attachmentFilename = encodedContent.parameters?.filename || filename || 'attachment';
    const mimeType = encodedContent.parameters?.mimeType || 'application/octet-stream';

    // The content field contains the raw attachment data
    const attachmentData = encodedContent.content;

    const attachment: LoadedAttachment = {
      filename: attachmentFilename,
      mimeType: mimeType,
      data: attachmentData,
    };

    // Create blob URL from decrypted data
    const blob = new Blob([attachment.data as BlobPart], { type: attachment.mimeType });
    const blobUrl = URL.createObjectURL(blob);

    // Cache the result
    const entry: WorldChatImage = {
      contentDigest,
      fileLocation: blobUrl,
      status: 'downloaded',
      isBackedUp: false,
      filename: attachment.filename || filename,
      mimeType: attachment.mimeType,
      contentLength: attachment.data.length,
      cachedAt: Date.now(),
    };

    imageCache.set(contentDigest, entry);
    saveToStorage();

    return {
      status: 'downloaded',
      blobUrl,
      filename: entry.filename,
      mimeType: entry.mimeType,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Download failed';
    console.error('[ImageService] Failed to load image:', {
      contentDigest,
      filename,
      url,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Cache the failure
    const failedEntry: WorldChatImage = {
      contentDigest,
      fileLocation: '',
      status: 'failed',
      isBackedUp: false,
      mimeType: '',
      cachedAt: Date.now(),
    };

    imageCache.set(contentDigest, failedEntry);
    saveToStorage();

    return {
      status: 'failed',
      blobUrl: null,
      error: errorMessage,
    };
  }
}

/**
 * Load an image from RemoteAttachment
 * Handles caching, CDN verification, download, and decryption
 */
export async function loadImage(
  remoteAttachment: RemoteAttachmentContent,
  xmtpClient: unknown
): Promise<ImageLoadResult> {
  loadFromStorage();

  const { contentDigest, url } = remoteAttachment;

  // Check cache first
  const cached = imageCache.get(contentDigest);
  if (cached && cached.status === 'downloaded' && cached.fileLocation) {
    return {
      status: 'downloaded',
      blobUrl: cached.fileLocation,
      filename: cached.filename,
      mimeType: cached.mimeType,
    };
  }

  // Return cached failure state (allows retry via retryImage)
  if (cached && cached.status === 'failed') {
    console.warn('[ImageService] Returning cached failure for:', contentDigest);
    return {
      status: 'failed',
      blobUrl: null,
      error: 'Previous download failed',
    };
  }

  // Deduplicate concurrent downloads
  const pending = pendingDownloads.get(contentDigest);
  if (pending) {
    return pending;
  }

  // Verify trusted CDN
  if (!isTrustedCdnUrl(url)) {
    console.warn('[ImageService] Untrusted CDN source:', { url, contentDigest });
    const failedEntry: WorldChatImage = {
      contentDigest,
      fileLocation: url,
      status: 'failed',
      isBackedUp: false,
      mimeType: '',
      cachedAt: Date.now(),
    };
    imageCache.set(contentDigest, failedEntry);
    saveToStorage();
    return {
      status: 'failed',
      blobUrl: null,
      error: 'Untrusted CDN source',
    };
  }

  // Start download
  const downloadPromise = downloadAndDecrypt(remoteAttachment, xmtpClient);
  pendingDownloads.set(contentDigest, downloadPromise);

  try {
    return await downloadPromise;
  } finally {
    pendingDownloads.delete(contentDigest);
  }
}

/**
 * Retry a failed image download
 * Clears the failed status and attempts download again
 */
export async function retryImage(
  contentDigest: string,
  remoteAttachment: RemoteAttachmentContent,
  xmtpClient: unknown
): Promise<ImageLoadResult> {
  // Clear failed status from cache
  imageCache.delete(contentDigest);
  saveToStorage();

  // Attempt download again
  return loadImage(remoteAttachment, xmtpClient);
}

/**
 * Get cached image status without triggering download
 */
export function getCachedImage(contentDigest: string): WorldChatImage | null {
  loadFromStorage();
  return imageCache.get(contentDigest) ?? null;
}

/**
 * Check if an image download is untrusted (no retry allowed)
 */
export function isUntrustedError(error: string | undefined): boolean {
  return error === 'Untrusted CDN source';
}

/**
 * Clear all cached images
 */
export function clearImageCache(): void {
  // Revoke all blob URLs
  imageCache.forEach((entry) => {
    if (entry.fileLocation.startsWith('blob:')) {
      URL.revokeObjectURL(entry.fileLocation);
    }
  });
  imageCache.clear();
  pendingDownloads.clear();
  storageLoaded = false;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(IMAGE_CACHE.STORAGE_KEY);
  }
}
