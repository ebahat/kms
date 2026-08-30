import { NextRequest, NextResponse } from 'next/server';

/**
 * ADR-0004 / design review finding 8: the platform-admin UI is served by
 * this SAME Next.js app on the kiboadmin.… hostname — no separate frontend.
 * Requests to kiboadmin.* are transparently rewritten into the /admin/*
 * route tree; everything else (tenant hostnames) is untouched.
 *
 * Was admin.* until 2026-08-30, renamed alongside api.*→kiboapi.* only
 * because both plain subdomains were already taken on this domain — see
 * deploy/Caddyfile's site-block comments.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const isAdminHost = host.startsWith('kiboadmin.');
  const path = req.nextUrl.pathname;

  if (isAdminHost && !path.startsWith('/admin')) {
    const url = req.nextUrl.clone();
    url.pathname = path === '/' ? '/admin/home' : `/admin${path}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};
