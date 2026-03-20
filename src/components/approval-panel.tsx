"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ApprovalPanel({ jobId, canApprove }: { jobId: string; canApprove: boolean }) {
  const [reason, setReason] = useState("Rejected pending manual review.");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function postAction(url: string, body?: unknown) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Action failed.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <section className="panel approval-panel">
      <div className="panel-header">
        <h2>风险闸门</h2>
        <p>高风险修复不会自动继续，必须由人类审批者显式放行。</p>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="action-row">
        <button disabled={!canApprove || isPending} onClick={() => postAction(`/api/jobs/${jobId}/approve`)}>
          {isPending ? "处理中..." : "批准并创建 PR"}
        </button>
        <button
          className="button-secondary"
          disabled={!canApprove || isPending}
          onClick={() => postAction(`/api/jobs/${jobId}/rerun`)}
        >
          重新执行
        </button>
      </div>
      <label>
        <span>拒绝原因</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
      </label>
      <button
        className="button-danger"
        disabled={!canApprove || isPending}
        onClick={() => postAction(`/api/jobs/${jobId}/reject`, { reason })}
      >
        拒绝并关闭任务
      </button>
    </section>
  );
}
