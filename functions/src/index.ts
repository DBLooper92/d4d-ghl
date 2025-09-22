import * as functions from "firebase-functions";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

export const exchangeGHLToken = functions
  .region("us-central1").runWith({ secrets: ["GHL_CLIENT_ID","GHL_CLIENT_SECRET","GHL_SHARED_SECRET_KEY","GHL_REDIRECT_URI","GHL_WEBHOOK_PUBLIC_KEY","GHL_SCOPES"] })
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }
      const code = (req.query.code as string) || (req.body?.code as string);
      const redirect_uri = (req.query.redirect_uri as string) || (req.body?.redirect_uri as string);
      if (!code || !redirect_uri) {
        res.status(400).send("Missing code or redirect_uri");
        return;
      }

      const client_id = process.env.GHL_CLIENT_ID;
      const client_secret = process.env.GHL_CLIENT_SECRET;
      if (!client_id || !client_secret) {
        res.status(500).send("Missing GHL client credentials in env");
        return;
      }

      // Exchange code -> tokens
      const tokenUrl = "https://services.leadconnectorhq.com/oauth/token"; console.log("[exchange] using client_id:", (client_id||"").slice(0,6)+"..."+(client_id||"").slice(-4)); console.log("[exchange] redirect_uri:", redirect_uri); console.log("[exchange] code:", (code||"").slice(0,12)+"...");
      const user_type = (req.query.user_type as string) || (req.body?.user_type as string) || "Company";
      const form = new URLSearchParams();
      form.set("grant_type", "authorization_code");
      form.set("code", code);
      form.set("client_id", client_id);
      form.set("client_secret", client_secret);
      form.set("redirect_uri", redirect_uri);
      form.set("user_type", user_type);

      const tokenResp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: form.toString(),
      });

      if (!tokenResp.ok) {
        const txt = await tokenResp.text();
        res.status(502).send(`GHL token endpoint error ${tokenResp.status}: ${txt}`);
        return;
      }

      const tokens = (await tokenResp.json()) as TokenResponse;

      // Persist minimal record (you can extend this later)
      const db = getFirestore();
      const docRef = db.collection("ghlTokens").doc(); // random id for now
      await docRef.set({
        createdAt: Timestamp.now(),
        redirect_uri,
        response: tokens,
      });

      res.status(200).json({ id: docRef.id, locationId: tokens.locationId ?? null, scope: tokens.scope ?? null });
    } catch (e: any) {
      res.status(500).send(`Exchange error: ${e?.message ?? e}`);
    }
  });


