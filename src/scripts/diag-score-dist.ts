/** 3분기 거절 임계 캘리브레이션 — 벤치 100문항 + 범위밖 증보 20문항의 검색 신호 분포 산출(감사 R4).
 *  범위밖(28) vs 정상(92)의 신호 분리도를 측정하고, "strongHits=0 AND vecTop<X" 거절 규칙의
 *  X 스윕으로 (범위밖 거절율↑, 정상 오거절율↓) Pareto 지점을 표로 출력한다.
 *  실행: npx tsx src/scripts/diag-score-dist.ts   (결과: /tmp/score-dist.json + 콘솔 요약)
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
import { rerankHits, computeSearchSignals, type RegHit, type SearchSignals } from "@/lib/regulations-search";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

type Q = { q: string; expect: string[]; cat: string; sub?: string };
type Row = { q: string; cat: string; sub?: string; signals: SearchSignals; goldInTop5: boolean | null };

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

async function main() {
  await connectDb();
  const cfg = await getPlaygroundConfig();
  const base = JSON.parse(fs.readFileSync("data/benchmark/queries.json", "utf8")) as Q[];
  const extra = JSON.parse(fs.readFileSync("data/benchmark/oos-extra.json", "utf8")) as Q[];
  const all = [...base, ...extra];
  console.log(`문항 ${all.length} (기존 ${base.length} + 범위밖 증보 ${extra.length})`);

  const rows: Row[] = [];
  let vecFail = 0;
  for (let i = 0; i < all.length; i++) {
    const it = all[i];
    let textHits: RegHit[] = [];
    try { textHits = (await retrieveRagRegulationsForQa(it.q, 9)) as RegHit[]; } catch { /* skip */ }
    let vecRawTop: number | null = null;
    let vecScore: Map<string, number> | undefined;
    try {
      const vs = await vectorSearchSeeds(it.q, 28, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
      let maxV = 0;
      for (const v of vs) { if (v.score > maxV) maxV = v.score; if (vecRawTop == null || v.score > vecRawTop) vecRawTop = v.score; }
      if (maxV > 0) vecScore = new Map(vs.map((v) => [v.title, v.score / maxV]));
    } catch { vecFail++; }
    let coh: Map<string, number> | undefined;
    try { coh = await graphCoherence(textHits.map((h) => h.title).filter((t): t is string => !!t)); } catch { /* skip */ }
    const ranked = rerankHits(it.q, textHits, { vec: vecScore, coh }).slice(0, 5);
    const signals = computeSearchSignals(it.q, ranked, { vecRawTop, textHitCount: textHits.length });
    const goldInTop5 = it.expect?.length
      ? it.expect.some((g) => ranked.some((h) => norm(h.title ?? "").includes(norm(g)) || norm(g).includes(norm(h.title ?? ""))))
      : null;
    rows.push({ q: it.q, cat: it.cat, sub: it.sub, signals, goldInTop5 });
    if ((i + 1) % 20 === 0) console.log(`  …${i + 1}/${all.length}`);
  }
  if (vecFail) console.log(`⚠ 벡터 신호 실패 ${vecFail}건(임베딩 서버 확인) — vecTop=null로 집계됨`);

  fs.writeFileSync("/tmp/score-dist.json", JSON.stringify(rows, null, 1));

  // ── 그룹 분포 요약 ──
  const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
  const groups: [string, Row[]][] = [
    ["정상(참조·의미·직접)", rows.filter((r) => r.cat !== "범위밖")],
    ["범위밖(전체)", rows.filter((r) => r.cat === "범위밖")],
    ["범위밖·명백", rows.filter((r) => r.sub === "명백")],
    ["범위밖·유사도메인", rows.filter((r) => r.sub === "유사도메인")],
  ];
  console.log("\n=== 신호 분포 (p10/p50/p90) ===");
  for (const [name, g] of groups) {
    if (!g.length) continue;
    const vt = g.map((r) => r.signals.vecTop).filter((v): v is number => v != null);
    const t1 = g.map((r) => r.signals.top1).filter((v): v is number => v != null);
    const sh = g.map((r) => r.signals.strongHits);
    console.log(
      `${name.padEnd(16)} n=${g.length}  vecTop ${pct(vt, 10)?.toFixed(3)}/${pct(vt, 50)?.toFixed(3)}/${pct(vt, 90)?.toFixed(3)}` +
      `  top1 ${pct(t1, 10)?.toFixed(0)}/${pct(t1, 50)?.toFixed(0)}/${pct(t1, 90)?.toFixed(0)}  strong0비율 ${(sh.filter((x) => x === 0).length / g.length * 100).toFixed(0)}%`,
    );
  }
  const normals = rows.filter((r) => r.cat !== "범위밖");
  const oos = rows.filter((r) => r.cat === "범위밖");
  console.log(`\n정상 문항 gold@top5: ${normals.filter((r) => r.goldInTop5).length}/${normals.filter((r) => r.goldInTop5 != null).length}`);

  // ── 거절 규칙 스윕: refuse if strongHits===0 AND (vecTop==null OR vecTop<X) ──
  console.log("\n=== 거절 규칙 스윕 (strongHits=0 AND vecTop<X) ===");
  console.log("X\t범위밖 거절율\t정상 오거절율\t오거절 문항");
  for (let x = 0.40; x <= 0.70001; x += 0.02) {
    const refuse = (r: Row) => r.signals.strongHits === 0 && (r.signals.vecTop == null || r.signals.vecTop < x);
    const oosR = oos.filter(refuse).length / oos.length;
    const misNames = normals.filter(refuse).map((r) => r.q.slice(0, 18));
    console.log(`${x.toFixed(2)}\t${(oosR * 100).toFixed(0)}%\t${(misNames.length / normals.length * 100).toFixed(1)}%\t${misNames.slice(0, 3).join(" | ")}`);
  }
  // 보조 규칙: top1 절대 하한 결합
  console.log("\n=== 보조 스윕 (strongHits=0 AND vecTop<X AND top1<Y) — Y=30 고정 ===");
  for (let x = 0.50; x <= 0.70001; x += 0.02) {
    const refuse = (r: Row) => r.signals.strongHits === 0 && (r.signals.vecTop == null || r.signals.vecTop < x) && (r.signals.top1 == null || r.signals.top1 < 30);
    const oosR = oos.filter(refuse).length / oos.length;
    const mis = normals.filter(refuse).length;
    console.log(`${x.toFixed(2)}\t${(oosR * 100).toFixed(0)}%\t${(mis / normals.length * 100).toFixed(1)}%`);
  }
  console.log("\n상세 → /tmp/score-dist.json");
  await mongoose.disconnect();
}

void main();
