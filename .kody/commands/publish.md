---
description: publish new ver
---

Create a release-request issue and dispatch the consolidated `release` executable.

Use the `request_release` tool when available. Otherwise create a release request issue labeled `release`, then comment:

`@kody release --issue <issue-number> --bump patch`

Do not call or recreate the removed `publish-release` duty.
