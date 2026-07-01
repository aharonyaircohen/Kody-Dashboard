/**
 * Doorman — tiny reverse proxy that guards per-PR Fly preview machines.
 *
 * Runs as PID 1 (or alongside Next.js) inside each preview machine, listening
 * on port 8080 (the port Fly's service maps 80/443 to). Verifies signed
 * preview tickets on first load, swaps the ticket for a session cookie, and
 * proxies valid requests to Next.js on port 3000.
 *
 * Ticket format (dashboard-side):
 *   mint: subject = "<repo>#<pr>:<expEpochSec>"
 *         sig     = HMAC-SHA256(subject, HKDF(KODY_MASTER_KEY, info="kody-preview:v1"))[0..31]
 *         wire    = base64url({ r: repo, p: pr, e: exp, s: sig })
 *     branch subject = "<repo>@<branch>:<expEpochSec>"
 *         wire    = base64url({ r: repo, b: branch, e: exp, s: sig })
 *   verify: decode wire -> extract repo, pr/branch, expiry, sig -> reject
 *           if expired -> recompute sig -> timingSafeEqual -> set-Cookie
 *           -> strip kp -> proxy
 *
 * Security notes:
 *   - The verify key (HKDF-derive) is all the doorman needs — it never holds
 *     the raw master key. Derived key arrives via KODY_PREVIEW_VERIFY_KEY env.
 *   - Cookie is HttpOnly+Secure so JS can't read it; the ticket param is stripped
 *     after verification so it leaves no trace in browser history.
 *   - The doorman reads machine identity from builder-set env
 *     (KODY_REPO_CONTEXT plus KODY_PR or KODY_BRANCH), not client input.
 */

import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const NEXT_PORT = Number.parseInt(process.env.NEXT_INTERNAL_PORT ?? "3000", 10);
const COOKIE_NAME = "kody_preview_session";
const COOKIE_MAX_AGE = 4 * 60 * 60; // 4 hours in seconds

// Machine identity — set at boot so the doorman can bind tickets to this
// specific machine (repo + pr/branch), preventing a ticket minted for machine A
// from being used on machine B (they share the same verify key).
const APP_REPO = process.env.KODY_REPO_CONTEXT ?? "";
const APP_PR_RAW = process.env.KODY_PR?.trim() ?? "";
const APP_PR = APP_PR_RAW ? Number.parseInt(APP_PR_RAW, 10) : null;
const APP_BRANCH = process.env.KODY_BRANCH?.trim() ?? "";

/**
 * HKDF-derive the preview verify key from the raw env var.
 * The raw master key never arrives here — only the derived 32-byte key.
 */
function getVerifyKey(): Buffer | null {
  const raw = process.env.KODY_PREVIEW_VERIFY_KEY;
  if (!raw) return null;
  // Accept hex (64 chars) or base64url
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    return Buffer.from(raw, "hex");
  }
  try {
    return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
}

interface TicketPayload {
  r: string;
  p?: number;
  b?: string;
  e: number;
  s: string;
}

function decodeTicket(ticket: string): TicketPayload | null {
  try {
    const payload = JSON.parse(
      Buffer.from(ticket, "base64url").toString("utf8"),
    ) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const p = payload as Record<string, unknown>;
    const hasPr = typeof p.p === "number";
    const hasBranch = typeof p.b === "string";
    if (
      typeof p.r !== "string" ||
      typeof p.e !== "number" ||
      typeof p.s !== "string" ||
      hasPr === hasBranch
    )
      return null;
    const base = { r: p.r, e: p.e, s: p.s };
    if (hasPr) {
      const pr = p.p;
      if (typeof pr !== "number") return null;
      return { ...base, p: pr };
    }

    const branch = p.b;
    if (typeof branch !== "string") return null;
    return { ...base, b: branch };
  } catch {
    return null;
  }
}

/**
 * Rebuild the HMAC subject from the ticket payload.
 * Note: payload.r is validated against kody_repo_context before this is called,
 * so we include it in the subject to bind the ticket to this specific machine.
 */
function buildSubject(payload: TicketPayload): string {
  if (typeof payload.p === "number") {
    return `${payload.r}#${payload.p}:${payload.e}`;
  }
  return `${payload.r}@${payload.b}:${payload.e}`;
}

function verifyAndGetSession(ticket: string, key: Buffer): boolean {
  const payload = decodeTicket(ticket);
  if (!payload) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now >= payload.e) return false;

  // Reject if the ticket isn't for this machine's repo, PR, or branch.
  // This prevents a ticket minted for machine A from being used on machine B,
  // even though both machines share the same verify key.
  if (payload.r !== APP_REPO) return false;
  if (typeof payload.p === "number") {
    if (APP_PR === null || payload.p !== APP_PR) return false;
  } else {
    if (!APP_BRANCH || payload.b !== APP_BRANCH) return false;
  }

  // note: payload.r is validated against kody_repo_context above.
  // we include it in the hmac subject so the ticket is bound to this specific machine.
  // SECURITY: the repo is sourced from the ticket's `r` field (HMAC-verified below),
  // NOT from parseAppName() — the parser can't recover the original repo name from
  // the hashed app name, and we must not "fix" that. Binding relies on the ticket.
  const subject = buildSubject(payload);
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(subject)
    .digest("hex")
    .slice(0, 32);

  const a = Buffer.from(payload.s, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sessionCookieHeader(): string {
  return `${COOKIE_NAME}=1; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=${COOKIE_MAX_AGE}`;
}

function send401(res: http.ServerResponse, body = "401 Unauthorized"): void {
  res.writeHead(401, {
    "Content-Type": "text/plain",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetPort: number,
  responseHeaders: http.OutgoingHttpHeaders = {},
): void {
  const options = {
    hostname: "localhost",
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      // Prevent hop-by-hop headers from being forwarded
      "x-forwarded-host": req.headers.host ?? "",
      "x-forwarded-proto": "https",
    },
    // Remove headers Node sets for its own proxied requests
  };

  // Strip hop-by-hop headers
  const hopByHop = [
    "transfer-encoding",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "upgrade",
  ];
  for (const h of hopByHop) {
    delete (options.headers as Record<string, string | string[] | undefined>)[
      h
    ];
  }

  const proxyReq = http.request(options, (proxyRes) => {
    const headers: http.OutgoingHttpHeaders = {
      ...proxyRes.headers,
      ...responseHeaders,
    };
    const proxySetCookie = proxyRes.headers["set-cookie"];
    const addedSetCookie =
      responseHeaders["set-cookie"] ?? responseHeaders["Set-Cookie"];
    if (addedSetCookie) {
      const proxyCookieValues = Array.isArray(proxySetCookie)
        ? proxySetCookie
        : proxySetCookie
          ? [proxySetCookie]
          : [];
      const addedCookieValues = Array.isArray(addedSetCookie)
        ? addedSetCookie.map(String)
        : [String(addedSetCookie)];
      headers["set-cookie"] = [...proxyCookieValues, ...addedCookieValues];
      delete headers["Set-Cookie"];
    }

    for (const h of hopByHop) {
      delete headers[h];
    }
    res.writeHead(proxyRes.statusCode ?? 200, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("[doorman] proxy error:", err.message);
    if (!res.headersSent) {
      send401(res, "502 Bad Gateway");
    }
  });

  req.pipe(proxyReq, { end: true });
}

const key = getVerifyKey();
const server = http.createServer((req, res) => {
  // Only handle GET / POST — preflight for font/audio/etc. still proxy
  if (req.method !== "GET" && req.method !== "POST") {
    proxyRequest(req, res, NEXT_PORT);
    return;
  }

  // No verify key → fail closed (machine not configured for token gating)
  if (!key) {
    console.error(
      "[doorman] KODY_PREVIEW_VERIFY_KEY not set — rejecting all requests",
    );
    send401(res, "401 Preview not configured (missing verify key)");
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost`);
  const ticket = url.searchParams.get("kp");
  const cookies = (req.headers.cookie ?? "")
    .split(";")
    .reduce<Record<string, string>>((acc, c) => {
      const [k, v] = c.trim().split("=");
      if (k) acc[k.trim()] = v ?? "";
      return acc;
    }, {});
  const hasSession = cookies[COOKIE_NAME] === "1";

  if (ticket) {
    // Verify the ticket
    if (!verifyAndGetSession(ticket, key)) {
      send401(res, "401 Invalid or expired preview token");
      return;
    }

    // Valid — strip kp before proxying so the token does not reach Next.js.
    url.searchParams.delete("kp");
    req.url = `${url.pathname}${url.search}${url.hash}` || "/";
    proxyRequest(req, res, NEXT_PORT, {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": sessionCookieHeader(),
    });
    return;
  }

  if (hasSession) {
    // Valid session — proxy through
    proxyRequest(req, res, NEXT_PORT);
    return;
  }

  // No ticket, no session → 401
  send401(res, "401 Preview requires authentication via the Kody dashboard");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[doorman] listening on ${PORT} → localhost:${NEXT_PORT}`);
});
