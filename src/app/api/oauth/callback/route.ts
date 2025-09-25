// File: src/app/api/oauth/callback/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/firebaseAdmin";
import {
  getGhlConfig,
  ghlTokenUrl,
  lcHeaders,
  OAuthTokens,
  olog,
  ghlCompanyLocationsUrl,
  ghlMintLocationTokenUrl,
} from "@/lib/ghl";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs"; // Node APIs for crypto/cookies

type InstallDoc = {
  provider: "leadconnector";
  agencyId: string | null;
  locationId?: string | null;
  scopes: string[];
  tokenMeta: {
    expiresIn: number;
    type: string;
    savedAt: FirebaseFirestore.FieldValue;
  };
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
};

// Types for /companies/{id}/locations response
type AnyLoc = {
  id?: string;
  _id?: string;
  locationId?: string;
  name?: string;
  isInstalled?: boolean;
};
type LCListLocationsResponse = { locations?: AnyLoc[] } | AnyLoc[];

function pickLocs(json: unknown): AnyLoc[] {
  if (Array.isArray(json)) return json.filter(isAnyLoc);
  if (isObj(json) && Array.isArray((json as { locations?: unknown }).locations)) {
    const arr = (json as { locations?: unknown }).locations;
    return (arr as unknown[]).filter(isAnyLoc) as AnyLoc[];
  }
  return [];
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isAnyLoc(v: unknown): v is AnyLoc {
  if (!isObj(v)) return false;
  return "id" in v || "locationId" in v || "_id" in v;
}
function safeId(l: AnyLoc): string | null {
  const cands = [l.id, l.locationId, l._id].map((x) => (typeof x === "string" ? x.trim() : ""));
  const id = cands.find((s) => s && s.length > 0);
  return id ?? null;
}
function safeName(l: AnyLoc): string | null {
  return typeof l.name === "string" && l.name.trim() ? l.name : null;
}
function safeInstalled(l: AnyLoc): boolean {
  return Boolean(l.isInstalled);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";

  // What GHL says it is installing *to* (Company | Location). We’ll pass this through to the token exchange.
  const userTypeQueryRaw =
    url.searchParams.get("user_type") ||
    url.searchParams.get("userType") ||
    "";
  const userTypeForToken =
    userTypeQueryRaw.toLowerCase() === "location"
      ? ("Location" as const)
      : userTypeQueryRaw.toLowerCase() === "company"
      ? ("Company" as const)
      : undefined;

  const state = url.searchParams.get("state") || "";
  const [nonce, rtB64] = state ? state.split("|") : ["", ""];

  const ck = await cookies();
  const cookieNonce = ck.get("d4d_oauth_state")?.value || "";

  // Allow fallback if coming from GHL and state omitted, else enforce state
  const hdrs = await headers();
  const referer = hdrs.get("referer") || "";
  const fromGhl = /gohighlevel\.com|leadconnector/i.test(referer);
  if (state) {
    if (!cookieNonce || cookieNonce !== nonce) {
      olog("state mismatch", { hasCookie: !!cookieNonce, nonceIn: !!nonce });
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }
  } else if (!fromGhl) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const { clientId, clientSecret, redirectUri, baseApp } = getGhlConfig();

  // 1) Exchange code → tokens
  // IMPORTANT: Send user_type exactly as provided by GHL so a Location install returns a location token.
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  if (userTypeForToken) form.set("user_type", userTypeForToken);

  const tokenResp = await fetch(ghlTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });

  const raw = await tokenResp.text();
  if (!tokenResp.ok) {
    olog("token exchange failed", { status: tokenResp.status, raw: raw.slice(0, 400) });
    return NextResponse.json({ error: "Token exchange failed" }, { status: 502 });
  }

  let tokens: OAuthTokens;
  try {
    tokens = JSON.parse(raw) as OAuthTokens;
  } catch {
    return NextResponse.json({ error: "Bad token JSON" }, { status: 502 });
  }

  const agencyId = tokens.companyId || null;
  const locationId = tokens.locationId || null;
  const scopeArr = (tokens.scope || "").split(" ").filter(Boolean);

  // Debug (safe): visibility only, no secrets
  olog("token snapshot", {
    userTypeForToken: userTypeForToken ?? "(none)",
    hasCompanyId: !!agencyId,
    hasLocationId: !!locationId,
  });

  // Derive install target; token payload is authoritative
  type InstallationTarget = "Company" | "Location";
  const installationTarget: InstallationTarget = locationId ? "Location" : "Company";

  // 2) Upsert installs/{installId or agencyId}
  const installsCol = db().collection("installs");
  let installRef = installsCol.doc();
  let isNew = true;

  if (agencyId) {
    const q = await installsCol.where("agencyId", "==", agencyId).limit(1).get();
    if (!q.empty) {
      installRef = q.docs[0].ref;
      isNew = false;
    }
  }

  const installDoc: InstallDoc = {
    provider: "leadconnector",
    agencyId,
    locationId,
    scopes: scopeArr,
    tokenMeta: {
      expiresIn: tokens.expires_in,
      type: tokens.token_type,
      savedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
  };
  await installRef.set(installDoc, { merge: true });

  // 3) Persist tokens in Firestore (NOT Secret Manager)
  if (agencyId && tokens.refresh_token) {
    await db()
      .collection("agencies")
      .doc(agencyId)
      .set(
        {
          agencyId,
          provider: "leadconnector",
          refreshToken: tokens.refresh_token,
          updatedAt: FieldValue.serverTimestamp(),
          ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
        },
        { merge: true }
      );
  }
  if (locationId && tokens.refresh_token) {
    await db()
      .collection("locations")
      .doc(locationId)
      .set(
        {
          locationId,
          agencyId,
          provider: "leadconnector",
          refreshToken: tokens.refresh_token,
          isInstalled: true,
          updatedAt: FieldValue.serverTimestamp(),
          ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
        },
        { merge: true }
      );
  }

  // 4) If Agency-level install, snapshot/relate locations and mint per-location tokens
  try {
    if (agencyId && installationTarget === "Company") {
      const locs: Array<{ id: string; name: string | null; isInstalled: boolean }> = [];
      const limit = 200;
      for (let page = 1; page < 999; page++) {
        const r = await fetch(ghlCompanyLocationsUrl(agencyId, page, limit), {
          headers: lcHeaders(tokens.access_token),
        });
        if (!r.ok) break;

        const j = (await r.json()) as LCListLocationsResponse;
        const arr = pickLocs(j);

        for (const e of arr) {
          const id = safeId(e);
          if (!id) continue;
          locs.push({ id, name: safeName(e), isInstalled: safeInstalled(e) });
        }
        if (arr.length < limit) break;
      }

      const batch = db().batch();
      const now = FieldValue.serverTimestamp();
      for (const l of locs) {
        const locRef = db().collection("locations").doc(l.id);
        batch.set(
          locRef,
          {
            locationId: l.id,
            agencyId,
            provider: "leadconnector",
            name: l.name,
            isInstalled: Boolean(l.isInstalled),
            updatedAt: now,
          },
          { merge: true }
        );
      }
      await batch.commit();

      // Mint per-location refresh tokens (best-effort)
      for (const l of locs) {
        const resp = await fetch(ghlMintLocationTokenUrl(), {
          method: "POST",
          headers: { ...lcHeaders(tokens.access_token), "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: agencyId, locationId: l.id }),
        });
        if (!resp.ok) continue;

        const body = (await resp.json()) as { data?: { refresh_token?: string }; refresh_token?: string };
        const tok = body?.data?.refresh_token ?? body?.refresh_token ?? "";
        if (!tok) continue;

        await db()
          .collection("locations")
          .doc(l.id)
          .set(
            {
              refreshToken: tok,
              isInstalled: true,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      }
    }
  } catch (e) {
    olog("location discovery/mint error", { message: (e as Error).message });
    // non-fatal
  }

  // 5) Send user to app
  const returnTo = rtB64 ? Buffer.from(rtB64, "base64url").toString("utf8") : `${baseApp}/app`;
  const ui = new URL(returnTo);
  ui.searchParams.set("installed", "1");
  if (agencyId) ui.searchParams.set("agencyId", agencyId);
  if (locationId) ui.searchParams.set("locationId", locationId);

  olog("oauth success", {
    userTypeQuery: userTypeForToken ?? "",
    derivedInstallTarget: installationTarget,
    agencyId,
    locationId,
    scopes: scopeArr.slice(0, 8),
    installId: installRef.id,
  });

  return NextResponse.redirect(ui.toString(), { status: 302 });
}
