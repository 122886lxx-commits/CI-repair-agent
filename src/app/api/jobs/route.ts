import { NextResponse } from "next/server";
import { z } from "zod";

import { JobService } from "@/server/services/job-service";

const jobInputSchema = z.object({
  repo: z.string().min(3),
  sha: z.string().min(6),
  workflow_run_id: z.number().int().positive(),
  mode: z.enum(["standard", "fix", "hotfix"])
});

export async function GET() {
  const service = new JobService();
  const jobs = await service.listJobs();
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  try {
    const payload = jobInputSchema.parse(await request.json());
    const service = new JobService();
    const record = await service.createJob({
      repo: payload.repo,
      sha: payload.sha,
      workflowRunId: payload.workflow_run_id,
      mode: payload.mode
    });

    await service.processNextJob();
    return NextResponse.json({ id: record.job.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create job."
      },
      { status: 400 }
    );
  }
}
