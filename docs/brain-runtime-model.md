# Brain Runtime Model

This doc defines the boundary between Brain image, Brain terminal, and repo
Brain state.

## Short Model

They are one Brain machine, seen from different angles:

- Brain image: saved machine backup.
- Brain terminal: shell access into that machine.
- Repo Brain state: repo data and working state inside that machine.

Do not call a Brain image a terminal image. The terminal does not own the
image; it only connects to the running Brain machine.

## Brain Image

A Brain image is a durable saved copy of the Brain machine filesystem.

Saving an image exports the machine root filesystem and pushes a container
image to GHCR. That can include cloned repos, local memory files, caches, and
workspace state that exist on the machine.

It does not mean every Brain control record is moved into GitHub. The dashboard
still stores small pointers separately.

## Brain Terminal

The Brain terminal is only an access surface.

It opens a shell into the currently running Brain machine. It does not have its
own machine image, saved memory, or repo state.

If the selected Brain image is not running, terminal recovery should send the
operator back to Brain Images to run the correct image.

## Repo Brain State

Repo Brain state is the repo-specific data Brain uses while working.

In the running Brain machine, repo workspaces are cloned under the Brain server
workspace. If that data is present on disk when an image is saved, the image
can contain it.

This is different from dashboard control records, which only tell the dashboard
what app, image, or runtime it should use.

## Dashboard Control Records

These records live in the Kody state repo and are not the Brain machine itself:

| Record                                     | Meaning                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `users/<login>/data/brain.json`            | Which Brain Fly app belongs to the user.                       |
| `users/<login>/data/brain-image.json`      | Saved Brain image catalog and selected image pointer.          |
| `users/<login>/data/brain-runtime.json`    | Desired and currently running Brain image for the Fly machine. |
| `users/<login>/data/brain-image-save.json` | Current or last image-save job state.                          |

## Naming Rule

Use:

- `Brain image`
- `Running Brain image`
- `Brain terminal`
- `Repo Brain state`

Avoid:

- `Terminal image`
