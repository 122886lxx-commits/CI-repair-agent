import { createHash, randomUUID } from "node:crypto";

import type { JobInput } from "@/server/domain/types";

export function createId() {
  return randomUUID();
}

export function buildDedupeKey(input: JobInput) {
  const hash = createHash("sha256");
  hash.update(`${input.repo}:${input.sha}:${input.workflowRunId}`);
  return hash.digest("hex");
}
