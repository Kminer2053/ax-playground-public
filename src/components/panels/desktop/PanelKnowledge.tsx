"use client";

import { useState, useEffect, Fragment } from "react";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { runOnEnterKeySubmit } from "@/lib/imeEnter";
import { formatLlmMs } from "@/components/llm/formatLlmDuration";
import { LlmMarkdown } from "@/components/llm/LlmMarkdown";
import { LlmSpinner } from "@/components/llm/LlmSpinner";
import { KnowledgeGraphPanel } from "./KnowledgeGraphPanel";

const CATEGORIES = ["규정", "세칙", "지침", "편람", "매뉴얼", "계약서"];
/** 분류별 색(배지 구분). */
const CAT_COLOR: Record<string, { bg: string; fg: string; bd: string }> = {
  규정: { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
  세칙: { bg: "#eef2ff", fg: "#4338ca", bd: "#c7d2fe" },
  지침: { bg: "#f0fdfa", fg: "#0f766e", bd: "#99f6e4" },
  편람: { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
  매뉴얼: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
  계약서: { bg: "#fff1f2", fg: "#be123c", bd: "#fecdd1" },
};
const catStyle = (c?: string) => CAT_COLOR[c ?? ""] ?? { bg: "var(--ax-border-soft)", fg: "var(--ax-text-muted)", bd: "var(--ax-border)" };
const catRank = (c?: string) => { const i = CATEGORIES.indexOf(c ?? ""); return i < 0 ? 99 : i; };
/** 연번(제N호)에서 숫자 추출. 없으면 맨 뒤로. */
const numOf = (n?: string) => { const m = (n ?? "").match(/(\d+)/); return m ? parseInt(m[1], 10) : 9999; };

function CatBadge({ c }: { c?: string }) {
  if (!c) return null;
  const s = catStyle(c);
  return <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: s.bg, color: s.fg, border: `1px solid ${s.bd}` }}>{c}</span>;
}

/**
 * 조문 본문 표출 서식 — 원문(데이터)은 그대로 두고 렌더에서만 정리.
 * ① 항(①②③/제N항)·호(1.)·목(가.)으로 블록 분리 → 위계 들여쓰기
 * ② 블록 내 PDF 시각줄바꿈은 한 문단으로 합침(가독성), 표(layout)는 원형 보존(pre)
 */
const TABLE_LINE = /\|.*\|/;
function isTableLine(l: string) { return TABLE_LINE.test(l) || (l.match(/\S {3,}\S/g)?.length ?? 0) >= 1; }
/** 부칙〈…〉/[별표]/[별지] 머리줄 — 별도 소제목 블록으로 분리(부칙 청크 가독성). */
const HEAD_RE = /^(?:부\s*칙(?=\s|$|[<([（〈《＜])|\[별표[^\]]*\]|\[별지[^\]]*\])/;
/** 제N조(…) 머리줄 — JO 청킹은 조 제목을 청크명에 두므로 본문 속 제N조는 대개 인용.
 *  한 청크에 3개+ 나오면 조 구조(예: 별지의 계약서 양식)로 보고 굵게, 1~2개는 법령 인용이라 산문 처리. */
const JO_HEAD_RE = /^제\s*\d+\s*조(?:의\s*\d+)?\s*[(（]/;
/** 장(章) 헤더 청크(빈 body=구분자) 식별 — 목록에서 조들의 상위 그룹 라벨로 렌더. */
const isChapterName = (s?: string) => /^제\s*\d+\s*장/.test(String(s || "").trim());
/** 꼬리 섹션(부칙·별표·별지) 그룹 라벨 — 이들은 내용 청크라 표시에서만 그룹핑(첫 항목 앞에 라벨). 조면 null. */
const tailGroupLabel = (s?: string) => {
  const t = String(s || "").trim();
  if (/^부칙/.test(t)) return "부칙";
  if (/^(별표|별지|서식|양식)/.test(t)) return "별표·별지";
  return null;
};
/** 섹션 구분자(빈 body 그룹 헤더) — 장 또는 계약서 부속서류. 목록에서 상위 그룹 라벨로 렌더. */
const isSectionDivider = (s?: string) => { const t = String(s || "").trim(); return isChapterName(s) || ["부속서류", "붙임", "별지 서식"].includes(t) || /^첨부자료(?:\s|$)/.test(t) || /^별표\s*제\d+호\s*부속/.test(t); };
/** 구분자 판정(article 기반) — 이름 구분자(제N장·부속서류) 또는 빈 body의 장 헤더("N." 십진장·로마자장).
 *  매뉴얼 NUM/로마박스 청킹의 상위 장(빈 body)을 목록 그룹 라벨로 렌더(비연고지·성희롱 등). */
const isDivider = (a?: { name?: string; fullText?: string }) =>
  isSectionDivider(a?.name) || (!String(a?.fullText || "").trim() && /^(?:\d+\.(?!\d)|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ][.\s])/.test(String(a?.name || "").trim().replace(/^\[[^\]]*\]\s*/, "")));
/** 산문 라인 위계(글머리 기호 기준 줄바꿈·들여쓰기): 항①②/제N항=0, 1.·□=1, 가./영문·○⚬◦·※=2,
 *  대시·소불릿=3, 그 외 -1(직전 줄에 이어붙임 — PDF 시각 줄바꿈 복원). */
function proseLevel(l: string): number {
  const t = l.trim();
  if (/^[①-⑳]/.test(t) || /^제\s*\d+\s*항/.test(t)) return 0;
  if (/^\d+\)\s/.test(t)) return 2;                                     // 1)·2) 목록(괄호닫음만) — N.N.N 절 아래로 들여쓰기((N)보다 얕게)
  const dec = t.match(/^(\d+(?:\.\d+)*)[.)]?\s/);                        // 1.·1.2·1.2.1 등 다단계 십진
  if (dec) return Math.max(1, Math.min(3, dec[1].split(".").length - 1)); // 1.→1, 1.2→1, 1.2.1→2, 1.2.1.1→3
  if (/^[□■▣]/.test(t)) return 1;                                       // □ 사각 글머리(소제목)
  if (/^[○◯⚬◦●⭘]/.test(t)) return 2;                                   // ○ 원형 글머리(항목)
  if (/^\([0-9가-힣a-zA-Z]+\)\s/.test(t)) return 3;                      // (1)·(가)·(a) 괄호번호(하위)
  if (/^[가-힣][.)]\s/.test(t) || /^[a-zA-Z][.)]\s/.test(t)) return 2;  // 가. / a.
  if (/^[※*＊]\s/.test(t)) return 2;                                    // 참고
  if (/^[-–‣•·▪]\s/.test(t)) return 3;                                  // 대시·소불릿(하위)
  return -1;
}
function parseArticleBlocks(raw: string): { level: number; head: boolean; table: boolean; quote: boolean; text: string }[] {
  const lines = String(raw || "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  // 종류 분류 후 단독 표라인은 산문으로 강등(연속 2줄+만 표로 인정)
  const joHead = lines.filter((l) => JO_HEAD_RE.test(l.trim())).length >= 3; // 조 3개+면 구조 헤딩, 1~2개는 인용
  const kind: string[] = lines.map((l) => {
    const t = l.trim();
    return HEAD_RE.test(t) || (joHead && JO_HEAD_RE.test(t)) ? "head" : isTableLine(l) ? "table" : "prose";
  });
  for (let i = 0; i < kind.length; i++) if (kind[i] === "table" && kind[i - 1] !== "table" && kind[i + 1] !== "table") kind[i] = "prose";
  // ≪…≫·《…》 규정 인용 블록(원문 회색 박스) → quote: 헤더 + 다음 구조마커(표·□⚬○[※·N.N·또다른 인용) 전까지. 본문 위계와 시각 분리.
  for (let i = 0; i < lines.length; i++) {
    if (kind[i] !== "head" && /^[≪《]/.test(lines[i].trim())) {
      kind[i] = "quote";
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (kind[j] === "head" || kind[j] === "table" || /^[≪《]/.test(t) || /^[□■▣⚬○◯◦●※[]/.test(t) || /^\d+\.\d/.test(t)) break;
        kind[j] = "quote";
      }
    }
  }
  const groups: { kind: string; level: number; lines: string[] }[] = [];
  let cur: { kind: string; level: number; lines: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], k = kind[i];
    if (k === "head") { groups.push({ kind: "head", level: 0, lines: [l] }); cur = null; continue; }
    if (k === "quote") { if (cur && cur.kind === "quote") cur.lines.push(l); else { cur = { kind: "quote", level: 0, lines: [l] }; groups.push(cur); } continue; }
    if (k === "table") { if (cur && cur.kind === "table") cur.lines.push(l); else { cur = { kind: "table", level: 0, lines: [l] }; groups.push(cur); } continue; }
    const level = proseLevel(l);
    if (level >= 0 || !cur || cur.kind !== "prose") { cur = { kind: "prose", level: level < 0 ? 0 : level, lines: [l] }; groups.push(cur); }
    else cur.lines.push(l);
  }
  const joinQuote = (ql: string[]) => { // 번호/마커 줄은 유지, 이어지는 줄(PDF 줄바꿈)은 직전에 합침
    const items: string[] = [];
    for (const l of ql) { const t = l.trim(); if (items.length && !/^[≪《]/.test(t) && proseLevel(l) < 0) items[items.length - 1] += " " + t; else items.push(t); }
    return items.join("\n");
  };
  return groups.map((g) => ({
    level: g.level, head: g.kind === "head", table: g.kind === "table", quote: g.kind === "quote",
    text: g.kind === "table" ? g.lines.join("\n") : g.kind === "quote" ? joinQuote(g.lines) : g.lines.join(" ").replace(/\s{2,}/g, " ").trim(),
  }));
}
/** 표 복구: ① 마크다운 파이프 표(| a | b |, <br>·구분행 처리) ② layout 공백표(2칸+ 공백) → HTML 표. 빈약하면 pre 보존. */
function TableGrid({ rows }: { rows: string[][] }) {
  const maxCols = Math.max(1, ...rows.map((r) => r.length));
  return (
    <div className="overflow-x-auto rounded border border-[var(--ax-border)]">
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={ri === 0 ? "bg-[var(--ax-border-soft)] font-semibold" : ""}>
              {Array.from({ length: maxCols }).map((_, ci) => (
                <td key={ci} className="whitespace-pre-line border border-[var(--ax-border)] px-2.5 py-1.5 align-top leading-relaxed text-[var(--ax-text)]">{(r[ci] ?? "").replace(/<br\s*\/?>/gi, "\n")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ArticleTable({ raw }: { raw: string }) {
  const all = raw.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  // ① 마크다운 파이프 표
  const pipeLines = all.filter((l) => l.includes("|"));
  if (pipeLines.length >= 2 && pipeLines.length >= all.length * 0.6) {
    const isSep = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")) || c === "");
    const rows = pipeLines.map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim())).filter((cells) => !isSep(cells));
    if (rows.length >= 1) return <TableGrid rows={rows} />;
  }
  // ② layout 공백표
  const rows = all.map((l) => l.trim().split(/ {2,}/).map((c) => c.trim()));
  const maxCols = Math.max(1, ...rows.map((r) => r.length));
  const multi = rows.filter((r) => r.length >= 2).length;
  // 행 다수가 다열(격자)일 때만 표로 복구. 느슨한(머리행+불릿) 건 layout 원형 보존.
  if (maxCols < 2 || multi < Math.max(2, Math.ceil(rows.length * 0.6))) {
    return <pre className="overflow-x-auto whitespace-pre rounded border border-[var(--ax-border)] bg-[var(--ax-card)] p-3 font-mono text-[13px] leading-relaxed text-[var(--ax-text-muted)]">{raw}</pre>;
  }
  return <TableGrid rows={rows} />;
}
/** 예시·확인서·점검표(표상자) 청크 — 본문 전체를 "예시" 박스로 감싸 실제 업무기준과 시각 구분(표는 박스 내부에서 정상 렌더). */
const isExampleName = (name?: string) => /예시|양식|확인서|점검표/.test(name || "");
function ArticleBody({ text, name }: { text?: string; name?: string }) {
  const blocks = parseArticleBlocks(text ?? "");
  if (!blocks.length) return <div className="text-sm italic text-[var(--ax-text-hint)]">본문 없음</div>;
  const inner = (
    <div className="space-y-2">
      {blocks.map((b, i) => (b.head ? (
        /^(?:부\s*칙|\[별[표지])/.test(b.text)
          ? <p key={i} className="mt-2.5 border-l-[3px] border-[var(--ax-accent)] pl-2 text-[13px] font-bold text-[var(--ax-accent)]">{b.text}</p>
          : <p key={i} className="mt-1.5 text-[14px] font-bold text-[var(--ax-text)]">{b.text}</p>
      ) : b.quote ? (
        <div key={i} className="my-1.5 whitespace-pre-line rounded border border-[var(--ax-border)] bg-[var(--ax-border-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--ax-text-muted)]">{b.text}</div>
      ) : b.table ? (
        <ArticleTable key={i} raw={b.text} />
      ) : (
        <p key={i} className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[var(--ax-text)]" style={{ paddingLeft: b.level * 16 }}>{b.text}</p>
      )))}
    </div>
  );
  if (!isExampleName(name)) return inner;
  return (
    <div className="rounded-md border border-dashed border-[var(--ax-border)] bg-[var(--ax-accent-bg)] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-[var(--ax-accent)]">
        <span className="material-symbols-outlined text-[14px]">description</span>예시 · 양식
      </div>
      {inner}
    </div>
  );
}

type SagyuDoc = { n: string; s: string; a: string[]; af?: { name: string; text: string }[]; w: string; c?: string; no?: string };
type Highlight = { id: string; title: string; category: string; year: string; docNumber: string };

interface InternalRegulationHit {
  key: string; // 정제 제목(조회 로깅·정렬용)
  title: string;
  revisionInfo: string;
  category?: string;
  docNumber?: string; // 연번(제N호) — 좌측 표시·정렬용
  articles: { name: string; fullText?: string }[];
  score?: number | null;
}
/** 좌측 결과 정렬: 위계(분류) → 연번(제N호) → 제목. */
const sortHits = (a: InternalRegulationHit, b: InternalRegulationHit) =>
  catRank(a.category) - catRank(b.category) || numOf(a.docNumber) - numOf(b.docNumber) || a.title.localeCompare(b.title, "ko");

/** 사규 열람 시 조회수 누적(자주 찾는 사규). fire-and-forget. */
function logView(title?: string) {
  if (!title) return;
  fetch("/api/knowledge/regulations/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }), credentials: "include" }).catch(() => {});
}

export function PanelKnowledge({ embedded = false }: { embedded?: boolean } = {}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [openAll, setOpenAll] = useState<number | null>(null); // 글박스 클릭 → 전체 조문
  const [openArt, setOpenArt] = useState<Set<string>>(new Set()); // "i:j" 개별 조문
  const [internalRegulations, setInternalRegulations] = useState<InternalRegulationHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [regCount, setRegCount] = useState<number | null>(null);
  const [extCount, setExtCount] = useState<number | null>(null); // 법령·행정규칙 등 외부 규범 건수
  const [sagyuDb, setSagyuDb] = useState<SagyuDoc[] | null>(null);
  const [popularRegs, setPopularRegs] = useState<Highlight[]>([]);
  const [recentRegs, setRecentRegs] = useState<Highlight[]>([]);

  const [aiQuery, setAiQuery] = useState("");
  const [aiMode, setAiMode] = useState<"fast" | "deep">("fast"); // 빠른검색/심층검색
  const [aiIntent, setAiIntent] = useState("");                  // 심층검색이 파악한 질문 의도
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [relatedTasks, setRelatedTasks] = useState<{ id: string; label: string; dept: string; org: string; fn: string; status: string }[]>([]);
  const [aiRefs, setAiRefs] = useState<{ title?: string; revisionInfo?: string; id?: string; viaGraph?: boolean; vecHit?: boolean; relatedFrom?: string }[]>([]);
  const [aiCitations, setAiCitations] = useState<{ id: string; title?: string; year?: string; articles?: string[] }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiElapsedMs, setAiElapsedMs] = useState<number | null>(null);
  const [showGraph, setShowGraph] = useState(false); // 좌측: 결과목록 ↔ 지식그래프 토글
  const [fb, setFb] = useState<"idle" | "sent">("idle");   // 답변 만족도 피드백 상태
  const [fbDownOpen, setFbDownOpen] = useState(false);      // 👎 사유 입력 모달
  const [fbReason, setFbReason] = useState("");
  const [fbImage, setFbImage] = useState<File | null>(null);
  const [fbBusy, setFbBusy] = useState(false);
  const [citationOpen, setCitationOpen] = useState<{ title?: string; year?: string; articles: { name: string; fullText?: string }[]; relevant?: string[] } | null>(null);
  const [citationLoading, setCitationLoading] = useState(false);

  useEffect(() => {
    fetch("/sagyu.json")
      .then((r) => r.json())
      .then((d: SagyuDoc[]) => { if (Array.isArray(d)) { setSagyuDb(d); setRegCount(d.length); } })
      .catch(() => {});
    fetch("/api/knowledge/regulations/count", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.count === "number" && d.count > 0) setRegCount(d.count);
        if (typeof d?.external === "number" && d.external > 0) setExtCount(d.external);
      })
      .catch(() => {});
    fetch("/api/knowledge/regulations/highlights", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d?.ok) { if (Array.isArray(d.popular)) setPopularRegs(d.popular); if (Array.isArray(d.recent)) setRecentRegs(d.recent); } })
      .catch(() => {});
  }, []);

  // 업무탐색(온톨로지 패널) → "지식검색에 질문" 프리필 수신
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      if (typeof q === "string" && q) setAiQuery(q);
    };
    window.addEventListener("axp-knowledge-ask", onAsk);
    return () => window.removeEventListener("axp-knowledge-ask", onAsk);
  }, []);

  const resetExpand = () => { setOpenAll(null); setOpenArt(new Set()); };
  /** 좌측 검색을 최상위(추천 화면)로 초기화. */
  const resetSearch = () => { setSearchQuery(""); setActiveCat(null); setSearchDone(false); setInternalRegulations([]); resetExpand(); };

  // 사규 실시간 검색 (sagyu.json, includes — 조항 본문 포함) + 위계 정렬
  const filterSagyu = (q: string, db: SagyuDoc[]) => {
    if (!q.trim() || !db.length) { setInternalRegulations([]); return; }
    const query = q.trim().toLowerCase();
    const results: InternalRegulationHit[] = [];
    const revMatch = (s: string) => s.match(/\(([^)]+)\)$/)?.at(1) ?? "";
    db.forEach((doc) => {
      const blob = (doc.n + " " + doc.s + " " + doc.w + " " + doc.a.join(" ") + " " + (doc.af?.map((a) => a.text).join(" ") ?? "")).toLowerCase();
      if (!blob.includes(query)) return;
      const matched = (doc.af ?? []).filter((a) => (a.name + " " + a.text).toLowerCase().includes(query));
      const articles = matched.length > 0
        ? matched.map((a) => ({ name: a.name, fullText: a.text || undefined }))
        : (doc.af ?? []).map((a) => ({ name: a.name, fullText: a.text || undefined }));
      results.push({ key: doc.s, title: doc.n, revisionInfo: revMatch(doc.n), category: doc.c, docNumber: doc.no, articles });
    });
    results.sort(sortHits);
    setInternalRegulations(results);
  };

  // 분류(카테고리) 필터 — 칩 클릭 시 해당 종류 문서 전체 표시
  const docToHit = (doc: SagyuDoc): InternalRegulationHit => ({
    key: doc.s,
    title: doc.n,
    revisionInfo: doc.n.match(/\(([^)]+)\)$/)?.[1] ?? "",
    category: doc.c,
    docNumber: doc.no,
    articles: (doc.af ?? []).map((a) => ({ name: a.name, fullText: a.text || undefined })),
  });
  const filterByCategory = (cat: string) => {
    if (!sagyuDb) return;
    resetExpand();
    if (activeCat === cat) { setActiveCat(null); setSearchDone(false); setInternalRegulations([]); return; }
    setSearchQuery("");
    setActiveCat(cat);
    setSearchDone(true);
    setInternalRegulations(sagyuDb.filter((d) => d.c === cat).map(docToHit).sort(sortHits));
  };

  const onSearchInputChange = (val: string) => {
    setSearchQuery(val);
    setActiveCat(null);
    resetExpand();
    if (sagyuDb) filterSagyu(val, sagyuDb);
    if (val.trim()) setSearchDone(true);
    else { setSearchDone(false); setInternalRegulations([]); }
  };

  const doSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? searchQuery).trim();
    if (!q) return;
    if (overrideQuery) setSearchQuery(overrideQuery);
    setActiveCat(null);
    setSearchLoading(true);
    setSearchDone(true);
    resetExpand();
    let db = sagyuDb;
    if (!db) {
      try {
        const res = await fetch("/sagyu.json");
        const d = await res.json();
        if (Array.isArray(d)) { setSagyuDb(d); setRegCount(d.length); db = d; }
      } catch { db = []; }
    }
    if (db) filterSagyu(q, db);
    setSearchLoading(false);
  };

  /** 추천(자주찾는/최근개정) 클릭 → 키워드검색이 아니라 해당 규정 1건 전체 조문 표시. */
  const openRegulation = (title: string) => {
    const db = sagyuDb;
    const docs = db ? db.filter((d) => d.s === title) : [];
    if (!docs.length) { void doSearch(title); return; } // 정확매칭 실패 시 폴백
    setSearchQuery("");
    setActiveCat(null);
    setSearchDone(true);
    resetExpand();
    const hits = docs.map(docToHit);
    setInternalRegulations(hits);
    setOpenAll(hits.length === 1 ? 0 : null); // 단일 규정이면 전체 조문 자동 펼침
    logView(title);
  };

  // 결과 카드 상호작용
  const toggleAll = (i: number, reg: InternalRegulationHit) => {
    setOpenAll((cur) => (cur === i ? null : i));
    if (openAll !== i) logView(reg.key);
  };
  const toggleArt = (i: number, j: number, reg: InternalRegulationHit) => {
    const k = `${i}:${j}`;
    setOpenArt((prev) => { const s = new Set(prev); if (s.has(k)) s.delete(k); else { s.add(k); logView(reg.key); } return s; });
  };

  const sendFeedback = async (rating: "up" | "down", reason = "", image: File | null = null) => {
    if (fbBusy) return;
    setFbBusy(true);
    try {
      const fd = new FormData();
      fd.set("rating", rating);
      fd.set("question", aiQuery);
      fd.set("answer", aiResponse ?? "");
      fd.set("mode", aiMode);
      fd.set("intent", aiIntent);
      const cites = (aiCitations.length ? aiCitations.map((c) => c.title) : aiRefs.map((r) => r.title)).filter(Boolean);
      fd.set("citations", JSON.stringify(cites));
      fd.set("usedVector", aiRefs.some((r) => r.vecHit) ? "1" : "0"); // 검색품질 분석용 채널 기록
      fd.set("usedGraph", aiRefs.some((r) => r.viaGraph) ? "1" : "0");
      if (reason) fd.set("reason", reason);
      if (image) fd.set("image", image);
      await fetch("/api/knowledge/feedback", { method: "POST", body: fd });
      setFb("sent"); setFbDownOpen(false); setFbReason(""); setFbImage(null);
    } catch { /* 피드백 전송 실패는 조용히 무시(UX 방해 방지) */ }
    finally { setFbBusy(false); }
  };

  const askAiAssistant = async () => {
    const q = aiQuery.trim();
    if (!q) return;
    setAiLoading(true);
    setAiResponse(null);
    setAiRefs([]);
    setAiCitations([]);
    setAiIntent("");
    setAiElapsedMs(null);
    setFb("idle"); setFbDownOpen(false); setFbReason(""); setFbImage(null);
    // 관련 업무 카드(온톨로지) — 답변과 병렬, 결정적 매칭(LLM 무관)
    setRelatedTasks([]);
    fetch(`/api/work100/related?q=${encodeURIComponent(q)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((d) => { if (Array.isArray(d?.tasks)) setRelatedTasks(d.tasks); })
      .catch(() => {});
    const t0 = performance.now();
    try {
      const res = await fetch("/api/knowledge/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, stream: true, mode: aiMode }),
        credentials: "include",
      });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder("utf-8");
        let buf = "";
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          buf += dec.decode(done ? new Uint8Array() : (value ?? new Uint8Array()), { stream: !done });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const block of parts) {
            const line = block.startsWith("data: ") ? block.slice(6) : block;
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as {
                type?: string; text?: string; message?: string; intent?: string;
                references?: { title?: string; revisionInfo?: string; id?: string; category?: string; viaGraph?: boolean; vecHit?: boolean; relatedFrom?: string }[];
                citations?: { id?: string; title?: string; year?: string; articles?: string[] }[];
              };
              if (msg.type === "meta") {
                if (typeof msg.intent === "string") setAiIntent(msg.intent);
                if (Array.isArray(msg.references)) setAiRefs(msg.references);
                if (Array.isArray(msg.citations)) {
                  setAiCitations(msg.citations.filter((c): c is { id: string; title?: string; year?: string; articles?: string[] } => typeof c.id === "string" && c.id.length > 0));
                }
              } else if (msg.type === "delta" && typeof msg.text === "string") {
                acc += msg.text;
                setAiResponse(acc);
              } else if (msg.type === "error") {
                setAiResponse(msg.message ?? "답변 생성 중 오류가 발생했습니다.");
              }
            } catch { /* ignore malformed chunk */ }
          }
          if (done) break;
        }
        setAiElapsedMs(Math.round(performance.now() - t0));
        if (!acc.trim()) setAiResponse("답변 내용이 비어 있습니다."); else setShowGraph(true); // 답변 완료 → 좌측 지식그래프 자동 표시
      } else {
        const data = await res.json();
        setAiElapsedMs(Math.round(performance.now() - t0));
        if (res.ok && data.answer) {
          setAiResponse(data.answer);
          setShowGraph(true); // 답변 완료 → 좌측 지식그래프 자동 표시
          if (Array.isArray(data.references)) setAiRefs(data.references);
          if (Array.isArray(data.citations)) setAiCitations(data.citations.filter((c: { id?: string }) => typeof c.id === "string" && c.id));
        } else setAiResponse(data?.error ?? "답변을 불러오지 못했습니다.");
      }
    } catch {
      setAiResponse("연결에 실패했습니다.");
      setAiElapsedMs(Math.round(performance.now() - t0));
    } finally {
      setAiLoading(false);
    }
  };

  const openCitation = async (c: { id: string; title?: string; year?: string; articles?: string[] }) => {
    setCitationLoading(true);
    setCitationOpen({ title: c.title, year: c.year, articles: [], relevant: c.articles ?? [] });
    logView(c.title);
    try {
      const res = await fetch(`/api/knowledge/regulations/${c.id}`, { credentials: "include" });
      const d = await res.json();
      if (d.ok) setCitationOpen({ title: d.title, year: d.year, articles: d.articles || [], relevant: c.articles ?? [] });
    } catch { /* 실패 시 제목만 유지 */ }
    finally { setCitationLoading(false); }
  };

  const count = regCount ?? 104;

  return (
    <div className={`flex ${embedded ? "h-full" : "h-dvh"} flex-col overflow-hidden bg-[var(--ax-page)] text-[var(--ax-text)]`}>
      <div className="mx-auto flex min-h-0 w-full max-w-[1672px] flex-1 flex-col px-6 py-6">
        {!embedded && <PanelHeader icon="manage_search" title="AI 지식검색" />}
        {/* Hero 검색 */}
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">사규·내부지식 검색</h1>
          <p className="text-sm text-[var(--ax-text-muted)]">규정·세칙·지침·편람·매뉴얼 등 내부 사규 {count}건{extCount ? `과 법령·행정규칙 ${extCount}건` : ""}에서 키워드로 검색하고, AI 어시스턴트에게 자연어로 물어보세요.</p>
        </div>
        <div className="mt-4 flex flex-col items-stretch gap-3 md:flex-row">
          <div className={`flex h-16 flex-1 items-center gap-3 rounded-2xl border bg-[var(--ax-card)] px-5 shadow-sm transition-all ${searchFocused ? "border-[var(--ax-accent)] ring-2 ring-[var(--ax-accent-soft)]" : "border-[var(--ax-border)]"}`}>
            <span className="material-symbols-outlined text-[var(--ax-text-hint)]">search</span>
            <input
              value={searchQuery}
              onChange={(e) => onSearchInputChange(e.target.value)}
              onFocus={() => { setSearchFocused(true); setShowGraph(false); }}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(e) => runOnEnterKeySubmit(e, () => doSearch())}
              className="flex-1 border-none bg-transparent text-base outline-none placeholder:text-[var(--ax-text-hint)] focus:ring-0"
              placeholder="검색어를 입력하세요 (예: 임대차, 징계, 연차휴가, 개인정보)"
            />
          </div>
          <button type="button" onClick={() => doSearch()} disabled={searchLoading} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-[var(--ax-accent)] px-8 font-bold text-white shadow-sm transition-all hover:bg-[var(--ax-accent-dark)] disabled:opacity-70">
            {searchLoading ? "검색 중…" : "검색"} <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[var(--ax-text-hint)]">분류</span>
          {CATEGORIES.map((cat) => {
            const s = catStyle(cat);
            const on = activeCat === cat;
            return (
              <button key={cat} type="button" onClick={() => filterByCategory(cat)}
                className="rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition-all"
                style={on ? { background: s.fg, color: "#fff", borderColor: s.fg } : { background: s.bg, color: s.fg, borderColor: s.bd }}>
                {cat}
              </button>
            );
          })}
        </div>

        {/* 2단: 좌 검색결과 / 우 AI 어시스턴트 */}
        <div className="mt-6 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(340px,1fr)]">
          {/* ── 좌: 결과 또는 추천 ── */}
          <section className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <div className="mb-2 flex items-center gap-2">
              <button type="button" onClick={() => setShowGraph((g) => !g)} className="flex items-center gap-1 rounded-lg border border-[var(--ax-border)] bg-[var(--ax-card)] px-2.5 py-1 text-xs font-semibold text-[var(--ax-text-muted)] transition-colors hover:bg-[var(--ax-border-soft)] hover:text-[var(--ax-text)]">
                <span className="material-symbols-outlined text-[14px]">{showGraph ? "list" : "hub"}</span>{showGraph ? "결과 목록" : "지식그래프"}
              </button>
              {showGraph && <span className="text-[11px] text-[var(--ax-text-hint)]">현재 답변 근거 문서가 빨간 노드로 강조됩니다</span>}
            </div>
            {showGraph ? (
              <div className="h-[calc(100dvh-240px)]">
                <KnowledgeGraphPanel highlight={aiRefs.map((r) => r.title).filter((t): t is string => !!t)} />
              </div>
            ) : searchDone ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-[var(--ax-accent)]">description</span>
                  <h3 className="text-lg font-bold">{activeCat ? `${activeCat} 분류` : "사규 검색 결과"}</h3>
                  <span className="text-xs text-[var(--ax-text-hint)]">{internalRegulations.length}건</span>
                  <span className="ml-auto hidden text-[11px] text-[var(--ax-text-hint)] sm:inline">글박스=전체 조문 · 조문칩=해당 조문 펼치기</span>
                  <button type="button" onClick={resetSearch} title="다시 검색" className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--ax-border)] bg-[var(--ax-card)] px-2.5 py-1 text-xs font-semibold text-[var(--ax-text-muted)] transition-colors hover:bg-[var(--ax-border-soft)] hover:text-[var(--ax-text)]">
                    <span className="material-symbols-outlined text-[14px]">search</span>다시검색
                  </button>
                </div>
                {internalRegulations.length === 0 ? (
                  <div className="rounded-[var(--ax-radius-lg)] border border-dashed border-[var(--ax-border)] bg-[var(--ax-card)] p-8 text-center text-sm text-[var(--ax-text-muted)]">
                    검색어 &quot;{searchQuery}&quot;에 맞는 내부 지식이 없습니다. 우측 AI 어시스턴트에게 질문해 보세요.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {internalRegulations.map((reg, i) => {
                      const allOpen = openAll === i;
                      const anyOpen = allOpen || reg.articles.some((_, j) => openArt.has(`${i}:${j}`));
                      const hasAttachGroup = reg.articles.some((a) => a.name === "부속서류"); // 계약서: 부속서류 구분자가 있으면 tailGroupLabel 자동그룹 억제
                      return (
                        <div key={`${reg.key}-${i}`} className="overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-sm">
                          {/* 글박스 헤더 → 전체 조문 */}
                          <button type="button" className="flex w-full items-center gap-2 p-4 text-left transition-colors hover:bg-[var(--ax-border-soft)]" onClick={() => toggleAll(i, reg)}>
                            <span className="material-symbols-outlined text-sm text-[var(--ax-text-hint)]" style={{ transition: "transform 0.2s", transform: allOpen ? "rotate(90deg)" : "rotate(0)" }}>chevron_right</span>
                            <CatBadge c={reg.category} />
                            {reg.docNumber && <span className="shrink-0 rounded bg-[var(--ax-border-soft)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--ax-text-muted)]">{reg.docNumber}</span>}
                            <span className="font-bold text-[var(--ax-text)]">{reg.title}</span>
                            {reg.revisionInfo && <span className="text-xs text-[var(--ax-text-muted)]">{reg.revisionInfo}</span>}
                            <span className="ml-auto shrink-0 text-[11px] text-[var(--ax-text-hint)]">조문 {reg.articles.filter((a) => !isDivider(a)).length}</span>
                          </button>
                          {/* 조문칩 → 해당 조문만 펼침. 장 헤더는 전체 너비 그룹 라벨로 렌더해 조들이 그 아래로 묶임. */}
                          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                            {reg.articles.map((a, j) => {
                              if (isDivider(a)) return (
                                <div key={j} className="mt-1.5 flex w-full items-center gap-1 text-[11px] font-bold text-[var(--ax-text-muted)] first:mt-0">
                                  <span className="material-symbols-outlined text-[13px]">folder</span>{a.name}
                                </div>
                              );
                              const on = allOpen || openArt.has(`${i}:${j}`);
                              const tg = hasAttachGroup ? null : tailGroupLabel(a.name);
                              const showTg = tg && tg !== (hasAttachGroup ? null : tailGroupLabel(reg.articles[j - 1]?.name));
                              return (
                                <Fragment key={j}>
                                  {showTg && (
                                    <div className="mt-1.5 flex w-full items-center gap-1 text-[11px] font-bold text-[var(--ax-text-muted)] first:mt-0">
                                      <span className="material-symbols-outlined text-[13px]">folder</span>{tg}
                                    </div>
                                  )}
                                  <button type="button" onClick={() => toggleArt(i, j, reg)}
                                    className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${on ? "bg-[var(--ax-accent)] text-white" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)] hover:bg-[var(--ax-accent-bg)] hover:text-[var(--ax-accent)]"}`}>
                                    {a.name}
                                  </button>
                                </Fragment>
                              );
                            })}
                          </div>
                          {/* 펼쳐진 조문 본문 */}
                          {anyOpen && (
                            <div className="max-h-[460px] space-y-2.5 overflow-y-auto border-t border-[var(--ax-border)] bg-[var(--ax-border-soft)] p-4">
                              {reg.articles.map((a, j) => {
                                if (isDivider(a)) return allOpen ? (
                                  <div key={j} className="flex items-center gap-1.5 pt-1 text-xs font-bold text-[var(--ax-text-muted)] first:pt-0">
                                    <span className="material-symbols-outlined text-[15px]">folder</span>{a.name}
                                  </div>
                                ) : null;
                                if (!(allOpen || openArt.has(`${i}:${j}`))) return null;
                                const tg = hasAttachGroup ? null : tailGroupLabel(a.name);
                                const showTg = allOpen && tg && tg !== (hasAttachGroup ? null : tailGroupLabel(reg.articles[j - 1]?.name));
                                return (
                                  <Fragment key={j}>
                                    {showTg && (
                                      <div className="flex items-center gap-1.5 pt-1 text-xs font-bold text-[var(--ax-text-muted)] first:pt-0">
                                        <span className="material-symbols-outlined text-[15px]">folder</span>{tg}
                                      </div>
                                    )}
                                    <div className="rounded-lg border border-[var(--ax-border)] bg-[var(--ax-card)] p-3">
                                      <div className="mb-1.5 text-sm font-bold text-[var(--ax-accent)]">{a.name}</div>
                                      <ArticleBody text={a.fullText} name={a.name} />
                                    </div>
                                  </Fragment>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 shadow-sm">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><span className="material-symbols-outlined text-[var(--ax-accent)]">trending_up</span>자주 찾는 사규</h3>
                  {popularRegs.length === 0 ? <p className="text-xs text-[var(--ax-text-hint)]">집계 중…</p> : (
                    <ul>
                      {popularRegs.map((reg, idx) => (
                        <li key={reg.id}><button type="button" onClick={() => openRegulation(reg.title)} className="-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[var(--ax-border-soft)]">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--ax-border-soft)] text-xs font-bold text-[var(--ax-text-muted)]">{idx + 1}</span>
                          <CatBadge c={reg.category} />
                          {reg.docNumber && <span className="shrink-0 rounded bg-[var(--ax-border-soft)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--ax-text-muted)]">{reg.docNumber}</span>}
                          <span className="truncate text-sm font-medium">{reg.title}</span>
                          {reg.year && <span className="ml-auto shrink-0 text-xs text-[var(--ax-text-hint)]">{reg.year}</span>}
                        </button></li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 shadow-sm">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><span className="material-symbols-outlined text-[var(--ax-warning)]">new_releases</span>최근 개정 사규</h3>
                  {recentRegs.length === 0 ? <p className="text-xs text-[var(--ax-text-hint)]">집계 중…</p> : (
                    <ul>
                      {recentRegs.map((reg) => (
                        <li key={reg.id}><button type="button" onClick={() => openRegulation(reg.title)} className="-mx-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-[var(--ax-border-soft)]">
                          <CatBadge c={reg.category} />
                          {reg.docNumber && <span className="shrink-0 rounded bg-[var(--ax-border-soft)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--ax-text-muted)]">{reg.docNumber}</span>}
                          <span className="truncate text-sm font-medium">{reg.title}</span>
                          {reg.year && <span className="ml-auto shrink-0 text-xs text-[var(--ax-text-hint)]">{reg.year}</span>}
                        </button></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── 우: AI 어시스턴트 ── */}
          <aside className="min-h-0 overflow-y-auto pr-1">
            <div className="overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-sm">
              <div className="flex items-center gap-2 bg-[var(--ax-accent)] px-4 py-3 text-white">
                <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                <span className="font-bold">AI 지식 어시스턴트</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">Beta</span>
              </div>
              <div className="p-4">
                <p className="mb-2 text-xs leading-relaxed text-[var(--ax-text-muted)]">자연어로 질문하세요. 내부 사규 {count}건{extCount ? `과 법령·행정규칙 ${extCount}건` : ""}을 근거로 AI가 답하고 출처를 보여줍니다.</p>
                {/* 검색 모드: 빠른 / 심층 */}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border border-[var(--ax-border)] p-0.5 text-xs">
                    {([["fast", "빠른 검색", "bolt"], ["deep", "심층 검색", "neurology"]] as const).map(([m, label, icon]) => (
                      <button key={m} type="button" onClick={() => setAiMode(m)}
                        className={`flex items-center gap-1 rounded-md px-3 py-1.5 font-semibold transition ${aiMode === m ? "bg-[var(--ax-accent)] text-white" : "text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"}`}>
                        <span className="material-symbols-outlined text-[14px]">{icon}</span>{label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-[var(--ax-text-hint)]">{aiMode === "deep" ? "의도 파악·관련 사규 전문 주입 (느리지만 고품질)" : "결정론적 빠른 검색"}</span>
                </div>
                <textarea
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  onKeyDown={(e) => runOnEnterKeySubmit(e, () => askAiAssistant())}
                  rows={2}
                  className="w-full resize-y rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)] focus:bg-white focus:ring-2 focus:ring-[var(--ax-accent-soft)]"
                  placeholder="예: 신입사원이 1/1 입사했는데 3/6 기준 연차가 있나요?"
                />
                <button type="button" onClick={askAiAssistant} disabled={aiLoading || !aiQuery.trim()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--ax-accent)] px-3 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">
                  {aiLoading ? (
                    <>
                      <LlmSpinner className="h-4 w-4" accentClass="border-t-white border-white/25" />
                      {aiMode === "deep" ? "심층 분석 중…" : "답변 작성 중…"}
                      <span className="axp-shimmer ml-auto text-[11px] font-normal">AI도 실수할 수 있습니다.</span>
                    </>
                  ) : (
                    <><span className="material-symbols-outlined text-[18px]">auto_awesome</span>AI에게 질문</>
                  )}
                </button>

                {aiLoading && !aiResponse && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--ax-border)] bg-[var(--ax-border-soft)] px-3 py-2.5 text-sm text-[var(--ax-text-muted)]">
                    <LlmSpinner className="h-4 w-4" accentClass="border-t-[var(--ax-accent)]" /> {aiMode === "deep" ? "의도를 파악하고 관련 사규를 깊게 분석하는 중…" : "사규를 찾고 답변을 작성하는 중…"}
                  </div>
                )}
                {aiResponse && (
                  <div className="mt-3 rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--ax-accent)]"><span className="material-symbols-outlined text-[18px]">smart_toy</span>AI 답변</span>
                      {aiElapsedMs != null && <span className="text-[10px] text-[var(--ax-text-hint)]">{formatLlmMs(aiElapsedMs)}</span>}
                    </div>
                    {aiIntent && (
                      <div className="mb-2 rounded-lg border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] px-3 py-2 text-xs text-[var(--ax-text-muted)]">
                        <span className="font-bold text-[var(--ax-accent)]">파악된 의도</span> · {aiIntent}
                      </div>
                    )}
                    <LlmMarkdown compact className="text-[15px] text-[var(--ax-text)]">{aiResponse}</LlmMarkdown>
                    {relatedTasks.length > 0 && (
                      <div className="mt-3 border-t border-[var(--ax-border)] pt-3">
                        <p className="mb-2 text-xs font-bold text-[var(--ax-text-muted)]">관련 업무 <span className="font-normal text-[var(--ax-text-hint)]">(업무지도 온톨로지 — 클릭하면 업무탐색에서 소관·전결·근거·절차 보드 확인)</span></p>
                        <div className="flex flex-wrap gap-1.5">
                          {relatedTasks.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => window.dispatchEvent(new CustomEvent("axp-work-open", { detail: { taskId: t.id } }))}
                              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-500 hover:text-white"
                            >
                              <span className="material-symbols-outlined text-[14px]">view_in_ar</span>
                              {t.label}
                              <span className="text-[10px] font-medium opacity-70">{t.dept}{t.org === "현업" ? " · 현장" : ""}{t.status === "promoted" ? "" : " · 검토중"}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {(aiCitations.length > 0 || aiRefs.length > 0) && (
                      <div className="mt-3 border-t border-[var(--ax-border)] pt-3">
                        <p className="mb-2 text-xs font-bold text-[var(--ax-text-muted)]">근거 문서 <span className="font-normal text-[var(--ax-text-hint)]">(클릭하면 해당 조문까지 펼침)</span></p>
                        <div className="flex flex-wrap gap-1.5">
                          {aiCitations.length > 0
                            ? aiCitations.map((c, i) => (
                                <button key={`${c.id}-${i}`} type="button" onClick={() => openCitation(c)} className="inline-flex items-center gap-1 rounded-full border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ax-accent)] transition-colors hover:bg-[var(--ax-accent)] hover:text-white">
                                  <span className="material-symbols-outlined text-[14px]">description</span>{c.title}{c.year ? ` (${c.year})` : ""}
                                </button>
                              ))
                            : aiRefs.map((rf, i) => (
                                <span key={`${rf.title ?? "ref"}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-[var(--ax-border-soft)] px-2.5 py-1 text-xs text-[var(--ax-text-muted)]">
                                  {rf.title}{rf.revisionInfo ? ` (${rf.revisionInfo})` : ""}
                                </span>
                              ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--ax-border)] pt-2.5">
                      {fb === "sent" ? (
                        <span className="flex items-center gap-1 text-xs text-[var(--ax-text-muted)]"><span className="material-symbols-outlined text-[15px] text-[var(--ax-accent)]">check_circle</span>피드백 감사합니다.</span>
                      ) : (
                        <>
                          <span className="text-xs text-[var(--ax-text-muted)]">이 답변이 도움이 되었나요?</span>
                          <button type="button" onClick={() => sendFeedback("up")} disabled={fbBusy} title="도움됨" className="inline-flex items-center rounded-full border border-[var(--ax-border)] px-2.5 py-1 text-[var(--ax-text-muted)] transition hover:border-[var(--ax-accent)] hover:bg-[var(--ax-accent-bg)] hover:text-[var(--ax-accent)] disabled:opacity-50"><span className="material-symbols-outlined text-[15px]">thumb_up</span></button>
                          <button type="button" onClick={() => setFbDownOpen(true)} disabled={fbBusy} title="아쉬움" className="inline-flex items-center rounded-full border border-[var(--ax-border)] px-2.5 py-1 text-[var(--ax-text-muted)] transition hover:border-[#d14343] hover:bg-[#fdeaea] hover:text-[#d14343] disabled:opacity-50"><span className="material-symbols-outlined text-[15px]">thumb_down</span></button>
                        </>
                      )}
                      <span className="ml-auto text-[10px] text-[var(--ax-text-hint)]">AI도 실수할 수 있습니다.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {citationOpen && <CitationModal data={citationOpen} loading={citationLoading} onClose={() => setCitationOpen(null)} />}
      {fbDownOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !fbBusy && setFbDownOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-[var(--ax-text)]"><span className="material-symbols-outlined text-[18px] text-[#d14343]">thumb_down</span>어떤 점이 아쉬웠나요?</div>
            <p className="mb-2 text-xs text-[var(--ax-text-muted)]">불만족 사유와 참고 이미지를 남겨주시면 검색 품질 개선에 활용합니다.</p>
            <textarea value={fbReason} onChange={(e) => setFbReason(e.target.value)} rows={4} placeholder="예: 근거 조문이 질문과 맞지 않습니다 / 최신 개정이 반영되지 않았습니다 등"
              className="w-full resize-y rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)] focus:bg-white" />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--ax-text-muted)]">
              <span className="material-symbols-outlined text-[16px]">image</span>참고 이미지(선택)
              <input type="file" accept="image/*" onChange={(e) => setFbImage(e.target.files?.[0] ?? null)} className="text-xs" />
            </label>
            {fbImage && <p className="mt-1 truncate text-[11px] text-[var(--ax-text-hint)]">{fbImage.name}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setFbDownOpen(false)} disabled={fbBusy} className="rounded-lg border border-[var(--ax-border)] px-3 py-1.5 text-sm text-[var(--ax-text-muted)] disabled:opacity-50">취소</button>
              <button type="button" onClick={() => sendFeedback("down", fbReason.trim(), fbImage)} disabled={fbBusy || (!fbReason.trim() && !fbImage)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ax-accent)] px-3 py-1.5 text-sm font-bold text-white transition hover:bg-[var(--ax-accent-dark)] disabled:opacity-50">
                {fbBusy && <LlmSpinner className="h-3.5 w-3.5" accentClass="border-t-white border-white/25" />}제출
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CitationModal({ data, loading, onClose }: {
  data: { title?: string; year?: string; articles: { name: string; fullText?: string }[]; relevant?: string[] };
  loading: boolean;
  onClose: () => void;
}) {
  const relevant = data.relevant ?? [];
  const isRelevant = (name: string) => relevant.some((r) => r && (name.includes(r) || r.includes(name)));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // 로드되면 '해당 조문'(관련) 자동 펼침
  useEffect(() => {
    if (!data.articles.length) return;
    const idx = data.articles.map((a, i) => (isRelevant(a.name) ? i : -1)).filter((i) => i >= 0);
    setExpanded(new Set(idx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.articles, data.relevant]);
  const toggle = (i: number) => setExpanded((p) => { const s = new Set(p); if (s.has(i)) s.delete(i); else s.add(i); return s; });

  // 관련 조문 먼저 보이도록 정렬
  const order = data.articles.map((a, i) => ({ a, i, rel: isRelevant(a.name) })).filter((o) => !isDivider(o.a)).sort((x, y) => Number(y.rel) - Number(x.rel) || x.i - y.i);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[var(--ax-border)] p-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--ax-accent)]"><span className="material-symbols-outlined text-[16px]">menu_book</span>근거 규정</div>
            <h3 className="mt-1 text-lg font-bold text-[var(--ax-text)]">{data.title}{data.year ? <span className="ml-2 text-sm font-normal text-[var(--ax-text-hint)]">{data.year}</span> : null}</h3>
            {relevant.length > 0 && <p className="mt-1 text-xs text-[var(--ax-text-muted)]">질의 관련 조문 {relevant.length}개를 펼쳤습니다.</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[var(--ax-text-hint)] hover:bg-[var(--ax-border-soft)]"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="py-12 text-center text-sm text-[var(--ax-text-hint)]">조문 불러오는 중…</div>
          ) : data.articles.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--ax-text-hint)]">표시할 조문이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {order.map(({ a, i, rel }) => (
                <div key={i} className={`overflow-hidden rounded-lg border ${rel ? "border-[var(--ax-accent-border)]" : "border-[var(--ax-border)]"}`}>
                  <button type="button" onClick={() => toggle(i)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--ax-border-soft)]">
                    <span className="material-symbols-outlined text-xs text-[var(--ax-text-hint)]" style={{ transition: "transform 0.2s", transform: expanded.has(i) ? "rotate(90deg)" : "rotate(0)" }}>chevron_right</span>
                    <span className="font-semibold text-[var(--ax-text)]">{a.name}</span>
                    {rel && <span className="rounded bg-[var(--ax-accent-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ax-accent)]">관련</span>}
                  </button>
                  {expanded.has(i) && (
                    <div className="border-t border-[var(--ax-border)] bg-[var(--ax-border-soft)] px-4 py-3">
                      <ArticleBody text={a.fullText} name={a.name} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
