// File: src/app/api/installed/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function truthyStr(v: unknown) {
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Accept several aliases (GHL can be inconsistent across contexts)
  const locationIdRaw =
    url.searchParams.get("location_id") ||
    url.searchParams.get("locationId") ||
    url.searchParams.get("location") ||
    url.searchParams.get("subAccountId") ||
    url.searchParams.get("accountId") ||
    "";

  const agencyIdRaw =
    url.searchParams.get("agency_id") ||
    url.searchParams.get("agencyId") ||
    url.searchParams.get("companyId") ||
    "";

  const wantDebug = url.searchParams.get("_debug") === "1";

  const locationIdIn = (locationIdRaw || "").trim();
  const agencyIdIn = (agencyIdRaw || "").trim();

  let installed = false;
  let agencyId: string | null = null;
  let finalLocationId: string | null = null;

  try {
    if (truthyStr(locationIdIn)) {
      // Primary: check a specific location doc
      const locSnap = await db().collection("locations").doc(locationIdIn).get();
      if (locSnap.exists) {
        const data = locSnap.data() || {};
        finalLocationId = locationIdIn;
        agencyId = (data.agencyId as string) || null;
        // consider installed if either refreshToken exists or isInstalled flag is true
        installed = Boolean(data.refreshToken) || Boolean(data.isInstalled);
      }
    } else if (truthyStr(agencyIdIn)) {
      // Fallback (agency-level CML): is there ANY installed location for this agency?
      const q = await db()
        .collection("locations")
        .where("agencyId", "==", agencyIdIn)
        .where("isInstalled", "==", true)
        .limit(1)
        .get();

      if (!q.empty) {
        const doc = q.docs[0];
        const data = doc.data() || {};
        agencyId = agencyIdIn;
        finalLocationId = (data.locationId as string) || doc.id;
        installed = true;
      } else {
        // As an additional fallback, consider agency installed if it has a refresh token
        const agSnap = await db().collection("agencies").doc(agencyIdIn).get();
        if (agSnap.exists) {
          const ag = agSnap.data() || {};
          if (truthyStr(ag.refreshToken)) {
            agencyId = agencyIdIn;
            installed = true;
          }
        }
      }
    }
  } catch {
    // Keep errors non-fatal for the UI
  }

  const base = {
    installed,
    agencyId,
    locationId: finalLocationId,
  };

  if (!wantDebug) {
    return NextResponse.json(base, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  // Debug echo (safe; contains only URL + what we parsed)
  const href = req.url;
  const u = new URL(href);
  const qs: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (qs[k] = v));
  const pathSegs = u.pathname.split("/").filter(Boolean);

  return NextResponse.json(
    {
      ...base,
      _debug: {
        href,
        qs,
        hash: u.hash,
        pathSegs,
        received: {
          location_id: url.searchParams.get("location_id") || undefined,
          locationId: url.searchParams.get("locationId") || undefined,
          location: url.searchParams.get("location") || undefined,
          subAccountId: url.searchParams.get("subAccountId") || undefined,
          accountId: url.searchParams.get("accountId") || undefined,
          agency_id: url.searchParams.get("agency_id") || undefined,
          agencyId: url.searchParams.get("agencyId") || undefined,
          companyId: url.searchParams.get("companyId") || undefined,
        },
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    }
  );
}
