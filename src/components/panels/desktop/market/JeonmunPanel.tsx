"use client";

import { type ReactNode } from "react";
import { MarketChart } from "./MarketChart";
import * as J from "@/lib/marketJeonmun";

const { W, WON, PCT, BASE_DATE, JM_DAE, JM_HIER, JM_ALL_BONBU, JM_STATIONS, jmField, jmScopeRecs, jmAgg, jmGroupTotals, jmGroupList, jmMonths, jmDates, jmYears, jmScopeLabel, jmNeed, jmColor, centersOf, stationsOf, GF_LABEL } = J;
type JmData = J.JmData; type JmFilters = J.JmFilters; type JmDrill = J.JmDrill; type JmCtx = J.JmCtx;

const FMT_Y = { ticks: { callback: (v: number) => W(v), font: { size: 11 }, color: "#5B6B83" }, grid: { color: "#EDF1F7" } };
const FMT_X = { ticks: { font: { size: 11 }, color: "#5B6B83", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } };
const LEG = { position: "bottom" as const, labels: { font: { size: 11.5 }, color: "#16233B", usePointStyle: true, pointStyle: "circle" as const, padding: 14, boxWidth: 8 } };
const tip = (cb: (c: { dataset?: { label?: string }; raw?: number; label?: string }) => string) => ({ callbacks: { label: cb } });

function Card({ title, tag, children }: { title?: string; tag?: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-sm">
      {title && <div className="flex items-center justify-between gap-2 border-b border-[var(--ax-border-soft)] px-4 py-2.5"><h3 className="text-sm font-bold text-[var(--ax-text)]">{title}</h3>{tag && <span className="rounded-full bg-[var(--ax-border-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ax-text-muted)]">{tag}</span>}</div>}
      <div className="p-4">{children}</div>
    </div>
  );
}
function EmptyState({ msg }: { msg: string }) {
  return <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--ax-radius-lg)] border border-dashed border-[var(--ax-border)] bg-[var(--ax-card)] p-10 text-center">
    <span className="material-symbols-outlined text-[40px] text-[var(--ax-text-hint)]">stacked_line_chart</span>
    <h3 className="text-sm font-bold text-[var(--ax-text)]">데이터가 더 필요합니다</h3>
    <p className="text-xs leading-relaxed text-[var(--ax-text-muted)]" dangerouslySetInnerHTML={{ __html: msg }} />
  </div>;
}

const JM_NAV: [string, string][] = [["jmdash", "전문점 대시보드"], ["jmdaily", "전문점 일자"], ["jmmonthly", "전문점 월간"], ["jmannual", "전문점 연간"], ["jmcompare", "대·중·소 비교"]];

export function JeonmunPanel({ data, filters, setFilters, drill, setDrill, view, setView }: {
  data: JmData; filters: JmFilters; setFilters: (f: JmFilters) => void; drill: JmDrill; setDrill: (d: JmDrill) => void; view: string; setView: (v: string) => void;
}) {
  const ctx: JmCtx = { data, filters, drill };
  const gf = jmField(drill); const gfLab = GF_LABEL[gf];

  return (
    <>
      {/* 서브내비 */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--ax-border)]">
        {JM_NAV.map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`border-b-2 px-3.5 py-2 text-sm font-bold transition ${view === k ? "border-[var(--ax-accent)] text-[var(--ax-accent)]" : "border-transparent text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"}`}>{l}</button>)}
      </div>

      {/* 드릴다운 크럼 */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
        <span className="text-[var(--ax-text-muted)]">드릴다운</span>
        <Crumb label="전체 (대분류)" active={!drill.dae} onClick={() => setDrill({ dae: null, jung: null, so: null })} />
        {drill.dae && <><span className="text-[var(--ax-text-hint)]">›</span><Crumb label={`${drill.dae} (중분류)`} active={!!drill.dae && !drill.jung} onClick={() => setDrill({ dae: drill.dae, jung: null, so: null })} /></>}
        {drill.jung && <><span className="text-[var(--ax-text-hint)]">›</span><Crumb label={`${drill.jung} (소분류)`} active /></>}
      </div>

      {/* 필터 바 */}
      <JmFilterBar filters={filters} setFilters={setFilters} drill={drill} setDrill={setDrill} />

      {view === "jmdaily" ? <JmDaily ctx={ctx} gf={gf} gfLab={gfLab} />
        : view === "jmmonthly" ? <JmMonthly ctx={ctx} gf={gf} gfLab={gfLab} />
        : view === "jmannual" ? <JmAnnual ctx={ctx} gf={gf} gfLab={gfLab} />
        : view === "jmcompare" ? <JmCompare ctx={ctx} gf={gf} />
        : <JmDashboard ctx={ctx} gf={gf} gfLab={gfLab} />}
    </>
  );
}

function Crumb({ label, active, onClick }: { label: string; active: boolean; onClick?: () => void }) {
  return <button type="button" onClick={onClick} disabled={!onClick} className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold ${active ? "border-[var(--ax-accent)] bg-[var(--ax-accent)] text-white" : "border-[var(--ax-border)] bg-[var(--ax-card)] text-[var(--ax-text-muted)]"} ${onClick ? "" : "cursor-default"}`}>{label}</button>;
}

function Sel({ label, value, opts, onChange, disabled }: { label: string; value: string; opts: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-[var(--ax-text-muted)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="rounded-md border border-[var(--ax-border)] bg-white px-2 py-1 text-sm text-[var(--ax-text)] outline-none disabled:opacity-50">
        <option>전체</option>{opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}
function JmFilterBar({ filters, setFilters, drill, setDrill }: { filters: JmFilters; setFilters: (f: JmFilters) => void; drill: JmDrill; setDrill: (d: JmDrill) => void }) {
  const jungList = drill.dae ? Object.keys(JM_HIER[drill.dae] || {}) : [];
  const soList = drill.dae && drill.jung ? JM_HIER[drill.dae]?.[drill.jung] || [] : [];
  return (
    <div className="flex flex-wrap items-end gap-2.5 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3">
      <Sel label="본부" value={filters.bonbu} opts={JM_ALL_BONBU} onChange={(v) => setFilters({ bonbu: v, center: "전체", station: "전체" })} />
      <Sel label="센터" value={filters.center} opts={centersOf(filters.bonbu)} onChange={(v) => setFilters({ ...filters, center: v, station: "전체" })} />
      <Sel label="역" value={filters.station} opts={stationsOf(filters.bonbu, filters.center)} onChange={(v) => setFilters({ ...filters, station: v })} />
      <Sel label="대분류" value={drill.dae ?? "전체"} opts={JM_DAE} onChange={(v) => setDrill({ dae: v === "전체" ? null : v, jung: null, so: null })} />
      <Sel label="중분류" value={drill.jung ?? "전체"} opts={jungList} disabled={!drill.dae} onChange={(v) => setDrill({ ...drill, jung: v === "전체" ? null : v, so: null })} />
      <Sel label="소분류" value={drill.so ?? "전체"} opts={soList} disabled={!drill.dae || !drill.jung} onChange={(v) => setDrill({ ...drill, so: v === "전체" ? null : v })} />
      <button type="button" onClick={() => { setFilters({ bonbu: "전체", center: "전체", station: "전체" }); setDrill({ dae: null, jung: null, so: null }); }} className="rounded-md border border-[var(--ax-border)] px-3 py-1.5 text-xs font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">필터 초기화</button>
    </div>
  );
}

/* 차트 빌더 */
const lineDs = (groups: string[], by: Record<string, Record<string | number, number>>, labels: (string | number)[], opts: Record<string, unknown> = {}) =>
  groups.map((g, i) => ({ label: g, data: labels.map((t) => by[g]?.[t] || 0), borderColor: jmColor(g, i), backgroundColor: jmColor(g, i) + "18", tension: 0.32, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, ...opts }));
const barDs = (groups: string[], by: Record<string, Record<string | number, number>>, labels: (string | number)[], opts: Record<string, unknown> = {}) =>
  groups.map((g, i) => ({ label: g, data: labels.map((t) => by[g]?.[t] || 0), backgroundColor: jmColor(g, i), borderRadius: 4, ...opts }));

function JmRank({ totals, tot, lab }: { totals: { k: string; v: number }[]; tot: number; lab: string }) {
  const max = Math.max(...totals.map((t) => t.v), 1);
  return (
    <Card title={`${lab}별 매출 규모 순위`} tag={`${lab} 기준`}>
      <div className="space-y-2">
        {totals.map((t, i) => (
          <div key={t.k} className="flex items-center gap-2 text-sm">
            <span className={`w-5 text-center text-xs font-black ${i === 0 ? "text-[var(--ax-accent)]" : "text-[var(--ax-text-hint)]"}`}>{i + 1}</span>
            <span className="w-28 shrink-0 truncate font-semibold text-[var(--ax-text)]">{t.k}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ax-border-soft)]"><div className="h-full rounded-full" style={{ width: `${(t.v / max) * 100}%`, background: jmColor(t.k, i) }} /></div>
            <span className="w-16 text-right text-xs font-bold text-[var(--ax-text)]">{WON(t.v)}</span>
            <span className="w-12 text-right text-xs text-[var(--ax-text-hint)]">{((t.v / tot) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- 대시보드 ---------- */
function JmDashboard({ ctx, gf, gfLab }: { ctx: JmCtx; gf: "dae" | "jung" | "so"; gfLab: string }) {
  const recsM = jmScopeRecs(ctx, "monthly");
  const last12 = jmMonths(ctx.data).slice(-12), prev12 = jmMonths(ctx.data).slice(-24, -12);
  const cur = recsM.filter((r) => last12.includes(r.yyyymm as string)).reduce((a, b) => a + b.sales, 0);
  const prv = recsM.filter((r) => prev12.includes(r.yyyymm as string)).reduce((a, b) => a + b.sales, 0);
  const g = prv > 0 ? ((cur - prv) / prv) * 100 : 0;
  const totals = jmGroupTotals(recsM, gf, last12); const tot12 = totals.reduce((a, b) => a + b.v, 0) || 1;
  const grow = totals.map((t) => { const c = recsM.filter((r) => r[gf] === t.k && last12.includes(r.yyyymm as string)).reduce((a, b) => a + b.sales, 0); const p = recsM.filter((r) => r[gf] === t.k && prev12.includes(r.yyyymm as string)).reduce((a, b) => a + b.sales, 0); return { k: t.k, g: p > 0 ? ((c - p) / p) * 100 : 0 }; }).sort((a, b) => b.g - a.g);
  const top = totals[0], up = grow[0], down = grow[grow.length - 1];
  const by = jmAgg(jmScopeRecs(ctx, "daily"), gf, "date"); const dlabels = jmDates(ctx.data); const dgroups = jmGroupList(jmScopeRecs(ctx, "daily"), gf).slice(0, 8);
  const byM = jmAgg(recsM, gf, "yyyymm"); const mlabels = jmMonths(ctx.data).slice(-18); const mgroups = jmGroupList(recsM, gf).slice(0, 8);
  const byY = jmAgg(recsM, gf, "year"); const years = jmYears(ctx.data);
  const kpis = [
    { l: "총매출(최근 12개월)", v: WON(cur), note: `${gfLab} ${totals.length}종 · ${jmScopeLabel(ctx.filters)}` },
    { l: "전년 동기간 대비", v: PCT(g), cls: g >= 0 ? "text-[var(--ax-danger)]" : "text-[var(--ax-accent)]" },
    { l: `최대 매출 ${gfLab}`, v: top ? top.k : "-", note: top ? WON(top.v) : "" },
    { l: `최고 성장 ${gfLab}`, v: up ? up.k : "-", note: up ? PCT(up.g) : "" },
    { l: down && down.g < 0 ? `최대 감소 ${gfLab}` : `최저 성장 ${gfLab}`, v: down ? down.k : "-", note: down ? PCT(down.g) : "", cls: down && down.g < 0 ? "text-[var(--ax-accent)]" : undefined },
    { l: "분석 대상", v: jmScopeLabel(ctx.filters), note: `전문점 · ${JM_STATIONS.length}개 역` },
  ];
  const lines: { t: string; h: string }[] = [];
  if (up) lines.push({ t: "u", h: `<b>${up.k}</b> ${gfLab}이(가) 전년 동기간 대비 <b>${PCT(up.g)}</b>로 가장 높은 증가세입니다.` });
  if (down && down.g < 0) lines.push({ t: "d", h: `<b>${down.k}</b> ${gfLab}은(는) 전년 동기간 대비 <b>${PCT(down.g)}</b> 감소했습니다.` });
  if (top) lines.push({ t: "i", h: `매출 비중 1위는 <b>${top.k}</b> (${((top.v / tot12) * 100).toFixed(1)}%)입니다.` });
  lines.push({ t: "i", h: `전문점 ${gfLab} ${totals.length}종 · ${jmScopeLabel(ctx.filters)} 기준 최근 12개월 합계 <b>${WON(cur)}</b>.` });
  return (
    <>
      <div><h2 className="text-lg font-extrabold text-[var(--ax-text)]">전문점 {gfLab} 매출 대시보드</h2><p className="text-xs text-[var(--ax-text-muted)]">대·중·소분류 세부 분석 · {jmScopeLabel(ctx.filters)} · 기준 {BASE_DATE}</p></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{kpis.map((k) => <div key={k.l} className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3"><div className="text-[11px] text-[var(--ax-text-muted)]">{k.l}</div><div className={`mt-0.5 truncate text-lg font-black ${k.cls || "text-[var(--ax-text)]"}`}>{k.v}</div>{k.note && <div className="truncate text-[10px] text-[var(--ax-text-hint)]">{k.note}</div>}</div>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`${gfLab}별 매출 비중`} tag="최근 12개월"><MarketChart className="h-[240px]" config={{ type: "doughnut", data: { labels: totals.map((t) => t.k), datasets: [{ data: totals.map((t) => t.v), backgroundColor: totals.map((t, i) => jmColor(t.k, i)), borderWidth: 2, borderColor: "#fff" }] }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.label}: ${WON(c.raw ?? 0)} (${(((c.raw ?? 0) / tot12) * 100).toFixed(1)}%)`) }, cutout: "58%" } }} /></Card>
        <Card title="📌 자동 분석 요약" tag="계산 결과 기반"><ul className="space-y-2 text-sm">{lines.map((x, i) => <li key={i} className="flex gap-2"><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${x.t === "u" ? "bg-[var(--ax-danger)]" : x.t === "d" ? "bg-[var(--ax-accent)]" : "bg-[var(--ax-text-hint)]"}`}>{x.t === "u" ? "↑" : x.t === "d" ? "↓" : "i"}</span><span className="leading-relaxed text-[var(--ax-text)]" dangerouslySetInnerHTML={{ __html: x.h }} /></li>)}</ul></Card>
      </div>
      <Card title={`일자별 매출 추이 (${gfLab}별)`} tag="최근 기간"><MarketChart config={{ type: "line", data: { labels: dlabels.map((d) => d.slice(5)), datasets: lineDs(dgroups, by, dlabels) }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="월간 매출 추이" tag="최근 18개월"><MarketChart config={{ type: "line", data: { labels: mlabels.map((m) => m.slice(2, 4) + "." + m.slice(4, 6)), datasets: lineDs(mgroups, byM, mlabels, { pointRadius: 1 }) }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
        <Card title="연간 매출 추이" tag="연도별"><MarketChart config={{ type: "bar", data: { labels: years, datasets: barDs(mgroups, byY, years, { maxBarThickness: 30, borderRadius: 5 }) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
      </div>
      <JmRank totals={totals} tot={tot12} lab={gfLab} />
    </>
  );
}

/* ---------- 일자별 ---------- */
function JmDaily({ ctx, gf, gfLab }: { ctx: JmCtx; gf: "dae" | "jung" | "so"; gfLab: string }) {
  const need = jmNeed(ctx.data, "daily"); if (need) return <EmptyState msg={need} />;
  const recs = jmScopeRecs(ctx, "daily"); const by = jmAgg(recs, gf, "date"); const labels = jmDates(ctx.data); const groups = jmGroupList(recs, gf).slice(0, 8);
  const dow = ["일", "월", "화", "수", "목", "금", "토"]; const sums = Array(7).fill(0), cnts = Array(7).fill(0);
  labels.forEach((d) => { const w = new Date(d).getDay(); sums[w] += groups.reduce((a, gg) => a + (by[gg]?.[d] || 0), 0); cnts[w]++; });
  const recent = labels.slice(-14).reverse();
  return (
    <>
      <Card title={`일자별 매출 추이 (${gfLab}별)`} tag="선택 범위"><MarketChart config={{ type: "line", data: { labels: labels.map((d) => d.slice(5)), datasets: lineDs(groups, by, labels, { fill: groups.length === 1 }) }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
      <Card title="요일별 평균 매출 패턴" tag="전체 기간 평균"><MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: dow, datasets: [{ label: "평균", data: sums.map((s, i) => (cnts[i] ? s / cnts[i] : 0)), backgroundColor: dow.map((_, i) => (i === 0 || i === 6 ? "#D86A2C" : "#1F5FBF")), borderRadius: 5, maxBarThickness: 46 }] }, options: { plugins: { legend: { display: false }, tooltip: tip((c) => " " + WON(c.raw ?? 0)) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
      <Card title="일자별 상세 (최근 14일)">
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-[var(--ax-border)] text-[var(--ax-text-muted)]"><th className="py-1.5 text-left">일자</th><th>요일</th>{groups.map((gg) => <th key={gg} className="text-right">{gg}</th>)}<th className="text-right">합계</th></tr></thead><tbody>{recent.map((d) => { const tot = groups.reduce((a, gg) => a + (by[gg]?.[d] || 0), 0); return <tr key={d} className="border-b border-[var(--ax-border-soft)]"><td className="py-1.5">{d}</td><td className="text-center">{dow[new Date(d).getDay()]}</td>{groups.map((gg) => <td key={gg} className="text-right">{WON(by[gg]?.[d] || 0)}</td>)}<td className="text-right font-bold">{WON(tot)}</td></tr>; })}</tbody></table></div>
      </Card>
    </>
  );
}

/* ---------- 월간 ---------- */
function JmMonthly({ ctx, gf, gfLab }: { ctx: JmCtx; gf: "dae" | "jung" | "so"; gfLab: string }) {
  const need = jmNeed(ctx.data, "monthly"); if (need) return <EmptyState msg={need} />;
  const recs = jmScopeRecs(ctx, "monthly"); const by = jmAgg(recs, gf, "yyyymm"); const labels = jmMonths(ctx.data).slice(-12); const groups = jmGroupList(recs, gf).slice(0, 8);
  const prevLabels = labels.map((m) => String(+m.slice(0, 4) - 1) + m.slice(4, 6));
  const curS = labels.map((m) => groups.reduce((a, gg) => a + (by[gg]?.[m] || 0), 0));
  const prvS = prevLabels.map((m) => groups.reduce((a, gg) => a + (by[gg]?.[m] || 0), 0));
  return (
    <>
      <Card title={`월간 매출 추이 (${gfLab}별)`} tag="최근 12개월"><MarketChart config={{ type: "line", data: { labels: labels.map((m) => m.slice(0, 4) + "." + m.slice(4, 6)), datasets: lineDs(groups, by, labels, { pointRadius: 2 }) }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
      <Card title="전년 동월 대비" tag="올해 12개월 vs 전년"><MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: labels.map((m) => m.slice(4, 6) + "월"), datasets: [{ label: "올해", data: curS, backgroundColor: "#1F5FBF", borderRadius: 4, maxBarThickness: 18 }, { label: "전년", data: prvS, backgroundColor: "#B9C6DC", borderRadius: 4, maxBarThickness: 18 }] }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
    </>
  );
}

/* ---------- 연간 ---------- */
function JmAnnual({ ctx, gf, gfLab }: { ctx: JmCtx; gf: "dae" | "jung" | "so"; gfLab: string }) {
  const need = jmNeed(ctx.data, "annual"); if (need) return <EmptyState msg={need} />;
  const recs = jmScopeRecs(ctx, "monthly"); const by = jmAgg(recs, gf, "year"); const years = jmYears(ctx.data); const groups = jmGroupList(recs, gf).slice(0, 8);
  const last = years[years.length - 1]; const totals = groups.map((gg) => ({ k: gg, v: by[gg]?.[last] || 0 })).sort((a, b) => b.v - a.v); const tot = totals.reduce((a, b) => a + b.v, 0) || 1;
  return (
    <>
      <Card title={`연간 매출 추이 (${gfLab}별)`} tag="연도별 합계"><MarketChart config={{ type: "bar", data: { labels: years, datasets: barDs(groups, by, years, { maxBarThickness: 34, borderRadius: 5 }) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="연도별 구성비" tag="누적"><MarketChart className="h-[240px]" config={{ type: "bar", data: { labels: years, datasets: barDs(groups, by, years, { borderRadius: 3 }) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: { ...FMT_Y, stacked: true }, x: { ...FMT_X, stacked: true } } } }} /></Card>
        <JmRank totals={totals} tot={tot} lab={`${gfLab}(${last})`} />
      </div>
    </>
  );
}

/* ---------- 대·중·소 비교 ---------- */
function JmCompare({ ctx, gf }: { ctx: JmCtx; gf: "dae" | "jung" | "so" }) {
  const recs = jmScopeRecs(ctx, "monthly"); const by = jmAgg(recs, gf, "year"); const years = jmYears(ctx.data); const groups = jmGroupList(recs, gf).slice(0, 10);
  return (
    <>
      <Card title="분류별 연간 매출 비교" tag="연도별 추이"><MarketChart config={{ type: "line", data: { labels: years, datasets: groups.map((gg, i) => ({ label: gg, data: years.map((y) => by[gg]?.[y] || 0), borderColor: jmColor(gg, i), backgroundColor: jmColor(gg, i) + "12", tension: 0.3, borderWidth: 2.2, pointRadius: 3 })) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: FMT_Y, x: FMT_X } } }} /></Card>
      <Card title="분류별 매출 비중 변화" tag="연도별 구성비"><MarketChart config={{ type: "bar", data: { labels: years, datasets: barDs(groups, by, years, { borderRadius: 3 }) }, options: { plugins: { legend: LEG, tooltip: tip((c) => ` ${c.dataset?.label}: ${WON(c.raw ?? 0)}`) }, scales: { y: { ...FMT_Y, stacked: true }, x: { ...FMT_X, stacked: true } } } }} /></Card>
    </>
  );
}
