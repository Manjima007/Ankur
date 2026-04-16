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

  const sessionCookie = request.cookies.get("session_id");
  const authTokenCookie = request.cookies.get("auth_token");
  const hasAuthCookie = Boolean(sessionCookie?.value || authTokenCookie?.value);

  // Crucial exclusion: never attempt to redirect / to / again.
  if (pathname === "/") {
    return NextResponse.next();
  }

  // Allow all public/static paths without auth redirect.
  if (isPublicPath(pathname) || isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // Redirect only when auth/session cookie is completely missing.
  if (!hasAuthCookie) {
    const loginUrl = new URL("/", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image).*)"],
};