/**
 * @fileType module
 * @domain chat-platform
 * @pattern i18n-catalog
 * @ai-summary Minimal locale layer (plan H7 — lands in Step 1 so Steps 2–5
 *   extract strings into it in one touch). En-only for now: a flat
 *   catalog with namespaced keys (`plugin.<id>.<key>`, `chat.core.<key>`),
 *   `t()` with {param} substitution, fallback to the key itself, and a
 *   locale→direction helper for the Step 5.5 RTL work.
 */

export type ChatTextDirection = "ltr" | "rtl";

const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

export function directionForLocale(locale: string): ChatTextDirection {
  const lang = locale.toLowerCase().split(/[-_]/)[0] ?? "";
  return RTL_LOCALES.has(lang) ? "rtl" : "ltr";
}

export interface ChatMessageCatalog {
  readonly locale: string;
  /** Registers messages; re-registering an existing key throws (collisions
   *  are bugs, not preferences). */
  register(messages: Readonly<Record<string, string>>): void;
  has(key: string): boolean;
  t(key: string, params?: Readonly<Record<string, string | number>>): string;
}

export class ChatCatalogCollisionError extends Error {
  constructor(readonly key: string) {
    super(`i18n key already registered: "${key}"`);
    this.name = "ChatCatalogCollisionError";
  }
}

function substitute(
  template: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function createChatCatalog(
  locale = "en",
  base?: Readonly<Record<string, string>>,
): ChatMessageCatalog {
  const messages = new Map<string, string>(Object.entries(base ?? {}));

  return {
    locale,

    register(next) {
      for (const [key, value] of Object.entries(next)) {
        if (messages.has(key)) throw new ChatCatalogCollisionError(key);
        messages.set(key, value);
      }
    },

    has(key) {
      return messages.has(key);
    },

    t(key, params) {
      const template = messages.get(key);
      // Fallback to the key itself: visible-but-safe for unlocalized keys.
      return substitute(template ?? key, params);
    },
  };
}
