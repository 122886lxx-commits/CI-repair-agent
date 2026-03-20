"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const initialState = {
  repo: "",
  sha: "",
  workflowRunId: "",
  mode: "fix"
};

export function CreateJobForm() {
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="panel create-job-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);

        startTransition(async () => {
          const response = await fetch("/api/jobs", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              repo: form.repo,
              sha: form.sha,
              workflow_run_id: Number(form.workflowRunId),
              mode: form.mode
            })
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            setError(payload?.error ?? "Unable to create job.");
            return;
          }

          const payload = (await response.json()) as { id: string };
          setForm(initialState);
          router.push(`/jobs/${payload.id}`);
          router.refresh();
        });
      }}
    >
      <div className="panel-header">
        <h2>创建修复任务</h2>
        <p>输入一次失败的 GitHub Actions run，系统会生成任务图并推进修复。</p>
      </div>
      <label>
        <span>仓库</span>
        <input
          value={form.repo}
          onChange={(event) => setForm((current) => ({ ...current, repo: event.target.value }))}
          placeholder="owner/repo"
          required
        />
      </label>
      <label>
        <span>Commit SHA</span>
        <input
          value={form.sha}
          onChange={(event) => setForm((current) => ({ ...current, sha: event.target.value }))}
          placeholder="abc123..."
          required
        />
      </label>
      <label>
        <span>Workflow Run ID</span>
        <input
          value={form.workflowRunId}
          onChange={(event) =>
            setForm((current) => ({ ...current, workflowRunId: event.target.value.replace(/\D+/g, "") }))
          }
          placeholder="123456789"
          required
        />
      </label>
      <label>
        <span>模式</span>
        <select
          value={form.mode}
          onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}
        >
          <option value="standard">standard</option>
          <option value="fix">fix</option>
          <option value="hotfix">hotfix</option>
        </select>
      </label>
      {error ? <p className="inline-error">{error}</p> : null}
      <button type="submit" disabled={isPending}>
        {isPending ? "正在创建..." : "创建任务"}
      </button>
    </form>
  );
}
