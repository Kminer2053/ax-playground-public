// 외부법령·행정규칙 원문 수집 — 법제처 국가법령정보 DRF API (온라인 개발망 전용, 폐쇄망 미실행)
// 입력: rag_graph_edges의 distinct lawName + data/laws/aliases.json
// 출력: data/laws/raw/<정식명>.json (법령 전문), data/laws/collect-report.json (해석·수집 결과 대사)
// 사용: node src/scripts/fetch-external-laws.mjs  (env LAW_OC=발급 OC, 기본 test / LAW_LIMIT=n 시험용)
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

const OC = process.env.LAW_OC || "test";
const LIMIT = Number(process.env.LAW_LIMIT || 0);
const ROOT = path.resolve(process.cwd());
const RAW_DIR = path.join(ROOT, "data/laws/raw");
const ALIASES = JSON.parse(fs.readFileSync(path.join(ROOT, "data/laws/aliases.json"), "utf8"));
const THROTTLE_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 비교용 정규화: 공백 제거·가운뎃점 통일·괄호류 제거
const norm = (s) => String(s || "").replace(/[·ㆍ‧․]/g, "ㆍ").replace(/[\s()「」『』]/g, "");

async function drf(params) {
  const u = new URL("https://www.law.go.kr/DRF/" + params._svc + ".do");
  for (const [k, v] of Object.entries(params)) if (k !== "_svc") u.searchParams.set(k, v);
  u.searchParams.set("OC", OC);
  u.searchParams.set("type", "JSON");
  const res = await fetch(u, { headers: { "User-Agent": "ax-playground-law-collector" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${u.pathname}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`JSON 아님(${u.searchParams.get("target")}): ${text.slice(0, 120)}`); }
}

// target=law 검색 → [{name, mst, kind, dept, efYd, histCode}]
async function searchLaw(q) {
  const d = await drf({ _svc: "lawSearch", target: "law", query: q, display: 100 });
  const rows = [].concat(d?.LawSearch?.law || []);
  return rows.map((r) => ({
    name: r["법령명한글"], mst: r["법령일련번호"], kind: r["법령구분명"],
    dept: r["소관부처명"], efYd: r["시행일자"], histCode: r["현행연혁코드"],
  }));
}
// target=admrul 검색
async function searchAdmrul(q) {
  const d = await drf({ _svc: "lawSearch", target: "admrul", query: q, display: 100 });
  const rows = [].concat(d?.AdmRulSearch?.admrul || []);
  return rows.map((r) => ({
    name: r["행정규칙명"], id: r["행정규칙일련번호"], kind: r["행정규칙종류"],
    dept: r["소관부처명"], efYd: r["시행일자"], histCode: r["현행연혁코드"], link: r["행정규칙상세링크"],
  }));
}
const pick = (rows, q) => {
  const cur = rows.filter((r) => r.histCode === "현행");
  const deprefix = (s) => norm(s).replace(/^계약예규/, ""); // "(계약예규) X" 접두 표기 대응
  return cur.find((r) => norm(r.name) === norm(q)) || (cur.length === 1 ? cur[0] : null) ||
    rows.find((r) => norm(r.name) === norm(q)) ||
    rows.find((r) => deprefix(r.name) === norm(q)) ||
    (rows.length === 1 ? rows[0] : null);
};

async function fetchLawBody(mst) { return drf({ _svc: "lawService", target: "law", MST: mst }); }
async function fetchAdmrulBody(id) { return drf({ _svc: "lawService", target: "admrul", ID: id }); }

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const mongo = await MongoClient.connect("mongodb://127.0.0.1:27017");
  const names = (await mongo.db("axplayground").collection("rag_graph_edges")
    .distinct("lawName", { kind: "law", lawName: { $nin: [null, ""] } })).sort();
  await mongo.close();

  const report = { oc: OC === "test" ? "test(정식 OC 발급 권장)" : "custom", at: new Date().toISOString(), resolved: [], skipped: [], unresolved: [] };
  const fetched = new Map(); // 정식명 → 파일명 (중복 수집 방지)
  const only = (process.env.LAW_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  let list = LIMIT ? names.slice(0, LIMIT) : names;
  if (only.length) list = names.filter((n) => only.includes(n));

  for (const raw of list) {
    const alias = ALIASES[raw] || {};
    if (alias.target === "skip") { report.skipped.push({ raw, note: alias.note }); continue; }
    const q = alias.q || raw;
    const target = alias.target || "law";
    try {
      await sleep(THROTTLE_MS);
      let hit = null, body = null, official = null, meta = null;
      if (target === "law") {
        hit = pick(await searchLaw(q), q);
        if (!hit) { await sleep(THROTTLE_MS); hit = pick(await searchAdmrul(q), q); if (hit) { meta = { target: "admrul" }; } }
        else meta = { target: "law" };
      } else {
        hit = pick(await searchAdmrul(q), q);
        meta = { target: "admrul" };
      }
      if (!hit) { report.unresolved.push({ raw, q, target }); console.log(`✗ 미해석: ${raw} (q=${q})`); continue; }
      official = hit.name;
      if (fetched.has(official)) {
        report.resolved.push({ raw, official, ...meta, dedupOf: fetched.get(official), loose: norm(official) !== norm(q) });
        console.log(`= 중복: ${raw} → ${official}`);
        continue;
      }
      await sleep(THROTTLE_MS);
      body = meta.target === "law" ? await fetchLawBody(hit.mst) : await fetchAdmrulBody(hit.id);
      const file = official.replace(/[/\\:]/g, "_") + ".json";
      fs.writeFileSync(path.join(RAW_DIR, file), JSON.stringify({ _meta: { raw, q, ...meta, hit, collectedAt: new Date().toISOString() }, body }, null, 1));
      fetched.set(official, file);
      report.resolved.push({ raw, official, ...meta, kind: hit.kind, efYd: hit.efYd, file, loose: norm(official) !== norm(q), note: alias.note });
      console.log(`✓ ${raw} → ${official} [${meta.target}/${hit.kind}] 시행 ${hit.efYd}`);
    } catch (e) {
      report.unresolved.push({ raw, q, target, error: String(e.message || e) });
      console.log(`! 오류: ${raw} — ${e.message}`);
    }
  }
  const repFile = only.length ? "data/laws/collect-report.partial.json" : "data/laws/collect-report.json";
  fs.writeFileSync(path.join(ROOT, repFile), JSON.stringify(report, null, 1));
  console.log(`\n완료: 해석 ${report.resolved.length} (수집 ${fetched.size}) / 제외 ${report.skipped.length} / 미해석 ${report.unresolved.length}`);
  console.log("리포트: data/laws/collect-report.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
