# Brain Terminal Codex Setup

Use this when an operator installs Codex inside a Brain terminal and wants
future Codex sessions to consistently read Kody state context.

## Model

Codex reads local files. It does not automatically read Kody state from GitHub.

The reliable setup is:

- app repo cloned at `/workspace/repo`
- Kody state repo cloned at `/workspace/kody-state`
- Codex started with both directories available
- repo-local `AGENTS.md` tells Codex where the Kody state files are

## Start Codex

```bash
codex --cd /workspace/repo --add-dir /workspace/kody-state
```

## One-Time Setup Prompt

Use this prompt in a fresh Codex session inside the Brain terminal:

```text
Set up this workspace so future Codex sessions always use Kody state context.

Do the following:
1. Confirm the app repo path. Use the current working directory unless I gave another path.
2. Confirm the Kody state repo path. Prefer /workspace/kody-state if it exists. If not, look for ../kody-state. If you cannot find it, ask me for the path.
3. Detect the current repo name from git remote origin. Use the repo name as the state folder name.
4. Confirm that this folder exists inside the Kody state repo:
   <kody-state>/<repo-name>
5. Create or update AGENTS.md in the app repo.
6. Do not hardcode any org, owner, or specific repo name into the reusable rule. Use placeholders like <repo-name> and explain that they resolve from the current git repo.
7. The AGENTS.md must make Kody state context mandatory before answering, planning, or editing when the request depends on project history, decisions, preferences, prior state, instructions, memory, or context.
8. The AGENTS.md must point to these generic paths:
   - <kody-state>/<repo-name>/instructions.md
   - <kody-state>/<repo-name>/context/
   - <kody-state>/<repo-name>/memory/INDEX.md
   - <kody-state>/<repo-name>/memory/
9. The AGENTS.md must say missing or stale context must be reported clearly, not guessed.
10. Do not change product code.
11. Show me the final AGENTS.md content and the exact command I should use to start Codex with the Kody state repo available.
12. Verify by reading the AGENTS.md back from disk.
```

## Expected AGENTS.md Rule

The setup prompt should produce a repo-local `AGENTS.md` with this behavior:

```md
# Required Kody Context

Before answering, planning, or editing, use the Kody state context for this
repo whenever the request depends on project history, decisions, preferences,
prior state, instructions, memory, or context.

The Kody state repo is available at:
<kody-state>

The repo-specific state folder is:
<kody-state>/<repo-name>

Resolve <repo-name> from the current git repo name. Do not hardcode an owner,
org, or repo name in this reusable rule.

Relevant context files:
- <kody-state>/<repo-name>/instructions.md
- <kody-state>/<repo-name>/context/
- <kody-state>/<repo-name>/memory/INDEX.md
- <kody-state>/<repo-name>/memory/

If these files are missing or stale, say that clearly before answering.
Do not invent context that is not in the app repo or Kody state repo.
Prefer current app repo files over memory when they conflict.
```

## When A Hook Is Needed

No hook is required for the basic setup.

Add a hook only when the operator wants stronger automation, such as:

- cloning or pulling `/workspace/kody-state` before each session
- blocking Codex when the state repo is missing
- injecting a compact context summary automatically
- checking that Codex read context before acting
