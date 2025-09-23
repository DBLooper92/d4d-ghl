// src/app/api/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

function parseCookie(header: string | null): Record<string,string> {
  const out: Record<string,string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k,v] = part.split("=").map(s => s.trim());
    if (k) out[k] = v ?? "";
  }
  return out;
}

function parseUserTypeFromState(state: string): "Company" | "Location" {
  // state format from login: nonce | base64url(returnTo?) | ut=Company|Location
  const parts = state.split("|").map(s => s.trim()).filter(Boolean);
  const ut = parts.find(p => p.startsWith("ut=")) || "";
  const v = ut.split("=")[1] || "";
  return v === "Location" ? "Location" : "Company";
}

export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get("error");
  const code  = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  if (error) return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  if (!code)  return new NextResponse("Missing ?code", { status: 400 });

  // CSRF state verification (tolerate missing state only if referer looks like GHL)
  const cookies = parseCookie(req.headers.get("cookie"));
  const cookieNonce = cookies["rl_state"] || "";
  const [nonce] = state ? state.split("|") : ["", ""];
  const referer = req.headers.get("referer") || "";
  const fromGhl = /gohighlevel\.com|leadconnector/i.test(referer);

  if (state) {
    if (!cookieNonce || cookieNonce !== nonce) {
      return new NextResponse("Invalid state", { status: 400 });
    }
  } else if (!fromGhl) {
    return new NextResponse("Invalid state", { status: 400 });
  }

  const userType = parseUserTypeFromState(state); // <- recovered from state

  const functionsBase = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL?.trim();
  const redirectUri = process.env.GHL_REDIRECT_URI?.trim();

  if (!functionsBase) return new NextResponse("Missing NEXT_PUBLIC_FUNCTIONS_BASE_URL", { status: 500 });
  if (!redirectUri)   return new NextResponse("Missing GHL_REDIRECT_URI", { status: 500 });

  const exchangeUrl =
    `${functionsBase}/exchangeGHLToken?` +
    `code=${encodeURIComponent(code)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `user_type=${encodeURIComponent(userType)}`;

  if (debug) {
    return NextResponse.json({
      message: "DEBUG ONLY — not exchanging tokens",
      will_call: exchangeUrl,
      env: {
        GHL_REDIRECT_URI: redirectUri,
        NEXT_PUBLIC_FUNCTIONS_BASE_URL: functionsBase,
        user_type: userType,
      }
    });
  }

  try {
    const res = await fetch(exchangeUrl, { method: "POST" });
    if (!res.ok) {
      const text = await res.text();
      return new NextResponse(`Token exchange failed: ${res.status} ${text}`, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ message: "Success! Tokens stored.", data }, { status: 200 });
  } catch (e: any) {
    return new NextResponse(`Token exchange error: ${e?.message ?? e}`, { status: 500 });
  }
}
