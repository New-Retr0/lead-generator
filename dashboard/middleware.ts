import { NextRequest, NextResponse } from "next/server";

const ALWAYS_PROTECTED = ["/api/jobs", "/api/export"];

function isMutating(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function needsAuth(pathname: string, method: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (ALWAYS_PROTECTED.some((prefix) => pathname.startsWith(prefix))) return true;
  // When a token is configured, also gate other mutating API routes.
  return isMutating(method);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!needsAuth(pathname, req.method)) {
    return NextResponse.next();
  }

  const expected = process.env.DASHBOARD_API_TOKEN?.trim();
  // Fail-open for local/dev when no token is configured.
  if (!expected) {
    return NextResponse.next();
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  const queryToken = req.nextUrl.searchParams.get("token") ?? "";
  if (token === expected || queryToken === expected) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/api/:path*"],
};
