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

export type BrainImageSavePhase =
  | "starting"
  | "uploading-script"
  | "exporting-rootfs"
  | "downloading-rootfs"
  | "preparing-push"
  | "pushing-image"
  | "verifying"
  | "completed"
  | "failed";

export interface BrainImageSaveProgress {
  phase: BrainImageSavePhase;
  message: string;
  lastOutput?: string;
}

const SAVE_STAGE_PROGRESS: Record<string, BrainImageSaveProgress> = {
  "upload-export-script": {
    phase: "uploading-script",
    message: "Preparing the Brain machine for export",
  },
  "export-rootfs": {
    phase: "exporting-rootfs",
    message: "Exporting the Brain filesystem",
  },
  "download-rootfs": {
    phase: "downloading-rootfs",
    message: "Downloading the Brain filesystem",
  },
  "install-crane": {
    phase: "preparing-push",
    message: "Preparing the image upload",
  },
  "push-ghcr": {
    phase: "pushing-image",
    message: "Pushing the Brain image to GHCR",
  },
};

export function brainImageSaveProgressFromOutput(input: {
  status: "running" | "completed" | "failed";
  stdout?: string | null;
  stderr?: string | null;
  error?: string | null;
}): BrainImageSaveProgress {
  const output = `${input.stdout ?? ""}\n${input.stderr ?? ""}`;
  const lastOutput = cleanProgressOutput(output);
  if (input.status === "completed") {
    return {
      phase: "completed",
      message: "Brain image saved",
      ...(lastOutput ? { lastOutput } : {}),
    };
  }
  if (input.status === "failed") {
    return {
      phase: "failed",
      message: input.error ?? "Brain image save failed",
      ...(lastOutput ? { lastOutput } : {}),
    };
  }

  const stages = [...output.matchAll(/__KODY_BRAIN_SAVE_STAGE=([^\s]+)/g)];
  const stage = stages.at(-1)?.[1];
  const progress = stage ? SAVE_STAGE_PROGRESS[stage] : null;
  const retry = [...output.matchAll(/__KODY_BRAIN_SAVE_RETRY=([^\s]+)/g)].at(
    -1,
  )?.[1];
  const message = retry
    ? `Retrying ${retry.replace(/:\d+$/, "").replaceAll("-", " ")}`
    : (progress?.message ?? "Starting Brain image save");
  return {
    phase: progress?.phase ?? "starting",
    message,
    ...(lastOutput ? { lastOutput } : {}),
  };
}

function cleanProgressOutput(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("__KODY_BRAIN_SAVE_STAGE=") &&
        !line.startsWith("__KODY_BRAIN_SAVE_RETRY="),
    )
    .slice(-20)
    .join("\n")
    .slice(-2000);
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
keepalive_pid=""
cleanup() {
  if [ -n "\${keepalive_pid:-}" ]; then
    kill "$keepalive_pid" >/dev/null 2>&1 || true
    wait "$keepalive_pid" >/dev/null 2>&1 || true
  fi
  flyctl ssh console --app "$app" --org "$org" --machine "$machine" --command "rm -f $remote_archive $remote_script" >/dev/null 2>&1 || true
  rm -rf "$tmpdir"
}
trap cleanup EXIT

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends ca-certificates curl tar gzip >/dev/null
  rm -rf /var/lib/apt/lists/*
fi

if [ -z "\${GHCR_TOKEN:-}" ]; then
  echo "GHCR_TOKEN missing; GitHub token needs write:packages permission" >&2
  exit 1
fi

keep_brain_awake() {
  while true; do
    curl -fsS --max-time 10 "https://$app.fly.dev/healthz" >/dev/null 2>&1 || true
    sleep 20
  done
}

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

retry() {
  local label="$1"
  shift
  local attempt=1
  while true; do
    "$@" && return 0
    local status=$?
    if [ "$attempt" -ge 3 ]; then return "$status"; fi
    echo "__KODY_BRAIN_SAVE_RETRY=$label:$attempt" >&2
    sleep $((attempt * 5))
    attempt=$((attempt + 1))
  done
}

keep_brain_awake &
keepalive_pid="$!"

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

echo "__KODY_BRAIN_SAVE_STAGE=upload-export-script"
if ! retry "upload-export-script" flyctl ssh sftp put "$tmpdir/export-rootfs.sh" "$remote_script" --mode 0755 --app "$app" --org "$org" --machine "$machine" --quiet > "$tmpdir/upload.log" 2>&1; then
  tail -n 200 "$tmpdir/upload.log" >&2
  exit 1
fi

echo "__KODY_BRAIN_SAVE_STAGE=export-rootfs"
if ! flyctl ssh console --app "$app" --org "$org" --machine "$machine" --command "/bin/bash $remote_script $remote_archive" > "$tmpdir/export.log" 2>&1; then
  tail -n 200 "$tmpdir/export.log" >&2
  exit 1
fi

echo "__KODY_BRAIN_SAVE_STAGE=download-rootfs"
if ! retry "download-rootfs" flyctl sftp get "$remote_archive" "$tmpdir/rootfs.tgz" --app "$app" --org "$org" --machine "$machine" --quiet > "$tmpdir/sftp.log" 2>&1; then
  tail -n 200 "$tmpdir/sftp.log" >&2
  exit 1
fi

echo "__KODY_BRAIN_SAVE_STAGE=install-crane"
install_crane
printf '%s' "$GHCR_TOKEN" | crane auth login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null

echo "__KODY_BRAIN_SAVE_STAGE=push-ghcr"
if ! retry "push-ghcr" crane append --base "$base" --new_layer "$tmpdir/rootfs.tgz" --new_tag "$image" > "$tmpdir/push.log" 2>&1; then
  tail -n 200 "$tmpdir/push.log" >&2
  exit 1
fi

printf '\\n__KODY_BRAIN_IMAGE_REF=%s\\n' "$image"
`)}`;
}
