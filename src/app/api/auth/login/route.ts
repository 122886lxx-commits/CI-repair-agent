import { NextResponse } from "next/server";

import { getConfig, isAuthBypassed } from "@/server/config";
import { writeSessionCookie } from "@/server/auth/session";

export async function GET() {
  const config = getConfig();

  if (isAuthBypassed()) {
    await writeSessionCookie({
      login: "local-operator",
      orgs: ["local-dev"]
    });
    return NextResponse.redirect(new URL("/", config.APP_URL));
  }

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.GITHUB_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", `${config.APP_URL}/api/auth/callback`);
  url.searchParams.set("scope", "read:user read:org");
  url.searchParams.set("state", "ci-repair-agent");
  return NextResponse.redirect(url);
}
