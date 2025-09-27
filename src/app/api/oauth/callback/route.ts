// File: src/app/api/oauth/callback/route.ts
import { NextResponse } from "next/server";
import { ghlTokenUrl } from "@/lib/ghl";

export const runtime = "nodejs";

// ====== Types ======
type UserRole = "all" | "admin" | "user";
type OpenMode = "iframe" | "current_tab";

type CustomMenuLink = {
  id?: string;
  title: string;
  url: string;
  userRole?: UserRole;
  openMode?: OpenMode;
  allowCamera?: boolean;
  allowMicrophone?: boolean;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  locationId?: string | null;
  companyId?: string | null; // agency/company
};

// ====== Small utilities ======
const json = (o: unknown) => JSON.stringify(o);
const log = (msg: string, meta?: unknown) => (meta ? console.log(msg, json(meta)) : console.log(msg));
const errlog = (msg: string, meta?: unknown) => (meta ? console.error(msg, json(meta)) : console.error(msg));

const lcHeaders = (accessToken: string): HeadersInit => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Version: "2021-07-28",
});

async function fetchWithBody(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; bodyText: string; json: unknown }> {
  const r = await fetch(url, init);
  const bodyText = await r.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }
  return { ok: r.ok, status: r.status, bodyText, json: parsed };
}

function toMenuList(r: unknown): CustomMenuLink[] {
  if (Array.isArray(r)) return r as CustomMenuLink[];
  if (r && typeof r === "object") {
    const maybe = r as { items?: unknown };
    if (Array.isArray(maybe.items)) return maybe.items as CustomMenuLink[];
  }
  return [];
}

// ====== Config loader (NO throws at import time, supports both env name styles) ======
function loadOauthConfig() {
  // Primary (your current setup via apphosting.yaml)
  let clientId = process.env.GHL_CLIENT_ID ?? "";
  let clientSecret = process.env.GHL_CLIENT_SECRET ?? "";
  const baseApp = process.env.NEXT_PUBLIC_APP_BASE_URL || "http://localhost:3000";
  const redirectPath = process.env.GHL_REDIRECT_PATH || "/api/oauth/callback";
  let redirectUri = `${baseApp}${redirectPath}`;

  // Fallback to legacy names if present (in case secrets are set under old keys)
  if (!clientId || !clientSecret) {
    clientId = process.env.GHL_OAUTH_CLIENT_ID ?? clientId;
    clientSecret = process.env.GHL_OAUTH_CLIENT_SECRET ?? clientSecret;
    redirectUri = process.env.GHL_OAUTH_REDIRECT_URI || redirectUri;
  }

  return { clientId: String(clientId || ""), clientSecret: String(clientSecret || ""), baseApp, redirectUri };
}

// Compute CML URL without importing other helpers (avoid early env access)
const CML_TITLE = "Driving for Dollars";
const CML_URL = `${process.env.NEXT_PUBLIC_APP_BASE_URL || "http://localhost:3000"}/app`;

// ====== OAuth exchange (uses the loader above) ======
async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = loadOauthConfig();

  // Hard fail (don’t send an empty POST that yields 422)
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing OAuth creds at runtime: hasClientId=${Boolean(clientId)} hasClientSecret=${Boolean(
        clientSecret
      )} redirectUri=${redirectUri}`
    );
  }

  log("[oauth] token exchange start", {
    hasClientId: true,
    hasClientSecret: true,
    redirectUri,
  });

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetchWithBody(ghlTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${res.bodyText || (res.json ? json(res.json) : "")}`
    );
  }

  return res.json as TokenResponse;
}

// ====== Identify install target ======
type WhoAmIResponse = {
  locationId?: string | null;
  companyId?: string | null;
};

const GHL_API_BASE = "https://services.leadconnectorhq.com";

async function whoAmI(accessToken: string): Promise<WhoAmIResponse> {
  const url = `${GHL_API_BASE}/oauth/userinfo`;
  const res = await fetchWithBody(url, {
    method: "GET",
    headers: lcHeaders(accessToken),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`userinfo failed (${res.status})`);
  return (res.json || {}) as WhoAmIResponse;
}

async function deriveInstallTarget(
  accessToken: string
): Promise<{ agencyId: string | null; locationId: string | null }> {
  const info = await whoAmI(accessToken);
  return {
    agencyId: info.companyId ?? null,
    locationId: info.locationId ?? null,
  };
}

// ====== CML handlers ======
async function listCmls(
  accessToken: string,
  scope: { agencyId?: string | null; locationId?: string | null }
): Promise<CustomMenuLink[]> {
  const qs = new URLSearchParams();
  if (scope.agencyId) qs.set("companyId", scope.agencyId);
  if (scope.locationId) qs.set("locationId", scope.locationId);

  const url = `${GHL_API_BASE}/custom-menu-links?${qs.toString()}`;

  const attempt = await fetchWithBody(url, {
    method: "GET",
    headers: lcHeaders(accessToken),
    cache: "no-store",
  });

  if (!attempt.ok) {
    log("[oauth] CML list non-OK", { status: attempt.status, sample: attempt.bodyText });
    return [];
  }

  return toMenuList(attempt.json);
}

async function createCml(
  accessToken: string,
  scope: { agencyId?: string | null; locationId?: string | null }
): Promise<boolean> {
  const commonBody: Omit<CustomMenuLink, "id"> & {
    companyId?: string;
    locationId?: string;
  } = {
    title: CML_TITLE,
    url: `${CML_URL}?installed=1${scope.agencyId ? `&agencyId=${scope.agencyId}` : ""}${
      scope.locationId ? `&locationId=${scope.locationId}` : ""
    }`,
    userRole: "all",
    openMode: "iframe",
    allowCamera: false,
    allowMicrophone: false,
    ...(scope.agencyId ? { companyId: scope.agencyId } : {}),
    ...(scope.locationId ? { locationId: scope.locationId } : {}),
  };

  // A) base endpoint
  {
    const url = `${GHL_API_BASE}/custom-menu-links`;
    const res = await fetchWithBody(url, {
      method: "POST",
      headers: lcHeaders(accessToken),
      body: JSON.stringify(commonBody),
      cache: "no-store",
    });

    if (res.ok) return true;

    log("[oauth] ensureCml base-create attempt failed", { status: res.status, sample: res.bodyText });
  }

  // B) nested company endpoint
  if (scope.agencyId) {
    const url = `${GHL_API_BASE}/custom-menu-links/companies/${encodeURIComponent(scope.agencyId)}`;
    const body = {
      title: commonBody.title,
      url: commonBody.url,
      userRole: commonBody.userRole,
      openMode: commonBody.openMode,
      allowCamera: commonBody.allowCamera,
      allowMicrophone: commonBody.allowMicrophone,
    };

    const res = await fetchWithBody(url, {
      method: "POST",
      headers: lcHeaders(accessToken),
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.ok) return true;

    log("[oauth] ensureCml nested-create attempt failed", { status: res.status, sample: res.bodyText });
  }

  // C) nested location endpoint
  if (scope.locationId) {
    const url = `${GHL_API_BASE}/custom-menu-links/locations/${encodeURIComponent(scope.locationId)}`;
    const body = {
      title: commonBody.title,
      url: commonBody.url,
      userRole: commonBody.userRole,
      openMode: commonBody.openMode,
      allowCamera: commonBody.allowCamera,
      allowMicrophone: commonBody.allowMicrophone,
    };

    const res = await fetchWithBody(url, {
      method: "POST",
      headers: lcHeaders(accessToken),
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.ok) return true;

    log("[oauth] ensureCml nested-create attempt failed", { status: res.status, sample: res.bodyText });
  }

  log("[oauth] CML create failed", { status: 0, body: "exhausted strategies" });
  return false;
}

async function ensureCml(accessToken: string, agencyId: string | null, locationId: string | null) {
  log("[oauth] ensureCml precheck", { companyId: agencyId, hasWrite: true, hasRead: true });

  const existing = await listCmls(accessToken, { agencyId, locationId });
  const exists = existing.some((m: CustomMenuLink) => {
    const title = (m.title || "").toLowerCase();
    return title === CML_TITLE.toLowerCase() && typeof m.url === "string" && m.url.startsWith(CML_URL);
  });
  if (exists) return true;

  return await createCml(accessToken, { agencyId, locationId });
}

// ====== Route handler ======
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code" }, { status: 400 });
  }

  try {
    // Quick visibility on env presence in logs (no secrets printed)
    const cfg = loadOauthConfig();
    log("[oauth] cfg snapshot", {
      hasClientId: Boolean(cfg.clientId),
      hasClientSecret: Boolean(cfg.clientSecret),
      redirectUri: cfg.redirectUri,
    });

    const token = await exchangeCodeForToken(code);

    const accessToken = token.access_token;
    log("[oauth] token snapshot", {
      hasCompanyId: Boolean(token.companyId),
      hasLocationId: Boolean(token.locationId),
    });

    const target = await deriveInstallTarget(accessToken);

    const installedLocations = target.locationId ? 1 : 0;
    log("[oauth] installedLocations discovered", { count: installedLocations });

    const ok = await ensureCml(accessToken, target.agencyId, target.locationId);
    if (!ok) {
      // proceed anyway; logging captures why
    }

    const redirectQs = new URLSearchParams({
      installed: "1",
      ...(target.agencyId ? { agencyId: target.agencyId } : {}),
      ...(target.locationId ? { locationId: target.locationId } : {}),
    });

    const appUrl = `${cfg.baseApp}/app?${redirectQs.toString()}`;
    return NextResponse.redirect(appUrl, { status: 302 });
  } catch (e) {
    errlog("[oauth] callback error", { message: (e as Error).message });
    return NextResponse.json(
      { error: "OAuth callback failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
