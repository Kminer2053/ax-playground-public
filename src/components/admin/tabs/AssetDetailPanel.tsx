"use client";

/**
 * 문서 상세 — 규정 하나가 파이프라인에서 만들어낸 것 전부.
 *
 * 현황 표는 "무엇이 낡았나"까지만 답한다. 실제로 조치하려면 어느 조문이 임베딩에서 빠졌는지,
 * 어떤 업무가 이 규정을 근거로 삼는지 들여다봐야 한다. 재실행은 무거운 작업이라 확인을 거치고,
 * 결과 수치를 그대로 보여준다 — 임베딩 서버가 꺼진 채 "성공"으로 보이면 안 된다.
 */

import { useCallback, useEffect, useState } from "react";

type Article = {
  name: string; order: number; page: string; chars: number;
  srcHash: string; hashState: "current" | "legacy" | "changed" | "none";
  embedded: boolean; ci: number | null;
  tableKind: string; tableConf: string; hasGloss: boolean;
};
type Impact = { edgeKey: string; rel: string; task: string; taskLabel: string; name: string; status: string; stale: string | null; verdict: string };
type Detail = {
  doc: { title: string; category: string; year: string; docNumber: string };
  status: { external: boolean; issues: string[]; embedding: { covered: number; total: number; dims: number }; tables: { count: number; byKind: Record<string, number> } } | null;
  articles: Article[];
  graph: {
    parents: string[]; children: string[];
    refOut: { sname?: string; tdoc?: string; tt?: string; rt?: string; reason?: string }[];
    refIn: { sdoc?: string; sname?: string; rt?: string }[];
    law: { sname?: string; lawName?: string; lawDoc?: string; rt?: string; reason?: string }[];
  };
  impact: Impact[];
};

const TABS = [
  { key: "articles", label: "조문" },
  { key: "embedding", label: "임베딩" },
  { key: "graph", label: "지식그래프" },
  { key: "tables", label: "표" },
  { key: "impact", label: "업무 영향" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const HASH_LABEL: Record<string, string> = { current: "현행", legacy: "레거시", changed: "불일치", none: "없음" };
const VERDICT_LABEL: Record<string, string> = { current: "일치", legacy: "레거시 해시", changed: "불일치", missing: "조문 소실", "no-hash": "해시 없음", "no-anchor": "조문 근거 아님" };
const KIND_LABEL: Record<string, string> = { A: "A 기준표", B: "B 서식", C: "C 본문", D: "D 연혁" };

export function AssetDetailPanel({ title, onClose }: { title: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<TabKey>("articles");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [art, setArt] = useState<{ name: string; fullText: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch(`/api/admin/assets/${encodeURIComponent(title)}`, { cache: "no-store" }).then((r) => r.json());
      if (j.ok) setD(j);
    } finally { setLoading(false); }
  }, [title]);
  useEffect(() => { void load(); }, [load]);

  const rerun = useCallback(async (action: "rebuild" | "retag" | "analyze", confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(action); setMsg("");
    try {
      const j = await fetch(`/api/admin/assets/${encodeURIComponent(title)}/rerun`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      }).then((r) => r.json());
      if (!j.ok) { setMsg(`실패 — ${j.message ?? j.error}`); return; }
      const r = j.result ?? {};
      const secs = `${(j.ms / 1000).toFixed(1)}초`;
      if (action === "rebuild") setMsg(`${secs} · 벡터 ${r.vectors ?? 0}개(재사용 ${r.reused ?? 0}) · 참조 ${r.refEdges ?? 0}·법령 ${r.lawEdges ?? 0}${j.warning ? ` — ⚠ ${j.warning}` : ""}`);
      else if (action === "retag") setMsg(`${secs} · 표 태깅 ${r.tagged ?? 0} · 명제화 ${r.glossed ?? 0} · gloss 재임베딩 ${r.embedded ?? 0}`);
      else setMsg(`${secs} · ${j.impactSummary || "변화 없음(근거 전부 원문과 일치)"}`);
      await load();
    } finally { setBusy(""); }
  }, [title, load]);

  const openArticle = useCallback(async (name: string) => {
    const j = await fetch(`/api/admin/assets/${encodeURIComponent(title)}?article=${encodeURIComponent(name)}`, { cache: "no-store" }).then((r) => r.json());
    if (j.ok) setArt({ name: j.name, fullText: j.fullText });
  }, [title]);

  if (loading) return <p className="py-8 text-center text-sm text-[var(--ax-text-muted)]">불러오는 중…</p>;
  if (!d) return <p className="py-8 text-center text-sm text-[#d14343]">문서를 불러오지 못했습니다.</p>;

  const ext = d.status?.external;
  const tableArts = d.articles.filter((a) => a.tableKind);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={onClose} className="mb-1 text-xs text-[var(--ax-accent)] hover:underline">← 현황으로</button>
          <h3 className="text-base font-bold">
            {d.doc.title}
            <span className="ml-2 text-xs font-normal text-[var(--ax-text-muted)]">{d.doc.category} · 시행 {d.doc.year || "—"}{d.doc.docNumber ? ` · ${d.doc.docNumber}` : ""}</span>
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => void rerun("analyze", `「${d.doc.title}」의 업무 근거를 다시 판정합니다. 어긋난 근거는 격리됩니다.`)}
            disabled={!!busy}
            className="rounded-md border border-[var(--ax-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--ax-border-soft)] disabled:opacity-50"
          >
            {busy === "analyze" ? "판정 중…" : "근거 재판정"}
          </button>
          {!ext && (
            <>
              <button
                onClick={() => void rerun("retag", `「${d.doc.title}」의 표를 다시 태깅하고 기준표를 명제화합니다. 수십 초 걸릴 수 있습니다.`)}
                disabled={!!busy}
                className="rounded-md border border-[var(--ax-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--ax-border-soft)] disabled:opacity-50"
              >
                {busy === "retag" ? "태깅 중…" : "표 재태깅"}
              </button>
              <button
                onClick={() => void rerun("rebuild", `「${d.doc.title}」의 임베딩과 지식그래프를 재구성합니다.\n\n무변경 조문은 재사용하지만 수 분 걸릴 수 있고, 임베딩·LLM 서버가 필요합니다.`)}
                disabled={!!busy}
                className="rounded-md bg-[var(--ax-accent)] px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {busy === "rebuild" ? "재구성 중…" : "임베딩·그래프 재구성"}
              </button>
            </>
          )}
        </div>
      </div>

      {msg && <p className="mb-2 rounded-md bg-[var(--ax-border-soft)] px-3 py-2 text-xs">{msg}</p>}
      {!!d.status?.issues.length && (
        <ul className="mb-3 list-disc rounded-md bg-[#fdeaea] px-6 py-2 text-xs text-[#d14343]">
          {d.status.issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}
      {ext && <p className="mb-3 rounded-md bg-[var(--ax-border-soft)] px-3 py-2 text-xs text-[var(--ax-text-muted)]">외부 법령·행정규칙은 검색 격리 대상입니다 — 임베딩·그래프·표태깅을 만들지 않는 것이 정상입니다.</p>}

      <div className="mb-2.5 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-bold ${tab === t.key ? "bg-[var(--ax-accent)] text-white" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]"}`}
          >
            {t.label}
            {t.key === "articles" && ` ${d.articles.length}`}
            {t.key === "tables" && ` ${tableArts.length}`}
            {t.key === "impact" && ` ${d.impact.length}`}
          </button>
        ))}
      </div>

      <div className="max-h-[26rem] overflow-auto rounded-lg border border-[var(--ax-border)]">
        {tab === "articles" && (
          <table className="w-full min-w-[600px] text-sm">
            <thead className="sticky top-0 bg-[var(--ax-border-soft)] text-left text-xs text-[var(--ax-text-muted)]">
              <tr><th className="px-3 py-1.5 font-medium">조문</th><th className="px-3 py-1.5 text-right font-medium">길이</th><th className="px-3 py-1.5 font-medium">해시</th><th className="px-3 py-1.5 font-medium">임베딩</th><th className="px-3 py-1.5 font-medium">표</th></tr>
            </thead>
            <tbody>
              {d.articles.map((a) => (
                <tr key={a.name} className="border-t border-[var(--ax-border)] hover:bg-[var(--ax-border-soft)]">
                  <td className="px-3 py-1.5">
                    <button onClick={() => void openArticle(a.name)} className="text-left hover:text-[var(--ax-accent)] hover:underline">{a.name}</button>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ax-text-muted)]">{a.chars.toLocaleString()}</td>
                  <td className="px-3 py-1.5">
                    <span className={a.hashState === "current" ? "text-[var(--ax-text-muted)]" : "text-[#d14343]"}>{HASH_LABEL[a.hashState]}</span>
                  </td>
                  <td className="px-3 py-1.5 text-[var(--ax-text-muted)]">{ext ? "격리" : a.embedded ? "○" : a.chars === 0 ? "—" : <span className="text-[#d14343]">누락</span>}</td>
                  <td className="px-3 py-1.5 text-xs text-[var(--ax-text-muted)]">{a.tableKind ? `${KIND_LABEL[a.tableKind] ?? a.tableKind}${a.tableConf ? ` (${a.tableConf})` : ""}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "embedding" && (
          <div className="p-3 text-sm">
            <p className="mb-2">
              커버리지 <span className="font-bold">{d.status?.embedding.covered ?? 0}/{d.status?.embedding.total ?? 0}</span>
              <span className="ml-1.5 text-xs text-[var(--ax-text-muted)]">· 차원 {d.status?.embedding.dims || "—"} · 본문이 있는 조문만 대상입니다(장 제목 등 0자 항목 제외)</span>
            </p>
            {(() => {
              const missing = d.articles.filter((a) => !a.embedded && a.chars > 0);
              if (ext) return <p className="text-xs text-[var(--ax-text-muted)]">외부 규범은 임베딩하지 않습니다.</p>;
              if (!missing.length) return <p className="text-xs text-[#1d7a44]">본문이 있는 조문이 모두 임베딩되어 있습니다.</p>;
              return (
                <>
                  <p className="mb-1 text-xs text-[#d14343]">미커버 {missing.length}건 — [임베딩·그래프 재구성]으로 채울 수 있습니다.</p>
                  <ul className="list-disc pl-5 text-xs text-[var(--ax-text-muted)]">
                    {missing.slice(0, 30).map((a) => <li key={a.name}>{a.name} ({a.chars.toLocaleString()}자)</li>)}
                  </ul>
                </>
              );
            })()}
          </div>
        )}

        {tab === "graph" && (
          <div className="space-y-3 p-3 text-sm">
            <p className="text-xs">
              <span className="text-[var(--ax-text-muted)]">상위</span> {d.graph.parents.join(", ") || "—"}
              <span className="ml-3 text-[var(--ax-text-muted)]">하위</span> {d.graph.children.join(", ") || "—"}
            </p>
            <Section title={`나가는 참조 ${d.graph.refOut.length}`}>
              {d.graph.refOut.slice(0, 60).map((e, i) => (
                <li key={i}><span className="text-[var(--ax-text-muted)]">{e.sname}</span> → {e.tdoc}{e.rt ? <em className="ml-1 not-italic text-[var(--ax-accent)]">{e.rt}</em> : null}</li>
              ))}
            </Section>
            <Section title={`들어오는 참조 ${d.graph.refIn.length}`}>
              {d.graph.refIn.slice(0, 60).map((e, i) => (
                <li key={i}>{e.sdoc} <span className="text-[var(--ax-text-muted)]">{e.sname}</span> → 이 규정{e.rt ? <em className="ml-1 not-italic text-[var(--ax-accent)]">{e.rt}</em> : null}</li>
              ))}
            </Section>
            <Section title={`법령 연결 ${d.graph.law.length}`}>
              {d.graph.law.slice(0, 60).map((e, i) => (
                <li key={i}><span className="text-[var(--ax-text-muted)]">{e.sname}</span> → {e.lawDoc || e.lawName || "(미식별)"}{e.rt ? <em className="ml-1 not-italic text-[var(--ax-accent)]">{e.rt}</em> : null}</li>
              ))}
            </Section>
          </div>
        )}

        {tab === "tables" && (
          <div className="p-3 text-sm">
            {!tableArts.length ? (
              <p className="text-xs text-[var(--ax-text-muted)]">인식된 표가 없습니다.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-[var(--ax-text-muted)]">
                  {Object.entries(d.status?.tables.byKind ?? {}).map(([k, n]) => `${KIND_LABEL[k] ?? k} ${n}`).join(" · ")}
                  {" · A 기준표는 행 명제화(gloss)로 검색에 보강됩니다"}
                </p>
                <ul className="space-y-1 text-xs">
                  {tableArts.map((a) => (
                    <li key={a.name} className="flex items-center gap-2">
                      <span className="rounded bg-[var(--ax-border-soft)] px-1.5 py-0.5">{KIND_LABEL[a.tableKind] ?? a.tableKind}</span>
                      <button onClick={() => void openArticle(a.name)} className="hover:text-[var(--ax-accent)] hover:underline">{a.name}</button>
                      {a.tableConf && <span className="text-[var(--ax-text-hint)]">신뢰도 {a.tableConf}</span>}
                      {a.hasGloss && <span className="text-[#1d7a44]">명제화됨</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {tab === "impact" && (
          <div className="p-3 text-sm">
            {!d.impact.length ? (
              <p className="text-xs text-[var(--ax-text-muted)]">이 규정을 근거로 삼는 업무가 없습니다.</p>
            ) : (
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-left text-[var(--ax-text-muted)]">
                  <tr><th className="py-1 font-medium">업무</th><th className="py-1 font-medium">관계</th><th className="py-1 font-medium">근거 조문</th><th className="py-1 font-medium">대조</th><th className="py-1 font-medium">상태</th></tr>
                </thead>
                <tbody>
                  {d.impact.map((e) => (
                    <tr key={e.edgeKey} className="border-t border-[var(--ax-border)]">
                      <td className="py-1 pr-2">{e.taskLabel}</td>
                      <td className="py-1 pr-2 text-[var(--ax-text-muted)]">{e.rel}</td>
                      <td className="py-1 pr-2 text-[var(--ax-text-muted)]">{e.name || "—"}</td>
                      <td className="py-1 pr-2">
                        <span className={e.verdict === "current" || e.verdict === "no-anchor" ? "text-[var(--ax-text-muted)]" : "text-[#d14343]"}>{VERDICT_LABEL[e.verdict] ?? e.verdict}</span>
                      </td>
                      <td className="py-1">{e.stale ? <span className="text-[#d14343]">격리({e.stale})</span> : <span className="text-[var(--ax-text-muted)]">{e.status}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {art && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setArt(null)}>
          <div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg bg-[var(--ax-card)] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-bold">{art.name}</h4>
              <button onClick={() => setArt(null)} className="text-sm text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]">닫기</button>
            </div>
            <pre className="whitespace-pre-wrap text-sm leading-relaxed">{art.fullText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div>
      <p className="mb-1 text-xs font-bold">{title}</p>
      {items.length ? <ul className="list-disc pl-5 text-xs">{children}</ul> : <p className="pl-5 text-xs text-[var(--ax-text-muted)]">없음</p>}
    </div>
  );
}
