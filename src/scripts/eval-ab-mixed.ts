/**
 * 통합 검증풀 랜덤 50문항 A/B — 기존 문서풀(queries.json 100) + 표형 골드셋(table-queries.json 122)을
 * 합쳐 결정적 시드로 50개 샘플링, 개선 전/후를 같은 문항으로 측정.
 *   MONGODB_URI=mongodb://127.0.0.1:27017/axabprev    npx tsx src/scripts/eval-ab-mixed.ts before   # 개선 전(코드 stash + 시드 DB)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/axplayground npx tsx src/scripts/eval-ab-mixed.ts after
 *   npx tsx src/scripts/eval-ab-mixed.ts compare                                                     # 두 결과 대조 출력
 * 지표: doc recall@5(전 문항) · evidence 탑재(표형 문항만) · 컨텍스트 길이. 샘플은 첫 실행 시
 * data/benchmark/ab-sample-50.json으로 고정 저장(전/후 동일 문항 보장).
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { fastSearchRegulations } from "@/lib/regulations-search";

type Item = { q: string; cat: string; src: "문서풀" | "표형풀"; expectDoc: string[]; expectEvidence?: string[] };
const SAMPLE_PATH = path.join(process.cwd(), "data/benchmark/ab-sample-50.json");
const OUT = (tag: string) => path.join(process.cwd(), "backups", `ab-mixed-${tag}.json`);
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 결정적 PRNG — 같은 시드면 항상 같은 샘플(전/후·재실행 동일) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadOrSample(): Item[] {
  if (fs.existsSync(SAMPLE_PATH)) return JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
  const docPool = (JSON.parse(fs.readFileSync("data/benchmark/queries.json", "utf8")) as { q: string; expect: string[]; cat: string }[])
    .map((x): Item => ({ q: x.q, cat: `문서:${x.cat}`, src: "문서풀", expectDoc: x.expect }));
  const tablePool = (JSON.parse(fs.readFileSync("data/benchmark/table-queries.json", "utf8")) as { q: string; cat: string; expectDoc: string[]; expectEvidence: string[] }[])
    .map((x): Item => ({ q: x.q, cat: `표형:${x.cat}`, src: "표형풀", expectDoc: x.expectDoc, expectEvidence: x.expectEvidence }));
  const all = [...docPool, ...tablePool];
  const rnd = mulberry32(20260703);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const sample = all.slice(0, 50);
  fs.writeFileSync(SAMPLE_PATH, JSON.stringify(sample, null, 1));
  console.log(`샘플 50 확정(시드 20260703): 문서풀 ${sample.filter((s) => s.src === "문서풀").length} · 표형풀 ${sample.filter((s) => s.src === "표형풀").length} → ${SAMPLE_PATH}`);
  return sample;
}

async function measure(tag: string) {
  await connectDb();
  const items = loadOrSample();
  const rows: { q: string; src: string; cat: string; doc: boolean; ev: boolean | null; ctxLen: number }[] = [];
  for (const it of items) {
    const r = await fastSearchRegulations(it.q);
    const top5 = r.allHits.slice(0, 5).map((h) => norm(h.title ?? ""));
    const doc = it.expectDoc.some((d) => top5.some((t) => t.includes(norm(d)) || norm(d).includes(t)));
    const ev = it.expectEvidence ? it.expectEvidence.some((e) => norm(r.contextText).includes(norm(e))) : null;
    rows.push({ q: it.q, src: it.src, cat: it.cat, doc, ev, ctxLen: r.contextText.length });
    console.log(`${doc ? "✅" : "❌"}doc${ev === null ? "     " : ev ? " ✅ev" : " ❌ev"} [${it.src}] ${it.q.slice(0, 44)}`);
  }
  fs.mkdirSync("backups", { recursive: true });
  fs.writeFileSync(OUT(tag), JSON.stringify({ tag, rows }, null, 1));
  const doc = rows.filter((r) => r.doc).length;
  const evRows = rows.filter((r) => r.ev !== null);
  console.log(`\n[${tag}] doc ${doc}/50 · evidence ${evRows.filter((r) => r.ev).length}/${evRows.length} · 저장 ${OUT(tag)}`);
  await mongoose.disconnect();
}

function compare() {
  const b = JSON.parse(fs.readFileSync(OUT("before"), "utf8")) as { rows: { q: string; src: string; doc: boolean; ev: boolean | null }[] };
  const a = JSON.parse(fs.readFileSync(OUT("after"), "utf8")) as { rows: { q: string; src: string; doc: boolean; ev: boolean | null }[] };
  const byQ = new Map(b.rows.map((r) => [r.q, r]));
  let dUp = 0, dDown = 0, eUp = 0, eDown = 0;
  console.log("문항별 변화(전→후, 변한 것만):");
  for (const r of a.rows) {
    const p = byQ.get(r.q);
    if (!p) continue;
    const dd = Number(r.doc) - Number(p.doc);
    const ee = r.ev === null || p.ev === null ? 0 : Number(r.ev) - Number(p.ev);
    if (dd > 0) dUp++; if (dd < 0) dDown++;
    if (ee > 0) eUp++; if (ee < 0) eDown++;
    if (dd || ee) console.log(`  ${dd > 0 ? "doc ⬆" : dd < 0 ? "doc ⬇" : ""}${ee > 0 ? " ev ⬆" : ee < 0 ? " ev ⬇" : ""}  [${r.src}] ${r.q.slice(0, 46)}`);
  }
  const sum = (rows: { doc: boolean; ev: boolean | null }[]) => ({
    doc: rows.filter((r) => r.doc).length,
    evN: rows.filter((r) => r.ev !== null).length,
    ev: rows.filter((r) => r.ev === true).length,
  });
  const sb = sum(b.rows), sa = sum(a.rows);
  console.log(`\n══ 합계(50문항) ══`);
  console.log(`  doc recall@5 : ${sb.doc}/50 → ${sa.doc}/50   (개선 ${dUp}건 · 악화 ${dDown}건)`);
  console.log(`  evidence 탑재: ${sb.ev}/${sb.evN} → ${sa.ev}/${sa.evN}   (개선 ${eUp}건 · 악화 ${eDown}건)`);
}

const mode = process.argv[2];
if (mode === "compare") compare();
else if (mode === "before" || mode === "after") measure(mode).catch((e) => { console.error(e); process.exit(1); });
else { console.log("사용: before | after | compare"); process.exit(1); }
