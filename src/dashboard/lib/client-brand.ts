/**
 * @fileType data
 * @domain client-chat
 * @pattern client-brand-config
 * @ai-summary Small, route-owned brand config for the client chat surface.
 *   This is display data only; chat behavior stays in KodyChat.
 */

export interface ClientBrand {
  slug: string;
  name: string;
  accent: string;
  /** BCP-47-ish locale tag, normalized lowercase (default "en"). Drives the
   *  surface-root text direction via `directionForLocale` (plan H7). */
  locale?: string;
  /** Optional brand welcome copy, contributed to the chat theme by the
   *  branding plugin (chat/plugins/branding). */
  welcomeText?: string;
}

const DEFAULT_CLIENT_LOCALE = "en";

const KNOWN_CLIENT_BRANDS: Record<string, ClientBrand> = {
  kody: {
    slug: "kody",
    name: "Kody",
    accent: "#0f766e",
  },
  // RTL reference brand (Step 5.5): same Kody surface, Hebrew locale.
  // Pinned by the RTL e2e in tests/e2e/client-chat-surface.spec.ts.
  "kody-he": {
    slug: "kody-he",
    name: "Kody",
    accent: "#0f766e",
    locale: "he",
  },
  // Theming reference brand (Step 6): distinct name + accent, pinned by the
  // branding-plugin e2e in tests/e2e/client-chat-surface.spec.ts.
  acme: {
    slug: "acme",
    name: "Acme",
    accent: "#7c3aed",
  },
};

export function normalizeClientBrandLocale(input?: string): string {
  const normalized = (input ?? "").trim().toLowerCase().replace(/_/g, "-");
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(normalized)
    ? normalized
    : DEFAULT_CLIENT_LOCALE;
}

export function normalizeClientBrandSlug(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized || "kody";
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getClientBrand(slug: string): ClientBrand {
  const normalized = normalizeClientBrandSlug(slug);
  const base = KNOWN_CLIENT_BRANDS[normalized] ?? {
    slug: normalized,
    name: titleFromSlug(normalized),
    accent: "#0f766e",
  };

  return { ...base, locale: normalizeClientBrandLocale(base.locale) };
}
