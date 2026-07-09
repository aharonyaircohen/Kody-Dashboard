/**
 * @fileType data
 * @domain wizards
 * @pattern wizard-registry
 * @ai-summary Registry of available setup wizards. The /setup index lists
 *   these; each runs on its own page at /setup/<slug>. New wizards add an
 *   entry here plus a definition module (see client-signin.ts).
 */
import { CLIENT_SIGNIN_WIZARD_SLUG } from "./client-signin";

export interface WizardRegistryEntry {
  slug: string;
  title: string;
  description: string;
}

export const WIZARD_REGISTRY: readonly WizardRegistryEntry[] = [
  {
    slug: CLIENT_SIGNIN_WIZARD_SLUG,
    title: "Client sign-in",
    description:
      "Connect Google, GitHub, and other sign-in providers for client brand pages.",
  },
];

export function getWizardEntry(slug: string): WizardRegistryEntry | null {
  return WIZARD_REGISTRY.find((entry) => entry.slug === slug) ?? null;
}
