import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAllowedGithubOrgs, getConfig, isAuthBypassed } from "@/server/config";

export const SESSION_COOKIE = "ci-repair-session";

export interface SessionUser {
  login: string;
  orgs: string[];
}

export class ApiAuthError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "ApiAuthError";
  }
}

function getSessionSecret() {
  const config = getConfig();
  return new TextEncoder().encode(config.SESSION_SECRET);
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ login: user.login, orgs: user.orgs })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSessionSecret());
}

export async function writeSessionCookie(user: SessionUser) {
  const token = await createSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().NODE_ENV === "production",
    path: "/"
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function readSession(): Promise<SessionUser | null> {
  if (isAuthBypassed()) {
    return {
      login: "local-operator",
      orgs: ["local-dev"]
    };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    const login = typeof payload.login === "string" ? payload.login : null;
    const orgs = Array.isArray(payload.orgs)
      ? payload.orgs.filter((value): value is string => typeof value === "string")
      : [];

    if (!login) {
      return null;
    }

    return { login, orgs };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await readSession();
  if (!session) {
    redirect("/api/auth/login");
  }
  return session;
}

export async function requireApiSession() {
  const session = await readSession();
  if (!session) {
    throw new ApiAuthError();
  }
  return session;
}

export function isAllowedOrgMember(orgs: string[]) {
  const allowed = getAllowedGithubOrgs();
  if (!allowed.length) {
    return true;
  }
  return orgs.some((org) => allowed.includes(org));
}
