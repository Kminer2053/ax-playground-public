"use client";
/**
 * 지식/업무 통합 셸 — 상단 중앙 토글 [업무탐색 | 지식검색].
 * 기본 업무탐색(3D). 지식검색은 기존 PanelKnowledge(embedded). 선택은 localStorage(axp-knowledge-view) 유지.
 * 지식검색 → 업무탐색 전환 시 게임식 로딩 오버레이(씬 최초 구성 비용과 결합). 업무탐색 → 지식검색은 즉시.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelBackToMain } from "@/components/panel/PanelBackToMain";
import { PanelKnowledge } from "./PanelKnowledge";
import WorkExplore3D from "./WorkExplore3D";
import WorkTaskPanel from "./WorkTaskPanel";

type View = "explore" | "search";
const KEY = "axp-knowledge-view";
const LOAD_STEPS = ["무한성 공간 구성 중 — 다다미 적층…", "부서 포켓·통로 개통…", "업무 큐브 배치…"];

export function KnowledgeShell() {
  const [view, setView] = useState<View>("search");
  const [mounted, setMounted] = useState(false);
  const [exploreReady, setExploreReady] = useState(false); // 씬 최초 1회 생성 후 유지
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const loadTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 초기 뷰 복원(SSR 안전 — 마운트 후). 기본값=지식검색, 직전 선택이 업무탐색일 때만 탐색으로 복원.
  useEffect(() => {
    setMounted(true);
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const v: View = saved === "explore" ? "explore" : "search";
    setView(v);
    if (v === "explore") setExploreReady(true);
  }, []);

  const go = useCallback(
    (v: View) => {
      if (v === view) return;
      localStorage.setItem(KEY, v);
      if (v === "explore" && !exploreReady) {
        // 게임식 로딩 연출 — 씬 최초 생성과 결합(재전환 시 생략)
        setLoading(true);
        setLoadStep(0);
        setView("explore");
        setExploreReady(true);
        let i = 0;
        loadTimer.current = setInterval(() => {
          i += 1;
          if (i >= LOAD_STEPS.length) {
            if (loadTimer.current) clearInterval(loadTimer.current);
            setTimeout(() => setLoading(false), 420);
          } else setLoadStep(i);
        }, 620);
      } else {
        setView(v);
        if (v === "search") setSelectedTask(null);
      }
    },
    [view, exploreReady],
  );

  useEffect(() => () => { if (loadTimer.current) clearInterval(loadTimer.current); }, []);

  // 지식검색 답변의 "관련 업무" 카드 → 업무탐색 전환 + 해당 업무 선택(패널·카메라)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const taskId = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (!taskId) return;
      go("explore");
      setSelectedTask(taskId);
      // 씬 카메라 이동(씬이 이미 떠 있으면 즉시, 최초 생성 중이면 씬 로드 후 무시돼도 패널은 열림)
      setTimeout(() => window.dispatchEvent(new CustomEvent("axp-work-select", { detail: { taskId } })), 400);
    };
    window.addEventListener("axp-work-open", onOpen);
    return () => window.removeEventListener("axp-work-open", onOpen);
  }, [go]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--ax-page)]">
      {/* 공통 상단 바 — 뒤로가기(좌) + 중앙 토글 */}
      <div className="relative z-20 flex shrink-0 items-center justify-between px-4 py-3">
        <PanelBackToMain className="text-[var(--ax-text-muted)] hover:text-[var(--ax-accent)]" />
        <div className="inline-flex rounded-full border border-[var(--brand-blue)]/20 bg-white/95 p-1 shadow-sm backdrop-blur">
          {(["explore", "search"] as const).map((v) => (
            <button
              key={v}
              onClick={() => go(v)}
              aria-pressed={mounted && view === v}
              className={`rounded-full px-6 py-2 text-sm font-bold transition ${
                mounted && view === v ? "bg-[var(--brand-blue)] text-white shadow" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {v === "explore" ? "🧊 업무탐색" : "🔎 지식검색"}
            </button>
          ))}
        </div>
        <div className="w-12" />
      </div>

      {/* 본문 — 두 화면은 완전히 상이(레이아웃 비공유). 씬은 최초 생성 후 유지(display 토글) */}
      <div className="relative min-h-0 flex-1">
        {exploreReady && (
          <div className={view === "explore" ? "absolute inset-0" : "hidden"}>
            <WorkExplore3D onSelectTask={setSelectedTask} />
            {selectedTask && (
              <WorkTaskPanel
                taskId={selectedTask}
                onClose={() => setSelectedTask(null)}
                onAsk={(query) => {
                  // 업무탐색 → 지식검색 전환 + 질문 프리필(패널이 이벤트로 수신)
                  go("search");
                  setTimeout(() => window.dispatchEvent(new CustomEvent("axp-knowledge-ask", { detail: { query } })), 50);
                }}
              />
            )}
          </div>
        )}
        <div className={view === "search" ? "absolute inset-0" : "hidden"}>
          <PanelKnowledge embedded />
        </div>
      </div>

      {/* 게임식 로딩 오버레이 */}
      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0a0705]/95 text-amber-100">
          <div className="mb-5 h-8 w-8 animate-spin rounded-full border-2 border-amber-200/30 border-t-amber-300" />
          <p className="text-sm font-semibold tracking-wide">{LOAD_STEPS[loadStep]}</p>
          <div className="mt-4 flex gap-1.5">
            {LOAD_STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 w-8 rounded-full ${i <= loadStep ? "bg-amber-300" : "bg-amber-200/20"}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgeShell;
