# Deploying Kody Dashboard to Vercel

This guide walks through deploying the Kody Dashboard to Vercel using the Vercel CLI.

## Prerequisites

- [Vercel CLI](https://vercel.com/cli) installed: `npm i -g vercel`
- A Vercel account
- A GitHub repository containing the dashboard code
- A GitHub Personal Access Token (PAT) with `repo` scope

## Step 1 — Link the project

In the dashboard repo root, run:

```bash
vercel
```

Follow the prompts:

1. **Set up and deploy?** → `Yes`
2. **Which scope?** → Select your Vercel account or team
3. **Link to existing project?** → Select your Vercel project (or create a new one)
4. **Directory?** → Press Enter to use `.`
5. **Override settings?** → `No`

This creates a `.vercel` directory with your project ID.

---

## Step 2 — Configure environment variables

Set the required secrets. You can do this via the Vercel dashboard or CLI:

```bash
# Core secrets (required)
vercel env add KODY_SESSION_SECRET
vercel env add GITHUB_APP_CLIENT_ID
vercel env add GITHUB_APP_CLIENT_SECRET

# GitHub OAuth App callback URL must match:
# https://<your-project>.vercel.app/api/oauth/github/callback
```

Optional variables:

```bash
# Public URL (used for OAuth redirects)
vercel env add NEXT_PUBLIC_SERVER_URL

# Optional: centralize the chat workflow on a single engine repo.
# Without this, chat dispatches against the repo the user connected at login.
vercel env add KODY_CHAT_WORKFLOW_REPO

# Optional: override the chat workflow filename (default: kody2.yml).
vercel env add KODY_CHAT_WORKFLOW_ID
```

> **Note:** After adding secrets, you must **redeploy** for them to take effect. Environment variables added in the Vercel dashboard are not applied to existing deployments until a new deployment is triggered.

---

## Step 3 — Disable SSO protection (first-time setup)

New Vercel projects may have SSO protection enabled by default, which blocks API access with a "Login – Vercel" page. To disable it:

```bash
# Install Vercel MCP tools (one-time)
mcp__plugin_vercel-plugin:authenticate

# Get your project ID from .vercel/project.json
PROJECT_ID=$(cat .vercel/project.json | grep -o '"projectId":"[^"]*"' | cut -d'"' -f4)

# Disable SSO protection
curl -X PATCH "https://api.vercel.com/v1/projects/${PROJECT_ID}" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssoProtection": null}'
```

Or disable it in the Vercel dashboard:

**Vercel Dashboard → Project → Settings → Security → SSO Protection → Disabled**

---

## Step 4 — Connect GitHub integration

In the Vercel dashboard:

1. Go to **Project → Settings → Git**
2. Click **Connect Git Repository**
3. Select the GitHub repo containing the Kody Dashboard
4. Grant the required GitHub permissions

This enables automatic deployments on push to `main`.

---

## Step 5 — Deploy to production

### Option A — Automatic (on push to `main`)

Once GitHub integration is connected, any push to `main` triggers a deployment automatically.

### Option B — Manual via CLI

```bash
vercel --prod --yes
```

The `--yes` flag skips all confirmation prompts.

### Option C — With a specific build

```bash
# Build locally first
pnpm build

# Then deploy the prebuilt output
vercel deploy --prebuilt --prod --yes
```

---

## Step 6 — Verify the deployment

After deployment completes, open your production URL:

```
https://<project-name>-<username>.vercel.app
```

1. You should be redirected to `/login`
2. Enter your GitHub repo URL (e.g., `https://github.com/aharonyaircohen/kody-engine`)
3. Enter your GitHub PAT (requires `repo` scope)
4. Click **Connect** — you should see the dashboard

---

## Updating the deployment

### Push new code

```bash
git add . && git commit -m "your changes" && git push
```

Vercel will automatically build and deploy. The GitHub integration must be connected (Step 4).

### Redeploy without code changes

```bash
vercel --prod --yes --token $VERCEL_TOKEN
```

Or from the dashboard: **Project → Deployments → Select latest → ⋮ → Redeploy**

### Add or update secrets

```bash
vercel env add SECRET_NAME
vercel --prod --yes
```

---

## Troubleshooting

### "Login – Vercel" page on API calls

SSO protection is enabled. See **Step 3**.

### 502 Bad Gateway in local dev

Expected when the dashboard runs without the engine backend. This is normal for local development — the engine is only available in production deployments.

### `logEvent` returns 500

`fs.writeFile` fails in Vercel's ephemeral filesystem. The event logging degrades gracefully — operations continue but events are not persisted to disk. This is expected in serverless environments.

### Deployment fails — `vercel deploy --prebuilt` error

The `--prebuilt` flag requires a prior `pnpm build` step. Use:

```bash
pnpm build && vercel deploy --prebuilt --prod --yes
```

Or simply:

```bash
vercel --prod --yes
```

Vercel will run the build automatically from `package.json` scripts.

### OAuth callback URL mismatch

The GitHub OAuth App callback URL must exactly match:

```
https://<your-project>.vercel.app/api/oauth/github/callback
```

Update it in your GitHub OAuth App settings at:

```
GitHub → Settings → Developer settings → OAuth Apps → <your-app> → Callback URL
```

---

## Project URLs

| Environment | URL format |
|-------------|------------|
| Production | `https://<slug>.vercel.app` |
| Preview | `https://<slug>-<branch>-<hash>.vercel.app` |

Get your project slug from `.vercel/project.json`:

```bash
cat .vercel/project.json | grep -o '"slug":"[^"]*"'
```
