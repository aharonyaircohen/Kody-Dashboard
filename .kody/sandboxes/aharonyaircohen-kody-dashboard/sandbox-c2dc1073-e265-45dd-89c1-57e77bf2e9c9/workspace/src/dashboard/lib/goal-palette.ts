/**
 * @fileType utility
 * @domain kody
 * @pattern goal-palette
 * @ai-summary Maps a goal id to a stable Tailwind color palette so each goal
 *   card on the dashboard gets a distinct accent (ring, header gradient,
 *   progress bar, footer tint). Hash is deterministic, so the same goal
 *   always gets the same color across reloads.
 *
 *   All class strings are written as literals so Tailwind's JIT scanner
 *   picks them up — do NOT template or concatenate color names.
 */

export type GoalPaletteKey =
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "indigo"
  | "teal"
  | "fuchsia";

export interface GoalPalette {
  key: GoalPaletteKey;
  ring: string;
  cardBg: string;
  hotRing: string;
  hintRing: string;
  glow: string;
  headerBg: string;
  tile: string;
  progress: string;
  footerBorder: string;
  footerBg: string;
  createHover: string;
  /** Task-list divider color inside a goal card */
  divide: string;
  /** Very subtle row tint for neutral (non-active-status) task rows */
  rowBg: string;
  /** Palette-tinted hover state for task rows (replaces default white/4) */
  rowHover: string;
}

const PALETTES: Record<GoalPaletteKey, GoalPalette> = {
  sky: {
    key: "sky",
    ring: "ring-sky-500/25",
    cardBg: "bg-sky-500/[0.015]",
    hotRing: "ring-sky-400",
    hintRing: "ring-sky-400/40",
    glow: "shadow-[0_0_0_4px_rgba(56,189,248,0.18)]",
    headerBg:
      "bg-gradient-to-r from-sky-500/[0.12] via-sky-500/[0.05] to-transparent",
    tile: "bg-sky-500/15 ring-sky-500/30 text-sky-300",
    progress: "from-sky-500 to-sky-300",
    footerBorder: "border-sky-500/10",
    footerBg: "bg-sky-500/[0.02]",
    createHover:
      "hover:border-sky-500/40 hover:bg-sky-500/[0.04] hover:text-sky-300",
    divide: "divide-sky-500/10",
    rowBg: "bg-sky-500/[0.04]",
    rowHover: "hover:bg-sky-500/[0.08]",
  },
  emerald: {
    key: "emerald",
    ring: "ring-emerald-500/25",
    cardBg: "bg-emerald-500/[0.015]",
    hotRing: "ring-emerald-400",
    hintRing: "ring-emerald-400/40",
    glow: "shadow-[0_0_0_4px_rgba(52,211,153,0.18)]",
    headerBg:
      "bg-gradient-to-r from-emerald-500/[0.12] via-emerald-500/[0.05] to-transparent",
    tile: "bg-emerald-500/15 ring-emerald-500/30 text-emerald-300",
    progress: "from-emerald-500 to-emerald-300",
    footerBorder: "border-emerald-500/10",
    footerBg: "bg-emerald-500/[0.02]",
    createHover:
      "hover:border-emerald-500/40 hover:bg-emerald-500/[0.04] hover:text-emerald-300",
    divide: "divide-emerald-500/10",
    rowBg: "bg-emerald-500/[0.04]",
    rowHover: "hover:bg-emerald-500/[0.08]",
  },
  amber: {
    key: "amber",
    ring: "ring-amber-500/25",
    cardBg: "bg-amber-500/[0.015]",
    hotRing: "ring-amber-400",
    hintRing: "ring-amber-400/40",
    glow: "shadow-[0_0_0_4px_rgba(251,191,36,0.18)]",
    headerBg:
      "bg-gradient-to-r from-amber-500/[0.12] via-amber-500/[0.05] to-transparent",
    tile: "bg-amber-500/15 ring-amber-500/30 text-amber-300",
    progress: "from-amber-500 to-amber-300",
    footerBorder: "border-amber-500/10",
    footerBg: "bg-amber-500/[0.02]",
    createHover:
      "hover:border-amber-500/40 hover:bg-amber-500/[0.04] hover:text-amber-300",
    divide: "divide-amber-500/10",
    rowBg: "bg-amber-500/[0.04]",
    rowHover: "hover:bg-amber-500/[0.08]",
  },
  rose: {
    key: "rose",
    ring: "ring-rose-500/25",
    cardBg: "bg-rose-500/[0.015]",
    hotRing: "ring-rose-400",
    hintRing: "ring-rose-400/40",
    glow: "shadow-[0_0_0_4px_rgba(244,63,94,0.18)]",
    headerBg:
      "bg-gradient-to-r from-rose-500/[0.12] via-rose-500/[0.05] to-transparent",
    tile: "bg-rose-500/15 ring-rose-500/30 text-rose-300",
    progress: "from-rose-500 to-rose-300",
    footerBorder: "border-rose-500/10",
    footerBg: "bg-rose-500/[0.02]",
    createHover:
      "hover:border-rose-500/40 hover:bg-rose-500/[0.04] hover:text-rose-300",
    divide: "divide-rose-500/10",
    rowBg: "bg-rose-500/[0.04]",
    rowHover: "hover:bg-rose-500/[0.08]",
  },
  violet: {
    key: "violet",
    ring: "ring-violet-500/25",
    cardBg: "bg-violet-500/[0.015]",
    hotRing: "ring-violet-400",
    hintRing: "ring-violet-400/40",
    glow: "shadow-[0_0_0_4px_rgba(139,92,246,0.18)]",
    headerBg:
      "bg-gradient-to-r from-violet-500/[0.12] via-violet-500/[0.05] to-transparent",
    tile: "bg-violet-500/15 ring-violet-500/30 text-violet-300",
    progress: "from-violet-500 to-violet-300",
    footerBorder: "border-violet-500/10",
    footerBg: "bg-violet-500/[0.02]",
    createHover:
      "hover:border-violet-500/40 hover:bg-violet-500/[0.04] hover:text-violet-300",
    divide: "divide-violet-500/10",
    rowBg: "bg-violet-500/[0.04]",
    rowHover: "hover:bg-violet-500/[0.08]",
  },
  indigo: {
    key: "indigo",
    ring: "ring-indigo-500/25",
    cardBg: "bg-indigo-500/[0.015]",
    hotRing: "ring-indigo-400",
    hintRing: "ring-indigo-400/40",
    glow: "shadow-[0_0_0_4px_rgba(99,102,241,0.18)]",
    headerBg:
      "bg-gradient-to-r from-indigo-500/[0.12] via-indigo-500/[0.05] to-transparent",
    tile: "bg-indigo-500/15 ring-indigo-500/30 text-indigo-300",
    progress: "from-indigo-500 to-indigo-300",
    footerBorder: "border-indigo-500/10",
    footerBg: "bg-indigo-500/[0.02]",
    createHover:
      "hover:border-indigo-500/40 hover:bg-indigo-500/[0.04] hover:text-indigo-300",
    divide: "divide-indigo-500/10",
    rowBg: "bg-indigo-500/[0.04]",
    rowHover: "hover:bg-indigo-500/[0.08]",
  },
  teal: {
    key: "teal",
    ring: "ring-teal-500/25",
    cardBg: "bg-teal-500/[0.015]",
    hotRing: "ring-teal-400",
    hintRing: "ring-teal-400/40",
    glow: "shadow-[0_0_0_4px_rgba(20,184,166,0.18)]",
    headerBg:
      "bg-gradient-to-r from-teal-500/[0.12] via-teal-500/[0.05] to-transparent",
    tile: "bg-teal-500/15 ring-teal-500/30 text-teal-300",
    progress: "from-teal-500 to-teal-300",
    footerBorder: "border-teal-500/10",
    footerBg: "bg-teal-500/[0.02]",
    createHover:
      "hover:border-teal-500/40 hover:bg-teal-500/[0.04] hover:text-teal-300",
    divide: "divide-teal-500/10",
    rowBg: "bg-teal-500/[0.04]",
    rowHover: "hover:bg-teal-500/[0.08]",
  },
  fuchsia: {
    key: "fuchsia",
    ring: "ring-fuchsia-500/25",
    cardBg: "bg-fuchsia-500/[0.015]",
    hotRing: "ring-fuchsia-400",
    hintRing: "ring-fuchsia-400/40",
    glow: "shadow-[0_0_0_4px_rgba(217,70,239,0.18)]",
    headerBg:
      "bg-gradient-to-r from-fuchsia-500/[0.12] via-fuchsia-500/[0.05] to-transparent",
    tile: "bg-fuchsia-500/15 ring-fuchsia-500/30 text-fuchsia-300",
    progress: "from-fuchsia-500 to-fuchsia-300",
    footerBorder: "border-fuchsia-500/10",
    footerBg: "bg-fuchsia-500/[0.02]",
    createHover:
      "hover:border-fuchsia-500/40 hover:bg-fuchsia-500/[0.04] hover:text-fuchsia-300",
    divide: "divide-fuchsia-500/10",
    rowBg: "bg-fuchsia-500/[0.04]",
    rowHover: "hover:bg-fuchsia-500/[0.08]",
  },
};

const PALETTE_ORDER: GoalPaletteKey[] = [
  "sky",
  "emerald",
  "amber",
  "rose",
  "violet",
  "indigo",
  "teal",
  "fuchsia",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function goalPalette(id: string): GoalPalette {
  const idx = hashString(id) % PALETTE_ORDER.length;
  return PALETTES[PALETTE_ORDER[idx]];
}
