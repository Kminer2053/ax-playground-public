/**
 * 서바이벌 퀴즈 Pool 시드 — AI 리터러시 상식 문제(멱등).
 * 실행: npx tsx src/scripts/seed-quiz-survival.ts (ax-portal 폴더에서)
 */
import "./load-env";

import mongoose from "mongoose";
import { env } from "../lib/env";
import { QuizPoolModel } from "../models/QuizPool";

const QUIZZES = [
  {
    question: "생성형 AI가 사실이 아닌 내용을 그럴듯하게 지어내는 현상을 뭐라고 부를까요?",
    choices: ["오버피팅(Overfitting)", "할루시네이션(Hallucination)", "토크나이징(Tokenizing)", "프롬프트 인젝션"],
    answerIndex: 1,
    explanation: "할루시네이션은 LLM이 모르는 내용을 자신감 있게 만들어내는 현상입니다. 그래서 AI 답변은 항상 출처·사실 확인이 필요합니다.",
  },
  {
    question: "LLM이 한 번에 기억하고 처리할 수 있는 텍스트의 양을 가리키는 말은?",
    choices: ["컨텍스트 윈도우(Context Window)", "램(RAM)", "방화벽(Firewall)", "캐시(Cache)"],
    answerIndex: 0,
    explanation: "컨텍스트 윈도우는 모델이 한 번에 볼 수 있는 토큰 수입니다. 이를 넘으면 앞부분을 '잊어버려' 맥락이 끊길 수 있습니다.",
  },
  {
    question: "회사 내부 문서를 AI 답변에 활용하려고, 질문과 관련된 문서를 먼저 검색해 함께 제공하는 기법은?",
    choices: ["RAG(검색증강생성)", "파인튜닝", "프롬프트 인젝션", "백프로파게이션"],
    answerIndex: 0,
    explanation: "RAG는 내부/외부 지식을 검색해 LLM에 함께 넣어주는 방식입니다. 모델 재학습 없이 전용 지식을 반영할 수 있어 사내 문서 활용의 핵심입니다.",
  },
  {
    question: "사내 보안상 가장 위험한 행동은?",
    choices: [
      "AI에게 보고서 문장을 다듬어 달라고 하기",
      "공개된 외부 AI 서비스에 고객 개인정보·미공개 영업비밀을 그대로 입력하기",
      "AI에게 회의록 요약을 부탁하기",
      "AI에게 엑셀 함수 사용법을 묻기",
    ],
    answerIndex: 1,
    explanation: "외부 AI 서비스에 입력한 데이터는 학습에 쓰이거나 외부에 남을 수 있습니다. 개인정보·기밀은 내부망 전용 AI에서만 다뤄야 합니다.",
  },
  {
    question: "이미지, 음성, 텍스트 등 여러 종류의 데이터를 함께 이해·처리하는 AI를 뭐라고 할까요?",
    choices: ["멀티모달(Multimodal) AI", "싱글톤 AI", "레거시 AI", "오프라인 AI"],
    answerIndex: 0,
    explanation: "멀티모달 AI는 텍스트뿐 아니라 사진·표·음성을 함께 이해합니다. 현장 사진으로 위험요소를 분석하는 안전관리 기능이 멀티모달을 활용합니다.",
  },
  {
    question: "특정 업무·말투에 맞게 AI 모델 자체를 추가 학습시키는 것을 뭐라고 할까요?",
    choices: ["파인튜닝(Fine-tuning)", "프롬프팅", "캐싱", "스트리밍"],
    answerIndex: 0,
    explanation: "파인튜닝은 모델 가중치를 추가 학습으로 조정합니다. 비용·시간이 크므로 많은 경우 먼저 프롬프트·RAG로 해결을 시도합니다.",
  },
  {
    question: "AI가 더 정확히 답하도록 좋은 예시 몇 개를 프롬프트에 함께 보여주는 기법은?",
    choices: ["퓨샷(Few-shot) 프롬프팅", "제로데이", "오버클럭", "롤백"],
    answerIndex: 0,
    explanation: "원하는 형식의 예시를 보여주면(few-shot) AI가 패턴을 따라 일관된 결과를 냅니다. 예시 없이 지시만 하면 'zero-shot'입니다.",
  },
  {
    question: "AI에게 역할·규칙·말투를 미리 정해주는 기본 지침을 무엇이라 부를까요?",
    choices: ["시스템 프롬프트(System Prompt)", "쿠키", "세션 토큰", "메타태그"],
    answerIndex: 0,
    explanation: "시스템 프롬프트는 '너는 친절한 민원 상담사야'처럼 AI의 기본 역할·태도를 정합니다. 사용자가 매번 입력하는 질문과 구분됩니다.",
  },
  {
    question: "스스로 계획을 세우고 도구(검색·계산·DB 등)를 사용해 여러 단계를 수행하는 AI를 뭐라고 할까요?",
    choices: ["AI 에이전트(Agent)", "챗봇 매크로", "스팸봇", "RPA 스크립트"],
    answerIndex: 0,
    explanation: "AI 에이전트는 목표를 받으면 스스로 단계를 나눠 도구를 호출하며 일을 처리합니다. 단순 1문1답 챗봇을 넘어선 개념입니다.",
  },
  {
    question: "텍스트를 의미가 담긴 숫자 벡터로 바꿔, 비슷한 의미끼리 가깝게 표현하는 기술은?",
    choices: ["임베딩(Embedding)", "압축(Zip)", "암호화(Encryption)", "렌더링(Rendering)"],
    answerIndex: 0,
    explanation: "임베딩은 문장을 벡터로 변환합니다. '강아지'와 '개'가 가까운 벡터가 되어 의미 기반 검색과 RAG의 토대가 됩니다.",
  },
  {
    question: "AI 답변을 업무에 쓸 때 가장 바람직한 태도는?",
    choices: [
      "AI는 항상 정확하니 검증 없이 사용한다",
      "AI 답변을 초안으로 보고, 사실·수치·출처를 사람이 검증한다",
      "AI 답변이 길면 무조건 신뢰한다",
      "영어로 답하면 더 정확하니 영어만 쓴다",
    ],
    answerIndex: 1,
    explanation: "AI는 강력한 '초안 도구'이지만 할루시네이션 가능성이 있습니다. 최종 책임은 사람에게 있으므로 사실·수치·출처 검증은 필수입니다.",
  },
  {
    question: "인터넷 연결 없이 회사 내부 서버·PC에서 직접 AI 모델을 돌리는 방식의 가장 큰 장점은?",
    choices: [
      "전기를 아낄 수 있다",
      "데이터가 외부로 나가지 않아 보안에 유리하다",
      "무조건 더 똑똑하다",
      "인터넷이 더 빨라진다",
    ],
    answerIndex: 1,
    explanation: "로컬/온프레미스 LLM은 데이터를 외부로 보내지 않아 개인정보·기밀 보호에 유리합니다. AX Playground도 내부망 전용으로 운영됩니다.",
  },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });
  let added = 0;
  for (const q of QUIZZES) {
    const exists = await QuizPoolModel.findOne({ question: q.question }).lean();
    if (!exists) {
      await QuizPoolModel.create(q);
      added++;
    }
  }
  const total = await QuizPoolModel.countDocuments();
  console.log(`서바이벌 퀴즈 시드: ${added}개 신규 추가 (기존 ${QUIZZES.length - added}개 스킵). QuizPool 총 ${total}개.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
