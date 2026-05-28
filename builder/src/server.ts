/**
 * Hono HTTP server for the preview builder.
 *
 * Endpoints:
 *   GET  /health         (unauthenticated)
 *   POST /build          (authenticated via X-Builder-Auth shared key)
 *
 * Auth is the derived KODY_MASTER_KEY-based shared key (auth.ts) so no
 * extra env vars travel between the dashboard and this service.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { verifyAuth } from "./auth.ts";
import { build } from "./builder.ts";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  if (!verifyAuth(c.req.header("x-builder-auth"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

app.post("/build", async (c) => {
  let body: {
    repo?: string;
    ref?: string;
    appName?: string;
    imageTag?: string;
    flyToken?: string;
    githubToken?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!body.repo || !body.ref || !body.appName || !body.flyToken) {
    return c.json(
      { error: "missing_fields", required: ["repo", "ref", "appName", "flyToken"] },
      400,
    );
  }

  try {
    const result = await build({
      repo: body.repo,
      ref: body.ref,
      appName: body.appName,
      imageTag: body.imageTag,
      flyToken: body.flyToken,
      githubToken: body.githubToken,
    });
    return c.json(result, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: "build_failed", message: msg }, 500);
  }
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port });
console.log(`kody-preview-builder listening on :${port}`);
