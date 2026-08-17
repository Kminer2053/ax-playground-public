"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PanelBackToMain } from "@/components/panel/PanelBackToMain";
import { sfx } from "@/lib/sfx";
import styles from "./QuizGame.module.css";

const TIME_LIMIT = 15;
// 콤보가 쌓일수록 타이머가 빨라짐(난이도 상승): 10콤보마다 +12%, 최대 3배속.
const COMBO_SPEED_STEP = 0.12;
const MAX_SPEED = 3;
function comboSpeed(combo: number): number {
  return Math.min(MAX_SPEED, 1 + Math.floor(combo / 10) * COMBO_SPEED_STEP);
}

type Question = { id: string; question: string; choices: string[]; answerIndex: number; explanation: string };
type RankRow = { rank: number; nickname: string; score: number; comboMax: number; playedAt: string };
type BoardRow = { rank: number; nickname: string; score: number; comboMax: number };
type Phase = "intro" | "playing" | "result";
type AnswerResult = "correct" | "wrong" | null;

/** 게임 중 실시간 리더보드 폴링(3초) — 캐시된 Top10 + 내 투영순위 + 순위변동 이벤트(속보·하이라이트). */
function useLiveBoard(active: boolean, scoreRef: { current: number }) {
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [projected, setProjected] = useState<{ rank: number; total: number } | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [movers, setMovers] = useState<Set<string>>(new Set());
  const prevRef = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    if (!active) {
      prevRef.current = null;
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/quiz/ranking?limit=10&forScore=${scoreRef.current}`);
        const d = await r.json();
        if (!alive || !d.ok) return;
        const rows: BoardRow[] = d.ranking || [];
        setBoard(rows);
        if (d.projected) setProjected(d.projected);

        const prev = prevRef.current;
        if (prev) {
          const evs: string[] = [];
          const mv = new Set<string>();
          for (const row of rows) {
            const was = prev.get(row.nickname);
            if (was === undefined) {
              evs.push(`🚨 ${row.nickname}님 ${row.rank}위 진입!`);
              mv.add(row.nickname);
            } else if (row.rank < was) {
              mv.add(row.nickname);
              if (row.rank === 1 && was !== 1) evs.push(`👑 ${row.nickname}님 1위 등극!`);
            }
          }
          if (evs.length) setEvents((e) => Array.from(new Set([...evs, ...e])).slice(0, 8));
          setMovers(mv);
        } else if (rows[0]) {
          setEvents([`👑 현재 1위 ${rows[0].nickname} (${rows[0].score.toLocaleString()}점)`]);
        }
        prevRef.current = new Map(rows.map((r) => [r.nickname, r.rank]));
      } catch {
        /* 폴링 실패는 조용히 무시 — 다음 주기에 재시도 */
      }
    };
    void poll();
    const iv = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [active, scoreRef]);

  return { board, projected, events, movers };
}

export function QuizGame() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [q, setQ] = useState<Question | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [comboMax, setComboMax] = useState(0);
  const [picked, setPicked] = useState<number | null>(null); // null=대기, -2=시간초과
  const [gain, setGain] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [cleared, setCleared] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lastResult, setLastResult] = useState<AnswerResult>(null);
  const [fxKey, setFxKey] = useState(0);
  const [milestone, setMilestone] = useState<number | null>(null);

  const [nickname, setNickname] = useState("");
  const [submitted, setSubmitted] = useState<{ rank: number; total: number; nickname: string } | null>(null);
  const [ranking, setRanking] = useState<RankRow[]>([]);
  const [busy, setBusy] = useState(false);

  const askedRef = useRef<string[]>([]);
  const scoreRef = useRef(0);
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  const live = useLiveBoard(phase === "playing", scoreRef);

  const endGame = useCallback((clearedFlag: boolean) => {
    setCleared(clearedFlag);
    setPhase("result");
  }, []);

  const loadNext = useCallback(async () => {
    setPicked(null);
    setLastResult(null);
    try {
      const r = await fetch(`/api/quiz/next?exclude=${encodeURIComponent(askedRef.current.join(","))}`);
      const data = await r.json();
      if (data.exhausted) {
        endGame(true);
        return;
      }
      askedRef.current = [...askedRef.current, data.id];
      setAsked(askedRef.current);
      setQ(data);
      setTimeLeft(TIME_LIMIT);
    } catch {
      endGame(false);
    }
  }, [endGame]);

  const start = useCallback(() => {
    sfx.setEnabled(!muted);
    sfx.start();
    setScore(0); setCombo(0); setComboMax(0); setGain(0);
    setLastResult(null); setFxKey(0);
    askedRef.current = []; setAsked([]);
    setCleared(false); setSubmitted(null); setNickname(""); setRanking([]);
    setQ(null); setPicked(null);
    setPhase("playing");
    void loadNext();
  }, [loadNext, muted]);

  const answer = useCallback((i: number) => {
    if (picked !== null || !q) return;
    setPicked(i);
    setFxKey((k) => k + 1);
    if (i === q.answerIndex) {
      const g = 100 + Math.round(timeLeft) * 5 + combo * 20;
      const nextCombo = combo + 1;
      setGain(g);
      setScore((s) => s + g);
      setCombo(nextCombo);
      setComboMax((m) => Math.max(m, nextCombo));
      setLastResult("correct");
      if (nextCombo % 5 === 0) {
        setMilestone(nextCombo);
        setTimeout(() => setMilestone((m) => (m === nextCombo ? null : m)), 1300);
      }
      if (nextCombo >= 2) sfx.combo(nextCombo); else sfx.correct();
      setTimeout(() => { void loadNext(); }, 750);
    } else {
      setLastResult("wrong");
      sfx.wrong();
      setTimeout(() => endGame(false), 950);
    }
  }, [picked, q, timeLeft, combo, loadNext, endGame]);

  // 카운트다운 타이머 (문제 표시 중, 미응답일 때만)
  useEffect(() => {
    if (phase !== "playing" || !q || picked !== null) return;
    // 콤보 단계에 따라 틱 주기를 짧게 → 같은 0.1초 차감이 더 빨리 흐름.
    const period = Math.max(40, Math.round(100 / comboSpeed(combo)));
    const iv = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 0.1) {
          clearInterval(iv);
          setPicked(-2);
          setLastResult("wrong");
          setFxKey((k) => k + 1);
          sfx.wrong();
          setTimeout(() => endGame(false), 950);
          return 0;
        }
        return Math.round((t - 0.1) * 10) / 10;
      });
    }, period);
    return () => clearInterval(iv);
  }, [phase, q, picked, endGame, combo]);

  // 결과 진입 시 랭킹 미리 로드
  useEffect(() => {
    if (phase !== "result") return;
    void fetch("/api/quiz/ranking?limit=10").then((r) => r.json()).then((d) => setRanking(d.ranking || [])).catch(() => {});
  }, [phase]);

  const submit = useCallback(async () => {
    if (submitted || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/quiz/ranking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, score, comboMax }),
      });
      const d = await r.json();
      if (d.ok) {
        setSubmitted({ rank: d.rank, total: d.total, nickname: d.nickname });
        const rr = await fetch("/api/quiz/ranking?limit=10").then((x) => x.json());
        setRanking(rr.ranking || []);
      }
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  }, [nickname, score, comboMax, submitted, busy]);

  const toggleMute = () => {
    setMuted((m) => { sfx.setEnabled(m); return !m; });
  };

  const header = (
    <div className="flex items-center justify-between py-5">
      <PanelBackToMain className="text-[var(--ax-text-muted)] hover:text-[var(--ax-accent)]" />
      <h1 className="flex items-center gap-2 text-base font-extrabold text-[var(--ax-accent)]">
        <span className="material-symbols-outlined text-[20px]">castle</span>
        AI 리터러시 서바이벌
      </h1>
      <button
        onClick={toggleMute}
        aria-label={muted ? "소리 켜기" : "음소거"}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ax-text-muted)] transition hover:bg-white hover:text-[var(--ax-accent)]"
      >
        <span className="material-symbols-outlined text-[20px]">{muted ? "volume_off" : "volume_up"}</span>
      </button>
    </div>
  );

  if (phase === "playing") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[var(--ax-accent-bg)] to-[var(--ax-page)]">
        {milestone !== null && <MilestoneOverlay key={milestone} combo={milestone} />}
        <div className="mx-auto max-w-[1400px] px-6">{header}</div>
        <Ticker events={live.events} />
        <div className="mx-auto max-w-[1400px] px-6 pb-10">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[260px_minmax(0,1fr)_300px] xl:items-start">
            <div className="hidden xl:block">
              <LeftRail projected={live.projected} board={live.board} score={score} />
            </div>
            <div className="mx-auto w-full max-w-2xl">
              <ReactionStage result={lastResult} combo={combo} gain={gain} fxKey={fxKey} />
              <PlayScreen q={q} picked={picked} timeLeft={timeLeft} onAnswer={answer} qNo={asked.length} score={score} combo={combo} />
            </div>
            <div className="hidden xl:block">
              <RightRail board={live.board} movers={live.movers} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden bg-gradient-to-b from-[var(--ax-accent-bg)] to-[var(--ax-page)]">
      <div className="mx-auto flex h-full max-w-2xl flex-col px-5">
        {header}
        <div className="flex min-h-0 flex-1 flex-col pb-8">
          {phase === "intro" && <IntroScreen onStart={start} />}
          {phase === "result" && (
            <ResultScreen
              score={score} comboMax={comboMax} cleared={cleared}
              nickname={nickname} setNickname={setNickname}
              submitted={submitted} ranking={ranking} busy={busy}
              onSubmit={submit} onRetry={start}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ["#0054a6", "#f59e0b", "#e24b4a", "#1d9e75", "#d4537e", "#7f77dd"];

// 결정적 의사난수(0~1) — 렌더 중 불순한 Math.random 대신 인덱스 기반 해시로 컨페티를 분산.
function rnd(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function MilestoneOverlay({ combo }: { combo: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        left: rnd(i * 1.7) * 100,
        delay: rnd(i * 2.9) * 0.25,
        dur: 1.1 + rnd(i * 3.3) * 0.9,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rot: Math.floor(rnd(i * 5.1) * 360),
      })),
    [],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className={`absolute inset-0 ${styles.mFlash}`} style={{ backgroundColor: "rgba(245,158,11,0.16)" }} />
      {pieces.map((p, i) => (
        <span
          key={i}
          className={styles.confetti}
          style={{ left: `${p.left}%`, backgroundColor: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }}
        />
      ))}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className={`flex flex-col items-center ${styles.mText}`}>
          <div className="text-6xl">🔥</div>
          <div className="mt-1 text-4xl font-black text-[var(--ax-accent)]">{combo} 콤보 달성!</div>
        </div>
      </div>
    </div>
  );
}

type ReactionView = { emoji: string; msg: string; box: string; flames: number; bolt: boolean; shake: boolean; glow: boolean };

function reactionView(result: AnswerResult, combo: number): ReactionView {
  if (result === "wrong")
    return { emoji: "😵", msg: "아쉽다!", box: "bg-[var(--ax-danger-bg)] text-[var(--ax-danger)]", flames: 0, bolt: false, shake: true, glow: false };
  const c = result === "correct";
  if (combo >= 7)
    return { emoji: "😎", msg: c ? "역대급!" : `${combo} 콤보 유지 중`, box: "bg-orange-100 text-orange-700", flames: 2, bolt: true, shake: false, glow: true };
  if (combo >= 4)
    return { emoji: "🤩", msg: c ? "불타오른다!" : `${combo} 콤보 유지 중`, box: "bg-amber-100 text-amber-700", flames: 2, bolt: false, shake: false, glow: false };
  if (combo >= 2)
    return { emoji: "😆", msg: c ? "콤보!" : `${combo} 콤보`, box: "bg-amber-50 text-amber-600", flames: 1, bolt: false, shake: false, glow: false };
  if (c)
    return { emoji: "😄", msg: "정답!", box: "bg-[var(--ax-success-bg)] text-[var(--ax-success)]", flames: 0, bolt: false, shake: false, glow: false };
  return { emoji: "🎯", msg: "집중!", box: "bg-[var(--ax-accent-bg)] text-[var(--ax-accent)]", flames: 0, bolt: false, shake: false, glow: false };
}

function ReactionStage({ result, combo, gain, fxKey }: { result: AnswerResult; combo: number; gain: number; fxKey: number }) {
  const v = reactionView(result, combo);
  return (
    <div className={`relative mb-3 flex h-16 items-center justify-center gap-2 rounded-[var(--ax-radius-lg)] ${v.box} ${v.glow ? styles.glow : ""}`}>
      <span key={fxKey} className={`flex items-center gap-2 ${styles.reactionIn}`}>
        {Array.from({ length: v.flames }).map((_, i) => (
          <span key={`f${i}`} className={styles.flame} style={{ animationDelay: `${i * 0.15}s` }}>🔥</span>
        ))}
        <span className={`text-3xl ${v.shake ? styles.shake : styles.bob}`}>{v.emoji}</span>
        <span className="text-lg font-black">{v.msg}</span>
        {v.bolt && <span className={styles.flame}>⚡</span>}
      </span>
      {result === "correct" && gain > 0 && (
        <span key={`pop${fxKey}`} className={`absolute right-4 top-1 text-base font-black ${styles.pop}`}>+{gain.toLocaleString()}</span>
      )}
    </div>
  );
}

function Ticker({ events }: { events: string[] }) {
  const text = events.length ? events.join(" · ") : "리더보드에 도전자가 모이는 중…";
  return (
    <div className="mx-auto mb-4 max-w-[1400px] px-6">
      <div className="flex items-center gap-3 overflow-hidden rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-3 py-2">
        <span className="flex flex-none items-center gap-1 text-xs font-black text-[var(--ax-danger)]">
          <span className="material-symbols-outlined text-[16px]">campaign</span>속보
        </span>
        <div className="flex-1 overflow-hidden">
          <span className={`${styles.marquee} text-sm text-[var(--ax-danger)]`}>
            {text}&emsp;&emsp;{text}&emsp;&emsp;
          </span>
        </div>
      </div>
    </div>
  );
}

function LeftRail({ projected, board, score }: { projected: { rank: number; total: number } | null; board: BoardRow[]; score: number }) {
  const above = [...board].reverse().find((r) => r.score > score);
  const isTop = projected ? projected.rank === 1 : false;
  return (
    <aside className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-sm">
      <div className="mb-3 text-xs font-bold text-[var(--ax-text-muted)]">내 라이브 순위</div>
      <div className="rounded-[var(--ax-radius)] bg-[var(--ax-accent-bg)] p-3 text-center">
        <div className="text-[11px] text-[var(--ax-accent)]">지금 멈추면</div>
        <div className="text-4xl font-black leading-tight text-[var(--ax-accent)]">{projected ? `${projected.rank}위` : "—"}</div>
        {projected && <div className="text-[11px] text-[var(--ax-text-muted)]">전체 {projected.total.toLocaleString()}명 중</div>}
      </div>
      <div className="mt-3 text-center text-xs leading-relaxed">
        {isTop ? (
          <span className="font-bold text-amber-600">🏆 현재 1위 질주 중!</span>
        ) : above ? (
          <span className="text-[var(--ax-text-muted)]">
            <b className="text-[var(--ax-text)]">{above.nickname}</b> 추월까지{" "}
            <b className="text-[var(--ax-accent)]">{(above.score - score + 1).toLocaleString()}점</b>
          </span>
        ) : (
          <span className="text-[var(--ax-text-hint)]">정답을 맞혀 순위를 올려보세요</span>
        )}
      </div>
      <div className="mt-4 border-t border-[var(--ax-border-soft)] pt-3 text-center text-[11px] text-[var(--ax-text-muted)]">
        현재 점수 <b className="text-[var(--ax-text)]">{score.toLocaleString()}</b>
      </div>
    </aside>
  );
}

function RightRail({ board, movers }: { board: BoardRow[]; movers: Set<string> }) {
  return (
    <aside className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-bold text-[var(--ax-text-muted)]">
          <span className="material-symbols-outlined text-[16px]">emoji_events</span>실시간 랭킹
        </span>
        <span className="flex items-center gap-1 text-[11px] text-[var(--ax-success)]">
          <span className={`${styles.live} inline-block h-1.5 w-1.5 rounded-full bg-[var(--ax-success)]`} />실시간
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {board.length === 0 && (
          <div className="rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)] p-3 text-center text-xs text-[var(--ax-text-hint)]">불러오는 중…</div>
        )}
        {board.map((r) => {
          const moved = movers.has(r.nickname);
          return (
            <div key={`${r.rank}-${r.nickname}`} className={`flex items-center gap-2 rounded-[var(--ax-radius-sm)] px-2 py-1.5 text-xs ${moved ? styles.flash : ""}`}>
              <span className={`w-4 text-center font-black ${r.rank <= 3 ? "text-amber-500" : "text-[var(--ax-text-hint)]"}`}>{r.rank}</span>
              <span className="flex-1 truncate text-[var(--ax-text)]">{r.nickname}</span>
              {moved && <span className="material-symbols-outlined text-[14px] text-[var(--ax-success)]">arrow_upward</span>}
              <span className="font-black text-[var(--ax-text)]">{r.score.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function IntroScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="text-6xl">🏰</div>
      <h2 className="mt-4 text-3xl font-black text-[var(--ax-text)]">AI 리터러시 서바이벌</h2>
      <p className="mt-2 text-[var(--ax-text-muted)]">AI 시대 상식 퀴즈 — 한 문제라도 틀리면 끝!</p>
      <div className="mt-6 w-full max-w-sm rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 text-left shadow-sm">
        <ul className="space-y-2.5 text-sm text-[var(--ax-text)]">
          <li className="flex gap-2"><b className="text-[var(--ax-accent)]">①</b> <span>매 문제 정답 선택 — <b className="text-[var(--ax-danger)]">오답 즉시 종료</b></span></li>
          <li className="flex gap-2"><b className="text-[var(--ax-accent)]">②</b> <span>문제당 <b>{TIME_LIMIT}초</b> 제한 · <b>10콤보마다 타이머 가속</b> (시간초과도 탈락)</span></li>
          <li className="flex gap-2"><b className="text-[var(--ax-accent)]">③</b> <span>빠르게 + 연속 정답(콤보)일수록 고득점 🔥</span></li>
          <li className="flex gap-2"><b className="text-[var(--ax-accent)]">④</b> <span>게임 내내 <b className="text-[var(--ax-accent)]">실시간 순위</b>가 양옆에 표시됩니다 🏆</span></li>
        </ul>
      </div>
      <button
        onClick={onStart}
        className="mt-7 rounded-full bg-[var(--ax-accent)] px-10 py-4 text-lg font-black text-white shadow-md transition hover:bg-[var(--ax-accent-dark)] active:scale-95"
      >
        시작하기 ▶
      </button>
    </div>
  );
}

function PlayScreen({
  q, picked, timeLeft, onAnswer, qNo, score, combo,
}: {
  q: Question | null; picked: number | null; timeLeft: number;
  onAnswer: (i: number) => void; qNo: number; score: number; combo: number;
}) {
  if (!q) {
    return <div className="flex flex-1 items-center justify-center py-16 text-[var(--ax-text-muted)]">문제 불러오는 중…</div>;
  }
  const pct = Math.max(0, (timeLeft / TIME_LIMIT) * 100);
  const danger = timeLeft <= 5;
  const speed = comboSpeed(combo);
  const tier = Math.floor(combo / 10);
  return (
    <div className="flex flex-col">
      {/* HUD: 문제번호 + 점수 (콤보·점수획득 연출은 위 리액션 칸이 담당) */}
      <div className="mb-3 flex items-center justify-between text-sm text-[var(--ax-text-muted)]">
        <span className="rounded-md bg-[var(--ax-accent-bg)] px-2 py-0.5 text-xs font-bold text-[var(--ax-accent)]">Q{qNo}</span>
        <span>점수 <span className="text-xl font-black text-[var(--ax-text)]">{score.toLocaleString()}</span></span>
      </div>
      {/* 타이머바 (콤보가 쌓이면 더 빨리 닳음) */}
      <div className="mb-5">
        {tier > 0 && (
          <div className="mb-1 flex justify-end">
            <span className="animate-pulse rounded-full bg-[var(--ax-danger-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--ax-danger)]">⚡ {speed.toFixed(2)}배속 · {combo}콤보</span>
          </div>
        )}
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--ax-border)]">
          <div
            className={`h-full rounded-full transition-[width] duration-100 ${danger ? "bg-[var(--ax-danger)]" : "bg-[var(--ax-accent)]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {/* 문제 */}
      <div className="mb-6 rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 text-lg font-bold leading-relaxed text-[var(--ax-text)] shadow-sm">{q.question}</div>
      {/* 보기 */}
      <div className="grid gap-3">
        {q.choices.map((c, i) => {
          let cls = "border-[var(--ax-border)] bg-[var(--ax-card)] text-[var(--ax-text)] hover:border-[var(--ax-accent-border)] hover:bg-[var(--ax-accent-bg)]";
          let badge = "bg-[var(--ax-accent-bg)] text-[var(--ax-accent)]";
          if (picked !== null) {
            if (i === q.answerIndex) {
              cls = "border-[var(--ax-success)] bg-[var(--ax-success-bg)] text-[var(--ax-success)]";
              badge = "bg-[var(--ax-success)] text-white";
            } else if (i === picked) {
              cls = "border-[var(--ax-danger)] bg-[var(--ax-danger-bg)] text-[var(--ax-danger)]";
              badge = "bg-[var(--ax-danger)] text-white";
            } else {
              cls = "border-[var(--ax-border)] bg-[var(--ax-card)] text-[var(--ax-text-hint)] opacity-60";
              badge = "bg-[var(--ax-border)] text-[var(--ax-text-hint)]";
            }
          }
          return (
            <button
              key={i}
              disabled={picked !== null}
              onClick={() => onAnswer(i)}
              className={`flex items-center gap-3 rounded-[var(--ax-radius)] border-2 px-4 py-4 text-left text-base font-semibold shadow-sm transition ${cls}`}
            >
              <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-black ${badge}`}>{i + 1}</span>
              <span>{c}</span>
            </button>
          );
        })}
      </div>
      {/* 해설(정답 맞힌 후) */}
      {picked !== null && picked === q.answerIndex && q.explanation && (
        <div className="mt-4 rounded-[var(--ax-radius)] bg-[var(--ax-success-bg)] p-4 text-sm text-[var(--ax-success)]">💡 {q.explanation}</div>
      )}
    </div>
  );
}

function ResultScreen({
  score, comboMax, cleared, nickname, setNickname, submitted, ranking, busy, onSubmit, onRetry,
}: {
  score: number; comboMax: number; cleared: boolean;
  nickname: string; setNickname: (v: string) => void;
  submitted: { rank: number; total: number; nickname: string } | null;
  ranking: RankRow[]; busy: boolean; onSubmit: () => void; onRetry: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="text-center">
        <div className="text-5xl">{cleared ? "🎉" : "💥"}</div>
        <h2 className="mt-2 text-2xl font-black text-[var(--ax-text)]">{cleared ? "올 클리어!" : "게임 오버"}</h2>
        <div className="mt-4 flex justify-center gap-8">
          <div><div className="text-xs text-[var(--ax-text-muted)]">최종 점수</div><div className="text-3xl font-black text-amber-500">{score.toLocaleString()}</div></div>
          <div><div className="text-xs text-[var(--ax-text-muted)]">최대 콤보</div><div className="text-3xl font-black text-[var(--ax-accent)]">{comboMax}</div></div>
        </div>
      </div>

      {/* 닉네임 등록 */}
      {!submitted ? (
        <div className="mt-6 rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-sm">
          <div className="mb-2 text-sm text-[var(--ax-text-muted)]">랭킹에 등록할 닉네임 <span className="text-[var(--ax-text-hint)]">(미입력 시 랜덤 별명)</span></div>
          <div className="flex gap-2">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={24}
              placeholder="닉네임"
              className="flex-1 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-white px-3 py-2 text-sm text-[var(--ax-text)] outline-none transition placeholder:text-[var(--ax-text-hint)] focus:border-[var(--ax-accent-border)] focus:ring-2 focus:ring-[var(--ax-accent-bg)]"
            />
            <button
              onClick={onSubmit}
              disabled={busy}
              className="rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-5 py-2 text-sm font-black text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50"
            >
              {busy ? "등록 중…" : "등록"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[var(--ax-radius-lg)] border border-amber-200 bg-amber-50 p-4 text-center text-[var(--ax-text)]">
          <span className="font-black text-amber-600">{submitted.nickname}</span>
          <span> 님, 전체 {submitted.total}명 중 </span>
          <span className="text-xl font-black text-[var(--ax-accent)]">{submitted.rank}위</span>
          <span> 입니다!</span>
        </div>
      )}

      {/* Top10 랭킹 */}
      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 text-sm font-bold text-[var(--ax-text-muted)]">🏆 실시간 랭킹 TOP 10</div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {ranking.length === 0 && <div className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3 text-center text-sm text-[var(--ax-text-hint)]">아직 기록이 없습니다.</div>}
          {ranking.map((r) => {
            const mine = submitted && r.nickname === submitted.nickname && r.rank === submitted.rank;
            return (
              <div key={`${r.rank}-${r.nickname}`} className={`flex items-center justify-between rounded-[var(--ax-radius)] border px-3 py-2 text-sm ${mine ? "border-amber-300 bg-amber-50 ring-1 ring-amber-200" : "border-[var(--ax-border)] bg-[var(--ax-card)]"}`}>
                <div className="flex items-center gap-3">
                  <span className={`w-6 text-center font-black ${r.rank <= 3 ? "text-amber-500" : "text-[var(--ax-text-hint)]"}`}>{r.rank}</span>
                  <span className="font-semibold text-[var(--ax-text)]">{r.nickname}</span>
                </div>
                <div className="flex items-center gap-3 text-[var(--ax-text-muted)]">
                  <span className="text-xs">🔥{r.comboMax}</span>
                  <span className="font-black text-[var(--ax-text)]">{r.score.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 액션 */}
      <div className="mt-6 flex gap-3">
        <button onClick={onRetry} className="flex-1 rounded-full bg-[var(--ax-accent)] py-3 font-black text-white transition hover:bg-[var(--ax-accent-dark)] active:scale-95">다시 도전 ▶</button>
        <Link href="/" className="flex-1 rounded-full border border-[var(--ax-border)] bg-[var(--ax-card)] py-3 text-center font-bold text-[var(--ax-text-muted)] transition hover:bg-[var(--ax-accent-bg)]">메인으로</Link>
      </div>
    </div>
  );
}
