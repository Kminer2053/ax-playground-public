import "./load-env";

import mongoose from "mongoose";
import { env } from "../lib/env";
import { NoticeModel } from "../models/Notice";
import { PressReleaseModel } from "../models/PressRelease";
import { PromptModel } from "../models/Prompt";
import { QuizPoolModel } from "../models/QuizPool";
import { ResourceModel } from "../models/Resource";
import { SafetyArticleModel } from "../models/SafetyArticle";
import { UserModel } from "../models/User";
import { VocItemModel } from "../models/VocItem";
import { PlaygroundConfigModel } from "../models/PlaygroundConfig";
import { DEFAULT_PANEL_CONTRIB } from "../lib/panel-intro";

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });

  const [noticeCount, quizCount, resourceCount, promptCount, userCount] = await Promise.all([
    NoticeModel.estimatedDocumentCount(),
    QuizPoolModel.estimatedDocumentCount(),
    ResourceModel.estimatedDocumentCount(),
    PromptModel.estimatedDocumentCount(),
    UserModel.estimatedDocumentCount(),
  ]);

  if (noticeCount === 0) {
    await NoticeModel.insertMany([
      {
        title: "[공지] AX Playground MVP 오픈",
        content: "대시보드/퀴즈/리더보드/프롬프트 도서관/자료실 기능이 포함된 MVP입니다.",
        isActive: true,
        createdBy: "admin",
      },
      {
        title: "[안내] 퀴즈 참여 시 포인트 적립",
        content: "매일 1회 참여 가능, 정답 500P / 오답(참여) 100P.",
        isActive: true,
        createdBy: "admin",
      },
    ]);
  }

  if (quizCount === 0) {
    await QuizPoolModel.insertMany([
      {
        question: "생성형 AI의 답변은 항상 100% 정확하므로 사실 확인 없이 업무에 바로 활용해도 된다.",
        choices: ["O", "X"],
        answerIndex: 1,
      },
      {
        question: "RAG는 외부/내부 문서를 검색해 LLM 응답의 근거를 강화하는 방식이다.",
        choices: ["O", "X"],
        answerIndex: 0,
      },
      {
        question: "프롬프트에 목표/제약/예시를 포함하면 결과 품질이 좋아지는 경우가 많다.",
        choices: ["O", "X"],
        answerIndex: 0,
      },
    ]);
  }

  if (resourceCount === 0) {
    await ResourceModel.insertMany([
      {
        title: "[필수] 생성형 AI 업무 활용 기초 가이드",
        type: "video",
        category: "교육",
        thumbnailUrl: "",
        viewCount: 1200,
        createdBy: "정보화처",
      },
      {
        title: "프롬프트 작성 매뉴얼 v2.pdf",
        type: "document",
        category: "매뉴얼",
        fileUrl: "",
        viewCount: 320,
        createdBy: "정보화처",
      },
      {
        title: "생성형 AI 도입 추진계획(예시).pptx",
        type: "document",
        category: "전략",
        fileUrl: "",
        viewCount: 180,
        createdBy: "경영기획처",
      },
    ]);
  }

  if (userCount === 0) {
    await UserModel.insertMany([
      { email: "sales.manager@demo.local", name: "김철수", dept: "사업운영본부/사업기획처", totalPoints: 5200, monthlyPoints: 5200 },
      { email: "safety.assistant@demo.local", name: "이영희", dept: "사업운영본부/안전관리처", totalPoints: 4800, monthlyPoints: 4800 },
      { email: "pr.staff@demo.local", name: "박준호", dept: "기획조정본부/홍보처", totalPoints: 4500, monthlyPoints: 4500 },
      { email: "it.lead@demo.local", name: "최수민", dept: "경영지원본부/정보화처", totalPoints: 3920, monthlyPoints: 3920 },
      { email: "hr.staff@demo.local", name: "강서윤", dept: "경영지원본부/인사처", totalPoints: 2650, monthlyPoints: 2650 },
    ]);
  }

  if (promptCount === 0) {
    const users = await UserModel.find().limit(5).lean();
    const createdBy = users[0]?._id;
    if (createdBy) {
      await PromptModel.insertMany([
        { title: "영업 제안서 자동 생성", content: "고객 맞춤형 제안서 초안을 빠르게 작성해줘.", category: "sales", createdBy, likeCount: 128 },
        { title: "안전 점검 리포트 요약", content: "현장 안전 점검 내용을 요약하여 보고서 형태로 출력해줘.", category: "safety", createdBy, likeCount: 98 },
        { title: "보도자료 헤드라인 생성기", content: "보도자료 내용에 맞는 헤드라인 5개를 추천해줘.", category: "pr", createdBy, likeCount: 89 },
        { title: "악성 민원 응대 스크립트", content: "정중하고 단호한 응대 스크립트를 만들어줘.", category: "cs", createdBy, likeCount: 56 },
        { title: "계약서 요약 프롬프트 v2.0", content: "복잡한 계약서를 핵심 조항 중심으로 요약해줘.", category: "knowledge", createdBy, likeCount: 76 },
      ]);
    }
  }

  const vocCount = await VocItemModel.estimatedDocumentCount();
  if (vocCount === 0) {
    const users = await UserModel.find().limit(1).lean();
    const createdBy = users[0]?._id;
    if (createdBy) {
      await VocItemModel.insertMany([
        {
          title: "결제 오류에 따른 환불 요청",
          content: "카드 결제 후 이용이 되지 않아 환불을 요청합니다.",
          status: "registered",
          dept: "사업운영본부/사업기획처",
          createdBy,
        },
        {
          title: "서비스 불만(직원 응대)",
          content: "응대 과정에서 불친절을 경험했습니다.",
          status: "reviewing",
          dept: "기획조정본부/홍보처",
          createdBy,
        },
      ]);
    }
  }

  const safetyCount = await SafetyArticleModel.estimatedDocumentCount();
  if (safetyCount === 0) {
    await SafetyArticleModel.insertMany([
      { title: "1분기 안전 점검 결과", content: "전 사업장 안전 점검을 실시하였으며, 소화기·비상구 점검 결과를 공유합니다.", type: "news", thumbnailUrl: "" },
      { title: "화재 예방 매뉴얼", content: "화재 발생 시 대피 요령 및 소화기 사용법을 정리한 매뉴얼입니다.", type: "library", thumbnailUrl: "" },
      { title: "안전 보건 관리 규정 개정 안내", content: "안전 보건 관리 규정이 일부 개정되었습니다. 변경 사항을 확인해 주세요.", type: "news", thumbnailUrl: "" },
    ]);
  }

  const prCount = await PressReleaseModel.estimatedDocumentCount();
  if (prCount === 0) {
    const users = await UserModel.find().limit(1).lean();
    const createdBy = users[0]?._id;
    if (createdBy) {
      await PressReleaseModel.insertMany([
        { title: "○○기관, AI 기반 업무지원 시스템 도입", body: "○○기관이 AI 기반 업무지원 시스템을 도입하여 대국민 서비스를 강화한다고 밝혔다.", status: "draft", createdBy },
        { title: "상반기 서비스 개선 추진 계획", body: "이용자 만족도가 낮은 절차를 중심으로 개선 과제를 발굴해 추진할 예정이다.", status: "submitted", createdBy },
      ]);
    }
  }

  // 운영 설정 싱글톤 — 기관 고유값(기관명·대표자·패널 기여자)은 코드가 아닌 설정에 둔다.
  // 기여자 기본값은 가상 인물 목업이며, 실제 값은 관리자 설정에서 입력한다.
  await PlaygroundConfigModel.updateOne(
    { key: "default" },
    { $setOnInsert: { orgName: "", ceoName: "", panelIntro: DEFAULT_PANEL_CONTRIB } },
    { upsert: true, strict: false },
  );

  console.log("Seed completed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });

