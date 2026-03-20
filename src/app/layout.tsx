import type { Metadata } from "next";

import { readSession } from "@/server/auth/session";

import "./globals.css";

export const metadata: Metadata = {
  title: "CI Repair Agent",
  description: "Agent-native control plane for GitHub Actions repair workflows."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await readSession();

  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <div className="brand-block">
              <span className="brand-kicker">Agent-Native Control Plane</span>
              <h1>CI Repair Agent</h1>
              <p>
                面向 GitHub Actions 的单租户修复平台。它先建模，再生成任务图，再让多角色 agent
                协作推进修复、验证、审批和审计。
              </p>
            </div>
            <div className="session-chip">
              <strong>{session?.login ?? "未登录"}</strong>
              <span className="muted">{session ? "GitHub operator" : "需要 GitHub OAuth"}</span>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
