import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/api/jobs", "/api/export"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!needsAuth) {
    return NextResponse.next();
  }

  const expected = process.env.DASHBOARD_API_TOKEN?.trim();
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
  matcher: ["/api/jobs/:path*", "/api/export/:path*"],
};
