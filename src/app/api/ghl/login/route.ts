import { NextRequest, NextResponse } from "next/server";
export function GET(req: NextRequest) {
  const target = new URL(req.nextUrl.toString());
  target.pathname = "/api/oauth/login";
  return NextResponse.redirect(target, { status: 301 });
}
