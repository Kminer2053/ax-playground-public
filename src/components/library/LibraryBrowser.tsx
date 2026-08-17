"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getVoterId, getMyVotes, setMyVote, type Dir } from "@/lib/voterId";
import {
  type Board, type Card,
  fmtSize, dateOnly, timeAgo, fileMeta,
  PostDetail, PostForm,
} from "./LibraryDetail";

type Sort = "latest" | "popular" | "views";

const TABS: { key: Board; label: string; icon: string }[] = [
  { key: "prompt", label: "프롬프트 도서관", icon: "forum" },
  { key: "video", label: "영상 자료실", icon: "smart_display" },
  { key: "file", label: "자료실", icon: "folder" },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: "latest", label: "최신순" },
  { key: "popular", label: "인기순" },
  { key: "views", label: "조회순" },
];

function fmtDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "";
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function LibraryBrowser() {
  const [tab, setTab] = useState<Board>("prompt");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("latest");
  const [items, setItems] = useState<Card[]>([]);
  const [popular, setPopular] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [myVotes, setMyVotes] = useState<Record<string, Dir>>({});
  const [selected, setSelected] = useState<Card | null>(null);
  const [form, setForm] = useState<{ mode: "new" | "edit"; board?: Board; card?: Card } | null>(null);
  const voterRef = useRef("");
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    voterRef.current = getVoterId();
    setMyVotes(getMyVotes());
    void fetch("/api/admin/auth").then((r) => r.json()).then((d) => setAdmin(!!d.admin)).catch(() => {});
  }, []);

  const load = useCallback(async (b: Board, q: string, s: Sort) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ board: b, sort: s });
      if (q) qs.set("q", q);
      const [l, p] = await Promise.all([
        fetch(`/api/library?${qs.toString()}`).then((r) => r.json()),
        fetch(`/api/library/popular?board=${b}`).then((r) => r.json()),
      ]);
      const now = Date.now();
      const withAgo = (arr: Card[]) => arr.map((c) => ({ ...c, ago: timeAgo(c.createdAt, now) }));
      const fresh = withAgo(l.items || []);
      setItems(fresh);
      setPopular(p.items || []);
      setSelected((cur) => (cur ? fresh.find((c) => c.id === cur.id) ?? cur : cur));
    } catch {
      setItems([]); setPopular([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(tab, query, sort), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [tab, query, sort, load]);

  useEffect(() => {
    if (selected) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  const vote = useCallback(async (id: string, dir: Dir) => {
    try {
      const r = await fetch(`/api/library/${id}/vote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, voterId: voterRef.current }),
      });
      const d = await r.json();
      if (d.ok) {
        const patch = (arr: Card[]) => arr.map((it) => (it.id === id ? { ...it, up: d.up, down: d.down } : it));
        setItems(patch); setPopular(patch);
        setSelected((s) => (s && s.id === id ? { ...s, up: d.up, down: d.down } : s));
        setMyVotes(setMyVote(id, d.my));
      }
    } catch { /* noop */ }
  }, []);

  const openDetail = useCallback((c: Card) => {
    setSelected({ ...c, viewCount: (c.viewCount || 0) + 1 });
    setItems((arr) => arr.map((it) => (it.id === c.id ? { ...it, viewCount: (it.viewCount || 0) + 1 } : it)));
    void fetch(`/api/library/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "view" }) }).catch(() => {});
  }, []);

  const pingDownload = useCallback((c: Card) => {
    setItems((arr) => arr.map((it) => (it.id === c.id ? { ...it, downloadCount: (it.downloadCount || 0) + 1 } : it)));
    setSelected((s) => (s && s.id === c.id ? { ...s, downloadCount: (s.downloadCount || 0) + 1 } : s));
    void fetch(`/api/library/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "download" }) }).catch(() => {});
  }, []);

  const featuredId = (popular[0] ?? items[0])?.id;
  const topPromptIds = new Set(popular.slice(0, 5).map((p) => p.id));

  return (
    <div className="min-h-screen bg-gradient-to-b from-[var(--ax-accent-bg)] to-[var(--ax-page)]">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        {/* 헤더 — 타이틀 가운데정렬(매거진 기준 통일) */}
        <div className="relative mb-5 flex items-center justify-center">
          <Link href="/" className="absolute left-0 flex items-center gap-1 text-sm font-semibold text-[var(--ax-text-muted)] transition hover:text-[var(--ax-accent)]">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>메인
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[var(--ax-accent)]">
            <span className="material-symbols-outlined text-[22px]">menu_book</span>AX 라이브러리
          </h1>
          <button onClick={() => setForm({ mode: "new", board: tab })} className="absolute right-0 flex items-center gap-1 rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--ax-accent-dark)]">
            <span className="material-symbols-outlined text-[18px]">add</span>등록하기
          </button>
        </div>

        {/* 브라우즈: 사이드바 + 메인 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
          <aside className="flex flex-col gap-5 rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-sm">
            <div className="flex items-center gap-2 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white px-3 py-2">
              <span className="material-symbols-outlined text-[18px] text-[var(--ax-text-hint)]">search</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="검색…" className="w-full bg-transparent text-sm text-[var(--ax-text)] outline-none placeholder:text-[var(--ax-text-hint)]" />
              {query && <button onClick={() => setQuery("")} aria-label="검색 지우기" className="material-symbols-outlined text-[16px] text-[var(--ax-text-hint)] hover:text-[var(--ax-text)]">close</button>}
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-[var(--ax-text-muted)]">정렬</div>
              <div className="flex flex-wrap gap-1.5">
                {SORTS.map((s) => (
                  <button key={s.key} onClick={() => setSort(s.key)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${sort === s.key ? "bg-[var(--ax-accent)] text-white" : "border border-[var(--ax-border)] bg-white text-[var(--ax-text-muted)] hover:bg-[var(--ax-accent-bg)]"}`}>{s.label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-[var(--ax-text-muted)]">게시판</div>
              <div className="flex flex-col gap-1">
                {TABS.map((t) => (
                  <button key={t.key} onClick={() => { setTab(t.key); setSelected(null); }} className={`flex items-center gap-2.5 rounded-[var(--ax-radius)] px-3 py-2.5 text-sm font-semibold transition ${tab === t.key ? "bg-[var(--ax-accent-bg)] text-[var(--ax-accent)]" : "text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]"}`}>
                    <span className="material-symbols-outlined text-[20px]">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-[var(--ax-text-muted)]">태그 <span className="text-[var(--ax-text-hint)]">· 준비 중</span></div>
              <div className="flex flex-wrap gap-1.5">
                {["요약", "번역", "문서작성", "코딩"].map((t) => <span key={t} className="rounded-full bg-[var(--ax-border-soft)] px-2.5 py-1 text-xs text-[var(--ax-text-hint)]">{t}</span>)}
              </div>
            </div>
          </aside>

          <main>
            {query && <div className="mb-3 text-sm text-[var(--ax-text-muted)]">“{query}” 검색 결과 {items.length}건</div>}

            {loading ? (
              <div className="py-24 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div>
            ) : items.length === 0 ? (
              <div className="rounded-[var(--ax-radius-lg)] border border-dashed border-[var(--ax-border)] py-24 text-center text-sm text-[var(--ax-text-hint)]">{query ? "검색 결과가 없습니다." : "아직 게시물이 없습니다. 첫 게시물을 올려보세요!"}</div>
            ) : tab === "prompt" ? (
              <div className="max-h-[min(520px,50vh)] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {items.map((c) => <PromptCard key={c.id} card={c} selected={selected?.id === c.id} popular={topPromptIds.has(c.id)} onOpen={openDetail} />)}
                </div>
              </div>
            ) : tab === "video" ? (
              <div className="max-h-[min(520px,50vh)] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
                  {items.map((c) => <VideoCard key={c.id} card={c} selected={selected?.id === c.id} featured={c.id === featuredId} onOpen={openDetail} />)}
                </div>
              </div>
            ) : (
              <div className="max-h-[min(520px,50vh)] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {items.map((c) => <FileCard key={c.id} card={c} selected={selected?.id === c.id} onOpen={openDetail} />)}
                </div>
              </div>
            )}
          </main>
        </div>

        {/* 하단 상세 — 전체폭(좌측 공백 없이) */}
        {selected && (
          <div ref={detailRef}>
            <PostDetail
              card={selected} admin={admin} myVote={myVotes[selected.id] ?? null}
              onVote={vote} onDownload={pingDownload}
              onEdit={(c) => setForm({ mode: "edit", card: c })}
              onDeleted={() => { setSelected(null); void load(tab, query, sort); }}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>

      {form && (
        <PostForm
          mode={form.mode} board={form.card?.board ?? form.board ?? tab} card={form.card} admin={admin}
          onClose={() => setForm(null)}
          onDone={() => { setForm(null); void load(tab, query, sort); }}
        />
      )}
    </div>
  );
}

function PromptCard({ card, selected, popular, onOpen }: { card: Card; selected: boolean; popular: boolean; onOpen: (c: Card) => void }) {
  return (
    <button onClick={() => onOpen(card)} className={`flex h-full min-h-[7.5rem] items-stretch gap-3 rounded-[var(--ax-radius-lg)] border bg-[var(--ax-card)] p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-[var(--ax-accent)] ring-2 ring-[var(--ax-accent-bg)]" : popular ? "border-[var(--ax-accent)]" : "border-[var(--ax-border)] hover:border-[var(--ax-accent-border)]"}`}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-[var(--ax-accent-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ax-accent)]">프롬프트</span>
          {popular && <span className="flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600"><span className="material-symbols-outlined text-[12px]">local_fire_department</span>인기</span>}
          {card.pinned && <span className="material-symbols-outlined text-[15px] text-[var(--ax-warning)]">push_pin</span>}
        </div>
        <h3 className="mt-1.5 line-clamp-1 font-bold leading-snug text-[var(--ax-text)]">{card.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--ax-text-muted)]">{card.content}</p>
        <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-[var(--ax-text-hint)]">
          <span>{card.author}</span>
          <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">visibility</span>{card.viewCount || 0}</span>
          <span className="ml-auto flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">thumb_up</span>{card.up}</span>
        </div>
      </div>
      <div className="h-24 w-24 flex-none self-stretch overflow-hidden rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)]">
        {card.thumbnailUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={card.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          : <div className="flex h-full items-center justify-center text-[var(--ax-text-hint)]"><span className="material-symbols-outlined text-[24px]">forum</span></div>}
      </div>
    </button>
  );
}

function VideoCard({ card, selected, featured, onOpen }: { card: Card; selected: boolean; featured: boolean; onOpen: (c: Card) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [dur, setDur] = useState("");
  const enter = () => { const v = ref.current; if (v) { v.currentTime = 0; void v.play().catch(() => {}); } };
  const leave = () => { const v = ref.current; if (v) { v.pause(); v.currentTime = 0; } };
  return (
    <button onClick={() => onOpen(card)} onMouseEnter={enter} onMouseLeave={leave} className="flex flex-col text-left">
      <div className={`relative aspect-video w-full overflow-hidden rounded-[var(--ax-radius)] bg-[var(--ax-border)] ${featured ? "ring-2 ring-[var(--ax-accent)]" : selected ? "ring-2 ring-[var(--ax-accent-border)]" : ""}`}>
        <video
          ref={ref}
          src={card.fileUrl || undefined}
          poster={card.thumbnailUrl || undefined}
          muted loop playsInline preload="metadata"
          onLoadedMetadata={(e) => setDur(fmtDuration(e.currentTarget.duration))}
          className="h-full w-full object-cover"
        />
        {featured && <span className="absolute left-1.5 top-1.5 rounded bg-[var(--ax-accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">인기영상</span>}
        {dur && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">{dur}</span>}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-[var(--ax-text)]">{card.title}</h3>
      <div className="mt-1 text-xs text-[var(--ax-text-hint)]">{card.author} · 조회 {card.viewCount || 0} · {card.ago || dateOnly(card.createdAt)}</div>
    </button>
  );
}

function FileCard({ card, selected, onOpen }: { card: Card; selected: boolean; onOpen: (c: Card) => void }) {
  const count = card.attachments?.length || 0;
  const total = (card.attachments || []).reduce((s, a) => s + (a.size || 0), 0);
  return (
    <button onClick={() => onOpen(card)} className={`flex h-full min-h-[7.5rem] items-stretch gap-3 rounded-[var(--ax-radius-lg)] border bg-[var(--ax-card)] p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-[var(--ax-accent)] ring-2 ring-[var(--ax-accent-bg)]" : "border-[var(--ax-border)] hover:border-[var(--ax-accent-border)]"}`}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-[var(--ax-accent-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ax-accent)]">자료실</span>
          {card.pinned && <span className="material-symbols-outlined text-[15px] text-[var(--ax-warning)]">push_pin</span>}
        </div>
        <h3 className="mt-1.5 line-clamp-2 font-bold leading-snug text-[var(--ax-text)]">{card.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--ax-text-muted)]">{card.content}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-[var(--ax-text-hint)]">
          <span>{card.author}</span>
          <span>첨부 {count}</span>
          <span>{fmtSize(total)}</span>
          <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">visibility</span>{card.viewCount || 0}</span>
          <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">download</span>{card.downloadCount || 0}</span>
        </div>
      </div>
      <div className="h-24 w-24 flex-none self-stretch overflow-hidden rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)]">
        {card.thumbnailUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={card.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          : <div className="flex h-full flex-col items-center justify-center gap-0.5 text-[var(--ax-text-hint)]">
            <span className="material-symbols-outlined text-[24px]">{count > 1 ? "folder_open" : fileMeta(card.attachments?.[0]?.name || "").icon}</span>
          </div>}
      </div>
    </button>
  );
}
