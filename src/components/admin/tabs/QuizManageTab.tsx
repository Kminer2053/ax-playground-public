"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Q = { _id: string; question: string; choices: string[]; answerIndex: number; explanation?: string };
type Form = { question: string; choices: string[]; answerIndex: number; explanation: string };
type Rank = { rank: number; nickname: string; score: number; comboMax: number };

/** 따옴표·줄바꿈 처리하는 최소 CSV 파서. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function QuizManageTab() {
  const [items, setItems] = useState<Q[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showRanking, setShowRanking] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await fetch("/api/quiz/pool").then((r) => r.json()); setItems(d.items || []); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const del = async (id: string) => {
    if (!window.confirm("이 문제를 삭제할까요?")) return;
    await fetch(`/api/quiz/pool/${id}`, { method: "DELETE" });
    void load();
  };

  const openNew = () => { setForm({ question: "", choices: ["", "", "", ""], answerIndex: 0, explanation: "" }); setEditingId(null); setErr(""); };
  const openEdit = (q: Q) => { setForm({ question: q.question, choices: [...q.choices], answerIndex: q.answerIndex, explanation: q.explanation || "" }); setEditingId(q._id); setErr(""); };

  const submit = async () => {
    if (!form) return;
    if (!form.question.trim() || form.choices.some((c) => !c.trim())) { setErr("문제와 모든 보기를 입력하세요."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(editingId ? `/api/quiz/pool/${editingId}` : "/api/quiz/pool", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: form.question.trim(), choices: form.choices.map((c) => c.trim()), answerIndex: form.answerIndex, explanation: form.explanation.trim() }),
      });
      const d = await r.json();
      if (d.ok) { setForm(null); setEditingId(null); void load(); }
      else setErr(d.error || "저장 실패");
    } finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const csv = "문제,보기1,보기2,보기3,보기4,정답번호,해설\n생성형 AI 답변은 항상 사실인가?,예,아니오,,,2,사실 확인이 필요합니다\nAI에게 역할을 미리 지정하는 지침은?,시스템 프롬프트,쿠키,세션,메타태그,1,\n";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "quiz_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File) => {
    setBulkMsg("");
    const rows = parseCSV(await file.text());
    const dataRows = rows.length && rows[0].join("").includes("문제") ? rows.slice(1) : rows;
    const list = dataRows.map((cols) => {
      const choices = [cols[1], cols[2], cols[3], cols[4]].map((s) => (s || "").trim());
      while (choices.length > 2 && !choices[choices.length - 1]) choices.pop();
      return { question: (cols[0] || "").trim(), choices, answerIndex: Math.max(0, (Number(cols[5]) || 1) - 1), explanation: (cols[6] || "").trim() };
    }).filter((x) => x.question);
    if (list.length === 0) { setBulkMsg("읽을 데이터가 없습니다."); return; }
    const r = await fetch("/api/quiz/pool/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: list }) });
    const d = await r.json();
    if (d.ok) { setBulkMsg(`✓ ${d.added}건 추가${d.skipped ? `, ${d.skipped}건 형식오류로 제외` : ""}`); void load(); }
    else setBulkMsg(d.error || "업로드 실패");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-[var(--ax-text-muted)]">문제 <b className="text-[var(--ax-text)]">{items.length}</b>개</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={openNew} className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white">+ 문제 추가</button>
          <button onClick={downloadTemplate} className="rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">CSV 양식</button>
          <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">엑셀/CSV 일괄</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          <button onClick={() => setShowRanking(true)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-[var(--ax-danger)] hover:bg-[var(--ax-danger-bg)]">랭킹 확인·초기화</button>
        </div>
      </div>
      {bulkMsg && <p className="rounded-[var(--ax-radius)] bg-[var(--ax-accent-bg)] px-3 py-2 text-sm text-[var(--ax-accent)]">{bulkMsg}</p>}

      {form && (
        <QForm form={form} setForm={setForm} editing={!!editingId} busy={busy} err={err} onSubmit={submit} onCancel={() => { setForm(null); setEditingId(null); }} />
      )}

      {loading ? <div className="py-12 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div> : (
        <div className="space-y-2">
          {items.map((q) => (
            <div key={q._id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--ax-border)] bg-white p-3 shadow-sm">
              <button onClick={() => openEdit(q)} className="min-w-0 flex-1 text-left">
                <div className="text-sm font-bold text-[var(--ax-text)]">{q.question}</div>
                <div className="mt-1 text-xs text-[var(--ax-text-hint)]">정답: {q.choices[q.answerIndex]} · 보기 {q.choices.length}개</div>
              </button>
              <div className="flex flex-none gap-1">
                <button onClick={() => openEdit(q)} className="material-symbols-outlined rounded-lg px-2 py-1 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]" title="수정">edit</button>
                <button onClick={() => del(q._id)} className="material-symbols-outlined rounded-lg px-2 py-1 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-danger-bg)] hover:text-[var(--ax-danger)]" title="삭제">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showRanking && <RankingModal onClose={() => setShowRanking(false)} />}
    </div>
  );
}

function QForm({ form, setForm, editing, busy, err, onSubmit, onCancel }: {
  form: Form; setForm: (f: Form) => void; editing: boolean; busy: boolean; err: string; onSubmit: () => void; onCancel: () => void;
}) {
  const inputCls = "w-full rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent-border)]";
  const setChoice = (i: number, v: string) => { const ch = [...form.choices]; ch[i] = v; setForm({ ...form, choices: ch }); };
  const addChoice = () => { if (form.choices.length < 6) setForm({ ...form, choices: [...form.choices, ""] }); };
  const rmChoice = (i: number) => {
    if (form.choices.length <= 2) return;
    const ch = form.choices.filter((_, j) => j !== i);
    setForm({ ...form, choices: ch, answerIndex: form.answerIndex >= ch.length ? 0 : form.answerIndex });
  };
  return (
    <div className="space-y-2 rounded-2xl border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] p-4">
      <div className="text-sm font-black text-[var(--ax-accent)]">{editing ? "문제 수정" : "문제 추가"}</div>
      {err && <p className="rounded bg-[var(--ax-danger-bg)] px-3 py-2 text-xs text-[var(--ax-danger)]">{err}</p>}
      <input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="문제" className={inputCls} />
      {form.choices.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="radio" checked={form.answerIndex === i} onChange={() => setForm({ ...form, answerIndex: i })} title="정답" />
          <input value={c} onChange={(e) => setChoice(i, e.target.value)} placeholder={`보기 ${i + 1}${form.answerIndex === i ? " (정답)" : ""}`} className={`flex-1 ${inputCls}`} />
          {form.choices.length > 2 && <button onClick={() => rmChoice(i)} className="material-symbols-outlined rounded px-1 text-[16px] text-[var(--ax-text-hint)] hover:text-[var(--ax-danger)]" title="보기 삭제">close</button>}
        </div>
      ))}
      {form.choices.length < 6 && <button onClick={addChoice} className="text-xs font-bold text-[var(--ax-accent)]">+ 보기 추가</button>}
      <input value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} placeholder="해설(선택)" className={inputCls} />
      <div className="flex gap-2">
        <button onClick={onSubmit} disabled={busy} className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "저장…" : editing ? "수정" : "추가"}</button>
        <button onClick={onCancel} className="rounded-lg border border-[var(--ax-border)] bg-white px-4 py-2 text-sm text-[var(--ax-text-muted)]">취소</button>
      </div>
    </div>
  );
}

function RankingModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Rank[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    void fetch("/api/quiz/ranking?limit=100").then((r) => r.json()).then((d) => setRows(d.ranking || [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const reset = async () => {
    if (!window.confirm("랭킹 기록을 전체 초기화할까요? 되돌릴 수 없습니다.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/quiz/ranking", { method: "DELETE" });
      if (r.ok) { setRows([]); window.alert("랭킹을 초기화했습니다."); }
      else window.alert("초기화에 실패했습니다.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-md overflow-hidden rounded-[var(--ax-radius-lg)] bg-[var(--ax-card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--ax-border-soft)] p-4">
          <h2 className="font-black text-[var(--ax-text)]">랭킹 ({rows.length})</h2>
          <button onClick={onClose} aria-label="닫기" className="material-symbols-outlined text-[20px] text-[var(--ax-text-hint)] hover:text-[var(--ax-text)]">close</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {loading ? <div className="py-10 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div> : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--ax-text-hint)]">랭킹 기록이 없습니다.</div>
          ) : (
            <div className="space-y-1">
              {rows.map((r) => (
                <div key={`${r.rank}-${r.nickname}`} className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm odd:bg-[var(--ax-border-soft)]">
                  <span className="flex items-center gap-2"><b className={`w-6 text-center ${r.rank <= 3 ? "text-amber-500" : "text-[var(--ax-text-hint)]"}`}>{r.rank}</b>{r.nickname}</span>
                  <span className="text-[var(--ax-text-muted)]">🔥{r.comboMax} · <b className="text-[var(--ax-text)]">{r.score.toLocaleString()}</b></span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-[var(--ax-border-soft)] p-3">
          <button onClick={reset} disabled={busy || rows.length === 0} className="w-full rounded-[var(--ax-radius)] bg-[var(--ax-danger-bg)] py-2 text-sm font-bold text-[var(--ax-danger)] hover:brightness-95 disabled:opacity-50">{busy ? "초기화…" : "랭킹 전체 초기화"}</button>
        </div>
      </div>
    </div>
  );
}
