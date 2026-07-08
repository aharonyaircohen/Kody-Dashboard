/**
 * @fileType module
 * @domain client-chat
 * @pattern i18n-catalog
 * @ai-summary Client-surface strings routed through the chat platform catalog
 *   (plan H7, Step 5.5). Only the /client surface's own user-facing strings
 *   live here — admin surface strings are deliberately NOT cataloged in this
 *   step. En-only: every locale gets the en defaults today; per-locale
 *   translations layer in via `catalog.register` later.
 */

import {
  createChatCatalog,
  type ChatMessageCatalog,
} from "./chat/platform/i18n";

const EN_CLIENT_SURFACE_MESSAGES: Readonly<Record<string, string>> = {
  "chat.client.metaTitle": "{brand} Chat",
  "chat.client.metaDescription": "Chat with {brand}.",
  "chat.client.chatRegionLabel": "Kody chat",
};

export function getClientSurfaceCatalog(locale = "en"): ChatMessageCatalog {
  return createChatCatalog(locale, EN_CLIENT_SURFACE_MESSAGES);
}
