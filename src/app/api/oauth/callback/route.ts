import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  if (!code) return new NextResponse("Missing ?code", { status: 400 });

  // Functions base: prefer env, else hard-code your project’s Cloud Functions URL.
  const functionsBase =
    process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL
    ?? "https://us-central1-driving4dollars-d4d.cloudfunctions.net";

  // Redirect URI: prefer explicit env (best for prod), then secret (if exposed), then origin fallback.
  const explicitRedirect =
    process.env.NEXT_PUBLIC_OAUTH_REDIRECT_URL
    ?? process.env.GHL_REDIRECT_URI; // may not be exposed to Next at runtime
  const redirectUri = explicitRedirect ?? `${req.nextUrl.origin}${process.env.GHL_REDIRECT_PATH ?? "/api/oauth/callback"}`;

  try {
    const url = `${functionsBase}/exchangeGHLToken?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const text = await res.text();
      return new NextResponse(`Token exchange failed: ${res.status} ${text}`, { status: 500 });
    }
    const data = await res.json();
    return NextResponse.json({ message: "Success! Tokens stored.", data }, { status: 200 });
  } catch (e: any) {
    return new NextResponse(`Token exchange error: ${e?.message ?? e}`, { status: 500 });
  }
}
