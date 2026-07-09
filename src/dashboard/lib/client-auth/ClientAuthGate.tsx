/**
 * @fileType component
 * @domain client-auth
 * @pattern branded-signin-gate
 * @ai-summary Server-rendered sign-in / access-denied screens for gated
 *   client brands. Uses Auth.js server actions (signIn/signOut) so no client
 *   JS is needed; styling picks up the brand accent.
 */
import type { ClientBrand } from "../client-brand";
import { signIn, signOut } from "./auth";

interface ClientAuthGateProps {
  brand: ClientBrand;
  callbackUrl: string;
  /** Signed-in email that failed the allowlist; absent = not signed in. */
  deniedEmail?: string;
  /** True when Google credentials are missing server-side. */
  misconfigured?: boolean;
}

export function ClientAuthGate({
  brand,
  callbackUrl,
  deniedEmail,
  misconfigured,
}: ClientAuthGateProps) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          width: "min(360px, 90vw)",
          padding: "2rem",
          borderRadius: 16,
          background: "#ffffff",
          boxShadow: "0 4px 24px rgba(15, 23, 42, 0.08)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            margin: "0 auto 0.75rem",
            background: brand.accent,
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "1.1rem",
          }}
        >
          {brand.name.charAt(0).toUpperCase()}
        </div>
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
          {brand.name}
        </h1>

        {misconfigured ? (
          <>
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
              This space requires sign-in, but sign-in isn&apos;t set up yet.
              Please contact whoever manages this space.
            </p>
            <p
              style={{
                marginTop: "0.75rem",
                color: "#94a3b8",
                fontSize: "0.75rem",
              }}
            >
              Admin: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the
              dashboard Secrets page to enable Google sign-in.
            </p>
          </>
        ) : deniedEmail ? (
          <>
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
              {deniedEmail} does not have access to this space.
            </p>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: callbackUrl });
              }}
            >
              <button type="submit" style={buttonStyle(brand.accent)}>
                Switch account
              </button>
            </form>
          </>
        ) : (
          <>
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
              Sign in to continue.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: callbackUrl });
              }}
            >
              <button type="submit" style={buttonStyle(brand.accent)}>
                Continue with Google
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

function buttonStyle(accent: string): React.CSSProperties {
  return {
    marginTop: "1rem",
    width: "100%",
    padding: "0.65rem 1rem",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#ffffff",
    background: accent,
  };
}
