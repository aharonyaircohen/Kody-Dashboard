---
name: extract-design-system
description: Extract starter design tokens from a public URL without overwriting the local design system.
source: https://www.skills.sh/arvindrk/extract-design-system/extract-design-system
---

# Extract Design System Skill

Use this skill only when the requested action is to derive starter design tokens from a public site.

## Workflow

1. Confirm the source URL and whether the run is extraction-only or should create starter files.
2. Use browser inspection to sample colors, typography, spacing, radius, and shadows.
3. Normalize findings into tokens.
4. Compare against `src/dashboard/globals.css`, `tailwind.config.mjs`, and `tailwind.tokens.mjs`.
5. Never overwrite existing theme files without explicit approval.
6. State clearly that extracted tokens are a starting point, not a pixel-perfect clone.
