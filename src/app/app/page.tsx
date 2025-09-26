// File: src/app/app/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type InstalledResp = {
  installed: boolean;
  agencyId: string | null;
  locationId: string | null;
  // debug echo from API so you can see what it received
  _debug?: {
    href: string;
    qs: Record<string, string>;
    hash: string;
    pathSegs: string[];
    received: Record<string, string | undefined>;
  };
};

function pickLikelyLocationId({
  search,
  hash,
  pathname,
}: {
  search: URLSearchParams;
  hash: string;
  pathname: string;
}) {
  // 1) Query params (both styles)
  const fromQS =
    search.get("location_id") ||
    search.get("locationId") ||
    search.get("location") ||
    "";

  if (fromQS && fromQS.trim()) return fromQS.trim();

  // 2) Hash (#location_id=… or #/location/ID, seen in some GHL contexts)
  if (hash) {
    try {
      const h = hash.startsWith("#") ? hash.slice(1) : hash;
      // style: #location_id=TNxo…
      const asParams = new URLSearchParams(h);
      const fromHash =
        asParams.get("location_id") ||
        asParams.get("locationId") ||
        asParams.get("location") ||
        "";
      if (fromHash && fromHash.trim()) return fromHash.trim();
      // style: #/something/TNxoaN…
      const segs = h.split(/[/?&]/).filter(Boolean);
      const maybeId = segs.find((s) => s.length >= 12); // GHL ids are long-ish
      if (maybeId) return maybeId.trim();
    } catch {
      // ignore
    }
  }

  // 3) Path segment (/app/TNxoaN…)
  const segs = pathname.split("/").filter(Boolean);
  // if path is /app/<id>, the id will be the second segment
  const maybeId = segs.length >= 2 ? segs[1] : "";
  if (maybeId && maybeId.length >= 12) return maybeId.trim();

  return "";
}

function pickLikelyAgencyId(search: URLSearchParams) {
  const fromQS =
    search.get("agency_id") ||
    search.get("agencyId") ||
    search.get("companyId") ||
    "";
  return (fromQS || "").trim();
}

function DashboardInner() {
  const qp = useSearchParams();

  const qpInstalled = qp.get("installed") === "1";

  const [state, setState] = useState<InstalledResp>({
    installed: qpInstalled,
    agencyId: qp.get("agencyId") || qp.get("agency_id"),
    locationId: qp.get("locationId") || qp.get("location_id"),
  });
  const [loading, setLoading] = useState(false);

  // Compute robust ids from location.search / hash / pathname each render
  const derived = useMemo(() => {
    const url = typeof window !== "undefined" ? new URL(window.location.href) : null;
    if (!url) {
      return { locationId: state.locationId || null, agencyId: state.agencyId || null };
    }
    const locationId = pickLikelyLocationId({
      search: url.searchParams,
      hash: url.hash,
      pathname: url.pathname,
    });
    const agencyId = pickLikelyAgencyId(url.searchParams);
    return {
      locationId: locationId || state.locationId || null,
      agencyId: agencyId || state.agencyId || null,
      href: url.href,
    };
  }, [state.locationId, state.agencyId]);

  const shouldVerify = useMemo(
    () => Boolean(derived.locationId || derived.agencyId),
    [derived.locationId, derived.agencyId]
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!shouldVerify) return;
      setLoading(true);
      try {
        const url = new URL("/api/installed", window.location.origin);
        if (derived.locationId) url.searchParams.set("locationId", derived.locationId);
        if (derived.agencyId) url.searchParams.set("agencyId", derived.agencyId);
        // include a tiny debug flag so API echoes what it received (safe)
        url.searchParams.set("_debug", "1");

        const r = await fetch(url.toString(), { cache: "no-store" });
        const json = (await r.json()) as InstalledResp;
        if (!cancelled) setState(json);
      } catch {
        if (!cancelled) {
          setState({
            installed: false,
            agencyId: derived.agencyId || null,
            locationId: derived.locationId || null,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [shouldVerify, derived.locationId, derived.agencyId]);

  return (
    <main style={{ padding: 24 }}>
      <h1>D4D Dashboard</h1>

      {loading ? (
        <p>Checking install…</p>
      ) : state.installed ? (
        <p>Install complete ✅</p>
      ) : (
        <p>Welcome. Connect your GoHighLevel account to begin.</p>
      )}

      <p style={{ marginTop: 16 }}>
        <a href="/api/oauth/prepare">Connect / Reconnect GHL</a>
      </p>

      <pre style={{ marginTop: 24, background: "rgba(127,127,127,.1)", padding: 12 }}>
        {JSON.stringify(state, null, 2)}
      </pre>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main style={{ padding: 24 }}>
          <h1>D4D Dashboard</h1>
          <p>Loading…</p>
        </main>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
