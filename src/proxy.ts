import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

function getStorageOrigin(): string | null {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  return endpoint ? new URL(endpoint).origin : null;
}

function buildContentSecurityPolicy(
  nonce: string,
  isDevelopment: boolean,
  isHttps: boolean,
): string {
  const storageOrigin = getStorageOrigin();
  const directives = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets hash-wasm compile Argon2id; React needs eval only in development.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${
      isDevelopment ? " 'unsafe-eval'" : ""
    }`,
    // Development hot reloading injects un-nonced styles; a nonce would disable 'unsafe-inline'.
    `style-src 'self' ${isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Encrypted documents upload and download directly through presigned storage URLs.
    `connect-src 'self'${storageOrigin ? ` ${storageOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Over plain-HTTP localhost this would rewrite the page's own assets to an unreachable https URL.
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/vault") && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    request.nextUrl.protocol === "https:",
  );
  // Next.js reads the nonce from the request's CSP header and applies it to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
