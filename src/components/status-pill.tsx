import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

const toneClassMap: Record<Tone, string> = {
  neutral: "pill pill-neutral",
  success: "pill pill-success",
  warning: "pill pill-warning",
  danger: "pill pill-danger",
  accent: "pill pill-accent"
};

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={toneClassMap[tone]}>{children}</span>;
}
