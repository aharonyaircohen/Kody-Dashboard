/**
 * @fileType component
 * @domain kody
 * @pattern notifications-manager
 * @ai-summary CRUD UI for notification rules. Supports multiple channel
 *   types (Slack, Telegram, Discord, generic webhook) via a discriminated
 *   union. The form swaps fields based on the selected channel type.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, BookOpen, Pencil, Plus, Send, Trash2 } from "lucide-react";
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
  CHANNEL_TYPES,
  channelTypeLabel,
  defaultTemplateForEvent,
  eventLabel,
  type ChannelType,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationRule,
} from "../notifications";
import { validateChannel } from "../notifications/channels";

interface FormState {
  id?: string;
  name: string;
  enabled: boolean;
  event: NotificationEvent;
  channel: NotificationChannel;
  template: string;
}

function blankChannel(type: ChannelType): NotificationChannel {
  switch (type) {
    case "slack-webhook":
      return { type: "slack-webhook", url: "" };
    case "telegram-bot":
      return { type: "telegram-bot", botToken: "", chatId: "" };
    case "discord-webhook":
      return { type: "discord-webhook", url: "" };
    case "generic-webhook":
      return { type: "generic-webhook", url: "" };
    case "web-push":
      return { type: "web-push" };
  }
}

const blankForm: FormState = {
  name: "",
  enabled: true,
  event: "deploy_pr_merged",
  channel: blankChannel("slack-webhook"),
  template: "",
};

function ruleToForm(rule: NotificationRule): FormState {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    event: rule.event,
    channel: rule.channel,
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
    <PageShell
      title="Notifications"
      icon={Bell}
      iconClassName="text-sky-400"
      width="wide"
      actions={
        <>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/notifications/docs" aria-label="Notifications docs">
              <BookOpen className="w-4 h-4" />
              Docs
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => setEditing({ ...blankForm })}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            New rule
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-white/50">Loading rules…</p>}
        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load rules
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

        {!isLoading && !error && rules.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Bell className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">
                No notification rules yet.
              </p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Add a rule to ping Slack, Telegram, Discord, or a custom
                webhook when a release deploy PR merges, a kody flow fails,
                or other events fire.
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
                  channel: rule.channel,
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
          Channel secrets (Slack URLs, Telegram bot tokens, etc.) sit in that
          issue body — keep this repo private.
        </p>
      </div>

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
    </PageShell>
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
            {eventLabel(rule.event)} → {channelTypeLabel(rule.channel.type)}
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
  createMutation: ReturnType<typeof useCreateNotification>;
  actorLogin?: string;
}) {
  const isEdit = !!form.id;
  const [name, setName] = useState(form.name);
  const [enabled, setEnabled] = useState(form.enabled);
  const [event, setEvent] = useState<NotificationEvent>(form.event);
  const [channel, setChannel] = useState<NotificationChannel>(form.channel);
  const [template, setTemplate] = useState(form.template);

  const updateMutation = useUpdateNotification(form.id ?? "", actorLogin);
  const test = useTestNotification(actorLogin);

  const channelError = validateChannel(channel);
  const canSave = name.trim().length > 0 && channelError === null;
  const pending = createMutation.isPending || updateMutation.isPending;

  function handleChannelTypeChange(type: ChannelType) {
    setChannel(blankChannel(type));
  }

  function handleSave() {
    const payload = {
      name: name.trim(),
      enabled,
      event,
      channel,
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
    if (channelError !== null) return;
    test.mutate({
      channel,
      text: `:test_tube: kody test for rule \`${name || "(unnamed)"}\``,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit rule" : "New notification rule"}
          </DialogTitle>
          <DialogDescription>
            One event, one channel. Pick a transport then fill in the
            channel-specific fields.
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
            <Label htmlFor="rule-channel-type">Channel</Label>
            <Select
              value={channel.type}
              onValueChange={(v) => handleChannelTypeChange(v as ChannelType)}
            >
              <SelectTrigger id="rule-channel-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {channelTypeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ChannelFields channel={channel} onChange={setChannel} />

          {channelError && (
            <p className="text-xs text-rose-400">{channelError}</p>
          )}

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
              placeholder={defaultTemplateForEvent(event)}
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
            disabled={channelError !== null || test.isPending}
            className="gap-1"
          >
            <Send className="w-4 h-4" />
            {test.isPending ? "Sending…" : "Test"}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || pending}
            >
              {pending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChannelFields({
  channel,
  onChange,
}: {
  channel: NotificationChannel;
  onChange: (next: NotificationChannel) => void;
}) {
  switch (channel.type) {
    case "slack-webhook":
      return (
        <div className="space-y-1.5">
          <Label htmlFor="ch-slack-url">Webhook URL</Label>
          <Input
            id="ch-slack-url"
            value={channel.url}
            onChange={(e) => onChange({ ...channel, url: e.target.value })}
            placeholder="https://hooks.slack.com/services/T.../B.../..."
            type="url"
          />
          <p className="text-[11px] text-white/40">
            Slack app → Incoming Webhooks → Add New Webhook to Workspace.
          </p>
        </div>
      );
    case "telegram-bot":
      return (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="ch-tg-token">Bot token</Label>
            <Input
              id="ch-tg-token"
              value={channel.botToken}
              onChange={(e) =>
                onChange({ ...channel, botToken: e.target.value })
              }
              placeholder="123456:AA-Ee-..."
              type="password"
            />
            <p className="text-[11px] text-white/40">
              Get one from @BotFather. Format:{" "}
              <code>&lt;bot-id&gt;:&lt;35-char-token&gt;</code>.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-tg-chat">Chat ID</Label>
            <Input
              id="ch-tg-chat"
              value={channel.chatId}
              onChange={(e) =>
                onChange({ ...channel, chatId: e.target.value })
              }
              placeholder="-1001234567890 or @channelname"
            />
            <p className="text-[11px] text-white/40">
              Numeric for groups (negative), <code>@username</code> for public
              channels. Add the bot to the chat first.
            </p>
          </div>
        </>
      );
    case "discord-webhook":
      return (
        <div className="space-y-1.5">
          <Label htmlFor="ch-discord-url">Webhook URL</Label>
          <Input
            id="ch-discord-url"
            value={channel.url}
            onChange={(e) => onChange({ ...channel, url: e.target.value })}
            placeholder="https://discord.com/api/webhooks/..."
            type="url"
          />
          <p className="text-[11px] text-white/40">
            Server settings → Integrations → Webhooks → New Webhook.
          </p>
        </div>
      );
    case "generic-webhook": {
      const format = channel.bodyFormat ?? "json";
      return (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="ch-gen-url">URL (https only)</Label>
            <Input
              id="ch-gen-url"
              value={channel.url}
              onChange={(e) => onChange({ ...channel, url: e.target.value })}
              placeholder="https://example.com/webhook"
              type="url"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-gen-format">Body format</Label>
            <Select
              value={format}
              onValueChange={(v) =>
                onChange({
                  ...channel,
                  bodyFormat: v === "form" ? "form" : undefined,
                })
              }
            >
              <SelectTrigger id="ch-gen-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">
                  JSON (application/json)
                </SelectItem>
                <SelectItem value="form">
                  Form-encoded (application/x-www-form-urlencoded)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-white/40">
              Use <span className="text-white/60">JSON</span> for most
              modern APIs (Slack-shaped, Mattermost, GChat, etc.). Use{" "}
              <span className="text-white/60">Form-encoded</span> for
              Twilio, Mailgun, and most legacy REST APIs.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-gen-tmpl">
              {format === "form" ? "Body template" : "JSON body template"}{" "}
              <span className="text-white/40 text-[11px]">
                {format === "form" ? "(required)" : "(optional)"}
              </span>
            </Label>
            <Textarea
              id="ch-gen-tmpl"
              value={channel.jsonTemplate ?? ""}
              onChange={(e) =>
                onChange({
                  ...channel,
                  jsonTemplate: e.target.value || undefined,
                })
              }
              rows={4}
              placeholder={
                format === "form"
                  ? '{"From":"whatsapp:+...","To":"whatsapp:+...","Body":"{{repo}} {{version}} shipped"}'
                  : '{"text":"{{repo}} {{version}} shipped"}'
              }
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-white/40">
              {format === "form"
                ? "Write a flat JSON object — the dashboard URL-form-encodes each key=value pair before posting."
                : "Empty = sends "}
              {format === "json" && (
                <code>{`{"text":"<rendered template>"}`}</code>
              )}
              {format === "json" && ". "}
              Use <code>{"{{var}}"}</code> tokens; the rendered string must
              parse as JSON.
            </p>
          </div>
          <p className="text-[11px] text-white/30">
            See{" "}
            <Link
              href="/notifications/docs"
              className="underline hover:text-white/50"
            >
              docs
            </Link>{" "}
            for full setup recipes (Twilio WhatsApp, Mattermost, etc.).
          </p>
        </>
      );
    }
    case "web-push":
      return (
        <p className="text-[11px] text-white/40">
          Notifications go to every device that has enabled push for this
          repo via Notification Settings → Mobile / push notifications.
          No per-channel config — server-side fan-out via VAPID.
        </p>
      );
  }
}
