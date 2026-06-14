/**
 * @fileType component
 * @domain kody
 * @pattern engine-config-cards
 * @ai-summary Company-page cards for the repo-wide engine config fields that
 *   don't have their own page: quality verification commands, comment aliases,
 *   the `@kody` access gate (`access.allowedAssociations`), and the default
 *   branch (`git.defaultBranch`). One `useEngineConfig` instance loads the
 *   slice once; each card edits its part and saves a partial patch the server
 *   merges. Mirrors OperatorsCard's chrome.
 */
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  X,
  Terminal,
  Shield,
  GitBranch,
  ArrowRightLeft,
} from "lucide-react";
import { Card, CardContent } from "@dashboard/ui/card";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { cn } from "../utils";
import {
  useEngineConfig,
  type UseEngineConfig,
} from "../engine/useEngineConfig";
import type { EngineEditableConfig } from "../api";

/** GitHub author associations the access gate accepts (display order).
 * Canonical validation lives server-side in engine/config.ts. */
const ASSOCIATIONS = [
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIME_CONTRIBUTOR",
  "NONE",
] as const;

const QUALITY_FIELDS: {
  key: keyof EngineEditableConfig["quality"];
  label: string;
  placeholder: string;
}[] = [
  { key: "typecheck", label: "Type check", placeholder: "pnpm typecheck" },
  { key: "lint", label: "Lint", placeholder: "pnpm lint" },
  { key: "format", label: "Format", placeholder: "pnpm format:check" },
  { key: "testUnit", label: "Unit tests", placeholder: "pnpm test" },
];

export function EngineConfigCards() {
  const cfg = useEngineConfig();
  return (
    <>
      <QualityCommandsCard cfg={cfg} />
      <AccessGateCard cfg={cfg} />
      <DefaultBranchCard cfg={cfg} />
      <AliasesCard cfg={cfg} />
    </>
  );
}

function CardHeader({
  icon: Icon,
  iconClass,
  title,
  children,
}: {
  icon: typeof Terminal;
  iconClass: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-white/90 flex items-center gap-2">
        <Icon className={cn("w-4 h-4", iconClass)} />
        {title}
      </p>
      <p className="text-xs text-white/50 mt-1">{children}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-xs text-white/40">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      Loading…
    </div>
  );
}

// ─── Quality commands ──────────────────────────────────────────────────────

function QualityCommandsCard({ cfg }: { cfg: UseEngineConfig }) {
  const { config, loading, saving, save } = cfg;
  const [draft, setDraft] = useState<EngineEditableConfig["quality"]>({});

  useEffect(() => {
    if (config) setDraft(config.quality);
  }, [config]);

  const dirty =
    !!config &&
    QUALITY_FIELDS.some(
      (f) => (draft[f.key] ?? "") !== (config.quality[f.key] ?? ""),
    );

  async function handleSave() {
    try {
      await save({ quality: draft });
      toast.success("Quality commands saved");
    } catch {
      toast.error("Couldn't save quality commands");
    }
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-3">
        <CardHeader
          icon={Terminal}
          iconClass="text-sky-400"
          title="Quality commands"
        >
          The commands Kody runs to verify its own work. Leave a field blank to
          skip that check.
        </CardHeader>
        {loading ? (
          <Loading />
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {QUALITY_FIELDS.map((f) => (
                <label key={f.key} className="space-y-1">
                  <span className="text-xs text-white/50">{f.label}</span>
                  <Input
                    value={draft[f.key] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                    disabled={saving}
                    className="h-8 text-sm font-mono"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Access gate ─────────────────────────────────────────────────────────────

function AccessGateCard({ cfg }: { cfg: UseEngineConfig }) {
  const { config, loading, saving, save } = cfg;
  const selected = new Set(config?.allowedAssociations ?? []);

  async function toggle(assoc: string) {
    const next = new Set(selected);
    if (next.has(assoc)) next.delete(assoc);
    else next.add(assoc);
    try {
      await save({ allowedAssociations: Array.from(next) });
    } catch {
      toast.error("Couldn't save access gate");
    }
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-3">
        <CardHeader
          icon={Shield}
          iconClass="text-amber-400"
          title="Who can trigger @kody"
        >
          Restrict <code className="text-white/70">@kody</code> to these GitHub
          author associations. None selected = engine default (team only:
          owners, members, collaborators). Add{" "}
          <code className="text-white/70">NONE</code> /{" "}
          <code className="text-white/70">CONTRIBUTOR</code> to open it to
          outside commenters.
        </CardHeader>
        {loading ? (
          <Loading />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {ASSOCIATIONS.map((a) => {
                const on = selected.has(a);
                return (
                  <button
                    key={a}
                    type="button"
                    disabled={saving}
                    onClick={() => void toggle(a)}
                    className={cn(
                      "px-2 py-1 rounded border text-xs transition-colors disabled:opacity-50",
                      on
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
                        : "border-white/10 text-white/50 hover:text-white/80",
                    )}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-white/40">
              Currently active:{" "}
              <span className="text-white/70">
                {selected.size > 0
                  ? Array.from(selected).join(", ")
                  : "OWNER, MEMBER, COLLABORATOR (engine default)"}
              </span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Default branch ──────────────────────────────────────────────────────────

function DefaultBranchCard({ cfg }: { cfg: UseEngineConfig }) {
  const { config, loading, saving, save } = cfg;
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (config) setDraft(config.defaultBranch);
  }, [config]);

  const dirty = !!config && draft.trim() !== config.defaultBranch;

  async function handleSave() {
    try {
      await save({ defaultBranch: draft.trim() });
      toast.success("Default branch saved");
    } catch {
      toast.error("Couldn't save default branch");
    }
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-3">
        <CardHeader
          icon={GitBranch}
          iconClass="text-emerald-400"
          title="Default branch"
        >
          The base branch new work branches off and targets. Blank = engine
          default (<code className="text-white/70">main</code>).
        </CardHeader>
        {loading ? (
          <Loading />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && dirty) {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                placeholder="main"
                disabled={saving}
                className="h-8 text-sm font-mono max-w-xs"
              />
              <Button
                size="sm"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            <p className="text-[11px] text-white/40">
              Currently:{" "}
              <span className="text-white/70 font-mono">
                {config?.defaultBranch?.trim() || "main (engine default)"}
              </span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Aliases ─────────────────────────────────────────────────────────────────

function AliasesCard({ cfg }: { cfg: UseEngineConfig }) {
  const { config, loading, saving, save } = cfg;
  const [alias, setAlias] = useState("");
  const [target, setTarget] = useState("");
  const entries = Object.entries(config?.aliases ?? {});

  async function persist(next: Record<string, string>) {
    try {
      await save({ aliases: next });
    } catch {
      toast.error("Couldn't save aliases");
    }
  }

  async function handleAdd() {
    const a = alias.trim().replace(/^@+/, "");
    const t = target.trim();
    if (!a || !t) return;
    await persist({ ...(config?.aliases ?? {}), [a]: t });
    setAlias("");
    setTarget("");
  }

  async function handleRemove(key: string) {
    const next = { ...(config?.aliases ?? {}) };
    delete next[key];
    await persist(next);
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-3">
        <CardHeader
          icon={ArrowRightLeft}
          iconClass="text-violet-400"
          title="Comment aliases"
        >
          Map a word to a subcommand, e.g.{" "}
          <code className="text-white/70">build → run</code> lets{" "}
          <code className="text-white/70">@kody build</code> dispatch the{" "}
          <code className="text-white/70">run</code> executable.
        </CardHeader>
        {loading ? (
          <Loading />
        ) : (
          <>
            {entries.length > 0 && (
              <ul className="space-y-1.5">
                {entries.map(([key, val]) => (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-sm text-white/80"
                  >
                    <span className="truncate font-mono">
                      {key} <span className="text-white/30">→</span> {val}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove alias ${key}`}
                      disabled={saving}
                      onClick={() => void handleRemove(key)}
                      className="text-white/30 hover:text-rose-300 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="alias (e.g. build)"
                disabled={saving}
                className="h-8 text-sm font-mono"
              />
              <span className="text-white/30">→</span>
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAdd();
                  }
                }}
                placeholder="executable (e.g. run)"
                disabled={saving}
                className="h-8 text-sm font-mono"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={saving || !alias.trim() || !target.trim()}
                onClick={() => void handleAdd()}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>
            {entries.length === 0 && (
              <p className="text-[11px] text-white/40">
                No custom aliases. Built-ins (e.g.{" "}
                <code className="text-white/60">build → run</code>) always
                apply.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
