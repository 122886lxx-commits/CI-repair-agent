import type { AgentRole, JobPhase, JobStatus, RiskLevel } from "@/server/domain/types";

export function formatStatus(status: JobStatus) {
  return status.replace(/_/g, " ");
}

export function formatPhase(phase: JobPhase) {
  return phase.replace(/-/g, " ");
}

export function formatAgent(role: AgentRole) {
  return role.replace(/-/g, " ");
}

export function formatRisk(level: RiskLevel) {
  return level.toUpperCase();
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
