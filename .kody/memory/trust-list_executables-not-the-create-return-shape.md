---
name: "Trust list_executables, not the create return shape"
description: "After any create_or_update_executable call, verify with list_executables — the create tool can return ok=true/action=created while the file is never actually written."
type: feedback
created: 2026-06-14T14:27:20.808Z
---

After any `create_or_update_executable` (or `create_or_update_kody_duty`) call, ALWAYS follow up with a second-source verification — `list_executables` / `list_duties` / `github_get_file` on the resulting path — before claiming the resource exists. The chat tool has been observed to return `ok: true, action: "created"` while the file is silently never written to the repo.

**Why:** In a single session I created 4 release executables (`release-prepare`, `release-merge`, `release-publish`, `release-deploy`) and got `ok: true` on every call. The user then asked "what will the fourth exec do?" — and a `list_executables` revealed all four were missing. The user was led to believe work had been done that wasn't.

**How to apply:**
- After any create, run a second-source check (list_*, get_file, read_*) and only report success on the second-source confirmation.
- If the second source disagrees, the second source is the truth — the tool return is wrong.
- The same pattern likely applies to `create_kody_duty` (duty create) and other write tools; verify all of them with a read.
- Don't trust the chat tool's success response shape alone.
