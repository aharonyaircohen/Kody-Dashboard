# Kody Dashboard — Operations UI

Next.js dashboard for monitoring and managing the Kody CI/CD pipeline.

## Architecture

- **Pages** (`app/`) — Next.js App Router pages and API routes
- **Components** (`src/dashboard/lib/components/`) — React UI components
- **Hooks** (`src/dashboard/lib/hooks/`) — Custom React hooks
- **Auth** (`src/dashboard/lib/auth/`) — GitHub OAuth authentication
- **API** (`app/api/kody/`) — Backend API routes for GitHub, tasks, chat, pipelines

## Quick Commands

### Development

- `pnpm dev` — Start dashboard at http://localhost:3333
- `pnpm build` — Build for production
- `pnpm typecheck` — Type check
- `pnpm lint` / `pnpm lint:fix` — Lint
- `pnpm format:check` / `pnpm format` — Format

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `KODY_SESSION_SECRET` | JWT session signing secret |
| `GITHUB_TOKEN` / `KODY_BOT_TOKEN` | GitHub API token |
| `GITHUB_APP_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_APP_CLIENT_SECRET` | GitHub OAuth App client secret |
| `KODY_PUBLIC_SERVER_URL` | Public URL for OAuth redirects |

## Deployment

### Production URL

https://kody-aguy.vercel.app

### Vercel CLI

```bash
export PATH="/opt/homebrew/bin:$PATH"  # macOS fix for node path
vercel --prod  # Deploy to production
```

### OAuth Setup

The GitHub OAuth App callback URL must match:

```
https://kody-aguy.vercel.app/api/oauth/github/callback
```

## Import Aliases

```typescript
import { ... } from '@dashboard/...'    // src/dashboard/
import { ... } from '@/...'             // src/
```
