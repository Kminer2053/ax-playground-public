/**
 * 외부 법령·행정규칙 일괄 적재 — `data/laws/md/*.md` → rag_regulation.
 *
 * 공개판에는 법령 데이터가 동봉되지 않는다. 법제처 국가법령정보 오픈API로 자체 수집한 뒤
 * 이 스크립트로 적재한다: fetch-external-laws(LAW_OC 필요, 인터넷) → convert-laws-to-md →
 * 이 스크립트. 법제처 원본이 개정되면 같은 순서로 다시 돌리면 된다.
 *
 * 조문 해시를 전량 대조해 바뀐 문서만 교체하므로 몇 번 돌려도 안전하다.
 * 외부 규범은 검색 격리 대상(ONTOLOGY.md §5)이라 임베딩·그래프·표태깅을 하지 않으며,
 * 그래서 임베딩·LLM 서버 없이 실행된다.
 *
 * 사용(MONGODB_DB가 URI 경로보다 우선하므로 둘 다 지정):
 *   MONGODB_URI="mongodb://127.0.0.1:27017" MONGODB_DB="axplayground" npm run laws:ingest
 *   npm run laws:ingest -- --dry     # 청킹까지만, DB 미변경
 *   npm run laws:ingest -- --force   # 내용이 같아도 재적재
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { ingestText } from "@/lib/regulations-ingest";
import { buildSagyuFromDb } from "@/lib/regulations-sagyu";
import { articleHash } from "@/lib/article-hash";
import { refreshAssetStatus } from "@/lib/asset-status";

const MD_DIR = path.join(process.cwd(), "data/laws/md");
const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

/** 진행 표시 — 터미널에서는 한 줄을 덮어쓰고, 로그로 넘길 때는 조용히 넘어간다. */
const progress = (s: string) => { if (process.stdout.isTTY) process.stdout.write(`\r${s}`); };

/** 파일명 접두어가 곧 분류다(`법령_감사원법.md`, `행정규칙_….md`). */
function categoryOf(file: string): "법령" | "행정규칙" | null {
  if (file.startsWith("법령_")) return "법령";
  if (file.startsWith("행정규칙_")) return "행정규칙";
  return null;
}

/** 조문 집합이 같은지 — 제목·본문 해시 전량 대조(멱등 판정) */
function sameArticles(a: { name: string; fullText: string }[], b: { name: string; fullText?: string }[]): boolean {
  if (a.length !== b.length) return false;
  const prev = new Map(b.map((x) => [x.name, articleHash(x.name, x.fullText ?? "")]));
  return a.every((x) => prev.get(x.name) === articleHash(x.name, x.fullText));
}

async function main() {
  if (!fs.existsSync(MD_DIR)) {
    console.error(`원문 디렉터리가 없습니다: ${MD_DIR}\n  법제처 수집본에서 변환하려면: node src/scripts/convert-laws-to-md.mjs`);
    process.exit(1);
  }
  const files = fs.readdirSync(MD_DIR).filter((f) => f.endsWith(".md")).sort();
  const targets = files.map((f) => ({ f, cat: categoryOf(f) })).filter((x): x is { f: string; cat: "법령" | "행정규칙" } => x.cat !== null);
  const skippedName = files.length - targets.length;
  console.log(`대상 ${targets.length}건(법령 ${targets.filter((t) => t.cat === "법령").length} · 행정규칙 ${targets.filter((t) => t.cat === "행정규칙").length})${skippedName ? ` · 분류 불명 ${skippedName}건 제외` : ""}`);

  if (!DRY) await connectDb();

  let inserted = 0, replaced = 0, unchanged = 0, failed = 0, articles = 0;
  const bad: string[] = [];

  for (const [i, { f, cat }] of targets.entries()) {
    const raw = fs.readFileSync(path.join(MD_DIR, f), "utf8");
    const { doc, audit } = ingestText(raw, { sourceName: f, category: cat, sourceFile: f });

    if (!doc.title || !doc.articles.length || audit.score === "bad") {
      failed += 1; bad.push(`${f} — 제목="${doc.title}" 조문=${doc.articles.length} 검수=${audit.score}`);
      continue;
    }
    articles += doc.articles.length;

    if (DRY) { progress(`  [dry] ${i + 1}/${targets.length}`); continue; }

    const prev = await RagRegulationModel.findOne({ title: doc.title })
      .select("articles.name articles.fullText").lean<{ articles?: { name: string; fullText?: string }[] }>();

    if (prev && !FORCE && sameArticles(doc.articles, prev.articles ?? [])) { unchanged += 1; }
    else {
      const del = await RagRegulationModel.deleteMany({ title: doc.title });
      // srcHash는 모델 pre-save 훅이 산정하지만, 의도를 드러내려 여기서도 명시한다(값은 동일).
      await new RagRegulationModel({
        title: doc.title, year: doc.year || "", category: cat, docNumber: doc.docNumber || "",
        content: doc.title,
        articles: doc.articles.map((a) => ({ name: a.name, fullText: a.fullText, order: a.order, page: a.page, srcHash: articleHash(a.name, a.fullText) })),
        metadata: { ...doc.metadata, ingestedVia: "laws-batch" },
      }).save();
      if (del.deletedCount) replaced += 1; else inserted += 1;
      await refreshAssetStatus(doc.title);
    }
    progress(`  ${i + 1}/${targets.length} — 신규 ${inserted} · 교체 ${replaced} · 무변경 ${unchanged}`);
  }
  if (process.stdout.isTTY) process.stdout.write("\n");

  if (bad.length) {
    console.log(`\n⚠ 적재 실패 ${bad.length}건`);
    bad.slice(0, 10).forEach((b) => console.log("  · " + b));
  }

  if (DRY) { console.log(`[dry] 청킹 결과 — 조문 ${articles.toLocaleString()}개 · 실패 ${failed}건. DB 미변경.`); return; }

  // 외부 규범은 sagyu 목록에서도 격리되지만, 적재 후 목록 일관성을 위해 1회 재생성한다(문서마다 돌리면 낭비).
  const sagyu = await buildSagyuFromDb();
  console.log(`신규 ${inserted} · 교체 ${replaced} · 무변경 ${unchanged} · 실패 ${failed} — 조문 ${articles.toLocaleString()}개`);
  console.log(`사규 목록 재생성: ${sagyu}건(외부 규범은 목록에서 제외됨)`);
  console.log("외부 규범이므로 임베딩·그래프·표태깅은 수행하지 않습니다(검색 격리).");
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
