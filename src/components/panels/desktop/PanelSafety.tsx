"use client";

import { useState, useEffect, useRef, useCallback, type ChangeEventHandler, type ReactNode } from "react";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { runOnEnterKeySubmit } from "@/lib/imeEnter";
import { formatLlmMs } from "@/components/llm/formatLlmDuration";
import { LlmMarkdown } from "@/components/llm/LlmMarkdown";
import { InlineMd } from "@/components/llm/InlineMd";
import { FeedbackBar } from "@/components/panels/desktop/FeedbackBar";
import { LlmSpinner } from "@/components/llm/LlmSpinner";
import { pickRandomCards, categoryStyle, type SafetyQa } from "@/lib/safety-qa";
import { strongQaPool } from "@/lib/safety-rag";
import { useOrgName } from "@/components/OrgProvider";
import { orgLabel } from "@/lib/org";

interface SafetyImageAnalysis {
  riskLevel?: string;
  summary?: string;
  violations?: string[];
  regulations?: string[];
  actions?: string[];
}

interface ChatMessage {
  id: string;
  type: "user" | "bot";
  content: string;
  imageUrl?: string;
  analysis?: SafetyImageAnalysis | null;
  elapsedMs?: number;
  /** 이 답변이 나온 질문 — 피드백에 함께 보낸다(오류 메시지엔 없음). */
  question?: string;
}

type Attach = { name: string; size: number; url: string };

interface Article {
  _id: string;
  title: string;
  content?: string;
  createdAt?: string;
  type?: string;
  imageUrl?: string;
  attachments?: Attach[];
}

type Editor = { mode: "create" | "edit"; type: "news" | "library"; _id?: string; title: string; content: string; imageUrl: string; attachments: Attach[] };

const FALLBACK_NEWS: Article[] = [
  { _id: "fb-n1", title: "동절기 매장 전열기구 특별 점검", content: "샘플 항목입니다. 관리 비밀번호로 실제 공지를 등록할 수 있습니다.", createdAt: "2026-02-06" },
  { _id: "fb-n2", title: "중대재해처벌법 매장 의무사항 안내", content: "샘플 항목입니다.", createdAt: "2026-02-01" },
];
const FALLBACK_LIBRARY: Article[] = [
  { _id: "fb-l1", title: "안전보건 가이드북", content: "샘플 항목입니다." },
  { _id: "fb-l2", title: "심폐소생술(CPR) 교육", content: "샘플 항목입니다." },
];

const isNone = (s: string) => /^(없음|해당\s*없음|없습니다|특이사항\s*없음|이상\s*없음|n\/?a|none|-|·|\.)$/i.test(s.trim());
const clean = (arr?: string[]) => (arr ?? []).map((s) => (s ?? "").trim()).filter((s) => s.length > 0 && !isNone(s));
const formatBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n > 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
const isRealId = (id: string) => /^[a-f0-9]{24}$/i.test(id);

function riskMeta(level?: string): { label: string; emoji: string; cls: string } {
  const s = (level ?? "").toLowerCase();
  if (/심각|위험|높음|high|critical|danger|severe/.test(s))
    return { label: level || "위험", emoji: "🔴", cls: "border-[var(--ax-danger)]/30 bg-[var(--ax-danger-bg)] text-[var(--ax-danger)]" };
  if (/주의|중간|보통|medium|moderate|warn/.test(s))
    return { label: level || "주의", emoji: "🟡", cls: "border-[var(--ax-warning)]/30 bg-[var(--ax-warning-bg)] text-[var(--ax-warning)]" };
  if (/안전|양호|낮음|low|safe|good|normal/.test(s))
    return { label: level || "양호", emoji: "🟢", cls: "border-[var(--ax-success)]/30 bg-[var(--ax-success-bg)] text-[var(--ax-success)]" };
  return { label: level || "미확인", emoji: "⚪", cls: "border-[var(--ax-border)] bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]" };
}

export function PanelSafety() {
  const org = orgLabel(useOrgName());
  const [news, setNews] = useState<Article[]>([]);
  const [library, setLibrary] = useState<Article[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      type: "bot",
      content:
        `안녕하세요. **${org} 안전 AI** 입니다.\n"콘센트가 뜨거워요", "기름에 불나면 어떡해요?" 처럼 매장 안전 상황을 편하게 물어보세요.\n\n📸 **카메라 버튼**으로 현장 사진을 보내주시면 위험 요소를 진단해 드립니다.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [quickCards, setQuickCards] = useState<SafetyQa[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 게시판 관리
  const [managePw, setManagePw] = useState<string | null>(null); // null=잠김
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockErr, setUnlockErr] = useState("");
  const [viewArticle, setViewArticle] = useState<Article | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorErr, setEditorErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const editorImageRef = useRef<HTMLInputElement>(null);
  const editorFileRef = useRef<HTMLInputElement>(null);
  const locked = managePw === null;

  const loadArticles = useCallback(() => {
    fetch("/api/safety/articles?type=news", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setNews(d?.ok && d?.items?.length ? d.items : FALLBACK_NEWS))
      .catch(() => setNews(FALLBACK_NEWS));
    fetch("/api/safety/articles?type=library", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setLibrary(d?.ok && d?.items?.length ? d.items : FALLBACK_LIBRARY))
      .catch(() => setLibrary(FALLBACK_LIBRARY));
  }, []);
  useEffect(() => { loadArticles(); }, [loadArticles]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  // 홈 퀵카드 — 난수 사용으로 SSR/클라 불일치 방지 위해 마운트 후 1회 생성
  useEffect(() => { setQuickCards(pickRandomCards(8, strongQaPool)); }, []);

  const toggleCheck = (key: string) => setChecked((c) => ({ ...c, [key]: !c[key] }));

  const send = async (text: string) => {
    if (!text || sending) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, type: "user", content: text }]);
    setSending(true);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/safety/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        credentials: "include",
      });
      const data = await res.json();
      const elapsedMs = Math.round(performance.now() - t0);
      const reply = data?.ok && data?.reply
        ? data.reply
        : data?.error
          ? `⚠️ ${data.error}`
          : "관련된 안전 규정을 찾지 못했습니다. '전기', '소화기', '넘어짐', '기름' 등의 키워드로 다시 질문해 주세요.";
      setMessages((prev) => [...prev, { id: `b-${Date.now()}`, type: "bot", content: reply, elapsedMs, question: text }]);
    } catch {
      const elapsedMs = Math.round(performance.now() - t0);
      setMessages((prev) => [...prev, { id: `b-${Date.now()}`, type: "bot", content: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", elapsedMs }]);
    } finally {
      setSending(false);
    }
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    void send(text);
  };
  const askCard = (qa: SafetyQa) => { void send(qa.q); };

  const onPickImage: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file || sending) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const imageDataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!imageDataUrl) return;
      const ts = Date.now();
      setMessages((prev) => [...prev, { id: `u-${ts}`, type: "user", content: "📷 현장 사진을 첨부했습니다. 위험요소를 진단해 주세요.", imageUrl: imageDataUrl }]);
      setSending(true);
      const t0 = performance.now();
      try {
        const res = await fetch("/api/safety/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ message: "첨부 이미지 기준으로 안전 위험요소를 분석해 주세요.", imageDataUrl }),
        });
        const data = await res.json();
        const elapsedMs = Math.round(performance.now() - t0);
        const reply = data?.ok && data?.reply
          ? data.reply
          : data?.error
            ? `⚠️ ${data.error}`
            : "이미지 분석에 실패했습니다. 빛이 충분한 곳에서 위험 요소가 잘 보이도록 다시 촬영해 주세요.";
        setMessages((prev) => [...prev, { id: `b-${Date.now()}`, type: "bot", content: reply, analysis: data?.analysis ?? null, elapsedMs }]);
      } catch {
        const elapsedMs = Math.round(performance.now() - t0);
        setMessages((prev) => [...prev, { id: `b-${Date.now()}`, type: "bot", content: "이미지 분석 중 오류가 발생했습니다.", elapsedMs }]);
      } finally {
        setSending(false);
      }
    };
    reader.readAsDataURL(file);
    e.currentTarget.value = "";
  };

  const doUnlock = async () => {
    setUnlockErr("");
    try {
      const r = await fetch("/api/safety/articles/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: unlockInput }),
      }).then((x) => x.json());
      if (r.ok) { setManagePw(unlockInput); setUnlockOpen(false); setUnlockInput(""); }
      else setUnlockErr("비밀번호가 올바르지 않습니다.");
    } catch {
      setUnlockErr("확인 중 오류가 발생했습니다.");
    }
  };

  const uploadEditorFile = async (file: File, kind: "image" | "file"): Promise<Attach | null> => {
    const fd = new FormData();
    fd.append("file", file); fd.append("kind", kind); fd.append("password", managePw ?? "");
    try {
      const r = await fetch("/api/safety/upload", { method: "POST", credentials: "include", body: fd }).then((x) => x.json());
      return r?.ok ? { name: r.name, size: r.size, url: r.url } : null;
    } catch {
      return null;
    }
  };

  const onPickEditorImage: ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0]; e.currentTarget.value = ""; if (!f) return;
    setUploading(true); setEditorErr("");
    const s = await uploadEditorFile(f, "image");
    setUploading(false);
    if (s) setEditor((ed) => (ed ? { ...ed, imageUrl: s.url } : ed));
    else setEditorErr("이미지 업로드에 실패했습니다.");
  };

  const onPickEditorFiles: ChangeEventHandler<HTMLInputElement> = async (e) => {
    const files = Array.from(e.target.files ?? []); e.currentTarget.value = ""; if (!files.length) return;
    setUploading(true); setEditorErr("");
    for (const f of files) {
      const s = await uploadEditorFile(f, "file");
      if (s) setEditor((ed) => (ed ? { ...ed, attachments: [...ed.attachments, s] } : ed));
      else setEditorErr(`'${f.name}' 업로드에 실패했습니다.`);
    }
    setUploading(false);
  };

  const saveEditor = async () => {
    if (!editor) return;
    const title = editor.title.trim();
    const content = editor.content.trim();
    if (!title || !content) { setEditorErr("제목과 내용을 모두 입력하세요."); return; }
    setEditorBusy(true); setEditorErr("");
    try {
      const isCreate = editor.mode === "create";
      const r = await fetch(isCreate ? "/api/safety/articles" : `/api/safety/articles/${editor._id}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title, content, type: editor.type, imageUrl: editor.imageUrl, attachments: editor.attachments, password: managePw ?? "" }),
      }).then((x) => x.json());
      if (r.ok) { setEditor(null); loadArticles(); }
      else setEditorErr(r.error ?? "저장에 실패했습니다.");
    } catch (e) {
      setEditorErr((e as Error).message);
    } finally {
      setEditorBusy(false);
    }
  };

  const deleteArticle = async (a: Article) => {
    if (!window.confirm(`'${a.title}' 게시물을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    const r = await fetch(`/api/safety/articles/${a._id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password: managePw ?? "" }),
    }).then((x) => x.json()).catch(() => ({}));
    if (r.ok) { setViewArticle(null); loadArticles(); }
    else window.alert(r.error ?? "삭제에 실패했습니다.");
  };

  const formatDate = (d?: string) => {
    if (!d) return "";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  const openCreate = (type: "news" | "library") => { setEditorErr(""); setEditor({ mode: "create", type, title: "", content: "", imageUrl: "", attachments: [] }); };

  return (
    <div className="min-h-screen bg-[var(--ax-page)]">
      <div className="mx-auto flex h-screen max-w-[1672px] flex-col px-6 py-5">
        <PanelHeader icon="health_and_safety" title="스마트 안전관리" />

        {/* 2단: 좌(채팅·진단) / 우(뉴스·자료 5:5 + 팁) */}
        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* ── 좌: 채팅 & 사진 진단 ── */}
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-sm">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--ax-border)] px-5 py-3">
              <span className="material-symbols-outlined text-[22px] text-[var(--ax-accent)]">forum</span>
              <div>
                <div className="text-sm font-bold text-[var(--ax-text)]">안전 AI</div>
                <div className="text-[11px] text-[var(--ax-text-muted)]">실시간 상담 &amp; 현장 진단</div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
              {messages.map((m) => (
                <div key={m.id} className={`flex max-w-[88%] items-start gap-2.5 ${m.type === "user" ? "flex-row-reverse self-end" : ""}`}>
                  {m.type === "bot" && (
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] text-[var(--ax-accent)]">
                      <span className="material-symbols-outlined text-[20px]">health_and_safety</span>
                    </div>
                  )}
                  <div className={`rounded-[var(--ax-radius)] px-4 py-3 text-[15px] leading-relaxed break-words ${m.type === "user" ? "bg-[var(--ax-accent)] text-white" : "border border-[var(--ax-border)] bg-[var(--ax-border-soft)] text-[var(--ax-text)]"}`}>
                    {m.imageUrl ? (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold opacity-90">첨부 이미지</div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.imageUrl} alt="첨부 현장 사진" className="max-h-72 w-full rounded-lg border border-white/30 object-cover" />
                      </div>
                    ) : m.analysis ? (
                      <AnalysisCard analysis={m.analysis} msgId={m.id} checked={checked} onToggle={toggleCheck} elapsedMs={m.elapsedMs} />
                    ) : m.type === "bot" ? (
                      <>
                        <LlmMarkdown compact className="text-[15px]">{m.content}</LlmMarkdown>
                        {m.elapsedMs != null && <p className="mt-2 border-t border-[var(--ax-border)] pt-2 text-[10px] text-[var(--ax-text-hint)]">응답 {formatLlmMs(m.elapsedMs)}</p>}
                        {/* 안전 질의 답변도 품질 평가 대상이다(사진 진단에만 있던 것을 채운다). 오류 메시지엔 붙지 않는다. */}
                        {m.question && (
                          <FeedbackBar
                            payload={{ panel: "safety", question: m.question, answer: m.content.slice(0, 8000) }}
                            resetKey={m.id}
                          />
                        )}
                      </>
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}
              {messages.length <= 1 && !sending && quickCards.length > 0 && (
                <div className="mt-1">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ax-text-muted)]">
                      <span className="material-symbols-outlined text-[16px] text-[var(--ax-accent)]">quiz</span>이런 게 궁금하지 않으세요?
                    </div>
                    <button type="button" onClick={() => setQuickCards(pickRandomCards(8, strongQaPool))} className="flex items-center gap-1 rounded-lg border border-[var(--ax-border)] px-2 py-1 text-[11px] font-semibold text-[var(--ax-text-muted)] transition hover:bg-[var(--ax-border-soft)]">
                      <span className="material-symbols-outlined text-[13px]">refresh</span>다른 질문
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {quickCards.map((qa) => {
                      const st = categoryStyle(qa.category);
                      return (
                        <button key={qa.id} type="button" onClick={() => askCard(qa)} className="group flex items-start gap-2.5 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white p-3 text-left transition hover:border-[var(--ax-accent-border)] hover:shadow-sm">
                          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg" style={{ background: st.bg }}>
                            <span className="material-symbols-outlined text-[18px]" style={{ color: st.color }}>{st.icon}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--ax-text)]">{qa.q}</span>
                            <span className="mt-0.5 block text-[11px] font-medium" style={{ color: st.color }}>{qa.category}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {sending && (
                <div className="flex max-w-[88%] items-start gap-2.5">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] text-[var(--ax-accent)]">
                    <span className="material-symbols-outlined text-[20px]">health_and_safety</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-border-soft)] px-4 py-3 text-sm text-[var(--ax-text-muted)]">
                    <LlmSpinner className="h-4 w-4" accentClass="border-t-[var(--ax-accent)]" /> 분석 중…
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="flex flex-shrink-0 items-center gap-2 border-t border-[var(--ax-border)] p-4">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
              <button type="button" onClick={() => fileInputRef.current?.click()} title="현장 사진 첨부 → AI 위험진단"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-[var(--ax-border)] bg-white text-[var(--ax-text-muted)] transition hover:border-[var(--ax-accent-border)] hover:text-[var(--ax-accent)]">
                <span className="material-symbols-outlined">add_a_photo</span>
              </button>
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => runOnEnterKeySubmit(e, sendMessage)}
                className="h-11 flex-1 rounded-full border border-[var(--ax-border)] bg-white px-4 text-[15px] text-[var(--ax-text)] outline-none focus:border-[var(--ax-accent)] focus:ring-2 focus:ring-[var(--ax-accent-soft)]"
                placeholder="매장 안전이 궁금하면 무엇이든 물어보세요…" />
              <button type="button" onClick={sendMessage} disabled={sending || !input.trim()}
                className="flex h-11 min-w-[84px] flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--ax-accent)] px-5 font-bold text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">
                {sending ? <LlmSpinner className="h-4 w-4" accentClass="border-t-white border-white/25" /> : <span className="material-symbols-outlined text-[18px]">send</span>}
                {sending ? "" : "전송"}
              </button>
            </div>
          </section>

          {/* ── 우: 뉴스·자료 5:5 + 팁(하단 고정) ── */}
          <aside className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-shrink-0 items-center justify-between rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] px-3 py-2 text-xs">
              <span className="font-bold text-[var(--ax-text-muted)]">게시판 관리</span>
              {locked ? (
                <button onClick={() => { setUnlockErr(""); setUnlockOpen(true); }} className="flex items-center gap-1 rounded-lg border border-[var(--ax-border)] px-2 py-1 font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">
                  <span className="material-symbols-outlined text-[14px]">lock</span>잠금 해제
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 font-bold text-[var(--ax-success)]"><span className="material-symbols-outlined text-[14px]">lock_open</span>관리 모드</span>
                  <button onClick={() => setManagePw(null)} className="rounded-lg border border-[var(--ax-border)] px-2 py-1 font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">잠금</button>
                </div>
              )}
            </div>

            <SideCard icon="campaign" title="최신 안전 뉴스" onAdd={!locked ? () => openCreate("news") : undefined}>
              {(news.length ? news : FALLBACK_NEWS).map((n) => (
                <ArticleRow key={n._id} article={n} sub={formatDate(n.createdAt)} badge="공지" thumb={n.imageUrl} onOpen={() => setViewArticle(n)} />
              ))}
            </SideCard>

            <SideCard icon="folder_open" title="안전 필수 자료" onAdd={!locked ? () => openCreate("library") : undefined}>
              {(library.length ? library : FALLBACK_LIBRARY).map((l) => (
                <ArticleRow key={l._id} article={l} sub={l.attachments?.length ? `첨부 ${l.attachments.length}개` : (l.content ?? "").slice(0, 40)} icon="description" onOpen={() => setViewArticle(l)} />
              ))}
            </SideCard>

            <div className="flex-shrink-0 rounded-[var(--ax-radius-lg)] border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] p-3 text-xs leading-relaxed text-[var(--ax-text-muted)]">
              <div className="mb-1 flex items-center gap-1.5 font-bold text-[var(--ax-accent)]">
                <span className="material-symbols-outlined text-[18px]">tips_and_updates</span> 사진 진단 팁
              </div>
              소화기·비상구·전선·통로 등 <b>위험이 보이는 곳</b>을 밝은 곳에서 가까이 촬영하면 더 정확하게 진단됩니다.
            </div>
          </aside>
        </div>
      </div>

      {/* ── 모달: 잠금 해제 ── */}
      {unlockOpen && (
        <Modal size="md" title="게시판 관리 잠금 해제" onClose={() => setUnlockOpen(false)}>
          <p className="mb-3 text-sm text-[var(--ax-text-muted)]">관리자 페이지에서 설정한 <b>안전 게시판 비밀번호</b>를 입력하면 뉴스·자료를 등록·수정·삭제할 수 있습니다.</p>
          <input autoFocus type="password" value={unlockInput} onChange={(e) => setUnlockInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void doUnlock(); }}
            placeholder="관리 비밀번호" className="w-full rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)]" />
          {unlockErr && <p className="mt-2 text-sm text-[var(--ax-danger)]">{unlockErr}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setUnlockOpen(false)} className="rounded-lg border border-[var(--ax-border)] px-4 py-2 text-sm font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">취소</button>
            <button onClick={doUnlock} className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--ax-accent-dark)]">확인</button>
          </div>
        </Modal>
      )}

      {/* ── 모달: 게시물 보기 (확대) ── */}
      {viewArticle && (
        <Modal size="5xl" title={viewArticle.type === "library" ? "안전 자료" : "안전 공지"} onClose={() => setViewArticle(null)}>
          {viewArticle.type === "news" ? (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="flex items-start justify-center overflow-hidden rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-border-soft)] p-2">
                {viewArticle.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={viewArticle.imageUrl} alt={viewArticle.title} className="max-h-[60vh] w-full rounded object-contain" />
                ) : (
                  <div className="flex h-56 w-full items-center justify-center text-sm text-[var(--ax-text-hint)]">등록된 이미지 없음</div>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="mb-1 text-xl font-bold text-[var(--ax-text)]">{viewArticle.title}</h2>
                {viewArticle.createdAt && <div className="mb-3 text-xs text-[var(--ax-text-hint)]">{formatDate(viewArticle.createdAt)}</div>}
                <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-[var(--ax-text)]">{viewArticle.content || "(내용 없음)"}</div>
              </div>
            </div>
          ) : (
            <div>
              <h2 className="mb-1 text-xl font-bold text-[var(--ax-text)]">{viewArticle.title}</h2>
              <div className="mb-4 max-h-[45vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-[var(--ax-text)]">{viewArticle.content || "(내용 없음)"}</div>
              {viewArticle.attachments && viewArticle.attachments.length > 0 && (
                <div className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-border-soft)] p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--ax-text)]"><span className="material-symbols-outlined text-[18px] text-[var(--ax-accent)]">attach_file</span>첨부파일 {viewArticle.attachments.length}개</div>
                  <ul className="space-y-1">
                    {viewArticle.attachments.map((a, i) => (
                      <li key={i}>
                        <a href={a.url} download={a.name} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--ax-accent)] hover:bg-[var(--ax-accent-bg)]">
                          <span className="material-symbols-outlined text-[18px]">download</span>
                          <span className="flex-1 truncate">{a.name}</span>
                          <span className="text-xs text-[var(--ax-text-hint)]">{formatBytes(a.size)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {!locked && isRealId(viewArticle._id) && (
            <div className="mt-5 flex justify-end gap-2 border-t border-[var(--ax-border-soft)] pt-4">
              <button onClick={() => { const a = viewArticle; setViewArticle(null); setEditorErr(""); setEditor({ mode: "edit", type: a.type === "library" ? "library" : "news", _id: a._id, title: a.title, content: a.content ?? "", imageUrl: a.imageUrl ?? "", attachments: a.attachments ?? [] }); }}
                className="rounded-lg border border-[var(--ax-border)] px-4 py-2 text-sm font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">수정</button>
              <button onClick={() => deleteArticle(viewArticle)} className="rounded-lg border border-[var(--ax-danger)]/30 bg-[var(--ax-danger-bg)] px-4 py-2 text-sm font-semibold text-[var(--ax-danger)] hover:opacity-90">삭제</button>
            </div>
          )}
        </Modal>
      )}

      {/* ── 모달: 등록/수정 (확대) ── */}
      {editor && (
        <Modal size="3xl" title={`${editor.type === "library" ? "안전 자료" : "안전 공지"} ${editor.mode === "create" ? "등록" : "수정"}`} onClose={() => setEditor(null)}>
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["news", "library"] as const).map((t) => (
                <button key={t} onClick={() => setEditor((ed) => (ed ? { ...ed, type: t } : ed))}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${editor.type === t ? "bg-[var(--ax-accent)] text-white" : "border border-[var(--ax-border)] text-[var(--ax-text-muted)]"}`}>
                  {t === "news" ? "안전 공지" : "안전 자료"}
                </button>
              ))}
            </div>
            <input value={editor.title} onChange={(e) => setEditor((ed) => (ed ? { ...ed, title: e.target.value } : ed))} placeholder="제목"
              className="w-full rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)]" />
            <textarea value={editor.content} onChange={(e) => setEditor((ed) => (ed ? { ...ed, content: e.target.value } : ed))} rows={7} placeholder="내용"
              className="w-full resize-y rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)]" />

            {editor.type === "news" ? (
              <div>
                <div className="mb-1 text-xs font-semibold text-[var(--ax-text-muted)]">대표 이미지 <span className="text-[var(--ax-text-hint)]">(보기 화면 좌측에 표시)</span></div>
                <input ref={editorImageRef} type="file" accept="image/*" className="hidden" onChange={onPickEditorImage} />
                {editor.imageUrl ? (
                  <div className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={editor.imageUrl} alt="대표 이미지" className="max-h-40 rounded-lg border border-[var(--ax-border)]" />
                    <button onClick={() => setEditor((ed) => (ed ? { ...ed, imageUrl: "" } : ed))} className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ax-danger)] text-white shadow"><span className="material-symbols-outlined text-[16px]">close</span></button>
                  </div>
                ) : (
                  <button onClick={() => editorImageRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--ax-border)] px-3 py-2 text-sm font-semibold text-[var(--ax-text-muted)] hover:border-[var(--ax-accent-border)] hover:text-[var(--ax-accent)]">
                    <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>이미지 첨부
                  </button>
                )}
              </div>
            ) : (
              <div>
                <div className="mb-1 text-xs font-semibold text-[var(--ax-text-muted)]">첨부파일</div>
                <input ref={editorFileRef} type="file" multiple className="hidden" onChange={onPickEditorFiles} />
                {editor.attachments.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {editor.attachments.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-lg border border-[var(--ax-border)] px-2 py-1.5 text-sm">
                        <span className="material-symbols-outlined text-[16px] text-[var(--ax-accent)]">attach_file</span>
                        <span className="flex-1 truncate">{a.name}</span>
                        <span className="text-xs text-[var(--ax-text-hint)]">{formatBytes(a.size)}</span>
                        <button onClick={() => setEditor((ed) => (ed ? { ...ed, attachments: ed.attachments.filter((_, j) => j !== i) } : ed))} className="text-[var(--ax-danger)]"><span className="material-symbols-outlined text-[16px]">close</span></button>
                      </li>
                    ))}
                  </ul>
                )}
                <button onClick={() => editorFileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--ax-border)] px-3 py-2 text-sm font-semibold text-[var(--ax-text-muted)] hover:border-[var(--ax-accent-border)] hover:text-[var(--ax-accent)]">
                  <span className="material-symbols-outlined text-[18px]">upload_file</span>파일 추가
                </button>
              </div>
            )}

            {uploading && <p className="flex items-center gap-1.5 text-xs text-[var(--ax-text-muted)]"><LlmSpinner className="h-3.5 w-3.5" accentClass="border-t-[var(--ax-accent)]" />업로드 중…</p>}
            {editorErr && <p className="text-sm text-[var(--ax-danger)]">{editorErr}</p>}
            <div className="flex justify-end gap-2 border-t border-[var(--ax-border-soft)] pt-3">
              <button onClick={() => setEditor(null)} className="rounded-lg border border-[var(--ax-border)] px-4 py-2 text-sm font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">취소</button>
              <button onClick={saveEditor} disabled={editorBusy || uploading} className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">{editorBusy ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, size = "lg" }: { title: string; onClose: () => void; children: ReactNode; size?: "md" | "lg" | "3xl" | "5xl" }) {
  const w = size === "5xl" ? "max-w-5xl" : size === "3xl" ? "max-w-3xl" : size === "md" ? "max-w-md" : "max-w-lg";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${w} overflow-y-auto rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--ax-border)] bg-[var(--ax-card)] px-5 py-3">
          <div className="text-sm font-bold text-[var(--ax-text)]">{title}</div>
          <button onClick={onClose} className="text-[var(--ax-text-hint)] hover:text-[var(--ax-text)]"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SideCard({ icon, title, onAdd, children }: { icon: string; title: string; onAdd?: () => void; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-sm">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between border-b border-[var(--ax-border-soft)] pb-2">
        <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--ax-text)]">
          <span className="material-symbols-outlined text-[20px] text-[var(--ax-accent)]">{icon}</span>{title}
        </div>
        {onAdd && (
          <button onClick={onAdd} className="flex items-center gap-1 rounded-lg border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] px-2 py-1 text-xs font-bold text-[var(--ax-accent)] hover:bg-[var(--ax-accent-soft)]">
            <span className="material-symbols-outlined text-[14px]">add</span>등록
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">{children}</div>
    </div>
  );
}

function ArticleRow({ article, sub, badge, icon, thumb, onOpen }: { article: Article; sub?: string; badge?: string; icon?: string; thumb?: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="block w-full rounded-[var(--ax-radius-sm)] text-left transition hover:bg-[var(--ax-accent-bg)]">
      <div className="flex items-start gap-2.5 px-2 py-2">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="mt-0.5 h-9 w-9 flex-none rounded object-cover" />
        ) : icon ? (
          <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--ax-accent)]">{icon}</span>
        ) : null}
        <div className="min-w-0 flex-1">
          {badge && <span className="mb-1 inline-block rounded bg-[var(--ax-accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span>}
          <div className="truncate text-sm font-semibold text-[var(--ax-text)]">{article.title}</div>
          {sub && <div className="truncate text-xs text-[var(--ax-text-hint)]">{sub}</div>}
        </div>
      </div>
    </button>
  );
}

function AnalysisCard({ analysis, msgId, checked, onToggle, elapsedMs }: {
  analysis: SafetyImageAnalysis; msgId: string; checked: Record<string, boolean>; onToggle: (key: string) => void; elapsedMs?: number;
}) {
  const r = riskMeta(analysis.riskLevel);
  const violations = clean(analysis.violations);
  const regulations = clean(analysis.regulations);
  const actions = clean(analysis.actions);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--ax-text)]">
          <span className="material-symbols-outlined text-[20px] text-[var(--ax-danger)]">crisis_alert</span>AI 현장 진단 결과
        </div>
        <span className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${r.cls}`}>{r.emoji} 위험도 {r.label}</span>
      </div>

      {analysis.summary ? (
        <div className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white p-3 text-sm text-[var(--ax-text)]">
          <LlmMarkdown compact className="text-sm">{analysis.summary}</LlmMarkdown>
        </div>
      ) : null}

      {violations.length > 0 ? (
        <div className="rounded-[var(--ax-radius)] border border-[var(--ax-danger)]/20 bg-[var(--ax-danger-bg)] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-[var(--ax-danger)]"><span className="material-symbols-outlined text-[18px]">search</span>위반사항 {violations.length}건</div>
          <ul className="space-y-1.5">
            {violations.map((v, i) => (
              <li key={i} className="flex gap-2 text-sm text-[var(--ax-text)]">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--ax-danger)] text-[11px] font-bold text-white">{i + 1}</span>
                <span><InlineMd>{v}</InlineMd></span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-[var(--ax-radius)] border border-[var(--ax-success)]/20 bg-[var(--ax-success-bg)] p-3 text-sm font-semibold text-[var(--ax-success)]">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>발견된 위반사항 없음
        </div>
      )}

      {regulations.length > 0 && (
        <div className="rounded-[var(--ax-radius)] border border-[var(--ax-warning)]/20 bg-[var(--ax-warning-bg)] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-[var(--ax-warning)]"><span className="material-symbols-outlined text-[18px]">gavel</span>근거 규정</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--ax-text)]">{regulations.map((v, i) => <li key={i}><InlineMd>{v}</InlineMd></li>)}</ul>
        </div>
      )}

      {actions.length > 0 && (
        <div className="rounded-[var(--ax-radius)] border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--ax-accent)]"><span className="material-symbols-outlined text-[18px]">checklist</span>즉시 조치 체크리스트</div>
          <ul className="space-y-1.5">
            {actions.map((a, i) => {
              const key = `${msgId}:${i}`;
              const done = !!checked[key];
              return (
                <li key={i}>
                  <button type="button" onClick={() => onToggle(key)} className="flex w-full items-start gap-2 text-left text-sm">
                    <span className={`mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded border ${done ? "border-[var(--ax-success)] bg-[var(--ax-success)] text-white" : "border-[var(--ax-text-hint)] bg-white"}`}>
                      {done && <span className="material-symbols-outlined text-[12px]">check</span>}
                    </span>
                    <span className={done ? "text-[var(--ax-text-hint)] line-through" : "text-[var(--ax-text)]"}><InlineMd>{a}</InlineMd></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {elapsedMs != null && <p className="text-[10px] text-[var(--ax-text-hint)]">분석 {formatLlmMs(elapsedMs)}</p>}

      <FeedbackBar
        payload={{
          panel: "safety",
          question: "현장 사진 위험요소 진단",
          answer: [analysis.summary, ...violations, ...regulations].filter(Boolean).join("\n").slice(0, 8000),
        }}
        resetKey={msgId}
      />
    </div>
  );
}
