import { describe, expect, it } from "vitest";

import { assessRisk } from "@/server/risk/engine";

describe("assessRisk", () => {
  it("flags workflow changes for approval", () => {
    const result = assessRisk(
      {
        rationale: "workflow fix",
        patch: "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
        files: [
          {
            path: ".github/workflows/ci.yml",
            changeType: "modified",
            additions: 2,
            deletions: 1,
            summary: "Update workflow"
          }
        ],
        riskFlags: []
      },
      "fix"
    );

    expect(result.requiresApproval).toBe(true);
    expect(result.level).toBe("high");
    expect(result.flags.some((flag) => flag.code === "workflow-change")).toBe(true);
  });

  it("keeps isolated source changes low risk", () => {
    const result = assessRisk(
      {
        rationale: "null guard",
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
      },
      "fix"
    );

    expect(result.requiresApproval).toBe(false);
    expect(result.level).toBe("low");
  });
});
