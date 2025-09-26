// File: src/app/api/installed/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function truthyStr(v: unknown) {
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Accept several aliases (GHL uses snake_case in CML)
  const locationIdRaw =
    url.searchParams.get("location_id") ||
    url.searchParams.get("locationId") ||
    url.searchParams.get("location") ||
    "";

  const agencyIdRaw =
    url.searchParams.get("agency_id") ||
    url.searchParams.get("agencyId") ||
    "";

  const locationIdIn = locationIdRaw.trim();
  const agencyIdIn = agencyIdRaw.trim();

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
    // Swallow errors; return a safe response
  }

  return NextResponse.json(
    { installed, agencyId, locationId: finalLocationId },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        // Helpful for embeds
        "X-Robots-Tag": "noindex",
      },
    }
  );
}
