import { NextResponse } from "next/server";

import { ApiAuthError, requireApiSession } from "@/server/auth/session";
import { JobService } from "@/server/services/job-service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;
    const service = new JobService();
    const record = await service.approveJob(id, session.login);
    return NextResponse.json(record);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve job" },
      { status: 400 }
    );
  }
}
