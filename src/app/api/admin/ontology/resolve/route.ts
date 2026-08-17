/**
 * 근거 재검토 조치 — 격리된 업무 근거를 사람이 판단해 정리한다.
 *
 *  keep    : 지금 원문이 여전히 이 업무의 근거다 → 앵커를 현재 원문으로 갱신하고 격리 해제
 *  replace : 근거가 다른 조문으로 옮겨갔다 → 지정한 조문으로 앵커를 바꾸고 격리 해제
 *  remove  : 더 이상 근거가 아니다 → 엣지 삭제
 *
 * 셋 다 **사람의 결정**이라 여기서만 수행한다. 자동 판정(analyzeOntologyImpact)은 격리까지만 하고
 * 근거를 갈아끼우지 않는다(ONTOLOGY.md: "AI는 초안, 확정은 원문·사람").
 *
 * keep/replace는 승격 상태를 건드리지 않는다. 격리 전 promoted였다면 해제 즉시 런타임에 복귀하고,
 * candidate/validated였다면 그대로다 — 재검토는 근거 정합성 판단이지 결재가 아니다.
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";
import { articleHash } from "@/lib/article-hash";

export const dynamic = "force-dynamic";

const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const stripLead = (s: string) => norm(s).replace(/^\d+[.)]\s*/, "").replace(/\s*<[^>]*>\s*$/, "").trim();
const rowHashOf = (s: string) => createHash("sha1").update(norm(s)).digest("hex").slice(0, 12);

type Body = {
  action?: "keep" | "replace" | "remove";
  edgeKeys?: string[];
  /** replace 전용 — 새 근거 위치. anchorText를 주면 행 앵커로 잡는다. */
  target?: { doc?: string; name?: string; anchorText?: string };
};

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const action = body.action;
  const keys = (body.edgeKeys ?? []).filter((k) => typeof k === "string" && k);
  if (!action || !["keep", "replace", "remove"].includes(action)) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  if (!keys.length) return NextResponse.json({ error: "no_edges" }, { status: 400 });

  await connectDb();
  const db = mongoose.connection.db;
  if (!db) return NextResponse.json({ error: "db" }, { status: 500 });
  const edges = db.collection(collectionName("ontologyEdges"));
  const regs = db.collection(collectionName("ragRegulation"));

  if (action === "remove") {
    const r = await edges.deleteMany({ edgeKey: { $in: keys } });
    return NextResponse.json({ ok: true, action, removed: r.deletedCount ?? 0 });
  }

  const now = new Date();
  let done = 0;
  const failed: { edgeKey: string; reason: string }[] = [];

  for (const edgeKey of keys) {
    const e = (await edges.findOne({ edgeKey })) as { evidence?: { doc?: string; name?: string; rowHash?: string; rowText?: string; quote?: string }; staleFrom?: { quote?: string } } | null;
    if (!e) { failed.push({ edgeKey, reason: "엣지를 찾을 수 없습니다" }); continue; }

    // keep은 기존 위치, replace는 지정 위치를 근거로 삼는다.
    const doc = action === "replace" ? (body.target?.doc ?? "").trim() : (e.evidence?.doc ?? "");
    const name = action === "replace" ? (body.target?.name ?? "").trim() : (e.evidence?.name ?? "");
    if (!doc || !name) { failed.push({ edgeKey, reason: "근거 위치가 비어 있습니다" }); continue; }

    const reg = (await regs.findOne({ title: doc }, { projection: { "articles.name": 1, "articles.fullText": 1 } })) as { articles?: { name: string; fullText?: string }[] } | null;
    const art = reg?.articles?.find((a) => a.name === name);
    if (!art) { failed.push({ edgeKey, reason: `「${doc} ${name}」을 찾을 수 없습니다` }); continue; }
    const bodyText = art.fullText ?? "";

    const set: Record<string, unknown> = {
      "evidence.doc": doc,
      "evidence.name": name,
      "evidence.srcHash": articleHash(name, bodyText),
      "evidence.resolvedAt": now,
      stale: null,
    };

    // 행 앵커 유지 — replace로 새 행을 지정했거나, 기존이 행 앵커였다면 현재 원문 기준으로 다시 잡는다.
    const anchorText = action === "replace" ? (body.target?.anchorText ?? "").trim() : (e.evidence?.rowText || e.staleFrom?.quote || "");
    const isRow = action === "replace" ? !!anchorText : !!e.evidence?.rowHash;
    if (isRow && anchorText) {
      // 지정 문구가 실제 원문에 있어야 앵커로 쓸 수 있다. 없으면 조문 단위로 내린다(격리는 풀되 앵커는 조문).
      const rows = new Set<string>();
      for (const raw of bodyText.split("\n")) {
        const line = norm(raw);
        if (!line) continue;
        for (const piece of line.includes("|") ? line.split("|") : [line]) {
          for (const item of piece.split(/(?=\d+[.)]\s*\S)/)) { const c = stripLead(item); if (c) rows.add(c); }
        }
      }
      const anchor = stripLead(anchorText);
      if (rows.has(anchor)) {
        set["evidence.rowText"] = anchor;
        set["evidence.rowHash"] = rowHashOf(anchor);
        set["evidence.quote"] = anchor;
      } else {
        failed.push({ edgeKey, reason: `지정한 문구가 「${name}」 원문에 없습니다` });
        continue;
      }
    }

    await edges.updateOne({ edgeKey }, { $set: set, $unset: { staleFrom: "" } });
    done += 1;
  }

  return NextResponse.json({ ok: true, action, resolved: done, failed });
}
