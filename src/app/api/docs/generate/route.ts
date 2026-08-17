import { NextResponse } from "next/server";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { guardedChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import { scoreInjection, INJECTION_BLOCK_THRESHOLD } from "@/lib/guardrails/input/injection";
import {
  DOC_FORMAT_INFO,
  buildDocPrompt,
  extractJson,
  isDocFormat,
  parseDocJson,
  repairDoc,
  buildValues1p,
  buildValuesGongmun,
  buildValuesFull,
  buildCustomEditPrompt,
  buildCustomClassifyPrompt,
  buildCustomWritePrompt,
  buildFormFillPrompt,
  renderEmailText,
  renderPreview,
  type Doc1p,
  type DocData,
  type DocEmail,
  type DocFormat,
  type DocFull,
  type DocGongmun,
} from "@/lib/docs-generate";
import { parseAttachment, toPlainText } from "@/lib/docparse";
import { openHwpxEditSession, catalogFor } from "@/lib/hwpx-edit-plan";
import { cellCapsByLabel } from "@/lib/hwpx-cell-caps";
import { indexAttachment, getAttachments, excerptAttachment, ATT_MAX_CHARS } from "@/lib/chat-attachments";
import { getEmbedding } from "@/lib/embedding";
import { queryTermsFromQuestion } from "@/lib/regulations-rag";
import { extractRegulationFile, isLikelyScannedPdf } from "@/lib/regulations-extract";
import { recordUsage } from "@/lib/usage";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { resolvePythonBin } from "@/lib/pythonBin";
import { execFileLimited as pExecFile } from "@/lib/subprocess";

export const dynamic = "force-dynamic";

const SCRIPTS_DIR = path.join(process.cwd(), "tools", "hwpx", "scripts");
const TPL_DIR = path.join(process.cwd(), "tools", "hwpx", "templates");
const KORDOC_CLI = path.join(process.cwd(), "node_modules", "kordoc", "dist", "cli.js");
const PYTHON_BIN = resolvePythonBin();
const PY_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
const PY_TIMEOUT_MS = 60_000; // hwpx 변환 타임아웃(명세 60s)

const FLOW_VERSION = "custom-form-v5"; // 하니스 스테일 카나리아 — 플로우 수정 시 갱신 // 하니스 스테일 카나리아 — 코드 수정 시 갱신
const MAX_FILES = 3;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 참고자료 파싱(docs/parse)·사이드챗 첨부와 동일 한도
const MAX_CHARS_PER_FILE = 8_000;

/** 업로드 컨텍스트 파일 → 텍스트(kordoc 파싱: hwp/hwpx/pdf/docx/xlsx, txt/md 직접).
 *  allowOcr: 참고자료 단계에서 사용자가 'OCR로 읽기'에 동의한 경우 — 스캔 PDF를 사규 적재와 동일 OCR로 승격. */
async function extractFileText(file: File, dir: string, allowOcr = false, maxChars = MAX_CHARS_PER_FILE): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new DocsError(400, `파일이 너무 큽니다(${file.name}) — 파일당 20MB 이내.`);
  }
  const safe = path.basename(file.name).replace(/[^\w.\-가-힣]/g, "_");
  const tmpPath = path.join(dir, `ctx_${safe}`);
  await writeFile(tmpPath, Buffer.from(await file.arrayBuffer()));
  const ext = path.extname(file.name).toLowerCase();
  if (allowOcr && ext === ".pdf") {
    const ex = await extractRegulationFile(tmpPath, file.name, { ocrMaxPages: 40, allowOcr: true });
    if (!ex.chars) throw new DocsError(400, `'${file.name}' 내용을 읽지 못했습니다(OCR 실패).`);
    return toPlainText(ex.text).slice(0, maxChars);
  }
  const parsed = await parseAttachment(tmpPath, file.name);
  if (!parsed.ok) {
    throw new DocsError(400, `'${file.name}' 내용을 읽지 못했습니다: ${parsed.error ?? "알 수 없는 오류"}`);
  }
  const plain = toPlainText(parsed.markdown);
  if (isLikelyScannedPdf(ext, plain)) {
    throw new DocsError(400, `'${file.name}'은 스캔 이미지 PDF입니다 — 참고자료 탭에서 'OCR로 읽기'를 먼저 실행해 주세요.`);
  }
  return plain.slice(0, maxChars);
}

class DocsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** python 빌더 stdout(JSON) 파싱 — status ok 확인. */
function parseBuilderResult(stdout: string): { status?: string; stage?: string; stderr?: string } {
  const s = stdout.indexOf("{");
  const e = stdout.lastIndexOf("}");
  if (s < 0 || e <= s) return { status: "error", stderr: stdout.slice(0, 300) };
  try {
    return JSON.parse(stdout.slice(s, e + 1));
  } catch {
    return { status: "error", stderr: stdout.slice(0, 300) };
  }
}

/** guardedChat → JSON 추출·zod 검증. 형식 오류 시 1회 재시도(명세). */
// ── 2단계 콘텐츠 파이프라인 (경량 모델 분할 정복) ───────────────────
// stage1: 첨부·지시를 '양식 무관' 구조화 마크다운으로 정리(무슨 내용을 담을지)
// stage2: 정리된 내용을 '양식에 맞춰' 스키마 JSON으로 재구성(어떻게 담을지)
// (Phase C에서 stage2 system 에 양식별 글쓰기 요령 references 를 주입한다.)

const STAGE1_ORGANIZE_SYSTEM = `당신은 공공기관 보고서 작성을 돕는 내용 정리 도우미입니다.
사용자의 [작업 지시]와 [첨부 자료]를 분석해, 보고서에 담을 핵심 내용을 구조화된 마크다운으로 정리하세요.

[원칙]
- 양식·분량·서식은 신경 쓰지 말고 '무슨 내용을 담을지'만 정리합니다.
- 제목 후보, 배경/목적, 현황/문제, 주요 항목, 수치·일정·근거를 계층 헤딩(#, ##, -)으로 구조화.
- 첨부 자료의 사실·수치를 빠짐없이 반영합니다.
- 지시가 구체적이면 그 범위에 맞는 내용을 우선 정리합니다.
- 지시가 짧거나 모호하면(예: "테스트", "작성", "정리해줘") 첨부 자료 자체를 보고서 주제로 삼아 핵심을 정리합니다. 절대 "내용 없음"으로 비우지 마세요.
- 보고서로 만들 수 있도록 최소 2~3개의 소주제(예: 개요/현황/주요내용/시사점)로 나눌 만큼 충분히 정리합니다.
- 추측·과장 없이 자료에 근거합니다. 마크다운 외 설명·머리말 없이 정리된 내용만 출력.`;

/** stage1: 첨부·지시 → 양식 무관 구조화 마크다운(내용 정리). */
async function organizeContent(
  instruction: string,
  context: string,
  ctx: Awaited<ReturnType<typeof buildGuardContext>>,
): Promise<string> {
  const user = `[작업 지시]\n${instruction}\n\n[첨부 자료]\n${context || "(없음)"}`;
  const md = await guardedChat({
    messages: [{ role: "user", content: user }],
    ctx,
    system: STAGE1_ORGANIZE_SYSTEM,
    maxTokens: 2500,
    temperature: 0.3,
    guardInput: `${instruction}\n${context}`, // 전문 가드검사·감사(타 패널과 동일 — 과거 slice(0,1500)은 검사 우회 유발이라 제거)
  });
  return md.replace(/```\w*\n?/g, "").trim();
}

/** zod/JSON 오류를 모델 재시도용 한국어 힌트로 요약(스키마 위반을 사람이 읽을 수 있게). */
function schemaErrorHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    const issues = JSON.parse(msg) as Array<{ path?: (string | number)[]; code?: string; minimum?: number }>;
    if (Array.isArray(issues) && issues.length) {
      return issues
        .slice(0, 4)
        .map((i) => {
          const field = (i.path ?? []).join(".") || "최상위";
          if (i.code === "too_small") return `${field}: 항목 부족(최소 ${i.minimum ?? "n"}개 필요)`;
          if (i.code === "too_big") return `${field}: 항목 과다`;
          if (i.code === "invalid_type") return `${field}: 값이 비었거나 형식 오류`;
          return `${field}: 형식 오류`;
        })
        .join("; ");
    }
  } catch {
    /* zod issues JSON 아님 — 일반 메시지 */
  }
  return msg.slice(0, 120);
}

/** stage2: 정리된 내용 → 양식 스키마 JSON(양식 맞춤). references 주입은 Phase C. */
async function formatToSchema(
  format: DocFormat,
  organizedMd: string,
  ctx: Awaited<ReturnType<typeof buildGuardContext>>,
): Promise<DocData> {
  // 대표자·기관명은 기관 고유값 — 관리자 설정에서 주입(미설정이면 ○○○/○○기관 으로 표기).
  const cfg = await getPlaygroundConfig().catch(() => null);
  const system = buildDocPrompt(format, cfg?.ceoName, cfg?.orgName);
  const baseUser = `[정리된 내용 — 아래 내용을 이 양식에 맞게 재구성해 작성]\n${organizedMd}`;
  let lastErr: unknown = null;
  let lastObj: unknown = null; // 마지막으로 추출에 성공한(검증은 실패한) 객체 — 안전망 보강용
  let hint = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? baseUser
        : `${baseUser}\n\n[재작성 — 직전 출력이 양식 스키마에 맞지 않았습니다: ${hint}]\n위 '정리된 내용'을 활용해 빈 항목을 채우고, 내용이 부족하면 더 세분해 스키마의 최소 개수를 반드시 충족하세요. 다른 텍스트 없이 JSON 객체 하나만 출력.`;
    const raw = await guardedChat({
      messages: [{ role: "user", content: user }],
      ctx,
      system,
      maxTokens: 3500,
      temperature: attempt === 0 ? 0.3 : 0.4,
      guardInput: organizedMd, // 전문 가드검사·감사(과거 slice(0,1500) 제거)
    });
    let obj: unknown;
    try {
      obj = extractJson(raw);
    } catch (e) {
      lastErr = e;
      hint = "JSON 객체를 찾지 못함 — 다른 텍스트 없이 JSON만 출력";
      continue;
    }
    lastObj = obj;
    try {
      return parseDocJson(format, obj);
    } catch (e) {
      lastErr = e;
      hint = schemaErrorHint(e);
    }
  }
  // 안전망: best-effort 출력(없으면 {})을 정리 내용(organizedMd) 기반으로 보강해 한 번 더 검증.
  try {
    return parseDocJson(format, repairDoc(format, lastObj ?? {}, organizedMd, cfg?.orgName));
  } catch (e) {
    console.error(`[docs] repair 후에도 검증 실패(${format}): ${e instanceof Error ? e.message : String(e)}`);
  }
  console.error(`[docs] formatToSchema 실패(${format}): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  throw new DocsError(
    422,
    "AI가 내용을 양식 구조로 충분히 정리하지 못했습니다. 지시를 조금 더 구체적으로 적거나, 참고 자료를 첨부해 다시 시도해 주세요.",
  );
}

/** stage1(정리) → stage2(양식 맞춤) 2단계 파이프라인. send로 단계 진행 통지(선택). */
async function generateDocData(
  format: DocFormat,
  instruction: string,
  context: string,
  ctx: Awaited<ReturnType<typeof buildGuardContext>>,
  send?: (ev: Record<string, unknown>) => void,
): Promise<DocData> {
  send?.({ stage: "organize", status: "start", label: "내용 정리" });
  let t = Date.now();
  const organized = await organizeContent(instruction, context, ctx);
  send?.({ stage: "organize", status: "done", ms: Date.now() - t });
  send?.({ stage: "format", status: "start", label: "양식 맞춤" });
  t = Date.now();
  const data = await formatToSchema(format, organized, ctx);
  send?.({ stage: "format", status: "done", ms: Date.now() - t });
  return data;
}

/**
 * 임의 양식 — 서식(폼) 분기: 신청서·서식처럼 빈 라벨-값 필드가 있는 양식.
 * LLM이 [내용]에서 각 필드 값을 매핑 → kordoc fill 로 채운다(라벨·표·서식 보존).
 */
// AI가 낸 {라벨:값} JSON을 양식 라벨에 매칭(괄호·공백·콜론 표기 차이 허용), 빈 값 제외.
/**
 * 필드의 최대 입력 글자수 추정 — 역할/라벨 의미로 판정(포맷 무관).
 * 서술형(사유·내용·실적 등)은 길게, 식별값(성명·날짜·번호 등)은 짧게.
 * 셀 넘침(오버플로우) 방지 + LLM 작성 가이드 + 수동입력 하드캡의 근거값.
 * (hwpx cellSz 정밀 산정은 후속 정밀화 여지)
 */
function fieldMaxLen(text: string): number {
  const s = String(text).replace(/\s+/g, "");
  if (/(사유|내용|실적|성과|개요|배경|비고|특이|의견|방법|계획|설명|현황|경위|요약|목적|기대|활용|추진|세부)/.test(s)) return 200;
  if (/(성명|이름|날짜|일자|일시|번호|전화|연락처|휴대|팩스|금액|구분|성별|나이|직번|우편)/.test(s)) return 20;
  if (/(소속|부서|기관|주소|직책|직위|직급|과제명|제목|사업명|업체|담당)/.test(s)) return 40;
  return 60;
}

/** 최종 상한 = 역할 휴리스틱 ∧ 셀 실측 용량(cellSz) — 실측이 있으면 더 작은 쪽(셀 넘침 방지),
 *  다만 바닥 10자(실측 오차로 입력 자체가 막히지 않게). 실측 없으면 휴리스틱 그대로. */
function capMax(cellCap: number | undefined, heuristic: number): number {
  return cellCap ? Math.min(heuristic, Math.max(10, cellCap)) : heuristic;
}

function matchFormValues(raw: string, labels: string[]): Record<string, string> {
  const norm = (s: string) => s.replace(/[\s()（）「」『』:：·.]/g, "");
  const byNorm = new Map(labels.map((l) => [norm(l), l]));
  const values: Record<string, string> = {};
  try {
    const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
    const obj = JSON.parse(raw.slice(a, z + 1)) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const val = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
      if (!val) continue;
      const label = labels.includes(k) ? k : byNorm.get(norm(k));
      if (label) values[label] = val;
    }
  } catch {
    /* 파싱 실패 → 빈 객체 */
  }
  return values;
}

/** 산출물 버퍼의 매직바이트로 실제 포맷 확장자를 정한다(D0CF=hwp CFB, 그 외 PK 등=hwpx zip).
 *  kordoc fill은 .hwp 입력도 hwpx로 변환 출력하고 patch는 원본 포맷을 보존하므로, '입력 확장자'가
 *  아니라 '실제 산출물' 기준으로 이름 붙여야 다운로드 파일이 항상 열린다(확장자·내용 불일치 방지). */
function docExt(buf: Buffer): "hwp" | "hwpx" {
  return buf.length >= 2 && buf[0] === 0xd0 && buf[1] === 0xcf ? "hwp" : "hwpx";
}

async function fillCustomForm(
  req: Request,
  dir: string,
  formPath: string,
  formFile: File,
  fields: { label: string; value?: string }[],
  instruction: string,
  conversation: string,
  ctxText: string,
  isHwp: boolean,
  stage: string,
  reviewedData: unknown,
  cellCaps: Map<string, number> = new Map(),
): Promise<NextResponse> {
  const labels = [...new Set(fields.map((f) => f.label))]; // 중복 라벨(예: 수신자 ×2) 제거

  const maxByLabel = new Map(labels.map((l) => [l, capMax(cellCaps.get(l), fieldMaxLen(l))]));

  // ── 검토 단계: AI가 각 필드 값을 제안 → '작성 컨텐츠'에서 검토·수정하도록 반환(채우지 않음). ──
  // (build=최종 채우기, preview=검토값 라이브 미리보기 — 둘 다 아래 '채우기'로 진행)
  if (stage !== "build" && stage !== "preview") {
    const ctx = await buildGuardContext(req, "docs");
    // 값-찾기 소스: 작성 지시 + AI 대화 + 첨부 참고자료. 출처를 구분해 넣어 모델이 각 필드 값을 찾게 한다.
    const contentText =
      [
        instruction.trim() ? `[작성 지시]\n${instruction.trim()}` : "",
        conversation.trim() ? `[AI 대화 내용]\n${conversation.trim()}` : "",
        ctxText.trim() ? `[첨부 참고자료]\n${ctxText.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n\n") || "(제공된 내용 없음)";

    // 필드 명세를 JSON으로 제시하고, 번호를 키로 한 JSON으로 값을 돌려받는다(입·출력 구조화).
    const spec = labels.map((l, i) => ({ 번호: i + 1, 항목: l, 최대글자: maxByLabel.get(l) ?? 60 }));
    const askJson = (list: typeof spec) =>
      `[양식 필드 명세(JSON)]\n${JSON.stringify(list)}\n\n[내용]\n${contentText}\n\n` +
      `위 [내용]에서 각 필드 값을 찾아 번호를 키로 한 JSON만 출력하라: {"1":"값","2":"값", ...}\n` +
      `- 각 값은 해당 필드의 '최대글자'를 절대 넘기지 말 것(넘칠 내용은 핵심만 간결히 요약).\n` +
      `- [내용]에서 근거를 찾을 수 없는 필드는 비워 둘 것(지어내지 말 것).`;

    const runFill = async (list: typeof spec, maxTokens: number): Promise<Record<string, string>> => {
      const raw = await guardedChat({
        messages: [{ role: "user", content: askJson(list) }],
        ctx, system: buildFormFillPrompt(), maxTokens, temperature: 0.2, guardInput: instruction,
      });
      const out: Record<string, string> = {};
      try {
        const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
        const obj = JSON.parse(raw.slice(a, z + 1)) as Record<string, unknown>;
        for (const it of list) {
          const v = obj[String(it.번호)];
          const val = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
          if (val) out[it.항목] = val.slice(0, it.최대글자); // maxLen 하드캡
        }
      } catch { /* n-키 파싱 실패 → 아래 라벨-키 폴백 */ }
      if (Object.keys(out).length === 0) {
        const byLabel = matchFormValues(raw, list.map((it) => it.항목)); // 소형 모델이 라벨-키로 낸 경우 폴백
        for (const it of list) { const v = byLabel[it.항목]; if (v) out[it.항목] = v.slice(0, it.최대글자); }
      }
      return out;
    };

    let proposed: Record<string, string> = {};
    try {
      proposed = await runFill(spec, 2500);
    } catch (e) {
      if (isGuardBlockedError(e)) return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    }
    // 2패스: 경량모델이 필드가 많으면 일부만 채우고 그침 — 빈 필드만 다시 물어 집중도를 높인다.
    const missing = spec.filter((s) => !String(proposed[s.항목] ?? "").trim());
    if (missing.length && missing.length < spec.length) {
      try { Object.assign(proposed, await runFill(missing, 1800)); } catch { /* 2패스 실패 → 1차만 사용 */ }
    }
    return NextResponse.json(
      {
        ok: true,
        format: "custom",
        data: { __form: true, formName: formFile.name, fields: labels.map((l) => ({ label: l, max: maxByLabel.get(l), value: proposed[l] ?? "" })) },
        flowVersion: FLOW_VERSION,
        preview: `서식 필드 ${labels.length}개를 감지했습니다. 각 칸에 채울 값을 검토·수정한 뒤 ‘이대로 생성 확정’을 누르세요.`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── 생성 단계: '작성 컨텐츠'에서 검토·수정된 값으로 채우기. ──
  const labelSet = new Set(labels);
  const revFields = reviewedData && Array.isArray((reviewedData as { fields?: unknown }).fields)
    ? (reviewedData as { fields: { label?: string; value?: string }[] }).fields
    : [];
  const values: Record<string, string> = {};
  for (const f of revFields) {
    const v = String(f?.value ?? "").trim();
    if (f?.label && labelSet.has(f.label) && v) {
      // 셀 넘침 방지 — 프런트 maxLength와 별개로 서버에서도 최대글자를 강제(변조 요청 대비).
      const cap = typeof (f as { max?: number }).max === "number" && (f as { max: number }).max > 0 ? (f as { max: number }).max : (maxByLabel.get(f.label) ?? 60);
      values[f.label] = v.slice(0, cap);
    }
  }
  const isPreview = stage === "preview";
  if (!Object.keys(values).length && !isPreview) {
    return NextResponse.json({ error: "채울 값이 없습니다. ‘작성 컨텐츠’에서 필드 값을 입력해 주세요." }, { status: 422 });
  }
  const valsPath = path.join(dir, "vals.json");
  await writeFile(valsPath, JSON.stringify(values), "utf-8");
  const outPath = path.join(dir, isHwp ? "out.hwp" : "out.hwpx");
  let out: Buffer;
  try {
    // kordoc fill 은 결과 hwpx/hwp 를 stdout 으로 출력(-o 미지원) → Buffer 로 캡처.
    const r = (await pExecFile(process.execPath, [KORDOC_CLI, "fill", formPath, "-j", valsPath, "--silent"], {
      timeout: PY_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "buffer",
    })) as unknown as { stdout: Buffer };
    out = r.stdout;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `양식 채우기에 실패했습니다: ${msg.slice(0, 160)}` }, { status: 502 });
  }
  // 출력은 hwpx(zip, PK) 또는 hwp(CFB, D0CF). 매직바이트로 1차 검증.
  if (!out || out.length < 200 || !((out[0] === 0x50 && out[1] === 0x4b) || (out[0] === 0xd0 && out[1] === 0xcf))) {
    return NextResponse.json({ error: "양식 채우기 결과가 유효하지 않습니다." }, { status: 502 });
  }
  await writeFile(outPath, out);
  // 라이브 미리보기(preview): 채운 결과를 렌더용 bytes로만 반환(다운로드·사용집계 없음).
  if (isPreview) {
    return NextResponse.json(
      { ok: true, format: "custom", previewBase64: out.toString("base64"), filled: Object.keys(values).length },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  recordUsage("docs", "generate");
  const base = formFile.name.replace(/\.[^.]+$/, "");
  const ext = docExt(out); // 실제 산출물 기준(.hwp 입력이어도 fill은 hwpx를 냄 → .hwpx로 명명)
  return NextResponse.json(
    {
      ok: true,
      format: "custom",
      filename: `${base}_작성.${ext}`,
      fileBase64: out.toString("base64"),
      preview:
        `양식의 빈 필드 ${Object.keys(values).length}개를 채웠습니다(표·서식 보존).${piiPlaceholderNote(Object.values(values))} ` +
        (isHwp && ext === "hwpx" ? "원본이 .hwp였지만 편집 결과는 .hwpx로 저장됩니다(한컴 2014 이상에서 열림). " : "") +
        "다운로드해 한컴에서 확인하세요.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 참고자료 컨텍스트 조립 — 총 12k 예산. 초과 시 파일별로 임시 인덱싱(TTL 24h) 후
 *  지시(instruction) 관련 발췌만 채운다(첨부 3계층 인프라 재사용 — 30만자 자료도 유효 활용). */
const REF_BUDGET_TOTAL = 12_000;
async function buildRefContext(parts: { name: string; text: string }[], instruction: string): Promise<string> {
  if (!parts.length) return "";
  const whole = parts.map((p) => `<<${p.name}>>\n${p.text}`).join("\n\n");
  if (whole.length <= REF_BUDGET_TOTAL) return whole;

  const per = Math.max(3_000, Math.floor(REF_BUDGET_TOTAL / parts.length));
  const terms = queryTermsFromQuestion(instruction).filter((t) => t.length >= 2).slice(0, 12);
  let qvec: number[] | null = null;
  try { qvec = await getEmbedding(instruction.slice(0, 1000)); } catch { /* 임베딩 미가동 → 용어 매칭 폴백 */ }

  const out: string[] = [];
  for (const p of parts) {
    if (p.text.length <= per) { out.push(`<<${p.name}>>\n${p.text}`); continue; }
    try {
      const sum = await indexAttachment(`[양식참고] ${p.name}`, "docs-ref", p.text);
      const [att] = await getAttachments([sum.attId]);
      const ex = att ? excerptAttachment(att, { qvec, terms, budget: per }) : null;
      out.push(`<<${p.name} — 관련 부분 발췌>>\n${ex?.text || p.text.slice(0, per)}`);
    } catch {
      out.push(`<<${p.name}>>\n${p.text.slice(0, per)}`); // 인덱싱 실패(DB 등) → 앞부분 절사 폴백
    }
  }
  return out.join("\n\n").slice(0, REF_BUDGET_TOTAL + 2_000);
}

/** 개인정보 자리표시([PHONE]·[EMAIL] 등) 안내 — 보안 정책상 실값은 자동 기재하지 않는다. */
const PII_PLACEHOLDER_RE = /\[(PHONE|EMAIL|RRN|CARD|ACCOUNT|BIZNO|FRN)\]/g;
function piiPlaceholderNote(texts: string[]): string {
  const n = texts.reduce((a, t) => a + (t.match(PII_PLACEHOLDER_RE)?.length ?? 0), 0);
  return n ? ` 개인정보 ${n}곳은 보안 정책상 [PHONE]·[EMAIL] 같은 자리표시로 채워졌습니다 — 다운로드 후 해당 칸만 직접 입력해 주세요.` : "";
}

/** 편집계획 기반 생성 프롬프트 — 카탈로그에 있는 블록·셀만, JSON edits 하나로. */
function buildEditPlanPrompt(): string {
  return (
    "당신은 한글(HWPX) 양식 편집 도우미입니다. [편집 슬롯 카탈로그]의 슬롯(S1, S2…)에만 내용을 쓸 수 있습니다(그 외는 자동 차단). " +
    "[정리된 내용]을 각 슬롯의 용도에 맞게 배치해, 다른 텍스트 없이 JSON 객체 하나만 출력하세요. 키는 슬롯 ID, 값은 그 슬롯에 들어갈 텍스트입니다: " +
    '{"S1":"…","S3":"…"} ' +
    "규칙: ① 표 «라벨» 칸에는 그 라벨이 요구하는 값만 — «점검기간» 칸에는 기간, «점검자» 칸에는 사람. 라벨과 무관한 내용을 넣느니 그 슬롯은 생략 " +
    "② '안내/예시 지문 — 실제 내용으로 교체 필요' 표시 슬롯은 반드시 실제 내용으로 교체 " +
    "③ 해당할 내용이 [정리된 내용]에 없는 슬롯은 생략(지어내기 금지) ④ 원문 유지가 적절한 슬롯도 생략 " +
    "⑤ 카탈로그의 현재=\"…\"는 참고용일 뿐 — 현재값을 그대로 또는 일부만 복사해 내는 것은 무효 처리되니, 쓸 값이 없으면 그 슬롯을 생략 " +
    "⑥ 사용자의 지시가 특정 본문(예: 시행문 본문·개요·계획)의 작성이나 재작성을 요구하면, 해당 [본문] 슬롯을 [정리된 내용] 기반의 완결된 새 문장으로 작성(이때는 생략하지 말 것)."
  );
}

/**
 * HWPX 편집계획 플로우(P1+P3): capability 지도 → LLM edits(JSON) → 증분 패치.
 * 반영 0이거나 계획이 비면 null을 반환해 기존 마크다운 patch 플로우로 폴백한다.
 */
async function tryEditPlanFlow(
  req: Request, dir: string, formPath: string, formFile: File,
  instruction: string, conversation: string, ctxText: string,
): Promise<NextResponse | null> {
  let sess: Awaited<ReturnType<typeof openHwpxEditSession>>;
  try {
    sess = await openHwpxEditSession(new Uint8Array(await readFile(formPath)));
  } catch { return null; }
  if (!sess.plan.areas.length) return null;

  const ctx = await buildGuardContext(req, "docs");
  const bodyContext = [conversation.trim() ? `[AI 대화 내용]\n${conversation.trim()}` : "", ctxText]
    .filter((s) => s && s.trim()).join("\n\n");
  const organizedMd = await organizeContent(instruction, bodyContext, ctx);

  // 긴 양식: 슬롯을 배치로 나눠 생성(경량모델 컨텍스트·집중력 한계) — 값은 병합 후 한 번에 패치.
  // n회 증분 ≡ 일괄 패치 동등성(kordoc CI 보장)이라 배치 수와 무관하게 결과가 같다.
  const BATCH = 20; // 경량모델 JSON 안정 구간(30에서 첫 배치 파싱 실패 실측)
  const values: Record<string, string> = {};
  const askBatch = async (slots: typeof sess.plan.slots): Promise<void> => {
    let hint = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await guardedChat({
        messages: [{ role: "user", content: `[편집 슬롯 카탈로그 — 이 슬롯에만 쓸 수 있음]\n${catalogFor(slots)}\n\n[정리된 내용]\n${organizedMd}${hint}` }],
        ctx, system: buildEditPlanPrompt(), maxTokens: 4096, temperature: attempt ? 0.3 : 0.2, guardInput: instruction,
      });
      try {
        const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
        const j = JSON.parse(raw.slice(a, z + 1)) as Record<string, unknown>;
        const ok = new Set(slots.map((s) => s.id));
        for (const [k, v] of Object.entries(j)) {
          const id = k.trim().toUpperCase();
          if (ok.has(id) && typeof v === "string" && v.trim()) values[id] = v;
        }
        return;
      } catch {
        hint = `\n\n[재시도 — 직전 출력이 JSON이 아니었습니다. 다른 텍스트 없이 {"S번호":"값"} JSON 객체 하나만 출력하세요.]`;
      }
    }
  };
  try {
    for (let i = 0; i < sess.plan.slots.length; i += BATCH) {
      await askBatch(sess.plan.slots.slice(i, i + BATCH));
    }
    // 2차 패스: 채움이 기대되는 슬롯(빈칸·안내문)이 미반영으로 남으면 그 슬롯만 재질의 —
    // 경량모델이 긴 카탈로그에서 일부만 내고 그치는 비결정성 완충(폼 2패스에서 효과 검증된 패턴).
    const mustFill = sess.plan.slots.filter((sl) => (sl.placeholder || (sl.kind === "표셀" && !sl.text)) && !values[sl.id]);
    if (mustFill.length && Object.keys(values).length) {
      for (let i = 0; i < mustFill.length; i += BATCH) await askBatch(mustFill.slice(i, i + BATCH));
    }
  } catch (e) {
    if (isGuardBlockedError(e)) throw e; // 가드 차단은 상위 공통 처리로
    if (!Object.keys(values).length) return null; // 전체 실패 → 기존 플로우 폴백(부분 성공은 계속)
  }
  if (!Object.keys(values).length) return null;

  const r = await sess.applySlots(values);
  if (!r.applied) return null;

  // patch 산출물도 원본 lineseg 캐시가 남으면 한컴이 변조로 볼 수 있어 기존 플로우와 동일하게 제거.
  const outPath = path.join(dir, "out-plan.hwpx");
  await writeFile(outPath, Buffer.from(r.bytes));
  try {
    await pExecFile(PYTHON_BIN, [path.join(SCRIPTS_DIR, "strip_lineseg.py"), outPath], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8", env: PY_ENV });
  } catch { /* 캐시 제거 실패해도 결과 유지 */ }
  const buf = await readFile(outPath);

  recordUsage("docs", "generate");
  const base = formFile.name.replace(/\.[^.]+$/, "");
  const skipReasons = [...new Set(r.skipped.map((s) => s.reason.replace(/\s*—.*$/, "")))];
  const skipNote = r.skipped.length ? ` (부분 반영 ${r.skipped.length}건: ${skipReasons.slice(0, 2).join("·")}${skipReasons.length > 2 ? " 외" : ""})` : "";
  // 한계 안내: 채움이 기대되던 곳(빈칸·안내문)이 자동 작성되지 않았으면 명확히 알린다 — 조용한 미완성 금지.
  const unfilled = sess.plan.slots.filter((sl) => (sl.placeholder || (sl.kind === "표셀" && !sl.text)) && !values[sl.id]).length;
  const unfilledNote = unfilled ? ` 자동 작성되지 않은 영역 ${unfilled}곳이 있습니다(서술형 본문 등은 현재 AI가 채우지 못합니다) — 문서를 열어 해당 부분을 직접 작성해 주세요.` : "";
  const piiNote = piiPlaceholderNote(Object.values(values));
  return NextResponse.json(
    {
      ok: true, format: "custom",
      filename: `${base}_AI수정.${docExt(buf)}`, // 편집계획은 hwpx 전용이나 산출물 기준 명명으로 통일
      fileBase64: buf.toString("base64"),
      preview: `편집영역 ${sess.plan.areas.length}곳 중 ${r.applied}곳에 내용을 반영했습니다(잠금 ${sess.plan.lockedBlocks}블록·비편집 영역은 원본 그대로).${skipNote}${piiNote}${unfilledNote} 다운로드해 한컴에서 확인하세요.`,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 임의 양식(custom): 첨부한 hwpx 양식을 처리(.hwp는 구조 손실로 미지원 — 상단에서 차단).
 * - 서식(폼: 빈 라벨-값 필드 다수) → fillCustomForm(필드 채우기)
 * - HWPX 문서 → 편집계획(capability) 증분 패치 우선, 폴백으로 마크다운 patch
 * - HWP 문서 → kordoc patch로 본문만 교체(서식·표·로고 보존)
 */
/** kordoc fill 로 양식 빈칸을 values 로 채운 결과 바이트(stdout) 반환. 실패 시 throw.
 *  마커/실값 미리보기와 build 공용(여기서는 미리보기 전용). */
async function runKordocFill(dir: string, formPath: string, values: Record<string, string>, tag: string): Promise<Buffer> {
  const valsPath = path.join(dir, `vals_${tag}.json`);
  await writeFile(valsPath, JSON.stringify(values), "utf-8");
  const r = (await pExecFile(process.execPath, [KORDOC_CLI, "fill", formPath, "-j", valsPath, "--silent"], {
    timeout: PY_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "buffer",
  })) as unknown as { stdout: Buffer };
  const out = r.stdout;
  if (!out || out.length < 200 || !((out[0] === 0x50 && out[1] === 0x4b) || (out[0] === 0xd0 && out[1] === 0xcf))) {
    throw new Error("fill 결과가 유효하지 않음");
  }
  return out;
}

/**
 * 서식 빈칸 라벨을 LLM이 명확한 역할명으로 정규화(모호·지저분한 라벨 보정 → 콘텐츠 라우팅·표시 개선).
 * 인젝션 가드 경유(guardInput=라벨). 실패 시 라벨 자체를 역할로 폴백(감지 흐름을 막지 않음).
 */
async function normalizeFieldRoles(
  labels: string[],
  ctx: Awaited<ReturnType<typeof buildGuardContext>>,
): Promise<Map<string, string>> {
  const roles = new Map<string, string>(labels.map((l) => [l, l]));
  // 라벨이 지나치게 많으면(대형 체크리스트류) LLM JSON이 잘려 폴백만 유발 — 라벨 그대로 사용.
  if (!labels.length || labels.length > 30) return roles;
  try {
    const raw = await guardedChat({
      messages: [
        {
          role: "user",
          content:
            `아래는 서식의 '빈칸 라벨' 목록이다(번호 매김). 각 번호의 라벨이 어떤 정보를 입력받는 칸인지 짧은 역할명(2~12자)으로 정규화하라.\n` +
            `- 예: "성  명"→"성명", "부서명-368"→"부서명", "(경유)"→"경유", "핸드폰  E-mail"→"연락처".\n` +
            `- 원래 의미 유지, 군더더기(공백중복·숫자꼬리·괄호·기호)만 정리. 한 칸에 두 항목이면 대표 역할 하나로.\n` +
            `- 출력은 반드시 번호를 키로 한 JSON 객체 하나: {"1":"역할","2":"역할", ...} (설명·코드펜스 없이).\n\n` +
            labels.map((l, i) => `${i + 1}. ${l}`).join("\n"),
        },
      ],
      ctx,
      maxTokens: 800,
      temperature: 0.1,
      guardInput: labels.join("\n"), // 역할정규화 입력(라벨)도 인젝션·PII 가드 경유
    });
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) {
      const obj = JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>;
      labels.forEach((l, i) => {
        const r = obj[String(i + 1)]; // 번호(인덱스) 키로 매핑 — 소형 모델이 원본 라벨을 그대로 못 되뇌는 문제 회피
        if (typeof r === "string" && r.trim()) roles.set(l, r.trim().replace(/\s+/g, " ").slice(0, 24));
      });
    }
  } catch {
    /* LLM/파싱 실패 → 라벨 폴백 유지 */
  }
  return roles;
}

type DryField = { label: string; value?: string; row?: number; col?: number };

/** dry-run 필드에서 '예시표'(빈 양식 뒤에 붙은, 앞 표와 라벨이 겹치고 값이 채워진 워크드 예시)
 *  소속 필드를 제외하고, 남은 표의 빈칸만 편집영역으로 반환한다. 여비정산·관리카드처럼 예시가
 *  동봉된 서식에서 예시 셀(서울·교사·부산 등)이 편집영역으로 오노출되던 문제를 막는다.
 *  표 경계는 dry-run 필드의 row가 이전보다 작아지는 지점(문서순). 코퍼스 16종 실측:
 *  13종 불변·busan 13→6(예시 7제거)·라우팅(≥3) 회귀 0. */
function dropExampleTableFields(all: DryField[]): DryField[] {
  const tables: { labels: Set<string>; fields: DryField[] }[] = [];
  let cur: { labels: Set<string>; fields: DryField[] } | null = null;
  let prev = -Infinity;
  for (const f of all) {
    const row = typeof f.row === "number" ? f.row : 0;
    if (row === -1) continue; // 표 밖 메타/각주(지급기준 등)
    if (cur === null || row < prev) { cur = { labels: new Set(), fields: [] }; tables.push(cur); }
    cur.labels.add(f.label);
    cur.fields.push(f);
    prev = row;
  }
  const kept: DryField[] = [];
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const filled = t.fields.filter((f) => String(f.value ?? "").trim()).length;
    const fillRatio = filled / Math.max(1, t.fields.length);
    let overlap = 0;
    for (let j = 0; j < i; j++) {
      const inter = [...t.labels].filter((x) => tables[j].labels.has(x)).length;
      overlap = Math.max(overlap, inter / Math.max(1, t.labels.size));
    }
    const isExample = overlap >= 0.55 && fillRatio >= 0.5; // 앞 표의 '채워진 반복' = 예시
    if (!isExample) kept.push(...t.fields);
  }
  // 예시 판정이 전부 걸러 0이 되면(단일표 오판 등) 보수적으로 원본 유지.
  const result = kept.length ? kept : all;
  return result.filter((f) => !String(f.value ?? "").trim());
}

/** 마커(【N】)로 채운 fill 결과에서 '실제로 배치된' 번호 집합을 읽는다. 병합 라벨·예시 잔재처럼
 *  kordoc fill이 배치하지 못하는 칸을 식별해, 사용자에게 '자동 채움 불가(직접 입력)'로 정직히 표시한다.
 *  출력은 hwpx(zip) — 비-zip(.hwp CFB 등)이면 판정 불가 → 빈 셋(호출부가 전부 채움가능으로 폴백). */
async function markersPlacedInFill(buf: Buffer): Promise<Set<number>> {
  const present = new Set<number>();
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buf);
    for (const f of zip.file(/section\d*\.xml$/i)) {
      const xml = await f.async("string");
      for (const s of xml.match(/【(\d+)】/g) ?? []) {
        const n = parseInt(s.replace(/[^\d]/g, ""), 10);
        if (n) present.add(n);
      }
    }
  } catch { /* zip 파싱 실패 → 판정 불가 */ }
  return present;
}

async function handleCustomForm(req: Request, dir: string, files: File[], instruction: string, conversation: string, stage: string, reviewedData: unknown, wantOcr = false): Promise<NextResponse> {
  // 양식 파일: hwpx 우선, 없으면 본문 교체형(긴본문) .hwp 도 받는다 — patch(kordoc patchHwp)는
  // 원본 포맷을 그대로 보존하므로 문서형 .hwp는 안전하다. 단 '서식(빈칸 채우기형)' .hwp는 구조
  // 보존 채우기가 불가(rhwp 변환에서 쪽·표 레이아웃 손실 — 79쪽→42쪽 실측)라 아래 감지 후 차단한다.
  const formFile = files.find((f) => /\.hwpx$/i.test(f.name)) ?? files.find((f) => /\.hwp$/i.test(f.name));
  if (!formFile) {
    return NextResponse.json(
      { error: "임의 양식은 hwpx(빈칸 서식·본문형) 또는 본문 교체형 hwp 파일을 첨부해야 합니다." },
      { status: 400 },
    );
  }
  // 양식 외 첨부(참고자료) — 대용량(≤30만자)도 전문 추출 후, 예산 초과분은 3계층 인프라로
  // 임시 인덱싱해 '지시와 관련된 부분 발췌'만 사용한다(기존 12k 절사 → 관련도 기반 선별).
  const refParts: { name: string; text: string }[] = [];
  for (const f of files) {
    if (f === formFile) continue;
    const text = (await extractFileText(f, dir, wantOcr, ATT_MAX_CHARS)).trim();
    if (text) refParts.push({ name: f.name, text });
  }
  const ctxText = await buildRefContext(refParts, instruction);

  // 양식 → 마크다운(원본 구조)
  const formPath = path.join(dir, `form${path.extname(formFile.name)}`);
  await writeFile(formPath, Buffer.from(await formFile.arrayBuffer()));
  const parsed = await parseAttachment(formPath, formFile.name);
  if (!parsed.ok || !parsed.markdown.trim()) {
    return NextResponse.json({ error: `양식을 읽지 못했습니다: ${parsed.error ?? "빈 문서"}` }, { status: 400 });
  }

  // ── 보안 관문: 업로드 양식(필드 라벨·본문)과 참고자료는 모두 프롬프트에 들어가는 외부 입력이다.
  // 어떤 스테이지(감지/채우기/빌드)든 LLM 호출 이전에 프롬프트 인젝션을 검사하고, 발견 시 중단한다.
  // 이 단일 관문이 fillCustomForm·문서형·피드백 등 모든 하위 채우기 경로를 함께 차단한다.
  {
    const refText = refParts.map((p) => p.text).join("\n");
    if (scoreInjection(`${parsed.markdown}\n${refText}`).score >= INJECTION_BLOCK_THRESHOLD) {
      const spans: { text: string; source: string }[] = [];
      const scan = (text: string, source: string) => {
        for (const ln of text.split(/\r?\n/)) {
          const t = ln.trim();
          if (t && scoreInjection(t).score > 0) spans.push({ text: t.slice(0, 120), source });
          if (spans.length >= 8) break;
        }
      };
      scan(parsed.markdown, "첨부 양식");
      for (const p of refParts) { if (spans.length >= 8) break; scan(p.text, p.name); }
      recordUsage("docs", "blocked");
      return NextResponse.json(
        {
          ok: false,
          injection: true,
          error: "첨부한 양식 또는 참고자료에 LLM 프롬프트 공격에 해당하는 문구가 있어 문서 작성을 중단했습니다.",
          문구: spans,
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // 양식 유형 판정: 빈 라벨-값 필드(신청서·서식)가 3개 이상이면 '서식(폼)' → 필드 채우기(fill).
  // 아니면(본문 문단 위주 '문서') 아래의 본문 교체(patch).
  const isHwp = /\.hwp$/i.test(formFile.name);
  let formFields: { label: string; value?: string }[] = [];
  try {
    const { stdout } = await pExecFile(process.execPath, [KORDOC_CLI, "fill", formPath, "--dry-run", "--silent"], {
      timeout: PY_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const j = JSON.parse(stdout) as { fields?: DryField[]; confidence?: number };
    if ((j.confidence ?? 0) >= 0.5) formFields = dropExampleTableFields(j.fields ?? []); // 빈칸만·예시표 제외
  } catch {
    /* 필드 감지 실패 → 문서(patch)로 폴백 */
  }
  // '서식' .hwp — 구조 보존 채우기 불가(위 입구 주석). 본문형(긴본문) .hwp만 아래 patch 경로로.
  if (isHwp && formFields.length >= 3) {
    return NextResponse.json(
      { error: "구버전 .hwp ‘빈칸 서식’은 자동 채우기를 지원하지 않습니다. 한컴오피스에서 ‘다른 이름으로 저장 → hwpx’로 변환해 다시 첨부해 주세요. (본문 교체형 .hwp 문서는 변환 없이 사용할 수 있습니다)" },
      { status: 400 },
    );
  }
  // 폼 감지가 '부분'인 경우(HWPX) 편집계획이 더 많은 빈칸을 보면 편집계획 경로가 이득 —
  // fill dry-run이 라벨 4개만 잡은 18칸 신청서에서 나머지 14칸이 기회조차 없던 문제(코퍼스 실측).
  if (formFields.length >= 3 && !isHwp) {
    try {
      const { plan } = await openHwpxEditSession(new Uint8Array(await readFile(formPath)));
      const emptyCells = plan.slots.filter((s) => s.kind === "표셀" && !s.text).length;
      if (emptyCells >= formFields.length * 2) formFields = []; // 문서형(편집계획) 경로로
    } catch { /* 세션 실패 → 폼 경로 유지 */ }
  }
  if (formFields.length >= 3) {
    // 셀 실측 상한(hwpx cellSz) — 역할 휴리스틱과 min 결합해 셀 넘침을 정밀 방지. 실패 시 휴리스틱만.
    let cellCaps = new Map<string, number>();
    try { cellCaps = await cellCapsByLabel(new Uint8Array(await readFile(formPath)), formFields); }
    catch { /* 실측 실패 → 역할 휴리스틱 폴백 */ }
    // detect 단계: 빈 필드 목록 + 역할정규화(LLM·가드) + 번호 마커 미리보기(편집영역 인지) 반환.
    if (stage === "detect") {
      const labels = [...new Set(formFields.map((f) => f.label))];
      const detectCtx = await buildGuardContext(req, "docs");
      const roles = await normalizeFieldRoles(labels, detectCtx);
      // 편집영역을 번호 마커로 채운 미리보기(어디에 무엇이 들어가는지 사용자 인지) — 실패 시 원본 미리보기로 폴백.
      // 동시에 '실제로 배치된 마커'를 읽어 kordoc이 못 채우는 칸(병합 라벨 등)을 식별한다.
      let previewBase64 = "";
      let placed = new Set<number>();
      try {
        const markers: Record<string, string> = {};
        labels.forEach((l, i) => { markers[l] = `【${i + 1}】`; });
        const buf = await runKordocFill(dir, formPath, markers, "markers");
        previewBase64 = buf.toString("base64");
        placed = await markersPlacedInFill(buf);
      } catch { /* 마커 프리뷰 실패 → 프런트가 원본(formBytes)으로 폴백 */ }
      const canFlag = placed.size > 0; // 판정 성공 시에만 '직접 입력' 표시(실패 시 전부 채움가능 가정)
      const autoN = canFlag ? labels.filter((_, i) => placed.has(i + 1)).length : labels.length;
      return NextResponse.json(
        {
          ok: true,
          format: "custom",
          data: {
            __form: true,
            formName: formFile.name,
            fields: labels.map((l, i) => {
              const role = roles.get(l) || l;
              // fillable=false → 자동 채움 불가(병합/예시 잔재). 프런트가 '직접 입력'으로 표시하고 값 채우기에서 제외.
              return { n: i + 1, label: l, role, max: capMax(cellCaps.get(l), fieldMaxLen(role)), value: "", fillable: canFlag ? placed.has(i + 1) : true };
            }),
          },
          previewBase64,
          preview:
            `서식 필드 ${labels.length}개를 감지했습니다(자동 채움 ${autoN}개` +
            (canFlag && autoN < labels.length ? ` · 직접 입력 ${labels.length - autoN}개` : "") +
            `). 미리보기의 편집영역(【1】【2】…)에 넣을 값을 대화·참고자료로 구성하거나 각 칸에 직접 입력하세요.`,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return await fillCustomForm(req, dir, formPath, formFile, formFields, instruction, conversation, ctxText, isHwp, stage, reviewedData, cellCaps);
  }

  // 서식이 아님(본문 문단형 문서) — detect 단계면 편집계획(HWPX)·안내를 반환하고 문서 흐름으로.
  if (stage === "detect") {
    let planNote = "본문 교체형 양식입니다 — 작성 지시나 대화로 내용을 입력한 뒤 ‘문서 생성’을 누르세요.";
    let planData: Record<string, unknown> | null = null;
    if (!isHwp) {
      try {
        const { plan } = await openHwpxEditSession(new Uint8Array(await readFile(formPath)));
        const cellN = plan.areas.filter((a) => a.kind === "표").reduce((s, a) => s + (a.kind === "표" ? a.cells.length : 0), 0);
        const bodyN = plan.areas.filter((a) => a.kind === "본문").length;
        if (plan.areas.length) {
          planNote = `편집영역을 파악했습니다 — 본문 문단 ${bodyN}곳 · 표 작성셀 ${cellN}개(잠금 ${plan.lockedBlocks}블록은 보존). 작성 지시나 참고자료를 입력한 뒤 ‘문서 생성’을 누르면 편집영역에만 반영합니다.`;
          planData = { __editplan: true, body: bodyN, cells: cellN, locked: plan.lockedBlocks };
        }
      } catch { /* 편집계획 실패 → 기존 안내 유지(생성 시에도 기존 플로우 폴백) */ }
    }
    return NextResponse.json(
      { ok: true, format: "custom", data: planData, preview: planNote, flowVersion: FLOW_VERSION },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // HWPX는 편집계획(블록·셀 capability) 기반 증분 패치를 우선 시도 — 비편집 영역은 구조적으로 불변.
  // 실패(영역 0·LLM 무응답·반영 0)하면 아래 기존 마크다운 patch 플로우로 폴백한다.
  if (!isHwp) {
    const viaPlan = await tryEditPlanFlow(req, dir, formPath, formFile, instruction, conversation, ctxText);
    if (viaPlan) return viaPlan;
    // 편집계획이 물러났고(값 전량 무효 = 대개 복창) 빈칸이 거의 없는 '작성 완료 문서'라면,
    // 폴백(본문 통째 교체)은 제목·의견을 스텁 문장으로 갈아치우는 파괴로 이어진다(코퍼스 실측).
    try {
      const { plan } = await openHwpxEditSession(new Uint8Array(await readFile(formPath)));
      const cellSlots = plan.slots.filter((sl) => sl.kind === "표셀");
      const emptyRatio = cellSlots.length ? cellSlots.filter((sl) => !sl.text).length / cellSlots.length : 1;
      if (emptyRatio < 0.15) {
        return NextResponse.json({
          error: "이 문서는 이미 작성 완료된 문서로 보입니다. 전면 재작성은 지원하지 않습니다 — 빈 양식을 첨부하시거나, 바꿀 부분과 새 내용을 구체적으로 지시해 주세요.",
        }, { status: 422 });
      }
    } catch { /* 판정 실패 → 기존 폴백 계속 */ }
  }

  // 원본을 블록(이중 개행)으로 분리 — 표/이미지 블록은 코드가 보존, 본문 문단만 교체 대상.
  const blocks = parsed.markdown.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  // 표·이미지·각주 포함 문단은 교체 대상에서 제외. patch는 각주(인라인 "(주:…)")가 든 문단의
  // 텍스트 교체를 일부 skip하며 무결성을 깨 한글에서 안 열리므로, 해당 문단은 원본 그대로 둔다.
  const bodyIdx = blocks.flatMap((b, i) => (/^(<table|<tr|\||!\[|<img)/.test(b) || /\(주\s*[:：]/.test(b) ? [] : [i]));
  const bodyBlocks = bodyIdx.map((i) => blocks[i]);
  if (!bodyBlocks.length) {
    return NextResponse.json({ error: "양식에서 교체할 본문 문단을 찾지 못했습니다(표·이미지뿐)." }, { status: 400 });
  }

  const ctx = await buildGuardContext(req, "docs");
  const parseArr = (raw: string): unknown[] => {
    const a = raw.indexOf("["), z = raw.lastIndexOf("]");
    try {
      const p = JSON.parse(raw.slice(a, z + 1));
      if (Array.isArray(p)) return p;
    } catch { /* 번호줄 폴백 */ }
    return raw.replace(/```\w*/g, "").split(/\n+/).map((l) => l.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  };

  // 0단계: 양식 문단 역할·유지/변경 분류 — 라벨·서명·날짜는 keep으로 보존, 내용 자리만 replace.
  let roles: Array<{ idx: number; role?: string; action?: string }> = [];
  try {
    const rawCls = await guardedChat({
      messages: [{ role: "user", content: `[양식 문단 ${bodyBlocks.length}개]\n${bodyBlocks.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}` }],
      ctx, system: buildCustomClassifyPrompt(bodyBlocks.length),
      maxTokens: 1500, temperature: 0.1, guardInput: instruction,
    });
    const p = parseArr(rawCls);
    if (p.every((x) => typeof x === "object")) roles = p as typeof roles;
  } catch (e) {
    if (isGuardBlockedError(e)) return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    /* 분류 실패 → 전부 replace 폴백 */
  }
  const actionOf = (li: number) => roles.find((r) => r.idx === li + 1)?.action;
  const roleOf = (li: number) => roles.find((r) => r.idx === li + 1)?.role ?? "body";
  // 글머리(□ ○ ◦ - ▲ * ·)로 시작하는 문단은 본문 내용이므로 분류와 무관하게 교체(경량모델 오분류 보정).
  const isBullet = (s: string) => /^\s*[□○◦\-▲*·]/.test(s);
  // 확인문·서명란·날짜 같은 정형구는 내용이 아닌 양식 요소 → 분류와 무관하게 보존(경량모델이 body로 오분류해도 keep).
  const isFixedPhrase = (s: string) => {
    const t = s.trim();
    return /사실과\s*다름없|틀림없|확인합니다|확인함|동의합니다|동의함|서약/.test(t)
      || /신청인\s*[:：]|\(\s*(서명|인|날인)\s*\)|（\s*서명\s*）/.test(t)
      || /^20\d{2}\s*\.[\s.]*$|^20\d{2}\s*\.\s+\.\s+\./.test(t);
  };
  // 정형구는 보존하고, 그 외(글머리이거나 keep이 아닌 문단)만 교체 대상으로.
  const replaceLocal = bodyBlocks
    .map((_, i) => i)
    .filter((i) => !isFixedPhrase(bodyBlocks[i]) && (isBullet(bodyBlocks[i]) || actionOf(i) !== "keep"));
  const replaceBlocks = replaceLocal.map((i) => bodyBlocks[i]);

  // 1단계: 첨부+대화+지시 내용을 양식 무관하게 정리(표준 양식과 동일 파이프라인).
  const bodyContext = [conversation.trim() ? `[AI 대화 내용]\n${conversation.trim()}` : "", ctxText]
    .filter((s) => s && s.trim())
    .join("\n\n");
  const organizedMd = await organizeContent(instruction, bodyContext, ctx);

  // 2단계: replace 문단을 역할별 방법론으로 작성(정리된 내용 기반).
  let edits: unknown[] = [];
  try {
    const rawWrite = await guardedChat({
      messages: [{ role: "user", content: `[정리된 내용]\n${organizedMd}\n\n[작성할 문단 ${replaceBlocks.length}개 — 아래 형식(글머리·역할·길이)만 맞추고, 내용은 반드시 위 '정리된 내용'에서 가져올 것. 원본 문장은 주지 않으니 베낄 수 없음]\n${replaceLocal.map((bi, k) => {
        const blk = bodyBlocks[bi].trim();
        const bullet = blk.match(/^([□○◦\-▲*·])/)?.[1];
        const hint = blk.length > 45 ? "긴 서술문" : "짧은 개조식";
        return `${k + 1}. ${bullet ? `글머리 "${bullet}" 유지 + ` : ""}${roleOf(bi)} · ${hint}`;
      }).join("\n")}` }],
      ctx, system: buildCustomWritePrompt(replaceBlocks.length),
      maxTokens: 4096, temperature: 0.3, guardInput: instruction,
    });
    edits = parseArr(rawWrite);
  } catch (e) {
    if (isGuardBlockedError(e)) return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
  }
  // 2단계가 비면 기존 일괄교체 방식으로 폴백(회귀 안전망).
  if (!edits.some((e) => typeof e === "string" && (e as string).trim())) {
    try {
      const rawFb = await guardedChat({
        messages: [{ role: "user", content: `[지시]\n${instruction}\n\n[첨부]\n${ctxText || "(없음)"}\n\n[원본 문단 ${replaceBlocks.length}개]\n${replaceBlocks.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}` }],
        ctx, system: buildCustomEditPrompt(replaceBlocks.length),
        maxTokens: 4096, temperature: 0.3, guardInput: instruction,
      });
      edits = parseArr(rawFb);
    } catch (e) {
      if (isGuardBlockedError(e)) return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    }
  }

  // 일부 경량모델이 원소를 {"title":"X"}·"body":"X" JSON 조각으로 내는 걸 값으로 환원(안전망).
  const cleanEdit = (v: unknown): string => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const s = Object.values(v as Record<string, unknown>).find((x) => typeof x === "string");
      return typeof s === "string" ? s.trim() : "";
    }
    if (typeof v !== "string") return "";
    const m = v.trim().match(/^\{?\s*"[^"]+"\s*:\s*"([\s\S]+?)"\s*\}?$/);
    return (m ? m[1] : v).trim();
  };
  // 스텁 파괴 게이트: 생성된 교체 문단 총량이 원본 교체 대상의 45% 미만이면(내용 없이
  // "…보강 요청" 류 재진술 스텁) 반영하지 않는다 — 원본 파괴 방지(코퍼스 실측).
  const genTotal = edits.map((v) => cleanEdit(v).length).reduce((a, b) => a + b, 0);
  const origTotal = replaceBlocks.reduce((a, b) => a + b.length, 0);
  if (replaceBlocks.length >= 3 && genTotal < origTotal * 0.45) {
    return NextResponse.json({
      error: "생성된 내용이 원본을 대체하기에 부족해 반영하지 않았습니다. 참고자료를 첨부하거나 작성할 내용을 더 구체적으로 지시해 주세요.",
    }, { status: 422 });
  }
  // 재조립: replace 문단만 같은 위치에서 교체, keep·표·이미지·순서는 원본 그대로.
  const newBlocks = [...blocks];
  replaceLocal.forEach((localBi, k) => {
    const v = cleanEdit(edits[k]);
    if (v) newBlocks[bodyIdx[localBi]] = v;
  });
  const editedPath = path.join(dir, "edited.md");
  await writeFile(editedPath, newBlocks.join("\n\n"), "utf-8");

  // kordoc patch — 편집 마크다운을 원본 양식에 서식 보존하며 반영.
  // patch는 일부 변경(각주·중첩표 등)을 skip하면 검증 잔차로 non-zero exit(2)를 내지만 파일은 정상
  // 생성한다. 따라서 exit code가 아니라 "적용된 변경 수 + 산출물 존재"로 성공을 판정한다.
  // 입력 양식 형식 보존: .hwp → .hwp(kordoc patchHwp), .hwpx → .hwpx(patchHwpx). 출력도 동일 형식.
  // (isHwp 는 위 서식 감지 단계에서 이미 선언됨)
  const outPath = path.join(dir, isHwp ? "out.hwp" : "out.hwpx");
  let patchLog = "";
  try {
    const r = await pExecFile(process.execPath, [KORDOC_CLI, "patch", formPath, editedPath, "-o", outPath], {
      timeout: PY_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    patchLog = `${r.stdout}\n${r.stderr}`;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    patchLog = `${err.stdout ?? ""}\n${err.stderr ?? err.message ?? ""}`;
  }
  const applied = Number(/(\d+)개 변경 적용/.exec(patchLog)?.[1] ?? "0");
  if (applied === 0) {
    return NextResponse.json({ error: "양식과 편집 내용이 맞지 않아 반영된 변경이 없습니다(표·이미지 위주이거나 본문 문단이 너무 적을 수 있습니다)." }, { status: 422 });
  }
  // hwpx만: patch가 텍스트만 교체하고 줄 위치 캐시(linesegarray)는 원본대로 둬, 길이가 바뀌면 한글이
  // 캐시 불일치를 '변조'로 감지해 문서를 열지 않는다. 캐시를 제거해 한글이 재계산하게 한다.
  // (.hwp는 kordoc patchHwp가 LINE_SEG 연쇄를 직접 갱신하므로 불필요 + strip_lineseg.py는 zip 전용)
  if (!isHwp) {
    try {
      await pExecFile(PYTHON_BIN, [path.join(SCRIPTS_DIR, "strip_lineseg.py"), outPath], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8", env: PY_ENV });
    } catch {
      /* 캐시 제거 실패해도 patch 결과 자체는 유지 */
    }
  }
  let buf: Buffer;
  try {
    buf = await readFile(outPath);
  } catch {
    return NextResponse.json({ error: `양식 반영에 실패했습니다: ${patchLog.replace(/\s+/g, " ").slice(0, 200)}` }, { status: 502 });
  }

  recordUsage("docs", "generate");
  const base = formFile.name.replace(/\.[^.]+$/, "");
  return NextResponse.json(
    {
      ok: true,
      format: "custom",
      filename: `${base}_AI수정.${docExt(buf)}`, // patch는 원본 포맷 보존(.hwp→.hwp) — 실제 산출물 기준 명명
      fileBase64: buf.toString("base64"),
      preview: "양식의 표·로고·서식을 그대로 보존한 채 본문이 교체되었습니다. 다운로드해 한컴에서 확인하세요.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 구조(data)를 최종 산출물로: 이메일은 텍스트, 그 외 양식은 hwpx 빌드 후 응답. */
async function finalizeDoc(
  format: Exclude<DocFormat, "custom">,
  data: DocData,
  dir: string,
  req: Request,
): Promise<NextResponse> {
  const orgName = (await getPlaygroundConfig().catch(() => null))?.orgName;
  const preview = renderPreview(format, data, orgName);

  if (format === "email") {
    recordUsage("docs", "generate");
    return NextResponse.json(
      { ok: true, format, filename: null, text: renderEmailText(data as DocEmail), preview },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const outPath = path.join(dir, "out.hwpx");
  const runPy = (args: string[]) =>
    pExecFile(PYTHON_BIN, args, { timeout: PY_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", env: PY_ENV });
  try {
    if (format === "press") {
      const payloadPath = path.join(dir, "payload.json");
      await writeFile(payloadPath, JSON.stringify(data), "utf-8");
      const { stdout } = await runPy([path.join(SCRIPTS_DIR, "press_builder.py"), payloadPath, outPath]);
      if (parseBuilderResult(stdout).status !== "ok") throw new DocsError(502, "보도자료 HWPX 변환에 실패했습니다.");
    } else if (format === "1p") {
      const valuesPath = path.join(dir, "values.json");
      await writeFile(valuesPath, JSON.stringify(buildValues1p(data as Doc1p)), "utf-8");
      await runPy([
        path.join(SCRIPTS_DIR, "fill_skeleton.py"),
        "--skeleton", path.join(TPL_DIR, "format_1p", "skeleton.hwpx"),
        "--values", valuesPath, "--output", outPath,
      ]);
      await runPy([path.join(SCRIPTS_DIR, "fix_namespaces.py"), outPath]);
      await runPy([path.join(SCRIPTS_DIR, "clean_lone_markers.py"), outPath]);
    } else if (format === "gongmun") {
      const valuesPath = path.join(dir, "values.json");
      await writeFile(valuesPath, JSON.stringify(buildValuesGongmun(data as DocGongmun, orgName)), "utf-8");
      await runPy([
        path.join(SCRIPTS_DIR, "fill_skeleton.py"),
        "--skeleton", path.join(TPL_DIR, "format_gongmun", "skeleton.hwpx"),
        "--values", valuesPath, "--output", outPath,
      ]);
      await runPy([path.join(SCRIPTS_DIR, "fix_namespaces.py"), outPath]);
      await runPy([path.join(SCRIPTS_DIR, "fix_gongmun_body.py"), outPath]);
    } else {
      const valuesPath = path.join(dir, "values.json");
      await writeFile(valuesPath, JSON.stringify(buildValuesFull(data as DocFull, orgName)), "utf-8");
      await pExecFile(
        PYTHON_BIN,
        [path.join(SCRIPTS_DIR, "build_full.py"), "--values", valuesPath, "--output", outPath],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, cwd: path.join(process.cwd(), "tools", "hwpx"), encoding: "utf8", env: PY_ENV },
      );
      await runPy([path.join(SCRIPTS_DIR, "clean_lone_markers.py"), outPath]);
      await runPy([path.join(SCRIPTS_DIR, "clean_empty_toc.py"), outPath]);
    }
  } catch (e) {
    if (e instanceof DocsError) throw e;
    const err = e as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string };
    if (err.code === "ENOENT") throw new DocsError(500, "서버에 Python이 없어 HWPX 변환을 할 수 없습니다. PYTHON_BIN 또는 tools/ocr/.venv 를 확인하세요.");
    if (err.killed) throw new DocsError(504, "HWPX 변환 시간이 초과되었습니다(60초). 다시 시도해 주세요.");
    throw new DocsError(502, `HWPX 변환 실패: ${String(err.stderr ?? err.stdout ?? err.message ?? "").slice(0, 200)}`);
  }

  const buf = await readFile(outPath);
  const title = (data as { title?: string }).title ?? "문서";
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  const filename = `${DOC_FORMAT_INFO[format].label}_${safe}.hwpx`;
  recordUsage("docs", "generate");

  if ((req.headers.get("accept") ?? "").includes("application/json")) {
    return NextResponse.json(
      { ok: true, format, filename, fileBase64: buf.toString("base64"), preview },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="doc.hwpx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

/** POST /api/docs/generate (multipart): { format, instruction, files[], stage? } → 구조 JSON / hwpx / 텍스트. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 요청이 필요합니다." }, { status: 400 });
  }
  const format = String(form.get("format") ?? "").trim();
  const instruction = String(form.get("instruction") ?? "").trim();
  const conversation = String(form.get("conversation") ?? "").trim(); // 대화 기반 모드: 대화 transcript를 컨텍스트로 사용
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const wantOcr = String(form.get("ocr") ?? "") === "1"; // 참고자료 단계에서 'OCR로 읽기' 동의한 스캔 PDF 포함
  const stage = String(form.get("stage") ?? "").trim(); // "" 일괄 | "structure" 구조만 | "build" 검토구조→빌드
  const wantsStream = new URL(req.url).searchParams.get("stream") === "1"; // 구조 단계 진행 NDJSON 스트림

  if (!isDocFormat(format)) {
    return NextResponse.json({ error: "format은 1p·full·gongmun·email·press 중 하나여야 합니다." }, { status: 400 });
  }
  if (stage !== "build" && stage !== "detect" && stage !== "preview" && !instruction && !conversation) return NextResponse.json({ error: "지시문 또는 대화 내용을 입력하세요." }, { status: 400 });
  if (instruction.length > 4000) {
    return NextResponse.json({ error: "지시문이 너무 깁니다(4000자 이내)." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `참고 파일은 최대 ${MAX_FILES}개입니다.` }, { status: 400 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "axdocs-"));
  try {
    // 임의 양식: 첨부 hwpx 양식의 본문을 서식 보존하며 교체 (별도 흐름)
    if (format === "custom") {
      let reviewedData: unknown = null;
      if (stage === "build" || stage === "preview") {
        try { reviewedData = JSON.parse(String(form.get("data") ?? "null")); } catch { /* 검토 데이터 없음 → 폼이면 채울 값 없음으로 안내 */ }
      }
      return await handleCustomForm(req, dir, files, instruction, conversation, stage, reviewedData, wantOcr);
    }

    // ① build 단계: 이미 ③탭에서 검토·수정된 구조(data)로 바로 최종화(빌드).
    if (stage === "build") {
      let reviewed: DocData;
      try {
        reviewed = parseDocJson(format, JSON.parse(String(form.get("data") ?? "")));
      } catch {
        return NextResponse.json({ error: "검토한 구조 데이터가 올바르지 않습니다." }, { status: 400 });
      }
      return await finalizeDoc(format, reviewed, dir, req);
    }

    // ② 업로드 컨텍스트 텍스트 추출
    const parts: string[] = [];
    if (conversation) parts.push(`<<대화 내용(사용자·AI)>>\n${conversation.slice(0, 14_000)}`);
    for (const f of files) {
      const text = (await extractFileText(f, dir, wantOcr)).trim();
      if (text) parts.push(`<<파일: ${f.name}>>\n${text}`);
    }
    const context = parts.join("\n\n").slice(0, 16_000);

    // ③ 가드레일 경유 LLM 생성(구조 JSON) + zod 검증/재시도
    const ctx = await buildGuardContext(req, "docs");

    // 스트리밍(구조 단계): 내용정리·양식맞춤 2단계 진행을 NDJSON으로 흘림 — ③탭 체감 대기 감소.
    // (첨부 텍스트는 위에서 이미 context로 추출됨 → 스트림 중 dir 불필요, finally 정리와 무관)
    if (wantsStream && stage === "structure") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (ev: Record<string, unknown>) => {
            try { controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n")); } catch { /* 닫힌 스트림 무시 */ }
          };
          try {
            const data = await generateDocData(format, instruction, context, ctx, send);
            recordUsage("docs", "generate");
            send({ done: true, format, data, preview: renderPreview(format, data, (await getPlaygroundConfig().catch(() => null))?.orgName) });
          } catch (e) {
            if (e instanceof DocsError) send({ error: e.message });
            else if (isGuardBlockedError(e)) send({ error: e.block.reason, ruleId: e.block.ruleId });
            else { console.error("[docs] stream 생성 실패:", e); send({ error: "서버 오류가 발생했습니다." }); }
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
    }

    const data = await generateDocData(format, instruction, context, ctx);

    // ④ structure 단계: 구조만 반환(③탭 검토·수정 게이트용 — 빌드 없음).
    if (stage === "structure") {
      recordUsage("docs", "generate");
      return NextResponse.json(
        { ok: true, format, data, preview: renderPreview(format, data, (await getPlaygroundConfig().catch(() => null))?.orgName) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // ⑤ 기본(일괄): 생성 → 최종화(이메일 텍스트 / hwpx 빌드).
    return await finalizeDoc(format, data, dir, req);
  } catch (e) {
    if (e instanceof DocsError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (isGuardBlockedError(e)) {
      return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    }
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
