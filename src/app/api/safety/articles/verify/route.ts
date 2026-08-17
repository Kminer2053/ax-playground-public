import { NextResponse } from "next/server";
import { canManageSafety } from "@/lib/safety";

export const dynamic = "force-dynamic";

/** POST /api/safety/articles/verify { password } — 관리 권한 확인(언락용). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ok = await canManageSafety(typeof body.password === "string" ? body.password : "");
  return NextResponse.json({ ok });
}
