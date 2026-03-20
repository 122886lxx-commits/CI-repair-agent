import { describe, expect, it } from "vitest";

import { MemoryJobRepository } from "@/server/db/memory-repository";
import type {
  ApprovalGate,
  DiffCandidate,
  FailureContext,
  Job,
  RepositoryAccess,
  TaskSpec
} from "@/server/domain/types";
import { buildRepairBranchName } from "@/server/github/service";
import type { GithubService } from "@/server/github/service";
import type { ModelProvider } from "@/server/openai/provider";
import type { SandboxRunner } from "@/server/sandbox/runner";
import { JobService } from "@/server/services/job-service";

function buildService(diff: DiffCandidate) {
  const repository = new MemoryJobRepository();

  const githubService: GithubService = {
    async getFailureContext(): Promise<FailureContext> {
      return {
        workflowName: "CI",
        jobName: "tests",
        htmlUrl: "https://github.com/acme/repo/actions/runs/1",
        failedStep: "npm run test",
        logExcerpt: "TypeError: expected string but received undefined",
        rawLogsUrl: "https://github.com/acme/repo/actions/runs/1/logs",
        defaultBranch: "main"
      };
    },
    async createPullRequest(job: Job) {
      return {
        branchName: `agent/${job.id}`,
        prUrl: `https://github.com/${job.repo}/pull/${job.id}`
      };
    },
    async getRepositoryAccess(repo: string): Promise<RepositoryAccess> {
      return {
        repo,
        cloneUrl: `https://github.com/${repo}.git`,
        defaultBranch: "main",
        source: "dry-run"
      };
    },
    async exchangeOAuthCode() {
      return {
        accessToken: "token",
        login: "tester",
        orgs: ["acme"]
      };
    }
  };

  const modelProvider: ModelProvider = {
    async proposePatch(_repo: string, _taskSpec: TaskSpec, _failureContext: FailureContext) {
      return diff;
    }
  };

  const sandboxRunner: SandboxRunner = {
    async validate(_job, _repositoryAccess, _taskSpec, _failureContext, proposal) {
      return {
        diffCandidate: proposal,
        evalResult: {
          automaticChecks: ["npm test"],
          manualChecks: [],
          passCriteria: ["all relevant checks pass"],
          failureHandling: ["rerun"],
          summary: ["validation complete"]
        }
      };
    }
  };

  return {
    repository,
    service: new JobService(repository, githubService, modelProvider, sandboxRunner)
  };
}

describe("JobService", () => {
  it("completes low-risk jobs by opening a pull request", async () => {
    const { service } = buildService({
      rationale: "add a null guard",
      patch: "diff --git a/src/index.ts b/src/index.ts",
      files: [
        {
          path: "src/index.ts",
          changeType: "modified",
          additions: 1,
          deletions: 1,
          summary: "Add null guard"
        }
      ],
      riskFlags: []
    });

    const created = await service.createJob({
      repo: "acme/repo",
      sha: "abc1234",
      workflowRunId: 42,
      mode: "fix"
    });
    const processed = await service.processNextJob();

    expect(created.job.id).toBe(processed?.job.id);
    expect(processed?.job.status).toBe("completed");
    expect(processed?.job.prUrl).toContain("github.com/acme/repo/pull");
  });

  it("holds high-risk jobs for approval", async () => {
    const { service } = buildService({
      rationale: "touch workflow",
      patch: "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
      files: [
        {
          path: ".github/workflows/ci.yml",
          changeType: "modified",
          additions: 3,
          deletions: 1,
          summary: "Change workflow"
        }
      ],
      riskFlags: []
    });

    await service.createJob({
      repo: "acme/repo",
      sha: "def5678",
      workflowRunId: 43,
      mode: "fix"
    });
    const processed = await service.processNextJob();

    expect(processed?.job.status).toBe("approval_pending");
    expect(processed?.approvalGate?.status).toBe("pending");
  });

  it("increments attempts and clears publish state on rerun", async () => {
    const repository = new MemoryJobRepository();
    const created = await repository.createJob({
      repo: "acme/repo",
      sha: "feed1234",
      workflowRunId: 99,
      mode: "fix"
    });

    await repository.saveDiffCandidate(created.job.id, {
      rationale: "add a null guard",
      patch: "diff --git a/src/index.ts b/src/index.ts",
      files: [
        {
          path: "src/index.ts",
          changeType: "modified",
          additions: 1,
          deletions: 1,
          summary: "Add null guard"
        }
      ],
      riskFlags: []
    });

    const approvalGate: ApprovalGate = {
      id: "gate-1",
      jobId: created.job.id,
      status: "pending",
      actions: ["Open a draft pull request"],
      reasons: ["Review required"],
      risks: ["Potential regression"],
      recommendation: "Approve after review",
      followUp: ["Check the diff"],
      createdAt: created.job.createdAt,
      updatedAt: created.job.updatedAt
    };
    await repository.saveApprovalGate(approvalGate);

    const completed = await repository.saveJob({
      ...created.job,
      status: "completed",
      branchName: buildRepairBranchName(created.job),
      prUrl: "https://github.com/acme/repo/pull/1",
      diffSummary: "Generated repair patch",
      riskLevel: "high",
      requiresApproval: true,
      summary: "Repair proposal created"
    });

    const rerun = await repository.rerunJob(created.job.id);

    expect(rerun?.job.attempt).toBe(2);
    expect(buildRepairBranchName(completed)).toBe("agent/repair-" + created.job.id.slice(0, 8) + "-a1");
    expect(buildRepairBranchName(rerun!.job)).toBe("agent/repair-" + created.job.id.slice(0, 8) + "-a2");
    expect(rerun?.job.branchName).toBeUndefined();
    expect(rerun?.job.prUrl).toBeUndefined();
    expect(rerun?.job.diffSummary).toBeUndefined();
    expect(rerun?.job.requiresApproval).toBe(false);
    expect(rerun?.job.riskLevel).toBe("low");
    expect(rerun?.approvalGate).toBeUndefined();
    expect(rerun?.diffCandidate).toBeUndefined();
  });
});
