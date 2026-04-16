import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/_next", "/favicon.ico", "/manifest.json", "/sw.js", "/offline.html"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isStaticAsset(pathname: string): boolean {
  // Public files like /icon-192.png, /ankur_logo.jpeg, /robots.txt, etc.
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname) || isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // Client-side auth is based on localStorage token and ProtectedRoute checks.
  // Avoid server-side cookie redirects here to prevent auth redirect loops.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image).*)"],
};