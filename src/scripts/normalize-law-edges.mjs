// law 엣지 최신화 Pass1(결정적) — GRAPH_SCHEMA 원칙: 규칙 우선, LLM은 잔여만.
//  a) lawName 표기변형 → 수집 리포트의 정식명으로 정규화 + 적재 문서 연결(lawDoc)
//  b) lawName 공백인데 tgt에 실명이 있는 증분 신규분 → 동일 매핑
//  c) tgt가 "외부법령 제N조"인 것 → 출처 조문에서 "…법 제N조" 한정어를 찾아
//     사규별 약칭 사전(「XX법」(이하 "법"이라 한다))으로 해석 — 유일 해석만 채택, 모호하면 보류(Pass2 LLM)
// 원본 보존: lawNameOrig($ifNull 1회 백업) · tgt 불변 · lawFix 마커. 사용: node ... [--apply]
import { MongoClient } from "mongodb";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const report = JSON.parse(fs.readFileSync("data/laws/collect-report.json", "utf8"));
const rawMap = new Map(); // 원표기(정규화) → 정식명
const normKey = (s) => String(s || "").replace(/[·ㆍ‧․]/g, "ㆍ").replace(/[\s「」()]/g, "");
for (const r of report.resolved) rawMap.set(normKey(r.raw), r.official);
const SKIP = new Set(report.skipped.map((s) => s.raw));

const mongo = await MongoClient.connect("mongodb://127.0.0.1:27017");
const db = mongo.db("axplayground");
const regs = db.collection("rag_regulation");
const edges = db.collection("rag_graph_edges");

const loaded = new Set(await regs.distinct("title", { category: { $in: ["법령", "행정규칙"] } }));
for (const o of rawMap.values()) if (!loaded.has(o)) console.log(`⚠ 매핑 정식명 미적재: ${o}`);

// ── 사규별 약칭 사전: 「명칭」(이하 "약칭") + 법→시행령·시행규칙 파생 ──
const aliasByDoc = new Map();
const ALIAS_RE = /「([^」]{2,60})」\s*\(이하\s*(?:각각\s*)?["“']?([^"”'),.\s]{1,25})["”']?(?:이라|라)?\s*(?:한다|합니다)?/g;
for (const d of await regs.find({ category: { $nin: ["법령", "행정규칙"] } }).project({ title: 1, "articles.fullText": 1 }).toArray()) {
  const dict = new Map();
  for (const a of d.articles || []) {
    for (const m of String(a.fullText || "").matchAll(ALIAS_RE)) {
      const official = rawMap.get(normKey(m[1]));
      if (official && !dict.has(m[2])) dict.set(m[2], official);
    }
  }
  // 파생: 법→X 이면 시행령/시행규칙도(적재 실존 시)
  const base = dict.get("법");
  if (base) for (const suf of [" 시행령", " 시행규칙"]) {
    const dv = base + suf;
    if (loaded.has(dv)) { if (!dict.has(suf.trim())) dict.set(suf.trim(), dv); if (suf === " 시행령" && !dict.has("영")) dict.set("영", dv); }
  }
  if (dict.size) aliasByDoc.set(d.title, dict);
}
console.log(`약칭 사전 보유 사규: ${aliasByDoc.size}개 (예: ${[...aliasByDoc.entries()].slice(0, 3).map(([t, m]) => `${t}→{${[...m.entries()].slice(0, 2).map(([k, v]) => `${k}=${v.slice(0, 12)}…`)}}`).join(" | ")})`);

const all = await edges.find({ kind: "law" }).toArray();
const stat = { renamed: 0, fromTgt: 0, clauseRule: 0, linked: 0, skipped: 0, pending: [] };
const artCache = new Map();
async function articleText(sdoc, sname, sci) {
  const key = sdoc + "␟" + sname;
  if (artCache.has(key)) return artCache.get(key);
  const d = await regs.findOne({ title: sdoc }, { projection: { articles: 1 } });
  let a = d?.articles?.find((x) => x.name === sname) || d?.articles?.[sci];
  const t = a?.fullText || "";
  artCache.set(key, t);
  return t;
}

const QUAL_RE = (jo) => new RegExp(`(같은\\s*법|동법|이\\s*법|「([^」]{2,60})」|[가-힣ㆍ·\\s]{2,30}?(법|규정|규칙|기준|지침)|법|시행령|영|시행규칙|규칙)\\s*(시행령|시행규칙)?\\s*제\\s*${jo}\\s*조`, "g");

for (const e of all) {
  const updates = {};
  const cur = e.lawName || "";
  const tgtBase = String(e.tgt || "").replace(/\s*제\s*\d+\s*조.*$/, "").trim();
  if (SKIP.has(cur) || SKIP.has(tgtBase)) { stat.skipped++; continue; }

  let official = null, via = null;
  if (cur && rawMap.has(normKey(cur))) { official = rawMap.get(normKey(cur)); via = cur !== official ? "map" : null; }
  else if (!cur && tgtBase && tgtBase !== "외부법령" && rawMap.has(normKey(tgtBase))) { official = rawMap.get(normKey(tgtBase)); via = "tgt"; }
  else if (!cur && tgtBase === "외부법령") {
    // 절 국소 해석: 출처 조문에서 "…제N조"의 한정어를 찾는다
    const jo = String(e.tgt).match(/제\s*(\d+)\s*조/)?.[1];
    if (jo) {
      const text = await articleText(e.sdoc, e.sname, e.sci);
      const dict = aliasByDoc.get(e.sdoc) || new Map();
      const found = new Set();
      for (const m of text.matchAll(QUAL_RE(jo))) {
        const inBracket = m[2]; const shortTail = (m[1] || "").trim().replace(/^같은\s*법$|^동법$|^이\s*법$/, "법");
        let r = null;
        if (inBracket) r = rawMap.get(normKey(inBracket + (m[4] || "")));
        if (!r && dict.has(shortTail + (m[4] ? " " + m[4] : ""))) r = dict.get(shortTail + (m[4] ? " " + m[4] : ""));
        if (!r && dict.has(shortTail)) r = m[4] && loaded.has(dict.get(shortTail) + " " + m[4]) ? dict.get(shortTail) + " " + m[4] : (m[4] ? null : dict.get(shortTail));
        if (!r && rawMap.has(normKey(shortTail + (m[4] ? " " + m[4] : "")))) r = rawMap.get(normKey(shortTail + (m[4] ? " " + m[4] : "")));
        if (r) found.add(r);
      }
      if (found.size === 1) { official = [...found][0]; via = "clause"; }
      else stat.pending.push({ id: String(e._id), sdoc: e.sdoc, sname: e.sname, tgt: e.tgt, candidates: [...found] });
    } else stat.pending.push({ id: String(e._id), sdoc: e.sdoc, sname: e.sname, tgt: e.tgt, candidates: [] });
  } else if (!cur) { stat.pending.push({ id: String(e._id), sdoc: e.sdoc, sname: e.sname, tgt: e.tgt, candidates: [] }); }

  if (official) {
    if (official !== cur) {
      updates.lawName = official;
      updates.lawFix = via === "clause" ? "clause-rule-260721" : "map-260721";
      if (via === "map") stat.renamed++; else if (via === "tgt") stat.fromTgt++; else if (via === "clause") stat.clauseRule++;
    }
    if (loaded.has(official) && e.lawDoc !== official) { updates.lawDoc = official; stat.linked++; }
  }
  if (Object.keys(updates).length && APPLY) {
    await edges.updateOne({ _id: e._id }, [
      { $set: { lawNameOrig: { $ifNull: ["$lawNameOrig", "$lawName"] } } },
      { $set: updates },
    ]);
  }
}
fs.writeFileSync("data/laws/law-edge-pending.json", JSON.stringify(stat.pending, null, 1));
console.log(`${APPLY ? "적용" : "드라이런"} — 표기정규화 ${stat.renamed} · tgt실명복원 ${stat.fromTgt} · 절규칙해석 ${stat.clauseRule} · 문서연결 ${stat.linked} · 오분류제외 ${stat.skipped} · 잔여(LLM행) ${stat.pending.length}`);
console.log("잔여 목록: data/laws/law-edge-pending.json");
await mongo.close();
