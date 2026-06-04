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
  Building2,
  Cpu,
  FileText,
  History,
  Home,
  Inbox,
  KeyRound,
  Layers,
  LayoutGrid,
  MessageSquare,
  MonitorPlay,
  Rocket,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Long-form blurb for the desktop drawer. */
  description?: string;
  /** Tailwind classes for the mobile menu's icon tint chip. */
  tint?: string;
  /** When true, only the exact path is the active route (used for "/"). */
  exact?: boolean;
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
  description: "Pipelines, tasks, and run health at a glance.",
  tint: "text-emerald-300 bg-emerald-500/10",
};

/** Dashboard — the operations overview at `/`. Rendered in the nav's "Views"
 *  group; `/` no longer redirects, it lands here. */
export const DASHBOARD_NAV_ITEM: SettingsNavItem = {
  href: "/",
  label: "Dashboard",
  icon: Home,
  exact: true,
  description: "Overview of tasks, runs, and activity at a glance.",
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
    href: "/duties",
    label: "Duties",
    icon: Layers,
    exact: true,
    description: "Run and edit recurring duties.",
    tint: "text-amber-300 bg-amber-500/10",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: FileText,
    description: "Outputs from duty runs.",
    tint: "text-sky-300 bg-sky-500/10",
  },
  {
    href: "/staff",
    label: "Staff",
    icon: Users,
    description: "Personas that execute your duties.",
    tint: "text-violet-300 bg-violet-500/10",
  },
  {
    href: "/trust",
    label: "Trust",
    icon: ShieldCheck,
    exact: true,
    description:
      "How close each staff member is to acting on its own — grant or revoke autonomy per action.",
    tint: "text-emerald-300 bg-emerald-500/10",
  },
  {
    href: "/preview",
    label: "Preview",
    icon: MonitorPlay,
    exact: true,
    description:
      "Live preview of any environment — Production, Staging, Dev — with views, device sizes, and element-pick into chat.",
    tint: "text-sky-300 bg-sky-500/10",
  },
  {
    href: "/messages",
    label: "Messages",
    icon: MessageSquare,
    description: "Team chat history.",
    tint: "text-cyan-300 bg-cyan-500/10",
  },
  {
    href: "/activity",
    label: "Activity",
    icon: Activity,
    description: "Engine run health — queue depth, throughput, failures.",
    tint: "text-rose-300 bg-rose-500/10",
  },
  {
    href: "/changelog",
    label: "Changelog",
    icon: History,
    description: "What shipped, version by version.",
    tint: "text-fuchsia-300 bg-fuchsia-500/10",
  },
] as const;

export interface SettingsNavSection {
  /** Section heading shown above its items. */
  title: string;
  items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: "Agent",
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
          "Curated markdown context you feed Kody — attach to staff; Kody's entries frame every chat turn.",
        tint: "text-teal-300 bg-teal-500/10",
      },
    ],
  },
  {
    title: "Company",
    items: [
      {
        href: "/config",
        label: "Config",
        icon: SlidersHorizontal,
        description:
          "Repo-wide engine settings: operators, quality commands, the @kody access gate, default branch, and aliases.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/company",
        label: "Import / Export",
        icon: Building2,
        description:
          "Move your staff, duties, prompts, and instructions between repos as a portable bundle.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      {
        href: "/runner",
        label: "Fly Runner",
        icon: Rocket,
        description:
          "Per-repo Fly infra: machines, activity, warm-pool, LiteLLM, Brain.",
        tint: "text-sky-300 bg-sky-500/10",
      },
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
        href: "/inbox",
        label: "Inbox",
        icon: Inbox,
        description: "Durable list of @mentions and review requests.",
        tint: "text-amber-300 bg-amber-500/10",
      },
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
const ALL_NAV_ITEMS: readonly SettingsNavItem[] = [
  HOME_NAV_ITEM,
  DASHBOARD_NAV_ITEM,
  TASKS_NAV_ITEM,
  VIBE_NAV_ITEM,
  ...PRIMARY_NAV_ITEMS,
  ...SETTINGS_NAV_SECTIONS.flatMap((section) => section.items),
];

/** Strip a query string off an href so "/reports" → "/duties". */
function navPath(href: string): string {
  const q = href.indexOf("?");
  return q === -1 ? href : href.slice(0, q);
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
    if (path === "/") {
      if (pathname === "/") return item.label;
      continue;
    }
    if (pathname === path || pathname.startsWith(`${path}/`)) {
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
