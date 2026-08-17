"use client";

/**
 * 사규 목록·직접 편집 — 파일 없이 조문을 손으로 고치는 경로.
 *
 * 적재(파일 업로드)와 달리 원본 없이 고칠 수 있어 오탈자 교정·긴급 수정에 쓴다.
 * 저장·삭제는 임베딩·그래프에 더해 근거 영향 판정까지 서버에서 이어진다(lib/doc-change.ts).
 */

import { useCallback, useEffect, useState } from "react";

type Reg = { id: string; title: string; year?: string; articleCount?: number };
type Article = { name: string; fullText: string };
type RegEdit = { id?: string; title: string; year: string; articles: Article[]; directParent?: string };
export function RegulationListPanel() {
  const [items, setItems] = useState<Reg[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<RegEdit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await fetch("/api/admin/regulations?limit=1000").then((r) => r.json()); setItems(d.items || []); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const del = async (id: string) => {
    if (!window.confirm("이 사규를 삭제할까요?")) return;
    await fetch(`/api/admin/regulations/${id}`, { method: "DELETE" });
    void load();
  };
  const openEdit = async (id: string) => {
    const d = await fetch(`/api/admin/regulations/${id}`).then((r) => r.json());
    if (!d.ok) { window.alert("불러오기 실패"); return; }
    const r = d.regulation;
    setEdit({ id: r.id, title: r.title || "", year: r.year || "", directParent: r.directParent || "", articles: (r.articles || []).map((a: Article) => ({ name: a.name, fullText: a.fullText })) });
  };
  const filtered = items.filter((r) => (r.title || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="사규명 검색" className="w-60 rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm" />
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--ax-text-muted)]">총 <b className="text-[var(--ax-text)]">{q ? `${filtered.length}/${items.length}` : items.length}</b>건</span>
          <button onClick={() => setEdit({ title: "", year: "", articles: [{ name: "", fullText: "" }] })} className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white">+ 신규 등록</button>
        </div>
      </div>
      {loading ? <div className="py-12 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div> : (
        <div className="max-h-[480px] space-y-1.5 overflow-y-auto">
          {filtered.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ax-border)] bg-white p-3 shadow-sm">
              <button onClick={() => openEdit(r.id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--ax-text)]">
                {r.title}{r.year ? <span className="ml-2 text-xs text-[var(--ax-text-hint)]">{r.year}</span> : null}
                {r.articleCount != null ? <span className="ml-2 text-xs text-[var(--ax-text-hint)]">· 조문 {r.articleCount}</span> : null}
              </button>
              <div className="flex flex-none gap-1">
                <button onClick={() => openEdit(r.id)} className="material-symbols-outlined rounded-lg px-2 py-1 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]" title="수정">edit</button>
                <button onClick={() => del(r.id)} className="material-symbols-outlined rounded-lg px-2 py-1 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-danger-bg)] hover:text-[var(--ax-danger)]" title="삭제">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <RegForm initial={edit} parentOptions={items.map((r) => r.title).filter(Boolean)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function RegForm({ initial, parentOptions, onClose, onSaved }: { initial: RegEdit; parentOptions: string[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!initial.id;
  const [title, setTitle] = useState(initial.title);
  const [year, setYear] = useState(initial.year);
  const [directParent, setDirectParent] = useState(initial.directParent ?? "");
  const [articles, setArticles] = useState<Article[]>(initial.articles.length ? initial.articles : [{ name: "", fullText: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setArt = (i: number, patch: Partial<Article>) => setArticles((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const inputCls = "w-full rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent-border)] focus:ring-2 focus:ring-[var(--ax-accent-bg)]";

  const submit = async () => {
    if (!title.trim()) { setErr("제목을 입력하세요."); return; }
    const arts = articles.filter((a) => a.name.trim()).map((a, i) => ({ name: a.name.trim(), fullText: a.fullText, order: i }));
    if (arts.length === 0) { setErr("조문을 1건 이상 입력하세요(조문명 필수)."); return; }
    if (!editing && !directParent.trim()) { setErr("직상위규정을 지정하세요(없으면 '외부법령')."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(editing ? `/api/admin/regulations/${initial.id}` : "/api/admin/regulations", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), year, articles: arts, ...(directParent.trim() ? { directParent: directParent.trim() } : {}) }),
      });
      const d = await r.json();
      if (r.ok && (d.ok || d.id)) onSaved();
      else setErr(d.error || "저장 실패");
    } catch { setErr("서버 연결 실패"); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[var(--ax-radius-lg)] bg-[var(--ax-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[var(--ax-accent)]">사규 {editing ? "수정" : "신규 등록"}</h2>
          <button onClick={onClose} aria-label="닫기" className="material-symbols-outlined text-[22px] text-[var(--ax-text-hint)] hover:text-[var(--ax-text)]">close</button>
        </div>
        {err && <p className="mb-3 rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-3 py-2 text-sm text-[var(--ax-danger)]">{err}</p>}
        <div className="flex gap-3">
          <label className="flex-1 text-xs font-bold text-[var(--ax-text)]">제목 *<input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputCls}`} /></label>
          <label className="w-28 text-xs font-bold text-[var(--ax-text)]">연도<input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026" className={`mt-1 ${inputCls}`} /></label>
        </div>
        <label className="mt-3 block text-xs font-bold text-[var(--ax-text)]">
          직상위규정 {editing ? <span className="font-normal text-[var(--ax-text-hint)]">(변경 시에만 입력)</span> : "*"}
          <input list="reg-parents" value={directParent} onChange={(e) => setDirectParent(e.target.value)} placeholder="상위 규정 선택 또는 '외부법령'" className={`mt-1 ${inputCls}`} />
        </label>
        <datalist id="reg-parents">
          <option value="외부법령" />
          {parentOptions.map((p) => <option key={p} value={p} />)}
        </datalist>
        <p className="mt-1 text-[11px] text-[var(--ax-text-hint)]">저장 시 이 문서만 임베딩·참조그래프가 로컬 LLM으로 증분 갱신됩니다(전체 재빌드 없음).</p>

        <div className="mt-4 mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-[var(--ax-text)]">조문 {articles.length}</span>
          <button onClick={() => setArticles((a) => [...a, { name: "", fullText: "" }])} className="flex items-center gap-1 rounded-[var(--ax-radius)] border border-[var(--ax-border)] px-2.5 py-1 text-xs font-bold text-[var(--ax-accent)] hover:bg-[var(--ax-accent-bg)]"><span className="material-symbols-outlined text-[15px]">add</span>조문 추가</button>
        </div>
        <div className="space-y-2.5">
          {articles.map((a, i) => (
            <div key={i} className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <input value={a.name} onChange={(e) => setArt(i, { name: e.target.value })} placeholder={`제${i + 1}조(조문명)`} className={`flex-1 ${inputCls}`} />
                <button onClick={() => setArticles((arr) => arr.filter((_, j) => j !== i))} className="material-symbols-outlined flex-none rounded-lg px-1.5 py-1 text-[16px] text-[var(--ax-text-hint)] hover:bg-[var(--ax-danger-bg)] hover:text-[var(--ax-danger)]" title="조문 삭제">close</button>
              </div>
              <textarea value={a.fullText} onChange={(e) => setArt(i, { fullText: e.target.value })} rows={2} placeholder="조문 본문" className={`resize-y ${inputCls}`} />
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-[var(--ax-border-soft)] pt-4">
          <button onClick={onClose} className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] px-4 py-2 text-sm font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">취소</button>
          <button onClick={submit} disabled={busy} className="rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-4 py-2 text-sm font-black text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">{busy ? "저장…" : editing ? "수정" : "등록"}</button>
        </div>
      </div>
    </div>
  );
}
