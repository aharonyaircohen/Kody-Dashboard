/**
 * @fileType util
 * @domain executables
 * @pattern executable-profile
 * @ai-summary Pure helpers that translate the dashboard's simple executable
 *   form fields <-> a valid engine `profile.json`. The engine reads custom
 *   executables from `.kody/executables/<slug>/profile.json` (registry root
 *   `.kody/executables` is checked before `src/executables`). We generate the
 *   same shape the built-in `feature` executable uses for the "opens a PR"
 *   landing (the `pr-branch` lifecycle wraps context-load → composePrompt →
 *   agent → verify → commit → PR → comment). The prompt the user writes lives
 *   in `prompt.md`, which the lifecycle's `composePrompt` step reads.
 *
 *   No engine call is made here — this is the contract, kept in sync with
 *   kody2/src/profile.ts. Validation mirrors the engine's required invariants
 *   so the dashboard can reject a broken profile before committing.
 */

/** Where the executable's result lands. `pr` opens a pull request; `comment`
 * posts a status comment. Only `pr` is fully wired today — `comment` is a
 * placeholder pending a generic "post agent result" engine postflight. */
export type ExecutableLanding = "pr" | "comment";

export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Tools the form offers as checkboxes. The engine accepts any string; this
 * is just the convenient subset for the common "work an issue" executable. */
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

/** Dashboard-facing description of an executable, independent of GitHub I/O. */
export interface ExecutableFields {
  /** Folder name under `.kody/executables/`. Becomes the `@kody <slug>` action. */
  slug: string;
  /** One-line human description (`profile.describe`). */
  describe: string;
  /** The prompt template — written to `prompt.md`, read by `composePrompt`. */
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
  /** Where the result lands. */
  landing: ExecutableLanding;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * Build a valid engine profile object from the form fields. Mirrors the
 * built-in `feature` profile for the PR landing so it is known-good.
 */
export function composeProfile(
  fields: ExecutableFields,
): Record<string, unknown> {
  const claudeCode: Record<string, unknown> = {
    model: fields.model || "inherit",
    permissionMode: fields.permissionMode,
    maxTurns: null,
    maxTurnTimeoutSec: 1200,
    systemPromptAppend: null,
    cacheable: true,
    enableVerifyTool: fields.landing === "pr",
    verifyAttempts: 4,
    tools: fields.tools,
    hooks: fields.landing === "pr" ? ["block-git"] : [],
    skills: fields.skills,
    commands: [],
    subagents: [],
    plugins: [],
    mcpServers: [],
  };

  // Shell scripts run as preflight steps before the agent (setup work).
  const preflight: Array<Record<string, unknown>> = fields.shellScripts.map(
    (shell) => ({ shell }),
  );

  const base: Record<string, unknown> = {
    name: fields.slug,
    role: "primitive",
    describe: fields.describe,
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

  // comment landing (placeholder until a generic "post agent answer"
  // postflight exists in the engine): load the issue, compose the prompt,
  // run the agent, post a status comment. No PR branch.
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
        { script: "postIssueComment" },
      ],
    },
  };
}

/** Serialize a profile object to the on-disk JSON string (2-space, trailing NL). */
export function serializeProfile(profile: Record<string, unknown>): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/** The landing implied by a parsed profile object. */
export function landingOf(profile: Record<string, unknown>): ExecutableLanding {
  return profile.lifecycle === "pr-branch" ? "pr" : "comment";
}

/**
 * Extract form fields back out of a parsed profile object so the editor can
 * round-trip an existing executable. `prompt` and `shellScripts`/`skills`
 * bodies are filled in by the file layer, not here.
 */
export function fieldsFromProfile(
  slug: string,
  profile: Record<string, unknown>,
): Omit<ExecutableFields, "prompt"> {
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
    model: typeof cc.model === "string" ? cc.model : "inherit",
    permissionMode: PERMISSION_MODES.includes(
      cc.permissionMode as PermissionMode,
    )
      ? (cc.permissionMode as PermissionMode)
      : "acceptEdits",
    tools: Array.isArray(cc.tools) ? (cc.tools as string[]) : [],
    skills: Array.isArray(cc.skills) ? (cc.skills as string[]) : [],
    shellScripts,
    landing: landingOf(profile),
  };
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
