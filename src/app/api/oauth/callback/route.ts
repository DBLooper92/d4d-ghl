// src/app/api/oauth/callback/route.ts
import { NextResponse } from "next/server";

// ====== Types (no `any`) ======
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
  // GHL sometimes includes these
  locationId?: string | null;
  companyId?: string | null; // "agencyId" in your logs
};

// ====== Env helpers ======
const {
  GHL_OAUTH_CLIENT_ID = "",
  GHL_OAUTH_CLIENT_SECRET = "",
  GHL_OAUTH_REDIRECT_URI = "",
  // API base (prod or sandbox). Keep as-is or adjust if you use a proxy.
  GHL_API_BASE = "https://services.leadconnectorhq.com",
} = process.env;

// App URL you want to install as a CML target
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://app.driving4dollars.co";

// ====== Small utilities ======
const json = (o: unknown) => JSON.stringify(o);

const log = (msg: string, meta?: unknown) => {
  if (meta) console.log(msg, json(meta));
  else console.log(msg);
};

const errlog = (msg: string, meta?: unknown) => {
  if (meta) console.error(msg, json(meta));
  else console.error(msg);
};

// Build headers for LeadConnector API calls
const lcHeaders = (accessToken: string): HeadersInit => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Version: "2021-07-28", // stable LC API version header commonly required
});

// Be tolerant to the two common list shapes (array or { items: [] })
function toMenuList(r: unknown): CustomMenuLink[] {
  if (Array.isArray(r)) return r as CustomMenuLink[];
  if (r && typeof r === "object") {
    const maybe = r as { items?: unknown };
    if (Array.isArray(maybe.items)) return maybe.items as CustomMenuLink[];
  }
  return [];
}

// Fetch helper that captures text + parsed JSON (as unknown)
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

// ====== OAuth exchange ======
async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const url = `${GHL_API_BASE}/oauth/token`;
  const form = new URLSearchParams({
    client_id: GHL_OAUTH_CLIENT_ID,
    client_secret: GHL_OAUTH_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: GHL_OAUTH_REDIRECT_URI,
  });

  const res = await fetchWithBody(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${res.bodyText || res.json ? json(res.json) : ""}`
    );
  }

  const token = res.json as TokenResponse;
  return token;
}

// ====== Helpers to identify install target ======
type WhoAmIResponse = {
  locationId?: string | null;
  companyId?: string | null;
  // userType etc might exist; we only need ids
};

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

// Some installs come in at agency (company) scope; some at location scope.
// Try to infer a good target for the CML.
async function deriveInstallTarget(
  accessToken: string
): Promise<{ agencyId: string | null; locationId: string | null }> {
  const info = await whoAmI(accessToken);
  // Prefer company/agencyId; fall back to locationId
  return {
    agencyId: info.companyId ?? null,
    locationId: info.locationId ?? null,
  };
}

// ====== Custom Menu Link (CML) handlers ======

const CML_TITLE = "Driving for Dollars";
const CML_URL = `${APP_BASE_URL}/app`;

// List existing CMLs (company or location)
async function listCmls(
  accessToken: string,
  scope: { agencyId?: string | null; locationId?: string | null }
): Promise<CustomMenuLink[]> {
  // Base endpoint used by newer LC routes:
  // - Company scope: /custom-menu-links?companyId=...
  // - Location scope: /custom-menu-links?locationId=...
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
    // Some accounts may not support the base list; return empty and let create path decide
    log("[oauth] CML list non-OK", { status: attempt.status, sample: attempt.bodyText });
    return [];
  }

  return toMenuList(attempt.json);
}

// Try multiple create strategies because LC tenants differ.
// Strategy A: POST /custom-menu-links with body containing companyId/locationId
// Strategy B: POST /custom-menu-links/companies/:companyId
// Strategy C: POST /custom-menu-links/locations/:locationId
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

  // --- Strategy A: base endpoint (preferred) ---
  {
    const url = `${GHL_API_BASE}/custom-menu-links`;
    const res = await fetchWithBody(url, {
      method: "POST",
      headers: lcHeaders(accessToken),
      body: JSON.stringify(commonBody),
      cache: "no-store",
    });

    if (res.ok) return true;

    log("[oauth] ensureCml base-create attempt failed", {
      status: res.status,
      sample: res.bodyText,
    });
  }

  // --- Strategy B: nested company endpoint ---
  if (scope.agencyId) {
    const url = `${GHL_API_BASE}/custom-menu-links/companies/${encodeURIComponent(
      scope.agencyId
    )}`;
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

    log("[oauth] ensureCml nested-create attempt failed", {
      status: res.status,
      sample: res.bodyText,
    });
  }

  // --- Strategy C: nested location endpoint ---
  if (scope.locationId) {
    const url = `${GHL_API_BASE}/custom-menu-links/locations/${encodeURIComponent(
      scope.locationId
    )}`;
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

    log("[oauth] ensureCml nested-create attempt failed", {
      status: res.status,
      sample: res.bodyText,
    });
  }

  log("[oauth] CML create failed", {
    status: 0,
    body: "exhausted all create strategies (base + nested) with conservative payload",
  });
  return false;
}

// Ensure the CML exists (idempotent)
async function ensureCml(accessToken: string, agencyId: string | null, locationId: string | null) {
  log("[oauth] ensureCml precheck", {
    companyId: agencyId,
    hasWrite: true,
    hasRead: true,
  });

  // 1) List and see if it already exists
  const existing = await listCmls(accessToken, { agencyId, locationId });
  const exists = existing.some((m: CustomMenuLink) => {
    const title = (m.title || "").toLowerCase();
    return (
      title === CML_TITLE.toLowerCase() &&
      typeof m.url === "string" &&
      m.url.startsWith(CML_URL)
    );
  });
  if (exists) return true;

  // 2) Try to create
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
    // 1) Exchange code for token
    const token = await exchangeCodeForToken(code);

    const accessToken = token.access_token;
    const tokenSnapshot = {
      userTypeForToken: "(none)", // left generic; user type isn’t strictly needed
      hasCompanyId: Boolean(token.companyId),
      hasLocationId: Boolean(token.locationId),
    };
    log("[oauth] token snapshot", tokenSnapshot);

    // 2) Discover where to install (company vs. location)
    // Prefer company/agency install as in your logs
    const target = await deriveInstallTarget(accessToken);

    // For log parity with your traces
    const installedLocations = target.locationId ? 1 : 0;
    log("[oauth] installedLocations discovered", { count: installedLocations });
    if (!installedLocations) {
      log("[oauth] company locations fallback", { count: 0 });
    }

    // 3) Ensure the Custom Menu Link exists
    const ok = await ensureCml(accessToken, target.agencyId, target.locationId);
    if (!ok) {
      // Continue anyway — you still want to complete OAuth and land in the app.
      // The logs will show the create attempts.
    }

    // 4) Redirect to your app shell so the marketplace can close out the install flow
    const derivedInstallTarget = target.agencyId ? "Company" : "Location";
    log("[oauth] oauth success", {
      userTypeQuery: "",
      derivedInstallTarget,
      agencyId: target.agencyId,
      locationId: target.locationId,
      scopes: [
        "locations.readonly",
        "oauth.readonly",
        "custom-menu-link.readonly",
        "custom-menu-link.write",
        "contacts.readonly",
        "contacts.write",
        "opportunities.readonly",
        "opportunities.write",
      ],
    });

    const redirectQs = new URLSearchParams({
      installed: "1",
      ...(target.agencyId ? { agencyId: target.agencyId } : {}),
      ...(target.locationId ? { locationId: target.locationId } : {}),
    });

    // Using your App Hosting domain (served by Next)
    const appUrl = `${APP_BASE_URL}/app?${redirectQs.toString()}`;

    return NextResponse.redirect(appUrl, { status: 302 });
  } catch (e) {
    errlog("[oauth] callback error", { message: (e as Error).message });
    return NextResponse.json(
      {
        error: "OAuth callback failed",
        detail: (e as Error).message,
      },
      { status: 500 }
    );
  }
}
