/**
 * 한국 PII 탐지 엔진 (presidio Analyzer 동급, 오프라인 정규식 기반).
 * GR1-3 입력 차단 / GR3-1 출력 마스킹이 공통으로 사용.
 * 근거: 국가·공공기관 AI보안 가이드북 v2.0 M13.
 *
 * severity:
 *   - "high"   : 고위험 식별정보 → 입력 단계에서 차단 + 출력 마스킹.
 *   - "medium" : 연락처/식별 보조정보 → 출력 마스킹(기본). 입력 차단 여부는 정책 설정.
 */

export type PiiType =
  | "RRN" // 주민등록번호
  | "FRN" // 외국인등록번호
  | "CARD" // 신용카드번호
  | "ACCOUNT" // 계좌번호(키워드 동반)
  | "BIZNO" // 사업자등록번호
  | "PHONE" // 전화번호(휴대/일반)
  | "EMAIL"; // 이메일

export type PiiSeverity = "high" | "medium";

export type PiiMatch = {
  type: PiiType;
  severity: PiiSeverity;
  value: string;
  index: number;
  length: number;
  /** 치환에 쓸 플레이스홀더 (예: [RRN]). */
  placeholder: string;
};

const PLACEHOLDER: Record<PiiType, string> = {
  RRN: "[RRN]",
  FRN: "[FRN]",
  CARD: "[CARD]",
  ACCOUNT: "[ACCOUNT]",
  BIZNO: "[BIZNO]",
  PHONE: "[PHONE]",
  EMAIL: "[EMAIL]",
};

const SEVERITY: Record<PiiType, PiiSeverity> = {
  RRN: "high",
  FRN: "high",
  CARD: "high",
  ACCOUNT: "high",
  BIZNO: "medium",
  PHONE: "medium",
  EMAIL: "medium",
};

// ── 검증 함수 ──────────────────────────────────────────────

/** 주민등록번호 체크섬 (1990년대~2020.10 이전 발급분). 2020.10 이후 임의발급분은 false일 수 있음. */
export function isValidRrnChecksum(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length !== 13) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * weights[i];
  const check = (11 - (sum % 11)) % 10;
  return check === Number(d[12]);
}

/** 생년월일 유효성 (YYMMDD). 오탐(전화번호 등)을 줄이기 위해 월·일 범위 확인. */
function isPlausibleYymmdd(yymmdd: string): boolean {
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/** 신용카드 Luhn 검증. */
export function isValidLuhn(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ── 패턴 정의 ──────────────────────────────────────────────
// 주의: 순서가 중요. 더 구체적/고위험 패턴을 먼저 매칭해 중복 치환을 방지.

type RawPattern = {
  type: PiiType;
  regex: RegExp;
  /** 매칭 후보를 추가 검증 (체크섬 등). 통과해야 PII로 인정. */
  validate?: (m: RegExpExecArray) => boolean;
};

const PATTERNS: RawPattern[] = [
  // 주민등록번호: YYMMDD-[1-4]나머지. 내국인 성별코드 1~4.
  {
    type: "RRN",
    regex: /\b(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))-?([1-4]\d{6})\b/g,
    validate: (m) => isPlausibleYymmdd(m[1]),
  },
  // 외국인등록번호: 동일 형식, 성별코드 5~8.
  {
    type: "FRN",
    regex: /\b(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))-?([5-8]\d{6})\b/g,
    validate: (m) => isPlausibleYymmdd(m[1]),
  },
  // 신용카드: 4-4-4-4 또는 연속 16자리. Luhn 통과 필수(오탐 차단).
  {
    type: "CARD",
    regex: /\b(?:\d[ -]?){15}\d\b/g,
    validate: (m) => isValidLuhn(m[0]),
  },
  // 사업자등록번호: 3-2-5.
  {
    type: "BIZNO",
    regex: /\b\d{3}-\d{2}-\d{5}\b/g,
  },
  // 휴대전화: 010~019.
  {
    type: "PHONE",
    regex: /\b01[0-9]-?\d{3,4}-?\d{4}\b/g,
  },
  // 일반전화: 02 또는 0XX 지역번호.
  {
    type: "PHONE",
    regex: /\b0(?:2|[3-6][1-5])-?\d{3,4}-?\d{4}\b/g,
  },
  // 계좌번호: "계좌/account/입금" 키워드 동반 시에만(오탐 방지). 숫자-구분 6~16자리.
  {
    type: "ACCOUNT",
    regex: /(?:계좌|account|입금|송금|예금주)[^\d]{0,8}(\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,6})?)/gi,
  },
  // 이메일.
  {
    type: "EMAIL",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
];

/**
 * 텍스트에서 PII를 모두 탐지. 겹치는 매칭은 먼저 탐지된(우선순위 높은) 쪽을 유지.
 */
export function detectPii(text: string): PiiMatch[] {
  const found: PiiMatch[] = [];
  const claimed: Array<[number, number]> = []; // [start, end) 점유 구간

  const overlaps = (start: number, end: number) =>
    claimed.some(([s, e]) => start < e && end > s);

  for (const { type, regex, validate } of PATTERNS) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      // 계좌번호는 캡처그룹(1)이 실제 PII 값. 그 외는 전체 매칭.
      const captureIdx = type === "ACCOUNT" ? 1 : 0;
      const value = m[captureIdx];
      if (value == null) continue;
      const start = m.index + m[0].indexOf(value);
      const end = start + value.length;

      if (validate && !validate(m)) continue;
      if (overlaps(start, end)) continue;

      claimed.push([start, end]);
      found.push({
        type,
        severity: SEVERITY[type],
        value,
        index: start,
        length: value.length,
        placeholder: PLACEHOLDER[type],
      });
      if (m.index === regex.lastIndex) regex.lastIndex++; // zero-length 방지
    }
  }

  return found.sort((a, b) => a.index - b.index);
}

/** 탐지된 PII를 플레이스홀더로 치환 (뒤에서부터 치환해 인덱스 보존). */
export function maskPiiMatches(text: string, matches: PiiMatch[]): string {
  let out = text;
  for (const m of [...matches].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, m.index) + m.placeholder + out.slice(m.index + m.length);
  }
  return out;
}
