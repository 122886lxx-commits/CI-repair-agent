import { NextResponse } from "next/server";

import { isAllowedOrgMember, writeSessionCookie } from "@/server/auth/session";
import { getConfig } from "@/server/config";
import { createGithubService } from "@/server/github/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const config = getConfig();

  if (!code || state !== "ci-repair-agent") {
    return NextResponse.json({ error: "Invalid GitHub OAuth callback" }, { status: 400 });
  }

  try {
    const github = createGithubService();
    const user = await github.exchangeOAuthCode(code);

    if (!isAllowedOrgMember(user.orgs)) {
      return NextResponse.json({ error: "User is not in an allowed GitHub organization" }, { status: 403 });
    }

    await writeSessionCookie({
      login: user.login,
      orgs: user.orgs
    });

    return NextResponse.redirect(new URL("/", config.APP_URL));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OAuth login failed" },
      { status: 400 }
    );
  }
}
