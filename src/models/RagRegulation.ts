import mongoose, { Schema, model, models, type InferSchemaType } from "mongoose";
import { buildRegulationContentFromArticles } from "@/lib/regulations-content";
import { collectionName } from "@/lib/collections";
import { articleHash } from "@/lib/article-hash";

const ArticleSchema = new Schema(
  {
    name: { type: String, required: true },
    fullText: { type: String, default: "" },
    order: { type: Number, default: 0 },
    page: { type: String, default: "" }, // 원문 페이지(비숫자 라벨 가능: "표지"·"3" 등) — 인용 정밀도
    srcHash: { type: String }, // 본문 해시 — 개정 감지의 기준(pre-save에서 자동 산정, article-hash.ts)
    tableKind: { type: String }, // 표 성격: A기준|B서식|C본문|D연혁 (classify-tables.ts)
    tableConf: { type: String }, // 분류 신뢰도: 상|중|하|확정(사람 검수 오버라이드)
    tableGloss: { type: String }, // A 기준표 행 명제 해석 — 검색·발췌·임베딩 보강용, 원문(fullText) 불변
  },
  { _id: false },
);

/**
 * 참조 AX_Portal `rag_regulation` + 조문 단위 `articles[]`.
 * `articles`가 있으면 저장 시 통본 `content`를 자동 재생성한다.
 */
const RagRegulationSchema = new Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    year: { type: String, default: "" },
    category: { type: String, default: "", index: true }, // 종류(규정·세칙·지침·매뉴얼·편람·계약서)
    docNumber: { type: String, default: "" }, // 제N호
    views: { type: Number, default: 0 }, // 조회수(자주 찾는 사규 산정)
    articles: { type: [ArticleSchema], default: [] },
    metadata: { type: Schema.Types.Mixed, default: {} },
    embedding: { type: [Number], default: null },
  },
  { timestamps: true },
);

RagRegulationSchema.pre("save", function syncContentFromArticles() {
  const doc = this as mongoose.Document;
  const articles = doc.get("articles") as Array<{ name: string; fullText?: string; order?: number; srcHash?: string }> | undefined;
  if (!Array.isArray(articles) || articles.length === 0) return;

  // 조문 해시는 저장 경로마다 따로 챙기면 반드시 빠진다(실제로 적재 라우트·CLI가 넣지 않아
  // 백필해 둔 해시가 재적재 때마다 사라졌다). 저장 시점에 한 곳에서 산정한다.
  for (const a of articles) {
    const h = articleHash(a.name, a.fullText ?? "");
    if (a.srcHash !== h) a.srcHash = h;
  }
  doc.markModified("articles");

  const sorted = [...articles].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const title = String(doc.get("title") ?? "").trim() || "(제목없음)";
  const year = String(doc.get("year") ?? "").trim();
  doc.set("content", buildRegulationContentFromArticles(title, year, sorted));

  const meta = doc.get("metadata");
  const merged =
    meta && typeof meta === "object" && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
  merged.articleCount = sorted.length;
  doc.set("metadata", merged);
});

RagRegulationSchema.index({ title: "text", content: "text", "articles.fullText": "text", "articles.name": "text" });

export type RagRegulationDoc = InferSchemaType<typeof RagRegulationSchema>;
export const RagRegulationModel =
  models.RagRegulation ?? model("RagRegulation", RagRegulationSchema, collectionName("ragRegulation"));
