/**
 * RemoveMessageCodec - XMTP content type codec for message-removal control events.
 *
 * This content type is emitted by some clients (for example World App) and is
 * not meant to be rendered as a normal chat message. We still register a codec
 * so the SDK can decode it without logging "No codec found".
 */

import type {
  ContentCodec,
  ContentTypeId,
  EncodedContent,
} from "@xmtp/content-type-primitives";

export const ContentTypeRemoveMessage: ContentTypeId = {
  authorityId: "toolsforhumanity.com",
  typeId: "remove_message",
  versionMajor: 1,
  versionMinor: 0,
  sameAs(id: ContentTypeId): boolean {
    return (
      this.authorityId === id.authorityId &&
      this.typeId === id.typeId &&
      this.versionMajor === id.versionMajor
    );
  },
};

export interface RemoveMessageContent {
  messageId?: string;
  reason?: string;
  raw?: string;
  [key: string]: unknown;
}

export class RemoveMessageCodec implements ContentCodec<RemoveMessageContent> {
  get contentType() {
    return ContentTypeRemoveMessage;
  }

  encode(content: RemoveMessageContent): EncodedContent {
    return {
      type: ContentTypeRemoveMessage,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content ?? {})),
    };
  }

  decode(encodedContent: EncodedContent): RemoveMessageContent {
    const bytes = encodedContent.content;
    if (!bytes || bytes.length === 0) {
      return {};
    }

    const text = new TextDecoder().decode(bytes);
    if (!text) {
      return {};
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as RemoveMessageContent;
      }
    } catch {
      // Not JSON - keep the raw text so callers can inspect if needed.
    }

    return { raw: text };
  }

  fallback(): string {
    return "";
  }

  shouldPush(): boolean {
    return false;
  }
}
