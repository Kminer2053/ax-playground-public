/**
 * A 기준표 행 명제화 — 표(마크다운 파이프)를 행 단위 문장으로 풀어낸 '해석 블록' 생성.
 *
 * 평탄화된 표(2단 병합 헤더가 데이터행으로 밀림, rowspan 붕괴)는 LLM도 검색도 행·열 대응을
 * 복원하지 못한다. 여기서 규칙으로 복원해 `tableGloss`(별도 필드)에 저장하면:
 *  - 조문 선택(scoreArticleForQuery)·발췌(buildSnippetFromArticles)·임베딩이 문장 명제로 매칭
 *  - 원문(fullText)은 그대로 — 재적재 diff·srcHash·관리자 원문 표시 불변, 롤백은 $unset
 *
 * 파서 3종(규칙 기반, LLM 미사용 — 폐쇄망 자급·재현 가능):
 *  A 전결표: ○섹션 + [업무내용|전결권자] 헤더 + 직급행 + ● 위치 → "업무 → 직급 전결"
 *  B 양정표: 비위유형 행 × 비위정도 열 → "유형: 정도→처분; …"
 *  C 매핑표: 헤더행 × 데이터행 → "첫셀: 헤더=값, …"
 * 한글 금액(삼천만원)은 아라비아 병기(삼천만원(3천만원))로 질의 표기와 매칭시킨다.
 */

const KOR_DIGIT: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };

/** 한글 수사 금액 → 만원 단위 값. 해석 불가 시 null */
function korAmountToManwon(s: string): number | null {
  // 예: 삼천만원=3000, 일백만원=100, 오십만원=50, 일억원=10000, 일억오천만원=15000
  let rest = s.replace(/원$/, "");
  let total = 0;
  const eok = rest.match(/^([일이삼사오육칠팔구]?)억/);
  if (eok) {
    total += (eok[1] ? KOR_DIGIT[eok[1]] : 1) * 10000;
    rest = rest.slice(eok[0].length);
  }
  if (rest) {
    if (!/만$/.test(rest)) return total > 0 && rest === "" ? total : null;
    rest = rest.replace(/만$/, "");
    let man = 0;
    const m = rest.match(/^([일이삼사오육칠팔구]?)천?([일이삼사오육칠팔구]?)백?([일이삼사오육칠팔구]?)십?([일이삼사오육칠팔구]?)$/);
    if (!m) return null;
    const [, ch, b, sip, il] = m;
    if (/천/.test(rest)) man += (ch ? KOR_DIGIT[ch] : 1) * 1000;
    if (/백/.test(rest)) man += (b ? KOR_DIGIT[b] : ch && !/천/.test(rest) ? KOR_DIGIT[ch] : 1) * 100;
    if (/십/.test(rest)) man += (sip ? KOR_DIGIT[sip] : 1) * 10;
    if (il) man += KOR_DIGIT[il];
    if (man === 0 && rest && KOR_DIGIT[rest]) man = KOR_DIGIT[rest];
    total += man;
  }
  return total > 0 ? total : null;
}

/** 만원 값 → 관용 표기(질의에서 쓰는 형태): 300→"300만원", 3000→"3천만원", 10000→"1억원", 15000→"1억5천만원" */
function manwonToLabel(v: number): string {
  if (v >= 10000) {
    const e = Math.floor(v / 10000);
    const r = v % 10000;
    return r === 0 ? `${e}억원` : r % 1000 === 0 ? `${e}억${r / 1000}천만원` : `${e}억${r}만원`;
  }
  if (v >= 1000 && v % 1000 === 0) return `${v / 1000}천만원`;
  return `${v}만원`;
}

/** 텍스트 속 한글 금액을 아라비아 표기로 모아 행끝 별첨을 만든다: "삼천만원 초과 오천만원 이하" → " (금액: 3천만원·5천만원)"
 *  본문에 인라인 병기를 섞으면 원문 문자열이 끊겨 발췌·인용·근거 대조가 깨지므로 별첨 방식만 사용.
 *  한글 수사로 시작하는 완전한 금액만 해석 — "3천만원"의 부분("천만원") 재해석 오염 방지. */
export function amountNote(text: string): string {
  const found: string[] = [];
  text.replace(/[일이삼사오육칠팔구][억천백십일이삼사오육칠팔구만]*원/g, (m) => {
    const v = korAmountToManwon(m);
    if (v) {
      const label = manwonToLabel(v);
      if (!found.includes(label)) found.push(label);
    }
    return m;
  });
  return found.length ? ` (금액: ${found.join("·")})` : "";
}

type Row = string[];

function parseRows(fullText: string): Row[] {
  return fullText
    .split("\n")
    .filter((l) => l.trimStart().startsWith("|"))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.replace(/<br\s*\/?>/gi, " ").trim()));
}

const isSep = (r: Row) => r.every((c) => /^-{2,}$/.test(c) || c === "");
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^-{2,}$/, "").trim();

/* ── A. 전결표 ───────────────────────────────────────────── */

function isApprovalTable(fullText: string): boolean {
  return /\|\s*업무\s*내용\s*\|\s*전결권자\s*\|/.test(fullText) && /●/.test(fullText);
}

function glossApproval(fullText: string): string[] {
  const out: string[] = [];
  let section = "";
  let field = ""; // 분야(rowspan 첫 셀: 기획조정·재무회계 등)
  let ranks: string[] = []; // 직급행
  let expectRanks = false;

  for (const line of fullText.split("\n")) {
    const t = line.trim();
    const sec = t.match(/^○\s*(.+?)(?:\s*<.*)?$/);
    if (sec) { section = clean(sec[1]); field = ""; ranks = []; continue; }
    if (!t.startsWith("|")) continue;
    const cells = t.split("|").slice(1, -1).map((c) => c.replace(/<br\s*\/?>/gi, " ").trim());
    if (isSep(cells)) continue;
    if (/^업무\s*내용$/.test(cells[0] ?? "")) { expectRanks = true; continue; } // 헤더 → 다음 유효행=직급행
    if (expectRanks) {
      ranks = cells.filter((c) => c && c !== "-");
      expectRanks = false;
      continue;
    }
    if (!cells.some((c) => /●/.test(c))) continue; // 빈 항목(2. / 3.)·비데이터행
    // 분야 셀(첫 셀이 "숫자." 시작이 아니고 ●도 아님) → 갱신 + 시프트
    let shift = 0;
    if (cells[0] && !/^\d+\./.test(cells[0]) && !/●/.test(cells[0])) { field = clean(cells[0]); shift = 1; }
    else if (cells[0] && /^\d+\./.test(cells[0])) { /* 분야 rowspan 연속 행 */ }
    const work = clean((cells[shift] ?? "").replace(/^\d+\.\s*/, ""));
    if (!work) continue;
    const dotIdx = cells.findIndex((c, i) => i > shift && /●/.test(c));
    if (dotIdx < 0) continue;
    const rank = ranks[dotIdx - shift - 1] ?? ranks[ranks.length - 1] ?? "";
    if (!rank) continue;
    const scope = section ? `[${section}${field ? "·" + field : ""}] ` : "";
    out.push(`- ${scope}${work} → ${rank} 전결${amountNote(work)}`);
  }
  return out;
}

/* ── B. 양정표 ───────────────────────────────────────────── */

const PUNISH = /파면|해임|정직|감봉|견책/;

function isDisciplineTable(rows: Row[]): boolean {
  if (!rows.length) return false;
  const head = rows[0].join(" ");
  return /비위/.test(head) && rows.some((r) => r.some((c) => PUNISH.test(c)));
}

function glossDiscipline(rows: Row[]): string[] {
  const out: string[] = [];
  const heads = rows[0].slice(1).map((h) => clean(h).slice(0, 60)).filter(Boolean);
  for (const r of rows.slice(1)) {
    if (isSep(r)) continue;
    const label = clean(r[0] ?? "");
    const vals = r.slice(1);
    if (!label && !vals.some((v) => PUNISH.test(v))) continue;
    if (/^\d+\.\s/.test(label) && !vals.some((v) => v)) { out.push(`- ${label} (하위 항목별 기준)`); continue; }
    const pairs: string[] = [];
    vals.forEach((v, i) => {
      const vv = clean(v);
      if (!vv) return;
      pairs.push(heads[i] ? `${heads[i]} → ${vv}` : vv);
    });
    if (!pairs.length) continue;
    // rowspan 붕괴 행(라벨 없이 값만)은 원행 그대로 문장화 — 잘못된 열 대응 단정 방지
    const line = label ? `- ${label}: ${pairs.join("; ")}` : `- (앞 행에 이어짐) ${pairs.join("; ")}`;
    out.push(line + amountNote(line));
  }
  return out;
}

/* ── C. 일반 매핑표(구분|기준, 평가군, 배분표 등) ─────────── */

function glossMapping(rows: Row[]): string[] {
  if (rows.length < 2) return [];
  const heads = rows[0].map(clean);
  const out: string[] = [];
  let prevLabel = "";
  for (const r of rows.slice(1)) {
    if (isSep(r)) continue;
    const label0 = clean(r[0] ?? "");
    const label1 = heads.length > 2 ? clean(r[1] ?? "") : "";
    const label = [label0 || prevLabel, label1].filter(Boolean).join(" ");
    prevLabel = label0 || prevLabel;
    const pairs: string[] = [];
    r.slice(label1 ? 2 : 1).forEach((v, i) => {
      const vv = clean(v);
      if (!vv || vv === "-") return;
      const h = heads[i + (label1 ? 2 : 1)];
      pairs.push(h ? `${h}=${vv}` : vv);
    });
    if (!label || !pairs.length) continue;
    const line = `- ${label}: ${pairs.join(", ")}`;
    out.push(line + amountNote(line));
  }
  return out;
}

/* ── 디스패처 ────────────────────────────────────────────── */

const GLOSS_MAX = 14000; // 청크당 안전 캡(위임전결 12.9k 별표 ≈ 180행 명제)

/** A 기준표 청크 → 해석 블록(행 명제 목록). 표가 없거나 명제 3개 미만이면 null(무리한 생성 방지) */
export function buildTableGloss(name: string, fullText: string): string | null {
  const text = fullText ?? "";
  const rows = parseRows(text);
  if (rows.length < 3) return null;

  let lines: string[];
  if (isApprovalTable(text)) lines = glossApproval(text);
  else if (isDisciplineTable(rows)) lines = glossDiscipline(rows);
  else lines = glossMapping(rows);

  lines = lines.filter((l) => l.length > 8);
  if (lines.length < 3) return null;
  let body = lines.join("\n");
  if (body.length > GLOSS_MAX) body = body.slice(0, GLOSS_MAX) + "\n…[해석 생략]…";
  return body;
}

/** 토큰(아라비아 "3천만원"·"500만원" 또는 한글 "삼천만원")을 만원 단위 값으로. 금액 아니면 null.
 *  접미 잔여("1200만원짜라"·"3천만원어치" 같은 오타·조사)는 무시 — 프리픽스로 인식한다. */
function tokenAmountManwon(tok: string): number | null {
  const t = tok.replace(/\s+/g, "");
  let m = t.match(/^(\d+(?:\.\d+)?)억원?(?![0-9])/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  m = t.match(/^(\d+)천만원?(?![0-9])/);
  if (m) return parseInt(m[1], 10) * 1000;
  m = t.match(/^(\d+)백만원?(?![0-9])/);
  if (m) return parseInt(m[1], 10) * 100;
  m = t.match(/^(\d+)만원(?![0-9])/);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^([일이삼사오육칠팔구억천백십만]+원)/);
  if (m) return korAmountToManwon(m[1]);
  return null;
}

/** 질의 금액이 명제 행의 주 구간("A 초과/이상 B 이하/미만" 또는 단독 경계)에 산술적으로 포함되는가.
 *  "3천만원 물품"은 문자열로는 "이천만원 초과 오천만원 이하" 행과 못 만난다 — 구간 판정으로 잇는다. */
export function amountInLineRange(lineRaw: string, qManwon: number): boolean {
  // 행 앞부분(주 구간)만 평가 — 뒤쪽 단서(단, 학술연구 3천만원 미만…)로 오판하지 않게 경계 2개까지
  const bounds: { v: number; op: string }[] = [];
  const re = /([일이삼사오육칠팔구억천백십만\d]+(?:억|천만|백만|십만|만)?원)\s*(초과|이상|이하|미만)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineRaw)) && bounds.length < 2) {
    const v = tokenAmountManwon(m[1]) ?? korAmountToManwon(m[1]);
    if (v) bounds.push({ v, op: m[2] });
  }
  if (!bounds.length) return false;
  let lo = -Infinity, hi = Infinity, loOpen = false, hiOpen = false;
  for (const b of bounds) {
    if (b.op === "초과") { lo = b.v; loOpen = true; }
    else if (b.op === "이상") { lo = b.v; }
    else if (b.op === "이하") { hi = b.v; }
    else { hi = b.v; hiOpen = true; } // 미만
  }
  if (lo > hi) return false; // 서로 다른 구간의 경계가 섞임 — 판정 포기(오판 방지)
  // 경계값 질의는 열린 경계(초과/미만)도 포함으로 판정 — "2000만원 넘는 건" 질의에서
  // 정답 행("이천만원 초과 …")이 2000 == 경계라는 이유로 탈락하지 않게. 인접 행이 같이 실리는
  // 것은 감수(경계 질의는 양쪽 행을 함께 보여주는 쪽이 답변에 안전하다).
  void loOpen; void hiOpen;
  return qManwon >= lo && qManwon <= hi;
}

/** gloss에서 질의 토큰 히트 행만 상위 n개 추출(발췌 부착용) — 히트 수 내림차순, 총 charCap 이내 */
export function pickGlossLines(gloss: string | undefined, tokens: string[], n = 4, charCap = 520): string[] {
  if (!gloss) return [];
  const toks = tokens.filter((t) => t.length >= 2).map((t) => t.toLowerCase());
  if (!toks.length) return [];
  // 질의 속 숫자는 표에서 행을 특정하는 강신호(조직단위 '8', '100만원' 등) — 단어 경계 일치 시 가산
  const nums = [...new Set(toks.join(" ").match(/\d+/g) ?? [])];
  // 질의 금액(첫 번째) — 행 구간 산술 판정용
  const qAmount = toks.map(tokenAmountManwon).find((v): v is number => v != null) ?? null;
  const scored = gloss
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const low = l.toLowerCase().replace(/\s+/g, "");
      let hits = 0;
      for (const t of toks) {
        const tc = t.replace(/\s+/g, "");
        if (low.includes(tc)) hits += 2;
        else if (tc.length >= 3 && low.includes(tc.slice(0, 2))) hits += 1; // 활용형("전결하나요")→어근 2자 완화
      }
      for (const n of nums) if (new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(low)) hits += 2;
      if (qAmount != null && amountInLineRange(l, qAmount)) hits += 4; // 구간 산술(500만원 ∈ "1천만원 이하") — 문자열보다 강한 신호
      return { l, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const out: string[] = [];
  let total = 0;
  for (const { l } of scored) {
    if (out.length >= n || total + l.length > charCap) break;
    out.push(l);
    total += l.length;
  }
  return out;
}
