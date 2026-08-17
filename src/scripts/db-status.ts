/**
 * MongoDB 연결 여부 및 컬렉션/문서 수 확인 스크립트
 * 실행: npm run db:status (또는 MONGODB_URI 설정 후 tsx src/scripts/db-status.ts)
 */
import dotenv from "dotenv";
import path from "path";

// Next 앱은 .env.local 사용. 스크립트 실행 시 로드.
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI가 없습니다. .env.local 또는 환경 변수를 설정하세요.");
  process.exitCode = 1;
  process.exit(1);
}
import { UserModel } from "../models/User";
import { NoticeModel } from "../models/Notice";
import { QuizPoolModel } from "../models/QuizPool";
import { QuizLogModel } from "../models/QuizLog";
import { VocItemModel } from "../models/VocItem";
import { PointLogModel } from "../models/PointLog";
import { PromptModel } from "../models/Prompt";
import { PressReleaseModel } from "../models/PressRelease";
import { ResourceModel } from "../models/Resource";
import { SafetyArticleModel } from "../models/SafetyArticle";
import { RagRegulationModel } from "../models/RagRegulation";
import { SalesOrderModel } from "../models/SalesOrder";

const MODELS: Record<string, { estimatedDocumentCount: () => Promise<number> }> = {
  users: UserModel,
  notices: NoticeModel,
  quizpools: QuizPoolModel,
  quizlogs: QuizLogModel,
  vocitems: VocItemModel,
  pointlogs: PointLogModel,
  prompts: PromptModel,
  pressreleases: PressReleaseModel,
  resources: ResourceModel,
  safetyarticles: SafetyArticleModel,
  rag_regulation: RagRegulationModel,
  salesorders: SalesOrderModel,
};

/** DB 레이아웃: 컬렉션별 용도 및 주요 필드 (Mongoose 모델 기준) */
const DB_LAYOUT: Record<string, string> = {
  users: "email, name, dept, position, totalPoints, monthlyPoints, lastLoginAt, createdAt",
  notices: "title, content, isActive, createdBy, createdAt",
  quizpools: "question, choices[], answerIndex, createdAt",
  quizlogs: "userId, quizId, quizDate, selectedIndex, isCorrect, createdAt",
  vocitems: "title, content, status, dept, createdBy, assignedTo, repliedBy, createdAt",
  pointlogs: "userId, amount, reason, sourceId, sourceType, createdAt",
  prompts: "title, content, category, createdBy, likeCount, likedBy[], createdAt",
  pressreleases: "title, body, status, createdBy, createdAt",
  resources: "title, type, category, thumbnailUrl, fileUrl, viewCount, createdBy, createdAt",
  safetyarticles: "title, content, type, thumbnailUrl, createdAt",
  rag_regulation: "title, content, year, articles[{name,fullText,order}], metadata, embedding(null), createdAt, updatedAt",
  salesorders: "productName, store, quantity, memo, requestedBy, status, createdAt, updatedAt",
};

async function main() {
  const uri = MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI가 없습니다.");
    process.exitCode = 1;
    return;
  }
  const safeUri = uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
  console.log("MONGODB_URI:", safeUri);
  console.log("연결 시도 중...\n");

  await mongoose.connect(uri, { maxPoolSize: 10 });
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("DB connection not ready");
  }

  const dbName = db.databaseName;
  const cols = await db.listCollections().toArray();
  const names = cols.map((c) => c.name).sort();

  console.log("=== 연결 성공 ===\n");
  console.log("데이터베이스:", dbName);
  console.log("컬렉션 수:", names.length);
  console.log("\n--- 컬렉션별 문서 수 ---");

  for (const name of names) {
    const model = MODELS[name];
    const count = model
      ? await model.estimatedDocumentCount()
      : await db.collection(name).estimatedDocumentCount();
    console.log(`  ${name}: ${count}`);
  }

  console.log("\n--- DB 레이아웃 현황 (컬렉션별 주요 필드) ---");
  for (const name of names) {
    const layout = DB_LAYOUT[name] ?? "(앱에서 미정의)";
    console.log(`  ${name}`);
    console.log(`    → ${layout}`);
  }

  console.log("\n완료.");
}

main()
  .catch((err) => {
    console.error("오류:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
