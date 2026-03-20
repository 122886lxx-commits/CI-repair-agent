import { Pool } from "pg";

import type {
  AgentAssignment,
  ApprovalGate,
  AuditEvent,
  DiffCandidate,
  EvalResult,
  Job,
  JobInput,
  JobRecord,
  RepositoryStats,
  TaskGraph,
  TaskSpec
} from "@/server/domain/types";
import { buildDedupeKey, createId } from "@/server/utils/ids";
import { nowIso } from "@/server/utils/time";

import type { JobRepository } from "./repository";

type Queryable = Pick<Pool, "query">;

export class PostgresJobRepository implements JobRepository {
  constructor(private readonly pool: Pool) {}

  async createJob(input: JobInput): Promise<JobRecord> {
    const dedupeKey = buildDedupeKey(input);
    const existing = await this.getJobByDedupeKey(dedupeKey);
    if (existing) {
      return existing;
    }

    const jobId = createId();
    await this.pool.query(
      `INSERT INTO jobs (
        id, dedupe_key, attempt, repo, sha, workflow_run_id, mode, status,
        current_phase, current_agent, risk_level, requires_approval
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        jobId,
        dedupeKey,
        1,
        input.repo,
        input.sha,
        input.workflowRunId,
        input.mode,
        "queued",
        "task-modeling",
        "orchestrator",
        "low",
        false
      ]
    );

    return this.mustGetJob(jobId);
  }

  async getJob(id: string): Promise<JobRecord | null> {
    const jobResult = await this.pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
    if (!jobResult.rowCount) {
      return null;
    }
    return this.loadRecordFromRow(jobResult.rows[0]);
  }

  async getJobByDedupeKey(dedupeKey: string): Promise<JobRecord | null> {
    const result = await this.pool.query(`SELECT * FROM jobs WHERE dedupe_key = $1`, [dedupeKey]);
    if (!result.rowCount) {
      return null;
    }
    return this.loadRecordFromRow(result.rows[0]);
  }

  async listJobs(): Promise<Job[]> {
    const result = await this.pool.query(`SELECT * FROM jobs ORDER BY updated_at DESC`);
    return result.rows.map((row: Record<string, unknown>) => this.mapJob(row));
  }

  async getStats(): Promise<RepositoryStats> {
    const result = await this.pool.query(`
      SELECT
        COUNT(*)::int AS total_jobs,
        COUNT(*) FILTER (WHERE status = 'approval_pending')::int AS pending_approvals,
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'failed'))::int AS active_jobs
      FROM jobs
    `);

    return {
      totalJobs: result.rows[0]?.total_jobs ?? 0,
      pendingApprovals: result.rows[0]?.pending_approvals ?? 0,
      activeJobs: result.rows[0]?.active_jobs ?? 0
    };
  }

  async saveJob(job: Job): Promise<Job> {
    const updatedAt = nowIso();
    await this.pool.query(
      `UPDATE jobs
       SET attempt = $2, repo = $3, sha = $4, workflow_run_id = $5, mode = $6, status = $7,
           current_phase = $8, current_agent = $9, risk_level = $10,
           requires_approval = $11, summary = $12, branch_name = $13,
           pr_url = $14, diff_summary = $15, last_error = $16, updated_at = $17
       WHERE id = $1`,
      [
        job.id,
        job.attempt,
        job.repo,
        job.sha,
        job.workflowRunId,
        job.mode,
        job.status,
        job.currentPhase,
        job.currentAgent,
        job.riskLevel,
        job.requiresApproval,
        job.summary ?? null,
        job.branchName ?? null,
        job.prUrl ?? null,
        job.diffSummary ?? null,
        job.lastError ?? null,
        updatedAt
      ]
    );

    return { ...job, updatedAt };
  }

  async claimNextJob(): Promise<JobRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT * FROM jobs
         WHERE status IN ('queued', 'needs_rerun')
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
      );

      if (!result.rowCount) {
        await client.query("COMMIT");
        return null;
      }

      const row = result.rows[0];
      await client.query(
        `UPDATE jobs
         SET status = 'modeling', current_phase = 'task-modeling', current_agent = 'orchestrator',
             last_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
      await client.query("COMMIT");
      return this.mustGetJob(row.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveTaskSpec(jobId: string, taskSpec: TaskSpec) {
    await this.upsertJsonPayload("task_specs", jobId, taskSpec);
  }

  async saveTaskGraph(jobId: string, taskGraph: TaskGraph) {
    await this.upsertJsonPayload("task_graphs", jobId, taskGraph);
  }

  async saveAgentAssignment(jobId: string, assignment: AgentAssignment) {
    await this.upsertJsonPayload("agent_assignments", jobId, assignment);
  }

  async saveDiffCandidate(jobId: string, diffCandidate: DiffCandidate) {
    await this.pool.query(
      `INSERT INTO diff_candidates (job_id, patch, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (job_id)
       DO UPDATE SET patch = EXCLUDED.patch, payload = EXCLUDED.payload`,
      [jobId, diffCandidate.patch, diffCandidate]
    );
  }

  async saveApprovalGate(gate: ApprovalGate) {
    await this.pool.query(
      `INSERT INTO approval_gates (id, job_id, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id)
       DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [gate.id, gate.jobId, gate.status, gate, gate.createdAt, gate.updatedAt]
    );
  }

  async saveEvalResult(jobId: string, evalResult: EvalResult) {
    await this.upsertJsonPayload("eval_results", jobId, evalResult);
  }

  async appendAuditEvent(event: AuditEvent) {
    await this.pool.query(
      `INSERT INTO audit_events (id, job_id, level, phase, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event.id, event.jobId, event.level, event.phase, event.payload, event.createdAt]
    );
  }

  async rerunJob(jobId: string): Promise<JobRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM task_specs WHERE job_id = $1`, [jobId]);
      await client.query(`DELETE FROM task_graphs WHERE job_id = $1`, [jobId]);
      await client.query(`DELETE FROM agent_assignments WHERE job_id = $1`, [jobId]);
      await client.query(`DELETE FROM diff_candidates WHERE job_id = $1`, [jobId]);
      await client.query(`DELETE FROM approval_gates WHERE job_id = $1`, [jobId]);
      await client.query(`DELETE FROM eval_results WHERE job_id = $1`, [jobId]);
      await client.query(
        `UPDATE jobs
         SET attempt = attempt + 1,
             status = 'needs_rerun',
             current_phase = 'task-modeling',
             current_agent = 'orchestrator',
             risk_level = 'low',
             requires_approval = FALSE,
             branch_name = NULL,
             pr_url = NULL,
             diff_summary = NULL,
             summary = 'Queued for rerun',
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [jobId]
      );
      await client.query("COMMIT");
      return this.getJob(jobId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertJsonPayload(table: string, jobId: string, payload: unknown) {
    await this.pool.query(
      `INSERT INTO ${table} (job_id, payload)
       VALUES ($1, $2)
       ON CONFLICT (job_id)
       DO UPDATE SET payload = EXCLUDED.payload`,
      [jobId, payload]
    );
  }

  private async loadRecordFromRow(row: Record<string, unknown>): Promise<JobRecord> {
    const job = this.mapJob(row);
    const [taskSpec, taskGraph, agentAssignment, diffCandidate, approvalGate, evalResult, auditEvents] =
      await Promise.all([
        this.selectPayload<TaskSpec>("task_specs", job.id),
        this.selectPayload<TaskGraph>("task_graphs", job.id),
        this.selectPayload<AgentAssignment>("agent_assignments", job.id),
        this.selectDiff(job.id),
        this.selectApproval(job.id),
        this.selectPayload<EvalResult>("eval_results", job.id),
        this.selectAuditEvents(job.id)
      ]);

    return {
      job,
      taskSpec: taskSpec ?? undefined,
      taskGraph: taskGraph ?? undefined,
      agentAssignment: agentAssignment ?? undefined,
      diffCandidate: diffCandidate ?? undefined,
      approvalGate: approvalGate ?? undefined,
      evalResult: evalResult ?? undefined,
      auditEvents
    };
  }

  private async mustGetJob(jobId: string) {
    const record = await this.getJob(jobId);
    if (!record) {
      throw new Error(`Missing job ${jobId}`);
    }
    return record;
  }

  private mapJob(row: Record<string, unknown>): Job {
    return {
      id: String(row.id),
      dedupeKey: String(row.dedupe_key),
      attempt: Number(row.attempt ?? 1),
      repo: String(row.repo),
      sha: String(row.sha),
      workflowRunId: Number(row.workflow_run_id),
      mode: row.mode as Job["mode"],
      status: row.status as Job["status"],
      currentPhase: row.current_phase as Job["currentPhase"],
      currentAgent: row.current_agent as Job["currentAgent"],
      riskLevel: row.risk_level as Job["riskLevel"],
      requiresApproval: Boolean(row.requires_approval),
      summary: row.summary ? String(row.summary) : undefined,
      branchName: row.branch_name ? String(row.branch_name) : undefined,
      prUrl: row.pr_url ? String(row.pr_url) : undefined,
      diffSummary: row.diff_summary ? String(row.diff_summary) : undefined,
      lastError: row.last_error ? String(row.last_error) : undefined,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString()
    };
  }

  private async selectPayload<T>(table: string, jobId: string): Promise<T | null> {
    const result = await this.pool.query(`SELECT payload FROM ${table} WHERE job_id = $1`, [jobId]);
    return (result.rows[0]?.payload as T | undefined) ?? null;
  }

  private async selectDiff(jobId: string): Promise<DiffCandidate | null> {
    const result = await this.pool.query(
      `SELECT patch, payload FROM diff_candidates WHERE job_id = $1`,
      [jobId]
    );
    if (!result.rowCount) {
      return null;
    }
    return {
      ...(result.rows[0].payload as Omit<DiffCandidate, "patch">),
      patch: result.rows[0].patch as string
    };
  }

  private async selectApproval(jobId: string): Promise<ApprovalGate | null> {
    const result = await this.pool.query(
      `SELECT payload FROM approval_gates WHERE job_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [jobId]
    );
    return (result.rows[0]?.payload as ApprovalGate | undefined) ?? null;
  }

  private async selectAuditEvents(jobId: string): Promise<AuditEvent[]> {
    const result = await this.pool.query(
      `SELECT id, job_id, level, phase, payload, created_at
       FROM audit_events
       WHERE job_id = $1
       ORDER BY created_at ASC`,
      [jobId]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      level: row.level as AuditEvent["level"],
      phase: row.phase as AuditEvent["phase"],
      payload: row.payload as AuditEvent["payload"],
      createdAt: new Date(String(row.created_at)).toISOString()
    }));
  }
}

export async function pingDatabase(client: Queryable) {
  await client.query("SELECT 1");
}
