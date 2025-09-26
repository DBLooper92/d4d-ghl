// src/lib/ghlTokens.ts
import { ghlTokenUrl } from "./ghl";

export type RefreshExchangeResponse = {
  access_token: string;
  scope?: string;
  token_type: string;
  expires_in: number;
};

export async function exchangeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<RefreshExchangeResponse> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const r = await fetch(ghlTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });

  const raw = await r.text();
  if (!r.ok) {
    throw new Error(`refresh exchange failed: ${r.status} ${raw.slice(0, 400)}`);
  }

  try {
    return JSON.parse(raw) as RefreshExchangeResponse;
  } catch {
    throw new Error(`refresh exchange bad JSON: ${raw.slice(0, 400)}`);
  }
}
