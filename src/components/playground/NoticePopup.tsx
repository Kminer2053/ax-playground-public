"use client";

/**
 * 공지 팝업 — 첫 접속 시 안내를 띄운다.
 *
 * 무로그인이라 "읽음"을 서버에 남길 수 없어 브라우저가 기억한다. 기억하는 키는 `id:rev`라서
 * 관리자가 공지를 고치면 rev가 바뀌어 닫아둔 사람에게도 다시 뜬다 — 바뀐 내용이 숨어 있으면 안 된다.
 *
 * [오늘 하루 보지 않기]는 날짜까지 함께 기록하고, [닫기]는 이번 방문만 넘긴다(sessionStorage).
 */

import { useCallback, useEffect, useState } from "react";

type Notice = { id: string; title: string; content: string; imageUrl?: string; rev: number; date: string };

const DAY_KEY = "axp-notice-hidden";      // { "<id>:<rev>": "YYYY-MM-DD" } — 그날 하루 숨김
const SESSION_KEY = "axp-notice-closed";  // 이번 방문에서 닫은 것

const today = () => new Date().toISOString().slice(0, 10);

/** 본문 속 URL만 클릭 가능한 링크로 — 텍스트를 토큰으로 쪼개 렌더하므로(innerHTML 미사용) XSS 여지가 없다.
 *  꼬리 구두점(문장 끝 마침표·괄호)은 링크에서 떼어 본문에 남긴다. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((p, i) => {
    if (!/^https?:\/\//.test(p)) return p;
    const m = p.match(/[.,)\]}>;:!?]+$/);
    const url = m ? p.slice(0, -m[0].length) : p;
    const tail = m ? m[0] : "";
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--ax-accent)] underline underline-offset-2 hover:opacity-80">
          {url}
        </a>
        {tail}
      </span>
    );
  });
}
const readJson = (store: Storage, key: string): Record<string, string> => {
  try { return JSON.parse(store.getItem(key) || "{}") as Record<string, string>; } catch { return {}; }
};

export function NoticePopup() {
  const [items, setItems] = useState<Notice[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const j = await fetch("/api/notices/active", { cache: "no-store" }).then((r) => r.json());
        if (!alive || !j.ok) return;
        const hidden = readJson(localStorage, DAY_KEY);
        const closed = readJson(sessionStorage, SESSION_KEY);
        const now = today();
        const list = (j.items as Notice[]).filter((n) => {
          const k = `${n.id}:${n.rev}`;
          return hidden[k] !== now && !closed[k];
        });
        setItems(list);
      } catch { /* 공지는 부가 기능 — 실패해도 홈은 그대로 쓴다 */ }
    })();
    return () => { alive = false; };
  }, []);

  const cur = items[idx];

  const close = useCallback((hideToday: boolean) => {
    if (!cur) return;
    const k = `${cur.id}:${cur.rev}`;
    if (hideToday) {
      const m = readJson(localStorage, DAY_KEY);
      m[k] = today();
      localStorage.setItem(DAY_KEY, JSON.stringify(m));
    }
    const s = readJson(sessionStorage, SESSION_KEY);
    s[k] = "1";
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setIdx((i) => i + 1);
  }, [cur]);

  // Esc로 닫기 — 모달을 키보드로 빠져나갈 수 있어야 한다.
  useEffect(() => {
    if (!cur) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, close]);

  if (!cur) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="axp-notice-title"
      onClick={() => close(false)}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--ax-border)] px-5 py-3.5">
          <div className="min-w-0">
            <p className="mb-0.5 text-xs font-bold text-[var(--ax-accent)]">공지사항</p>
            <h2 id="axp-notice-title" className="truncate text-lg font-bold text-[var(--ax-text)]">{cur.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {items.length > 1 && <span className="text-xs text-[var(--ax-text-muted)]">{idx + 1}/{items.length}</span>}
            <button onClick={() => close(false)} aria-label="닫기" className="text-xl leading-none text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]">×</button>
          </div>
        </div>

        <div className="max-h-[52vh] overflow-auto px-5 py-4">
          {/* 이미지는 본문 위에. 세로로 길어도 모달을 밀지 않도록 높이를 묶는다. */}
          {cur.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 폐쇄망 로컬 업로드 경로라 next/image 최적화 대상이 아니다
            <img
              src={cur.imageUrl}
              alt=""
              className="mb-3 max-h-[32vh] w-full rounded-lg object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ax-text)]">{linkify(cur.content)}</p>
          <p className="mt-3 text-xs text-[var(--ax-text-muted)]">{cur.date}</p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--ax-border)] px-5 py-3">
          <button onClick={() => close(true)} className="text-xs text-[var(--ax-text-muted)] hover:text-[var(--ax-text)] hover:underline">
            오늘 하루 보지 않기
          </button>
          <button onClick={() => close(false)} className="rounded-lg bg-[var(--ax-accent)] px-4 py-1.5 text-sm font-bold text-white">
            {idx + 1 < items.length ? "다음" : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
