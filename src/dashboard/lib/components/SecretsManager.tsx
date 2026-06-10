/**
 * @fileType component
 * @domain vault
 * @pattern secrets-manager
 * @ai-summary CRUD UI for the dashboard secrets vault. Per-repo encrypted
 *   vault stored at .kody/secrets.enc in the connected GitHub repo. Values
 *   are write-only after creation — the GitHub Contents API returns
 *   ciphertext only and the server never echoes plaintext back to the client.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { AuthGuard } from "../auth-guard";
import { useAuth, buildAuthHeaders } from "../auth-context";

interface SecretRow {
  name: string;
  updatedAt: string;
  updatedBy?: string;
}

interface SecretValue {
  name: string;
  value: string;
  updatedAt: string;
  updatedBy?: string;
}

async function unlockVault(
  headers: Record<string, string>,
  key: string,
): Promise<SecretValue[]> {
  const res = await fetch("/api/kody/secrets/vault", {
    method: "POST",
    headers,
    body: JSON.stringify({ key }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    secrets?: SecretValue[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.secrets ?? [];
}

const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

const secretsQueryKey = ["kody-secrets"] as const;

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

async function listSecrets(
  headers: Record<string, string>,
): Promise<SecretRow[]> {
  const res = await fetch("/api/kody/secrets", { headers });
  const json = (await res.json().catch(() => ({}))) as {
    secrets?: SecretRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.secrets ?? [];
}

async function upsertSecret(
  headers: Record<string, string>,
  name: string,
  value: string,
  actorLogin?: string,
): Promise<void> {
  const res = await fetch("/api/kody/secrets", {
    method: "POST",
    headers,
    body: JSON.stringify({ name, value, actorLogin }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

async function deleteSecret(
  headers: Record<string, string>,
  name: string,
): Promise<void> {
  const res = await fetch(`/api/kody/secrets/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

export function SecretsManager() {
  return (
    <AuthGuard>
      <SecretsManagerInner />
    </AuthGuard>
  );
}

function SecretsManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<SecretRow[]>({
    queryKey: secretsQueryKey,
    queryFn: () => listSecrets(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  // POOL_MIN is per-repo Fly config managed on /runner, not a credential.
  const secrets = (data ?? []).filter((s) => s.name !== "POOL_MIN");

  const upsert = useMutation({
    mutationFn: (input: { name: string; value: string }) =>
      upsertSecret(headers, input.name, input.value, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: secretsQueryKey });
      toast.success("Secret saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save secret"),
  });

  const remove = useMutation({
    mutationFn: (name: string) => deleteSecret(headers, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: secretsQueryKey });
      toast.success("Secret deleted");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete secret"),
  });

  async function handleUnlock() {
    if (!unlockKey.trim()) return;
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const secrets = await unlockVault(headers, unlockKey);
      setUnlockedSecrets(secrets);
      setUnlocked(true);
    } catch (err) {
      setUnlockError(
        err instanceof Error ? err.message : "Failed to unlock vault",
      );
    } finally {
      setIsUnlocking(false);
    }
  }

  const [editing, setEditing] = useState<{
    name: string;
    existing: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedSecrets, setUnlockedSecrets] = useState<SecretValue[]>([]);
  const [unlockKey, setUnlockKey] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);

  return (
    <PageShell
      title="Secrets"
      icon={KeyRound}
      iconClassName="text-amber-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/secrets/docs" aria-label="Vault docs">
              <BookOpen className="w-4 h-4" />
              Docs
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => setEditing({ name: "", existing: false })}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            New secret
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading secrets…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load secrets
              </p>
              <p className="text-rose-200/70 mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && secrets.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <ShieldCheck className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No secrets stored yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Secrets are AES-256-GCM-encrypted and stored at{" "}
                <code className="text-white/55">.kody/secrets.enc</code> in this
                repo. Use them in place of Vercel env vars — the dashboard reads
                them at request time.
              </p>
              <Button
                size="sm"
                onClick={() => setEditing({ name: "", existing: false })}
                className="gap-1"
              >
                <Plus className="w-4 h-4" />
                Add your first secret
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Unlock card — shown when vault is locked and secrets exist */}
        {!unlocked && !isLoading && !error && secrets.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-950/10">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-sm text-amber-200">
                  Enter your master key to reveal secret values
                </p>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={unlockKey}
                    onChange={(e) => setUnlockKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUnlock();
                    }}
                    placeholder="KODY_MASTER_KEY"
                    className="pr-10 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={handleUnlock}
                  disabled={isUnlocking || !unlockKey.trim()}
                >
                  {isUnlocking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Unlock"
                  )}
                </Button>
              </div>
              {unlockError && (
                <p className="text-xs text-rose-300">{unlockError}</p>
              )}
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {(unlocked ? unlockedSecrets : secrets).map((s) => (
            <li key={s.name}>
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-white/90 truncate">
                      {s.name}
                    </p>
                    {unlocked ? (
                      <p className="font-mono text-[11px] text-emerald-300 mt-0.5 truncate">
                        {(s as SecretValue).value}
                      </p>
                    ) : (
                      <p className="text-[11px] text-white/40 mt-0.5">
                        Updated {formatRelative(s.updatedAt)}
                        {s.updatedBy ? ` by ${s.updatedBy}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {unlocked ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-amber-300"
                        onClick={() => {
                          setUnlocked(false);
                          setUnlockedSecrets([]);
                          setUnlockKey("");
                          setUnlockError(null);
                        }}
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        Lock
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          onClick={() =>
                            setEditing({ name: s.name, existing: true })
                          }
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-rose-300 hover:text-rose-200"
                          onClick={() => setDeleting(s.name)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-white/30 pt-4">
          Values are encrypted at rest with AES-256-GCM using{" "}
          <code className="text-white/50">KODY_MASTER_KEY</code> from Vercel
          env. Rotating the key invalidates the entire vault — back up secrets
          before rotating.
        </p>
      </div>

      {editing && (
        <SecretEditor
          initialName={editing.name}
          isUpdate={editing.existing}
          onClose={() => setEditing(null)}
          onSave={(name, value) =>
            upsert.mutateAsync({ name, value }).then(() => setEditing(null))
          }
          saving={upsert.isPending}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting}?`}
        description="The secret is removed from the vault and any code reading it will fall back to environment variables."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </PageShell>
  );
}

interface SecretEditorProps {
  initialName: string;
  isUpdate: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string, value: string) => Promise<void>;
}

function SecretEditor({
  initialName,
  isUpdate,
  saving,
  onClose,
  onSave,
}: SecretEditorProps) {
  const [name, setName] = useState(initialName);
  const [value, setValue] = useState("");
  const [touchedName, setTouchedName] = useState(false);

  const nameError = (() => {
    if (!touchedName && !isUpdate) return null;
    if (!name) return "Required";
    if (!NAME_RE.test(name))
      return "Use uppercase letters, digits, underscores. Start with a letter.";
    return null;
  })();

  const valueError = value.length === 0 ? "Required" : null;
  const canSave = !saving && !nameError && !valueError;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isUpdate ? `Edit ${initialName}` : "New secret"}
          </DialogTitle>
          <DialogDescription>
            Stored encrypted in <code>.kody/secrets.enc</code>. Existing values
            aren&apos;t shown — saving overwrites the current value.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label htmlFor="secret-name" className="text-xs">
              Name
            </Label>
            <Input
              id="secret-name"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              onBlur={() => setTouchedName(true)}
              disabled={isUpdate}
              placeholder="AI_GATEWAY_API_KEY"
              className="font-mono"
            />
            {nameError && (
              <p className="text-xs text-rose-300 mt-1">{nameError}</p>
            )}
          </div>
          <div>
            <Label htmlFor="secret-value" className="text-xs">
              Value
            </Label>
            <Textarea
              id="secret-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                isUpdate
                  ? "Enter new value to overwrite…"
                  : "Paste the secret value"
              }
              className="font-mono text-xs"
              rows={4}
              autoFocus
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => {
              if (canSave) onSave(name, value);
            }}
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                Saving…
              </>
            ) : isUpdate ? (
              "Update"
            ) : (
              "Create"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
