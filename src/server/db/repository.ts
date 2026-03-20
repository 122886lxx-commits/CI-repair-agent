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

export interface JobRepository {
  createJob(input: JobInput): Promise<JobRecord>;
  getJob(id: string): Promise<JobRecord | null>;
  getJobByDedupeKey(dedupeKey: string): Promise<JobRecord | null>;
  listJobs(): Promise<Job[]>;
  getStats(): Promise<RepositoryStats>;
  saveJob(job: Job): Promise<Job>;
  claimNextJob(): Promise<JobRecord | null>;
  saveTaskSpec(jobId: string, taskSpec: TaskSpec): Promise<void>;
  saveTaskGraph(jobId: string, taskGraph: TaskGraph): Promise<void>;
  saveAgentAssignment(jobId: string, assignment: AgentAssignment): Promise<void>;
  saveDiffCandidate(jobId: string, diffCandidate: DiffCandidate): Promise<void>;
  saveApprovalGate(gate: ApprovalGate): Promise<void>;
  saveEvalResult(jobId: string, evalResult: EvalResult): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<void>;
  rerunJob(jobId: string): Promise<JobRecord | null>;
}
