/**
 * Attachment Types
 * Types for image attachments received via XMTP RemoteAttachment
 */

/** Status of an image download */
export type ImageStatus = 'downloading' | 'downloaded' | 'failed';

/** Cached image entry stored in localStorage (WorldChatImages table) */
export interface WorldChatImage {
  /** SHA256 content digest from RemoteAttachment (primary key) */
  contentDigest: string;
  /** Blob URL or empty if failed */
  fileLocation: string;
  /** Download/cache status */
  status: ImageStatus;
  /** Placeholder for future backup feature */
  isBackedUp: boolean;
  /** Original filename from attachment */
  filename?: string;
  /** MIME type (e.g., 'image/png') */
  mimeType: string;
  /** File size in bytes */
  contentLength?: number;
  /** Timestamp when cached */
  cachedAt: number;
}

/** RemoteAttachment content structure from XMTP */
export interface RemoteAttachmentContent {
  /** CDN URL to fetch encrypted content */
  url: string;
  /** Content hash for verification */
  contentDigest: string;
  /** Salt for decryption */
  salt: Uint8Array;
  /** Nonce for decryption */
  nonce: Uint8Array;
  /** Secret key for decryption */
  secret: Uint8Array;
  /** Encryption scheme (e.g., 'aes-256-gcm') */
  scheme: string;
  /** Optional file size in bytes */
  contentLength?: number;
  /** Optional original filename */
  filename?: string;
}

/** Decrypted attachment result from RemoteAttachmentCodec.load() */
export interface DecryptedAttachment {
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/** Image load result for UI */
export interface ImageLoadResult {
  status: ImageStatus;
  blobUrl: string | null;
  error?: string;
  filename?: string;
  mimeType?: string;
}

/** Multi-attachment content (array of remote attachments) */
export type MultiRemoteAttachmentContent = RemoteAttachmentContent[];

/** Multi-attachment wrapper (object with attachments array) */
export interface MultiRemoteAttachmentWrapper {
  attachments: RemoteAttachmentContent[];
}

/** Alternative multi-attachment wrapper (object with remoteAttachments array) */
export interface MultiRemoteStaticAttachmentWrapper {
  remoteAttachments: RemoteAttachmentContent[];
}

/** Helper to check if an item looks like an attachment */
function isAttachmentLike(item: unknown): item is RemoteAttachmentContent {
  return typeof item === 'object' &&
    item !== null &&
    'contentDigest' in item &&
    'url' in item;
}

/** Check if content is a multi-attachment array */
export function isMultiAttachment(content: unknown): content is MultiRemoteAttachmentContent {
  // Direct array of attachments
  if (Array.isArray(content) && content.length > 0) {
    return content.every(isAttachmentLike);
  }
  return false;
}

/** Check if content is a multi-attachment wrapper (object with attachments or remoteAttachments array) */
export function isMultiAttachmentWrapper(content: unknown): content is MultiRemoteAttachmentWrapper | MultiRemoteStaticAttachmentWrapper {
  if (typeof content !== 'object' || content === null) return false;

  // Check for 'attachments' property
  if ('attachments' in content) {
    const wrapper = content as { attachments: unknown };
    return Array.isArray(wrapper.attachments) &&
           wrapper.attachments.length > 0 &&
           wrapper.attachments.every(isAttachmentLike);
  }

  // Check for 'remoteAttachments' property (World App format)
  if ('remoteAttachments' in content) {
    const wrapper = content as { remoteAttachments: unknown };
    return Array.isArray(wrapper.remoteAttachments) &&
           wrapper.remoteAttachments.length > 0 &&
           wrapper.remoteAttachments.every(isAttachmentLike);
  }

  return false;
}

/** Extract the array from a wrapper object */
function extractFromWrapper(content: object): RemoteAttachmentContent[] | null {
  if ('attachments' in content) {
    const wrapper = content as { attachments: unknown };
    if (Array.isArray(wrapper.attachments)) {
      return wrapper.attachments.filter(isAttachmentLike);
    }
  }
  if ('remoteAttachments' in content) {
    const wrapper = content as { remoteAttachments: unknown };
    if (Array.isArray(wrapper.remoteAttachments)) {
      return wrapper.remoteAttachments.filter(isAttachmentLike);
    }
  }
  return null;
}

/** Extract attachments from various multi-attachment formats */
export function extractAttachments(content: unknown): RemoteAttachmentContent[] | null {
  // Direct array
  if (isMultiAttachment(content)) {
    return content;
  }
  // Wrapper object with attachments or remoteAttachments property
  if (typeof content === 'object' && content !== null) {
    const fromWrapper = extractFromWrapper(content);
    if (fromWrapper && fromWrapper.length > 0) {
      return fromWrapper;
    }
  }
  // Single attachment as array
  if (isSingleAttachment(content)) {
    return [content];
  }
  return null;
}

/** Check if content is a single remote attachment */
export function isSingleAttachment(content: unknown): content is RemoteAttachmentContent {
  return typeof content === 'object' &&
    content !== null &&
    'contentDigest' in content &&
    'url' in content &&
    !Array.isArray(content);
}
