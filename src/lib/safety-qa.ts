/**
 * 매장 안전 Q&A 단일 소스 — 매장안전챗봇 원본 안전DB 이식(107건).
 * 폐쇄망: 외부 API/임베딩 미사용. 여기서는 데이터(JSON) + 카테고리 메타 + UI 헬퍼만 제공한다.
 * 키워드 검색(RAG)은 server 전용 [safety-rag.ts] 참조.
 */
import safetyQaRaw from "@/data/safety/safety-qa.json";
import { secureRandomInt, secureShuffle } from "@/lib/random";

export type SafetyQa = {
  id: number;
  category: string;
  risk_default: string;
  q: string;
  patterns: string[];
  actions: string[];
  cautions: string[];
  report: string;
};

export const safetyQa = safetyQaRaw as SafetyQa[];

/**
 * 카테고리 메타 — 홈 카드 아이콘/색 + 검색용 도메인 키워드. (매장안전챗봇 원본 CATEGORY_META 이식)
 * 카테고리 추가 시 이 한 곳만 수정하면 카드 UI·검색 키워드에 모두 반영된다.
 */
export const CATEGORY_META: Record<string, { icon: string; color: string; bg: string; keywords: string[] }> = {
  전기: { icon: "electrical_services", color: "#d97706", bg: "#fffbeb", keywords: ["전기", "감전", "합선", "누전", "멀티탭", "플러그", "콘센트", "전선", "배선", "전열기", "히터", "난방"] },
  소방: { icon: "local_fire_department", color: "#dc2626", bg: "#fef2f2", keywords: ["소방", "소화기", "화재", "불", "스프링클러", "비상구", "대피", "연기", "경보", "소화", "진화", "방화"] },
  배기: { icon: "air", color: "#6366f1", bg: "#eef2ff", keywords: ["배기", "환기", "냄새", "가스", "일산화탄소"] },
  주방: { icon: "skillet", color: "#ea580c", bg: "#fff7ed", keywords: ["주방", "칼", "화상", "기름", "부탄", "조리", "베임", "베이", "절단"] },
  미끄러짐: { icon: "do_not_step", color: "#0891b2", bg: "#ecfeff", keywords: ["미끄러짐", "미끄럼", "낙상", "넘어", "바닥", "젖은", "전도"] },
  고객응대: { icon: "support_agent", color: "#0054a6", bg: "#eff6ff", keywords: ["고객", "컴플레인", "민원"] },
  응급처치: { icon: "emergency", color: "#e11d48", bg: "#fff1f2", keywords: ["응급", "구급", "심폐소생", "AED", "제세동", "쓰러", "의식"] },
  폭언난동: { icon: "gpp_bad", color: "#7c3aed", bg: "#f5f3ff", keywords: ["폭언", "난동", "폭력", "위협", "흉기", "술취"] },
  어린이: { icon: "child_care", color: "#059669", bg: "#ecfdf5", keywords: ["어린이", "아이", "유아", "키즈"] },
  유아카트: { icon: "shopping_cart", color: "#059669", bg: "#ecfdf5", keywords: ["유아카트", "카트"] },
  신고대응: { icon: "call", color: "#0284c7", bg: "#f0f9ff", keywords: ["신고", "112", "119", "경찰", "소방서"] },
  "보고/교육": { icon: "school", color: "#4f46e5", bg: "#eef2ff", keywords: ["보고", "교육", "점검", "안전관리", "규정", "위험성평가", "리스크", "유해요인", "근골격", "VDT"] },
  기상: { icon: "thermostat", color: "#0d9488", bg: "#f0fdfa", keywords: ["폭염", "온열", "더위", "한파", "동절기", "동파", "결빙", "빙판", "한여름", "장마"] },
};

export type CategoryStyle = { icon: string; color: string; bg: string };
const DEFAULT_STYLE: CategoryStyle = { icon: "shield", color: "#6b7280", bg: "#f9fafb" };

export function categoryStyle(name: string): CategoryStyle {
  const m = CATEGORY_META[name];
  return m ? { icon: m.icon, color: m.color, bg: m.bg } : DEFAULT_STYLE;
}

/**
 * 홈 화면 랜덤 퀵카드 N개 — 카테고리가 다양하게 섞이도록 선택. (매장안전챗봇 원본 이식)
 * 난수 사용 → 하이드레이션 불일치 방지를 위해 클라이언트 마운트 후 호출할 것.
 */
// source 풀을 받을 수 있게(기본=전체). 메인 추천 카드는 '강하게 매칭되는' 항목만 담은 풀을 넘긴다.
export function pickRandomCards(count: number, source: SafetyQa[] = safetyQa): SafetyQa[] {
  const base = source.length > 0 ? source : safetyQa;
  const categories = secureShuffle([...new Set(base.map((d) => d.category))]);
  const picked: SafetyQa[] = [];
  const usedIds = new Set<number>();
  // 카테고리를 돌며 하나씩 → 다양성 확보
  for (const cat of categories) {
    if (picked.length >= count) break;
    const pool = base.filter((d) => d.category === cat && !usedIds.has(d.id));
    if (pool.length > 0) {
      const item = pool[secureRandomInt(pool.length)];
      picked.push(item);
      usedIds.add(item.id);
    }
  }
  // 부족하면 나머지에서 랜덤 채움
  const remaining = secureShuffle(base.filter((d) => !usedIds.has(d.id)));
  for (const item of remaining) {
    if (picked.length >= count) break;
    picked.push(item);
  }
  return secureShuffle(picked);
}
