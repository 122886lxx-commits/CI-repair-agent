import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

describe("runValidationInDocker", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        callback(null, { stdout: "ok", stderr: "" });
      }
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("runs install with network access before offline validation", async () => {
    const { runValidationInDocker } = await import("@/server/sandbox/workspace");

    await runValidationInDocker({
      image: "node:22-bookworm",
      workdir: "/tmp/workspace",
      networkDisabled: true,
      validationPlan: {
        packageManager: "npm",
        installCommand: "npm ci",
        commands: ["npm run test"]
      }
    });

    expect(execFileMock).toHaveBeenCalledTimes(2);

    const installArgs = execFileMock.mock.calls[0]?.[1] as string[];
    const validationArgs = execFileMock.mock.calls[1]?.[1] as string[];

    expect(installArgs).not.toContain("--network=none");
    expect(validationArgs).toContain("--network=none");
  });

  it("skips the install container when no install command is needed", async () => {
    const { runValidationInDocker } = await import("@/server/sandbox/workspace");

    await runValidationInDocker({
      image: "node:22-bookworm",
      workdir: "/tmp/workspace",
      networkDisabled: false,
      validationPlan: {
        packageManager: "unknown",
        installCommand: null,
        commands: ["echo ok"]
      }
    });

    expect(execFileMock).toHaveBeenCalledTimes(1);

    const validationArgs = execFileMock.mock.calls[0]?.[1] as string[];
    expect(validationArgs).not.toContain("--network=none");
  });
});
