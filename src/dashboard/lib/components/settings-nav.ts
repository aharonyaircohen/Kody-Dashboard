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
  Building,
  Building2,
  Cpu,
  FileText,
  Github,
  History,
  Home,
  Inbox,
  KeyRound,
  Layers,
  MessageSquare,
  Rocket,
  ScrollText,
  Settings as SettingsIcon,
  Settings2,
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
export const PRIMARY_NAV_ITEMS: readonly SettingsNavItem[] = [
  { href: "/", label: "Dashboard", icon: Home, exact: true },
  { href: "/duties", label: "Duties", icon: Layers, exact: true },
  { href: "/duties?tab=reports", label: "Reports", icon: FileText },
  { href: "/staff", label: "Staff", icon: Users },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  {
    href: "/activity",
    label: "Activity",
    icon: Activity,
    description: "Engine run health — queue depth, throughput, failures.",
  },
  { href: "/changelog", label: "Changelog", icon: History },
] as const;

export interface SettingsNavSection {
  /** Section heading shown above its items. */
  title: string;
  items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    title: "Chat",
    items: [
      {
        href: "/models",
        label: "Chat Models",
        icon: Cpu,
        description: "LLM provider + model selection.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
      {
        href: "/prompts",
        label: "Prompts",
        icon: Bot,
        description: "Slash-command prompts in the chat composer.",
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
        href: "/profile",
        label: "Company Profile",
        icon: Building,
        description:
          "Markdown sections describing your company — fed to Kody on every chat turn.",
        tint: "text-teal-300 bg-teal-500/10",
      },
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        href: "/company",
        label: "Company",
        icon: Building2,
        description:
          "Import/export your staff, duties, prompts, and instructions as a portable bundle.",
        tint: "text-emerald-300 bg-emerald-500/10",
      },
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
      {
        href: "/runner",
        label: "Fly Runner",
        icon: Rocket,
        description: "Per-repo Fly infra: warm-pool size, LiteLLM, Brain.",
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
      {
        href: "/repos",
        label: "Repositories",
        icon: Github,
        description: "Connected GitHub repos and tokens.",
        tint: "text-zinc-300 bg-white/[0.08]",
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

/** Icon used by the drawer trigger button (kept here so we don't need to
 *  re-export from lucide elsewhere). */
export { Sparkles as SettingsDrawerSparkles };
