/** vec/coh 재랭킹 회귀 측정 — 간편모드(확장無, retrieval 동일)로 rerank만 OLD vs NEW 비교.
 *  100문항 gold(expect) 대비 recall@5. MONGODB_URI=... npx tsx src/scripts/diag-ab-recall.ts
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { vectorSearchSeeds } from "@/lib/regulations-vector";
import { graphCoherence } from "@/lib/regulations-graph";
import { semanticTermsForRag, expandTermsForRag, queryTermsFromQuestion, termMatchRatio, compactPhraseMatch, ragRegulationTextBlob } from "@/lib/regulations-rag";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

type Q = { q: string; expect: string[]; cat: string };
type Hit = { _id?: unknown; title?: string; year?: string; content?: string };
const keyOf = (h: Hit) => (h._id != null ? String(h._id) : `${h.title ?? ""}::${h.year ?? ""}`);
const blobOf = (h: Hit) => ragRegulationTextBlob({ title: h.title, year: h.year, content: h.content });
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function rerank(q: string, textHits: Hit[], o: { vec?: Map<string, number>; coh?: Map<string, number>; titleW?: number } = {}): string[] {
  const semantic = semanticTermsForRag(q);
  const terms = semantic.length ? semantic : expandTermsForRag(q, queryTermsFromQuestion(q));
  const merged = new Map<string, { hit: Hit; score: number }>();
  textHits.forEach((h, i) => {
    const k = keyOf(h);
    const e = merged.get(k) ?? { hit: h, score: 0 };
    e.score += Math.max(0, 42 - i * 2.8);
    merged.set(k, e);
  });
  for (const e of merged.values()) {
    const blob = blobOf(e.hit);
    const tr = termMatchRatio(blob, terms);
    const cp = compactPhraseMatch(q, blob);
    e.score += tr * 28 + cp * 22;
    if (terms.length && tr === 0 && cp === 0) e.score *= 0.35;
    if (o.vec) e.score += (o.vec.get(e.hit.title ?? "") ?? 0) * 40;
    if (o.coh) e.score += Math.min(o.coh.get(e.hit.title ?? "") ?? 0, 3) * 6;
    if (o.titleW) { // 제목 매칭 질의어 수 × W (특정성: 전문점 운영 계약서=전문점+계약 2개)
      const title = (e.hit.title ?? "").toLowerCase();
      let n = 0; for (const t of terms) if (t.length >= 2 && title.includes(t.toLowerCase())) n++;
      e.score += n * o.titleW;
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).map((x) => x.hit.title ?? "");
}

const hit = (refs: string[], expect: string[]) =>
  expect.some((e) => refs.some((r) => norm(r).includes(norm(e)) || norm(e).includes(norm(r))));

async function main() {
  const K = 5;
  await connectDb();
  const cfg = await getPlaygroundConfig();
  const qs: Q[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/benchmark/queries.json"), "utf8"));
  const byCat: Record<string, { n: number; old: number; neo: number; ti: number }> = {};

  for (const it of qs) {
    if (!it.expect?.length) continue; // gold 없는 항목(범위밖 등) 제외
    const textHits = (await retrieveRagRegulationsForQa(it.q, K + 4)) as Hit[];
    const vs = await vectorSearchSeeds(it.q, K * 4 + 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
    let maxV = 0; for (const v of vs) if (v.score > maxV) maxV = v.score;
    const vec = new Map(vs.map((v) => [v.title, maxV > 0 ? v.score / maxV : 0]));
    const coh = await graphCoherence(textHits.map((h) => h.title).filter((t): t is string => !!t));

    const oH = hit(rerank(it.q, textHits).slice(0, K), it.expect);
    const nH = hit(rerank(it.q, textHits, { vec, coh }).slice(0, K), it.expect);
    const tH = hit(rerank(it.q, textHits, { vec, coh, titleW: 9 }).slice(0, K), it.expect);
    const c = (byCat[it.cat] ??= { n: 0, old: 0, neo: 0, ti: 0 });
    c.n++; if (oH) c.old++; if (nH) c.neo++; if (tH) c.ti++;
  }

  console.log(`\n=== recall@${K} : OLD vs NEW(vec+coh) vs NEW+제목(vec+coh+title9) ===`);
  let tn = 0, to = 0, te = 0, tt = 0;
  for (const [cat, c] of Object.entries(byCat)) {
    console.log(`  ${cat.padEnd(6)} n=${c.n}  OLD ${(100*c.old/c.n).toFixed(0)}%  →  NEW ${(100*c.neo/c.n).toFixed(0)}%  →  +제목 ${(100*c.ti/c.n).toFixed(0)}%`);
    tn += c.n; to += c.old; te += c.neo; tt += c.ti;
  }
  console.log(`  ${"전체".padEnd(6)} n=${tn}  OLD ${(100*to/tn).toFixed(1)}%  →  NEW ${(100*te/tn).toFixed(1)}%  →  +제목 ${(100*tt/tn).toFixed(1)}%`);

  // 전문점 질의 특정성 점검(질의는 벤치 밖) — neo vs +제목 top5
  const pq = "전문점 계약 체결시 계약자에게 안내해야할 사항";
  const ph = (await retrieveRagRegulationsForQa(pq, K + 4)) as Hit[];
  const pvs = await vectorSearchSeeds(pq, K * 4 + 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
  let pmx = 0; for (const v of pvs) if (v.score > pmx) pmx = v.score;
  const pvec = new Map(pvs.map((v) => [v.title, pmx > 0 ? v.score / pmx : 0]));
  const pcoh = await graphCoherence(ph.map((h) => h.title).filter((t): t is string => !!t));
  console.log(`\n[전문점 질의 top5]  NEW(vec+coh):`);
  rerank(pq, ph, { vec: pvec, coh: pcoh }).slice(0, 5).forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  console.log(`  +제목(title9):`);
  rerank(pq, ph, { vec: pvec, coh: pcoh, titleW: 9 }).slice(0, 5).forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
