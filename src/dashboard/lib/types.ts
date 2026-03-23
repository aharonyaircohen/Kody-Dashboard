/**
 * @fileType types
 * @domain kody
 * @pattern types
 * @ai-summary Core TypeScript types for Kody dashboard
 */

// ============ Pipeline Types ============

export type StageState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'skipped'
  | 'gate-waiting'
  | 'paused'

export interface StageStatus {
  state: StageState
  startedAt?: string
  completedAt?: string
  elapsed?: number
  retries: number
  outputFile?: string
  error?: string
}

export interface CheckRunResult {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | 'timed_out' | null
  output?: {
    summary: string
    text?: string
  }
  html_url?: string
}

/** A single entry in the pipeline actor audit trail */
export interface ActorEvent {
  /** Action type: pipeline-triggered, gate-approved, gate-rejected, etc. */
  action: string
  /** GitHub login of the person who performed the action */
  actor: string
  /** ISO timestamp */
  timestamp: string
  /** Stage name, if action is stage-specific */
  stage?: string
}

export interface KodyPipelineStatus {
  taskId: string
  mode: string
  pipeline: string
  startedAt: string
  updatedAt: string
  completedAt?: string
  totalElapsed?: number
  state: 'running' | 'completed' | 'failed' | 'timeout' | 'paused'
  currentStage: string | null
  stages: Record<string, StageStatus>
  triggeredBy: string
  issueNumber?: number
  runId?: string
  runUrl?: string
  controlMode?: 'auto' | 'risk-gated' | 'hard-stop'
  gatePoint?: string
  /** GitHub login of the person who triggered this pipeline run */
  triggeredByLogin?: string
  /** GitHub login of the person who created the issue (the "owner") */
  issueCreator?: string
  /** Audit trail of actor actions (capped at 50 entries) */
  actorHistory?: ActorEvent[]
}

// ============ Task Definition ============

export type TaskType =
  | 'spec_only'
  | 'implement_feature'
  | 'fix_bug'
  | 'refactor'
  | 'docs'
  | 'ops'
  | 'research'

export type RiskLevel = 'low' | 'medium' | 'high'

export type PrimaryDomain = 'backend' | 'frontend' | 'infra' | 'data' | 'llm' | 'devops' | 'product'

export interface MissingInput {
  field: string
  question: string
}

export interface TaskDefinition {
  task_type: TaskType
  pipeline: 'spec_only' | 'spec_execute_verify'
  risk_level: RiskLevel
  confidence: number
  primary_domain: PrimaryDomain
  scope: string[]
  missing_inputs: MissingInput[]
  assumptions: string[]
}

// ============ Comment Types ============

export type CommentType =
  | 'task-marker'
  | 'running-status'
  | 'success'
  | 'failure'
  | 'kody-failed'
  | 'timeout'
  | 'gate-request'
  | 'gate-approval'
  | 'gate-rejection'
  | 'clarify-stop'
  | 'supervisor-retry'
  | 'supervisor-exhausted'
  | 'supervisor-error'
  | 'vercel-preview'
  | 'unknown'

export interface StageProgress {
  stage: string
  state: StageState
  icon: string
}

export interface ParsedComment {
  type: CommentType
  taskId?: string
  createdAt: string
  body: string
  // type-specific fields
  error?: string
  retryNumber?: number
  maxRetries?: number
  stages?: StageProgress[]
  mode?: string
}

// ============ Kanban Types ============

export type ColumnId =
  | 'open'
  | 'building'
  | 'review'
  | 'failed'
  | 'gate-waiting'
  | 'retrying'
  | 'done'

export interface Board {
  id: string
  name: string
  type: 'label' | 'milestone' | 'all'
}

// ============ Task Data ============

export interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: Array<{ name: string; color: string }>
  milestone: { title: string } | null
  assignees: Array<{ login: string; avatar_url: string }>
  created_at: string
  updated_at: string
  closed_at: string | null
  html_url: string
  // Kody-specific fields
  isKodyAssigned?: boolean
  previewUrl?: string
}

export interface GitHubComment {
  id: number
  body: string
  created_at: string
  user: { login: string; type: string; avatar_url?: string }
}

export interface WorkflowRun {
  id: number
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  created_at: string
  updated_at: string
  html_url: string
  display_title?: string
  head_branch?: string
}

export interface GitHubPR {
  id: number
  number: number
  title: string
  state: string
  head: { ref: string; sha: string }
  merged_at: string | null
  html_url: string
  labels?: string[]
  ciStatus?: 'pending' | 'success' | 'failure' | 'running'
  mergeable?: boolean
}
export interface KodyTask {
  id: string // taskId
  issueNumber: number
  title: string
  body: string
  state: 'open' | 'closed'
  labels: string[]
  column: ColumnId
  createdAt: string
  updatedAt: string
  pipeline?: KodyPipelineStatus
  workflowRun?: WorkflowRun
  associatedPR?: GitHubPR | null
  taskDefinition?: TaskDefinition
  // Additional fields for UI
  assignees?: Array<{ login: string; avatar_url: string }>
  isKodyAssigned?: boolean
  previewUrl?: string
  // Substatus fields — progressively populated from list/detail API
  // List view: only isTimeout available from workflow run conclusion
  // Detail view: all fields populated from parsed comments
  gateType?: 'hard-stop' | 'risk-gated' // which gate type (only when column === 'gate-waiting')
  gateStage?: string // which stage gate paused at ('taskify' | 'architect')
  clarifyWaiting?: boolean // waiting for user to answer questions
  isTimeout?: boolean // pipeline timed out (vs regular failure)
  isExhausted?: boolean // retries exhausted (terminal failure)
  isSupervisorError?: boolean // infrastructure/supervisor error
}

// ============ Sort Types ============

export type SortField =
  | 'updatedAt'
  | 'createdAt'
  | 'issueNumber'
  | 'column'
  | 'riskLevel'
  | 'pipelineProgress'
  | 'assignee'
  | 'title'
  | 'label'
  | 'priority'

export type SortDirection = 'asc' | 'desc'

// ============ API Response Types ============

export interface TasksResponse {
  tasks: KodyTask[]
  columns: ColumnId[]
}

export interface BoardsResponse {
  boards: Board[]
}

export interface PipelineResponse {
  status: KodyPipelineStatus | null
  source: 'branch' | 'artifact' | 'comments' | null
}

export interface ActionResponse {
  success: boolean
  message: string
  data?: unknown
}

// ============ GitHub Action Types ============

export type GitHubAction =
  | 'approve'
  | 'reject'
  | 'rerun'
  | 'abort'
  | 'assign'
  | 'unassign'
  | 'close'
  | 'reopen'
  | 'add-label'
  | 'remove-label'
  | 'comment'

// ============ Collaborator Type ============

export interface GitHubCollaborator {
  login: string
  avatar_url: string
}

export interface CollaboratorsResponse {
  collaborators: GitHubCollaborator[]
}

// ============ Preview Tab Types ============

export interface PRComment {
  id: number
  body: string
  created_at: string
  user: { login: string; avatar_url: string }
  path?: string // File comment
  line?: number // Line comment
  side?: string // 'LEFT' or 'RIGHT' for diff comments
}

export interface FileChange {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed'
  additions: number
  deletions: number
}

export interface TaskDocument {
  name: string
  content: string
  path: string
}
