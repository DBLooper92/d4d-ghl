import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  }
  if (!code) {
    return new NextResponse("Missing ?code", { status: 400 });
  }

  const functionsBase = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL!;
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}${process.env.GHL_REDIRECT_PATH ?? "/api/oauth/callback"}`;

  try {
    const res = await fetch(`${functionsBase}/exchangeGHLToken?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`, {
      method: "POST",
    });
    if (!res.ok) {
      const text = await res.text();
      return new NextResponse(`Token exchange failed: ${res.status} ${text}`, { status: 500 });
    }
    const data = await res.json();
    // For now, just confirm receipt; UI wiring comes later.
    return NextResponse.json({ message: "Success! Tokens stored.", data }, { status: 200 });
  } catch (e: any) {
    return new NextResponse(`Token exchange error: ${e?.message ?? e}`, { status: 500 });
  }
}
