/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern notification-prefs-api
 * @ai-summary GET / POST per-user notification preferences.
 *   Persisted as `.kody/notifications/preferences/<login>.json` on the
 *   `kody-state` branch. Authed via `x-kody-token` header (client localStorage
 *   auth) or env token fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { resolveVaultGithubToken } from "@dashboard/lib/vault/bootstrap";
import {
  readNotificationPrefs,
  writeNotificationPrefs,
  type NotificationPrefsFile,
  type ServerNotificationType,
} from "@dashboard/lib/notifications/prefs-store";

// Valid notification types that can be muted
const VALID_TYPES: ServerNotificationType[] = [
  "task-assigned",
  "task-completed",
  "task-failed",
  "pr-ready",
  "pr-merged",
  "chat-response",
  "gate-waiting",
];

const UpdateSchema = z.object({
  mutedTypes: z.array(z.string()),
});

function invalidTypeResponse(invalid: string[]) {
  return NextResponse.json(
    {
      error: "invalid_notification_type",
      message: `Unknown notification types: ${invalid.join(", ")}`,
    },
    { status: 400 },
  );
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  // The caller's login is embedded in the token JWT — extract it to identify
  // whose prefs file to read.
  const tokenPayload = parseKodyToken(auth.token);
  const login = tokenPayload?.login;
  if (!login) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  // Resolve token for GitHub API calls: prefer the user's PAT from headers,
  // fall back to the vault token (public-repo bootstrap).
  const token =
    auth.token && auth.token.startsWith("ghp_")
      ? auth.token
      : await resolveVaultGithubToken(auth.owner, auth.repo);

  if (!token) {
    return NextResponse.json({ error: "no_github_token" }, { status: 401 });
  }

  setGitHubContext(auth.owner, auth.repo, token);
  try {
    const prefs = await readNotificationPrefs(login, token);
    return NextResponse.json({ login, mutedTypes: prefs.mutedTypes });
  } catch (err) {
    return NextResponse.json(
      {
        error: "prefs_read_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  // Extract caller login from token
  const tokenPayload = parseKodyToken(auth.token);
  const login = tokenPayload?.login;
  if (!login) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const invalid = parsed.data.mutedTypes.filter(
    (t): t is string => !VALID_TYPES.includes(t as ServerNotificationType),
  );
  if (invalid.length > 0) {
    return invalidTypeResponse(invalid);
  }

  // Resolve token: prefer user's PAT, fall back to vault token
  const token =
    auth.token && auth.token.startsWith("ghp_")
      ? auth.token
      : await resolveVaultGithubToken(auth.owner, auth.repo);

  if (!token) {
    return NextResponse.json({ error: "no_github_token" }, { status: 401 });
  }

  setGitHubContext(auth.owner, auth.repo, token);
  try {
    const prefs: NotificationPrefsFile = {
      version: 1,
      mutedTypes: parsed.data.mutedTypes as ServerNotificationType[],
    };
    await writeNotificationPrefs(login, token, prefs);
    return NextResponse.json({ ok: true, login, mutedTypes: prefs.mutedTypes });
  } catch (err) {
    return NextResponse.json(
      {
        error: "prefs_write_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

/**
 * Decode the `x-kody-token` JWT to extract the GitHub login.
 * The token is a JWT signed with KODY_MASTER_KEY; its payload contains `login`.
 */
function parseKodyToken(token: string): { login?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1]!;
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(json) as { login?: string };
  } catch {
    return null;
  }
}
