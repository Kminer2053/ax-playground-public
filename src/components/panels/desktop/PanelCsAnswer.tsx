"use client";

import { useState, type ReactNode } from "react";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { useOrgName } from "@/components/OrgProvider";
import { orgLabel } from "@/lib/org";
import { LlmSpinner } from "@/components/llm/LlmSpinner";
import { formatLlmMs } from "@/components/llm/formatLlmDuration";
import { FeedbackBar } from "@/components/panels/desktop/FeedbackBar";

type Analysis = { summary: string; category: string; actions: string[] };
type CitedStat = { label: string; value: number | string; verified: boolean };
type Result = {
  analysis: Analysis | null;
  recurrence: string;
  citedStats: CitedStat[];
  reply: string;
  answerBody: string;
  complaintSummary: string;
  groundedOn: string;
};

const TONES = [
  { key: "standard", label: "표준", desc: "정중한 표준 문체" },
  { key: "empathy", label: "공감 강화", desc: "따뜻한 공감 어조" },
  { key: "concise", label: "간결", desc: "핵심만 짧게" },
];
const TYPES = ["상품·품질", "환불·교환", "시설·청결", "직원응대", "결제·이용", "기타"];

export function PanelCsAnswer() {
  const org = orgLabel(useOrgName());
  const [content, setContent] = useState("");
  const [tone, setTone] = useState("standard");
  const [type, setType] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async (overrideTone?: string) => {
    const t = overrideTone ?? tone;
    if (!content.trim()) { setError("민원 내용을 입력해 주세요."); return; }
    if (overrideTone) setTone(overrideTone);
    setLoading(true); setError(null); setResult(null); setElapsedMs(null); setCopied(false);
    const t0 = performance.now();
    try {
      const r = await fetch("/api/cs/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, tone: t, type }),
      });
      const d = await r.json();
      setElapsedMs(Math.round(performance.now() - t0));
      if (d.ok) {
        setResult({
          analysis: d.analysis ?? null,
          recurrence: typeof d.recurrence === "string" ? d.recurrence : "",
          citedStats: Array.isArray(d.citedStats) ? d.citedStats : [],
          reply: typeof d.reply === "string" ? d.reply : "",
          answerBody: typeof d.answerBody === "string" ? d.answerBody : "",
          complaintSummary: typeof d.complaintSummary === "string" ? d.complaintSummary : "",
          groundedOn: typeof d.groundedOn === "string" ? d.groundedOn : "",
        });
      } else setError(d.error || "답변 생성에 실패했습니다.");
    } catch {
      setError("서버 연결에 실패했습니다.");
      setElapsedMs(Math.round(performance.now() - t0));
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!result?.reply) return;
    void navigator.clipboard?.writeText(result.reply).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--ax-page)]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col px-6 py-6">
        <PanelHeader icon="support_agent" title="AI 민원답변" />

        <p className="mb-5 text-sm text-[var(--ax-text-muted)]">
          접수된 민원을 붙여넣고 유형·어조를 지정하면, <b>2024–2025 전사 민원 집계를 근거로</b> 핵심 분석·반복성 진단과
          {org} 고객의소리 답변 양식(인사말·담당자·맺음말 고정)을 생성합니다.
        </p>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* 좌: 입력 */}
          <section className="min-h-0 overflow-y-auto rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 shadow-sm">
            <label className="mb-1.5 block text-sm font-bold text-[var(--ax-text)]">
              민원 내용 <span className="text-[var(--ax-danger)]">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              maxLength={4000}
              placeholder="고객이 접수한 민원 내용을 입력하거나 붙여넣으세요."
              className="w-full resize-y rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white p-4 text-sm leading-relaxed text-[var(--ax-text)] outline-none transition focus:border-[var(--ax-accent)] focus:ring-2 focus:ring-[var(--ax-accent-soft)]"
            />
            <div className="mt-1 text-right text-xs text-[var(--ax-text-hint)]">{content.length}/4000</div>

            <Field label="민원 유형" hint="선택 · 미지정 시 자동 분류">
              {TYPES.map((x) => <Chip key={x} active={type === x} onClick={() => setType(type === x ? "" : x)}>{x}</Chip>)}
            </Field>
            <Field label="답변 어조">
              {TONES.map((x) => <Chip key={x.key} active={tone === x.key} onClick={() => setTone(x.key)} title={x.desc}>{x.label}</Chip>)}
            </Field>

            <button
              type="button"
              onClick={() => generate()}
              disabled={loading}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[var(--ax-radius)] bg-[var(--ax-accent)] px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-60"
            >
              {loading
                ? <LlmSpinner className="h-5 w-5" accentClass="border-t-white border-white/30" />
                : <span className="material-symbols-outlined text-[18px]">auto_awesome</span>}
              {loading ? "분석 · 생성 중…" : "분석 · 답변 생성"}
            </button>
            {error && <div className="mt-3 rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] px-4 py-3 text-sm text-[var(--ax-danger)]">{error}</div>}
          </section>

          {/* 우: 결과 */}
          <section className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-8 text-center shadow-sm">
                <LlmSpinner className="h-8 w-8" />
                <p className="mt-3 text-sm text-[var(--ax-text-muted)]">2년치 데이터를 근거로 분석하고 답변을 작성하고 있습니다…</p>
              </div>
            ) : !result ? (
              <div className="flex min-h-[340px] flex-col items-center justify-center rounded-[var(--ax-radius-lg)] border border-dashed border-[var(--ax-border)] bg-[var(--ax-card)] p-8 text-center">
                <span className="material-symbols-outlined text-[40px] text-[var(--ax-text-hint)]">support_agent</span>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ax-text-muted)]">
                  좌측에 민원 내용을 입력하고<br />‘분석 · 답변 생성’을 누르면<br />결과가 여기에 표시됩니다.
                </p>
              </div>
            ) : (
              <>
                {result.analysis && (
                  <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 shadow-sm">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-[var(--ax-text)]">
                      <span className="material-symbols-outlined text-[20px] text-[var(--ax-accent)]">insights</span>핵심 분석
                    </h3>
                    <dl className="flex flex-col gap-2.5 text-sm">
                      <Row label="요지"><span className="leading-relaxed text-[var(--ax-text)]">{result.analysis.summary || "—"}</span></Row>
                      <Row label="분류">
                        <span className="rounded-full bg-[var(--ax-accent-bg)] px-2.5 py-0.5 text-xs font-bold text-[var(--ax-accent)]">{result.analysis.category}</span>
                      </Row>
                    </dl>
                    {result.analysis.actions.length > 0 && (
                      <div className="mt-3 border-t border-[var(--ax-border-soft)] pt-3">
                        <div className="mb-1.5 text-xs font-bold text-[var(--ax-text-muted)]">권장 조치</div>
                        <ul className="flex flex-col gap-1.5">
                          {result.analysis.actions.map((a, i) => (
                            <li key={i} className="flex gap-1.5 text-sm leading-relaxed text-[var(--ax-text)]">
                              <span className="material-symbols-outlined mt-0.5 flex-none text-[16px] text-[var(--ax-success)]">check_circle</span>{a}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 2년치 데이터 근거 */}
                {result.groundedOn && (result.recurrence || result.citedStats.length > 0) && (
                  <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] border-l-4 border-l-[var(--ax-accent)] bg-[var(--ax-card)] p-5 shadow-sm">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-[var(--ax-text)]">
                      <span className="material-symbols-outlined text-[20px] text-[var(--ax-accent)]">database</span>2년치 데이터 근거
                      <span className="text-[10px] font-normal text-[var(--ax-text-hint)]">({result.groundedOn})</span>
                    </h3>
                    {result.recurrence && <p className="text-sm leading-relaxed text-[var(--ax-text)]">{result.recurrence}</p>}
                    {result.citedStats.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {result.citedStats.map((s, i) => (
                          <span
                            key={i}
                            title={s.verified ? "집계 데이터와 일치 확인" : "집계에서 미확인 — 참고만"}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
                              s.verified
                                ? "bg-[var(--ax-accent-bg)] text-[var(--ax-accent)] ring-[var(--ax-accent-border)]"
                                : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)] ring-[var(--ax-border)]"
                            }`}
                          >
                            {s.verified ? "✓ " : ""}{s.label} {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 추천 공식 답변 */}
                <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-extrabold text-[var(--ax-text)]">
                      <span className="material-symbols-outlined text-[20px] text-[var(--ax-success)]">mark_email_read</span>추천 공식 답변
                    </h3>
                    <div className="flex items-center gap-2">
                      {elapsedMs != null && <span className="text-xs text-[var(--ax-text-hint)]">{formatLlmMs(elapsedMs)}</span>}
                      <button type="button" onClick={copy} className="rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] px-3 py-1 text-xs font-bold text-[var(--ax-text-muted)] transition hover:bg-[var(--ax-accent-bg)]">{copied ? "복사됨 ✓" : "복사"}</button>
                      <button type="button" onClick={() => generate()} className="rounded-[var(--ax-radius-sm)] border border-[var(--ax-accent-border)] px-3 py-1 text-xs font-bold text-[var(--ax-accent)] transition hover:bg-[var(--ax-accent-bg)]">재생성</button>
                    </div>
                  </div>
                  <textarea
                    value={result.reply}
                    onChange={(e) => setResult({ ...result, reply: e.target.value })}
                    rows={13}
                    className="w-full resize-y rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white p-4 text-sm leading-relaxed text-[var(--ax-text)] outline-none transition focus:border-[var(--ax-accent)] focus:ring-2 focus:ring-[var(--ax-accent-soft)]"
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ax-border-soft)] pt-2.5 text-xs text-[var(--ax-text-hint)]">
                    <span>초안입니다. <b>000(이름)·연락처</b>를 채워 사용하세요.</span>
                    <span>
                      다른 어조:{" "}
                      {TONES.map((t) => (
                        <button key={t.key} type="button" onClick={() => generate(t.key)} className="mx-1 font-semibold text-[var(--ax-accent)] underline-offset-2 hover:underline">{t.label}</button>
                      ))}
                    </span>
                  </div>
                  <FeedbackBar
                    payload={{ panel: "cs", question: (result.complaintSummary || content).slice(0, 2000), answer: (result.reply || "").slice(0, 8000) }}
                    resetKey={result.reply?.slice(0, 40)}
                  />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-3.5">
      <div className="mb-1.5 text-sm font-bold text-[var(--ax-text)]">
        {label}{hint && <span className="ml-1 font-normal text-[var(--ax-text-hint)]">· {hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${active ? "bg-[var(--ax-accent)] text-white" : "border border-[var(--ax-border)] bg-white text-[var(--ax-text-muted)] hover:bg-[var(--ax-accent-bg)]"}`}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 flex-none pt-0.5 text-xs font-bold text-[var(--ax-text-muted)]">{label}</dt>
      <dd className="flex-1">{children}</dd>
    </div>
  );
}

