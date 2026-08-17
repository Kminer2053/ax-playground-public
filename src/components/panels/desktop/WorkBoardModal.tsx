"use client";
/**
 * 스윔레인 보드 전체화면 모달 — 렌더캐시(정적/모션) 인라인. 흐름 재생(모션, 1회 freeze)·줌·접기.
 * 모션 SVG는 캐시 단계에서 id `_m` 접미 처리됨(정적과 공존해도 충돌 없음).
 */
import { useEffect, useRef, useState } from "react";

type BoardData = { svg: string; motionSvg: string | null; audit?: { score?: number } | null; staleRefs?: number };

export default function WorkBoardModal({ taskId, title, onClose }: { taskId: string; title: string; onClose: () => void }) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [err, setErr] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1150);
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/work100/board/${encodeURIComponent(taskId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setBoard(d))
      .catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [taskId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 재생: 모션 주입 후 SMIL 타임라인 0으로(1회 재생 후 freeze 유지)
  useEffect(() => {
    if (!playing || !holderRef.current) return;
    const svg = holderRef.current.querySelector("svg") as (SVGSVGElement & { setCurrentTime?: (t: number) => void }) | null;
    if (svg?.setCurrentTime) svg.setCurrentTime(0);
  }, [playing, board]);

  const html = playing && board?.motionSvg ? board.motionSvg : board?.svg ?? "";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0705]/97" role="dialog" aria-modal="true">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200/15 px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-amber-50">{title}</h2>
          <p className="text-[11px] text-amber-200/50">내부 업무 절차(자동 생성 후보){board?.audit?.score != null ? ` · 구성점수 ${board.audit.score}` : ""}</p>
          {/* 근거가 개정으로 격리되면 이 흐름도도 낡았을 수 있다. 내용은 그대로 두고 사실만 알린다. */}
          {!!board?.staleRefs && (
            <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-200">
              <span aria-hidden>⚠</span> 근거 확인 필요 {board.staleRefs}건 — 관련 규정이 개정되어 재검토 중입니다
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setPlaying((p) => !p)}
            disabled={!board?.motionSvg}
            className="rounded-lg border border-amber-300/40 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
          >{playing ? "⟲ 다시 재생" : "▶ 흐름 재생"}</button>
          <button onClick={() => setZoom((z) => Math.max(650, z - 150))} className="h-8 w-8 rounded-lg border border-amber-200/20 text-amber-100 hover:bg-white/5">−</button>
          <button onClick={() => setZoom((z) => Math.min(1800, z + 150))} className="h-8 w-8 rounded-lg border border-amber-200/20 text-amber-100 hover:bg-white/5">+</button>
          <button onClick={() => setZoom((holderRef.current?.parentElement?.clientWidth ?? 1150) - 40)} className="rounded-lg border border-amber-200/20 px-2.5 py-1.5 text-xs text-amber-100 hover:bg-white/5">맞춤</button>
          <button onClick={onClose} className="ml-1 rounded-lg border border-amber-200/25 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-white/5">접기 ✕</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {err ? (
          <div className="flex h-full items-center justify-center text-amber-100/60 text-sm">보드를 불러올 수 없습니다.</div>
        ) : !board ? (
          <div className="flex h-full items-center justify-center text-amber-100/60 text-sm">보드 불러오는 중…</div>
        ) : (
          <div className="flex justify-center">
            <div
              ref={holderRef}
              key={playing ? "motion" : "static"}
              style={{ width: zoom, maxWidth: "none" }}
              className="[&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
