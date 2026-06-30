/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-save
 *
 * Helpers for saving a Brain machine as a durable container image.
 */

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function dockerNamePart(value: string, field: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error(`Invalid Brain image ${field}`);
  }
  return normalized;
}

export function brainImageTag(now = new Date()): string {
  return now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}

export function brainGhcrImageRef(input: {
  owner: string;
  account: string;
  tag: string;
}): string {
  const owner = dockerNamePart(input.owner, "owner");
  const account = dockerNamePart(input.account, "account");
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(input.tag)) {
    throw new Error("Invalid Brain image tag");
  }
  return `ghcr.io/${owner}/kody-brain-${account}:${input.tag}`;
}

export function brainImageBuildCommand(input: {
  app: string;
  machineId: string;
  orgSlug: string;
  tag: string;
  baseImageRef: string;
  imageRef: string;
  ghcrUser: string;
}): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(input.tag)) {
    throw new Error("Invalid Brain image tag");
  }
  if (
    !/^ghcr\.io\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?:@sha256:[a-f0-9]{64})?$/.test(
      input.imageRef,
    )
  ) {
    throw new Error("Invalid Brain GHCR image ref");
  }
  const ghcrUser = dockerNamePart(input.ghcrUser, "GHCR user");
  return String.raw`/bin/bash -lc ${shellQuote(`
set -euo pipefail
app=${shellQuote(input.app)}
machine=${shellQuote(input.machineId)}
org=${shellQuote(input.orgSlug)}
tag=${shellQuote(input.tag)}
base=${shellQuote(input.baseImageRef)}
image=${shellQuote(input.imageRef)}
ghcr_user=${shellQuote(ghcrUser)}
tmpdir="$(mktemp -d)"
remote_archive="/tmp/kody-brain-rootfs-$tag.tgz"
remote_script="/tmp/kody-brain-export-$tag.sh"
trap 'flyctl ssh console --app "$app" --org "$org" --machine "$machine" --command "rm -f $remote_archive $remote_script" >/dev/null 2>&1 || true; rm -rf "$tmpdir"' EXIT

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends ca-certificates curl tar gzip >/dev/null
  rm -rf /var/lib/apt/lists/*
fi

if [ -z "\${GHCR_TOKEN:-}" ]; then
  echo "GHCR_TOKEN missing; GitHub token needs write:packages permission" >&2
  exit 1
fi

install_crane() {
  if command -v crane >/dev/null 2>&1; then return; fi
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) crane_arch="x86_64" ;;
    aarch64|arm64) crane_arch="arm64" ;;
    *) echo "unsupported crane architecture: $arch" >&2; exit 1 ;;
  esac
  crane_url="https://github.com/google/go-containerregistry/releases/download/v0.20.7/go-containerregistry_Linux_$crane_arch.tar.gz"
  curl -fsSL "$crane_url" -o "$tmpdir/crane.tgz"
  tar -xzf "$tmpdir/crane.tgz" -C "$tmpdir" crane
  install -m 0755 "$tmpdir/crane" /usr/local/bin/crane
}

cat > "$tmpdir/export-rootfs.sh" <<'EXPORT_SCRIPT'
#!/bin/bash
set -euo pipefail

archive="\${1:?archive}"
tmp="$archive.tmp"
rm -f "$tmp" "$archive"
status=0
tar -C / \\
  --one-file-system \\
  --numeric-owner \\
  --ignore-failed-read \\
  --warning=no-file-changed \\
  --exclude=proc \\
  --exclude=sys \\
  --exclude=dev \\
  --exclude=run \\
  --exclude=tmp \\
  --exclude=mnt \\
  --exclude=media \\
  --exclude=lost+found \\
  --exclude=var/tmp \\
  -czf "$tmp" . || status=$?
if [ "$status" -gt 1 ]; then exit "$status"; fi
mv "$tmp" "$archive"
ls -lh "$archive"
EXPORT_SCRIPT

if ! flyctl ssh sftp put "$tmpdir/export-rootfs.sh" "$remote_script" --mode 0755 --app "$app" --org "$org" --machine "$machine" --quiet > "$tmpdir/upload.log" 2>&1; then
  tail -n 200 "$tmpdir/upload.log" >&2
  exit 1
fi

if ! flyctl ssh console --app "$app" --org "$org" --machine "$machine" --command "/bin/bash $remote_script $remote_archive" > "$tmpdir/export.log" 2>&1; then
  tail -n 200 "$tmpdir/export.log" >&2
  exit 1
fi

if ! flyctl sftp get "$remote_archive" "$tmpdir/rootfs.tgz" --app "$app" --org "$org" --machine "$machine" --quiet > "$tmpdir/sftp.log" 2>&1; then
  tail -n 200 "$tmpdir/sftp.log" >&2
  exit 1
fi

install_crane
printf '%s' "$GHCR_TOKEN" | crane auth login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null

if ! crane append --base "$base" --new_layer "$tmpdir/rootfs.tgz" --new_tag "$image" > "$tmpdir/push.log" 2>&1; then
  tail -n 200 "$tmpdir/push.log" >&2
  exit 1
fi

printf '\\n__KODY_BRAIN_IMAGE_REF=%s\\n' "$image"
`)}`;
}
