/**
 * @fileType util
 * @domain kody
 * @pattern shared-slug
 * @ai-summary Shared normalization for state-repo file slugs.
 */

export interface SlugifyOptions {
  maxLength?: number;
  fallback?: string;
  allowUnderscore?: boolean;
  stripDiacritics?: boolean;
  splitCamelCase?: boolean;
  trimLeadingUnderscores?: boolean;
}

export function slugifyTitle(
  title: string,
  {
    maxLength = 64,
    fallback = "",
    allowUnderscore = true,
    stripDiacritics = false,
    splitCamelCase = false,
    trimLeadingUnderscores = false,
  }: SlugifyOptions = {},
): string {
  const source = stripDiacritics
    ? title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    : title;
  const cased = splitCamelCase
    ? source.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    : source;
  const allowed = allowUnderscore ? /[^a-z0-9_-]+/g : /[^a-z0-9-]+/g;
  const edge = allowUnderscore ? /^[-_]+|[-_]+$/g : /^-+|-+$/g;
  let slug = cased
    .trim()
    .toLowerCase()
    .replace(allowed, "-")
    .replace(edge, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLength)
    .replace(edge, "");

  if (trimLeadingUnderscores) {
    slug = slug.replace(/^_+/, "").replace(edge, "");
  }

  return slug || fallback;
}

export function normalizeSlug(
  input: string,
  fallbackPrefix: string,
  options: SlugifyOptions = {},
): string {
  const slug = slugifyTitle(input, options);
  if (slug) return slug;

  return `${fallbackPrefix}-${Date.now().toString(36)}`.slice(
    0,
    options.maxLength ?? 64,
  );
}
