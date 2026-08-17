import { NextResponse } from "next/server";
import mongoose, { Types } from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { updateGraphForDoc, removeGraphForDoc } from "@/lib/regulations-graph-build";
import { finalizeDocChange } from "@/lib/doc-change";
import { buildSagyuFromDb } from "@/lib/regulations-sagyu";
import { checkEmbeddingHealth } from "@/lib/embedding";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { collectionName } from "@/lib/collections";

/** 좌측 사규검색(sagyu.json)은 DB의 투영이다 — 어떤 쓰기 경로든 끝에서 재생성해야
 *  검색 목록과 DB가 어긋난 채 남지 않는다. 실패는 응답으로 알리되 본 작업은 유지. */
async function rebuildSagyu(): Promise<string | undefined> {
  try { await buildSagyuFromDb(); return undefined; }
  catch (e) { console.error("buildSagyuFromDb(CRUD)", e); return e instanceof Error ? e.message : String(e); }
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 증분 그래프(임베딩·LLM 검증) 여유

/** GET — 사규 단건 상세(조문 포함) (admin). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  await connectDb();
  const doc = await RagRegulationModel.findById(id)
    .select({ title: 1, year: 1, articles: 1, content: 1 })
    .lean<{ _id: unknown; title: string; year: string; articles: unknown[]; content: string } | null>();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let directParent = "";
  try {
    const h = await mongoose.connection?.db?.collection(collectionName("ragGraphEdges")).findOne({ kind: "hier", sdoc: doc.title }, { projection: { tdoc: 1 } });
    directParent = (h as { tdoc?: string } | null)?.tdoc ?? "";
  } catch { /* 위계 미적재 */ }
  return NextResponse.json({ ok: true, regulation: { ...doc, id: String(doc._id), directParent, _id: undefined } });
}

/** PATCH — 사규 수정 (admin). title/year/articles. content는 훅이 재생성. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });

  await connectDb();
  const doc = await RagRegulationModel.findById(id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const oldTitle = String(doc.get("title") || "");

  if (typeof body.title === "string") doc.set("title", body.title.trim());
  if (typeof body.year === "string") doc.set("year", body.year);
  // 개명은 옛 제목의 벡터를 지우고 새 제목으로 다시 만드는 작업이다 — 이때 임베딩 서버가
  // 죽어 있으면 "보존할 옛 벡터"조차 새 제목 아래엔 없어서 벡터가 전멸한다. 개명만 사전 차단.
  if (String(doc.get("title") || "") !== oldTitle) {
    const cfg = await getPlaygroundConfig();
    if (cfg.ragVectorEnabled) {
      const health = await checkEmbeddingHealth({ model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
      if (!health.ok) return NextResponse.json({ error: `임베딩 서버 점검 실패로 제목 변경을 중단했습니다. ${health.reason}`, embedDown: true }, { status: 503 });
    }
  }
  if (Array.isArray(body.articles)) {
    const articles = body.articles
      .map((a, i) =>
        a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string"
          ? {
              name: (a as { name: string }).name,
              fullText: typeof (a as { fullText?: unknown }).fullText === "string" ? (a as { fullText: string }).fullText : "",
              order: typeof (a as { order?: unknown }).order === "number" ? (a as { order: number }).order : i,
            }
          : null,
      )
      .filter((x) => x !== null);
    doc.set("articles", articles);
  }
  await doc.save(); // pre-save 훅이 content·articleCount 재생성
  // 증분 그래프 갱신(변경 문서만). 제목 변경 시 옛 제목 그래프·벡터 정리.
  const newTitle = String(doc.get("title") || "");
  const directParent = typeof body.directParent === "string" ? body.directParent.trim() : undefined;
  let graph: Awaited<ReturnType<typeof updateGraphForDoc>> | null = null;
  try {
    if (newTitle && newTitle !== oldTitle) await removeGraphForDoc(oldTitle);
    graph = await updateGraphForDoc(newTitle, directParent);
  } catch (e) { console.error("updateGraphForDoc(PATCH)", e); }
  // 표 태깅·근거 영향 판정·상태 집계. 개명이면 옛 제목 근거를 doc-removed로 격리한다.
  const fin = await finalizeDocChange(newTitle, { removedTitle: newTitle !== oldTitle ? oldTitle : undefined });
  const sagyuError = await rebuildSagyu();
  return NextResponse.json({ ok: true, graph, sagyuError, ...fin });
}

/** DELETE — 사규 삭제 (admin). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  await connectDb();
  const r = await RagRegulationModel.findByIdAndDelete(id).lean<{ title?: string } | null>();
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.title) {
    try { await removeGraphForDoc(String(r.title)); } catch (e) { console.error("removeGraphForDoc(DELETE)", e); }
    // 사규가 사라지면 그것을 근거로 삼던 업무 근거도 격리돼야 한다(doc-removed).
    await finalizeDocChange("", { removedTitle: String(r.title), retag: false });
  }
  const sagyuError = await rebuildSagyu();
  return NextResponse.json({ ok: true, sagyuError });
}
