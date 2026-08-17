import { NextResponse } from "next/server";
import { isAdmin, verifyAdminKeyResolved } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { PlaygroundConfigModel } from "@/models/PlaygroundConfig";
import { invalidatePlaygroundConfigCache } from "@/lib/playgroundConfig";
import { hashPassword } from "@/lib/postAuth";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/settings/admin-key — 관리자 암호 변경.
 * 현재 암호(DB 해시 또는 env 키) 확인 후 새 암호의 scrypt 해시를 DB에 저장.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { oldKey?: string; newKey?: string } | null;
  const oldKey = typeof body?.oldKey === "string" ? body.oldKey : "";
  const newKey = typeof body?.newKey === "string" ? body.newKey.trim() : "";

  if (newKey.length < 8) {
    return NextResponse.json({ ok: false, error: "새 암호는 8자 이상이어야 합니다." }, { status: 400 });
  }
  if (!(await verifyAdminKeyResolved(oldKey))) {
    return NextResponse.json({ ok: false, error: "현재 암호가 올바르지 않습니다." }, { status: 401 });
  }

  await connectDb();
  await PlaygroundConfigModel.findOneAndUpdate(
    { key: "default" },
    { $set: { key: "default", adminKeyHash: hashPassword(newKey), updatedBy: "admin" } },
    { upsert: true },
  );
  invalidatePlaygroundConfigCache();
  return NextResponse.json({ ok: true });
}
