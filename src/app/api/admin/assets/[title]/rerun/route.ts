/**
 * 문서 단위 재실행 — 파이프라인 한 단계를 다시 돌린다.
 *
 *  rebuild : 임베딩 + 지식그래프 재구성(updateGraphForDoc). 무변경 조문은 srcHash로 재사용한다.
 *  retag   : 표 성격 태깅 + A 기준표 명제화
 *  analyze : 근거 영향 판정 + 상태 재집계(가볍다 — LLM·임베딩 불필요)
 *
 * **결과를 있는 그대로 돌려준다.** 임베딩 서버가 꺼져 있으면 벡터가 0개인 채로 "성공"할 수 있는데
 * (updateGraphForDoc은 갱신을 건너뛰고 본문 적재만 마친다), 화면에 성공으로만 뜨면 관리자가
 * 재계산됐다고 오해한다. 수치를 그대로 실어 보내 UI가 판단하게 한다.
 */
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";
import { updateGraphForDoc } from "@/lib/regulations-graph-build";
import { retagAndGlossDoc } from "@/lib/regulations-table-retag";
import { finalizeDocChange } from "@/lib/doc-change";
import { refreshAssetStatus } from "@/lib/asset-status";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 대형 문서 재임베딩 여유

export async function POST(req: Request, { params }: { params: Promise<{ title: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { title: raw } = await params;
  const title = decodeURIComponent(raw);

  let action = "";
  try { action = String(((await req.json()) as { action?: string }).action ?? ""); } catch { /* 본문 없음 */ }
  if (!["rebuild", "retag", "analyze"].includes(action)) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  await connectDb();
  const db = mongoose.connection.db;
  if (!db) return NextResponse.json({ error: "db" }, { status: 500 });
  const reg = await db.collection(collectionName("ragRegulation")).findOne({ title }, { projection: { _id: 1, category: 1 } });
  if (!reg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // 외부 규범은 검색 격리 대상이라 임베딩·그래프·표태깅을 만들지 않는 것이 정상이다.
  const external = ["법령", "행정규칙"].includes(String(reg.category ?? ""));
  if (external && action !== "analyze") {
    return NextResponse.json({ ok: false, error: "external_isolated", message: "외부 법령·행정규칙은 검색 격리 대상이라 임베딩·그래프·표태깅을 만들지 않습니다." }, { status: 400 });
  }

  const started = Date.now();
  try {
    if (action === "rebuild") {
      // 위계 부모는 기존 엣지에서 이어받는다(없으면 그래프 빌더가 알아서 정한다).
      const h = await db.collection(collectionName("ragGraphEdges")).findOne({ kind: "hier", sdoc: title }, { projection: { tdoc: 1 } });
      const g = await updateGraphForDoc(title, (h as { tdoc?: string } | null)?.tdoc || undefined);
      const assets = await refreshAssetStatus(title);
      return NextResponse.json({
        ok: true, action, ms: Date.now() - started, result: g, assets,
        // 벡터가 하나도 안 나오면 임베딩 서버가 꺼졌을 가능성이 크다 — 조용히 넘기지 않는다.
        warning: g.vectors === 0 ? "벡터가 0개입니다. 임베딩 서버가 꺼져 있으면 갱신이 건너뛰어집니다(설정 탭에서 주소 확인)." : "",
      });
    }
    if (action === "retag") {
      const t = await retagAndGlossDoc(title);
      const assets = await refreshAssetStatus(title);
      return NextResponse.json({ ok: true, action, ms: Date.now() - started, result: t, assets });
    }
    const fin = await finalizeDocChange(title, { retag: false });
    return NextResponse.json({ ok: true, action, ms: Date.now() - started, result: fin.impact, impactSummary: fin.impactSummary, assets: fin.assets });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`assets/rerun(${action})`, e);
    return NextResponse.json({ ok: false, action, error: "run_failed", message: msg }, { status: 500 });
  }
}
