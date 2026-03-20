import { Webhooks } from "@octokit/webhooks";
import { NextResponse } from "next/server";

import { getConfig } from "@/server/config";
import { JobService } from "@/server/services/job-service";

export async function POST(request: Request) {
  const payloadText = await request.text();
  const eventName = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const config = getConfig();
  const service = new JobService();

  try {
    if (config.GITHUB_WEBHOOK_SECRET && eventName) {
      const webhooks = new Webhooks({
        secret: config.GITHUB_WEBHOOK_SECRET
      });
      await webhooks.verify(payloadText, signature);
    }

    if (eventName === "workflow_run") {
      const payload = JSON.parse(payloadText) as {
        action: string;
        repository: { full_name: string };
        workflow_run: { conclusion: string | null; head_sha: string; id: number };
      };

      if (payload.action === "completed" && payload.workflow_run.conclusion === "failure") {
        await service.createJob({
          repo: payload.repository.full_name,
          sha: payload.workflow_run.head_sha,
          workflowRunId: payload.workflow_run.id,
          mode: "fix"
        });
        await service.processNextJob();
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook handling failed" },
      { status: 400 }
    );
  }
}
