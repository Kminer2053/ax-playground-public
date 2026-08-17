"use client";

import { useCallback, useEffect, useState } from "react";

type Attachment = { name: string; size: number; url: string };
type Card = {
  id: string; board: string; title: string; content: string; usage?: string; author: string;
  thumbnailUrl?: string; fileUrl?: string; fileName?: string; fileSize?: number;
  attachments?: Attachment[]; up: number; down: number; viewCount?: number; downloadCount?: number;
  pinned: boolean; createdAt?: string;
};
type Cfg = { popularWindowDays: number; popularMinLikes: number; popularCount: number };

const BOARDS = [{ k: "prompt", l: "프롬프트" }, { k: "video", l: "영상" }, { k: "file", l: "자료" }];

function fmtSize(b: number): string {
  if (!b) return "";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export function LibraryManageTab() {
  const [board, setBoard] = useState("prompt");
  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [savedMsg, setSavedMsg] = useState("");
  const [detail, setDetail] = useState<Card | null>(null);

  const load = useCallback(async (b: string) => {
    setLoading(true);
    try {
      const d = await fetch(`/api/library?board=${b}`).then((r) => r.json());
      setItems(d.items || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(board); }, [board, load]);
  useEffect(() => { void fetch("/api/admin/playground-config").then((r) => r.json()).then((d) => d.ok && setCfg(d.config)).catch(() => {}); }, []);

  const togglePin = async (id: string, pinned: boolean) => {
    await fetch(`/api/library/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !pinned }) });
    setDetail((d) => (d && d.id === id ? { ...d, pinned: !pinned } : d));
    void load(board);
  };
  const del = async (id: string) => {
    if (!window.confirm("이 게시물을 삭제할까요?")) return;
    await fetch(`/api/library/${id}`, { method: "DELETE" });
    setDetail((d) => (d && d.id === id ? null : d));
    void load(board);
  };
  const saveCfg = async () => {
    if (!cfg) return;
    const r = await fetch("/api/admin/playground-config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const d = await r.json();
    if (d.ok) { setCfg(d.config); setSavedMsg("저장됨 ✓ (30초 내 인기 산정 반영)"); setTimeout(() => setSavedMsg(""), 2500); }
  };

  return (
    <div className="space-y-6">
      {/* 인기 설정 */}
      {cfg && (
        <div className="rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm">
          <div className="mb-3 text-sm font-bold text-[var(--ax-text)]">인기 게시물 산정 설정</div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs text-[var(--ax-text-muted)]">산정 기간(일)<input type="number" value={cfg.popularWindowDays} onChange={(e) => setCfg({ ...cfg, popularWindowDays: Number(e.target.value) })} className="mt-1 block w-24 rounded-lg border border-[var(--ax-border)] px-2 py-1.5 text-sm" /></label>
            <label className="text-xs text-[var(--ax-text-muted)]">최소 좋아요<input type="number" value={cfg.popularMinLikes} onChange={(e) => setCfg({ ...cfg, popularMinLikes: Number(e.target.value) })} className="mt-1 block w-24 rounded-lg border border-[var(--ax-border)] px-2 py-1.5 text-sm" /></label>
            <label className="text-xs text-[var(--ax-text-muted)]">노출 개수<input type="number" value={cfg.popularCount} onChange={(e) => setCfg({ ...cfg, popularCount: Number(e.target.value) })} className="mt-1 block w-24 rounded-lg border border-[var(--ax-border)] px-2 py-1.5 text-sm" /></label>
            <button onClick={saveCfg} className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white">저장</button>
            {savedMsg && <span className="text-xs text-[var(--ax-success)]">{savedMsg}</span>}
          </div>
        </div>
      )}

      {/* 게시물 관리 */}
      <div>
        <div className="mb-3 flex gap-1">
          {BOARDS.map((b) => (
            <button key={b.k} onClick={() => setBoard(b.k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${board === b.k ? "bg-[var(--ax-accent)] text-white" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]"}`}>{b.l}</button>
          ))}
        </div>
        {loading ? <div className="py-12 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div> : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--ax-border)] py-12 text-center text-sm text-[var(--ax-text-hint)]">게시물이 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {items.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ax-border)] bg-white p-3 shadow-sm">
                <button onClick={() => setDetail(c)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--ax-text)]">{c.pinned && <span className="material-symbols-outlined text-[15px] text-[var(--ax-warning)]">push_pin</span>}<span className="truncate">{c.title}</span></div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--ax-text-hint)]">{c.author} · 👍 {c.up} 👎 {c.down}{c.board === "file" && c.attachments ? ` · 첨부 ${c.attachments.length}` : ""} · <span className="text-[var(--ax-accent)]">내용 보기</span></div>
                </button>
                <div className="flex flex-none gap-1">
                  <button onClick={() => togglePin(c.id, c.pinned)} className={`material-symbols-outlined rounded-lg px-2 py-1 text-[18px] ${c.pinned ? "bg-amber-100 text-amber-600" : "text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]"}`} title="고정">push_pin</button>
                  <button onClick={() => del(c.id)} className="material-symbols-outlined rounded-lg px-2 py-1 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-danger-bg)] hover:text-[var(--ax-danger)]" title="삭제">delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detail && <DetailModal card={detail} onClose={() => setDetail(null)} onPin={togglePin} onDelete={del} />}
    </div>
  );
}

function DetailModal({ card, onClose, onPin, onDelete }: { card: Card; onClose: () => void; onPin: (id: string, pinned: boolean) => void; onDelete: (id: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[var(--ax-radius-lg)] bg-[var(--ax-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {card.pinned && <span className="material-symbols-outlined text-[16px] text-[var(--ax-warning)]">push_pin</span>}
              <h2 className="text-lg font-black text-[var(--ax-text)]">{card.title}</h2>
            </div>
            <div className="mt-1 text-xs text-[var(--ax-text-hint)]">{card.author} · 👍 {card.up} 👎 {card.down}{card.viewCount != null ? ` · 조회 ${card.viewCount}` : ""}{card.createdAt ? ` · ${card.createdAt.slice(0, 10)}` : ""}</div>
          </div>
          <button onClick={onClose} aria-label="닫기" className="material-symbols-outlined text-[22px] text-[var(--ax-text-hint)] hover:text-[var(--ax-text)]">close</button>
        </div>

        {card.board === "video" && card.fileUrl && (
          <video controls src={card.fileUrl} poster={card.thumbnailUrl || undefined} className="mb-3 aspect-video w-full rounded-[var(--ax-radius)] bg-black" />
        )}
        {card.board === "prompt" && card.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.thumbnailUrl} alt="" className="mb-3 max-h-60 rounded-[var(--ax-radius)] object-contain" />
        )}

        <pre className="whitespace-pre-wrap rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)] p-3 font-mono text-sm leading-relaxed text-[var(--ax-text)]">{card.content}</pre>
        {card.usage && <div className="mt-2 rounded-[var(--ax-radius)] bg-[var(--ax-accent-bg)] p-2.5 text-xs text-[var(--ax-accent)]">💡 {card.usage}</div>}

        {card.board === "file" && card.attachments && card.attachments.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold text-[var(--ax-text-muted)]">첨부파일 {card.attachments.length}</div>
            <div className="flex flex-col gap-1.5">
              {card.attachments.map((a, i) => (
                <a key={i} href={a.url} download={a.name} className="flex items-center justify-between gap-2 rounded-[var(--ax-radius)] border border-[var(--ax-border)] p-2 text-sm hover:bg-[var(--ax-accent-bg)]">
                  <span className="truncate text-[var(--ax-text)]">{a.name}</span>
                  <span className="flex-none text-xs text-[var(--ax-text-hint)]">{fmtSize(a.size)}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--ax-border-soft)] pt-4">
          <button onClick={() => onPin(card.id, card.pinned)} className="flex items-center gap-1 rounded-[var(--ax-radius)] border border-[var(--ax-border)] px-3 py-1.5 text-sm font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">
            <span className="material-symbols-outlined text-[16px]">push_pin</span>{card.pinned ? "고정 해제" : "고정"}
          </button>
          <button onClick={() => onDelete(card.id)} className="flex items-center gap-1 rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-3 py-1.5 text-sm font-bold text-[var(--ax-danger)] hover:brightness-95">
            <span className="material-symbols-outlined text-[16px]">delete</span>삭제
          </button>
        </div>
      </div>
    </div>
  );
}
