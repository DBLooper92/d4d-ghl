// src/app/api/user-context/decode/route.ts
import { decryptUserContext } from "@/lib/ghlUserContext";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { encryptedData?: { iv: string; cipherText: string; tag: string } };
    if (!body?.encryptedData) {
      return new Response(JSON.stringify({ error: "Missing encryptedData" }), { status: 400 });
    }
    const ctx = decryptUserContext(body.encryptedData);
    return new Response(JSON.stringify(ctx), {
      headers: { "content-type": "application/json", "Cache-Control": "no-store" },
      status: 200,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Decode failed" }), { status: 400 });
  }
}
