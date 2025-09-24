// functions/src/index.ts
import * as functions from "firebase-functions";
import { initializeApp, getApps } from "firebase-admin/app";
import crypto from "node:crypto";
import { upsertInstallTokens, installDocIdForAgency, installDocIdForLocation, readInstallByAgencyId, readAnyAgencyInstall, updateTokens, } from "./ghlStore.js";
if (!getApps().length) {
    initializeApp();
}
const sha12 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
// --- NEW: identity probe to classify token when payload lacks ids ---
async function whoAmI(accessToken) {
    const url = "https://services.leadconnectorhq.com/users/me";
    const r = await fetch(url, {
        method: "GET",
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-07-28",
        },
    });
    let body = {};
    try {
        body = await r.json();
    }
    catch { /* ignore parse errors */ }
    // Try a few shapes commonly seen
    const companyId = String(body?.company?.id ?? body?.agency?.id ?? body?.companyId ?? "").trim() || undefined;
    const locationId = String(body?.location?.id ?? body?.account?.id ?? body?.locationId ?? "").trim() || undefined;
    console.info("[whoAmI]", {
        ok: r.ok,
        status: r.status,
        hasCompany: !!companyId,
        hasLocation: !!locationId,
    });
    return { companyId, locationId };
}
async function refreshAccessToken(refreshToken) {
    const client_id = (process.env.GHL_CLIENT_ID || "").trim();
    const client_secret = (process.env.GHL_CLIENT_SECRET || "").trim();
    const form = new URLSearchParams({
        grant_type: "refresh_token",
        client_id,
        client_secret,
        refresh_token: refreshToken,
    });
    const r = await fetch("https://services.leadconnectorhq.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form,
    });
    if (!r.ok) {
        const txt = await r.text();
        console.error("[refreshAccessToken] failed", { status: r.status, body: txt.slice(0, 500) });
        throw new Error(`refresh failed ${r.status}: ${txt}`);
    }
    const tokens = (await r.json());
    console.info("[refreshAccessToken] ok", {
        scopeLen: (tokens.scope || "").split(" ").filter(Boolean).length,
        hasRefresh: !!tokens.refresh_token,
    });
    return tokens;
}
async function callInstalledLocations(accessToken) {
    const url = "https://services.leadconnectorhq.com/oauth/installedLocations";
    const r = await fetch(url, {
        method: "GET",
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-07-28",
        },
    });
    console.info("[installedLocations]", { status: r.status });
    return r;
}
async function mintLocationTokenWithAgency(agencyAccessToken, locationId) {
    const url = "https://services.leadconnectorhq.com/oauth/locationToken";
    const body = JSON.stringify({ locationId });
    const r = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${agencyAccessToken}`,
            Version: "2021-07-28",
        },
        body,
    });
    if (!r.ok) {
        const txt = await r.text();
        console.error("[locationToken] failed", { status: r.status, body: txt.slice(0, 500) });
        throw new Error(`locationToken ${r.status}: ${txt}`);
    }
    const tokens = (await r.json());
    console.info("[locationToken] ok", {
        scopeLen: (tokens.scope || "").split(" ").filter(Boolean).length,
        hasRefresh: !!tokens.refresh_token,
    });
    return tokens;
}
/**
 * Exchange authorization code for tokens and persist to Firestore.
 * Uses /users/me to classify when the token payload lacks ids.
 */
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
    const execId = req?.headers?.["function-execution-id"] || "";
    try {
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }
        const code = req.query.code || req.body?.code;
        const redirect_uri = (req.query.redirect_uri || req.body?.redirect_uri || "").trim();
        const user_type = (req.query.user_type || req.body?.user_type || "Company").trim();
        const client_id = (process.env.GHL_CLIENT_ID || "").trim();
        const client_secret = (process.env.GHL_CLIENT_SECRET || "").trim();
        console.info("[exchange/start]", {
            execId,
            method: req.method,
            hasCode: !!code,
            redirectFp: redirect_uri ? sha12(redirect_uri) : "(none)",
            user_type_hint: user_type,
            clientIdFp: client_id ? sha12(client_id) : "(empty)",
        });
        if (!code || !redirect_uri) {
            res.status(400).send("Missing code or redirect_uri");
            return;
        }
        if (!client_id || !client_secret) {
            res.status(500).send("Missing GHL client credentials in env");
            return;
        }
        // Exchange code -> tokens
        const form = new URLSearchParams();
        form.set("grant_type", "authorization_code");
        form.set("code", code);
        form.set("client_id", client_id);
        form.set("client_secret", client_secret);
        form.set("redirect_uri", redirect_uri);
        form.set("user_type", user_type);
        const tokenResp = await fetch("https://services.leadconnectorhq.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: form.toString(),
        });
        if (!tokenResp.ok) {
            const txt = await tokenResp.text();
            console.error("[exchange/token] error", { status: tokenResp.status, body: txt.slice(0, 800) });
            res.status(502).send(`GHL token endpoint error ${tokenResp.status}: ${txt}`);
            return;
        }
        const tokens = (await tokenResp.json());
        // First-pass ids from token payload (may be missing!)
        let companyId = tokens.companyId || undefined;
        let locationId = tokens.locationId || undefined;
        console.info("[exchange/token] received", {
            hasCompanyInToken: !!companyId,
            hasLocationInToken: !!locationId,
            scopeLen: (tokens.scope || "").split(" ").filter(Boolean).length,
            hasRefresh: !!tokens.refresh_token,
        });
        // If either id is missing, probe identity
        if (!companyId || !locationId) {
            try {
                const me = await whoAmI(tokens.access_token);
                companyId = companyId || me.companyId;
                locationId = locationId || me.locationId;
            }
            catch (e) {
                console.warn("[exchange/whoAmI] failed", { message: e?.message ?? String(e) });
            }
        }
        const isLocation = !!locationId;
        const clientIdFingerprint = sha12(client_id);
        const docId = isLocation
            ? installDocIdForLocation(String(locationId))
            : installDocIdForAgency(companyId ?? null, clientIdFingerprint);
        console.info("[exchange/classify]", {
            user_type_hint: user_type,
            decided: isLocation ? "Location" : "Company",
            docId,
            companyId: companyId ?? null,
            locationId: locationId ?? null,
        });
        await upsertInstallTokens(docId, {
            companyId: companyId ?? null,
            locationId: locationId ?? null,
            scopes: tokens.scope ? tokens.scope.split(" ").filter(Boolean) : [],
            tokens,
        });
        res.status(200).json({
            id: docId,
            companyId: companyId ?? null,
            locationId: locationId ?? null,
            scope: tokens.scope ?? null,
            decided: isLocation ? "Location" : "Company",
        });
        return;
    }
    catch (e) {
        console.error("[exchange/fatal]", { execId, message: e?.message ?? String(e) });
        res.status(500).send(`Exchange error: ${e?.message ?? e}`);
        return;
    }
});
/**
 * GET /getInstalledLocations  (unchanged, now logs)
 */
export const getInstalledLocations = functions
    .region("us-central1")
    .runWith({ secrets: ["GHL_CLIENT_ID", "GHL_CLIENT_SECRET"] })
    .https.onRequest(async (req, res) => {
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
        const explicitCompany = req.query.companyId || "";
        console.info("[installed/start]", { explicitCompany: explicitCompany || "(none)" });
        let agencyInstall = null;
        if (explicitCompany) {
            agencyInstall = await readInstallByAgencyId(explicitCompany);
            if (!agencyInstall) {
                res.status(404).json({ error: "Agency install not found for companyId", companyId: explicitCompany });
                return;
            }
        }
        else {
            agencyInstall = await readAnyAgencyInstall();
            if (!agencyInstall) {
                res.status(404).json({ error: "No agency install found. Install the app at the agency level first." });
                return;
            }
        }
        const { id: docId, data } = agencyInstall;
        let accessToken = data?.tokens?.access_token;
        const refreshToken = data?.tokens?.refresh_token || undefined;
        console.info("[installed/doc]", { docId, hasRefresh: !!refreshToken });
        if (!accessToken) {
            res.status(400).json({ error: "No access_token stored for agency install", docId });
            return;
        }
        let ghRes = await callInstalledLocations(accessToken);
        if (ghRes.status === 401 && refreshToken) {
            try {
                const rotated = await refreshAccessToken(refreshToken);
                await updateTokens(docId, rotated);
                accessToken = rotated.access_token;
                ghRes = await callInstalledLocations(accessToken);
            }
            catch (e) {
                const body = await ghRes.text();
                res.status(401).json({ error: "Access token expired and refresh failed", cause: e?.message ?? String(e), lastResponse: body });
                return;
            }
        }
        const text = await ghRes.text();
        res.status(ghRes.status).send(text);
        return;
    }
    catch (e) {
        console.error("[installed/fatal]", { message: e?.message ?? String(e) });
        res.status(500).json({ error: e?.message ?? String(e) });
        return;
    }
});
/**
 * POST /mintLocationToken?companyId=...&locationId=...
 */
export const mintLocationToken = functions
    .region("us-central1")
    .runWith({ secrets: ["GHL_CLIENT_ID", "GHL_CLIENT_SECRET"] })
    .https.onRequest(async (req, res) => {
    try {
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }
        const companyId = req.query.companyId || "";
        const locationId = req.query.locationId || "";
        console.info("[mintLocation/start]", { companyId, locationId });
        if (!companyId || !locationId) {
            res.status(400).json({ error: "Both companyId and locationId are required" });
            return;
        }
        const agency = await readInstallByAgencyId(companyId);
        if (!agency) {
            res.status(404).json({ error: "Agency install not found for companyId", companyId });
            return;
        }
        let accessToken = agency.data.tokens.access_token;
        const refreshToken = agency.data.tokens.refresh_token || undefined;
        try {
            const locTokens = await mintLocationTokenWithAgency(accessToken, locationId);
            await upsertInstallTokens(installDocIdForLocation(locationId), {
                companyId,
                locationId,
                scopes: locTokens.scope ? locTokens.scope.split(" ").filter(Boolean) : [],
                tokens: locTokens,
            });
            res.status(200).json({ ok: true, locationId, stored: true });
            return;
        }
        catch (errFirst) {
            console.warn("[mintLocation/firstTry] failed, will attempt refresh", { message: errFirst?.message ?? String(errFirst) });
            if (refreshToken) {
                const rotated = await refreshAccessToken(refreshToken);
                await updateTokens(agency.id, rotated);
                accessToken = rotated.access_token;
                const locTokens = await mintLocationTokenWithAgency(accessToken, locationId);
                await upsertInstallTokens(installDocIdForLocation(locationId), {
                    companyId,
                    locationId,
                    scopes: locTokens.scope ? locTokens.scope.split(" ").filter(Boolean) : [],
                    tokens: locTokens,
                });
                res.status(200).json({ ok: true, locationId, stored: true, refreshedAgencyToken: true });
                return;
            }
            throw errFirst;
        }
    }
    catch (e) {
        console.error("[mintLocation/fatal]", { message: e?.message ?? String(e) });
        res.status(500).json({ error: e?.message ?? String(e) });
        return;
    }
});
/**
 * POST /backfillLocations  (unchanged logic, extra logs)
 */
export const backfillLocations = functions
    .region("us-central1")
    .runWith({ secrets: ["GHL_CLIENT_ID", "GHL_CLIENT_SECRET"] })
    .https.onRequest(async (req, res) => {
    try {
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }
        const companyId = req.query.companyId ||
            req.body?.companyId ||
            "";
        console.info("[backfill/start]", { companyId: companyId || "(auto)" });
        const agency = companyId ? await readInstallByAgencyId(companyId) : await readAnyAgencyInstall();
        if (!agency) {
            res.status(404).json({ error: "Agency install not found" });
            return;
        }
        let accessToken = agency.data.tokens.access_token;
        const refreshToken = agency.data.tokens.refresh_token || undefined;
        // fetch locations (retry once on 401)
        let r = await callInstalledLocations(accessToken);
        if (r.status === 401 && refreshToken) {
            const rotated = await refreshAccessToken(refreshToken);
            await updateTokens(agency.id, rotated);
            accessToken = rotated.access_token;
            r = await callInstalledLocations(accessToken);
        }
        if (!r.ok) {
            const txt = await r.text();
            console.error("[backfill/installed] failed", { status: r.status, body: txt.slice(0, 800) });
            res.status(r.status).json({ error: "installedLocations failed", body: txt });
            return;
        }
        const payload = (await r.json());
        const locs = Array.isArray(payload?.locations)
            ? payload.locations.map((l) => String(l.id)).filter(Boolean)
            : [];
        console.info("[backfill/locations]", { count: locs.length });
        const minted = [];
        for (const locId of locs) {
            try {
                const locTokens = await mintLocationTokenWithAgency(accessToken, locId);
                await upsertInstallTokens(installDocIdForLocation(locId), {
                    companyId: agency.data.companyId ?? null,
                    locationId: locId,
                    scopes: locTokens.scope ? locTokens.scope.split(" ").filter(Boolean) : [],
                    tokens: locTokens,
                });
                minted.push(locId);
            }
            catch (e) {
                console.warn("[backfill/mintOne] failed", { locId, message: e?.message ?? String(e) });
            }
        }
        res.status(200).json({
            ok: true,
            companyId: agency.data.companyId ?? null,
            locationsFound: locs.length,
            locationsMinted: minted.length,
            minted,
        });
        return;
    }
    catch (e) {
        console.error("[backfill/fatal]", { message: e?.message ?? String(e) });
        res.status(500).json({ error: e?.message ?? String(e) });
        return;
    }
});
/**
 * (Optional) GET /debugInstall?docId=...  – quick peek at what we stored
 */
export const debugInstall = functions
    .region("us-central1")
    .https.onRequest(async (req, res) => {
    try {
        const docId = req.query.docId || "";
        if (!docId) {
            res.status(400).json({ error: "docId required" });
            return;
        }
        const { getFirestore } = await import("firebase-admin/firestore");
        const snap = await getFirestore().collection("installs").doc(docId).get();
        if (!snap.exists) {
            res.status(404).json({ error: "not found", docId });
            return;
        }
        const data = snap.data();
        // redact token strings
        if (data?.tokens) {
            data.tokens = {
                ...data.tokens,
                access_token: data.tokens.access_token ? "redacted" : null,
                refresh_token: data.tokens.refresh_token ? "redacted" : null,
            };
        }
        res.status(200).json({ docId, data });
    }
    catch (e) {
        res.status(500).json({ error: e?.message ?? String(e) });
    }
});
