# kody-preview-builder

Tiny Fly service that builds preview images for the dashboard's PR
preview feature. **Consumer repos stay zero-touch** — no Dockerfile,
no workflow, no secrets needed there.

## What it does

```
POST /build { repo, ref, appName, flyToken, githubToken? }
  1. Clones the repo at <ref> into /tmp
  2. Drops in a default Dockerfile.preview if the repo has none
  3. Runs `flyctl deploy --build-only --remote-only` against <appName>
     → Fly's hosted remote builder does the heavy lifting; this
       service stays small (no docker-in-docker)
  4. Returns { image: "registry.fly.io/<appName>:<tag>", durationMs }
```

The dashboard creates the per-PR Fly app first, then calls `/build`,
then boots a machine from the returned image. Each component owns one
job: dashboard orchestrates lifecycle, builder produces images, the
preview machine serves traffic.

## Auth

`X-Builder-Auth` shared key derived from `KODY_MASTER_KEY` (HKDF-style
purpose-prefix hash). No additional env vars; both the dashboard and
this service derive the same key independently.

## Deploy

```bash
flyctl deploy -c builder/fly.toml --app kody-preview-builder
flyctl secrets set KODY_MASTER_KEY=... --app kody-preview-builder
```

That's the whole bootstrap.

## Local dev

```bash
cd builder
pnpm install
KODY_MASTER_KEY=dev pnpm dev
```

## File layout

```
builder/
  Dockerfile                       Builder service image
  fly.toml                         Fly deploy config
  default-Dockerfile.preview       Used when consumer repo has none
  src/
    auth.ts                        KODY_MASTER_KEY-derived shared key
    builder.ts                     git clone + flyctl deploy --build-only
    server.ts                      Hono HTTP server (POST /build)
```
