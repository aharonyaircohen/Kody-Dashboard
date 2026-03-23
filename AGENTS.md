# Kody Dashboard — Agent Reference

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

| File | Purpose |
|------|---------|
| `app/page.tsx` | Dashboard home (task list) |
| `app/KodyProviders.tsx` | Root providers (React Query, Theme) |
| `src/dashboard/lib/components/KodyDashboard.tsx` | Main dashboard component |
| `src/dashboard/lib/components/KodyChat.tsx` | Chat interface |
| `src/dashboard/lib/auth/kody_session.ts` | Session management |
| `src/dashboard/lib/api.ts` | API client utilities |
| `src/dashboard/lib/github-client.ts` | GitHub API client |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `KODY_SESSION_SECRET` | JWT session signing |
| `GITHUB_TOKEN` / `KODY_BOT_TOKEN` | GitHub API access |
| `KODY_PUBLIC_SERVER_URL` | Public URL for OAuth |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | OAuth app credentials |
