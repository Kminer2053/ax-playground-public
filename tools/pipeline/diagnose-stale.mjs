/* P0 진단 — 근거 해시 불일치 225건의 실제 원인 분류.
   엣지 quote(생성 시점 본문 앞 200자)와 현재 조문 본문을 대조해
   ①공백·기호 등 표기만 다름(파싱 변화) ②앞부분 동일·뒷부분 다름(증보) ③문면 자체가 다름(실제 개정)으로 가른다. */
import { MongoClient } from "mongodb";
import { createHash } from "node:crypto";
import fs from "node:fs";

const H = (n, b) => createHash("sha1").update(`${n}\n${String(b).replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
/** 표기 차이를 무시한 강정규화 — 공백·구두점·유사기호 통일 */
const hard = (s) => norm(s)
  .replace(/[·ㆍ‧․∙]/g, "")
  .replace(/[․．.]/g, "")
  .replace(/[「」『』<>《》〈〉]/g, "")
  .replace(/[（(]\s*/g, "(").replace(/\s*[）)]/g, ")")
  .replace(/[ㅡ—–\-]/g, "")
  .replace(/\s/g, "");

const c = await MongoClient.connect("mongodb://127.0.0.1:27017");
const db = c.db("axplayground");
const regs = await db.collection("rag_regulation").find({}, { projection: { title: 1, year: 1, articles: 1 } }).toArray();
const body = new Map(), year = new Map();
for (const r of regs) { year.set(r.title, r.year); for (const a of r.articles || []) body.set(r.title + "#" + a.name, a.fullText || ""); }

const edges = await db.collection("ontology_edges").find({ "evidence.srcHash": { $exists: true, $ne: "" } }).toArray();
const out = { parse: [], appended: [], amended: [], ok: 0 };
for (const e of edges) {
  const ev = e.evidence, cur = body.get(ev.doc + "#" + ev.name);
  if (cur === undefined) continue;
  if (H(ev.name, cur) === ev.srcHash) { out.ok += 1; continue; }
  const q = norm(ev.quote), curN = norm(cur);
  const rec = { task: e.from, doc: ev.doc, name: ev.name, year: year.get(ev.doc) || "",
                quote: q.slice(0, 120), cur: curN.slice(0, 120), qLen: q.length, curLen: curN.length };
  // quote는 생성 시 200자로 잘렸으므로 그 길이만큼만 비교
  const cut = Math.min(q.length, curN.length);
  const qa = q.slice(0, cut), ca = curN.slice(0, cut);
  if (qa === ca) out.appended.push(rec);           // 앞부분 동일 → 뒤가 늘거나 줄음
  else if (hard(qa) === hard(ca)) out.parse.push(rec); // 표기만 다름 → 파싱/정규화 변화
  else out.amended.push(rec);                      // 문면이 다름 → 실제 개정 의심
}
fs.writeFileSync(new URL("./diag.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`해시 일치 ${out.ok}`);
console.log(`불일치 — 표기차이(파싱) ${out.parse.length} · 앞부분동일(증감) ${out.appended.length} · 문면상이(개정의심) ${out.amended.length}`);
const byDoc = {};
for (const r of out.amended) byDoc[r.doc] = (byDoc[r.doc] || 0) + 1;
console.log("\n개정 의심 상위 문서:");
Object.entries(byDoc).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([d, n]) => console.log(`  ${String(n).padStart(3)}건  ${d} (${year.get(d) || "-"})`));
await c.close();
