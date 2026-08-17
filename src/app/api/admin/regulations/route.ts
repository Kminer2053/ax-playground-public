import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { updateGraphForDoc } from "@/lib/regulations-graph-build";
import { finalizeDocChange } from "@/lib/doc-change";
import { buildSagyuFromDb } from "@/lib/regulations-sagyu";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 증분 그래프(임베딩·LLM 검증) 여유

type ArticleInput = { name: string; fullText: string; order: number };

function parseArticles(v: unknown): ArticleInput[] {
  if (!Array.isArray(v)) return [];
  const out: ArticleInput[] = [];
  v.forEach((a, i) => {
    if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
      out.push({
        name: (a as { name: string }).name,
        fullText: typeof (a as { fullText?: unknown }).fullText === "string" ? (a as { fullText: string }).fullText : "",
        order: typeof (a as { order?: unknown }).order === "number" ? (a as { order: number }).order : i,
      });
    }
  });
  return out;
}

/** GET — 사규 목록·검색 (admin). ?q=&page= */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1), 1000);

  await connectDb();
  const filter = q ? { $text: { $search: q } } : {};
  const [items, total] = await Promise.all([
    RagRegulationModel.find(filter)
      .select({ title: 1, year: 1, "metadata.articleCount": 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RagRegulationModel.countDocuments(filter),
  ]);

  return NextResponse.json({
    ok: true,
    total,
    page,
    items: items.map((x) => ({
      id: String(x._id),
      title: x.title,
      year: x.year,
      articleCount: (x.metadata as { articleCount?: number } | undefined)?.articleCount ?? 0,
    })),
  });
}

/** POST — 신규 사규 (admin). title, year?, directParent(필수), articles[{name, fullText, order?}] */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const directParent = typeof body?.directParent === "string" ? body.directParent.trim() : "";
  const articles = parseArticles(body?.articles);
  if (!title || articles.length === 0) {
    return NextResponse.json({ error: "title과 articles(1건 이상)는 필수입니다." }, { status: 400 });
  }
  if (!directParent) {
    return NextResponse.json({ error: "신규 사규는 직상위규정(또는 '외부법령')을 지정해야 합니다." }, { status: 400 });
  }

  await connectDb();
  // pre-save 훅이 content를 articles에서 자동 생성하므로 new+save 사용.
  const doc = new RagRegulationModel({
    title,
    year: typeof body?.year === "string" ? body.year : "",
    content: title, // 훅이 덮어씀 (required 충족용 임시)
    articles,
  });
  await doc.save();
  // 증분 그래프: 신규 문서만 임베딩·엣지 빌드(전체 재빌드 회피). 실패해도 저장은 유지.
  let graph: Awaited<ReturnType<typeof updateGraphForDoc>> | null = null;
  try { graph = await updateGraphForDoc(title, directParent); } catch (e) { console.error("updateGraphForDoc(POST)", e); }
  const fin = await finalizeDocChange(title);
  // 신규 문서도 좌측 사규검색 목록에 바로 보여야 한다 — 실패는 응답으로 알리되 저장은 유지.
  let sagyuError: string | undefined;
  try { await buildSagyuFromDb(); } catch (e) { console.error("buildSagyuFromDb(POST)", e); sagyuError = e instanceof Error ? e.message : String(e); }
  return NextResponse.json({ ok: true, id: String(doc._id), graph, sagyuError, ...fin }, { status: 201 });
}
