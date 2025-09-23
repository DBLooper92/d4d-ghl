// src/app/api/debug/ghl/route.ts
import { NextRequest, NextResponse } from "next/server";

export function GET(req: NextRequest) {
  const clientId = process.env.GHL_CLIENT_ID?.trim() || "";
  const redirectUri = process.env.GHL_REDIRECT_URI?.trim() || "";
  const scopes = (process.env.GHL_SCOPES ?? "").trim().replace(/\s+/g, " ");
  const functionsBase = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL?.trim() || "";

  const auth = new URL("https://marketplace.gohighlevel.com/oauth/authorize");
  auth.searchParams.set("response_type", "code");
  if (clientId) auth.searchParams.set("client_id", clientId);
  if (redirectUri) auth.searchParams.set("redirect_uri", redirectUri);
  if (scopes) auth.searchParams.set("scope", scopes);
  auth.searchParams.set("user_type", "Company");

  return NextResponse.json({
    GHL_CLIENT_ID: clientId,
    GHL_REDIRECT_URI: redirectUri,
    GHL_SCOPES: scopes,
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: functionsBase,
    constructed_authorize_url: auth.toString(),
    notes:
      "All values come from App Hosting secrets/vars. The authorize URL above is exactly what /api/oauth/login should redirect to.",
  });
}
