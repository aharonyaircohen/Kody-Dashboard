/**
 * @fileType util
 * @domain capabilities
 * @pattern capability-profile
 * @ai-summary Pure helpers that translate the dashboard's simple capability
 *   form fields to and from a valid engine `profile.json`.
 *   We generate the same execution shape the built-in `feature` capability
 *   uses for the "opens a PR" landing (the `pr-branch` lifecycle wraps context-load
 *   → composePrompt → agent → verify → commit → PR → comment). The
 *   instructions the user writes live in `capability.md`, which the lifecycle's
 *   `composePrompt` step reads.
 *
 *   No engine call is made here — this is the contract, kept in sync with
 *   kody2/src/profile.ts. Validation mirrors the engine's required invariants
 *   so the dashboard can reject a broken profile before committing.
 */

/** Where the capability's result lands. `pr` opens a pull request (the
 * `pr-branch` lifecycle); `comment` posts the agent's answer as a comment
 * (the engine's `postAgentComment` postflight) with no branch or PR. */
export type CapabilityLanding = "pr" | "comment";

export const CAPABILITY_KINDS = ["observe", "act", "verify"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const DEFAULT_CAPABILITY_KIND: CapabilityKind = "act";

export function isCapabilityKind(value: unknown): value is CapabilityKind {
  return (
    typeof value === "string" &&
    CAPABILITY_KINDS.includes(value as CapabilityKind)
  );
}

/**
 * An external MCP (Model Context Protocol) server the engine spawns so the
 * agent can call its tools. Matches the engine's `McpServerSpec`
 * shape exactly — `{ name, command, args?, env? }`
 * — so a dashboard-authored entry drops straight into `claudeCode.mcpServers`.
 * Example: `{ name: "codegraph", command: "codegraph", args: ["serve","--mcp"] }`.
 */
export interface McpServerSpec {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** The allowlist token that grants the agent every tool from an MCP server. */
export function mcpAllowToken(serverName: string): string {
  return `mcp__${serverName}`;
}

export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Tools the form offers as checkboxes. The engine accepts any string; this
 * is just the convenient subset for the common "work an issue" capability. */
export const COMMON_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "Agent",
  "mcp__kody-verify",
] as const;

/** Dashboard-facing description of a capability, independent of GitHub I/O. */
export interface CapabilityFields {
  /** Folder name under `capabilities/` in the state repo. */
  slug: string;
  /** One-line human description (`profile.describe`). */
  describe: string;
  /** Public capability promise. Engine metadata only; it does not change control flow. */
  capabilityKind: CapabilityKind;
  /** Glue instructions — written to `prompt.md`, read by `composePrompt`. */
  prompt: string;
  /** `claudeCode.model`: "inherit" or "provider/model". */
  model: string;
  /** `claudeCode.permissionMode`. */
  permissionMode: PermissionMode;
  /** `claudeCode.tools`. */
  tools: string[];
  /** Skill folder names under `skills/`. Maps to `claudeCode.skills`. */
  skills: string[];
  /** `.sh` filenames colocated with the profile, run as preflight shell steps. */
  shellScripts: string[];
  /**
   * External MCP tool servers the agent may call. Written to
   * `claudeCode.mcpServers`; each server's tools are auto-added to the
   * allowlist via {@link mcpAllowToken} so the agent is permitted to call them.
   */
  mcpServers: McpServerSpec[];
  /** Where the result lands. */
  landing: CapabilityLanding;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function descriptionFromInstructions(
  name: string,
  instructions: string,
): string {
  const fallback = name.trim() || "Untitled action";
  const line =
    instructions
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(
        (entry) =>
          entry &&
          !entry.startsWith("#") &&
          entry !== "Use the configured skills, tools, and scripts." &&
          entry !== "Return the required final result.",
      ) ?? fallback;
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : line;
}

/**
 * The engine parses the agent's FINAL message for `DONE` / `COMMIT_MSG` /
 * `PR_SUMMARY` / `FAILED` markers (kody2/src/prompt.ts `parseAgentResult`).
 * The built-in `feature` flow bakes this contract into its prompt; `plan`
 * puts it at the END of its prompt.md. Live testing showed the agent only
 * reliably emits the markers when the contract is the LAST instruction it
 * sees — `systemPromptAppend` alone gets ignored. So we APPEND the contract
 * to prompt.md (after a managed sentinel) on write, and strip it on read so
 * the editor only shows the user's part. Without the markers,
 * `parseAgentResult` reports markerMissing → no commit and no comment.
 */
export const OUTPUT_CONTRACT_SENTINEL =
  "<!-- kody:output-format (managed — edit above this line only) -->";

const PR_OUTPUT_CONTRACT = `

# Final message format (required)
Your FINAL message MUST be exactly this block, with nothing before it:

DONE
COMMIT_MSG: <conventional commit, e.g. "feat: add X">
PR_SUMMARY:
<2–6 bullets: what you changed, why, and how it works>

If you cannot complete the task, output a single line instead: FAILED: <reason>`;

const COMMENT_OUTPUT_CONTRACT = `

# Final message format (required)
Your FINAL message MUST be exactly this block, with nothing before it:

DONE
PR_SUMMARY:
<your complete answer to the issue — this text is posted verbatim as a comment>

If you cannot answer, output a single line instead: FAILED: <reason>`;

/** The output-format contract appended to prompt.md for a given landing. */
export function contractFor(landing: CapabilityLanding): string {
  return landing === "pr" ? PR_OUTPUT_CONTRACT : COMMENT_OUTPUT_CONTRACT;
}

/**
 * Append the managed output-format contract to a user's prompt so it's the
 * final instruction the agent sees. Idempotent: any previously-appended
 * contract is stripped first.
 */
export function appendContract(
  userPrompt: string,
  landing: CapabilityLanding,
): string {
  const base = stripContract(userPrompt).replace(/\s+$/, "");
  return `${base}\n\n${OUTPUT_CONTRACT_SENTINEL}${contractFor(landing)}`;
}

/** Remove the managed contract (everything from the sentinel on). */
export function stripContract(prompt: string): string {
  const i = prompt.indexOf(OUTPUT_CONTRACT_SENTINEL);
  return i === -1 ? prompt : prompt.slice(0, i).replace(/\s+$/, "");
}

/**
 * Build a valid engine profile object from the form fields. Mirrors the
 * built-in `feature` profile for the PR landing so it is known-good.
 */
export function composeProfile(
  fields: CapabilityFields,
): Record<string, unknown> {
  // Derive the MCP allow-tokens fresh from the server list and merge them into
  // the user's checkbox tools, deduped. We strip any pre-existing `mcp__*`
  // entries first so the allowlist is always exactly the current servers —
  // otherwise round-tripping (fieldsFromProfile → composeProfile) would
  // accumulate stale tokens for servers that were removed.
  const mcpServers = fields.mcpServers ?? [];
  const baseTools = fields.tools.filter((t) => !t.startsWith("mcp__"));
  const tools = [...baseTools, ...mcpServers.map((s) => mcpAllowToken(s.name))];

  const claudeCode: Record<string, unknown> = {
    model: fields.model || "inherit",
    permissionMode: fields.permissionMode,
    maxTurns: null,
    maxTurnTimeoutSec: 1200,
    // The output-format contract lives at the END of prompt.md (see
    // appendContract), not here — the agent ignores a system-prompt-only
    // contract. Kept null so we don't duplicate/conflict.
    systemPromptAppend: null,
    cacheable: true,
    enableVerifyTool: fields.landing === "pr",
    verifyAttempts: 4,
    tools,
    hooks: fields.landing === "pr" ? ["block-git"] : [],
    skills: fields.skills,
    commands: [],
    subagents: [],
    plugins: [],
    mcpServers,
  };

  // Shell scripts run as preflight steps before the agent (setup work).
  const preflight: Array<Record<string, unknown>> = fields.shellScripts.map(
    (shell) => ({ shell }),
  );
  // Skills only load if buildSyntheticPlugin assembles them in preflight
  // (it reads claudeCode.skills + the skills/<name>/ folders). The built-in
  // `probe-skill` declares it the same way; without it skills are inert.
  if (fields.skills.length > 0) {
    preflight.push({ script: "buildSyntheticPlugin" });
  }

  const base: Record<string, unknown> = {
    name: fields.slug,
    role: "primitive",
    describe: fields.describe,
    capabilityKind: fields.capabilityKind,
    inputs: [
      {
        name: "issue",
        flag: "--issue",
        type: "int",
        required: true,
        describe: "GitHub issue number to work on.",
      },
    ],
    claudeCode,
    cliTools: [],
  };

  if (fields.landing === "pr") {
    return {
      ...base,
      lifecycle: "pr-branch",
      lifecycleConfig: {
        label: {
          name: "kody:running",
          color: "fbca04",
          description: "kody: working",
        },
        context: "task",
        sync: false,
        verify: true,
        advance: false,
        mirrorState: true,
        finalize: true,
      },
      scripts: { preflight, postflight: [] },
    };
  }

  // comment landing: load the issue, compose the prompt, run the agent,
  // post the agent's answer as a comment (no branch, no PR). Uses the
  // engine's generic `postAgentComment` postflight.
  return {
    ...base,
    scripts: {
      preflight: [
        ...preflight,
        { script: "loadIssueContext" },
        { script: "composePrompt" },
      ],
      postflight: [
        { script: "parseAgentResult" },
        { script: "postAgentComment" },
      ],
    },
  };
}

/** Serialize a profile object to the on-disk JSON string (2-space, trailing NL). */
export function serializeProfile(profile: Record<string, unknown>): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/** The landing implied by a parsed profile object. */
export function landingOf(
  profile: Record<string, unknown>,
): CapabilityLanding {
  return profile.lifecycle === "pr-branch" ? "pr" : "comment";
}

/**
 * Extract form fields back out of a parsed profile object so the editor can
 * round-trip an existing capability. `prompt` and `shellScripts`/`skills`
 * bodies are filled in by the file layer, not here.
 */
export function fieldsFromProfile(
  slug: string,
  profile: Record<string, unknown>,
): Omit<CapabilityFields, "prompt"> {
  const cc = (profile.claudeCode ?? {}) as Record<string, unknown>;
  const scripts = (profile.scripts ?? {}) as Record<string, unknown>;
  const preflight = Array.isArray(scripts.preflight)
    ? (scripts.preflight as Array<Record<string, unknown>>)
    : [];
  const shellScripts = preflight
    .map((e) => e.shell)
    .filter((s): s is string => typeof s === "string");
  return {
    slug,
    describe: typeof profile.describe === "string" ? profile.describe : "",
    capabilityKind: isCapabilityKind(profile.capabilityKind)
      ? profile.capabilityKind
      : DEFAULT_CAPABILITY_KIND,
    model: typeof cc.model === "string" ? cc.model : "inherit",
    permissionMode: PERMISSION_MODES.includes(
      cc.permissionMode as PermissionMode,
    )
      ? (cc.permissionMode as PermissionMode)
      : "acceptEdits",
    // Strip the derived `mcp__*` allow-tokens — they're regenerated from
    // mcpServers on write, so the editor only tracks the user's real tools.
    tools: Array.isArray(cc.tools)
      ? (cc.tools as string[]).filter((t) => !t.startsWith("mcp__"))
      : [],
    skills: Array.isArray(cc.skills) ? (cc.skills as string[]) : [],
    shellScripts,
    mcpServers: parseMcpServers(cc.mcpServers),
    landing: landingOf(profile),
  };
}

/** Parse a raw `claudeCode.mcpServers` value into validated specs ([] if absent/malformed). */
function parseMcpServers(raw: unknown): McpServerSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: McpServerSpec[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.command !== "string") continue;
    const spec: McpServerSpec = { name: r.name, command: r.command };
    if (Array.isArray(r.args))
      spec.args = r.args.filter((a): a is string => typeof a === "string");
    if (r.env && typeof r.env === "object" && !Array.isArray(r.env))
      spec.env = r.env as Record<string, string>;
    out.push(spec);
  }
  return out;
}

/**
 * Lightweight validation mirroring the engine's `loadProfile` invariants, so
 * the dashboard can reject a broken profile before committing it. Returns a
 * list of human-readable problems ([] = valid).
 */
export function validateProfile(profile: unknown): string[] {
  const errors: string[] = [];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return ["profile must be a JSON object"];
  }
  const r = profile as Record<string, unknown>;
  const validRoles = [
    "primitive",
    "orchestrator",
    "container",
    "watch",
    "utility",
  ];

  if (typeof r.name !== "string" || r.name.length === 0)
    errors.push('"name" must be a non-empty string');
  if (typeof r.role !== "string" || !validRoles.includes(r.role))
    errors.push(`"role" must be one of: ${validRoles.join(" | ")}`);
  if (r.capabilityKind !== undefined && !isCapabilityKind(r.capabilityKind)) {
    errors.push('"capabilityKind" must be one of: observe | act | verify');
  }
  if (!Array.isArray(r.inputs)) errors.push('"inputs" must be an array');
  if (!r.claudeCode || typeof r.claudeCode !== "object")
    errors.push('"claudeCode" must be an object');
  const scripts = r.scripts as Record<string, unknown> | undefined;
  if (!scripts || typeof scripts !== "object") {
    errors.push(
      '"scripts" must be an object with preflight and postflight arrays',
    );
  } else {
    if (!Array.isArray(scripts.preflight))
      errors.push('"scripts.preflight" must be an array');
    if (!Array.isArray(scripts.postflight))
      errors.push('"scripts.postflight" must be an array');
  }
  if (r.kind === "scheduled" && typeof r.schedule !== "string")
    errors.push('kind: "scheduled" requires a "schedule" cron string');
  if (r.lifecycle !== undefined && r.lifecycle !== "pr-branch")
    errors.push(
      `unknown "lifecycle": "${String(r.lifecycle)}" (only "pr-branch" is supported)`,
    );
  return errors;
}
