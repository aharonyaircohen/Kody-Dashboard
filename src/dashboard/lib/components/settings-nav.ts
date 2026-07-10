/**
 * @fileType data
 * @domain kody
 * @pattern settings-nav
 * @ai-summary Single source of truth for the settings sidebar
 *   (SettingsDrawer + MobileMenu). Defines sections + items so both
 *   sidebars render the same grouping. Add new pages here once; both
 *   sidebars pick them up automatically.
 */
import {
  Activity,
  Bell,
  Bot,
  Brain,
  Building2,
  Wand2,
  CheckCircle2,
  Compass,
  Cpu,
  Database,
  FileText,
  FolderOpen,
  History,
  Home,
  KeyRound,
  Layers,
  Languages,
  LayoutGrid,
  MessageSquare,
  MonitorPlay,
  Package,
  Palette,
  Route,
  ScrollText,
  Settings as SettingsIcon,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { repoPathForNavMatching } from "@dashboard/lib/routes";

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Long-form blurb for the desktop drawer. */
  description?: string;
  /** Tailwind classes for the mobile menu's icon tint chip. */
  tint?: string;
  /** When true, only the exact path is active unless extra patterns match. */
  exact?: boolean;
  /** Extra route shapes owned by this item, e.g. task issue-number pages. */
  activePathPatterns?: readonly RegExp[];
}

/**
 * Primary surfaces — the top of the sidebar and the first palette group.
 * Shared so the Sidebar, CommandPalette (and eventually MobileMenu) render
 * one list instead of drifting copies.
 */
/** Chat — the primary assistant view. NOT rendered in the nav lists (the
 *  header ViewToggle switches Chat/Tasks); kept here only so navLabelForPath
 *  can resolve "/chat" → "Chat" and as the canonical home href. */
export const HOME_NAV_ITEM: SettingsNavItem = {
  href: "/chat",
  label: "Chat",
  icon: MessageSquare,
  exact: true,
  description: "Chat with Kody — coding help, notes, and ideas.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/** Tasks view — sibling of Chat. Also NOT rendered in the nav lists (same
 *  ViewToggle reason); kept only so navLabelForPath resolves "/tasks". */
export const TASKS_NAV_ITEM: SettingsNavItem = {
  href: "/tasks",
  label: "Tasks",
  icon: Home,
  exact: true,
  activePathPatterns: [/^\/\d+(?:\/|$)/],
  description: "Pipelines, tasks, and run health at a glance.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/** Dashboard — the fixed home link at `/`. */
export const DASHBOARD_NAV_ITEM: SettingsNavItem = {
  href: "/",
  label: "Dashboard",
  icon: Home,
  exact: true,
  description: "Dashboard home.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/** Vibe — chat-driven preview. Now a first-class nav entry (it used to be a
 *  header on/off toggle). */
export const VIBE_NAV_ITEM: SettingsNavItem = {
  href: "/vibe",
  label: "Vibe",
  icon: Sparkles,
  description: "Chat-driven preview — approve and ship.",
  tint: "text-fuchsia-300 bg-fuchsia-500/10",
};

export const PREVIEW_NAV_ITEM: SettingsNavItem = {
  href: "/preview",
  label: "Views",
  icon: MonitorPlay,
  description:
    "View any environment — Production, Staging, Dev — with saved paths, device sizes, and element-pick into chat.",
  tint: "text-sky-300 bg-sky-500/10",
};

export const TODOS_NAV_ITEM: SettingsNavItem = {
  href: "/todos",
  label: "Todos",
  icon: CheckCircle2,
  description: "Visible worklists for regular tasks, goals, and loops.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/**
 * Primary view switch (Dashboard / Tasks / Vibe), rendered at the very top of
 * the sidebar rail and mobile menu. Replaces the old header ViewToggle +
 * VibeToggle — navigation now lives entirely in the nav. Shared so the desktop
 * Sidebar and MobileMenu can't drift.
 */
export const PRIMARY_VIEW_TITLE = "Views" as const;

export const PRIMARY_VIEW_ITEMS: readonly SettingsNavItem[] = [
  DASHBOARD_NAV_ITEM,
  { ...TASKS_NAV_ITEM, icon: LayoutGrid },
  VIBE_NAV_ITEM,
];

/** Heading shown above the primary surfaces in the expanded sidebar rail. */
export const PRIMARY_NAV_TITLE = "Workspace" as const;

export const PRIMARY_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    href: "/org",
    label: "Org",
    icon: Building2,
    description: "Org workspace — manage attached repositories.",
    tint: "text-emerald-300 bg-emerald-500/10",
  },

  {
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    description: "Team chat history.",
    tint: "text-cyan-300 bg-cyan-500/10",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: FileText,
    description: "Outputs from capability runs.",
    tint: "text-sky-300 bg-sky-500/10",
  },
  PREVIEW_NAV_ITEM,
] as const;

export interface SettingsNavSection {
  /** Section heading shown above its items. */
  title: string;
  items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: "Content",
    items: [
      {
        href: "/content/entries",
        label: "Entries",
        icon: Database,
        description: "Browse and edit content entries.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/content/models",
        label: "Models",
        icon: Layers,
        description: "Define content collections and fields.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/content/settings",
        label: "Settings",
        icon: Settings2,
        exact: true,
        description: "Adapter, schema, permissions, and MCP settings.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
    ],
  },
  {
    title: "Fly",
    items: [
      {
        href: "/fly/config",
        label: "Config",
        icon: SlidersHorizontal,
        exact: true,
        description: "Fly token, runners, and Brain settings.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/fly/previews",
        label: "Previews",
        icon: MonitorPlay,
        exact: true,
        description: "Preview URLs, machines, and PR preview settings.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/fly/brain-images",
        label: "Brain Images",
        icon: Brain,
        exact: true,
        description: "Saved Brain runtime images and active restore selection.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/fly/machines",
        label: "Live machines",
        icon: Cpu,
        exact: true,
        description: "Current Fly machines and actions.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/fly/history",
        label: "History",
        icon: History,
        exact: true,
        description: "Fly machine activity snapshots and estimated cost.",
        tint: "text-amber-300 bg-amber-500/10",
      },
    ],
  },
  {
    title: "Monitoring",
    items: [
      {
        href: "/activity",
        label: "Activity",
        icon: Activity,
        description: "Engine run health — queue depth, throughput, failures.",
        tint: "text-rose-300 bg-rose-500/10",
      },
    ],
  },
  {
    title: "AI Agency",
    items: [
      TODOS_NAV_ITEM,
      {
        href: "/agency-runs",
        label: "Agency Runs",
        icon: Route,
        description: "Kody runs for goals, loops, and workflows.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/agents",
        label: "Agents",
        icon: Users,
        description: "Agent identities that execute your capabilities.",
        tint: "text-violet-300 bg-violet-500/10",
      },

      {
        href: "/agent-goals",
        label: "Goals",
        icon: Target,
        description: "Finite outcomes driven by missing evidence.",
        tint: "text-sky-300 bg-sky-500/10",
      },
      {
        href: "/company-intents",
        label: "Intents",
        icon: Compass,
        description:
          "CTO guidance for AI Agency goals, loops, and capabilities.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/agent-loops",
        label: "Loops",
        icon: History,
        description: "Operational loops driven by schedule and health.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/workflows",
        label: "Workflows",
        icon: Workflow,
        description: "Ordered capability queues.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/capabilities",
        label: "Capabilities",
        icon: Layers,
        description: "Manage reusable capabilities.",
        tint: "text-amber-300 bg-amber-500/10",
      },
      {
        href: "/store-catalog",
        label: "Store Catalog",
        icon: Package,
        description:
          "Browse shared store items and activate them in this repo.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/company",
        label: "Import / Export",
        icon: Building2,
        description:
          "Move your AI Agency setup between repos as a portable bundle.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
    ],
  },
  {
    title: "Agent Settings",
    items: [
      {
        href: "/models",
        label: "Chat Models",
        icon: Cpu,
        description: "LLM provider + model selection.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/commands",
        label: "Commands",
        icon: Bot,
        description: "Slash commands in the chat composer.",
        tint: "text-violet-300 bg-violet-500/10",
      },
      {
        href: "/brands",
        label: "Brands",
        icon: Palette,
        description: "Client chat branding for /client surfaces.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/languages",
        label: "Languages",
        icon: Languages,
        description: "Client chat translations for /client surfaces.",
        tint: "text-amber-300 bg-amber-500/10",
      },
      {
        href: "/setup",
        label: "Setup",
        icon: Wand2,
        description: "Guided wizards for configuring features.",
        tint: "text-teal-300 bg-teal-500/10",
      },
      {
        href: "/views/renderers",
        label: "View Renderers",
        icon: LayoutGrid,
        description: "Renderer JSON for structured chat UI.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/instructions",
        label: "Instructions",
        icon: ScrollText,
        description:
          "Tone, length, and behavior preferences appended to every chat turn.",
        tint: "text-cyan-300 bg-cyan-500/10",
      },
      {
        href: "/context",
        label: "Context",
        icon: FileText,
        description:
          "Curated markdown context you feed Kody — attach to agent; Kody's entries frame every chat turn.",
        tint: "text-teal-300 bg-teal-500/10",
      },
      {
        href: "/memory",
        label: "Memory",
        icon: Brain,
        description:
          "Persistent facts and feedback Kody remembers across chat turns.",
        tint: "text-fuchsia-300 bg-fuchsia-500/10",
      },
    ],
  },
  {
    title: "Engine",
    items: [
      {
        href: "/config",
        label: "Engine config",
        icon: SlidersHorizontal,
        description:
          "Repo-wide engine settings: reasoning effort, operators, quality commands, the @kody access gate, default branch, and aliases.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      {
        href: "/secrets",
        label: "Secrets",
        icon: KeyRound,
        description: "Encrypted per-repo secrets vault.",
        tint: "text-rose-300 bg-rose-500/10",
      },
      {
        href: "/variables",
        label: "Variables",
        icon: Settings2,
        description: "Non-secret config shared across runs.",
        tint: "text-indigo-300 bg-indigo-500/10",
      },
    ],
  },
  {
    title: "Alerts",
    items: [
      {
        href: "/notifications",
        label: "Notifications",
        icon: Bell,
        description: "Browser + email alerts and routing rules.",
        tint: "text-amber-300 bg-amber-500/10",
      },
    ],
  },
  {
    title: "General",
    items: [
      {
        href: "/files",
        label: "Files",
        icon: FolderOpen,
        description: "Browse and edit files in your repository.",
        tint: "text-amber-300 bg-amber-500/10",
      },
      {
        href: "/docs",
        label: "Docs",
        icon: FileText,
        description: "README and docs folder from the repo.",
        tint: "text-amber-300 bg-amber-500/10",
      },
      {
        href: "/changelog",
        label: "Changelog",
        icon: History,
        description: "What shipped, version by version.",
        tint: "text-fuchsia-300 bg-fuchsia-500/10",
      },
      {
        href: "/settings",
        label: "Settings",
        icon: SettingsIcon,
        description: "Dashboard-wide preferences.",
        tint: "text-sky-300 bg-sky-500/10",
      },
    ],
  },
] as const;

/** Every nav item, flattened — home + primary + all section items. */
export const ALL_NAV_ITEMS: readonly SettingsNavItem[] = [
  HOME_NAV_ITEM,
  DASHBOARD_NAV_ITEM,
  TASKS_NAV_ITEM,
  VIBE_NAV_ITEM,
  PREVIEW_NAV_ITEM,
  ...PRIMARY_NAV_ITEMS,
  ...SETTINGS_NAV_SECTIONS.flatMap((section) => section.items),
];

const NAV_ITEM_BY_HREF = new Map(
  ALL_NAV_ITEMS.map((item) => [item.href, item] as const),
);

function navItemForHref(href: string): SettingsNavItem {
  const item = NAV_ITEM_BY_HREF.get(href);
  if (!item) throw new Error(`Missing sidebar item for ${href}`);
  return item;
}

function settingsSection(title: string): SettingsNavSection {
  const section = SETTINGS_NAV_SECTIONS.find((item) => item.title === title);
  if (!section) throw new Error(`Missing sidebar section ${title}`);
  return section;
}

export const VIBE_MODE_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: PRIMARY_VIEW_TITLE,
    items: [VIBE_NAV_ITEM, PREVIEW_NAV_ITEM],
  },
  {
    title: PRIMARY_NAV_TITLE,
    items: [
      navItemForHref("/org"),
      navItemForHref("/messages"),
      navItemForHref("/reports"),
      navItemForHref("/docs"),
      navItemForHref("/changelog"),
    ],
  },
  {
    title: "AI Agency",
    items: [
      TODOS_NAV_ITEM,
      navItemForHref("/agency-runs"),
      navItemForHref("/agent-goals"),
      navItemForHref("/agent-loops"),
    ],
  },
  settingsSection("Content"),
];

export const ENGINEER_MODE_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: PRIMARY_VIEW_TITLE,
    items: [TASKS_NAV_ITEM, VIBE_NAV_ITEM, PREVIEW_NAV_ITEM],
  },
  settingsSection("AI Agency"),
  {
    title: PRIMARY_NAV_TITLE,
    items: [
      navItemForHref("/org"),
      navItemForHref("/messages"),
      navItemForHref("/reports"),
      navItemForHref("/files"),
      navItemForHref("/docs"),
      navItemForHref("/changelog"),
    ],
  },
  settingsSection("Content"),
  settingsSection("Monitoring"),
  settingsSection("Fly"),
  settingsSection("Agent Settings"),
  settingsSection("Engine"),
  settingsSection("Infrastructure"),
  settingsSection("Alerts"),
  { title: "General", items: [navItemForHref("/settings")] },
];

export const MOBILE_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: PRIMARY_VIEW_TITLE,
    items: [
      DASHBOARD_NAV_ITEM,
      TASKS_NAV_ITEM,
      VIBE_NAV_ITEM,
      PREVIEW_NAV_ITEM,
    ],
  },
  ...ENGINEER_MODE_SECTIONS.filter(
    (section) => section.title !== PRIMARY_VIEW_TITLE,
  ),
];

/** Strip a query string off an href so "/reports?x=1" maps to "/reports". */
function navPath(href: string): string {
  const q = href.indexOf("?");
  return q === -1 ? href : href.slice(0, q);
}

export function isNavItemActive(
  pathname: string,
  search: string,
  item: SettingsNavItem,
): boolean {
  const navPathname = repoPathForNavMatching(pathname);
  const [hrefPath, hrefQuery = ""] = item.href.split("?");
  if (hrefQuery) {
    return navPathname === hrefPath && search === hrefQuery;
  }

  if (item.exact) {
    return (
      navPathname === hrefPath ||
      item.activePathPatterns?.some((pattern) => pattern.test(navPathname)) ===
        true
    );
  }

  return (
    navPathname === hrefPath ||
    navPathname.startsWith(`${hrefPath}/`) ||
    item.activePathPatterns?.some((pattern) => pattern.test(navPathname)) ===
      true
  );
}

/**
 * Resolve the human label for the page at `pathname` (e.g. "/variables" →
 * "Variables", "/secrets/docs" → "Secrets"). Matches the deepest nav path that
 * the pathname falls under; home ("/") matches only exactly. Returns null when
 * no sidebar page owns the route (e.g. /vibe, /scenario). Single source of
 * truth so callers don't hard-code page names.
 */
export function navLabelForPath(pathname: string): string | null {
  let best: { label: string; len: number } | null = null;
  for (const item of ALL_NAV_ITEMS) {
    const path = navPath(item.href);
    if (isNavItemActive(pathname, "", item)) {
      if (!best || path.length > best.len) {
        best = { label: item.label, len: path.length };
      }
    }
  }
  return best?.label ?? null;
}

/** Icon used by the drawer trigger button (kept here so we don't need to
 *  re-export from lucide elsewhere). */
export { Sparkles as SettingsDrawerSparkles };
