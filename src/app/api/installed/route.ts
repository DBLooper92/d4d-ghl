// File: src/app/api/installed/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function truthyStr(v: unknown) {
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Accept several aliases just in case the CML is configured differently
  const locationId =
    url.searchParams.get("location_id") ||
    url.searchParams.get("locationId") ||
    url.searchParams.get("location") ||
    "";

  const agencyIdIn =
    url.searchParams.get("agency_id") ||
    url.searchParams.get("agencyId") ||
    "";

  let installed = false;
  let agencyId: string | null = null;
  let finalLocationId: string | null = null;

  try {
    if (truthyStr(locationId)) {
      // Look up the location doc
      const locSnap = await db().collection("locations").doc(locationId!).get();
      if (locSnap.exists) {
        const data = locSnap.data() || {};
        finalLocationId = locationId!;
        agencyId = (data.agencyId as string) || null;
        // consider installed if either refreshToken exists or isInstalled flag is true
        installed = Boolean(data.refreshToken) || Boolean(data.isInstalled);
      }
    } else if (truthyStr(agencyIdIn)) {
      // Fallback: agency level check (less precise inside the left menu)
      const agSnap = await db().collection("agencies").doc(agencyIdIn!).get();
      if (agSnap.exists) {
        const data = agSnap.data() || {};
        agencyId = agencyIdIn!;
        installed = Boolean(data.refreshToken);
      }
    }
  } catch {
    // Keep errors non-fatal for the UI
  }

  return NextResponse.json(
    {
      installed,
      agencyId,
      locationId: finalLocationId,
    },
    { status: 200 }
  );
}
