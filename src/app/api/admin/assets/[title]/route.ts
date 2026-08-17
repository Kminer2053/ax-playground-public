/**
 * 문서 상세 — 규정 하나가 파이프라인에서 만들어낸 것 전부.
 *
 * 조문·임베딩·그래프·표·업무영향을 한 번에 모아 준다. 탭마다 따로 부르면 같은 조문 배열을
 * 여러 번 읽게 되는데, 위임전결 별표1처럼 12,934자짜리 조문이 있어 한 번에 읽고 나누는 편이 낫다.
 * 본문 전체는 무거우므로 목록에는 길이·해시만 싣고, 원문은 `?article=` 로 따로 준다.
 */
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";
import { verifyArticleHash } from "@/lib/article-hash";
import { computeAssetStatus } from "@/lib/asset-status";

export const dynamic = "force-dynamic";

type Article = { name: string; fullText?: string; order?: number; page?: string; srcHash?: string; tableKind?: string; tableConf?: string; tableGloss?: string };

export async function GET(req: Request, { params }: { params: Promise<{ title: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { title: raw } = await params;
  const title = decodeURIComponent(raw);
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) return NextResponse.json({ error: "db" }, { status: 500 });

  const reg = (await db.collection(collectionName("ragRegulation")).findOne(
    { title },
    { projection: { _id: 0, title: 1, category: 1, year: 1, docNumber: 1, metadata: 1, articles: 1 } },
  )) as { title: string; category?: string; year?: string; docNumber?: string; metadata?: Record<string, unknown>; articles?: Article[] } | null;
  if (!reg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const arts = reg.articles ?? [];

  // 특정 조문 원문만 요청한 경우 — 목록 응답에 본문을 싣지 않기 위한 별도 경로.
  const wanted = new URL(req.url).searchParams.get("article");
  if (wanted) {
    const a = arts.find((x) => x.name === wanted);
    if (!a) return NextResponse.json({ error: "article_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, name: a.name, fullText: a.fullText ?? "", page: a.page ?? "", tableGloss: a.tableGloss ?? "" });
  }

  // ── 임베딩: 조문 단위 커버리지 ──
  const vecs = (await db.collection(collectionName("ragVectors"))
    .find({ doc: title }, { projection: { _id: 0, name: 1, ci: 1, h: 1 } })
    .toArray()) as unknown as { name: string; ci: number; h?: string }[];
  const vecByName = new Map(vecs.map((v) => [v.name, v]));

  // ── 그래프: 이 문서가 걸린 모든 엣지 ──
  const ge = collectionName("ragGraphEdges");
  const [hierUp, hierDown, refOut, refIn, lawOut] = await Promise.all([
    db.collection(ge).find({ kind: "hier", sdoc: title }, { projection: { _id: 0, tdoc: 1 } }).toArray(),
    db.collection(ge).find({ kind: "hier", tdoc: title }, { projection: { _id: 0, sdoc: 1 } }).toArray(),
    db.collection(ge).find({ kind: "ref", sdoc: title }, { projection: { _id: 0, sname: 1, tdoc: 1, tt: 1, rt: 1, reason: 1 } }).limit(300).toArray(),
    db.collection(ge).find({ kind: "ref", tdoc: title }, { projection: { _id: 0, sdoc: 1, sname: 1, rt: 1 } }).limit(300).toArray(),
    db.collection(ge).find({ kind: "law", sdoc: title }, { projection: { _id: 0, sname: 1, lawName: 1, lawDoc: 1, rt: 1, reason: 1 } }).limit(300).toArray(),
  ]);

  // ── 업무 영향: 이 문서를 근거로 삼는 엣지 + 조문 일치 여부 ──
  const onto = (await db.collection(collectionName("ontologyEdges"))
    .find({ "evidence.doc": title }, { projection: { _id: 0, edgeKey: 1, rel: 1, from: 1, status: 1, stale: 1, evidence: 1 } })
    .toArray()) as unknown as { edgeKey: string; rel: string; from: string; status?: string; stale?: { reason?: string } | null; evidence?: { name?: string; srcHash?: string; quote?: string } }[];

  const taskIds = [...new Set(onto.map((e) => e.from).filter(Boolean))];
  const nodes = taskIds.length
    ? (await db.collection(collectionName("ontologyNodes")).find({ id: { $in: taskIds } }, { projection: { _id: 0, id: 1, label: 1 } }).toArray()) as unknown as { id: string; label: string }[]
    : [];
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  const bodyOf = new Map(arts.map((a) => [a.name, a.fullText ?? ""]));

  const impact = onto.map((e) => {
    const name = e.evidence?.name ?? "";
    const body = bodyOf.get(name);
    const verdict = !name ? "no-anchor"
      : body === undefined ? "missing"
      : !e.evidence?.srcHash ? "no-hash"
      : verifyArticleHash(name, body, e.evidence.srcHash);
    return {
      edgeKey: e.edgeKey, rel: e.rel, task: e.from, taskLabel: labelOf.get(e.from) ?? e.from,
      name, status: e.status ?? "", stale: e.stale?.reason ?? null, verdict,
    };
  });

  const articles = arts.map((a) => {
    const v = vecByName.get(a.name);
    return {
      name: a.name, order: a.order ?? 0, page: a.page ?? "",
      chars: (a.fullText ?? "").length,
      srcHash: a.srcHash ?? "",
      hashState: a.srcHash ? verifyArticleHash(a.name, a.fullText ?? "", a.srcHash) : "none",
      embedded: !!v, ci: v?.ci ?? null,
      tableKind: a.tableKind ?? "", tableConf: a.tableConf ?? "", hasGloss: !!a.tableGloss,
    };
  });

  const status = await computeAssetStatus(title);

  return NextResponse.json({
    ok: true,
    doc: { title: reg.title, category: reg.category ?? "", year: reg.year ?? "", docNumber: reg.docNumber ?? "", metadata: reg.metadata ?? {} },
    status,
    articles,
    graph: {
      parents: hierUp.map((x) => (x as { tdoc?: string }).tdoc).filter(Boolean),
      children: hierDown.map((x) => (x as { sdoc?: string }).sdoc).filter(Boolean),
      refOut, refIn, law: lawOut,
    },
    impact,
  });
}
