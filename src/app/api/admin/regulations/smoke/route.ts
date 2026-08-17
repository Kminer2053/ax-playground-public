/**
 * 관리자 미니 벤치 — 저장된 예상 질문(metadata.smokeQuestions) 전 문서 일괄 스모크.
 * 회수 단계만 검사(LLM 무관)라 폐쇄망에서 수 초~수십 초에 끝난다. 적재·개정·코드 배포 후
 * "검색이 깨졌는지"를 관리자가 버튼 하나로 확인하는 용도 — 기존 벤치 하니스는 전부
 * 개발자 CLI라 폐쇄망 관리자가 돌릴 수단이 없었다.
 */
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { runSmokeQuestions } from "@/lib/regulations-smoke";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectDb();
  const docs = await RagRegulationModel.find({ "metadata.smokeQuestions.0": { $exists: true } })
    .select("title metadata.smokeQuestions").lean<{ title: string; metadata?: { smokeQuestions?: string[] } }[]>();

  const results: { title: string; total: number; passed: number; misses: { q: string; rank: number }[] }[] = [];
  for (const d of docs) {
    const qs = d.metadata?.smokeQuestions ?? [];
    if (!qs.length) continue;
    const r = await runSmokeQuestions(d.title, qs);
    results.push({
      title: d.title, total: r.length, passed: r.filter((x) => x.hit).length,
      misses: r.filter((x) => !x.hit).map((x) => ({ q: x.q, rank: x.rank })),
    });
  }
  const total = results.reduce((s, r) => s + r.total, 0);
  const passed = results.reduce((s, r) => s + r.passed, 0);
  return NextResponse.json({ ok: true, docs: results.length, total, passed, results: results.filter((r) => r.misses.length) });
}
