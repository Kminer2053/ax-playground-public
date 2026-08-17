/**
 * 사규 TXT 폴더에서 MongoDB 적재 (참조 리포와 동일: rag_regulation, 임베딩 없음).
 * 실행: npx tsx src/scripts/seed-regulations-from-txt.ts
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
const CANDIDATES = [
  process.env.REGS_SRC_DIR || path.join(CWD, "data", "tmp", "regulations-src"),
  path.join(CWD, "data", "regulations"),
];

function resolveTxtDir(): string {
  if (process.env.REGULATIONS_TXT_DIR && fs.existsSync(process.env.REGULATIONS_TXT_DIR))
    return process.env.REGULATIONS_TXT_DIR;
  for (const d of CANDIDATES) {
    if (fs.existsSync(d)) return d;
  }
  return CANDIDATES[0]!;
}

const TXT_DIR = resolveTxtDir();

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

async function main() {
  if (!fs.existsSync(TXT_DIR)) {
    console.error("TXT 폴더가 없습니다:", TXT_DIR);
    console.error("REGULATIONS_TXT_DIR 환경 변수로 절대 경로를 지정하세요.");
    process.exitCode = 1;
    return;
  }
  console.log("사규 TXT 폴더:", TXT_DIR);

  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });

  const files = await collectTxtFiles(TXT_DIR);
  console.log("TXT 파일 수:", files.length);

  const toInsert: { title: string; revisionInfo: string; articles: { name: string; fullText?: string }[] }[] = [];

  for (const filePath of files) {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = parseTxtFileRaw(raw);
    if (!parsed || parsed.articles.length === 0) continue;
    toInsert.push(parsed);
  }

  const existing = await RagRegulationModel.estimatedDocumentCount();
  if (existing > 0) {
    console.log("rag_regulation에 이미 문서가 있습니다. 덮어쓰려면 FORCE_SEED_REGULATIONS=1");
    const choice = process.env.FORCE_SEED_REGULATIONS;
    if (choice !== "1" && choice !== "true") {
      await mongoose.disconnect().catch(() => undefined);
      return;
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
      metadata: { articleCount: articles.length, source: "seed-txt" },
      embedding: null,
    });
  }

  console.log("완료:", toInsert.length, "건");
  await mongoose.disconnect().catch(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
