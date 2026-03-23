import type { NextRequest } from "next/server";

export function getPublicBaseUrl(req?: NextRequest): string {
  if (process.env.KODY_PUBLIC_SERVER_URL)
    return process.env.KODY_PUBLIC_SERVER_URL.trim();
  if (process.env.NEXT_PUBLIC_SERVER_URL)
    return process.env.NEXT_PUBLIC_SERVER_URL.trim();

  if (req) {
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const forwardedHost = req.headers.get("x-forwarded-host");
    if (forwardedProto && forwardedHost) {
      return `${forwardedProto}://${forwardedHost}`;
    }
    return req.nextUrl.origin;
  }

  return "http://localhost:3333";
}
