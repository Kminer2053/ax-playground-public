"use client";

// HWPX 미리보기 — @rhwp/core(Rust/WASM)로 hwpx 바이트를 SVG로 렌더한다.
// 폐쇄망: WASM(/rhwp_bg.wasm)은 같은 출처에서 로드(외부 fetch 0). 클라이언트 전용.
// 6MB WASM은 이 컴포넌트가 처음 마운트될 때만 동적 import(지연 로드)된다.
// 한 쪽을 화면 높이에 맞춰(fit-to-height) 보여주고, 여러 쪽은 ‹ N/총 › 페이지 넘김.

import { useEffect, useRef, useState } from "react";

type RhwpModule = typeof import("@rhwp/core");

/**
 * 렌더된 SVG를 host에 innerHTML로 주입하기 전 살균한다(DOM XSS 방어).
 * hwpx는 사용자 업로드/LLM 생성물이므로, <script>·이벤트 핸들러(on*)·javascript: 링크를 제거한다.
 * (레이아웃 요소는 보존 — foreignObject 내부의 스크립트/핸들러도 아래 순회로 함께 제거됨.)
 */
function sanitizeSvg(svg: string): string {
  if (!svg) return "";
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.getElementsByTagName("parsererror").length) return ""; // 파싱 실패 → 렌더 안 함(안전측)
    doc.querySelectorAll("script").forEach((el) => el.remove());
    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const val = attr.value.replace(/\s+/g, "").toLowerCase();
        if (name.startsWith("on")) el.removeAttribute(attr.name);
        else if ((name === "href" || name === "xlink:href") && (val.startsWith("javascript:") || val.startsWith("data:text/html"))) el.removeAttribute(attr.name);
      }
    });
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch {
    return "";
  }
}

let rhwpPromise: Promise<RhwpModule> | null = null;

// WASM 1회 초기화 + 텍스트폭 측정 콜백 등록(렌더 레이아웃에 필수).
function ensureRhwp(): Promise<RhwpModule> {
  if (rhwpPromise) return rhwpPromise;
  rhwpPromise = (async () => {
    const mod = await import("@rhwp/core");
    const g = globalThis as unknown as {
      measureTextWidth?: (font: string, text: string) => number;
    };
    if (typeof g.measureTextWidth !== "function") {
      let ctx: CanvasRenderingContext2D | null = null;
      let lastFont = "";
      g.measureTextWidth = (font: string, text: string) => {
        if (!ctx) ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return 0;
        if (font !== lastFont) {
          ctx.font = font;
          lastFont = font;
        }
        return ctx.measureText(text).width;
      };
    }
    await mod.default({ module_or_path: "/rhwp_bg.wasm" });
    return mod;
  })().catch((e) => {
    rhwpPromise = null; // 실패 시 다음 시도에서 재초기화
    throw e;
  });
  return rhwpPromise;
}

/** 미리보기 탭이 처음 열릴 때 미리 WASM을 준비(체감 지연 감소)용 — 선택. */
export function preloadHwpxRenderer(): void {
  void ensureRhwp().catch(() => {});
}

type Status = "idle" | "loading" | "ready" | "error";

type Win = { svg: string; vb: string | null }; // 표시 단위(쪽). vb=윈도 viewBox(null이면 원본).

// 보도자료·시행문은 한컴 줄 위치 캐시(linesegarray)가 없어 rhwp가 A4 한 쪽 경계에서 내용을
// 잘라먹는다(한컴은 자체 reflow로 정상). 렌더 전 페이지 높이를 키우면(tall) rhwp가 전체를
// 한 쪽에 펼쳐 그리므로, 그 결과를 다시 A4 높이로 윈도잉해 쪽 넘김을 만든다.
// jszip은 tall 모드에서만 동적 로드(평소 번들에서 분리).
async function patchTallPage(data: Uint8Array, mult: number): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const f = zip.file("Contents/section0.xml");
  if (!f) return data;
  const xml = await f.async("string");
  const patched = xml.replace(/(<hp:pagePr\b[^>]*\bheight=")(\d+)(")/, (_m, a, h, c) => a + String(parseInt(h, 10) * mult) + c);
  zip.file("Contents/section0.xml", patched);
  return zip.generateAsync({ type: "uint8array" });
}

// tall 렌더 SVG 1장을 콘텐츠 실제 범위(텍스트·이미지; 하단 고정 쪽번호 제외)만큼 A4 쪽들로 분할.
function sliceTall(svgStr: string, meas: HTMLDivElement): Win[] {
  meas.innerHTML = svgStr;
  const svg = meas.querySelector("svg");
  const vbAttr = svg instanceof SVGSVGElement ? svg.getAttribute("viewBox") : null;
  if (!(svg instanceof SVGSVGElement) || !vbAttr) return [{ svg: svgStr, vb: null }];
  const [vx, vy, vw, tallH] = vbAttr.split(/\s+/).map(Number);
  const pageH = vw * 1.414213; // A4 한 쪽 높이(너비×√2)
  const footerZone = tallH - pageH * 0.12; // 페이지 하단에 고정된 쪽번호 등 제외
  let top = Infinity, bottom = -Infinity;
  svg.querySelectorAll("text,image").forEach((el) => {
    try {
      const b = (el as SVGGraphicsElement).getBBox();
      if (b.height > 0 && b.y < footerZone) { top = Math.min(top, b.y); bottom = Math.max(bottom, b.y + b.height); }
    } catch { /* getBBox 미지원 — 무시 */ }
  });
  if (!isFinite(top) || !isFinite(bottom) || bottom <= top) return [{ svg: svgStr, vb: `${vx} ${vy} ${vw} ${pageH}` }];
  const nWin = Math.max(1, Math.min(20, Math.ceil((bottom - top) / pageH - 0.1)));
  const wins: Win[] = [];
  for (let i = 0; i < nWin; i++) wins.push({ svg: svgStr, vb: `${vx} ${(top + i * pageH).toFixed(1)} ${vw} ${pageH.toFixed(1)}` });
  return wins;
}

export function HwpxPreview({
  src,
  bytes,
  tall = false,
  className,
}: {
  /** hwpx 바이트를 받아올 URL (예: 표준양식 API). bytes 와 택일. */
  src?: string;
  /** hwpx 바이트 직접 전달 (예: 생성 결과). src 와 택일. */
  bytes?: Uint8Array;
  /** 보도자료·시행문 등 linesegarray 없는 양식 — 페이지높이를 키워 전체를 그린 뒤 A4로 분할. */
  tall?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Win[]>([]); // 표시 단위(쪽) 목록
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1); // 확대/축소 배율(1=화면높이 맞춤). 0.5~3.0
  const [status, setStatus] = useState<Status>(() => (src || bytes ? "loading" : "idle"));
  const [error, setError] = useState("");

  // 로드 → (tall이면 페이지높이 패치) → 페이지별 렌더 → (tall이면 콘텐츠 범위를 A4 윈도로 분할).
  useEffect(() => {
    if (!src && !bytes) return;
    let cancelled = false;
    void (async () => {
      setStatus("loading");
      setError("");
      setPages([]);
      setCurrent(0);
      setZoom(1); // 새 문서 로드 시 배율 초기화
      try {
        let data = bytes ?? new Uint8Array(await (await fetch(src as string)).arrayBuffer());
        if (tall) {
          try { data = await patchTallPage(data, 8); } catch { /* 패치 실패 → 원본으로 진행 */ }
        }
        const mod = await ensureRhwp();
        if (cancelled) return;
        const doc = new mod.HwpDocument(data);
        const n = doc.pageCount();
        const meas = document.createElement("div");
        meas.style.cssText = "position:fixed;left:-99999px;top:0;width:794px;visibility:hidden;pointer-events:none";
        document.body.appendChild(meas);
        const wins: Win[] = [];
        try {
          for (let i = 0; i < n; i++) {
            let svgStr: string;
            try {
              svgStr = doc.renderPageSvg(i);
            } catch {
              wins.push({ svg: `<div style="padding:2rem;color:#94a3b8;font-size:13px">(${i + 1}쪽 렌더 실패)</div>`, vb: null });
              continue;
            }
            if (tall) wins.push(...sliceTall(svgStr, meas));
            else wins.push({ svg: svgStr, vb: null });
          }
        } finally {
          document.body.removeChild(meas);
        }
        if (!cancelled) {
          setPages(wins);
          setStatus("ready");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, bytes, tall]);

  // 현재 쪽만 host에 주입 + 높이 기준 맞춤(fit-to-height) — 한 쪽이 통째로 들어옴.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "ready") return;
    const win = pages[Math.min(current, pages.length - 1)];
    host.innerHTML = sanitizeSvg(win?.svg ?? "");
    const svg = host.querySelector("svg");
    if (svg instanceof SVGSVGElement) {
      if (win?.vb) {
        svg.setAttribute("viewBox", win.vb); // 분할된 쪽 윈도
      } else if (!svg.getAttribute("viewBox")) {
        // 원본에 viewBox가 없으면 폭/높이 속성으로 보장(종횡비 유지에 필요)
        const w = parseFloat(svg.getAttribute("width") ?? "");
        const h = parseFloat(svg.getAttribute("height") ?? "");
        if (w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      }
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.height = "100%";
      svg.style.width = "auto";
      svg.style.maxWidth = "100%";
      svg.style.display = "block";
      svg.style.background = "#fff";
      svg.style.border = "1px solid var(--ax-border)";
      svg.style.borderRadius = "2px";
      svg.style.boxShadow = "0 2px 10px rgba(15, 42, 80, 0.10)";
    }
  }, [pages, current, status]);

  // 확대/축소 — 주입된 SVG 높이를 배율로 조정(1=화면높이 맞춤). 넘치면 host가 스크롤한다.
  // 배율만 바뀔 땐 재주입 없이 기존 SVG 크기만 갱신(위 주입 효과는 zoom 비의존).
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (svg instanceof SVGSVGElement) {
      svg.style.height = `${Math.round(zoom * 100)}%`;
      svg.style.maxWidth = zoom > 1 ? "none" : "100%";
    }
  }, [zoom, pages, current, status]);

  const total = pages.length;
  const page = Math.min(current, Math.max(0, total - 1));
  const navBtn =
    "flex h-7 w-7 items-center justify-center rounded-full border border-[var(--ax-border)] text-[var(--ax-text-muted)] enabled:hover:bg-[var(--ax-border-soft)] disabled:opacity-30";

  return (
    <div className={className} style={{ position: "relative", minHeight: 80, height: "100%" }}>
      {status === "loading" && (
        <div className="flex h-full min-h-20 items-center justify-center gap-2 text-sm text-[var(--ax-text-muted)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--ax-accent)] border-t-transparent" />
          미리보기 불러오는 중…
        </div>
      )}
      {status === "error" && (
        <div className="rounded-[var(--ax-radius)] border border-[var(--ax-danger)] bg-[var(--ax-danger-bg)] px-3 py-2 text-sm text-[var(--ax-danger)]">
          미리보기 실패: {error}
        </div>
      )}
      {status === "idle" && (
        <div className="flex h-full min-h-20 items-center justify-center text-sm text-[var(--ax-text-muted)]">
          미리보기할 문서가 없습니다.
        </div>
      )}
      {status === "ready" && (
        <div className="flex h-full flex-col items-center gap-2 rounded-[var(--ax-radius-sm)]" style={{ background: "var(--ax-page)" }}>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1.5 text-sm">
            {total > 1 && (
              <div className="flex items-center gap-3">
                <button onClick={() => setCurrent(Math.max(0, page - 1))} disabled={page <= 0} className={navBtn} aria-label="이전 쪽">‹</button>
                <span className="tabular-nums text-[var(--ax-text-muted)]">{page + 1} / {total}</span>
                <button onClick={() => setCurrent(Math.min(total - 1, page + 1))} disabled={page >= total - 1} className={navBtn} aria-label="다음 쪽">›</button>
              </div>
            )}
            <div className="flex items-center gap-1" role="group" aria-label="확대/축소">
              <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5} className={navBtn} aria-label="축소">−</button>
              <button onClick={() => setZoom(1)} className="min-w-[3.2rem] rounded-md px-1.5 py-0.5 text-[13px] tabular-nums text-[var(--ax-text-muted)] transition hover:bg-[var(--ax-border-soft)]" title="화면 맞춤(100%)">{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} disabled={zoom >= 3} className={navBtn} aria-label="확대">+</button>
            </div>
          </div>
          <div ref={hostRef} className="flex min-h-0 w-full flex-1 overflow-auto px-2" style={{ alignItems: "safe center", justifyContent: "safe center" }} />
          <p className="shrink-0 pb-1.5 text-center text-[11px] text-[var(--ax-text-hint)]">
            rhwp 근사 미리보기 — <span className="font-bold text-[var(--ax-danger)]">실제 한컴오피스 서식과 다를 수 있습니다</span>
            {total > 1 ? ` (총 ${total}쪽)` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
