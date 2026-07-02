/**
 * @fileType utility
 * @domain kody
 * @pattern company-intents
 * @ai-summary Types and normalizers for CTO agency-architect intents stored in state repo.
 */

export type CompanyIntentStatus = "active" | "paused" | "archived";
export type CompanyIntentPosture =
  | "confidence"
  | "speed"
  | "stability-recovery"
  | "maintenance"
  | "balanced";

export interface CompanyIntent {
  version: 1;
  id: string;
  status: CompanyIntentStatus;
  for: string;
  description?: string;
  priority: number;
  posture: CompanyIntentPosture;
  scope: {
    repos: string[];
    areas: string[];
  };
  principles: string[];
  metrics: string[];
  policy: {
    release?: {
      cadence?: "manual" | "1d" | "1w";
      qaDepth?: "light" | "standard" | "strict";
      blockerLevel?: "low" | "standard" | "strict";
      approval?: "none" | "before-production" | "before-risky-actions";
    };
    automation: {
      authority: "full-auto";
      maxConcurrentGoals: number;
      maxDailyActions: number;
      requiresHumanFor: string[];
    };
  };
  portfolio: {
    goals: string[];
    loops: string[];
    capabilities: string[];
  };
  manager: {
    agent: "cto";
    loop: "agency-architect-loop";
    capability: "agency-architect";
    reviewEvery: "1d" | "1w";
    lastReviewedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CompanyIntentDecisionLog {
  at: string;
  agent: "cto";
  intentId?: string;
  action: string;
  reason: string;
  before?: unknown;
  after?: unknown;
  resources?: string[];
}

export interface CompanyIntentManagerHealth {
  loop: {
    id: string;
    exists: boolean;
    state?: string;
    updatedAt?: string;
  };
  capability: {
    id: string;
    exists: boolean;
  };
}

export interface CompanyIntentRecord {
  id: string;
  path: string;
  intent: CompanyIntent;
  decisions: CompanyIntentDecisionLog[];
  managerHealth?: CompanyIntentManagerHealth;
}

export interface CompanyIntentInput {
  id?: string;
  for: string;
  description?: string;
  priority: number;
  posture: CompanyIntentPosture;
  scope: {
    repos: string[];
    areas: string[];
  };
  principles: string[];
  metrics: string[];
  policy: CompanyIntent["policy"];
  portfolio: CompanyIntent["portfolio"];
  manager: Pick<CompanyIntent["manager"], "reviewEvery">;
  status?: CompanyIntentStatus;
}

const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function isCompanyIntentId(value: string): boolean {
  return SLUG_RE.test(value);
}

export function slugifyCompanyIntentId(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug) return "";
  return /^[a-z]/.test(slug) ? slug : `i-${slug}`.slice(0, 64);
}

export function companyIntentPath(id: string): string {
  return `intents/${id}/intent.json`;
}

export function companyIntentDecisionsPath(id: string): string {
  return `intents/${id}/decisions.jsonl`;
}

export function buildCompanyIntent(
  input: CompanyIntentInput,
  now = new Date().toISOString(),
): CompanyIntent {
  const id = input.id?.trim() ?? "";
  if (!isCompanyIntentId(id)) {
    throw new Error("Invalid company intent id");
  }

  return normalizeCompanyIntent(companyIntentPath(id), {
    version: 1,
    id,
    status: input.status ?? "active",
    for: input.for,
    ...(input.description?.trim()
      ? { description: input.description.trim() }
      : {}),
    priority: input.priority,
    posture: input.posture,
    scope: input.scope,
    principles: input.principles,
    metrics: input.metrics,
    policy: input.policy,
    portfolio: input.portfolio,
    manager: {
      agent: "cto",
      loop: "agency-architect-loop",
      capability: "agency-architect",
      reviewEvery: input.manager.reviewEvery,
    },
    createdAt: now,
    updatedAt: now,
  });
}

export function normalizeCompanyIntent(
  path: string,
  value: unknown,
): CompanyIntent {
  const input = recordField(value);
  if (!input) {
    throw new Error(`Invalid company intent at ${path}: expected object`);
  }

  const id = stringField(input.id) || idFromPath(path);
  if (!isCompanyIntentId(id)) {
    throw new Error(`Invalid company intent id at ${path}`);
  }

  const now = new Date(0).toISOString();
  const createdAt = stringField(input.createdAt) || now;
  const updatedAt = stringField(input.updatedAt) || createdAt;
  const description = stringField(input.description);
  const policy = recordField(input.policy);

  return {
    version: 1,
    id,
    status: companyIntentStatus(input.status),
    for: stringField(input.for),
    ...(description ? { description } : {}),
    priority: numberField(input.priority, 100),
    posture: companyIntentPosture(input.posture),
    scope: normalizeScope(input.scope),
    principles: stringArray(input.principles),
    metrics: stringArray(input.metrics),
    policy: {
      release: normalizeReleasePolicy(policy?.release),
      automation: normalizeAutomationPolicy(policy?.automation),
    },
    portfolio: normalizePortfolio(input.portfolio),
    manager: normalizeManager(input.manager),
    createdAt,
    updatedAt,
  };
}

export const parseCompanyIntent = normalizeCompanyIntent;

export function parseCompanyIntentDecisionLog(
  content: string,
): CompanyIntentDecisionLog[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeDecisionLog(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((entry): entry is CompanyIntentDecisionLog => entry !== null);
}

export function sortCompanyIntentRecords(
  records: CompanyIntentRecord[],
): CompanyIntentRecord[] {
  return [...records].sort(
    (a, b) => a.intent.priority - b.intent.priority || a.id.localeCompare(b.id),
  );
}

export function companyIntentWarnings(
  intent: CompanyIntent,
  managerHealth?: CompanyIntentManagerHealth,
): string[] {
  const warnings: string[] = [];
  if (intent.metrics.length === 0) warnings.push("No metrics set");
  if (intent.scope.repos.length === 0 && intent.scope.areas.length === 0) {
    warnings.push("No scope set");
  }
  if (managerHealth && !managerHealth.loop.exists) {
    warnings.push("Manager loop missing");
  }
  if (managerHealth && !managerHealth.capability.exists) {
    warnings.push("Manager capability missing");
  }
  return warnings;
}

function idFromPath(path: string): string {
  const match = path.match(/(?:^|\/)intents\/([^/]+)\/intent\.json$/);
  return match?.[1] ?? "";
}

function normalizeScope(value: unknown): CompanyIntent["scope"] {
  const input = recordField(value);
  return {
    repos: stringArray(input?.repos),
    areas: stringArray(input?.areas),
  };
}

function normalizePortfolio(value: unknown): CompanyIntent["portfolio"] {
  const input = recordField(value);
  return {
    goals: stringArray(input?.goals).filter(isCompanyIntentId),
    loops: stringArray(input?.loops).filter(isCompanyIntentId),
    capabilities: stringArray(input?.capabilities).filter(isCompanyIntentId),
  };
}

function normalizeReleasePolicy(
  value: unknown,
): CompanyIntent["policy"]["release"] {
  const input = recordField(value);
  if (!input) return undefined;

  return {
    cadence: enumField(input.cadence, ["manual", "1d", "1w"]),
    qaDepth: enumField(input.qaDepth, ["light", "standard", "strict"]),
    blockerLevel: enumField(input.blockerLevel, ["low", "standard", "strict"]),
    approval: enumField(input.approval, [
      "none",
      "before-production",
      "before-risky-actions",
    ]),
  };
}

function normalizeAutomationPolicy(
  value: unknown,
): CompanyIntent["policy"]["automation"] {
  const input = recordField(value);
  return {
    authority: "full-auto",
    maxConcurrentGoals: numberField(input?.maxConcurrentGoals, 1),
    maxDailyActions: numberField(input?.maxDailyActions, 5),
    requiresHumanFor: stringArray(input?.requiresHumanFor),
  };
}

function normalizeManager(value: unknown): CompanyIntent["manager"] {
  const input = recordField(value);
  const lastReviewedAt = stringField(input?.lastReviewedAt);
  return {
    agent: "cto",
    loop: "agency-architect-loop",
    capability: "agency-architect",
    reviewEvery: enumField(input?.reviewEvery, ["1d", "1w"]) ?? "1d",
    ...(lastReviewedAt ? { lastReviewedAt } : {}),
  };
}

function normalizeDecisionLog(value: unknown): CompanyIntentDecisionLog | null {
  const input = recordField(value);
  if (!input) return null;

  const at = stringField(input.at);
  const action = stringField(input.action);
  const reason =
    stringField(input.reason) || stringField(input.message) || "No reason";
  if (!at || !action) return null;

  return {
    at,
    agent: "cto",
    ...(stringField(input.intentId)
      ? { intentId: stringField(input.intentId) }
      : {}),
    action,
    reason,
    before: input.before,
    after: input.after,
    resources: stringArray(input.resources),
  };
}

function companyIntentStatus(value: unknown): CompanyIntentStatus {
  return enumField(value, ["active", "paused", "archived"]) ?? "active";
}

function companyIntentPosture(value: unknown): CompanyIntentPosture {
  return (
    enumField(value, [
      "confidence",
      "speed",
      "stability-recovery",
      "maintenance",
      "balanced",
    ]) ?? "balanced"
  );
}

function enumField<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : undefined;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function recordField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
