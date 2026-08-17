import { z } from "zod";
import { orgDocLabel } from "@/lib/org";

/**
 * AI 문서작성(P6) — 양식별 LLM 출력 스키마(zod)·시스템 프롬프트·compose payload 변환.
 *
 * 설계(품질 재설계): LLM이 양식 구조에 맞는 JSON을 생성 → buildComposePayload가 그것을
 * compose_doc의 payload 형식(map_to_*과 동일)으로 직접 변환 → build_from_payload.py가
 * 글다듬기 후 빌드. md 평탄화·기계 매핑(특히 full의 요약/본문 중복)을 거치지 않는다.
 *  - 1p/full/gongmun: buildComposePayload → build_from_payload.py
 *  - press: press_builder.py (Base-hwpx 치환, 별도)
 *  - email: renderEmailText (텍스트)
 */

export type DocFormat = "1p" | "full" | "gongmun" | "email" | "press" | "custom";

export const DOC_FORMAT_INFO: Record<
  DocFormat,
  { label: string; desc: string; icon: string; composeFormat?: string }
> = {
  "1p": { label: "1페이지 보고서", desc: "의사결정용 한 장 요약 (□/○ 개조식)", icon: "📄", composeFormat: "format_1p" },
  full: { label: "풀버전 보고서", desc: "표지·목차·요약 자동 포함 (본문 4~6장)", icon: "📚", composeFormat: "format_full" },
  gongmun: { label: "시행문", desc: "대외 발송 공문 (수신·붙임·발신명의)", icon: "📨", composeFormat: "format_gongmun" },
  press: { label: "보도자료", desc: "자사 표준 양식 (머리표·□/○·인용문)", icon: "📰" },
  email: { label: "이메일", desc: "메일 본문 텍스트 (복사해 사용)", icon: "✉️" },
  custom: { label: "임의 양식", desc: "내 hwpx 양식 업로드 → 서식 유지·본문만 교체", icon: "🧩" },
};

export function isDocFormat(v: string): v is DocFormat {
  return v in DOC_FORMAT_INFO;
}

// ── zod 스키마 ──────────────────────────────────────────────

// 경량 모델이 배열을 가끔 단일 문자열로 출력 → 'string이면 [string]'으로 정규화해 zod 실패를 줄인다.
const toArr = (v: unknown) => (typeof v === "string" ? [v] : v);
const zItems = z.preprocess(toArr, z.array(z.string().min(2)).min(1).max(8));
// 위계 하위 레벨: - 세부(detail) / ※·* 주석(note). 빈 문자열은 undefined 로(생략).
const zSub = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().min(2).max(150).optional());
// 시행문 항목: 가.항목(text) + (선택)1)2) 세부(subs). string이면 {text}로 정규화(하위호환).
const zGongItem = z.preprocess(
  (v) => (typeof v === "string" ? { text: v } : v),
  z.object({
    text: z.string().min(2).max(150),
    subs: z.preprocess(toArr, z.array(z.string().min(2).max(150)).max(6)).optional(),
  }),
);

export const SCHEMA_1P = z.object({
  title: z.string().min(2).max(60),
  subtitle: z.string().max(60).optional(),
  department: z.string().max(30).optional(), // 소속부서(메타) — 편집 가능
  date: z.string().max(30).optional(), // 작성일자(메타) — 편집 가능
  summary: z.string().min(10).max(200),
  sections: z.array(z.object({ heading: z.string().min(2).max(30), items: zItems, detail: zSub, note: zSub })).min(2).max(5),
});

export const SCHEMA_FULL = z.object({
  title: z.string().min(2).max(60),
  subtitle: z.string().max(60).optional(),
  department: z.string().max(30).optional(), // 소속부서(메타) — 편집 가능
  date: z.string().max(30).optional(), // 작성일자(메타) — 편집 가능
  summary: z.array(z.string().min(5).max(120)).min(2).max(5),
  chapters: z
    .array(
      z.object({
        heading: z.string().min(2).max(30),
        sections: z.array(z.object({ title: z.string().min(2).max(40), items: zItems, detail: zSub, note: zSub })).min(1).max(5),
      }),
    )
    .min(3)
    .max(6),
  // (선택) 추진일정·단계별 계획처럼 표로 정리할 내용 → 구분/일정/내용 2~4행. 표가 어울릴 때만.
  schedule: z
    .array(z.object({ 구분: z.string().min(1).max(20), 일정: z.string().min(1).max(40), 내용: z.string().min(1).max(60) }))
    .min(2)
    .max(4)
    .optional(),
});

export const SCHEMA_GONGMUN = z.object({
  title: z.string().min(2).max(60),
  receiver: z.string().min(2).max(40).catch("수신자 제위"),
  opening: z.string().min(10).max(200),
  items: z.preprocess(toArr, z.array(zGongItem).min(1).max(8)),
  attachments: z.preprocess(toArr, z.array(z.string()).max(5)).optional(),
});

export const SCHEMA_EMAIL = z.object({
  subject: z.string().min(2).max(80),
  body: z.string().min(50).max(2500),
});

export const SCHEMA_PRESS = z.object({
  title: z.string().min(5).max(80),
  subtitles: z.preprocess(toArr, z.array(z.string().min(4).max(90)).min(1).max(2)),
  deptBiz: z.string().min(2).max(20).catch("○○부서"),
  body: z.array(z.object({ level: z.enum(["□", "○"]), text: z.string().min(14) })).min(3).max(12),
  quote: z.object({
    speaker: z.string().min(2).max(20),
    part1: z.string().min(5).max(150),
    part2: z.string().min(5).max(150),
  }),
  photoCaptions: z.preprocess(toArr, z.array(z.string().min(2).max(80)).max(3)).optional(),
});

export type Doc1p = z.infer<typeof SCHEMA_1P>;
export type DocFull = z.infer<typeof SCHEMA_FULL>;
export type DocGongmun = z.infer<typeof SCHEMA_GONGMUN>;
export type DocEmail = z.infer<typeof SCHEMA_EMAIL>;
export type DocPress = z.infer<typeof SCHEMA_PRESS>;
export type DocData = Doc1p | DocFull | DocGongmun | DocEmail | DocPress;

// ── 위계 편집기(StructureEditor)용 양식 슬롯 한도 — 빌더 슬롯과 일치(초과분은 빌드에서 생략) ──
/** full: ci번째 장이 수용하는 절(소제목) 최대 개수 = max(TOC_SEC_SLOTS[ci], CHAPTER_SEC_SLOTS[ci]) 길이. */
const FULL_SEC_CAP = [1, 4, 3, 5, 4, 4];
export function fullChapterSectionCap(ci: number): number { return FULL_SEC_CAP[ci] ?? 4; }
export const FULL_MAX_CHAPTERS = 6; // TOC_CHAP_SLOTS 길이
export const ONEP_MAX_SECTIONS = 5; // □ 슬롯 4개 + 5번째는 동적 삽입(apply_1p_expansion). 짧은 섹션이면 한 장 수용

// 부서·날짜 메타 기본값 주입 — ③ 검토 편집기에 보이고 수정 가능하도록(1p·full).
function withDocMeta<T extends { department?: string; date?: string }>(d: T): T {
  if (!d.department) d.department = "○○부서";
  if (!d.date) d.date = nowMeta().long;
  return d;
}

export function parseDocJson(format: DocFormat, obj: unknown): DocData {
  switch (format) {
    case "1p": return withDocMeta(SCHEMA_1P.parse(obj));
    case "full": return withDocMeta(SCHEMA_FULL.parse(obj));
    case "gongmun": return SCHEMA_GONGMUN.parse(obj);
    case "email": return SCHEMA_EMAIL.parse(obj);
    case "press": return SCHEMA_PRESS.parse(obj);
    default: throw new Error(`임의 양식은 JSON 스키마를 사용하지 않습니다: ${format}`);
  }
}

/**
 * 안전망 — 소형 모델이 스키마 최소 개수를 못 채웠을 때 best-effort 출력을 최소치 충족하도록 보강한다.
 * 완벽한 품질이 아니라 ③ 검토 게이트에서 '편집 가능한 유효 초안'을 보장하는 용도.
 * 정상 응답을 건드리지 않도록 parseDocJson 검증이 실패했을 때에만 호출한다(1p·full 지원).
 */
export function repairDoc(format: DocFormat, obj: unknown, organizedMd = "", orgName?: string): unknown {
  const o: Record<string, unknown> = obj && typeof obj === "object" ? { ...(obj as Record<string, unknown>) } : {};
  const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const lines = organizedMd.split("\n").map((l) => l.trim());
  const mdTitle = lines.find((l) => /^#\s/.test(l))?.replace(/^#+\s*/, "").trim();
  const bullets = lines
    .filter((l) => /^[-*•]\s/.test(l))
    .map((l) => clip(l.replace(/^[-*•]\s*/, ""), 150))
    .filter((x) => x.length >= 2);

  if (format === "1p") {
    const title = clip(o.title || mdTitle, 60) || "참고 자료 정리";
    const sm = clip(o.summary, 200);
    const summary = sm.length >= 10 ? sm : `${title} 관련 주요 내용을 정리한다.`.slice(0, 200);
    let secs = (Array.isArray(o.sections) ? o.sections : [])
      .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
      .map((s) => ({
        heading: clip(s.heading || "주요 내용", 30) || "주요 내용",
        items: (Array.isArray(s.items) ? s.items : []).map((x) => clip(x, 150)).filter((x) => x.length >= 2).slice(0, 8),
      }))
      .filter((s) => s.items.length);
    if (!secs.length && bullets.length) secs = [{ heading: "주요 내용", items: bullets.slice(0, 8) }];
    if (secs.length === 1) {
      const list = secs[0];
      secs = [
        { heading: "개요", items: [`${title} — 총 ${list.items.length}건`, summary].filter((x) => x.length >= 2).slice(0, 4) },
        { heading: list.heading === "개요" ? "주요 내용" : list.heading, items: list.items },
      ];
    }
    const subtitle = clip(o.subtitle, 60);
    return { title, ...(subtitle.length >= 2 ? { subtitle } : {}), summary, sections: secs };
  }

  if (format === "full") {
    const title = clip(o.title || mdTitle, 60) || "참고 자료 정리";
    let summary = (Array.isArray(o.summary) ? o.summary : o.summary != null ? [o.summary] : [])
      .map((x) => clip(x, 120))
      .filter((x) => x.length >= 5);
    let chapters = (Array.isArray(o.chapters) ? o.chapters : [])
      .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
      .map((c) => ({
        heading: clip(c.heading || "내용", 30) || "내용",
        sections: (Array.isArray(c.sections) ? c.sections : [])
          .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
          .map((s) => ({
            title: clip(s.title || "세부", 40) || "세부",
            items: (Array.isArray(s.items) ? s.items : []).map((x) => clip(x, 150)).filter((x) => x.length >= 2).slice(0, 5),
          }))
          .filter((s) => s.items.length),
      }))
      .filter((c) => c.sections.length);
    if (!chapters.length && bullets.length) chapters = [{ heading: title, sections: [{ title: "주요 내용", items: bullets.slice(0, 5) }] }];
    if (summary.length < 2) summary = [`${title} 관련 핵심 내용을 정리한다.`, ...summary, "세부 사항은 본문에 정리한다."].slice(0, 2);
    const subtitle = clip(o.subtitle, 60);
    return { title, ...(subtitle.length >= 2 ? { subtitle } : {}), summary, chapters };
  }

  if (format === "email") {
    const subjBase = clip(o.subject, 80);
    const subject = subjBase.length >= 2 ? subjBase : `[안내] ${clip(o.title || mdTitle || "업무 안내", 60)}`.slice(0, 80);
    let body = String(o.body ?? "").replace(/\r/g, "").trim();
    if (body.length < 50) {
      const lead = clip(o.summary || mdTitle, 180) || "관련 내용을 아래와 같이 안내드립니다.";
      const lines = bullets.slice(0, 6).map((b) => `□ ${b}`);
      body = ["안녕하세요.", "", lead, ...(lines.length ? ["", ...lines] : []), "", "확인 부탁드립니다. 감사합니다.", "", `${orgDocLabel(orgName)} 드림`].join("\n");
    }
    body = body.slice(0, 2500);
    if (body.length < 50) body = `${body}\n\n자세한 내용은 별도 안내드리겠습니다. 감사합니다.\n${orgDocLabel(orgName)} 드림`.slice(0, 2500);
    return { subject, body };
  }

  return obj; // 그 외 양식(시행문·보도자료)은 형식이 달라 무리한 보강을 하지 않음(깨끗한 오류로 안내)
}

// ── LLM 응답에서 JSON 추출 ──────────────────────────────────

export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON 객체를 찾지 못함");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ── 시스템 프롬프트 ─────────────────────────────────────────

const WRITING_CORE = `[작성 원칙 — 공공기관 보고서]
- 두괄식: 결론·핵심을 맨 앞에
- 개조식: 키워드 중심 짧은 문장, 한 문장 한 핵심(40자 내외), 명사형 종결
- 군더더기 금지: '-적', '~의', '~것', '~들', '~에 대한' 최소화
- 구체 수치·날짜 우선("6월 13일", "9개 부서 17명")
[출력 규칙]
- 아래 JSON 스키마와 정확히 같은 구조의 JSON 객체 "하나만" 출력
- 코드블록(\`\`\`)·설명·주석·여는말 절대 금지. 모든 문자열은 한국어.`;

const FORMAT_PROMPT: Record<Exclude<DocFormat, "custom">, string> = {
  "1p": `${WRITING_CORE}
[양식] 1페이지 보고서 — 의사결정자가 30초 안에 읽는 한 장 보고서. 1쪽 초과 금지.
- summary: 보고서 전체 결론을 압축한 두괄식 1문장(음영 박스에 들어감)
- sections: 3~4개(예: 추진배경/현황/추진내용/향후계획), 각 heading + items 2~4개
- (선택) 각 section에 detail(근거·수치 한 줄)·note(단서·예외 한 줄)를 더하면 -·* 하위 위계로 출력됨. 꼭 필요할 때만 — 1쪽을 넘기지 말 것
- summary와 sections 내용이 단순 반복되지 않게 — summary는 결론, sections는 근거·세부
JSON 스키마 예:
{"title":"AI 역량강화 교육 추진 보고","subtitle":"전사 AI 전환 기반 조성을 위한","summary":"6월 부서별 AI 교육 3회로 참석률 92%를 달성하고 7월 심화과정으로 확대한다.","sections":[{"heading":"추진배경","items":["전 직원 AI 활용 역량 격차 해소 필요","AI 도구 도입 확대로 교육 수요 증가"],"detail":"전사 설문 응답자 78%가 교육 필요성에 공감","note":"부서별 디지털 역량 편차가 큼"},{"heading":"추진내용","items":["6월 부서별 기초교육 3회 실시","실습 중심 커리큘럼 운영"]},{"heading":"향후계획","items":["7월 심화과정 개설","수료율 90% 목표"]}]}`,
  full: `${WRITING_CORE}
[양식] 풀버전 보고서 — 표지·목차·"보고내용 요약" 페이지는 자동 생성된다. 아래 둘을 각각 작성:
- summary: 보고서 전체 핵심을 압축한 2~4문장(배열). 의사결정자가 가장 먼저 읽는 요약.
- chapters: 본문 4~6개 장(章). 각 장 = heading(대주제) + sections 2~4개(절: title + items 2~4개).
  · 각 절에 detail(부연 근거·수치 한 줄)·note(단서·출처·예외 한 줄)를 더하면 - 세부·※ 주석 하위 위계로 풍부해짐(권장).
  ※ summary와 chapters가 같은 문장을 반복하지 말 것 — summary는 요약, chapters는 구체 서술.
- (선택) schedule: 추진 일정·단계별 계획처럼 표로 정리하면 좋은 내용이 있으면 schedule 배열(구분/일정/내용 2~4행)로 정리하면 본문 알맞은 장 끝에 표로 출력된다. ★구체적인 기간·내용을 알 때만 작성한다 — 모르면 schedule 자체를 생략하고, '미정'·'명시 필요'·'추후 결정' 같은 빈칸 채우기 문구는 절대 쓰지 말 것(빈 표·미완성 표는 만들지 않음).
JSON 스키마 예:
{"title":"AI 역량강화 교육 추진 결과 보고","subtitle":"- 부서별 교육 운영 현황 및 향후 계획 -","summary":["6월 10~12일 전사 AI 기초교육을 3회 실시해 참석률 92%·만족도 4.6점을 달성했다.","현장 실습 중심 운영으로 직무 적용도가 높았다.","7월 심화과정 개설로 역량 강화를 이어간다."],"chapters":[{"heading":"교육 개요","sections":[{"title":"교육 기간 및 대상","items":["6월 10일부터 12일까지 3일간","9개 부서 전 직원 대상"],"detail":"부서별 순환 방식으로 업무 공백 최소화","note":"교대근무 부서는 야간 회차 별도 운영"},{"title":"교육 방식","items":["부서별 집합교육","AX Playground 실습 병행"]}]},{"heading":"운영 실적","sections":[{"title":"정량 성과","items":["참석률 92% 달성","만족도 4.6점 기록"]},{"title":"정성 성과","items":["직무 적용 사례 다수 확보","후속 교육 수요 확인"]}]},{"heading":"향후 계획","sections":[{"title":"심화과정 운영","items":["7월 심화과정 개설","수료율 90% 목표"]}]}],"schedule":[{"구분":"1단계","일정":"2026.6~7","내용":"부서별 기초교육 운영 및 수요조사"},{"구분":"2단계","일정":"2026.8~9","내용":"심화과정 개설 및 전사 확대"}]}`,
  gongmun: `${WRITING_CORE}
[양식] 시행문(공문) — 외부기관·관계부서 발송. 정중한 공문체.
- opening: 서술식 도입 1문장(20자 이상, "~ 관련하여 다음과 같이 알려드립니다." 패턴)
- items: 개조식 안내 항목 2~5개(가.나.다.). 복잡한 항목은 subs(1)2) 세부)로 풀어쓸 수 있음. 마지막 항목은 협조 요청("~하여 주시기 바랍니다.")
JSON 스키마 예:
{"title":"AI 역량강화 교육 실시 알림","receiver":"수신자 제위","opening":"전사 AI 역량강화 교육 실시와 관련하여 다음과 같이 알려드립니다.","items":[{"text":"교육 일시: 2026. 6. 20.(토) 14:00"},{"text":"교육 대상 및 방식","subs":["정규직: 본사 집합교육 우선","계약직: 온라인 과정 병행"]},{"text":"교육 참석에 협조하여 주시기 바랍니다."}],"attachments":["교육 안내문 1부"]}`,
  email: `${WRITING_CORE}
[양식] 업무 이메일 — 본문 200~500자, 복사해 바로 발송 가능한 완성 본문.
- body 구성: 인사 → 결론(두괄식 1~2문장) → □ 핵심 안내 2~3줄 → 마무리 인사 → 서명("__ORG__ ○○○ 드림")
JSON 스키마 예:
{"subject":"[안내] 6월 정례회의 일정","body":"안녕하세요, ○○○님.\\n\\n6월 정례회의를 아래와 같이 안내드립니다.\\n\\n□ 일시: 6월 20일(금) 14:00\\n□ 장소: 본사 3층 회의실\\n\\n참석 부탁드립니다. 감사합니다.\\n\\n__ORG__ 기획부서 드림"}`,
  press: `${WRITING_CORE}
[양식] __ORG__ 보도자료 — 자사 표준. 경어·청유 금지.
- ★문체(가장 중요): 각 □·○ 단락은 반드시 '~다'로 끝나는 완전한 서술 문장(주어+서술어, 보도체 "~한다 / ~밝혔다 / ~계획이다 / ~예정이다 / ~방침이다 / ~기대된다"). 개조식·명사형 종결("~증대", "~강화 예상", "~제공 시행", "~확대 추진") 금지. 당위·주장형("~필요하다", "~해야 한다", "~중요하다", "~요구된다")도 금지 — 보도자료는 주장이 아니라 사실·계획을 전달한다(보고서가 아니라 기사 문장)
- 기호: □ 주요 단락(4~6개) → ○ 하위 보충(□당 0~2개), 나열은 본문 안에 ▲항목 ▲항목
- body[0](□)은 리드: "__ORG__(대표 __CEO__)이 [핵심 사실]한다." — 두괄식 5W1H 1~2문장, (대표 __CEO__) 필수
- 전문용어는 한글(영문) 병기: 인공지능(AI). 구체 수치·날짜 우선
- 마지막 □는 "한편, ~"로 배경·관련활동 1단락. quote는 별도(직책+실명, part1=의의·part2=포부)
- subtitles 1~2개: 명사형 압축(대시 "-" 없이 본문만), 2번째는 인용형 허용
JSON 스키마 예:
{"title":"__ORG__, ○○ 본격화…'○○' 출범","subtitles":["핵심 효과 압축 1줄","대표 \\"인용형 부제\\""],"deptBiz":"기획부서","body":[{"level":"□","text":"__ORG__(대표 __CEO__)은 전 직원에게 9개 인공지능(AI) 도구를 무료로 제공한다고 15일 밝혔다."},{"level":"○","text":"이번 도입으로 임직원의 업무 효율성이 크게 향상될 것으로 기대된다."},{"level":"□","text":"한편, __ORG__은 디지털 전환을 지속적으로 추진해 왔다."}],"quote":{"speaker":"__CEO__ 대표","part1":"…출발점","part2":"…연결하겠다"},"photoCaptions":[]}`,
};

// ── 글쓰기 요령 (스킬 references 핵심 압축 — stage2 양식맞춤에 주입) ──────
// 원본: tools/hwpx/references/{writing-principles,layout-rules,format-*}.md (벤더링)
const WRITING_COMMON = `[공공기관 보고서 글쓰기 원칙]
- 두괄식: 결론·핵심을 맨 앞에 둔다.
- 개조식: 키워드 중심으로 짧게 끊어 쓴다(서술식 지양). 한 문장에 한 핵심, 한 줄(약 40자) 이내.
- 명사형 종결: "~함/~필요/~예정/~추진"으로 간결하게. "~와 관련된"→"~ 관련".
- 적·의·것·들 정리: 불필요한 '-적/-의/-것/-들'은 빼도 뜻이 통하면 뺀다.
- 판단·예정 압축: "~할 것으로 보입니다"→"~ 예상", "~하는 것이 필요합니다"→"~ 필요".
- 수치·근거는 구체적으로(날짜·인원·금액·비율).`;

const WRITING_GUIDE: Record<Exclude<DocFormat, "custom">, string> = {
  "1p": `[1페이지 보고서 — A4 1쪽 강제] 위계 A체계 □대제목→◦항목→-세부→*주석. □ 3~4개, 각 ◦ 2~4개로 핵심만 압축(1쪽 초과 금지).`,
  full: `[풀버전 — A4 5~30쪽] 위계 B체계 Ⅰ장→□절→◦항목→-세부→※주석. 장은 6개 이내, 도입 장(Ⅰ)은 절 1개·본론 장은 각 절 2~3개로 구성하고 각 절에 ◦ 항목을 충실히.`,
  gongmun: `[시행문] 본문은 1.(관련·근거를 서술식 1~2문장 도입) + 가.나.다.(개조식 협조사항). 결문은 "~하여 주시기 바랍니다". 항목이 많으면 가.나.다. 아래 1)2)로 세분.`,
  press: `[보도자료] □(핵심 사실)/○(부연) 교대. ★각 단락은 '~다'로 끝나는 완전한 서술 문장(보도체 "~한다/~밝혔다/~방침이다")으로 — 개조식·명사형 종결("~증대","~시행")과 당위·주장형("~필요하다","~해야 한다") 금지. 사실·계획만 객관 서술, 인용은 직접화법.`,
  email: `[이메일 — 200~500자] 두괄식으로 결론(요청·통보)을 먼저. 간단한 □/- 정리.`,
};

/** 대표자 성명 자리표시자 — 기관 고유값이라 코드에 넣지 않고 관리자 설정(ceoName)에서 주입한다. */
const CEO_PLACEHOLDER = "__CEO__";
/** 설정이 비어 있을 때 프롬프트에 넣는 표기 — 실명 대신 빈칸 기호. */
const CEO_FALLBACK = "○○○";
/** 기관명 자리표시자 — 관리자 설정(orgName)에서 주입한다. 폴백은 orgDocLabel("○○기관"). */
const ORG_PLACEHOLDER = "__ORG__";

export function buildDocPrompt(format: DocFormat, ceoName?: string, orgName?: string): string {
  const f = format as Exclude<DocFormat, "custom">;
  const ceo = (ceoName ?? "").trim() || CEO_FALLBACK;
  const spec = FORMAT_PROMPT[f].split(CEO_PLACEHOLDER).join(ceo).split(ORG_PLACEHOLDER).join(orgDocLabel(orgName));
  return `${spec}\n\n${WRITING_COMMON}\n${WRITING_GUIDE[f]}`;
}

/**
 * 임의 양식(custom) 편집 프롬프트 — 사용자 hwpx를 마크다운으로 추출한 원본을 받아
 * 구조(제목·표·문단·글머리)를 유지하고 본문 텍스트만 지시·첨부 반영해 교체하게 한다.
 * 결과 마크다운을 kordoc patch로 원본 hwpx에 반영하므로 줄·구조 대응이 중요.
 */
export function buildCustomEditPrompt(blockCount: number): string {
  return `당신은 공공기관 문서 편집기입니다. 아래 [원본 문단] ${blockCount}개를 사용자 [지시]와 [첨부]를 반영해 내용만 교체하세요.

[출력 형식 — 엄수]
- 정확히 ${blockCount}개 항목의 JSON 문자열 배열만 출력하세요. 예: ["교체된 1번 문단","교체된 2번 문단", …]
- 항목 수는 반드시 ${blockCount}개. 문단을 합치거나 나누거나 삭제하지 마세요(1번→1번, 2번→2번로 대응).
- 각 문단의 글머리(□ ○ - ▲ * ·)와 위계·길이를 비슷하게 유지하고 텍스트 내용만 교체.
- 지시·첨부에 없는 부분은 원본 문맥에 맞게 자연스럽게.
- 코드블록·설명·머리말 없이 JSON 배열만 출력.`;
}

/**
 * 임의 양식 0단계 — 양식 문단의 역할과 '유지/변경'을 분류한다.
 * 라벨("수신:")·서명("○○ 사장")·날짜·문서번호 같은 양식 고정 텍스트는 keep 으로 보존하고,
 * 제목·본문·개조식 항목처럼 실제 내용이 들어갈 자리만 replace 로 골라 2단계 작성 대상으로 넘긴다.
 */
export function buildCustomClassifyPrompt(blockCount: number): string {
  return `당신은 공공기관 문서 양식 분석기입니다. 아래 [양식 문단] ${blockCount}개 각각의 역할과 교체 여부를 판정하세요.

[역할(role)]
- title 제목 / subtitle 부제
- body 본문 서술 문단 / item 개조식 항목(□ ○ - 등 글머리)
- label 고정 안내 라벨("수신", "제목", "붙임" 등)
- meta 날짜·문서번호·기관명·서명("신청인:", "(서명)")·확인문("~사실과 다름없음을 확인합니다", "~동의합니다") 같은 정형구
- etc 기타

[교체여부(action)]
- replace 실제 내용이 들어갈 자리(title·subtitle·body·item). □ ○ - ▲ * · 글머리이거나 서술 문장이면 반드시 replace
- keep 내용이 아닌 양식 요소 — "수신/제목/붙임" 같은 짧은 라벨, 날짜·문서번호·기관명·서명("○○ 사장")에만
- 애매하면 replace (대부분의 문단은 내용 자리다)

[출력 — 엄수]
정확히 ${blockCount}개 항목의 JSON 배열만. 예: [{"idx":1,"role":"title","action":"replace"},{"idx":2,"role":"label","action":"keep"}]
코드블록·설명 없이 JSON 배열만 출력.`;
}

/**
 * 임의 양식 2단계 — 1단계에서 정리된 내용을, replace 대상 문단들에 역할별 방법론으로 작성한다.
 * (글머리·위계·길이는 원본 양식 문단을 따르고 텍스트 내용만 채운다.)
 */
export function buildCustomWritePrompt(blockCount: number): string {
  return `당신은 공공기관 문서 작성기입니다. [정리된 내용]을 양식의 [교체 문단] ${blockCount}개에 맞게 작성하세요.

[핵심 원칙 — 최우선]
★ 원본 문단의 '주제·내용'은 완전히 버리고 [정리된 내용]의 새 주제로 모든 문단을 다시 씁니다.
★ 원본에서 가져올 것은 글머리(□ ○ -)와 문단의 성격·길이뿐. 원본 문장을 그대로 복사하면 절대 안 됩니다.

[역할별 작성법]
- title: 핵심을 압축한 제목 한 줄(군더더기 없이)
- subtitle: "- ~ -" 형태의 부제
- body: 두괄식 본문 서술, 원본 문단과 비슷한 길이
- item: 개조식 항목 — 원본 글머리(□ ○ - ▲ * ·)와 위계를 그대로 유지하고 내용만 교체

[출력 — 엄수]
[교체 문단] 순서대로 정확히 ${blockCount}개의 문자열 배열만. 예: ["교체된 1번 문단","교체된 2번 문단"]
각 원소는 교체될 문단 텍스트 그 자체입니다. 절대 {"title":"…"} 나 "body":"…" 같은 객체·키를 넣지 마세요.
글머리(□ ○ - ▲ * ·)만 유지하고 내용은 전부 새 주제로 교체. [정리된 내용]이 부족하면 새 주제에 맞게 자연스럽게 채우되, 원본의 옛 주제·문장으로 되돌아가지 마세요. 코드블록·설명 없이 배열만 출력.`;
}

/**
 * 임의 양식(서식/폼) — 양식의 빈 필드 라벨에 채울 값을 [내용]에서 매핑한다.
 * 신청서·서식처럼 표 기반 양식에서 라벨-값 셀의 '값'만 만든다(라벨·표·서식은 kordoc이 보존).
 */
export function buildFormFillPrompt(): string {
  return `당신은 공공기관 서식(신청서·보고서 양식)의 빈 칸을 채우는 작성기입니다. 목표는 단 하나 — [양식 빈 필드]의 각 라벨에 들어갈 '값'을 [내용]에서 찾아내는 것입니다. 새 문서를 쓰거나 내용을 요약·재구성하지 말고, 오직 각 칸에 들어갈 값만 추출하세요.

[작업 방식 — 라벨마다 '값 찾기']
- 라벨을 질문으로 바꿔 생각한다. 예: "성명"→"이 사람 이름은?", "신청일"→"신청 날짜는?", "연락처"→"전화번호는?", "사업자등록번호"→"그 번호는?".
- 그 답을 [내용](AI 대화·첨부 참고자료·작성 지시)에서 찾아 값으로 넣는다. 라벨과 표현이 달라도 뜻이 같으면 매칭한다(성명=이름, 연락처=전화/휴대폰, 주소=소재지, 금액=비용/예산, 기간=일정 등).
- 단서가 여러 곳이면 가장 구체적이고 최신인 값을 쓴다. 값은 칸에 그대로 들어갈 '결과값'만(라벨·설명 문구 반복 금지).

[출력 — 엄수]
- {"라벨":"값", ...} 형태의 JSON 객체만 출력. 키는 [양식 빈 필드]의 라벨과 글자까지 정확히 동일하게.
- 코드블록·설명·머리말 없이 JSON 객체만.

[규칙]
- [내용]에 근거가 없는 필드는 키를 아예 생략한다(빈칸으로 남김). 추측·창작 금지 — 없으면 비운다.
- 라벨이 값을 받는 칸이 아니라 묶음 머리글(예: "회사개요", "구분", "신청내용")이면 생략한다.
- 날짜·전화·법인번호·금액 등은 형식을 지키고, 과장 없이 [내용]의 사실만 반영한다.
- 한 필드 값은 표 칸에 들어갈 만큼 한 줄로 간결하게.`;
}

// ── compose_doc payload 변환 (1p/full/gongmun) ──────────────

const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ"];

function nowMeta() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  return { short: `'${String(y).slice(2)}. ${m}.`, long: `${y}. ${m}.` };
}

/** LLM JSON → compose_doc payload(map_to_*과 동일 형식). build_from_payload.py 입력. */
export function buildComposePayload(
  format: Extract<DocFormat, "1p" | "full" | "gongmun">,
  data: DocData,
  orgName?: string,
): Record<string, unknown> {
  const { short, long } = nowMeta();

  if (format === "1p") {
    const d = data as Doc1p;
    return {
      subtitle: d.subtitle ?? "",
      title: d.title,
      author: "○○부서",
      date: short,
      phone: "",
      summary: d.summary,
      sections: d.sections.map((s) => ({ heading: s.heading, items: s.items.map((t) => ({ text: t, sub: [] })) })),
      _missing: [],
    };
  }

  if (format === "full") {
    const d = data as DocFull;
    return {
      cover: { subtitle: d.subtitle ?? "", title: d.title, date: long, department: "○○부서", doc_meta: {}, approval_line: [] },
      toc: d.chapters.map((c, i) => [`${ROMAN[i] ?? ""}. ${c.heading}`, 4 + i * 2]),
      toc_appendix: [],
      // 요약 페이지: LLM이 본문과 별도로 생성한 summary[]를 사용 → 본문과 중복 제거
      summary: { title: "보고내용 요약", sections: [{ heading: "주요 내용", items: d.summary }], side_boxes: [] },
      chapters: d.chapters.map((c, i) => ({
        roman: ROMAN[i] ?? "Ⅰ",
        title: c.heading,
        sections: c.sections.map((s) => ({
          title: s.title,
          subsections: s.items.length ? [{ title: "주요 내용", items: s.items }] : [],
        })),
      })),
      appendix: [],
      _missing: [],
    };
  }

  // gongmun
  const d = data as DocGongmun;
  const org = orgDocLabel(orgName);
  return {
    sender_org: org,
    receiver: d.receiver,
    via: "",
    title: d.title,
    related_clause: "",
    main_paragraph: d.opening,
    items: d.items.map((it) => it.text),
    attachments: d.attachments ?? [],
    signature_org: org,
    signature_title: `${org} 대표`,
    metadata: {},
    _missing: [],
  };
}

// ── skeleton fill용 values 변환 ─────────────────────────────
// 양식 skeleton의 토큰(text_NNN)에 LLM 콘텐츠를 매핑한다. fill_skeleton.py가 양식
// hwpx를 통째로 보존한 채 토큰만 치환하므로 표·테두리·색 등 시각 디자인이 100% 유지된다.
// (◦/- 마커는 fill_skeleton의 normalize_1p_markers가 자동 처리 → 값엔 마커 없이 텍스트만)

const PAD3 = (n: number) => `text_${String(n).padStart(3, "0")}`;

/** 1p: text_001 제목 / text_003 메타 / text_004~023 4섹션(□ + ◦×2). */
export function buildValues1p(data: Doc1p): Record<string, unknown> {
  const { long } = nowMeta();
  const v: Record<string, unknown> = {
    text_002: data.title, // 제목은 파란 줄 사이 '아래'
    text_003: `<${data.department || "○○부서"}, ${data.date || long}>`,
  };
  // 부제는 제목 '위'(text_001) + 좌우 대시. standard.hwpx에서 text_001 자리를 부제 서식
  // (파란 #0000FF 15pt·줄간격 130%)으로 디자인 → make_skeleton이 skeleton에 전파.
  if (data.subtitle) {
    // subtitle에 이미 좌우 대시가 있으면 제거 후 통일(이중 대시 방지).
    const sub = data.subtitle.replace(/^[\s–—-]+|[\s–—-]+$/g, "").trim();
    v.text_001 = `- ${sub} -`;
  }
  // 섹션별 □ 헤딩 + ◦ 항목(가변). 항목은 '섹션N_항목' 배열로 넘기면 fill_skeleton의
  // apply_1p_expansion이 ◦ 슬롯 2개를 채우고 초과분을 ◦ 단락으로 동적 확장한다(잘림 없음).
  const SECTION_BASE = [4, 9, 14, 19];
  const used = data.sections.slice(0, 4);
  used.forEach((s, i) => {
    const b = SECTION_BASE[i];
    v[PAD3(b)] = `□ ${s.heading}`;
    v[`섹션${i + 1}_항목`] = s.items.map((it) => (it.trimStart().startsWith("◦") ? it : `◦ ${it}`));
    // 선택적 하위 위계: - 세부(b+3, BULLET 자동마커) / * 주석(b+4). 값 있을 때만 → EMPTY 제외.
    if (s.detail) v[PAD3(b + 3)] = `- ${s.detail}`;
    if (s.note) v[PAD3(b + 4)] = `* ${s.note}`;
  });
  // 5번째 이상 섹션: 템플릿 □ 슬롯은 4개뿐이라, 초과분은 4번째 섹션 뒤에 동적 삽입(apply_1p_expansion).
  // 짧은 섹션이면 한 장에 다 들어간다. □ 제목 + ◦항목(+세부/주석)을 한 배열로 평탄화해 전달.
  const extra = data.sections.slice(4);
  if (extra.length) {
    const lines: string[] = [];
    for (const s of extra) {
      lines.push(`□ ${s.heading}`);
      for (const it of s.items) lines.push(it.trimStart().startsWith("◦") ? it : `◦ ${it}`);
      if (s.detail) lines.push(`- ${s.detail}`);
      if (s.note) lines.push(`* ${s.note}`);
    }
    v["1p_추가섹션"] = lines;
  }
  // 사용 섹션의 ◦ 슬롯(b+1,b+2)은 apply_1p_expansion이 채우므로 EMPTY 대상에서 제외.
  const ocrSlots = new Set<string>();
  used.forEach((_, i) => {
    ocrSlots.add(PAD3(SECTION_BASE[i] + 1));
    ocrSlots.add(PAD3(SECTION_BASE[i] + 2));
  });
  // 나머지 미사용 본문 슬롯은 EMPTY_MARKER → fill_skeleton/clean_lone_markers가 빈 단락 제거.
  const EMPTY_MARKER = "​​__EMPTY_PLACEHOLDER__​​";
  for (let i = 4; i <= 23; i++) {
    const tk = PAD3(i);
    if (!(tk in v) && !ocrSlots.has(tk)) v[tk] = EMPTY_MARKER;
  }
  return v;
}

/** gongmun: 표 기반 기관/수신/제목 + 본문(배열). expand_gongmun_body가 위계별 동적 확장. */
export function buildValuesGongmun(data: DocGongmun, orgName?: string): Record<string, unknown> {
  const KOR = "가나다라마바사아자차";
  const atts = data.attachments ?? [];
  const org = orgDocLabel(orgName);
  const v: Record<string, unknown> = {
    text_001: org,
    text_003: org,
    수신자: data.receiver,
    text_005: "(경유)",
    text_006: data.title,
    // 본문: 도입 1문장(1.) + 항목(가.나.다.)
    본문: [`1. ${data.opening}`],
    // 가.항목 + (선택)1)2) 세부를 한 배열로 → expand가 paraPr26 동적단락으로 통일. 1) 세부는
    // 전각공백 1칸 안쪽으로 계단(가. 아래 중첩). 마커는 여기서 직접 부여.
    본문_가나: data.items.flatMap((it, i) => [
      `${KOR[i] ?? "·"}. ${it.text}`,
      ...(it.subs ?? []).map((s, j) => `　${j + 1}) ${s}`),
    ]),
    text_014: `${org} 대표`,
  };
  if (atts.length) {
    v["붙임"] = atts.map((a, i) => {
      const head = i === 0 ? `붙임  ${a} 1부.` : `      ${a} 1부.`;
      return i === atts.length - 1 ? `${head}  끝.` : head;
    });
  }
  return v;
}

/**
 * full: 표지 + 목차(제목 홀수슬롯, 페이지 짝수슬롯은 build_full이 자동 산출) +
 * 6장 제목 + 본문(절□-항목○-세부−-주석※ 1:1:1:1, 최대 12세트). build_full.py로 빌드.
 */
export function buildValuesFull(data: DocFull, orgName?: string): Record<string, unknown> {
  const { long } = nowMeta();
  const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ"];
  const PAD2 = (n: number) => String(n).padStart(2, "0");
  const chapters = data.chapters.slice(0, 6);
  const v: Record<string, unknown> = {
    text_002: data.title,
    text_001: data.subtitle ?? `- ${data.title} -`,
    보고일: data.date || long,
    기관명: orgDocLabel(orgName),
    본부부서명: data.department || "○○부서",
  };

  // 목차 슬롯 구조(build_full.py CHAPTER_SLOTS/CHAPTER_SECTION_SLOTS와 동일): 장=대제목
  // 슬롯(굵게)·절=소제목 슬롯(보통). 순차가 아니라 이 자리에 맞춰야 서식이 정합한다.
  const TOC_CHAP_SLOTS = [1, 3, 13, 21, 33, 43];
  const TOC_SEC_SLOTS = [[], [5, 7, 9, 11], [15, 17, 19], [23, 25, 27, 29, 31], [35, 37, 39, 41], [45, 47, 49, 51]];
  const usedToc = new Set<number>();
  const setToc = (n: number, s: string) => { v[`목차_항목_${String(n).padStart(3, "0")}`] = s; usedToc.add(n); };
  // 본문 절 슬롯 분포(skeleton 고정): 장1→001, 장2→002·003 … 장6→011·012.
  const CHAPTER_SEC_SLOTS = [[1], [2, 3], [4, 5], [6, 7], [8, 9, 10], [11, 12]];
  chapters.forEach((c, ci) => {
    v[`장${PAD2(ci + 1)}_제목`] = ` ${c.heading}`;
    if (TOC_CHAP_SLOTS[ci]) setToc(TOC_CHAP_SLOTS[ci], `${ROMAN[ci]}. ${c.heading}`); // 목차 장 → 대제목 슬롯
    const tocSec = TOC_SEC_SLOTS[ci] ?? [];
    const slots = CHAPTER_SEC_SLOTS[ci] ?? [];
    // 원칙: 절이 1개뿐인 장은 목차에 절을 표기하지 않는다(단일 소제목 = 장 제목과 중복).
    // Ⅰ장은 양식상 목차 절 슬롯이 없어(tocSec=[]) 어차피 미표기 → 1절 추진배경과 자연 정합.
    const showSecInToc = c.sections.length >= 2;
    // 본문 렌더 상한 = 목차 용량(소제목 슬롯 수)과 일치시켜 목차=본문 절 수를 맞춘다.
    // 고정 본문 □ 슬롯(slots, 장당 1~3)을 넘는 절은 장N_추가절 배열로 모아 동적 삽입.
    const bodyCap = Math.max(slots.length, tocSec.length);
    const extraSecs: string[] = [];
    c.sections.forEach((s, si) => {
      if (showSecInToc && si < tocSec.length) setToc(tocSec[si], `  ${si + 1}. ${s.title}`); // 목차 절 → 소제목 슬롯(2절 이상일 때만)
      if (si >= bodyCap) return; // 목차 용량 초과 절은 본문에서도 생략(목차=본문 일치)
      // ◦ 항목 + (선택)세부/주석을 한 배열로 → 마커·전각공백 계단은 여기서 직접 부여.
      const secItems = s.items.map((it) => `◦ ${it}`);
      if (s.detail) secItems.push(`　- ${s.detail}`); // 전각1 안쪽
      if (s.note) secItems.push(`　　※ ${s.note}`); // 전각2 안쪽
      if (si < slots.length) {
        // 고정 □ 슬롯: apply_full_expansion이 ◦항목을 □ 절 직후에 paraPr38 동적단락으로 삽입.
        const n = String(slots[si]).padStart(3, "0");
        v[`본문_절_${n}`] = `□ ${s.title}`;
        v[`절${slots[si]}_항목`] = secItems;
      } else {
        // 슬롯 초과 절: □ 제목 + ◦항목을 한 배열로 누적 → 마지막 □ 슬롯 뒤에 동적 삽입.
        extraSecs.push(`□ ${s.title}`, ...secItems);
      }
    });
    if (extraSecs.length) v[`장${ci + 1}_추가절`] = extraSecs;
  });
  // 추진일정 등 '표로 정리할 내용'이 있으면 일정표(구분/일정/내용)를 알맞은 장 끝에 동적 배치.
  // 배치 장 = 추진/계획/전략 키워드 매칭(없으면 마지막 장)의 마지막 채운 절 슬롯 뒤. 없으면 표 미표출.
  // 경량 모델이 일정/내용을 '추후 결정'·'미정' 같은 빈칸채우기로 내놓으면 미완성 표가 되므로
  // 그런 행은 버리고, 실제 내용 행이 2개 미만이면 표 자체를 만들지 않는다.
  const PLACEHOLDER = /미정|추후|명시\s*필요|미\s*확정|결정\s*예정|별도\s*협의|해당\s*없음|TBD|N\/?A/i;
  const sched = (data.schedule ?? []).filter((r) => !PLACEHOLDER.test(r.일정) && !PLACEHOLDER.test(r.내용));
  if (sched.length >= 2) {
    const planIdx = chapters.findIndex((c) => /계획|전략|방안|로드맵|실행|이행|일정|단계별/.test(c.heading)); // '추진배경'(배경) 오매칭 회피
    const tci = planIdx >= 0 ? planIdx : chapters.length - 1;
    const tslots = CHAPTER_SEC_SLOTS[tci] ?? [];
    const filledN = Math.min(chapters[tci].sections.length, tslots.length);
    const lastSlot = tslots[Math.max(0, filledN - 1)] ?? tslots[0];
    if (lastSlot) {
      v["일정표_anchor"] = `본문_절_${String(lastSlot).padStart(3, "0")}`;
      v["일정표_rows"] = sched.slice(0, 4).map((r) => [r.구분, r.일정, r.내용]);
    }
  }
  // 본문_항목/세부/주석 슬롯은 미사용(○ 항목은 절N_항목 배열로 □ 절 직후에 동적 삽입) →
  // EMPTY_MARKER 로 비워 fill_skeleton이 빈 단락을 제거.
  const EMPTY_MARKER = "​​__EMPTY_PLACEHOLDER__​​";
  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(3, "0");
    v[`본문_항목_${n}`] = EMPTY_MARKER;
    v[`본문_세부_${n}`] = EMPTY_MARKER; // 세부/주석은 절N_항목 배열로 흡수 → 슬롯은 항상 비움
    v[`본문_주석_${n}`] = EMPTY_MARKER;
  }
  // 미사용 목차_항목 슬롯(채우지 않은 제목·페이지 칸)을 EMPTY_MARKER로 → 빈 점선 단락 제거.
  for (let t = 1; t <= 52; t += 2) {
    if (!usedToc.has(t)) {
      v[`목차_항목_${String(t).padStart(3, "0")}`] = EMPTY_MARKER;
      v[`목차_항목_${String(t + 1).padStart(3, "0")}`] = EMPTY_MARKER;
    }
  }
  return v;
}

// ── 미리보기·이메일 텍스트 렌더 ─────────────────────────────

export function renderEmailText(data: DocEmail): string {
  return `제목: ${data.subject}\n\n${data.body}`;
}

export function renderPreview(format: DocFormat, data: DocData, orgName?: string): string {
  switch (format) {
    case "email":
      return renderEmailText(data as DocEmail);
    case "gongmun": {
      const d = data as DocGongmun;
      return [
        `수신: ${d.receiver}`,
        `제목: ${d.title}`,
        "",
        d.opening,
        ...d.items.flatMap((it, i) => [
          `${"가나다라마바사아"[i] ?? "·"}. ${it.text}`,
          ...(it.subs ?? []).map((s, j) => `  ${j + 1}) ${s}`),
        ]),
        ...(d.attachments?.length ? ["", `붙임: ${d.attachments.join(", ")}`] : []),
        "",
        `${orgDocLabel(orgName)} 대표`,
      ].join("\n");
    }
    case "press": {
      const d = data as DocPress;
      return [
        "[보도자료]",
        d.title,
        ...d.subtitles.map((s) => `- ${s}`),
        "",
        ...d.body.map((b) => `${b.level} ${b.text}`),
        "",
        `□ ${d.quote.speaker}는 “${d.quote.part1}”며, “${d.quote.part2}”고 말했다.`,
        ...(d.photoCaptions?.length ? ["", ...d.photoCaptions.map((c) => `▲ ${c}`)] : []),
      ].join("\n");
    }
    case "full": {
      const d = data as DocFull;
      return [
        d.title,
        ...(d.subtitle ? [d.subtitle] : []),
        "",
        "【보고내용 요약】",
        ...d.summary.map((s) => `  · ${s}`),
        "",
        ...d.chapters.flatMap((c, i) => [
          `${ROMAN[i] ?? ""}. ${c.heading}`,
          ...c.sections.flatMap((s) => [`  ${s.title}`, ...s.items.map((it) => `    - ${it}`)]),
          "",
        ]),
      ].join("\n");
    }
    default: {
      const d = data as Doc1p;
      return [
        d.title,
        ...(d.subtitle ? [d.subtitle] : []),
        "",
        `▣ ${d.summary}`,
        "",
        ...d.sections.flatMap((s) => [`□ ${s.heading}`, ...s.items.map((i) => `  ○ ${i}`), ""]),
      ].join("\n");
    }
  }
}
