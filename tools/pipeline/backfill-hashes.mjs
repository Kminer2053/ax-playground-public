/**
 * P0 백필 — 개정 감지의 기준선 구축.
 *
 *  ① rag_regulation.articles[].srcHash 부여(원본에 해시가 없어 매번 재계산해야 했던 문제 해소)
 *  ② 온톨로지 엣지의 레거시 해시(앞 200자 기준) → 현행 전체본문 해시로 마이그레이션
 *     내용이 같은 것만 갱신한다. 실제로 달라진 것은 건드리지 않고 changed로 보고(재검토 대상).
 *  ③ 소관·전결 엣지에 srcHash 부여(doc·name은 있는데 해시가 없어 대조 불가였던 451건)
 *
 * 사용: node tools/pipeline/backfill-hashes.mjs [--apply]   (기본 dry-run)
 */
import { MongoClient } from "mongodb";
import { createHash } from "node:crypto";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB = process.env.MONGODB_DB || "axplayground";
const APPLY = process.argv.includes("--apply");

const digest = (name, body) =>
  createHash("sha1").update(`${name}\n${String(body).replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);
const articleHash = (name, full) => digest(name, full);
const legacyHash = (name, full) => digest(name, String(full).slice(0, 200));

const c = await MongoClient.connect(URI);
const db = c.db(DB);
const regs = db.collection("rag_regulation");
const edges = db.collection("ontology_edges");

// ── ① 조문 해시 부여 ────────────────────────────────────────────
const docs = await regs.find({}, { projection: { title: 1, articles: 1 } }).toArray();
const bodyOf = new Map();
let artTotal = 0, docTouched = 0;
for (const d of docs) {
  const arts = d.articles || [];
  let changed = false;
  for (const a of arts) {
    bodyOf.set(d.title + "#" + a.name, a.fullText || "");
    const h = articleHash(a.name, a.fullText || "");
    if (a.srcHash !== h) { a.srcHash = h; changed = true; }
    artTotal += 1;
  }
  if (changed) {
    docTouched += 1;
    if (APPLY) await regs.updateOne({ _id: d._id }, { $set: { articles: arts } });
  }
}
console.log(`① 조문 해시 — 문서 ${docs.length} · 조문 ${artTotal} · 갱신 대상 문서 ${docTouched}`);

// ── ②③ 엣지 해시 마이그레이션·백필 ───────────────────────────────
const all = await edges.find({}).toArray();
let migrated = 0, filled = 0, okAlready = 0, changedReal = 0, noAnchor = 0, orphan = 0;
const changedList = [], orphanList = [];

for (const e of all) {
  const ev = e.evidence || {};
  if (!ev.doc || !ev.name) { noAnchor += 1; continue; }          // 기능분류·선행 등 조문 근거 아님
  const body = bodyOf.get(ev.doc + "#" + ev.name);
  if (body === undefined) { orphan += 1; orphanList.push(`${ev.doc} ${ev.name}`); continue; }
  const cur = articleHash(ev.name, body);

  if (!ev.srcHash) {                                              // ③ 소관·전결 등 해시 없음
    filled += 1;
    if (APPLY) await edges.updateOne({ _id: e._id }, { $set: { "evidence.srcHash": cur } });
    continue;
  }
  if (ev.srcHash === cur) { okAlready += 1; continue; }
  if (ev.srcHash === legacyHash(ev.name, body)) {                 // ② 레거시 → 현행(내용 동일)
    migrated += 1;
    if (APPLY) await edges.updateOne({ _id: e._id }, { $set: { "evidence.srcHash": cur, "evidence.hashRev": 2 } });
    continue;
  }
  changedReal += 1;                                               // 실제 본문 변경 — 건드리지 않음
  changedList.push(`${e.from} ← ${ev.doc} ${ev.name}`);
}

console.log(`②③ 엣지 ${all.length} — 이미 현행 ${okAlready} · 레거시→현행 ${migrated} · 해시 신규부여 ${filled}`);
console.log(`    조문 근거 아님(분류·선행 등) ${noAnchor} · 조문 소실 ${orphan} · 실제 변경 ${changedReal}`);
if (orphanList.length) { console.log("  [조문 소실]"); [...new Set(orphanList)].slice(0, 10).forEach((x) => console.log("    · " + x)); }
if (changedList.length) { console.log("  [실제 변경 — 재검토 대상]"); changedList.slice(0, 10).forEach((x) => console.log("    · " + x)); }
console.log(APPLY ? "\n✓ 반영 완료" : "\n(dry-run — 반영하려면 --apply)");
await c.close();
