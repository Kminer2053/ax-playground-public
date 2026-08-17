"use client";

import { useState } from "react";
import { LlmSpinner } from "@/components/llm/LlmSpinner";

/**
 * 생성형 결과물 만족도 피드백 바(👍/👎 + 불만 사유·이미지 모달) — 지식검색과 동일 UX.
 * 문서작성·안전관리·민원답변·도안심의 공용. 결과물이 확정된 시점의 결과 하단에 배치한다.
 *
 *  - payload: 서버에 함께 저장할 맥락(question=사용자 입력/지시, answer=AI 산출물, 그 외 메타).
 *    panel별로 question/answer의 의미가 달라도 스키마는 동일 — 관리자 분석에서 panel로 구분.
 *  - endpoint: 기본 /api/feedback(생성형 4패널). 지식검색은 자체 구현 사용.
 *  - resetKey: 값이 바뀌면(새 결과 생성 시) 피드백 상태를 초기화 — 결과마다 새로 받도록.
 */
export type FeedbackPayload = {
  panel: "docs" | "safety" | "cs" | "ad";
  question?: string;
  answer?: string;
  intent?: string;
  citations?: string[];
};

export function FeedbackBar({ payload, resetKey }: { payload: FeedbackPayload; resetKey?: string }) {
  const [sent, setSent] = useState(false);
  const [downOpen, setDownOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState(resetKey);

  // 새 결과가 나오면(resetKey 변경) 렌더 중 상태 초기화 — useEffect 없이 파생 리셋.
  if (resetKey !== lastKey) {
    setLastKey(resetKey);
    setSent(false); setDownOpen(false); setReason(""); setImage(null);
  }

  const send = async (rating: "up" | "down", why = "", img: File | null = null) => {
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("panel", payload.panel);
      fd.set("rating", rating);
      fd.set("question", payload.question ?? "");
      fd.set("answer", payload.answer ?? "");
      if (payload.intent) fd.set("intent", payload.intent);
      if (payload.citations?.length) fd.set("citations", JSON.stringify(payload.citations));
      if (why) fd.set("reason", why);
      if (img) fd.set("image", img);
      await fetch("/api/feedback", { method: "POST", body: fd });
      setSent(true); setDownOpen(false); setReason(""); setImage(null);
    } catch { /* 전송 실패는 조용히 무시(UX 방해 방지) */ }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--ax-border)] pt-2.5">
        {sent ? (
          <span className="flex items-center gap-1 text-xs text-[var(--ax-text-muted)]"><span className="material-symbols-outlined text-[15px] text-[var(--ax-accent)]">check_circle</span>피드백 감사합니다.</span>
        ) : (
          <>
            <span className="text-xs text-[var(--ax-text-muted)]">이 결과가 도움이 되었나요?</span>
            <button type="button" onClick={() => send("up")} disabled={busy} title="도움됨" className="inline-flex items-center rounded-full border border-[var(--ax-border)] px-2.5 py-1 text-[var(--ax-text-muted)] transition hover:border-[var(--ax-accent)] hover:bg-[var(--ax-accent-bg)] hover:text-[var(--ax-accent)] disabled:opacity-50"><span className="material-symbols-outlined text-[15px]">thumb_up</span></button>
            <button type="button" onClick={() => setDownOpen(true)} disabled={busy} title="아쉬움" className="inline-flex items-center rounded-full border border-[var(--ax-border)] px-2.5 py-1 text-[var(--ax-text-muted)] transition hover:border-[#d14343] hover:bg-[#fdeaea] hover:text-[#d14343] disabled:opacity-50"><span className="material-symbols-outlined text-[15px]">thumb_down</span></button>
          </>
        )}
        <span className="ml-auto text-[10px] text-[var(--ax-text-hint)]">AI도 실수할 수 있습니다.</span>
      </div>

      {downOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setDownOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-[var(--ax-text)]"><span className="material-symbols-outlined text-[18px] text-[#d14343]">thumb_down</span>어떤 점이 아쉬웠나요?</div>
            <p className="mb-2 text-xs text-[var(--ax-text-muted)]">불만족 사유와 참고 이미지를 남겨주시면 품질 개선에 활용합니다.</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="예: 내용이 사실과 다릅니다 / 형식이 맞지 않습니다 / 핵심이 빠졌습니다 등"
              className="w-full resize-y rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)] focus:bg-white" />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--ax-text-muted)]">
              <span className="material-symbols-outlined text-[16px]">image</span>참고 이미지(선택)
              <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="text-xs" />
            </label>
            {image && <p className="mt-1 truncate text-[11px] text-[var(--ax-text-hint)]">{image.name}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setDownOpen(false)} disabled={busy} className="rounded-lg border border-[var(--ax-border)] px-3 py-1.5 text-sm text-[var(--ax-text-muted)] disabled:opacity-50">취소</button>
              <button type="button" onClick={() => send("down", reason.trim(), image)} disabled={busy || (!reason.trim() && !image)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ax-accent)] px-3 py-1.5 text-sm font-bold text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">
                {busy && <LlmSpinner className="h-3.5 w-3.5" accentClass="border-t-white border-white/25" />}제출
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
