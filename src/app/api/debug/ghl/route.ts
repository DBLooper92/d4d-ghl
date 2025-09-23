import { NextResponse } from "next/server";
import crypto from "node:crypto";

function fp(s?: string) {
  return s ? crypto.createHash("sha256").update(s).digest("hex").slice(0, 12) : "(empty)";
}

export async function GET() {
  const envClient = process.env.GHL_CLIENT_ID || "";
  const envRedirect = process.env.GHL_REDIRECT_URI || "";
  const envScopes = (process.env.GHL_SCOPES || "").trim().replace(/\s+/g, " ");

  const auth = new URL("https://marketplace.gohighlevel.com/oauth/authorize");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", envClient);
  auth.searchParams.set("redirect_uri", envRedirect);
  if (envScopes) auth.searchParams.set("scope", envScopes);
  auth.searchParams.set("user_type", "Company");

  return NextResponse.json({
    GHL_CLIENT_ID: envClient,
    GHL_REDIRECT_URI: envRedirect,
    GHL_SCOPES: envScopes,
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL,
    fp: {
      apphosting_client_id_sha256_12: fp(envClient),
      apphosting_redirect_sha256_12: fp(envRedirect),
    },
    constructed_authorize_url: auth.toString(),
    notes: "Fingerprints come from App Hosting env."
  });
}
