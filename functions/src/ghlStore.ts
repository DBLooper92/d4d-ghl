// functions/src/ghlStore.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export type StoredTokens = {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_in: number;
  scope?: string;
  savedAt: FirebaseFirestore.FieldValue;
};

export type InstallDoc = {
  provider: "leadconnector";
  companyId?: string | null;
  locationId?: string | null;
  scopes?: string[];
  tokens: StoredTokens;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
};

function db() {
  if (!getApps().length) initializeApp();
  return getFirestore();
}

export function installDocIdForAgency(companyId?: string | null, clientIdFingerprint?: string) {
  if (companyId && String(companyId).trim()) return `agency_${companyId}`;
  return `agency_byClient_${clientIdFingerprint ?? "unknown"}`;
}

export function installDocIdForLocation(locationId: string) {
  return `location_${locationId}`;
}

export async function upsertInstallTokens(docId: string, payload: {
  companyId?: string | null;
  locationId?: string | null;
  scopes?: string[];
  tokens: {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
    scope?: string;
  };
}) {
  const scopes = payload.scopes ?? (payload.tokens.scope ? payload.tokens.scope.split(" ").filter(Boolean) : []);
  const data: InstallDoc = {
    provider: "leadconnector",
    companyId: payload.companyId ?? null,
    locationId: payload.locationId ?? null,
    scopes,
    tokens: {
      access_token: payload.tokens.access_token,
      refresh_token: payload.tokens.refresh_token ?? null,
      token_type: payload.tokens.token_type,
      expires_in: payload.tokens.expires_in,
      scope: payload.tokens.scope,
      savedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  };

  const ref = db().collection("installs").doc(docId);
  const snap = await ref.get();
  const isNew = !snap.exists;

  console.info("[install/upsert]", {
    docId,
    isNew,
    companyId: data.companyId ?? null,
    locationId: data.locationId ?? null,
    scopesCount: data.scopes?.length ?? 0,
    hasRefresh: !!data.tokens.refresh_token,
  });

  if (isNew) {
    data.createdAt = FieldValue.serverTimestamp();
  }
  await ref.set(data, { merge: true });
}

export async function readInstallByAgencyId(companyId: string) {
  const id = installDocIdForAgency(companyId);
  const snap = await db().collection("installs").doc(id).get();
  console.info("[install/readByAgencyId]", { companyId, found: snap.exists, id });
  return snap.exists ? { id, data: snap.data() as InstallDoc } : null;
}

export async function readAnyAgencyInstall() {
  const q = await db().collection("installs")
    .where("provider", "==", "leadconnector")
    .where("companyId", "!=", null)
    .limit(1)
    .get();
  const found = !q.empty;
  console.info("[install/readAnyAgencyInstall]", { found });
  if (!found) return null;
  const d = q.docs[0];
  return { id: d.id, data: d.data() as InstallDoc };
}

export async function updateTokens(docId: string, tokens: {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}) {
  console.info("[install/updateTokens]", {
    docId,
    scopeLen: (tokens.scope || "").split(" ").filter(Boolean).length,
    hasRefresh: !!tokens.refresh_token,
  });

  await db().collection("installs").doc(docId).set({
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      savedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
