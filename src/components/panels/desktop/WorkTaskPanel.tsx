"use client";
/**
 * 온톨로지 패널 — 업무 클릭 시 우측 도킹(560px). 소관·전결(한도)·근거를 상태 배지와 함께.
 * [상세 업무흐름 보기] → 전체화면 스윔레인 보드 모달. 근거는 promoted/candidate·규정확정/AI추정 구분.
 */
import { useEffect, useState } from "react";
import WorkBoardModal from "./WorkBoardModal";
import { RegAnnexBody } from "./RegAnnexBody";

type Limit = { min: number | null; max: number | null; text: string } | null;
type Anchor = { doc?: string; name?: string; quote?: string };
type TaskData = {
  task: { id: string; label: string; dept: string; desc: string; status: string; fn?: string; org?: string; steps?: string[]; linkedToHQ?: string | null; alsoDepts?: string[] };
  ownership: { dept: string; deptLabel?: string; duties: string[]; status?: string; evidence?: Anchor }[];
  approval: { position: string; limit: Limit; note?: string; status?: string; evidence?: Anchor }[];
  basis: { doc: string; name: string; basis?: string; note?: string; external?: boolean; status?: string; method?: string; evidence?: { quote?: string } }[];
  hasBoard: boolean;
  boardId: string | null;
};
type ArticleView = { doc: string; name: string; quote?: string };

const won = (n: number | null) => {
  if (n == null) return "";
  if (n >= 100000000) return (n / 100000000).toLocaleString("ko") + "억원";
  if (n >= 10000) return (n / 10000).toLocaleString("ko") + "만원";
  return n.toLocaleString("ko") + "원";
};
const limitText = (l: Limit) => {
  if (!l) return null;
  if (l.min != null && l.max != null) return `${won(l.min)} 초과 ~ ${won(l.max)} 미만`;
  if (l.max != null) return `${won(l.max)} 이하`;
  if (l.min != null) return `${won(l.min)} 초과`;
  return l.text;
};
function StatusBadge({ status }: { status?: string }) {
  if (status === "promoted") return <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">승격</span>;
  if (status === "validated") return <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">원문확인</span>;
  return <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">검토중</span>;
}

export default function WorkTaskPanel({ taskId, onClose, onAsk }: { taskId: string; onClose: () => void; onAsk?: (query: string) => void }) {
  const [data, setData] = useState<TaskData | null>(null);
  const [err, setErr] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [article, setArticle] = useState<ArticleView | null>(null);

  useEffect(() => {
    setData(null); setErr(false);
    let alive = true;
    fetch(`/api/work100/task/${encodeURIComponent(taskId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setData(d))
      .catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [taskId]);

  return (
    <>
      <aside className="absolute right-0 top-0 z-10 flex h-full w-full max-w-[560px] flex-col border-l border-amber-200/15 bg-[#140f0a]/96 text-amber-50 shadow-2xl backdrop-blur">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3 border-b border-amber-200/15 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">{data?.task.dept ?? "…"}</span>
              {data?.task.org === "현업" && <span className="rounded-full bg-teal-500/20 px-2 py-0.5 text-[11px] font-bold text-teal-300">현장 집행</span>}
              {data?.task.fn && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-amber-100/60">{data.task.fn}</span>}
              {data && <StatusBadge status={data.task.status} />}
            </div>
            <h2 className="text-lg font-extrabold leading-tight">{data?.task.label ?? "불러오는 중…"}</h2>
            {data?.task.desc && <p className="mt-1 text-xs text-amber-100/60">{data.task.desc}</p>}
            {!!data?.task.steps?.length && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {data.task.steps.map((s, i) => (
                  <span key={i} className="flex items-center gap-1 text-[10.5px] text-amber-100/75">
                    <span className="rounded bg-amber-950/40 px-1.5 py-0.5">{s}</span>
                    {i < data.task.steps!.length - 1 && <span className="text-amber-200/40">›</span>}
                  </span>
                ))}
              </div>
            )}
            {data?.task.linkedToHQ && (
              <p className="mt-2 rounded-lg bg-teal-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-teal-200/90">↳ {data.task.linkedToHQ}</p>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg border border-amber-200/20 px-2 py-1 text-amber-100/70 hover:bg-white/5">✕</button>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {err ? (
            <p className="text-sm text-amber-100/60">업무 정보를 불러올 수 없습니다.</p>
          ) : !data ? (
            <p className="text-sm text-amber-100/50">불러오는 중…</p>
          ) : (
            <div className="flex flex-col gap-5">
              {/* 소관 */}
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-300/80">소관 <span className="font-normal text-amber-100/40">어느 부서 업무인가</span></h3>
                {data.ownership.length ? data.ownership.map((o, i) => (
                  <div key={i} className="rounded-lg border border-amber-200/10 bg-black/20 p-3">
                    <div className="mb-1.5 flex items-center gap-2"><span className="font-bold text-amber-50">{o.deptLabel ?? o.dept}</span><StatusBadge status={o.status} /></div>
                    <ul className="flex flex-col gap-1">
                      {o.duties.slice(0, 5).map((d, k) => <li key={k} className="rounded bg-amber-950/30 px-2 py-1 text-[12px] text-amber-100/80">{d}</li>)}
                    </ul>
                  </div>
                )) : <p className="text-xs text-amber-100/40">소관 분장 없음</p>}
              </section>

              {/* 전결 */}
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-300/80">전결 <span className="font-normal text-amber-100/40">누가 결재하는가 · 한도</span></h3>
                {data.approval.length ? (
                  <ul className="flex flex-col gap-2">
                    {data.approval.map((a, i) => {
                      const lt = limitText(a.limit);
                      return (
                        <li key={i} className="rounded-lg border border-amber-200/10 bg-black/20 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[12px] font-bold text-amber-100">{a.position}</span>
                            {lt ? <span className="text-[12px] font-bold text-orange-300">{lt}</span> : <span className="text-[11px] text-amber-100/40">한도 명시 없음</span>}
                            <StatusBadge status={a.status} />
                          </div>
                          {a.evidence?.quote && (
                            <button
                              onClick={() => a.evidence?.doc && setArticle({ doc: a.evidence.doc, name: a.evidence.name ?? "", quote: a.evidence.quote })}
                              className="mt-1.5 block w-full border-l-2 border-amber-200/20 pl-2 text-left text-[11px] text-amber-100/55 transition hover:border-amber-300/60 hover:text-amber-100/90"
                              title="전결 별표 원문 보기"
                            >{a.evidence.quote} <span className="text-[10px] text-amber-300/60">↗</span></button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-xs text-amber-100/40">전결 근거 없음 <span className="opacity-70">(위임전결 별표1 미해당)</span></p>}
              </section>

              {/* 근거 */}
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-300/80">근거 <span className="font-normal text-amber-100/40">근거 규정·조문</span></h3>
                {data.basis.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {data.basis.map((b, i) => (
                      <li key={i}>
                        <button
                          onClick={() => !b.external && setArticle({ doc: b.doc, name: b.name, quote: b.evidence?.quote })}
                          disabled={b.external}
                          className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-amber-200/10 bg-black/20 px-3 py-2 text-left text-[12px] transition enabled:hover:border-amber-300/40 enabled:hover:bg-black/40 disabled:cursor-default"
                          title={b.external ? "외부 규범 — 원문 미수록" : "원문 보기"}
                        >
                          {b.basis === "전결"
                            ? <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">규정확정</span>
                            : <span className="rounded bg-stone-500 px-1.5 py-0.5 text-[10px] font-bold text-white">AI추정</span>}
                          <span className="font-semibold text-amber-50">「{b.doc}」 {b.name}</span>
                          {b.basis && <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-amber-100/60">{b.basis}</span>}
                          {b.external
                            ? <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">외부·원문 미수록</span>
                            : <span className="ml-auto text-[10px] text-amber-300/70">원문 ↗</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-amber-100/40">근거 조문 미도출 <span className="opacity-70">(회수 보완 검토 큐)</span></p>}
              </section>
            </div>
          )}
        </div>

        {/* 하단 액션 */}
        <div className="flex shrink-0 gap-2 border-t border-amber-200/15 px-5 py-3">
          <button
            onClick={() => setBoardOpen(true)}
            disabled={!data?.hasBoard}
            className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white transition hover:bg-amber-500 disabled:cursor-default disabled:opacity-40"
          >▤ 상세 업무흐름 보기</button>
          <button
            onClick={() => data && onAsk?.(`「${data.task.label}」 업무의 처리 절차와 근거 규정을 알려줘`)}
            disabled={!data || !onAsk}
            className="flex-1 rounded-xl border border-amber-400/50 bg-amber-500/10 py-2.5 text-sm font-bold text-amber-200 transition hover:bg-amber-500/25 disabled:cursor-default disabled:opacity-40"
          >🔎 지식검색에 질문</button>
        </div>
      </aside>

      {boardOpen && data?.boardId && (
        <WorkBoardModal taskId={data.boardId} title={data.task.label} onClose={() => setBoardOpen(false)} />
      )}
      {article && <ArticleModal article={article} onClose={() => setArticle(null)} />}
    </>
  );
}

/** 조문 원문 모달 — 온톨로지 evidence 앵커(doc·name) 직행. 인용문 강조 + 전문 스크롤. */
function ArticleModal({ article, onClose }: { article: ArticleView; onClose: () => void }) {
  const [body, setBody] = useState<{ doc: string; name: string; category: string; fullText: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/work100/article?doc=${encodeURIComponent(article.doc)}&name=${encodeURIComponent(article.name)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setBody(d))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [article]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const isExternal = body && /법령|행정규칙/.test(body.category);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-[86vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-amber-200/25 bg-[#171310] text-amber-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-amber-200/15 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {body?.category && (
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${isExternal ? "bg-purple-500/20 text-purple-300" : "bg-amber-500/15 text-amber-300"}`}>{body.category}</span>
              )}
            </div>
            <h2 className="text-base font-extrabold leading-tight">「{article.doc}」 <span className="font-bold text-amber-200/90">{body?.name ?? article.name}</span></h2>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg border border-amber-200/20 px-2 py-1 text-amber-100/70 hover:bg-white/5">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {failed ? (
            <p className="text-sm text-amber-100/60">원문을 찾을 수 없습니다(적재본에 해당 조문 없음).</p>
          ) : !body ? (
            <p className="text-sm text-amber-100/50">원문 불러오는 중…</p>
          ) : (
            <>
              {article.quote && (
                <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-amber-300/80">근거 인용</p>
                  <p className="text-[12.5px] text-amber-50">{article.quote}</p>
                </div>
              )}
              <RegAnnexBody fullText={body.fullText} quote={article.quote} theme="dark" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
