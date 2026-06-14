/**
 * @fileType component
 * @domain kody
 * @pattern file-diff
 * @ai-summary Renders a unified-diff patch string with line numbers, red/green hunks, and syntax-highlighted code.
 */
"use client";

import { useMemo } from "react";
import hljs from "highlight.js/lib/common";
import { cn } from "../utils";

type DiffLine = {
  type: "context" | "add" | "del" | "hunk";
  text: string;
  oldNum?: number;
  newNum?: number;
};

function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNum = parseInt(match[1], 10);
        newNum = parseInt(match[2], 10);
      }
      lines.push({ type: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push({ type: "add", text: raw.slice(1), newNum });
      newNum++;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      lines.push({ type: "del", text: raw.slice(1), oldNum });
      oldNum++;
    } else if (raw.startsWith(" ")) {
      lines.push({ type: "context", text: raw.slice(1), oldNum, newNum });
      oldNum++;
      newNum++;
    } else if (raw.startsWith("\\")) {
      lines.push({ type: "context", text: raw });
    }
  }
  return lines;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  html: "xml",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  dockerfile: "dockerfile",
};

function detectLanguage(filename?: string): string | null {
  if (!filename) return null;
  const base = filename.split("/").pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return "dockerfile";
  const ext = base.split(".").pop();
  if (!ext) return null;
  const lang = EXT_TO_LANG[ext];
  if (!lang) return null;
  return hljs.getLanguage(lang) ? lang : null;
}

function highlightLine(text: string, lang: string | null): string {
  if (!text) return "";
  if (!lang) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface FileDiffProps {
  patch: string;
  filename?: string;
}

export function FileDiff({ patch, filename }: FileDiffProps) {
  const lang = useMemo(() => detectLanguage(filename), [filename]);
  const lines = useMemo(() => parsePatch(patch), [patch]);

  return (
    <div className="font-mono text-xs leading-5 overflow-x-auto bg-zinc-950/50 border border-zinc-800 rounded">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => {
            if (line.type === "hunk") {
              return (
                <tr key={i} className="bg-blue-500/10 text-blue-300">
                  <td colSpan={3} className="px-3 py-1 select-none">
                    {line.text}
                  </td>
                </tr>
              );
            }
            const bg =
              line.type === "add"
                ? "bg-green-500/10"
                : line.type === "del"
                  ? "bg-red-500/10"
                  : "";
            const sign =
              line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
            const html = highlightLine(line.text, lang);
            return (
              <tr key={i} className={cn(bg, "hover:bg-zinc-800/40")}>
                <td className="px-2 text-right text-zinc-600 select-none w-12 align-top">
                  {line.oldNum ?? ""}
                </td>
                <td className="px-2 text-right text-zinc-600 select-none w-12 align-top border-r border-zinc-800">
                  {line.newNum ?? ""}
                </td>
                <td className="px-3 whitespace-pre text-zinc-200">
                  <span
                    className={cn(
                      "select-none mr-2",
                      line.type === "add"
                        ? "text-green-400"
                        : line.type === "del"
                          ? "text-red-400"
                          : "text-zinc-600",
                    )}
                  >
                    {sign}
                  </span>
                  <span dangerouslySetInnerHTML={{ __html: html }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
