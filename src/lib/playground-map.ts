/**
 * AX Playground 메인 — 레이어 합성 데이터.
 * 배경(base-map.png) 위에 각 건물 PNG를 절대 배치한다.
 * 좌표계: 원본 1672 × 941 (배경 이미지 기준). 컴포넌트에서 %로 변환.
 *
 * 좌표 산출 방식(재현 가능):
 *  1) base-map의 빈 원형 플랫폼을 색상으로 자동검출 → 중심/가로폭
 *  2) 각 건물 PNG를 알파>8 기준 타이트 재크롭(투명여백 제거 → 클릭박스=본체)
 *  3) 본체 종횡비 유지 + 플랫폼 폭 대비 축소(scale)·하강(foot)으로 left/top/width/height 산출
 *     (성은 타이틀 가림 방지로 아래 배치, 라벨 카드가 항상 위에 떠서 세로 간격 확보)
 */

export const MAP_W = 1672;
export const MAP_H = 941;

export type Building = {
  id: string;
  /** 메인 표시 번호(라벨 배지). */
  no: number;
  label: string;
  desc: string;
  href: string;
  image: string;
  /** 테마색(라벨 배지/제목/외곽선). */
  color: string;
  /** 원본 좌표계 배치 (재크롭 본체의 종횡비 반영). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** true면 href가 외부 웹앱 URL — 스플래시 없이 새 탭으로 연다. */
  external?: boolean;
};

/** 9개 기능 건물 + 중앙 성. 번호순. (라우트 매핑은 실행계획 §2-4) */
export const BUILDINGS: Building[] = [
  { id: "quiz",      no: 1, label: "AI 리터러시 리더보드", desc: "AI 리터러시 퀴즈 게임 · 실시간 랭킹", href: "/quiz",            image: "/playground/buildings/castle.png",   color: "#b45309", left: 534,  top: 150, width: 600, height: 459 },
  { id: "library",   no: 2, label: "AX 라이브러리",       desc: "프롬프트 도서관 · AI자료실",         href: "/library",         image: "/playground/buildings/library.png",  color: "#7c3aed", left: 136,  top: 155, width: 299, height: 208 },
  { id: "search",    no: 3, label: "AI 지식검색",         desc: "사규·매뉴얼 등 내부지식 RAG검색",    href: "/panel/knowledge",       image: "/playground/buildings/search.png",   color: "#16a34a", left: 46,   top: 312, width: 257, height: 213 },
  { id: "sales",     no: 4, label: "AI 매출분석",         desc: "편의점 매출 비교·업종별 트렌드 분석",        href: "/panel/sales",     image: "/playground/buildings/sales.png",    color: "#2563eb", left: 1221, top: 92,  width: 296, height: 273 },
  { id: "docs",      no: 5, label: "AI 문서작성",         desc: "보고서·시행문·보도자료 등 작성",     href: "/panel/docs",      image: "/playground/buildings/docs.png",     color: "#ea580c", left: 1331, top: 283, width: 274, height: 236 },
  { id: "safety",    no: 6, label: "스마트 안전관리",     desc: "자연어·사진으로 위험요소 분석",      href: "/panel/safety",    image: "/playground/buildings/safety.png",   color: "#0f766e", left: 86,   top: 514, width: 242, height: 234 },
  { id: "cs-answer", no: 7, label: "AI 민원답변",         desc: "CS 민원 기반 최적 답변안 작성",      href: "/panel/cs-answer", image: "/playground/buildings/cs.png",       color: "#dc2626", left: 426,  top: 521, width: 233, height: 219 },
  { id: "ad-review", no: 8, label: "AI 광고도안심의",     desc: "광고도안 내부기준 도안심의",         href: "/panel/ad-review", image: "/playground/buildings/ad.png",       color: "#1e3a8a", left: 998,  top: 533, width: 235, height: 214 },
  { id: "magazine",  no: 9, label: "AI 리서치매거진",     desc: "인사이트허브 소개 · QR링크",         href: "/panel/magazine",  image: "/playground/buildings/magazine.png", color: "#1e40af", left: 1310, top: 500, width: 259, height: 229 },
];

/**
 * 플랫폼 핵심 4기능 — 내부 구현이 곧 서비스라 외부 웹앱 연계·숨김 대상이 아니다.
 * (이름·설명 변경은 허용 — 기관 용어에 맞출 수 있게.)
 */
export const CORE_BUILDING_IDS: readonly string[] = ["quiz", "library", "search", "docs"];

/** 관리자 설정(playground_config.panelOverrides)으로 덮어쓸 수 있는 건물 속성. */
export type BuildingOverride = {
  /** 건물 이름(라벨 카드·메뉴 타일). 비우면 코드 기본값. */
  label?: string;
  /** 한 줄 설명. 비우면 코드 기본값. */
  desc?: string;
  /** 기관 자체 웹앱 URL — 설정 시 내부 패널 대신 새 탭으로 이동(핵심 4기능 제외). */
  externalUrl?: string;
  /** 메인에서 숨김(핵심 4기능 제외). */
  hidden?: boolean;
};

const BUILDING_IDS = new Set(BUILDINGS.map((b) => b.id));

/** DB(Mixed) 값 → 안전한 오버라이드 맵. 알 수 없는 건물 키·타입·URL 스킴은 버린다. */
export function sanitizePanelOverrides(v: unknown): Record<string, BuildingOverride> {
  const out: Record<string, BuildingOverride> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!BUILDING_IDS.has(k) || !raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const entry: BuildingOverride = {};
    // 라벨 카드는 nowrap이라 과도하게 길면 옆 건물을 침범한다 — 길이 상한.
    if (typeof o.label === "string" && o.label.trim()) entry.label = o.label.trim().slice(0, 16);
    if (typeof o.desc === "string" && o.desc.trim()) entry.desc = o.desc.trim().slice(0, 30);
    const core = CORE_BUILDING_IDS.includes(k);
    if (!core && typeof o.externalUrl === "string") {
      const u = o.externalUrl.trim();
      if (/^https?:\/\//i.test(u)) entry.externalUrl = u.slice(0, 300);
    }
    if (!core && o.hidden === true) entry.hidden = true;
    if (Object.keys(entry).length) out[k] = entry;
  }
  return out;
}

/** 코드 기본값 + 관리자 오버라이드 병합 → 메인화면에 실제로 그릴 건물 목록. */
export function resolveBuildings(overrides?: Record<string, BuildingOverride> | null): Building[] {
  const ov = overrides ?? {};
  return BUILDINGS.filter((b) => !ov[b.id]?.hidden).map((b) => {
    const o = ov[b.id];
    if (!o) return b;
    return {
      ...b,
      label: o.label ?? b.label,
      desc: o.desc ?? b.desc,
      ...(o.externalUrl ? { href: o.externalUrl, external: true } : {}),
    };
  });
}

/** 중앙 성 전광판(리더보드 표시) 위치 — castle 본체 navy 패널 자동검출(원본 좌표). P3에서 실데이터 연결. */
export const LEADERBOARD_BOX = { left: 710, top: 360, width: 241, height: 171 };

/** 히든 관리자 진입 — 우측 매표소(TICKET). 배경의 일부라 polygon 클릭영역. */
export const ADMIN_HIDDEN = { href: "/admin", points: "1045,850 1130,850 1130,925 1045,925" };

/** 메뉴(풀다운) 모드용. */
export const MENU_ITEMS = BUILDINGS.map((b) => ({ id: b.id, no: b.no, label: b.label, desc: b.desc, href: b.href, color: b.color }));

/** 패널 → Material Symbols 아이콘(오프라인 번들 폰트 서브셋 글리프). 메뉴 타일·진입 스플래시 공용. */
export const PANEL_ICON: Record<string, string> = {
  quiz: "emoji_events",
  library: "menu_book",
  search: "manage_search",
  sales: "storefront",
  "sales-trend": "trending_up",
  docs: "edit_document",
  safety: "health_and_safety",
  "cs-answer": "support_agent",
  "ad-review": "fact_check",
  magazine: "article",
  admin: "admin_panel_settings",
};
