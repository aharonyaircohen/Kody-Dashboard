/**
 * @fileType module
 * @domain client-chat
 * @pattern i18n-catalog
 * @ai-summary Client-surface strings routed through the chat platform catalog
 *   (plan H7, Step 5.5). Only the /client surface's own user-facing strings
 *   live here — admin surface strings are deliberately NOT cataloged. English
 *   defaults ship built-in (kody-chat client-language); per-locale packs from
 *   `languages/<code>.json` layer in as overrides.
 */

import {
  createChatCatalog,
  type ChatMessageCatalog,
} from "@kody-ade/kody-chat/platform/i18n";
import { EN_CLIENT_LANGUAGE } from "@kody-ade/kody-chat/client-language";

export function getClientSurfaceCatalog(
  locale = "en",
  overrides?: Record<string, string>,
): ChatMessageCatalog {
  return createChatCatalog(locale, {
    ...EN_CLIENT_LANGUAGE.strings,
    ...(overrides ?? {}),
  });
}
