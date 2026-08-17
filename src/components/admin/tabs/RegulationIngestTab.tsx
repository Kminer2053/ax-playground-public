"use client";

import { useEffect, useRef, useState } from "react";

const CATEGORIES = ["규정", "세칙", "지침", "편람", "매뉴얼", "계약서"];

type Audit = {
  retentionPct: number; sourceChars: number; chunkChars: number; chunks: number;
  empty: number; dup: number; buchikLeak: number; midSentence: number; orphanHang: number;
  flags: string[]; score: "good" | "warn" | "bad";
};
type ChangeCat = "real" | "rename" | "marker" | "cosmetic";
type ChangedItem = { name: string; cat: ChangeCat; old: string };
type Diff = { added: string[]; removed: string[]; changed: ChangedItem[]; addedCount: number; removedCount: number; changedCount: number; cats: { real: number; rename: number; marker: number; cosmetic: number }; substantive: number; kept: number; unchanged: number };
type Existing = { year: string; docNumber: string; category: string; articleCount: number; updatedAt: string | null; diff?: Diff };
type PreviewChunk = { name: string; len: number; preview: string };
type SimilarTitle = { title: string; articleCount: number } | null;
type Preview = {
  ok: boolean;
  meta: { title: string; category: string; year: string; docNumber: string; pages: number; via: string };
  similarTitle?: SimilarTitle;
  chunkKnobsInherited?: Record<string, string> | null;
  method: string; note?: string; chars: number; koreanRatio: number;
  audit: Audit; chunks: PreviewChunk[]; existing?: Existing | null;
  rawText: string; ext: string; sourceName: string;
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ko-KR") : "");

const SCORE_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  good: { bg: "#ecfdf5", fg: "#047857", label: "양호" },
  warn: { bg: "#fffbeb", fg: "#b45309", label: "주의" },
  bad: { bg: "#fff1f2", fg: "#be123c", label: "미달" },
};

const CAT_BADGE: Record<string, { label: string; cls: string }> = {
  real: { label: "실질변경", cls: "bg-[#fef3c7] text-[#b45309]" },
  rename: { label: "명칭변경", cls: "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]" },
  marker: { label: "마커", cls: "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]" },
  cosmetic: { label: "표기차", cls: "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]" },
  added: { label: "추가", cls: "bg-[#dcfce7] text-[#047857]" },
};

import { InlineDiff } from "@/components/admin/InlineDiff";

export function RegulationIngestTab() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("규정");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [meta, setMeta] = useState({ title: "", year: "", docNumber: "" });
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openChunk, setOpenChunk] = useState<number | null>(null);
  const [smokeText, setSmokeText] = useState("");
  const [titleExisting, setTitleExisting] = useState<Existing | null | undefined>(undefined);

  const reset = () => { setPreview(null); setResult(null); setError(null); setOpenChunk(null); setTitleExisting(undefined); setSmokeText(""); setMeta({ title: "", year: "", docNumber: "" }); };

  // 제목을 편집하면 그 제목의 기존본 존재를 재확인(교체/신규 판정 갱신). 미편집이면 preview.existing 사용.
  useEffect(() => {
    if (!preview) { setTitleExisting(undefined); return; }
    const t = meta.title.trim();
    if (!t || t === preview.meta.title) { setTitleExisting(undefined); return; }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/regulations/ingest?title=${encodeURIComponent(t)}`);
        const d = await r.json();
        setTitleExisting(d.exists ? (d.existing as Existing) : null);
      } catch { setTitleExisting(undefined); }
    }, 400);
    return () => clearTimeout(id);
  }, [meta.title, preview]);

  const runPreview = async () => {
    if (!file) { setError("파일을 선택하세요."); return; }
    const keepTitle = meta.title.trim();   // 409 후 재분석 — 편집한 제목 기준으로 다시 청킹
    reset(); setLoading(true);
    try {
      const fd = new FormData();
      fd.set("mode", "preview");
      fd.set("file", file);
      fd.set("category", category);
      if (keepTitle) fd.set("title", keepTitle);
      const res = await fetch("/api/admin/regulations/ingest", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok || !d.ok) { setError(d.error || "분석 실패"); return; }
      setPreview(d as Preview);
      setMeta({ title: d.meta.title || "", year: d.meta.year || "", docNumber: d.meta.docNumber || "" });
    } catch {
      setError("요청 실패(네트워크/서버).");
    } finally { setLoading(false); }
  };

  const runCommit = async () => {
    if (!preview) return;
    setCommitting(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.set("mode", "commit");
      fd.set("rawText", preview.rawText);
      fd.set("ext", preview.ext);
      fd.set("sourceName", preview.sourceName);
      fd.set("category", category);
      fd.set("title", meta.title);
      fd.set("year", meta.year);
      fd.set("docNumber", meta.docNumber);
      fd.set("smokeQuestions", smokeText);
      fd.set("previewChunks", String(preview.chunks.length));   // 검수한 청킹 고정 — 어긋나면 서버가 409로 재분석 요구
      const res = await fetch("/api/admin/regulations/ingest", { method: "POST", body: fd });
      const d = await res.json();
      if (res.status === 409 && d.needsRepreview) { setError(d.error); setPreview(null); return; }   // 재분석 필요 — 미리보기 무효화
      if (!res.ok || !d.ok) { setError(d.error || "적재 실패"); return; }
      const head = d.replaced > 0 ? `교체 완료(기존 ${d.replaced}건 대체)` : "신규 적재 완료";
      const fb = d.graph?.llmFallback > 0 ? ` · ⚠ LLM 형식오류로 ${d.graph.llmFallback}건 기본처리(임시 판정 — LLM 복구 후 재적재 시 자동 재판정)` : "";
      // 부분 실패는 "정상 완료"로 보이면 안 된다 — 임베딩 실패·절단·검색목록 실패를 전부 문면에 노출.
      const ef = d.graph?.embedFailed > 0 ? ` · ⚠ 임베딩 실패 ${d.graph.embedFailed}건(옛 벡터 유지 — 서버 확인 후 재적재 필요)` : "";
      const tr = d.graph?.embedTruncated > 0 ? ` · ⚠ 초장문 조문 ${d.graph.embedTruncated}건 절단 임베딩(뒷부분 벡터검색 미노출)` : "";
      const g = d.graph ? ` · 임베딩 ${d.graph.vectors}개(재사용 ${d.graph.reused ?? 0}) · 그래프 참조 ${d.graph.refEdges}·법령 ${d.graph.lawEdges}(재사용 ${d.graph.edgeReused ?? 0})${fb}${ef}${tr}` : " · ⚠ 임베딩/그래프 갱신 실패(임베딩 서버 확인)";
      const inh = (d.inherited?.year || d.inherited?.docNumber) ? ` · 기존 ${[d.inherited.year && "시행일", d.inherited.docNumber && "연번"].filter(Boolean).join("·")} 승계` : "";
      const sm = Array.isArray(d.smoke) && d.smoke.length
        ? (() => { const ok = d.smoke.filter((x: { hit: boolean }) => x.hit).length;
            const miss = d.smoke.filter((x: { hit: boolean }) => !x.hit).map((x: { q: string }) => `"${x.q}"`).join(", ");
            return ok === d.smoke.length ? ` · 검색 확인 ${ok}/${d.smoke.length} 통과` : ` · ⚠ 검색 확인 ${ok}/${d.smoke.length} — 미회수: ${miss}`; })()
        : "";
      const sag = d.sagyuError ? ` ⚠ 검색목록 재생성 실패(${d.sagyuError}) — 좌측 검색에 미반영, 다음 적재 때 재시도됨.` : ` 전체 사규 ${d.sagyuCount}건, 좌측 검색에 반영됨.`;
      setResult(`${head} — "${d.title}" (조문 ${d.chunks}개)${g}${inh}${sm}.${sag}`);
      setPreview(null); setFile(null); setMeta({ title: "", year: "", docNumber: "" }); if (fileRef.current) fileRef.current.value = "";
    } catch {
      setError("적재 요청 실패.");
    } finally { setCommitting(false); }
  };

  const a = preview?.audit;
  const sc = a ? SCORE_STYLE[a.score] : null;
  // 편집된 제목이 있으면 그 기준, 아니면 미리보기 시점 기존본
  const existing = titleExisting !== undefined ? titleExisting : (preview?.existing ?? null);
  const diff = existing?.diff;
  const changedByName = new Map<string, ChangedItem>((diff?.changed ?? []).map((c) => [c.name, c]));
  const addedSet = new Set<string>(diff?.added ?? []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">사규 적재</h2>
        <p className="mt-1 text-sm text-[var(--ax-text-muted)]">
          원본(hwp·pdf·docx) 또는 정제본(md·txt)을 올리면 자동으로 조문 단위로 청킹·검수해 DB에 적재합니다.
          스캔 PDF는 한국어 OCR이 자동 적용됩니다(수 분 소요). 동일 제목은 최신본으로 교체됩니다.
        </p>
      </div>

      {/* 업로드 */}
      <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select value={category} onChange={(e) => { setCategory(e.target.value); reset(); /* 분류는 청킹 전략을 바꾼다 — 미리보기와 다른 결과로 커밋되지 않게 */ }} className="rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".hwp,.hwpx,.pdf,.docx,.xlsx,.md,.txt" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} className="text-sm" />
          <button type="button" onClick={runPreview} disabled={!file || loading}
            className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">
            {loading ? "분석 중…" : "분석/미리보기"}
          </button>
        </div>
        {loading && <p className="mt-2 text-xs text-[var(--ax-text-hint)]">추출·OCR·청킹 중입니다. 스캔 PDF는 페이지 수에 따라 수 분 걸릴 수 있습니다.</p>}
      </div>

      {error && <div className="rounded-lg border border-[#fecdd1] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">{error}</div>}
      {result && <div className="rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-3 text-sm font-medium text-[#047857]">{result}</div>}

      {/* 미리보기 */}
      {preview && a && sc && (
        <div className="space-y-4 rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-4">
          {/* 검수 요약 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full px-3 py-1 text-sm font-bold" style={{ background: sc.bg, color: sc.fg }}>검수 {sc.label}</span>
            <span className="text-sm text-[var(--ax-text-muted)]">조문 {a.chunks}개 · 본문 보존율 {a.retentionPct}% · 전략 {preview.meta.via} · {preview.meta.pages}p</span>
            <span className="text-xs text-[var(--ax-text-hint)]">추출: {preview.method === "ocr" ? "OCR(스캔)" : "텍스트"} · 한글 {Math.round(preview.koreanRatio * 100)}%</span>
          </div>
          {preview.note && <p className="text-xs text-[var(--ax-warning)]">{preview.note}</p>}
          {a.flags.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {a.flags.map((f, i) => <li key={i} className="rounded bg-[var(--ax-border-soft)] px-2 py-1 text-xs text-[var(--ax-text-muted)]">⚠ {f}</li>)}
            </ul>
          )}

          {/* 메타(수정 가능) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-[var(--ax-text-muted)]">제목
              <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm font-normal text-[var(--ax-text)]" />
            </label>
            <label className="text-xs font-semibold text-[var(--ax-text-muted)]">시행일/개정
              <input value={meta.year} onChange={(e) => setMeta({ ...meta, year: e.target.value })} placeholder="예: 2026-04-16" className="mt-1 w-full rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm font-normal text-[var(--ax-text)]" />
            </label>
            <label className="text-xs font-semibold text-[var(--ax-text-muted)]">연번(제N호)
              <input value={meta.docNumber} onChange={(e) => setMeta({ ...meta, docNumber: e.target.value })} placeholder="예: 제7호" className="mt-1 w-full rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm font-normal text-[var(--ax-text)]" />
            </label>
          </div>

          {/* 예상 질문 — 적재 직후 이 질문으로 검색이 되는지 자동 확인(스모크). 부서 제출 양식의 질문을 붙여넣는다 */}
          <label className="block text-xs font-semibold text-[var(--ax-text-muted)]">예상 질문 (한 줄에 하나 · 적재 후 검색 자동 확인 · 비우면 기존 질문 재사용)
            <textarea value={smokeText} onChange={(e) => setSmokeText(e.target.value)} rows={3}
              placeholder={"예)\n외부위탁교육은 몇 시간 이수해야 하나요?\n법정교육은 연간 무엇을 들어야 하나요?"}
              className="mt-1 w-full rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm font-normal text-[var(--ax-text)]" />
          </label>

          {/* 표기만 다른 기존본 — 신규로 갈라져 폐지본이 잔존하는 사고를 여기서 막는다 */}
          {!existing && preview.similarTitle && (
            <div className="rounded-lg border border-[#fecaca] bg-[#fff1f2] p-3 text-sm">
              <p className="font-bold text-[#be123c]">⚠ 표기만 다른 기존본이 있습니다 — 「{preview.similarTitle.title}」 (조문 {preview.similarTitle.articleCount}개)</p>
              <p className="mt-1 text-xs text-[var(--ax-text-muted)]">
                이대로 적재하면 <b>신규 문서로 갈라져 옛 버전이 검색에 계속 남습니다.</b> 교체가 맞다면 위 제목 칸을
                「{preview.similarTitle.title}」로 고쳐 주세요. 별개 문서가 맞을 때만 그대로 진행하세요.
              </p>
              <button type="button" onClick={() => setMeta((m) => ({ ...m, title: preview.similarTitle!.title }))}
                className="mt-2 rounded-md border border-[#fca5a5] bg-white px-2.5 py-1 text-xs font-bold text-[#be123c] hover:bg-[#fff5f5]">
                제목을 기존본과 맞추기
              </button>
            </div>
          )}

          {/* 청킹 노브 승계 — hwp 원본 교체에서도 기존 세밀 청킹 유지됨을 알림 */}
          {preview.chunkKnobsInherited && (
            <p className="rounded-lg border border-[var(--ax-border)] bg-[var(--ax-border-soft)] px-3 py-2 text-xs text-[var(--ax-text-muted)]">
              기존본의 청킹 방식을 승계했습니다: {Object.entries(preview.chunkKnobsInherited).map(([k, v]) => `${k}=${v}`).join(" · ")}
            </p>
          )}

          {/* 동일 제목 기존본 = 버전 교체 안내 + 변경점 */}
          {existing && (
            <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] p-3 text-sm">
              <p className="font-bold text-[#b45309]">⚠ 동일 제목의 기존본이 있습니다 — 적재하면 최신본으로 <b>교체</b>됩니다.</p>
              <p className="mt-1.5 text-xs text-[var(--ax-text-muted)]">
                기존: 시행일 <b>{existing.year || "—"}</b> · 연번 <b>{existing.docNumber || "—"}</b> · 조문 <b>{existing.articleCount}</b>개{existing.updatedAt ? ` · 수정 ${fmtDate(existing.updatedAt)}` : ""}
                {"  →  "}신규: 시행일 <b>{meta.year || "—"}</b> · 연번 <b>{meta.docNumber || "—"}</b> · 조문 <b>{preview.chunks.length}</b>개
              </p>
              {existing.diff && (
                <div className="mt-1 space-y-0.5 text-xs text-[var(--ax-text-muted)]">
                  <p>변경점: 추가 <b className="text-[#047857]">+{existing.diff.addedCount}</b> · 삭제 <b className="text-[#be123c]">−{existing.diff.removedCount}</b> · <b className="text-[#b45309]">실질변경 {existing.diff.substantive}</b> · 무변경 {existing.diff.unchanged}</p>
                  {existing.diff.changedCount - existing.diff.substantive > 0 && (
                    <p className="text-[var(--ax-text-hint)]">비실질 {existing.diff.changedCount - existing.diff.substantive}건(마커 {existing.diff.cats.marker}·명칭 {existing.diff.cats.rename}·표기차 {existing.diff.cats.cosmetic}) — 개정마커·명칭변경·표 표기차로 실질내용 변화 아님(조문 열어 확인)</p>
                  )}
                  {existing.diff.substantive > 0 && <p className="text-[var(--ax-text-hint)]">실질변경 조문: {existing.diff.changed.filter((c) => c.cat === "real").map((c) => c.name).slice(0, 12).join(", ")}{existing.diff.substantive > 12 ? " …" : ""}</p>}
                  {existing.diff.addedCount > 0 && <p className="text-[var(--ax-text-hint)]">추가: {existing.diff.added.slice(0, 6).join(", ")}{existing.diff.addedCount > 6 ? " …" : ""}</p>}
                  {existing.diff.removedCount > 0 && <p className="text-[var(--ax-text-hint)]">삭제: {existing.diff.removed.slice(0, 6).join(", ")}{existing.diff.removedCount > 6 ? " …" : ""}</p>}
                </div>
              )}
            </div>
          )}

          {/* 조문 미리보기 + 변경내역 */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-xs font-bold text-[var(--ax-text-muted)]">조문 {preview.chunks.length}개 (클릭하면 본문·변경내역)</p>
              {diff && (
                <span className="text-[11px] text-[var(--ax-text-hint)]">
                  배지 <span className="rounded bg-[#fef3c7] px-1 text-[#b45309]">실질변경</span> <span className="rounded bg-[#dcfce7] px-1 text-[#047857]">추가</span> <span className="rounded bg-[var(--ax-border-soft)] px-1">마커·명칭·표기차</span> · 열면 <span className="bg-[#dcfce7] text-[#166534]">신규</span>/<span className="bg-[#fee2e2] text-[#b91c1c] line-through">삭제</span>
                </span>
              )}
            </div>
            <div className="max-h-[360px] space-y-1 overflow-y-auto">
              {preview.chunks.map((c, i) => {
                const ch = changedByName.get(c.name);
                const isAdded = addedSet.has(c.name);
                const badge = isAdded ? CAT_BADGE.added : ch ? CAT_BADGE[ch.cat] : null;
                return (
                  <div key={i} className="rounded-lg border border-[var(--ax-border)]">
                    <button type="button" onClick={() => setOpenChunk(openChunk === i ? null : i)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--ax-border-soft)]">
                      <span className="font-semibold text-[var(--ax-text)]">{c.name}</span>
                      {badge && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>}
                      <span className="ml-auto text-[11px] text-[var(--ax-text-hint)]">{c.len}자</span>
                    </button>
                    {openChunk === i && (
                      <div className="max-h-[320px] overflow-auto border-t border-[var(--ax-border)] bg-[var(--ax-border-soft)] p-3 text-xs">
                        {ch ? <InlineDiff oldText={ch.old} newText={c.preview} />
                          : isAdded ? <InlineDiff oldText="" newText={c.preview} />
                            : <pre className="whitespace-pre-wrap text-[var(--ax-text-muted)]">{c.preview}</pre>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={runCommit} disabled={committing || a.score === "bad"}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold text-white transition disabled:opacity-60"
              style={{ background: existing ? "#b45309" : "var(--ax-accent)" }}>
              {committing && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
              {committing ? "적재 중…" : existing ? "기존본 교체 적재" : "DB에 신규 적재"}
            </button>
            {committing && <span className="text-xs text-[var(--ax-text-hint)]">임베딩·그래프 갱신까지 수 초~수십 초 걸립니다. 창을 닫지 마세요.</span>}
            {!committing && a.score === "bad" && <span className="text-xs text-[#be123c]">품질 미달 — 적재 불가(원본/형식 확인)</span>}
            {!committing && <button type="button" onClick={() => { setPreview(null); reset(); }} className="text-sm text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]">취소</button>}
          </div>
        </div>
      )}
    </div>
  );
}
