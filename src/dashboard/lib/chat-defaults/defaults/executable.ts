/**
 * kody-chat executable — the single impl that backs the kody-direct chat.
 * Carries the tool allowlist + skill list + glue text. Model-agnostic
 * (no `claudeCode.` prefix; the chat uses the user's chosen model).
 *
 * Tool names match the chat tool registry in `app/api/kody/chat/tools/`.
 * The list is the union of all tools the kody-direct route can wire —
 * per-request filtering (e.g. repo-only, actor-only, vibe-only) still
 * happens in the route; the bundle just declares what's possible.
 */

import type { ExecutableEntry } from "./types";

export const DEFAULT_EXECUTABLE: ExecutableEntry = {
  slug: "kody-chat",
  title: "kody-chat",
  describe:
    "In-process dashboard chat — research, planning, and creation flows wired against the connected repo.",
  tools: [
    // ── GitHub primitives (repo-gated) ─────────────────────────────────────
    // Names MUST match the registry in app/api/kody/chat/tools/*.ts. The
    // filterToolsByAllowlist call in the route drops any name in this list
    // that isn't in the registry's merged tools — phantom names here do
    // nothing, but phantom names in the persona mislead the model into
    // calling tools that don't exist, which is how the chat ends up
    // "hallucinating" file contents.
    "github_get_issue",
    "github_get_pull_request",
    "github_list_issues",
    "github_search_code",
    "github_get_file",
    "github_list_tree",
    "github_blame",
    "github_commits_for_path",
    "github_comment_on_issue",
    "github_close_issue",
    "merge_pr",
    // ── Pipeline / workflow status (repo-gated) ───────────────────────────
    "kody_get_pipeline_status",
    "kody_list_workflow_runs",
    "kody_list_open_prs",
    // ── Vibe ───────────────────────────────────────────────────────────────
    "vibe_start_execution",
    // ── Kody pipeline dispatch (actor-gated, user invokes with @kody) ─────
    "kody_run_issue",
    "kody_fix_pr",
    "kody_fix_ci_pr",
    "kody_review_pr",
    "kody_resolve_pr",
    "kody_revert_pr",
    "kody_sync_pr",
    "request_release",
    // ── Issue / task creation (actor-gated) ────────────────────────────────
    "report_bug",
    "create_feature",
    "create_enhancement",
    "create_refactor",
    "create_documentation",
    "create_chore",
    // ── Kody admin (actor-gated) ───────────────────────────────────────────
    "switch_agent",
    "list_dashboard_features",
    "describe_feature",
    // ── Duty admin (actor-gated) ───────────────────────────────────────────
    "list_duties",
    "read_duty",
    "delete_duty",
    "run_duty",
    "read_duty_creation_guide",
    "create_or_update_kody_duty",
    // ── Staff admin (actor-gated) ──────────────────────────────────────────
    "list_staff",
    "read_staff",
    "delete_staff",
    "dispatch_staff",
    "create_kody_staff",
    // ── Executable admin (actor-gated) ─────────────────────────────────────
    "list_executables",
    "read_executable",
    "delete_executable",
    "read_executable_creation_guide",
    "create_or_update_executable",
    // ── Command admin (actor-gated) ────────────────────────────────────────
    "list_commands",
    "read_command",
    "create_or_update_command",
    "delete_command",
    // ── Context admin (actor-gated) ────────────────────────────────────────
    "list_context",
    "read_context",
    "create_or_update_context",
    "delete_context",
    // ── Instructions (actor-gated) ─────────────────────────────────────────
    "read_instructions",
    "set_instructions",
    "delete_instructions",
    // ── Variables (actor-gated) ────────────────────────────────────────────
    "list_variables",
    "set_variable",
    "delete_variable",
    // ── Secrets (actor-gated) ──────────────────────────────────────────────
    "list_secret_names",
    // ── Models (actor-gated) ───────────────────────────────────────────────
    "list_models",
    "set_default_model",
    "set_model_enabled",
    // ── Macros (actor-gated) ───────────────────────────────────────────────
    "list_macros",
    "read_macro",
    "rename_macro",
    "delete_macro",
    // ── Inbox (actor-gated) ────────────────────────────────────────────────
    "list_inbox",
    // ── Company bundle (actor-gated) ───────────────────────────────────────
    "read_operators",
    "set_operators",
    "export_company",
    "import_company",
    // ── Webhooks (actor-gated) ─────────────────────────────────────────────
    "register_webhook",
    // ── Notifications (actor-gated) ────────────────────────────────────────
    "list_notification_rules",
    "create_notification_rule",
    "delete_notification_rule",
    // ── Reports (repo-gated) ───────────────────────────────────────────────
    "list_reports",
    "read_report",
    // ── Goals (repo-gated) ─────────────────────────────────────────────────
    "get_goal",
    "list_goals",
    "attach_task_to_goal",
    "detach_task_from_goal",
    "create_task_for_goal",
    // ── Memory (repo-gated) ────────────────────────────────────────────────
    "remember",
    "recall",
    "recall_search",
    "list_memories",
    "update_memory",
    "forget",
    // ── Preview interaction ───────────────────────────────────────────────
    "preview_act",
    // ── Remote dev (only when remote is configured) ────────────────────────
    "remote_exec",
    "remote_read",
    "remote_write",
    "remote_ls",
    // ── Browser + UI primitives ────────────────────────────────────────────
    "fetch_url",
  ],
  skills: [
    "diagnose-pr",
    "report-advise",
    "goal-planner",
    "create-issue",
    "create-duty",
    "create-staff",
    "vibe",
    "memory",
  ],
  prompt: `Kody chat — apply the persona, workflows, and skills below. The user connected a repo; treat its code as the source of truth and the tools allowlist as the only callables you may invoke.`,
};
