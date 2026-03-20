import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inferValidationPlan } from "@/server/sandbox/workspace";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("inferValidationPlan", () => {
  it("prefers ci:repair:validate over generic scripts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ci-repair-workspace-"));
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          scripts: {
            "ci:repair:validate": "npm run test && npm run lint",
            test: "vitest run"
          }
        },
        null,
        2
      )
    );
    await writeFile(path.join(dir, "package-lock.json"), "{}");

    const plan = await inferValidationPlan(dir);

    expect(plan.packageManager).toBe("npm");
    expect(plan.installCommand).toBe("npm ci");
    expect(plan.commands).toEqual(["npm run ci:repair:validate"]);
  });

  it("falls back to common Node validation scripts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ci-repair-workspace-"));
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          scripts: {
            lint: "eslint .",
            test: "vitest run",
            build: "tsc -p tsconfig.json"
          }
        },
        null,
        2
      )
    );
    await writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");

    const plan = await inferValidationPlan(dir);

    expect(plan.packageManager).toBe("pnpm");
    expect(plan.installCommand).toBe("pnpm install --frozen-lockfile");
    expect(plan.commands).toEqual(["pnpm run lint", "pnpm run test", "pnpm run build"]);
  });
});
