import type {
  AgentAssignment,
  FailureContext,
  JobMode,
  TaskGraph,
  TaskSpec
} from "@/server/domain/types";

export function buildTaskSpec(goal: string, mode: JobMode, failureContext: FailureContext): TaskSpec {
  return {
    goal: [goal],
    successCriteria: [
      "Diagnose the failing GitHub Actions run.",
      "Produce a bounded repair diff.",
      "Trigger approval before any high-risk action.",
      "Leave a complete audit trail."
    ],
    constraints: [
      "Do not push to the protected default branch.",
      "Do not auto-merge any pull request.",
      "Keep fixes scoped to the observed CI failure."
    ],
    nonGoals: [
      "Do not redesign unrelated modules.",
      "Do not change deployment infrastructure unless explicitly required.",
      `Do not exceed the semantics of ${mode} mode.`
    ],
    externalDependencies: [
      "GitHub Actions workflow metadata",
      "Repository read access",
      "Model provider for repair reasoning",
      "Container sandbox for validation"
    ],
    unknowns: [
      "Whether the failure is flaky or deterministic.",
      "Whether the repository requires custom bootstrap commands."
    ],
    failureContext,
    capabilityBoundary: {
      allowedActions: [
        "Read workflow metadata",
        "Generate and inspect candidate patches",
        "Run validation in isolated sandbox",
        "Create a draft pull request for approved repairs"
      ],
      blockedActions: [
        "Push directly to the default branch",
        "Auto-merge pull requests",
        "Bypass approval for infrastructure or auth changes"
      ],
      approvalTriggers: [
        "Workflow or infrastructure file modifications",
        "Permission or authentication changes",
        "Database or destructive changes",
        "High-cost external calls"
      ],
      toolScopes: [
        "GitHub Actions read access",
        "Repository contents read/write via branch PR flow",
        "OpenAI repair planning"
      ]
    }
  };
}

export function buildTaskGraph(): TaskGraph {
  return {
    nodes: [
      {
        id: "collect-failure-context",
        title: "Collect failure context",
        description: "Gather workflow metadata, failing step details, and log excerpt.",
        assignedAgent: "orchestrator",
        inputs: ["workflow_run_id"],
        outputs: ["FailureContext"],
        doneDefinition: ["Failure context is persisted with failed step and log excerpt."]
      },
      {
        id: "generate-repair-patch",
        title: "Generate repair patch",
        description: "Builder proposes a bounded patch and summary.",
        assignedAgent: "builder",
        inputs: ["TaskSpec", "FailureContext"],
        outputs: ["DiffCandidate"],
        doneDefinition: ["Candidate patch exists with file list and rationale."]
      },
      {
        id: "review-risk",
        title: "Review risk",
        description: "Reviewer applies policy heuristics and marks approval requirements.",
        assignedAgent: "reviewer",
        inputs: ["DiffCandidate"],
        outputs: ["RiskAssessment"],
        doneDefinition: ["Risk flags and approval requirement are persisted."]
      },
      {
        id: "validate-in-sandbox",
        title: "Validate in sandbox",
        description: "Evaluator runs automated checks or dry-run validation.",
        assignedAgent: "evaluator",
        inputs: ["DiffCandidate", "FailureContext"],
        outputs: ["EvalResult"],
        doneDefinition: ["Validation summary and next action are recorded."]
      },
      {
        id: "release-gate",
        title: "Release gate",
        description: "Release Gatekeeper either opens PR or routes to approval.",
        assignedAgent: "release-gatekeeper",
        inputs: ["RiskAssessment", "EvalResult"],
        outputs: ["ApprovalGate or PullRequestResult"],
        doneDefinition: ["System enters approval_pending or completes PR creation."]
      }
    ],
    dependencies: [
      { from: "collect-failure-context", to: "generate-repair-patch", reason: "Need logs before patching." },
      { from: "generate-repair-patch", to: "review-risk", reason: "Need a concrete diff to assess risk." },
      { from: "generate-repair-patch", to: "validate-in-sandbox", reason: "Need a patch before validation." },
      { from: "review-risk", to: "release-gate", reason: "Approval state depends on risk." },
      { from: "validate-in-sandbox", to: "release-gate", reason: "Release gate depends on validation status." }
    ],
    parallelizable: ["review-risk", "validate-in-sandbox"],
    blockingConditions: [
      "Missing workflow context",
      "Patch touches protected files without approval",
      "Validation cannot complete and no safe downgrade path exists"
    ]
  };
}

export function buildAgentAssignment(): AgentAssignment {
  return {
    entries: [
      {
        role: "orchestrator",
        responsibility: ["Own job state", "Create task graph", "Advance phases and audit events"],
        inputs: ["JobInput", "FailureContext"],
        outputs: ["TaskSpec", "TaskGraph"],
        handoff: ["Pass task spec to builder", "Pass job state to release gatekeeper"]
      },
      {
        role: "builder",
        responsibility: ["Propose bounded patch", "Keep patch aligned with failing step"],
        inputs: ["TaskSpec", "FailureContext"],
        outputs: ["DiffCandidate"],
        handoff: ["Pass diff to reviewer and evaluator"]
      },
      {
        role: "reviewer",
        responsibility: ["Mark risky surfaces", "Escalate protected changes"],
        inputs: ["DiffCandidate"],
        outputs: ["RiskAssessment"],
        handoff: ["Pass risk level to release gatekeeper"]
      },
      {
        role: "evaluator",
        responsibility: ["Run sandbox validation", "Summarize residual risk"],
        inputs: ["DiffCandidate", "FailureContext"],
        outputs: ["EvalResult"],
        handoff: ["Pass validation outcome to release gatekeeper"]
      },
      {
        role: "release-gatekeeper",
        responsibility: ["Open PR or hold for approval", "Close audit trail"],
        inputs: ["RiskAssessment", "EvalResult"],
        outputs: ["ApprovalGate", "AuditEvent", "PullRequestResult"],
        handoff: ["Return final state to orchestrator"]
      }
    ]
  };
}
