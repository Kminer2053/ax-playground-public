import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { NoticeModel } from "@/models/Notice";
import { QuizPoolModel } from "@/models/QuizPool";
import { QuizLogModel } from "@/models/QuizLog";
import { VocItemModel } from "@/models/VocItem";
import { PointLogModel } from "@/models/PointLog";
import { PromptModel } from "@/models/Prompt";
import { PressReleaseModel } from "@/models/PressRelease";
import { ResourceModel } from "@/models/Resource";
import { SafetyArticleModel } from "@/models/SafetyArticle";
import { RagRegulationModel } from "@/models/RagRegulation";

const COLLECTION_MODELS: Record<string, { estimatedDocumentCount: () => Promise<number> }> = {
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
};

/** MongoDB 연결 상태, 컬렉션 목록, 문서 수, 스키마 요약 */
export async function GET() {
  try {
    await connectDb();
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json(
        { ok: false, error: "DB connection not ready" },
        { status: 503 }
      );
    }

    const dbName = db.databaseName;
    const cols = await db.listCollections().toArray();
    const collectionNames = cols.map((c) => c.name);

    const counts: Record<string, number> = {};
    await Promise.all(
      collectionNames.map(async (name) => {
        const model = COLLECTION_MODELS[name];
        if (model) {
          counts[name] = await model.estimatedDocumentCount();
        } else {
          counts[name] = await db.collection(name).estimatedDocumentCount();
        }
      })
    );

    const regulationCount = await RagRegulationModel.estimatedDocumentCount();
    return NextResponse.json({
      ok: true,
      connected: true,
      database: dbName,
      regulationCount,
      hint: "이 API가 연결한 DB 정보입니다. 이 서버(앱 인스턴스)가 실제로 사용하는 DB가 표시됩니다.",
      collections: collectionNames.map((name) => ({
        name,
        count: counts[name] ?? 0,
      })),
      schemas: SCHEMA_SUMMARY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, connected: false, error: message },
      { status: 503 }
    );
  }
}

const SCHEMA_SUMMARY: Record<string, { fields: string; description: string }> = {
  users: {
    fields: "email, name, dept, position, totalPoints, monthlyPoints, lastLoginAt, createdAt",
    description: "사용자(로그인·부서·포인트)",
  },
  notices: {
    fields: "title, content, isActive, createdBy, createdAt",
    description: "공지사항",
  },
  quizpools: {
    fields: "question, choices[], answerIndex, createdAt",
    description: "퀴즈 문제 풀",
  },
  quizlogs: {
    fields: "userId, quizId, isCorrect, quizDate, answeredAt",
    description: "퀴즈 참여 이력(유저별 일 1회)",
  },
  vocitems: {
    fields: "title, content, status, dept, createdBy, assignedTo, aiSuggestion, reply, repliedBy, createdAt, updatedAt",
    description: "VOC 민원",
  },
  pointlogs: {
    fields: "userId, type(login|quiz|prompt_register|like_received|admin), amount, refId, createdAt",
    description: "포인트 적립/차감 로그",
  },
  prompts: {
    fields: "title, content, category(sales|knowledge|safety|pr|cs|hr), createdBy, likeCount, likedBy[], createdAt",
    description: "프롬프트 도서관",
  },
  pressreleases: {
    fields: "title, body, status(draft|submitted|confirmed), createdBy, createdAt, updatedAt",
    description: "보도자료",
  },
  resources: {
    fields: "title, type(video|document), category, fileUrl, thumbnailUrl, viewCount, createdBy, createdAt",
    description: "AX 자료실(영상·문서)",
  },
  safetyarticles: {
    fields: "title, content, type(news|library), thumbnailUrl, createdAt, updatedAt",
    description: "안전 뉴스/자료실",
  },
  rag_regulation: {
    fields: "title, content, year, metadata, embedding, createdAt, updatedAt",
    description: "사내 규정(RAG·텍스트 검색, articles[] 조문 단위·통본 content)",
  },
};
