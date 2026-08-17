/**
 * M2b Task 큐레이션 도출 — 부서 분장업무+전결사항을 LLM(E4B)이 의미 단위 Task로 큐레이션.
 * 출력은 candidate 후보(사람 검토 전제). data/work100/tasks/<부서>.json 저장.
 *
 * 실행: MONGODB_URI=... npx tsx src/scripts/gen-work100-tasks.ts [--dept 경영지원처] [--all]
 *   (LLM 타겟은 DB playgroundconfigs 설정 사용 = 배포 E4B. 키는 사용자가 DB에 입력)
 */
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { chatLlm } from "@/lib/llm";
import { parseBunjangEopmu, parseJeongyeol, type JeongyeolRow } from "@/lib/work100-source-extract";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ONLY_DEPT = arg("dept") ?? "경영지원처";
const ALL = process.argv.includes("--all");
const OUT_DIR = path.join(process.cwd(), "data/work100/tasks");

// 부서 → 소속 본부(전결 섹션 매핑). 조직축 deptPath에서 도출.
function honbu(deptPath: string): string {
  const top = deptPath.split("/")[0];
  return top; // 예: 운영관리본부
}

const SYS =
  "당신은 내부 사규 업무 분석가입니다. 한 부서의 '분장업무'와 '전결사항'을 입력받아 실무 단위의 '업무(Task)'로 큐레이션합니다.\n" +
  "규칙:\n" +
  "① 각 Task는 실무자가 '이 업무를 수행한다'고 말할 수 있는 자기완결적 단위입니다. 관련 있는 분장업무를 적극적으로 묶으세요(분장업무 1:1 지양, 보통 분장업무 개수의 60~75% 수준으로 압축).\n" +
  "② 성격이 같은 분장업무·전결 항목을 하나의 Task로 묶고, 성격이 다르면 나눕니다.\n" +
  "③ 각 분장업무 번호는 가장 관련 깊은 Task 하나에만 배정하세요(dutyRefs 중복 금지). 전결 번호(approvalRefs)는 그 업무를 실제로 규율하는 Task에만.\n" +
  "④ 부서 소관이 명백한 업무만 만들고, 애매하면 제외합니다. 억지로 만들지 마세요.\n" +
  "예시: 분장업무 '전사 입찰 및 본사 계약 행정업무' + 전결 '물품구매·공사·용역 계약 체결(처장)' → Task {label:'계약·입찰 관리', dutyRefs:[해당번호], approvalRefs:[해당번호]}.\n\n" +
  "반드시 아래 JSON 객체 하나만 출력하세요. 마크다운 표·코드블록·설명 문장 없이 JSON만:\n" +
  '{"tasks":[{"label":"업무명","desc":"한 줄 설명","dutyRefs":[1,2],"approvalRefs":[11]}]}';

/** 관대 JSON 추출 — 코드블록·앞뒤 서술 제거, 흔한 LLM 오류(배열/숫자 뒤 잉여 따옴표) 복구. */
function extractJson(raw: string): { tasks: { label: string; desc: string; dutyRefs: number[]; approvalRefs: number[] }[] } {
  let s = raw.replace(/```json?/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  s = s.replace(/([\]\d])\s*"(?=\s*[,}\]])/g, "$1"); // "…]"  → "…]" 잉여 따옴표 제거(숫자·배열 뒤만, 정상 문자열 무영향)
  return JSON.parse(s);
}

const HINTS: Record<string, string> = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/work100/curation-hints.json"), "utf8"));
  } catch {
    return {};
  }
})();

async function curate(dept: string, deptPath: string, duties: string[], jy: JeongyeolRow[]) {
  const dutyBlock = duties.map((d, i) => `${i + 1}. ${d}`).join("\n");
  const apprBlock = jy.map((r) => `${r.num}. ${r.text} [${r.positions.join(",") || "?"}]${r.limit ? ` (한도 ${r.limit.text})` : ""}`).join("\n");
  const hint = HINTS[dept] ? `\n\n[이 부서 큐레이션 지침]\n${HINTS[dept]}` : "";
  const user = `부서: ${dept} (${deptPath})\n\n[분장업무]\n${dutyBlock}\n\n[전결사항 — ${honbu(deptPath)} / ${dept} 소부서]\n${apprBlock || "(해당 없음)"}${hint}\n\n위 부서의 업무를 Task로 큐레이션하세요. JSON 객체 하나만 출력.`;
  let parsed: { tasks: { label: string; desc: string; dutyRefs: number[]; approvalRefs: number[] }[] } | null = null;
  let lastRaw = "";
  for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
    lastRaw = await chatLlm([{ role: "user", content: user }], { system: SYS, maxTokens: 4096, temperature: attempt === 1 ? 0.2 : 0.4 });
    try {
      const p = extractJson(lastRaw);
      if (Array.isArray(p.tasks) && p.tasks.length) parsed = p;
    } catch {
      /* 재시도 */
    }
  }
  if (!parsed) {
    console.error(`  ✗ ${dept}: JSON 파싱 3회 실패 len=${lastRaw.length} 끝=…${lastRaw.slice(-60)}`);
    fs.writeFileSync(path.join(OUT_DIR, `${dept}.raw.txt`), lastRaw);
    return null;
  }
  // LLM 필드 누락 방어(dutyRefs/approvalRefs 미포함 Task 대비)
  parsed.tasks = parsed.tasks
    .filter((t) => t && t.label)
    .map((t) => ({
      label: String(t.label),
      desc: String(t.desc ?? ""),
      dutyRefs: Array.isArray(t.dutyRefs) ? t.dutyRefs : [],
      approvalRefs: Array.isArray(t.approvalRefs) ? t.approvalRefs : [],
    }));
  return { dept, deptPath, honbu: honbu(deptPath), duties, jy, tasks: parsed.tasks, generatedAt: new Date().toISOString() };
}

async function main() {
  await connectDb();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const deptNodes = await OntologyNodeModel.find({ type: "Dept" }).select("label props").lean<
    { label: string; props: { deptPath: string } }[]
  >();
  const leaf = deptNodes.filter((d) => !/본부$/.test(d.label));
  const labels = leaf.map((d) => d.label);

  const b6 = (await RagRegulationModel.findOne({ title: "직제규정 시행세칙" }, { articles: 1 }).lean<{
    articles: { name: string; fullText?: string }[];
  }>())!.articles.find((a) => /별표 제6호/.test(a.name))!;
  const duties = parseBunjangEopmu(b6.fullText ?? "", labels, ["자판기센터"]);
  // 자판기센터(직판사업처 하위 센터)의 분장업무를 직판사업처(자판기센터) Dept로 병합
  const jpc = duties.find((d) => d.dept === "자판기센터");
  const jyeong = duties.find((d) => d.dept === "직판사업처");
  if (jpc && jyeong) {
    jyeong.items.push(...jpc.items);
    duties.splice(duties.indexOf(jpc), 1);
  }

  const b1 = (await RagRegulationModel.findOne({ title: "위임전결규정" }, { articles: 1 }).lean<{
    articles: { name: string; fullText?: string }[];
  }>())!.articles.find((a) => a.name === "별표 제1호 (전결사항)")!;
  const jyAll = parseJeongyeol(b1.fullText ?? "");

  const targets = ALL ? leaf : leaf.filter((d) => d.label === ONLY_DEPT);
  if (!targets.length) throw new Error(`대상 부서 없음: ${ONLY_DEPT}`);

  for (const d of targets) {
    const cleanLabel = d.label.replace(/\([^)]*\)/g, "").trim(); // 파서는 괄호 제거 label로 저장
    const dd = duties.find((x) => x.dept === cleanLabel);
    if (!dd) {
      console.log(`  - ${d.label}: 별표6 분장업무 미매칭 → skip`);
      continue;
    }
    const hb = honbu(d.props.deptPath);
    // 소속 본부 섹션 + (소부서 일치 or 소부서 없음=본부 공통) 전결
    const subHint = d.label.replace(/처$|단$|실$|센터$/, "");
    const jy = jyAll.filter((r) => r.section === hb && (r.subsection === "" || r.subsection.includes(subHint) || subHint.includes(r.subsection)));
    const res = await curate(d.label, d.props.deptPath, dd.items, jy);
    if (!res) continue;
    fs.writeFileSync(path.join(OUT_DIR, `${d.label}.json`), JSON.stringify(res, null, 1));
    console.log(`\n■ ${d.label} — Task ${res.tasks.length}건 (분장 ${dd.items.length}·전결 ${jy.length})`);
    res.tasks.forEach((t) =>
      console.log(`  · ${t.label} — ${t.desc.slice(0, 40)} [소관 ${t.dutyRefs.join(",")||"-"} · 전결 ${t.approvalRefs.join(",")||"-"}]`),
    );
  }
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
