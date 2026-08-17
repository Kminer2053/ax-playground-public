/**
 * 업종별 매출 트렌드 분석 — 데이터층(전사·역별).
 * kr-market 단일 HTML(업종별매출트렌드분석)의 파싱·집계·예측·요약 로직을 React용 순수 함수로 이식.
 * 전역 STATE 대신 ctx({data, scope, station})를 인자로 받는다. 모든 분석은 브라우저 내부에서만 동작(원본 외부 전송 없음).
 * (전문점 드릴다운 모듈은 별도 lib로 분리 예정)
 */
import * as XLSX from "xlsx";

/* ---------- 설정 ---------- */
export const CAT = ["편의점", "전문점", "자판기", "상생물류", "임대", "기타수익"] as const;
export const CAT_COLOR: Record<string, string> = {
  편의점: "#1F5FBF", 전문점: "#16A085", 자판기: "#E0A41E", 상생물류: "#8E5BD6", 임대: "#D86A2C", 기타수익: "#5B6B83",
};
export const YEARS = [2022, 2023, 2024, 2025, 2026];
export const CUR_YEAR = 2026;
export const BASE_DATE = "2026-06-17";
export const YEAR_PROGRESS = 0.46; // 2026 경과율(연간 누계 비율, 6/17 기준)
export const FISCAL_MONTHS = ["07월", "08월", "09월", "10월", "11월", "12월", "01월", "02월", "03월", "04월", "05월", "06월"];
export const FY_LABELS = ["Y(2025~2026)", "Y-1(2024~2025)", "Y-2(2023~2024)", "Y-3(2022~2023)", "Y-4(2021~2022)"];

// 업무사이트 표준 엑셀 컬럼 매핑(컬럼명이 바뀌어도 대응)
const COLUMN_MAP = {
  hq: ["본부명", "본부"], station: ["역명", "역", "소속역"],
  fyear: ["기준년도", "기준연도"], cat: ["사업구분", "업종", "업종명"],
  detail: ["사업구분상세", "업종상세"], sales: ["매출액(VAT-)", "매출액", "총매출", "매출금액"],
  stores: ["매장수"],
};

// 표준 역↔본부(데모/검증 참조). 실제 업로드 시 파일의 값으로 대체됨.
export const STN: Record<string, string[]> = {
  서울본부: ["서울", "용산", "수원"], 경인본부: ["영등포", "부평", "인천", "안양"],
  경기본부: ["수원", "평택"], 대구경북본부: ["동대구", "대구", "경주", "구미", "김천", "포항"],
  부산경남본부: ["부산", "마산", "진주", "울산"], 충청본부: ["대전", "천안아산", "오송", "천안"],
  호남본부: ["광주송정", "익산", "순천", "전주", "목포"], 동부본부: ["청량리", "강릉", "춘천"],
  본사: ["역외"],
};
export const STATIONS: { s: string; hq: string }[] = [];
Object.entries(STN).forEach(([hq, arr]) => arr.forEach((s) => { if (!STATIONS.find((x) => x.s === s && x.hq === hq)) STATIONS.push({ s, hq }); }));

/* ---------- 포맷터 ---------- */
export const W = (n: number): string => {
  if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + "억";
  if (n >= 1e4) return (n / 1e4).toFixed(0) + "만";
  return Math.round(n).toLocaleString();
};
export const WON = (n: number): string => "₩" + W(n);
export const PCT = (n: number): string => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
export const NUM = (n: number): string => Math.round(n).toLocaleString();

/* ---------- 타입 ---------- */
export type AnnualRec = { hq: string; station: string; cat: string; detail?: string; year: number; sales: number; stores: number };
export type MonthlyRec = { hq: string; station: string; cat: string; detail?: string; fy: string; month: string; sales: number; stores: number };
export type DailyRec = { hq: string; station: string; cat: string; detail?: string; year: number; date: string; sales: number; stores: number };
export type MarketData = { daily: DailyRec[]; monthly: MonthlyRec[]; annual: AnnualRec[]; dates?: string[]; demo: boolean };
export type Scope = { scope: "all" | "station"; station: string | null };

export type ParseResult = {
  ok: boolean; type: "daily" | "monthly" | "annual" | null;
  errors: string[]; records: Array<Record<string, unknown>> | null; info: string; empty?: boolean;
};

/* ---------- 데모 데이터(업로드 전 시각화용, 시드 고정) ---------- */
function rng(seed: number): () => number { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function hash(str: string): number { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

const CAT_PROFILE: Record<string, { base: number; trend: number; season: number; share: number }> = {
  편의점: { base: 9.2e8, trend: -0.022, season: 0.1, share: 1 },
  전문점: { base: 5.4e8, trend: +0.061, season: 0.16, share: 1 },
  자판기: { base: 1.1e8, trend: -0.005, season: 0.07, share: 1 },
  상생물류: { base: 2.7e8, trend: +0.085, season: 0.05, share: 0.5 },
  임대: { base: 3.9e8, trend: +0.021, season: 0.04, share: 1 },
  기타수익: { base: 0.8e8, trend: +0.012, season: 0.2, share: 0.6 },
};
function stationScale(s: string): number {
  const big = ["서울", "부산", "동대구", "대전", "광주송정", "용산", "수원", "인천"];
  return big.includes(s) ? 1.6 + (hash(s) % 40) / 100 : 0.35 + (hash(s) % 90) / 100;
}

export function genDemo(): MarketData {
  const daily: DailyRec[] = [], monthly: MonthlyRec[] = [], annual: AnnualRec[] = [];
  const dates: string[] = []; let d = new Date("2026-04-17"); const end = new Date("2026-06-17");
  while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }

  STATIONS.forEach(({ s, hq }) => {
    const sc = stationScale(s); const r = rng(hash(s + hq));
    CAT.forEach((cat) => {
      const p = CAT_PROFILE[cat]; if (r() > p.share && cat !== "편의점" && cat !== "전문점") return;
      const annualBase = p.base * sc * (0.8 + r() * 0.5);
      YEARS.forEach((y) => {
        const yrsFromNow = CUR_YEAR - y;
        let val = annualBase * Math.pow(1 + p.trend, -yrsFromNow) * (0.97 + r() * 0.06);
        if (y === CUR_YEAR) val *= YEAR_PROGRESS;
        annual.push({ hq, station: s, cat, year: y, sales: Math.round(val), stores: Math.max(1, Math.round(val / 1.2e8)) });
      });
      FY_LABELS.forEach((fy, fi) => {
        FISCAL_MONTHS.forEach((m) => {
          const monthN = parseInt(m); const seasonF = 1 + p.season * Math.sin((monthN / 12) * Math.PI * 2 - 1.2);
          let mv = (annualBase / 12) * Math.pow(1 + p.trend, -fi) * seasonF * (0.93 + r() * 0.14);
          if (fi === 0 && m === "06월") mv *= 0.55;
          monthly.push({ hq, station: s, cat, fy, month: m, sales: Math.round(mv), stores: Math.max(1, Math.round(mv / 1e7)) });
        });
      });
      [2026, 2025, 2024, 2023, 2022].forEach((y, yi) => {
        dates.forEach((ds) => {
          const dow = new Date(ds).getDay(); const wk = dow === 0 || dow === 6 ? 0.82 : 1.05;
          const dailyBase = (annualBase / 365) * Math.pow(1 + p.trend, -yi) * wk * (0.85 + r() * 0.3);
          daily.push({ hq, station: s, cat, year: y, date: ds, sales: Math.round(dailyBase), stores: Math.max(1, Math.round(dailyBase / 4e5)) });
        });
      });
    });
  });
  return { daily, monthly, annual, dates, demo: true };
}

/* ---------- 엑셀 파서 & 구조 검증 ---------- */
function norm(s: unknown): string { return (s == null ? "" : String(s)).replace(/\s+/g, "").trim(); }
function findCol(headerRow: unknown[], aliases: string[]): number {
  for (let i = 0; i < headerRow.length; i++) { const h = norm(headerRow[i]); if (aliases.some((a) => h === norm(a))) return i; }
  return -1;
}
function parseDateLabel(lab: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(lab)) return lab.slice(0, 10);
  if (/^\d{5}$/.test(lab)) { const d = new Date(Date.UTC(1899, 11, 30) + +lab * 86400000); return d.toISOString().slice(0, 10); }
  return lab;
}
function yearFromFY(fy: string): number | null { const m = /\((\d{4})\)/.exec(fy) || /(\d{4})/.exec(fy); return m ? +m[1] : null; }

/** 워크북(aoa) → 파일유형 자동판별 + 검증 + 정규화. */
export function parseWorkbook(aoa: unknown[][], fname?: string): ParseResult {
  const result: ParseResult = { ok: false, type: null, errors: [], records: null, info: "" };
  if (!aoa || aoa.length < 3) { result.errors.push("데이터 행이 없습니다. 빈 파일이거나 형식이 올바르지 않습니다."); return result; }
  const r0 = (aoa[0] as unknown[]).map(norm), r1 = (aoa[1] as unknown[]).map(norm);

  const c_hq = findCol(r0, COLUMN_MAP.hq), c_st = findCol(r0, COLUMN_MAP.station);
  const c_fy = findCol(r0, COLUMN_MAP.fyear), c_cat = findCol(r0, COLUMN_MAP.cat), c_det = findCol(r0, COLUMN_MAP.detail);
  if (c_hq < 0 || c_st < 0) { result.errors.push("필수 컬럼 누락: 본부명 / 역명 (역별 데이터 구조가 아님)"); return result; }
  if (c_cat < 0) { result.errors.push("필수 컬럼 누락: 사업구분(업종)"); return result; }

  const timeCols: { label: string; col: number; kind: "date" | "month" | "year" }[] = [];
  for (let i = 0; i < r0.length; i++) {
    if (norm(r1[i]).startsWith("매출액")) {
      const lab = String((aoa[0] as unknown[])[i]).trim();
      let kind: "date" | "month" | "year" | null = null;
      if (/^\d{4}-\d{2}-\d{2}/.test(lab) || /^\d{5}$/.test(lab)) kind = "date";
      else if (/^\d{2}월$/.test(lab)) kind = "month";
      else if (/^\d{4}$/.test(lab)) kind = "year";
      if (kind) timeCols.push({ label: lab, col: i, kind });
    }
  }
  if (timeCols.length === 0) { result.errors.push("시간축(일자/월/연도) 데이터 컬럼을 찾을 수 없습니다. 표준 양식인지 확인해 주세요."); return result; }

  const kind = timeCols[0].kind;
  const type: "daily" | "monthly" | "annual" = kind === "date" ? "daily" : kind === "month" ? "monthly" : "annual";

  const fn = fname || "";
  const expect = fn.includes("일자") || fn.includes("일별") ? "daily" : fn.includes("월별") ? "monthly" : fn.includes("연") || fn.includes("년") ? "annual" : null;
  if (expect && expect !== type) {
    result.errors.push(`업로드 위치와 파일 내용이 다릅니다. (이 파일은 '${({ daily: "일자별", monthly: "월별", annual: "연도별" } as Record<string, string>)[type]}' 데이터로 보입니다.)`);
    return result;
  }

  const recs: Array<Record<string, unknown>> = [];
  for (let ri = 2; ri < aoa.length; ri++) {
    const row = aoa[ri] as unknown[]; if (!row) continue;
    const hq = norm(row[c_hq]), st = norm(row[c_st]);
    if (!hq || !st || hq === "본부명") continue;
    const cat = norm(row[c_cat]); const detail = c_det >= 0 ? norm(row[c_det]) : "";
    const fyear = c_fy >= 0 ? String(row[c_fy] || "").trim() : "";
    timeCols.forEach((tc) => {
      const raw = row[tc.col]; const sales = Number(String(raw).replace(/,/g, ""));
      const stores = Number(String(row[tc.col + 1]).replace(/,/g, "")) || 0;
      if (!isNaN(sales) && raw != null && raw !== "") {
        const rec: Record<string, unknown> = { hq, station: st, cat, detail, sales, stores };
        if (type === "daily") { rec.date = parseDateLabel(tc.label); rec.year = yearFromFY(fyear) || (rec.date ? +String(rec.date).slice(0, 4) : CUR_YEAR); }
        else if (type === "monthly") { rec.month = tc.label; rec.fy = fyear || tc.label; }
        else { rec.year = +tc.label; }
        recs.push(rec);
      }
    });
  }
  if (recs.length === 0) {
    result.ok = true; result.type = type; result.records = recs; result.empty = true;
    result.info = "구조 정상 · 매출 수치가 비어 있는 양식 파일입니다(데모 데이터로 표시).";
    return result;
  }
  result.ok = true; result.type = type; result.records = recs;
  result.info = `구조 정상 · ${recs.length.toLocaleString()}건 인식`;
  return result;
}

export function readExcelFile(file: File): Promise<ParseResult> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
        res(parseWorkbook(aoa, file.name));
      } catch (err) { rej(err); }
    };
    fr.onerror = rej; fr.readAsArrayBuffer(file);
  });
}

/** 업로드된 파싱 결과(일/월/연)를 합쳐 MarketData로. 비어있으면 데모로 폴백. */
export function buildFromUploads(parts: { daily?: ParseResult; monthly?: ParseResult; annual?: ParseResult }): MarketData {
  const daily = (parts.daily?.records as DailyRec[] | undefined) ?? [];
  const monthly = (parts.monthly?.records as MonthlyRec[] | undefined) ?? [];
  const annual = (parts.annual?.records as AnnualRec[] | undefined) ?? [];
  if (!daily.length && !monthly.length && !annual.length) return genDemo();
  const demo = genDemo();
  return {
    daily: daily.length ? daily : demo.daily,
    monthly: monthly.length ? monthly : demo.monthly,
    annual: annual.length ? annual : demo.annual,
    dates: daily.length ? [...new Set(daily.map((r) => r.date))].sort() : demo.dates,
    demo: false,
  };
}

/* ---------- 집계(scope 적용) ---------- */
function rows(ctx: { data: MarketData } & Scope, kind: "daily" | "monthly" | "annual"): Array<DailyRec | MonthlyRec | AnnualRec> {
  let r: Array<DailyRec | MonthlyRec | AnnualRec> = ctx.data[kind] || [];
  if (ctx.scope === "station" && ctx.station) r = r.filter((x) => x.station === ctx.station);
  return r;
}
type Ctx = { data: MarketData } & Scope;

export function annualByCat(ctx: Ctx): Record<string, Record<number, number>> {
  const out: Record<string, Record<number, number>> = {}; CAT.forEach((c) => (out[c] = {}));
  (rows(ctx, "annual") as AnnualRec[]).forEach((r) => { if (!out[r.cat]) out[r.cat] = {}; out[r.cat][r.year] = (out[r.cat][r.year] || 0) + r.sales; });
  return out;
}
export function monthlyByCat(ctx: Ctx, fy: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}; CAT.forEach((c) => (out[c] = {}));
  (rows(ctx, "monthly") as MonthlyRec[]).filter((r) => r.fy === fy).forEach((r) => { if (!out[r.cat]) out[r.cat] = {}; out[r.cat][r.month] = (out[r.cat][r.month] || 0) + r.sales; });
  return out;
}
export function dailyByCat(ctx: Ctx, year: number): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}; CAT.forEach((c) => (out[c] = {}));
  (rows(ctx, "daily") as DailyRec[]).filter((r) => r.year === year).forEach((r) => { if (!out[r.cat]) out[r.cat] = {}; out[r.cat][r.date] = (out[r.cat][r.date] || 0) + r.sales; });
  return out;
}
export function totalAnnual(ctx: Ctx, year: number): number {
  return (rows(ctx, "annual") as AnnualRec[]).filter((r) => r.year === year).reduce((a, b) => a + b.sales, 0);
}
export function catShareCurrent(ctx: Ctx): { cat: string; val: number }[] {
  const m: Record<string, number> = {};
  (rows(ctx, "annual") as AnnualRec[]).filter((r) => r.year === CUR_YEAR).forEach((r) => (m[r.cat] = (m[r.cat] || 0) + r.sales));
  return CAT.map((c) => ({ cat: c, val: m[c] || 0 })).filter((x) => x.val > 0).sort((a, b) => b.val - a.val);
}
export function catGrowth(ctx: Ctx): { cat: string; cur: number; prevSame: number; g: number }[] {
  return CAT.map((c) => {
    const cur = (rows(ctx, "annual") as AnnualRec[]).filter((r) => r.year === CUR_YEAR && r.cat === c).reduce((a, b) => a + b.sales, 0);
    const prevFull = (rows(ctx, "annual") as AnnualRec[]).filter((r) => r.year === CUR_YEAR - 1 && r.cat === c).reduce((a, b) => a + b.sales, 0);
    const prevSame = prevFull * YEAR_PROGRESS;
    const g = prevSame > 0 ? ((cur - prevSame) / prevSame) * 100 : 0;
    return { cat: c, cur, prevSame, g };
  }).filter((x) => x.cur > 0);
}
export function cat3yTrend(ctx: Ctx, c: string): number {
  const a = annualByCat(ctx)[c] || {}; const y0 = a[CUR_YEAR - 3], y1 = a[CUR_YEAR - 1];
  if (!y0 || !y1) return 0; return (Math.pow(y1 / y0, 1 / 2) - 1) * 100;
}

/* ---------- 참고용 예측 (고도화: 실데이터 잔여기간 보정) ---------- */
export type PredictBasis = { method: string; lines: { ko: string; num: string }[] };
export type PredictRow = { cat: string; pred: number; actual: number; rem: number; avg5: number; prev: number; g: number; basis?: PredictBasis };
function daysInMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }

/** 월별(월별 데이터 기준): 당월 부분 실적 + (예년 동월 일평균과 올해 경과 페이스의 경과일 가중 × 잔여일). */
export function predictMonth(ctx: Ctx): PredictRow[] {
  const today = new Date(BASE_DATE); const Y = today.getFullYear(), Mo = today.getMonth() + 1;
  const dim = daysInMonth(Y, Mo), dayN = today.getDate(), remain = Math.max(0, dim - dayN);
  const mm = String(Mo).padStart(2, "0"); const target = mm + "월";
  const curMon = monthlyByCat(ctx, FY_LABELS[0]);
  return CAT.map((c): PredictRow | null => {
    const partial = curMon[c]?.[target] || 0; // 올해 당월 부분 실적(월별)
    const hist = FY_LABELS.slice(1).map((fy) => monthlyByCat(ctx, fy)[c]?.[target] || 0).filter((v) => v > 0);
    const histAvg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    const histPerDay = histAvg / dim;
    // ⓐ 당월 실적이 없으면(미업로드) 예년 동월 평균을 당월 예측치로 — 예년도 없으면 행 제외.
    if (partial <= 0) {
      if (histAvg <= 0) return null;
      const prev = hist[0] || histAvg;
      const basis: PredictBasis = { method: `${target} 예측 = 예년 동월 평균 (당월 실적 미업로드)`, lines: [{ ko: `${target} 예측 = 예년 ${target} 평균`, num: `= ${W(histAvg)}` }] };
      return { cat: c, pred: histAvg, actual: 0, rem: histAvg, avg5: histAvg, prev, g: prev > 0 ? ((histAvg - prev) / prev) * 100 : 0, basis };
    }
    const daysElapsed = dayN; // 달력 경과일
    const pacePerDay = partial / daysElapsed;
    const w = Math.min(1, daysElapsed / dim);
    const blendedPerDay = histPerDay > 0 ? histPerDay * (1 - w) + pacePerDay * w : pacePerDay;
    const rem = blendedPerDay * remain;
    const pred = partial + rem;
    const avg5 = histAvg || partial * (dim / daysElapsed);
    const prev = hist[0] || avg5;
    const basis: PredictBasis = {
      method: `${target} 예측 = ${target} 부분 실적 + 잔여기간 추정`,
      lines: [
        { ko: `① ${target} 부분 실적 (${dayN}일 경과)`, num: `= ${W(partial)}` },
        { ko: `② 예년 동월 일평균 = 예년 ${target} 평균 ÷ ${dim}일`, num: `= ${W(histAvg)} ÷ ${dim} = ${W(histPerDay)}/일` },
        { ko: `③ 올해 경과 일평균 = ① ÷ ${dayN}일`, num: `= ${W(partial)} ÷ ${dayN} = ${W(pacePerDay)}/일` },
        { ko: `④ 잔여 일평균 = ②×(1−경과율) + ③×경과율  [경과율 ${Math.round(w * 100)}%]`, num: `= ${W(histPerDay)}×${(1 - w).toFixed(2)} + ${W(pacePerDay)}×${w.toFixed(2)} = ${W(blendedPerDay)}/일` },
        { ko: `⑤ 잔여기간 추정 = ④ × 잔여일수(${remain}일)`, num: `= ${W(blendedPerDay)}/일 × ${remain}일 = ${W(rem)}` },
        { ko: `⑥ ${target} 예측 = ① + ⑤`, num: `= ${W(partial)} + ${W(rem)} = ${W(pred)}` },
      ],
    };
    return { cat: c, pred, actual: partial, rem, avg5, prev, g: prev > 0 ? ((pred - prev) / prev) * 100 : 0, basis };
  }).filter((x): x is PredictRow => !!x && (x.actual > 0 || x.avg5 > 0));
}
/** 연간: 올해 누계 실적 + 당월 잔여 추정 + (과거 월평균 × 잔여월수 × 전년대비 성장계수). */
export function predictYear(ctx: Ctx): PredictRow[] {
  const today = new Date(BASE_DATE); const Mo = today.getMonth() + 1; const monthsRemain = 12 - Mo;
  const pm = predictMonth(ctx); const pmMap: Record<string, PredictRow> = {}; pm.forEach((x) => (pmMap[x.cat] = x));
  return CAT.map((c): PredictRow | null => {
    const a = annualByCat(ctx)[c] || {}; const curPartial = a[CUR_YEAR] || 0;
    const hist = [CUR_YEAR - 1, CUR_YEAR - 2, CUR_YEAR - 3].map((y) => a[y]).filter((v) => v > 0);
    if (!hist.length) return null; // 과거 실적이 전혀 없으면 예측 불가
    const avgFull = hist.reduce((a, b) => a + b, 0) / hist.length;
    const yoy = hist.length >= 2 ? Math.min(1.5, Math.max(0.6, hist[0] / hist[1])) : 1;
    // ⓐ 당해 누계가 없으면(미업로드) 과거 평균 × 전년대비 추세로 연간 추정.
    if (!curPartial) {
      const pred = avgFull * yoy;
      const basis: PredictBasis = { method: `올해 예측 = 과거 ${hist.length}년 연평균 × 전년대비 계수 (당해 미업로드)`, lines: [{ ko: `올해 예측 = 과거 연평균 × 전년대비 계수`, num: `= ${W(avgFull)} × ${yoy.toFixed(2)} = ${W(pred)}` }] };
      return { cat: c, pred, actual: 0, rem: pred, avg5: avgFull, prev: hist[0], g: hist[0] > 0 ? ((pred - hist[0]) / hist[0]) * 100 : 0, basis };
    }
    const monthRemainEst = pmMap[c] ? pmMap[c].rem : 0;
    const remainMonthsEst = (avgFull / 12) * monthsRemain * yoy;
    const rem = monthRemainEst + remainMonthsEst;
    const pred = curPartial + rem;
    const prev = hist[0];
    const basis: PredictBasis = {
      method: `올해 예측 = 올해 누계 + 당월 잔여 + 잔여 ${monthsRemain}개월 추정`,
      lines: [
        { ko: `① 올해 누계 실적`, num: `= ${W(curPartial)}` },
        { ko: `② 당월 잔여 추정 (월별 예측에서)`, num: `= ${W(monthRemainEst)}` },
        { ko: `③ 과거 ${hist.length}년 연평균`, num: `= ${W(avgFull)}` },
        { ko: `④ 전년대비 계수 = 전년 ÷ 전전년 (0.6~1.5 제한)`, num: `= ${yoy.toFixed(2)}` },
        { ko: `⑤ 잔여 ${monthsRemain}개월 추정 = ③ ÷ 12 × ${monthsRemain}개월 × ④`, num: `= ${W(avgFull)} ÷ 12 × ${monthsRemain} × ${yoy.toFixed(2)} = ${W(remainMonthsEst)}` },
        { ko: `⑥ 올해 예측 = ① + ② + ⑤`, num: `= ${W(curPartial)} + ${W(monthRemainEst)} + ${W(remainMonthsEst)} = ${W(pred)}` },
      ],
    };
    return { cat: c, pred, actual: curPartial, rem, avg5: avgFull, prev, g: prev > 0 ? ((pred - prev) / prev) * 100 : 0, basis };
  }).filter((x): x is PredictRow => !!x);
}
/** 역간 비교용 — 특정 역의 연간 매출 합계(필터 가능). */
export function stnSum(data: MarketData, station: string, filterFn?: (r: AnnualRec) => boolean): number {
  return (data.annual || []).filter((r) => r.station === station && (!filterFn || filterFn(r))).reduce((a, b) => a + b.sales, 0);
}
/** 특정 역의 올해 누계 주력 업종. */
export function topCatOf(data: MarketData, station: string): string | null {
  const m: Record<string, number> = {};
  (data.annual || []).filter((r) => r.station === station && r.year === CUR_YEAR).forEach((r) => (m[r.cat] = (m[r.cat] || 0) + r.sales));
  const e = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  return e ? e[0] : null;
}

/* ---------- 규칙형 자동 요약 ---------- */
export type Insight = { t: "u" | "d" | "i"; h: string };
export function buildInsights(ctx: Ctx): Insight[] {
  const out: Insight[] = []; const g = catGrowth(ctx).sort((a, b) => b.g - a.g);
  const scopeLab = ctx.scope === "station" ? `${ctx.station}역` : "전체";
  if (g.length) {
    const top = g[0], bot = g[g.length - 1];
    out.push({ t: "u", h: `${scopeLab} 기준 <b>${top.cat}</b> 업종이 전년 동기간 대비 <b>${PCT(top.g)}</b>로 가장 높은 증가세입니다.` });
    if (bot.g < 0) out.push({ t: "d", h: `<b>${bot.cat}</b> 업종은 전년 동기간 대비 <b>${PCT(bot.g)}</b>로 감소했습니다.` });
  }
  const t3 = CAT.map((c) => ({ c, v: cat3yTrend(ctx, c) })).filter((x) => x.v !== 0).sort((a, b) => b.v - a.v);
  if (t3.length >= 2) {
    const up = t3[0], dn = t3[t3.length - 1];
    out.push({ t: "i", h: `최근 3년 추세: <b>${up.c}</b> 연평균 ${PCT(up.v)} 성장, <b>${dn.c}</b> 연평균 ${PCT(dn.v)} ${dn.v < 0 ? "감소" : "성장"}.` });
  }
  const share = catShareCurrent(ctx);
  if (share.length) out.push({ t: "i", h: `올해 매출 비중 1위는 <b>${share[0].cat}</b> (${((share[0].val / share.reduce((a, b) => a + b.val, 0)) * 100).toFixed(1)}%)입니다.` });
  return out;
}
export function insightText(ctx: Ctx): string { return buildInsights(ctx).map((x) => "· " + x.h.replace(/<\/?b>/g, "")).join("\n"); }

/* ---------- 자연어 검색(로컬 규칙 파서 · 외부 전송 없음) ---------- */
export type NLIntent = {
  cat: string | null; station: string | null; stations: string[]; years: number | null;
  metric: "trend" | "up" | "down" | "share"; period: "daily" | "month" | "year" | null; compare: boolean;
};
export function parseNL(q: string): NLIntent {
  const t = q.replace(/\s/g, "");
  const o: NLIntent = { cat: null, station: null, stations: [], years: null, metric: "trend", period: null, compare: false };
  CAT.forEach((c) => { if (t.includes(c)) o.cat = c; }); if (t.includes("카페")) o.cat = "전문점";
  const found: string[] = [];
  STATIONS.forEach((x) => { if (x.s.length >= 2 && t.includes(x.s) && !found.includes(x.s)) found.push(x.s); });
  o.stations = found; o.station = found[0] || null;
  if (/3년|삼년/.test(t)) o.years = 3; else if (/5년|오년/.test(t)) o.years = 5; else if (/2개월|두달|2달/.test(t)) o.period = "daily";
  if (/올해|금년|당해/.test(t)) o.period = o.period || "year";
  if (/줄|감소|하락|떨어/.test(t)) o.metric = "down";
  if (/늘|증가|성장|올랐/.test(t)) o.metric = "up";
  if (/비중|구성|점유/.test(t)) o.metric = "share";
  if (/비교|대비|vs/.test(t)) o.compare = true;
  if (/월별|매월/.test(t)) o.period = "month";
  if (/연간|연도별|매년/.test(t)) o.period = "year";
  if (/일자|일별|날짜|매출추이/.test(t) && !o.period) o.period = "daily";
  return o;
}
/** LLM 자연어 검색용 — 현재 데이터의 압축 통계 컨텍스트(가드레일 경유 내부 LLM에 근거로 주입). hintStations는 질의에서 감지된 역의 업종 상세를 추가. */
export function buildNlContext(data: MarketData, hintStations: string[] = []): string {
  const all: Ctx = { data, scope: "all", station: null };
  const share = catShareCurrent(all); const tot = share.reduce((a, b) => a + b.val, 0) || 1;
  const grow = catGrowth(all);
  const lines: string[] = [];
  lines.push("[전사 업종별 · 올해 누계 비중/전년동기/3년추세]");
  share.forEach((s) => { const g = grow.find((x) => x.cat === s.cat); lines.push(`- ${s.cat}: 비중 ${((s.val / tot) * 100).toFixed(1)}%, 전년동기 ${g ? PCT(g.g) : "-"}, 3년 ${PCT(cat3yTrend(all, s.cat))}`); });
  const st: Record<string, number> = {};
  data.annual.filter((r) => r.year === CUR_YEAR).forEach((r) => { st[r.station] = (st[r.station] || 0) + r.sales; });
  const sorted = Object.entries(st).sort((a, b) => b[1] - a[1]);
  lines.push(`[역 Top10(올해 누계)] ${sorted.slice(0, 10).map(([s, v]) => `${s} ${WON(v)}`).join(", ")}`);
  [...new Set(hintStations)].forEach((hs) => {
    const sc: Ctx = { data, scope: "station", station: hs };
    const ss = catShareCurrent(sc); const t2 = ss.reduce((a, b) => a + b.val, 0) || 1;
    if (ss.length) lines.push(`[${hs}역 업종별 비중] ${ss.map((x) => `${x.cat} ${((x.val / t2) * 100).toFixed(1)}%`).join(", ")}`);
  });
  lines.push(`[분석 가능 역] ${[...new Set(data.annual.map((r) => r.station))].join(", ")}`);
  lines.push(`[업종] ${CAT.join(", ")} / [연도] ${[...new Set(data.annual.map((r) => r.year))].sort().join(", ")}`);
  return lines.join("\n");
}
export function nlAnswer(ctx: Ctx, o: NLIntent): string {
  const scope = o.station ? `${o.station}역` : "전체";
  if (o.cat) {
    if (o.metric === "share") {
      const s = catShareCurrent(ctx); const f = s.find((x) => x.cat === o.cat); const tot = s.reduce((a, b) => a + b.val, 0);
      return f ? `${scope} 기준 <b>${o.cat}</b> 매출 비중은 <b>${((f.val / tot) * 100).toFixed(1)}%</b> (${WON(f.val)})입니다.` : "데이터가 없습니다.";
    }
    const a = annualByCat(ctx)[o.cat] || {}; const n = o.years || 3;
    const y0 = a[CUR_YEAR - 1], yN = a[CUR_YEAR - 1 - n];
    if (y0 && yN) { const cagr = (Math.pow(y0 / yN, 1 / n) - 1) * 100; return `${scope} 기준 최근 ${n}년간 <b>${o.cat}</b> 매출은 연평균 <b>${PCT(cagr)}</b> ${cagr >= 0 ? "증가" : "감소"}했습니다.`; }
    const g = catGrowth(ctx).find((x) => x.cat === o.cat);
    return g ? `${scope} 기준 <b>${o.cat}</b>은 전년 동기간 대비 <b>${PCT(g.g)}</b>입니다.` : "데이터가 없습니다.";
  }
  const g = catGrowth(ctx).sort((a, b) => b.g - a.g);
  if (o.metric === "down" && g.length) { const d = g[g.length - 1]; return `${scope} 기준 가장 많이 감소한 업종은 <b>${d.cat}</b> (${PCT(d.g)})입니다.`; }
  if (g.length) { const u = g[0]; return `${scope} 기준 가장 높은 성장 업종은 <b>${u.cat}</b> (${PCT(u.g)})입니다.`; }
  return "분석 조건을 인식했습니다. 아래 대시보드를 확인하세요.";
}
