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
  LCListLocationsResponse,
  pickLocs,
  safeId,
  safeInstalled,
  safeName,
  ghlInstalledLocationsUrl,
  ghlCompanyLocationsUrl,
  ghlMintLocationTokenUrl,
} from "@/lib/ghl";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs"; // Node APIs for crypto/cookies

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";

  // Pass through user_type only if GHL supplied it. We do not guess here.
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

  const { clientId, clientSecret, redirectUri, baseApp, integrationId } = getGhlConfig();

  // 1) Exchange code → tokens
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

  olog("token snapshot", {
    userTypeForToken: userTypeForToken ?? "(none)",
    hasCompanyId: !!agencyId,
    hasLocationId: !!locationId,
  });

  type InstallationTarget = "Company" | "Location";
  const installationTarget: InstallationTarget = locationId ? "Location" : "Company";

  // ─────────────────────────────────────────────────────────────────────────────
  // 2) Upsert agencies/{agencyId} with agency-level refresh token + metadata
  //    (doc id = agencyId). Also create/update subcollection agencies/{agencyId}/locations later.
  // ─────────────────────────────────────────────────────────────────────────────
  if (agencyId) {
    const agenciesRef = db().collection("agencies").doc(agencyId);
    const snap = await agenciesRef.get();
    const isNewAgency = !snap.exists;

    await agenciesRef.set(
      {
        agencyId,
        provider: "leadconnector",
        scopes: scopeArr,
        // Save the latest refresh token if present (agency token on Company installs)
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        installedAt: isNewAgency ? FieldValue.serverTimestamp() : snap.get("installedAt") ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3) If this was a Location install, persist that single location both top-level
  //    and under agencies/{agencyId}/locations/{locationId}
  // ─────────────────────────────────────────────────────────────────────────────
  if (agencyId && locationId) {
    // Top-level locations/{locationId}
    await db().collection("locations").doc(locationId).set(
      {
        locationId,
        agencyId,
        provider: "leadconnector",
        // For a Location install, this is a location-scoped refresh token
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        isInstalled: true,
        // Name is unknown at this point; it will be set during discovery/refresh paths
        name: null,
        installedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // agencies/{agencyId}/locations/{locationId}
    await db()
      .collection("agencies")
      .doc(agencyId)
      .collection("locations")
      .doc(locationId)
      .set(
        {
          locationId,
          agencyId,
          name: null,
          installedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4) Company-level path: discover locations & mint per-location tokens
  //    Writes to:
  //      - locations/{locationId} (top-level)
  //      - agencies/{agencyId}/locations/{locationId}
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    if (agencyId && installationTarget === "Company") {
      // First try the “installed locations” endpoint if we know our app/integration id
      let locs: Array<{ id: string; name: string | null; isInstalled: boolean }> = [];
      if (integrationId) {
        try {
          const r = await fetch(ghlInstalledLocationsUrl(agencyId, integrationId), {
            headers: lcHeaders(tokens.access_token),
          });
          if (r.ok) {
            const data = (await r.json()) as LCListLocationsResponse;
            const arr = pickLocs(data);
            locs = arr
              .map((e) => ({ id: safeId(e), name: safeName(e), isInstalled: safeInstalled(e) }))
              .filter((x): x is { id: string; name: string | null; isInstalled: boolean } => !!x.id);
            olog("installedLocations discovered", { count: locs.length });
          } else {
            olog("installedLocations failed, will fallback", { status: r.status, body: await r.text().catch(() => "") });
          }
        } catch (e) {
          olog("installedLocations error, will fallback", { err: String(e) });
        }
      }

      // Fallback to listing *all* company locations
      if (!locs.length) {
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
        olog("company locations fallback", { count: locs.length });
      }

      // Persist locations to both places (top-level & under agency subcollection)
      const batch = db().batch();
      const now = FieldValue.serverTimestamp();

      for (const l of locs) {
        // Top-level: locations/{locationId}
        const locRef = db().collection("locations").doc(l.id);
        batch.set(
          locRef,
          {
            locationId: l.id,
            agencyId,
            provider: "leadconnector",
            name: l.name ?? null,
            isInstalled: Boolean(l.isInstalled),
            installedAt: now,
            updatedAt: now,
          },
          { merge: true }
        );

        // agencies/{agencyId}/locations/{locationId}
        const agencyLocRef = db().collection("agencies").doc(agencyId).collection("locations").doc(l.id);
        batch.set(
          agencyLocRef,
          {
            locationId: l.id,
            agencyId,
            name: l.name ?? null,
            installedAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      }
      await batch.commit();

      // Mint & persist per-location refresh tokens (best effort)
      for (const l of locs) {
        try {
          const resp = await fetch(ghlMintLocationTokenUrl(), {
            method: "POST",
            headers: { ...lcHeaders(tokens.access_token), "Content-Type": "application/json" },
            body: JSON.stringify({ companyId: agencyId, locationId: l.id }),
          });
          if (!resp.ok) {
            const errTxt = await resp.text().catch(() => "");
            olog("mint failed", { locationId: l.id, status: resp.status, body: errTxt.slice(0, 300) });
            continue;
          }

          const body = (await resp.json()) as {
            data?: { refresh_token?: string; scope?: string; expires_in?: number; token_type?: string };
            refresh_token?: string; scope?: string; expires_in?: number; token_type?: string;
          };

          const mintedRefresh = body?.data?.refresh_token ?? body?.refresh_token ?? "";
          if (!mintedRefresh) {
            olog("mint missing refresh_token", { locationId: l.id });
            continue;
          }

          // Save refresh token under top-level locations/{locationId}
          await db().collection("locations").doc(l.id).set(
            {
              refreshToken: mintedRefresh,
              isInstalled: true,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } catch (e) {
          olog("mint error (non-fatal)", { locationId: l.id, err: String(e) });
        }
      }
    }
  } catch (e) {
    olog("location discovery/mint error", { message: (e as Error).message });
    // non-fatal
  }

  // 5) Redirect back to UI
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
  });

  return NextResponse.redirect(ui.toString(), { status: 302 });
}
