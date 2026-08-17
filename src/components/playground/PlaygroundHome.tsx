"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { MainMap } from "./MainMap";
import { AdminEntryModal } from "./AdminEntryModal";
import { PanelIntroModal, type IntroTarget } from "./PanelIntroModal";
import { NoticePopup } from "./NoticePopup";
import { BUILDINGS, PANEL_ICON, type Building } from "@/lib/playground-map";

type Mode = "map" | "menu";
const STORAGE_KEY = "axp-main-mode";
const EVT = "axp-mode-change";

/** localStorage 모드 구독 (effect 없이 SSR-safe). */
function useMode(): [Mode, (m: Mode) => void] {
  const mode = useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => (localStorage.getItem(STORAGE_KEY) === "menu" ? "menu" : "map"),
    () => "map" as Mode, // SSR 기본값
  );
  const set = (m: Mode) => {
    localStorage.setItem(STORAGE_KEY, m);
    window.dispatchEvent(new Event(EVT));
  };
  return [mode, set];
}

/** 메인 — 그래픽(이미지맵) / 메뉴(타일) 토글. 선택은 localStorage 저장. */
export function PlaygroundHome({ buildings = BUILDINGS }: { buildings?: Building[] }) {
  const [mode, setMode] = useMode();
  const router = useRouter();
  const [adminOpen, setAdminOpen] = useState(false);
  const [intro, setIntro] = useState<IntroTarget | null>(null);

  const enter = (t: IntroTarget) => {
    // 기관 웹앱 연계(관리자 설정 externalUrl) — 스플래시 없이 새 탭. 플레이그라운드는 유지.
    if (t.external) {
      window.open(t.href, "_blank", "noopener,noreferrer");
      return;
    }
    // 매출분석은 허브(중간 패널)로 직행 — 패널 소개 스플래시는 허브에서 도구 선택 시 표시.
    if (t.id === "sales") {
      router.push(t.href);
      return;
    }
    setIntro(t);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      {/* 공지 팝업 — 첫 접속 시. 실패해도 홈은 그대로 동작한다. */}
      <NoticePopup />
      <div className="mx-auto flex h-dvh max-w-[1672px] flex-col overflow-hidden px-4 py-4">
        {/* 중앙 모드 토글 */}
        <div className="mb-4 flex shrink-0 items-center justify-center">
          <div className="inline-flex rounded-full border border-[var(--brand-blue)]/20 bg-white p-1 shadow-sm">
            {(["map", "menu"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded-full px-6 py-2 text-sm font-bold transition ${
                  mode === m ? "bg-[var(--brand-blue)] text-white shadow" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {m === "map" ? "🎡 그래픽" : "☰ 메뉴"}
              </button>
            ))}
          </div>
        </div>

        {mode === "map" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <MainMap buildings={buildings} onEnter={(b) => enter(b)} />
          </div>
        ) : (
          <MenuTiles buildings={buildings} onEnter={(t) => enter(t)} onAdmin={() => setAdminOpen(true)} />
        )}
      </div>
      {adminOpen && <AdminEntryModal onClose={() => setAdminOpen(false)} />}
      {intro && (
        <PanelIntroModal
          target={intro}
          onEnter={() => {
            const href = intro.href;
            setIntro(null);
            router.push(href);
          }}
          onCancel={() => setIntro(null)}
        />
      )}
    </div>
  );
}

type Tile = { id: string; no: number; label: string; desc: string; color: string; icon: string; href: string; external?: boolean; admin?: boolean };

/** 10개 패널 카드타일(아이콘+컬러) — 최적 해상도(lg)에서 5×2로 화면을 가득 채운다. */
function MenuTiles({ buildings, onEnter, onAdmin }: { buildings: Building[]; onEnter: (t: IntroTarget) => void; onAdmin: () => void }) {
  const tiles: Tile[] = [
    ...buildings.map((b) => ({ id: b.id, no: b.no, label: b.label, desc: b.desc, color: b.color, icon: PANEL_ICON[b.id] ?? "apps", href: b.href, external: b.external })),
    { id: "admin", no: 10, label: "관리자", desc: "콘텐츠·데이터 관리", color: "#475569", icon: "admin_panel_settings", href: "/admin", admin: true },
  ];
  return (
    <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:[grid-template-rows:1fr_1fr]">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => (t.admin ? onAdmin() : onEnter({ id: t.id, label: t.label, color: t.color, href: t.href, external: t.external }))}
          aria-label={t.label}
          className="group relative flex min-h-[190px] flex-col items-center justify-center gap-5 rounded-3xl border bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          style={{ borderColor: `${t.color}29` }}
        >
          {/* 번호 */}
          <span className="absolute right-5 top-4 text-base font-black text-[var(--ax-text-hint)]">{t.no}</span>
          {/* 아이콘 타일 */}
          <span className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-[28px] transition group-hover:scale-105" style={{ background: `${t.color}16` }}>
            <span className="material-symbols-outlined leading-none" style={{ fontSize: 60, color: t.color }}>{t.icon}</span>
          </span>
          {/* 라벨 */}
          <span className="block w-full">
            <span className="block text-[22px] font-black leading-tight" style={{ color: t.color }}>{t.label}</span>
            <span className="mt-1.5 block text-sm leading-snug text-gray-500">{t.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
