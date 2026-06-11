---
name: next-best-practices
description: Next.js App Router rules for routes, server components, data fetching, and errors.
source: https://www.skills.sh/vercel-labs/next-skills/next-best-practices
---

# Next Best Practices Skill

Use this skill for Next.js App Router code.

## Rules

- Respect App Router file conventions in `app/`.
- Keep server components server-side unless interactivity requires `use client`.
- Put route handlers under `app/api/.../route.ts`.
- Use explicit error handling and status codes in APIs.
- Avoid hydration mismatches from time, random values, or browser-only APIs.
- Keep metadata, loading, error, and not-found behavior consistent with nearby routes.
