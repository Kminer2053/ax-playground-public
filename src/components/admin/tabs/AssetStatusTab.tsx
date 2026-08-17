"use client";

/**
 * 지식자산 현황 — "지금 무엇이 낡았나"에 한 화면으로 답한다.
 *
 * 규정을 올리면 임베딩·그래프·표태깅·업무근거가 연쇄로 갱신되지만, 지금까지는 적재 성공
 * 여부만 보였다. 각 문서가 파이프라인에서 무엇을 만들어냈고 무엇이 어긋났는지 보여준다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetDetailPanel } from "./AssetDetailPanel";

type Row = {
  title: string; category: string; year: string; external: boolean;
  articles: { count: number; hashed: number; legacyHash: number; chars: number };
  embedding: { covered: number; total: number; dims: number; stale?: number };
  graph: { hierUp: number; hierDown: number; refOut: number; refIn: number; law: number };
  tables: { count: number; byKind: Record<string, number> };
  ontology: { edges: number; stale: number; tasks: number; byStatus: Record<string, number>; mismatch: { changed: number; legacy: number; missing: number } };
  boards: { affected: number };
  issues: string[];
  health: "ok" | "attention";
  computedAt: string;
};
type Summary = {
  docs: { total: number; internal: number; external: number };
  articles: number;
  embedding: { covered: number; total: number };
  graph: { ref: number; law: number; hier: number };
  tables: number;
  ontology: { edges: number; stale: number; mismatch: number; tasks: number };
  boards: number;
  attention: number;
  computedAt: string | null;
};

const CATS = ["전체", "규정", "세칙", "지침", "매뉴얼", "편람", "계약서", "법령", "행정규칙"] as const;
const num = (n: number) => n.toLocaleString();

function Card({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-[var(--ax-border-soft)] px-3 py-2.5">
      <p className="mb-1 text-xs text-[var(--ax-text-muted)]">{label}</p>
      <p className={`text-2xl font-bold ${warn ? "text-[#d14343]" : "text-[var(--ax-text)]"}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${warn ? "text-[#d14343]" : "text-[var(--ax-text-muted)]"}`}>{sub}</p>}
    </div>
  );
}

export default function AssetStatusTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cat, setCat] = useState<(typeof CATS)[number]>("전체");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [smoking, setSmoking] = useState(false);
  const [smokeMsg, setSmokeMsg] = useState<string | null>(null);

  // 미니 벤치 — 저장된 예상 질문 전 문서 일괄 검색 확인(회수만, 수 초). 적재·개정 후 버튼 하나로 회귀 점검.
  const runSmoke = useCallback(async () => {
    setSmoking(true); setSmokeMsg(null);
    try {
      const r = await fetch("/api/admin/regulations/smoke", { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setSmokeMsg(`실행 실패 — ${j.error ?? "알 수 없는 오류"}`); return; }
      if (j.total === 0) { setSmokeMsg("저장된 예상 질문이 없습니다 — 적재 시 예상 질문을 함께 넣어 주세요."); return; }
      const misses = (j.results as { title: string; misses: { q: string }[] }[]).flatMap((r2) => r2.misses.map((m) => `「${r2.title}」 ${m.q}`));
      setSmokeMsg(j.passed === j.total
        ? `검색 확인 ${j.passed}/${j.total} 전부 통과 (${j.docs}개 문서)`
        : `⚠ 검색 확인 ${j.passed}/${j.total} — 미회수: ${misses.slice(0, 3).join(" · ")}${misses.length > 3 ? ` 외 ${misses.length - 3}건` : ""}`);
    } catch { setSmokeMsg("요청 실패(네트워크/서버)."); }
    finally { setSmoking(false); }
  }, []);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const r = await fetch(`/api/admin/assets${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) { setRows(j.rows); setSummary(j.summary); }
    } finally { setRefreshing(false); setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const view = useMemo(() => rows.filter((r) => {
    if (cat !== "전체" && r.category !== cat) return false;
    if (onlyIssues && r.health !== "attention") return false;
    if (q && !r.title.includes(q)) return false;
    return true;
  }), [rows, cat, onlyIssues, q]);

  if (loading) return <p className="py-8 text-center text-sm text-[var(--ax-text-muted)]">불러오는 중…</p>;
  // 상세는 목록을 대체한다 — 나란히 두면 좁은 화면에서 표가 잘린다.
  if (detail) return <AssetDetailPanel title={detail} onClose={() => { setDetail(null); void load(); }} />;

  return (
    <div>
      {/* 요약 */}
      {summary && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-[var(--ax-text-muted)]">
              {summary.computedAt ? `최종 집계 ${new Date(summary.computedAt).toLocaleString("ko-KR")}` : "집계 이력 없음"}
            </p>
            <div className="flex items-center gap-2">
              {smokeMsg && <span className={`text-xs ${smokeMsg.startsWith("⚠") ? "text-[#b45309]" : "text-[var(--ax-text-muted)]"}`}>{smokeMsg}</span>}
              <button
                onClick={() => void runSmoke()}
                disabled={smoking}
                className="rounded-md border border-[var(--ax-border)] px-3 py-1.5 text-sm hover:bg-[var(--ax-border-soft)] disabled:opacity-50"
              >
                {smoking ? "검색 확인 중…" : "검색 스모크"}
              </button>
              <button
                onClick={() => void load(true)}
                disabled={refreshing}
                className="rounded-md border border-[var(--ax-border)] px-3 py-1.5 text-sm hover:bg-[var(--ax-border-soft)] disabled:opacity-50"
              >
                {refreshing ? "집계 중…" : "새로 집계"}
              </button>
            </div>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-5">
            <Card label="사규·법령" value={num(summary.docs.total)} sub={`내부 ${summary.docs.internal} · 외부 ${summary.docs.external} · 조문 ${num(summary.articles)}`} />
            <Card
              label="임베딩"
              value={`${num(summary.embedding.covered)}/${num(summary.embedding.total)}`}
              sub={summary.embedding.covered < summary.embedding.total ? `미커버 ${num(summary.embedding.total - summary.embedding.covered)}` : "전량 커버"}
              warn={summary.embedding.covered < summary.embedding.total}
            />
            <Card label="지식그래프" value={num(summary.graph.ref + summary.graph.law + summary.graph.hier)} sub={`참조 ${summary.graph.ref} · 법령 ${summary.graph.law} · 위계 ${summary.graph.hier}`} />
            <Card
              label="업무 온톨로지"
              value={num(summary.ontology.edges)}
              sub={summary.ontology.stale || summary.ontology.mismatch ? `재검토 ${summary.ontology.stale} · 미격리 불일치 ${summary.ontology.mismatch}` : `근거 엣지 · 전체 업무 ${summary.ontology.tasks}개`}
              warn={summary.ontology.stale > 0 || summary.ontology.mismatch > 0}
            />
            <Card label="업무흐름도" value={num(summary.boards)} sub={`보드 · 표 태깅 ${num(summary.tables)}건`} />
          </div>
        </>
      )}

      {/* 필터 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={cat} onChange={(e) => setCat(e.target.value as (typeof CATS)[number])} className="rounded-md border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-1.5 text-sm">
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="규정명 검색" className="flex-1 min-w-40 rounded-md border border-[var(--ax-border)] bg-[var(--ax-card)] px-2.5 py-1.5 text-sm" />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          조치 필요만{summary && summary.attention > 0 ? ` (${summary.attention})` : ""}
        </label>
        <span className="text-sm text-[var(--ax-text-muted)]">{view.length}건</span>
      </div>

      {/* 문서별 상태 */}
      <div className="overflow-x-auto rounded-lg border border-[var(--ax-border)]">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-[var(--ax-border-soft)] text-left text-xs text-[var(--ax-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">규정명</th>
              <th className="px-3 py-2 font-medium">시행일</th>
              <th className="px-3 py-2 text-right font-medium">조문</th>
              <th className="px-3 py-2 text-right font-medium">임베딩</th>
              <th className="px-3 py-2 text-right font-medium">참조·법령</th>
              <th className="px-3 py-2 text-right font-medium">표</th>
              <th className="px-3 py-2 text-right font-medium">업무근거</th>
              <th className="px-3 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr
                key={r.title}
                onClick={() => setOpen(open === r.title ? null : r.title)}
                className="cursor-pointer border-t border-[var(--ax-border)] hover:bg-[var(--ax-border-soft)]"
              >
                <td className="px-3 py-2">
                  <span className="font-medium">{r.title}</span>
                  <span className="ml-1.5 text-xs text-[var(--ax-text-muted)]">{r.category}</span>
                  {open === r.title && r.issues.length > 0 && (
                    <ul className="mt-1.5 list-disc pl-4 text-xs text-[#d14343]">
                      {r.issues.map((i) => <li key={i}>{i}</li>)}
                    </ul>
                  )}
                  {open === r.title && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDetail(r.title); }}
                      className="mt-1.5 mr-2 rounded border border-[var(--ax-border)] px-2 py-0.5 text-xs hover:bg-[var(--ax-card)]"
                    >
                      상세 보기 →
                    </button>
                  )}
                  {open === r.title && r.issues.length === 0 && (
                    <p className="mt-1.5 text-xs text-[var(--ax-text-muted)]">
                      조문 해시 {r.articles.hashed}/{r.articles.count} · 참조 나감 {r.graph.refOut}·들어옴 {r.graph.refIn} · 연결 업무 {r.ontology.tasks}개 · 보드 {r.boards.affected}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-[var(--ax-text-muted)]">{r.year || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num(r.articles.count)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.external ? <span className="text-[var(--ax-text-muted)]">격리</span>
                    : <span className={r.embedding.covered < r.embedding.total ? "text-[#d14343]" : ""}>
                        {r.embedding.covered}/{r.embedding.total}
                        {(r.embedding.stale ?? 0) > 0 && <span className="text-[#d14343]" title="본문은 바뀌었는데 벡터가 옛것 — 재적재 필요"> ⟳{r.embedding.stale}</span>}
                      </span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ax-text-muted)]">
                  {r.external ? "—" : `${r.graph.refOut}·${r.graph.law}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ax-text-muted)]">{r.tables.count || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.ontology.edges ? <>{r.ontology.edges}{r.ontology.stale > 0 && <span className="text-[#d14343]"> ({r.ontology.stale})</span>}</> : "—"}
                </td>
                <td className="px-3 py-2">
                  {r.health === "ok"
                    ? <span className="rounded-full bg-[#e6f6ec] px-2 py-0.5 text-xs text-[#1d7a44]">정상</span>
                    : <span className="rounded-full bg-[#fdeaea] px-2 py-0.5 text-xs text-[#d14343]">조치 필요</span>}
                </td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--ax-text-muted)]">해당 문서가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--ax-text-muted)]">
        행을 클릭하면 상세가 펼쳐집니다. 외부 법령·행정규칙은 검색 격리 대상이라 임베딩·그래프를 만들지 않는 것이 정상입니다.
      </p>
    </div>
  );
}
