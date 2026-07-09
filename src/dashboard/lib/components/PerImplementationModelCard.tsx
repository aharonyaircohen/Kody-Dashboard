/**
 * @fileType component
 * @domain variables
 * @pattern per-capability-model-card
 * @ai-summary /models card for the `agent.perImplementation` config map.
 *   Public copy calls these per-capability model overrides.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X, Cpu } from "lucide-react";
import { Card, CardContent } from "@dashboard/ui/card";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { useEngineConfig } from "../engine/useEngineConfig";
import { engineModelSpec, type ChatModel } from "../variables/models";

export function PerImplementationModelCard({
  models,
}: {
  models: ChatModel[];
}) {
  const { config, loading, saving, save } = useEngineConfig();
  const [slug, setSlug] = useState("");
  const [spec, setSpec] = useState("");
  const entries = Object.entries(config?.perImplementation ?? {});

  // Distinct engine specs from the configured models, for the dropdown.
  const specOptions = Array.from(
    new Map(
      models.map((m) => [engineModelSpec(m), m.label || m.modelName]),
    ).entries(),
  ).filter(([s]) => s);

  async function persist(next: Record<string, string>) {
    try {
      await save({ perImplementation: next });
    } catch {
      toast.error("Couldn't save model overrides");
    }
  }

  async function handleAdd() {
    const s = slug.trim();
    const m = spec.trim();
    if (!s || !m) return;
    await persist({ ...(config?.perImplementation ?? {}), [s]: m });
    setSlug("");
    setSpec("");
  }

  async function handleRemove(key: string) {
    const next = { ...(config?.perImplementation ?? {}) };
    delete next[key];
    await persist(next);
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-3">
        <div className="min-w-0">
          <p className="font-medium text-white/90 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-sky-400" />
            Per-capability model
          </p>
          <p className="text-xs text-white/50 mt-1">
            Run a specific capability on a different model than the engine
            default, e.g. <code className="text-white/70">research</code> on a
            deeper model. Everything else uses the engine default above.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </div>
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
                      aria-label={`Remove override for ${key}`}
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
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="capability (e.g. research)"
                disabled={saving}
                className="h-8 text-sm font-mono"
              />
              <span className="text-white/30">→</span>
              <Input
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAdd();
                  }
                }}
                list="per-implementation-model-specs"
                placeholder="provider/model"
                disabled={saving}
                className="h-8 text-sm font-mono"
              />
              <datalist id="per-implementation-model-specs">
                {specOptions.map(([s, label]) => (
                  <option key={s} value={s}>
                    {label}
                  </option>
                ))}
              </datalist>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || !slug.trim() || !spec.trim()}
                onClick={() => void handleAdd()}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
