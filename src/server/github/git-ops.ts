import type { RepositoryAccess } from "@/server/domain/types";
import { createCommitFromPatch } from "@/server/sandbox/workspace";

export async function pushPatchBranch(options: {
  repositoryAccess: RepositoryAccess;
  sha: string;
  patch: string;
  branchName: string;
  commitMessage: string;
}) {
  await createCommitFromPatch(options);
}
