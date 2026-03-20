import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { getConfig } from "@/server/config";
import type { RepositoryAccess } from "@/server/domain/types";

const execFileAsync = promisify(execFile);

type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export interface ValidationPlan {
  packageManager: PackageManager;
  installCommand: string | null;
  commands: string[];
}

export interface PreparedWorkspace {
  dir: string;
  validationPlan: ValidationPlan;
  cleanup: () => Promise<void>;
}

export async function prepareWorkspace(options: {
  repositoryAccess: RepositoryAccess;
  sha: string;
  patch: string;
}): Promise<PreparedWorkspace> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ci-repair-agent-"));
  try {
    await cloneRepository(options.repositoryAccess, dir);
    await checkoutRef(dir, options.sha);
    await applyPatch(dir, options.patch);
    const validationPlan = await inferValidationPlan(dir);

    return {
      dir,
      validationPlan,
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function applyPatch(dir: string, patch: string) {
  const patchFile = path.join(dir, ".ci-repair.patch");
  await writeFile(patchFile, patch, "utf8");

  try {
    await execGit(["apply", "--3way", "--whitespace=nowarn", patchFile], dir);
  } catch {
    await execGit(["apply", "--whitespace=nowarn", patchFile], dir);
  }
}

export async function createCommitFromPatch(options: {
  repositoryAccess: RepositoryAccess;
  sha: string;
  patch: string;
  branchName: string;
  commitMessage: string;
}) {
  const config = getConfig();
  const workspace = await prepareWorkspace({
    repositoryAccess: options.repositoryAccess,
    sha: options.sha,
    patch: options.patch
  });

  try {
    await execGit(["checkout", "-b", options.branchName], workspace.dir);
    await execGit(["config", "user.name", config.GIT_AUTHOR_NAME], workspace.dir);
    await execGit(["config", "user.email", config.GIT_AUTHOR_EMAIL], workspace.dir);
    await execGit(["add", "-A"], workspace.dir);

    const status = await execGit(["status", "--short"], workspace.dir);
    if (!status.stdout.trim()) {
      throw new Error("Patch produced no file changes; refusing to create an empty commit.");
    }

    await execGit(["commit", "-m", options.commitMessage], workspace.dir);
    await execGit(["push", "-u", "origin", options.branchName], workspace.dir);
  } finally {
    await workspace.cleanup();
  }
}

export async function inferValidationPlan(dir: string): Promise<ValidationPlan> {
  const packageManager = await detectPackageManager(dir);
  const packageJson = await readPackageJson(dir);
  const scripts = packageJson?.scripts ?? {};

  if (scripts["ci:repair:validate"]) {
    return {
      packageManager,
      installCommand: inferInstallCommand(packageManager, packageJson !== null),
      commands: [runScriptCommand(packageManager, "ci:repair:validate")]
    };
  }

  if (scripts.validate) {
    return {
      packageManager,
      installCommand: inferInstallCommand(packageManager, packageJson !== null),
      commands: [runScriptCommand(packageManager, "validate")]
    };
  }

  const scriptOrder = ["typecheck", "lint", "test", "test:ci", "build"];
  const commands = scriptOrder
    .filter((scriptName) => typeof scripts[scriptName] === "string")
    .map((scriptName) => runScriptCommand(packageManager, scriptName));

  return {
    packageManager,
    installCommand: inferInstallCommand(packageManager, packageJson !== null),
    commands
  };
}

export async function runValidationInDocker(options: {
  image: string;
  workdir: string;
  networkDisabled: boolean;
  validationPlan: ValidationPlan;
}) {
  const outputs: string[] = [];

  if (options.validationPlan.installCommand) {
    const installResult = await execDockerCommand({
      image: options.image,
      workdir: options.workdir,
      networkDisabled: false,
      command: ["set -euo pipefail", options.validationPlan.installCommand].join(" && ")
    });
    outputs.push(installResult.stdout.trim());
  }

  const validationCommand = buildValidationCommand(options.validationPlan);
  const validationResult = await execDockerCommand({
    image: options.image,
    workdir: options.workdir,
    networkDisabled: options.networkDisabled,
    command: validationCommand
  });
  outputs.push(validationResult.stdout.trim());

  return {
    stdout: outputs.filter(Boolean).join("\n"),
    stderr: validationResult.stderr
  };
}

export async function collectGitDiffSummary(dir: string) {
  const diffStat = await execGit(["diff", "--stat"], dir);
  return diffStat.stdout.trim();
}

async function cloneRepository(repositoryAccess: RepositoryAccess, dir: string) {
  await execGit(["clone", "--depth", "1", repositoryAccess.cloneUrl, dir], process.cwd());
}

async function checkoutRef(dir: string, sha: string) {
  await execGit(["fetch", "--depth", "1", "origin", sha], dir);
  await execGit(["checkout", "--detach", sha], dir);
}

async function detectPackageManager(dir: string): Promise<PackageManager> {
  const candidates: Array<[PackageManager, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lockb"],
    ["bun", "bun.lock"],
    ["npm", "package-lock.json"]
  ];

  for (const [manager, filename] of candidates) {
    if (await exists(path.join(dir, filename))) {
      return manager;
    }
  }

  return (await exists(path.join(dir, "package.json"))) ? "npm" : "unknown";
}

async function readPackageJson(dir: string): Promise<{ scripts?: Record<string, string> } | null> {
  const filename = path.join(dir, "package.json");
  if (!(await exists(filename))) {
    return null;
  }

  const raw = await readFile(filename, "utf8");
  return JSON.parse(raw) as { scripts?: Record<string, string> };
}

function inferInstallCommand(packageManager: PackageManager, hasPackageJson: boolean) {
  if (!hasPackageJson) {
    return null;
  }

  switch (packageManager) {
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return "yarn install --frozen-lockfile";
    case "bun":
      return "bun install --frozen-lockfile";
    case "npm":
      return "npm ci";
    default:
      return null;
  }
}

function runScriptCommand(packageManager: PackageManager, scriptName: string) {
  switch (packageManager) {
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    case "npm":
    case "unknown":
    default:
      return `npm run ${scriptName}`;
  }
}

function buildValidationCommand(validationPlan: ValidationPlan) {
  const commands: string[] = [];
  if (validationPlan.commands.length) {
    commands.push(...validationPlan.commands);
  } else {
    commands.push("echo 'No validation commands inferred; treating as manual review only.'");
  }

  return ["set -euo pipefail", ...commands].join(" && ");
}

async function execDockerCommand(options: {
  image: string;
  workdir: string;
  networkDisabled: boolean;
  command: string;
}) {
  const args = [
    "run",
    "--rm",
    "-v",
    `${options.workdir}:/workspace`,
    "-w",
    "/workspace",
    ...(options.networkDisabled ? ["--network=none"] : []),
    options.image,
    "bash",
    "-lc",
    options.command
  ];

  return execFileAsync("docker", args, {
    maxBuffer: 10 * 1024 * 1024
  });
}

async function exists(filename: string) {
  try {
    await stat(filename);
    return true;
  } catch {
    return false;
  }
}

async function execGit(args: string[], cwd: string) {
  return execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024
  });
}
