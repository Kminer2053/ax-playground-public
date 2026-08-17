"use client";

import { useState } from "react";

/**
 * 관리자 암호키 입력 게이트 — 미인증 상태에서 표시.
 * 성공 시 세션(admin=true)이 발급되고 페이지를 새로고침한다.
 */
export function AdminKeyGate() {
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
        window.location.reload();
        return;
      }
      const d = await r.json().catch(() => ({}));
      setErr(d.error ?? "인증에 실패했습니다.");
    } catch {
      setErr("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[var(--ax-accent-bg)] to-[var(--ax-page)] px-4">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-6 shadow-sm">
        <div className="text-center">
          <span className="material-symbols-outlined text-[34px] text-[var(--ax-accent)]">lock</span>
          <h1 className="mt-1 text-lg font-black text-[var(--ax-text)]">관리자 인증</h1>
          <p className="mt-1 text-xs text-[var(--ax-text-hint)]">관리자 암호키를 입력하세요</p>
        </div>
        {err && <p className="rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-3 py-2 text-xs text-[var(--ax-danger)]">{err}</p>}
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          placeholder="암호키"
          className="w-full rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-white px-3 py-2 text-sm text-[var(--ax-text)] outline-none transition placeholder:text-[var(--ax-text-hint)] focus:border-[var(--ax-accent-border)] focus:ring-2 focus:ring-[var(--ax-accent-bg)]"
        />
        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="w-full rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-4 py-2 text-sm font-black text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-40"
        >
          {busy ? "확인 중…" : "진입"}
        </button>
      </form>
    </div>
  );
}
