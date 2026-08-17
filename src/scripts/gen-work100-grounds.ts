/**
 * M2c-2 업무근거 도출 — Task별 근거 조문(Task→Article)을 회수+LLM으로 연결.
 * 회수는 지식검색 파이프라인(retrieveRagRegulationsForQa) 재사용. LLM은 회수 조문 중 근거만 선별+basis 분류.
 * 후보는 candidate로 적재(사람 검토 전제). data/work100/grounds/<부서>.json 로그.
 *
 * 실행: MONGODB_URI=... npx tsx src/scripts/gen-work100-grounds.ts [--dept 경영지원처] [--all] [--dry]
 */
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";
import { RagRegulationModel } from "@/models/RagRegulation";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { chatLlm } from "@/lib/llm";
import { putEdge, type Provenance } from "@/lib/ontology-store";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ONLY = arg("dept") ?? "경영지원처";
const ALL = process.argv.includes("--all");
const DRY = process.argv.includes("--dry");
const RESUME = process.argv.includes("--resume"); // 업무근거가 이미 있는 Task는 건너뜀(중단 재개용)
const AT = new Date().toISOString();
const LLM: Provenance = { method: "llm", model: "google/gemma-4-E4B-it", at: AT };
const RULE: Provenance = { method: "rule", at: AT };
const B1_DOC = "위임전결규정";
const B1_NAME = "별표 제1호 (전결사항)";
let B1_HASH = ""; // 별표1 srcHash(전결 근거 앵커) — main에서 계산
const OUT_DIR = path.join(process.cwd(), "data/work100/grounds");
const srcHash = (name: string, body: string) =>
  crypto.createHash("sha1").update(`${name}\n${String(body).replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);

const SYS =
  "당신은 내부 사규 분석가입니다. 하나의 '업무'와 후보 사규 조문 목록을 받아, 그 업무의 '근거'가 되는 조문만 선별합니다.\n" +
  "규칙:\n① 업무를 직접 규율하는 핵심 조문만 고르세요. 일반적 정의 조문·표준계약 일반조건처럼 업무 특정성이 낮은 것, 우연히 같은 단어가 나온 무관 조문은 제외. 근거가 없으면 빈 배열.\n" +
  "② 각 근거에 basis를 분류: 절차(처리 순서·방법), 기준(요건·판단 기준), 서식(별지·별표 서식). ※전결 권한 조문은 별도 처리하므로 여기서 제외.\n" +
  "③ 조문은 목록의 번호(ref)로만 지목하세요(이름 재작성 금지).\n" +
  "반드시 아래 JSON 하나만 출력(마크다운·설명 금지):\n" +
  '{"grounds":[{"ref":3,"basis":"기준","note":"근거 요지 한 줄"}]}';

function extractJson(raw: string): { grounds: { ref: number; basis: string; note: string }[] } {
  let s = raw.replace(/```json?/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    return JSON.parse(s);
  } catch {
    // 꼬리따옴표 수리(E4B 간헐 오류)는 1차 파싱 실패 시에만 — 정상 JSON의 ""(빈 문자열)을 훼손하지 않도록
    return JSON.parse(s.replace(/([\]\d"])\s*"(?=\s*[,}\]])/g, "$1"));
  }
}

type Cand = { doc: string; name: string; body: string };
const BASIS = new Set(["절차", "기준", "서식"]); // 전결은 결정적 처리(회수 LLM에서 제외)

/** Task 질의 → 회수 문서에서 후보 조문 목록(Task 키워드 매칭 상위). */
async function candidates(query: string): Promise<Cand[]> {
  const docs = (await retrieveRagRegulationsForQa(query, 5)) as {
    title?: string;
    articles?: { name: string; fullText?: string }[];
  }[];
  const toks = query.split(/[\s·,()]+/).filter((w) => w.length >= 2);
  const out: Cand[] = [];
  for (const d of docs.slice(0, 4)) {
    const arts = (d.articles ?? []).filter((a) => /^제\d+조|^별표|^별지/.test(a.name));
    // Task 토큰 매칭 점수 상위 6개
    const scored = arts
      .map((a) => ({ a, s: toks.reduce((n, t) => n + ((a.name + (a.fullText ?? "")).includes(t) ? 1 : 0), 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
    for (const { a } of scored) out.push({ doc: d.title ?? "", name: a.name, body: (a.fullText ?? "").slice(0, 200) });
  }
  return out.slice(0, 18);
}

async function ground(task: { id: string; label: string; desc: string; dept: string }) {
  // 소관·전결 엣지의 원문(분장업무·전결)을 질의에 더해 회수를 구체화(일반 label의 약한 신호 보강)
  const ctxEdges = await OntologyEdgeModel.find({ from: task.id, rel: { $in: ["소관", "전결"] } })
    .select("evidence.quote")
    .lean<{ evidence?: { quote?: string } }[]>();
  const ctx = ctxEdges.map((e) => e.evidence?.quote ?? "").filter(Boolean).join(" ").slice(0, 300);
  const query = `${task.label} ${task.desc} ${ctx}`;
  const cand = await candidates(query);
  if (!cand.length) return { task, grounds: [], cand: 0 };
  const list = cand.map((c, i) => `${i + 1}. 「${c.doc}」 ${c.name}: ${c.body.replace(/\s+/g, " ").slice(0, 90)}`).join("\n");
  const user = `업무: ${task.label} — ${task.desc}\n\n[후보 조문]\n${list}\n\n이 업무의 근거 조문만 선별하세요. JSON 하나만.`;
  let parsed: { grounds: { ref: number; basis: string; note: string }[] } | null = null;
  for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
    const raw = await chatLlm([{ role: "user", content: user }], { system: SYS, maxTokens: 1500, temperature: attempt === 1 ? 0.2 : 0.4 });
    try {
      const p = extractJson(raw);
      if (Array.isArray(p.grounds)) parsed = p;
    } catch {
      /* 재시도 */
    }
  }
  const grounds = (parsed?.grounds ?? [])
    .filter((g) => cand[g.ref - 1] && BASIS.has(g.basis))
    .map((g) => ({ ...cand[g.ref - 1], basis: g.basis, note: String(g.note ?? "").slice(0, 80) }));
  return { task, grounds, cand: cand.length };
}

/** 전결 엣지 → 업무근거(basis:전결) 결정적 승격. 위임전결 별표1 앵커 + 전결행 rowHash·quote. */
async function jeoGrounds(taskId: string) {
  const jeo = await OntologyEdgeModel.find({ from: taskId, rel: "전결" })
    .select("evidence props")
    .lean<{ evidence?: { rowHash?: string; quote?: string }; props?: { limit?: { text?: string } } }[]>();
  const seen = new Set<string>();
  const out: { rowHash: string; quote: string; note: string }[] = [];
  for (const e of jeo) {
    const rh = e.evidence?.rowHash ?? "";
    if (!rh || seen.has(rh)) continue; // 같은 전결행(직위별 엣지 중복) 1건으로
    seen.add(rh);
    out.push({
      rowHash: rh,
      quote: e.evidence?.quote ?? "",
      note: e.props?.limit?.text ? `전결 한도 ${e.props.limit.text}` : "전결권자 규율",
    });
  }
  return out;
}

async function main() {
  await connectDb();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 별표1 srcHash(전결 근거 앵커) 계산
  const b1ft = (await RagRegulationModel.findOne({ title: B1_DOC }, { articles: 1 }).lean<{
    articles: { name: string; fullText?: string }[];
  }>())!.articles.find((a) => a.name === B1_NAME)!.fullText!;
  B1_HASH = srcHash(B1_NAME, b1ft);
  const q: Record<string, unknown> = { type: "Task" };
  if (!ALL) q["props.dept"] = ONLY;
  let tasks = (await OntologyNodeModel.find(q).select("id label props").lean<
    { id: string; label: string; props: { desc: string; dept: string } }[]
  >()).map((t) => ({ id: t.id, label: t.label, desc: t.props?.desc ?? "", dept: t.props?.dept ?? "" }));
  if (RESUME) {
    const done = new Set(await OntologyEdgeModel.distinct("from", { rel: "업무근거" }));
    const before = tasks.length;
    tasks = tasks.filter((t) => !done.has(t.id));
    console.log(`[재개] 기처리 ${before - tasks.length} 스킵 → 잔여 ${tasks.length}`);
  }
  if (!tasks.length) throw new Error(`Task 없음: ${ALL ? "(전체)" : ONLY}`);

  // 멱등 — 대상 Task의 기존 업무근거 삭제 후 재생성(회수는 비결정적이라 중복 누적 방지)
  if (!DRY) {
    const del = await OntologyEdgeModel.deleteMany({ rel: "업무근거", from: { $in: tasks.map((t) => t.id) } });
    if (del.deletedCount) console.log(`[초기화] 기존 업무근거 ${del.deletedCount} 삭제`);
  }

  const byDept: Record<string, unknown[]> = {};
  let edgeN = 0;
  let jeoN = 0;
  let emptyN = 0;
  for (const t of tasks) {
    // ① 전결 결정적 업무근거(basis:전결) — 위임전결 별표1 앵커
    const jgs = await jeoGrounds(t.id);
    for (const jg of jgs) {
      if (!DRY) await putEdge({
        rel: "업무근거",
        from: t.id,
        to: { doc: B1_DOC, name: B1_NAME, srcHash: B1_HASH },
        fromSpace: "work",
        fromType: "Task",
        toSpace: "corpus",
        toType: "Article",
        props: { basis: "전결", note: jg.note },
        evidence: { doc: B1_DOC, name: B1_NAME, srcHash: B1_HASH, rowHash: jg.rowHash, quote: jg.quote.slice(0, 120) },
        status: "validated", // 결정적(전결 엣지 근거) — 앵커 실존
        rtConf: "상",
        provenance: { ...RULE },
      });
      jeoN++;
    }
    // ② 회수+LLM 보완(절차·기준·서식)
    const r = await ground(t);
    if (!r.grounds.length && !jgs.length) emptyN++;
    console.log(`  ${t.dept}/${t.label} — 전결근거 ${jgs.length} · 회수근거 ${r.grounds.length} (후보 ${r.cand})${!r.grounds.length && !jgs.length ? " ⚠무근거" : ""}`);
    for (const g of r.grounds) {
      const anchor = { doc: g.doc, name: g.name, srcHash: srcHash(g.name, g.body) };
      if (!DRY) await putEdge({
        rel: "업무근거",
        from: t.id,
        to: anchor,
        fromSpace: "work",
        fromType: "Task",
        toSpace: "corpus",
        toType: "Article",
        props: { basis: g.basis, note: g.note },
        evidence: { doc: g.doc, name: g.name, srcHash: anchor.srcHash, quote: g.body.slice(0, 120) },
        status: "candidate",
        rtConf: "상",
        provenance: { ...LLM },
      });
      edgeN++;
    }
    (byDept[t.dept] ??= []).push({ task: t.label, grounds: r.grounds.map((g) => ({ doc: g.doc, name: g.name, basis: g.basis })) });
  }
  for (const [dept, rows] of Object.entries(byDept)) {
    fs.writeFileSync(path.join(OUT_DIR, `${dept.replace(/[/\\]/g, "_")}.json`), JSON.stringify(rows, null, 1));
  }
  console.log(`\n[대사] Task ${tasks.length} · 전결근거 ${jeoN}(validated) · 회수근거 ${edgeN}(candidate)${DRY ? "(dry)" : ""} · 무근거 Task ${emptyN}`);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
