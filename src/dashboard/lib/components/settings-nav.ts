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
  Bell,
  Bot,
  Cpu,
  Github,
  KeyRound,
  Settings as SettingsIcon,
  Settings2,
  Sparkles,
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
}

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
    ],
  },
  {
    title: "Workspace",
    items: [
      {
        href: "/notifications",
        label: "Notifications",
        icon: Bell,
        description: "Browser + email alerts and routing rules.",
        tint: "text-amber-300 bg-amber-500/10",
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
