// law 엣지 재식별 판정 반영 (data/laws/law-edge-verdicts.json → rag_graph_edges)
//  - identified.lawName 有: lawName·lawConf·lawEvidence·lawFix=llm-260721 (+적재 시 lawDoc)
//  - identified.lawName null: 내부 오분류·자기참조 등 → lawMisclass=true 플래그(향후 kind 전환 검토)
//  - auditCorrections: Pass1 절규칙 오류 교정(lawName 교체 또는 미식별 되돌림)
// 원본 보존: lawNameOrig $ifNull. 사용: node src/scripts/apply-law-verdicts.mjs [--apply]
import { MongoClient, ObjectId } from "mongodb";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const V = JSON.parse(fs.readFileSync("data/laws/law-edge-verdicts.json", "utf8"));
const report = JSON.parse(fs.readFileSync("data/laws/collect-report.json", "utf8"));

const mongo = await MongoClient.connect("mongodb://127.0.0.1:27017");
const db = mongo.db("axplayground");
const edges = db.collection("rag_graph_edges");
const loaded = new Set(await db.collection("rag_regulation").distinct("title", { category: { $in: ["법령", "행정규칙"] } }));
// 수집 정식명 매핑(감사 교정의 명칭 정규화용)
const normKey = (s) => String(s || "").replace(/[·ㆍ‧․]/g, "ㆍ").replace(/[\s「」()]/g, "");
const rawMap = new Map(report.resolved.map((r) => [normKey(r.raw), r.official]));
const canon = (name) => rawMap.get(normKey(name)) || name;

const stat = { set: 0, offList: 0, misclass: 0, auditFix: 0, auditRevert: 0 };
const ops = [];
for (const v of V.identified) {
  const _id = new ObjectId(v.id);
  if (v.lawName) {
    const name = canon(v.lawName);
    const upd = { lawName: name, lawConf: v.conf, lawEvidence: String(v.evidence || "").slice(0, 300), lawFix: "llm-260721" };
    if (loaded.has(name)) upd.lawDoc = name; else stat.offList++;
    ops.push({ _id, upd });
    stat.set++;
  } else {
    ops.push({ _id, upd: { lawMisclass: true, lawEvidence: String(v.evidence || "").slice(0, 300) } });
    stat.misclass++;
  }
}
for (const a of V.auditCorrections) {
  const _id = new ObjectId(a.id);
  if (a.lawName) {
    const name = canon(a.lawName);
    const upd = { lawName: name, lawConf: a.conf || "상", lawEvidence: String(a.evidence || "").slice(0, 300), lawFix: "audit-260721" };
    if (loaded.has(name)) upd.lawDoc = name; else delete upd.lawDoc;
    ops.push({ _id, upd, unsetDoc: !loaded.has(name) });
    stat.auditFix++;
  } else {
    ops.push({ _id, upd: { lawName: "", lawFix: "audit-revert-260721", lawEvidence: String(a.evidence || "").slice(0, 300) }, unsetDoc: true });
    stat.auditRevert++;
  }
}
if (APPLY) {
  for (const o of ops) {
    await edges.updateOne({ _id: o._id }, [
      { $set: { lawNameOrig: { $ifNull: ["$lawNameOrig", "$lawName"] } } },
      { $set: o.upd },
      ...(o.unsetDoc ? [{ $unset: "lawDoc" }] : []),
    ]);
  }
}
console.log(`${APPLY ? "적용" : "드라이런"} — 식별 반영 ${stat.set}(미수록 ${stat.offList}) · 오분류 플래그 ${stat.misclass} · 감사 교정 ${stat.auditFix} · 감사 되돌림 ${stat.auditRevert}`);

// 최종 대사
const total = await edges.countDocuments({ kind: "law" });
const named = await edges.countDocuments({ kind: "law", lawName: { $nin: [null, ""] } });
const linked = await edges.countDocuments({ kind: "law", lawDoc: { $exists: true } });
const mis = await edges.countDocuments({ kind: "law", lawMisclass: true });
console.log(`law 엣지 대사 — 총 ${total} · lawName 보유 ${named}(${Math.round((named / total) * 100)}%) · 적재문서 연결 ${linked} · 내부 오분류 플래그 ${mis}`);
await mongo.close();
