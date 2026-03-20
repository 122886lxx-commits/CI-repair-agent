import type { DiffCandidate, JobMode, RiskFlag, RiskLevel } from "@/server/domain/types";

const WORKFLOW_PATTERNS = [/^\.github\/workflows\//, /^infra\//, /^terraform\//, /^helm\//];
const AUTH_PATTERNS = [/auth/i, /session/i, /permission/i, /rbac/i, /secret/i, /\.env/i];
const DB_PATTERNS = [/migrations?\//i, /schema/i, /prisma\//i, /database/i];

export interface RiskAssessment {
  level: RiskLevel;
  requiresApproval: boolean;
  flags: RiskFlag[];
}

export function assessRisk(diff: DiffCandidate, mode: JobMode): RiskAssessment {
  const flags: RiskFlag[] = [];

  for (const file of diff.files) {
    if (WORKFLOW_PATTERNS.some((pattern) => pattern.test(file.path))) {
      flags.push({
        code: "workflow-change",
        level: "high",
        description: `${file.path} touches CI or infrastructure workflow configuration.`
      });
    }

    if (AUTH_PATTERNS.some((pattern) => pattern.test(file.path))) {
      flags.push({
        code: "auth-surface",
        level: "high",
        description: `${file.path} appears to affect authentication, secrets, or permissions.`
      });
    }

    if (DB_PATTERNS.some((pattern) => pattern.test(file.path))) {
      flags.push({
        code: "database-change",
        level: "high",
        description: `${file.path} appears to change schema or migration behavior.`
      });
    }

    if (file.changeType === "deleted") {
      flags.push({
        code: "deletion",
        level: "medium",
        description: `${file.path} is being deleted and requires review.`
      });
    }
  }

  if (/["']\^[0-9]+\./.test(diff.patch) || /"dependencies"/.test(diff.patch)) {
    flags.push({
      code: "dependency-upgrade",
      level: "high",
      description: "Patch appears to modify package versions and should be reviewed."
    });
  }

  if (/DELETE FROM|drop table|drop database/i.test(diff.patch)) {
    flags.push({
      code: "destructive-sql",
      level: "critical",
      description: "Patch includes destructive SQL semantics."
    });
  }

  if (mode === "hotfix" && flags.length === 0) {
    flags.push({
      code: "hotfix-review",
      level: "medium",
      description: "Hotfix mode always requires residual-risk review before release."
    });
  }

  const level = flags.some((flag) => flag.level === "critical")
    ? "critical"
    : flags.some((flag) => flag.level === "high")
      ? "high"
      : flags.some((flag) => flag.level === "medium")
        ? "medium"
        : "low";

  return {
    level,
    requiresApproval: level === "high" || level === "critical",
    flags
  };
}
