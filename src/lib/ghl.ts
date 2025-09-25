// File: src/lib/ghl.ts
const API_VERSION = "2021-07-28";

export type OAuthTokens = {
  access_token: string;
  refresh_token: string;
  scope?: string;
  expires_in: number;
  token_type: string;
  companyId?: string;  // agencyId
  locationId?: string; // sub-account id
};

export const OAUTH_LOG = String(process.env.OAUTH_LOG || "off").toLowerCase() === "on";
export const OAUTH_LOG_PREFIX = "[oauth]";

export function olog(msg: string, details?: unknown) {
  if (!OAUTH_LOG) return;
  // keep logs concise but useful
  console.info(
    `${OAUTH_LOG_PREFIX} ${msg}`,
    details ? JSON.stringify(details, (_k, v) => (Array.isArray(v) ? v.slice(0, 5) : v)) : ""
  );
}

export function lcHeaders(accessToken: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    Version: API_VERSION,
    ...(extra ?? {}),
  };
}

export function ghlAuthBase() {
  return "https://marketplace.gohighlevel.com/oauth/authorize";
}
export function ghlTokenUrl() {
  return "https://services.leadconnectorhq.com/oauth/token";
}
export function ghlUsersMeUrl() {
  return "https://services.leadconnectorhq.com/users/me";
}

export function ghlCompanyUrl(companyId: string) {
  return `https://services.leadconnectorhq.com/companies/${companyId}`;
}
export function ghlCompanyLocationsUrl(companyId: string, page = 1, limit = 200) {
  const u = new URL(`https://services.leadconnectorhq.com/companies/${companyId}/locations`);
  u.searchParams.set("page", String(page));
  u.searchParams.set("limit", String(limit));
  return u.toString();
}
export function ghlMintLocationTokenUrl() {
  return "https://services.leadconnectorhq.com/oauth/locationToken";
}

export function getGhlConfig() {
  const baseApp = process.env.NEXT_PUBLIC_APP_BASE_URL || "http://localhost:3000";
  const redirectPath = process.env.GHL_REDIRECT_PATH || "/api/oauth/callback";
  const redirectUri = `${baseApp}${redirectPath}`;

  return {
    clientId: required("GHL_CLIENT_ID"),
    clientSecret: required("GHL_CLIENT_SECRET"),
    scope: process.env.GHL_SCOPES || "",
    redirectUri, // computed from base + path
    baseApp,
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(v);
}

export function isCompany(userType?: string) {
  const t = String(userType || "").toLowerCase();
  return t === "company";
}
export function isLocation(userType?: string) {
  const t = String(userType || "").toLowerCase();
  return t === "location";
}
