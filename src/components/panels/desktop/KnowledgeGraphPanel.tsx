"use client";

import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { KnowledgeGraph3D, type GraphData3D } from "./KnowledgeGraph3D";
import { RegAnnexBody } from "./RegAnnexBody";

/** 사규 지식그래프 패널 — 토글 시 좌측에 표출. 3D(E 절충안: 위계 지층+한지 카드+법령 물결 링) 기본, 2D(cytoscape) 전환 가능.
 *  highlight: 현재 답변 근거 문서 제목들 → 강조 + 포커스(3D는 인용 문서 간 관계선·유형 배지까지). */
const COL: Record<string, string> = {
  규정: "#3b6fd4", 세칙: "#0d9488", 지침: "#d97706", 매뉴얼: "#7c3aed", 편람: "#db2777", 계약서: "#ea580c", 외부: "#6b7280", 기타: "#9ca3af",
};
const LEGEND_2D: [string, string][] = [["규정", COL.규정], ["세칙", COL.세칙], ["지침", COL.지침], ["매뉴얼", COL.매뉴얼], ["편람", COL.편람], ["계약서", COL.계약서]];
// 3D(한지 잉크 팔레트) — KnowledgeGraph3D CAT_COLOR와 동일 배색
const LEGEND_3D: [string, string][] = [
  ["규정", "#c9820e"], ["세칙", "#0e9678"], ["지침", "#3568b8"], ["매뉴얼", "#7448c8"], ["편람", "#c05c1a"], ["계약서", "#c23a63"], ["법령", "#8b97a8"],
];

type GraphData = GraphData3D;
type ViewMode = "3d" | "2d";
const VIEW_KEY = "axp-knowledge-graph-view";

export function KnowledgeGraphPanel({ highlight }: { highlight?: string[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [view, setView] = useState<ViewMode>("3d");
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(VIEW_KEY) : null;
    if (saved === "2d") setView("2d");
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/knowledge/graph")
      .then((r) => r.json())
      .then((d) => { if (alive) { if (d.ok) setData(d); else setErr("그래프를 불러오지 못했습니다."); } })
      .catch(() => alive && setErr("그래프 로드 실패"));
    return () => { alive = false; };
  }, []);

  const switchView = (v: ViewMode) => {
    setView(v);
    setInfo("");
    setSelectedDoc(null);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* noop */ }
  };

  // ── 2D(cytoscape) — 2D 모드에서만 구성 ──
  useEffect(() => {
    if (view !== "2d" || !data || !boxRef.current) return;
    const dark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
    const els: cytoscape.ElementDefinition[] = [
      ...data.nodes.map((n) => ({ data: { id: n.id, label: n.id, color: COL[n.cat] || COL.기타 } })),
      ...data.hier.map(([a, b], i) => ({ data: { id: `h${i}`, source: a, target: b }, classes: "hier" })),
      ...data.ref.map(([a, b, w], i) => ({ data: { id: `r${i}`, source: a, target: b, w }, classes: "ref" })),
    ];
    const cy = cytoscape({
      container: boxRef.current,
      elements: els,
      style: [
        { selector: "node", style: { "background-color": "data(color)", width: 16, height: 16, label: "data(label)", "font-size": 9, color: dark ? "#e5e5e5" : "#2a2a2a", "text-valign": "bottom", "text-margin-y": 2, "min-zoomed-font-size": 7, "text-outline-width": 2, "text-outline-color": dark ? "#1a1a1a" : "#ffffff" } },
        { selector: "edge.hier", style: { width: 1, "line-color": dark ? "#5a5f66" : "#c2c7cd", "curve-style": "bezier", "target-arrow-shape": "none" } },
        { selector: "edge.ref", style: { width: "mapData(w, 1, 9, 1, 4)", "line-color": "#c026a3", "line-style": "dashed", "curve-style": "bezier", "target-arrow-shape": "triangle", "arrow-scale": 0.6, "target-arrow-color": "#c026a3", opacity: 0.45 } },
        { selector: ".dim", style: { opacity: 0.08 } },
        { selector: ".cur", style: { "background-color": "#dc2626", width: 26, height: 26, "border-width": 2, "border-color": dark ? "#fff" : "#7f1d1d", "font-size": 11, "min-zoomed-font-size": 0 } },
        { selector: ".nbr", style: { "border-width": 2, "border-color": dark ? "#fff" : "#111" } },
      ],
      layout: { name: "cose", animate: false, randomize: true, componentSpacing: 80, nodeRepulsion: 12000, idealEdgeLength: 70, gravity: 0.35, numIter: 1000 },
      minZoom: 0.1, maxZoom: 3, wheelSensitivity: 0.25,
    });
    cyRef.current = cy;
    cy.ready(() => cy.fit(undefined, 30));
    cy.on("tap", "node", (ev) => {
      const n = ev.target;
      const nb = n.closedNeighborhood();
      cy.elements().addClass("dim");
      nb.removeClass("dim");
      n.addClass("nbr");
      const out = n.outgoers("node").length, inc = n.incomers("node").length;
      setInfo(`${n.id()} · 나가는 참조/상위 ${out} · 들어오는 ${inc}`);
      setSelectedDoc(n.id());
    });
    cy.on("dbltap", "node", (ev) => setOpenDoc(ev.target.id()));
    cy.on("tap", (ev) => { if (ev.target === cy) { cy.elements().removeClass("dim nbr"); setInfo(""); setSelectedDoc(null); } });
    return () => { cy.destroy(); cyRef.current = null; };
  }, [data, view]);

  // 2D — 현재 답변 근거 문서 강조 + 포커스
  useEffect(() => {
    if (view !== "2d") return;
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("cur");
    const hl = (highlight || []).filter(Boolean);
    if (!hl.length) return;
    const sel = cy.nodes().filter((n) => hl.includes(n.id()));
    if (sel.length) {
      sel.addClass("cur");
      cy.animate({ fit: { eles: sel.closedNeighborhood(), padding: 50 } }, { duration: 400 });
    }
  }, [highlight, data, view]);

  const legend = view === "3d" ? LEGEND_3D : LEGEND_2D;
  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ax-border)] px-3 py-2 text-[11px] text-[var(--ax-text-muted)]">
        {legend.map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />{k}</span>
        ))}
        <span className="text-[var(--ax-text-hint)]">
          {view === "3d"
            ? <>카드=사규 위계 지층 · 링=법령 · 더블클릭=원문 · <span style={{ color: "#dc2626" }}>● 답변 근거</span>는 관계선·유형까지 표시</>
            : <>· 실선=위계 · 점선=참조 · 더블클릭=원문 · <span style={{ color: "#dc2626" }}>● 현재 답변 근거</span></>}
        </span>
        {info && <span className="ml-auto font-semibold text-[var(--ax-text)]">{info}</span>}
        {selectedDoc && (
          <button type="button" onClick={() => setOpenDoc(selectedDoc)}
            className="rounded-lg border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-0.5 text-[11px] font-bold text-[var(--ax-accent)] transition-colors hover:bg-[var(--ax-border-soft)]">
            원문 보기
          </button>
        )}
        <span className={info ? "" : "ml-auto"}>
          <span className="inline-flex overflow-hidden rounded-lg border border-[var(--ax-border)]">
            {(["3d", "2d"] as const).map((v) => (
              <button key={v} type="button" onClick={() => switchView(v)}
                className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${view === v ? "bg-[var(--ax-accent)] text-white" : "bg-[var(--ax-card)] text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"}`}>
                {v.toUpperCase()}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {err ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--ax-text-hint)]">{err}</div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--ax-text-hint)]">그래프 불러오는 중…</div>
        ) : view === "3d" ? (
          <KnowledgeGraph3D data={data} highlight={highlight} onInfo={setInfo} onSelectDoc={setSelectedDoc} onOpenDoc={setOpenDoc} />
        ) : null}
        {view === "2d" && <div ref={boxRef} className="h-full w-full" />}
      </div>
      {openDoc && <DocModal title={openDoc} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}

/** 문서 원문 모달 — 지식검색 라이트 테마(업무패널 ArticleModal 구조 재사용) */
function DocModal({ title, onClose }: { title: string; onClose: () => void }) {
  const [body, setBody] = useState<{ title: string; category: string; year: string; articles: { name: string; fullText: string }[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/knowledge/doc?title=${encodeURIComponent(title)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setBody(d))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const isExternal = body && /법령|행정규칙/.test(body.category);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-6" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-[86vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--ax-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {body?.category && (
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${isExternal ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-800"}`}>{body.category}</span>
              )}
              {body?.year && <span className="text-[10.5px] text-[var(--ax-text-hint)]">{body.year}</span>}
            </div>
            <h2 className="text-base font-extrabold leading-tight text-[var(--ax-text)]">「{title}」</h2>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg border border-[var(--ax-border)] px-2 py-1 text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {failed ? (
            <p className="text-sm text-[var(--ax-text-muted)]">원문을 찾을 수 없습니다(적재본에 해당 문서 없음).</p>
          ) : !body ? (
            <p className="text-sm text-[var(--ax-text-hint)]">원문 불러오는 중…</p>
          ) : body.articles.length === 0 ? (
            <p className="text-sm text-[var(--ax-text-muted)]">이 문서에는 표시할 조문이 없습니다.</p>
          ) : (
            body.articles.map((a) => (
              <section key={a.name} className="mb-4">
                <h3 className="mb-1 text-[13px] font-bold text-[var(--ax-accent)]">{a.name}</h3>
                <RegAnnexBody fullText={a.fullText} theme="light" />
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
