"use client";

/**
 * 내부망 매장 매출 분석 패널 — 엑셀 4종 업로드 → 실데이터 분석.
 * ax-portal 데모 (PanelSales)와 분리. 브라우저에서 직접 분석 (파일 서버 전송 없음).
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { SalesResultView } from "./SalesResultView";
import { StoreSelector, type StoreInfo } from "./StoreSelector";
import type { SalesAnalysisResult } from "@/lib/salesAnalysis";
import { cacheGet, cacheSet } from "@/lib/uploadCache";

type UploadState = "idle" | "uploading" | "done" | "error";

interface FileSlot {
  key: "ourDaily" | "compareDaily" | "allStats" | "inventory";
  label: string;
  hint: string;
  file: File | null;
}

const DEFAULT_SLOTS: FileSlot[] = [
  { key: "ourDaily", label: "우리 매장 일매출", hint: "일별매출실적_YYMM.xlsx", file: null },
  { key: "inventory", label: "현재고", hint: "현재고_YYYYMMDD.xlsx", file: null },
  { key: "compareDaily", label: "비교 매장 일매출", hint: "비교매장일매출_YYYYMM.xlsx", file: null },
  { key: "allStats", label: "전체 통계", hint: "매출통계_YYYYMM.xlsx", file: null },
];

// 업로드 파일·매장 선택 보관:
//  - 모듈 메모리(uploadSession): 라우트 이동 시 즉시 복원(동기).
//  - IndexedDB("salesUpload"): 하드 새로고침·탭 재방문에도 유지(콜드 스타트 시 복원).
// 비우기는 화면의 × 버튼으로 사용자가 직접 한다.
type UploadCache = { slots: FileSlot[]; ourStore: StoreInfo | null; compareStore: StoreInfo | null };
let uploadSession: UploadCache | null = null;
const UPLOAD_CACHE_KEY = "salesUpload";

export function PanelSalesUpload() {
  const [slots, setSlots] = useState<FileSlot[]>(() => uploadSession?.slots ?? DEFAULT_SLOTS.map((s) => ({ ...s })));
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState("");
  const [result, setResult] = useState<SalesAnalysisResult | null>(null);
  // 변형(사내 매출시스템 원본형) 양식엔 매장명이 없어 자동 인식 불가 → 본부·역·매장명 드롭다운으로 지정
  const [ourStore, setOurStore] = useState<StoreInfo | null>(() => uploadSession?.ourStore ?? null);
  const [compareStore, setCompareStore] = useState<StoreInfo | null>(() => uploadSession?.compareStore ?? null);
  const [showGuide, setShowGuide] = useState(false);

  const ready = useRef(false);
  // 콜드 스타트(하드 새로고침 등): 세션 메모리에 없으면 IndexedDB에서 첨부 복원.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!uploadSession) {
        const v = await cacheGet<UploadCache>(UPLOAD_CACHE_KEY);
        if (alive && v) { uploadSession = v; setSlots(v.slots); setOurStore(v.ourStore); setCompareStore(v.compareStore); }
      }
      if (alive) ready.current = true;
    })();
    return () => { alive = false; };
  }, []);
  // 첨부·매장 선택 변경 시 세션 메모리 + IndexedDB에 영속(복원이 끝난 뒤에만 기록해 초기값 덮어쓰기 방지).
  useEffect(() => {
    if (!ready.current) return;
    uploadSession = { slots, ourStore, compareStore };
    cacheSet(UPLOAD_CACHE_KEY, uploadSession);
  }, [slots, ourStore, compareStore]);

  const handleFile = (key: FileSlot["key"], file: File | null) => {
    setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, file } : s)));
  };

  const handleUpload = useCallback(async () => {
    if (!slots.some((s) => s.file !== null)) return;
    setUploadState("uploading");
    setUploadError("");
    setResult(null);

    try {
      const { runSalesAnalysisFromFiles } = await import("@/lib/salesAnalysis");
      const fileMap = Object.fromEntries(slots.map((s) => [s.key, s.file ?? undefined]));
      const analysisResult = await runSalesAnalysisFromFiles({
        storeName: ourStore?.name?.trim() || "우리 매장",
        compareStoreName: compareStore?.name?.trim() || undefined,
        ourDailyFile: fileMap.ourDaily,
        compareDailyFile: fileMap.compareDaily,
        allStatsFile: fileMap.allStats,
        inventoryFile: fileMap.inventory,
      });
      setResult(analysisResult);
      setUploadState("done");
    } catch (e) {
      setUploadError(String(e));
      setUploadState("error");
    }
  }, [slots, ourStore, compareStore]);

  // ─── 결과 ──────
  if (uploadState === "done" && result) {
    return (
      <SalesResultView
        result={result}
        onBack={() => { setUploadState("idle"); setResult(null); }}
        backLabel="← 새 파일 업로드"
      />
    );
  }

  // ─── 로딩 ──────
  if (uploadState === "uploading") {
    return (
      <div className="min-h-screen bg-[var(--panel-bg)] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-lg font-bold text-gray-700">브라우저에서 분석 중...</p>
          <p className="text-sm text-gray-400 mt-1">파일이 서버로 전송되지 않습니다. 잠시만 기다려 주세요.</p>
        </div>
      </div>
    );
  }

  // ─── 업로드 폼 ──────
  return (
    <div className="min-h-screen bg-[var(--panel-bg)] flex flex-col">
      <div className="max-w-[900px] mx-auto w-full flex flex-col gap-4 p-5">
        <PanelHeader icon="storefront" title="편의점 매출 비교분석" backHref="/panel/sales" />
        <p className="-mt-2 text-center text-xs text-[var(--ax-text-muted)]">엑셀 4종 업로드 → 브라우저 직접 분석 → AI 진단</p>

        {/* 매장 지정 — 변형 양식엔 매장명이 없어 직접 선택 */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <p className="text-sm font-bold text-gray-700 mb-1">분석 매장 지정</p>
          <p className="text-[11px] text-gray-400 mb-4">
            현재 매출 양식(사내 매출시스템 원본형)에는 <b>매장명이 들어있지 않습니다.</b> 분석할 매장의 본부명·역명·매장명을 직접 입력해 주세요(현황 변동 대비).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StoreSelector label="우리 매장 (분석 대상)" value={ourStore} onChange={setOurStore} accent="var(--kb)" />
            <StoreSelector label="비교 매장 (벤치마크, 선택)" value={compareStore} onChange={setCompareStore} accent="var(--kc)" />
          </div>
          {(!ourStore?.name?.trim() || (slots.find((s) => s.key === "compareDaily")?.file && !compareStore?.name?.trim())) && (
            <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-700">
              ⚠️ 매장명을 입력하지 않으면 {!ourStore?.name?.trim() ? "우리 매장명" : ""}
              {!ourStore?.name?.trim() && slots.find((s) => s.key === "compareDaily")?.file && !compareStore?.name?.trim() ? " · " : ""}
              {slots.find((s) => s.key === "compareDaily")?.file && !compareStore?.name?.trim() ? "비교 매장명" : ""} 없이
              분석됩니다(매장명 미표시). 분석·수치는 정상 동작합니다.
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-sm font-bold text-gray-700">엑셀 파일 업로드</p>
            <button type="button" onClick={() => setShowGuide(true)} className="text-[11px] font-semibold text-[var(--kb)] border border-[var(--kb)] rounded-full px-3 py-1 hover:bg-[var(--kb)] hover:text-white whitespace-nowrap">📥 엑셀 다운로드 방법</button>
          </div>
          <p className="text-[11px] text-gray-400 mb-4">사내 매출시스템에서 받은 엑셀을 그대로 올리세요. 일별매출실적·비교매장일매출은 <b>동일 양식</b>입니다(같은 메뉴에서 추출).</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {slots.map((slot) => (
              <div key={slot.key} className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-600">{slot.label}</label>
                <label
                  className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
                    slot.file ? "border-[var(--kb)] bg-blue-50" : "border-gray-200 hover:border-[var(--kb)] hover:bg-gray-50"
                  }`}
                >
                  {slot.file && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFile(slot.key, null); }}
                      aria-label={`${slot.label} 첨부 삭제`}
                      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-[13px] leading-none hover:bg-red-600"
                    >×</button>
                  )}
                  <span className="text-2xl">{slot.file ? "✅" : "📂"}</span>
                  <span className="text-[11px] text-center text-gray-500">
                    {slot.file ? slot.file.name : slot.hint}
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => handleFile(slot.key, e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            ))}
          </div>

          {uploadState === "error" && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              ⚠️ {uploadError}
            </div>
          )}

          <button
            type="button"
            disabled={!slots.some((s) => s.file)}
            onClick={handleUpload}
            className="w-full bg-[var(--kb)] text-white py-3 rounded-lg font-bold text-sm hover:bg-[#003d7a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            📊 분석 시작
          </button>

          <p className="mt-3 text-[11px] text-gray-400 text-center">
            파일은 서버에 저장되지 않습니다. 브라우저에서 직접 분석합니다.
          </p>
        </div>

        {/* 사내 매출시스템 엑셀 다운로드 방법 — 모달 팝업 */}
        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowGuide(false)}>
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 text-xs text-gray-600 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="font-bold text-[var(--kb)] text-[15px]">📥 사내 매출시스템 엑셀 다운로드 방법 (4종)</p>
                <button type="button" onClick={() => setShowGuide(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
              </div>

              {/* ① 매출분석 조회1 — 일별실적 (우리 매장 일매출) */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-[var(--kb)] text-white px-3 py-2 flex items-center justify-between">
                  <span className="font-bold text-[12px]">① 우리 매장 일매출</span>
                  <span className="text-[10px] opacity-80">일별 매출 조회</span>
                </div>
                <div className="p-3 space-y-1.5">
                  <p className="text-[var(--kb)] font-medium">예: 영업관리 › 매출조회 (일별 매출 메뉴)</p>
                  <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[11px]">
                    <span className="text-gray-400">기간</span><span><b>◉ 일별실적</b> · 해당 월 1일 ~ 말일 (예: 2026-05-01 ~ 2026-05-31)</span>
                    <span className="text-gray-400">센터</span><span><b>◉ 전센터</b></span>
                    <span className="text-gray-400">매장</span><span><b>◉ 특정매장</b> → <b>우리 매장코드</b> 입력</span>
                    <span className="text-gray-400">상품</span><span>◉ 전체 · 전체(배달포함) · 과세 전체</span>
                    <span className="text-gray-400">Display</span><span>☑ 본부 ☑ 판매수량 ☑ <b>판매금액(VAT-)</b> ☑ 상품 ☑ 상품정보</span>
                  </div>
                  <a href="/sales-guide/sales-daily.png" target="_blank" rel="noopener noreferrer" className="block mt-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/sales-guide/sales-daily.png" alt="일별 매출 조회 설정 예시 화면" className="w-full rounded-lg border border-gray-200" />
                    <span className="block text-[10px] text-gray-400 mt-1">↑ 예시 화면(설명용 목업) · 클릭하면 새 탭에서 크게 보기</span>
                  </a>
                </div>
              </div>

              {/* ② 현재고현황 */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-[var(--kg)] text-white px-3 py-2 flex items-center justify-between">
                  <span className="font-bold text-[12px]">② 현재고</span>
                  <span className="text-[10px] opacity-80">재고 현황 조회</span>
                </div>
                <div className="p-3 space-y-1.5">
                  <p className="text-[var(--kb)] font-medium">예: 영업관리 › 재고조회 (현재고 메뉴)</p>
                  <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[11px]">
                    <span className="text-gray-400">매장코드</span><span>센터/매장코드 = <b>우리 매장코드</b></span>
                    <span className="text-gray-400">조건</span><span>대분류 <b>전체</b> · 계약구분 <b>전체</b> · 마이너스 재고 <b>체크 해제</b></span>
                    <span className="text-gray-400">거래처</span><span>거래처코드 입력(필수)</span>
                    <span className="text-gray-400">받기</span><span><b>화면 그대로 다운로드</b> — 바코드·상품코드·상품명·현재고·판매가·재고금액 포함. 현재 시점 스냅샷(일자 선택 없음).</span>
                  </div>
                  <a href="/sales-guide/inventory.png" target="_blank" rel="noopener noreferrer" className="block mt-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/sales-guide/inventory.png" alt="현재고 조회 설정 예시 화면" className="w-full rounded-lg border border-gray-200" />
                    <span className="block text-[10px] text-gray-400 mt-1">↑ 예시 화면(설명용 목업) · 클릭하면 새 탭에서 크게 보기</span>
                  </a>
                </div>
              </div>

              {/* ③ 매출분석 조회1 — 일별실적 (비교 매장 일매출, ①과 동일 양식 · 코드만 교체) */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-[var(--ky)] text-white px-3 py-2 flex items-center justify-between">
                  <span className="font-bold text-[12px]">③ 비교 매장 일매출 <span className="opacity-80 font-medium">(선택)</span></span>
                  <span className="text-[10px] opacity-80">①과 동일 메뉴</span>
                </div>
                <div className="p-3 space-y-1.5">
                  <p className="text-[var(--kb)] font-medium">①과 동일 메뉴·설정 · <b>매장코드만 비교 매장으로 교체</b></p>
                  <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[11px]">
                    <span className="text-gray-400">기간</span><span><b>◉ 일별실적</b> · ①과 동일 기간 (예: 2026-05-01 ~ 2026-05-31)</span>
                    <span className="text-gray-400">매장</span><span><b>◉ 특정매장</b> → <b>비교 매장코드</b> 입력 (벤치마크할 매장)</span>
                    <span className="text-gray-400">나머지</span><span>센터·상품·Display 모두 ①과 동일</span>
                  </div>
                  <a href="/sales-guide/sales-daily.png" target="_blank" rel="noopener noreferrer" className="block mt-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/sales-guide/sales-daily.png" alt="일별 매출 조회(비교 매장) 설정 예시 화면 — 코드만 교체" className="w-full rounded-lg border border-gray-200" />
                    <span className="block text-[10px] text-gray-400 mt-1">↑ ①과 같은 화면(설명용 목업) · 매장코드만 다르게</span>
                  </a>
                </div>
              </div>

              {/* ④ 매출분석 조회1 — 월별실적 (전체 통계) */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-[var(--kc)] text-white px-3 py-2 flex items-center justify-between">
                  <span className="font-bold text-[12px]">④ 전체 통계 (전 편의점 합계)</span>
                  <span className="text-[10px] opacity-80">월별 매출 조회</span>
                </div>
                <div className="p-3 space-y-1.5">
                  <p className="text-[var(--kb)] font-medium">①·③과 동일 메뉴 · 설정만 변경</p>
                  <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[11px]">
                    <span className="text-gray-400">기간</span><span><b>◉ 월별실적</b> · 해당 월 ~ 해당 월 (예: 2026-05 ~ 2026-05)</span>
                    <span className="text-gray-400">센터</span><span><b>◉ 전센터</b></span>
                    <span className="text-gray-400">매장</span><span><b>◉ 구분 → 편의점</b></span>
                    <span className="text-gray-400">Display</span><span>☑ 본부 ☑ 판매수량 ☑ <b>판매금액(VAT-)</b> ☑ 상품 ☑ 상품정보</span>
                  </div>
                  <a href="/sales-guide/sales-monthly.png" target="_blank" rel="noopener noreferrer" className="block mt-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/sales-guide/sales-monthly.png" alt="월별 매출 조회(전체 통계) 설정 예시 화면" className="w-full rounded-lg border border-gray-200" />
                    <span className="block text-[10px] text-gray-400 mt-1">↑ 예시 화면(설명용 목업) · 클릭하면 새 탭에서 크게 보기</span>
                  </a>
                </div>
              </div>

              <p className="text-gray-500 pt-1 border-t border-gray-100">
                • 일별·비교 양식엔 <b>매장명이 없어</b> 업로드 화면 드롭다운으로 매장을 지정하세요.<br />
                • 파일이 없어도 있는 것만으로 부분 분석 가능. 이 양식은 거래·시간 정보가 없어 <b>시간대·장바구니(MBA)·객단가</b> 분석은 제외됩니다.
              </p>

              <button type="button" onClick={() => setShowGuide(false)} className="w-full bg-[var(--kb)] text-white py-2 rounded-lg text-sm font-bold hover:opacity-90">닫기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
