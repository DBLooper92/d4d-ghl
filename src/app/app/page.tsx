// File: src/app/app/page.tsx
"use client";

import { useSearchParams } from "next/navigation";

export default function Dashboard() {
  const qp = useSearchParams();
  const installed = qp.get("installed") === "1";
  const agencyId = qp.get("agencyId");
  const locationId = qp.get("locationId");

  return (
    <main style={{ padding: 24 }}>
      <h1>D4D Dashboard</h1>
      {installed ? (
        <p>Install complete ✅</p>
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
