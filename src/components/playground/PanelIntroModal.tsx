"use client";

import { useEffect, useState } from "react";
import { PANEL_ICON } from "@/lib/playground-map";
import {
  PANEL_BADGE_LABEL,
  resolvePanelIntro,
  type PanelBadgeKind,
  type PanelIntro,
} from "@/lib/panel-intro";

/** globals.css `.axp-splash-bar` 의 var(--axp-splash-ms, 3500ms) 기본값과 동일하게 유지. */
const AUTO_MS = 3500;

/**
 * 기여자·배지는 관리자 설정(DB)에서 온다. 스플래시는 3.5초 후 자동 입장하므로
 * 코드 기본값으로 즉시 그리고, 공개 API 응답이 오면 갈아끼운다(탭 수명 동안 1회만 요청).
 */
let introCache: Promise<Record<string, PanelIntro>> | null = null;
function loadPanelIntro(): Promise<Record<string, PanelIntro>> {
  introCache ??= fetch("/api/panel-intro")
    .then((r) => r.json())
    .then((d) => (d?.ok && d.panels ? (d.panels as Record<string, PanelIntro>) : resolvePanelIntro(null)))
    .catch(() => resolvePanelIntro(null));
  return introCache;
}

export type IntroTarget = { id: string; label: string; color: string; href: string; external?: boolean };

/**
 * 패널 진입 시 뜨는 타이틀 스플래시(패키지 프로그램 기동 화면 컨셉).
 * 로고(아이콘) · 서비스 소개 · 개발 배경 · 기여자(아이디어/코드개발).
 * 매 진입 자동입장(3.5s) — 클릭/들어가기 시 즉시 입장, ✕ 시 입장 취소.
 */
export function PanelIntroModal({
  target,
  onEnter,
  onCancel,
}: {
  target: IntroTarget;
  onEnter: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onEnter, AUTO_MS);
    return () => clearTimeout(t);
  }, [onEnter]);

  const [panels, setPanels] = useState<Record<string, PanelIntro>>(() => resolvePanelIntro(null));
  useEffect(() => {
    let alive = true;
    void loadPanelIntro().then((p) => { if (alive) setPanels(p); });
    return () => { alive = false; };
  }, []);

  const info = panels[target.id];
  const icon = PANEL_ICON[target.id] ?? "apps";
  const c = target.color;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${target.label} 소개`}
      onClick={onEnter}
    >
      <div
        className="axp-splash relative w-[440px] max-w-full rounded-[var(--ax-radius-lg)] bg-[var(--ax-card)] p-8 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 취소(입장 안 함) */}
        <button
          type="button"
          aria-label="닫기"
          onClick={onCancel}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-[var(--ax-text-hint)] transition hover:bg-[var(--ax-border-soft)] hover:text-[var(--ax-text)]"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: 18 }}>close</span>
        </button>

        {/* 로고(아이콘) */}
        <div className="axp-splash-logo mx-auto flex h-24 w-24 items-center justify-center rounded-[28px]" style={{ background: `${c}16` }}>
          <span className="material-symbols-outlined leading-none" style={{ fontSize: 54, color: c }}>{icon}</span>
        </div>

        {/* 패널명 */}
        <h2 className="axp-splash-t mt-4 text-[22px] font-black leading-tight" style={{ color: c }}>{target.label}</h2>

        {/* 출처 배지 (경진대회 수상 / 수요조사 발굴) */}
        {info?.badge && <SplashBadge badge={info.badge} />}

        {/* 서비스 소개 */}
        <p className="axp-splash-i mx-auto mt-2 max-w-[330px] text-sm leading-relaxed text-[var(--ax-text-muted)]">{info?.intro}</p>

        {/* 개발 배경 */}
        {info?.background && (
          <div className="axp-splash-s mt-5 text-left">
            <div className="text-xs font-bold tracking-wide text-[var(--ax-text-hint)]">개발 배경</div>
            <div className="mt-1 text-[13px] leading-relaxed text-[var(--ax-text-muted)]">{info.background}</div>
          </div>
        )}

        {/* 기여자 */}
        <div className="axp-splash-s mt-3 space-y-1.5 text-left">
          <Credit label="아이디어" people={info?.ideaBy} color={c} />
          <Credit label="코드개발" people={info?.codeBy} color={c} />
        </div>

        {/* 들어가기 */}
        <button
          type="button"
          onClick={onEnter}
          className="axp-splash-b mt-6 h-11 w-full rounded-[var(--ax-radius)] text-sm font-black text-white shadow transition hover:brightness-95"
          style={{ background: c }}
        >
          들어가기 →
        </button>

        {/* 자동입장 진행바 */}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--ax-border-soft)]">
          <div className="axp-splash-bar h-full rounded-full" style={{ background: c }} />
        </div>
        <div className="mt-1.5 text-[11px] text-[var(--ax-text-hint)]">잠시 후 자동으로 입장합니다 · 클릭 시 바로 입장</div>
      </div>
    </div>
  );
}

/** 출처 배지 — 골드(경진대회 수상) / 바이올렛(CEO 지시사항) / 스카이(수요조사 발굴). */
function SplashBadge({ badge }: { badge: PanelBadgeKind }) {
  const s =
    badge === "contest"
      ? { icon: "emoji_events", fg: "#b45309", bg: "#f59e0b1f", bd: "#f59e0b40" }
      : badge === "ceo"
        ? { icon: "campaign", fg: "#6d28d9", bg: "#8b5cf61f", bd: "#8b5cf640" }
        : { icon: "manage_search", fg: "#0369a1", bg: "#0ea5e91f", bd: "#0ea5e940" };
  const text = PANEL_BADGE_LABEL[badge];
  return (
    <div
      className="axp-splash-t mx-auto mt-2.5 flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold"
      style={{ color: s.fg, background: s.bg, borderColor: s.bd }}
    >
      <span className="material-symbols-outlined leading-none" style={{ fontSize: 15 }}>{s.icon}</span>
      {text}
    </div>
  );
}

function Credit({ label, people, color }: { label: string; people?: string[]; color: string }) {
  if (!people?.length) return null;
  return (
    <div className="flex items-center gap-2 rounded-[var(--ax-radius-sm)] bg-[var(--ax-border-soft)] px-3 py-2 text-[13px]">
      <span className="min-w-[56px] font-bold" style={{ color }}>{label}</span>
      <span className="text-[var(--ax-text)]">{people.join(", ")}</span>
    </div>
  );
}
