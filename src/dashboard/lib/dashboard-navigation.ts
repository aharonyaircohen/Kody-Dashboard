import { ALL_NAV_ITEMS, type SettingsNavItem } from "./components/settings-nav";
import { PACKAGE_ADMIN_PAGE_META } from "@kody-ade/kody-chat/admin-pages-meta";

export const DASHBOARD_TASK_ROUTE_ID = "task" as const;

export interface DashboardNavigationTarget {
  routeId: string;
  href: string;
  label: string;
  description: string;
  aliases: readonly string[];
  when: string;
}

export interface ResolvedDashboardNavigation {
  routeId: string;
  href: string;
  label: string;
  reason: string;
}

type RouteRule = {
  aliases?: readonly string[];
  when?: string;
};

const ROUTE_RULES_BY_HREF: Readonly<Record<string, RouteRule>> = {
  "/": {
    aliases: ["home", "overview", "dashboard home"],
    when: "Use when the user asks for the dashboard overview or home page.",
  },
  "/tasks": {
    aliases: ["tasks", "issues", "work", "pipeline"],
    when: "Use when the user asks to see tasks, issues, or current work.",
  },
  "/vibe": {
    aliases: ["vibe", "preview workspace", "approve and ship"],
    when: "Use when the user asks to work in the chat-driven preview surface.",
  },
  "/preview": {
    aliases: ["preview", "views", "browser", "environments"],
    when: "Use when the user asks to inspect a saved environment or preview.",
  },
  "/secrets": {
    aliases: ["secret", "secrets", "vault", "api key", "token"],
    when: "Use when the user asks to manage encrypted secrets or runtime keys.",
  },
  "/variables": {
    aliases: ["variables", "non-secret config", "env vars"],
    when: "Use when the user asks to manage non-secret runtime config.",
  },
  "/models": {
    aliases: ["models", "chat model", "llm", "provider"],
    when: "Use when the user asks to configure chat models or providers.",
  },
  "/instructions": {
    aliases: ["instructions", "tone", "behavior", "preferences"],
    when: "Use when the user asks to change Kody's standing chat behavior.",
  },
  "/context": {
    aliases: ["context", "curated context", "project notes"],
    when: "Use when the user asks to manage curated context files.",
  },
  "/memory": {
    aliases: ["memory", "remembered facts", "feedback"],
    when: "Use when the user asks to inspect or manage Kody memory.",
  },
  "/capabilities": {
    aliases: ["capabilities", "tools", "capability"],
    when: "Use when the user asks to manage reusable Kody capabilities.",
  },
  "/agents": {
    aliases: ["agents", "staff", "personas"],
    when: "Use when the user asks to manage agent identities.",
  },
  "/brands": {
    aliases: ["brands", "client brands", "client chat"],
    when: "Use when the user asks to manage client chat brands.",
  },
  ...Object.fromEntries(
    PACKAGE_ADMIN_PAGE_META.map((page) => [
      page.href,
      { aliases: [...page.aliases], when: page.when },
    ]),
  ),
  "/agent-goals": {
    aliases: ["goals", "missions", "outcomes"],
    when: "Use when the user asks to inspect or manage goals.",
  },
  "/agent-loops": {
    aliases: ["loops", "recurring work", "cadence"],
    when: "Use when the user asks to inspect or manage operational loops.",
  },
  "/workflows": {
    aliases: ["workflows", "queues", "steps"],
    when: "Use when the user asks to inspect or manage workflows.",
  },
  "/activity": {
    aliases: ["activity", "runs", "health", "logs"],
    when: "Use when the user asks for run health, activity, or failures.",
  },
  "/reports": {
    aliases: ["reports", "outputs", "artifacts"],
    when: "Use when the user asks to view capability run outputs.",
  },
  "/todos": {
    aliases: ["todos", "todo lists", "worklists"],
    when: "Use when the user asks to inspect or manage dashboard todo lists.",
  },
  "/files": {
    aliases: ["files", "repo files", "file browser"],
    when: "Use when the user asks to browse or edit repository files.",
  },
  "/docs": {
    aliases: ["docs", "readme", "documentation"],
    when: "Use when the user asks to browse README or docs.",
  },
};

const TASK_TARGET: DashboardNavigationTarget = {
  routeId: DASHBOARD_TASK_ROUTE_ID,
  href: "/:issueNumber",
  label: "Task detail",
  description: "Open a specific task or issue by number.",
  aliases: ["task", "issue", "ticket", "pr task"],
  when: "Use when the user asks to open a specific task or issue number. Requires issueNumber.",
};

function routeIdForHref(href: string): string {
  if (href === "/") return "dashboard";
  return href.split("?")[0].split("/").filter(Boolean).join("-");
}

function targetFromItem(item: SettingsNavItem): DashboardNavigationTarget {
  const rules = ROUTE_RULES_BY_HREF[item.href] ?? {};
  return {
    routeId: routeIdForHref(item.href),
    href: item.href,
    label: item.label,
    description: item.description ?? `${item.label} page.`,
    aliases: rules.aliases ?? [item.label.toLowerCase()],
    when: rules.when ?? `Use when the user asks to open ${item.label}.`,
  };
}

export const DASHBOARD_NAVIGATION_TARGETS: readonly DashboardNavigationTarget[] =
  [
    TASK_TARGET,
    ...ALL_NAV_ITEMS.map(targetFromItem).filter((target, index, all) => {
      return all.findIndex((item) => item.routeId === target.routeId) === index;
    }),
  ];

const TARGET_BY_ID = new Map(
  DASHBOARD_NAVIGATION_TARGETS.map((target) => [target.routeId, target]),
);

export function dashboardNavigationCatalogForPrompt(): string {
  return DASHBOARD_NAVIGATION_TARGETS.map((target) => {
    const aliases = target.aliases.length
      ? ` Aliases: ${target.aliases.join(", ")}.`
      : "";
    return `- ${target.routeId}: ${target.label} -> ${target.href}. ${target.when}${aliases}`;
  }).join("\n");
}

export function resolveDashboardNavigationTarget(input: {
  routeId: string;
  issueNumber?: number;
  reason: string;
}): ResolvedDashboardNavigation | { error: string } {
  const routeId = input.routeId.trim();
  const target = TARGET_BY_ID.get(routeId);
  if (!target) {
    return {
      error: `Unknown dashboard route "${input.routeId}". Use one of: ${DASHBOARD_NAVIGATION_TARGETS.map((item) => item.routeId).join(", ")}`,
    };
  }

  if (target.routeId === DASHBOARD_TASK_ROUTE_ID) {
    if (
      typeof input.issueNumber !== "number" ||
      !Number.isInteger(input.issueNumber) ||
      input.issueNumber <= 0
    ) {
      return { error: "Task navigation requires a positive issueNumber." };
    }
    return {
      routeId: target.routeId,
      href: `/${input.issueNumber}`,
      label: `Task #${input.issueNumber}`,
      reason: input.reason,
    };
  }

  return {
    routeId: target.routeId,
    href: target.href,
    label: target.label,
    reason: input.reason,
  };
}
