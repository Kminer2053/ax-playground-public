import { NextResponse } from "next/server";
import { guardedChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { orgLabel } from "@/lib/org";
import { recordUsage } from "@/lib/usage";
import { vocAggregates, buildComplaintContext, collectKnownNumbers } from "@/lib/cs/voc-analytics";

export const dynamic = "force-dynamic";

/** 어조별 지시. */
const TONES: Record<string, string> = {
  standard: "정중하고 표준적인 공공기관 문체로",
  empathy: "고객의 감정에 깊이 공감하는 따뜻한 어조로(공감·위로 표현을 더 풍부하게)",
  concise: "핵심만 간결하게(군더더기 없이 짧고 명확하게)",
};

const CATEGORIES = ["상품·품질", "환불·교환", "시설·청결", "직원응대", "결제·이용", "기타"];

/**
 * 받침에 따른 조사 선택: 받침 없음·ㄹ받침 → "로", 그 외 → "으로". (kr-minwon 이식)
 */
function eulRo(word: string): "로" | "으로" {
  const ch = word.trim().slice(-1);
  if (!ch) return "으로";
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28; // 0=받침없음, 8=ㄹ
    return jong === 0 || jong === 8 ? "로" : "으로";
  }
  if (/[0-9]$/.test(ch)) return ["2", "4", "5", "9"].includes(ch) ? "로" : "으로";
  return "으로";
}

/**
 * 고정 공식 답변 양식. AI가 채우는 곳은 두 군데(complaintSummary·answerBody)뿐이고
 * 인사말·담당자·연락처·맺음말은 양식 고정(담당자가 000(이름)/연락처만 채움). (kr-minwon 이식)
 */
function buildReply(org: string, complaintSummary: string, answerBody: string): string {
  return [
    `안녕하십니까, ${org} 고객의 소리 담당자 000(이름)입니다.`,
    "",
    `귀하의 민원은 ${complaintSummary}${eulRo(complaintSummary)} 이해됩니다.`,
    "",
    answerBody,
    "",
    `답변 내용에 대한 추가 설명이 필요한 경우 ${org} 고객의 소리 담당자 000(이름)(유선 연락처)에게 연락주시면 안내해드리도록 하겠습니다.`,
    "",
    "감사합니다.",
  ].join("\n");
}

function systemPrompt(org: string, toneDesc: string, grounded: boolean): string {
  return (
    `당신은 ${org} 고객의소리(VOC) 담당자입니다. 접수된 민원을 분석하고 공식 답변 재료를 작성하세요.\n` +
    (grounded ? `아래 [2024–2025 전사 민원 통계]를 근거로 분석하세요.\n` : ``) +
    `\n출력은 아래 JSON 객체 하나만 출력하세요(설명·코드펜스 없이):\n` +
    `{\n` +
    `  "complaintSummary": "민원을 한 구절의 명사형으로(공식 문서체). \\"귀하의 민원은 ___(으)로 이해됩니다\\" 문장에 자연스럽게 들어가야 함. 예: 판매 중인 김밥의 소비기한 경과 및 환불 요청",\n` +
    `  "answerBody": "고객에게 전할 답변 본문만. ${toneDesc} 작성. ①공감 → ②사실확인·경위 → ③조치·처리계획 → ④안내 순, 정중한 존댓말 3~5문장. 인사말·맺음말·서명·담당자/연락처는 절대 넣지 마라(양식이 따로 처리). 사실관계가 불명확하면 단정하지 말고 '확인 후 안내드리겠습니다' 형태로. 과장된 약속·보상 금지. 매장 업종은 식당·카페·편의점·전문점 등 다양하므로 '쇼핑', '쇼핑하실 수 있도록' 같은 특정 업종에 한정된 표현은 절대 쓰지 말고, 업종에 무관한 공통 표현인 '매장을 이용하실 수 있도록'을 사용하라.",\n` +
    `  "category": "${CATEGORIES.join("|")} 중 가장 적합한 하나",\n` +
    `  "actions": ["담당자 권장 조치 2~4개를 각각 한 문장으로"],\n` +
    (grounded
      ? `  "recurrence": "2년치 통계에 비춘 반복성·빈도 진단(수치 포함). 칭찬·감사 민원은 표면 에피소드(어떤 직원이 무엇을 했는지 등)가 매번 달라도 '칭찬/감사'라는 의도 기준으로 같은 유형으로 묶어, 전사 칭찬 비중을 근거로 반복(빈발) 유형임을 진단하라. 표면 내용이 다르다는 이유로 반복이 아니라고 판단하지 마라. 근거 없으면 '전사 통계상 두드러진 반복 유형은 아닙니다'",\n` +
        `  "citedStats": [{"label":"근거 항목","value": 숫자}]\n`
      : `  "recurrence": "",\n  "citedStats": []\n`) +
    `}\n` +
    (grounded ? `citedStats의 value는 [통계]에 실제 있는 수치만 쓰고, 통계에 없는 수치·역명·유형은 절대 지어내지 마라. 근거가 없으면 citedStats는 [].` : ``)
  );
}

function parseJson(raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
type Analysis = { summary: string; category: string; actions: string[] };
type CitedStat = { label: string; value: number | string; verified: boolean };

/** POST /api/cs/answer — 2024·2025 전사 집계 근거 민원분석 + 공식 답변양식 생성. body: { content, tone, type? } */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { content?: string; tone?: string; type?: string }
    | null;
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const tone = body?.tone && TONES[body.tone] ? body.tone : "standard";
  const type = typeof body?.type === "string" ? body.type.trim().slice(0, 40) : "";
  if (!content) return NextResponse.json({ error: "민원 내용을 입력하세요." }, { status: 400 });
  if (content.length > 4000) return NextResponse.json({ error: "민원 내용이 너무 깁니다(4000자 이내)." }, { status: 400 });

  // 2024·2025 전사 집계(번들된 정적 파일)를 근거로 주입
  const context = buildComplaintContext(vocAggregates);

  const meta = type ? `민원 유형: ${type}` : "";
  const userContent =
    (context ? `${context}\n\n` : "") +
    (meta ? `[참고 정보] ${meta}\n\n` : "") +
    `[접수된 민원 내용]\n${content}` +
    (context ? `\n\n위 [통계]를 근거로 답변 재료를 작성하라.` : "");

  const ctx = await buildGuardContext(req, "cs");
  const org = orgLabel((await getPlaygroundConfig()).orgName);
  let raw = "";
  try {
    raw = await guardedChat({
      messages: [{ role: "user", content: userContent }],
      ctx,
      system: systemPrompt(org, TONES[tone], true),
      maxTokens: 2000,
      temperature: 0.4,
      guardInput: content,
    });
  } catch (e) {
    if (isGuardBlockedError(e)) {
      return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    }
    throw e;
  }
  recordUsage("cs", tone); // 답변 어조별(standard|empathy|concise)

  const groundedOn = "2024–2025 전사 민원 집계";
  const parsed = parseJson(raw);
  if (!parsed) {
    // JSON 파싱 실패 폴백 — 원문을 본문으로 양식에 끼움
    const answerBody = raw.trim();
    return NextResponse.json({
      ok: true,
      analysis: null,
      recurrence: "",
      citedStats: [],
      complaintSummary: "",
      answerBody,
      reply: buildReply(org, "(민원 요약)", answerBody || "(답변 내용)"),
      groundedOn,
      tone,
    });
  }

  // 모델이 요약에 양식 꼬리("…(으)로 이해됩니다")를 붙여 오면 제거(중복 방지) — buildReply가 따로 붙임
  const complaintSummary = str(parsed.complaintSummary)
    .replace(/\s*(?:으로|로)?\s*이해\s*됩니다\.?$/, "")
    .replace(/[.\s]+$/, "")
    .trim();
  const answerBody = str(parsed.answerBody);
  const categoryRaw = str(parsed.category);
  const category = CATEGORIES.includes(categoryRaw) ? categoryRaw : "기타";
  const actions = Array.isArray(parsed.actions) ? parsed.actions.map(str).filter(Boolean).slice(0, 5) : [];
  const recurrence = str(parsed.recurrence);

  // citedStats 검증 — 수치가 실제 집계에 존재하는지 대조(환각 2차 차단)
  const known = collectKnownNumbers(vocAggregates);
  const rawStats = Array.isArray(parsed.citedStats) ? parsed.citedStats : [];
  const citedStats: CitedStat[] = rawStats
    .slice(0, 6)
    .map((s): CitedStat => {
      const o = (s ?? {}) as Record<string, unknown>;
      const value = (o.value ?? "") as number | string;
      const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
      const verified = Number.isFinite(num) ? known.has(num) : false;
      return { label: str(o.label), value, verified };
    })
    .filter((s) => s.label || s.value !== "");

  const analysis: Analysis | null =
    complaintSummary || category || actions.length > 0
      ? { summary: complaintSummary, category, actions }
      : null;

  return NextResponse.json({
    ok: true,
    analysis,
    recurrence,
    citedStats,
    complaintSummary,
    answerBody,
    reply: buildReply(org, complaintSummary || "(민원 요약)", answerBody || "(답변 내용)"),
    groundedOn,
    tone,
  });
}
