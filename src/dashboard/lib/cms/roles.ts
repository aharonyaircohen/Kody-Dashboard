import "server-only";

import type { NextRequest } from "next/server";
import type { Octokit } from "@octokit/rest";

import { getRequestAuth, resolveActorFromToken } from "@dashboard/lib/auth";
import type { CmsRole } from "./types";

export async function getCmsActorRole(
  req: NextRequest,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<CmsRole> {
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) return "viewer";

  const actor = await resolveActorFromToken(headerAuth.token);
  if (!actor) return "viewer";

  try {
    const { data } = await octokit.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: actor.login,
    });

    switch (data.permission) {
      case "admin":
      case "maintain":
        return "admin";
      case "write":
        return "editor";
      default:
        return "viewer";
    }
  } catch {
    return "viewer";
  }
}
