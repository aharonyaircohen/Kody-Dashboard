/**
 * @fileType component
 * @domain kody
 * @pattern operators-card
 * @ai-summary Company-page card to manage the operator list
 *   (`github.operators`) — the logins recommendation capabilities (pr-health/CTO)
 *   @-mention so their comments reach the inbox. Add/remove handles; the list
 *   is the company's explicit choice (no auto-fill). Warns when empty, since
 *   an empty list means recommendations reach nobody's inbox.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Inbox, Loader2, Plus, X, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@dashboard/ui/card";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { useOperators } from "../operators/useOperators";

export function OperatorsCard() {
  const { operators, loading, saving, meIncluded, meLogin, add, remove } =
    useOperators();
  const [draft, setDraft] = useState("");

  async function handleAdd(login: string) {
    const handle = login.trim().replace(/^@+/, "");
    if (!handle) return;
    try {
      await add(handle);
      setDraft("");
    } catch {
      toast.error("Couldn't save operators");
    }
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-3">
        <div className="min-w-0">
          <p className="font-medium text-white/90 flex items-center gap-2">
            <Inbox className="w-4 h-4 text-amber-400" />
            Operators
          </p>
          <p className="text-xs text-white/50 mt-1">
            Who gets recommendations in their inbox. Capabilities @-mention these
            people; an empty list means recommendations reach no one.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {operators.length === 0 ? (
              <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  No operators set — recommendations won&apos;t reach
                  anyone&apos;s inbox.
                </span>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {operators.map((op) => (
                  <li
                    key={op.toLowerCase()}
                    className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-sm text-white/80"
                  >
                    <span className="truncate">@{op}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${op}`}
                      disabled={saving}
                      onClick={() => {
                        void remove(op).catch(() =>
                          toast.error("Couldn't save operators"),
                        );
                      }}
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
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAdd(draft);
                  }
                }}
                placeholder="GitHub username"
                disabled={saving}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={saving || !draft.trim()}
                onClick={() => void handleAdd(draft)}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>

            {meLogin && !meIncluded && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleAdd(meLogin)}
                className="text-xs text-emerald-300/80 hover:text-emerald-200 disabled:opacity-50"
              >
                + Add me (@{meLogin})
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
