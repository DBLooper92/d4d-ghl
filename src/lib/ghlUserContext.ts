// src/lib/ghlUserContext.ts
import crypto from "node:crypto";

function getSharedSecret(): string {
  const k = process.env.GHL_SHARED_SECRET_KEY || "";
  if (!k) throw new Error("Missing GHL_SHARED_SECRET_KEY");
  return k;
}

export type EncryptedPayload = {
  iv: string;         // base64url
  cipherText: string; // base64url
  tag: string;        // base64url (GCM auth tag)
};

export type UserContext = {
  user: {
    id: string;
    email?: string;
    name?: string;
    type: "Company" | "Location" | string;
  };
  activeCompanyId?: string;  // agency/company id
  activeLocationId?: string; // subaccount/location id
  roles?: string[];
};

export function decryptUserContext(input: EncryptedPayload): UserContext {
  const key = Buffer.from(getSharedSecret(), "utf8");
  const iv = Buffer.from(input.iv, "base64url");
  const tag = Buffer.from(input.tag, "base64url");
  const cipherText = Buffer.from(input.cipherText, "base64url");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    crypto.createHash("sha256").update(key).digest(),
    iv
  );
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  const json = JSON.parse(dec.toString("utf8"));

  const ctx: UserContext = {
    user: {
      id: String(json?.user?.id ?? ""),
      email: json?.user?.email ?? undefined,
      name: json?.user?.name ?? undefined,
      type: String(json?.user?.type ?? ""),
    },
    activeCompanyId: json?.activeCompanyId ?? json?.companyId ?? undefined,
    activeLocationId: json?.activeLocationId ?? json?.locationId ?? undefined,
    roles: Array.isArray(json?.roles) ? json.roles : undefined,
  };
  return ctx;
}
