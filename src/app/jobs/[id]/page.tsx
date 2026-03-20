import { notFound } from "next/navigation";

import { ApprovalPanel } from "@/components/approval-panel";
import { StatusPill } from "@/components/status-pill";
import { readSession } from "@/server/auth/session";
import { JobService } from "@/server/services/job-service";
import { formatAgent, formatDate, formatPhase, formatRisk, formatStatus } from "@/server/utils/format";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = new JobService();
  const [record, session] = await Promise.all([service.getJob(id), readSession()]);

  if (!record) {
    notFound();
  }

  const { job } = record;

  return (
    <main className="detail-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>{job.repo}</h2>
          <p>{job.summary ?? "Job detail view for the current repair lifecycle."}</p>
        </div>
        <div className="summary-list">
          <article className="summary-item">
            <span className="summary-key">状态</span>
            <StatusPill tone={job.status === "completed" ? "success" : job.status === "approval_pending" ? "warning" : "accent"}>
              {formatStatus(job.status)}
            </StatusPill>
          </article>
          <article className="summary-item">
            <span className="summary-key">当前阶段</span>
            <strong>{formatPhase(job.currentPhase)}</strong>
            <div className="muted">{formatAgent(job.currentAgent)}</div>
          </article>
          <article className="summary-item">
            <span className="summary-key">风险级别</span>
            <StatusPill tone={job.riskLevel === "low" ? "success" : job.riskLevel === "medium" ? "warning" : "danger"}>
              {formatRisk(job.riskLevel)}
            </StatusPill>
          </article>
          <article className="summary-item">
            <span className="summary-key">元数据</span>
            <strong>Run #{job.workflowRunId}</strong>
            <div className="muted">
              SHA {job.sha.slice(0, 12)} · Updated {formatDate(job.updatedAt)}
            </div>
            {job.prUrl ? (
              <div style={{ marginTop: "10px" }}>
                <a href={job.prUrl} target="_blank" rel="noreferrer">
                  打开 Draft PR
                </a>
              </div>
            ) : null}
          </article>
        </div>

        {record.taskSpec ? (
          <section style={{ marginTop: "22px" }}>
            <div className="panel-header">
              <h3>任务规格</h3>
              <p>任务建模阶段定义的约束和成功条件。</p>
            </div>
            <div className="bullet-list">
              <article className="bullet-card">
                <span className="summary-key">Goal</span>
                {record.taskSpec.goal.map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </article>
              <article className="bullet-card">
                <span className="summary-key">Constraints</span>
                {record.taskSpec.constraints.map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </article>
              <article className="bullet-card">
                <span className="summary-key">Approval triggers</span>
                {record.taskSpec.capabilityBoundary.approvalTriggers.map((item) => (
                  <div key={item}>{item}</div>
                ))}
              </article>
            </div>
          </section>
        ) : null}

        {record.taskGraph ? (
          <section style={{ marginTop: "22px" }}>
            <div className="panel-header">
              <h3>任务图</h3>
              <p>Orchestrator 生成的节点、依赖和阻塞条件。</p>
            </div>
            <div className="node-list">
              {record.taskGraph.nodes.map((node) => (
                <article key={node.id} className="node-card">
                  <strong>{node.title}</strong>
                  <div className="muted">{node.description}</div>
                  <div style={{ marginTop: "8px" }}>
                    <StatusPill tone="accent">{node.assignedAgent ?? "unassigned"}</StatusPill>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {record.diffCandidate ? (
          <section style={{ marginTop: "22px" }}>
            <div className="panel-header">
              <h3>候选补丁</h3>
              <p>{record.diffCandidate.rationale}</p>
            </div>
            <pre className="code-block">{record.diffCandidate.patch}</pre>
          </section>
        ) : null}
      </section>

      <section className="detail-grid" style={{ gridTemplateColumns: "1fr", alignContent: "start" }}>
        {record.approvalGate ? <ApprovalPanel jobId={job.id} canApprove={Boolean(session)} /> : null}

        {record.evalResult ? (
          <section className="panel">
            <div className="panel-header">
              <h2>评测结果</h2>
              <p>Evaluator 输出的自动验证和残余风险说明。</p>
            </div>
            <div className="bullet-list">
              {record.evalResult.summary.map((item) => (
                <article key={item} className="bullet-card">
                  {item}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panel">
          <div className="panel-header">
            <h2>审计时间线</h2>
            <p>所有关键动作都以追加式事件记录，方便回放和责任追踪。</p>
          </div>
          <div className="timeline">
            {record.auditEvents.map((event) => (
              <article key={event.id} className="timeline-item">
                <span className="summary-key">
                  {formatPhase(event.phase)} · {formatDate(event.createdAt)}
                </span>
                <strong>{event.payload.title}</strong>
                <div className="muted">{event.payload.detail}</div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
