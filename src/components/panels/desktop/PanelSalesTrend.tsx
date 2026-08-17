"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { MarketChart } from "./market/MarketChart";
import { JeonmunPanel } from "./market/JeonmunPanel";
import { GuideOverlay } from "./market/GuideOverlay";
import * as M from "@/lib/marketAnalysis";
import * as J from "@/lib/marketJeonmun";
import { cacheGet, cacheSet } from "@/lib/uploadCache";

const { CAT, CAT_COLOR, YEARS, CUR_YEAR, BASE_DATE, FISCAL_MONTHS, FY_LABELS, STN, STATIONS, W, WON, PCT } = M;
type MarketData = M.MarketData;
type Ctx = { data: MarketData; scope: "all" | "station"; station: string | null };

/* Chart.js 옵션 조각 */
const FMT_Y = { ticks: { callback: (v: number) => W(v), font: { size: 11 }, color: "#5B6B83" }, grid: { color: "#EDF1F7" } };
const FMT_X = { ticks: { font: { size: 11 }, color: "#5B6B83", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } };
const LEG = { position: "bottom" as const, labels: { font: { size: 11.5 }, color: "#16233B", usePointStyle: true, pointStyle: "circle" as const, padding: 14, boxWidth: 8 } };
const tip = (cb: (c: { dataset?: { label?: string }; raw?: number; label?: string }) => string) => ({ callbacks: { label: cb } });

const ALL_NAV: [string, string][] = [["dashboard", "전체 대시보드"], ["daily", "일자별"], ["monthly", "월별"], ["annual", "연간"], ["compare", "전년 동기간"], ["catcompare", "업종별 비교"]];
const STN_NAV: [string, string][] = [["stnsearch", "역 검색"], ["dashboard", "역별 대시보드"], ["daily", "역별 일자"], ["monthly", "역별 월간"], ["annual", "역별 연간"], ["catcompare", "역별 업종비교"], ["stncompare", "역간 비교"]];
const CHIPS = ["최근 3년간 편의점 매출은 줄었어?", "서울역 업종별 매출 비중", "전문점 최근 5년 추이 비교", "전년 대비 가장 감소한 업종은?"];

/* ---------- 공용 카드 ---------- */
function Card({ title, tag, children }: { title?: string; tag?: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-sm">
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--ax-border-soft)] px-4 py-2.5">
          <h3 className="text-sm font-bold text-[var(--ax-text)]">{title}</h3>
          {tag && <span className="rounded-full bg-[var(--ax-border-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ax-text-muted)]">{tag}</span>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

// 업로드(파싱 결과) 보관:
//  - 모듈 메모리(trendUpSession/trendJmSession): 라우트 이동 시 즉시 복원(동기).
//  - IndexedDB("salesTrend"): 하드 새로고침·탭 재방문에도 유지(콜드 스타트 시 복원).
// 비우기는 화면의 × 버튼으로 사용자가 직접 한다.
type TrendUp = { daily: M.ParseResult | null; monthly: M.ParseResult | null; annual: M.ParseResult | null };
type TrendJm = { daily: J.JmParse[]; monthly: J.JmParse[] };
let trendUpSession: TrendUp = { daily: null, monthly: null, annual: null };
let trendJmSession: TrendJm = { daily: [], monthly: [] };
let trendSessionLive = false; // 이 페이지 로드에서 모듈 메모리가 채워졌는지(콜드 스타트 판별용)
const TREND_CACHE_KEY = "salesTrend";

export function PanelSalesTrend() {
  const [data, setData] = useState<MarketData | null>(null);
  const [demo, setDemo] = useState(true);
  const [scope, setScope] = useState<"all" | "station" | "jeonmun">("all");
  const [station, setStation] = useState<string | null>(null);
  const [view, setView] = useState("dashboard");
  const [filterCat, setFilterCat] = useState("전체");
  const [predMonthly, setPredMonthly] = useState(false);
  const [predAnnual, setPredAnnual] = useState(false);
  const [nlResult, setNlResult] = useState<{ q: string; o: M.NLIntent; answer: string } | null>(null);
  const [up, setUp] = useState<{ daily: M.ParseResult | null; monthly: M.ParseResult | null; annual: M.ParseResult | null }>(() => trendUpSession);
  const [upErr, setUpErr] = useState("");
  const [jmUp, setJmUp] = useState<{ daily: J.JmParse[]; monthly: J.JmParse[] }>(() => trendJmSession);
  const [jmData, setJmData] = useState<J.JmData | null>(null);
  const [jmFilters, setJmFilters] = useState<J.JmFilters>({ bonbu: "전체", center: "전체", station: "전체" });
  const [jmDrill, setJmDrill] = useState<J.JmDrill>({ dae: null, jung: null, so: null });
  const [jmView, setJmView] = useState("jmdash");
  const [stnQuery, setStnQuery] = useState("");
  const [compareStations, setCompareStations] = useState<string[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [nlLoading, setNlLoading] = useState(false);
  const nlRef = useRef<HTMLInputElement>(null);
  const ready = useRef(false);

  // 콜드 스타트(하드 새로고침 등): 모듈 메모리가 비어 있으면 IndexedDB에서 첨부 복원.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!trendSessionLive) {
        const v = await cacheGet<{ up: TrendUp; jmUp: TrendJm }>(TREND_CACHE_KEY);
        if (alive && v) { trendUpSession = v.up; trendJmSession = v.jmUp; setUp(v.up); setJmUp(v.jmUp); }
        trendSessionLive = true;
      }
      if (alive) ready.current = true;
    })();
    return () => { alive = false; };
  }, []);

  // 업로드(파싱 결과) 변경 시 모듈 메모리 + IndexedDB에 영속(복원이 끝난 뒤에만 기록).
  useEffect(() => {
    if (!ready.current) return;
    trendUpSession = up; trendJmSession = jmUp; trendSessionLive = true;
    cacheSet(TREND_CACHE_KEY, { up, jmUp });
  }, [up, jmUp]);

  /* ---------- 업로드 화면 ---------- */
  const onFile = async (k: "daily" | "monthly" | "annual", file?: File) => {
    if (!file) return;
    setUpErr("");
    try {
      const r = await M.readExcelFile(file);
      if (r.ok && r.type === k) setUp((s) => ({ ...s, [k]: r }));
      else { setUp((s) => ({ ...s, [k]: null })); setUpErr((r.errors[0] || `${k} 위치에 맞지 않는 파일입니다.`) + " · 업무사이트 표준 양식만 분석할 수 있습니다."); }
    } catch { setUp((s) => ({ ...s, [k]: null })); setUpErr("파일을 읽을 수 없습니다. .xls / .xlsx 인지 확인해 주세요."); }
  };
  const onJmFile = async (kind: "daily" | "monthly", files: FileList | null) => {
    if (!files || !files.length) return;
    setUpErr("");
    const added: J.JmParse[] = [];
    for (const f of Array.from(files)) {
      try {
        const r = await J.readJeonmunFile(f);
        if (r.ok && r.type === (kind === "daily" ? "jmdaily" : "jmmonthly")) added.push(r);
        else setUpErr((r.errors[0] || "전문점 양식 검증 실패") + " (필터링 없이 전체 본부·센터 포함 양식만 가능)");
      } catch { setUpErr("전문점 파일을 읽을 수 없습니다."); }
    }
    if (added.length) setJmUp((s) => ({ ...s, [kind]: [...s[kind], ...added] }));
  };
  const start = () => {
    const built = M.buildFromUploads({ daily: up.daily ?? undefined, monthly: up.monthly ?? undefined, annual: up.annual ?? undefined });
    setData(built); setDemo(built.demo);
    setJmData(jmUp.daily.length || jmUp.monthly.length ? J.buildJmFromUploads(jmUp.daily, jmUp.monthly) : null);
    setScope("all"); setStation(null); setView("dashboard"); setNlResult(null);
  };
  const startDemo = () => { setData(M.genDemo()); setDemo(true); setJmData(null); setScope("all"); setStation(null); setView("dashboard"); setNlResult(null); };

  if (!data) {
    const slots: { k: "daily" | "monthly" | "annual"; n: string; d: string }[] = [
      { k: "daily", n: "일자별 데이터", d: "오늘 제외 최근 2개월 · 역·업종 포함" },
      { k: "monthly", n: "월별 데이터", d: "최근 5개년(회계연도) · 올해 누계" },
      { k: "annual", n: "연도별 데이터", d: "최근 5개년 · 올해 누계" },
    ];
    const anyUp = up.daily || up.monthly || up.annual;
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-[var(--ax-page)]">
        <div className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 flex-col overflow-y-auto px-6 py-6">
          <PanelHeader icon="trending_up" title="업종별 매출트렌드 분석" backHref="/panel/sales" />
          <div className="mx-auto w-full max-w-3xl">
            <p className="mb-5 text-center text-sm text-[var(--ax-text-muted)]">
              업무사이트에서 내려받은 <b>표준 엑셀 3종</b>을 올리면 업종·기간·역별 매출 흐름을 분석합니다.
              <br />파일은 서버로 전송되지 않고 <b>브라우저에서만</b> 분석됩니다(폐쇄망 사용 가능).
            </p>
            <div className="mb-5 text-center">
              <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] px-4 py-2 text-xs font-bold text-[var(--ax-accent)] hover:bg-[var(--ax-accent-soft)]"><span className="material-symbols-outlined text-[16px]">download</span>파일 다운로드 가이드 — 업무사이트에서 어떻게 받나요?</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {slots.map((s) => {
                const r = up[s.k];
                return (
                  <label key={s.k} className={`relative flex cursor-pointer flex-col gap-1 rounded-[var(--ax-radius-lg)] border-2 border-dashed p-4 text-center transition ${r ? "border-[var(--ax-accent)] bg-[var(--ax-accent-bg)]" : "border-[var(--ax-border)] hover:border-[var(--ax-accent-border)]"}`}>
                    {r && (
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setUp((prev) => ({ ...prev, [s.k]: null })); setUpErr(""); }} aria-label={`${s.n} 첨부 삭제`} className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ax-danger)] text-[13px] leading-none text-white hover:opacity-80">×</button>
                    )}
                    <span className="material-symbols-outlined text-[26px] text-[var(--ax-accent)]">{r ? "task" : "upload_file"}</span>
                    <span className="text-sm font-bold text-[var(--ax-text)]">{s.n}</span>
                    <span className="text-[11px] text-[var(--ax-text-hint)]">{s.d}</span>
                    <span className={`mt-1 text-[11px] font-semibold ${r ? "text-[var(--ax-success)]" : "text-[var(--ax-text-muted)]"}`}>
                      {r ? `✓ ${r.empty ? "구조 정상(양식)" : `${(r.records?.length ?? 0).toLocaleString()}건`}` : "파일 선택"}
                    </span>
                    <input type="file" accept=".xls,.xlsx" className="hidden" onChange={(e) => onFile(s.k, e.target.files?.[0])} />
                  </label>
                );
              })}
            </div>
            <div className="mt-5 text-xs font-bold text-[var(--ax-text-muted)]">② 전문점 세부분류 매출실적 <span className="font-semibold text-[var(--ax-text-hint)]">(전문점 분석 · 대/중/소분류) — 같은 유형 여러 개 업로드 가능(기간 합산)</span></div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {([["daily", "전문점 일자별", "최대 31일/파일 · 여러 개 합산"], ["monthly", "전문점 월별", "최대 12개월/파일 · 연간은 3개"]] as ["daily" | "monthly", string, string][]).map(([k, n, d]) => {
                const cnt = [...new Set(jmUp[k].flatMap((u) => u.records.map((r) => (k === "daily" ? r.date : r.yyyymm))))].length;
                return (
                  <label key={k} className={`relative flex cursor-pointer flex-col gap-1 rounded-[var(--ax-radius-lg)] border-2 border-dashed p-4 text-center transition ${jmUp[k].length ? "border-[var(--ax-accent)] bg-[var(--ax-accent-bg)]" : "border-[var(--ax-border)] hover:border-[var(--ax-accent-border)]"}`}>
                    {jmUp[k].length > 0 && (
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setJmUp((prev) => ({ ...prev, [k]: [] })); setUpErr(""); }} aria-label={`${n} 첨부 전체 삭제`} className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ax-danger)] text-[13px] leading-none text-white hover:opacity-80">×</button>
                    )}
                    <span className="material-symbols-outlined text-[26px] text-[var(--ax-accent)]">{jmUp[k].length ? "task" : "calendar_month"}</span>
                    <span className="text-sm font-bold text-[var(--ax-text)]">{n}</span>
                    <span className="text-[11px] text-[var(--ax-text-hint)]">{d}</span>
                    <span className={`mt-1 text-[11px] font-semibold ${jmUp[k].length ? "text-[var(--ax-success)]" : "text-[var(--ax-text-muted)]"}`}>{jmUp[k].length ? `✓ ${jmUp[k].length}개 파일 · 누적 ${cnt}${k === "daily" ? "일" : "개월"}` : "파일 선택(다중 가능)"}</span>
                    <input type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(e) => onJmFile(k, e.target.files)} />
                  </label>
                );
              })}
            </div>
            {upErr && <div className="mt-3 rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-4 py-3 text-sm text-[var(--ax-danger)]">⚠️ {upErr}</div>}
            <div className="mt-5 flex items-center justify-center gap-2">
              <button type="button" onClick={startDemo} className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] px-5 py-2.5 text-sm font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">데모 데이터로 미리보기</button>
              <button type="button" onClick={start} disabled={!anyUp} className="rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-6 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">분석 시작하기 →</button>
            </div>
            <p className="mt-4 text-center text-[11px] text-[var(--ax-text-hint)]">🔒 업로드 데이터는 외부로 전송되지 않습니다 · 자연어 검색도 내부 데이터 기반으로만 동작</p>
            {guideOpen && <GuideOverlay onClose={() => setGuideOpen(false)} />}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 앱 ---------- */
  const ctx: Ctx = { data, scope: scope === "jeonmun" ? "all" : scope, station };
  const activeCats = (): string[] => CAT.filter((c) => M.catShareCurrent(ctx).some((x) => x.cat === c));
  const filteredCats = (): string[] => (filterCat === "전체" ? activeCats() : [filterCat].filter((c) => activeCats().includes(c)));
  const scopeLab = scope === "station" ? `${station}역` : "전체";

  const applyIntent = (o: M.NLIntent, q: string, answer: string) => {
    if (o.stations.length >= 2) {
      setScope("station"); setStation(o.stations[0]); setCompareStations(o.stations);
      if (o.cat) setFilterCat(o.cat);
      setNlResult({ q, o, answer: answer || `${o.stations.join(" · ")} ${o.stations.length}개 역을 비교합니다.${o.cat ? ` (업종: ${o.cat})` : ""}` });
      setView("stncompare"); return;
    }
    const ns: "all" | "station" = o.station ? "station" : "all";
    setScope(ns); setStation(o.station); setFilterCat(o.cat || "전체");
    setNlResult({ q, o, answer: answer || M.nlAnswer({ data, scope: ns, station: o.station }, o) });
    setView(o.period === "daily" ? "daily" : o.period === "month" ? "monthly" : o.metric === "share" ? "dashboard" : o.compare ? "compare" : "annual");
  };
  // 자연어 검색: LLM(가드레일 경유)으로 의도 파싱+근거 답변, 실패 시 규칙 파서 폴백.
  const runNL = async (q: string) => {
    if (!q.trim() || nlLoading) return;
    setNlLoading(true);
    try {
      const res = await fetch("/api/sales/trend-nl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, context: M.buildNlContext(data, M.parseNL(q).stations) }) });
      const d = await res.json();
      if (d.ok && d.intent) { applyIntent(d.intent as M.NLIntent, q, typeof d.answer === "string" ? d.answer : ""); return; }
      throw new Error("fallback");
    } catch {
      const o = M.parseNL(q);
      applyIntent(o, q, M.nlAnswer({ data, scope: o.station ? "station" : "all", station: o.station }, o));
    } finally {
      setNlLoading(false);
    }
  };
  const selectStation = (s: string) => { setStation(s); setScope("station"); setView("dashboard"); setStnQuery(""); };

  const NAV = scope === "station" ? STN_NAV : ALL_NAV;
  const effView = scope === "station" && !station && view !== "stnsearch" && view !== "stncompare" ? "stnsearch" : view;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--ax-page)]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col px-6 pt-6">
        <PanelHeader
          icon="trending_up"
          title="업종별 매출트렌드 분석"
          backHref="/panel/sales"
          right={
            <div className="flex items-center gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-[var(--ax-radius-sm)] bg-[var(--ax-accent)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--ax-accent-dark)]"><span className="material-symbols-outlined text-[15px]">print</span>인쇄·PDF</button>
              <button type="button" onClick={() => { setData(null); setUp({ daily: null, monthly: null, annual: null }); setJmUp({ daily: [], monthly: [] }); setJmData(null); }} className="rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] px-3 py-1.5 text-xs font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">새 파일 업로드</button>
            </div>
          }
        />


        {/* scope 토글 + NL 검색 */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-[var(--ax-border)] bg-[var(--ax-card)] p-1">
            {([["all", "전체 분석"], ["station", "역별 분석"], ["jeonmun", "전문점 분석"]] as [string, string][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { const sc = k as "all" | "station" | "jeonmun"; if (sc === "jeonmun" && !jmData) setJmData(J.genJmDemo()); setScope(sc); setNlResult(null); if (sc !== "jeonmun") setView(sc === "station" ? (station ? "dashboard" : "stnsearch") : "dashboard"); }}
                className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${scope === k ? "bg-[var(--ax-accent)] text-white" : "text-[var(--ax-text-muted)]"}`}>{l}</button>
            ))}
          </div>
          <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-full border border-[var(--ax-border)] bg-[var(--ax-card)] px-4 py-1.5">
            <span className="material-symbols-outlined text-[18px] text-[var(--ax-text-hint)]">search</span>
            <input ref={nlRef} defaultValue="" placeholder="자연어로 검색 (예: 서울역 업종별 매출 비중)" onKeyDown={(e) => { if (e.key === "Enter") runNL((e.target as HTMLInputElement).value); }}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ax-text-hint)]" />
            <button type="button" onClick={() => runNL(nlRef.current?.value ?? "")} disabled={nlLoading} className="rounded-full bg-[var(--ax-accent)] px-3 py-1 text-xs font-bold text-white disabled:opacity-60">{nlLoading ? "검색 중…" : "검색"}</button>
          </div>
          {/* 선택된 역 표시 + 역 변경(검수: 역이 바뀌지 않는 문제 — 변경 진입점 명시) */}
          {scope === "station" && station && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ax-accent-bg)] px-3 py-1.5 text-xs font-bold text-[var(--ax-accent)] ring-1 ring-[var(--ax-accent-border)]">
              <span className="material-symbols-outlined text-[15px]">location_on</span>{station}역
              <button type="button" onClick={() => { setStation(null); setView("stnsearch"); setNlResult(null); }} className="ml-1 rounded-full bg-white/70 px-2 py-0.5 font-bold text-[var(--ax-accent)] hover:bg-white">역 변경</button>
            </div>
          )}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CHIPS.map((q) => <button key={q} type="button" onClick={() => { if (nlRef.current) nlRef.current.value = q; runNL(q); }} className="rounded-full border border-[var(--ax-border)] bg-[var(--ax-card)] px-3 py-1 text-xs text-[var(--ax-text-muted)] hover:border-[var(--ax-accent-border)] hover:text-[var(--ax-accent)]">{q}</button>)}
        </div>

        {scope === "jeonmun" ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
            {jmData?.demo && <div className="rounded-[var(--ax-radius)] border border-[var(--ax-warning)]/30 bg-[var(--ax-warning-bg)] px-4 py-2 text-xs font-semibold text-[var(--ax-warning)]">데모 데이터 표시 중 — 전문점 엑셀을 업로드하면 실데이터로 분석됩니다.</div>}
            <JeonmunPanel data={jmData ?? J.genJmDemo()} filters={jmFilters} setFilters={setJmFilters} drill={jmDrill} setDrill={setJmDrill} view={jmView} setView={setJmView} />
          </div>
        ) : (
          <>
            {/* 서브내비 */}
            <div className="mb-1 flex flex-wrap gap-1 border-b border-[var(--ax-border)]">
              {NAV.map(([k, l]) => (
                <button key={k} type="button" onClick={() => setView(k)} className={`border-b-2 px-3.5 py-2 text-sm font-bold transition ${effView === k ? "border-[var(--ax-accent)] text-[var(--ax-accent)]" : "border-transparent text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"}`}>{l}</button>
              ))}
            </div>
            {/* 본문 (스크롤) */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
              {demo && <div className="rounded-[var(--ax-radius)] border border-[var(--ax-warning)]/30 bg-[var(--ax-warning-bg)] px-4 py-2 text-xs font-semibold text-[var(--ax-warning)]">데모 데이터 표시 중 — 실제 엑셀을 업로드하면 실데이터로 분석됩니다.</div>}
              {nlResult && effView !== "stnsearch" && <NlCard r={nlResult} />}
              {effView === "stnsearch" ? <StationSearch query={stnQuery} setQuery={setStnQuery} onSelect={selectStation} />
                : effView === "stncompare" ? <StationCompare data={data} stations={compareStations} setStations={setCompareStations} />
                : effView === "dashboard" ? <Dashboard ctx={ctx} scopeLab={scopeLab} activeCats={activeCats} />
                : effView === "daily" ? <DailyView ctx={ctx} filteredCats={filteredCats} filterBar={<FilterBar v={filterCat} set={setFilterCat} cats={activeCats()} />} />
                : effView === "monthly" ? <MonthlyView ctx={ctx} filteredCats={filteredCats} filterBar={<FilterBar v={filterCat} set={setFilterCat} cats={activeCats()} />} pred={predMonthly} setPred={setPredMonthly} />
                : effView === "annual" ? <AnnualView ctx={ctx} filteredCats={filteredCats} filterBar={<FilterBar v={filterCat} set={setFilterCat} cats={activeCats()} />} pred={predAnnual} setPred={setPredAnnual} />
                : effView === "compare" ? <CompareView ctx={ctx} filteredCats={filteredCats} filterBar={<FilterBar v={filterCat} set={setFilterCat} cats={activeCats()} />} />
                : <CatCompareView ctx={ctx} activeCats={activeCats} scopeLab={scopeLab} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- 필터 바 ---------- */
/** 업종 드롭다운 — 현재 분석 범위에 매출 데이터가 있는 업종만 노출(데이터 0 업종 자동 숨김). */
function FilterBar({ v, set, cats }: { v: string; set: (s: string) => void; cats: string[] }) {
  const list: string[] = CAT.filter((c) => cats.includes(c));
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-[var(--ax-text-muted)]">업종</span>
      <select value={list.includes(v) ? v : "전체"} onChange={(e) => set(e.target.value)} className="rounded-md border border-[var(--ax-border)] bg-white px-2 py-1 text-sm text-[var(--ax-text)] outline-none">
        <option>전체</option>
        {list.map((c) => <option key={c}>{c}</option>)}
      </select>
    </div>
  );
}

/* ---------- NL 결과 ---------- */
function NlCard({ r }: { r: { q: string; o: M.NLIntent; answer: string } }) {
  const pills: string[] = [];
  pills.push(r.o.station ? `역: ${r.o.station}` : "기준: 전체");
  if (r.o.cat) pills.push(`업종: ${r.o.cat}`);
  if (r.o.years) pills.push(`최근 ${r.o.years}년`);
  if (r.o.period) pills.push(`단위: ${({ daily: "일자별", month: "월별", year: "연간" } as Record<string, string>)[r.o.period] || r.o.period}`);
  if (r.o.compare) pills.push("전년 대비");
  return (
    <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] p-4">
      <div className="text-xs font-bold text-[var(--ax-text-muted)]">질문</div>
      <div className="text-sm font-semibold text-[var(--ax-text)]">{r.q}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{pills.map((p) => <span key={p} className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-[var(--ax-accent)] ring-1 ring-[var(--ax-accent-border)]">{p}</span>)}</div>
      <div className="mt-2.5 text-sm leading-relaxed text-[var(--ax-text)]" dangerouslySetInnerHTML={{ __html: r.answer }} />
    </div>
  );
}

/* ---------- KPI ---------- */
function KpiStrip({ ctx, scopeLab }: { ctx: Ctx; scopeLab: string }) {
  const total = M.totalAnnual(ctx, CUR_YEAR);
  const prev = M.totalAnnual(ctx, CUR_YEAR - 1) * M.YEAR_PROGRESS;
  const g = prev > 0 ? ((total - prev) / prev) * 100 : 0;
  const grow = M.catGrowth(ctx).sort((a, b) => b.g - a.g);
  const topSales = M.catShareCurrent(ctx)[0];
  const up = grow[0], down = grow[grow.length - 1];
  const items = [
    { l: "총매출(올해 누계)", v: WON(total), note: `${YEARS[0]}~${CUR_YEAR} · ${BASE_DATE}` },
    { l: "전년 동기간 대비", v: PCT(g), cls: g >= 0 ? "text-[var(--ax-danger)]" : "text-[var(--ax-accent)]" },
    { l: "최대 매출 업종", v: topSales ? topSales.cat : "-", note: topSales ? WON(topSales.val) : "" },
    { l: "최고 성장 업종", v: up ? up.cat : "-", note: up ? PCT(up.g) : "" },
    { l: "최대 감소 업종", v: down && down.g < 0 ? down.cat : "-", note: down && down.g < 0 ? PCT(down.g) : "" },
    { l: "분석 대상", v: scopeLab, note: ctx.scope === "station" ? STATIONS.find((x) => x.s === ctx.station)?.hq || "" : `${STATIONS.length}개 역` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((k) => (
        <div key={k.l} className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3">
          <div className="text-[11px] text-[var(--ax-text-muted)]">{k.l}</div>
          <div className={`mt-0.5 text-lg font-black ${k.cls || "text-[var(--ax-text)]"}`}>{k.v}</div>
          {k.note && <div className="text-[10px] text-[var(--ax-text-hint)]">{k.note}</div>}
        </div>
      ))}
    </div>
  );
}

function RankList({ ctx, mode }: { ctx: Ctx; mode: "growth" | "size" }) {
  const arr = mode === "growth"
    ? M.catGrowth(ctx).sort((a, b) => b.g - a.g).map((x) => ({ nm: x.cat, val: x.cur, d: x.g as number | null }))
    : M.catShareCurrent(ctx).map((x) => ({ nm: x.cat, val: x.val, d: null as number | null }));
  const max = Math.max(...arr.map((a) => a.val), 1);
  return (
    <div className="space-y-2">
      {arr.map((a, i) => (
        <div key={a.nm} className="flex items-center gap-2 text-sm">
          <span className={`w-5 text-center text-xs font-black ${i === 0 ? "text-[var(--ax-accent)]" : "text-[var(--ax-text-hint)]"}`}>{i + 1}</span>
          <span className="w-16 shrink-0 font-semibold text-[var(--ax-text)]">{a.nm}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ax-border-soft)]"><div className="h-full rounded-full" style={{ width: `${(a.val / max) * 100}%`, background: CAT_COLOR[a.nm] }} /></div>
          <span className="w-16 text-right text-xs font-bold text-[var(--ax-text)]">{WON(a.val)}</span>
          {a.d != null && <span className={`w-14 text-right text-xs font-bold ${a.d > 1 ? "text-[var(--ax-danger)]" : a.d < -1 ? "text-[var(--ax-accent)]" : "text-[var(--ax-text-hint)]"}`}>{PCT(a.d)}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---------- 차트 헬퍼 ---------- */
const lineDs = (acts: string[], dataFn: (c: string) => number[], opts: Record<string, unknown> = {}) =>
  acts.map((c) => ({ label: c, data: dataFn(c), borderColor: CAT_COLOR[c], backgroundColor: CAT_COLOR[c] + "18", tension: 0.32, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: false, ...opts }));

/* ---------- 대시보드 ---------- */
function Dashboard({ ctx, scopeLab, activeCats }: { ctx: Ctx; scopeLab: string; activeCats: () => string[] }) {
  const ac = activeCats();
  const share = M.catShareCurrent(ctx);
  const shareTot = share.reduce((a, b) => a + b.val, 0);
  const bc = M.dailyByCat(ctx, CUR_YEAR);
  const dates = (ctx.data.dates || []).slice();
  const mc = M.monthlyByCat(ctx, FY_LABELS[0]);
  const ann = M.annualByCat(ctx);
  const ins = M.buildInsights(ctx);
  return (
    <>
      <div>
        <h2 className="text-lg font-extrabold text-[var(--ax-text)]">{scopeLab} 매출 트렌드 대시보드</h2>
        <p className="text-xs text-[var(--ax-text-muted)]">업종별 거시 흐름 · 분석기준 {YEARS[0]}–{CUR_YEAR}</p>
      </div>
      <KpiStrip ctx={ctx} scopeLab={scopeLab} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="업종별 매출 비중" tag="올해 누계">
          <MarketChart className="h-[240px]" config={{ type: "doughnut", data: { labels: share.map((x) => x.cat), datasets: [{ data: share.map((x) => x.val), backgroundColor: share.map((x) => CAT_COLOR[x.cat]), borderWidth: 2, borderColor: "#fff" }] }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.label}: ${WON(c.raw ?? 0)} (${(((c.raw ?? 0) / shareTot) * 100).toFixed(1)}%)`) }, cutout: "58%" } }} />
        </Card>
        <Card title="📌 자동 분석 요약" tag="계산 결과 기반">
          <ul className="space-y-2 text-sm">
            {ins.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${x.t === "u" ? "bg-[var(--ax-danger)]" : x.t === "d" ? "bg-[var(--ax-accent)]" : "bg-[var(--ax-text-hint)]"}`}>{x.t === "u" ? "↑" : x.t === "d" ? "↓" : "i"}</span>
                <span className="leading-relaxed text-[var(--ax-text)]" dangerouslySetInnerHTML={{ __html: x.h }} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="일자별 매출 추이" tag="최근 2개월 · 업종별">
        <MarketChart config={{ type: "line", data: { labels: dates.map((d) => d.slice(5)), datasets: lineDs(ac, (c) => dates.map((d) => bc[c]?.[d] || 0)) }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="월별 매출 추이" tag="회계연도 7~6월">
          <MarketChart config={{ type: "line", data: { labels: FISCAL_MONTHS, datasets: lineDs(ac, (c) => FISCAL_MONTHS.map((m) => mc[c]?.[m] || 0), { pointRadius: 2 }) }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
        </Card>
        <Card title="연간 매출 추이" tag="최근 5개년">
          <MarketChart config={{ type: "bar", data: { labels: YEARS, datasets: ac.map((c) => ({ label: c, data: YEARS.map((y) => ann[c]?.[y] || 0), backgroundColor: CAT_COLOR[c], borderRadius: 5, maxBarThickness: 30 })) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="업종별 증감 순위 (전년 동기간 대비)"><RankList ctx={ctx} mode="growth" /></Card>
        <Card title="업종별 매출 규모 순위"><RankList ctx={ctx} mode="size" /></Card>
      </div>
      <ConnectCard />
    </>
  );
}

/* ---------- 연계 분석 안내 ---------- */
const CONNECT_LINKS = [
  { href: "/panel/sales/compare", icon: "storefront", color: "#2563eb", title: "편의점 매출 비교분석", desc: "특정 매장 매출 엑셀로 KPI·ABC·벤치마킹·AI 진단" },
  { href: "/panel/magazine", icon: "article", color: "#1e40af", title: "AI 리서치매거진", desc: "시장·트렌드 심층 리서치가 필요하면 의뢰하기" },
];

function ConnectCard() {
  return (
    <Card title="🔗 연계 분석 안내">
      <div className="grid gap-3 sm:grid-cols-2">
        {CONNECT_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group flex items-center gap-3 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-page)] p-3.5 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${l.color}16` }}>
              <span className="material-symbols-outlined leading-none" style={{ fontSize: 24, color: l.color }}>{l.icon}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-[var(--ax-text)]">{l.title}</span>
              <span className="block text-xs leading-snug text-[var(--ax-text-muted)]">{l.desc}</span>
            </span>
            <span className="material-symbols-outlined leading-none transition group-hover:translate-x-1" style={{ fontSize: 20, color: l.color }}>arrow_forward</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/* ---------- 일자별 ---------- */
function DailyView({ ctx, filteredCats, filterBar }: { ctx: Ctx; filteredCats: () => string[]; filterBar: ReactNode }) {
  const ac = filteredCats();
  const bc = M.dailyByCat(ctx, CUR_YEAR);
  const dates = (ctx.data.dates || []).slice();
  const dow = ["일", "월", "화", "수", "목", "금", "토"];
  const sums = Array(7).fill(0), cnts = Array(7).fill(0);
  dates.forEach((d) => { const w = new Date(d).getDay(); sums[w] += ac.reduce((a, c) => a + (bc[c]?.[d] || 0), 0); cnts[w]++; });
  const recent = dates.slice(-14).reverse();
  return (
    <>
      {filterBar}
      <Card title="일자별 매출 추이" tag="선택 업종">
        <MarketChart config={{ type: "line", data: { labels: dates.map((d) => d.slice(5)), datasets: lineDs(ac, (c) => dates.map((d) => bc[c]?.[d] || 0), { fill: ac.length === 1 }) }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      <Card title="요일별 평균 매출 패턴" tag="전체 기간 평균">
        <MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: dow, datasets: [{ label: "평균 매출", data: sums.map((s, i) => (cnts[i] ? s / cnts[i] : 0)), backgroundColor: dow.map((_, i) => (i === 0 || i === 6 ? "#D86A2C" : "#1F5FBF")), borderRadius: 5, maxBarThickness: 46 }] }, options: { plugins: { legend: { display: false }, tooltip: tip((c) => " " + WON(c.raw ?? 0)) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      <Card title="일자별 상세 (최근 14일)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[var(--ax-border)] text-[var(--ax-text-muted)]"><th className="py-1.5 text-left">일자</th><th>요일</th>{ac.map((c) => <th key={c} className="text-right">{c}</th>)}<th className="text-right">합계</th></tr></thead>
            <tbody>
              {recent.map((d) => { const tot = ac.reduce((a, c) => a + (bc[c]?.[d] || 0), 0); return (
                <tr key={d} className="border-b border-[var(--ax-border-soft)]"><td className="py-1.5">{d}</td><td className="text-center">{dow[new Date(d).getDay()]}</td>{ac.map((c) => <td key={c} className="text-right">{WON(bc[c]?.[d] || 0)}</td>)}<td className="text-right font-bold">{WON(tot)}</td></tr>
              ); })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ---------- 예측 토글/카드 ---------- */
function PredictToggle({ on, set, label, note }: { on: boolean; set: (b: boolean) => void; label: string; note: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] px-4 py-2.5">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-[var(--ax-accent)]" />
      <span><span className="text-sm font-bold text-[var(--ax-text)]">{label} </span><span className="rounded bg-[var(--ax-warning-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ax-warning)]">참고용</span><span className="block text-[11px] text-[var(--ax-text-hint)]">{note}</span></span>
    </label>
  );
}
function Disclaimer() { return <div className="rounded-[var(--ax-radius)] border border-[var(--ax-warning)]/30 bg-[var(--ax-warning-bg)] px-4 py-2.5 text-xs leading-relaxed text-[var(--ax-warning)]">본 예측은 과거 데이터 기반 <b>참고용 추정치</b>입니다. 실제 매출을 보장하지 않으며 보조자료로만 활용해 주세요.</div>; }
function PredictCard({ rows, kind }: { rows: M.PredictRow[]; kind: "month" | "year" }) {
  if (rows.length === 0) {
    return (
      <Card title={`📈 ${kind === "month" ? "당월(06월) 업종별 예상 매출" : "올해 업종별 예상 연매출"}`} tag="참고용">
        <div className="flex flex-col items-center gap-1.5 py-7 text-center">
          <span className="material-symbols-outlined text-[32px] text-[var(--ax-text-hint)]">query_stats</span>
          <p className="text-sm font-bold text-[var(--ax-text)]">예측에 필요한 실적 데이터가 부족합니다</p>
          <p className="text-xs leading-relaxed text-[var(--ax-text-muted)]">{kind === "month" ? "당월 또는 과거 동월" : "올해 누계 또는 과거 연도"} 매출이 있어야 추정할 수 있습니다. 해당 기간 엑셀을 업로드해 주세요.</p>
        </div>
      </Card>
    );
  }
  const cfg = { type: "bar", data: { labels: rows.map((d) => d.cat), datasets: [
    { label: "실적", data: rows.map((d) => d.actual), backgroundColor: "#1F5FBF", borderRadius: 4, maxBarThickness: 34, stack: "s" },
    { label: "잔여기간 추정", data: rows.map((d) => d.rem), backgroundColor: "#E0A41E", borderRadius: 4, maxBarThickness: 34, stack: "s" }] },
    options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: { ...FMT_Y, stacked: true }, x: { ...FMT_X, stacked: true } } } };
  return (
    <Card title={`📈 ${kind === "month" ? "당월(06월) 업종별 예상 매출" : "올해 업종별 예상 연매출"}`} tag="참고용 · 실적+잔여 추정">
      <MarketChart className="h-[240px]" config={cfg} />
      <div className="mt-3 overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="border-b border-[var(--ax-border)] text-[var(--ax-text-muted)]"><th className="py-1.5 text-left">업종</th><th className="text-right">{kind === "month" ? "현재까지 실적" : "올해 누계"}</th><th className="text-right">잔여 추정</th><th className="text-right">예측 합계</th><th className="text-right">{kind === "month" ? "5년 동월 평균" : "3년 평균"}</th><th className="text-right">전년 대비</th></tr></thead>
        <tbody>{rows.map((d) => <tr key={d.cat} className="border-b border-[var(--ax-border-soft)]"><td className="py-1.5 font-semibold">{d.cat}</td><td className="text-right">{WON(d.actual)}</td><td className="text-right text-[var(--ax-warning)]">+{W(d.rem)}</td><td className="text-right font-bold">{WON(d.pred)}</td><td className="text-right">{WON(d.avg5)}</td><td className={`text-right font-bold ${d.g >= 0 ? "text-[var(--ax-danger)]" : "text-[var(--ax-accent)]"}`}>{PCT(d.g)}</td></tr>)}</tbody>
      </table></div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--ax-text-hint)]">
        산출 근거 — {kind === "month"
          ? "최근 5개년 동월 일평균 매출에 올해 당월 경과 페이스를 경과일수만큼 가중 블렌딩해 잔여일을 추정(실적 + 잔여추정 = 예측 합계)."
          : "최근 3개년 월별 추이·구성비와 올해 누계 경과율을 가중해 연매출을 역산(올해 누계 + 잔여 추정 = 예측 합계)."} 표의 5개년/3년 평균·전년 대비로 타당성을 함께 확인하세요.
      </p>
    </Card>
  );
}

/* ---------- 역간 비교 ---------- */
function StationCompare({ data, stations, setStations }: { data: MarketData; stations: string[]; setStations: (s: string[]) => void }) {
  const [q, setQ] = useState("");
  const colors = ["#1F5FBF", "#16A085", "#E0A41E", "#8E5BD6", "#D86A2C", "#C0392B", "#2C82C9", "#27AE60"];
  const hits = q.trim() ? [...new Set(STATIONS.filter((x) => x.s.includes(q.trim())).map((x) => x.s))].filter((s) => !stations.includes(s)).slice(0, 20) : [];
  const add = (s: string) => { if (!stations.includes(s)) setStations([...stations, s]); setQ(""); };
  const rows = stations.map((s) => { const cur = M.stnSum(data, s, (r) => r.year === CUR_YEAR); const prevSame = M.stnSum(data, s, (r) => r.year === CUR_YEAR - 1) * M.YEAR_PROGRESS; return { s, cur, prevSame, g: prevSame > 0 ? ((cur - prevSame) / prevSame) * 100 : 0, top: M.topCatOf(data, s) }; }).sort((a, b) => b.cur - a.cur);
  const cats = CAT.filter((cat) => stations.some((s) => M.stnSum(data, s, (r) => r.year === CUR_YEAR && r.cat === cat) > 0));
  const lineDsS = stations.map((s, i) => { const bc: Record<string, number> = {}; (data.monthly || []).filter((r) => r.station === s && r.fy === FY_LABELS[0]).forEach((r) => (bc[r.month] = (bc[r.month] || 0) + r.sales)); return { label: s, data: FISCAL_MONTHS.map((m) => bc[m] || 0), borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length] + "12", tension: 0.3, borderWidth: 2.4, pointRadius: 2 }; });
  const compDs = stations.map((s, i) => ({ label: s, data: cats.map((cat) => M.stnSum(data, s, (r) => r.year === CUR_YEAR && r.cat === cat)), backgroundColor: colors[i % colors.length], borderRadius: 4, maxBarThickness: 22 }));
  return (
    <>
      <Card title="비교할 역 선택" tag="2개 이상">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) add(hits[0]); }} placeholder="역명 입력 후 Enter (예: 서울, 부산, 대전)" className="w-full rounded-[var(--ax-radius)] border border-[var(--ax-border)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)]" />
        {hits.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{hits.map((s) => <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-[var(--ax-border)] px-3 py-1 text-xs font-semibold text-[var(--ax-text-muted)] hover:border-[var(--ax-accent-border)] hover:text-[var(--ax-accent)]">+ {s}</button>)}</div>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stations.length ? stations.map((s) => <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ax-accent-bg)] px-3 py-1 text-xs font-bold text-[var(--ax-accent)] ring-1 ring-[var(--ax-accent-border)]">{s}<button type="button" onClick={() => setStations(stations.filter((x) => x !== s))} className="text-[var(--ax-danger)]">×</button></span>) : <span className="text-xs text-[var(--ax-text-hint)]">아직 선택된 역이 없습니다.</span>}
        </div>
      </Card>
      {stations.length >= 2 ? (
        <>
          <Card title="역별 월간 매출 추이 비교" tag="현재 회계연도 합계"><MarketChart config={{ type: "line", data: { labels: FISCAL_MONTHS, datasets: lineDsS }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="역별 업종 구성 비교" tag="올해 누계"><MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: cats, datasets: compDs }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
            <Card title="역별 올해 누계 매출" tag="순위"><MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: rows.map((x) => x.s), datasets: [{ label: "올해 누계", data: rows.map((x) => x.cur), backgroundColor: rows.map((_, i) => colors[i % colors.length]), borderRadius: 5, maxBarThickness: 40 }] }, options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: tip((c) => " " + WON(c.raw ?? 0)) }, scales: { x: FMT_Y, y: FMT_X } } }} /></Card>
          </div>
          <Card title="역별 전년 동기간 대비 증감">
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-[var(--ax-border)] text-[var(--ax-text-muted)]"><th className="py-1.5 text-left">순위</th><th className="text-left">역명</th><th className="text-right">올해 누계</th><th className="text-right">전년 동기간</th><th className="text-right">증감률</th><th className="text-left">주력 업종</th></tr></thead><tbody>{rows.map((x, i) => <tr key={x.s} className="border-b border-[var(--ax-border-soft)]"><td className="py-1.5">{i + 1}</td><td className="font-semibold">{x.s}</td><td className="text-right">{WON(x.cur)}</td><td className="text-right">{WON(x.prevSame)}</td><td className={`text-right font-bold ${x.g > 1 ? "text-[var(--ax-danger)]" : x.g < -1 ? "text-[var(--ax-accent)]" : "text-[var(--ax-text-hint)]"}`}>{PCT(x.g)}</td><td>{x.top || "-"}</td></tr>)}</tbody></table></div>
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--ax-radius-lg)] border border-dashed border-[var(--ax-border)] bg-[var(--ax-card)] p-10 text-center">
          <span className="material-symbols-outlined text-[40px] text-[var(--ax-text-hint)]">bar_chart</span>
          <h3 className="text-sm font-bold text-[var(--ax-text)]">역을 2개 이상 선택해 주세요</h3>
          <p className="text-xs leading-relaxed text-[var(--ax-text-muted)]">기간별 추이·업종 구성·증감을 나란히 비교합니다. 자연어로 &quot;서울역과 부산역 매출 비교해줘&quot;도 됩니다.</p>
        </div>
      )}
    </>
  );
}

/* ---------- 예측 산출 근거 모달 ---------- */
function PredictBasisModal({ title, rows, onClose }: { title: string; rows: M.PredictRow[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--ax-border)] px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-[var(--ax-text)]"><span className="material-symbols-outlined text-[18px] text-[var(--ax-accent)]">calculate</span>예측 산출 근거 — {title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[var(--ax-text-hint)] hover:bg-[var(--ax-border-soft)]"><span className="material-symbols-outlined text-[20px]">close</span></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {rows.map((r) => (
            <div key={r.cat} className="rounded-[var(--ax-radius)] border border-[var(--ax-border-soft)] p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold" style={{ color: CAT_COLOR[r.cat] || "var(--ax-text)" }}>{r.cat}</span>
                <span className="text-sm font-extrabold text-[var(--ax-accent)]">{WON(r.pred)}</span>
              </div>
              {r.basis ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold text-[var(--ax-text-muted)]">{r.basis.method}</p>
                  <div className="space-y-1.5">
                    {r.basis.lines.map((ln, i) => (
                      <div key={i} className="leading-snug">
                        <div className="text-[12px] text-[var(--ax-text)]">{ln.ko}</div>
                        <div className="pl-2 font-mono text-[11px] text-[var(--ax-accent)]">{ln.num}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-[var(--ax-text-hint)]">산출 근거 정보가 없습니다.</p>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--ax-border)] px-5 py-2.5 text-[11px] leading-relaxed text-[var(--ax-text-hint)]">
          ※ 본 예측은 과거 데이터 기반 <b>참고용 추정치</b>입니다. 금액은 표시 단위(억/만)로 반올림되어 합이 미세하게 다를 수 있습니다.
        </div>
      </div>
    </div>
  );
}

/* ---------- 월별 ---------- */
function MonthlyView({ ctx, filteredCats, filterBar, pred, setPred }: { ctx: Ctx; filteredCats: () => string[]; filterBar: ReactNode; pred: boolean; setPred: (b: boolean) => void }) {
  const ac = filteredCats();
  const bc = M.monthlyByCat(ctx, FY_LABELS[0]), pc = M.monthlyByCat(ctx, FY_LABELS[1]);
  // 예측 ON: 당월(현재 월)의 값을 '부분 실적 + 잔여 추정'으로 올려 라인이 최종 예측치까지 오르게 한다.
  const curMonth = String(new Date(BASE_DATE).getMonth() + 1).padStart(2, "0") + "월";
  const [basisRows, setBasisRows] = useState<M.PredictRow[] | null>(null);
  const pmRows = pred ? M.predictMonth(ctx) : [];
  const remMap: Record<string, number> = {};
  pmRows.forEach((r) => { remMap[r.cat] = r.rem; });
  const mVal = (c: string, m: string) => (bc[c]?.[m] || 0) + (pred && m === curMonth ? (remMap[c] || 0) : 0);
  const lastIdx = FISCAL_MONTHS.length - 1;
  const mLabels = pred ? FISCAL_MONTHS.map((m, i) => (i === lastIdx ? `${m}(예측)` : m)) : FISCAL_MONTHS;
  const predOpts = pred
    ? {
        segment: { borderDash: (cx: { p1DataIndex: number }) => (cx.p1DataIndex === lastIdx ? [6, 4] : undefined) },
        pointRadius: (cx: { dataIndex: number }) => (cx.dataIndex === lastIdx ? 6 : 2),
        pointStyle: (cx: { dataIndex: number }) => (cx.dataIndex === lastIdx ? "rectRot" : "circle"),
        pointHoverRadius: 6,
      }
    : { pointRadius: 2 };
  const onPointClick = (_e: unknown, els: Array<{ datasetIndex: number; index: number }>) => {
    const el = els && els[0];
    if (!el || el.index !== lastIdx) return;
    const row = pmRows.find((r) => r.cat === ac[el.datasetIndex]);
    if (row) setBasisRows([row]);
  };
  return (
    <>
      <PredictToggle on={pred} set={setPred} label="참고용 매출 예측 보기" note="최근 5개년 동월 추이 기반 당월(06월) 예측치 — 차트의 당월 값이 예측치로 올라갑니다" />
      {pred && <Disclaimer />}
      {pred && (
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--ax-text-hint)]">📈 차트의 예측 점(◆)을 클릭하면 산출 근거가 표시됩니다.</span>
          <button type="button" onClick={() => setBasisRows(pmRows)} className="rounded-[var(--ax-radius-sm)] border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] px-3 py-1 text-[11px] font-bold text-[var(--ax-accent)] hover:bg-[var(--ax-accent-soft)]">📋 예측 산출 근거 보기</button>
        </div>
      )}
      {filterBar}
      <Card title="월별 매출 추이 (현재 회계연도)" tag={pred ? "업종별 · 당월 예측 반영" : "업종별"}>
        <MarketChart config={{ type: "line", data: { labels: mLabels, datasets: lineDs(ac, (c) => FISCAL_MONTHS.map((m) => mVal(c, m)), predOpts) }, options: { onClick: pred ? onPointClick : undefined, interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}${pred && typeof c.label === "string" && c.label.includes("예측") ? " (예측)" : ""}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      <Card title="전년 동월 대비 비교" tag="Y vs Y-1">
        <MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: FISCAL_MONTHS, datasets: [{ label: "올해(Y)", data: FISCAL_MONTHS.map((m) => ac.reduce((a, c) => a + (bc[c]?.[m] || 0), 0)), backgroundColor: "#1F5FBF", borderRadius: 4, maxBarThickness: 18 }, { label: "전년(Y-1)", data: FISCAL_MONTHS.map((m) => ac.reduce((a, c) => a + (pc[c]?.[m] || 0), 0)), backgroundColor: "#B9C6DC", borderRadius: 4, maxBarThickness: 18 }] }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      {pred && <PredictCard rows={pmRows} kind="month" />}
      {basisRows && <PredictBasisModal title="당월(6월) 예측" rows={basisRows} onClose={() => setBasisRows(null)} />}
    </>
  );
}

/* ---------- 연간 ---------- */
function AnnualView({ ctx, filteredCats, filterBar, pred, setPred }: { ctx: Ctx; filteredCats: () => string[]; filterBar: ReactNode; pred: boolean; setPred: (b: boolean) => void }) {
  const ac = filteredCats();
  const ann = M.annualByCat(ctx);
  const tr = ac.map((c) => ({ c, v: M.cat3yTrend(ctx, c) }));
  // 예측 ON: 올해(CUR_YEAR) 막대를 '누계 + 잔여 추정'으로 올려 최종 예측 연매출을 보여준다.
  const [basisRows, setBasisRows] = useState<M.PredictRow[] | null>(null);
  const pyRows = pred ? M.predictYear(ctx) : [];
  const yRemMap: Record<string, number> = {};
  pyRows.forEach((r) => { yRemMap[r.cat] = r.rem; });
  const yVal = (c: string, y: number) => (ann[c]?.[y] || 0) + (pred && y === CUR_YEAR ? (yRemMap[c] || 0) : 0);
  const onBarClick = (_e: unknown, els: Array<{ datasetIndex: number; index: number }>) => {
    const el = els && els[0];
    if (!el || YEARS[el.index] !== CUR_YEAR) return;
    const row = pyRows.find((r) => r.cat === ac[el.datasetIndex]);
    if (row) setBasisRows([row]);
  };
  return (
    <>
      <PredictToggle on={pred} set={setPred} label="참고용 매출 예측 보기" note="최근 5개년 추이·누계 경과율 기반 올해 연매출 예측 — 차트의 올해 막대가 예측치로 올라갑니다" />
      {pred && <Disclaimer />}
      {pred && (
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--ax-text-hint)]">📈 올해(예측) 막대를 클릭하면 산출 근거가 표시됩니다.</span>
          <button type="button" onClick={() => setBasisRows(pyRows)} className="rounded-[var(--ax-radius-sm)] border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] px-3 py-1 text-[11px] font-bold text-[var(--ax-accent)] hover:bg-[var(--ax-accent-soft)]">📋 예측 산출 근거 보기</button>
        </div>
      )}
      {filterBar}
      <Card title="연간 매출 추이" tag={pred ? "최근 5개년 · 올해 예측 반영" : "최근 5개년"}>
        <MarketChart config={{ type: "bar", data: { labels: pred ? YEARS.map((y) => (y === CUR_YEAR ? `${y}(예측)` : String(y))) : YEARS, datasets: ac.map((c) => ({ label: c, data: YEARS.map((y) => yVal(c, y)), backgroundColor: CAT_COLOR[c], borderRadius: 5, maxBarThickness: 30 })) }, options: { onClick: pred ? onBarClick : undefined, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}${typeof c.label === "string" && c.label.startsWith(String(CUR_YEAR)) ? (pred ? " (예측)" : " (누계)") : ""}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="업종별 연평균 성장률 (최근 3년)" tag="CAGR 추정">
          <MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: tr.map((x) => x.c), datasets: [{ label: "연평균 성장률", data: tr.map((x) => x.v), backgroundColor: tr.map((x) => (x.v >= 0 ? "#1E9E6A" : "#D64545")), borderRadius: 5, maxBarThickness: 40 }] }, options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: tip((c) => " " + PCT(c.raw ?? 0)) }, scales: { x: { ticks: { callback: (v: number) => v + "%", font: { size: 11 }, color: "#5B6B83" }, grid: { color: "#EDF1F7" } }, y: FMT_X } } }} />
        </Card>
        <Card title="업종별 매출 규모 순위 (올해 누계)"><RankList ctx={ctx} mode="size" /></Card>
      </div>
      {pred && <PredictCard rows={pyRows} kind="year" />}
      {basisRows && <PredictBasisModal title="올해 연매출 예측" rows={basisRows} onClose={() => setBasisRows(null)} />}
    </>
  );
}

/* ---------- 전년 동기간 비교 ---------- */
function CompareView({ ctx, filteredCats, filterBar }: { ctx: Ctx; filteredCats: () => string[]; filterBar: ReactNode }) {
  const ac = filteredCats();
  const cur = M.dailyByCat(ctx, CUR_YEAR), prev = M.dailyByCat(ctx, CUR_YEAR - 1);
  const dates = (ctx.data.dates || []).slice();
  const g = M.catGrowth(ctx).sort((a, b) => b.g - a.g);
  return (
    <>
      {filterBar}
      <Card title="일자별 동일 날짜 비교 (올해 vs 전년)" tag="합계 기준">
        <MarketChart config={{ type: "line", data: { labels: dates.map((d) => d.slice(5)), datasets: [{ label: `올해(${CUR_YEAR})`, data: dates.map((d) => ac.reduce((a, c) => a + (cur[c]?.[d] || 0), 0)), borderColor: "#1F5FBF", backgroundColor: "#1F5FBF15", tension: 0.3, borderWidth: 2.4, pointRadius: 0, fill: true }, { label: `전년(${CUR_YEAR - 1})`, data: dates.map((d) => ac.reduce((a, c) => a + (prev[c]?.[d] || 0), 0)), borderColor: "#B9C6DC", borderDash: [5, 4], tension: 0.3, borderWidth: 2, pointRadius: 0 }] }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      <Card title="업종별 전년 동기간 대비 증감">
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="border-b border-[var(--ax-border)] text-[var(--ax-text-muted)]"><th className="py-1.5 text-left">순위</th><th className="text-left">업종</th><th className="text-right">올해 누계</th><th className="text-right">전년 동기간</th><th className="text-right">증감률</th></tr></thead>
          <tbody>{g.map((x, i) => <tr key={x.cat} className="border-b border-[var(--ax-border-soft)]"><td className="py-1.5">{i + 1}</td><td className="font-semibold">{x.cat}</td><td className="text-right">{WON(x.cur)}</td><td className="text-right">{WON(x.prevSame)}</td><td className={`text-right font-bold ${x.g > 1 ? "text-[var(--ax-danger)]" : x.g < -1 ? "text-[var(--ax-accent)]" : "text-[var(--ax-text-hint)]"}`}>{PCT(x.g)}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  );
}

/* ---------- 업종별 비교 ---------- */
function CatCompareView({ ctx, activeCats, scopeLab }: { ctx: Ctx; activeCats: () => string[]; scopeLab: string }) {
  const ac = activeCats();
  const ann = M.annualByCat(ctx);
  return (
    <>
      <div><h2 className="text-lg font-extrabold text-[var(--ax-text)]">{scopeLab} 업종별 비교</h2><p className="text-xs text-[var(--ax-text-muted)]">업종 간 매출 규모·추세 직접 비교 · 최근 5개년</p></div>
      <Card title="업종별 연간 매출 비교" tag="5개년 추이">
        <MarketChart config={{ type: "line", data: { labels: YEARS, datasets: ac.map((c) => ({ label: c, data: YEARS.map((y) => ann[c]?.[y] || 0), borderColor: CAT_COLOR[c], backgroundColor: CAT_COLOR[c] + "12", tension: 0.3, borderWidth: 2.2, pointRadius: 3, fill: false })) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} />
      </Card>
      <Card title="업종별 매출 비중 변화" tag="연도별 구성비(누적)">
        <MarketChart config={{ type: "bar", data: { labels: YEARS, datasets: ac.map((c) => ({ label: c, data: YEARS.map((y) => ann[c]?.[y] || 0), backgroundColor: CAT_COLOR[c], borderRadius: 3 })) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: { ...FMT_Y, stacked: true }, x: { ...FMT_X, stacked: true } } } }} />
      </Card>
    </>
  );
}

/* ---------- 역 검색 ---------- */
function StationSearch({ query, setQuery, onSelect }: { query: string; setQuery: (s: string) => void; onSelect: (s: string) => void }) {
  const hits = query.trim() ? STATIONS.filter((x) => x.s.includes(query.trim())).slice(0, 30) : [];
  return (
    <>
      <div className="mx-auto w-full max-w-xl">
        <Card title="역 검색">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 서울, 부산, 대전..." className="w-full rounded-[var(--ax-radius)] border border-[var(--ax-border)] px-3 py-2.5 text-sm outline-none focus:border-[var(--ax-accent)]" />
          {query.trim() && (
            <div className="mt-2 max-h-52 overflow-y-auto rounded-[var(--ax-radius)] border border-[var(--ax-border)]">
              {hits.length ? hits.map((h) => <button key={`${h.hq}-${h.s}`} type="button" onClick={() => onSelect(h.s)} className="flex w-full items-center gap-2 border-b border-[var(--ax-border-soft)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--ax-accent-bg)]"><span className="text-xs text-[var(--ax-text-hint)]">{h.hq}</span><span className="font-semibold text-[var(--ax-text)]">{h.s}</span></button>) : <div className="px-3 py-3 text-center text-sm text-[var(--ax-text-hint)]">검색 결과가 없습니다.</div>}
            </div>
          )}
        </Card>
      </div>
      <Card title="본부별 주요 역">
        <div className="space-y-3">
          {Object.entries(STN).map(([hq, arr]) => (
            <div key={hq}>
              <div className="mb-1.5 text-xs font-bold text-[var(--ax-text-muted)]">{hq}</div>
              <div className="flex flex-wrap gap-1.5">{[...new Set(arr)].map((s) => <button key={s} type="button" onClick={() => onSelect(s)} className="rounded-full border border-[var(--ax-border)] bg-[var(--ax-card)] px-3 py-1 text-xs font-semibold text-[var(--ax-text-muted)] hover:border-[var(--ax-accent-border)] hover:text-[var(--ax-accent)]">{s}</button>)}</div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
