/**
 * 표형 골드셋(4유형×5문항) 평가 — 표 QA 개선(P1 명제화) 전후 비교용.
 *   MONGODB_URI=... npx tsx src/scripts/eval-table-gold.ts [tag]
 * 지표: ①evidence 포함율(정답 표 행이 컨텍스트에 실렸는가 — 핵심) ②doc recall@5 ③컨텍스트 중복 라인율.
 * 결과는 backups/table-gold-<tag>.json 저장(전후 diff용). 기본 tag=baseline.
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { fastSearchRegulations } from "@/lib/regulations-search";

type Q = { q: string; cat: string; expectDoc: string[]; expectEvidence: string[]; answer: string };

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 컨텍스트 내 동일 라인 중복율(12자 이상 라인 기준) — 명제화가 도배를 만드는지 감시 */
function dupRate(ctx: string): number {
  const lines = ctx.split("\n").map(norm).filter((l) => l.length >= 12);
  if (!lines.length) return 0;
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1);
  const dup = [...seen.values()].reduce((a, n) => a + (n - 1), 0);
  return Math.round((dup / lines.length) * 1000) / 10;
}

async function main() {
  const tag = process.argv[2] || "baseline";
  await connectDb();
  const qs: Q[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/benchmark/table-queries.json"), "utf8"));

  const rows: { q: string; cat: string; doc: boolean; ev: boolean; dup: number; ctxLen: number }[] = [];
  const byCat: Record<string, { n: number; doc: number; ev: number }> = {};
  for (const it of qs) {
    const r = await fastSearchRegulations(it.q);
    const nctx = norm(r.contextText);
    const top5 = r.allHits.slice(0, 5).map((h) => norm(h.title ?? ""));
    const doc = it.expectDoc.some((d) => top5.some((t) => t.includes(norm(d))));
    const ev = it.expectEvidence.some((e) => nctx.includes(norm(e)));
    const dup = dupRate(r.contextText);
    rows.push({ q: it.q, cat: it.cat, doc, ev, dup, ctxLen: r.contextText.length });
    const c = (byCat[it.cat] ??= { n: 0, doc: 0, ev: 0 });
    c.n++; if (doc) c.doc++; if (ev) c.ev++;
    console.log(`${ev ? "✅" : "❌"}ev ${doc ? "✅" : "❌"}doc [${it.cat}] ${it.q}  (dup ${dup}% · ctx ${r.contextText.length}자)`);
  }

  const tot = { n: rows.length, doc: rows.filter((r) => r.doc).length, ev: rows.filter((r) => r.ev).length };
  const avgDup = Math.round((rows.reduce((a, r) => a + r.dup, 0) / rows.length) * 10) / 10;
  console.log("\n유형별 (evidence / doc):");
  for (const [k, v] of Object.entries(byCat)) console.log(`  ${k}: ${v.ev}/${v.n} · ${v.doc}/${v.n}`);
  console.log(`합계: evidence ${tot.ev}/${tot.n} (${Math.round((tot.ev / tot.n) * 100)}%) · doc ${tot.doc}/${tot.n} · 평균 중복율 ${avgDup}%`);

  fs.mkdirSync("backups", { recursive: true });
  const out = path.join("backups", `table-gold-${tag}.json`);
  fs.writeFileSync(out, JSON.stringify({ tag, total: tot, avgDup, byCat, rows }, null, 1));
  console.log(`저장: ${out}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
