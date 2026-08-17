"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PeriodPicker, periodParams, type Period } from "@/components/admin/PeriodPicker";

type KV = { key: string; count: number };
type Stats = {
  days: number;
  summary: { total: number; passed: number; blocked: number; errored: number; blockRate: number; avgLatencyMs: number };
  trend: { day: string; pass: number; blocked: number; error: number }[];
  byRule: KV[];
  byPanel: KV[];
  byStage: KV[];
  topUsers: KV[];
  byMaskType: KV[];
};
type LogRow = {
  id: string; at: string; outcome: string; stage: string | null; ruleId: string | null;
  panel: string; userId: string | null; ip: string | null; maskedTypes: string[];
  latencyMs: number; inputLen: number; outputLen: number;
};
type Config = {
  enableLength: boolean; enableInjection: boolean; enablePii: boolean; enableRateLimit: boolean;
  enableOutputPiiMask: boolean; enableOutputSecrets: boolean; enableAudit: boolean;
  maxInputChars: number; rateLimitPerWindow: number; rateLimitWindowSec: number; injectionThreshold: number;
  blockOnInputPii: string[];
  maskExtraIps: string;
};

const PII_LABELS: Record<string, string> = {
  RRN: "주민번호", FRN: "외국인등록", CARD: "신용카드", ACCOUNT: "계좌번호", BIZNO: "사업자", PHONE: "전화", EMAIL: "이메일",
};
type LogFilter = "all" | "blocked" | "error";
const RULE_LABEL: Record<string, string> = {
  "M13-input-pii": "입력 PII 차단",
  "M14-M27-ratelimit": "요청 속도 제한",
  "M14-input-length": "입력 길이 초과",
  "M14-input-tokens": "입력 토큰 초과",
  "model-error": "모델 오류",
};
const PANEL_LABEL: Record<string, string> = {
  knowledge: "AI 지식검색", sales: "AI 매출분석", docs: "AI 문서작성", cs: "AI 민원답변",
  ad: "AI 광고도안심의", safety: "스마트 안전관리", pr: "AI 리서치매거진", ai: "AI 통합 채팅", other: "기타",
};
const labelRows = (rows: KV[], map: Record<string, string>): KV[] => rows.map((r) => ({ key: map[r.key] ?? r.key, count: r.count }));
const userRows = (rows: KV[]): KV[] => rows.map((r) => ({ key: !r.key || r.key === "anonymous" ? "익명" : `익명 · ${r.key}`, count: r.count }));
const STAGE_LABEL: Record<string, string> = { input: "입력 검사", model: "모델 호출", output: "출력 검사" };
const OUTCOME_LABEL: Record<string, string> = { pass: "정상", blocked: "차단", error: "오류" };
const LOG_LIMIT = 20;
const fmtUserIp = (userId: string | null, ip: string | null): string =>
  userId || (ip === "::1" || ip === "127.0.0.1" ? "로컬(::1)" : ip) || "-";
const ruleText = (ruleId: string | null, maskedTypes: string[]): string =>
  ruleId
    ? RULE_LABEL[ruleId] ?? RULE_LABEL[ruleId.split(":")[0]] ?? ruleId
    : maskedTypes.length
      ? `마스킹: ${maskedTypes.map((t) => PII_LABELS[t] ?? t).join(", ")}`
      : "-";
const TOGGLES: { key: keyof Config; label: string; desc: string }[] = [
  { key: "enableLength", label: "입력 길이 제한", desc: "M14 · 최대 글자수 초과 차단" },
  { key: "enableInjection", label: "인젝션 탐지", desc: "M14 · 탈옥/주입 시도 차단" },
  { key: "enablePii", label: "PII 입력 차단", desc: "M13 · 고위험 개인정보 차단" },
  { key: "enableRateLimit", label: "요청 속도 제한", desc: "M14·M27 · 과다 요청 차단" },
  { key: "enableOutputPiiMask", label: "출력 PII 마스킹", desc: "M13 · 응답 개인정보 치환" },
  { key: "enableOutputSecrets", label: "출력 민감정보 필터", desc: "M13 · 자격증명·IP·악성코드" },
  { key: "enableAudit", label: "감사 로그", desc: "M09 · 입·출력 기록" },
];

function Bar({ rows, color }: { rows: KV[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className="text-sm text-[var(--ax-text-hint)]">데이터 없음</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate text-[var(--ax-text-muted)]" title={r.key}>{r.key}</span>
          <div className="flex-1 bg-[var(--ax-border-soft)] rounded h-4 overflow-hidden">
            <div className="h-full rounded" style={{ width: `${(r.count / max) * 100}%`, background: color }} />
          </div>
          <span className="w-10 text-right tabular-nums text-[var(--ax-text)]">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string | null }) {
  const copy = () => { if (text) void navigator.clipboard?.writeText(text); };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-[var(--ax-text)]">{title}</span>
        {text != null && <button onClick={copy} className="text-[var(--ax-accent)] hover:underline">복사</button>}
      </div>
      {text == null ? (
        <div className="rounded bg-[var(--ax-border-soft)] p-3 text-[var(--ax-text-hint)]">전문 기록이 비활성화(AUDIT_LOG_FULL_TEXT=false)이거나 빈 값입니다.</div>
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--ax-page)] p-3 text-[var(--ax-text)]">{text}</pre>
      )}
    </div>
  );
}

export function GuardrailDashboardClient() {
  const [tab, setTab] = useState<"dashboard" | "control">("dashboard");
  const [period, setPeriod] = useState<Period>({ mode: "preset", days: 7 });
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [page, setPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ loading: boolean; meta: LogRow; input: string | null; output: string | null } | null>(null);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<{ destroy: () => void } | null>(null);

  const loadStats = useCallback(async () => {
    const qs = new URLSearchParams(periodParams(period));
    if (logFilter !== "all") qs.set("outcome", logFilter);
    const r = await fetch(`/api/admin/guardrails/stats?${qs.toString()}`);
    if (r.ok) setStats(await r.json());
  }, [period, logFilter]);

  const loadLogs = useCallback(async () => {
    const qs = new URLSearchParams(periodParams(period));
    if (logFilter !== "all") qs.set("outcome", logFilter);
    qs.set("limit", String(LOG_LIMIT));
    qs.set("page", String(page));
    const r = await fetch(`/api/admin/guardrails/logs?${qs.toString()}`);
    if (r.ok) {
      const j = await r.json();
      setLogs(j.logs ?? []);
      setLogTotal(j.total ?? 0);
    }
  }, [period, logFilter, page]);

  // 보안 추적용: 입력·생성 텍스트까지 포함한 CSV를 서버에서 받아 다운로드(현재 필터·기간 반영).
  const exportCsv = () => {
    const qs = new URLSearchParams(periodParams(period));
    if (logFilter !== "all") qs.set("outcome", logFilter);
    const a = document.createElement("a");
    a.href = `/api/admin/guardrails/logs/export?${qs.toString()}`;
    a.click();
  };

  // 행별 입력·생성 전문을 모달로 열람(lazy-load).
  const openDetail = async (l: LogRow) => {
    setDetail({ loading: true, meta: l, input: null, output: null });
    try {
      const r = await fetch(`/api/admin/guardrails/logs/${l.id}`);
      const j = r.ok ? await r.json() : null;
      setDetail({ loading: false, meta: l, input: j?.inputText ?? null, output: j?.outputText ?? null });
    } catch {
      setDetail({ loading: false, meta: l, input: null, output: null });
    }
  };

  const loadConfig = useCallback(async () => {
    const r = await fetch(`/api/admin/guardrails/config`);
    if (r.ok) {
      const c = (await r.json()).config as Config;
      setConfig(c);
      setDraft(c);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStats(), loadConfig()]).finally(() => setLoading(false));
  }, [loadStats, loadConfig]);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  // 추세 차트
  useEffect(() => {
    let mounted = true;
    if (tab !== "dashboard" || !stats || !chartRef.current) return;
    (async () => {
      type ChartCtor = new (c: HTMLCanvasElement, cfg: object) => { destroy: () => void };
      const mod = await import("chart.js/auto");
      const ChartJS = (mod as unknown as { default: ChartCtor }).default;
      if (!mounted || !chartRef.current) return;
      chartInst.current?.destroy();
      chartInst.current = new ChartJS(chartRef.current, {
        type: "bar",
        data: {
          labels: stats.trend.map((t) => t.day.slice(5)),
          datasets: [
            { label: "정상", data: stats.trend.map((t) => t.pass), backgroundColor: "#3B6D11" },
            { label: "차단", data: stats.trend.map((t) => t.blocked), backgroundColor: "#A32D2D" },
            { label: "오류", data: stats.trend.map((t) => t.error), backgroundColor: "#B8730C" },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
          plugins: { legend: { position: "bottom" } },
        },
      });
    })();
    return () => { mounted = false; };
  }, [tab, stats]);

  const saveConfig = async () => {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/guardrails/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await r.json();
      if (!r.ok) { setMsg(`저장 실패: ${data.error ?? r.status}`); return; }
      setConfig(data.config);
      setDraft(data.config);
      setMsg("저장되었습니다. 다음 요청부터 적용됩니다.");
    } catch {
      setMsg("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const dirty = JSON.stringify(config) !== JSON.stringify(draft);

  if (loading) return <p className="text-[var(--ax-text-muted)]">불러오는 중…</p>;

  return (
    <div className="space-y-5">
      {/* 탭 */}
      <div className="flex gap-1 border-b border-[var(--ax-border)]">
        {(["dashboard", "control"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-[var(--ax-accent)] text-[var(--ax-accent)]" : "border-transparent text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"
            }`}
          >
            {t === "dashboard" ? "📊 모니터링" : "⚙️ 제어판"}
          </button>
        ))}
      </div>

      {tab === "dashboard" && stats && (
        <div className="space-y-5">
          {/* 기간 선택 */}
          <PeriodPicker value={period} onChange={(p) => { setPage(1); setPeriod(p); }} presets={[1, 7, 14, 30]} />

          {/* 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {([
              { label: "총 요청", value: stats.summary.total.toLocaleString(), color: "#185FA5", f: "all" as LogFilter },
              { label: "차단", value: stats.summary.blocked.toLocaleString(), color: "#A32D2D", f: "blocked" as LogFilter },
              { label: "오류(LLM)", value: (stats.summary.errored ?? 0).toLocaleString(), color: "#B8730C", f: "error" as LogFilter },
              { label: "차단율", value: `${stats.summary.blockRate}%`, color: "#854F0B", f: null },
              { label: "평균 지연", value: `${stats.summary.avgLatencyMs}ms`, color: "#3B6D11", f: null },
            ] as { label: string; value: string; color: string; f: LogFilter | null }[]).map((c) => {
              const active = c.f != null && logFilter === c.f;
              const cls = `rounded-lg border p-3 bg-white text-left ${active ? "border-[var(--ax-accent)] ring-2 ring-[var(--ax-accent-bg)]" : "border-[var(--ax-border)]"}`;
              return c.f != null ? (
                <button key={c.label} onClick={() => { setPage(1); setLogFilter(c.f as LogFilter); }} className={`${cls} transition hover:border-[var(--ax-accent-border)]`} title="클릭하면 아래 그래프·로그가 이 항목으로 필터됩니다">
                  <div className="text-xs text-[var(--ax-text-muted)]">{c.label}{active ? " · 필터중" : ""}</div>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.value}</div>
                </button>
              ) : (
                <div key={c.label} className={cls}>
                  <div className="text-xs text-[var(--ax-text-muted)]">{c.label}</div>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.value}</div>
                </div>
              );
            })}
          </div>

          {/* 추세 차트 */}
          <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
            <div className="text-sm font-semibold mb-2 text-[var(--ax-text)]">일별 추세 (정상/차단)</div>
            <div style={{ height: 220 }}><canvas ref={chartRef} /></div>
          </div>

          {/* 분포 */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
              <div className="text-sm font-semibold mb-3 text-[var(--ax-text)]">차단 사유(룰)별</div>
              <Bar rows={labelRows(stats.byRule, RULE_LABEL)} color="#A32D2D" />
            </div>
            <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
              <div className="text-sm font-semibold mb-3 text-[var(--ax-text)]">패널별 요청</div>
              <Bar rows={labelRows(stats.byPanel, PANEL_LABEL)} color="#185FA5" />
            </div>
            <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
              <div className="text-sm font-semibold mb-3 text-[var(--ax-text)]">출력 마스킹 발생</div>
              <Bar rows={stats.byMaskType.map((m) => ({ key: PII_LABELS[m.key] ?? m.key, count: m.count }))} color="#854F0B" />
            </div>
            <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
              <div className="text-sm font-semibold mb-3 text-[var(--ax-text)]">사용자/IP별 차단 Top 10 ⚠</div>
              <Bar rows={userRows(stats.topUsers)} color="#993C1D" />
            </div>
          </div>

          {/* 최근 로그 */}
          <div className="rounded-lg border border-[var(--ax-border)] bg-white">
            <div className="flex items-center justify-between p-3 border-b border-[var(--ax-border)]">
              <div className="text-sm font-semibold text-[var(--ax-text)]">최근 감사 로그</div>
              <div className="flex items-center gap-1 text-xs">
                {(["all", "blocked", "error"] as const).map((f) => (
                  <button key={f} onClick={() => { setPage(1); setLogFilter(f); }}
                    className={`px-2 py-1 rounded ${logFilter === f ? "bg-[var(--ax-accent)] text-white" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]"}`}>
                    {f === "blocked" ? "차단만" : f === "error" ? "오류만" : "전체"}
                  </button>
                ))}
                <button onClick={exportCsv} className="ml-1 flex items-center gap-1 rounded border border-[var(--ax-border)] px-2 py-1 font-medium text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]"><span className="material-symbols-outlined text-[14px]">download</span>CSV</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]">
                  <tr>
                    <th className="text-left p-2">시각</th><th className="text-left p-2">결과</th>
                    <th className="text-left p-2">패널</th><th className="text-left p-2">단계</th>
                    <th className="text-left p-2">룰</th><th className="text-left p-2">사용자/IP</th>
                    <th className="text-right p-2">지연</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--ax-border-soft)]">
                      <td className="p-2 text-[var(--ax-text-muted)] whitespace-nowrap">{new Date(l.at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="p-2">
                        <span className={l.outcome === "blocked" ? "text-[var(--ax-danger)] font-medium" : l.outcome === "error" ? "text-amber-600 font-medium" : "text-green-700"}>
                          {l.outcome === "blocked" ? "차단" : l.outcome === "error" ? "오류" : "정상"}
                        </span>
                      </td>
                      <td className="p-2">{PANEL_LABEL[l.panel] ?? l.panel}</td>
                      <td className="p-2 text-[var(--ax-text-muted)]">{l.stage ? STAGE_LABEL[l.stage] ?? l.stage : "-"}</td>
                      <td className="p-2 text-[var(--ax-text-muted)] max-w-[200px] truncate" title={l.ruleId ?? ""}>{ruleText(l.ruleId, l.maskedTypes)}</td>
                      <td className="p-2 text-[var(--ax-text-muted)] max-w-[140px] truncate">{fmtUserIp(l.userId, l.ip)}</td>
                      <td className="p-2 text-right whitespace-nowrap text-[var(--ax-text-muted)]">
                        <span className="tabular-nums">{l.latencyMs}ms</span>
                        <button onClick={() => openDetail(l)} title="입력·생성 텍스트 보기" className="ml-1.5 align-middle text-[var(--ax-accent)] hover:text-[var(--ax-accent-dark)]">
                          <span className="material-symbols-outlined align-middle text-[16px]">description</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--ax-text-hint)]">로그 없음</td></tr>}
                </tbody>
              </table>
            </div>
            {logTotal > LOG_LIMIT && (
              <div className="flex items-center justify-between border-t border-[var(--ax-border)] p-2 text-xs text-[var(--ax-text-muted)]">
                <span>{(page - 1) * LOG_LIMIT + 1}–{Math.min(page * LOG_LIMIT, logTotal)} / 총 {logTotal.toLocaleString()}건</span>
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-[var(--ax-border)] px-2 py-1 hover:bg-[var(--ax-border-soft)] disabled:opacity-40">이전</button>
                  <span className="px-1 tabular-nums">{page} / {Math.max(1, Math.ceil(logTotal / LOG_LIMIT))}</span>
                  <button disabled={page >= Math.ceil(logTotal / LOG_LIMIT)} onClick={() => setPage((p) => p + 1)} className="rounded border border-[var(--ax-border)] px-2 py-1 hover:bg-[var(--ax-border-soft)] disabled:opacity-40">다음</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "control" && draft && (
        <div className="space-y-5 max-w-3xl">
          {msg && <div className={`text-sm p-2 rounded ${msg.includes("실패") || msg.includes("오류") ? "bg-[var(--ax-danger-bg)] text-red-700" : "bg-green-50 text-green-700"}`}>{msg}</div>}

          {/* 기능 토글 */}
          <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
            <div className="text-sm font-semibold mb-3 text-[var(--ax-text)]">가드 기능 활성화</div>
            <div className="grid md:grid-cols-2 gap-2">
              {TOGGLES.map((t) => (
                <label key={t.key} className="flex items-start gap-2 p-2 rounded hover:bg-[var(--ax-border-soft)] cursor-pointer">
                  <input type="checkbox" className="mt-0.5"
                    checked={Boolean(draft[t.key])}
                    onChange={(e) => setDraft({ ...draft, [t.key]: e.target.checked })} />
                  <div>
                    <div className="text-sm text-[var(--ax-text)]">{t.label}</div>
                    <div className="text-xs text-[var(--ax-text-hint)]">{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 임계치 */}
          <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
            <div className="text-sm font-semibold mb-3 text-[var(--ax-text)]">임계치</div>
            <div className="grid md:grid-cols-2 gap-4">
              {([
                { key: "maxInputChars", label: "최대 입력 글자수", min: 100, max: 100000 },
                { key: "injectionThreshold", label: "인젝션 차단 점수", min: 1, max: 20 },
                { key: "rateLimitPerWindow", label: "윈도우당 최대 요청", min: 1, max: 100000 },
                { key: "rateLimitWindowSec", label: "윈도우 길이(초)", min: 1, max: 3600 },
              ] as const).map((f) => (
                <label key={f.key} className="text-sm">
                  <span className="text-[var(--ax-text-muted)]">{f.label}</span>
                  <input type="number" min={f.min} max={f.max}
                    value={Number(draft[f.key])}
                    onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
                    className="mt-1 w-full border border-[var(--ax-border)] rounded px-2 py-1.5 tabular-nums" />
                </label>
              ))}
            </div>
          </div>

          {/* PII 입력 차단 대상 */}
          <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
            <div className="text-sm font-semibold mb-1 text-[var(--ax-text)]">PII 입력 차단 대상</div>
            <div className="text-xs text-[var(--ax-text-hint)] mb-3">체크된 유형은 입력 단계에서 차단됩니다. 해제된 유형은 출력 단계에서 마스킹만 됩니다.</div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(PII_LABELS).map((t) => {
                const on = draft.blockOnInputPii.includes(t);
                return (
                  <button key={t}
                    onClick={() => setDraft({
                      ...draft,
                      blockOnInputPii: on ? draft.blockOnInputPii.filter((x) => x !== t) : [...draft.blockOnInputPii, t],
                    })}
                    className={`px-3 py-1.5 rounded-full text-xs border ${on ? "bg-[var(--ax-danger-bg)] border-red-300 text-red-700" : "bg-[var(--ax-border-soft)] border-[var(--ax-border)] text-[var(--ax-text-hint)]"}`}>
                    {on ? "🚫 " : ""}{PII_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 출력 마스킹 보호 IP */}
          <div className="rounded-lg border border-[var(--ax-border)] p-4 bg-white">
            <div className="text-sm font-semibold mb-1 text-[var(--ax-text)]">출력 마스킹 보호 IP</div>
            <div className="text-xs text-[var(--ax-text-hint)] mb-3">
              AI 답변에 노출되면 <b>[IP]</b>로 가릴 추가 IP(콤마 구분). 사설 대역(10.x·172.16~31.x·192.168.x)은 기본 마스킹되며, 여기엔 운영 서버 공인 IP 등을 넣습니다. 환경변수 <code>MASK_EXTRA_IPS</code>와 합쳐 적용됩니다.
            </div>
            <input
              type="text"
              value={draft.maskExtraIps ?? ""}
              onChange={(e) => setDraft({ ...draft, maskExtraIps: e.target.value })}
              placeholder="예: 203.0.113.5, 203.0.113.9"
              spellCheck={false}
              className="w-full rounded border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm font-mono outline-none focus:border-[var(--ax-accent)]"
            />
          </div>

          <div className="flex items-center gap-3">
            <button onClick={saveConfig} disabled={!dirty || saving}
              className="px-4 py-2 rounded bg-[var(--ax-accent)] text-white text-sm font-medium disabled:opacity-40">
              {saving ? "저장 중…" : "설정 저장"}
            </button>
            {dirty && <span className="text-xs text-amber-600">저장되지 않은 변경사항이 있습니다</span>}
            {config && <button onClick={() => setDraft(config)} disabled={!dirty} className="text-xs text-[var(--ax-text-hint)] hover:text-[var(--ax-text-muted)] disabled:opacity-30">되돌리기</button>}
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--ax-border)] p-4">
              <div className="text-sm font-bold text-[var(--ax-text)]">감사 로그 상세 — 입력·생성 텍스트</div>
              <button onClick={() => setDetail(null)} className="material-symbols-outlined text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]">close</button>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--ax-border-soft)] px-4 py-2 text-xs text-[var(--ax-text-muted)]">
              <span>{new Date(detail.meta.at).toLocaleString("ko-KR")}</span>
              <span>· {PANEL_LABEL[detail.meta.panel] ?? detail.meta.panel}</span>
              <span className={detail.meta.outcome === "blocked" ? "font-medium text-[var(--ax-danger)]" : detail.meta.outcome === "error" ? "font-medium text-amber-600" : "text-green-700"}>· {OUTCOME_LABEL[detail.meta.outcome] ?? detail.meta.outcome}</span>
              {detail.meta.ruleId && <span>· {detail.meta.ruleId}</span>}
              {detail.meta.maskedTypes.length > 0 && <span>· 마스킹: {detail.meta.maskedTypes.join(", ")}</span>}
            </div>
            <div className="space-y-4 overflow-y-auto p-4 text-xs">
              {detail.loading ? (
                <div className="py-10 text-center text-[var(--ax-text-hint)]">불러오는 중…</div>
              ) : (
                <>
                  <TextBlock title={`입력 텍스트 (${detail.meta.inputLen.toLocaleString()}자)`} text={detail.input} />
                  <TextBlock title={`생성 텍스트 (${detail.meta.outputLen.toLocaleString()}자)`} text={detail.output} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
