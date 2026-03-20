import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, requireApiSession } from "@/server/auth/session";
import { JobService } from "@/server/services/job-service";

const rejectSchema = z.object({
  reason: z.string().min(3)
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    const { id } = await context.params;
    const body = rejectSchema.parse(await request.json());
    const service = new JobService();
    const record = await service.rejectJob(id, session.login, body.reason);
    return NextResponse.json(record);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reject job" },
      { status: 400 }
    );
  }
}
