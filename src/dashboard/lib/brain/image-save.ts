/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-save
 *
 * Small helpers shared by the Brain image save API route and tests.
 */

export const BRAIN_STATE_LAYER_MAX_BYTES = 64 * 1024 * 1024;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function brainImageTag(now = new Date()): string {
  return now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();
}

export function brainFlyImageRef(app: string, tag: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(app)) {
    throw new Error("Invalid Brain app name");
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    throw new Error("Invalid Brain image tag");
  }
  return `registry.fly.io/${app}:${tag}`;
}

export function brainStateExportCommand(): string {
  return String.raw`/bin/bash -lc '
set -u
tmpdir="$(mktemp -d)"
archive="$tmpdir/root-state.tar"
err="$tmpdir/tar.err"
status=0
tar -C / \
  --exclude=root/.cache \
  --exclude=root/.npm \
  --exclude=root/.pnpm-store \
  --exclude=root/.local/share/pnpm \
  --exclude=root/.local/share/Trash \
  --exclude=root/.local/share/containers \
  --exclude=root/.cargo/registry \
  --exclude=root/.cargo/git \
  --exclude=root/.rustup \
  --exclude=root/go \
  --exclude=root/.local/share/uv \
  --exclude="root/**/node_modules" \
  --exclude="root/**/.git" \
  --ignore-failed-read \
  --warning=no-file-changed \
  -cf "$archive" root 2>"$err" || status=$?
if [ "$status" -gt 1 ]; then
  cat "$err" >&2
  rm -rf "$tmpdir"
  exit "$status"
fi
gzip -n -c "$archive" | {
  if base64 --help 2>&1 | grep -q -- "-w"; then
    base64 -w 0
  else
    base64 | tr -d "\n"
  fi
}
rm -rf "$tmpdir"
'`;
}

export function decodeBrainStateLayer(value: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!compact) throw new Error("Brain state export was empty");
  const buffer = Buffer.from(compact, "base64");
  if (buffer.length === 0) throw new Error("Brain state export was empty");
  if (buffer.length > BRAIN_STATE_LAYER_MAX_BYTES) {
    throw new Error(
      `Brain state export is too large (${Math.round(
        buffer.length / 1024 / 1024,
      )}MB compressed; limit is ${Math.round(
        BRAIN_STATE_LAYER_MAX_BYTES / 1024 / 1024,
      )}MB)`,
    );
  }
  return buffer;
}

export function brainImageBuildCommand(input: {
  app: string;
  machineId: string;
  tag: string;
  baseImageRef: string;
}): string {
  const imageRef = brainFlyImageRef(input.app, input.tag);
  const exportCommand = brainStateExportCommand();
  return String.raw`/bin/bash -lc ${shellQuote(`
set -euo pipefail
app=${shellQuote(input.app)}
machine=${shellQuote(input.machineId)}
tag=${shellQuote(input.tag)}
base=${shellQuote(input.baseImageRef)}
image=${shellQuote(imageRef)}
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

if ! flyctl ssh console --app "$app" --machine "$machine" --command ${shellQuote(
    exportCommand,
  )} > "$tmpdir/root-state.tgz.b64" 2>"$tmpdir/export.log"; then
  tail -n 200 "$tmpdir/export.log" >&2
  exit 1
fi
base64 -d "$tmpdir/root-state.tgz.b64" > "$tmpdir/root-state.tgz"

cat > "$tmpdir/Dockerfile" <<EOF
FROM $base
COPY root-state.tgz /tmp/kody-root-state.tgz
RUN tar -xzf /tmp/kody-root-state.tgz -C / && rm /tmp/kody-root-state.tgz
EOF

cat > "$tmpdir/fly.toml" <<EOF
app = "$app"

[build]
  dockerfile = "Dockerfile"
EOF

if ! NO_COLOR=1 flyctl deploy "$tmpdir" \
  --app "$app" \
  --config "$tmpdir/fly.toml" \
  --build-only \
  --push \
  --depot=false \
  --image-label "$tag" > "$tmpdir/build.log" 2>&1; then
  tail -n 200 "$tmpdir/build.log" >&2
  exit 1
fi

printf '\\n__KODY_BRAIN_IMAGE_REF=%s\\n' "$image"
`)}`;
}
