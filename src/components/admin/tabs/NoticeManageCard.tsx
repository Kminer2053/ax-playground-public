"use client";

/**
 * 공지 관리 — 첫 접속 팝업에 띄울 내용을 여기서 쓴다.
 *
 * 게시 기간을 두면 지난 공지를 지우지 않아도 자동으로 내려간다. 내용을 고치면 이미 닫아둔
 * 사용자에게도 다시 뜬다(모델의 updatedAt 기준) — 바뀐 안내가 숨어 있으면 안 된다.
 */

import { useCallback, useEffect, useState } from "react";

type Notice = {
  id: string; title: string; content: string; imageUrl: string; isActive: boolean;
  startAt: string; endAt: string; pinned: number;
  createdAt?: string; updatedAt?: string;
};
type Draft = { title: string; content: string; imageUrl: string; isActive: boolean; startAt: string; endAt: string; pinned: number };

const EMPTY: Draft = { title: "", content: "", imageUrl: "", isActive: true, startAt: "", endAt: "", pinned: 0 };

/** 지금 사용자에게 보이는지 — 활성 + 기간 안. 관리자가 "왜 안 뜨지"를 바로 알 수 있게 한다. */
function liveState(n: Notice): { live: boolean; why: string } {
  if (!n.isActive) return { live: false, why: "비활성" };
  const now = new Date().toISOString().slice(0, 10);
  if (n.startAt && n.startAt > now) return { live: false, why: `${n.startAt}부터` };
  if (n.endAt && n.endAt < now) return { live: false, why: `${n.endAt} 종료` };
  return { live: true, why: "게시 중" };
}

export function NoticeManageCard() {
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);   // id 또는 "new"
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/admin/notices", { cache: "no-store" }).then((r) => r.json());
      if (j.ok) setItems(j.items);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = useCallback(async (file: File) => {
    setBusy(true); setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const j = await fetch("/api/admin/notices/upload", { method: "POST", body: fd }).then((r) => r.json());
      if (!j.ok) { setMsg(`업로드 실패 — ${j.error ?? "알 수 없는 오류"}`); return; }
      setDraft((d) => ({ ...d, imageUrl: j.url }));
      setMsg(`이미지 첨부됨 (${Math.round(j.size / 1024)}KB)`);
    } finally { setBusy(false); }
  }, []);

  const save = useCallback(async () => {
    if (!draft.title.trim() || !draft.content.trim()) { setMsg("제목과 내용을 입력하세요."); return; }
    setBusy(true); setMsg("");
    try {
      const isNew = editing === "new";
      const j = await fetch(isNew ? "/api/admin/notices" : `/api/admin/notices/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }).then((r) => r.json());
      if (!j.ok) { setMsg(`실패 — ${j.error ?? "알 수 없는 오류"}`); return; }
      setMsg(isNew ? "등록했습니다." : "수정했습니다. 이미 닫은 사용자에게도 다시 표시됩니다.");
      setEditing(null); setDraft(EMPTY);
      await load();
    } finally { setBusy(false); }
  }, [draft, editing, load]);

  const toggle = useCallback(async (n: Notice) => {
    setBusy(true);
    try {
      await fetch(`/api/admin/notices/${n.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !n.isActive }),
      });
      await load();
    } finally { setBusy(false); }
  }, [load]);

  const del = useCallback(async (n: Notice) => {
    if (!window.confirm(`「${n.title}」 공지를 삭제할까요?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/notices/${n.id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }, [load]);

  return (
    <div className="rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">공지 팝업</h3>
          <p className="mt-0.5 text-xs text-[var(--ax-text-muted)]">첫 접속 시 메인 화면에 띄웁니다. 사용자는 [오늘 하루 보지 않기]로 넘길 수 있습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-[var(--ax-accent)]">{msg}</span>}
          <button
            onClick={() => { setEditing("new"); setDraft(EMPTY); setMsg(""); }}
            className="rounded-lg bg-[var(--ax-accent)] px-3 py-1.5 text-xs font-bold text-white"
          >
            + 새 공지
          </button>
        </div>
      </div>

      {editing && (
        <div className="mb-3 space-y-2 rounded-lg border border-[var(--ax-border)] bg-[var(--ax-border-soft)] p-3">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="제목"
            className="w-full rounded-md border border-[var(--ax-border)] bg-[var(--ax-card)] px-2.5 py-1.5 text-sm"
          />
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="내용 (줄바꿈이 그대로 표시됩니다)"
            rows={5}
            className="w-full rounded-md border border-[var(--ax-border)] bg-[var(--ax-card)] px-2.5 py-1.5 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              이미지
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
                disabled={busy}
                className="text-xs"
              />
            </label>
            {draft.imageUrl && (
              <span className="flex items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- 폐쇄망 로컬 업로드 경로 */}
                <img src={draft.imageUrl} alt="" className="h-10 rounded border border-[var(--ax-border)] object-contain" />
                <button onClick={() => setDraft({ ...draft, imageUrl: "" })} className="text-[var(--ax-text-muted)] hover:text-[#d14343]">제거</button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              게시 시작
              <input type="date" value={draft.startAt} onChange={(e) => setDraft({ ...draft, startAt: e.target.value })} className="rounded border border-[var(--ax-border)] bg-[var(--ax-card)] px-1.5 py-1" />
            </label>
            <label className="flex items-center gap-1">
              종료
              <input type="date" value={draft.endAt} onChange={(e) => setDraft({ ...draft, endAt: e.target.value })} className="rounded border border-[var(--ax-border)] bg-[var(--ax-card)] px-1.5 py-1" />
            </label>
            <span className="text-[var(--ax-text-muted)]">비워두면 제한 없음</span>
            <label className="ml-auto flex items-center gap-1">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              활성
            </label>
            <label className="flex items-center gap-1">
              우선순위
              <input type="number" value={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: Number(e.target.value) || 0 })} className="w-16 rounded border border-[var(--ax-border)] bg-[var(--ax-card)] px-1.5 py-1" />
            </label>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => void save()} disabled={busy} className="rounded-md bg-[var(--ax-accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {busy ? "저장 중…" : "저장"}
            </button>
            <button onClick={() => { setEditing(null); setDraft(EMPTY); }} className="rounded-md border border-[var(--ax-border)] px-3 py-1.5 text-xs">취소</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-4 text-center text-xs text-[var(--ax-text-muted)]">불러오는 중…</p>
      ) : !items.length ? (
        <p className="py-4 text-center text-xs text-[var(--ax-text-muted)]">등록된 공지가 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((n) => {
            const st = liveState(n);
            return (
              <li key={n.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs ${st.live ? "bg-[#e6f6ec] text-[#1d7a44]" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]"}`}>{st.why}</span>
                {n.imageUrl && <span className="text-xs text-[var(--ax-text-muted)]" title="이미지 포함">🖼</span>}
                <span className="font-medium">{n.title}</span>
                {!!n.pinned && <span className="text-xs text-[var(--ax-text-muted)]">우선 {n.pinned}</span>}
                {(n.startAt || n.endAt) && <span className="text-xs text-[var(--ax-text-muted)]">{n.startAt || "…"} ~ {n.endAt || "…"}</span>}
                <span className="ml-auto flex gap-1">
                  <button
                    onClick={() => { setEditing(n.id); setDraft({ title: n.title, content: n.content, imageUrl: n.imageUrl || "", isActive: n.isActive, startAt: n.startAt, endAt: n.endAt, pinned: n.pinned }); setMsg(""); }}
                    className="rounded border border-[var(--ax-border)] px-2 py-0.5 text-xs hover:bg-[var(--ax-border-soft)]"
                  >
                    수정
                  </button>
                  <button onClick={() => void toggle(n)} disabled={busy} className="rounded border border-[var(--ax-border)] px-2 py-0.5 text-xs hover:bg-[var(--ax-border-soft)] disabled:opacity-50">
                    {n.isActive ? "내리기" : "게시"}
                  </button>
                  <button onClick={() => void del(n)} disabled={busy} className="rounded border border-[var(--ax-border)] px-2 py-0.5 text-xs text-[#d14343] hover:bg-[#fdeaea] disabled:opacity-50">
                    삭제
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
