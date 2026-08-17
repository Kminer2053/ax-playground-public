"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 매표소 히든 진입(또는 메뉴 관리자 타일) — 암호키 입력 후 /admin 이동. */
export function AdminEntryModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
        credentials: "include",
      });
      if (r.ok) {
        router.push("/admin");
        return;
      }
      setErr((await r.json().catch(() => ({})))?.error ?? "인증 실패");
    } catch {
      setErr("서버 연결 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-80 space-y-4 rounded-[var(--ax-radius-lg)] bg-[var(--ax-card)] p-6 shadow-xl">
        <div className="text-center">
          <div className="text-3xl">🎟️</div>
          <h2 className="mt-1 text-lg font-black text-[var(--ax-text)]">관리자 입장</h2>
          <p className="mt-1 text-xs text-[var(--ax-text-hint)]">암호키를 입력하세요</p>
        </div>
        {err && <p className="rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-3 py-2 text-xs text-[var(--ax-danger)]">{err}</p>}
        <input type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} className="w-full rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-white px-3 py-2 text-sm text-[var(--ax-text)] outline-none transition placeholder:text-[var(--ax-text-hint)] focus:border-[var(--ax-accent-border)] focus:ring-2 focus:ring-[var(--ax-accent-bg)]" />
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-[var(--ax-radius)] border border-[var(--ax-border)] px-4 py-2 text-sm font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">취소</button>
          <button type="submit" disabled={busy || !key.trim()} className="flex-1 rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-4 py-2 text-sm font-black text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-40">{busy ? "확인…" : "입장"}</button>
        </div>
      </form>
    </div>
  );
}
