"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  MAP_W, MAP_H, BUILDINGS, ADMIN_HIDDEN, LEADERBOARD_BOX, type Building,
} from "@/lib/playground-map";
import { AdminEntryModal } from "./AdminEntryModal";

/** ?dev=1 여부 (effect 없이 읽기). */
function useDevMode(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("dev") === "1",
    () => false,
  );
}

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/**
 * 레이어 합성 메인. 배경(base-map) 위에 건물 PNG를 절대배치.
 * 호버/포커스 → 해당 건물만 노란 조명 + 살짝 떠오름. 클릭 → 즉시 이동.
 * 히든 매표소 5연속 클릭 → 관리자 모달.
 */
export function MainMap({ buildings = BUILDINGS, onEnter }: { buildings?: Building[]; onEnter?: (b: Building) => void }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const devMode = useDevMode();
  const [adminOpen, setAdminOpen] = useState(false);
  const [ticketTaps, setTicketTaps] = useState<number[]>([]);
  const [board, setBoard] = useState<{ rank: number; nickname: string; score: number }[]>([]);

  // 전광판 리더보드 — Top5 (P3)
  useEffect(() => {
    void fetch("/api/quiz/ranking?limit=5")
      .then((r) => r.json())
      .then((d) => setBoard(d.ranking || []))
      .catch(() => {});
  }, []);

  const go = (b: Building) => {
    if (onEnter) return onEnter(b);
    if (b.external) return void window.open(b.href, "_blank", "noopener,noreferrer");
    router.push(b.href);
  };

  const onTicket = (ts: number) => {
    const recent = [...ticketTaps.filter((t) => ts - t < 3000), ts];
    if (recent.length >= 5) {
      setTicketTaps([]);
      setAdminOpen(true);
    } else {
      setTicketTaps(recent);
    }
  };

  return (
    <div className="relative mx-auto w-full select-none" style={{ maxWidth: `min(${MAP_W}px, calc((100dvh - 112px) * ${MAP_W} / ${MAP_H}))`, aspectRatio: `${MAP_W}/${MAP_H}` }}>
      {/* 배경 베이스 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/playground/base-map.png" alt="AX Playground" className="block w-full h-full" draggable={false} />

      {/* 건물 레이어 */}
      {buildings.map((b) => {
        const active = hover === b.id;
        return (
          <button
            key={b.id}
            type="button"
            aria-label={b.label}
            className={`axp-building${active ? " axp-building-active" : ""}`}
            style={{ left: pct(b.left, MAP_W), top: pct(b.top, MAP_H), width: pct(b.width, MAP_W) }}
            onMouseEnter={() => setHover(b.id)}
            onMouseLeave={() => setHover((h) => (h === b.id ? null : h))}
            onFocus={() => setHover(b.id)}
            onBlur={() => setHover((h) => (h === b.id ? null : h))}
            onClick={() => go(b)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.image} alt={b.label} className="block w-full h-auto" draggable={false} />
            {/* 라벨 카드 (번호+이름+설명) — 항상 표시 */}
            <span
              className="axp-building-label"
              style={{
                borderColor: b.color,
                // 성(1번)은 전광판 바로 밑(성 본체 0.84)에 — CSS 클래스 대신 인라인(Turbopack CSS HMR 회피)
                ...(b.id === "quiz" ? { top: "84%", bottom: "auto", marginTop: 0, marginBottom: 0 } : {}),
              }}
            >
              <span className="axp-no" style={{ background: b.color }}>{b.no}</span>
              <span className="axp-label-text">
                <span className="axp-label-title" style={{ color: b.color }}>{b.label}</span>
                <span className="axp-label-desc">{b.desc}</span>
              </span>
            </span>
          </button>
        );
      })}

      {/* 리더보드 오버레이 (성 전광판 위) — P3에서 실데이터 연결 */}
      <div
        className="absolute z-20 flex flex-col items-center justify-center rounded-md bg-[#16224a]/80 text-white pointer-events-none"
        style={{
          left: pct(LEADERBOARD_BOX.left, MAP_W),
          top: pct(LEADERBOARD_BOX.top, MAP_H),
          width: pct(LEADERBOARD_BOX.width, MAP_W),
          height: pct(LEADERBOARD_BOX.height, MAP_H),
        }}
      >
        <div className="font-black leading-none" style={{ fontSize: "1.05vw", color: "#fde68a" }}>🏆 실시간 랭킹</div>
        {board.length === 0 ? (
          <div className="leading-tight" style={{ fontSize: "0.64vw", color: "#fcd34d", marginTop: "6px" }}>첫 도전자가 되어보세요!</div>
        ) : (
          <div style={{ width: "90%", marginTop: "6px" }}>
            {board.map((r) => (
              <div key={r.rank} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.62vw", lineHeight: 1.65 }}>
                <span style={{ color: r.rank <= 3 ? "#fde68a" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "76%" }}>
                  {r.rank}. {r.nickname}
                </span>
                <span style={{ color: "#fff", fontWeight: 800 }}>{r.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 히든 매표소 클릭영역 (배경 위 투명) */}
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <polygon
          points={ADMIN_HIDDEN.points}
          fill={devMode ? "rgba(255,0,0,0.25)" : "transparent"}
          stroke={devMode ? "red" : "transparent"}
          style={{ pointerEvents: "auto", cursor: "default" }}
          onClick={(e) => onTicket(e.timeStamp)}
        />
        {devMode &&
          buildings.map((b) => (
            <rect
              key={b.id}
              x={b.left}
              y={b.top}
              width={b.width}
              height={b.height}
              fill="none"
              stroke="rgba(0,150,255,0.5)"
              strokeDasharray="6 4"
            />
          ))}
      </svg>

      {devMode && (
        <div className="absolute left-2 top-2 z-30 rounded bg-black/70 px-2 py-1 text-xs text-yellow-300">
          DEV — 파란 점선=건물 배치박스, 빨강=히든. 어긋나면 lib/playground-map.ts 보정.
        </div>
      )}

      {adminOpen && <AdminEntryModal onClose={() => setAdminOpen(false)} />}
    </div>
  );
}
