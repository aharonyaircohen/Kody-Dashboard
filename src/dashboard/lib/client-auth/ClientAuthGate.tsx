/**
 * @fileType component
 * @domain client-auth
 * @pattern branded-signin-gate
 * @ai-summary Server-rendered sign-in / access-denied screens for gated
 *   client brands. Mirrors the ClientChatSurface shell (same header, theme
 *   tokens, and locale direction) so the gate feels like the brand page it
 *   protects. Uses Auth.js server actions (signIn/signOut) — no client JS.
 */
import { Zap } from "lucide-react";

import type { ClientBrand } from "../client-brand";
import { directionForLocale } from "@kody-ade/kody-chat/platform/i18n";
import type { ClientAuthProvider } from "./allowlist";
import { providerLabel } from "./catalog";
import { signIn, signOut } from "./auth";
import { getClientSurfaceCatalog } from "../client-chat-strings";

interface ClientAuthGateProps {
  brand: ClientBrand;
  callbackUrl: string;
  /** Configured sign-in methods to offer (chooser state). */
  providers?: ClientAuthProvider[];
  /** Signed-in email that failed the allowlist; absent = not signed in. */
  deniedEmail?: string;
  /** True when no provider credentials are configured server-side. */
  misconfigured?: boolean;
  /** Resolved language pack for the brand's locale (languages/<code>.json). */
  languageStrings?: Record<string, string>;
}

export function ClientAuthGate({
  brand,
  callbackUrl,
  providers = ["google"],
  deniedEmail,
  misconfigured,
  languageStrings,
}: ClientAuthGateProps) {
  const catalog = getClientSurfaceCatalog(
    brand.locale ?? "en",
    languageStrings,
  );
  const packDir = catalog.t("chat.client.dir");
  const dir =
    packDir === "rtl" || packDir === "ltr"
      ? packDir
      : directionForLocale(brand.locale ?? "en");
  return (
    <main
      data-testid="client-auth-gate"
      dir={dir}
      className="flex h-dvh min-h-dvh flex-col bg-background text-foreground"
    >
      <header className="shrink-0 border-b border-border bg-background px-4 py-3">
        <div className="flex w-full items-center gap-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white shadow-sm"
            style={{ backgroundColor: brand.accent }}
            aria-hidden="true"
          >
            <Zap className="h-4 w-4" />
          </span>
          <span className="truncate text-base font-semibold">
            {brand.name}
          </span>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          {misconfigured ? (
            <>
              <p className="text-sm text-muted-foreground">
                {catalog.t("chat.client.auth.misconfigured")}
              </p>
              <p className="mt-3 text-xs text-muted-foreground/70">
                {catalog.t("chat.client.auth.adminHint")}
              </p>
            </>
          ) : deniedEmail ? (
            <>
              <p className="text-sm text-muted-foreground">
                {catalog.t("chat.client.auth.denied", { email: deniedEmail })}
              </p>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: callbackUrl });
                }}
              >
                <GateButton
                  accent={brand.accent}
                  label={catalog.t("chat.client.auth.switchAccount")}
                />
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {catalog.t("chat.client.auth.signIn")}
              </p>
              {providers.map((provider) => (
                <form
                  key={provider}
                  action={async () => {
                    "use server";
                    await signIn(provider, { redirectTo: callbackUrl });
                  }}
                >
                  <GateButton
                    accent={brand.accent}
                    label={catalog.t("chat.client.auth.continueWith", {
                      provider: providerLabel(provider),
                    })}
                  />
                </form>
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function GateButton({ accent, label }: { accent: string; label: string }) {
  return (
    <button
      type="submit"
      className="mt-4 w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
      style={{ backgroundColor: accent }}
    >
      {label}
    </button>
  );
}
