import { afterEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();

class MockApiAuthError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "ApiAuthError";
  }
}

vi.mock("@/server/auth/session", () => ({
  ApiAuthError: MockApiAuthError,
  requireApiSession: requireApiSessionMock
}));

vi.mock("@/server/services/job-service", () => ({
  JobService: vi.fn().mockImplementation(() => ({
    approveJob: vi.fn(),
    rejectJob: vi.fn(),
    rerunJob: vi.fn(),
    processNextJob: vi.fn()
  }))
}));

describe("job approval APIs", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a typed 401 response when API auth is missing", async () => {
    requireApiSessionMock.mockRejectedValueOnce(new MockApiAuthError());
    const { POST } = await import("../src/app/api/jobs/[id]/approve/route");

    const response = await POST(new Request("http://localhost/api/jobs/job-1/approve"), {
      params: Promise.resolve({ id: "job-1" })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });
});
