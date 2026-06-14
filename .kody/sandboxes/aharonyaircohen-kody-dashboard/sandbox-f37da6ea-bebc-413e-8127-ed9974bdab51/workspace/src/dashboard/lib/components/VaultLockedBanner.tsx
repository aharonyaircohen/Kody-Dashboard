/**
 * @fileType component
 * @domain vault
 * @pattern vault-locked-banner
 * @ai-summary Red banner shown wherever a vault-backed feature silently breaks
 *   because the secrets vault can't be read. Distinguishes "can't decrypt"
 *   (wrong master key) from "not configured" (no master key), gives a plain-
 *   language fix, AND prints the raw server error so the real failure isn't
 *   hidden. Renders nothing when the vault reads fine.
 */
"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { useVaultStatus } from "../hooks/useVaultStatus";

interface VaultLockedBannerProps {
  /** Optional context line, e.g. "Fly previews are off until this is fixed." */
  feature?: string;
  className?: string;
}

export function VaultLockedBanner({
  feature,
  className,
}: VaultLockedBannerProps) {
  const { failed, code, message } = useVaultStatus();
  if (!failed) return null;

  const locked = code === "vault_read_failed";
  const headline = locked
    ? "Can't read your secrets — the master key doesn't match the vault."
    : code === "vault_not_configured"
      ? "Secrets vault isn't configured on the server."
      : "Couldn't read the secrets vault.";

  const fix = locked
    ? "Restore the original KODY_MASTER_KEY, or re-enter your secrets so the vault is re-locked with the current key."
    : code === "vault_not_configured"
      ? "Set KODY_MASTER_KEY in the server environment (pnpm vault:init)."
      : "Open the Secrets page to retry.";

  return (
    <div
      className={`rounded-md border border-rose-500/30 bg-rose-950/20 px-4 py-3 ${className ?? ""}`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-rose-300 mt-0.5 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="text-rose-200 font-medium">{headline}</p>
          {feature && <p className="text-rose-200/70 mt-0.5">{feature}</p>}
          <p className="text-rose-200/70 mt-0.5">{fix}</p>
          {message && (
            <pre className="mt-2 overflow-x-auto rounded bg-black/40 px-2 py-1 text-[11px] text-rose-200/80 whitespace-pre-wrap break-words">
              {code}: {message}
            </pre>
          )}
          <Link
            href="/secrets"
            className="inline-block mt-2 text-xs text-rose-200 underline hover:text-rose-100"
          >
            Open Secrets →
          </Link>
        </div>
      </div>
    </div>
  );
}
