/**
 * @fileType component
 * @domain wizards
 * @pattern wizard-runner
 * @ai-summary Generic renderer for declarative WizardDefinitions: progress
 *   header, back/next, per-step UI (instructions / collect-variable /
 *   collect-secret / check), resume via localStorage. Collect steps save
 *   through the existing /variables and /secrets APIs; check steps call
 *   /api/kody/wizards/check.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import type { WizardDefinition, WizardStep } from "@dashboard/lib/wizards/types";
import { PageShell } from "./PageShell";

interface WizardRunnerProps {
  definition: WizardDefinition;
  /** Distinguishes runs of the same wizard (e.g. per provider). */
  instanceKey?: string;
  /** Where the final "Done" button navigates. */
  doneHref?: string;
}

interface StepState {
  status: "idle" | "saving" | "done" | "error";
  message?: string;
}

export function WizardRunner({
  definition,
  instanceKey = "",
  doneHref,
}: WizardRunnerProps) {
  const { auth } = useAuth();
  const headers: Record<string, string> = useMemo(
    () => ({ "Content-Type": "application/json", ...buildAuthHeaders(auth) }),
    [auth],
  );
  const storageKey = `kody:wizard:${definition.slug}:${instanceKey}`;

  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, StepState>>({});

  // Resume: restore the step index for this wizard instance.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = Number.parseInt(raw, 10);
      if (Number.isInteger(saved) && saved > 0 && saved < definition.steps.length) {
        setIndex(saved);
      }
    } catch {
      /* resume is best-effort */
    }
  }, [storageKey, definition.steps.length]);

  const persistIndex = (next: number) => {
    setIndex(next);
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      /* best-effort */
    }
  };

  const step = definition.steps[index]!;
  const state = states[step.id] ?? { status: "idle" };
  const isLast = index === definition.steps.length - 1;

  const setStepState = (id: string, next: StepState) =>
    setStates((prev) => ({ ...prev, [id]: next }));

  const saveCollect = async (
    collect: Extract<WizardStep, { type: "collect-variable" | "collect-secret" }>,
  ) => {
    const value = (values[collect.id] ?? "").trim();
    if (!value) {
      setStepState(collect.id, { status: "error", message: "Enter a value first." });
      return;
    }
    setStepState(collect.id, { status: "saving" });
    const endpoint =
      collect.type === "collect-variable" ? "/api/kody/variables" : "/api/kody/secrets";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: collect.name, value }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setStepState(collect.id, { status: "done", message: `Saved ${collect.name}.` });
    } catch (error) {
      setStepState(collect.id, {
        status: "error",
        message: error instanceof Error ? error.message : "Save failed",
      });
    }
  };

  const runCheck = async (check: Extract<WizardStep, { type: "check" }>) => {
    setStepState(check.id, { status: "saving" });
    try {
      const res = await fetch("/api/kody/wizards/check", {
        method: "POST",
        headers,
        body: JSON.stringify({ checkId: check.checkId, params: check.params }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.message || "Check failed");
      }
      setStepState(check.id, { status: "done", message: json.message });
    } catch (error) {
      setStepState(check.id, {
        status: "error",
        message: error instanceof Error ? error.message : "Check failed",
      });
    }
  };

  const canContinue =
    step.type === "instructions" || state.status === "done";

  return (
    <PageShell
      title={definition.title}
      subtitle={definition.description}
      backHref="/setup"
    >
      <div className="flex items-center gap-1.5" aria-label="Progress">
        {definition.steps.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 flex-1 rounded-full ${
              i < index ? "bg-primary" : i === index ? "bg-primary/60" : "bg-muted"
            }`}
          />
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-medium">
          {index + 1}. {step.title}
        </h2>

        {step.type === "instructions" && (
          <>
            <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-muted-foreground">
              {step.body}
            </p>
            {step.href && (
              <a
                href={step.href}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline"
              >
                Open console <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        )}

        {(step.type === "collect-variable" || step.type === "collect-secret") && (
          <div className="mt-3">
            <Label htmlFor={`wizard-${step.id}`} className="text-xs">
              {step.name}
            </Label>
            <div className="mt-1 flex gap-2">
              <Input
                id={`wizard-${step.id}`}
                type={step.type === "collect-secret" ? "password" : "text"}
                value={values[step.id] ?? ""}
                placeholder={
                  step.type === "collect-variable" ? step.placeholder : undefined
                }
                onChange={(event) => {
                  setValues((prev) => ({ ...prev, [step.id]: event.target.value }));
                  if (state.status !== "idle") setStepState(step.id, { status: "idle" });
                }}
                className="font-mono"
              />
              <Button
                size="sm"
                onClick={() => saveCollect(step)}
                disabled={state.status === "saving"}
              >
                {state.status === "saving" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
            {step.hint && (
              <p className="mt-1 text-xs text-muted-foreground">{step.hint}</p>
            )}
          </div>
        )}

        {step.type === "check" && (
          <div className="mt-3">
            {step.hint && (
              <p className="text-xs text-muted-foreground">{step.hint}</p>
            )}
            <Button
              size="sm"
              className="mt-2"
              onClick={() => runCheck(step)}
              disabled={state.status === "saving"}
            >
              {state.status === "saving" ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Checking...
                </>
              ) : (
                "Run check"
              )}
            </Button>
          </div>
        )}

        {state.message && (
          <p
            className={`mt-3 flex items-center gap-1.5 text-sm ${
              state.status === "error" ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {state.status === "error" ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {state.message}
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => persistIndex(Math.max(0, index - 1))}
          disabled={index === 0}
        >
          Back
        </Button>
        {isLast ? (
          <Button size="sm" disabled={!canContinue} asChild>
            <a href={doneHref ?? "/brands"}>Done</a>
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!canContinue}
            onClick={() => persistIndex(index + 1)}
          >
            Next
          </Button>
        )}
      </div>
    </PageShell>
  );
}
