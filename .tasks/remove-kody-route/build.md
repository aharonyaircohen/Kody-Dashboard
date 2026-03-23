# Build Agent Report: Remove /kody Route Prefix

## Changes

### Directory Structure
- Moved `app/kody/*` → `app/*` (all page routes now at root)
- Pages now accessible at `/`, `/bug`, `/chat`, `/new`, `/scenario`, `/scenario/list`, `/:issueNumber`, etc.

### Configuration Changes
- **next.config.mjs**: Removed redirect from `/` → `/kody`

### API Route Changes
- **app/api/oauth/github/route.ts**: Changed default `returnTo` from `/kody` to `/`
- **app/api/oauth/github/callback/route.ts**: Changed all redirect URLs from `/kody?error=...` to `/?error=...`
- **app/api/kody/auth/logout/route.ts**: Changed `returnTo` from `/kody` to `/`

### Page Metadata Updates
- **app/page.tsx**: Changed path from `/kody` to `/`
- **app/bug/page.tsx**: Changed path from `/kody/bug` to `/bug`
- **app/chat/page.tsx**: Changed path from `/kody/chat` to `/chat`
- **app/new/page.tsx**: Changed path from `/kody/new` to `/new`
- **app/scenario/page.tsx**: Changed path from `/kody/scenario` to `/scenario`
- **app/scenario/list/page.tsx**: Changed path from `/kody/scenario/list` to `/scenario/list`
- **app/metadata.ts**: Updated `buildTaskMetadata` default path pattern from `/kody/:id` to `/:id`
- **app/[issueNumber]/page.tsx**: Changed redirect from `/kody` to `/`
- **app/[issueNumber]/preview/page.tsx**: Changed path and redirect
- **app/[issueNumber]/preview/docs/page.tsx**: Changed path and redirect
- **app/[issueNumber]/preview/comments/page.tsx**: Changed path and redirect
- **app/[issueNumber]/comments/page.tsx**: Changed path and redirect

### Client-Side Navigation Updates
- **src/dashboard/lib/components/KodyDashboard.tsx**: Updated all `window.history.pushState` calls and URL pattern matching
- **src/dashboard/lib/components/TaskDetail.tsx**: Updated URL patterns
- **src/dashboard/lib/components/PreviewModal.tsx**: Updated URL patterns
- **src/dashboard/lib/components/BugReportDialog.tsx**: Updated `redirectToLogin` call
- **src/dashboard/lib/api.ts**: Changed `redirectToLogin` default parameter from `/kody` to `/`

### NOT Changed (Intentionally)
- API routes at `/api/kody/*` remain at their current paths
- GitHub command comments (`/kody approve`, `/kody reject`) remain unchanged
- Placeholder examples in code

## Deviations
- None — plan followed exactly

## Quality
- TypeScript: Unable to verify (node not available in environment)
- Lint: Unable to verify (node not available in environment)
- **User should run**: `pnpm tsc --noEmit && pnpm lint` before committing

## Next Steps
1. Run `pnpm tsc --noEmit` to check for TypeScript errors
2. Run `pnpm lint` to check for lint errors
3. Run `pnpm generate:importmap` if there are admin component changes
4. Test the application locally to verify routes work correctly
5. Update Vercel deployment (no configuration changes needed - routes are relative now)

---

## Deployment Details

### Commits (in order)
| Commit | Description |
|--------|-------------|
| `d6bfaaa` | refactor: remove /kody route prefix - routes now at root |
| `ab725c9` | fix: correct import path in OAuth callback route |
| `6d3bbca` | fix: use dynamic baseUrl for OAuth callback URL |

### Deployments
| Deployment | URL | Status |
|------------|-----|--------|
| Initial (broken import) | `kody-6v7czb7b1-aguy.vercel.app` | ❌ Failed - module not found |
| Second (broken OAuth callback) | `kody-5iq6yel87-aguy.vercel.app` | ❌ token_exchange_failed |
| Third (fixed) | `kody-pirzgp4w1-aguy.vercel.app` | ✅ Success |

### Issues Encountered
1. **Broken import path** (`@dashboard/lib/auth/_session` → `@dashboard/lib/auth/kody_session`)
   - Fixed in commit `ab725c9`

2. **Malformed OAuth callback URL** (`https://-aguy.vercel.app` → `${baseUrl}/api/oauth/github/callback`)
   - Caused `token_exchange_failed` for all users except owner
   - Fixed in commit `6d3bbca`

### Production URL
https://kody-aguy.vercel.app
