import { NextResponse } from "next/server";
import { guardedChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import { getAdCriteria, getIndustryRule, getIndustryRules, type IndustryRule } from "@/lib/ad-rules";
import { scanRules, buildTextReviewPrompt, buildVisualReviewPrompt, extractJsonObject, mergeReview, applyGojiScanFallback } from "@/lib/ad-review";
import { ocrImage } from "@/lib/ocr";
import { recordUsage } from "@/lib/usage";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { scoreInjection, INJECTION_BLOCK_THRESHOLD } from "@/lib/guardrails/input/injection";

export const dynamic = "force-dynamic";

// base64 길이 상한(원본 ~8MB 이미지 기준 여유). 무저장: 이미지는 메모리에서만 사용.
const MAX_B64 = 12 * 1024 * 1024;

// 구조화 출력(response_format json_schema) — 작은 양자화 모델(Ollama 등)에서도 JSON을 강제(constrained
// decoding)해 파싱 실패를 막는다. 미지원 서버는 llm.ts에서 자동 폴백(프롬프트 기반 + 기존 복구).
const LV3 = { type: "string", enum: ["이상없음", "확인필요", "위반의심"] };
const LV2 = { type: "string", enum: ["이상없음", "확인필요"] };
const STR = { type: "string" };
const TEXT_SCHEMA = {
  name: "ad_text_review",
  schema: {
    type: "object",
    properties: {
      문구적정성: { type: "object", properties: { 수준: LV3, 근거룰: STR, 의견: STR, 근거문구: STR }, required: ["수준"] },
      업종고지문구: { type: "object", properties: { 추정업종: STR, 수준: LV3, 근거룰: STR, 의견: STR, 근거문구: STR }, required: ["수준"] },
      금지의심: { type: "object", properties: { 해당: { type: "boolean" }, 사유: STR, 근거룰: STR }, required: ["해당"] },
    },
    required: ["문구적정성", "업종고지문구", "금지의심"],
  },
};
const VISUAL_SCHEMA = {
  name: "ad_visual_review",
  schema: {
    type: "object",
    properties: {
      이미지배경: { type: "object", properties: { 수준: LV2, 근거룰: STR, 의견: STR, 위치: STR }, required: ["수준"] },
      저작권초상권: { type: "object", properties: { 수준: LV2, 근거룰: STR, 의견: STR, 위치: STR }, required: ["수준"] },
    },
    required: ["이미지배경", "저작권초상권"],
  },
};

/** OCR 박스로 정밀 위치 — 각 분야의 '근거문구'를 OCR 라인과 매칭해 위치박스(정규화)를 부착한다. */
function attachOcrBoxes(
  result: Record<string, unknown> | null,
  lines: { text: string; box: { x: number; y: number; w: number; h: number } }[],
): void {
  if (!result || !Array.isArray(result.분야) || !lines.length) return;
  const norm = (s: string) => s.replace(/[\s·“”"'`.,!?()[\]]/g, "").toLowerCase();
  for (const f of result.분야 as Record<string, unknown>[]) {
    const phrase = norm(String(f.근거문구 ?? ""));
    if (phrase.length < 2) continue;
    let best: { box: { x: number; y: number; w: number; h: number } } | null = null;
    let bestLen = 0;
    for (const ln of lines) {
      const nl = norm(ln.text);
      if (nl.length < 2) continue;
      if (nl.includes(phrase) || phrase.includes(nl)) {
        const overlap = Math.min(nl.length, phrase.length);
        if (overlap > bestLen) {
          best = ln;
          bestLen = overlap;
        }
      }
    }
    if (best && bestLen >= 2) f.위치박스 = best.box;
  }
}

/** 업종 미선택 시 모델이 도안을 보고 업종을 분류(목록에서 하나) → 추정업종명 + (룰 있으면) 룰 반환. */
async function estimateIndustryByModel(
  ctx: Awaited<ReturnType<typeof buildGuardContext>>,
  imageBase64: string,
  mediaType: string,
  ocrText: string,
  rules: IndustryRule[],
): Promise<{ name: string; rule: IndustryRule | null }> {
  const names = rules.map((r) => r.industry).join(" / ");
  let out = "";
  try {
    out = await guardedChat({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
            { type: "text", text: `이 광고 도안의 업종을 아래 목록에서 가장 가까운 하나만 골라 그 이름만 출력하라(설명 없이 한 줄). 명확하지 않으면 "기타".\n[목록] ${names}\n[도안 문구] ${ocrText.slice(0, 400)}` },
          ],
        },
      ],
      ctx,
      maxTokens: 32,
      temperature: 0,
      guardInput: "광고 업종 추정",
    });
  } catch {
    return { name: "", rule: null };
  }
  const o = out.replace(/\s+/g, "");
  let best = rules.find((r) => o.includes(r.industry.replace(/\s+/g, "")));
  if (!best) best = rules.find((r) => r.industry.split(/[·,/]/).some((w) => w.length >= 2 && o.includes(w)));
  const guess = best?.industry ?? out.replace(/["'\n]/g, "").trim().slice(0, 20);
  const rule = best && (best.requiredNotices.length > 0 || best.riskExpressions.length > 0) ? best : null;
  return { name: guess === "기타" ? "" : guess, rule };
}

/** 단일 멀티모달 패스 — 원하는 키가 든 JSON 객체를 얻을 때까지 최대 2회. 가드 차단은 상위로 던진다. */
async function runPass(
  ctx: Awaited<ReturnType<typeof buildGuardContext>>,
  imageBase64: string,
  mediaType: string,
  prompt: string,
  wantKeys: string[],
  guardInput: string,
  jsonSchema: { name: string; schema: Record<string, unknown> },
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const userText = attempt === 0 ? prompt : `${prompt}\n\n[재시도] 추가 업로드를 요청하지 말고, 첨부된 도안을 직접 보고 설명 없이 위 JSON 하나만 출력하세요.`;
    const text = await guardedChat({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } }, { type: "text", text: userText }] }],
      ctx,
      maxTokens: 1024,
      temperature: attempt === 0 ? 0.2 : 0.4,
      guardInput,
      jsonSchema,
    });
    const obj = extractJsonObject(text);
    if (obj && wantKeys.some((k) => k in obj)) return obj;
    console.error(`[ad-review] ${guardInput} 파싱 실패(시도 ${attempt + 1}/2) — len=${text.length} head=${JSON.stringify(text.slice(0, 120))}`);
  }
  return null;
}

type Send = (ev: Record<string, unknown>) => void;
type ReviewError = { message: string; status: number; ruleId?: string };

/** 심의 핵심 — 단계별 진행/시간을 send()로 흘리며 결과를 만든다(스트림·JSON 공통). */
async function runReview(
  req: Request,
  imageBase64: string,
  mediaType: string,
  industry: string,
  send: Send,
): Promise<{ result?: Record<string, unknown>; error?: ReviewError; totalMs: number }> {
  const t0 = Date.now();

  // ① 도안 문구 인식(OCR) + 기준·룰 동시
  send({ stage: "ocr", status: "start", label: "도안 문구 인식" });
  let t = Date.now();
  const [criteria, rule, ocr] = await Promise.all([
    getAdCriteria(),
    industry ? getIndustryRule(industry) : Promise.resolve(null),
    ocrImage(Buffer.from(imageBase64, "base64"), mediaType).catch(() => ({ lines: [], text: "" })),
  ]);
  send({ stage: "ocr", status: "done", ms: Date.now() - t, detail: `문구 ${ocr.lines.length}개` });

  // ①-보안: OCR 문구(사용자 업로드물 = 공격자 통제 가능)에 프롬프트 인젝션이 있으면
  // 어떤 LLM 호출(업종추정·문구심의)에도 전달하기 전에 심의를 중단한다.
  const inj = scoreInjection(ocr.text);
  if (inj.score >= INJECTION_BLOCK_THRESHOLD) {
    const flagged = ocr.lines
      .filter((l) => scoreInjection(l.text).score > 0)
      .map((l) => ({ text: l.text, box: l.box }));
    send({ stage: "guard", status: "done", ms: 0, label: "보안 점검", detail: "프롬프트 공격 탐지 — 심의 중단" });
    recordUsage("ad", "blocked");
    return {
      result: {
        심의불가: {
          사유: "OCR이 도안의 문구 중 LLM 프롬프트 공격에 해당하는 내용이 포함되어 있습니다.",
          룰: inj.hits,
          문구: flagged,
        },
        추출텍스트: ocr.lines.map((l) => l.text).filter(Boolean),
      },
      totalMs: Date.now() - t0,
    };
  }

  const ctx = await buildGuardContext(req, "ad");

  // ② 업종 미선택 → 모델이 도안을 보고 업종을 분류 → 해당 룰 적용(설계: AI 자동 판단)
  let effIndustry = industry;
  let effRule: IndustryRule | null = rule;
  let aiIndustry = ""; // 자동 추정된 업종명(미선택일 때만 · 매칭 룰 유무와 무관하게 결과에 표기)
  if (!industry) {
    send({ stage: "industry", status: "start", label: "업종 추정" });
    t = Date.now();
    const est = await estimateIndustryByModel(ctx, imageBase64, mediaType, ocr.text, await getIndustryRules());
    aiIndustry = est.name;
    if (est.rule) { effIndustry = est.rule.industry; effRule = est.rule; }
    else if (est.name) effIndustry = est.name;
    send({ stage: "industry", status: "done", ms: Date.now() - t, detail: aiIndustry || "추정 보류" });
  }

  // ③ 텍스트 심의 + ④ 시각 탐지 — 분야 분리(품질 우선). 텍스트는 OCR↔룰 결정론 대조를 근거로.
  const scan = scanRules(ocr.text, effRule, criteria.prohibitedList);
  const orgName = (await getPlaygroundConfig().catch(() => null))?.orgName;
  let textRes: Record<string, unknown> | null = null;
  let visualRes: Record<string, unknown> | null = null;
  try {
    send({ stage: "text", status: "start", label: "문구·고지문구 심의" });
    t = Date.now();
    textRes = await runPass(
      ctx, imageBase64, mediaType,
      buildTextReviewPrompt(criteria, effIndustry, effRule, ocr.text, scan, orgName),
      ["문구적정성", "업종고지문구", "금지의심"],
      "광고 문구·고지문구 심의 (텍스트)",
      TEXT_SCHEMA,
    );
    send({ stage: "text", status: "done", ms: Date.now() - t, detail: textRes ? "완료" : "보류" });

    send({ stage: "visual", status: "start", label: "이미지·저작권 점검" });
    t = Date.now();
    visualRes = await runPass(
      ctx, imageBase64, mediaType,
      buildVisualReviewPrompt(orgName),
      ["이미지배경", "저작권초상권"],
      "광고 이미지·저작권 점검 (시각)",
      VISUAL_SCHEMA,
    );
    send({ stage: "visual", status: "done", ms: Date.now() - t, detail: visualRes ? "완료" : "보류" });
  } catch (e) {
    if (isGuardBlockedError(e)) return { error: { message: e.block.reason, status: e.block.status, ruleId: e.block.ruleId }, totalMs: Date.now() - t0 };
    throw e;
  }

  if (!textRes && !visualRes) {
    return { error: { message: "AI가 도안을 분석하지 못했습니다(여러 번 시도). 잠시 후 다시 시도하거나 다른 도안으로 시도해 주세요.", status: 502 }, totalMs: Date.now() - t0 };
  }

  // ⑤ 종합 + 위치 매칭(근거문구 → OCR 박스)
  send({ stage: "finalize", status: "start", label: "결과 정리" });
  t = Date.now();
  const result = mergeReview(textRes, visualRes, ocr.lines);
  applyGojiScanFallback(result, scan, effRule, aiIndustry || effIndustry);
  if (aiIndustry) result.자동추정업종 = aiIndustry;
  attachOcrBoxes(result, ocr.lines);
  send({ stage: "finalize", status: "done", ms: Date.now() - t });
  recordUsage("ad", "review"); // 심의 완료(가드 차단은 blocked)
  return { result, totalMs: Date.now() - t0 };
}

/**
 * POST /api/ad/review { imageBase64, mediaType, industry? }   (?stream=1 → 단계별 NDJSON 스트림)
 * 4분야 멀티모달 심의. 무저장: 이미지 미보존(메모리만), 감사로그엔 텍스트만.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { imageBase64?: string; mediaType?: string; industry?: string } | null;
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
  const mediaType = typeof body?.mediaType === "string" && body.mediaType.startsWith("image/") ? body.mediaType : "image/jpeg";
  const industry = typeof body?.industry === "string" ? body.industry.trim() : "";
  if (!imageBase64) return NextResponse.json({ error: "도안 이미지가 없습니다." }, { status: 400 });
  if (imageBase64.length > MAX_B64) return NextResponse.json({ error: "이미지가 너무 큽니다(약 8MB 이내)." }, { status: 400 });

  const wantsStream = new URL(req.url).searchParams.get("stream") === "1";

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send: Send = (ev) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
          } catch {
            /* 닫힌 스트림 무시 */
          }
        };
        try {
          const { result, error, totalMs } = await runReview(req, imageBase64, mediaType, industry, send);
          if (error) send({ error: error.message, ruleId: error.ruleId });
          else send({ done: true, result, totalMs });
        } catch {
          send({ error: "서버 오류가 발생했습니다." });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // 비스트림(JSON) 폴백
  try {
    const { result, error } = await runReview(req, imageBase64, mediaType, industry, () => {});
    if (error) return NextResponse.json({ error: error.message, ruleId: error.ruleId }, { status: error.status });
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
