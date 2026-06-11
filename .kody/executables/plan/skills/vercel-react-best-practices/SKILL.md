---
name: vercel-react-best-practices
description: React and Next.js performance rules for dashboard components.
source: https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
---

# Vercel React Best Practices Skill

Use this skill when writing, planning, or reviewing React code.

## Focus

- Avoid data waterfalls. Fetch in parallel when possible.
- Keep server/client boundaries intentional.
- Minimize client component state and effects.
- Avoid unnecessary rerenders in large lists and dashboards.
- Memoize only when it removes real repeated work.
- Keep props stable for expensive child components.
- Do not move logic client-side unless interaction requires it.
