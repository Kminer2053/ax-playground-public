/** Phase2-C — 로컬 gemma + few-shot(B 예시은행)으로 교차규정 엣지 전수 재타이핑(생산 경로 검증).
 *  --write: DB 반영(rt_old 백업). --sample N: 앞 N개만(검증용). 결과 /tmp/c_typed.json.
 *  MONGODB_URI=... npx tsx src/scripts/type-edges-gemma.ts [--write] [--sample N]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { chatLlm } from "@/lib/llm";
import { localizeClause } from "@/lib/regulations-rel-classify";
import { collectionName } from "@/lib/collections";

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const SAMPLE = (() => { const i = argv.indexOf("--sample"); return i >= 0 ? parseInt(argv[i + 1], 10) : 0; })();
const RT_SET = new Set(["근거", "준용적용", "서식첨부", "위임", "정의", "절차", "예외", "상충·우선", "제재·벌칙"]);

const TYPEDEFS =
  "유형 정의: 근거(…에 따라/의하여 처리) · 준용적용(준용한다/예에 따른다/정하지않은 사항은 …기준) · 서식첨부(별표·별지 서식 사용) · " +
  "위임(세부를 대상에 맡김: …에서 정하는 바/것/기준에 따라, …으로 정한다) · 정의(‘…란/이라 함은 … 말한다’ 정의문) · " +
  "절차(…에 정한 절차를 따른다) · 예외(…는 제외/그러하지 아니) · 상충·우선(…에도 불구하고 …적용/우선) · 제재·벌칙(대상 위반→경고·징계·제재).";
const RULES =
  "주의: ‘정하는 것에/지급기준에 따라/…으로 정한다’는 위임(근거 아님). 정의문 내부의 ‘에 따라’는 정의. " +
  "‘…에 해당하는 자에 한한다’는 한정=근거(예외 아님), ‘…는 제외’만 예외. ‘…에도 불구하고 적용’은 상충·우선.";

function findArticleText(arts: { name?: string; fullText?: string }[] | undefined, sname: string): string {
  if (!arts?.length) return "";
  const norm = (s: string) => String(s || "").replace(/\s+/g, "");
  const key = norm(sname);
  let a = arts.find((x) => norm(x.name ?? "") === key);
  if (!a) a = arts.find((x) => key && (norm(x.name ?? "").includes(key) || key.includes(norm(x.name ?? ""))));
  return (a?.fullText ?? "").trim();
}

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const fewshot = JSON.parse(fs.readFileSync("data/graph/fewshot-rel.json", "utf8")) as { clause: string; target: string; rt: string }[];
  const fsBlock = fewshot.slice(0, 10).map((f, i) => `예시${i + 1}) [${f.rt}] (대상「${f.target}」) ${f.clause}`).join("\n");

  const titles = new Set<string>((await RagRegulationModel.find({}).select({ title: 1 }).lean()).map((d) => String((d as { title?: string }).title)));
  let edges = (await db.collection(collectionName("ragGraphEdges")).find({ kind: "ref", tt: "doc" },
    { projection: { sdoc: 1, sci: 1, sname: 1, rt: 1, tdoc: 1 } }).toArray()) as unknown as
    { _id: unknown; sdoc: string; sci: number; sname: string; rt: string; tdoc: string }[];
  edges = edges.filter((e) => titles.has(e.tdoc) && e.sdoc !== e.tdoc);
  if (SAMPLE) edges = edges.slice(0, SAMPLE);

  const docs = (await RagRegulationModel.find({ title: { $in: [...new Set(edges.map((e) => e.sdoc))] } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1, content: 1 }).lean()) as unknown as
    { title?: string; articles?: { name?: string; fullText?: string }[]; content?: string }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));
  const items = edges.map((e) => {
    const d = byTitle.get(e.sdoc);
    let src = findArticleText(d?.articles, e.sname);
    if (!src) { const c = d?.content ?? ""; const i = c.indexOf(e.sname.slice(0, 8)); src = i >= 0 ? c.slice(i, i + 600) : ""; }
    return { e, clause: localizeClause(src, e.tdoc).clause.slice(0, 300) };
  });

  const typed: { id: unknown; sdoc: string; sname: string; tdoc: string; rt_gemma: string; rt: string; reason: string }[] = [];
  const B = 8;
  for (let i = 0; i < items.length; i += B) {
    const batch = items.slice(i, i + B);
    const lines = batch.map((it, k) => `${k + 1}. 출처「${it.e.sdoc}」${it.e.sname} → 대상「${it.e.tdoc}」: ${it.clause}`).join("\n");
    const prompt = `${TYPEDEFS}\n${RULES}\n\n[참고 예시]\n${fsBlock}\n\n아래 각 참조의 유형을 위 정의로 판정하라. 각 줄 정확히 "번호:유형:한줄근거" 형식만 출력(설명 금지).\n\n${lines}`;
    let out = "";
    try { out = await chatLlm([{ role: "user", content: prompt }], { maxTokens: 900, temperature: 0.1 }); }
    catch (err) { out = ""; }
    if (i === 0 && process.env.DBG) console.error("=== RAW gemma 출력 ===\n" + out + "\n=== 끝 ===");
    const parsed = new Map<number, { rt: string; reason: string }>();
    for (const m of out.matchAll(/(\d+)\s*[:：]\s*([^:：\n]+?)\s*[:：]\s*([^\n]+)/g)) {
      const n = parseInt(m[1], 10); const rt = m[2].trim(); const reason = m[3].trim();
      parsed.set(n, { rt: RT_SET.has(rt) ? rt : "근거", reason });
    }
    batch.forEach((it, k) => {
      const p = parsed.get(k + 1);
      typed.push({ id: it.e._id, sdoc: it.e.sdoc, sname: it.e.sname, tdoc: it.e.tdoc, rt_gemma: it.e.rt, rt: p?.rt ?? it.e.rt, reason: p?.reason ?? "" });
    });
    process.stdout.write(`.${i + B >= items.length ? "\n" : ""}`);
  }

  fs.writeFileSync("/tmp/c_typed.json", JSON.stringify(typed, null, 1));
  const changed = typed.filter((t) => t.rt !== t.rt_gemma).length;
  console.log(`타이핑 ${typed.length}개, 변경 ${changed} (${Math.round(changed / typed.length * 100)}%)`);
  const cnt = new Map<string, number>(); typed.forEach((t) => cnt.set(t.rt, (cnt.get(t.rt) ?? 0) + 1));
  console.log("유형 분포:", [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log("저장: /tmp/c_typed.json");

  if (WRITE) {
    const ops = typed.map((t) => ({ updateOne: { filter: { _id: t.id }, update: [{ $set: { rt_old: { $ifNull: ["$rt_old", "$rt"] } } }, { $set: { rt: t.rt, reason: t.reason, rtConf: "중" } }] } }));
    const res = await db.collection(collectionName("ragGraphEdges")).bulkWrite(ops as unknown as never[]);
    console.log(`[--write] DB 반영 ${res.modifiedCount}건 (rt_old 백업·reason 추가)`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
