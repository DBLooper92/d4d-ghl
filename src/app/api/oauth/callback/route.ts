// File: src/app/api/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

function parseCookie(headerInput: string | null | undefined): Record<string, string> {
  const header = headerInput ?? "";
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(";")) {
    const [kRaw, vRaw] = part.split("=", 2);
    const k: string = (kRaw ?? "").trim();
    const v: string = (vRaw ?? "").trim();
    if (k) out[k] = v;
  }
  return out;
}

function parseUserTypeFromState(state: string): "Company" | "Location" {
  // state format from login: nonce | base64url(returnTo?) | ut=Company|Location
  const parts = state.split("|").map((s) => s.trim()).filter(Boolean);
  const ut = parts.find((p) => p.startsWith("ut=")) || "";
  const v = ut.split("=")[1] || "";
  return v === "Location" ? "Location" : "Company";
}

function safeReturnFromState(state: string): string {
  // state format: nonce | base64url(returnTo?) | ut=...
  try {
    const parts = state.split("|").map((s) => s.trim()).filter(Boolean);

    // The returnTo (if present) is the second segment and is base64url-encoded.
    if (parts.length >= 2) {
      const maybeEncoded: string | undefined = parts[1];
      if (maybeEncoded && !maybeEncoded.startsWith("ut=")) {
        const decoded = Buffer.from(maybeEncoded, "base64url").toString("utf8");

        const u = new URL(decoded);
        const hostname = u.hostname.toLowerCase();

        const isGhl =
          hostname === "app.gohighlevel.com" &&
          u.pathname.startsWith("/custom-page-link/");

        const isOwn =
          hostname.endsWith("drivehound.com") ||
          hostname.endsWith("driving4dollars-d4d.us-central1.hosted.app");

        if (isGhl || isOwn) return decoded;
      }
    }
  } catch {
    // ignore
  }
  return "/"; // relative fallback (we'll absolutize it below)
}

function toAbsoluteUrl(urlish: string, origin: string): string {
  try {
    // If it's already absolute, this will succeed.
    // eslint-disable-next-line no-new
    new URL(urlish);
    return urlish;
  } catch {
    // Make it absolute against our origin.
    return new URL(urlish, origin).toString();
  }
}

export async function GET(req: NextRequest) {
  // Coerce all possibly-null values to concrete strings immediately
  const error: string = req.nextUrl.searchParams.get("error") ?? "";
  const code: string = req.nextUrl.searchParams.get("code") ?? "";
  const state: string = req.nextUrl.searchParams.get("state") ?? "";
  const debug: boolean = (req.nextUrl.searchParams.get("debug") ?? "") === "1";

  if (error) return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  if (!code) return new NextResponse("Missing ?code", { status: 400 });

  // CSRF state verification (tolerate missing state only if referer looks like GHL)
  const cookies = parseCookie(req.headers.get("cookie"));
  const cookieNonce: string = cookies["rl_state"] ?? "";

  // Avoid destructuring (keeps types concrete)
  const nonce: string = state ? (state.split("|")[0] ?? "") : "";
  const referer: string = req.headers.get("referer") ?? "";
  const fromGhl = /gohighlevel\.com|leadconnector/i.test(referer);

  if (state) {
    if (!cookieNonce || cookieNonce !== nonce) {
      return new NextResponse("Invalid state", { status: 400 });
    }
  } else if (!fromGhl) {
    return new NextResponse("Invalid state", { status: 400 });
  }

  const userType = parseUserTypeFromState(state);

  // Env
  const functionsBase: string = (process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL ?? "").trim();
  const redirectUri: string = (process.env.GHL_REDIRECT_URI ?? "").trim();

  if (!functionsBase)
    return new NextResponse("Missing NEXT_PUBLIC_FUNCTIONS_BASE_URL", { status: 500 });
  if (!redirectUri)
    return new NextResponse("Missing GHL_REDIRECT_URI", { status: 500 });

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
      },
    });
  }

  try {
    const r = await fetch(exchangeUrl, { method: "POST" });
    if (!r.ok) {
      const text = await r.text();
      return new NextResponse(`Token exchange failed: ${r.status} ${text}`, {
        status: 502,
      });
    }

    // Build an ABSOLUTE redirect target
    const origin = req.nextUrl.origin; // e.g., https://app.drivehound.com or your App Hosting domain
    const returnToRelativeOrAbsolute = safeReturnFromState(state);
    const redirectAbsolute = toAbsoluteUrl(returnToRelativeOrAbsolute, origin);

    const response = NextResponse.redirect(redirectAbsolute, { status: 302 });

    // Nuke the one-time state cookie
    response.headers.append(
      "Set-Cookie",
      "rl_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
    );
    return response;
  } catch (e: any) {
    return new NextResponse(`Token exchange error: ${e?.message ?? e}`, {
      status: 500,
    });
  }
}
