# release-tag skill

Publish the release tag and GitHub Release.

## Owns
- Confirm `v<version>` does not already exist.
- Create an annotated tag on the merged version PR commit.
- Push the tag.
- Create the GitHub Release with generated notes.
- Upload build artifacts only when the repo clearly produces them.

## Safety
- Never tag an unmerged PR branch.
- Never move an existing tag.
- Never edit an existing release unless the release-request issue explicitly asks for that recovery.
