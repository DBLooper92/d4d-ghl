"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type InstalledResp = {
  installed: boolean;
  agencyId: string | null;
  locationId: string | null;
  _debug?: {
    href: string;
    qs: Record<string, string>;
    hash: string;
    pathSegs: string[];
    received: Record<string, string | undefined>;
  };
};

type EncryptedPayload = {
  iv: string;         // base64url
  cipherText: string; // base64url
  tag: string;        // base64url
};

type RequestUserDataResponse = {
  message: "REQUEST_USER_DATA_RESPONSE";
  payload: EncryptedPayload;
};

async function getMarketplaceUserContext(): Promise<{
  activeLocationId?: string;
  activeCompanyId?: string;
} | null> {
  // Ask GHL parent for encrypted user data
  const encrypted = await new Promise<EncryptedPayload | null>((resolve) => {
    try {
      window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
      const onMsg = (ev: MessageEvent<unknown>) => {
        const d = ev?.data as RequestUserDataResponse | undefined;
        if (d && d.message === "REQUEST_USER_DATA_RESPONSE" && d.payload) {
          window.removeEventListener("message", onMsg as EventListener);
          resolve(d.payload);
        }
      };
      window.addEventListener("message", onMsg as EventListener);
    } catch {
      resolve(null);
    }
  });

  if (!encrypted) return null;

  try {
    const r = await fetch("/api/user-context/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedData: encrypted }),
    });
    if (!r.ok) return null;
    const json = (await r.json()) as { activeLocationId?: string; activeCompanyId?: string };
    return json;
  } catch {
    return null;
  }
}

function pickLikelyLocationId({
  search,
  hash,
  pathname,
}: {
  search: URLSearchParams;
  hash: string;
  pathname: string;
}) {
  const fromQS =
    search.get("location_id") ||
    search.get("locationId") ||
    search.get("location") ||
    "";
  if (fromQS && fromQS.trim()) return fromQS.trim();

  if (hash) {
    try {
      const h = hash.startsWith("#") ? hash.slice(1) : hash;
      const asParams = new URLSearchParams(h);
      const fromHash =
        asParams.get("location_id") ||
        asParams.get("locationId") ||
        asParams.get("location") ||
        "";
      if (fromHash && fromHash.trim()) return fromHash.trim();
      const segs = h.split(/[/?&]/).filter(Boolean);
      const maybeId = segs.find((s) => s.length >= 12);
      if (maybeId) return maybeId.trim();
    } catch {
      // ignore
    }
  }

  const segs = pathname.split("/").filter(Boolean);
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

  // Derive IDs from URL each render
  const derived = useMemo(() => {
    const url = typeof window !== "undefined" ? new URL(window.location.href) : null;
    if (!url) {
      return { locationId: state.locationId || null, agencyId: state.agencyId || null, href: "" };
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

  // Single effect handles both cases:
  // - If we already have IDs ⇒ verify install immediately
  // - Else ⇒ try SSO user context, then verify
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      try {
        let agencyId = derived.agencyId ?? null;
        let locationId = derived.locationId ?? null;

        if (!agencyId && !locationId) {
          // Try Marketplace SSO
          const ctx = await getMarketplaceUserContext();
          agencyId = ctx?.activeCompanyId ?? null;
          locationId = ctx?.activeLocationId ?? null;
        }

        if (!agencyId && !locationId) {
          // Nothing to verify yet; show connect CTA
          if (!cancelled) setState((s) => ({ ...s, installed: false }));
          return;
        }

        const url = new URL("/api/installed", window.location.origin);
        if (locationId) url.searchParams.set("locationId", locationId);
        if (agencyId) url.searchParams.set("agencyId", agencyId);
        url.searchParams.set("_debug", "1");

        const r = await fetch(url.toString(), { cache: "no-store" });
        const json = (await r.json()) as InstalledResp;
        if (!cancelled) setState(json);
      } catch {
        if (!cancelled) {
          setState((s) => ({ ...s, installed: false }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [derived.agencyId, derived.locationId]);

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
