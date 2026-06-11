---
name: design-system
description: Build Kody Dashboard UI using the local theme, tokens, and component system.
---

# Design System Skill

Use this skill when planning, building, or reviewing Kody Dashboard UI.

## Read First

- `src/dashboard/globals.css` for CSS variables, themes, semantic colors, shadows, and radius.
- `tailwind.config.mjs` and `tailwind.tokens.mjs` for spacing, type, radius, shadow, and icon tokens.
- `src/dashboard/ui/*` before creating primitives.
- Nearby components in `src/dashboard/lib/components/` before inventing new patterns.

## Rules

- Build operational dashboard UI: dense, calm, scannable, and repeat-use friendly.
- Prefer existing shadcn-style primitives from `src/dashboard/ui`.
- Use theme tokens: `bg-background`, `bg-card`, `text-foreground`, `border-border`, `text-muted-foreground`, `text-primary`.
- Keep cards modest; do not nest cards inside cards.
- Use icon buttons for common actions and clear labels for destructive actions.
- Support light and dark themes.
- Verify mobile width for overflow, clipped text, and overlapping controls.
