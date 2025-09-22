import { NextRequest, NextResponse } from "next/server";
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  console.log("OAuth callback:", { code, error });
  const msg = error ? `OAuth error: ${error}` : "Success! Code received.";
  return new NextResponse(msg, { status: 200 });
}
