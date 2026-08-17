"use client";

// 생성된 구조(DocData)를 JSON이 아니라 장/절/항목 위계형 폼으로 편집한다.
// 지원: 보고서(full·1p) + 보도자료(press). 그 외 양식은 읽기용 미리보기(패널에서 분기).
// 위계가 한눈에 들어오도록 카드+헤더바+들여쓰기로 단계를 구분하고, 풀버전 장은 접기/펼치기 지원.
import { useState, type ReactNode } from "react";
import { type DocFormat, fullChapterSectionCap, FULL_MAX_CHAPTERS, ONEP_MAX_SECTIONS } from "@/lib/docs-generate";
import { Label, TextInput, TextArea } from "@/components/ui";

type Obj = Record<string, unknown>;
type Section = { title?: string; heading?: string; items?: string[]; detail?: string; note?: string };
type PressLine = { level: "□" | "○"; text: string };
type GongItem = { text?: string; subs?: string[] };

const LIMIT = {
  sections1p: { min: 2, max: ONEP_MAX_SECTIONS }, // 빌더 슬롯 4개
  chaptersFull: { min: 3, max: FULL_MAX_CHAPTERS }, // 장 슬롯 6개
  sectionsFull: { min: 1 }, // 장당 절 max는 위치별 fullChapterSectionCap(ci)
  pressBody: { min: 3, max: 12 }, // SCHEMA_PRESS body
  pressSubtitles: { min: 1, max: 2 },
  gongItems: { min: 1, max: 8 }, // SCHEMA_GONGMUN items
  gongAtts: { max: 5 }, // 붙임
};
const ROMAN = "ⅠⅡⅢⅣⅤⅥ";
const GANADA = "가나다라마바사아"; // 시행문 본문 항목 머리표

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

type FormField = { n?: number; label: string; role?: string; max?: number; value?: string; fillable?: boolean };

/** 임의 양식(서식/폼): 감지된 필드를 [번호][역할][값] 3열로 검토·수정한다.
 *  값 입력은 필드별 최대글자(max)로 하드 제한 + 실시간 카운터(셀 넘침 방지).
 *  fillable===false(자동 채움 불가·병합/예시 잔재)는 '직접 입력'으로 표시하고 입력을 잠근다. */
export function FormFieldsEditor({ value, onChange }: { value: Obj; onChange: (v: Obj) => void }) {
  const fields = (value.fields as FormField[]) ?? [];
  const setField = (i: number, val: string) => onChange({ ...value, fields: fields.map((f, j) => (j === i ? { ...f, value: val } : f)) });
  const auto = fields.filter((f) => f.fillable !== false);
  const manual = fields.filter((f) => f.fillable === false).length;
  const filled = auto.filter((f) => String(f.value ?? "").trim()).length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--ax-text-muted)]">📋 감지된 편집영역 — 번호·역할·값(최대글자)</span>
        <span className="text-[11px] text-[var(--ax-text-hint)]">{filled}/{auto.length} 채움{manual > 0 ? ` · 직접입력 ${manual}` : ""}</span>
      </div>
      {fields.map((f, i) => {
        const max = typeof f.max === "number" && f.max > 0 ? f.max : 200;
        const cur = String(f.value ?? "");
        const near = cur.length >= max; // 한도 도달
        const longField = max >= 100;
        const noAuto = f.fillable === false; // 자동 채움 불가
        return (
          <div key={i} className={`flex items-start gap-2 rounded-[var(--ax-radius-sm)] border px-2 py-1.5 ${noAuto ? "border-dashed border-[var(--ax-border)] bg-[var(--ax-border-soft)]" : "border-[var(--ax-border)] bg-[var(--ax-card)]"}`}>
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${noAuto ? "bg-[var(--ax-text-hint)]" : "bg-[var(--ax-accent)]"}`}>{f.n ?? i + 1}</span>
            <span className="mt-1 w-24 shrink-0 truncate text-xs font-medium text-[var(--ax-text)]" title={f.label}>{f.role || f.label}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {noAuto ? (
                <input
                  disabled value=""
                  placeholder="다운로드 후 한컴에서 직접 입력"
                  className="min-w-0 cursor-not-allowed rounded-[5px] border border-dashed border-[var(--ax-border)] bg-transparent px-2 py-1 text-sm text-[var(--ax-text-hint)] outline-none"
                />
              ) : longField ? (
                <textarea
                  value={cur} maxLength={max} rows={2}
                  onChange={(e) => setField(i, e.target.value)}
                  placeholder="(비움)"
                  className="min-w-0 resize-y rounded-[5px] border border-[var(--ax-border)] bg-[var(--ax-page)] px-2 py-1 text-sm outline-none focus:border-[var(--ax-accent)]"
                />
              ) : (
                <input
                  value={cur} maxLength={max}
                  onChange={(e) => setField(i, e.target.value)}
                  placeholder="(비움)"
                  className="min-w-0 rounded-[5px] border border-[var(--ax-border)] bg-[var(--ax-page)] px-2 py-1 text-sm outline-none focus:border-[var(--ax-accent)]"
                />
              )}
              {noAuto ? (
                <span className="self-end text-[10px] font-medium text-[var(--ax-warning)]">✎ 자동 채움 미지원 — 직접 입력</span>
              ) : (
                <span className={`self-end text-[10px] tabular-nums ${near ? "font-bold text-[var(--ax-warning)]" : "text-[var(--ax-text-hint)]"}`}>{cur.length}/{max}자</span>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--ax-text-hint)]">각 칸은 서식 셀 크기에 맞춰 최대글자를 제한합니다(넘침 방지). 빈 칸은 채우지 않습니다. ‘직접 입력’ 표시된 칸은 서식 구조상 자동 채움이 어려워 다운로드 후 한컴에서 입력합니다.</p>
    </div>
  );
}

export function isStructEditable(format: DocFormat): boolean {
  return format === "full" || format === "1p" || format === "press" || format === "gongmun";
}

// 빌드 전 정리 — 빈 항목/줄 제거(편집 중 빈 줄 허용 → 전송 시 정리).
export function cleanStructure(format: DocFormat, data: Obj): Obj {
  const cleanSec = (s: Section): Section => ({
    ...s,
    items: (s.items ?? []).map((x) => x.trim()).filter(Boolean),
  });
  if (format === "full") {
    return {
      ...data,
      summary: Array.isArray(data.summary) ? (data.summary as string[]).map((x) => x.trim()).filter(Boolean) : data.summary,
      chapters: ((data.chapters as Obj[]) ?? []).map((ch) => ({
        ...ch,
        sections: ((ch.sections as Section[]) ?? []).map(cleanSec),
      })),
    };
  }
  if (format === "1p") {
    return { ...data, sections: ((data.sections as Section[]) ?? []).map(cleanSec) };
  }
  if (format === "press") {
    return {
      ...data,
      subtitles: Array.isArray(data.subtitles) ? (data.subtitles as string[]).map((x) => x.trim()).filter(Boolean) : data.subtitles,
      body: ((data.body as PressLine[]) ?? [])
        .map((b) => ({ level: b.level === "○" ? "○" : "□", text: (b.text ?? "").trim() }))
        .filter((b) => b.text),
    };
  }
  if (format === "gongmun") {
    return {
      ...data,
      items: ((data.items as GongItem[]) ?? [])
        .map((it) => ({ text: (it.text ?? "").trim(), subs: (it.subs ?? []).map((s) => s.trim()).filter(Boolean) }))
        .filter((it) => it.text),
      attachments: Array.isArray(data.attachments) ? (data.attachments as string[]).map((x) => x.trim()).filter(Boolean) : data.attachments,
    };
  }
  return data; // 그 외 양식은 위계 편집 미지원 → 그대로
}

// ── 공통 입력 ──
function Field({ label, value, onChange, area, mono }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; mono?: boolean }) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <Label>{label}</Label>
      {area ? (
        <TextArea value={value} onChange={(e) => onChange(e.target.value)} className={`min-h-16 ${mono ? "font-mono text-[11px]" : ""}`} />
      ) : (
        <TextInput value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** 순서이동(↑↓)·삭제(✕) — 한계 도달 시 비활성. */
function RowControls({ onUp, onDown, onRemove, canUp, canDown, canRemove }: { onUp: () => void; onDown: () => void; onRemove: () => void; canUp: boolean; canDown: boolean; canRemove: boolean }) {
  const btn = "flex h-6 w-6 items-center justify-center rounded-[6px] border border-[var(--ax-border)] bg-[var(--ax-card)] text-xs text-[var(--ax-text-muted)] enabled:hover:bg-[var(--ax-border-soft)] disabled:opacity-30";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" className={btn} onClick={onUp} disabled={!canUp} aria-label="위로">↑</button>
      <button type="button" className={btn} onClick={onDown} disabled={!canDown} aria-label="아래로">↓</button>
      <button type="button" className={`${btn} enabled:hover:border-[var(--ax-danger)] enabled:hover:text-[var(--ax-danger)]`} onClick={onRemove} disabled={!canRemove} aria-label="삭제">✕</button>
    </div>
  );
}

function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-[var(--ax-radius-sm)] border border-dashed border-[var(--ax-accent-border)] py-1.5 text-xs font-medium text-[var(--ax-accent)] transition enabled:hover:bg-[var(--ax-accent-bg)] disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** 위계 단계 표식 배지(Ⅰ·소제목 등). */
function Badge({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "muted" }) {
  const cls = tone === "accent"
    ? "bg-[var(--ax-accent)] text-white"
    : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]";
  return <span className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] px-1 text-[11px] font-bold ${cls}`}>{children}</span>;
}

/** 헤더바에 들어가는 인라인 편집 입력(테두리 없이 바에 녹아듦). */
function BarInput({ value, onChange, placeholder, bold }: { value: string; onChange: (v: string) => void; placeholder?: string; bold?: boolean }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`min-w-0 flex-1 rounded-[5px] border border-transparent bg-white/70 px-2 py-1 text-sm text-[var(--ax-text)] outline-none transition focus:border-[var(--ax-accent)] focus:bg-white ${bold ? "font-semibold" : ""}`}
    />
  );
}

// ── 절(소제목) 카드 — 항목/세부/주석 ──
function SectionCard({ sec, titleKey, badge, onChange, controls }: { sec: Section; titleKey: "title" | "heading"; badge: ReactNode; onChange: (s: Section) => void; controls: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-[var(--ax-page)] p-2.5">
      <div className="flex items-center gap-2">
        {badge}
        <input
          value={sec[titleKey] ?? ""}
          onChange={(e) => onChange({ ...sec, [titleKey]: e.target.value })}
          placeholder="소제목"
          className="min-w-0 flex-1 rounded-[5px] border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-1 text-sm font-medium text-[var(--ax-text)] outline-none focus:border-[var(--ax-accent)]"
        />
        {controls}
      </div>
      <div className="pl-1">
        <Field label="◦ 항목 (한 줄에 하나)" area value={(sec.items ?? []).join("\n")} onChange={(v) => onChange({ ...sec, items: v.split("\n") })} />
        {sec.detail !== undefined && <div className="mt-1.5"><Field label="– 세부" value={sec.detail ?? ""} onChange={(v) => onChange({ ...sec, detail: v })} /></div>}
        {sec.note !== undefined && <div className="mt-1.5"><Field label="※ 주석" value={sec.note ?? ""} onChange={(v) => onChange({ ...sec, note: v })} /></div>}
      </div>
    </div>
  );
}

// ── 문서 정보(공통 상단) ──
function MetaCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ax-text-muted)]">📄 문서 정보</div>
      {children}
    </div>
  );
}

export function StructureEditor({ format, value, onChange }: { format: DocFormat; value: Obj; onChange: (v: Obj) => void }) {
  const set = (patch: Obj) => onChange({ ...value, ...patch });
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const toggleCollapse = (ci: number) => setCollapsed((c) => (c.includes(ci) ? c.filter((x) => x !== ci) : [...c, ci]));

  // ── 시행문(공문) ──
  if (format === "gongmun") {
    const items = (value.items as GongItem[]) ?? [];
    const atts = (value.attachments as string[]) ?? [];
    const setItems = (next: GongItem[]) => set({ items: next });
    const setAtts = (next: string[]) => set({ attachments: next });
    return (
      <div className="flex flex-col gap-3">
        <MetaCard>
          <Field label="제목" value={(value.title as string) ?? ""} onChange={(v) => set({ title: v })} />
          <Field label="수신" value={(value.receiver as string) ?? ""} onChange={(v) => set({ receiver: v })} />
          <Field label="도입부 (서술식 인사·배경)" area value={(value.opening as string) ?? ""} onChange={(v) => set({ opening: v })} />
        </MetaCard>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--ax-text-muted)]">본문 항목 (가·나·다 …)</span>
            <span className="text-[11px] text-[var(--ax-text-hint)]">{items.length}/{LIMIT.gongItems.max}</span>
          </div>
          {items.map((it, i) => {
            const subs = it.subs ?? [];
            const patchItem = (patch: GongItem) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="flex flex-col gap-2 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-[var(--ax-page)] p-2.5">
                <div className="flex items-center gap-2">
                  <Badge>{GANADA[i] ?? i + 1}</Badge>
                  <input
                    value={it.text ?? ""}
                    onChange={(e) => patchItem({ text: e.target.value })}
                    placeholder="항목 제목"
                    className="min-w-0 flex-1 rounded-[5px] border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-1 text-sm font-medium outline-none focus:border-[var(--ax-accent)]"
                  />
                  <RowControls onUp={() => setItems(move(items, i, -1))} onDown={() => setItems(move(items, i, 1))} onRemove={() => setItems(items.filter((_, j) => j !== i))} canUp={i > 0} canDown={i < items.length - 1} canRemove={items.length > LIMIT.gongItems.min} />
                </div>
                <div className="pl-1">
                  <Field label="1)·2) 하위 항목 (한 줄에 하나, 선택)" area value={subs.join("\n")} onChange={(v) => patchItem({ subs: v.split("\n") })} />
                </div>
              </div>
            );
          })}
          <AddButton label="＋ 항목 추가" onClick={() => setItems([...items, { text: "새 항목", subs: [] }])} disabled={items.length >= LIMIT.gongItems.max} />
        </div>

        <div className="flex flex-col gap-2 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3">
          <span className="text-xs font-semibold text-[var(--ax-text-muted)]">붙임 (선택)</span>
          {atts.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <Badge tone="muted">{i + 1}</Badge>
              <input value={a} onChange={(e) => setAtts(atts.map((x, j) => (j === i ? e.target.value : x)))} placeholder="붙임 파일·문서명" className="min-w-0 flex-1 rounded-[5px] border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-1 text-sm outline-none focus:border-[var(--ax-accent)]" />
              <RowControls onUp={() => setAtts(move(atts, i, -1))} onDown={() => setAtts(move(atts, i, 1))} onRemove={() => setAtts(atts.filter((_, j) => j !== i))} canUp={i > 0} canDown={i < atts.length - 1} canRemove />
            </div>
          ))}
          {atts.length < LIMIT.gongAtts.max && <AddButton label="＋ 붙임 추가" onClick={() => setAtts([...atts, ""])} />}
        </div>
      </div>
    );
  }

  // ── 보도자료 ──
  if (format === "press") {
    const subtitles = (value.subtitles as string[]) ?? [];
    const body = (value.body as PressLine[]) ?? [];
    const quote = (value.quote as { speaker?: string; part1?: string; part2?: string }) ?? {};
    const setBody = (next: PressLine[]) => set({ body: next });
    const setSubs = (next: string[]) => set({ subtitles: next });
    return (
      <div className="flex flex-col gap-3">
        <MetaCard>
          <Field label="제목" value={(value.title as string) ?? ""} onChange={(v) => set({ title: v })} />
          <div className="flex flex-col gap-1">
            <Label>부제목 (1~2개)</Label>
            {subtitles.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge tone="muted">{i + 1}</Badge>
                <input value={s} onChange={(e) => setSubs(subtitles.map((x, j) => (j === i ? e.target.value : x)))} placeholder="부제목" className="min-w-0 flex-1 rounded-[5px] border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-1 text-sm outline-none focus:border-[var(--ax-accent)]" />
                <RowControls onUp={() => setSubs(move(subtitles, i, -1))} onDown={() => setSubs(move(subtitles, i, 1))} onRemove={() => setSubs(subtitles.filter((_, j) => j !== i))} canUp={i > 0} canDown={i < subtitles.length - 1} canRemove={subtitles.length > LIMIT.pressSubtitles.min} />
              </div>
            ))}
            {subtitles.length < LIMIT.pressSubtitles.max && <AddButton label="＋ 부제목 추가" onClick={() => setSubs([...subtitles, ""])} />}
          </div>
          <Field label="발신 부서" value={(value.deptBiz as string) ?? ""} onChange={(v) => set({ deptBiz: v })} />
        </MetaCard>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--ax-text-muted)]">본문 — □ 핵심 / ○ 부연</span>
            <span className="text-[11px] text-[var(--ax-text-hint)]">{body.length}/{LIMIT.pressBody.max}</span>
          </div>
          {body.map((line, i) => (
            <div key={i} className="flex items-start gap-2 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-[var(--ax-page)] p-2">
              <button
                type="button"
                onClick={() => setBody(body.map((b, j) => (j === i ? { ...b, level: b.level === "□" ? "○" : "□" } : b)))}
                title="□(핵심)/○(부연) 전환"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[var(--ax-accent-border)] bg-[var(--ax-card)] text-sm text-[var(--ax-accent)] hover:bg-[var(--ax-accent-bg)]"
              >
                {line.level}
              </button>
              <textarea
                value={line.text}
                onChange={(e) => setBody(body.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))}
                rows={2}
                placeholder="문장 ('~다'로 끝나는 보도체)"
                className="min-h-9 min-w-0 flex-1 resize-y rounded-[5px] border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-1 text-sm leading-relaxed outline-none focus:border-[var(--ax-accent)]"
              />
              <RowControls onUp={() => setBody(move(body, i, -1))} onDown={() => setBody(move(body, i, 1))} onRemove={() => setBody(body.filter((_, j) => j !== i))} canUp={i > 0} canDown={i < body.length - 1} canRemove={body.length > LIMIT.pressBody.min} />
            </div>
          ))}
          <AddButton label="＋ 본문 줄 추가" onClick={() => setBody([...body, { level: body.at(-1)?.level === "□" ? "○" : "□", text: "" }])} disabled={body.length >= LIMIT.pressBody.max} />
        </div>

        <div className="flex flex-col gap-2 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3">
          <div className="text-xs font-semibold text-[var(--ax-text-muted)]">“ 인용문 (대표 발언)</div>
          <Field label="화자" value={quote.speaker ?? ""} onChange={(v) => set({ quote: { ...quote, speaker: v } })} />
          <Field label="앞 문장" area value={quote.part1 ?? ""} onChange={(v) => set({ quote: { ...quote, part1: v } })} />
          <Field label="뒤 문장" area value={quote.part2 ?? ""} onChange={(v) => set({ quote: { ...quote, part2: v } })} />
        </div>
      </div>
    );
  }

  // ── 보고서(full·1p) ──
  const sections = (value.sections as Section[]) ?? [];
  const chapters = (value.chapters as Obj[]) ?? [];
  const setSections = (next: Section[]) => set({ sections: next });
  const setChapters = (next: Obj[]) => set({ chapters: next });

  return (
    <div className="flex flex-col gap-3">
      <MetaCard>
        <Field label="제목" value={(value.title as string) ?? ""} onChange={(v) => set({ title: v })} />
        <Field label="부제" value={(value.subtitle as string) ?? ""} onChange={(v) => set({ subtitle: v })} />
        <div className="flex gap-2.5">
          <Field label="소속부서" value={(value.department as string) ?? ""} onChange={(v) => set({ department: v })} />
          <Field label="작성일자" value={(value.date as string) ?? ""} onChange={(v) => set({ date: v })} />
        </div>
      </MetaCard>

      {format === "full" ? (
        <>
          {Array.isArray(value.summary) && (
            <div className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3">
              <Field label="보고내용 요약 (한 줄에 하나)" area value={(value.summary as string[]).join("\n")} onChange={(v) => set({ summary: v.split("\n") })} />
            </div>
          )}
          {chapters.map((ch, ci) => {
            const chSections = (ch.sections as Section[]) ?? [];
            const open = !collapsed.includes(ci);
            const patchCh = (patch: Obj) => {
              const next = [...chapters];
              next[ci] = { ...ch, ...patch };
              setChapters(next);
            };
            return (
              <div key={ci} className="overflow-hidden rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)]">
                {/* 장 헤더바 */}
                <div className="flex items-center gap-2 border-b border-[var(--ax-border-soft)] bg-[var(--ax-accent-bg)] px-2.5 py-2">
                  <button type="button" onClick={() => toggleCollapse(ci)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[var(--ax-text-muted)] hover:bg-white/60" aria-label={open ? "접기" : "펼치기"}>
                    {open ? "▾" : "▸"}
                  </button>
                  <Badge>{ROMAN[ci] ?? ci + 1}</Badge>
                  <BarInput value={(ch.heading as string) ?? ""} onChange={(v) => patchCh({ heading: v })} placeholder="장 제목" bold />
                  <RowControls
                    onUp={() => setChapters(move(chapters, ci, -1))}
                    onDown={() => setChapters(move(chapters, ci, 1))}
                    onRemove={() => setChapters(chapters.filter((_, j) => j !== ci))}
                    canUp={ci > 0}
                    canDown={ci < chapters.length - 1}
                    canRemove={chapters.length > LIMIT.chaptersFull.min}
                  />
                </div>
                {open ? (
                  <div className="flex flex-col gap-2 p-2.5">
                    {chSections.map((sec, si) => (
                      <SectionCard
                        key={si}
                        sec={sec}
                        titleKey="title"
                        badge={<Badge tone="muted">{si + 1}</Badge>}
                        onChange={(s) => {
                          const ns = [...chSections];
                          ns[si] = s;
                          patchCh({ sections: ns });
                        }}
                        controls={
                          <RowControls
                            onUp={() => patchCh({ sections: move(chSections, si, -1) })}
                            onDown={() => patchCh({ sections: move(chSections, si, 1) })}
                            onRemove={() => patchCh({ sections: chSections.filter((_, j) => j !== si) })}
                            canUp={si > 0}
                            canDown={si < chSections.length - 1}
                            canRemove={chSections.length > LIMIT.sectionsFull.min}
                          />
                        }
                      />
                    ))}
                    <AddButton
                      label="＋ 소제목 추가"
                      onClick={() => patchCh({ sections: [...chSections, { title: "새 소제목", items: ["내용을 입력하세요"] }] })}
                      disabled={chSections.length >= fullChapterSectionCap(ci)}
                    />
                  </div>
                ) : (
                  <button type="button" onClick={() => toggleCollapse(ci)} className="w-full px-2.5 py-1.5 text-left text-[11px] text-[var(--ax-text-hint)] hover:bg-[var(--ax-border-soft)]">
                    소제목 {chSections.length}개 — 펼치기
                  </button>
                )}
              </div>
            );
          })}
          <AddButton
            label="＋ 장 추가"
            onClick={() => setChapters([...chapters, { heading: "새 장", sections: [{ title: "새 소제목", items: ["내용을 입력하세요"] }] }])}
            disabled={chapters.length >= LIMIT.chaptersFull.max}
          />
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-[var(--ax-text-muted)]">본문 항목</span>
          {sections.map((sec, si) => (
            <SectionCard
              key={si}
              sec={sec}
              titleKey="heading"
              badge={<Badge>{si + 1}</Badge>}
              onChange={(s) => {
                const next = [...sections];
                next[si] = s;
                setSections(next);
              }}
              controls={
                <RowControls
                  onUp={() => setSections(move(sections, si, -1))}
                  onDown={() => setSections(move(sections, si, 1))}
                  onRemove={() => setSections(sections.filter((_, j) => j !== si))}
                  canUp={si > 0}
                  canDown={si < sections.length - 1}
                  canRemove={sections.length > LIMIT.sections1p.min}
                />
              }
            />
          ))}
          <AddButton
            label="＋ 항목 추가"
            onClick={() => setSections([...sections, { heading: "새 항목", items: ["내용을 입력하세요"] }])}
            disabled={sections.length >= LIMIT.sections1p.max}
          />
        </div>
      )}
    </div>
  );
}
