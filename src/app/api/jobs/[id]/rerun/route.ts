import { NextResponse } from "next/server";

import { ApiAuthError, requireApiSession } from "@/server/auth/session";
import { JobService } from "@/server/services/job-service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession();
    const { id } = await context.params;
    const service = new JobService();
    const record = await service.rerunJob(id);
    if (!record) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    await service.processNextJob();
    return NextResponse.json(record);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to rerun job" },
      { status: 400 }
    );
  }
}
