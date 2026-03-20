import { getConfig } from "@/server/config";
import type {
  DiffCandidate,
  EvalResult,
  FailureContext,
  Job,
  RepositoryAccess,
  TaskSpec
} from "@/server/domain/types";
import {
  collectGitDiffSummary,
  prepareWorkspace,
  runValidationInDocker
} from "@/server/sandbox/workspace";

export interface SandboxRunner {
  validate(
    job: Job,
    repositoryAccess: RepositoryAccess,
    taskSpec: TaskSpec,
    failureContext: FailureContext,
    proposal: DiffCandidate
  ): Promise<{
    diffCandidate: DiffCandidate;
    evalResult: EvalResult;
  }>;
}

export function createSandboxRunner(): SandboxRunner {
  const config = getConfig();
  if (config.LIVE_SANDBOX) {
    return new DockerSandboxRunner(config.SANDBOX_IMAGE, config.SANDBOX_NETWORK_DISABLED);
  }
  return new DryRunSandboxRunner();
}

class DryRunSandboxRunner implements SandboxRunner {
  async validate(
    _job: Job,
    _repositoryAccess: RepositoryAccess,
    _taskSpec: TaskSpec,
    _failureContext: FailureContext,
    proposal: DiffCandidate
  ) {
    return {
      diffCandidate: proposal,
      evalResult: {
        automaticChecks: ["Skipped live container validation; dry-run sandbox in effect."],
        manualChecks: ["Review diff candidate before enabling live sandbox mode."],
        passCriteria: ["Patch targets the failing area and stays within the declared risk boundaries."],
        failureHandling: ["Escalate to approval if live validation is unavailable or patch scope expands."],
        summary: ["Dry-run validation completed; enable LIVE_SANDBOX for containerized execution."]
      }
    };
  }
}

class DockerSandboxRunner implements SandboxRunner {
  constructor(
    private readonly image: string,
    private readonly networkDisabled: boolean
  ) {}

  async validate(
    job: Job,
    repositoryAccess: RepositoryAccess,
    _taskSpec: TaskSpec,
    failureContext: FailureContext,
    proposal: DiffCandidate
  ) {
    const workspace = await prepareWorkspace({
      repositoryAccess,
      sha: job.sha,
      patch: proposal.patch
    });

    try {
      const result = await runValidationInDocker({
        image: this.image,
        workdir: workspace.dir,
        networkDisabled: this.networkDisabled,
        validationPlan: workspace.validationPlan
      });
      const diffSummary = await collectGitDiffSummary(workspace.dir);

      return {
        diffCandidate: {
          ...proposal,
          rationale: `${proposal.rationale} Validated against ${failureContext.failedStep}.`,
          files: proposal.files.map((file) => ({
            ...file,
            summary: diffSummary || file.summary
          }))
        },
        evalResult: {
          automaticChecks: [
            workspace.validationPlan.installCommand
              ? `Bootstrap: ${workspace.validationPlan.installCommand}`
              : "Bootstrap skipped",
            ...workspace.validationPlan.commands
          ],
          manualChecks: [
            "Review residual risk for repository-specific scripts or flaky jobs."
          ],
          passCriteria: [
            "Container validation commands exit with code 0.",
            "Patch remains scoped to the failing area."
          ],
          failureHandling: [
            "Keep task in rerun or approval-needed state if validation fails.",
            "Escalate to manual handling if repository bootstrap is unsupported."
          ],
          summary: [
            `Sandbox validation completed in ${this.image}.`,
            result.stdout.trim() || "Validation command completed without stdout."
          ]
        }
      };
    } finally {
      await workspace.cleanup();
    }
  }
}
