---
name: shadcn
description: Use existing shadcn-style primitives safely in Kody Dashboard.
source: https://www.skills.sh/shadcn/ui/shadcn
---

# Shadcn Skill

Use this skill when UI work needs shadcn-style components.

## Rules

- Prefer existing primitives in `src/dashboard/ui/*`.
- Do not run the shadcn CLI unless a component is truly missing.
- If adding a primitive, match local imports, tokens, radius, variants, and file style.
- Keep generated code small and remove unused variants.
- Use `cn` from `@dashboard/lib/utils/ui`.
- Check the feature component that consumes the primitive before changing the primitive API.
