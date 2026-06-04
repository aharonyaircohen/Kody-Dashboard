/**
 * @fileType component
 * @domain executables
 * @pattern executables-manager
 * @ai-summary CRUD UI for custom executables stored at
 *   `.kody/executables/<slug>/` in the connected repo. The engine resolves
 *   these before its own built-ins, so `@kody <slug>` runs them. The editor
 *   is a simple form (describe + prompt + model + tools), plus a skills tab
 *   (paste a `SKILL.md` or import one from a GitHub source) and a scripts tab
 *   (one `*.sh` each). A
 *   Validate button checks the generated profile.json before saving; Run
 *   posts `@kody <slug>` on an issue; "Set default" writes the bare-`@kody`
 *   default into kody.config.json.
 */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Download,
  Loader2,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { ListSearch } from "./ListSearch";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import { Checkbox } from "@dashboard/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dashboard/ui/tabs";
import { ConfirmDialog } from "./ConfirmDialog";
import { AuthGuard } from "../auth-guard";
import { useAuth, buildAuthHeaders } from "../auth-context";
import {
  COMMON_TOOLS,
  composeProfile,
  isValidSlug,
  serializeProfile,
  validateProfile,
  type ExecutableLanding,
  type McpServerSpec,
  type PermissionMode,
} from "../executables/profile";

/** One-line explanation per tool, shown beside its checkbox. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  Read: "Read files in the repo.",
  Write: "Create new files.",
  Edit: "Modify existing files.",
  Bash: "Run shell commands (build, tests, scripts).",
  Grep: "Search file contents.",
  Glob: "Find files by name or pattern.",
  Agent: "Spawn sub-agents to delegate or parallelize work (advanced).",
  "mcp__kody-verify":
    "Gives the agent a 'verify' tool it can call to re-check its work. It does NOT run verify automatically — the agent decides when to call it. PR-landing already runs verify as its own step.",
};

interface ExecutableSkill {
  name: string;
  body: string;
}
interface ExecutableShellScript {
  name: string;
  content: string;
}
interface ExecutableSummary {
  slug: string;
  describe: string;
  landing: ExecutableLanding;
  updatedAt: string | null;
  htmlUrl: string;
  /** Staff member this duty runs as, or null. */
  staff?: string | null;
  /** True when still under the legacy `.kody/executables/` dir. */
  legacy?: boolean;
  /** True for a legacy markdown duty (`.kody/duties/<slug>.md`), pending migration. */
  markdown?: boolean;
}
interface ExecutableDetail extends ExecutableSummary {
  prompt: string;
  model: string;
  permissionMode: PermissionMode;
  tools: string[];
  skills: ExecutableSkill[];
  shellScripts: ExecutableShellScript[];
  mcpServers: McpServerSpec[];
  profileJson: string;
}
interface DefaultsState {
  issue: string | null;
  pr: string | null;
}

const queryKey = ["kody-executables"] as const;

function formatRelative(iso: string): string {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

async function listApi(
  headers: Record<string, string>,
): Promise<{ executables: ExecutableSummary[]; defaults: DefaultsState }> {
  const res = await fetch("/api/kody/executables", { headers });
  const json = (await res.json().catch(() => ({}))) as {
    executables?: ExecutableSummary[];
    defaults?: DefaultsState;
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return {
    executables: json.executables ?? [],
    defaults: json.defaults ?? { issue: null, pr: null },
  };
}

async function readApi(
  headers: Record<string, string>,
  slug: string,
): Promise<ExecutableDetail> {
  const res = await fetch(`/api/kody/executables/${encodeURIComponent(slug)}`, {
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as {
    executable?: ExecutableDetail;
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.executable)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return json.executable;
}

interface SavePayload {
  slug: string;
  describe: string;
  prompt: string;
  model: string;
  permissionMode: PermissionMode;
  tools: string[];
  skills: ExecutableSkill[];
  shellScripts: ExecutableShellScript[];
  mcpServers: McpServerSpec[];
  landing: ExecutableLanding;
  isUpdate: boolean;
}

async function saveApi(
  headers: Record<string, string>,
  payload: SavePayload,
  actorLogin?: string,
): Promise<void> {
  const { slug, isUpdate, ...rest } = payload;
  const url = isUpdate
    ? `/api/kody/executables/${encodeURIComponent(slug)}`
    : "/api/kody/executables";
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers,
    body: JSON.stringify(
      isUpdate ? { ...rest, actorLogin } : { slug, ...rest, actorLogin },
    ),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
}

async function deleteApi(
  headers: Record<string, string>,
  slug: string,
): Promise<void> {
  const res = await fetch(`/api/kody/executables/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
}

async function setDefaultApi(
  headers: Record<string, string>,
  slug: string,
  target: "issue" | "pr",
  clear: boolean,
  actorLogin?: string,
): Promise<void> {
  const res = await fetch(
    `/api/kody/executables/${encodeURIComponent(slug)}/default`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ target, clear, actorLogin }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
}

async function runApi(
  headers: Record<string, string>,
  slug: string,
  issue: number,
  actorLogin?: string,
): Promise<string> {
  const res = await fetch(
    `/api/kody/executables/${encodeURIComponent(slug)}/run`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ issue, actorLogin }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    commentUrl?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return json.commentUrl ?? "";
}

export function ExecutablesManager() {
  return (
    <AuthGuard>
      <ExecutablesManagerInner />
    </AuthGuard>
  );
}

/**
 * Standalone editor page for `/executables/new` (slug=null) and
 * `/executables/<slug>`. Owns the save mutation and returns to the list on
 * save/back via the router — so the browser Back button lands on the list,
 * not wherever you were before opening the dashboard.
 */
export function ExecutableEditorPage({ slug }: { slug: string | null }) {
  return (
    <AuthGuard>
      <ExecutableEditorPageInner slug={slug} />
    </AuthGuard>
  );
}

function ExecutableEditorPageInner({ slug }: { slug: string | null }) {
  const { auth } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;

  const { data } = useQuery({
    queryKey,
    queryFn: () => listApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const existingSlugs = new Set((data?.executables ?? []).map((e) => e.slug));

  const save = useMutation({
    mutationFn: (payload: SavePayload) => saveApi(headers, payload, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Duty saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save"),
  });

  const back = () => router.push("/duties");

  return (
    <PageShell
      title={slug ? `Edit @kody ${slug}` : "New duty"}
      icon={Boxes}
      iconClassName="text-amber-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
    >
      <ExecutableEditor
        slug={slug}
        headers={headers}
        existingSlugs={existingSlugs}
        saving={save.isPending}
        onClose={back}
        onSave={async (payload) => {
          await save.mutateAsync(payload);
          back();
        }}
      />
    </PageShell>
  );
}

function ExecutablesManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => listApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const executables = useMemo(() => data?.executables ?? [], [data]);
  const defaults = data?.defaults ?? { issue: null, pr: null };

  const remove = useMutation({
    mutationFn: (slug: string) => deleteApi(headers, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Duty deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete"),
  });

  const setDefault = useMutation({
    mutationFn: (v: { slug: string; target: "issue" | "pr"; clear: boolean }) =>
      setDefaultApi(headers, v.slug, v.target, v.clear, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Default updated");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to set default"),
  });

  const run = useMutation({
    mutationFn: (v: { slug: string; issue: number }) =>
      runApi(headers, v.slug, v.issue, actorLogin),
    onSuccess: (url) =>
      toast.success(url ? "Dispatched — comment posted" : "Dispatched"),
    onError: (err: Error) => toast.error(err.message || "Failed to run"),
  });

  const [deleting, setDeleting] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return executables;
    return executables.filter(
      (e) =>
        e.slug.toLowerCase().includes(q) ||
        e.describe.toLowerCase().includes(q),
    );
  }, [executables, search]);

  return (
    <PageShell
      title="Duties"
      icon={Boxes}
      iconClassName="text-amber-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <Button asChild size="sm" className="gap-1">
          <Link href="/executables/new">
            <Plus className="w-4 h-4" />
            New duty
          </Link>
        </Button>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading duties…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load duties
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

        {!isLoading && !error && executables.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No duties yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                A duty is a staffed{" "}
                <code className="text-white/55">@kody &lt;slug&gt;</code> action
                stored at{" "}
                <code className="text-white/55">
                  .kody/duties/&lt;slug&gt;/
                </code>{" "}
                in this repo. The engine runs it as its staff member.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && executables.length > 0 && (
          <ListSearch
            value={search}
            onChange={setSearch}
            placeholder="Search duties…"
            ariaLabel="Search duties"
            accent="teal"
          />
        )}

        <ul className="space-y-2">
          {filtered.map((e) => {
            const isIssueDefault = defaults.issue === e.slug;
            const isPrDefault = defaults.pr === e.slug;
            return (
              <li key={e.slug}>
                <Card className="border-white/[0.08] bg-white/[0.03]">
                  <CardContent className="p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono text-sm text-white/90 truncate">
                          @kody {e.slug}
                        </p>
                        <span className="text-[10px] uppercase tracking-wide bg-white/[0.06] text-white/50 px-1.5 py-0.5 rounded">
                          {e.landing === "pr" ? "opens PR" : "comments"}
                        </span>
                        {e.staff && (
                          <span className="text-[10px] uppercase tracking-wide bg-emerald-500/15 text-emerald-300/90 px-1.5 py-0.5 rounded">
                            runs as {e.staff}
                          </span>
                        )}
                        {e.legacy && (
                          <span className="text-[10px] uppercase tracking-wide bg-orange-500/15 text-orange-300/90 px-1.5 py-0.5 rounded">
                            {e.markdown ? "legacy .md" : "legacy"}
                          </span>
                        )}
                        {isIssueDefault && (
                          <span className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-300/90 px-1.5 py-0.5 rounded">
                            issue default
                          </span>
                        )}
                        {isPrDefault && (
                          <span className="text-[10px] uppercase tracking-wide bg-sky-500/15 text-sky-300/90 px-1.5 py-0.5 rounded">
                            PR default
                          </span>
                        )}
                      </div>
                      {e.describe && (
                        <p className="text-xs text-white/60 mt-1 truncate">
                          {e.describe}
                        </p>
                      )}
                      {e.updatedAt && (
                        <p className="text-[11px] text-white/40 mt-0.5">
                          Updated {formatRelative(e.updatedAt)}
                        </p>
                      )}
                      {e.markdown ? (
                        <p className="text-[11px] text-orange-300/70 mt-2">
                          Legacy markdown duty — migrate to a folder-duty to
                          edit it here.
                        </p>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <Button
                            size="sm"
                            variant={isIssueDefault ? "secondary" : "ghost"}
                            className="h-6 gap-1 text-[11px] px-2"
                            onClick={() =>
                              setDefault.mutate({
                                slug: e.slug,
                                target: "issue",
                                clear: isIssueDefault,
                              })
                            }
                          >
                            <Star className="w-3 h-3" />
                            {isIssueDefault
                              ? "Issue default ✓"
                              : "Set issue default"}
                          </Button>
                          <Button
                            size="sm"
                            variant={isPrDefault ? "secondary" : "ghost"}
                            className="h-6 gap-1 text-[11px] px-2"
                            onClick={() =>
                              setDefault.mutate({
                                slug: e.slug,
                                target: "pr",
                                clear: isPrDefault,
                              })
                            }
                          >
                            <Star className="w-3 h-3" />
                            {isPrDefault ? "PR default ✓" : "Set PR default"}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {e.markdown ? (
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                        >
                          <a href={e.htmlUrl} target="_blank" rel="noreferrer">
                            <Pencil className="w-3.5 h-3.5" />
                            Open .md
                          </a>
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            onClick={() => setRunning(e.slug)}
                          >
                            <Play className="w-3.5 h-3.5" />
                            Run
                          </Button>
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                          >
                            <Link href={`/executables/${e.slug}`}>
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-rose-300 hover:text-rose-200"
                            onClick={() => setDeleting(e.slug)}
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
            );
          })}
        </ul>
      </div>

      {running && (
        <RunDialog
          slug={running}
          running={run.isPending}
          onClose={() => setRunning(null)}
          onRun={async (issue) => {
            await run.mutateAsync({ slug: running, issue });
            setRunning(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete @kody ${deleting}?`}
        description="The whole duty folder is removed from the repo."
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

interface EditorProps {
  slug: string | null;
  headers: Record<string, string>;
  existingSlugs: Set<string>;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}

const DEFAULT_PROMPT =
  "You are working on issue #{{issue.number}}: {{issue.title}}\n\n{{issue.body}}\n\nImplement the change end-to-end.\n";

function ExecutableEditor({
  slug,
  headers,
  existingSlugs,
  saving,
  onClose,
  onSave,
}: EditorProps) {
  const isNew = slug === null;
  const detail = useQuery({
    queryKey: ["kody-executable", slug],
    queryFn: () => readApi(headers, slug as string),
    enabled: !isNew,
  });

  if (!isNew && detail.isLoading) {
    return (
      <p className="text-sm text-white/60 flex items-center gap-2 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <ExecutableEditorForm
      isNew={isNew}
      initial={detail.data ?? null}
      existingSlugs={existingSlugs}
      saving={saving}
      headers={headers}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function ExecutableEditorForm({
  isNew,
  initial,
  existingSlugs,
  saving,
  headers,
  onClose,
  onSave,
}: {
  isNew: boolean;
  initial: ExecutableDetail | null;
  existingSlugs: Set<string>;
  saving: boolean;
  headers: Record<string, string>;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [describe, setDescribe] = useState(initial?.describe ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? DEFAULT_PROMPT);
  const [model, setModel] = useState(initial?.model ?? "inherit");
  // Not user-tunable: the engine runs headless (no human to approve tool
  // prompts), so "accept edits" is the only workable mode — exposing the
  // others just invites a stuck run. Hardcoded.
  const permissionMode: PermissionMode = "acceptEdits";
  const [tools, setTools] = useState<string[]>(
    initial?.tools ?? ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
  );
  const [landing, setLanding] = useState<ExecutableLanding>(
    initial?.landing ?? "pr",
  );
  const [skills, setSkills] = useState<ExecutableSkill[]>(
    initial?.skills ?? [],
  );
  const [shellScripts, setShellScripts] = useState<ExecutableShellScript[]>(
    initial?.shellScripts ?? [],
  );
  const [mcpServers, setMcpServers] = useState<McpServerSpec[]>(
    initial?.mcpServers ?? [],
  );
  const [skillSource, setSkillSource] = useState("");
  const [importing, setImporting] = useState(false);
  const [mcpSource, setMcpSource] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  // Analyze a GitHub repo and pre-fill a tool from it: the user pastes a URL,
  // the server reads the repo's README/package.json and proposes the MCP
  // command/args + an install command. We pre-fill (never auto-save) so the
  // user reviews — especially the install command, which runs in the runner.
  async function analyzeToolFromSource() {
    const source = mcpSource.trim();
    if (!source) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/kody/executables/analyze-tool", {
        method: "POST",
        headers,
        body: JSON.stringify({ source }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        proposal?: {
          name: string;
          command: string;
          args: string[];
          installCommand: string;
          isMcpServer: boolean;
          notes: string;
        };
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.proposal)
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      const p = json.proposal;
      setMcpServers((prev) => [
        ...prev.filter((s) => s.name !== p.name),
        {
          name: p.name,
          command: p.command,
          args: p.args.length > 0 ? p.args : undefined,
        },
      ]);
      // Pre-fill the install command as a preflight script so the binary is
      // present at run time (the run breaks otherwise). User reviews it.
      if (p.installCommand.trim()) {
        const fname = `install-${p.name}.sh`;
        const content = `#!/usr/bin/env bash\nset -euo pipefail\n${p.installCommand.trim()}\n`;
        setShellScripts((prev) => [
          ...prev.filter((s) => s.name !== fname),
          { name: fname, content },
        ]);
      }
      setMcpSource("");
      if (!p.isMcpServer)
        toast.warning(
          `${p.name}: repo may not ship an MCP server — review the command. ${p.notes}`.trim(),
        );
      else
        toast.success(
          `Added "${p.name}". Review the command + the install-${p.name}.sh script before saving.`,
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analyze failed");
    } finally {
      setAnalyzing(false);
    }
  }

  // Import a skill from a GitHub source (the same source format the `skills`
  // CLI uses, e.g. vercel-labs/agent-skills). Fetches its SKILL.md and adds
  // it as a skill entry; it's committed into skills/<name>/ on save.
  async function importSkillFromSource() {
    const source = skillSource.trim();
    if (!source) return;
    setImporting(true);
    try {
      const res = await fetch("/api/kody/executables/import-skill", {
        method: "POST",
        headers,
        body: JSON.stringify({ source }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        skill?: ExecutableSkill;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.skill)
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      const imported = json.skill;
      setSkills((prev) => [
        ...prev.filter((s) => s.name !== imported.name),
        imported,
      ]);
      setSkillSource("");
      toast.success(`Imported skill "${imported.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const slugError = (() => {
    if (!isNew || !touchedSlug) return null;
    if (!slug) return "Required";
    if (!isValidSlug(slug))
      return "Use lowercase letters, digits, dashes, underscores. Start with a letter or digit.";
    if (existingSlugs.has(slug)) return `"${slug}" already exists`;
    return null;
  })();
  const promptError = prompt.trim().length === 0 ? "Prompt is required" : null;

  // Live validation of the profile the form will generate.
  const validation = useMemo(() => {
    const effectiveSlug = isNew ? slug || "draft" : slug;
    const profile = composeProfile({
      slug: effectiveSlug,
      describe,
      prompt,
      model,
      permissionMode,
      tools,
      skills: skills.map((s) => s.name),
      shellScripts: shellScripts.map((s) => s.name),
      mcpServers,
      landing,
    });
    const errors = validateProfile(profile);
    // Local consistency: skill/sh names must be present and well-formed.
    for (const s of skills)
      if (!s.name.trim()) errors.push("a skill is missing a name");
    for (const s of shellScripts)
      if (!/^[a-zA-Z0-9._-]+\.sh$/.test(s.name))
        errors.push(`shell file "${s.name || "(blank)"}" must be a *.sh name`);
    for (const m of mcpServers) {
      if (!/^[a-zA-Z0-9_-]+$/.test(m.name))
        errors.push(
          `tool name "${m.name || "(blank)"}" must be letters, digits, dash, underscore`,
        );
      if (!m.command.trim())
        errors.push(`tool "${m.name || "(unnamed)"}" is missing a command`);
    }
    return { errors, json: serializeProfile(profile) };
  }, [
    isNew,
    slug,
    describe,
    prompt,
    model,
    permissionMode,
    tools,
    skills,
    shellScripts,
    mcpServers,
    landing,
  ]);

  // Block save when the composed profile fails the engine invariants or a
  // referenced skill/shell file is malformed — not just slug/prompt.
  const canSave =
    !saving &&
    !slugError &&
    !promptError &&
    validation.errors.length === 0 &&
    (isNew ? !!slug : true);

  const toggleTool = (tool: string) =>
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
    );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white/90">
            {isNew ? "New duty" : `Edit @kody ${initial?.slug}`}
          </h2>
          <p className="text-xs text-white/50">
            Stored at .kody/duties/&lt;slug&gt;/. The engine runs it for
            <code className="mx-1">@kody &lt;slug&gt;</code>.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 shrink-0"
          onClick={onClose}
          disabled={saving}
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
      </div>

      <Tabs defaultValue="config" className="mt-2">
        <TabsList>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
          <TabsTrigger value="skills">Skills ({skills.length})</TabsTrigger>
          <TabsTrigger value="tools">Tools ({mcpServers.length})</TabsTrigger>
          <TabsTrigger value="scripts">
            Scripts ({shellScripts.length})
          </TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-3">
          <div>
            <Label htmlFor="exec-slug" className="text-xs">
              Slug (becomes @kody slug)
            </Label>
            <Input
              id="exec-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              onBlur={() => setTouchedSlug(true)}
              disabled={!isNew}
              placeholder="ship-feature"
              className="font-mono"
            />
            {slugError && (
              <p className="text-xs text-rose-300 mt-1">{slugError}</p>
            )}
          </div>
          <div>
            <Label htmlFor="exec-describe" className="text-xs">
              Description
            </Label>
            <Textarea
              id="exec-describe"
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              placeholder="Implement an issue end-to-end and open a PR"
              rows={4}
            />
          </div>
          <div>
            <Label className="text-xs">Landing</Label>
            <Select
              value={landing}
              onValueChange={(v) => setLanding(v as ExecutableLanding)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pr">Opens a PR (commits + PR)</SelectItem>
                <SelectItem value="comment">
                  Just comments (posts an answer)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-white/40 mt-1">
              {landing === "pr"
                ? "Edits code and opens a pull request."
                : "Reads and replies with a comment — no code changes."}
            </p>
          </div>
          <div>
            <Label htmlFor="exec-model" className="text-xs">
              Model (inherit = use the repo&apos;s default)
            </Label>
            <Input
              id="exec-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="inherit"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Tools the agent may use</Label>
            <div className="grid grid-cols-1 gap-1.5 mt-1">
              {COMMON_TOOLS.map((tool) => (
                <label
                  key={tool}
                  className="flex items-start gap-2 text-xs text-white/70 cursor-pointer"
                >
                  <Checkbox
                    checked={tools.includes(tool)}
                    onCheckedChange={() => toggleTool(tool)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-white/90">{tool}</span>
                    <span className="text-white/45">
                      {" "}
                      — {TOOL_DESCRIPTIONS[tool] ?? ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="prompt" className="space-y-2">
          <p className="text-[11px] text-white/40">
            Markdown with <code>{"{{issue.number}}"}</code>,{" "}
            <code>{"{{issue.title}}"}</code>, <code>{"{{issue.body}}"}</code>{" "}
            tokens. Saved as prompt.md. The required output format is appended
            automatically.
          </p>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="font-mono text-xs"
            rows={16}
          />
          {promptError && (
            <p className="text-xs text-rose-300">{promptError}</p>
          )}
        </TabsContent>

        <TabsContent value="skills" className="space-y-3">
          <p className="text-[11px] text-white/40">
            Each skill is a SKILL.md the agent loads, saved at
            skills/&lt;name&gt;/SKILL.md and committed into this executable.
          </p>
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-3 space-y-1.5">
              <Label className="text-xs">
                Import from the skills ecosystem
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={skillSource}
                  onChange={(e) => setSkillSource(e.target.value)}
                  placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
                  className="font-mono text-xs h-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      importSkillFromSource();
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 shrink-0"
                  disabled={importing || !skillSource.trim()}
                  onClick={importSkillFromSource}
                >
                  {importing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Import
                </Button>
              </div>
              <p className="text-[11px] text-white/40">
                Paste the GitHub URL of a skill folder (the one containing its
                SKILL.md). Shorthand <code>owner/repo/path</code> also works.
                Fetches its SKILL.md; you can edit it below before saving.
              </p>
            </CardContent>
          </Card>
          {skills.map((s, i) => (
            <Card key={i} className="border-white/[0.08] bg-white/[0.02]">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={s.name}
                    onChange={(e) =>
                      setSkills((prev) =>
                        prev.map((x, xi) =>
                          xi === i
                            ? { ...x, name: e.target.value.toLowerCase() }
                            : x,
                        ),
                      )
                    }
                    placeholder="skill-name"
                    className="font-mono text-xs h-8"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-300"
                    onClick={() =>
                      setSkills((prev) => prev.filter((_, xi) => xi !== i))
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={s.body}
                  onChange={(e) =>
                    setSkills((prev) =>
                      prev.map((x, xi) =>
                        xi === i ? { ...x, body: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="---&#10;name: skill-name&#10;description: …&#10;---&#10;&#10;Skill instructions…"
                  className="font-mono text-xs"
                  rows={6}
                />
              </CardContent>
            </Card>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() =>
              setSkills((prev) => [...prev, { name: "", body: "" }])
            }
          >
            <Plus className="w-3.5 h-3.5" /> Add skill
          </Button>
        </TabsContent>

        <TabsContent value="tools" className="space-y-3">
          <p className="text-[11px] text-white/40">
            Connect an external{" "}
            <span className="font-mono text-white/70">MCP</span> tool server the
            agent can call. Each entry is written to
            <code className="mx-1">claudeCode.mcpServers</code> and its tools
            are auto-allowed. The <code>command</code> must be available in the
            run (install it via a preflight Script).
          </p>
          <p className="text-[11px] text-white/40">
            Example — codegraph: name{" "}
            <code className="text-white/70">codegraph</code>, command{" "}
            <code className="text-white/70">codegraph</code>, args{" "}
            <code className="text-white/70">serve --mcp</code>.
          </p>
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-3 space-y-1.5">
              <Label className="text-xs">Add from a GitHub repo</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={mcpSource}
                  onChange={(e) => setMcpSource(e.target.value)}
                  placeholder="https://github.com/colbymchenry/codegraph"
                  className="font-mono text-xs h-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      analyzeToolFromSource();
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 shrink-0"
                  disabled={analyzing || !mcpSource.trim()}
                  onClick={analyzeToolFromSource}
                >
                  {analyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Analyze
                </Button>
              </div>
              <p className="text-[11px] text-white/40">
                Reads the repo&apos;s README + package.json and pre-fills the
                command, args, and an install script below.{" "}
                <span className="text-amber-300/70">
                  Review the generated install script before saving.
                </span>
              </p>
            </CardContent>
          </Card>
          {mcpServers.map((m, i) => (
            <Card key={i} className="border-white/[0.08] bg-white/[0.02]">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={m.name}
                    onChange={(e) =>
                      setMcpServers((prev) =>
                        prev.map((x, xi) =>
                          xi === i
                            ? { ...x, name: e.target.value.toLowerCase() }
                            : x,
                        ),
                      )
                    }
                    placeholder="tool-name"
                    className="font-mono text-xs h-8"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-300"
                    onClick={() =>
                      setMcpServers((prev) => prev.filter((_, xi) => xi !== i))
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div>
                  <Label className="text-[11px] text-white/50">Command</Label>
                  <Input
                    value={m.command}
                    onChange={(e) =>
                      setMcpServers((prev) =>
                        prev.map((x, xi) =>
                          xi === i ? { ...x, command: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="codegraph"
                    className="font-mono text-xs h-8"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-white/50">
                    Args (space-separated)
                  </Label>
                  <Input
                    value={(m.args ?? []).join(" ")}
                    onChange={(e) => {
                      const args = e.target.value.split(/\s+/).filter(Boolean);
                      setMcpServers((prev) =>
                        prev.map((x, xi) =>
                          xi === i
                            ? {
                                ...x,
                                args: args.length > 0 ? args : undefined,
                              }
                            : x,
                        ),
                      );
                    }}
                    placeholder="serve --mcp"
                    className="font-mono text-xs h-8"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() =>
              setMcpServers((prev) => [...prev, { name: "", command: "" }])
            }
          >
            <Plus className="w-3.5 h-3.5" /> Add tool
          </Button>
        </TabsContent>

        <TabsContent value="scripts" className="space-y-3">
          <p className="text-[11px] text-white/40">
            Each script runs as a preflight step before the agent. Saved as a
            &lt;name&gt;.sh file next to the profile.
          </p>
          {shellScripts.map((s, i) => (
            <Card key={i} className="border-white/[0.08] bg-white/[0.02]">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={s.name}
                    onChange={(e) =>
                      setShellScripts((prev) =>
                        prev.map((x, xi) =>
                          xi === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="setup.sh"
                    className="font-mono text-xs h-8"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-300"
                    onClick={() =>
                      setShellScripts((prev) =>
                        prev.filter((_, xi) => xi !== i),
                      )
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={s.content}
                  onChange={(e) =>
                    setShellScripts((prev) =>
                      prev.map((x, xi) =>
                        xi === i ? { ...x, content: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="#!/usr/bin/env bash&#10;set -euo pipefail&#10;npm install -g some-tool"
                  className="font-mono text-xs"
                  rows={6}
                />
              </CardContent>
            </Card>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() =>
              setShellScripts((prev) => [...prev, { name: "", content: "" }])
            }
          >
            <Plus className="w-3.5 h-3.5" /> Add script
          </Button>
        </TabsContent>

        <TabsContent value="review" className="space-y-3">
          {validation.errors.length === 0 ? (
            <p className="text-sm text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Valid — ready to save.
            </p>
          ) : (
            <div className="text-sm text-rose-300 space-y-1">
              <p className="flex items-center gap-2">
                <XCircle className="w-4 h-4" /> Problems:
              </p>
              <ul className="list-disc pl-6 text-rose-200/80 text-xs">
                {validation.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <Label className="text-xs">Generated profile.json</Label>
            <pre className="mt-1 text-[11px] font-mono bg-black/40 border border-white/[0.08] rounded p-3 overflow-x-auto max-h-72">
              {validation.json}
            </pre>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => {
            if (!canSave) return;
            onSave({
              slug,
              describe,
              prompt,
              model,
              permissionMode,
              tools,
              skills,
              shellScripts,
              mcpServers,
              landing,
              isUpdate: !isNew,
            });
          }}
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              Saving…
            </>
          ) : isNew ? (
            "Create"
          ) : (
            "Update"
          )}
        </Button>
      </div>
    </div>
  );
}

function RunDialog({
  slug,
  running,
  onClose,
  onRun,
}: {
  slug: string;
  running: boolean;
  onClose: () => void;
  onRun: (issue: number) => Promise<void>;
}) {
  const [issue, setIssue] = useState("");
  const n = Number(issue);
  const valid = Number.isInteger(n) && n > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run @kody {slug}</DialogTitle>
          <DialogDescription>
            Posts <code>@kody {slug}</code> as a comment on the issue, which the
            engine picks up.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <Label htmlFor="run-issue" className="text-xs">
            Issue number
          </Label>
          <Input
            id="run-issue"
            value={issue}
            onChange={(e) => setIssue(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="123"
            className="font-mono"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={running}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid || running}
            onClick={() => valid && onRun(n)}
            className="gap-1"
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Run on #{valid ? n : "…"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
