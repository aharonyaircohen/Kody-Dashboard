/**
 * @fileType component
 * @domain kody
 * @pattern kody-bug-report-dialog
 * @ai-summary Report a bug in Kody ITSELF (dashboard/engine). Files into the
 *   Kody dashboard repo via /api/kody/report-kody-bug — distinct from
 *   BugReportDialog, which files into the consumer's connected repo.
 */
"use client";

import { useEffect, useState } from "react";
import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { kodyApi, redirectToLogin, SessionExpiredError } from "../api";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import {
  KODY_BUG_AREAS,
  KODY_BUG_SEVERITIES,
  type KodyBugArea,
  type KodyBugSeverity,
} from "../constants";

interface KodyBugReportDialogProps {
  open: boolean;
  onClose: () => void;
}

const AREA_LABEL: Record<KodyBugArea, string> = {
  dashboard: "Dashboard (this UI)",
  engine: "Engine (the build agent)",
  chat: "Chat",
  runners: "Runners / Fly",
  other: "Other / not sure",
};

const SEVERITY_LABEL: Record<KodyBugSeverity, string> = {
  blocker: "🟥 Blocker — can't use it",
  major: "🟧 Major — broken but workaround exists",
  minor: "🟨 Minor — cosmetic / small",
};

/** Snapshot the browser environment so maintainers don't have to ask. */
function captureDiagnostics(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const d: Record<string, string> = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
  };
  if (document.referrer) d.referrer = document.referrer;
  if (navigator.userAgent) d.userAgent = navigator.userAgent;
  if (navigator.platform) d.platform = navigator.platform;
  if (window.screen) d.screen = `${window.screen.width}×${window.screen.height}`;
  d.viewport = `${window.innerWidth}×${window.innerHeight}`;
  try {
    d.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // ignore
  }
  return d;
}

export function KodyBugReportDialog({ open, onClose }: KodyBugReportDialogProps) {
  const { githubUser } = useGitHubIdentity();

  const [title, setTitle] = useState("");
  const [area, setArea] = useState<KodyBugArea>("dashboard");
  const [severity, setSeverity] = useState<KodyBugSeverity>("major");
  const [whatHappened, setWhatHappened] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [where, setWhere] = useState("");

  const report = useMutation({
    mutationFn: () =>
      kodyApi.kodyBugs.report({
        title,
        area,
        severity,
        whatHappened,
        steps,
        expected,
        where,
        reporterLogin: githubUser?.login,
        diagnostics: captureDiagnostics(),
      }),
    onError: (error) => {
      if (error instanceof SessionExpiredError) redirectToLogin("/report-kody-bug");
    },
  });

  // Reset everything when the dialog is dismissed.
  useEffect(() => {
    if (!open) {
      setTitle("");
      setArea("dashboard");
      setSeverity("major");
      setWhatHappened("");
      setSteps("");
      setExpected("");
      setWhere("");
      report.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const created = report.data?.issue;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    report.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a Kody bug</DialogTitle>
          <DialogDescription>
            Something wrong with Kody itself (the dashboard or the build agent)?
            This opens an issue on the Kody repo — not your connected project.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="grid gap-4 py-6 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-green-500" />
            <div>
              <p className="font-medium">Thanks — your report was filed.</p>
              <p className="text-sm text-muted-foreground">
                Kody issue #{created.number}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <a
                href={created.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
              >
                <Button type="button" variant="outline" className="w-full gap-2">
                  <ExternalLink className="w-4 h-4" />
                  View on GitHub
                </Button>
              </a>
              <Button type="button" className="flex-1" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4 py-4">
            {report.error && (
              <div className="p-2 bg-destructive/10 text-destructive text-sm rounded">
                {report.error.message}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="kbug-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="kbug-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short description of what's broken"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="kbug-area">Component</Label>
                <Select
                  value={area}
                  onValueChange={(v) => setArea(v as KodyBugArea)}
                >
                  <SelectTrigger id="kbug-area">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KODY_BUG_AREAS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {AREA_LABEL[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="kbug-severity">Severity</Label>
                <Select
                  value={severity}
                  onValueChange={(v) => setSeverity(v as KodyBugSeverity)}
                >
                  <SelectTrigger id="kbug-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KODY_BUG_SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SEVERITY_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="kbug-what">
                What happened <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="kbug-what"
                value={whatHappened}
                onChange={(e) => setWhatHappened(e.target.value)}
                placeholder="Describe the problem you ran into."
                rows={3}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="kbug-steps">Steps to reproduce</Label>
              <Textarea
                id="kbug-steps"
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                placeholder={"1. Go to...\n2. Click...\n3. See error"}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="kbug-expected">Expected result</Label>
              <Textarea
                id="kbug-expected"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="What did you expect to happen instead?"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="kbug-where">Where in Kody did it happen?</Label>
              <Input
                id="kbug-where"
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                placeholder="e.g. Tasks board, a specific task, the chat, Settings…"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Your browser, screen size, and current page are attached
              automatically to help us reproduce it.
            </p>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={report.isPending}
              >
                {report.isPending ? "Filing…" : "Report bug"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
