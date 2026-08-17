/**
 * 2차 퀴즈 Pool 시드 — 문서 9번 4개 퀴즈 등록
 * 실행: npx tsx src/scripts/seed-quiz-pool-2nd.ts (ax-portal 폴더에서)
 */
import "./load-env";

import mongoose from "mongoose";
import { env } from "../lib/env";
import { QuizPoolModel } from "../models/QuizPool";

const QUIZZES = [
  {
    question:
      "최근 AI 생태계에서 화두인 'MCP(Model Context Protocol)'의 역할을 비유하자면?",
    choices: [
      "AI의 두뇌를 업그레이드하는 칩",
      "AI가 외부 도구·데이터베이스와 소통할 수 있게 해주는 '배관(Plumbing)'",
      "AI가 인터넷을 검색하는 브라우저",
      "AI의 답변을 번역해주는 통역사",
    ],
    answerIndex: 1,
    explanation:
      "AI 모델(LLM)은 아무리 똑똑해도 혼자서는 우리 회사 DB에 접근하거나 엑셀을 열 수 없습니다. MCP는 AI와 외부 도구(DB, API, 파일시스템 등)를 연결하는 표준 프로토콜입니다.",
  },
  {
    question: "'바이브 코딩(Vibe Coding)'이란 무엇일까요?",
    choices: [
      "음악을 들으며 코딩하는 개발 문화",
      "감으로 대충 코딩하는 것",
      "자연어(일상 말)로 AI에게 지시하면 AI가 코드를 작성해주는 개발 방식",
      "특정 프로그래밍 언어의 이름",
    ],
    answerIndex: 2,
    explanation: "",
  },
  {
    question:
      "같은 AI에게 같은 질문을 했는데 결과 품질이 완전히 달라졌습니다. 가장 큰 차이를 만드는 요소는?",
    choices: [
      "AI 모델의 버전",
      "인터넷 속도",
      "프롬프트(질문/지시)를 얼마나 구체적으로 작성했는가",
      "사용하는 컴퓨터의 성능",
    ],
    answerIndex: 2,
    explanation:
      "'매출 분석해줘' vs '2024년 3분기 편의점 사업부 매출을 전년 동기 대비 증감률로 표로 정리하고, 하락 품목 상위 3개의 원인을 분석해줘' — 결과는 하늘과 땅 차이입니다. 프롬프트는 AI 시대의 '업무 지시서'입니다.",
  },
  {
    question:
      "국가AI전략위원회에서 정부·공공기관 보고서 작성 시 '마크다운(Markdown)' 형식을 도입하겠다고 했습니다. 가장 큰 이유는?",
    choices: [
      "한글(HWP) 라이선스 비용을 절감하려고",
      "AI가 마크다운 문서를 가장 잘 읽고 처리할 수 있어서",
      "마크다운이 디자인적으로 더 예쁘니까",
      "해외 표준에 맞추기 위한 외교적 이유",
    ],
    answerIndex: 1,
    explanation:
      "HWP·PDF는 AI가 텍스트를 추출하기 어렵고 구조 파악이 힘듭니다. 반면 마크다운은 AI가 즉시 파싱하고 요약·분석할 수 있습니다.",
  },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });

  const existing = await QuizPoolModel.countDocuments({
    question: QUIZZES[0].question,
  });
  if (existing > 0) {
    console.log("2차 퀴즈가 이미 존재합니다. 스킵.");
    return;
  }

  await QuizPoolModel.insertMany(QUIZZES);
  console.log("2차 퀴즈 4개 등록 완료.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
