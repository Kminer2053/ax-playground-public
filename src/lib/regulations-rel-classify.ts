/**
 * 관계유형 결정론적 분류기 — GRAPH_SCHEMA.md §2·§3·§8 규칙의 코드화.
 * 출처 조문 텍스트의 트리거 어구로 rt를 우선순위 판정. Opus 일괄·gemma 증분 공용 "규칙층".
 * 규칙으로 못 정하면 conf="하"로 반환 → 호출측이 LLM 검증/검토 큐로 보냄.
 */
export type RelType =
  | "상충·우선" | "준용적용" | "위임" | "서식첨부" | "제재·벌칙" | "예외" | "정의" | "절차" | "근거";
export type RelClass = { rt: RelType; conf: "상" | "중" | "하" };

/** 우선순위 트리거 분류. 순서가 의미를 가짐(상충·우선 최우선 → … → 근거 기본값). */
export function classifyRelType(srcText: string): RelClass {
  const s = String(srcText || "").replace(/\s+/g, " ");

  // 1) 상충·우선 — "…에도 불구하고 …적용/한다", "…에 우선하여" (다른 트리거보다 우선)
  if (/에도\s*불구하고/.test(s) && /(적용|우선|따른|한다|시킬)/.test(s)) return { rt: "상충·우선", conf: "상" };
  if (/우선하여\s*적용|에\s*우선한다|우선\s*적용/.test(s)) return { rt: "상충·우선", conf: "상" };

  // 2) 준용적용 — 명시 트리거만(과용 방지)
  if (/준용(한다|하여|하며|할)|예에\s*따른다|정하지\s*(아니한|않은)\s*사항|기준으로\s*삼|을\s*기준으로/.test(s))
    return { rt: "준용적용", conf: "상" };

  // 3) 위임 — 세부/별도 위임
  if (/에서\s*정하는\s*바|따로\s*정한다|따로\s*정하는|에\s*위임|정한\s*바에\s*따른|이\s*정하는\s*바|에서\s*정한\s*바/.test(s))
    return { rt: "위임", conf: "상" };

  // 4) 서식첨부 — 별표/별지 서식
  if (/별지\s*제?\s*\d+\s*호.*서식|별표\s*제?\s*\d+\s*호|서식에\s*따른|서식으로\s*한다|별표와\s*같다|표준으로\s*하여\s*작성/.test(s))
    return { rt: "서식첨부", conf: "중" };

  // 5) 제재·벌칙 연계 — 위반 → 징계/제재/경고/변상
  if (/위반/.test(s) && /(징계|제재|경고|변상|처벌|해지|손해배상)/.test(s)) return { rt: "제재·벌칙", conf: "중" };

  // 6) 예외 — 제외/단서(한정 "…에 한한다"는 예외 아님 → 근거로 흐름)
  if (/는\s*제외(한다|하며|하고)|그러하지\s*아니하다|예외로\s*한다|적용하지\s*아니한다/.test(s))
    return { rt: "예외", conf: "중" };

  // 7) 정의 — 용어 정의 원용
  if (/용어의?\s*(뜻|정의)|이라\s*함은|이란\b.{0,40}말한다|에\s*따른\s*.{0,12}(정보|자|부서|사원|임원)/.test(s))
    return { rt: "정의", conf: "중" };

  // 8) 절차 — 처리 절차/방법
  if (/절차에?\s*따라|절차를\s*따른다|에\s*정한\s*절차|절차에\s*의하여|에\s*따라\s*(처리|조치|시행)/.test(s))
    return { rt: "절차", conf: "중" };

  // 9) 근거 — 일반 참조 기본값("…에 따라/의하여/근거/규정/정한/한한다")
  if (/에\s*따라|에\s*의하여|에\s*근거|에\s*규정(된|한)|에\s*정한|에\s*의한|에\s*해당|에\s*한한다|에\s*한정/.test(s))
    return { rt: "근거", conf: "중" };

  return { rt: "근거", conf: "하" }; // 트리거 미검출 → 저신뢰(LLM/검토 필요)
}

/**
 * 대상-국소화 분류 — 출처 조문에서 **대상 규정이 언급된 절 주변**만 보고 분류.
 * 한 조문이 여러 규정을 다르게 참조할 때, 이 엣지의 대상과 무관한 트리거(우연한 "별표" 등)를 집는 오류 방지.
 */
/** 출처 조문에서 대상 규정이 언급된 절만 추출(없으면 전체·found=false). */
export function localizeClause(srcText: string, targetTitle: string): { clause: string; found: boolean } {
  const s = String(srcText || "");
  const core = String(targetTitle || "").replace(/\s+/g, "");
  if (core.length >= 2) {
    const flex = core.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
    const re = new RegExp(flex);
    const clauses = s.split(/(?<=다[.)])\s*|\n+|(?=[①-⑩])|(?<=\.)\s+/).map((c) => c.trim()).filter(Boolean);
    const hit = clauses.find((c) => re.test(c));
    if (hit) return { clause: hit, found: true };
    if (re.test(s)) return { clause: s, found: false };
  }
  return { clause: s, found: false };
}

export function classifyRelTypeForTarget(srcText: string, targetTitle: string): RelClass {
  const { clause, found } = localizeClause(srcText, targetTitle);
  const r = classifyRelType(clause);
  return found ? r : { ...r, conf: "하" }; // 대상 절 못 찾으면 저신뢰
}
