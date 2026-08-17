/**
 * 패널 진입 스플래시(타이틀) 모달 콘텐츠.
 * - intro/background: 각 패널 기능에 맞춘 소개·개발 배경 (기관 무관 — 코드에 고정)
 * - badge / ideaBy / codeBy: 기관마다 다른 값이라 **관리자 설정(DB)** 으로 외부화한다.
 *   → PlaygroundConfig.panelIntro { [패널key]: { ideaBy, codeBy, badge } }
 *   → 공개 조회 API: GET /api/panel-intro (무로그인)
 *   아래 DEFAULT_PANEL_CONTRIB 는 **목업 예시**이며, 설정이 비어 있을 때의 폴백일 뿐이다.
 * 관리자(admin) 패널은 스플래시를 띄우지 않으므로 제외.
 */

/** 출처 배지 — 사내 아이디어 경진대회 수상작 / CEO 지시사항 / 수요조사 발굴. */
export type PanelBadgeKind = "contest" | "ceo" | "demand";

export const PANEL_BADGE_LABEL: Record<PanelBadgeKind, string> = {
  contest: "아이디어 경진대회 수상작",
  ceo: "CEO 지시사항",
  demand: "수요조사 발굴",
};

/** 기관별로 달라지는 부분 (관리자 설정). */
export type PanelContrib = {
  /** 아이디어 기여자 */
  ideaBy: string[];
  /** 코드개발 기여자 */
  codeBy: string[];
  /** 출처 배지 (없으면 미표시) */
  badge?: PanelBadgeKind;
};

/** 코드에 고정된 소개 문구. */
export type PanelIntroText = {
  /** 서비스 한 줄 소개 */
  intro: string;
  /** 개발 배경 */
  background: string;
};

/** 스플래시에 실제로 그려지는 합본. */
export type PanelIntro = PanelIntroText & PanelContrib;

export const PANEL_INTRO_TEXT: Record<string, PanelIntroText> = {
  quiz: {
    intro: "AI 리터러시 퀴즈로 실력을 겨루고 실시간 랭킹에 도전하는 게임형 학습 공간입니다.",
    background: "딱딱한 교육 대신 놀이로 AI 역량을 키우자는 취지에서, 임직원이 즐기며 배우도록 기획되었습니다.",
  },
  library: {
    intro: "검증된 프롬프트와 AI 활용 자료를 한곳에 모은 사내 프롬프트 도서관입니다.",
    background: "흩어진 노하우와 프롬프트를 공유 자산으로 축적해, 누구나 바로 꺼내 쓸 수 있도록 만들었습니다.",
  },
  search: {
    intro: "사규·매뉴얼 등 내부 지식을 자연어로 묻고 근거와 함께 답을 찾는 RAG 검색입니다.",
    background: "방대한 내부 문서에서 필요한 규정을 빠르고 정확히 찾기 어려운 문제를 해결하기 위해 개발되었습니다.",
  },
  sales: {
    intro: "편의점 매장 매출 엑셀을 올리면 KPI·ABC·카테고리·놓친매출·벤치마킹·재고예측과 AI 진단을 제공합니다.",
    background: "데이터를 들여다보는 시간을 줄이고 현장이 의사결정에 집중하도록, 분석과 보고를 자동화했습니다.",
  },
  "sales-trend": {
    intro: "업종·기간·역별 매출 흐름을 시각화합니다. 전문점 대>중>소 드릴다운·역간 비교·예측·자연어 검색까지.",
    background: "전사 매출 트렌드를 클릭만으로 파악하고, 업종 구조와 추세를 빠르게 읽을 수 있도록 만들었습니다.",
  },
  docs: {
    intro: "보고서·시행문·보도자료·이메일 등 공공기관 표준 문서를 AI가 초안부터 서식까지 작성합니다.",
    background: "반복적인 문서 작업의 부담을 줄이고, 누구나 일관된 품질의 공문서를 빠르게 만들도록 기획되었습니다.",
  },
  safety: {
    intro: "현장 사진과 자연어 설명으로 위험요소를 분석해 안전관리를 돕는 도구입니다.",
    background: "현장의 위험을 더 빠르게 발견하고 기록·공유하기 위해, 사진·자연어 기반 분석을 도입했습니다.",
  },
  "cs-answer": {
    intro: "CS 민원 내용을 바탕으로 규정에 맞는 최적의 답변안을 AI가 작성합니다.",
    background: "민원 응대의 품질을 고르게 하고 담당자의 작성 부담을 덜기 위해 개발되었습니다.",
  },
  "ad-review": {
    intro: "광고 도안을 내부 기준으로 심의해 위반·확인 사항을 짚어 줍니다.",
    background: "광고 심의의 일관성과 속도를 높이고, 사전 점검으로 리스크를 줄이기 위해 만들었습니다.",
  },
  magazine: {
    intro: "리서치가 필요한 사항은 무엇이든 요청해주세요!",
    background: "필요한 리서치를 언제든 요청하고 결과를 받아볼 수 있도록, 리서치 의뢰 창구를 마련했습니다.",
  },
};

/** 관리자 설정 UI에 노출할 패널 목록(순서 고정). */
export const PANEL_INTRO_KEYS = Object.keys(PANEL_INTRO_TEXT);

/**
 * 기여자 기본값 — **가상 인물 목업**. 실제 운영기관 값은 관리자 설정에서 입력한다.
 * (배포본에 특정인의 실명이 남지 않도록 코드 기본값은 예시로만 둔다.)
 */
export const DEFAULT_PANEL_CONTRIB: Record<string, PanelContrib> = {
  quiz: { ideaBy: ["정보화부서"], codeBy: ["정보화부서"] },
  library: { ideaBy: ["정보화부서"], codeBy: ["정보화부서"] },
  search: { ideaBy: ["전사공통"], codeBy: ["정보화부서"] },
  sales: { badge: "contest", ideaBy: ["김하늘", "이도윤"], codeBy: ["프로토타입 박서준", "수정/보완 최지우"] },
  "sales-trend": { badge: "ceo", ideaBy: ["정민재"], codeBy: ["프로토타입 정민재", "수정/보완 한소율"] },
  docs: { badge: "contest", ideaBy: ["한소율", "오세훈"], codeBy: ["한소율"] },
  safety: { badge: "contest", ideaBy: ["윤가온"], codeBy: ["프로토타입 윤가온", "수정/보완 최지우"] },
  "cs-answer": { badge: "contest", ideaBy: ["최지우"], codeBy: ["최지우"] },
  "ad-review": { badge: "demand", ideaBy: ["콘텐츠부서"], codeBy: ["프로토타입 배수아", "수정/보완 한소율"] },
  magazine: { badge: "ceo", ideaBy: ["정보화부서"], codeBy: ["정보화부서"] },
};

function toNameList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  return [];
}

function toBadge(v: unknown): PanelBadgeKind | undefined {
  return v === "contest" || v === "ceo" || v === "demand" ? v : undefined;
}

/** DB(Mixed) 값 → 안전한 PanelContrib 맵. 알 수 없는 패널 키·타입은 버린다. */
export function sanitizePanelIntro(v: unknown): Record<string, PanelContrib> {
  const out: Record<string, PanelContrib> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!PANEL_INTRO_KEYS.includes(k) || !raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const badge = toBadge(o.badge);
    out[k] = { ideaBy: toNameList(o.ideaBy), codeBy: toNameList(o.codeBy), ...(badge ? { badge } : {}) };
  }
  return out;
}

/** 설정값(있으면) + 코드 기본값(폴백)을 합쳐 스플래시용 데이터로. */
export function resolvePanelIntro(configured?: Record<string, PanelContrib> | null): Record<string, PanelIntro> {
  const out: Record<string, PanelIntro> = {};
  for (const [k, text] of Object.entries(PANEL_INTRO_TEXT)) {
    const c = configured?.[k] ?? DEFAULT_PANEL_CONTRIB[k] ?? { ideaBy: [], codeBy: [] };
    out[k] = { ...text, ...c };
  }
  return out;
}
