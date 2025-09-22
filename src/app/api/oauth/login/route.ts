import { NextRequest, NextResponse } from "next/server";

// Builds the authorize URL and redirects there.
// Requires process.env.GHL_CLIENT_ID (you set this in App Hosting secrets).
export async function GET(req: NextRequest) {
  const clientId = process.env.GHL_CLIENT_ID;
  if (!clientId) return new NextResponse("Missing GHL_CLIENT_ID", { status: 500 });

  const origin = req.nextUrl.origin;
  const redirect_uri = `${origin}/api/oauth/callback`;

  const scope = [
    "contacts.readonly",
    "contacts.write",
    "opportunities.readonly",
    "opportunities.write",
    "locations/customFields.readonly",
    "oauth.readonly",
  ].join("%20");

  const url = new URL("https://marketplace.gohighlevel.com/oauth/chooselocation");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect_uri);
  url.searchParams.set("scope", scope);

  return NextResponse.redirect(url.toString(), { status: 302 });
}
