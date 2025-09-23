// File: src/app/api/debug/ghl/installed/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL?.trim();
  if (!base) return NextResponse.json({ error: "Missing NEXT_PUBLIC_FUNCTIONS_BASE_URL" }, { status: 500 });

  const url = `${base}/getInstalledLocations`;
  try {
    const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const text = await r.text();
    // Return raw text so you see exactly what GHL returns (JSON string or error)
    return new NextResponse(text, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") || "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
