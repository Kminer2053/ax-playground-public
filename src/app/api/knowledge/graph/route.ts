import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { collectionName } from "@/lib/collections";

export const dynamic = "force-dynamic";

/**
 * GET /api/knowledge/graph — 사규 문서 지식그래프(무로그인 공개).
 * 노드=문서(분류), 엣지=위계(직상위) + 참조(chunk→doc 집계) + 법령(사규→외부법령 적재 문서).
 * ref/law 튜플 = [출처, 대상, 가중치, 관계유형(문서쌍 최빈 rt), 근거문장 1건] — 그래프 패널 관계특성 표시용.
 */
export async function GET() {
  await connectDb();
  const docs = (await RagRegulationModel.find({}, { title: 1, category: 1 }).lean()) as { title?: string; category?: string }[];
  const nodes = new Map<string, { id: string; cat: string }>();
  for (const d of docs) {
    const t = String(d.title || "");
    if (t) nodes.set(t, { id: t, cat: String(d.category || "") });
  }

  let hier: [string, string][] = [];
  let ref: [string, string, number, string, string][] = [];
  let law: [string, string, number, string, string][] = [];
  const db = mongoose.connection?.db;
  if (db) {
    const col = db.collection(collectionName("ragGraphEdges"));
    type EdgeRow = { sdoc?: string; tdoc?: string; lawDoc?: string; rt?: string; reason?: string };
    const [hRows, rRows, lRows] = await Promise.all([
      col.find({ kind: "hier" }).project({ sdoc: 1, tdoc: 1, _id: 0 }).toArray(),
      col.find({ kind: "ref", tt: "doc" }).project({ sdoc: 1, tdoc: 1, rt: 1, reason: 1, _id: 0 }).toArray(),
      col.find({ kind: "law", lawDoc: { $type: "string", $ne: "" }, rt: { $nin: [null, "", "미상", "보류"] } })
        .project({ sdoc: 1, lawDoc: 1, rt: 1, reason: 1, _id: 0 }).toArray(),
    ]);
    hier = (hRows as EdgeRow[])
      .filter((r) => r.sdoc && r.tdoc)
      .map((r) => [r.sdoc as string, r.tdoc as string]);
    // 문서쌍 집계 — 가중치=건수, 대표 관계유형(최빈), 근거문장 첫 건
    const aggPairs = (rows: EdgeRow[], tKey: "tdoc" | "lawDoc") => {
      const m = new Map<string, { s: string; t: string; n: number; rts: Record<string, number>; reason: string }>();
      for (const r of rows) {
        const s = r.sdoc, t = r[tKey];
        if (!s || !t || s === t) continue;
        const k = `${s}\u0000${t}`;
        let e = m.get(k);
        if (!e) { e = { s, t, n: 0, rts: {}, reason: "" }; m.set(k, e); }
        e.n += 1;
        if (r.rt) e.rts[r.rt] = (e.rts[r.rt] || 0) + 1;
        if (!e.reason && r.reason) e.reason = String(r.reason).slice(0, 110);
      }
      return [...m.values()].map((e) => {
        const rt = Object.entries(e.rts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
        return [e.s, e.t, e.n, rt, e.reason] as [string, string, number, string, string];
      });
    };
    ref = aggPairs(rRows as EdgeRow[], "tdoc");
    law = aggPairs(lRows as EdgeRow[], "lawDoc");
  }

  // 엣지 끝점 중 노드 목록에 없는 것(외부법령 가상노드 등) 보강
  const addMissing = (id: string, cat: string) => { if (id && !nodes.has(id)) nodes.set(id, { id, cat }); };
  for (const [a, b] of hier) { addMissing(a, "기타"); addMissing(b, b === "외부법령" ? "외부" : "기타"); }
  for (const [a, b] of ref) { addMissing(a, "기타"); addMissing(b, "기타"); }
  for (const [a, b] of law) { addMissing(a, "기타"); addMissing(b, "법령"); }

  return NextResponse.json({ ok: true, nodes: [...nodes.values()], hier, ref, law });
}
