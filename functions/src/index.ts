// File: functions/src/index.ts
import * as functions from "firebase-functions";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";

// Initialize Admin SDK (default credentials in Firebase environment)
if (!getApps().length) {
  initializeApp();
}

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  locationId?: string;
  [key: string]: any;
};

// Small helper for short fingerprints in logs (non-sensitive)
const sha12 = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

export const exchangeGHLToken = functions
  .region("us-central1")
  .runWith({
    secrets: [
      "GHL_CLIENT_ID",
      "GHL_CLIENT_SECRET",
      "GHL_SHARED_SECRET_KEY",
      "GHL_REDIRECT_URI",
      "GHL_WEBHOOK_PUBLIC_KEY",
      "GHL_SCOPES",
    ],
  })
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      const code = (req.query.code as string) || (req.body?.code as string);
      const redirect_uri = ((req.query.redirect_uri as string) || (req.body?.redirect_uri as string) || "").trim();
      const user_type = ((req.query.user_type as string) || (req.body?.user_type as string) || "Company").trim();

      if (!code || !redirect_uri) {
        res.status(400).send("Missing code or redirect_uri");
        return;
      }

      // IMPORTANT: trim to strip stray spaces/newlines from Secret Manager values
      const client_id = (process.env.GHL_CLIENT_ID || "").trim();
      const client_secret = (process.env.GHL_CLIENT_SECRET || "").trim();

      console.log("[exchange] fp client_id:", sha12(client_id));
      console.log("[exchange] fp redirect_env:", sha12((process.env.GHL_REDIRECT_URI || "").trim()));
      console.log("[exchange] fp redirect_sent:", sha12(redirect_uri));
      console.log("[exchange] user_type:", user_type);

      if (!client_id || !client_secret) {
        res.status(500).send("Missing GHL client credentials in env");
        return;
      }

      // Exchange code -> tokens
      const tokenUrl = "https://services.leadconnectorhq.com/oauth/token";
      console.log("[exchange] using client_id:", (client_id || "").slice(0, 6) + "..." + (client_id || "").slice(-4));
      console.log("[exchange] redirect_uri:", redirect_uri);
      console.log("[exchange] code:", (code || "").slice(0, 12) + "...");

      const form = new URLSearchParams();
      form.set("grant_type", "authorization_code");
      form.set("code", code);
      form.set("client_id", client_id);
      form.set("client_secret", client_secret);
      form.set("redirect_uri", redirect_uri);
      form.set("user_type", user_type);

      const tokenResp = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form.toString(),
      });

      if (!tokenResp.ok) {
        const txt = await tokenResp.text();
        res.status(502).send(`GHL token endpoint error ${tokenResp.status}: ${txt}`);
        return;
      }

      const tokens = (await tokenResp.json()) as TokenResponse;

      // Persist deterministic record: agency_<first6(client_id)> OR loc_<locationId>
      const db = getFirestore();
      const userType = user_type as "Company" | "Location";
      const docId = tokens.locationId
        ? `loc_${tokens.locationId}`
        : `agency_${(client_id || "").slice(0, 6)}`;

      await db.collection("ghlTokens").doc(docId).set(
        {
          createdAt: Timestamp.now(),
          userType,
          redirect_uri,
          response: tokens,
        },
        { merge: true }
      );

      res.status(200).json({
        id: docId,
        locationId: tokens.locationId ?? null,
        scope: tokens.scope ?? null,
      });
    } catch (e: any) {
      res.status(500).send(`Exchange error: ${e?.message ?? e}`);
    }
  });

/**
 * getInstalledLocations — quick verifier that your Agency install is recognized by GHL.
 * Looks up the agency token doc (agency_<first6(client_id)>) and calls the GHL endpoint.
 *
 * GET /getInstalledLocations
 */
export const getInstalledLocations = functions
  .region("us-central1")
  .runWith({
    secrets: ["GHL_CLIENT_ID"],
  })
  .https.onRequest(async (req, res) => {
    // Allow simple browser calls while testing
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const client_id = (process.env.GHL_CLIENT_ID || "").trim();
      const agencyDocId = `agency_${(client_id || "").slice(0, 6)}`;

      const db = getFirestore();
      const snap = await db.collection("ghlTokens").doc(agencyDocId).get();
      if (!snap.exists) {
        res.status(404).json({ error: "Agency token not found", agencyDocId });
        return;
      }

      const agency = snap.data() as any;
      const accessToken = agency?.response?.access_token as string | undefined;
      if (!accessToken) {
        res.status(400).json({ error: "Agency access_token missing in stored record", agencyDocId });
        return;
      }

      const url = "https://services.leadconnectorhq.com/oauth/installedLocations";
      const ghRes = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const text = await ghRes.text();
      res.status(ghRes.status).send(text);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });
