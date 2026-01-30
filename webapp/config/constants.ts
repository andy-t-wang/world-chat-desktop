/**
 * Application Constants
 * Centralized configuration values for the chat application
 */

/** XMTP Configuration */
export const XMTP_CONFIG = {
  /** Default environment */
  DEFAULT_ENV: 'production' as const,
  /** Application version for XMTP client */
  APP_VERSION: '1.0.0',
} as const;

/** Pagination Configuration */
export const PAGINATION = {
  /** Number of messages to load per page */
  MESSAGE_PAGE_SIZE: 50,
  /** Number of conversations to load per page */
  CONVERSATION_PAGE_SIZE: 20,
} as const;

/** Virtualization Configuration */
export const VIRTUALIZATION = {
  /** Estimated height of a message row in pixels */
  MESSAGE_ROW_HEIGHT: 72,
  /** Estimated height of a conversation item in pixels (desktop) */
  CONVERSATION_ITEM_HEIGHT: 68,
  /** Number of items to render beyond visible area */
  OVERSCAN_COUNT: 10,
} as const;

/** Cache Configuration */
export const CACHE = {
  /** Maximum number of messages to keep in memory */
  MAX_MESSAGES_IN_MEMORY: 1000,
  /** Maximum number of conversations to cache */
  MAX_CONVERSATIONS_CACHED: 100,
  /** LRU cache eviction threshold */
  EVICTION_THRESHOLD: 0.9,
} as const;

/** Timing Configuration */
export const TIMING = {
  /** Debounce delay for typing indicators (ms) */
  TYPING_DEBOUNCE_MS: 300,
  /** Timeout for typing indicator display (ms) */
  TYPING_TIMEOUT_MS: 3000,
  /** Retry delay for failed messages (ms) */
  MESSAGE_RETRY_DELAY_MS: 2000,
  /** Maximum retry attempts for failed messages */
  MAX_RETRY_ATTEMPTS: 3,
  /** Stream reconnection delay (ms) */
  STREAM_RECONNECT_DELAY_MS: 1000,
} as const;

/** UI Configuration */
export const UI = {
  /** Maximum message bubble width as percentage */
  MAX_MESSAGE_WIDTH_PERCENT: 70,
  /** Maximum characters for conversation preview */
  CONVERSATION_PREVIEW_MAX_CHARS: 50,
  /** Avatar size in pixels */
  AVATAR_SIZE: 40,
} as const;

/** World App Username API Configuration */
export const USERNAME_API = {
  /** Base URL for the Username API */
  BASE_URL: 'https://usernames.worldcoin.org',
  /** Maximum addresses to query in a single batch request */
  MAX_BATCH_SIZE: 100,
  /** Cache TTL in milliseconds (7 days) for successful lookups */
  CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  /** Cache TTL for null results (1 hour) - shorter so new usernames are found faster */
  NULL_CACHE_TTL_MS: 60 * 60 * 1000,
  /** Maximum usernames to cache */
  MAX_CACHE_SIZE: 500,
} as const;

/** Image Cache Configuration */
export const IMAGE_CACHE = {
  /** Trusted CDN for image downloads */
  TRUSTED_CDN: 'https://chat-assets.toolsforhumanity.com',
  /** Maximum images to keep in memory */
  MAX_CACHE_SIZE: 100,
  /** Cache TTL in milliseconds (24 hours) */
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  /** localStorage key for image metadata */
  STORAGE_KEY: 'worldchat_images',
  /** Storage version for migration */
  STORAGE_VERSION: 1,
} as const;

/** Local Storage Keys */
export const STORAGE_KEYS = {
  /** Key for storing encryption salt */
  ENCRYPTION_SALT: 'xmtp-encryption-salt',
  /** Key for storing wallet connection status */
  WALLET_CONNECTED: 'wallet-connected',
  /** Key for storing selected conversation */
  SELECTED_CONVERSATION: 'selected-conversation',
  /** Key for storing user preferences */
  USER_PREFERENCES: 'user-preferences',
  /** Key for storing cached images metadata */
  IMAGES_CACHE: 'worldchat_images',
} as const;


