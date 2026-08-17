import type { IndustryRule, AdCriteria } from "@/lib/ad-rules";
import { orgLabel } from "@/lib/org";

/** 잘린 JSON best-effort 복구 — 첫 '{'부터 마지막 안전 지점까지 취해 열린 괄호를 닫는다(부분 결과라도 살림). */
function repairTruncatedJson(s: string): Record<string, unknown> | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  const body = s.slice(start);
  // 값/구조가 완결된 마지막 안전 지점(닫는 괄호·숫자·문자열 끝)
  let inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "}" || c === "]") lastSafe = i; // 완결된 구조의 끝(닫는 괄호)에서만 자른다
  }
  if (lastSafe < 0) return null;
  let cut = body.slice(0, lastSafe + 1).replace(/,\s*$/, "");
  // 안전 지점까지 열린 괄호 재계산 후 역순으로 닫기
  const open: string[] = [];
  inStr = false; esc = false;
  for (let i = 0; i < cut.length; i++) {
    const c = cut[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") open.push(c);
    else if (c === "}" || c === "]") open.pop();
  }
  for (let i = open.length - 1; i >= 0; i--) cut += open[i] === "{" ? "}" : "]";
  try { const o = JSON.parse(cut); return o && typeof o === "object" ? (o as Record<string, unknown>) : null; } catch { return null; }
}

// ───────── 재설계(품질 우선): 텍스트/시각 분리 다단계 심의 ─────────
export type ReviewLevel = "이상없음" | "확인필요" | "위반의심";
const LV = `"이상없음"|"확인필요"|"위반의심"`;

export type RuleScan = { riskHits: string[]; missingNotices: string[]; prohibitedHits: string[] };

/** OCR 문구 ↔ 룰 결정론적 대조 — 위험표현·필수고지문구 누락·금지목록 매칭(확실한 신호). */
export function scanRules(ocrText: string, rule: IndustryRule | null, prohibitedList: string[]): RuleScan {
  const t = ocrText.replace(/\s+/g, "").toLowerCase();
  const has = (kw: string) => { const k = kw.replace(/\s+/g, "").toLowerCase(); return k.length >= 2 && t.includes(k); };
  return {
    riskHits: (rule?.riskExpressions ?? []).filter(has),
    missingNotices: (rule?.requiredNotices ?? []).filter((n) => !has(n)),
    prohibitedHits: prohibitedList.filter(has),
  };
}

/** 텍스트 패스 — 문구 적정성·업종 고지문구·금지의심(3단계). OCR+룰 대조를 근거로, 이미지로 OCR 오인 보정. orgName 미지정 시 "우리 기관" 폴백. */
export function buildTextReviewPrompt(criteria: AdCriteria, industry: string, rule: IndustryRule | null, ocrText: string, scan: RuleScan, orgName?: string | null): string {
  const prohibited = criteria.prohibitedList.length ? criteria.prohibitedList.join(", ") : "담배·전자담배, 카지노·도박·복권, 음란물, 무기, 종교포교, 정당·정치, 점술, 유흥주점, 불법안마, 무인가 금융, 기부금품";
  const ruleInfo = rule
    ? `\n[업종 ${industry} (${rule.category})${rule.basis ? ` · 근거 ${rule.basis}` : ""}]\n- 위험·주의 표현: ${rule.riskExpressions.join(", ") || "(없음)"}\n- 필수 고지문구: ${rule.requiredNotices.join(" / ") || "(없음)"}`
    : `\n[업종] 미선택 — 일반 기준으로 점검`;
  return (
    `당신은 ${orgLabel(orgName)} 옥외·매장 광고 도안심의 보조 AI입니다. 첨부 도안과 아래 근거로 '텍스트' 항목만 판정하세요(시각 판정은 별도이니 하지 마세요).\n` +
    `[판정 항목 3가지]\n· 문구 적정성 — 허위·과장·무근거 최상급('100%','최고','부작용 없음' 등)·소비자 오인(제10·12·20조)\n· 업종 필수 고지문구 — 업종 의무 표기 누락(제3장)\n· 금지의심 — 금지광고 대상: ${prohibited}\n` +
    `[수준 3단계] ${LV} — (위반의심)무근거 최상급·확실한 허위·필수문구 확실 누락·금지대상 / (확인필요)소지 있으나 맥락 판단 필요 / (이상없음)해당 없음.\n` +
    `[자동 대조(OCR↔룰)] 도안 내 위험표현=${scan.riskHits.join(", ") || "없음"} · 누락 의심 필수문구=${scan.missingNotices.join(" / ") || "없음"} · 금지 매칭=${scan.prohibitedHits.join(", ") || "없음"}\n` +
    `[규칙] (1)위 자동 대조는 OCR 기반 사실이니 신뢰하되, 이미지로 재확인해 'OCR이 있는 문구를 누락으로 본' 오인은 바로잡아라. (2)판정마다 '근거룰'에 적용 룰·조항·매칭 표현을 적어라(예: "제12조 · '100% 보장' 무근거 최상급"). (3)이상없음이면 의견·근거룰·근거문구 빈 값. (4)'확인필요'·'위반의심' 판정이 도안의 특정 문구 때문이면 수준과 무관하게 반드시 '근거문구'에 그 문구를 OCR에서 글자 그대로 적어라(도안 위 위치 핀 표시에 쓰임). 단, 고지문구 '누락'처럼 도안에 없는 것이 사유면 근거문구는 비워라(위치 표기 불가). (5)JSON 한 줄(코드펜스·설명 금지).` +
    ruleInfo +
    `${criteria.criteriaText ? `\n[심의기준]\n${criteria.criteriaText.slice(0, 1400)}` : ""}` +
    `${ocrText ? `\n[OCR 문구]\n${ocrText.slice(0, 1400)}` : ""}\n` +
    `[출력형식]{"문구적정성":{"수준":${LV},"근거룰":"","의견":"","근거문구":""},"업종고지문구":{"추정업종":"","수준":${LV},"근거룰":"","의견":"","근거문구":""},"금지의심":{"해당":false,"사유":"","근거룰":""}}\n※ 첨부 도안을 직접 분석해 위 JSON 하나만 출력.`
  );
}

/** 시각 패스 — 이미지·배경·저작권/초상권(2단계). 룰이 정의한 확인대상 시각요소가 도안에 보이는지만. orgName 미지정 시 "우리 기관" 폴백. */
export function buildVisualReviewPrompt(orgName?: string | null): string {
  return (
    `당신은 ${orgLabel(orgName)} 옥외·매장 광고 도안심의 보조 AI입니다. 첨부 도안의 '시각' 항목만, 아래 [확인대상 시각요소]가 도안에 실제로 보이는지만 점검하세요. 외부 정보·맥락 추측 금지 — 보이면 "확인필요", 안 보이면 "이상없음"(2단계).\n` +
    `[판정 항목 2가지]\n· 이미지·배경 적정성 — 폭력·혐오·과도노출·선정성, 자극적 색채, 부적절 상징물(욱일기 연상 방사형 배경 등), 안전운행 저해(제7·9·10·22조)\n· 저작권·초상권 — 타인 저작물·캐릭터·로고·상표, 연예인/일반인 사진(무단 사용 의심)(제15·16조)\n` +
    `[규칙] (1)해당 요소가 도안에 '실제로 보일 때만' 확인필요. 추측·일반론 금지(안 보이면 이상없음). (2)'근거룰'에 무엇이 보였는지+조항(예: "제9조 · 방사형 배경 욱일기 연상"). (3)'위치'는 3×3 격자칸(좌상·중상·우상·좌중·중앙·우중·좌하·중하·우하) 또는 배경 전반이면 "전체". (4)이상없음이면 빈 값. (5)JSON 한 줄.\n` +
    `[출력형식]{"이미지배경":{"수준":"이상없음"|"확인필요","근거룰":"","의견":"","위치":""},"저작권초상권":{"수준":"이상없음"|"확인필요","근거룰":"","의견":"","위치":""}}\n※ 첨부 도안을 직접 보고 위 JSON 하나만 출력.`
  );
}

/** 임의 JSON 객체 추출(+잘림 복구) — 패스별 응답 파싱용. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const s = String(text).replace(/```json/gi, "").replace(/```/g, "");
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { try { return JSON.parse(s.slice(start, i + 1)) as Record<string, unknown>; } catch { start = -1; } } }
  }
  try { const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>; } catch { /* skip */ }
  return repairTruncatedJson(s);
}

/**
 * 텍스트 패스 + 시각 패스 결과를 표준 4분야 결과로 병합.
 * 패스가 실패(null)하거나 항목이 빠지면 '분석보류'로 표기한다 — 실패를 '이상없음'(초록)으로 위장하면
 * 시각 위반을 놓쳐도 통과돼 위험하므로, 분석 못 한 항목은 명시적으로 보류 처리해 수동 확인을 유도한다.
 */
export function mergeReview(text: Record<string, unknown> | null, visual: Record<string, unknown> | null, ocrLines: { text: string }[]): Record<string, unknown> {
  const HOLD = "분석보류";
  const HOLD_MSG = "AI가 이 항목을 분석하지 못했습니다(보류) — 수동 확인이 필요합니다.";
  const g = (o: Record<string, unknown> | null, k: string): Record<string, unknown> | null => (o && typeof o[k] === "object" && o[k] ? (o[k] as Record<string, unknown>) : null);
  const lv = (o: Record<string, unknown> | null) => { const v = String(o?.수준 ?? ""); return v === "확인필요" || v === "위반의심" || v === "이상없음" ? v : null; };
  const mun = g(text, "문구적정성"), goji = g(text, "업종고지문구"), geum = g(text, "금지의심");
  const img = g(visual, "이미지배경"), copy = g(visual, "저작권초상권");
  // passFailed: 해당 패스 자체가 null(JSON 파싱 2회 실패) → 분야 전체 보류. 객체는 왔지만 수준이 없으면 그 항목만 보류.
  const fld = (분류: string, src: Record<string, unknown> | null, passFailed: boolean, extra: Record<string, unknown> = {}) => {
    const 수준 = passFailed ? HOLD : (lv(src) ?? HOLD);
    const hold = 수준 === HOLD;
    const ok = 수준 === "이상없음"; // 이상없음이면 근거·의견·위치 비움(모델이 빈 값 규칙을 어겨도 결과를 깨끗하게)
    const blank = ok || hold;
    return { 분류, 수준, 근거룰: blank ? "" : String(src?.근거룰 ?? ""), 관련조항: "", 의견: hold ? HOLD_MSG : ok ? "" : String(src?.의견 ?? ""), 위치: blank ? "" : String(src?.위치 ?? ""), 근거문구: blank ? "" : String(src?.근거문구 ?? ""), ...extra };
  };
  const 분야 = [
    fld("문구 적정성", mun, text === null),
    fld("이미지·배경 적정성", img, visual === null),
    fld("업종 필수 고지문구", goji, text === null, { 추정업종: String(goji?.추정업종 ?? "") }),
    fld("저작권·초상권", copy, visual === null),
  ];
  const 금지의심 = { 해당: geum?.해당 === true, 사유: String(geum?.사유 ?? ""), 근거룰: String(geum?.근거룰 ?? "") };
  const warn = 분야.filter((f) => f.수준 !== "이상없음");
  const red = 분야.some((f) => f.수준 === "위반의심") || 금지의심.해당;
  const holdN = 분야.filter((f) => f.수준 === HOLD).length;
  const 종합메모 = warn.length
    ? `${red ? "위반의심 포함 " : ""}점검 ${warn.length}건: ${warn.map((f) => `${f.분류}(${f.수준})`).join(", ")}.${금지의심.해당 ? " 금지광고 의심." : ""}${holdN ? ` (분석보류 ${holdN}건 — 수동 확인 필요)` : ""}`
    : "4개 분야 모두 이상없음.";
  return { 분야, 금지의심, 추출텍스트: ocrLines.map((l) => l.text), 종합메모 };
}

/** LLM JSON이 깨져 '업종 필수 고지문구'가 분석보류일 때 OCR↔룰 결정론(scan)으로 보완. */
export function applyGojiScanFallback(
  result: Record<string, unknown>,
  scan: RuleScan,
  rule: IndustryRule | null,
  industryLabel: string,
): void {
  const fields = result.분야 as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(fields)) return;
  const f = fields.find((x) => x.분류 === "업종 필수 고지문구");
  if (!f || f.수준 !== "분석보류") return;
  if (!rule && !scan.missingNotices.length) return;

  const label = industryLabel || String(rule?.industry ?? "").trim();
  if (scan.missingNotices.length > 0) {
    f.수준 = "위반의심";
    f.추정업종 = label || String(f.추정업종 ?? "");
    const tag = rule?.category ? `[${rule.category}] ` : "";
    f.근거룰 = rule?.basis
      ? `${rule.basis} · ${tag}필수 고지문구 누락: ${scan.missingNotices.join(" / ")}`
      : `${tag}필수 고지문구 누락(OCR 대조): ${scan.missingNotices.join(" / ")}`;
    f.의견 = `OCR 대조 결과 도안에 업종 필수 표기가 없습니다: ${scan.missingNotices.join(", ")}.`;
  } else {
    f.수준 = "이상없음";
    f.추정업종 = label || String(f.추정업종 ?? "");
    f.근거룰 = "";
    f.의견 = "";
  }
  f.근거문구 = "";
  f.위치 = "";

  const 금지 = result.금지의심 as { 해당?: boolean } | undefined;
  const 분야 = fields;
  const warn = 분야.filter((x) => x.수준 !== "이상없음");
  const red = 분야.some((x) => x.수준 === "위반의심") || 금지?.해당 === true;
  const holdN = 분야.filter((x) => x.수준 === "분석보류").length;
  result.종합메모 = warn.length
    ? `${red ? "위반의심 포함 " : ""}점검 ${warn.length}건: ${warn.map((x) => `${x.분류}(${x.수준})`).join(", ")}.${금지?.해당 ? " 금지광고 의심." : ""}${holdN ? ` (분석보류 ${holdN}건 — 수동 확인 필요)` : ""}`
    : "4개 분야 모두 이상없음.";
}
