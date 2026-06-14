import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

const gh = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

const vault = vi.hoisted(() => ({
  resolveVaultGithubToken: vi.fn(async () => "vault-token"),
}));

const prefs = vi.hoisted(() => ({
  readNotificationPrefs: vi.fn(async () => ({
    version: 1,
    mutedTypes: ["pr-ready"],
  })),
  writeNotificationPrefs: vi.fn(async () => {}),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: gh.setGitHubContext,
  clearGitHubContext: gh.clearGitHubContext,
}));

vi.mock("@dashboard/lib/vault/bootstrap", () => ({
  resolveVaultGithubToken: vault.resolveVaultGithubToken,
}));

vi.mock("@dashboard/lib/notifications/prefs-store", () => ({
  readNotificationPrefs: prefs.readNotificationPrefs,
  writeNotificationPrefs: prefs.writeNotificationPrefs,
}));

import { GET, POST } from "../../app/api/notifications/preferences/route";

const MASTER = "notification-route-test-secret";

function req(
  token: string,
  init: {
    method?: string;
    body?: BodyInit;
    headers?: Record<string, string>;
  } = {},
) {
  return new NextRequest("https://dash.test/api/notifications/preferences", {
    method: init.method,
    body: init.body,
    headers: {
      "x-kody-token": token,
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
      ...(init.headers ?? {}),
    },
  });
}

async function signedToken(login: string) {
  return new SignJWT({ login })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(MASTER));
}

function unsignedToken(login: string) {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ login })}.`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KODY_MASTER_KEY", MASTER);
  vault.resolveVaultGithubToken.mockResolvedValue("vault-token");
});

describe("/api/notifications/preferences token verification", () => {
  it("accepts a KODY_MASTER_KEY-signed token", async () => {
    const token = await signedToken("alice");

    const res = await GET(req(token));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      login: "alice",
      mutedTypes: ["pr-ready"],
    });
    expect(prefs.readNotificationPrefs).toHaveBeenCalledWith(
      "alice",
      "vault-token",
    );
  });

  it("rejects an unsigned forged token", async () => {
    const res = await POST(
      req(unsignedToken("admin"), {
        method: "POST",
        body: JSON.stringify({ mutedTypes: [] }),
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "invalid_token" });
    expect(prefs.writeNotificationPrefs).not.toHaveBeenCalled();
  });
});
