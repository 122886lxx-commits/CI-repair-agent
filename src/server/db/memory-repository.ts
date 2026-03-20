import {
  type AgentAssignment,
  type ApprovalGate,
  type AuditEvent,
  type DiffCandidate,
  type EvalResult,
  type Job,
  type JobInput,
  type JobRecord,
  type RepositoryStats,
  type TaskGraph,
  type TaskSpec
} from "@/server/domain/types";
import { buildDedupeKey, createId } from "@/server/utils/ids";
import { nowIso } from "@/server/utils/time";

import type { JobRepository } from "./repository";

export class MemoryJobRepository implements JobRepository {
  private jobs = new Map<string, Job>();
  private records = new Map<string, Omit<JobRecord, "job">>();

  async createJob(input: JobInput): Promise<JobRecord> {
    const dedupeKey = buildDedupeKey(input);
    const existing = await this.getJobByDedupeKey(dedupeKey);
    if (existing) {
      return existing;
    }

    const now = nowIso();
    const job: Job = {
      id: createId(),
      dedupeKey,
      attempt: 1,
      repo: input.repo,
      sha: input.sha,
      workflowRunId: input.workflowRunId,
      mode: input.mode,
      status: "queued",
      currentPhase: "task-modeling",
      currentAgent: "orchestrator",
      riskLevel: "low",
      requiresApproval: false,
      createdAt: now,
      updatedAt: now
    };

    this.jobs.set(job.id, job);
    this.records.set(job.id, { auditEvents: [] });
    return this.toRecord(job.id);
  }

  async getJob(id: string): Promise<JobRecord | null> {
    if (!this.jobs.has(id)) {
      return null;
    }
    return this.toRecord(id);
  }

  async getJobByDedupeKey(dedupeKey: string): Promise<JobRecord | null> {
    const job = [...this.jobs.values()].find((entry) => entry.dedupeKey === dedupeKey);
    if (!job) {
      return null;
    }
    return this.toRecord(job.id);
  }

  async listJobs(): Promise<Job[]> {
    return [...this.jobs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getStats(): Promise<RepositoryStats> {
    const jobs = await this.listJobs();
    return {
      totalJobs: jobs.length,
      pendingApprovals: jobs.filter((job) => job.status === "approval_pending").length,
      activeJobs: jobs.filter((job) => !["completed", "failed"].includes(job.status)).length
    };
  }

  async saveJob(job: Job): Promise<Job> {
    const nextJob = { ...job, updatedAt: nowIso() };
    this.jobs.set(job.id, nextJob);
    return nextJob;
  }

  async claimNextJob(): Promise<JobRecord | null> {
    const next = [...this.jobs.values()]
      .filter((job) => job.status === "queued" || job.status === "needs_rerun")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    if (!next) {
      return null;
    }

    await this.saveJob({
      ...next,
      status: "modeling",
      currentPhase: "task-modeling",
      currentAgent: "orchestrator",
      lastError: undefined
    });

    return this.toRecord(next.id);
  }

  async saveTaskSpec(jobId: string, taskSpec: TaskSpec) {
    this.patchRecord(jobId, { taskSpec });
  }

  async saveTaskGraph(jobId: string, taskGraph: TaskGraph) {
    this.patchRecord(jobId, { taskGraph });
  }

  async saveAgentAssignment(jobId: string, assignment: AgentAssignment) {
    this.patchRecord(jobId, { agentAssignment: assignment });
  }

  async saveDiffCandidate(jobId: string, diffCandidate: DiffCandidate) {
    this.patchRecord(jobId, { diffCandidate });
  }

  async saveApprovalGate(gate: ApprovalGate) {
    this.patchRecord(gate.jobId, { approvalGate: gate });
  }

  async saveEvalResult(jobId: string, evalResult: EvalResult) {
    this.patchRecord(jobId, { evalResult });
  }

  async appendAuditEvent(event: AuditEvent) {
    const record = this.records.get(event.jobId);
    if (!record) {
      return;
    }
    record.auditEvents = [...record.auditEvents, event].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  async rerunJob(jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    this.patchRecord(jobId, {
      taskSpec: undefined,
      taskGraph: undefined,
      agentAssignment: undefined,
      diffCandidate: undefined,
      approvalGate: undefined,
      evalResult: undefined
    });

    await this.saveJob({
      ...job,
      attempt: job.attempt + 1,
      status: "needs_rerun",
      currentPhase: "task-modeling",
      currentAgent: "orchestrator",
      riskLevel: "low",
      requiresApproval: false,
      branchName: undefined,
      prUrl: undefined,
      diffSummary: undefined,
      summary: "Queued for rerun",
      lastError: undefined
    });

    return this.toRecord(jobId);
  }

  private patchRecord(
    jobId: string,
    patch: Partial<Omit<JobRecord, "job" | "auditEvents">>
  ) {
    const current = this.records.get(jobId);
    if (!current) {
      throw new Error(`Missing record for job ${jobId}`);
    }
    this.records.set(jobId, { ...current, ...patch });
  }

  private toRecord(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    const record = this.records.get(jobId);
    if (!job || !record) {
      throw new Error(`Missing job record for ${jobId}`);
    }
    return {
      job,
      ...record
    };
  }
}
