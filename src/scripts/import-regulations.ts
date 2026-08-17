/**
 * 지식검색 사규 DB 재구축 임포트 (data/regulations-2026 → rag_regulation).
 * 파이프라인 본체는 src/lib/regulations-ingest.ts(관리자 적재 API와 공용). 이 스크립트는 파일수집·모드만 담당.
 *
 * 모드:
 *   --extract           수작업 정제가 필요한 완전공백 줄 추출 → /tmp/reg-mangle.json
 *   --dry-run [--limit N] [--cat 매뉴얼] [--file 부분문자열]   DB 미변경, 파싱/청킹 리포트(+ /tmp/reg-dryrun.json)
 *   --commit            현행 백업 확인 후 rag_regulation 드롭 → 신규 삽입
 *   --sagyu             public/sagyu.json 재생성(파일 기반)
 */
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import {
  type Doc, type MangleStat, parseMeta, tokenize, buildDocFromRaw, MANGLE_RE, newMangleStat,
} from "../lib/regulations-ingest";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const SRC = path.join(process.cwd(), "data", "regulations-2026");
const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

// ───────── 파일 수집 ─────────
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name === "README.md") continue; // 폴더 사용법 안내 문서 — 사규가 아니므로 제외
    else if (e.name.endsWith(".txt") || e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** data/regulations-2026 파일 → Doc (정제본이므로 isExtracted=false). stat 넘기면 정제 통계 누적. */
function buildDoc(p: string, stat?: MangleStat): Doc {
  const raw = fs.readFileSync(p, "utf8");
  const category = path.relative(SRC, p).split(path.sep)[0].normalize("NFC");
  const sourceFile = path.relative(SRC, p);
  const d = buildDocFromRaw(raw, { sourceName: path.basename(p), category, sourceFile, isExtracted: false, stat });
  (d.metadata as Record<string, unknown>).source = "regulations-2026"; // 출처 표기 유지
  return d;
}

// ───────── 모드 ─────────
function modeExtract() {
  const files = walk(SRC).filter((f) => f.endsWith(".txt"));
  const set = new Set<string>();
  for (const f of files) {
    const { body } = parseMeta(fs.readFileSync(f, "utf8"));
    for (const l of tokenize(body)) if (MANGLE_RE.test(l.text)) set.add(l.text);
  }
  const arr = [...set].sort();
  fs.writeFileSync("/tmp/reg-mangle.json", JSON.stringify(arr, null, 1), "utf8");
  console.log(`완전공백(수작업) 줄 distinct ${arr.length}개 → /tmp/reg-mangle.json`);
}

function modeDryRun() {
  let files = walk(SRC);
  const cat = val("--cat"); if (cat) files = files.filter((f) => f.includes(`/${cat}/`));
  const fsub = val("--file"); if (fsub) files = files.filter((f) => f.includes(fsub));
  const lim = val("--limit"); if (lim) files = files.slice(0, Number(lim));

  const stat = newMangleStat();
  const docs = files.map((f) => buildDoc(f, stat));
  const byVia: Record<string, number> = {};
  const flags: string[] = [];
  const report = docs.map((d) => {
    byVia[d.via] = (byVia[d.via] || 0) + 1;
    const lens = d.articles.map((a) => a.fullText.length);
    const avg = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0;
    const max = lens.length ? Math.max(...lens) : 0;
    if (d.articles.length === 0) flags.push(`청크0: ${d.title}`);
    if (max > 6000) flags.push(`과대청크 ${max}자: ${d.title}`);
    if (d.articles.length === 1 && d.pages > 3) flags.push(`단일청크/다페이지: ${d.title}`);
    return { cat: d.category, title: d.title, docNumber: d.docNumber, via: d.via, chunks: d.articles.length, pages: d.pages, avg, max, names: d.articles.slice(0, 3).map((a) => a.name) };
  });
  console.log(`\n=== 파싱 ${docs.length}개 / 전략분포 ${JSON.stringify(byVia)} ===`);
  console.log(`정제: 맵적용 ${stat.mapped} / 맵무결성위반 ${stat.mappedBad} / 미매핑 완전공백줄 ${stat.unmapped}`);
  const cats = [...new Set(report.map((r) => r.cat))].sort();
  for (const c of cats) {
    console.log(`\n── ${c} ──`);
    for (const r of report.filter((x) => x.cat === c)) {
      console.log(`  ${r.via.padEnd(4)} 청크${String(r.chunks).padStart(3)} p${String(r.pages).padStart(3)} 평균${String(r.avg).padStart(4)} 최대${String(r.max).padStart(5)} | ${r.title.slice(0, 30)}`);
    }
  }
  if (flags.length) { console.log("\n=== ⚠ 검수 플래그 ==="); flags.forEach((f) => console.log("  " + f)); }
  fs.writeFileSync("/tmp/reg-dryrun.json", JSON.stringify(docs, null, 1), "utf8");
  console.log(`\n전체 문서 → /tmp/reg-dryrun.json`);
}

async function modeCommit() {
  const bdir = path.join(process.cwd(), "backups");
  const hasBackup = fs.existsSync(bdir) && fs.readdirSync(bdir).some((f) => f.startsWith("regulations-"));
  if (!hasBackup) { console.error("백업이 없습니다. 먼저 npm run backup:regulations 실행."); process.exit(1); }
  const stat = newMangleStat();
  const docs = walk(SRC).map((f) => buildDoc(f, stat));
  if (stat.mappedBad > 0) console.warn(`경고: 맵 무결성 위반 ${stat.mappedBad}건은 폴백 처리됨.`);

  const MONGODB_URI = process.env.MONGODB_URI!;
  const MONGODB_DB = (process.env.MONGODB_DB || "").trim() || "axplayground";
  const mongoose = (await import("mongoose")).default;
  const { RagRegulationModel } = await import("../models/RagRegulation");
  const { buildRegulationContentFromArticles } = await import("../lib/regulations-content");
  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB });
  await RagRegulationModel.deleteMany({});
  let n = 0, arts = 0;
  for (const d of docs) {
    const articles = d.articles.map((a) => ({ name: a.name, fullText: a.fullText, order: a.order, page: a.page }));
    const content = buildRegulationContentFromArticles(d.title, d.year, articles);
    await RagRegulationModel.create({
      title: d.title, content, year: d.year, category: d.category, docNumber: d.docNumber,
      articles, metadata: d.metadata,
    });
    n++; arts += articles.length;
  }
  console.log(`재구축 완료: 규정 ${n}건 / 청크 ${arts}개 (db=${MONGODB_DB})`);
  await mongoose.disconnect();
}

/** public/sagyu.json 재생성 — 좌측 클라이언트 키워드검색용(category 포함). 파일 기반. */
function modeSagyu() {
  if (!fs.existsSync(SRC)) { console.log(`${path.relative(process.cwd(), SRC)} 없음 → 기존 public/sagyu.json 유지(재생성 스킵)`); return; }
  const docs = walk(SRC).map((f) => buildDoc(f)); // 정제 통계 불필요(stat 미전달)
  const items = docs.map((d) => {
    const a = d.articles.map((x) => x.name);
    const af = d.articles.map((x) => ({ name: x.name, text: (x.fullText || "").slice(0, 3000) }));
    const w = [d.title, d.year, ...a, ...d.articles.map((x) => (x.fullText || "").slice(0, 3000))].join(" ");
    return { n: d.year ? `${d.title}(${d.year})` : d.title, s: d.title, a, af, w, c: d.category, no: d.docNumber };
  });
  const out = path.join(process.cwd(), "public", "sagyu.json");
  fs.writeFileSync(out, JSON.stringify(items), "utf8");
  console.log(`public/sagyu.json 생성: ${items.length}건 (category 포함, ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)}MB)`);
}

(async () => {
  if (has("--extract")) modeExtract();
  else if (has("--sagyu")) modeSagyu();
  else if (has("--commit")) await modeCommit();
  else modeDryRun();
})();
