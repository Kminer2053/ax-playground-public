"use client";

import Link from "next/link";
import { useState } from "react";
import { preventImeEnterFormSubmit } from "@/lib/imeEnter";
import { formatLlmMs } from "@/components/llm/formatLlmDuration";
import { LlmMarkdown } from "@/components/llm/LlmMarkdown";
import { LlmSpinner } from "@/components/llm/LlmSpinner";

export default function SafetyChatPage() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setReply("");
    setElapsedMs(null);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/safety/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
        credentials: "include",
      });
      const data = await res.json();
      setElapsedMs(Math.round(performance.now() - t0));
      setReply(data.reply || data.error || "응답을 받지 못했습니다.");
    } catch {
      setReply("서버 연결에 실패했습니다.");
      setElapsedMs(Math.round(performance.now() - t0));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link href="/safety" className="text-gray-500 hover:text-[var(--brand-blue)]">← 안전</Link>
      <h1 className="text-2xl font-bold">스마트안전챗봇</h1>
      <form onSubmit={handleSubmit} onKeyDownCapture={preventImeEnterFormSubmit} className="flex gap-2 items-center">
        <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="안전 관련 질문 (예: 소화기 사용법)" className="flex-1 px-4 py-3 rounded-xl border border-gray-200" />
        <button type="submit" disabled={loading} className="bg-[var(--brand-blue)] text-white font-semibold px-6 py-3 rounded-xl disabled:opacity-50 flex items-center gap-2 min-w-[100px] justify-center">
          {loading ? <LlmSpinner className="w-5 h-5" accentClass="border-t-white border-white/25" /> : null}
          {loading ? "대기" : "질문"}
        </button>
      </form>
      {loading && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3 text-sm text-slate-600">
          <LlmSpinner className="w-5 h-5" accentClass="border-t-[var(--brand-blue)]" />
          답변 생성 중…
        </div>
      )}
      {reply && !loading && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-100">
          <div className="flex justify-end mb-2">
            {elapsedMs != null && <span className="text-xs text-slate-400">응답 소요 {formatLlmMs(elapsedMs)}</span>}
          </div>
          <LlmMarkdown className="text-slate-800">{reply}</LlmMarkdown>
        </div>
      )}
    </div>
  );
}
