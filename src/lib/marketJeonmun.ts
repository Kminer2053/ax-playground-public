/**
 * 전문점(JM) 세부분류 매출 분석 — 데이터층.
 * kr-market v2 전문점 모듈(대>중>소 드릴다운)의 설정·파서·집계를 React용 순수 함수로 이식.
 * 전역 STATE 대신 ctx({data, filters, drill})를 받는다. 브라우저 내부 분석(외부 전송 없음).
 */
import * as XLSX from "xlsx";
import { W, WON, PCT, CUR_YEAR, BASE_DATE } from "./marketAnalysis";

export { W, WON, PCT, CUR_YEAR, BASE_DATE };

/* ---------- 본부/센터/역 ---------- */
export const JM_BONBU_CENTER: Record<string, string[]> = { "본사": ["본사매출"], "경인본부": ["경인본소"], "경기본부": ["금정지점", "분당지점", "수원본소"], "서울본부": ["서울"], "동부본부": ["의정부지점", "청량리"], "부산경남본부": ["부산본소"], "충청본부": ["대전본소", "천안지점"], "호남본부": ["호남본소"], "대구경북본부": ["대구"] };
const JM_BCS: Record<string, Record<string, string[]>> = { "본사": { "본사매출": ["미정", "역외"] }, "경인본부": { "경인본소": ["가산디지털단지", "간석", "개봉", "광명", "구로", "구일", "금천구청", "김포공항", "노량진", "대방", "대방(신림선)", "독산", "동암", "백운", "보라매병원(신림선)", "부개", "부천", "부평", "소래포구", "소사(경인선)", "송내", "신길", "신도림", "신림(신림선)", "안양", "역곡", "역외", "영등포", "오류동", "원인재", "인천", "인천논현", "제물포", "주안", "중동"] }, "경기본부": { "수원본소": ["당정", "병점", "성균관대", "수원", "역외", "오산", "의왕", "지제", "평택"], "금정지점": ["경마공원", "고잔", "과천", "금정", "대공원", "범계", "산본", "상록수", "안산", "오이도", "인덕원", "정부과천청사", "정왕", "중앙", "평촌", "한대앞"], "분당지점": ["강남구청", "기흥", "망포", "모란", "미금", "서울숲", "서현", "선릉", "선정릉", "수서", "수원시청", "압구정로데오", "야탑", "영통", "오리", "정자", "죽전", "한티"] }, "서울본부": { "서울": ["대화", "마두", "문산", "백마", "백석", "삼송", "서울", "서울(GTX-A)", "역외", "연신내", "용산", "운정중앙", "원당", "일산", "정발산", "주엽", "킨텍스", "탄현", "풍산", "행신", "화정"] }, "동부본부": { "의정부지점": ["가능(의정부북부)", "광운대", "녹양", "덕계", "덕정", "도봉산", "동두천중앙", "석계", "양주", "연천", "외대앞", "의정부", "지행", "회룡"], "청량리": ["가평", "강릉", "구리", "남춘천", "덕소", "도농", "동해", "망우", "묵호", "상봉", "양평", "옥수", "왕십리", "원주", "정동진", "청량리", "춘천", "퇴계원", "평내호평", "평창", "회기"] }, "부산경남본부": { "부산본소": ["구포", "마산", "부산", "부전", "신해운대", "오시리아", "울산", "진주", "창원중앙", "태화강"] }, "충청본부": { "대전본소": ["공주", "대전", "서대전", "오송", "제천"], "천안지점": ["대천", "두정", "아산", "온양온천", "천안", "천안아산", "홍성"] }, "호남본부": { "호남본소": ["광주", "광주송정", "군산", "나주", "남원", "목포", "순천", "여수엑스포", "여천", "역외", "익산", "전주", "정읍"] }, "대구경북본부": { "대구": ["경산", "경주", "구미", "김천", "김천(구미)", "대구", "동대구", "서대구", "안동", "영주", "청도", "포항"] } };
export const JM_HIER: Record<string, Record<string, string[]>> = { "고향뜨락": { "고향뜨락": ["고향뜨락"] }, "명품마루": { "명품마루": ["명품마루"] }, "사회적경제기업": { "사회적경제기업": ["사회적경제기업"] }, "식음료": { "간편식": ["기타간편식", "패스트푸드"], "식사": ["기타외국식", "분식", "양식", "일식", "중식", "한식"], "음료/후식": ["기타후식", "주스", "차", "커피"], "제과/간식": ["기타간식", "도넛", "전문제과", "종합제과"] }, "여성기업": { "여성기업": ["여성기업"] }, "일반상업시설": { "H and B": ["H and B"], "기타": ["기타"], "농축수산물": ["농축수산물"], "도서": ["도서"], "문구/팬시용품": ["문구/팬시용품"], "물품보관함": ["물품보관함"], "생활용품": ["생활용품"], "서비스": ["서비스"], "액세서리": ["액세서리"], "약국": ["약국"], "의류/패션": ["의류/패션"], "화장품": ["화장품"], "화훼": ["화훼"] }, "직영카페": { "직영카페": ["직영카페"] }, "찬들마루": { "찬들마루": ["찬들마루"] }, "팝업스토어": { "팝업스토어": ["팝업스토어"] } };

export const JM_DAE: string[] = (() => { const ks = Object.keys(JM_HIER); return ["식음료", ...ks.filter((k) => k !== "식음료")]; })();
const JM_DAE_COLOR: Record<string, string> = { "식음료": "#1F5FBF", "일반상업시설": "#16A085", "직영카페": "#8E5BD6", "고향뜨락": "#E0A41E", "찬들마루": "#D86A2C", "명품마루": "#C0392B", "여성기업": "#2C82C9", "팝업스토어": "#E84393", "사회적경제기업": "#27AE60" };
const JM_PALETTE = ["#1F5FBF", "#16A085", "#E0A41E", "#8E5BD6", "#D86A2C", "#2C82C9", "#E84393", "#27AE60", "#C0392B", "#0E9AA7", "#7F8C8D", "#E67E22", "#2980B9", "#9B59B6", "#1ABC9C", "#F39C12"];
export function jmColor(name: string, idx?: number): string { return JM_DAE_COLOR[name] || JM_PALETTE[(idx || 0) % JM_PALETTE.length]; }

const JM_DAE_PROFILE: Record<string, { base: number; trend: number; season: number; share: number }> = {
  "식음료": { base: 2.1e7, trend: +0.04, season: 0.15, share: 0.9 }, "일반상업시설": { base: 1.8e7, trend: +0.02, season: 0.08, share: 0.7 },
  "직영카페": { base: 0.9e7, trend: +0.07, season: 0.12, share: 0.3 }, "고향뜨락": { base: 0.6e7, trend: +0.01, season: 0.1, share: 0.22 },
  "찬들마루": { base: 0.5e7, trend: +0.03, season: 0.06, share: 0.18 }, "명품마루": { base: 0.45e7, trend: -0.01, season: 0.05, share: 0.14 },
  "여성기업": { base: 0.35e7, trend: +0.02, season: 0.07, share: 0.12 }, "팝업스토어": { base: 0.4e7, trend: +0.1, season: 0.2, share: 0.16 },
  "사회적경제기업": { base: 0.3e7, trend: +0.05, season: 0.05, share: 0.12 },
};

export const JM_ALL_BONBU = Object.keys(JM_BONBU_CENTER);
export const JM_ALL_CENTER: string[] = ([] as string[]).concat(...Object.values(JM_BONBU_CENTER));
export const JM_STATIONS: { s: string; bonbu: string; center: string }[] = [];
Object.keys(JM_BCS).forEach((b) => Object.keys(JM_BCS[b]).forEach((c) => JM_BCS[b][c].forEach((s) => { if (!JM_STATIONS.find((x) => x.s === s && x.center === c)) JM_STATIONS.push({ s, bonbu: b, center: c }); })));
export function centersOf(bonbu: string): string[] { return bonbu === "전체" ? JM_ALL_CENTER : JM_BONBU_CENTER[bonbu] || []; }
export function stationsOf(bonbu: string, center: string): string[] {
  return [...new Set(JM_STATIONS.filter((x) => (bonbu === "전체" || x.bonbu === bonbu) && (center === "전체" || x.center === center)).map((x) => x.s))].sort();
}

/* ---------- 타입 ---------- */
export type JmRec = { bonbu: string; center: string; station: string; dae: string; jung: string; so: string; sales: number; date?: string; yyyymm?: string };
export type JmData = { daily: JmRec[]; monthly: JmRec[]; demo: boolean };
export type JmFilters = { bonbu: string; center: string; station: string };
export type JmDrill = { dae: string | null; jung: string | null; so: string | null };
export type JmCtx = { data: JmData; filters: JmFilters; drill: JmDrill };
export type JmParse = { ok: boolean; type: "jmdaily" | "jmmonthly" | null; errors: string[]; records: JmRec[]; empty?: boolean; coverageFail?: boolean; info?: string };

/* ---------- helpers ---------- */
function norm(s: unknown): string { return (s == null ? "" : String(s)).replace(/\s+/g, "").trim(); }
function rng(seed: number): () => number { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function hash(str: string): number { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

/* ---------- 데모 ---------- */
export function genJmDemo(): JmData {
  const daily: JmRec[] = [], monthly: JmRec[] = [];
  const months: number[] = []; for (let y = 2023; y <= 2026; y++) { for (let m = 1; m <= 12; m++) { if (y === 2026 && m > 6) break; months.push(y * 100 + m); } }
  const dates: string[] = []; { let d = new Date("2026-05-04"); const end = new Date("2026-06-17"); while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); } }
  const leaves: { dae: string; jung: string; so: string }[] = [];
  JM_DAE.forEach((dae) => Object.keys(JM_HIER[dae]).forEach((jung) => JM_HIER[dae][jung].forEach((so) => leaves.push({ dae, jung, so }))));
  JM_STATIONS.forEach(({ s, bonbu, center }) => {
    const r = rng(hash(s + bonbu + center)); const sc = 0.4 + (hash(s) % 120) / 100;
    let picked = leaves.filter((L) => { const p = JM_DAE_PROFILE[L.dae] ? JM_DAE_PROFILE[L.dae].share : 0.2; return r() < p * 0.6; });
    if (!picked.length) picked = [leaves[Math.floor(r() * leaves.length)]];
    picked.forEach((L) => {
      const prof = JM_DAE_PROFILE[L.dae] || { base: 5e6, trend: 0, season: 0.1 };
      const baseM = prof.base * sc * (0.5 + r());
      months.forEach((ym) => {
        const y = Math.floor(ym / 100), m = ym % 100, yrsFromNow = 2026 - y;
        const season = 1 + prof.season * Math.sin((m / 12) * Math.PI * 2 - 1.1);
        let v = baseM * Math.pow(1 + prof.trend, -yrsFromNow) * season * (0.85 + r() * 0.3);
        if (y === 2026 && m === 6) v *= 0.58;
        monthly.push({ bonbu, center, station: s, dae: L.dae, jung: L.jung, so: L.so, yyyymm: String(ym), sales: Math.round(v) });
      });
      dates.forEach((ds) => { const dow = new Date(ds).getDay(), wk = dow === 0 || dow === 6 ? 0.8 : 1.06; daily.push({ bonbu, center, station: s, dae: L.dae, jung: L.jung, so: L.so, date: ds, sales: Math.round((baseM / 30) * wk * (0.7 + r() * 0.6)) }); });
    });
  });
  return { daily, monthly, demo: true };
}

/* ---------- 파서(전체 본부/센터 포함 검증) ---------- */
export function parseJeonmunWorkbook(aoa: unknown[][], fname?: string): JmParse {
  void fname;
  const res: JmParse = { ok: false, type: null, errors: [], records: [] };
  if (!aoa || aoa.length < 7) { res.errors.push("데이터 행이 부족합니다. 전문점 표준 양식 파일이 아닙니다."); return res; }
  let hr = -1;
  for (let i = 0; i < Math.min(aoa.length, 14); i++) { const row = (aoa[i] || []).map(norm); if (row.includes("본부") && row.includes("대분류명")) { hr = i; break; } }
  if (hr < 0) { res.errors.push("헤더(본부 / 대분류명)를 찾을 수 없습니다. 전문점 표준 양식인지 확인해 주세요."); return res; }
  const H = (aoa[hr] as unknown[]).map(norm);
  const col = (names: string[]) => { for (let i = 0; i < H.length; i++) if (names.some((n) => H[i] === norm(n))) return i; return -1; };
  const ci = { bonbu: col(["본부", "본부명"]), center: col(["센터"]), station: col(["역명", "역"]), dae: col(["대분류명", "대분류"]), jung: col(["중분류명", "중분류"]), so: col(["소분류명", "소분류"]) };
  const need: Record<string, string> = { bonbu: "본부", center: "센터", station: "역명", dae: "대분류명", jung: "중분류명", so: "소분류명" };
  const missCol = (Object.keys(ci) as (keyof typeof ci)[]).filter((k) => ci[k] < 0).map((k) => need[k]);
  if (missCol.length) { res.errors.push("필수 컬럼 누락: " + missCol.join(", ")); return res; }
  const timeCols: { lab: string; col: number; kind: "daily" | "monthly" }[] = [];
  for (let i = 0; i < H.length; i++) { const lab = String((aoa[hr] as unknown[])[i] == null ? "" : (aoa[hr] as unknown[])[i]).trim(); if (/^\d{8}$/.test(lab)) timeCols.push({ lab, col: i, kind: "daily" }); else if (/^\d{6}$/.test(lab)) timeCols.push({ lab, col: i, kind: "monthly" }); }
  if (!timeCols.length) { res.errors.push("일자(YYYYMMDD) 또는 월(YYYYMM) 매출 컬럼을 찾을 수 없습니다."); return res; }
  const kind = timeCols[0].kind, type: "jmdaily" | "jmmonthly" = kind === "daily" ? "jmdaily" : "jmmonthly";
  const seenB = new Set<string>(), seenC = new Set<string>(), recs: JmRec[] = [];
  for (let ri = hr + 2; ri < aoa.length; ri++) {
    const row = aoa[ri] as unknown[]; if (!row) continue;
    const bonbu = norm(row[ci.bonbu]); if (!bonbu || bonbu === "본부") continue;
    const center = norm(row[ci.center]), station = norm(row[ci.station]) || "미정";
    const dae = norm(row[ci.dae]) || "기타", jung = norm(row[ci.jung]) || dae, so = norm(row[ci.so]) || jung;
    seenB.add(bonbu); seenC.add(center);
    timeCols.forEach((tc) => { const raw = row[tc.col]; const sales = Number(String(raw).replace(/,/g, "")); if (raw != null && raw !== "" && !isNaN(sales)) { const rec: JmRec = { bonbu, center, station, dae, jung, so, sales }; if (kind === "daily") rec.date = tc.lab.slice(0, 4) + "-" + tc.lab.slice(4, 6) + "-" + tc.lab.slice(6, 8); else rec.yyyymm = tc.lab; recs.push(rec); } });
  }
  const missB = JM_ALL_BONBU.filter((b) => !seenB.has(b)), missC = JM_ALL_CENTER.filter((c) => !seenC.has(c));
  if (missB.length || missC.length) {
    res.errors.push("전체 데이터가 아닙니다. 일부 본부/센터가 빠져 분석할 수 없습니다. (필터링 없이 전체를 다운로드해 주세요)");
    if (missB.length) res.errors.push("누락 본부: " + missB.join(", "));
    if (missC.length) res.errors.push("누락 센터: " + missC.join(", "));
    res.coverageFail = true; return res;
  }
  res.ok = true; res.type = type; res.records = recs; res.empty = recs.length === 0;
  res.info = res.empty ? "구조·본부/센터 전체 정상(수치 비어있는 양식 → 데모로 표시)" : `구조 정상 · ${recs.length.toLocaleString()}건 인식`;
  return res;
}

export function readJeonmunFile(file: File): Promise<JmParse> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = (e) => { try { const wb = XLSX.read(e.target?.result, { type: "array" }); const ws = wb.Sheets[wb.SheetNames[0]]; const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][]; res(parseJeonmunWorkbook(aoa, file.name)); } catch (err) { rej(err); } };
    fr.onerror = rej; fr.readAsArrayBuffer(file);
  });
}

/** 업로드된 전문점 일/월 파싱결과(다중)를 합쳐 JmData로. 비어있으면 데모. */
export function buildJmFromUploads(dailyParts: JmParse[], monthlyParts: JmParse[]): JmData {
  const daily = dailyParts.flatMap((u) => u.records || []);
  const monthly = monthlyParts.flatMap((u) => u.records || []);
  if (!daily.length && !monthly.length) return genJmDemo();
  return { daily, monthly, demo: false };
}

/* ---------- 집계(필터·드릴다운) ---------- */
export function jmField(drill: JmDrill): "dae" | "jung" | "so" { return drill.jung ? "so" : drill.dae ? "jung" : "dae"; }
export function jmScopeRecs(ctx: JmCtx, kind: "daily" | "monthly"): JmRec[] {
  let r = ctx.data[kind] || []; const f = ctx.filters, d = ctx.drill;
  if (f.bonbu !== "전체") r = r.filter((x) => x.bonbu === f.bonbu);
  if (f.center !== "전체") r = r.filter((x) => x.center === f.center);
  if (f.station !== "전체") r = r.filter((x) => x.station === f.station);
  if (d.dae) r = r.filter((x) => x.dae === d.dae);
  if (d.jung) r = r.filter((x) => x.jung === d.jung);
  if (d.so) r = r.filter((x) => x.so === d.so);
  return r;
}
export function jmMonths(data: JmData): string[] { return [...new Set((data.monthly || []).map((r) => r.yyyymm as string))].sort(); }
export function jmDates(data: JmData): string[] { return [...new Set((data.daily || []).map((r) => r.date as string))].sort(); }
export function jmYears(data: JmData): number[] { return [...new Set(jmMonths(data).map((m) => +m.slice(0, 4)))].sort(); }
export function jmCoverage(data: JmData): { days: number; months: number } { return { days: jmDates(data).length, months: jmMonths(data).length }; }
export function jmAgg(recs: JmRec[], gf: "dae" | "jung" | "so", tf: "date" | "yyyymm" | "year"): Record<string, Record<string | number, number>> {
  const o: Record<string, Record<string | number, number>> = {};
  recs.forEach((r) => { const g = (r[gf] as string) || "기타"; let t: string | number = (r as Record<string, unknown>)[tf] as string; if (tf === "year") t = +(r.yyyymm as string).slice(0, 4); (o[g] = o[g] || {})[t] = (o[g][t] || 0) + r.sales; });
  return o;
}
export function jmGroupTotals(recs: JmRec[], gf: "dae" | "jung" | "so", months?: string[]): { k: string; v: number }[] {
  const m: Record<string, number> = {};
  recs.forEach((r) => { if (months && !months.includes(r.yyyymm as string)) return; const g = (r[gf] as string) || "기타"; m[g] = (m[g] || 0) + r.sales; });
  return Object.keys(m).map((k) => ({ k, v: m[k] })).sort((a, b) => b.v - a.v);
}
export function jmGroupList(recs: JmRec[], gf: "dae" | "jung" | "so"): string[] { return jmGroupTotals(recs, gf).map((t) => t.k); }
export function jmScopeLabel(filters: JmFilters): string { if (filters.station !== "전체") return filters.station + "역"; if (filters.center !== "전체") return filters.center; if (filters.bonbu !== "전체") return filters.bonbu; return "전체"; }
export function jmNeed(data: JmData, view: "daily" | "monthly" | "annual"): string | null {
  const cov = jmCoverage(data);
  if (view === "daily" && cov.days < 30) return `일자별 분석은 누적 <b>30일 이상</b> 데이터가 필요합니다. (현재 ${cov.days}일)<br>일자별 파일은 시스템상 최대 31일 → 여러 번 받아 중복 업로드하면 기간이 합산됩니다.`;
  if (view === "monthly" && cov.months < 12) return `월간 분석은 누적 <b>12개월 이상</b> 데이터가 필요합니다. (현재 ${cov.months}개월)`;
  if (view === "annual" && cov.months < 36) return `연간 분석은 누적 <b>36개월 이상</b>(월별 12개월 × 3) 데이터가 필요합니다. (현재 ${cov.months}개월)`;
  return null;
}
export const GF_LABEL: Record<string, string> = { dae: "대분류", jung: "중분류", so: "소분류" };
