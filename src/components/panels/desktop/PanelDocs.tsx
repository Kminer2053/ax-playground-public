"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DOC_FORMAT_INFO, type DocFormat } from "@/lib/docs-generate";
import {
  PanelShell,
  Card,
  Chip,
  Label,
  TextArea,
  FileDrop,
  Button,
  Tabs,
  StatusBox,
  type TabItem,
} from "@/components/ui";
import { HwpxPreview, preloadHwpxRenderer } from "@/components/docs/HwpxPreview";
import { FeedbackBar } from "@/components/panels/desktop/FeedbackBar";
import { StructureEditor, FormFieldsEditor, isStructEditable, cleanStructure } from "@/components/docs/StructureEditor";
import { LlmMarkdown } from "@/components/llm/LlmMarkdown";
import { formatLlmMs } from "@/components/llm/formatLlmDuration";
import { useOrgName } from "@/components/OrgProvider";
import { orgLabel } from "@/lib/org";

const FORMAT_KEYS: DocFormat[] = ["1p", "full", "gongmun", "press", "email", "custom"];
const ACCEPT_EXTS = ".txt,.md,.hwp,.hwpx,.pdf,.docx,.xlsx";
// 표준양식 미리보기 — rhwp 근사(한컴폰트 부재로 표 양식 깨짐) 대신 한컴 렌더 정적 이미지
// (public/doc-standards/<format>-<n>.png)를 노출. 양식별 쪽수. 목록에 없는 양식(press)은
// 미리보기 이미지 없이 안내 문구만 표시.
const STANDARD_PAGES: Record<string, number> = { "1p": 2, full: 5, gongmun: 1 };
const CHAT_ACCEPT = "image/*,.txt,.md,.hwp,.hwpx,.pdf,.docx,.xlsx";
const docChatSystem = (org: string) =>
  `당신은 ${org} 임직원의 공공기관 문서작성을 돕는 비서입니다. 사용자와 대화하며 보고서·공문에 담을 내용(배경·목적·현황·핵심 항목·수치·일정·근거 등)을 함께 구체화하세요. 빠진 정보는 질문하고, 정리가 충분해지면 핵심을 짚어 주세요. 답변은 간결한 한국어로.`;

type ParseResult = { name: string; format: string; ok: boolean; chars: number; preview: string; markdown?: string; truncated?: boolean; error?: string; needsOcr?: boolean; method?: string; note?: string };
type Final = { bytes?: Uint8Array; filename?: string | null; text?: string; preview?: string };
type TabKey = "form" | "files" | "content" | "final";
type Mode = "file" | "chat";
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMeta = {
  typedChars?: number;
  reg?: { chars: number } | null;
  attachments?: { attId: string; name: string; srcChars: number; usedChars: number; segments: number; mode: string; flagged?: number }[];
  history?: { total: number; kept: number; summarized: number };
};
type ChatMsg = { role: "user" | "assistant"; text: string; atts: { name: string; img: boolean }[]; content: string | ContentPart[]; ms?: number; meta?: ChatMeta };
// 인덱싱된 첨부(서버 TTL 24h 캐시) — 대화 턴마다 attId만 보내고 서버가 질문 맞춤 발췌
type ChatAtt = { attId: string; name: string; srcChars: number; chars: number; tier: "full" | "indexed"; chunkCount: number; indexing?: boolean; error?: string; needsOcr?: boolean; file?: File };
const CHAT_INPUT_MAX = 8000; // 가드레일 입력 게이트(타이핑 기준) — 첨부는 인덱싱 경유라 미포함
type GenStep = { stage: string; label: string; ms?: number; status: "run" | "done" };

function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const isImageFile = (f: File) => f.type.startsWith("image/");
const fileToDataURL = (f: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ""));
    r.onerror = rej;
    r.readAsDataURL(f);
  });
const partsToText = (content: string | ContentPart[]): string =>
  typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "[이미지]")).join(" ");
// 대화 → 구조생성용 transcript(사용자·AI 발화 정리)
const buildTranscript = (msgs: ChatMsg[]): string =>
  msgs
    .map((m) => `${m.role === "user" ? "사용자" : "AI"}: ${partsToText(m.content).trim()}`)
    .filter((s) => s.replace(/^(사용자|AI):\s*/, "").trim())
    .join("\n\n");

export function PanelDocs() {
  const orgName = useOrgName();
  const [format, setFormat] = useState<DocFormat>("1p");
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ParseResult[]>([]);
  const [parsing, setParsing] = useState(false);
  const [ocrBusy, setOcrBusy] = useState<string | null>(null); // 참고자료 스캔 PDF OCR 진행 중 파일명
  const [formFile, setFormFile] = useState<File | null>(null); // 임의 양식: 양식(템플릿) 파일
  const [formBytes, setFormBytes] = useState<Uint8Array | null>(null); // 임의 양식: 첨부 양식 rhwp 미리보기용
  const [formMarkerBytes, setFormMarkerBytes] = useState<Uint8Array | null>(null); // 임의 양식: 편집영역을 【N】 마커로 채운 미리보기(감지 후)
  const [formFilledBytes, setFormFilledBytes] = useState<Uint8Array | null>(null); // 임의 양식: 검토값을 실제로 채운 라이브 미리보기(3단계)
  const [previewMode, setPreviewMode] = useState<"marker" | "filled">("marker"); // 표준양식 탭: 편집영역(마커) / 입력값 반영
  const [formErr, setFormErr] = useState(""); // 임의 양식: 첨부 거부 사유(.hwp 등) 안내
  const [detecting, setDetecting] = useState(false); // 임의 양식: 편집영역 인식(detect API) 진행 중
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState("");
  const [previewSnap, setPreviewSnap] = useState(""); // 라이브 미리보기 시점의 값 스냅샷(변경 감지 → '오래됨' 표시)
  const [instruction, setInstruction] = useState("");
  const [tab, setTab] = useState<TabKey>("form");
  const [formPage, setFormPage] = useState(0); // 표준양식 미리보기 페이지(쪽) 인덱스

  // 대화 기반 모드
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatFiles, setChatFiles] = useState<File[]>([]); // 이미지(멀티모달) 첨부
  const [chatAtts, setChatAtts] = useState<ChatAtt[]>([]); // 문서 첨부(서버 인덱싱, 세션 지속)
  const [chatLoading, setChatLoading] = useState(false);
  const [confirmGen, setConfirmGen] = useState(false);
  const [chatDrag, setChatDrag] = useState(false);
  const [modelName, setModelName] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);

  // ③ 구조(검토 게이트) — 위계형 편집 객체
  const [structure, setStructure] = useState<Record<string, unknown> | null>(null);
  const [structurePreview, setStructurePreview] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [injAlert, setInjAlert] = useState<{ error: string; 문구: { text: string; source: string }[] } | null>(null); // 임의양식 인젝션 감지 안내
  const [steps, setSteps] = useState<GenStep[]>([]); // ① 생성 진행 단계(스트리밍)
  const [contentView, setContentView] = useState<"tree" | "json">("tree"); // ③ 위계형 / JSON
  const [jsonDraft, setJsonDraft] = useState(""); // ③ JSON 편집 버퍼
  const [jsonError, setJsonError] = useState(false); // JSON 형식 오류(편집 중)
  const [refineOpen, setRefineOpen] = useState(false); // ③ AI 지시 수정 모달
  const [refineText, setRefineText] = useState("");
  const [refineBusy, setRefineBusy] = useState(false);
  const [refineErr, setRefineErr] = useState("");

  // ④ 최종
  const [final, setFinal] = useState<Final | null>(null);
  const [buildLoading, setBuildLoading] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [copied, setCopied] = useState(false);
  const [finalView, setFinalView] = useState<"rhwp" | "html">("rhwp"); // ④ 근사(rhwp) / 내용(HTML)
  const [finalName, setFinalName] = useState(""); // ⑤ 다운로드 파일명(편집 가능)
  const abortRef = useRef<AbortController | null>(null); // ⑤ 생성/빌드 중단용

  const isEmail = format === "email";
  const isCustom = format === "custom";
  const hasForm = isCustom ? !!formFile : files.some((f) => /\.hwpx$/i.test(f.name));
  // 1단계 게이트: 임의 양식은 양식(템플릿)을 먼저 첨부해야 대화·참고자료 첨부가 열린다.
  const formLocked = isCustom && !hasForm;
  const canGen = !!instruction.trim() && (!isCustom || hasForm);
  const chatCanGen = chatMessages.some((m) => m.role === "user") && !chatLoading;
  const canGenChat = chatCanGen && (!isCustom || hasForm);
  const useChat = mode === "chat";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, chatLoading]);

  // 사용 모델명(라벨 표기용) 1회 조회
  useEffect(() => {
    void fetch("/api/ai/chat", { method: "GET" })
      .then((r) => r.json())
      .then((d) => setModelName(typeof d?.model === "string" ? d.model : ""))
      .catch(() => {});
  }, []);

  // rhwp 6MB WASM 미리 로드 — 미리보기 첫 조회 지연 제거(③).
  useEffect(() => { preloadHwpxRenderer(); }, []);

  // ⑤ 새 결과가 나오면 다운로드 파일명을 서버 기본값으로 초기화(이후 사용자가 편집 가능).
  useEffect(() => { if (final?.filename) setFinalName(final.filename); }, [final]);

  // ⑤ 진행 중인 생성/빌드 중단(AbortController).
  const cancelGen = () => abortRef.current?.abort();
  // ⑤ 대화 세션 초기화 — 메시지·입력·첨부뿐 아니라 그 대화로 만든 파생 결과(작성 컨텐츠·최종·
  // 진행상태·오류)까지 비워 완전한 '새 대화'로 시작한다. 단, 임의 양식의 '감지된 필드'는 양식(첨부)
  // 기반이라 라벨은 유지하고 값만 비워 새 대화로 다시 채울 수 있게 한다.
  const resetChat = () => {
    setChatMessages([]);
    setChatInput("");
    setChatFiles([]);
    setChatAtts([]);
    setConfirmGen(false);
    setSteps([]);
    setGenError("");
    setBuildError("");
    setFinal(null);
    setStructurePreview("");
    setStructure((prev) => {
      if (isCustom && prev && (prev as { __form?: boolean }).__form) {
        // 감지된 편집영역(번호·역할·최대글자)은 양식 기반이라 유지하고 입력값만 비운다.
        const fields = ((prev as { fields?: Record<string, unknown>[] }).fields ?? []).map((f) => ({ ...f, value: "" }));
        return { ...(prev as Record<string, unknown>), fields };
      }
      return null;
    });
    if (tab === "content" || tab === "final") setTab("form");
  };

  const selectFormat = (k: DocFormat) => {
    setFormat(k);
    setTab("form");
    setFormPage(0);
    setStructure(null);
    setStructurePreview("");
    setGenError("");
    setContentView("tree");
    setJsonError(false);
    setFinal(null);
    setBuildError("");
    setConfirmGen(false);
    if (k === "custom") setMode("file"); // 임의 양식 기본 파일첨부(대화로 전환 가능)
    else { setFormFile(null); setFormBytes(null); } // 다른 양식으로 가면 첨부 양식 정리
  };

  const parseFiles = useCallback(async (list: File[]) => {
    if (!list.length) {
      setParsed([]);
      return;
    }
    setParsing(true);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      const d = await fetch("/api/docs/parse", { method: "POST", body: fd }).then((r) => r.json());
      setParsed(d.ok ? d.results : []);
    } catch {
      setParsed([]);
    } finally {
      setParsing(false);
    }
  }, []);

  // 임의 양식: 양식(템플릿) 첨부 — 표준양식 탭 rhwp 미리보기용. .hwp/.hwpx 모두 rhwp가 렌더.
  // 양식 첨부 즉시: rhwp 미리보기 + 입력 필드 감지(작성 컨텐츠에 표시) — 감지는 LLM 없이 kordoc만.
  const detectFormFields = async (f: File) => {
    const fd = new FormData();
    fd.set("format", "custom");
    fd.set("stage", "detect");
    fd.append("files", f);
    setDetecting(true); // 편집영역 인식 시작 — UI 스피너 표시
    try {
      const d = await fetch("/api/docs/generate", { method: "POST", headers: { Accept: "application/json" }, body: fd }).then((r) => r.json());
      if (d?.injection) { setInjAlert({ error: String(d.error ?? ""), 문구: Array.isArray(d.문구) ? d.문구 : [] }); resetCustomInputs(); return; }
      if (d && d.ok === undefined && typeof d.error === "string" && d.error) {
        // 서버 판정 거부(예: '빈칸 서식' .hwp) — 사유를 그대로 보이고 첨부를 되돌린다.
        setFormErr(d.error); setFormFile(null); setFormBytes(null); return;
      }
      if (d?.ok && d.data && (d.data as Record<string, unknown>).__form) {
        setStructure(d.data as Record<string, unknown>);
        setStructurePreview(typeof d.preview === "string" ? d.preview : "");
        // 편집영역 【N】 마커 미리보기 — 표준양식 탭이 원본 대신 마커본을 보여 어디에 무엇이 들어가는지 인지.
        if (typeof d.previewBase64 === "string" && d.previewBase64) setFormMarkerBytes(b64ToBytes(d.previewBase64));
        setContentView("tree");
        setJsonError(false);
      }
    } catch {
      /* 감지 실패 → 작성 지시/대화로 진행 */
    } finally {
      setDetecting(false); // 성공·실패·오탐 무관하게 스피너 종료
    }
  };
  const attachForm = (fl: FileList) => {
    const arr = Array.from(fl);
    // hwpx 우선, 본문 교체형(긴본문) .hwp 도 허용 — '빈칸 서식' .hwp만 서버 감지 후 거부된다(사유 표시).
    const f = arr.find((x) => /\.hwpx$/i.test(x.name)) ?? arr.find((x) => /\.hwp$/i.test(x.name));
    if (!f) return;
    setFormErr("");
    setInjAlert(null);
    setFormFile(f);
    void f.arrayBuffer().then((b) => setFormBytes(new Uint8Array(b)));
    setFormMarkerBytes(null); // 이전 마커 미리보기 제거(감지 완료 시 재설정)
    setFormFilledBytes(null);
    setPreviewMode("marker");
    setPreviewErr("");
    setStructure(null);
    setStructurePreview("");
    setFinal(null);
    setTab("form");
    void detectFormFields(f); // 첨부 즉시 입력 필드 파악 → 작성 컨텐츠
  };
  const clearForm = () => {
    setFormFile(null);
    setFormBytes(null);
    setFormMarkerBytes(null);
    setFormFilledBytes(null);
    setPreviewMode("marker");
    setPreviewErr("");
    setFormErr("");
    setDetecting(false);
    setStructure(null);
  };
  // 인젝션 감지 시: 양식·참고자료·감지필드 초기화(맨처음 첨부 상태). 대화·작성 지시는 유지.
  const resetCustomInputs = () => {
    clearForm();
    setFiles([]);
    setParsed([]);
    setStructurePreview("");
    setFinal(null);
  };
  // 참고자료 첨부(임의 양식 포함 — 본문 작성에 활용). 양식은 attachForm로 별도 관리.
  const addFiles = (fl: FileList) => {
    if (formLocked) return; // 임의 양식: 양식 첨부 전에는 참고자료 첨부 차단
    const next = [...files, ...Array.from(fl)].slice(0, 3);
    setFiles(next);
    void parseFiles(next);
    setTab("files");
  };
  const removeFile = (i: number) => {
    const next = files.filter((_, j) => j !== i);
    setFiles(next);
    void parseFiles(next);
  };

  // 대화 — 첨부(이미지=멀티모달, 문서=파싱 텍스트) 후 /api/ai/chat 으로 모델과 대화.
  // ⚠ 파일은 동기적으로 File[]로 캡처해 넘겨야 함: input value 리셋이 FileList를 비우기 전에.
  // 참고자료 스캔 PDF — 사용자가 'OCR로 읽기' 동의 시 해당 파일만 ocr=1로 재파싱해 결과 교체.
  const reparseWithOcr = async (name: string) => {
    const f = files.find((x) => x.name === name);
    if (!f || ocrBusy) return;
    setOcrBusy(name);
    try {
      const fd = new FormData();
      fd.append("files", f);
      fd.set("ocr", "1");
      const d = await fetch("/api/docs/parse", { method: "POST", body: fd }).then((r) => r.json()).catch(() => null);
      const r0 = d?.ok ? (d.results as ParseResult[])[0] : null;
      if (r0) setParsed((ps) => ps.map((p) => (p.name === name ? r0 : p)));
    } finally {
      setOcrBusy(null);
    }
  };

  // 첨부 라우팅: 이미지=멀티모달(메시지에 동봉), 문서=서버 인덱싱(/api/ai/chat/attach) 후 attId로 대화.
  // 문서는 파일 크기와 무관하게(수십만 자) 턴마다 질문 맞춤 발췌되어 활용된다.
  const addChatFiles = (list: File[]) => {
    if (formLocked) return; // 양식 미첨부 시 첨부 차단(드롭·붙여넣기 우회 방지)
    if (!list.length) return;
    const imgs = list.filter(isImageFile);
    const docs = list.filter((f) => !isImageFile(f));
    if (imgs.length) setChatFiles((c) => [...c, ...imgs].slice(0, 4));
    if (docs.length) void uploadChatDocs(docs.slice(0, 4));
  };
  const removeChatFile = (i: number) => setChatFiles((c) => c.filter((_, j) => j !== i));
  const removeChatAtt = (attId: string) => setChatAtts((c) => c.filter((a) => a.attId !== attId));
  const uploadChatDocs = async (docs: File[], ocr = false) => {
    const pend: ChatAtt[] = docs.map((f, i) => ({ attId: `pending-${Date.now()}-${i}`, name: f.name, srcChars: 0, chars: 0, tier: "full", chunkCount: 0, indexing: true }));
    setChatAtts((c) => [...c, ...pend].slice(0, 4));
    try {
      const fd = new FormData();
      for (const f of docs) fd.append("files", f);
      if (ocr) fd.set("ocr", "1"); // 스캔 PDF — 사용자가 'OCR로 읽기' 동의
      const d = await fetch("/api/ai/chat/attach", { method: "POST", body: fd }).then((r) => r.json());
      const rs = (d?.ok ? d.results : []) as (Partial<ChatAtt> & { ok?: boolean; name?: string; error?: string; needsOcr?: boolean })[];
      setChatAtts((c) => {
        const rest = c.filter((a) => !pend.some((p) => p.attId === a.attId));
        const done: ChatAtt[] = rs.map((r, i) => {
          if (r.ok && r.attId)
            return { attId: r.attId, name: r.name ?? docs[i]?.name ?? "첨부", srcChars: r.srcChars ?? r.chars ?? 0, chars: r.chars ?? 0, tier: (r.tier as ChatAtt["tier"]) ?? "full", chunkCount: r.chunkCount ?? 0 };
          if (r.needsOcr)
            return { attId: `ocr-${Date.now()}-${i}`, name: r.name ?? docs[i]?.name ?? "첨부", srcChars: 0, chars: 0, tier: "full", chunkCount: 0, needsOcr: true, file: docs[i] };
          return { attId: `err-${Date.now()}-${i}`, name: r.name ?? docs[i]?.name ?? "첨부", srcChars: 0, chars: 0, tier: "full", chunkCount: 0, error: r.error || "인덱싱 실패" };
        });
        return [...rest, ...done].slice(0, 4);
      });
    } catch {
      setChatAtts((c) => c.map((a) => (pend.some((p) => p.attId === a.attId) ? { ...a, indexing: false, error: "업로드 실패" } : a)));
    }
  };
  // 스캔 PDF 칩의 [OCR] 버튼 — 동의 후 재업로드(원본 File 보관분 사용)
  const retryAttOcr = (a: ChatAtt) => {
    if (!a.file) return;
    removeChatAtt(a.attId);
    void uploadChatDocs([a.file], true);
  };

  const sendChat = async () => {
    if (chatLoading || formLocked) return;
    const text = chatInput.trim();
    const readyAtts = chatAtts.filter((a) => !a.indexing && !a.error);
    if (!text && chatFiles.length === 0 && readyAtts.length === 0) return;
    if (text.length > CHAT_INPUT_MAX) return; // 게이트 사전 차단(미터에 경고 표시)
    setChatLoading(true);
    try {
      const imgUrls = await Promise.all(chatFiles.map(fileToDataURL));
      const content: string | ContentPart[] = imgUrls.length
        ? [
            ...(text ? [{ type: "text", text } as ContentPart] : []),
            ...imgUrls.map((url) => ({ type: "image_url", image_url: { url } }) as ContentPart),
          ]
        : text;
      const atts = [
        ...chatFiles.map((f) => ({ name: f.name, img: true })),
        ...readyAtts.map((a) => ({ name: a.name, img: false })),
      ];
      const userMsg: ChatMsg = { role: "user", text: text || "(첨부 전송)", atts, content };
      const history = [...chatMessages, userMsg];
      setChatMessages(history);
      setChatInput("");
      setChatFiles([]); // 이미지는 1회성, 문서 첨부(chatAtts)는 세션 지속 — 후속 질문에 재활용
      const t0 = performance.now();
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          system: docChatSystem(orgLabel(orgName)),
          attIds: readyAtts.map((a) => a.attId),
        }),
      });
      const d = await r.json().catch(() => ({}));
      const ms = Math.round(performance.now() - t0);
      let reply: string;
      if (r.ok && d.ok) reply = String(d.text ?? "");
      else if (String(d.ruleId ?? "").startsWith("M14")) {
        reply = `⚠️ ${d.error || "입력이 너무 깁니다."}\n\n👉 긴 자료는 📎 파일로 첨부해 주세요(자동 인덱싱되어 질문마다 관련 부분이 발췌됩니다). 또는 내용을 나눠서 보내주세요.`;
      } else reply = `⚠️ ${d.error || "응답을 받지 못했습니다."}`;
      setChatMessages((m) => [...m, { role: "assistant", text: reply, atts: [], content: reply, ms, meta: d.contextMeta as ChatMeta | undefined }]);
    } catch {
      setChatMessages((m) => [...m, { role: "assistant", text: "⚠️ 서버 연결에 실패했습니다.", atts: [], content: "" }]);
    } finally {
      setChatLoading(false);
    }
  };

  // 생성(구조) — stage=structure. 대화 모드면 transcript를 conversation으로 전송. custom 은 게이트 없이 일괄.
  const genStructure = async () => {
    if (genLoading) return;
    if (useChat ? !canGenChat : !canGen) return;
    setGenLoading(true);
    setGenError("");
    setInjAlert(null);
    setFinal(null);
    setSteps([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const fd = new FormData();
    fd.set("format", format);
    if (parsed.some((p) => p.method === "ocr")) fd.set("ocr", "1"); // 참고자료를 OCR로 읽었다면 생성 단계도 동일 승격
    if (isCustom) {
      if (formFile) fd.append("files", formFile); // 양식(첫 hwpx/hwp) — handleCustomForm이 양식으로 인식
      for (const f of files) fd.append("files", f); // 참고자료
      // 대화 모드: transcript를 conversation으로 분리 전달. 서버가 서식(폼)이면 각 필드 '값 찾기'로,
      // 본문형 문서면 본문 작성에 사용한다. 지시에 "본문에 채우세요" 같은 구조생성 프레이밍을 섞지
      // 않아야 서식 필드가 값-찾기로 제대로 채워진다.
      fd.set("instruction", instruction.trim());
      if (useChat) fd.set("conversation", buildTranscript(chatMessages));
    } else if (useChat) {
      fd.set("instruction", "아래 대화 내용을 정리하여 이 양식에 맞는 문서로 작성하세요.");
      fd.set("conversation", buildTranscript(chatMessages));
    } else {
      fd.set("instruction", instruction.trim());
      for (const f of files) fd.append("files", f);
    }
    try {
      // 임의 양식: 서식(폼)이면 감지된 필드+제안값을 검토 게이트(작성 컨텐츠)로, 문서면 일괄 빌드.
      if (isCustom) {
        const r = await fetch("/api/docs/generate", { method: "POST", headers: { Accept: "application/json" }, body: fd, signal: ctrl.signal });
        const d = await r.json();
        if (d.injection) { setInjAlert({ error: String(d.error ?? ""), 문구: Array.isArray(d.문구) ? d.문구 : [] }); resetCustomInputs(); return; }
        if (!r.ok || !d.ok) { setGenError(d.error || `생성 실패 (HTTP ${r.status})`); return; }
        if (d.data && (d.data as Record<string, unknown>).__form) {
          // 서식 → 필드 값 검토(작성 컨텐츠). AI 제안값은 '빈 칸'에만 반영해 직접 수정한 값은 보존.
          // 자동 채움 불가(fillable===false) 필드는 채우지 않는다(다운로드 후 직접 입력).
          const ai = ((d.data as { fields?: { label: string; value?: string }[] }).fields) ?? [];
          const aiByLabel = new Map(ai.map((f) => [f.label, f.value ?? ""]));
          setStructure((prev) => {
            const cur = (prev?.fields as { label: string; value?: string; fillable?: boolean }[] | undefined) ?? [];
            const merged = cur.length
              ? cur.map((f) => ({ ...f, value: f.fillable === false ? "" : (String(f.value ?? "").trim() ? f.value : aiByLabel.get(f.label) ?? "") }))
              : ai;
            return { ...(d.data as Record<string, unknown>), fields: merged };
          });
          setStructurePreview(typeof d.preview === "string" ? d.preview : "");
          setContentView("tree");
          setJsonError(false);
          setTab("content");
        } else {
          // 문서 → 최종
          setFinal({ bytes: d.fileBase64 ? b64ToBytes(d.fileBase64) : undefined, filename: d.filename, text: d.text, preview: d.preview });
          setTab("final");
        }
        return;
      }
      // 구조 생성(스트리밍) — 내용정리 → 양식맞춤 단계 진행을 실시간 표시.
      fd.set("stage", "structure");
      setTab("content");
      const res = await fetch("/api/docs/generate?stream=1", { method: "POST", headers: { Accept: "application/x-ndjson" }, body: fd, signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        setGenError(d.error || `생성 실패 (HTTP ${res.status})`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let ok = false, errored = false;
      const onEvent = (e: Record<string, unknown>) => {
        if (e.done) {
          ok = true;
          setStructure((e.data as Record<string, unknown>) ?? null);
          setStructurePreview(typeof e.preview === "string" ? e.preview : "");
          setContentView("tree");
          setJsonError(false);
          setSteps((s) => s.map((x) => ({ ...x, status: "done" })));
        } else if (e.error) {
          errored = true;
          setGenError(String(e.error));
        } else if (e.stage) {
          const stg = String(e.stage), status = String(e.status ?? ""), label = String(e.label ?? stg), ms = e.ms != null ? Number(e.ms) : undefined;
          setSteps((prev) => {
            const idx = prev.findIndex((p) => p.stage === stg);
            if (status === "start") return idx < 0 ? [...prev, { stage: stg, label, status: "run" }] : prev;
            if (status === "done") return prev.map((p) => (p.stage === stg ? { ...p, status: "done", ms } : p));
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
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim()) { try { onEvent(JSON.parse(line)); } catch { /* skip */ } }
        }
      }
      if (!ok && !errored) setGenError("구조 생성에 실패했습니다. 다시 시도해 주세요.");
    } catch {
      if (!ctrl.signal.aborted) setGenError("요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      abortRef.current = null;
      setGenLoading(false);
      setConfirmGen(false); // 생성 완료(성공·실패·중단) 후에만 확인 다이얼로그 → 원래 버튼 복귀(스피너 유지)
    }
  };

  // 생성 확정(빌드) — stage=build. 검토·수정된 구조 → 최종.
  const buildFinal = async () => {
    if (buildLoading) return;
    setBuildLoading(true);
    setBuildError("");
    setConfirmGen(false); // 최종 생성 시작 시 대화모드 확인 다이얼로그 정리(원래 버튼으로 복귀)
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const fd = new FormData();
      fd.set("format", format);
      fd.set("stage", "build");
      fd.set("data", JSON.stringify(isCustom ? structure ?? {} : structure ? cleanStructure(format, structure) : {}));
      if (isCustom && formFile) fd.append("files", formFile); // 서식: 양식 파일 재전송(채우기용)
      const r = await fetch("/api/docs/generate", { method: "POST", headers: { Accept: "application/json" }, body: fd, signal: ctrl.signal });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setBuildError(d.error || `생성 실패 (HTTP ${r.status})`);
        return;
      }
      setFinal({ bytes: d.fileBase64 ? b64ToBytes(d.fileBase64) : undefined, filename: d.filename, text: d.text, preview: d.preview });
      setTab("final");
    } catch {
      if (!ctrl.signal.aborted) setBuildError("요청 처리 중 오류가 발생했습니다.");
    } finally {
      abortRef.current = null;
      setBuildLoading(false);
    }
  };

  // 3단계 라이브 미리보기 — 검토·수정한 값을 실제로 채운 양식을 렌더(다운로드·집계 없음).
  // 표준양식 탭에서 '입력값 반영'을 누르면 현재 값으로 서버 fill 후 그 결과를 미리 본다.
  const refreshFilledPreview = async () => {
    if (!formFile || previewBusy) return;
    setPreviewBusy(true);
    setPreviewErr("");
    try {
      const fd = new FormData();
      fd.set("format", "custom");
      fd.set("stage", "preview");
      fd.set("data", JSON.stringify(structure ?? {}));
      fd.append("files", formFile);
      const d = await fetch("/api/docs/generate", { method: "POST", headers: { Accept: "application/json" }, body: fd }).then((r) => r.json());
      if (d?.injection) { setInjAlert({ error: String(d.error ?? ""), 문구: Array.isArray(d.문구) ? d.문구 : [] }); return; }
      if (d?.ok && typeof d.previewBase64 === "string" && d.previewBase64) {
        setFormFilledBytes(b64ToBytes(d.previewBase64));
        setPreviewSnap(JSON.stringify(structure ?? {}));
        setPreviewMode("filled");
      } else {
        setPreviewErr(d?.error || "미리보기 생성에 실패했습니다.");
      }
    } catch {
      setPreviewErr("미리보기 요청에 실패했습니다.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const download = () => {
    if (!final?.bytes) return;
    const b = final.bytes;
    // 확장자는 '실제 내용'(매직바이트)으로 강제 — D0CF=hwp, 그 외(PK 등)=hwpx. 사용자가 파일명을
    // 임의로 바꿔도 내용·확장자 불일치로 안 열리는 일을 막는다(fill 결과는 항상 hwpx).
    const ext = b.length >= 2 && b[0] === 0xd0 && b[1] === 0xcf ? "hwp" : "hwpx";
    const stem = (finalName || final.filename || "문서").trim().replace(/\.hwpx?$/i, "").replace(/\.+$/, "") || "문서";
    const name = `${stem}.${ext}`;
    const url = URL.createObjectURL(new Blob([final.bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copyText = async () => {
    await navigator.clipboard.writeText(final?.text ?? final?.preview ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // ③ JSON 보기로 전환 — 현재 구조를 JSON 텍스트로 스냅샷
  const showJsonView = () => {
    setJsonDraft(JSON.stringify(structure ?? {}, null, 2));
    setJsonError(false);
    setContentView("json");
  };
  // JSON 편집 — 유효하면 구조에 즉시 반영, 아니면 오류 표시(편집은 계속 허용)
  const onJsonEdit = (v: string) => {
    setJsonDraft(v);
    try {
      setStructure(JSON.parse(v) as Record<string, unknown>);
      setJsonError(false);
    } catch {
      setJsonError(true);
    }
  };

  // AI 지시로 작성 컨텐츠(구조) 수정 — 직접 편집 대신 "더 간결하게" "OO 추가" 등 자연어로.
  const applyRefine = async () => {
    const ins = refineText.trim();
    if (!ins || refineBusy || !structure) return;
    setRefineBusy(true); setRefineErr("");
    try {
      const r = await fetch("/api/docs/refine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, structure, instruction: ins }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setRefineErr(d.error || `수정 실패 (HTTP ${r.status})`); return; }
      setStructure(d.structure as Record<string, unknown>);
      if (contentView === "json") setJsonDraft(JSON.stringify(d.structure, null, 2));
      setRefineOpen(false); setRefineText("");
    } catch {
      setRefineErr("수정 중 오류가 발생했습니다.");
    } finally { setRefineBusy(false); }
  };

  const tabs: TabItem[] = [
    { key: "form", label: "표준양식", icon: "🗂" },
    { key: "files", label: "참고자료", icon: "📄" },
    { key: "content", label: "작성 컨텐츠", icon: "🧩" },
    { key: "final", label: isEmail ? "최종 본문" : "최종 HWPX", icon: "✅" },
  ];

  return (
    <PanelShell title="AI 문서작성" icon="edit_document" bodyClassName="grid min-h-0 grid-cols-[minmax(320px,34%)_1fr] gap-3 p-3.5">
      {/* 좌: 입력 */}
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pr-0.5">
        <Card label="양식 선택">
          <div className="grid grid-cols-3 gap-1.5">
            {FORMAT_KEYS.map((k) => (
              <Chip key={k} active={format === k} icon={DOC_FORMAT_INFO[k].icon} label={DOC_FORMAT_INFO[k].label} onClick={() => selectFormat(k)} />
            ))}
          </div>
        </Card>

        {isCustom && (
          <Card label="양식 첨부 (필수)">
            <FileDrop onFiles={attachForm} accept=".hwpx">
              <span>
                📎 양식 파일 드래그 · 선택{" "}
                <span className="text-[var(--ax-text-hint)]">(hwpx · 1개)</span>
              </span>
            </FileDrop>
            {formErr && (
              <p className="mt-2 rounded-[var(--ax-radius-sm)] border border-[var(--ax-danger)] bg-[var(--ax-danger-bg)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--ax-danger)]">{formErr}</p>
            )}
            {formFile ? (
              <>
                <div className="mt-2 flex items-center gap-2 rounded-[var(--ax-radius-sm)] bg-[var(--ax-accent-bg)] px-2.5 py-1.5 text-xs text-[var(--ax-accent-dark)]">
                  <span className="shrink-0 rounded-[4px] bg-[var(--ax-accent)] px-1 py-0.5 text-[10px] font-medium text-white">양식</span>
                  <span className="truncate">{formFile.name}</span>
                  <button onClick={clearForm} className="ml-auto text-[var(--ax-text-hint)] hover:text-[var(--ax-danger)]" aria-label="제거">✕</button>
                </div>
                {detecting ? (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--ax-accent)]" role="status" aria-live="polite">
                    <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[var(--ax-accent)] border-t-transparent" />
                    편집영역을 인식하는 중입니다…
                  </div>
                ) : structure?.__form ? (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--ax-accent)]"><span>✓</span> 편집영역 {(structure?.fields as unknown[] | undefined)?.length ?? 0}곳을 인식했습니다.</div>
                ) : null}
              </>
            ) : (
              <div className="mt-1.5 flex flex-col gap-1 text-[11px] leading-relaxed">
                <p className="text-[var(--ax-warning)]">표·서식을 보존할 <b>hwpx 양식</b>만 지원합니다 (본문만 AI가 교체). <span className="text-[var(--ax-text-hint)]">구버전 .hwp는 한컴에서 hwpx로 저장 후 첨부하세요.</span></p>
                <p className="text-[var(--ax-text-hint)]">인식 기준 · 빈칸(라벨-값)이 <b>3개 이상</b>이면 자동 <b>필드 채우기</b>, 본문 위주 문서면 <b>본문 편집</b>으로 처리됩니다. 예시가 채워진 표(견본)는 편집영역에서 제외됩니다.</p>
              </div>
            )}
          </Card>
        )}

        <Card label="문서작성 방법">
          <div className="grid grid-cols-2 gap-1.5">
            <Chip active={mode === "chat"} icon="💬" label="AI와 대화 기반" onClick={() => setMode("chat")} />
            <Chip active={mode === "file"} icon="📎" label="파일첨부 기반" onClick={() => setMode("file")} />
          </div>
        </Card>

        {useChat ? (
          <>
            <Card
              label="AI와 대화"
              action={
                <div className="flex items-center gap-2">
                  {modelName && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ax-text-muted)]">🤖 {modelName}</span>}
                  {chatMessages.length > 0 && (
                    <button
                      onClick={resetChat}
                      className="inline-flex items-center gap-0.5 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] px-1.5 py-0.5 text-[11px] text-[var(--ax-text-muted)] transition hover:border-[var(--ax-danger)] hover:text-[var(--ax-danger)]"
                      title="대화와 생성한 내용을 모두 비우고 새 대화를 시작합니다"
                    >
                      ↺ 대화 초기화
                    </button>
                  )}
                </div>
              }
              className="flex min-h-0 flex-1 flex-col"
              bodyClassName="flex min-h-0 flex-1 flex-col gap-2"
            >
              <div
                onDragOver={(e) => { e.preventDefault(); setChatDrag(true); }}
                onDragLeave={() => setChatDrag(false)}
                onDrop={(e) => { e.preventDefault(); setChatDrag(false); addChatFiles(Array.from(e.dataTransfer.files ?? [])); }}
                className={`flex min-h-[220px] flex-1 flex-col gap-2 overflow-y-auto rounded-[var(--ax-radius-sm)] pr-0.5 transition ${chatDrag ? "bg-[var(--ax-accent-bg)] ring-2 ring-inset ring-[var(--ax-accent)]" : ""}`}
              >
                {chatMessages.length === 0 ? (
                  formLocked ? (
                    <div className="m-auto flex max-w-[280px] flex-col items-center gap-1 px-4 text-center text-xs leading-relaxed text-[var(--ax-text-hint)]">
                      <span className="text-2xl">🔒</span>
                      <span className="font-medium text-[var(--ax-text-muted)]">먼저 ‘양식 첨부’에서 hwpx 양식을 올려주세요.</span>
                      <span>양식을 첨부해 편집영역이 파악되면 대화와 파일 첨부가 열립니다.</span>
                    </div>
                  ) : (
                    <div className="m-auto px-4 text-center text-xs leading-relaxed text-[var(--ax-text-hint)]">
                      작성할 문서 내용을 AI와 대화로 정리하세요.
                      <br />
                      📎 버튼·드래그·붙여넣기로 파일·이미지를 첨부할 수 있습니다.
                    </div>
                  )
                ) : (
                  chatMessages.map((m, i) => (
                    <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                      <div
                        className={`max-w-[88%] rounded-[var(--ax-radius)] px-3 py-2 text-sm leading-relaxed ${
                          m.role === "user" ? "whitespace-pre-wrap bg-[var(--ax-accent)] text-white" : "bg-[var(--ax-page)] text-[var(--ax-text)]"
                        }`}
                      >
                        {m.role === "assistant" ? <LlmMarkdown compact className="!text-[13px]">{m.text}</LlmMarkdown> : m.text}
                        {m.atts.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {m.atts.map((a, j) => (
                              <span
                                key={j}
                                className={`rounded-[5px] px-1.5 py-0.5 text-[11px] ${m.role === "user" ? "bg-white/20" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]"}`}
                              >
                                {a.img ? "🖼" : "📄"} {a.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {m.role === "assistant" && (m.ms != null || m.meta) && (
                        <span className="mt-0.5 flex flex-wrap gap-x-2 px-1 text-[11px] text-[var(--ax-text-hint)]">
                          {m.ms != null && <span>⏱ {formatLlmMs(m.ms)}</span>}
                          {(m.meta?.attachments ?? []).map((a, j) => (
                            <span key={j} title={`발췌 방식: ${a.mode}`}>
                              📎 {a.name}: {a.mode === "full"
                                ? "전문 반영"
                                : `${a.srcChars.toLocaleString()}자 중 ${a.usedChars.toLocaleString()}자·${a.segments}구간${a.mode === "skim" ? "(전체 스킴)" : ""} 반영`}
                            </span>
                          ))}
                          {(m.meta?.history?.summarized ?? 0) > 0 && (
                            <span>🕐 이전 {m.meta!.history!.summarized}개 메시지 요약 반영</span>
                          )}
                          {m.meta?.reg?.chars ? <span>📚 사규 근거 반영</span> : null}
                        </span>
                      )}
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-[var(--ax-radius)] bg-[var(--ax-page)] px-3 py-2 text-sm text-[var(--ax-text-muted)]">··· 생각하는 중</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* 작성 바 */}
              <div className="flex flex-col gap-1.5 border-t border-[var(--ax-border-soft)] pt-2">
                {(chatFiles.length > 0 || chatAtts.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {chatAtts.map((a) => (
                      <span
                        key={a.attId}
                        title={a.needsOcr ? "스캔 이미지 PDF — OCR로 읽기(수 분)를 누르면 텍스트를 인식합니다" : a.error ? a.error : a.tier === "indexed" ? `전체 ${a.srcChars.toLocaleString()}자 인덱싱 — 질문마다 관련 부분 자동 발췌` : "전문 반영"}
                        className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] ${a.error ? "bg-[#fff1f2] text-[#be123c]" : a.needsOcr ? "bg-[#fffbeb] text-[#b45309]" : "bg-[var(--ax-accent-bg)] text-[var(--ax-accent-dark)]"}`}
                      >
                        {a.indexing ? "⏳" : a.error ? "⚠" : a.needsOcr ? "🖼" : "📄"} <span className="max-w-32 truncate">{a.name}</span>
                        {a.needsOcr && (
                          <button onClick={() => retryAttOcr(a)} className="rounded border border-current px-1 font-semibold hover:bg-[#fef3c7]">
                            OCR로 읽기
                          </button>
                        )}
                        {!a.indexing && !a.error && !a.needsOcr && (
                          <span className="text-[var(--ax-text-hint)]">
                            {a.tier === "indexed" ? `${(a.srcChars / 10000).toFixed(1)}만자·검색형` : "전문"}
                          </span>
                        )}
                        {a.indexing && <span className="text-[var(--ax-text-hint)]">인덱싱…</span>}
                        <button onClick={() => removeChatAtt(a.attId)} className="text-[var(--ax-text-hint)] hover:text-[var(--ax-danger)]" aria-label="제거">✕</button>
                      </span>
                    ))}
                    {chatFiles.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-[5px] bg-[var(--ax-accent-bg)] px-1.5 py-0.5 text-[11px] text-[var(--ax-accent-dark)]">
                        🖼 <span className="max-w-28 truncate">{f.name}</span>
                        <button onClick={() => removeChatFile(i)} className="text-[var(--ax-text-hint)] hover:text-[var(--ax-danger)]" aria-label="제거">✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-1.5">
                  <button
                    onClick={() => chatFileRef.current?.click()}
                    disabled={formLocked}
                    title={formLocked ? "양식을 먼저 첨부하세요" : "파일·이미지 첨부"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] text-[var(--ax-text-muted)] transition hover:bg-[var(--ax-border-soft)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    aria-label="첨부"
                  >
                    📎
                  </button>
                  <input
                    ref={chatFileRef}
                    type="file"
                    accept={CHAT_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addChatFiles(e.target.files ? Array.from(e.target.files) : []);
                      e.target.value = "";
                    }}
                  />
                  <TextArea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={formLocked}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void sendChat();
                      }
                    }}
                    onPaste={(e) => {
                      const imgs = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
                      if (imgs.length) { e.preventDefault(); addChatFiles(imgs); }
                    }}
                    rows={1}
                    placeholder={formLocked ? "양식을 먼저 첨부하면 대화가 열립니다" : "메시지 입력 (Shift+Enter 줄바꿈)"}
                    className="min-h-9 flex-1 resize-none !py-2 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <Button
                    size="sm"
                    icon="➤"
                    onClick={sendChat}
                    loading={chatLoading}
                    disabled={formLocked || chatInput.length > CHAT_INPUT_MAX || (!chatInput.trim() && chatFiles.length === 0 && !chatAtts.some((a) => !a.indexing && !a.error))}
                  >
                    전송
                  </Button>
                </div>
                {/* 입력 예산 미터 — 게이트(8,000자)는 타이핑 기준. 첨부는 인덱싱 경유라 미포함 */}
                {chatInput.length > CHAT_INPUT_MAX * 0.8 && (
                  <div className={`px-1 text-[11px] ${chatInput.length > CHAT_INPUT_MAX ? "font-semibold text-[var(--ax-danger)]" : "text-[var(--ax-warning)]"}`}>
                    {chatInput.length.toLocaleString()} / {CHAT_INPUT_MAX.toLocaleString()}자
                    {chatInput.length > CHAT_INPUT_MAX
                      ? " — 초과되어 전송할 수 없습니다. 긴 자료는 📎 파일로 첨부하면 자동 발췌되고, 설명은 나눠서 보내주세요."
                      : " — 8,000자 초과 시 전송이 차단됩니다. 긴 자료는 파일 첨부를 권장합니다."}
                  </div>
                )}
              </div>
            </Card>

            {confirmGen ? (
              <div className="flex flex-col gap-2 rounded-[var(--ax-radius)] border border-[var(--ax-accent-border)] bg-[var(--ax-accent-bg)] p-3">
                <span className="text-sm font-medium text-[var(--ax-text)]">현재 대화 내용을 정리해서 문서를 작성합니까?</span>
                <div className="flex gap-2">
                  <Button onClick={genStructure} loading={genLoading} icon="✅">확인</Button>
                  {genLoading ? (
                    <Button variant="ghost" onClick={cancelGen}>중단</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmGen(false)}>취소</Button>
                  )}
                </div>
              </div>
            ) : (
              <Button onClick={() => setConfirmGen(true)} disabled={!canGenChat} icon="✨">{isCustom ? (structure?.__form ? "대화 내용으로 필드 채우기" : "양식 처리 → 생성") : "구조 생성 → 검토"}</Button>
            )}
            {isCustom && !hasForm && <span className="text-xs text-[var(--ax-warning)]">‘양식 첨부’에서 hwpx 양식을 먼저 첨부하세요.</span>}
          </>
        ) : (
          <>
            <Card label="참고 자료 (선택)">
              <FileDrop onFiles={addFiles} accept={ACCEPT_EXTS} multiple disabled={formLocked}>
                {formLocked ? (
                  <span>🔒 양식을 먼저 첨부하면 참고자료를 올릴 수 있습니다</span>
                ) : (
                  <span>
                    📎 파일 드래그 · 선택{" "}
                    <span className="text-[var(--ax-text-hint)]">{isCustom ? "(본문에 반영할 자료 · pdf·docx·hwpx 등 · 최대 3개)" : "(hwpx·hwp·pdf·docx·txt … 최대 3개)"}</span>
                  </span>
                )}
              </FileDrop>
              {files.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-[var(--ax-radius-sm)] bg-[var(--ax-accent-bg)] px-2.5 py-1.5 text-xs text-[var(--ax-accent-dark)]">
                      <span className="truncate">{f.name}</span>
                      <button onClick={() => removeFile(i)} className="ml-auto text-[var(--ax-text-hint)] hover:text-[var(--ax-danger)]" aria-label="제거">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card label="작성 지시" className="flex min-h-0 flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col">
              <TextArea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={4000}
                placeholder={"예: 6월 전사 AI 교육 결과 보고서.\n- 6/10~12 교육 3회, 참석률 92%\n- 7월 심화과정 예정"}
                className="min-h-24 flex-1"
              />
            </Card>

            <Button onClick={genStructure} disabled={!canGen} loading={genLoading} icon="✨">
              {isCustom ? (structure?.__form ? "내용으로 필드 채우기" : "양식 처리 → 생성") : "구조 생성 → 검토"}
            </Button>
            {genLoading && <Button variant="ghost" onClick={cancelGen}>생성 중단</Button>}
            {isCustom && !hasForm && <span className="text-xs text-[var(--ax-warning)]">‘양식 첨부’에서 hwpx 양식을 먼저 첨부하세요.</span>}
          </>
        )}
        {injAlert && (
          <div className="rounded-[var(--ax-radius)] border border-[var(--ax-danger)] bg-[var(--ax-danger-bg)] p-3">
            <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--ax-danger)]"><span>⛔</span> 프롬프트 공격 감지 — 문서 작성 중단</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ax-danger)]">{injAlert.error}</p>
            {injAlert.문구.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {injAlert.문구.map((p, i) => (
                  <div key={i} className="rounded-[6px] border border-[var(--ax-danger)] bg-[var(--ax-card)] px-2 py-1 text-xs text-[var(--ax-text)]">
                    <span className="font-semibold text-[var(--ax-text-muted)]">[{p.source}]</span> “{p.text}”
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-[var(--ax-text-muted)]">양식·참고자료를 초기화했습니다. 해당 문구를 제거한 파일로 다시 첨부해 주세요.</p>
          </div>
        )}
        {genError && <StatusBox kind="error">{genError}</StatusBox>}
      </div>

      {/* 우: 4탭 미리보기 */}
      <Card className="flex min-h-0 flex-col p-0" bodyClassName="flex min-h-0 flex-1 flex-col">
        <Tabs items={tabs} active={tab} onChange={(k) => setTab(k as TabKey)} />
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          {tab === "form" &&
            (isEmail ? (
              <StatusBox kind="empty">이메일은 표준양식이 없습니다 (텍스트 본문).</StatusBox>
            ) : isCustom ? (
              formBytes ? (
                (() => {
                  const fmFields = (structure?.fields as { n?: number; role?: string; label?: string; max?: number; value?: string; fillable?: boolean }[] | undefined) ?? [];
                  const hasFields = fmFields.length > 0;
                  const filledView = previewMode === "filled" && !!formFilledBytes;
                  const bytes = (filledView ? formFilledBytes : (formMarkerBytes ?? formBytes)) as Uint8Array;
                  const stale = previewMode === "filled" && !!formFilledBytes && previewSnap !== JSON.stringify(structure ?? {});
                  const segBtn = (on: boolean) => `rounded-md px-2.5 py-1 transition ${on ? "bg-[var(--ax-accent-soft)] font-medium text-[var(--ax-accent)]" : "text-[var(--ax-text-muted)]"}`;
                  return (
                    <div className="flex h-full flex-col gap-2">
                      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-medium text-[var(--ax-text)]">{formFile?.name ?? "첨부 양식"}</span>
                        <span className="text-[var(--ax-text-hint)]">
                          {detecting ? "— 편집영역을 인식하는 중입니다…" : filledView ? "— 입력값을 채운 미리보기입니다(표·서식 보존)" : "— 【숫자】가 편집영역입니다. 표·서식은 보존하고 그 자리만 채웁니다"}
                        </span>
                        {hasFields && (
                          <div className="ml-auto inline-flex rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] p-0.5">
                            <button onClick={() => setPreviewMode("marker")} className={segBtn(previewMode === "marker")}>편집영역</button>
                            <button onClick={refreshFilledPreview} disabled={previewBusy} className={segBtn(previewMode === "filled")}>
                              {previewBusy ? "채우는 중…" : "입력값 반영"}
                            </button>
                          </div>
                        )}
                      </div>
                      {detecting && (
                        <div className="shrink-0 flex items-center gap-1.5 rounded-[var(--ax-radius-sm)] bg-[var(--ax-accent-bg)] px-2.5 py-1.5 text-[11px] text-[var(--ax-accent-dark)]" role="status" aria-live="polite">
                          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[var(--ax-accent-dark)] border-t-transparent" />
                          편집영역을 파악하는 중입니다 — 잠시 후 【숫자】 표시와 필드 목록이 나타납니다.
                        </div>
                      )}
                      {hasFields && (
                        <div className="shrink-0 flex flex-wrap gap-1">
                          {fmFields.map((f, i) => {
                            const v = String(f.value ?? "").trim();
                            const noAuto = f.fillable === false;
                            return (
                              <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${noAuto ? "border-dashed border-[var(--ax-border)] bg-[var(--ax-border-soft)]" : "border-[var(--ax-border)] bg-[var(--ax-card)]"}`} title={f.label}>
                                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${noAuto ? "bg-[var(--ax-text-hint)]" : "bg-[var(--ax-accent)]"}`}>{f.n ?? i + 1}</span>
                                <span className="font-medium text-[var(--ax-text)]">{f.role || f.label}</span>
                                {noAuto ? <span className="text-[var(--ax-warning)]">✎ 직접 입력</span> : filledView && v ? <span className="max-w-28 truncate text-[var(--ax-accent-dark)]">{v}</span> : <span className="text-[var(--ax-text-hint)]">최대 {f.max ?? 200}자</span>}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {stale && (
                        <button onClick={refreshFilledPreview} disabled={previewBusy} className="shrink-0 self-start rounded-[var(--ax-radius-sm)] bg-[var(--ax-warning-bg,#fffbeb)] px-2 py-1 text-[11px] font-medium text-[var(--ax-warning)]">
                          ⚠ 값이 바뀌었습니다 — 다시 반영하려면 클릭
                        </button>
                      )}
                      {previewErr && <span className="shrink-0 text-[11px] text-[var(--ax-danger)]">{previewErr}</span>}
                      <HwpxPreview bytes={bytes} className="min-h-0 flex-1" />
                    </div>
                  );
                })()
              ) : (
                <StatusBox kind="empty">hwpx 양식을 첨부하면 여기에 양식 미리보기가 표시됩니다.</StatusBox>
              )
            ) : (
              (() => {
                const total = STANDARD_PAGES[format] ?? 0;
                if (total === 0) return <StatusBox kind="empty">이 양식은 표준양식 미리보기 이미지가 없습니다. 생성 시 표준 양식이 자동 적용됩니다.</StatusBox>;
                const page = Math.min(formPage, total - 1);
                const navBtn = "flex h-7 w-7 items-center justify-center rounded-full border border-[var(--ax-border)] text-[var(--ax-text-muted)] enabled:hover:bg-[var(--ax-border-soft)] disabled:opacity-30";
                return (
                  <div className="flex h-full flex-col items-center gap-2 rounded-[var(--ax-radius-sm)]" style={{ background: "var(--ax-page)" }}>
                    {total > 1 && (
                      <div className="flex shrink-0 items-center gap-3 pt-1.5 text-sm">
                        <button onClick={() => setFormPage(Math.max(0, page - 1))} disabled={page <= 0} className={navBtn} aria-label="이전 쪽">‹</button>
                        <span className="tabular-nums text-[var(--ax-text-muted)]">{page + 1} / {total}</span>
                        <button onClick={() => setFormPage(Math.min(total - 1, page + 1))} disabled={page >= total - 1} className={navBtn} aria-label="다음 쪽">›</button>
                      </div>
                    )}
                    <div className="flex min-h-0 w-full flex-1 items-center justify-center px-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/doc-standards/${format}-${page + 1}.png`}
                        alt={`${DOC_FORMAT_INFO[format].label} 표준양식 ${page + 1}쪽`}
                        className="max-h-full w-auto max-w-full rounded-[2px] border border-[var(--ax-border)] bg-white shadow-sm"
                      />
                    </div>
                    <p className="shrink-0 pb-1.5 text-[11px] text-[var(--ax-text-hint)]">표준양식 미리보기 · 실제 한컴오피스 렌더 이미지{total > 1 ? ` (총 ${total}쪽)` : ""}</p>
                  </div>
                );
              })()
            ))}

          {tab === "files" &&
            (parsing ? (
              <StatusBox kind="loading">첨부 내용 분석 중…</StatusBox>
            ) : parsed.length === 0 ? (
              <StatusBox kind="empty">{isCustom ? "참고자료(pdf·docx·txt·hwpx 등)를 첨부하면 본문 작성에 활용됩니다 (선택). 양식 미리보기는 ‘표준양식’ 탭에서." : useChat ? "대화 모드에서는 채팅창에서 파일·이미지를 첨부합니다." : "첨부한 참고자료의 추출 내용이 여기 표시됩니다."}</StatusBox>
            ) : (
              <div className="flex flex-col gap-2.5">
                {parsed.map((p, i) => (
                  <div key={i}>
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <span className="font-medium text-[var(--ax-text)]">{p.name}</span>
                      {p.ok ? (
                        <span className="text-[var(--ax-success)]">
                          ✓ {p.chars.toLocaleString()}자{p.method === "ocr" ? <span className="text-[var(--ax-text-hint)]"> · OCR 인식{p.note ? `(${p.note.replace(/^스캔 PDF — /, "")})` : ""}</span> : null}
                        </span>
                      ) : p.needsOcr ? (
                        <span className="flex items-center gap-2 text-[#b45309]">
                          🖼 스캔 이미지 PDF
                          <button
                            onClick={() => void reparseWithOcr(p.name)}
                            disabled={ocrBusy === p.name}
                            className="rounded border border-[var(--ax-accent)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--ax-accent)] hover:bg-[var(--ax-accent-bg)] disabled:opacity-50"
                          >
                            {ocrBusy === p.name ? "OCR 인식 중…(수 분 소요)" : "OCR로 읽기 (앞 40쪽)"}
                          </button>
                        </span>
                      ) : (
                        <span className="text-[var(--ax-danger)]">✗ 분석 실패{p.error ? ` — ${p.error}` : ""}</span>
                      )}
                    </div>
                    {p.ok && (
                      <div className="ax-doc-preview max-h-[60vh] overflow-y-auto rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-[var(--ax-page)] p-3 text-xs leading-relaxed text-[var(--ax-text-muted)]">
                        <LlmMarkdown compact>{(p.markdown || p.preview) + (p.truncated ? "\n\n…(이하 생략)" : "")}</LlmMarkdown>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}

          {tab === "content" &&
            (genLoading ? (
              <div className="rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3.5">
                <div className="mb-2.5 text-sm font-medium text-[var(--ax-text)]">구조 생성 중…</div>
                <div className="flex flex-col gap-2">
                  {steps.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-[var(--ax-text-muted)]">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--ax-accent)] border-t-transparent" />
                      AI가 내용을 정리하는 중…
                    </div>
                  )}
                  {steps.map((s) => (
                    <div key={s.stage} className="flex items-center justify-between text-sm">
                      <span className={`flex items-center gap-2 ${s.status === "done" ? "text-[var(--ax-text)]" : "text-[var(--ax-text-muted)]"}`}>
                        {s.status === "done" ? <span className="text-[var(--ax-success)]">✓</span> : <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--ax-accent)] border-t-transparent" />}
                        {s.label}
                      </span>
                      <span className="text-xs text-[var(--ax-text-muted)]">{s.ms != null ? formatLlmMs(s.ms) : "…"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : !structure ? (
              <StatusBox kind="empty">
                {isCustom
                  ? "임의 양식은 구조 검토 없이 바로 생성됩니다."
                  : "‘구조 생성’을 누르면 AI가 정리한 구조가 여기 표시됩니다. 검토·수정 후 생성하세요."}
              </StatusBox>
            ) : (
              <div className="flex h-full flex-col gap-2.5">
                {/* 위계형 / JSON 토글 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] p-0.5 text-xs">
                    <button onClick={() => setContentView("tree")} className={`rounded-md px-2.5 py-1 transition ${contentView === "tree" ? "bg-[var(--ax-accent-soft)] font-medium text-[var(--ax-accent)]" : "text-[var(--ax-text-muted)]"}`}>
                      {isStructEditable(format) ? "위계형 편집" : "위계형"}
                    </button>
                    <button onClick={showJsonView} className={`rounded-md px-2.5 py-1 transition ${contentView === "json" ? "bg-[var(--ax-accent-soft)] font-medium text-[var(--ax-accent)]" : "text-[var(--ax-text-muted)]"}`}>JSON</button>
                  </div>
                  {contentView === "json" && jsonError && (
                    <span className="text-xs text-[var(--ax-danger)]">JSON 형식 오류 — 수정 중</span>
                  )}
                </div>
                {/* 에디터 */}
                <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                  {contentView === "json" ? (
                    <TextArea
                      value={jsonDraft}
                      onChange={(e) => onJsonEdit(e.target.value)}
                      spellCheck={false}
                      className="h-full min-h-[360px] font-mono text-[11px] leading-relaxed"
                    />
                  ) : isCustom && structure?.__form ? (
                    <FormFieldsEditor value={structure} onChange={setStructure} />
                  ) : isStructEditable(format) ? (
                    <StructureEditor format={format} value={structure} onChange={setStructure} />
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-[var(--ax-radius-sm)] bg-[var(--ax-page)] p-3 text-xs leading-relaxed text-[var(--ax-text-muted)]">
                      {structurePreview}
                    </pre>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={buildFinal} loading={buildLoading} disabled={jsonError} icon="✅">이대로 생성 확정</Button>
                  {isCustom && structure?.__form ? (
                    <Button variant="outline" onClick={() => { setTab("form"); void refreshFilledPreview(); }} loading={previewBusy} disabled={buildLoading} icon="👁">값 채워 미리보기</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => { setRefineErr(""); setRefineOpen(true); }} disabled={buildLoading || jsonError} icon="✨">AI로 수정</Button>
                  )}
                  {buildLoading && <Button variant="ghost" onClick={cancelGen}>중단</Button>}
                  {jsonError && <span className="text-xs text-[var(--ax-text-hint)]">JSON 오류를 고치면 생성됩니다.</span>}
                  {buildError && <span className="text-xs text-[var(--ax-danger)]">{buildError}</span>}
                </div>
              </div>
            ))}

          {tab === "final" &&
            (buildLoading ? (
              <StatusBox kind="loading">HWPX 생성 중…</StatusBox>
            ) : !final ? (
              <StatusBox kind="empty">생성 확정하면 최종 문서가 여기 표시됩니다.</StatusBox>
            ) : (
              <div className="flex h-full flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Label>{isEmail ? "최종 본문" : "최종 HWPX"}</Label>
                    {final.bytes && (
                      <div className="inline-flex rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] p-0.5 text-xs">
                        <button onClick={() => setFinalView("rhwp")} className={`rounded-md px-2.5 py-1 transition ${finalView === "rhwp" ? "bg-[var(--ax-accent-soft)] font-medium text-[var(--ax-accent)]" : "text-[var(--ax-text-muted)]"}`}>근사(rhwp)</button>
                        <button onClick={() => setFinalView("html")} className={`rounded-md px-2.5 py-1 transition ${finalView === "html" ? "bg-[var(--ax-accent-soft)] font-medium text-[var(--ax-accent)]" : "text-[var(--ax-text-muted)]"}`}>내용(HTML)</button>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {final.bytes && (
                      <Button size="sm" variant="outline" icon="⬇" onClick={download}>다운로드</Button>
                    )}
                    {(isEmail || final.text) && (
                      <Button size="sm" variant="ghost" onClick={copyText}>{copied ? "복사됨 ✓" : "본문 복사"}</Button>
                    )}
                  </div>
                </div>
                {final.bytes && (
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-[var(--ax-text-muted)]">파일명</span>
                    <input
                      value={finalName}
                      onChange={(e) => setFinalName(e.target.value)}
                      onBlur={() => setFinalName((n) => n.trim() || final.filename || "문서.hwpx")}
                      spellCheck={false}
                      placeholder="파일명 (.hwpx)"
                      className="min-w-0 flex-1 rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-[var(--ax-card)] px-2.5 py-1 text-xs text-[var(--ax-text)] outline-none transition focus:border-[var(--ax-accent)]"
                    />
                  </div>
                )}
                {!final.bytes ? (
                  <pre className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-[var(--ax-radius-sm)] bg-[var(--ax-page)] p-3 text-sm leading-relaxed text-[var(--ax-text)]">
                    {final.text ?? final.preview}
                  </pre>
                ) : finalView === "rhwp" ? (
                  <HwpxPreview bytes={final.bytes} tall={format === "press"} className="min-h-0 flex-1" />
                ) : (
                  <div className="mx-auto w-full max-w-[640px] rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-white p-6">
                    <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--ax-text)]">{final.preview}</pre>
                  </div>
                )}
                <FeedbackBar
                  payload={{ panel: "docs", question: `[${format}] ${instruction}`.slice(0, 2000), answer: (final.text ?? final.preview ?? "").slice(0, 8000) }}
                  resetKey={finalName || final.filename || undefined}
                />
              </div>
            ))}
        </div>
      </Card>

      {refineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !refineBusy && setRefineOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-[var(--ax-text)]"><span>✨</span>AI로 작성 컨텐츠 수정</div>
            <p className="mb-2 text-xs text-[var(--ax-text-muted)]">수정 방향을 자연어로 지시하면 AI가 현재 내용을 고쳐줍니다(양식 구조는 유지). 예: “전체를 더 간결하게”, “배경에 추진 근거 한 문단 추가”, “수치를 표로 정리”.</p>
            <textarea value={refineText} onChange={(e) => setRefineText(e.target.value)} rows={4} autoFocus
              placeholder="어떻게 고칠지 지시해 주세요"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void applyRefine(); }}
              className="w-full resize-y rounded-lg border border-[var(--ax-border)] bg-[var(--ax-page)] px-3 py-2 text-sm outline-none focus:border-[var(--ax-accent)] focus:bg-white" />
            {refineErr && <p className="mt-1.5 text-xs text-[var(--ax-danger)]">{refineErr}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setRefineOpen(false)} disabled={refineBusy} className="rounded-lg border border-[var(--ax-border)] px-3 py-1.5 text-sm text-[var(--ax-text-muted)] disabled:opacity-50">취소</button>
              <Button onClick={applyRefine} loading={refineBusy} disabled={!refineText.trim()} icon="✨">수정 적용</Button>
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
