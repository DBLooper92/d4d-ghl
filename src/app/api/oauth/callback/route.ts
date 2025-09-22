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

export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get("error");
  const code  = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";

  if (error) return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  if (!code)  return new NextResponse("Missing ?code", { status: 400 });

  // CSRF state verification (tolerate missing state only if referer looks like GHL)
  const cookies = parseCookie(req.headers.get("cookie"));
  const cookieNonce = cookies["rl_state"] || "";
  const [nonce, rtB64] = state ? state.split("|") : ["", ""];
  const referer = req.headers.get("referer") || "";
  const fromGhl = /gohighlevel\.com|leadconnector/i.test(referer);

  if (state) {
    if (!cookieNonce || cookieNonce !== nonce) {
      return new NextResponse("Invalid state", { status: 400 });
    }
  } else if (!fromGhl) {
    return new NextResponse("Invalid state", { status: 400 });
  }

  // Build function call
  const functionsBase = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL!;
  const redirectUri   = process.env.GHL_REDIRECT_URI!;
  if (!functionsBase || !redirectUri) {
    return new NextResponse("Missing NEXT_PUBLIC_FUNCTIONS_BASE_URL or GHL_REDIRECT_URI", { status: 500 });
    }

  try {
    // Include user_type=Company to mirror the authorize request
    const url = `${functionsBase}/exchangeGHLToken?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}&user_type=Company`;
    const res = await fetch(url, { method: "POST" });
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
