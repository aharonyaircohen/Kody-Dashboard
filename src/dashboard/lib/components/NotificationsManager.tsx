/**
 * @fileType component
 * @domain kody
 * @pattern notifications-manager
 * @ai-summary CRUD UI for notification rules (slack-webhook channel today).
 *   List + add/edit dialog + delete confirm + test action. Mirrors the
 *   look-and-feel of MissionControl: header bar with title + back link, card
 *   list, and a single dialog for the form.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Bell, Pencil, Plus, Send, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { ConfirmDialog } from "./ConfirmDialog";
import { AuthGuard } from "../auth-guard";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import {
  useNotifications,
  useCreateNotification,
  useUpdateNotification,
  useDeleteNotification,
  useTestNotification,
} from "../hooks/useNotifications";
import {
  NOTIFICATION_EVENTS,
  defaultTemplateForEvent,
  eventLabel,
  type NotificationEvent,
  type NotificationRule,
} from "../notifications";

interface FormState {
  id?: string;
  name: string;
  enabled: boolean;
  event: NotificationEvent;
  webhookUrl: string;
  template: string;
}

const blankForm: FormState = {
  name: "",
  enabled: true,
  event: "deploy_pr_merged",
  webhookUrl: "",
  template: "",
};

function ruleToForm(rule: NotificationRule): FormState {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    event: rule.event,
    webhookUrl: rule.channel.url,
    template: rule.template ?? "",
  };
}

export function NotificationsManager() {
  return (
    <AuthGuard>
      <NotificationsManagerInner />
    </AuthGuard>
  );
}

function NotificationsManagerInner() {
  const { githubUser } = useGitHubIdentity();
  const actorLogin = githubUser?.login;

  const { data: rules = [], isLoading, error, refetch } = useNotifications();
  const create = useCreateNotification(actorLogin);
  const remove = useDeleteNotification(actorLogin);
  const test = useTestNotification(actorLogin);

  const [editing, setEditing] = useState<FormState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-black/95 text-white/90">
      <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/" aria-label="Back to dashboard">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <Bell className="w-5 h-5 text-sky-400" />
          <h1 className="text-base md:text-lg font-semibold">Notifications</h1>
        </div>
        <Button
          size="sm"
          onClick={() => setEditing({ ...blankForm })}
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          New rule
        </Button>
      </header>

      <main className="px-4 md:px-6 py-6 max-w-4xl mx-auto space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50">Loading rules…</p>
        )}
        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">Couldn&apos;t load rules</p>
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

        {!isLoading && !error && rules.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Bell className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No notification rules yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Add a rule to ping a Slack channel when a release deploy PR
                merges, a kody flow fails, or other events fire.
              </p>
              <Button
                size="sm"
                onClick={() => setEditing({ ...blankForm })}
                className="gap-1"
              >
                <Plus className="w-4 h-4" />
                Add your first rule
              </Button>
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => setEditing(ruleToForm(rule))}
              onDelete={() => setDeletingId(rule.id)}
              onTest={() =>
                test.mutate({
                  url: rule.channel.url,
                  text: `:test_tube: kody test from rule \`${rule.name}\``,
                })
              }
              testing={test.isPending}
              actorLogin={actorLogin}
            />
          ))}
        </ul>

        <p className="text-[11px] text-white/30 pt-4">
          Rules are stored in a single GitHub issue labelled{" "}
          <code className="text-white/50">kody:notifications-manifest</code>.
          Webhook URLs sit in that issue body — keep this repo private.
        </p>
      </main>

      {editing && (
        <RuleEditor
          form={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
          createMutation={create}
          actorLogin={actorLogin}
        />
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete notification rule?"
        description="This won't undo any past notifications, but no future events will fire from this rule."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deletingId) remove.mutate(deletingId);
          setDeletingId(null);
        }}
        onClose={() => setDeletingId(null)}
      />
    </div>
  );
}

function RuleCard({
  rule,
  onEdit,
  onDelete,
  onTest,
  testing,
  actorLogin,
}: {
  rule: NotificationRule;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  testing: boolean;
  actorLogin?: string;
}) {
  const update = useUpdateNotification(rule.id, actorLogin);
  return (
    <Card className="border-white/[0.06] bg-white/[0.02]">
      <CardContent className="p-4 flex items-start gap-4">
        <button
          type="button"
          onClick={() => update.mutate({ enabled: !rule.enabled })}
          className={`mt-1 w-9 h-5 rounded-full relative transition-colors ${
            rule.enabled ? "bg-emerald-500" : "bg-white/15"
          }`}
          aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              rule.enabled ? "translate-x-4" : ""
            }`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{rule.name}</p>
          <p className="text-xs text-white/50 mt-0.5">
            {eventLabel(rule.event)} → Slack
          </p>
          {rule.template && (
            <p className="text-[11px] text-white/30 mt-1 font-mono truncate">
              {rule.template}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onTest}
            disabled={testing || !rule.enabled}
            title={rule.enabled ? "Send test message" : "Enable rule to test"}
          >
            <Send className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="w-4 h-4 text-rose-400" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleEditor({
  form,
  onClose,
  onSaved,
  createMutation,
  actorLogin,
}: {
  form: FormState;
  onClose: () => void;
  onSaved: () => void;
  // Reusing the create mutation when adding; for edits we instantiate a
  // separate update hook below.
  createMutation: ReturnType<typeof useCreateNotification>;
  actorLogin?: string;
}) {
  const isEdit = !!form.id;
  const [name, setName] = useState(form.name);
  const [enabled, setEnabled] = useState(form.enabled);
  const [event, setEvent] = useState<NotificationEvent>(form.event);
  const [webhookUrl, setWebhookUrl] = useState(form.webhookUrl);
  const [template, setTemplate] = useState(form.template);
  const [testing, setTesting] = useState(false);

  const updateMutation = useUpdateNotification(form.id ?? "", actorLogin);
  const test = useTestNotification(actorLogin);

  const trimmedUrl = webhookUrl.trim();
  const validUrl = trimmedUrl.startsWith("https://hooks.slack.com/");
  const canSave = name.trim().length > 0 && validUrl;
  const pending = createMutation.isPending || updateMutation.isPending;

  function handleSave() {
    const payload = {
      name: name.trim(),
      enabled,
      event,
      channel: { type: "slack-webhook" as const, url: trimmedUrl },
      template: template.trim() || undefined,
    };
    if (isEdit) {
      updateMutation.mutate(
        { ...payload, template: template.trim() || null },
        { onSuccess: onSaved },
      );
    } else {
      createMutation.mutate(payload, { onSuccess: onSaved });
    }
  }

  function handleTest() {
    if (!validUrl) return;
    setTesting(true);
    test.mutate(
      {
        url: trimmedUrl,
        text: `:test_tube: kody test for rule \`${name || "(unnamed)"}\``,
      },
      { onSettled: () => setTesting(false) },
    );
  }

  const placeholder = template || defaultTemplateForEvent(event);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit rule" : "New notification rule"}</DialogTitle>
          <DialogDescription>
            One event, one Slack channel. Slack incoming webhook URL only
            (https://hooks.slack.com/services/...).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Releases → #ops"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-event">Event</Label>
            <Select
              value={event}
              onValueChange={(v) => setEvent(v as NotificationEvent)}
            >
              <SelectTrigger id="rule-event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_EVENTS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {eventLabel(e)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-url">Slack webhook URL</Label>
            <Input
              id="rule-url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              type="url"
            />
            {webhookUrl.length > 0 && !validUrl && (
              <p className="text-xs text-rose-400">
                Must be a Slack incoming webhook URL.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-template">
              Message template{" "}
              <span className="text-white/40 text-[11px]">(optional)</span>
            </Label>
            <Textarea
              id="rule-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={3}
              placeholder={placeholder}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-white/40">
              Variables: <code>{"{{repo}}"}</code> <code>{"{{prUrl}}"}</code>{" "}
              <code>{"{{prTitle}}"}</code> <code>{"{{prBody}}"}</code>{" "}
              <code>{"{{author}}"}</code> <code>{"{{version}}"}</code>
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="flex justify-between gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={!validUrl || testing || test.isPending}
            className="gap-1"
          >
            <Send className="w-4 h-4" />
            {testing || test.isPending ? "Sending…" : "Test"}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!canSave || pending}>
              {pending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
