import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GHL_CLIENT_ID;
  const scopesEnv = process.env.GHL_SCOPES ?? "";
  if (!clientId) {
    return new NextResponse("Missing GHL_CLIENT_ID (set in env / App Hosting secrets)", { status: 500 });
  }
  const origin = req.nextUrl.origin;
  const redirectPath = process.env.GHL_REDIRECT_PATH ?? "/api/oauth/callback";
  const redirect_uri = `${origin}${redirectPath}`;

  // space-separated -> %20-joined
  const scope = scopesEnv.trim().split(/\s+/).join("%20");

  const url = new URL("https://marketplace.gohighlevel.com/oauth/chooselocation");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect_uri);
  if (scope) url.searchParams.set("scope", scope);

  return NextResponse.redirect(url.toString(), { status: 302 });
}
