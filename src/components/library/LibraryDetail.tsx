"use client";

import { useRef, useState } from "react";
import type { Dir } from "@/lib/voterId";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { LIBRARY_FILE_ACCEPT } from "@/lib/libraryFileTypes";

export type Board = "prompt" | "video" | "file";
export type Comment = { id: string; author: string; content: string; createdAt: string; hasPassword: boolean };
export type Attachment = { name: string; size: number; url: string };
export type Card = {
  id: string;
  board: Board;
  title: string;
  content: string;
  usage: string;
  author: string;
  thumbnailUrl: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  attachments: Attachment[];
  up: number;
  down: number;
  viewCount: number;
  downloadCount: number;
  pinned: boolean;
  hasPassword: boolean;
  comments: Comment[];
  createdAt: string;
  ago?: string;
};

export function fmtSize(b: number): string {
  if (!b) return "";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}
export function dateOnly(iso: string): string {
  return (iso || "").slice(0, 10);
}
export function timeAgo(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const day = 86400000;
  const diff = nowMs - t;
  if (diff < day) return "오늘";
  const days = Math.floor(diff / day);
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}
export function fileMeta(name: string): { icon: string; color: string; cat: string } {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return { icon: "picture_as_pdf", color: "var(--ax-danger)", cat: "PDF" };
  if (ext === "hwp" || ext === "hwpx") return { icon: "description", color: "var(--ax-accent)", cat: "한글" };
  if (ext === "doc" || ext === "docx") return { icon: "description", color: "#2b579a", cat: "문서" };
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return { icon: "table_view", color: "var(--ax-success)", cat: "표" };
  if (ext === "ppt" || ext === "pptx") return { icon: "slideshow", color: "var(--ax-warning)", cat: "슬라이드" };
  if (ext === "zip") return { icon: "folder_zip", color: "var(--ax-text-muted)", cat: "압축" };
  return { icon: "draft", color: "var(--ax-text-muted)", cat: "기타" };
}

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      {children}
    </div>
  );
}

function VoteButtons({ card, myVote, onVote }: { card: Card; myVote: Dir | null; onVote: (id: string, dir: Dir) => void }) {
  return (
    <div className="flex gap-1.5">
      <button onClick={() => onVote(card.id, "up")} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${myVote === "up" ? "bg-[var(--ax-success-bg)] text-[var(--ax-success)]" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)] hover:bg-[var(--ax-border)]"}`}><span className="material-symbols-outlined text-[16px]">thumb_up</span>{card.up}</button>
      <button onClick={() => onVote(card.id, "down")} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${myVote === "down" ? "bg-[var(--ax-danger-bg)] text-[var(--ax-danger)]" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)] hover:bg-[var(--ax-border)]"}`}><span className="material-symbols-outlined text-[16px]">thumb_down</span>{card.down}</button>
    </div>
  );
}

/* ───────── 댓글 ───────── */

function Comments({ card, admin }: { card: Card; admin: boolean }) {
  const [list, setList] = useState<Comment[]>(card.comments || []);
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/library/${card.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author, content, password: pw }),
      });
      const d = await r.json();
      if (d.ok) { setList((l) => [...l, d.comment]); setContent(""); setPw(""); }
    } finally { setBusy(false); }
  };

  const del = async (c: Comment) => {
    let password = "";
    if (!admin) {
      if (!c.hasPassword) { window.alert("비밀번호가 설정된 댓글만 본인이 삭제할 수 있습니다."); return; }
      password = window.prompt("댓글 비밀번호") || "";
      if (!password) return;
    } else if (!window.confirm("이 댓글을 삭제할까요?")) return;
    const r = await fetch(`/api/library/${card.id}/comments/${c.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (r.ok) setList((l) => l.filter((x) => x.id !== c.id));
    else window.alert("삭제 실패 — 비밀번호를 확인하세요.");
  };

  return (
    <div className="mt-5 border-t border-[var(--ax-border-soft)] pt-4">
      <div className="mb-3 text-sm font-bold text-[var(--ax-text)]">댓글 {list.length}</div>
      <div className="flex flex-col gap-2.5">
        {list.length === 0 && <div className="text-sm text-[var(--ax-text-hint)]">첫 댓글을 남겨보세요.</div>}
        {list.map((c) => (
          <div key={c.id} className="flex items-start gap-2 rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)] p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-[var(--ax-text-hint)]"><span className="font-bold text-[var(--ax-text-muted)]">{c.author}</span>{dateOnly(c.createdAt)}</div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--ax-text)]">{c.content}</div>
            </div>
            {(admin || c.hasPassword) && (
              <button onClick={() => del(c)} aria-label="댓글 삭제" className="material-symbols-outlined text-[16px] text-[var(--ax-text-hint)] hover:text-[var(--ax-danger)]">close</button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white p-2.5">
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} maxLength={1000} placeholder="댓글 입력…" className="w-full resize-none text-sm text-[var(--ax-text)] outline-none placeholder:text-[var(--ax-text-hint)]" />
        <div className="mt-2 flex items-center gap-2">
          <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={24} placeholder="닉네임(선택)" className="w-28 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] px-2 py-1 text-xs outline-none" />
          <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" maxLength={32} placeholder="삭제 비번(선택)" className="w-28 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] px-2 py-1 text-xs outline-none" />
          <button onClick={add} disabled={busy || !content.trim()} className="ml-auto flex items-center gap-1 rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-4 py-1.5 text-sm font-bold text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50"><span className="material-symbols-outlined text-[16px]">send</span>등록</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── 상세 패널 (하단 인라인, 보드별) ───────── */

export function PostDetail({
  card, admin, myVote, onVote, onDownload, onEdit, onDeleted, onClose,
}: {
  card: Card; admin: boolean; myVote: Dir | null;
  onVote: (id: string, dir: Dir) => void;
  onDownload: (c: Card) => void;
  onEdit: (c: Card) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [popup, setPopup] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const copy = () => {
    void copyToClipboard(card.content).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } else {
        window.alert("복사에 실패했습니다. 아래 프롬프트 텍스트를 직접 선택해 복사해 주세요.");
      }
    });
  };

  const canManage = admin || card.hasPassword;
  const del = async () => {
    let password = "";
    if (!admin) {
      if (!card.hasPassword) { window.alert("비밀번호가 설정된 게시물만 본인이 삭제할 수 있습니다. (관리자는 가능)"); return; }
      password = window.prompt("게시물 비밀번호") || "";
      if (!password) return;
    } else if (!window.confirm("이 게시물을 삭제할까요?")) return;
    const r = await fetch(`/api/library/${card.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (r.ok) onDeleted();
    else window.alert("삭제 실패 — 비밀번호를 확인하세요.");
  };

  return (
    <div className="mt-6 scroll-mt-6 rounded-[var(--ax-radius-lg)] border border-[var(--ax-accent-border)] bg-[var(--ax-card)] p-5 shadow-md">
      {/* 헤더 */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {card.pinned && <span className="material-symbols-outlined text-[16px] text-[var(--ax-warning)]">push_pin</span>}
            <h2 className="text-lg font-black text-[var(--ax-text)]">{card.title}</h2>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ax-text-hint)]">
            {card.author} · <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">visibility</span>{card.viewCount || 0}</span> · {dateOnly(card.createdAt)}
          </div>
        </div>
        <div className="flex flex-none items-center gap-1">
          {canManage && <button onClick={() => onEdit(card)} title="수정" className="material-symbols-outlined rounded-[var(--ax-radius)] px-2 py-1.5 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">edit</button>}
          {canManage && <button onClick={del} title="삭제" className="material-symbols-outlined rounded-[var(--ax-radius)] px-2 py-1.5 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-danger-bg)] hover:text-[var(--ax-danger)]">delete</button>}
          <button onClick={onClose} aria-label="닫기" className="material-symbols-outlined rounded-[var(--ax-radius)] px-2 py-1.5 text-[20px] text-[var(--ax-text-hint)] hover:bg-[var(--ax-border-soft)]">close</button>
        </div>
      </div>

      {/* 보드별 본문 */}
      {card.board === "prompt" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-h-[180px] items-center justify-center overflow-hidden rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)]">
            {card.thumbnailUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={card.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              : <div className="flex flex-col items-center gap-1 text-[var(--ax-text-hint)]"><span className="material-symbols-outlined text-[30px]">image</span><span className="text-xs">예시 이미지 없음</span></div>}
          </div>
          <div className="flex flex-col">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)] p-3 font-mono text-sm leading-relaxed text-[var(--ax-text)]">{card.content}</pre>
            {card.usage && <div className="mt-2 flex items-start gap-1.5 rounded-[var(--ax-radius)] bg-[var(--ax-accent-bg)] p-2.5 text-xs text-[var(--ax-accent)]"><span className="material-symbols-outlined text-[15px]">lightbulb</span>{card.usage}</div>}
            <div className="mt-3 flex items-center gap-2">
              <button onClick={copy} className="flex items-center gap-1.5 rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--ax-accent-dark)]"><span className="material-symbols-outlined text-[16px]">content_copy</span>{copied ? "복사됨 ✓" : "프롬프트 복사"}</button>
              <VoteButtons card={card} myVote={myVote} onVote={onVote} />
            </div>
          </div>
        </div>
      )}

      {card.board === "video" && (
        <div>
          <video ref={videoRef} controls src={card.fileUrl || undefined} poster={card.thumbnailUrl || undefined} className="aspect-video w-full rounded-[var(--ax-radius)] bg-black" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setPopup(true)} className="flex items-center gap-1.5 rounded-[var(--ax-radius)] bg-[var(--ax-accent-bg)] px-3 py-1.5 text-sm font-bold text-[var(--ax-accent)] transition hover:bg-[var(--ax-accent-soft)]"><span className="material-symbols-outlined text-[16px]">open_in_new</span>팝업 재생</button>
            <button onClick={() => videoRef.current?.requestFullscreen?.()} className="flex items-center gap-1.5 rounded-[var(--ax-radius)] bg-[var(--ax-accent-bg)] px-3 py-1.5 text-sm font-bold text-[var(--ax-accent)] transition hover:bg-[var(--ax-accent-soft)]"><span className="material-symbols-outlined text-[16px]">fullscreen</span>전체화면</button>
            <div className="ml-auto"><VoteButtons card={card} myVote={myVote} onVote={onVote} /></div>
          </div>
          {card.content && <div className="mt-3 whitespace-pre-wrap rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)] p-3 text-sm leading-relaxed text-[var(--ax-text-muted)]">{card.content}</div>}
        </div>
      )}

      {card.board === "file" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="whitespace-pre-wrap rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)] p-4 text-sm leading-relaxed text-[var(--ax-text)]">{card.content}</div>
          <div>
            <div className="mb-2 flex items-center gap-1 text-xs font-bold text-[var(--ax-text-muted)]"><span className="material-symbols-outlined text-[15px]">attach_file</span>첨부파일 {card.attachments?.length || 0}</div>
            <div className="flex flex-col gap-1.5">
              {(card.attachments || []).map((a, i) => {
                const m = fileMeta(a.name);
                return (
                  <a key={i} href={a.url} download={a.name} onClick={() => onDownload(card)} className="flex items-center gap-2 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white p-2 transition hover:border-[var(--ax-accent-border)] hover:bg-[var(--ax-accent-bg)]">
                    <span className="material-symbols-outlined text-[22px]" style={{ color: m.color }}>{m.icon}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[var(--ax-text)]">{a.name}</span><span className="block text-xs text-[var(--ax-text-hint)]">{fmtSize(a.size)}</span></span>
                    <span className="material-symbols-outlined text-[18px] text-[var(--ax-accent)]">download</span>
                  </a>
                );
              })}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--ax-text-hint)]">
              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">download</span>다운로드 {card.downloadCount || 0}</span>
              <VoteButtons card={card} myVote={myVote} onVote={onVote} />
            </div>
          </div>
        </div>
      )}

      <Comments card={card} admin={admin} />

      {popup && (
        <Overlay onClose={() => setPopup(false)}>
          <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <video controls autoPlay src={card.fileUrl || undefined} poster={card.thumbnailUrl || undefined} className="aspect-video w-full rounded-[var(--ax-radius)] bg-black" />
          </div>
        </Overlay>
      )}
    </div>
  );
}

/* ───────── 등록/수정 폼 ───────── */

export function PostForm({
  mode, board, card, admin, onClose, onDone,
}: {
  mode: "new" | "edit"; board: Board; card?: Card; admin: boolean; onClose: () => void; onDone: () => void;
}) {
  const editing = mode === "edit";
  const [title, setTitle] = useState(card?.title || "");
  const [content, setContent] = useState(card?.content || "");
  const [usage, setUsage] = useState(card?.usage || "");
  const [author, setAuthor] = useState("");
  const [password, setPassword] = useState("");
  const [thumb, setThumb] = useState<File | null>(null);
  const [removeThumb, setRemoveThumb] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [removeAttachmentUrls, setRemoveAttachmentUrls] = useState<string[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const b = card?.board || board;
  const labels: Record<Board, string> = { prompt: "프롬프트 도서관", video: "영상 자료실", file: "자료실" };
  const contentLabel = b === "prompt" ? "프롬프트 내용" : b === "video" ? "설명" : "상세 내용";
  const inputCls = "w-full rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-white px-3 py-2 text-sm text-[var(--ax-text)] outline-none transition placeholder:text-[var(--ax-text-hint)] focus:border-[var(--ax-accent-border)] focus:ring-2 focus:ring-[var(--ax-accent-bg)]";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) { setErr("제목과 내용을 입력하세요."); return; }
    setBusy(true); setErr("");
    try {
      if (editing) {
        const hasThumbChange = !!thumb || removeThumb;
        const hasFileChange = b === "file" && (files.length > 0 || removeAttachmentUrls.length > 0);
        if (b === "file") {
          const remain = (card!.attachments?.length || 0) - removeAttachmentUrls.length + files.length;
          if (remain < 1) { setErr("첨부 파일을 1개 이상 유지하세요."); setBusy(false); return; }
          if (remain > 10) { setErr("첨부 파일은 최대 10개까지입니다."); setBusy(false); return; }
        }
        let r: Response;
        if (hasThumbChange || hasFileChange) {
          const fd = new FormData();
          fd.set("title", title.trim());
          fd.set("content", content.trim());
          fd.set("usage", usage.trim());
          if (!admin) fd.set("password", password);
          if (thumb) fd.set("thumbnail", thumb);
          if (removeThumb) fd.set("removeThumbnail", "1");
          if (b === "file") {
            files.forEach((f) => fd.append("files", f));
            if (removeAttachmentUrls.length) fd.set("removeAttachments", JSON.stringify(removeAttachmentUrls));
          }
          r = await fetch(`/api/library/${card!.id}`, { method: "PATCH", body: fd });
        } else {
          r = await fetch(`/api/library/${card!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title.trim(), content: content.trim(), usage: usage.trim(), password: admin ? undefined : password }),
          });
        }
        const d = await r.json();
        if (d.ok) onDone(); else setErr(d.error || "수정 실패");
      } else {
        if (b === "video" && !video) { setErr("영상 파일을 첨부하세요."); setBusy(false); return; }
        if (b === "file" && files.length === 0) { setErr("첨부 파일을 1개 이상 추가하세요."); setBusy(false); return; }
        const fd = new FormData();
        fd.set("board", b); fd.set("title", title.trim()); fd.set("content", content.trim());
        fd.set("usage", usage.trim()); fd.set("author", author.trim()); fd.set("password", password);
        if (thumb) fd.set("thumbnail", thumb);
        if (b === "video" && video) fd.set("file", video);
        if (b === "file") files.forEach((f) => fd.append("files", f));
        const r = await fetch("/api/library", { method: "POST", body: fd });
        const d = await r.json();
        if (d.ok) onDone(); else setErr(d.error || "등록 실패");
      }
    } catch { setErr("서버 연결 실패"); } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--ax-radius-lg)] bg-[var(--ax-card)] p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-black text-[var(--ax-accent)]">{labels[b]} {editing ? "수정" : "등록"}</h2>
        {err && <p className="mb-3 rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-3 py-2 text-sm text-[var(--ax-danger)]">{err}</p>}

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">제목 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls} />
        </label>

        {editing && (
          <div className="mb-3 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">{b === "video" ? "썸네일/포스터" : "썸네일/대표 이미지"}</span>
            {card?.thumbnailUrl && !removeThumb && (
              <div className="mb-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.thumbnailUrl} alt="" className="h-20 w-20 rounded-[var(--ax-radius-sm)] object-cover" />
                <button type="button" onClick={() => { setRemoveThumb(true); setThumb(null); }} className="text-xs font-semibold text-[var(--ax-danger)] hover:underline">현재 썸네일 삭제</button>
              </div>
            )}
            {removeThumb && <p className="mb-2 text-xs text-[var(--ax-text-muted)]">저장 시 썸네일이 제거됩니다.</p>}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { setThumb(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setRemoveThumb(false); }} className="w-full text-sm text-[var(--ax-text-muted)]" />
            <p className="mt-1 text-xs text-[var(--ax-text-hint)]">새 파일을 선택하면 기존 썸네일을 교체합니다.</p>
          </div>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">{contentLabel} *</span>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={b === "prompt" ? 5 : 3} className={`${inputCls} resize-y`} />
        </label>
        {b === "prompt" && (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">사용 방법 (선택)</span>
            <input value={usage} onChange={(e) => setUsage(e.target.value)} placeholder="예: {회사명}을 실제 이름으로 바꿔 사용" className={inputCls} />
          </label>
        )}

        {!editing && b === "video" && (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">영상 파일 (mp4/webm) *</span>
            <input type="file" accept="video/mp4,video/webm,video/ogg" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} className="w-full text-sm text-[var(--ax-text-muted)]" />
          </label>
        )}
        {!editing && b === "file" && (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">첨부 파일 * <span className="font-normal text-[var(--ax-text-hint)]">(여러 개 선택 가능, 이미지 포함)</span></span>
            <input type="file" multiple accept={LIBRARY_FILE_ACCEPT} onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])} className="w-full text-sm text-[var(--ax-text-muted)]" />
            {files.length > 0 && <div className="mt-1 text-xs text-[var(--ax-text-muted)]">{files.length}개 선택 · {fmtSize(files.reduce((s, f) => s + f.size, 0))}</div>}
          </label>
        )}
        {editing && b === "file" && (
          <div className="mb-3 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">첨부 파일 *</span>
            <div className="mb-2 flex flex-col gap-1.5">
              {(card?.attachments || []).filter((a) => !removeAttachmentUrls.includes(a.url)).map((a) => (
                <div key={a.url} className="flex items-center gap-2 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-white px-2.5 py-2 text-xs">
                  <span className="material-symbols-outlined text-[18px] text-[var(--ax-accent)]">{fileMeta(a.name).icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--ax-text)]">{a.name}</span>
                  <span className="text-[var(--ax-text-hint)]">{fmtSize(a.size)}</span>
                  <button type="button" onClick={() => setRemoveAttachmentUrls((arr) => [...arr, a.url])} className="text-[var(--ax-danger)] hover:underline">삭제</button>
                </div>
              ))}
              {removeAttachmentUrls.length > 0 && (
                <p className="text-xs text-[var(--ax-text-muted)]">삭제 예정 {removeAttachmentUrls.length}개 · 저장 시 반영</p>
              )}
            </div>
            <input type="file" multiple accept={LIBRARY_FILE_ACCEPT} onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])} className="w-full text-sm text-[var(--ax-text-muted)]" />
            {files.length > 0 && <div className="mt-1 text-xs text-[var(--ax-text-muted)]">추가 {files.length}개 · {fmtSize(files.reduce((s, f) => s + f.size, 0))}</div>}
          </div>
        )}
        {!editing && (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">{b === "video" ? "썸네일/포스터" : "썸네일/대표 이미지"} (선택)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setThumb(e.target.files?.[0] ?? null)} className="w-full text-sm text-[var(--ax-text-muted)]" />
          </label>
        )}

        {!editing && (
          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">작성자 (선택 — 미입력 시 랜덤 별명)</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={24} className={inputCls} />
          </label>
        )}

        {(!editing || !admin) && (
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-bold text-[var(--ax-text)]">비밀번호 {editing ? "*" : "(선택 — 본인 수정/삭제용)"}</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" maxLength={32} placeholder={editing ? "작성 시 설정한 비밀번호" : "수정·삭제 시 필요"} className={inputCls} />
          </label>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-[var(--ax-radius)] border border-[var(--ax-border)] py-2.5 text-sm font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">취소</button>
          <button type="submit" disabled={busy} className="flex-1 rounded-[var(--ax-radius)] bg-[var(--ax-accent)] py-2.5 text-sm font-black text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">{busy ? "처리 중…" : editing ? "수정" : "등록"}</button>
        </div>
      </form>
    </Overlay>
  );
}
