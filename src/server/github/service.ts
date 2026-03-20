import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

import { getConfig } from "@/server/config";
import type { DiffCandidate, FailureContext, Job, RepositoryAccess } from "@/server/domain/types";
import { pushPatchBranch } from "@/server/github/git-ops";
import { logger } from "@/server/utils/logger";

interface PullRequestResult {
  branchName: string;
  prUrl: string;
}

export interface GithubService {
  getFailureContext(repo: string, workflowRunId: number): Promise<FailureContext>;
  getRepositoryAccess(repo: string): Promise<RepositoryAccess>;
  createPullRequest(job: Job, diff: DiffCandidate, baseRef?: string): Promise<PullRequestResult>;
  exchangeOAuthCode(code: string): Promise<{ accessToken: string; login: string; orgs: string[] }>;
}

export function createGithubService(): GithubService {
  const config = getConfig();
  if (config.GITHUB_APP_ID && config.GITHUB_PRIVATE_KEY) {
    return new GithubAppService();
  }
  return new DryRunGithubService();
}

class DryRunGithubService implements GithubService {
  async getFailureContext(repo: string, workflowRunId: number): Promise<FailureContext> {
    return {
      workflowName: "CI",
      jobName: "test-and-lint",
      htmlUrl: `https://github.com/${repo}/actions/runs/${workflowRunId}`,
      failedStep: "npm run test",
      logExcerpt:
        "Example failure: TypeError in packages/web/src/__tests__/smoke.test.ts caused by missing null guard.",
      rawLogsUrl: `https://github.com/${repo}/actions/runs/${workflowRunId}/logs`,
      defaultBranch: "main"
    };
  }

  async createPullRequest(job: Job, diff: DiffCandidate): Promise<PullRequestResult> {
    const branchName = buildRepairBranchName(job);
    return {
      branchName,
      prUrl: `https://github.com/${job.repo}/pull/mock-${job.id.slice(0, 8)}`
    };
  }

  async getRepositoryAccess(repo: string): Promise<RepositoryAccess> {
    return {
      repo,
      cloneUrl: `https://github.com/${repo}.git`,
      defaultBranch: "main",
      source: "dry-run"
    };
  }

  async exchangeOAuthCode() {
    return {
      accessToken: "dry-run-token",
      login: "local-operator",
      orgs: ["local-dev"]
    };
  }
}

class GithubAppService implements GithubService {
  private readonly config = getConfig();
  private readonly app = new App({
    appId: this.config.GITHUB_APP_ID!,
    privateKey: this.config.GITHUB_PRIVATE_KEY!.replace(/\\n/g, "\n")
  });

  async getFailureContext(repo: string, workflowRunId: number): Promise<FailureContext> {
    const { octokit } = await this.getRepoContext(repo);
    const [owner, name] = splitRepo(repo);
    const run = await octokit.actions.getWorkflowRun({
      owner,
      repo: name,
      run_id: workflowRunId
    });
    const jobs = await octokit.actions.listJobsForWorkflowRun({
      owner,
      repo: name,
      run_id: workflowRunId
    });
    const failedJob = jobs.data.jobs.find((job: { conclusion: string | null }) => job.conclusion === "failure") ??
      jobs.data.jobs[0];
    const failedStep =
      failedJob?.steps?.find((step: { conclusion: string | null; name: string }) => step.conclusion === "failure")
        ?.name ??
      failedJob?.steps?.at(-1)?.name ??
      "workflow failure";

    return {
      workflowName: run.data.name ?? "workflow",
      jobName: failedJob?.name ?? "job",
      htmlUrl: run.data.html_url,
      failedStep,
      logExcerpt: "Logs are available through GitHub Actions API and should be fetched during sandbox execution.",
      rawLogsUrl: run.data.logs_url,
      defaultBranch: run.data.head_branch || run.data.repository.default_branch
    };
  }

  async getRepositoryAccess(repo: string): Promise<RepositoryAccess> {
    const { octokit, token } = await this.getRepoContext(repo);
    const [owner, name] = splitRepo(repo);
    const repoResponse = await octokit.repos.get({
      owner,
      repo: name
    });

    return {
      repo,
      cloneUrl: `https://x-access-token:${token}@github.com/${repo}.git`,
      defaultBranch: repoResponse.data.default_branch,
      source: "github-app"
    };
  }

  async createPullRequest(job: Job, diff: DiffCandidate, baseRef?: string): Promise<PullRequestResult> {
    const { octokit } = await this.getRepoContext(job.repo);
    const repoAccess = await this.getRepositoryAccess(job.repo);
    const [owner, name] = splitRepo(job.repo);
    const branchName = buildRepairBranchName(job);

    await pushPatchBranch({
      repositoryAccess: repoAccess,
      sha: job.sha,
      patch: diff.patch,
      branchName,
      commitMessage: `ci: repair workflow run ${job.workflowRunId}`
    });

    const pull = await octokit.pulls.create({
      owner,
      repo: name,
      title: `CI repair for workflow run ${job.workflowRunId}`,
      head: branchName,
      base: baseRef ?? repoAccess.defaultBranch,
      body: [
        "Automated CI repair proposal.",
        "",
        "This PR was created by the CI Repair Agent control plane.",
        "",
        "```diff",
        diff.patch.slice(0, 20000),
        "```"
      ].join("\n"),
      draft: true
    });

    return {
      branchName,
      prUrl: pull.data.html_url
    };
  }

  async exchangeOAuthCode(code: string) {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: this.config.GITHUB_OAUTH_CLIENT_ID,
        client_secret: this.config.GITHUB_OAUTH_CLIENT_SECRET,
        code
      })
    });

    const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenPayload.access_token) {
      throw new Error("GitHub OAuth exchange failed");
    }

    const oauthClient = new Octokit({ auth: tokenPayload.access_token });
    const [{ data: user }, { data: orgs }] = await Promise.all([
      oauthClient.users.getAuthenticated(),
      oauthClient.orgs.listForAuthenticatedUser()
    ]);

    return {
      accessToken: tokenPayload.access_token,
      login: user.login,
      orgs: orgs.map((org) => org.login)
    };
  }

  private async getRepoContext(repo: string): Promise<{ octokit: any; token: string }> {
    const [owner, name] = splitRepo(repo);
    const installation = await this.app.octokit.request("GET /repos/{owner}/{repo}/installation", {
      owner,
      repo: name
    });

    logger.debug({ repo, installationId: installation.data.id }, "Using GitHub App installation");
    const octokit = await this.app.getInstallationOctokit(installation.data.id);
    const auth = (await octokit.auth({ type: "installation" } as any)) as { token: string };
    return {
      octokit,
      token: auth.token
    };
  }
}

function splitRepo(repo: string) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo slug: ${repo}`);
  }
  return [owner, name] as const;
}

export function buildRepairBranchName(job: Job) {
  return `agent/repair-${job.id.slice(0, 8)}-a${job.attempt}`;
}
