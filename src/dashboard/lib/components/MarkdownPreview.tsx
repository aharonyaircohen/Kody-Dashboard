/**
 * @fileType component
 * @domain files
 * @pattern markdown-preview
 * @ai-summary Renders rich read-only Markdown previews for repo files.
 */

"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Info,
  Lightbulb,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@dashboard/lib/utils";
import {
  detectCalloutKind,
  extractCodeLanguage,
  slugifyHeading,
  stripCalloutMarker,
  type MarkdownCalloutKind,
} from "@dashboard/lib/markdown-preview-utils";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  dir?: React.HTMLAttributes<HTMLDivElement>["dir"];
  variant?: "document" | "compact";
}

const calloutStyles: Record<
  MarkdownCalloutKind,
  { label: string; icon: React.ElementType; className: string }
> = {
  note: {
    label: "Note",
    icon: Info,
    className:
      "border-blue-400/40 bg-blue-500/10 text-blue-900 dark:text-blue-100",
  },
  tip: {
    label: "Tip",
    icon: Lightbulb,
    className:
      "border-emerald-400/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
  },
  important: {
    label: "Important",
    icon: AlertCircle,
    className:
      "border-violet-400/40 bg-violet-500/10 text-violet-900 dark:text-violet-100",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    className:
      "border-amber-400/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
  },
  caution: {
    label: "Caution",
    icon: ShieldAlert,
    className: "border-red-400/40 bg-red-500/10 text-red-900 dark:text-red-100",
  },
};

function textFromChildren(children: React.ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(children)) {
    return textFromChildren(children.props.children);
  }
  return "";
}

function stripCalloutMarkerFromChildren(
  children: React.ReactNode,
): React.ReactNode {
  let markerRemoved = false;

  const stripNode = (node: React.ReactNode): React.ReactNode => {
    if (markerRemoved) return node;
    if (typeof node === "string") {
      markerRemoved = true;
      return stripCalloutMarker(node);
    }
    if (Array.isArray(node)) {
      return node.map((child, index) => (
        <React.Fragment key={index}>{stripNode(child)}</React.Fragment>
      ));
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
      return React.cloneElement(node, {
        children: stripNode(node.props.children),
      });
    }
    return node;
  };

  return stripNode(children);
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded border border-white/10",
        "text-white/50 hover:bg-white/10 hover:text-white/90",
      )}
      title="Copy code"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function HighlightedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const highlight = async () => {
      try {
        const [{ codeToHtml }, { default: DOMPurify }] = await Promise.all([
          import("shiki"),
          import("dompurify"),
        ]);
        const html = await codeToHtml(code, {
          lang: language ?? "text",
          theme: "github-dark-dimmed",
        });
        if (!cancelled) setHighlightedHtml(DOMPurify.sanitize(html));
      } catch {
        if (!cancelled) setHighlightedHtml(null);
      }
    };

    highlight();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <div className="my-4 overflow-hidden rounded-md border border-white/10 bg-[#0d1117]">
      <div className="flex h-9 items-center gap-2 border-b border-white/10 px-3">
        <span className="text-xs uppercase tracking-normal text-white/45">
          {language ?? "text"}
        </span>
        <div className="ml-auto">
          <CopyButton value={code} />
        </div>
      </div>
      {highlightedHtml ? (
        <div
          className="[&_code]:text-[13px] [&_code]:leading-6 [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-4"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="m-0 overflow-x-auto bg-transparent p-4 text-[13px] leading-6 text-white/80">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      setError(null);
      setSvg(null);

      try {
        const [{ default: mermaid }, { default: DOMPurify }] =
          await Promise.all([import("mermaid"), import("dompurify")]);

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          themeVariables: {
            background: "transparent",
            mainBkg: "#18181b",
            primaryColor: "#18181b",
            primaryTextColor: "#f4f4f5",
            primaryBorderColor: "#3f3f46",
            lineColor: "#a1a1aa",
            textColor: "#f4f4f5",
          },
        });

        const result = await mermaid.render(`kody-mermaid-${renderId}`, chart);
        const cleanSvg = DOMPurify.sanitize(result.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });

        if (!cancelled) setSvg(cleanSvg);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Invalid Mermaid diagram",
          );
        }
      }
    };

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [chart, renderId]);

  if (error) {
    return (
      <div className="my-4 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Mermaid diagram could not render
        </div>
        <pre className="m-0 overflow-x-auto bg-transparent text-xs text-red-100/80">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="my-4 overflow-x-auto rounded-md border border-white/10 bg-zinc-950/60 p-4">
      {svg ? (
        <div
          className="flex min-w-max justify-center [&_svg]:h-auto [&_svg]:max-w-none"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-sm text-white/45">Rendering diagram...</div>
      )}
    </div>
  );
}

function RichCode({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const code = String(children ?? "").replace(/\n$/, "");
  const language = extractCodeLanguage(className);

  if (language === "mermaid") {
    return <MermaidBlock chart={code} />;
  }

  if (language) {
    return <HighlightedCodeBlock code={code} language={language} />;
  }

  return (
    <code className="rounded bg-white/5 px-1 py-0.5 text-emerald-300">
      {children}
    </code>
  );
}

function RichBlockquote({ children }: { children?: React.ReactNode }) {
  const text = textFromChildren(children);
  const calloutKind = detectCalloutKind(text);

  if (!calloutKind) {
    return (
      <blockquote className="border-l-2 border-emerald-500/70 pl-4 text-muted-foreground">
        {children}
      </blockquote>
    );
  }

  const callout = calloutStyles[calloutKind];
  const Icon = callout.icon;

  return (
    <div className={cn("my-4 rounded-md border p-3", callout.className)}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4" />
        {callout.label}
      </div>
      <div className="text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {stripCalloutMarkerFromChildren(children)}
      </div>
    </div>
  );
}

function Heading({
  level,
  children,
}: {
  level: 1 | 2 | 3 | 4;
  children?: React.ReactNode;
}) {
  const text = textFromChildren(children);
  const id = useMemo(() => slugifyHeading(text), [text]);
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";

  return (
    <Tag id={id} className="group scroll-mt-20">
      <a
        href={`#${id}`}
        className="no-underline after:ml-2 after:text-muted-foreground/35 after:content-['#'] hover:after:text-muted-foreground/70"
      >
        {children}
      </a>
    </Tag>
  );
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => {
    const isHashLink = href?.startsWith("#");

    return (
      <a
        href={href}
        target={isHashLink ? undefined : "_blank"}
        rel={isHashLink ? undefined : "noopener noreferrer"}
        {...props}
      >
        {children}
      </a>
    );
  },
  blockquote: RichBlockquote,
  code: RichCode,
  pre: ({ children }) => <>{children}</>,
  h1: ({ children }) => <Heading level={1}>{children}</Heading>,
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  h4: ({ children }) => <Heading level={4}>{children}</Heading>,
};

export function MarkdownPreview({
  content,
  className,
  dir,
  variant = "document",
}: MarkdownPreviewProps) {
  return (
    <div
      dir={dir}
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert",
        variant === "compact" &&
          "text-sm prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-blockquote:my-2",
        "prose-headings:text-foreground",
        "prose-p:text-muted-foreground",
        "prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-blue-400",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-transparent prose-pre:p-0",
        "prose-strong:text-foreground",
        "prose-ul:text-muted-foreground prose-ol:text-muted-foreground",
        "prose-li:marker:text-muted-foreground/60",
        "prose-table:text-muted-foreground",
        "prose-th:text-foreground prose-th:border-border",
        "prose-td:border-border",
        "prose-hr:border-border",
        "prose-img:max-w-full prose-img:rounded-md",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
