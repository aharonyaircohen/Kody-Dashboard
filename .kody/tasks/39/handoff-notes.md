## What happened

`git merge origin/main` into PR #39 (25-keep-screen-always-on-during-voice-mode) produced two conflicts, both on regenerated duty-output report snapshots under `.kody/reports/`. Neither file is touched by the PR's actual code change (voice-mode wake lock in `useVoiceChat.ts`); the conflicts are pure drift between two parallel refresh cycles of the same files.

## How I resolved each

**`.kody/reports/ceo-performance-review.md`** — symmetric "both sides modified." Base was last week's report. PR (HEAD) had a mid-week refresh; origin/main had a more recent refresh with more detail (escalation notes on ceo cadence, PR #61 closing unmerged as the new tech-writer cause, full orphan-duty paragraph on `clear-empty-goals`). Took origin/main — newer data, more accurate.

**`.kody/reports/clear-empty-goals.md`** — asymmetric `delete vs modify` (DU). Base was the 18:58 UTC scan. PR (HEAD) deleted the file; origin/main modified it to the 20:16 UTC scan (with an extra cross-check bullet for orphan `goal:release-version`). Took origin/main — the PR's deletion was incidental (no code change in the PR touches this file or its duty), and the newer scan is the most recent authoritative state. The next duty fire will overwrite either way.

## Why not "take HEAD" / "preserve PR intent"

The PR is on a feature branch and its intent is voice-mode. The reports are time-stamped snapshots of duty output; there is no PR-authored change to preserve in either file. Both files are regenerable: the next duty fire will overwrite them with the current state. The natural merge resolution is "keep the most recent data" — which is what origin/main carries.

## Verification

- `grep -c '<<<<<<<'` on both files returns 0.
- `diff <(git show :3:FILE) FILE` is empty for both — working tree now matches origin/main's stage 3.
- The wrapper handles `git add` and the merge commit.
