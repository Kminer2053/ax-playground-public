/**
 * 사규(사내 규정) 시드 — 원본 TXT 폴더 우선, 없으면 10건 인라인.
 * 참조 리포와 동일: 컬렉션 `rag_regulation`, 통본 content, 임베딩 없음.
 * 실행: npm run seed:regulations
 */
import "./load-env";
import * as fs from "fs";
import * as path from "path";
import mongoose from "mongoose";
import { env } from "../lib/env";
import { buildRegulationContentFromArticles } from "../lib/regulations-content";
import { parseTxtFileRaw } from "../lib/regulations-parse";
import { RagRegulationModel } from "../models/RagRegulation";

const CWD = process.cwd();
const TXT_CANDIDATES = [
  path.join(CWD, "data", "regulations"),
  process.env.REGS_SRC_DIR || path.join(CWD, "data", "tmp", "regulations-src"),
];

function resolveTxtDir(): string | null {
  if (process.env.REGULATIONS_TXT_DIR && fs.existsSync(process.env.REGULATIONS_TXT_DIR))
    return process.env.REGULATIONS_TXT_DIR;
  for (const d of TXT_CANDIDATES) {
    if (fs.existsSync(d)) return d;
  }
  return null;
}

async function collectTxtFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectTxtFiles(full)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".txt")) {
      out.push(full);
    }
  }
  return out;
}

async function seedFromTxt(txtDir: string): Promise<number> {
  const files = await collectTxtFiles(txtDir);
  const toInsert: { title: string; revisionInfo: string; articles: { name: string; fullText?: string }[] }[] = [];

  for (const filePath of files) {
    const raw = (await fs.promises.readFile(filePath, "utf-8")).replace(/^\uFEFF/, "");
    const parsed = parseTxtFileRaw(raw);
    if (!parsed || parsed.articles.length === 0) continue;
    toInsert.push(parsed);
  }

  const existing = await RagRegulationModel.estimatedDocumentCount();
  if (existing > 0) {
    if (process.env.FORCE_SEED_REGULATIONS !== "1" && process.env.FORCE_SEED_REGULATIONS !== "true") {
      console.log("rag_regulation에 이미 %d건 있습니다. 덮어쓰려면 FORCE_SEED_REGULATIONS=1 npm run seed:regulations", existing);
      return 0;
    }
    await RagRegulationModel.deleteMany({});
    console.log("기존 문서 삭제 후 재시드 진행.");
  }

  for (const item of toInsert) {
    const articles = item.articles.map((a, i) => ({ ...a, order: i }));
    const content = buildRegulationContentFromArticles(item.title, item.revisionInfo, articles);
    await RagRegulationModel.create({
      title: item.title,
      year: item.revisionInfo,
      content,
      articles,
      metadata: { articleCount: articles.length, source: "seed-regulations-txt" },
      embedding: null,
    });
  }
  return toInsert.length;
}

const SAGYU_10 = [
  { n: "취업 규칙(2025년도 9월 개정)", a: ["제1조(목적)", "제14조(근무시간)", "제55조(연차유급휴가)", "제56조(육아기 근로시간 단축)", "제31조(징계)", "제40조(해고)"] },
  { n: "인사규정(2024년도 12월 개정)", a: ["제1조(목적)", "제5조(채용)", "제10조(전보)", "제15조(승진)", "제20조(평가)", "제31조(징계의 종류)"] },
  { n: "급여 규정(2025년도 9월 개정)", a: ["제1조(목적)", "제4조(임금의 구성)", "제8조(통상임금)", "제12조(시간외근무수당)", "제15조(연차수당)"] },
  { n: "감사규정(2023년도 10월 개정)", a: ["제1조(목적)", "제5조(감사의 종류)", "제10조(감사 실시)", "제15조(감사결과 처리)", "제20조(징계요구)"] },
  { n: "개인정보보호지침(2024년도 6월 개정)", a: ["제1조(목적)", "제5조(개인정보의 수집)", "제10조(제3자 제공)", "제15조(파기)", "제20조(안전성 확보조치)"] },
  { n: "계약업무 처리지침(2024년도 12월 개정)", a: ["제1조(목적)", "제5조(계약의 종류)", "제10조(수의계약)", "제15조(계약보증금)", "제20조(대가지급)"] },
  { n: "안전보건관리 규정(2025년도 9월 26일 개정)", a: ["제1조(목적)", "제5조(안전보건관리체제)", "제10조(안전보건교육)", "제15조(위험성평가)"] },
  { n: "복지후생 세칙(2024년도 11월 개정)", a: ["제1조(목적)", "제5조(경조금)", "제10조(학자금)", "제15조(건강검진)", "제20조(선택적복지)"] },
  { n: "윤리 규정(2024년도 8월 개정)", a: ["제1조(목적)", "제5조(금품수수 금지)", "제10조(이해충돌 방지)", "제15조(비밀유지)"] },
  { n: "유연근무제 운영지침(2024년도 4월 개정)", a: ["제1조(목적)", "제3조(정의)", "제7조(근무시간 및 근무일)", "제9조(실시대상 및 유형)"] },
];

async function seedFromInline(): Promise<number> {
  const count = await RagRegulationModel.estimatedDocumentCount();
  if (count > 0) {
    console.log("rag_regulation에 이미 문서가 있습니다. 건너뜁니다.");
    return 0;
  }

  for (const item of SAGYU_10) {
    const match = item.n.match(/^(.+?)\(([^)]+)\)$/);
    const title = match ? match[1].trim() : item.n;
    const revisionInfo = match ? match[2].trim() : "";
    const articles = item.a.map((name, i) => ({ name, order: i }));
    const content = buildRegulationContentFromArticles(title, revisionInfo, articles);
    await RagRegulationModel.create({
      title,
      year: revisionInfo,
      content,
      articles,
      metadata: { articleCount: articles.length, source: "seed-inline" },
      embedding: null,
    });
  }
  return SAGYU_10.length;
}

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });

  const txtDir = resolveTxtDir();
  let n = 0;

  if (txtDir && fs.existsSync(txtDir)) {
    console.log("사규 TXT 폴더 사용:", txtDir);
    n = await seedFromTxt(txtDir);
  } else {
    console.log("TXT 폴더 없음. 10건 인라인 시드.");
    n = await seedFromInline();
  }

  console.log("Seed rag_regulation: %d documents created (no embeddings).", n);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
