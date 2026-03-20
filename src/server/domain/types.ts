export const JOB_MODES = ["standard", "fix", "hotfix"] as const;
export const JOB_STATUSES = [
  "queued",
  "modeling",
  "graphing",
  "executing",
  "evaluating",
  "approval_pending",
  "opening_pr",
  "failed",
  "needs_rerun",
  "completed"
] as const;
export const JOB_PHASES = [
  "task-modeling",
  "capability-boundary",
  "task-graphing",
  "agent-assignment",
  "execution",
  "evaluation",
  "risk-approval",
  "release-audit"
] as const;
export const AGENT_ROLES = [
  "orchestrator",
  "builder",
  "reviewer",
  "evaluator",
  "release-gatekeeper"
] as const;
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type JobMode = (typeof JOB_MODES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobPhase = (typeof JOB_PHASES)[number];
export type AgentRole = (typeof AGENT_ROLES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type AuditLevel = "info" | "warning" | "error";

export interface JobInput {
  repo: string;
  sha: string;
  workflowRunId: number;
  mode: JobMode;
}

export interface Job {
  id: string;
  dedupeKey: string;
  attempt: number;
  repo: string;
  sha: string;
  workflowRunId: number;
  mode: JobMode;
  status: JobStatus;
  currentPhase: JobPhase;
  currentAgent: AgentRole;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  summary?: string;
  branchName?: string;
  prUrl?: string;
  diffSummary?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FailureContext {
  workflowName: string;
  jobName: string;
  htmlUrl: string;
  failedStep: string;
  logExcerpt: string;
  rawLogsUrl?: string;
  defaultBranch?: string;
}

export interface RepositoryAccess {
  repo: string;
  cloneUrl: string;
  defaultBranch: string;
  source: "dry-run" | "github-app";
}

export interface CapabilityBoundary {
  allowedActions: string[];
  blockedActions: string[];
  approvalTriggers: string[];
  toolScopes: string[];
}

export interface TaskSpec {
  goal: string[];
  successCriteria: string[];
  constraints: string[];
  nonGoals: string[];
  externalDependencies: string[];
  unknowns: string[];
  failureContext?: FailureContext;
  capabilityBoundary: CapabilityBoundary;
}

export interface TaskGraphNode {
  id: string;
  title: string;
  description: string;
  assignedAgent?: AgentRole;
  inputs: string[];
  outputs: string[];
  doneDefinition: string[];
}

export interface TaskGraph {
  nodes: TaskGraphNode[];
  dependencies: Array<{ from: string; to: string; reason: string }>;
  parallelizable: string[];
  blockingConditions: string[];
}

export interface AgentAssignmentEntry {
  role: AgentRole;
  responsibility: string[];
  inputs: string[];
  outputs: string[];
  handoff: string[];
}

export interface AgentAssignment {
  entries: AgentAssignmentEntry[];
}

export interface RiskFlag {
  code: string;
  level: RiskLevel;
  description: string;
}

export interface DiffFile {
  path: string;
  changeType: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  summary: string;
}

export interface DiffCandidate {
  patch: string;
  rationale: string;
  files: DiffFile[];
  riskFlags: RiskFlag[];
}

export interface ApprovalGate {
  id: string;
  jobId: string;
  status: ApprovalStatus;
  actions: string[];
  reasons: string[];
  risks: string[];
  recommendation: string;
  followUp: string[];
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvalResult {
  automaticChecks: string[];
  manualChecks: string[];
  passCriteria: string[];
  failureHandling: string[];
  summary: string[];
}

export interface AuditEvent {
  id: string;
  jobId: string;
  level: AuditLevel;
  phase: JobPhase;
  createdAt: string;
  payload: {
    title: string;
    detail: string;
    meta?: Record<string, string | number | boolean | null>;
  };
}

export interface JobRecord {
  job: Job;
  taskSpec?: TaskSpec;
  taskGraph?: TaskGraph;
  agentAssignment?: AgentAssignment;
  diffCandidate?: DiffCandidate;
  approvalGate?: ApprovalGate;
  evalResult?: EvalResult;
  auditEvents: AuditEvent[];
}

export interface RepositoryStats {
  totalJobs: number;
  pendingApprovals: number;
  activeJobs: number;
}
