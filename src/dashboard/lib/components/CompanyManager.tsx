/**
 * @fileType component
 * @domain kody
 * @pattern company-manager
 * @ai-summary Import/export a "Company" — the portable operating manual of
 *   an org (staff, duties, prompts, instructions). Export downloads a JSON
 *   bundle from the connected repo; Import uploads one and writes it back,
 *   with skip/overwrite collision handling. A separate card runs the
 *   one-time legacy `.kody/jobs|workers` → `duties|staff` folder migration.
 */
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Download,
  Upload,
  Loader2,
  Users,
  ListChecks,
  Bot,
  ScrollText,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { AuthGuard } from "../auth-guard";
import { useAuth } from "../auth-context";
import { kodyApi } from "../api";
import type {
  CompanyBundle,
  CompanyImportMode,
  CompanyImportResult,
} from "../company/types";
import { cn } from "../utils";

export function CompanyManager() {
  return (
    <AuthGuard>
      <CompanyManagerInner />
    </AuthGuard>
  );
}

function countLine(label: string, c: CompanyImportResult["staff"]): string {
  return `${label}: ${c.created} added, ${c.updated} updated, ${c.skipped} skipped${
    c.failed ? `, ${c.failed} failed` : ""
  }`;
}

function CompanyManagerInner() {
  const { auth } = useAuth();
  const actorLogin = auth?.user.login;
  const fileInput = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<CompanyImportMode>("skip");
  const [lastImport, setLastImport] = useState<CompanyImportResult | null>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const bundle = await kodyApi.company.export();
      const stamp = new Date().toISOString().slice(0, 10);
      const safeRepo = `${auth?.owner ?? "repo"}-${auth?.repo ?? ""}`.replace(
        /[^a-z0-9_-]+/gi,
        "-",
      );
      downloadJson(`kody-company-${safeRepo}-${stamp}.json`, bundle);
      const total =
        bundle.staff.length +
        bundle.duties.length +
        bundle.prompts.length +
        (bundle.instructions ? 1 : 0);
      toast.success(
        `Exported ${bundle.staff.length} staff, ${bundle.duties.length} duties, ${bundle.prompts.length} prompts${
          bundle.instructions ? ", instructions" : ""
        } (${total} items)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setLastImport(null);
    try {
      const text = await file.text();
      let bundle: CompanyBundle;
      try {
        bundle = JSON.parse(text) as CompanyBundle;
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      const result = await kodyApi.company.import(bundle, mode, actorLogin);
      setLastImport(result);
      const failed =
        result.staff.failed + result.duties.failed + result.prompts.failed;
      if (failed > 0) {
        toast.warning(`Imported with ${failed} failure(s) — see details below`);
      } else {
        toast.success("Company imported");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <PageShell
      title="Company"
      icon={Building2}
      iconClassName="text-emerald-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
    >
      <div className="space-y-4">
        <p className="text-sm text-white/60 max-w-2xl">
          A <span className="text-white/80">Company</span> is your org&apos;s
          portable operating manual — its{" "}
          <span className="text-white/80">staff</span>,{" "}
          <span className="text-white/80">duties</span>,{" "}
          <span className="text-white/80">prompts</span>, and{" "}
          <span className="text-white/80">instructions</span>. Export it from
          one repo and import it into another to stand up the same team
          instantly. Repo-specific state (memory, secrets, variables, goals)
          stays behind by design.
        </p>

        {/* Export */}
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-white/90 flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                Export company
              </p>
              <p className="text-xs text-white/50 mt-1">
                Download a JSON bundle of this repo&apos;s staff, duties,
                repo-defined prompts, and instructions.
              </p>
            </div>
            <Button size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  Exporting…
                </>
              ) : (
                "Export"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Import */}
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-white/90 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-sky-400" />
                  Import company
                </p>
                <p className="text-xs text-white/50 mt-1">
                  Upload a bundle to write its artifacts into this repo.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={importing}
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    Importing…
                  </>
                ) : (
                  "Choose file…"
                )}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportFile(f);
                }}
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/40">On collision:</span>
              {(["skip", "overwrite"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "px-2 py-1 rounded border transition-colors",
                    mode === m
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 text-white/50 hover:text-white/80",
                  )}
                >
                  {m === "skip" ? "Keep existing (skip)" : "Overwrite"}
                </button>
              ))}
            </div>

            {lastImport && (
              <div className="text-xs text-white/60 border-t border-white/[0.06] pt-3 space-y-1">
                <p>{countLine("Staff", lastImport.staff)}</p>
                <p>{countLine("Duties", lastImport.duties)}</p>
                <p>{countLine("Prompts", lastImport.prompts)}</p>
                <p>Instructions: {lastImport.instructions}</p>
                {lastImport.notes.length > 0 && (
                  <ul className="text-rose-300/80 mt-1 list-disc list-inside">
                    {lastImport.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* What's included */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-white/45">
          <Included icon={Users} label="Staff" />
          <Included icon={ListChecks} label="Duties" />
          <Included icon={Bot} label="Prompts" />
          <Included icon={ScrollText} label="Instructions" />
        </div>
      </div>
    </PageShell>
  );
}

function Included({
  icon: Icon,
  label,
}: {
  icon: typeof Users;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
      <Icon className="w-3.5 h-3.5 text-white/35" />
      {label}
    </div>
  );
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
