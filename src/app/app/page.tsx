// File: src/app/app/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type InstalledResp = {
  installed: boolean;
  agencyId: string | null;
  locationId: string | null;
};

function DashboardInner() {
  const qp = useSearchParams();

  // 1) If we just returned from OAuth redirect, keep that quick happy path.
  const installedFromRedirect = qp.get("installed") === "1";
  const agencyIdFromRedirect = qp.get("agencyId");
  const locationIdFromRedirect = qp.get("locationId");

  // 2) Otherwise, attempt to resolve via /api/installed using whatever params we have
  const [resolved, setResolved] = useState<InstalledResp | null>(null);
  const [loading, setLoading] = useState(false);

  // Build a query string to forward to /api/installed (e.g. location_id from CML)
  const passthroughQs = useMemo(() => {
    const keys = ["location_id", "locationId", "location", "agency_id", "agencyId"];
    const params = new URLSearchParams();
    keys.forEach((k) => {
      const v = qp.get(k);
      if (v) params.set(k, v);
    });
    return params.toString();
  }, [qp]);

  useEffect(() => {
    // Only fetch if we are NOT on an OAuth-redirect success already
    if (!installedFromRedirect) {
      setLoading(true);
      const url = passthroughQs ? `/api/installed?${passthroughQs}` : `/api/installed`;
      fetch(url)
        .then((r) => r.json())
        .then((j: InstalledResp) => setResolved(j))
        .catch(() => setResolved({ installed: false, agencyId: null, locationId: null }))
        .finally(() => setLoading(false));
    }
  }, [installedFromRedirect, passthroughQs]);

  const installed = installedFromRedirect || Boolean(resolved?.installed);
  const agencyId = agencyIdFromRedirect ?? resolved?.agencyId ?? null;
  const locationId = locationIdFromRedirect ?? resolved?.locationId ?? null;

  return (
    <main style={{ padding: 24 }}>
      <h1>D4D Dashboard</h1>

      {installed ? (
        <p>Install complete ✅</p>
      ) : loading ? (
        <p>Connecting…</p>
      ) : (
        <p>Welcome. Connect your GoHighLevel account to begin.</p>
      )}

      <p style={{ marginTop: 16 }}>
        <a href="/api/oauth/prepare">Connect / Reconnect GHL</a>
      </p>

      <pre style={{ marginTop: 24, background: "rgba(127,127,127,.1)", padding: 12 }}>
        {JSON.stringify({ installed, agencyId, locationId }, null, 2)}
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
