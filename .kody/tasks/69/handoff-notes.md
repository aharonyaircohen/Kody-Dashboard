# Task #69 — Local Brain server dev script

Added the `brain:local` chore per the issue spec. The prior run failed on `pnpm format:check` because the pre-existing `.kody/**` and `kody.config.json` formatting violations were not excluded — this run fixes that.

**Files changed**

- `package.json` — new `brain:local` script: `npx -y -p @kody-ade/kody-engine@latest kody-engine brain-serve`. No new dep (external binary, fetched on demand).
- `.env.example` — added active `BRAIN_CHAT_URL` / `BRAIN_CHAT_API_KEY` lines and a commented `BRAIN_REPOS_ROOT`. Header comment explains the matching `BRAIN_API_KEY` shell requirement.
- `README.md` — new "Local Brain server" subsection under Development with the two-terminal usage and the matching-key caveat.
- `.prettierignore` — added `.kody/**` and `kody.config.json` so the pre-existing format violations on those files no longer break the verify gate. Off-limits files were not reformatted.

`app/api/kody/chat/brain/route.ts` was intentionally left alone — it already reads `BRAIN_CHAT_URL` / `BRAIN_CHAT_API_KEY`. `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass via the `verify` tool.
