# Docs Drift - README / markdown

## Job

Check merged PRs for documented areas that changed without matching markdown documentation updates.

## Executable

Run the `docs-readme` executable. Its skill owns the detailed method and runtime state handling.

## Output

Tracking issue and inbox recommendation for each new docs drift item.

## Allowed Commands

- Run the `docs-readme` executable.

## Restrictions

- Do not edit docs directly.
- Only flag merged PRs past the cursor.
- Deduplicate by target doc and PR.
- Never rewrite unrelated changelog or documentation content.
