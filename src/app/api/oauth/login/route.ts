// src/app/api/oauth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export async function GET(req: NextRequest) {
  const clientId = process.env.GHL_CLIENT_ID;
  const redirectUri = process.env.GHL_REDIRECT_URI?.trim();
  const scopeStr = (process.env.GHL_SCOPES ?? "").trim().replace(/\s+/g, " ");

  if (!clientId)  return new NextResponse("Missing GHL_CLIENT_ID", { status: 500 });
  if (!redirectUri) return new NextResponse("Missing GHL_REDIRECT_URI", { status: 500 });

  // Determine target install type (default Agency)
  const raw = (req.nextUrl.searchParams.get("user_type") || "").trim();
  const userType = raw === "Location" ? "Location" : "Company";

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

  // Pack state: nonce | base64url(returnTo?) | ut=Company|Location
  const encode = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const parts = [nonce];
  if (safeReturnTo) parts.push(encode(safeReturnTo));
  parts.push(`ut=${userType}`);
  const state = parts.join("|");

  // Marketplace authorize endpoint
  const auth = new URL("https://marketplace.gohighlevel.com/oauth/authorize");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  if (scopeStr) auth.searchParams.set("scope", scopeStr);
  auth.searchParams.set("user_type", userType); // <- dynamic
  auth.searchParams.set("state", state);

  const res = NextResponse.redirect(auth.toString(), { status: 302 });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
