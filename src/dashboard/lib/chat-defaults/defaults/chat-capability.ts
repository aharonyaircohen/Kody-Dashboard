/**
 * kody-chat capability — the single contract that backs direct chat.
 * Carries the tool allowlist + skill list + glue text. Model-agnostic
 * (no `claudeCode.` prefix; the chat uses the user's chosen model).
 *
 * Tool names match the chat tool registry in `app/api/kody/chat/tools/`.
 * The list is the union of all tools the kody-direct route can wire —
 * per-request filtering (e.g. repo-only, actor-only, vibe-only) still
 * happens in the route; the bundle just declares what's possible.
 */

import type { ChatCapabilityEntry } from "./types";

export const DEFAULT_CHAT_CAPABILITY: ChatCapabilityEntry = {
  slug: "kody-chat",
  title: "kody-chat",
  describe:
    "In-process dashboard chat — research, planning, and creation flows wired against the connected repo.",
  tools: [
    // ── GitHub primitives (repo-gated) ─────────────────────────────────────
    // Names MUST match the registry in app/api/kody/chat/tools/*.ts. The
    // filterToolsByAllowlist call in the route drops any name in this list
    // that isn't in the registry's merged tools — phantom names here do
    // nothing, but phantom names in the agentIdentity mislead the model into
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
    "kody_run_issue",
    // ── Issue / task creation (actor-gated) ────────────────────────────────
    "report_bug",
    "create_feature",
    "create_enhancement",
    "create_refactor",
    "create_documentation",
    "create_chore",
    // ── Core chat output protocol
    "final_answer",
    // ── User-managed view renderers
    "show_view",
    // ── Kody admin (actor-gated) ───────────────────────────────────────────
    "switch_agent",
    "dashboard_navigate",
    "list_dashboard_features",
    "describe_feature",
    // ── CMS (repo-gated, schema-driven) ──────────────────────────────────
    "cms_list_collections",
    "cms_describe_collection",
    "cms_list_documents",
    "cms_get_document",
    "cms_mutate_document",
    // ── Capability admin (actor-gated) ─────────────────────────────────────
    "list_capabilities",
    "read_capability",
    "delete_capability",
    "run_capability",
    "read_capability_creation_guide",
    "create_or_update_capability",
    // ── Agent admin (actor-gated) ──────────────────────────────────────────
    "list_agents",
    "read_agent",
    "delete_agent",
    "dispatch_agent",
    "create_kody_agent",
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
    // ── Todos page (actor-gated, state repo todos/*.json) ──────────────────
    "list_todo_lists",
    "read_todo_list",
    "create_or_update_todo_list",
    "delete_todo_list",
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
    "remote_read",
    "remote_ls",
    // ── Browser + UI primitives ────────────────────────────────────────────
    "fetch_url",
  ],
  skills: [
    "diagnose-pr",
    "report-advise",
    "goal-planner",
    "create-issue",
    "create-capability",
    "create-agent",
    "vibe",
    "memory",
  ],
  prompt: `Kody chat — apply the agent identity, workflows, and skills below. The user connected a repo; treat its code as the source of truth and the tools allowlist as the only callables you may invoke.`,
};
