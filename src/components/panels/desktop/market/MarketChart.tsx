"use client";

import { useEffect, useRef } from "react";

type ChartCtor = new (canvas: HTMLCanvasElement, config: unknown) => { destroy: () => void };

/**
 * Chart.js를 React에서 감싼 래퍼.
 * - chart.js/auto는 모듈 레벨에서 1회만 동적 import(클라이언트 전용, SSR 회피)하고 캐시한다.
 * - 최초 로드 이후에는 차트 재생성을 '동기적으로' 처리해, 리렌더 사이에 캔버스가 빈 채로
 *   깜빡이는(차트가 떴다 사라지는) 현상을 막는다. (예: '참고용 매출 예측 보기' 토글 시)
 * - responsive+maintainAspectRatio:false 를 강제 주입한다. 기본값(maintainAspectRatio:true)은
 *   고정 높이 컨테이너에서 ResizeObserver 피드백 루프로 캔버스가 0높이로 붕괴해 차트가
 *   '떴다 사라지는' 원인이 된다. 모든 차트 컨테이너가 고정 높이라 false가 올바르다.
 */
let chartCtor: ChartCtor | null = null;
let chartLoad: Promise<ChartCtor> | null = null;
function loadChart(): Promise<ChartCtor> {
  if (chartCtor) return Promise.resolve(chartCtor);
  if (!chartLoad) {
    chartLoad = import("chart.js/auto").then((mod) => {
      chartCtor = (mod as unknown as { default: ChartCtor }).default;
      return chartCtor;
    });
  }
  return chartLoad;
}

/** config.options 에 responsive/maintainAspectRatio 기본값을 주입(고정 높이 컨테이너 대응). */
function withSizingDefaults(config: unknown): unknown {
  if (!config || typeof config !== "object") return config;
  const c = config as { options?: Record<string, unknown> };
  return { ...c, options: { ...(c.options ?? {}), responsive: true, maintainAspectRatio: false } };
}

export function MarketChart({ config, className = "h-[300px]" }: { config: unknown; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = (Chart: ChartCtor) => {
      // effect 정리 이후 캔버스가 교체/언마운트되었으면 그리지 않는다.
      if (ref.current !== canvas) return;
      inst.current?.destroy();
      inst.current = new Chart(canvas, withSizingDefaults(config));
    };

    // 이미 로드된 경우: 동기 재생성 → await 공백(빈 프레임) 없음.
    if (chartCtor) {
      draw(chartCtor);
      return () => {
        inst.current?.destroy();
        inst.current = null;
      };
    }

    // 최초 1회만 비동기 로드.
    let alive = true;
    loadChart().then((Chart) => {
      if (alive) draw(Chart);
    });
    return () => {
      alive = false;
      inst.current?.destroy();
      inst.current = null;
    };
  }, [config]);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={ref} />
    </div>
  );
}
