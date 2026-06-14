/**
 * @fileType error-boundary
 * @domain kody
 * @pattern next-global-error-boundary
 * @ai-summary Last-resort error boundary — catches errors thrown by the root
 *   layout, providers, and chat-rail shell. Without this, those errors render
 *   a blank page because `app/error.tsx` only catches errors in children of
 *   the root layout, not the layout itself. Must render its own <html>/<body>.
 */
"use client";

import { useEffect } from "react";

export default function KodyGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[KodyDashboard] Global error:", error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <div
            style={{
              fontSize: 40,
              marginBottom: 12,
            }}
            aria-hidden
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            The dashboard crashed
          </h1>
          <p style={{ color: "#a3a3a3", margin: "0 0 16px", fontSize: 14 }}>
            A fatal error happened before the UI could load. Try again, or
            reload the page.
          </p>
          {error.digest && (
            <p
              style={{
                color: "#737373",
                fontSize: 12,
                margin: "0 0 16px",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
              }}
            >
              ref: {error.digest}
            </p>
          )}
          {isDev && error.message && (
            <pre
              style={{
                textAlign: "left",
                background: "#171717",
                color: "#fca5a5",
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                overflow: "auto",
                maxHeight: 160,
                margin: "0 0 16px",
              }}
            >
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{
                background: "#fafafa",
                color: "#0a0a0a",
                border: "none",
                padding: "8px 16px",
                borderRadius: 6,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "transparent",
                color: "#fafafa",
                border: "1px solid #404040",
                padding: "8px 16px",
                borderRadius: 6,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
