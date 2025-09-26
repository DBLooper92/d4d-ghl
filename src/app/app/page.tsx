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

  // Accept both styles: ?locationId=... or ?location_id=...
  const qpLocationId = qp.get("locationId") || qp.get("location_id");
  const qpAgencyId = qp.get("agencyId") || qp.get("agency_id");
  const qpInstalled = qp.get("installed") === "1";

  const [state, setState] = useState<InstalledResp>({
    installed: qpInstalled,
    agencyId: qpAgencyId,
    locationId: qpLocationId,
  });
  const [loading, setLoading] = useState(false);

  // If we have a locationId from the URL (e.g. GHL sidebar), verify against Firestore
  const shouldVerify = useMemo(() => !!qpLocationId, [qpLocationId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!shouldVerify) return;
      setLoading(true);
      try {
        const url = new URL("/api/installed", window.location.origin);
        url.searchParams.set("locationId", qpLocationId!);
        const r = await fetch(url.toString(), { cache: "no-store" });
        const json = (await r.json()) as InstalledResp;
        if (!cancelled) setState(json);
      } catch {
        if (!cancelled) {
          setState({
            installed: false,
            agencyId: null,
            locationId: qpLocationId || null,
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
  }, [shouldVerify, qpLocationId]);

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
