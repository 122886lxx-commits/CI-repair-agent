import Link from "next/link";

import { CreateJobForm } from "@/components/create-job-form";
import { StatusPill } from "@/components/status-pill";
import { readSession } from "@/server/auth/session";
import { JobService } from "@/server/services/job-service";
import { formatAgent, formatDate, formatPhase, formatRisk, formatStatus } from "@/server/utils/format";

function toneForStatus(status: string): "neutral" | "success" | "warning" | "danger" | "accent" {
  if (status === "completed") {
    return "success";
  }
  if (status === "approval_pending") {
    return "warning";
  }
  if (status === "failed") {
    return "danger";
  }
  return "accent";
}

export default async function HomePage() {
  const service = new JobService();
  const [jobs, stats, session] = await Promise.all([
    service.listJobs(),
    service.getStats(),
    readSession()
  ]);

  return (
    <main className="dashboard-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>Fleet Overview</h2>
          <p>控制面展示当前 CI 修复任务的队列、审批压力和风险状态。</p>
        </div>
        <div className="stat-grid">
          <article className="stat-card">
            <span>Total jobs</span>
            <strong>{stats.totalJobs}</strong>
          </article>
          <article className="stat-card">
            <span>Active jobs</span>
            <strong>{stats.activeJobs}</strong>
          </article>
          <article className="stat-card">
            <span>Pending approval</span>
            <strong>{stats.pendingApprovals}</strong>
          </article>
        </div>
        <div className="panel-header" style={{ marginTop: "22px" }}>
          <h3>任务列表</h3>
          <p>每个任务都经过任务规格、图生成、修复、评测和审计闭环。</p>
        </div>
        {jobs.length ? (
          <table className="jobs-table">
            <thead>
              <tr>
                <th>仓库</th>
                <th>阶段 / Agent</th>
                <th>风险</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link href={`/jobs/${job.id}`}>
                      <strong>{job.repo}</strong>
                      <br />
                      <small>{job.sha.slice(0, 12)}</small>
                    </Link>
                  </td>
                  <td>
                    <StatusPill tone={toneForStatus(job.status)}>{formatStatus(job.status)}</StatusPill>
                    <div style={{ marginTop: "10px" }}>
                      <strong>{formatPhase(job.currentPhase)}</strong>
                      <br />
                      <small>{formatAgent(job.currentAgent)}</small>
                    </div>
                  </td>
                  <td>
                    <StatusPill tone={job.riskLevel === "low" ? "success" : job.riskLevel === "medium" ? "warning" : "danger"}>
                      {formatRisk(job.riskLevel)}
                    </StatusPill>
                    <div style={{ marginTop: "10px" }}>
                      <small>{job.summary ?? "No summary yet"}</small>
                    </div>
                  </td>
                  <td>{formatDate(job.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="summary-item">
            <span className="summary-key">No jobs yet</span>
            <strong>创建第一个 workflow 修复任务开始测试这个 agent。</strong>
          </div>
        )}
      </section>

      {session ? (
        <CreateJobForm />
      ) : (
        <section className="panel signin-panel">
          <div className="panel-header">
            <h2>登录控制台</h2>
            <p>审批、rerun 和 webhook 管理都要求 GitHub OAuth 会话。</p>
          </div>
          <a href="/api/auth/login">
            <button type="button">使用 GitHub 登录</button>
          </a>
        </section>
      )}
    </main>
  );
}
