/**
 * 매장 매출 분석 서비스 — KR_TAS Python 알고리즘 TypeScript 포팅
 * 파일 4종: 우리매장 일매출, 비교매장 일매출, 전체통계, 현재고
 */
import * as XLSX from "xlsx";

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

export interface DailySalesRow {
  date: string;
  productCode: string;
  productName: string;
  category1: string;
  category2: string;
  category3: string;
  qty: number;
  amount: number;
  hour?: number;   // 매출시간(HHMMSS)에서 추출한 '시'(0~23) — 시간대 분석용
  txnKey?: string; // 고유 거래 키 (날짜|POS|거래순번) — 방문객/객단가 산출용
  bonbu?: string;    // 본부 (변형 양식)
  vendor?: string;   // 거래처(공급처) (변형 양식)
  contract?: string; // 계약구분 (변형 양식)
  pb?: boolean;      // PB상품 여부 (변형 양식)
  maint?: boolean;   // 정비상품 여부 (변형 양식)
}

/** 시간대별 매출(매출·객수·객단가 + 누적) */
export interface HourlyPoint {
  hour: number;
  amount: number;
  qty: number;
  visitors: number;        // 객수(고유 거래 수)
  avgPerVisitor: number;   // 객단가
  cumAmount: number;       // 누적 매출
  cumVisitors: number;     // 누적 객수
}

/** 요일별 매출 */
export interface DowPoint {
  dow: number;             // 0=월 … 6=일
  label: string;           // "월"…"일"
  amount: number;
  qty: number;
  visitors: number;
  days: number;            // 해당 요일이 데이터에 등장한 날 수
  avgAmount: number;       // 요일 일평균 매출
}

/** 기간(일/주/월) 매출 */
export interface PeriodPoint {
  key: string;
  label: string;
  amount: number;
  qty: number;
  visitors: number;
  avgPerVisitor: number;
}

export interface AllStoreStatsRow {
  yearMonth: string;
  productCode: string;
  productName: string;
  category1: string;
  storeCount: number;
  totalQty: number;
  totalAmount: number;
  bonbu?: string;    // 본부 (변형 양식 — 본부별 매출용)
}

export interface InventoryRow {
  productCode: string;
  productName: string;
  stock: number;
}

export interface GapItem {
  productCode: string;
  productName: string;
  category1: string;
  ourDailyAvg: number;
  allDailyAvg: number;
  gapRatio: number;
}

export interface AbcItem {
  productCode: string;
  productName: string;
  category1: string;
  totalAmount: number;
  cumShare: number;
  grade: "A" | "B" | "C";
  ourRank: number;
  allRank: number | null;
}

/** 침투율 — 전체 매장 중 이 상품을 파는 매장 비율 (판매매장수 기반) */
export interface PenetrationItem {
  productCode: string;
  productName: string;
  category1: string;
  storeCount: number;      // 판매 매장 수
  totalStores: number;     // 전체 매장 수(관측 최대치로 추정)
  penetration: number;     // storeCount / totalStores (0~1)
  grade: "A" | "B" | "C";  // A≥0.7(필수상품) · B≥0.3 · C(틈새)
  weCarry: boolean;        // 우리 매장 취급 여부
  allAmount: number;       // 전체 매출(참고)
}

/** 매장당 성과 — 우리 매장 매출 vs 전체 매장당 평균 매출 비율 */
export interface PerStoreItem {
  productCode: string;
  productName: string;
  category1: string;
  ourAmount: number;          // 우리 매장 매출
  allPerStoreAmount: number;  // 전체 매장당 평균 매출
  ratio: number;              // ourAmount / allPerStoreAmount (>1 우위)
  storeCount: number;
}

/** MBA(장바구니 분석) 연관규칙 — "A 사면 B도 같이" */
export interface BasketRule {
  a: string;          // 선행 상품명
  b: string;          // 후행 상품명
  count: number;      // 동시 구매 거래 수
  support: number;    // count / 총거래수
  confidence: number; // P(B|A)
  lift: number;       // >1 = 양(+)의 연관
}

export interface CategoryPortfolioItem {
  category: string;
  ourShare: number;
  allShare: number;
  ourAmount: number;
  allAmount: number;
  gap: number;
}

export interface TimeSeriesPoint {
  date: string;
  amount: number;
  qty: number;
  ma7: number | null;
  compareAmount: number | null; // 비교매장 같은 날 매출
}

export interface InventoryAlert {
  productCode: string;
  productName: string;
  stock: number;
  dailySale: number;
  exhaustDays: number | null;
  status: "danger" | "warn" | "ok" | "noSale";
}

export interface Insight {
  type: "category_gap" | "opportunity" | "efficiency" | "missing_essential" | "penetration" | "performance";
  level: "high" | "mid" | "low";
  title: string;
  body: string;
  action: string;
}

export interface LostRevenueItem {
  category: string;
  ourShare: number;
  allShare: number;
  gap: number;        // allShare - ourShare (양수 = 부족)
  amount: number;     // 양수 = 손실 추정, 음수 = 초과 수익
  isPositive: boolean; // true = 우리가 잘함 (초과 수익)
}

export interface TrendProductItem {
  category: string;
  ourName: string;
  ourDailyAvg: number;     // 일평균 매출(원)
  compareName: string;
  compareDailyAvg: number;
  weWin: boolean;
}

export interface BenchmarkData {
  ourName: string;
  ourDailyAvg: number;
  compareName: string;
  compareDailyAvg: number;
  ourRank: number;  // 1 또는 2
  diffPct: number;  // (우리-비교)/비교
}

/** 본부별 매출 (전매장 통계의 본부 차원) */
export interface BonbuPoint { bonbu: string; amount: number; qty: number; share: number; }
/** 공급처(거래처)별 매출 — 우리 매장 */
export interface VendorPoint { vendor: string; amount: number; qty: number; products: number; }
/** 계약구분별 매출 — 우리 매장 */
export interface ContractPoint { contract: string; amount: number; share: number; }
/** PB상품 분석 — 우리 매장 (변형 양식에 PB상품 컬럼 있을 때만) */
export interface PbSummary {
  pbAmount: number; normalAmount: number; pbShare: number; pbItemCount: number;
  maintAmount: number; topPb: { name: string; amount: number }[];
}

export interface SalesAnalysisResult {
  storeName: string;
  /** 매장 소속 본부 (날씨 매핑용, 선택) */
  bonbu?: string;
  compareStoreName: string;
  period: { start: string; end: string; days: number };
  totalAmount: number;
  totalQty: number;
  dailyAvgAmount: number;
  uniqueProducts: number;
  visitors: number;        // 방문객 (고유 거래 수, POS 데이터 있을 때만 >0)
  avgPerVisitor: number;   // 객단가
  gapAnalysis: GapItem[];
  abcRanking: AbcItem[];
  penetration: PenetrationItem[];   // 침투율(전체 매장 중 판매 비율)
  perStore: PerStoreItem[];         // 매장당 성과(우리 vs 전체 평균)
  marketBasket: BasketRule[];       // MBA 장바구니 연관규칙
  categoryPortfolio: CategoryPortfolioItem[];
  timeSeries: TimeSeriesPoint[];
  hourly: HourlyPoint[];                                   // 시간대별 매출·객수·객단가(+누적)
  dayOfWeek: DowPoint[];                                   // 요일별 매출
  periods: { day: PeriodPoint[]; week: PeriodPoint[]; month: PeriodPoint[] }; // 일/주/월 매출
  byBonbu: BonbuPoint[];        // 본부별 매출(전매장 통계, 변형 양식)
  byVendor: VendorPoint[];      // 공급처별 매출(우리 매장, 변형 양식)
  byContract: ContractPoint[];  // 계약구분별 매출(우리 매장, 변형 양식)
  pb: PbSummary | null;         // PB상품 분석(우리 매장, 변형 양식)
  inventoryAlerts: InventoryAlert[];
  insights: Insight[];
  lostRevenue: { total: number; items: LostRevenueItem[] };
  trendProducts: TrendProductItem[];
  benchmark: BenchmarkData | null;
  diagnosisContext: string;
}

// ─── Excel 파싱 헬퍼 ─────────────────────────────────────────────────────────

/** Node.js Buffer 또는 브라우저 ArrayBuffer 모두 처리 */
function readWorkbook(input: Buffer | ArrayBuffer): XLSX.WorkBook {
  if (input instanceof ArrayBuffer) {
    return XLSX.read(new Uint8Array(input), { type: "array", cellDates: false });
  }
  return XLSX.read(input, { type: "buffer", cellDates: false });
}

function parseDate(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "number") {
    // 날짜가 YYYYMMDD 형식 숫자로 저장된 경우 (예: 20251001)
    if (raw >= 19000101 && raw <= 21001231) {
      const s = String(Math.round(raw));
      if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    // Excel 날짜 시리얼
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return String(raw);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(raw).replace(/\./g, "-").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

function num(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * 파일 간 상품 조인 키. 일별매출실적은 바코드(13자리), 매출통계는 내부코드(7자리)로
 * **코드 체계가 달라 코드로는 0% 매칭**된다. 따라서 코드가 안 맞을 때 상품명으로 폴백 조인한다.
 * (NFC 정규화 + 공백 제거 + 소문자 — 표기 차이 흡수)
 */
function nameKey(name: string): string {
  return str(name).normalize("NFC").replace(/\s+/g, "").toLowerCase();
}


/** 매출시간(HHMMSS, 예: 142340 → 14시)에서 '시'(0~23) 추출. 없으면 undefined. */
function parseHourFromTime(v: unknown): number | undefined {
  const n = num(v);
  if (!n) return undefined;
  const h = Math.floor(n / 10000);
  return h >= 0 && h <= 23 ? h : undefined;
}

/** 날짜("YYYY-MM-DD")의 요일 인덱스. 0=월 … 6=일. 실패 시 -1. */
function dowIndex(date: string): number {
  const m = String(date).replace(/\D/g, "");
  if (m.length < 8) return -1;
  const y = +m.slice(0, 4), mo = +m.slice(4, 6), da = +m.slice(6, 8);
  if (!y || !mo || !da) return -1;
  return (new Date(y, mo - 1, da).getDay() + 6) % 7; // JS 0=일 → 0=월 보정
}

function sheetToRows(wb: XLSX.WorkBook): Record<string, unknown>[] {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
}

/**
 * 머리말(제목·필터 등)이 앞에 붙은 엑셀에서도 헤더 행을 자동 탐지해 객체 배열로 변환.
 * anchors(예: ["상품코드","현재고"]) 중 과반을 포함하는 첫 행을 헤더로 사용.
 * (예: '매장 현재고현황'처럼 제목·센터/매장·필터 줄이 상단에 붙은 양식 대응)
 */
function sheetToRowsAuto(wb: XLSX.WorkBook, anchors: string[]): Record<string, unknown>[] {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
  const need = Math.max(1, Math.ceil(anchors.length / 2));
  let hi = -1;
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const cells = (aoa[i] ?? []).map((c) => str(c).trim());
    if (anchors.filter((a) => cells.includes(a)).length >= need) {
      hi = i;
      break;
    }
  }
  if (hi < 0) return sheetToRows(wb); // 헤더 못 찾으면 기존 방식
  const header = (aoa[hi] ?? []).map((c) => str(c).trim());
  const out: Record<string, unknown>[] = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const row = (aoa[i] ?? []) as unknown[];
    const obj: Record<string, unknown> = {};
    let any = false;
    header.forEach((h, j) => {
      if (!h) return;
      const v = row[j] ?? "";
      obj[h] = v;
      if (v !== "" && v != null) any = true;
    });
    if (any) out.push(obj);
  }
  return out;
}

// ─── 파일 파싱 ───────────────────────────────────────────────────────────────

/**
 * 변형(KRS 원본형) 일별매출실적 = 상품×날짜 피벗 양식 감지.
 * 머리말 아래 2행 헤더: (날짜행 = 8자리 날짜가 여러 열) + (하위행 = 판매수량/판매금액).
 * 감지 시 날짜 헤더행 인덱스 반환, 아니면 -1.
 */
function detectPivotHeader(aoa: unknown[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = (aoa[i] ?? []).map((c) => str(c));
    const dateCells = row.filter((c) => /^\d{8}$/.test(c)).length;
    const sub = (aoa[i + 1] ?? []).map((c) => str(c));
    if (dateCells >= 3 && sub.some((c) => c.includes("판매수량"))) return i;
  }
  return -1;
}

/**
 * 변형(피벗) 양식 → DailySalesRow[] 언피벗.
 * 상품(내부코드)×날짜 집계라 매출시간·POS가 없음 → hour/txnKey undefined
 * (시간대·MBA·객단가는 자연히 빈값). 끝의 평균·합계 열은 8자리 날짜가 아니라 제외됨.
 */
function parseDailySalesPivot(aoa: unknown[][], hd: number): DailySalesRow[] {
  const head = (aoa[hd] ?? []).map((c) => str(c));      // 날짜 + 고정 라벨
  const sub = (aoa[hd + 1] ?? []).map((c) => str(c));    // 판매수량/판매금액 + 고정 라벨
  const idxOf = (label: string) => sub.findIndex((c) => c === label);
  const ci = {
    code: idxOf("상품"), name: idxOf("상품명"), c1: idxOf("대분류명"), c2: idxOf("중분류명"), c3: idxOf("소분류명"),
    bonbu: idxOf("본부"), vendor: idxOf("거래처"), contract: idxOf("계약구분"), pb: idxOf("PB상품"), maint: idxOf("정비상품여부"),
  };

  // 날짜 열(판매수량 위치)만 수집 — 평균/합계 열은 8자리 날짜가 아니라 자동 제외
  const dateCols: { col: number; date: string }[] = [];
  for (let col = 0; col < head.length; col++) {
    if (/^\d{8}$/.test(head[col]) && sub[col].includes("판매수량")) {
      dateCols.push({ col, date: parseDate(head[col]) });
    }
  }

  const out: DailySalesRow[] = [];
  for (let i = hd + 2; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const productCode = ci.code >= 0 ? str(row[ci.code]) : "";
    const productName = ci.name >= 0 ? str(row[ci.name]) : "";
    if (!productCode && !productName) continue; // 빈줄/푸터
    const category1 = ci.c1 >= 0 ? str(row[ci.c1]) : "";
    const category2 = ci.c2 >= 0 ? str(row[ci.c2]) : "";
    const category3 = ci.c3 >= 0 ? str(row[ci.c3]) : "";
    const bonbu = ci.bonbu >= 0 ? str(row[ci.bonbu]) : undefined;
    const vendor = ci.vendor >= 0 ? str(row[ci.vendor]) : undefined;
    const contract = ci.contract >= 0 ? str(row[ci.contract]) : undefined;
    const pb = ci.pb >= 0 ? str(row[ci.pb]) === "Y" : undefined;
    const maint = ci.maint >= 0 ? str(row[ci.maint]) === "Y" : undefined;
    for (const { col, date } of dateCols) {
      if (!date) continue;
      const qty = num(row[col]);
      const amount = num(row[col + 1]); // 바로 다음 열 = 판매금액(-)
      if (!qty && !amount) continue;
      out.push({ date, productCode, productName, category1, category2, category3, qty, amount, bonbu, vendor, contract, pb, maint });
    }
  }
  return out.filter((r) => r.date && r.amount > 0);
}

/** 우리 매장 일매출 (일별매출실적) 또는 비교매장일매출 공통 파서. 거래단위/피벗 양식 자동 감지. */
export function parseDailySales(buffer: Buffer | ArrayBuffer): DailySalesRow[] {
  const wb = readWorkbook(buffer);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const hd = detectPivotHeader(aoa);
  if (hd >= 0) return parseDailySalesPivot(aoa, hd); // 변형(KRS 원본형) 피벗

  // 기존 거래단위(단일 헤더): 매출시간·POS 포함 → 시간대·MBA·객단가 가능
  const rows = sheetToRows(wb);
  return rows.map((r) => {
    const date = parseDate(r["판매일자"] ?? r["일자"] ?? r["날짜"]);
    const pos = str(r["POS번호"] ?? r["POS"]);
    const seq = str(r["거래순번"]);
    const hour = parseHourFromTime(r["매출시간"] ?? r["매출 시간"] ?? r["시간"]);
    return {
      date,
      productCode: str(r["상품코드"] ?? r["코드"]),
      productName: str(r["상품명"] ?? r["상품 명"]),
      category1: str(r["대분류"] ?? r["카테고리"]),
      category2: str(r["중분류"] ?? ""),
      category3: str(r["소분류"] ?? ""),
      qty: num(r["판매수량"] ?? r["수량"]),
      amount: num(r["판매금액"] ?? r["금액"]),
      hour,
      txnKey: pos ? `${date}|${pos}|${seq}` : undefined,
    };
  }).filter((r) => r.date && r.amount > 0);
}

/**
 * 변형(피벗) 매출통계 → AllStoreStatsRow[]. 상품(내부코드)×월 집계.
 * ⚠️ 변형 양식엔 '판매매장수'가 없음(거래처=공급처라 매장수 복원 불가) → storeCount=0
 * → 침투율·매장당성과는 빈값/비활성. 총 판매수량/금액·분류는 정상.
 */
function parseAllStoreStatsPivot(aoa: unknown[][], hd: number): AllStoreStatsRow[] {
  const head = (aoa[hd] ?? []).map((c) => str(c));
  const sub = (aoa[hd + 1] ?? []).map((c) => str(c));
  const idxOf = (label: string) => sub.findIndex((c) => c === label);
  const ci = { code: idxOf("상품"), name: idxOf("상품명"), c1: idxOf("대분류명"), bonbu: idxOf("본부") };
  const monCols: { col: number; ym: string }[] = [];
  for (let col = 0; col < head.length; col++) {
    if (/^\d{6}$/.test(head[col]) && sub[col].includes("판매수량")) monCols.push({ col, ym: head[col] });
  }
  const out: AllStoreStatsRow[] = [];
  for (let i = hd + 2; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const productCode = ci.code >= 0 ? str(row[ci.code]) : "";
    if (!productCode) continue;
    const productName = ci.name >= 0 ? str(row[ci.name]) : "";
    const category1 = ci.c1 >= 0 ? str(row[ci.c1]) : "";
    const bonbu = ci.bonbu >= 0 ? str(row[ci.bonbu]) : undefined;
    for (const { col, ym } of monCols) {
      const totalQty = num(row[col]);
      const totalAmount = num(row[col + 1]);
      if (!totalQty && !totalAmount) continue;
      out.push({ yearMonth: ym, productCode, productName, category1, storeCount: 0, totalQty, totalAmount, bonbu });
    }
  }
  return out.filter((r) => r.productCode && r.totalAmount > 0);
}

export function parseAllStoreStats(buffer: Buffer | ArrayBuffer): AllStoreStatsRow[] {
  const wb = readWorkbook(buffer);
  // 변형(피벗) 감지: 6자리 년월 열 + '판매수량' 하위행 + '상품' 라벨
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) as unknown[][];
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = (aoa[i] ?? []).map((c) => str(c));
    const sub = (aoa[i + 1] ?? []).map((c) => str(c));
    if (row.filter((c) => /^\d{6}$/.test(c)).length >= 1 && sub.some((c) => c.includes("판매수량")) && row.some((c) => c === "상품")) {
      return parseAllStoreStatsPivot(aoa, i);
    }
  }
  // 기존 단일헤더(판매매장수 포함)
  const rows = sheetToRows(wb);
  return rows.map((r) => ({
    yearMonth: str(r["년월"] ?? r["연월"]),
    productCode: str(r["상품코드"] ?? r["코드"]),
    productName: str(r["상품명"] ?? r["상품 명"]),
    category1: str(r["대분류"] ?? ""),
    storeCount: num(r["판매매장수"] ?? r["매장수"]),
    totalQty: num(r["판매수량"] ?? r["수량"]),
    totalAmount: num(r["판매금액"] ?? r["금액"]),
  })).filter((r) => r.productCode && r.totalAmount > 0);
}

export function parseInventory(buffer: Buffer | ArrayBuffer): InventoryRow[] {
  const wb = readWorkbook(buffer);
  // '매장 현재고현황' 양식: 상단 머리말(센터/매장·필터) 후 헤더 행 → 자동 탐지
  const rows = sheetToRowsAuto(wb, ["상품코드", "현재고", "재고수량"]);
  return rows.map((r) => ({
    productCode: str(r["상품코드"] ?? r["코드"]),
    // 양식에 따라 상품명이 없을 수 있음 — 나중에 allStats에서 보완
    productName: str(r["상품명"] ?? r["상품 명"]),
    // 컬럼명이 "현재고" 또는 "재고수량"
    stock: num(r["현재고"] ?? r["재고수량"] ?? r["재고"]),
  })).filter((r) => r.productCode);
}

// ─── 분석 알고리즘 ───────────────────────────────────────────────────────────

export function calculateGapAnalysis(
  daily: DailySalesRow[],
  allStats: AllStoreStatsRow[]
): GapItem[] {
  if (!daily.length) return [];
  // 판매매장수가 없으면(변형 매출통계) 매장당 평균을 구할 수 없어 Gap이 왜곡됨 → 비활성
  if (!allStats.some((r) => r.storeCount > 0)) return [];

  const dates = new Set(daily.map((r) => r.date));
  const days = dates.size || 1;

  const ourMap = new Map<string, { name: string; cat: string; qty: number }>();
  for (const r of daily) {
    const prev = ourMap.get(r.productCode) ?? { name: r.productName, cat: r.category1, qty: 0 };
    ourMap.set(r.productCode, { ...prev, qty: prev.qty + r.qty });
  }

  // 전체 통계: 상품별 매장당 일평균 수량 (코드 + 상품명 두 키로 적재 → 폴백 조인)
  const allMap = new Map<string, { name: string; cat: string; dailyAvg: number }>();
  const allByName = new Map<string, { name: string; cat: string; dailyAvg: number }>();
  for (const r of allStats) {
    const stores = r.storeCount || 1;
    const dailyAvg = r.totalQty / stores / 30;
    const prev = allMap.get(r.productCode);
    const v = {
      name: r.productName || prev?.name || "",
      cat: r.category1 || prev?.cat || "",
      dailyAvg: (prev?.dailyAvg ?? 0) + dailyAvg,
    };
    allMap.set(r.productCode, v);
    const nk = nameKey(r.productName);
    if (nk) {
      const pn = allByName.get(nk);
      allByName.set(nk, { name: v.name, cat: v.cat, dailyAvg: (pn?.dailyAvg ?? 0) + dailyAvg });
    }
  }

  const items: GapItem[] = [];
  for (const [code, our] of ourMap) {
    const all = allMap.get(code) ?? allByName.get(nameKey(our.name));
    const ourDailyAvg = our.qty / days;
    const allDailyAvg = all?.dailyAvg ?? 0;
    const gapRatio = allDailyAvg > 0 ? (ourDailyAvg - allDailyAvg) / allDailyAvg : 0;
    items.push({
      productCode: code,
      productName: our.name || all?.name || code,
      category1: our.cat || all?.cat || "기타",
      ourDailyAvg,
      allDailyAvg,
      gapRatio,
    });
  }

  return items.sort((a, b) => a.gapRatio - b.gapRatio);
}

export function calculateAbcRanking(
  daily: DailySalesRow[],
  allStats: AllStoreStatsRow[]
): AbcItem[] {
  if (!daily.length) return [];

  const ourMap = new Map<string, { name: string; cat: string; amount: number }>();
  for (const r of daily) {
    const prev = ourMap.get(r.productCode) ?? { name: r.productName, cat: r.category1, amount: 0 };
    ourMap.set(r.productCode, { ...prev, amount: prev.amount + r.amount });
  }

  const sorted = [...ourMap.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const total = sorted.reduce((s, [, v]) => s + v.amount, 0) || 1;

  // 전체매장 상품별 매출 → 순위. 코드 + 상품명 두 키로 순위 맵(폴백 조인).
  const allAmtMap = new Map<string, { name: string; amount: number }>();
  for (const r of allStats) {
    const prev = allAmtMap.get(r.productCode);
    allAmtMap.set(r.productCode, { name: r.productName || prev?.name || "", amount: (prev?.amount ?? 0) + r.totalAmount });
  }
  const allSorted = [...allAmtMap.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const allRankByCode = new Map<string, number>();
  const allRankByName = new Map<string, number>();
  allSorted.forEach(([code, v], i) => {
    allRankByCode.set(code, i + 1);
    const nk = nameKey(v.name);
    if (nk && !allRankByName.has(nk)) allRankByName.set(nk, i + 1); // 동명이 여럿이면 상위(첫) 순위
  });

  let cumAmount = 0;
  return sorted.map(([code, v], i) => {
    cumAmount += v.amount;
    const cumShare = cumAmount / total;
    const grade: "A" | "B" | "C" = cumShare <= 0.2 ? "A" : cumShare <= 0.5 ? "B" : "C";
    return {
      productCode: code,
      productName: v.name,
      category1: v.cat,
      totalAmount: v.amount,
      cumShare,
      grade,
      ourRank: i + 1,
      allRank: allRankByCode.get(code) ?? allRankByName.get(nameKey(v.name)) ?? null,
    };
  });
}

/**
 * 침투율 — 전체 매장 중 이 상품을 파는 매장 비율. (KR_TAS calculate_store_penetration)
 * 전체매장수는 관측된 판매매장수의 최대값으로 추정. 우리 미취급 + 고침투 = 미취급 추천 근거.
 */
export function calculateStorePenetration(
  daily: DailySalesRow[],
  allStats: AllStoreStatsRow[]
): PenetrationItem[] {
  if (!allStats.length) return [];
  const totalStores = allStats.reduce((m, r) => Math.max(m, r.storeCount), 0) || 1;
  // 우리 취급 여부 — 코드(바코드)와 상품명 둘 다로 판단(코드 체계가 달라 코드만으론 0% 매칭)
  const ourCodes = new Set(daily.map((r) => r.productCode));
  const ourNames = new Set(daily.map((r) => nameKey(r.productName)).filter(Boolean));

  const map = new Map<string, { name: string; cat: string; storeCount: number; amount: number }>();
  for (const r of allStats) {
    const prev = map.get(r.productCode) ?? { name: r.productName, cat: r.category1, storeCount: 0, amount: 0 };
    map.set(r.productCode, {
      name: r.productName || prev.name,
      cat: r.category1 || prev.cat,
      storeCount: Math.max(prev.storeCount, r.storeCount), // 다월이면 최대치
      amount: prev.amount + r.totalAmount,
    });
  }

  return [...map.entries()].map(([code, v]) => {
    const penetration = v.storeCount / totalStores;
    const grade: "A" | "B" | "C" = penetration >= 0.7 ? "A" : penetration >= 0.3 ? "B" : "C";
    return {
      productCode: code,
      productName: v.name || code,
      category1: v.cat || "기타",
      storeCount: v.storeCount,
      totalStores,
      penetration,
      grade,
      weCarry: ourCodes.has(code) || ourNames.has(nameKey(v.name)),
      allAmount: v.amount,
    };
  }).sort((a, b) => b.penetration - a.penetration);
}

/**
 * 매장당 성과 — 우리 매장 상품매출 vs 전체 매장당 평균 매출 비율. (KR_TAS calculate_per_store_performance)
 * ratio>1 = 우리가 평균 매장보다 잘 팜, <1 = 부진.
 */
export function calculatePerStorePerformance(
  daily: DailySalesRow[],
  allStats: AllStoreStatsRow[]
): PerStoreItem[] {
  if (!daily.length || !allStats.length) return [];

  const ourMap = new Map<string, { name: string; cat: string; amount: number }>();
  for (const r of daily) {
    const prev = ourMap.get(r.productCode) ?? { name: r.productName, cat: r.category1, amount: 0 };
    ourMap.set(r.productCode, { ...prev, amount: prev.amount + r.amount });
  }

  const allMap = new Map<string, { storeCount: number; amount: number }>();
  const allByName = new Map<string, { storeCount: number; amount: number }>();
  for (const r of allStats) {
    const prev = allMap.get(r.productCode) ?? { storeCount: 0, amount: 0 };
    allMap.set(r.productCode, { storeCount: Math.max(prev.storeCount, r.storeCount), amount: prev.amount + r.totalAmount });
    const nk = nameKey(r.productName);
    if (nk) {
      const pn = allByName.get(nk) ?? { storeCount: 0, amount: 0 };
      allByName.set(nk, { storeCount: Math.max(pn.storeCount, r.storeCount), amount: pn.amount + r.totalAmount });
    }
  }

  const items: PerStoreItem[] = [];
  for (const [code, our] of ourMap) {
    const all = allMap.get(code) ?? allByName.get(nameKey(our.name));
    if (!all || all.storeCount <= 0) continue;
    const perStore = all.amount / all.storeCount;
    if (perStore <= 0) continue;
    items.push({
      productCode: code,
      productName: our.name || code,
      category1: our.cat || "기타",
      ourAmount: our.amount,
      allPerStoreAmount: perStore,
      ratio: our.amount / perStore,
      storeCount: all.storeCount,
    });
  }
  return items.sort((a, b) => b.ratio - a.ratio);
}

/**
 * MBA(장바구니 분석) — 같은 영수증(txnKey)에 함께 담긴 상품쌍의 연관규칙. (KR_TAS Apriori 대응)
 * 거래단위 raw(POS+거래순번)일 때만 동작. 집계본이면 빈 배열.
 * 쌍 폭발 방지를 위해 빈도 상위 topProducts개로 한정.
 */
export function analyzeMarketBasket(
  daily: DailySalesRow[],
  opts?: { minCount?: number; topProducts?: number; maxRules?: number }
): BasketRule[] {
  const topN = opts?.topProducts ?? 80;
  const maxRules = opts?.maxRules ?? 20;

  // 거래별 상품 집합
  const txns = new Map<string, Set<string>>();
  const nameMap = new Map<string, string>();
  for (const r of daily) {
    if (!r.txnKey) continue;
    if (r.productName) nameMap.set(r.productCode, r.productName);
    let set = txns.get(r.txnKey);
    if (!set) { set = new Set(); txns.set(r.txnKey, set); }
    set.add(r.productCode);
  }
  const totalTxn = txns.size;
  if (totalTxn < 20) return []; // 거래 표본 부족(또는 집계본)
  // 동시구매 최소 건수(지지도 대신 건수 기반 — 거래수가 많아도 의미있는 쌍이 잘리지 않게)
  const minCount = opts?.minCount ?? Math.max(5, Math.round(totalTxn * 0.0005));

  // 상품별 등장 거래 수
  const freq = new Map<string, number>();
  for (const set of txns.values()) for (const c of set) freq.set(c, (freq.get(c) ?? 0) + 1);

  // 빈도 상위 N개만 대상 (쌍 폭발 방지)
  const allowed = new Set([...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([c]) => c));

  const pairCount = new Map<string, number>();
  for (const set of txns.values()) {
    const items = [...set].filter((c) => allowed.has(c)).sort();
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const key = `${items[i]} ${items[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
  }

  const rules: BasketRule[] = [];
  for (const [key, count] of pairCount) {
    const support = count / totalTxn;
    if (count < minCount) continue;
    const [ca, cb] = key.split(" ");
    const fa = freq.get(ca) ?? 0, fb = freq.get(cb) ?? 0;
    if (!fa || !fb) continue;
    // confidence 높은 방향을 A→B로
    const confAB = count / fa, confBA = count / fb;
    const [from, to, conf, fTo] = confAB >= confBA ? [ca, cb, confAB, fb] : [cb, ca, confBA, fa];
    const lift = support / ((freq.get(from)! / totalTxn) * (fTo / totalTxn));
    rules.push({ a: nameMap.get(from) || from, b: nameMap.get(to) || to, count, support, confidence: conf, lift });
  }
  return rules.sort((a, b) => b.lift - a.lift).slice(0, maxRules);
}

/** 본부별 매출 — 전매장 통계(변형)의 본부 차원 집계. */
export function analyzeByBonbu(allStats: AllStoreStatsRow[]): BonbuPoint[] {
  const m = new Map<string, { amount: number; qty: number }>();
  for (const r of allStats) {
    if (!r.bonbu) continue;
    const p = m.get(r.bonbu) ?? { amount: 0, qty: 0 };
    m.set(r.bonbu, { amount: p.amount + r.totalAmount, qty: p.qty + r.totalQty });
  }
  const total = [...m.values()].reduce((s, v) => s + v.amount, 0) || 1;
  return [...m.entries()]
    .map(([bonbu, v]) => ({ bonbu, amount: v.amount, qty: v.qty, share: v.amount / total }))
    .sort((a, b) => b.amount - a.amount);
}

/** 공급처(거래처)별 매출 — 우리 매장. */
export function analyzeByVendor(daily: DailySalesRow[]): VendorPoint[] {
  const m = new Map<string, { amount: number; qty: number; prods: Set<string> }>();
  for (const r of daily) {
    if (!r.vendor) continue;
    const p = m.get(r.vendor) ?? { amount: 0, qty: 0, prods: new Set<string>() };
    p.amount += r.amount; p.qty += r.qty; p.prods.add(r.productCode);
    m.set(r.vendor, p);
  }
  return [...m.entries()]
    .map(([vendor, v]) => ({ vendor, amount: v.amount, qty: v.qty, products: v.prods.size }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20);
}

/** 계약구분별 매출 — 우리 매장. */
export function analyzeByContract(daily: DailySalesRow[]): ContractPoint[] {
  const m = new Map<string, number>();
  for (const r of daily) {
    if (!r.contract) continue;
    m.set(r.contract, (m.get(r.contract) ?? 0) + r.amount);
  }
  const total = [...m.values()].reduce((s, v) => s + v, 0) || 1;
  return [...m.entries()]
    .map(([contract, amount]) => ({ contract, amount, share: amount / total }))
    .sort((a, b) => b.amount - a.amount);
}

/** PB상품 분석 — 우리 매장. PB상품 컬럼이 있을 때만(없으면 null). */
export function analyzePb(daily: DailySalesRow[]): PbSummary | null {
  if (!daily.some((r) => r.pb !== undefined)) return null;
  let pbAmount = 0, normalAmount = 0, maintAmount = 0;
  const pbItems = new Map<string, { name: string; amount: number }>();
  for (const r of daily) {
    if (r.pb) {
      pbAmount += r.amount;
      const p = pbItems.get(r.productCode) ?? { name: r.productName, amount: 0 };
      p.amount += r.amount; pbItems.set(r.productCode, p);
    } else {
      normalAmount += r.amount;
    }
    if (r.maint) maintAmount += r.amount;
  }
  const total = pbAmount + normalAmount || 1;
  return {
    pbAmount, normalAmount, pbShare: pbAmount / total, pbItemCount: pbItems.size, maintAmount,
    topPb: [...pbItems.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
  };
}

export function calculateCategoryPortfolio(
  daily: DailySalesRow[],
  allStats: AllStoreStatsRow[]
): CategoryPortfolioItem[] {
  if (!daily.length) return [];

  // 상품코드 → 카테고리 매핑 (allStats가 더 완전)
  const codeTocat = new Map<string, string>();
  for (const r of allStats) if (r.category1) codeTocat.set(r.productCode, r.category1);
  for (const r of daily) if (r.category1) codeTocat.set(r.productCode, r.category1);

  const ourCat = new Map<string, number>();
  for (const r of daily) {
    const cat = codeTocat.get(r.productCode) || r.category1 || "기타";
    ourCat.set(cat, (ourCat.get(cat) ?? 0) + r.amount);
  }

  const allCat = new Map<string, number>();
  for (const r of allStats) {
    const cat = codeTocat.get(r.productCode) || r.category1 || "기타";
    allCat.set(cat, (allCat.get(cat) ?? 0) + r.totalAmount);
  }

  const ourTotal = [...ourCat.values()].reduce((s, v) => s + v, 0) || 1;
  const allTotal = [...allCat.values()].reduce((s, v) => s + v, 0) || 1;

  const cats = new Set([...ourCat.keys(), ...allCat.keys()]);
  return [...cats].map((cat) => {
    const ourAmount = ourCat.get(cat) ?? 0;
    const allAmount = allCat.get(cat) ?? 0;
    return {
      category: cat,
      ourShare: ourAmount / ourTotal,
      allShare: allAmount / allTotal,
      ourAmount,
      allAmount,
      gap: ourAmount / ourTotal - allAmount / allTotal,
    };
  }).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/** 시간대별 매출·객수·객단가 + 누적. 매출시간(hour) 있을 때만 의미 있음. */
export function analyzeHourly(daily: DailySalesRow[]): HourlyPoint[] {
  const agg = new Map<number, { amount: number; qty: number; vis: Set<string> }>();
  for (const r of daily) {
    if (r.hour == null) continue;
    let g = agg.get(r.hour);
    if (!g) { g = { amount: 0, qty: 0, vis: new Set() }; agg.set(r.hour, g); }
    g.amount += r.amount;
    g.qty += r.qty;
    if (r.txnKey) g.vis.add(r.txnKey);
  }
  let cumAmount = 0, cumVisitors = 0;
  return [...agg.keys()].sort((a, b) => a - b).map((hour) => {
    const g = agg.get(hour)!;
    const visitors = g.vis.size;
    cumAmount += g.amount;
    cumVisitors += visitors;
    return {
      hour,
      amount: g.amount,
      qty: g.qty,
      visitors,
      avgPerVisitor: visitors > 0 ? g.amount / visitors : 0,
      cumAmount,
      cumVisitors,
    };
  });
}

/** 요일별 매출(막대그래프용). 월~일 순. */
export function analyzeDayOfWeek(daily: DailySalesRow[]): DowPoint[] {
  const LABELS = ["월", "화", "수", "목", "금", "토", "일"];
  const agg = new Map<number, { amount: number; qty: number; vis: Set<string>; dates: Set<string> }>();
  for (const r of daily) {
    const d = dowIndex(r.date);
    if (d < 0) continue;
    let g = agg.get(d);
    if (!g) { g = { amount: 0, qty: 0, vis: new Set(), dates: new Set() }; agg.set(d, g); }
    g.amount += r.amount;
    g.qty += r.qty;
    if (r.txnKey) g.vis.add(r.txnKey);
    g.dates.add(r.date);
  }
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => agg.has(d)).map((d) => {
    const g = agg.get(d)!;
    const days = g.dates.size;
    return {
      dow: d,
      label: LABELS[d],
      amount: g.amount,
      qty: g.qty,
      visitors: g.vis.size,
      days,
      avgAmount: days > 0 ? g.amount / days : 0,
    };
  });
}

/** 기간(일/주/월) 매출 집계. */
export function analyzePeriod(daily: DailySalesRow[], unit: "day" | "week" | "month"): PeriodPoint[] {
  const keyOf = (date: string): { key: string; label: string } => {
    const m = String(date).replace(/\D/g, "");
    const y = m.slice(0, 4), mo = m.slice(4, 6), da = m.slice(6, 8);
    if (unit === "day") return { key: `${y}${mo}${da}`, label: `${mo}/${da}` };
    if (unit === "month") return { key: `${y}${mo}`, label: `${y}.${mo}` };
    // week: 해당 연도 기준 주차
    const dt = new Date(+y, +mo - 1, +da);
    const jan1 = new Date(+y, 0, 1);
    const wk = Math.ceil(((dt.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return { key: `${y}-W${String(wk).padStart(2, "0")}`, label: `${y} ${wk}주` };
  };
  const agg = new Map<string, { label: string; amount: number; qty: number; vis: Set<string> }>();
  for (const r of daily) {
    if (!r.date) continue;
    const { key, label } = keyOf(r.date);
    let g = agg.get(key);
    if (!g) { g = { label, amount: 0, qty: 0, vis: new Set() }; agg.set(key, g); }
    g.amount += r.amount;
    g.qty += r.qty;
    if (r.txnKey) g.vis.add(r.txnKey);
  }
  return [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, g]) => ({
    key,
    label: g.label,
    amount: g.amount,
    qty: g.qty,
    visitors: g.vis.size,
    avgPerVisitor: g.vis.size > 0 ? g.amount / g.vis.size : 0,
  }));
}

export function generateTimeSeries(
  daily: DailySalesRow[],
  compare: DailySalesRow[]
): TimeSeriesPoint[] {
  if (!daily.length) return [];

  const byDate = new Map<string, { amount: number; qty: number }>();
  for (const r of daily) {
    const prev = byDate.get(r.date) ?? { amount: 0, qty: 0 };
    byDate.set(r.date, { amount: prev.amount + r.amount, qty: prev.qty + r.qty });
  }

  const compareByDate = new Map<string, number>();
  for (const r of compare) {
    compareByDate.set(r.date, (compareByDate.get(r.date) ?? 0) + r.amount);
  }

  const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return sorted.map(([date, v], i) => {
    const window = sorted.slice(Math.max(0, i - 6), i + 1).map(([, x]) => x.amount);
    const ma7 = window.length >= 3 ? window.reduce((s, x) => s + x, 0) / window.length : null;
    return {
      date,
      amount: v.amount,
      qty: v.qty,
      ma7,
      compareAmount: compareByDate.get(date) ?? null,
    };
  });
}

export function predictInventory(
  inventory: InventoryRow[],
  daily: DailySalesRow[],
  nameMap: Map<string, string>
): InventoryAlert[] {
  if (!inventory.length) return [];

  const dates = new Set(daily.map((r) => r.date));
  const days = dates.size || 1;

  const dailySaleMap = new Map<string, number>();
  for (const r of daily) {
    dailySaleMap.set(r.productCode, (dailySaleMap.get(r.productCode) ?? 0) + r.qty);
  }
  for (const [code, total] of dailySaleMap) dailySaleMap.set(code, total / days);

  return inventory.map((inv) => {
    const dailySale = dailySaleMap.get(inv.productCode) ?? 0;
    const exhaustDays = dailySale > 0 ? inv.stock / dailySale : null;
    // 상품명 없으면 allStats/daily에서 보완
    const productName = inv.productName || nameMap.get(inv.productCode) || inv.productCode;
    let status: InventoryAlert["status"] = "ok";
    if (dailySale === 0) status = "noSale";
    else if (exhaustDays !== null && exhaustDays <= 1) status = "danger";
    else if (exhaustDays !== null && exhaustDays <= 3) status = "warn";
    return {
      productCode: inv.productCode,
      productName,
      stock: inv.stock,
      dailySale,
      exhaustDays,
      status,
    };
  }).sort((a, b) => {
    const order = { danger: 0, warn: 1, ok: 2, noSale: 3 };
    return order[a.status] - order[b.status];
  });
}

export function generateInsights(
  gap: GapItem[],
  abc: AbcItem[],
  catPortfolio: CategoryPortfolioItem[],
  inventory: InventoryAlert[],
  penetration: PenetrationItem[] = [],
  perStore: PerStoreItem[] = []
): Insight[] {
  const insights: Insight[] = [];

  const weakCats = catPortfolio.filter((c) => c.gap < -0.03).slice(0, 2);
  for (const cat of weakCats) {
    insights.push({
      type: "category_gap",
      level: Math.abs(cat.gap) > 0.08 ? "high" : "mid",
      title: `${cat.category} 카테고리 매출 격차`,
      body: `전체 평균 대비 ${cat.category} 비중이 ${Math.abs(cat.gap * 100).toFixed(1)}%p 부족. (우리: ${(cat.ourShare * 100).toFixed(1)}%, 평균: ${(cat.allShare * 100).toFixed(1)}%)`,
      action: `${cat.category} 상품 진열 확대 및 발주 조정`,
    });
  }

  const opportunities = abc.filter((p) => p.grade === "C" && p.allRank !== null && p.allRank <= 20).slice(0, 3);
  for (const p of opportunities) {
    insights.push({
      type: "opportunity",
      level: "high",
      title: `기회 상품: ${p.productName}`,
      body: `전체 ${p.allRank}위이나 우리 매장 ${p.ourRank}위. 발주·진열 미흡 가능성.`,
      action: `즉시 발주 검토 및 전면 진열`,
    });
  }

  const aItems = abc.filter((p) => p.grade === "A");
  if (aItems.length > 0) {
    insights.push({
      type: "efficiency",
      level: "low",
      title: `핵심 상품: ${aItems[0].productName}`,
      body: `매출 기여 1위. 재고 부족 시 즉각 대응 필요.`,
      action: `안전재고 수준 확인 및 정기 발주 유지`,
    });
  }

  // 침투율: 전체 매장 대부분이 파는데(고침투 A등급) 우리는 미취급 = 필수상품 누락
  const mustHave = penetration
    .filter((p) => p.grade === "A" && !p.weCarry)
    .sort((a, b) => b.allAmount - a.allAmount)
    .slice(0, 3);
  for (const p of mustHave) {
    insights.push({
      type: "penetration",
      level: "high",
      title: `필수 상품 누락: ${p.productName}`,
      body: `전체 매장의 ${(p.penetration * 100).toFixed(0)}%(${p.storeCount}/${p.totalStores}곳)가 취급하는데 우리 매장은 미취급.`,
      action: `도입 검토 — 표준 진열 상품일 가능성`,
    });
  }

  // 매장당 성과: 전체 평균 매장보다 크게 부진한 상품(취급 중인데 ratio<<1)
  const underPerf = perStore
    .filter((p) => p.ratio < 0.5 && p.allPerStoreAmount > 0)
    .sort((a, b) => b.allPerStoreAmount - a.allPerStoreAmount)
    .slice(0, 2);
  for (const p of underPerf) {
    insights.push({
      type: "performance",
      level: "mid",
      title: `매장당 성과 부진: ${p.productName}`,
      body: `전체 매장당 평균 ${Math.round(p.allPerStoreAmount).toLocaleString()}원인데 우리는 ${Math.round(p.ourAmount).toLocaleString()}원 (평균의 ${(p.ratio * 100).toFixed(0)}%).`,
      action: `진열 위치·발주량 점검`,
    });
  }

  const dangerItems = inventory.filter((i) => i.status === "danger").slice(0, 2);
  for (const item of dangerItems) {
    insights.push({
      type: "missing_essential",
      level: "high",
      title: `긴급 발주: ${item.productName}`,
      body: `재고 ${item.stock}개, 일평균 ${item.dailySale.toFixed(1)}개 — ${item.exhaustDays !== null ? `${item.exhaustDays.toFixed(1)}일 내 소진` : "즉시 소진"}.`,
      action: `즉시 발주 최소 ${Math.ceil((item.dailySale || 1) * 7)}개`,
    });
  }

  return insights;
}

/** 놓친 매출 — 카테고리별 (전체평균 - 우리비중) × 우리총매출 */
export function calculateLostRevenue(
  categoryPortfolio: CategoryPortfolioItem[],
  ourTotal: number
): { total: number; items: LostRevenueItem[] } {
  const items: LostRevenueItem[] = categoryPortfolio
    .map((c) => {
      const amount = c.gap * ourTotal * -1; // gap = our-all. 음수(부족) → 양수 손실
      return {
        category: c.category || "기타",
        ourShare: c.ourShare,
        allShare: c.allShare,
        gap: c.allShare - c.ourShare,
        amount,
        isPositive: amount < 0, // 손실<0 = 우리가 잘함
      };
    })
    .filter((i) => Math.abs(i.amount) > ourTotal * 0.005) // 0.5% 미만 노이즈 제거
    .sort((a, b) => b.amount - a.amount);

  const total = items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  return { total, items: items.slice(0, 6) };
}

/** 트렌드 상품 비교 — 카테고리별 우리 Top vs 비교매장 Top */
export function calculateTrendProducts(
  daily: DailySalesRow[],
  compare: DailySalesRow[]
): TrendProductItem[] {
  if (!daily.length || !compare.length) return [];

  const ourDays = new Set(daily.map((r) => r.date)).size || 1;
  const cmpDays = new Set(compare.map((r) => r.date)).size || 1;

  // 카테고리 → 상품 → 매출 합계
  const topByCat = (rows: DailySalesRow[], days: number) => {
    const catMap = new Map<string, Map<string, { name: string; amount: number }>>();
    for (const r of rows) {
      const cat = r.category1 || "기타";
      if (!catMap.has(cat)) catMap.set(cat, new Map());
      const pm = catMap.get(cat)!;
      const prev = pm.get(r.productCode) ?? { name: r.productName, amount: 0 };
      pm.set(r.productCode, { name: prev.name, amount: prev.amount + r.amount });
    }
    const result = new Map<string, { name: string; dailyAvg: number }>();
    for (const [cat, pm] of catMap) {
      let top = { name: "", amount: 0 };
      for (const v of pm.values()) if (v.amount > top.amount) top = v;
      result.set(cat, { name: top.name, dailyAvg: top.amount / days });
    }
    return result;
  };

  const ourTop = topByCat(daily, ourDays);
  const cmpTop = topByCat(compare, cmpDays);

  // 양쪽 모두 있는 카테고리, 우리 매출 큰 순
  const cats = [...ourTop.keys()].filter((c) => cmpTop.has(c));
  return cats
    .map((cat) => {
      const our = ourTop.get(cat)!;
      const cmp = cmpTop.get(cat)!;
      return {
        category: cat,
        ourName: our.name,
        ourDailyAvg: our.dailyAvg,
        compareName: cmp.name,
        compareDailyAvg: cmp.dailyAvg,
        weWin: our.dailyAvg >= cmp.dailyAvg,
      };
    })
    .sort((a, b) => b.ourDailyAvg - a.ourDailyAvg)
    .slice(0, 5);
}

/** 벤치마킹 — 우리 vs 비교매장 일평균 매출 */
export function calculateBenchmark(
  daily: DailySalesRow[],
  compare: DailySalesRow[],
  ourName: string,
  compareName: string
): BenchmarkData | null {
  if (!daily.length || !compare.length) return null;
  const ourDays = new Set(daily.map((r) => r.date)).size || 1;
  const cmpDays = new Set(compare.map((r) => r.date)).size || 1;
  const ourDailyAvg = daily.reduce((s, r) => s + r.amount, 0) / ourDays;
  const compareDailyAvg = compare.reduce((s, r) => s + r.amount, 0) / cmpDays;
  return {
    ourName: ourName || "우리 매장",
    ourDailyAvg,
    compareName: compareName || "비교 매장",
    compareDailyAvg,
    ourRank: ourDailyAvg >= compareDailyAvg ? 1 : 2,
    diffPct: compareDailyAvg > 0 ? (ourDailyAvg - compareDailyAvg) / compareDailyAvg : 0,
  };
}

export function buildDiagnosisContext(result: SalesAnalysisResult): string {
  const { period, totalAmount, dailyAvgAmount, uniqueProducts, visitors, avgPerVisitor, categoryPortfolio, abcRanking, inventoryAlerts, insights, gapAnalysis, compareStoreName, lostRevenue, benchmark, penetration, marketBasket } = result;

  const fmt = (n: number) => n.toLocaleString("ko-KR");
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const lines: string[] = [
    `[분석 기간] ${period.start} ~ ${period.end} (${period.days}일)`,
    `[총 매출] ${fmt(totalAmount)}원 / 일평균 ${fmt(Math.round(dailyAvgAmount))}원`,
    visitors > 0 ? `[방문객] ${fmt(visitors)}명 / 객단가 ${fmt(Math.round(avgPerVisitor))}원` : "",
    `[취급 상품 수] ${uniqueProducts}종`,
    compareStoreName ? `[비교 매장] ${compareStoreName}` : "",
    benchmark ? `[벤치마크] 우리 일평균 ${fmt(Math.round(benchmark.ourDailyAvg))}원 vs ${benchmark.compareName} ${fmt(Math.round(benchmark.compareDailyAvg))}원 (${benchmark.diffPct >= 0 ? "+" : ""}${pct(benchmark.diffPct)})` : "",
    lostRevenue.total > 0 ? `[놓친 매출 추정] 약 ${fmt(Math.round(lostRevenue.total))}원 (유사 평균 대비 부족 카테고리 합산)` : "",
    "",
    "[카테고리 비중 (우리 vs 전체 평균)]",
    ...categoryPortfolio.slice(0, 6).map(
      (c) => `  ${c.category || "기타"}: 우리 ${pct(c.ourShare)} vs 평균 ${pct(c.allShare)} (${c.gap >= 0 ? "+" : ""}${pct(c.gap)})`
    ),
    "",
    "[ABC 등급 상위 10개]",
    ...abcRanking.slice(0, 10).map(
      (p) => `  [${p.grade}] ${p.productName} — ${fmt(p.totalAmount)}원 (우리${p.ourRank}위${p.allRank ? ` / 전체${p.allRank}위` : ""})`
    ),
    "",
    "[재고 위험]",
    ...inventoryAlerts.filter((a) => a.status === "danger" || a.status === "warn").slice(0, 5).map(
      (a) => `  [${a.status === "danger" ? "긴급" : "주의"}] ${a.productName}: 재고${a.stock}개 일평균${a.dailySale.toFixed(1)}개 → ${a.exhaustDays !== null ? `${a.exhaustDays.toFixed(1)}일 후 소진` : "소진"}`
    ),
    "",
    "[경쟁 대비 기회 상품 (전체 상위·우리 부진)]",
    ...gapAnalysis.filter((g) => g.gapRatio < -0.3 && g.allDailyAvg > 0).slice(0, 5).map(
      (g) => `  ${g.productName}: 전체일평균${g.allDailyAvg.toFixed(1)}개 vs 우리${g.ourDailyAvg.toFixed(1)}개 (${(g.gapRatio * 100).toFixed(0)}%)`
    ),
    "",
    "[필수상품 누락 (전체 매장 다수 취급·우리 미취급)]",
    ...penetration.filter((p) => p.grade === "A" && !p.weCarry).sort((a, b) => b.allAmount - a.allAmount).slice(0, 5).map(
      (p) => `  ${p.productName}: 전체 ${(p.penetration * 100).toFixed(0)}%(${p.storeCount}/${p.totalStores}곳) 취급, 우리 미취급`
    ),
    "",
    "[장바구니 연관 (함께 구매)]",
    ...marketBasket.slice(0, 8).map(
      (r) => `  ${r.a} → ${r.b} (동시구매 ${r.count}건, 신뢰도 ${(r.confidence * 100).toFixed(0)}%, lift ${r.lift.toFixed(1)})`
    ),
    "",
    "[인사이트]",
    ...insights.map((i) => `  [${i.level === "high" ? "높음" : i.level === "mid" ? "중간" : "낮음"}] ${i.title}: ${i.body} → ${i.action}`),
  ].filter((l) => l !== undefined);

  return lines.join("\n");
}

// ─── 메인 진입점 ─────────────────────────────────────────────────────────────

export function runSalesAnalysis(params: {
  storeName: string;
  compareStoreName?: string;
  ourDailyBuffer?: Buffer | ArrayBuffer;
  compareDailyBuffer?: Buffer | ArrayBuffer;
  allStatsBuffer?: Buffer | ArrayBuffer;
  inventoryBuffer?: Buffer | ArrayBuffer;
}): SalesAnalysisResult {
  const { storeName } = params;

  const ourDaily = params.ourDailyBuffer ? parseDailySales(params.ourDailyBuffer) : [];
  const compareDaily = params.compareDailyBuffer ? parseDailySales(params.compareDailyBuffer) : [];
  const allStats = params.allStatsBuffer ? parseAllStoreStats(params.allStatsBuffer) : [];
  const inventoryRaw = params.inventoryBuffer ? parseInventory(params.inventoryBuffer) : [];

  // 비교 매장명 — 선택된 매장명 우선, 없으면 파일에서 추출
  let compareStoreName = params.compareStoreName ?? "";
  if (!compareStoreName && params.compareDailyBuffer && compareDaily.length > 0) {
    try {
      const wb = readWorkbook(params.compareDailyBuffer);
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const name = str(rows[0]?.["매장명"]);
      if (name) compareStoreName = name;
    } catch { /* 무시 */ }
  }

  // 상품명 보완 맵 (코드 → 이름)
  const nameMap = new Map<string, string>();
  for (const r of allStats) if (r.productName) nameMap.set(r.productCode, r.productName);
  for (const r of ourDaily) if (r.productName) nameMap.set(r.productCode, r.productName);
  for (const r of compareDaily) if (r.productName) nameMap.set(r.productCode, r.productName);

  const daily = ourDaily; // 우리 매장 = 분석 주체
  const dates = [...new Set(daily.map((r) => r.date))].sort();
  const period = {
    start: dates[0] ?? "",
    end: dates[dates.length - 1] ?? "",
    days: dates.length || 1,
  };

  const totalAmount = daily.reduce((s, r) => s + r.amount, 0);
  const totalQty = daily.reduce((s, r) => s + r.qty, 0);
  const dailyAvgAmount = totalAmount / period.days;
  const uniqueProducts = new Set(daily.map((r) => r.productCode)).size;

  // 방문객(고유 거래 수) · 객단가 — POS 데이터(txnKey) 있을 때만
  const txnKeys = new Set(daily.map((r) => r.txnKey).filter(Boolean) as string[]);
  const visitors = txnKeys.size;
  const avgPerVisitor = visitors > 0 ? totalAmount / visitors : 0;

  const gapAnalysis = calculateGapAnalysis(daily, allStats);
  const abcRanking = calculateAbcRanking(daily, allStats);
  const penetration = calculateStorePenetration(daily, allStats);
  const perStore = calculatePerStorePerformance(daily, allStats);
  const marketBasket = analyzeMarketBasket(daily);
  const categoryPortfolio = calculateCategoryPortfolio(daily, allStats);
  const timeSeries = generateTimeSeries(daily, compareDaily);
  const hourly = analyzeHourly(daily);
  const dayOfWeek = analyzeDayOfWeek(daily);
  const periods = {
    day: analyzePeriod(daily, "day"),
    week: analyzePeriod(daily, "week"),
    month: analyzePeriod(daily, "month"),
  };
  const inventoryAlerts = predictInventory(inventoryRaw, daily, nameMap);
  // 변형(KRS 원본형) 신규 분석 — 본부별/공급처별/계약구분/PB
  const byBonbu = analyzeByBonbu(allStats);
  const byVendor = analyzeByVendor(daily);
  const byContract = analyzeByContract(daily);
  const pb = analyzePb(daily);
  const insights = generateInsights(gapAnalysis, abcRanking, categoryPortfolio, inventoryAlerts, penetration, perStore);
  const lostRevenue = calculateLostRevenue(categoryPortfolio, totalAmount);
  const trendProducts = calculateTrendProducts(daily, compareDaily);
  const benchmark = calculateBenchmark(daily, compareDaily, storeName, compareStoreName);

  const result: SalesAnalysisResult = {
    storeName,
    compareStoreName,
    period,
    totalAmount,
    totalQty,
    dailyAvgAmount,
    uniqueProducts,
    visitors,
    avgPerVisitor,
    gapAnalysis: gapAnalysis.slice(0, 50),
    abcRanking: abcRanking.slice(0, 100),
    penetration: penetration.slice(0, 100),
    perStore: perStore.slice(0, 100),
    marketBasket,
    categoryPortfolio,
    timeSeries,
    hourly,
    dayOfWeek,
    periods,
    byBonbu,
    byVendor,
    byContract,
    pb,
    inventoryAlerts,
    insights,
    lostRevenue,
    trendProducts,
    benchmark,
    diagnosisContext: "",
  };

  result.diagnosisContext = buildDiagnosisContext(result);
  return result;
}

// ─── 브라우저용 File 입력 래퍼 ───────────────────────────────────────────────

/** 브라우저 File 객체를 받아 분석 실행 (파일 업로드 없음 — 브라우저 내 처리) */
export async function runSalesAnalysisFromFiles(params: {
  storeName: string;
  compareStoreName?: string;
  ourDailyFile?: File;
  compareDailyFile?: File;
  allStatsFile?: File;
  inventoryFile?: File;
}): Promise<SalesAnalysisResult> {
  const toAB = async (f?: File) => (f ? f.arrayBuffer() : undefined);
  const [ourDailyBuffer, compareDailyBuffer, allStatsBuffer, inventoryBuffer] = await Promise.all([
    toAB(params.ourDailyFile),
    toAB(params.compareDailyFile),
    toAB(params.allStatsFile),
    toAB(params.inventoryFile),
  ]);
  return runSalesAnalysis({
    storeName: params.storeName,
    compareStoreName: params.compareStoreName,
    ourDailyBuffer,
    compareDailyBuffer,
    allStatsBuffer,
    inventoryBuffer,
  });
}
