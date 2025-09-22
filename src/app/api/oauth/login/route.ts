// src/app/api/oauth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export async function GET(req: NextRequest) {
  const clientId = process.env.GHL_CLIENT_ID;
  const configuredRedirect = process.env.GHL_REDIRECT_URI?.trim();
  // Fallback to the current origin so we never error at runtime
  const redirectUri = configuredRedirect || `${req.nextUrl.origin}/api/oauth/callback`;
  const scopeStr = (process.env.GHL_SCOPES ?? "").trim().replace(/\s+/g, " ");

  if (!clientId) {
    return new NextResponse("Missing GHL_CLIENT_ID", { status: 500 });
  }

  // CSRF state via nonce cookie
  const nonce = crypto.randomBytes(16).toString("base64url");
  const cookie = [
    `rl_state=${nonce}`,
    "Max-Age=600",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");

  // Optional allow-listed returnTo (GHL custom-page-link only)
  let safeReturnTo = "";
  const rtRaw = req.nextUrl.searchParams.get("returnTo") || "";
  if (rtRaw) {
    try {
      const u = new URL(rtRaw);
      const isGhl = u.hostname === "app.gohighlevel.com";
      const isCustom = u.pathname.startsWith("/custom-page-link/");
      if (isGhl && isCustom) safeReturnTo = u.toString();
    } catch {}
  }
  const encode = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const state = [nonce, safeReturnTo ? encode(safeReturnTo) : ""].filter(Boolean).join("|");

  // Correct authorize endpoint
  const auth = new URL("https://marketplace.gohighlevel.com/oauth/authorize");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  if (scopeStr) auth.searchParams.set("scope", scopeStr);
  auth.searchParams.set("user_type", "Company"); // Agency-level install
  auth.searchParams.set("state", state);

  const res = NextResponse.redirect(auth.toString(), { status: 302 });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
