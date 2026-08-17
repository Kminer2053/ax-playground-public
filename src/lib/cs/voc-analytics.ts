/**
 * 민원(VOC) 집계 로더 + LLM 그라운딩 컨텍스트 빌더.
 * 사전 빌드된 PII 없는 집계(2024·2025 전사 고객의소리)를 정적 파일로 번들해 답변 근거로 주입한다.
 * 데이터가 작은 집계(약 20KB)라 DB 없이 파일 import 한 번으로 충분.
 * 원본: kr-minwon `lib/monitor/analytics.ts`. 데이터 갱신: src/data/cs/voc-aggregates.json 교체 후 재배포.
 */
import aggregatesJson from "@/data/cs/voc-aggregates.json";

export type Year = "2024" | "2025";
export type Counted = { name: string; count: number; pct: number };
export type FieldCount = Counted & { estimated: boolean };
export type StationCount = Counted & { verified: boolean; topField: string | null };
export type Share = { count: number; pct: number };
export type Sla = { computable: number; total: number; medianDays: number; within14Pct: number; onTimePct: number } | null;

export type YearAgg = {
  total: number;
  byBonbu: Counted[];
  byField: FieldCount[];
  byType1: Counted[];
  byType2: Counted[];
  byCompletion: Counted[];
  topStations: StationCount[];
  stationCoveragePct: number;
  topBrands: Counted[];
  repeatIssues: Counted[];
  negativeShare: Share;
  paymentShare: Share;
  praiseShare: Share;
  transferShare: Share;
  sla: Sla;
};

export type YoyRow = { name: string; y2024: number; y2025: number; deltaPct: number | null };

export type MonitorAggregates = {
  generatedAt: string;
  source: string;
  totals: { y2024: number; y2025: number; all: number; yoyPct: number | null };
  byMonth: { month: number; y2024: number; y2025: number }[];
  yoy: { byBonbu: YoyRow[]; byIssue: YoyRow[] };
  years: { "2025": YearAgg; "2024": YearAgg };
};

/** 번들된 VOC 집계(정적, PII 없음). */
export const vocAggregates = aggregatesJson as unknown as MonitorAggregates;

function getYearAgg(a: MonitorAggregates, year: Year): YearAgg {
  return a.years[year];
}

/** citedStats 검증용 — 집계에 등장하는 모든 수치 집합(환각 2차 차단). */
export function collectKnownNumbers(a: MonitorAggregates): Set<number> {
  const nums = new Set<number>();
  const add = (n: unknown) => {
    if (typeof n === "number" && Number.isFinite(n)) nums.add(n);
  };
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else add(v);
  };
  walk(a);
  return nums;
}

function topList(items: Counted[], n: number): string {
  return items.slice(0, n).map((x) => `${x.name} ${x.count}(${x.pct}%)`).join(", ");
}

/**
 * 단건 민원 분석용 — 2024·2025 전사 집계를 compact 텍스트로 직렬화.
 * "이게 반복 유형인지·얼마나 흔한지·어떻게 처리되는지"의 근거로 LLM에 주입.
 */
export function buildComplaintContext(a: MonitorAggregates): string {
  const y = getYearAgg(a, "2025"); // 최신 연도 기준 + 합계는 양년
  const lines: string[] = [];
  lines.push(
    `[2024–2025 전사 민원 통계 · 총 ${a.totals.all}건 (2024년 ${a.totals.y2024}건, 2025년 ${a.totals.y2025}건, 전년대비 ${a.totals.yoyPct ?? "-"}%)]`,
  );
  lines.push(`반복 민원 이슈군(2025년 상위): ${topList(y.repeatIssues, 11)}`);
  if (y.byType2.length) lines.push(`2차유형 상위(2025년): ${topList(y.byType2, 10)}`);
  if (y.byField.length) lines.push(`분야별(2025년): ${topList(y.byField, 8)}`);
  if (y.byType1.length) lines.push(`1차유형(2025년): ${topList(y.byType1, 8)}`);
  lines.push(`반복 역/매장 Top(2025년): ${y.topStations.slice(0, 12).map((s) => `${s.name} ${s.count}건`).join(", ")}`);
  lines.push(
    `민원 성격(2025년): 부정(불만·응대) ${y.negativeShare.pct}%, 결제/카드사고 ${y.paymentShare.pct}%, 칭찬 ${y.praiseShare.pct}%, 소관외이관 ${y.transferShare.pct}%`,
  );
  if (y.sla) {
    lines.push(`처리기간(2025년): 중앙값 ${y.sla.medianDays}일, 14일 내 처리 ${y.sla.within14Pct}%, 기한준수 ${y.sla.onTimePct}%`);
  }
  return lines.join("\n");
}
