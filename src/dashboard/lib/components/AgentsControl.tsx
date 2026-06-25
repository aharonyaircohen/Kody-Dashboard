/**
 * @fileType component
 * @domain kody
 * @pattern agent-control-page
 * @ai-summary Agent Control — list, view, create, edit, and delete agent.
 *   An agent is a pure reusable identity file at `agents/<slug>.md`
 *   in the state repo: a markdown body describing the agent's
 *   intent, allowed commands, and restrictions. Agents have no schedule, no
 *   state, and no run/tick — they're agent identities referenced by other flows.
 *   The chat rail reuses the existing agentResponsibility scope kind (an agent is
 *   structurally identical to a agentResponsibility).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { AuthGuard } from "../auth-guard";
import { cn } from "../utils";
import {
  useCreateAgent,
  useDeleteAgent,
  useDispatchAgent,
  useAgents,
  useUpdateAgent,
} from "../hooks/useAgents";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import type { Agent } from "../api";
import { KODY_CHAT_AGENT } from "../context/frontmatter";
import { AGENT_TEMPLATE } from "../agent-template";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { PageHeader } from "./PageShell";
import { useChatScope } from "./ChatRailShell";

/**
 * Kody — the built-in chat agentIdentity. Always present in the agent list and
 * never editable or removable (it lives in code, not a state repo `agents/*.md`
 * file). Identified by the `kody` slug; `isBuiltinAgent` gates the UI.
 */
const BUILTIN_KODY_AGENT: Agent = {
  slug: KODY_CHAT_AGENT,
  title: "Kody",
  body:
    "Kody is the built-in assistant agentIdentity — the agent the in-process " +
    "chat runs as. It is always available and can't be edited or removed here. " +
    "Attach Context entries to Kody to inject them into every chat turn.",
  updatedAt: "",
  htmlUrl: "",
};

/** True for built-in const agent (no file, no edit/delete). */
function isBuiltinAgent(slug: string): boolean {
  return slug === KODY_CHAT_AGENT;
}

interface AgentsControlProps {
  /** Render without the built-in PageHeader (e.g. when hosted in AgentsPageTabs). */
  embedded?: boolean;
}

export function AgentsControl({ embedded = false }: AgentsControlProps = {}) {
  return (
    <AuthGuard>
      <AgentsControlInner embedded={embedded} />
    </AuthGuard>
  );
}

export function AgentsControlInner({
  embedded = false,
}: AgentsControlProps = {}) {
  const {
    data: rawStaff = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useAgents();

  // Kody is always first and never removable; repo agent follow (any stray
  // `kody.md` file is dropped so the const wins).
  const agent = useMemo(
    () => [
      BUILTIN_KODY_AGENT,
      ...rawStaff.filter((m) => !isBuiltinAgent(m.slug)),
    ],
    [rawStaff],
  );

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingMember, setEditingMember] = useState<Agent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [taskMember, setTaskMember] = useState<Agent | null>(null);

  const selectedMember = useMemo(
    () => agent.find((m) => m.slug === selectedSlug) ?? null,
    [agent, selectedSlug],
  );

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agent;
    return agent.filter(
      (m) =>
        m.slug.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q),
    );
  }, [agent, search]);

  useEffect(() => {
    if (!selectedSlug && agent.length > 0) {
      setSelectedSlug(agent[0].slug);
    }
  }, [agent, selectedSlug]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteAgent(githubUser?.login);

  // Push chat context up to the persistent rail in the root layout.
  // An agent is structurally identical to a agentResponsibility, so we reuse the
  // existing agentResponsibility scope kind — the chat just needs the file's title/body
  // to answer questions about the selected member.
  const { setScope } = useChatScope();
  useEffect(() => {
    setScope(
      selectedMember
        ? { kind: "agentResponsibility", agentResponsibility: selectedMember }
        : null,
    );
    return () => setScope(null);
  }, [selectedMember, setScope]);

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {/* Chat rail + sidebar come from the root layout (ChatRailShell). */}
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {embedded ? (
          <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
            <span className="text-xs text-muted-foreground mr-auto">
              {agent.length} {agent.length === 1 ? "member" : "agent"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh agent"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="gap-1"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New member</span>
            </Button>
          </div>
        ) : (
          <PageHeader
            title="Agent Control"
            icon={Target}
            iconClassName="text-emerald-400"
            subtitle={`${agent.length} ${agent.length === 1 ? "member" : "agent"}`}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label="Refresh agent"
                >
                  <RefreshCw
                    className={cn("w-4 h-4", isFetching && "animate-spin")}
                  />
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowCreate(true)}
                  className="gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New member</span>
                </Button>
              </>
            }
          />
        )}

        {error ? (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
            Failed to load agent: {(error as Error).message}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex">
          {/* Middle: agent list */}
          <aside
            className={cn(
              "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
              selectedMember && "hidden md:block",
            )}
          >
            {agent.length > 0 ? (
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 md:px-4 py-2 md:py-3 border-b border-border">
                <ListSearch
                  value={search}
                  onChange={setSearch}
                  placeholder="Search agent…"
                  ariaLabel="Search agent"
                  accent="emerald"
                />
              </div>
            ) : null}
            {isLoading ? (
              <EmptyState icon={<FileText />} title="Loading agent…" />
            ) : agent.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No agent yet"
                hint="Create your first agent to describe the intent, system prompt, and restrictions."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No matching agent"
                hint="No agent matches your search. Try a different term."
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((member) => {
                  const isActive = selectedSlug === member.slug;
                  return (
                    <li key={member.slug}>
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(member.slug)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                          isActive && "bg-accent/70",
                        )}
                      >
                        {isActive ? (
                          <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400" />
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Target
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              isActive
                                ? "text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="font-medium text-sm truncate flex-1">
                            {member.title}
                          </span>
                          {member.source === "store" ? (
                            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                              Store
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          <span className="font-mono opacity-80">
                            {member.slug}
                          </span>
                          <span>·</span>
                          {isBuiltinAgent(member.slug) ? (
                            <span>Built-in</span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(member.updatedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right: agent detail */}
          <section
            className={cn(
              "flex-1 min-w-0 overflow-y-auto",
              !selectedMember && "hidden md:block",
            )}
          >
            {selectedMember ? (
              <StaffDetail
                member={selectedMember}
                onBack={() => setSelectedSlug(null)}
                onEdit={() => {
                  if (!selectedMember.readOnly)
                    setEditingMember(selectedMember);
                }}
                onDelete={() => {
                  setPendingDelete(selectedMember);
                }}
                onSendTask={() => setTaskMember(selectedMember)}
              />
            ) : (
              <EmptyState
                icon={<Target />}
                title="Select an agent"
                hint="Pick an agent from the list to see its intent and system prompt."
              />
            )}
          </section>
        </div>

        {/* Create */}
        <CreateAgentDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(member) => {
            setSelectedSlug(member.slug);
            setShowCreate(false);
          }}
        />

        {/* Edit */}
        {editingMember ? (
          <EditStaffDialog
            member={editingMember}
            onClose={() => setEditingMember(null)}
            onSaved={() => setEditingMember(null)}
          />
        ) : null}

        {/* Delete confirm */}
        <ConfirmDialog
          open={!!pendingDelete}
          title={
            pendingDelete?.source === "store"
              ? "Remove Store agent?"
              : "Delete this agent?"
          }
          description={
            pendingDelete
              ? pendingDelete.source === "store"
                ? `Agent member "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from this repo's active Store agents. The Store asset will not be deleted.`
                : `Agent member "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from the state repo agent store.`
              : ""
          }
          variant="destructive"
          confirmLabel={
            pendingDelete?.source === "store"
              ? "Remove member"
              : "Delete member"
          }
          onConfirm={() => {
            if (!pendingDelete) return;
            const target = pendingDelete;
            deleteMutation.mutate(target.slug, {
              onSuccess: () => {
                if (selectedSlug === target.slug) setSelectedSlug(null);
              },
            });
          }}
          onClose={() => setPendingDelete(null)}
        />

        {/* Send ad-hoc task */}
        {taskMember ? (
          <SendTaskDialog
            member={taskMember}
            onClose={() => setTaskMember(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function StaffDetail({
  member,
  onBack,
  onEdit,
  onDelete,
  onSendTask,
}: {
  member: Agent;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSendTask: () => void;
}) {
  const hasBody = member.body.trim().length > 0;
  const isBuiltin = isBuiltinAgent(member.slug);
  return (
    <article className="min-h-full">
      {/* Hero */}
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All agent
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                {member.title}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{member.slug}</span>
                {member.source === "store" ? (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      Store
                    </span>
                  </>
                ) : null}
                {isBuiltin ? (
                  <>
                    <span>·</span>
                    <span>Built-in agentIdentity</span>
                  </>
                ) : (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      updated {new Date(member.updatedAt).toLocaleDateString()}
                    </span>
                    <span>·</span>
                    <a
                      href={member.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      title="Open on GitHub"
                    >
                      <ExternalLink className="w-3 h-3" />
                      GitHub
                    </a>
                  </>
                )}
              </div>
            </div>
            {isBuiltin ? (
              <span className="shrink-0 inline-flex items-center rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[11px] font-medium text-teal-300">
                Built-in · permanent
              </span>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={onSendTask}
                  className="w-9 px-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                  title="Send an ad-hoc task to this agent"
                  aria-label="Send task"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  disabled={member.readOnly}
                  className="w-9 px-0"
                  title={
                    member.readOnly
                      ? "Store-linked agent are read-only"
                      : "Edit agent"
                  }
                  aria-label="Edit agent"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="w-9 px-0 text-red-400"
                  title={
                    member.source === "store"
                      ? "Remove Store agent from this repo"
                      : "Delete agent"
                  }
                  aria-label={
                    member.source === "store"
                      ? "Remove Store agent from this repo"
                      : "Delete agent"
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <MarkdownPreview content={member.body} variant="compact" />
            </div>
          ) : null}
        </div>
      </div>

      {/* Empty body fallback below the hero */}
      {!hasBody ? (
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                No description yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Use <span className="font-medium text-foreground">Edit</span> to
                describe the agent&apos;s intent, system prompt, allowed
                commands, and restrictions.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              disabled={member.readOnly}
              className="gap-1.5 mt-1"
              title={
                member.readOnly
                  ? "Store-linked agent are read-only"
                  : "Edit agent"
              }
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit agent
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (member: Agent) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateAgent(githubUser?.login);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState(AGENT_TEMPLATE);

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody(AGENT_TEMPLATE);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return;
    createMutation.mutate(
      { title: title.trim(), body },
      {
        onSuccess: (member) => onCreated(member),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Describe the agent&apos;s intent, system prompt, allowed commands,
            and restrictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="agent-title">Title</Label>
            <Input
              id="agent-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Release notes manager"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={14} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create member"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditStaffDialog({
  member,
  onClose,
  onSaved,
}: {
  member: Agent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateAgent(member.slug, githubUser?.login);

  const [title, setTitle] = useState(member.title);
  const [body, setBody] = useState(member.body || "");

  useEffect(() => {
    setTitle(member.title);
    setBody(member.body || "");
  }, [member]);

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending) return;
    const patch: {
      title?: string;
      body?: string;
    } = {};
    if (title !== member.title) patch.title = title.trim();
    if (body !== member.body) patch.body = body;
    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }
    updateMutation.mutate(patch, { onSuccess: () => onSaved() });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit agent `{member.slug}`</DialogTitle>
          <DialogDescription>
            Update the agent&apos;s title or body. Saving commits the file to
            the default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-title">Title</Label>
            <Input
              id="edit-agent-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={14} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!title.trim() || updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SendTaskDialog({
  member,
  onClose,
}: {
  member: Agent;
  onClose: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const dispatchMutation = useDispatchAgent(githubUser?.login);

  const [message, setMessage] = useState("");

  useEffect(() => {
    setMessage("");
  }, [member]);

  const handleSubmit = () => {
    if (!message.trim() || dispatchMutation.isPending) return;
    dispatchMutation.mutate(
      { slug: member.slug, message: message.trim() },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send a task to {member.title}</DialogTitle>
          <DialogDescription>
            Runs <span className="font-mono">{member.slug}</span> once on your
            message — like a one-off agentResponsibility. The reply is posted on
            the Kody control issue
            {githubUser?.login ? " and lands in your inbox" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 mt-2">
          <Label>Message</Label>
          <MarkdownEditor value={message} onChange={setMessage} rows={8} />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!message.trim() || dispatchMutation.isPending}
            className="gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            {dispatchMutation.isPending ? "Sending…" : "Send task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="w-10 h-10 mb-3 opacity-60">{icon}</div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <p className="text-xs mt-1 max-w-xs">{hint}</p> : null}
    </div>
  );
}
