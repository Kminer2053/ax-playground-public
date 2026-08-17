import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { PlaygroundConfigModel } from "@/models/PlaygroundConfig";
import { getPlaygroundConfig, invalidatePlaygroundConfigCache } from "@/lib/playgroundConfig";

export const dynamic = "force-dynamic";

const NUM_FIELDS: Record<string, [number, number]> = {
  popularWindowDays: [1, 365],
  popularMinLikes: [0, 10_000],
  popularCount: [1, 50],
  quizTimeLimitSec: [3, 600],
};

/** GET /api/admin/playground-config — 운영 설정 조회 (admin). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const config = await getPlaygroundConfig();
  return NextResponse.json({ ok: true, config });
}

/** PATCH /api/admin/playground-config — 운영 설정 저장 + 캐시 무효화 (admin). */
export async function PATCH(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });

  const update: Record<string, unknown> = { key: "default", updatedBy: "admin" };
  for (const [f, [min, max]] of Object.entries(NUM_FIELDS)) {
    if (body[f] != null) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < min || n > max) {
        return NextResponse.json({ error: `${f}는 ${min}~${max} 범위여야 합니다.` }, { status: 400 });
      }
      update[f] = Math.floor(n);
    }
  }

  await connectDb();
  await PlaygroundConfigModel.findOneAndUpdate({ key: "default" }, { $set: update }, { upsert: true });
  invalidatePlaygroundConfigCache();
  const config = await getPlaygroundConfig();
  return NextResponse.json({ ok: true, config });
}
