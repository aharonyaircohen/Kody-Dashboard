# Kody Dashboard — Agent Reference

## Response Style

- Think more before replying; say less unless detail is needed to make the next action clear.

## Architecture

Next.js App Router application with:

1. **Pages** (`app/`) — Dashboard views, task detail, chat, scenario builder
2. **API Routes** (`app/api/kody/`) — GitHub proxy, auth, pipeline status, chat
3. **Components** (`src/dashboard/lib/components/`) — React UI components
4. **Hooks** (`src/dashboard/lib/hooks/`) — State management and data fetching

## Project Structure

```
app/                              # Next.js App Router
  ├── api/kody/                   # API routes (auth, tasks, prs, chat, etc.)
  ├── api/oauth/                  # GitHub OAuth flow
  ├── [issueNumber]/              # Task detail pages
  ├── chat/                       # Chat interface
  ├── scenario/                   # Scenario builder
  └── page.tsx                    # Dashboard home
src/dashboard/
  ├── lib/components/             # React components
  ├── lib/hooks/                  # Custom hooks
  ├── lib/auth/                   # Auth utilities (OAuth, sessions)
  ├── lib/notifications/          # Notification system
  ├── providers/                  # Theme provider
  └── ui/                         # shadcn/ui primitives
```

## Key Files

| File                                             | Purpose                             |
| ------------------------------------------------ | ----------------------------------- |
| `app/page.tsx`                                   | Dashboard home (task list)          |
| `app/KodyProviders.tsx`                          | Root providers (React Query, Theme) |
| `src/dashboard/lib/components/KodyDashboard.tsx` | Main dashboard component            |
| `src/dashboard/lib/components/KodyChat.tsx`      | Chat interface                      |
| `src/dashboard/lib/auth/kody_session.ts`         | Session management                  |
| `src/dashboard/lib/api.ts`                       | API client utilities                |
| `src/dashboard/lib/github-client.ts`             | GitHub API client                   |

## Environment Variables

| Variable                          | Purpose                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `KODY_MASTER_KEY`                 | Single master secret — vault AES, session JWT, ingest HMAC.                        |
| `GITHUB_TOKEN` / `KODY_BOT_TOKEN` | GitHub API access for server-side flows.                                           |
| `NEXT_PUBLIC_SERVER_URL`          | Public URL for redirects/callbacks (set in dev; in prod, Vercel headers are used). |

## Kody Clean Boundary

Hard constraints:

- **Engine**: runs the requested agentAction and reports success/failure.
- **Preview agentAction/tool**: owns preview behavior and preview-provider details.
- **Task-leader/release policy**: decides whether a preview result is required for a given PR type.
- **`.github/workflows/kody.yml`**: immutable launcher only; never change this file.

<!-- headroom:rtk-instructions -->

# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands

```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules

- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
