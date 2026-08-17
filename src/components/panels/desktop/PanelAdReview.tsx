"use client";

import { useEffect, useRef, useState } from "react";
import { PanelShell, Card, Button, StatusBox, TextInput, TextArea } from "@/components/ui";
import { FeedbackBar } from "@/components/panels/desktop/FeedbackBar";

type Box = { x: number; y: number; w: number; h: number };
type Field = { 분류?: string; 수준?: string; 근거룰?: string; 관련조항?: string; 의견?: string; 추정업종?: string; 위치?: string; 근거문구?: string; 위치박스?: Box };
type InjPhrase = { text: string; box?: Box };
type AdResult = { 분야?: Field[]; 금지의심?: { 해당?: boolean; 사유?: string; 근거룰?: string }; 추출텍스트?: string[]; 종합메모?: string; 자동추정업종?: string; 심의불가?: { 사유: string; 룰?: string[]; 문구?: InjPhrase[] } };
type Industry = { industry: string; category: string; highRisk: boolean; banned: boolean };
type Step = { stage: string; label: string; ms?: number; status: "run" | "done"; detail?: string };

// 3×3 격자 칸 → 핀 중심 좌표(%). OCR 박스가 없을 때(시각 이슈)만 폴백으로 사용.
const CELL_POS: Record<string, { x: number; y: number }> = {
  좌상: { x: 18, y: 18 }, 중상: { x: 50, y: 18 }, 우상: { x: 82, y: 18 },
  좌중: { x: 18, y: 50 }, 중앙: { x: 50, y: 50 }, 우중: { x: 82, y: 50 },
  좌하: { x: 18, y: 82 }, 중하: { x: 50, y: 82 }, 우하: { x: 82, y: 82 },
};
const cellOf = (loc?: string) => (loc ? CELL_POS[loc.trim()] : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const secs = (ms?: number) => (ms == null ? "…" : `${(ms / 1000).toFixed(1)}초`);

// 수준 — 🟢 이상없음 / 🟡 확인필요 / 🔴 위반의심 / ⏸ 분석보류(AI가 분석 못 함 → 수동 확인)
const LEVELS = {
  이상없음: { key: "ok" as const, icon: "✓", chip: "bg-[var(--ax-success-bg)] text-[var(--ax-success)]", card: "border-[var(--ax-border)] bg-[var(--ax-card)]", ring: "ring-[var(--ax-success)]", color: "var(--ax-success)" },
  확인필요: { key: "warn" as const, icon: "⚠", chip: "bg-[var(--ax-warning)] text-white", card: "border-[var(--ax-warning)] bg-[var(--ax-warning-bg)]", ring: "ring-[var(--ax-warning)]", color: "var(--ax-warning)" },
  위반의심: { key: "danger" as const, icon: "⛔", chip: "bg-[var(--ax-danger)] text-white", card: "border-[var(--ax-danger)] bg-[var(--ax-danger-bg)]", ring: "ring-[var(--ax-danger)]", color: "var(--ax-danger)" },
  분석보류: { key: "hold" as const, icon: "⏸", chip: "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]", card: "border-dashed border-[var(--ax-border)] bg-[var(--ax-card)]", ring: "ring-[var(--ax-text-muted)]", color: "var(--ax-text-muted)" },
};
const lvOf = (s?: string) => LEVELS[s as keyof typeof LEVELS] ?? LEVELS.이상없음;
const nextLevel = (s?: string) => (s === "이상없음" ? "확인필요" : s === "확인필요" ? "위반의심" : "이상없음");

export function PanelAdReview() {
  const [preview, setPreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState("");
  const [mediaType, setMediaType] = useState("image/jpeg");
  const [imgAspect, setImgAspect] = useState(4 / 3); // 업로드 도안 종횡비(w/h) — PDF에서 영역에 맞게 최대화(업스케일)
  const [industry, setIndustry] = useState("");
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [result, setResult] = useState<AdResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [activePin, setActivePin] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomBoxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch("/api/ad/industries").then((r) => r.json()).then((d) => setIndustries(d.industries || [])).catch(() => {});
  }, []);

  // 휠 줌(비수동 리스너로 페이지 스크롤 막음)
  useEffect(() => {
    const el = zoomBoxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!preview) return;
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.15 : 0.87), 1, 6));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [preview]);

  useEffect(() => { if (zoom <= 1) setPan({ x: 0, y: 0 }); }, [zoom]);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const pickFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("이미지 파일만 첨부할 수 있습니다."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("이미지는 8MB 이내여야 합니다."); return; }
    setError(null); setResult(null); setSteps([]); setTotalMs(null); setEditing(false); setActivePin(null); resetView();
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      setPreview(url); setMediaType(file.type); setImageBase64(url.split(",")[1] || "");
      const im = new window.Image();
      im.onload = () => setImgAspect(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 4 / 3);
      im.src = url;
    };
    reader.readAsDataURL(file);
  };

  // 스트리밍 심의 — 단계/시간 갱신 후 결과 세팅
  const review = async () => {
    if (!imageBase64) { setError("도안 이미지를 첨부하세요."); return; }
    setLoading(true); setError(null); setResult(null); setSteps([]); setTotalMs(null); setEditing(false); setActivePin(null);
    try {
      const res = await fetch("/api/ad/review?stream=1", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mediaType, industry }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "심의에 실패했습니다."); return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const onEvent = (e: Record<string, unknown>) => {
        if (e.done) { setResult(e.result as AdResult); setTotalMs(Number(e.totalMs) || null); setSteps((s) => s.map((x) => ({ ...x, status: "done" }))); }
        else if (e.error) { setError(String(e.error)); }
        else if (e.stage) {
          const stage = String(e.stage), status = String(e.status ?? ""), label = String(e.label ?? stage), detail = e.detail ? String(e.detail) : undefined, ms = e.ms != null ? Number(e.ms) : undefined;
          setSteps((prev) => {
            const idx = prev.findIndex((p) => p.stage === stage);
            if (status === "start") return idx < 0 ? [...prev, { stage, label, status: "run" }] : prev;
            if (status === "done") return prev.map((p) => (p.stage === stage ? { ...p, status: "done", ms, detail } : p));
            if (status === "retry") return prev.map((p) => (p.stage === stage ? { ...p, detail } : p));
            return prev;
          });
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.trim()) { try { onEvent(JSON.parse(line)); } catch { /* skip */ } }
        }
      }
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 결과 편집 핸들러
  const setField = (i: number, patch: Partial<Field>) => setResult((r) => (r ? { ...r, 분야: (r.분야 ?? []).map((f, j) => (j === i ? { ...f, ...patch } : f)) } : r));
  const removeField = (i: number) => setResult((r) => (r ? { ...r, 분야: (r.분야 ?? []).filter((_, j) => j !== i) } : r));
  const addField = () => setResult((r) => (r ? { ...r, 분야: [...(r.분야 ?? []), { 분류: "추가 항목", 수준: "확인필요", 관련조항: "", 의견: "" }] } : r));
  const setBanned = (patch: { 해당?: boolean; 사유?: string; 근거룰?: string }) => setResult((r) => (r ? { ...r, 금지의심: { ...(r.금지의심 ?? {}), ...patch } } : r));

  const fields = result?.분야 ?? [];
  const banned = result?.금지의심?.해당 === true;
  const okBox = (b?: Box) => !!b && b.w > 0.01 && b.h > 0.005;
  // 프롬프트 인젝션으로 심의 중단된 경우: 걸린 문구 + 위치박스(빨간 오버레이)
  const blocked = result?.심의불가;
  const injBoxes = (blocked?.문구 ?? [])
    .filter((p) => okBox(p.box))
    .map((p, i) => ({ box: p.box as Box, n: i + 1, text: p.text }));
  let pinSeq = 0;
  const meta = fields.map((f) => {
    const lvl = lvOf(f.수준);
    const flagged = lvl.key !== "ok";
    const box = flagged && okBox(f.위치박스) ? f.위치박스 : undefined;
    const pos = flagged && !box ? cellOf(f.위치) : undefined;
    const full = flagged && !box && f.위치?.trim() === "전체";
    const n = box || pos ? ++pinSeq : null;
    return { f, lvl, box, pos, full, n };
  });
  const boxes = meta.flatMap((m) => (m.box && m.n != null ? [{ box: m.box, n: m.n, f: m.f, color: m.lvl.color }] : []));
  const pins = meta.flatMap((m) => (m.pos && m.n != null ? [{ pos: m.pos, n: m.n, color: m.lvl.color }] : []));
  const hasFull = meta.some((m) => m.full);
  const dangerCount = fields.filter((f) => f.수준 === "위반의심").length;
  const warnCount = fields.filter((f) => f.수준 === "확인필요").length;
  const holdCount = fields.filter((f) => f.수준 === "분석보류").length;
  const okCount = fields.filter((f) => f.수준 === "이상없음").length;
  const worst = banned || dangerCount > 0 ? lvOf("위반의심") : warnCount > 0 ? lvOf("확인필요") : holdCount > 0 ? lvOf("분석보류") : lvOf("이상없음");
  const extracted = (result?.추출텍스트 ?? []).filter(Boolean);
  const aiIndustry = result?.자동추정업종 ? String(result.자동추정업종) : ""; // 업종 미선택 시 AI가 추정한 업종명

  return (
    <PanelShell title="AI 광고도안심의" icon="fact_check" bodyClassName="grid min-h-0 grid-cols-[minmax(320px,42%)_1fr] gap-3 p-3.5">
      {/* 좌: 도안 + 입력 */}
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pr-0.5">
        <Card label="광고 도안" className="flex flex-col" bodyClassName="flex flex-col">
          <div
            ref={zoomBoxRef}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0] ?? null); }}
            onClick={() => { if (!preview) inputRef.current?.click(); }}
            onMouseDown={(e) => { if (preview && zoom > 1) panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
            onMouseMove={(e) => { if (panRef.current) setPan({ x: panRef.current.px + (e.clientX - panRef.current.x), y: panRef.current.py + (e.clientY - panRef.current.y) }); }}
            onMouseUp={() => { panRef.current = null; }}
            onMouseLeave={() => { panRef.current = null; }}
            className={`relative flex min-h-[300px] items-center justify-center overflow-hidden rounded-[var(--ax-radius)] border-2 border-dashed bg-white p-2 transition ${dragOver ? "border-[var(--ax-accent)] bg-[var(--ax-accent-bg)]" : "border-[var(--ax-accent-border)]"} ${preview ? (zoom > 1 ? "cursor-grab active:cursor-grabbing" : "") : "cursor-pointer"}`}
          >
            {preview ? (
              <div className="relative inline-block leading-[0] select-none" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="도안 미리보기" draggable={false} className="block max-h-[440px] w-auto max-w-full rounded-[var(--ax-radius-sm)]" />
                {hasFull && <div className="pointer-events-none absolute inset-0 rounded-[var(--ax-radius-sm)] border-2 border-dashed border-[var(--ax-warning)]" />}
                {injBoxes.map((b) => (
                  <div
                    key={`inj${b.n}`}
                    title={`프롬프트 공격 의심 문구: "${b.text}"`}
                    className="absolute rounded-[3px] border-2"
                    style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%`, borderColor: "var(--ax-danger)" }}
                  >
                    <span className="absolute -left-2 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[11px] font-medium text-white shadow" style={{ background: "var(--ax-danger)" }}>!</span>
                  </div>
                ))}
                {boxes.map((b) => (
                  <button
                    key={`b${b.n}`} type="button"
                    title={`${b.f.분류 ?? ""}${b.f.근거문구 ? `: "${b.f.근거문구}"` : ""}`}
                    onMouseEnter={() => setActivePin(b.n)} onMouseLeave={() => setActivePin(null)}
                    className={`absolute rounded-[3px] border-2 transition ${activePin === b.n ? "z-10" : ""}`}
                    style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%`, borderColor: b.color }}
                  >
                    <span className="absolute -left-2 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[11px] font-medium text-white shadow" style={{ background: b.color }}>{b.n}</span>
                  </button>
                ))}
                {pins.map((p) => (
                  <button
                    key={`p${p.n}`} type="button"
                    onMouseEnter={() => setActivePin(p.n)} onMouseLeave={() => setActivePin(null)}
                    className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-medium text-white shadow transition ${activePin === p.n ? "z-10 scale-125" : ""}`}
                    style={{ left: `${p.pos.x}%`, top: `${p.pos.y}%`, background: p.color }}
                  >{p.n}</button>
                ))}
              </div>
            ) : (
              <div className="px-4 text-center">
                <div className="text-3xl">🖼️</div>
                <p className="mt-2 text-sm font-medium text-[var(--ax-text-muted)]">도안을 드래그하거나 클릭해 선택</p>
                <p className="mt-1 text-xs text-[var(--ax-text-hint)]">PNG·JPG·WEBP · 8MB 이내</p>
              </div>
            )}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </div>
          {preview && (
            <div className="mt-2 flex items-center gap-1.5">
              <button onClick={() => setZoom((z) => clamp(z * 0.8, 1, 6))} className="flex h-7 w-7 items-center justify-center rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] text-sm text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]" aria-label="축소">−</button>
              <span className="w-12 text-center text-xs text-[var(--ax-text-muted)]">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => clamp(z * 1.25, 1, 6))} className="flex h-7 w-7 items-center justify-center rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] text-sm text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]" aria-label="확대">+</button>
              <button onClick={resetView} className="ml-1 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] px-2 py-1 text-xs text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">리셋</button>
              {zoom > 1 && <span className="text-[11px] text-[var(--ax-text-hint)]">드래그로 이동</span>}
              <button onClick={() => inputRef.current?.click()} className="ml-auto text-xs font-medium text-[var(--ax-accent)] hover:underline">다른 도안</button>
            </div>
          )}
        </Card>

        <Card label="신고 업종 (선택 — 미선택 시 AI 추정)">
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-full rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-white px-3 py-2 text-sm text-[var(--ax-text)] outline-none transition focus:border-[var(--ax-accent-border)] focus:ring-2 focus:ring-[var(--ax-accent-bg)]">
            <option value="">업종 자동 추정 (AI)</option>
            {industries.map((it) => (
              <option key={it.industry} value={it.industry}>{it.industry}{it.banned ? " (금지업종)" : it.highRisk ? " (고위험)" : ""}</option>
            ))}
          </select>
        </Card>

        <Button onClick={review} loading={loading} disabled={!imageBase64} icon="⚖">{loading ? "도안 분석 중…" : "심의 실행"}</Button>
        {error && <StatusBox kind="error">{error}</StatusBox>}

        <p className="rounded-[var(--ax-radius-sm)] bg-[var(--ax-warning-bg)] px-3 py-2.5 text-xs leading-relaxed text-[var(--ax-warning)]">
          본 결과는 <b>보조 의견</b>이며 최종 게재 가부는 담당자가 판단합니다. 도안은 서버에 저장되지 않습니다(무저장).<br />
          · 판정 3단계: <b>🟢 이상없음 / 🟡 확인필요 / 🔴 위반의심</b><br />
          <span className="pl-3">문구·고지문구는 OCR+룰 대조로 🔴까지 · 이미지·배경·저작권은 비전 점검으로 🟡까지 표기합니다.</span><br />
          · 광고주 평판·논란 체크는 외부 검색이 필요해 내부망에서는 제공하지 않습니다.
        </p>
      </div>

      {/* 우: 진행 / 결과 */}
      <Card className="flex min-h-0 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
        {!result && !loading && <StatusBox kind="empty">도안을 올리고 심의를 실행하면 단계별 진행과 결과가 표시됩니다.</StatusBox>}

        {(loading || (steps.length > 0 && !result)) && (
          <div className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3.5">
            <div className="mb-2 text-sm font-medium text-[var(--ax-text)]">심의 진행</div>
            <div className="flex flex-col gap-1.5">
              {steps.map((s) => (
                <div key={s.stage} className="flex items-center justify-between text-sm">
                  <span className={s.status === "done" ? "text-[var(--ax-text)]" : "text-[var(--ax-text-muted)]"}>
                    {s.status === "done" ? "✓" : "⏳"} {s.label}{s.detail ? <span className="text-[var(--ax-text-hint)]"> · {s.detail}</span> : null}
                  </span>
                  <span className="text-xs text-[var(--ax-text-muted)]">{secs(s.ms)}</span>
                </div>
              ))}
              {steps.length === 0 && <div className="text-sm text-[var(--ax-text-muted)]">멀티모달 AI가 도안을 분석하는 중…</div>}
            </div>
          </div>
        )}

        {result && (
          <>
            {/* 툴바: 소요시간 + 수정 + PDF */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--ax-text-muted)]">
                {totalMs != null ? `총 ${secs(totalMs)}` : ""}
                {steps.length > 0 ? <span className="text-[var(--ax-text-hint)]"> ({steps.map((s) => `${s.label.replace("도안 ", "")} ${secs(s.ms)}`).join(" · ")})</span> : null}
              </span>
              <div className="flex gap-2">
                {!blocked && <Button size="sm" variant={editing ? "primary" : "outline"} icon={editing ? "✓" : "✎"} onClick={() => setEditing((v) => !v)}>{editing ? "수정 완료" : "수정"}</Button>}
                <Button size="sm" variant="outline" icon="⬇" onClick={() => window.print()}>PDF 저장</Button>
              </div>
            </div>

            {/* 프롬프트 인젝션 탐지 → 심의 불가 */}
            {blocked && (
              <div className="rounded-[var(--ax-radius)] border border-[var(--ax-danger)] bg-[var(--ax-danger-bg)] p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--ax-danger)]"><span>⛔</span> 심의 불가 — 프롬프트 공격 탐지</div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--ax-danger)]">{blocked.사유}</p>
                {(blocked.문구 ?? []).length > 0 && (
                  <div className="mt-2.5">
                    <div className="text-xs font-semibold text-[var(--ax-text-muted)]">탐지된 문구{injBoxes.length > 0 ? " (도안에 위치 표시)" : ""}</div>
                    <div className="mt-1 flex flex-col gap-1">
                      {(blocked.문구 ?? []).map((p, i) => {
                        const bn = injBoxes.find((b) => b.text === p.text)?.n;
                        return (
                          <div key={i} className="flex items-start gap-1.5 rounded-[6px] border border-[var(--ax-danger)] bg-[var(--ax-card)] px-2 py-1 text-xs text-[var(--ax-text)]">
                            {bn != null && <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] text-white" style={{ background: "var(--ax-danger)" }}>!</span>}
                            <span className="break-all">“{p.text}”</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--ax-text-muted)]">도안에 심의 AI를 조작하려는 지시성 문구가 포함되어 심의를 진행하지 않았습니다. 해당 문구를 제거한 뒤 다시 시도하세요.</p>
              </div>
            )}

            {!blocked && (<>
            {/* AI 업종 추정 결과 (업종 미선택 시) */}
            {aiIndustry && (
              <div className="flex items-center gap-2 rounded-[var(--ax-radius-sm)] border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] px-3 py-1.5 text-xs">
                <span>🏷️</span><span className="font-semibold text-[var(--ax-accent-dark)]">AI 추정 업종</span>
                <span className="text-[var(--ax-text)]">{aiIndustry}</span>
                <span className="ml-auto text-[var(--ax-text-hint)]">업종 미선택 → 자동 분류</span>
              </div>
            )}

            {/* 도안에서 읽은 문구 — OCR 결과를 가장 먼저 확인 */}
            {extracted.length > 0 && (
              <Card label="도안에서 읽은 문구"><div className="flex flex-wrap gap-1.5">{extracted.map((t, i) => <span key={i} className="rounded-[6px] bg-[var(--ax-border-soft)] px-2 py-1 text-xs text-[var(--ax-text-muted)]">{t}</span>)}</div></Card>
            )}

            {/* 금지의심 */}
            {(banned || editing) && (
              <div className={`rounded-[var(--ax-radius)] border p-3 ${banned ? "border-[var(--ax-danger)] bg-[var(--ax-danger-bg)]" : "border-[var(--ax-border)] bg-[var(--ax-card)]"}`}>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ax-danger)]">
                  {editing && <input type="checkbox" checked={banned} onChange={(e) => setBanned({ 해당: e.target.checked })} />}
                  <span>🚫</span> 금지광고 의심 {!editing && !banned ? <span className="font-normal text-[var(--ax-text-hint)]">없음</span> : null}
                </label>
                {(banned || editing) && (editing
                  ? <><TextInput value={result.금지의심?.사유 ?? ""} onChange={(e) => setBanned({ 사유: e.target.value })} placeholder="사유" className="mt-1.5" /><TextInput value={result.금지의심?.근거룰 ?? ""} onChange={(e) => setBanned({ 근거룰: e.target.value })} placeholder="근거룰 (금지 대상·조항)" className="mt-1.5" /></>
                  : <><p className="mt-1 text-sm text-[var(--ax-danger)]">{result.금지의심?.사유 || "금지광고 대상으로 의심됩니다."}</p>{result.금지의심?.근거룰 ? <p className="mt-0.5 text-xs font-medium text-[var(--ax-danger)]">근거 {result.금지의심.근거룰}</p> : null}</>)}
              </div>
            )}

            {/* 판정 요약 (3단계) */}
            <div className={`flex items-center justify-between rounded-[var(--ax-radius)] border px-3.5 py-2.5 ${worst.key === "danger" ? "border-[var(--ax-danger)] bg-[var(--ax-danger-bg)]" : worst.key === "warn" ? "border-[var(--ax-warning)] bg-[var(--ax-warning-bg)]" : worst.key === "hold" ? "border-[var(--ax-border)] bg-[var(--ax-card)]" : "border-[var(--ax-success)] bg-[var(--ax-success-bg)]"}`}>
              <span className="text-sm font-semibold" style={{ color: worst.color }}>
                {worst.key === "danger" ? `⛔ 위반의심 ${dangerCount}건${warnCount ? ` · 확인필요 ${warnCount}건` : ""}` : worst.key === "warn" ? `⚠ 확인필요 ${warnCount}건${holdCount ? ` · 분석보류 ${holdCount}건` : ""}` : worst.key === "hold" ? `⏸ 분석보류 ${holdCount}건 — 수동 확인 필요` : "✓ 4개 분야 이상없음"}
              </span>
              <span className="text-xs text-[var(--ax-text-muted)]">🔴 {dangerCount} · 🟡 {warnCount} · 🟢 {okCount}{holdCount ? ` · ⏸ ${holdCount}` : ""}{banned ? " · 🚫 금지의심" : ""}</span>
            </div>

            {/* 4분야 카드 (view / edit) */}
            {meta.map(({ f, lvl, n, full, box }, i) => {
              const ok = lvl.key === "ok";
              return (
                <div key={i} onMouseEnter={() => { if (n != null) setActivePin(n); }} onMouseLeave={() => setActivePin(null)}
                  className={`rounded-[var(--ax-radius)] border p-3 transition ${lvl.card} ${n != null && activePin === n ? `ring-2 ${lvl.ring}` : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--ax-text)]">
                      {n != null && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white" style={{ background: lvl.color }}>{n}</span>}
                      {editing ? <TextInput value={f.분류 ?? ""} onChange={(e) => setField(i, { 분류: e.target.value })} className="!py-1 text-sm" /> : <><span>{lvl.icon}</span>{f.분류}{f.추정업종 ? <span className="text-xs font-normal text-[var(--ax-text-hint)]">추정 {f.추정업종}</span> : null}</>}
                    </div>
                    {editing ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => setField(i, { 수준: nextLevel(f.수준) })} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${lvl.chip}`}>{f.수준 || "-"} ⇄</button>
                        <button onClick={() => removeField(i)} className="px-1 text-[var(--ax-text-hint)] hover:text-[var(--ax-danger)]" aria-label="삭제">✕</button>
                      </div>
                    ) : (
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${lvl.chip}`}>{f.수준 || "-"}</span>
                    )}
                  </div>
                  {editing ? (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <TextInput value={f.근거룰 ?? ""} onChange={(e) => setField(i, { 근거룰: e.target.value })} placeholder="근거룰 (적용 룰·조항·매칭 표현)" className="!py-1 text-xs" />
                      <TextArea value={f.의견 ?? ""} onChange={(e) => setField(i, { 의견: e.target.value })} placeholder="의견·근거" className="min-h-14 text-sm" />
                      <TextInput value={f.근거문구 ?? ""} onChange={(e) => setField(i, { 근거문구: e.target.value })} placeholder="근거문구(도안의 해당 문구 — 위치 표시용)" className="!py-1 text-xs" />
                    </div>
                  ) : (!ok && (f.근거룰 || f.관련조항 || f.의견 || f.위치 || box) && (
                    <div className="mt-1.5 text-sm text-[var(--ax-text-muted)]">
                      {(f.근거룰 || f.관련조항) ? <span className="text-xs font-medium" style={{ color: lvl.color }}>근거 {f.근거룰 || f.관련조항}</span> : null}
                      {f.의견 ? <p className="mt-0.5 leading-relaxed">{f.의견}</p> : null}
                      {lvl.key !== "hold" && ((box || full || f.위치?.trim())
                        ? <span className="mt-1.5 inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-medium" style={{ background: "var(--ax-warning-bg)", color: "var(--ax-warning)" }}>📍 {box ? (f.근거문구 ? `“${f.근거문구}” 표시` : "도안에 표시") : full ? "전체" : `위치 ${f.위치}`}</span>
                        : <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--ax-text-hint)]">📍 도안 내 위치 없음 (문구 누락 등)</span>)}
                    </div>
                  ))}
                </div>
              );
            })}
            {editing && <button onClick={addField} className="rounded-[var(--ax-radius)] border border-dashed border-[var(--ax-accent-border)] py-2 text-sm font-medium text-[var(--ax-accent)] hover:bg-[var(--ax-accent-bg)]">＋ 분야 추가</button>}

            <Card label="종합 메모">
              {editing
                ? <TextArea value={result.종합메모 ?? ""} onChange={(e) => setResult((r) => (r ? { ...r, 종합메모: e.target.value } : r))} placeholder="종합 메모" className="min-h-16 text-sm" />
                : <p className="text-sm leading-relaxed text-[var(--ax-text-muted)]">{result.종합메모 || "—"}</p>}
            </Card>
            <FeedbackBar
              payload={{
                panel: "ad",
                question: `업종: ${industry || result.자동추정업종 || "자동추정"}`,
                answer: [result.종합메모, ...(result.분야 ?? []).map((f) => `${f.분류 ?? ""}(${f.수준 ?? ""}) ${f.의견 ?? ""}`)].filter((s) => s && s.trim()).join("\n").slice(0, 8000),
              }}
              resetKey={result.종합메모?.slice(0, 40) || result.자동추정업종}
            />
            </>)}
          </>
        )}
      </Card>

      {/* 인쇄용 리포트 (화면 숨김 · 인쇄 시 표시 → PDF로 저장) */}
      {result && !blocked && (
        <div className="ax-print-area hidden text-[#1f2937] print:block" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
          {/* 제목 — 크게, 가운데 정렬 */}
          <h1 className="text-center font-extrabold tracking-tight" style={{ fontSize: "30pt", lineHeight: 1.15 }}>AI 광고도안 심의결과</h1>
          {/* 심의일시 — 오른쪽 정렬 */}
          <p className="text-right" style={{ marginTop: "3mm", fontSize: "13pt", color: "#555" }}>심의 일시 {new Date().toLocaleString("ko-KR")} · AI 보조 의견{industry ? ` · 신고 업종 ${industry}` : aiIndustry ? ` · 업종 자동 추정: ${aiIndustry}` : " · 업종 자동 추정"}</p>

          {/* 심의대상 도안 — 고정 영역(약 반 페이지) 내 최대 표시 + 지적번호 오버레이, 가운데 */}
          {preview && (
            <div className="flex items-center justify-center rounded" style={{ marginTop: "5mm", height: "139mm", border: "1px solid #e2e2e2", background: "#fafafa", overflow: "hidden" }}>
              <div className="relative" style={{ ...(imgAspect >= 176 / 137 ? { width: "100%", aspectRatio: String(imgAspect) } : { height: "137mm", aspectRatio: String(imgAspect) }), lineHeight: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="심의 대상 도안" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                {hasFull && <div className="absolute inset-0" style={{ border: "2.5px dashed #854f0b" }} />}
                {boxes.map((b) => (
                  <div key={`pb${b.n}`} className="absolute" style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%`, border: `2.5px solid ${b.color}`, borderRadius: "2px" }}>
                    <span className="absolute flex items-center justify-center rounded-full text-white" style={{ left: "-12px", top: "-13px", width: "23px", height: "23px", background: b.color, fontSize: "13pt", fontWeight: 700, border: "2px solid #fff" }}>{b.n}</span>
                  </div>
                ))}
                {pins.map((p) => (
                  <div key={`pp${p.n}`} className="absolute flex items-center justify-center rounded-full text-white" style={{ left: `${p.pos.x}%`, top: `${p.pos.y}%`, width: "25px", height: "25px", transform: "translate(-50%, -50%)", background: p.color, fontSize: "13pt", fontWeight: 700, border: "2px solid #fff" }}>{p.n}</div>
                ))}
              </div>
            </div>
          )}

          {/* 심의결과 요약 — 신호등 + 종합메모 */}
          <div className="flex items-center gap-4 rounded" style={{ marginTop: "6mm", border: "1px solid #e2e2e2", padding: "11px 14px" }}>
            <div className="flex shrink-0 items-center gap-3">
              {[{ c: "#a32d2d", n: dangerCount, l: "위반의심" }, { c: "#b07a0b", n: warnCount, l: "확인필요" }, { c: "#0f6e56", n: okCount, l: "이상없음" }, ...(holdCount ? [{ c: "#666666", n: holdCount, l: "분석보류" }] : [])].map((x) => (
                <span key={x.l} className="flex items-center gap-1.5" style={{ fontSize: "13pt", fontWeight: 600, color: x.c }}>
                  <span className="inline-flex items-center justify-center rounded-full text-white" style={{ width: "25px", height: "25px", background: x.c, fontSize: "13pt", fontWeight: 700 }}>{x.n}</span>{x.l}
                </span>
              ))}
              {banned && <span style={{ fontSize: "13pt", fontWeight: 700, color: "#a32d2d" }}>🚫 금지의심</span>}
            </div>
            <div style={{ fontSize: "13pt", color: "#333", lineHeight: 1.4 }}><b>종합메모</b> {result.종합메모 || "—"}</div>
          </div>

          {/* 검토항목별 심의내용 — 2×2 박스 */}
          <div style={{ marginTop: "6mm", marginBottom: "2.5mm", fontSize: "15pt", fontWeight: 700, color: "#333" }}>검토항목별 심의내용</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
            {meta.map(({ f, n, full }, i) => {
              const danger = f.수준 === "위반의심", warn = f.수준 === "확인필요", hold = f.수준 === "분석보류", flagged = danger || warn;
              const bg = danger ? "#fcebeb" : warn ? "#faeeda" : hold ? "#f0f0f0" : "#f1f8f5";
              const fg = danger ? "#a32d2d" : warn ? "#854f0b" : hold ? "#666666" : "#0f6e56";
              return (
                <div key={i} className="rounded" style={{ border: `1px solid ${fg}33`, background: bg, padding: "12px 14px", minHeight: "35mm", breakInside: "avoid" }}>
                  <div className="flex items-start justify-between gap-2">
                    <span style={{ fontSize: "15pt", fontWeight: 700, color: "#222" }}>
                      {n != null ? <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "21px", height: "21px", borderRadius: "9999px", background: fg, color: "#fff", fontSize: "12pt", fontWeight: 700, marginRight: "5px", verticalAlign: "middle" }}>{n}</span> : null}
                      {f.분류}{f.추정업종 ? <span style={{ fontSize: "13pt", fontWeight: 400, color: "#777" }}> · 추정 {f.추정업종}</span> : null}
                    </span>
                    <span className="shrink-0 rounded-full text-white" style={{ background: fg, fontSize: "13pt", fontWeight: 700, padding: "3px 11px" }}>{f.수준}</span>
                  </div>
                  {f.근거룰 ? <div style={{ marginTop: "6px", fontSize: "13pt", fontWeight: 600, color: fg }}>근거 {f.근거룰}</div> : null}
                  {f.의견 ? <div style={{ marginTop: "6px", fontSize: "13pt", color: "#333", lineHeight: 1.5 }}>{f.의견}{f.근거문구 ? ` (문구: ${f.근거문구})` : ""}</div> : <div style={{ marginTop: "6px", fontSize: "13pt", color: "#9a9a9a" }}>특이사항 없음</div>}
                  {flagged && n == null ? <div style={{ marginTop: "6px", fontSize: "12pt", color: "#999" }}>📍 {full ? "도안 전체" : "도안 내 위치 없음 (문구 누락 등)"}</div> : null}
                </div>
              );
            })}
          </div>

          {banned ? <p style={{ marginTop: "4mm", fontSize: "13pt", color: "#a32d2d" }}><b>🚫 금지광고 의심:</b> {result.금지의심?.사유 || "금지광고 대상 의심"}{result.금지의심?.근거룰 ? ` (근거 ${result.금지의심.근거룰})` : ""}</p> : null}

          <p style={{ marginTop: "6mm", fontSize: "13pt", color: "#888", lineHeight: 1.5 }}>※ 본 결과는 AI 보조 의견이며 최종 게재 가부는 담당자가 판단합니다. 도안 이미지는 서버에 저장되지 않습니다(무저장).<br />· 문구·고지문구는 OCR+룰 대조로 🔴 위반의심까지 판정 · 이미지·배경·저작권은 비전 점검으로 🟡 확인필요까지 표기.</p>
        </div>
      )}

      {/* 인쇄용 리포트 — 심의 불가(프롬프트 공격 탐지) */}
      {result && blocked && (
        <div className="ax-print-area hidden text-[#1f2937] print:block" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
          <h1 className="text-center font-extrabold tracking-tight" style={{ fontSize: "30pt", lineHeight: 1.15 }}>AI 광고도안 심의결과</h1>
          <p className="text-right" style={{ marginTop: "3mm", fontSize: "13pt", color: "#555" }}>심의 일시 {new Date().toLocaleString("ko-KR")} · AI 보조 의견</p>
          {preview && (
            <div className="flex items-center justify-center rounded" style={{ marginTop: "5mm", height: "139mm", border: "1px solid #e2e2e2", background: "#fafafa", overflow: "hidden" }}>
              <div className="relative" style={{ ...(imgAspect >= 176 / 137 ? { width: "100%", aspectRatio: String(imgAspect) } : { height: "137mm", aspectRatio: String(imgAspect) }), lineHeight: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="심의 대상 도안" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
                {injBoxes.map((b) => (
                  <div key={`ib${b.n}`} className="absolute" style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%`, border: "2.5px solid #a32d2d", borderRadius: "2px" }}>
                    <span className="absolute flex items-center justify-center rounded-full text-white" style={{ left: "-12px", top: "-13px", width: "23px", height: "23px", background: "#a32d2d", fontSize: "13pt", fontWeight: 700, border: "2px solid #fff" }}>!</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded" style={{ marginTop: "6mm", border: "1.5px solid #a32d2d", background: "#fcebeb", padding: "13px 16px" }}>
            <div style={{ fontSize: "16pt", fontWeight: 800, color: "#a32d2d" }}>⛔ 심의 불가 — 프롬프트 공격 탐지</div>
            <div style={{ marginTop: "5px", fontSize: "13pt", color: "#7a1f1f", lineHeight: 1.5 }}>{blocked.사유}</div>
          </div>
          {(blocked.문구 ?? []).length > 0 && (
            <div style={{ marginTop: "5mm" }}>
              <div style={{ fontSize: "14pt", fontWeight: 700, color: "#333", marginBottom: "2mm" }}>탐지된 문구</div>
              {(blocked.문구 ?? []).map((p, i) => (
                <div key={i} style={{ fontSize: "13pt", color: "#333", lineHeight: 1.5, marginTop: "1.5mm" }}>· “{p.text}”</div>
              ))}
            </div>
          )}
          <p style={{ marginTop: "6mm", fontSize: "13pt", color: "#888", lineHeight: 1.5 }}>※ 도안에 심의 AI를 조작하려는 지시성 문구가 포함되어 심의를 진행하지 않았습니다. 해당 문구를 제거한 뒤 다시 심의를 요청하세요. 도안 이미지는 서버에 저장되지 않습니다(무저장).</p>
        </div>
      )}
    </PanelShell>
  );
}
