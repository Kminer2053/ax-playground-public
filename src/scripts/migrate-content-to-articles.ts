/**
 * 기존 rag_regulation 통본 content → articles[] 분할 저장.
 * 실행: npx tsx src/scripts/migrate-content-to-articles.ts
 * 이미 articles가 있는 문서는 건너뜀. 전부 다시 자르려면 FORCE_MIGRATE_ARTICLES=1
 */
import "./load-env";
import mongoose from "mongoose";
import { env } from "../lib/env";
import { buildRegulationContentFromArticles } from "../lib/regulations-content";
import { splitContentIntoArticles } from "../lib/regulations-articles";
import { RagRegulationModel } from "../models/RagRegulation";

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });

  const force = process.env.FORCE_MIGRATE_ARTICLES === "1" || process.env.FORCE_MIGRATE_ARTICLES === "true";
  const all = await RagRegulationModel.find({}).lean();

  let updated = 0;
  let skipped = 0;

  for (const doc of all) {
    const d = doc as {
      _id: unknown;
      title?: string;
      year?: string;
      content?: string;
      articles?: unknown[];
      metadata?: Record<string, unknown>;
    };

    const hasArticles = Array.isArray(d.articles) && d.articles.length > 0;
    if (hasArticles && !force) {
      skipped++;
      continue;
    }

    const content = String(d.content ?? "");
    const rawArticles = splitContentIntoArticles(content);
    if (rawArticles.length === 0) {
      skipped++;
      continue;
    }

    const articles = rawArticles.map((a) => ({
      name: a.name,
      fullText: a.fullText,
      order: a.order,
    }));

    const title = String(d.title ?? "").trim() || "(제목없음)";
    const year = String(d.year ?? "").trim();
    const rebuilt = buildRegulationContentFromArticles(title, year, articles);

    const meta =
      d.metadata && typeof d.metadata === "object" && !Array.isArray(d.metadata) ? { ...d.metadata } : {};

    await RagRegulationModel.updateOne(
      { _id: d._id },
      {
        $set: {
          articles,
          content: rebuilt,
          metadata: {
            ...meta,
            articleCount: articles.length,
            articlesSource: "split-from-content",
          },
        },
      },
    );
    updated++;
  }

  console.log(`[migrate-articles] 완료: 갱신 ${updated}건, 건너뜀 ${skipped}건 (이미 조문 있음 또는 분할 불가)`);
  if (updated > 0) {
    console.log("[migrate-articles] text 인덱스에 조문 필드를 반영하려면: npm run fix:regulations-index 후 dev 서버 재시작");
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
