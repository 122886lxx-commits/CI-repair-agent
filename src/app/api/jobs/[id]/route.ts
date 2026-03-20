import { NextResponse } from "next/server";

import { JobService } from "@/server/services/job-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const service = new JobService();
  const record = await service.getJob(id);
  if (!record) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json(record);
}
