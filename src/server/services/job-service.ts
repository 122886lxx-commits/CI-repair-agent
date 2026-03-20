import type {
  ApprovalStatus,
  AuditLevel,
  JobInput,
  JobPhase,
  JobRecord
} from "@/server/domain/types";
import { createGithubService, type GithubService } from "@/server/github/service";
import { buildAgentAssignment, buildTaskGraph, buildTaskSpec } from "@/server/orchestrator/builders";
import { createModelProvider, type ModelProvider } from "@/server/openai/provider";
import { assessRisk } from "@/server/risk/engine";
import { createSandboxRunner, type SandboxRunner } from "@/server/sandbox/runner";
import { getRepository } from "@/server/db";
import type { JobRepository } from "@/server/db/repository";
import { createId } from "@/server/utils/ids";
import { logger } from "@/server/utils/logger";
import { nowIso } from "@/server/utils/time";

export class JobService {
  constructor(
    private readonly repository: JobRepository = getRepository(),
    private readonly githubService: GithubService = createGithubService(),
    private readonly modelProvider: ModelProvider = createModelProvider(),
    private readonly sandboxRunner: SandboxRunner = createSandboxRunner()
  ) {}

  async listJobs() {
    return this.repository.listJobs();
  }

  async getStats() {
    return this.repository.getStats();
  }

  async getJob(jobId: string) {
    return this.repository.getJob(jobId);
  }

  async createJob(input: JobInput) {
    return this.repository.createJob(input);
  }

  async rerunJob(jobId: string) {
    return this.repository.rerunJob(jobId);
  }

  async processNextJob() {
    const record = await this.repository.claimNextJob();
    if (!record) {
      return null;
    }

    await this.appendAudit(record.job.id, "task-modeling", "info", "Job claimed by orchestrator", {
      status: record.job.status
    });

    try {
      return await this.processJob(record.job.id);
    } catch (error) {
      logger.error({ error, jobId: record.job.id }, "Job processing failed");
      const failed = await this.repository.getJob(record.job.id);
      if (!failed) {
        throw error;
      }
      const nextJob = await this.repository.saveJob({
        ...failed.job,
        status: "failed",
        currentPhase: "release-audit",
        currentAgent: "orchestrator",
        summary: "Execution failed before completion",
        lastError: error instanceof Error ? error.message : String(error)
      });

      await this.appendAudit(nextJob.id, "release-audit", "error", "Job failed", {
        error: nextJob.lastError ?? "unknown"
      });

      return this.repository.getJob(nextJob.id);
    }
  }

  async approveJob(jobId: string, actor: string) {
    const record = await this.requireJob(jobId);
    if (!record.approvalGate) {
      throw new Error("No approval gate exists for this job.");
    }

    const approvalGate = {
      ...record.approvalGate,
      status: "approved" as ApprovalStatus,
      updatedBy: actor,
      updatedAt: nowIso()
    };

    await this.repository.saveApprovalGate(approvalGate);
    await this.appendAudit(jobId, "risk-approval", "info", "Approval gate approved", { actor });

    const pullRequest = await this.githubService.createPullRequest(
      record.job,
      record.diffCandidate!,
      record.taskSpec?.failureContext?.defaultBranch
    );
    const nextJob = await this.repository.saveJob({
      ...record.job,
      status: "completed",
      currentPhase: "release-audit",
      currentAgent: "release-gatekeeper",
      requiresApproval: false,
      branchName: pullRequest.branchName,
      prUrl: pullRequest.prUrl,
      summary: "Repair approved and draft pull request created."
    });

    await this.appendAudit(jobId, "release-audit", "info", "Draft pull request created after approval", {
      prUrl: pullRequest.prUrl
    });

    return this.repository.getJob(nextJob.id);
  }

  async rejectJob(jobId: string, actor: string, reason: string) {
    const record = await this.requireJob(jobId);
    if (!record.approvalGate) {
      throw new Error("No approval gate exists for this job.");
    }

    const approvalGate = {
      ...record.approvalGate,
      status: "rejected" as ApprovalStatus,
      updatedBy: actor,
      updatedAt: nowIso(),
      followUp: [...record.approvalGate.followUp, reason]
    };

    await this.repository.saveApprovalGate(approvalGate);
    const nextJob = await this.repository.saveJob({
      ...record.job,
      status: "completed",
      currentPhase: "release-audit",
      currentAgent: "release-gatekeeper",
      summary: "Repair was rejected at approval gate."
    });

    await this.appendAudit(jobId, "risk-approval", "warning", "Approval gate rejected", { actor, reason });
    return this.repository.getJob(nextJob.id);
  }

  private async processJob(jobId: string): Promise<JobRecord | null> {
    const record = await this.requireJob(jobId);
    const [failureContext, repositoryAccess] = await Promise.all([
      this.githubService.getFailureContext(record.job.repo, record.job.workflowRunId),
      this.githubService.getRepositoryAccess(record.job.repo)
    ]);

    const modelingJob = await this.repository.saveJob({
      ...record.job,
      status: "modeling",
      currentPhase: "task-modeling",
      currentAgent: "orchestrator",
      summary: "Building task specification from workflow context."
    });

    const goal = `Repair GitHub Actions workflow run ${modelingJob.workflowRunId} for ${modelingJob.repo}`;
    const taskSpec = buildTaskSpec(goal, modelingJob.mode, failureContext);
    await this.repository.saveTaskSpec(jobId, taskSpec);
    await this.appendAudit(jobId, "task-modeling", "info", "Task specification created", {
      workflow: failureContext.workflowName,
      failedStep: failureContext.failedStep
    });

    const graphingJob = await this.repository.saveJob({
      ...modelingJob,
      status: "graphing",
      currentPhase: "task-graphing",
      currentAgent: "orchestrator",
      summary: "Creating task graph and agent assignments."
    });

    await this.repository.saveTaskGraph(jobId, buildTaskGraph());
    await this.repository.saveAgentAssignment(jobId, buildAgentAssignment());
    await this.appendAudit(jobId, "task-graphing", "info", "Task graph and agent assignments persisted", {});

    const executingJob = await this.repository.saveJob({
      ...graphingJob,
      status: "executing",
      currentPhase: "execution",
      currentAgent: "builder",
      summary: "Generating patch proposal."
    });

    const proposal = await this.modelProvider.proposePatch(executingJob.repo, taskSpec, failureContext);
    const validation = await this.sandboxRunner.validate(
      executingJob,
      repositoryAccess,
      taskSpec,
      failureContext,
      proposal
    );
    const risk = assessRisk(validation.diffCandidate, executingJob.mode);

    await this.repository.saveDiffCandidate(jobId, {
      ...validation.diffCandidate,
      riskFlags: risk.flags
    });
    await this.repository.saveEvalResult(jobId, validation.evalResult);
    await this.appendAudit(jobId, "evaluation", "info", "Patch proposal validated", {
      riskLevel: risk.level,
      requiresApproval: String(risk.requiresApproval)
    });

    const evaluatingJob = await this.repository.saveJob({
      ...executingJob,
      status: "evaluating",
      currentPhase: "evaluation",
      currentAgent: "evaluator",
      riskLevel: risk.level,
      requiresApproval: risk.requiresApproval,
      diffSummary: validation.diffCandidate.rationale,
      summary: risk.requiresApproval
        ? "Validation complete; waiting for approval gate."
        : "Validation complete; opening draft pull request."
    });

    if (risk.requiresApproval) {
      const approvalGate = {
        id: createId(),
        jobId,
        status: "pending" as ApprovalStatus,
        actions: risk.flags.map((flag) => flag.description),
        reasons: ["Patch touches a protected or high-risk surface."],
        risks: risk.flags.map((flag) => `[${flag.level}] ${flag.description}`),
        recommendation: "Require human approval before opening a pull request.",
        followUp: ["Review diff and residual risk.", "Approve or reject with explicit reason."],
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await this.repository.saveApprovalGate(approvalGate);
      const gatedJob = await this.repository.saveJob({
        ...evaluatingJob,
        status: "approval_pending",
        currentPhase: "risk-approval",
        currentAgent: "release-gatekeeper"
      });

      await this.appendAudit(jobId, "risk-approval", "warning", "Job moved to approval gate", {
        riskLevel: risk.level
      });

      return this.repository.getJob(gatedJob.id);
    }

    const openingJob = await this.repository.saveJob({
      ...evaluatingJob,
      status: "opening_pr",
      currentPhase: "release-audit",
      currentAgent: "release-gatekeeper"
    });

    const pullRequest = await this.githubService.createPullRequest(
      openingJob,
      validation.diffCandidate,
      failureContext.defaultBranch ?? repositoryAccess.defaultBranch
    );
    const completedJob = await this.repository.saveJob({
      ...openingJob,
      status: "completed",
      currentPhase: "release-audit",
      currentAgent: "release-gatekeeper",
      branchName: pullRequest.branchName,
      prUrl: pullRequest.prUrl,
      summary: "Repair proposal created and draft pull request opened."
    });

    await this.appendAudit(jobId, "release-audit", "info", "Draft pull request opened", {
      prUrl: pullRequest.prUrl
    });

    return this.repository.getJob(completedJob.id);
  }

  private async requireJob(jobId: string) {
    const record = await this.repository.getJob(jobId);
    if (!record) {
      throw new Error(`Job ${jobId} not found`);
    }
    return record;
  }

  private async appendAudit(
    jobId: string,
    phase: JobPhase,
    level: AuditLevel,
    title: string,
    meta: Record<string, string> = {}
  ) {
    await this.repository.appendAuditEvent({
      id: createId(),
      jobId,
      phase,
      level,
      createdAt: nowIso(),
      payload: {
        title,
        detail: title,
        meta
      }
    });
  }
}
