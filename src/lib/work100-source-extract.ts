/**
 * 업무100 M2 소스 추출기 — LLM Task 큐레이션에 먹일 결정적 소스 파서.
 *
 * ① 별표 제6호(본사 부서별 분장업무): Dept label로 구획 분할 → {부서: 분장업무 텍스트·항목}.
 *    세로쓰기 헤더·표 구분자 등 노이즈는 정제하되, 항목 정밀 분해는 LLM에 위임(관대 파싱).
 * ② 별표 제1호(전결사항): ○섹션(본부) × 표 → 전결행 {업무·직위·limit·조건·앵커}.
 * ③ 한글 금액 → 정수, limit{min,max,text} 구조화(매니페스트 전결.props.limit 규약).
 *
 * 순수 함수(DB 무관). 원문 fullText를 인자로 받는다.
 */

// ── ③ 한글 금액 파서 ──────────────────────────────────────────
const KO_DIGIT: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const KO_SMALL: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };

/** "이천만원"→20000000, "삼백만원"→3000000, "일억"→100000000. 실패 시 null. */
export function parseKoAmount(s: string): number | null {
  let total = 0;
  let section = 0;
  let num = 0;
  let seen = false;
  for (const ch of s) {
    if (ch in KO_DIGIT) {
      num = KO_DIGIT[ch];
      seen = true;
    } else if (ch in KO_SMALL) {
      section += (num || 1) * KO_SMALL[ch];
      num = 0;
      seen = true;
    } else if (ch === "만") {
      section += num;
      total += section * 10000;
      section = 0;
      num = 0;
      seen = true;
    } else if (ch === "억") {
      section += num;
      total += section * 100000000;
      section = 0;
      num = 0;
      seen = true;
    }
  }
  total += section + num;
  return seen ? total : null;
}

export type Limit = { min: number | null; max: number | null; text: string };
const AMT_REL = /([일이삼사오육칠팔구십백천만억]+)\s*원?\s*(초과|이상|이하|미만)/g;

/** 업무내용 문자열에서 금액 한도 추출. min=초과·이상, max=이하·미만. 없으면 null. */
export function extractLimit(text: string): Limit | null {
  let min: number | null = null;
  let max: number | null = null;
  const parts: string[] = [];
  for (const m of text.matchAll(AMT_REL)) {
    const val = parseKoAmount(m[1]);
    if (val == null) continue;
    if (m[2] === "초과" || m[2] === "이상") min = min == null ? val : Math.max(min, val);
    else max = max == null ? val : Math.min(max, val);
    parts.push(m[0].trim());
  }
  if (min == null && max == null) return null;
  return { min, max, text: parts.join(" ") };
}

// ── ① 별표 제6호 — 부서별 분장업무 구획 분할 ──────────────────
export type DeptDuties = { dept: string; items: string[]; raw: string };

/** 분장업무 항목 끝에 붙어 넘어오는 다음 구획의 본부명(예: "…경영본부"). 기관별 명칭이 달라 일반 패턴으로 처리. */
const HONBU_TAIL = /[가-힣]{2,8}본부\s*$/;
/** 분장업무 항목 꼬리 정제 — 마지막 항목에 붙는 다음 구획 노이즈(표 구분선·세로쓰기 본부명) 제거. */
export function cleanDutyText(raw: string): string {
  let s = raw.replace(/-{2,}/g, " ").replace(/소\s*속|분장업무/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/(?:[가-힣]\s){2,}[가-힣]\s*$/, "").trim(); // 세로쓰기 본부명(경 영 본 부)
  s = s.replace(HONBU_TAIL, "").trim(); // 붙은 본부명
  return s;
}

/**
 * 최말단 부서 label 목록(처·실·센터·단)을 앵커로 별표 제6호를 구획 분할.
 * extraAnchors: 조직축 Dept가 아니지만 별표6에 독립 헤더로 존재하는 하위 조직(예: 자판기센터).
 * 앵커 매칭은 공백 허용(원문의 '디지털미디어 사업단'처럼 label에 없는 공백이 낀 표기 대응).
 * 반환: 부서별 분장업무 항목(관대 분리) + 원문 블록. 미매칭 부서는 결과에서 빠짐(호출부가 대사).
 */
export function parseBunjangEopmu(fullText: string, deptLabels: string[], extraAnchors: string[] = []): DeptDuties[] {
  // 표 구분자·세로쓰기 헤더("소 속"/"분장업무"/본부명 세로) 정제
  const clean = fullText
    .replace(/\|/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/소\s*속|분장업무/g, " ");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const anchorLabels = [...deptLabels.map((l) => l.replace(/\([^)]*\)/g, "").trim()), ...extraAnchors];
  // 각 label을 문자 사이 공백 허용 정규식으로 위치 탐색
  const anchors: { label: string; idx: number; len: number }[] = [];
  for (const label of anchorLabels) {
    const re = new RegExp(label.split("").map(esc).join("\\s*"));
    const m = clean.match(re);
    if (m && m.index != null) anchors.push({ label, idx: m.index, len: m[0].length });
  }
  anchors.sort((a, b) => a.idx - b.idx);
  const out: DeptDuties[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].idx + anchors[i].len;
    const end = i + 1 < anchors.length ? anchors[i + 1].idx : clean.length;
    const block = clean.slice(start, end);
    // 번호 항목 분리: "N." 또는 "N " (점 누락) 시퀀스. 항목 내부 숫자 오인 방지 위해 순차 증가만 채택.
    const items: string[] = [];
    const marks = [...block.matchAll(/(\d+)\s*\.?\s*/g)];
    let expect = 1;
    for (let k = 0; k < marks.length; k++) {
      const n = Number(marks[k][1]);
      if (n !== expect) continue; // 순차(1,2,3…)만 항목 경계로
      const from = marks[k].index! + marks[k][0].length;
      // 다음 순차 번호(expect+1) 위치까지
      let to = block.length;
      for (let j = k + 1; j < marks.length; j++) {
        if (Number(marks[j][1]) === expect + 1) {
          to = marks[j].index!;
          break;
        }
      }
      const text = cleanDutyText(block.slice(from, to));
      if (text) items.push(text);
      expect++;
    }
    out.push({ dept: anchors[i].label, items, raw: block.replace(/\s+/g, " ").trim() });
  }
  return out;
}

// ── ② 별표 제1호 — 전결사항 ───────────────────────────────────
export type JeongyeolRow = {
  section: string; // 본부(본사공통·경영본부 등)
  subsection: string; // 소부서(rowspan 부서명, 예: 총무지원·재무회계). 없으면 ""
  num: number;
  text: string; // 업무내용(전문)
  positions: string[]; // ● 마크된 전결권자 직위(복합열은 분할)
  limit: Limit | null;
  rowText: string; // 원본 행(rowHash 산정용)
};

const POS_WORDS = ["대표이사", "본부장", "실장", "센터장", "처장", "단장", "팀장", "지점장"];

/** 표 행 → 셀 배열. 파이프 양끝의 빈 셀만 제거하고 중간 빈 셀은 위치 보존(● 컬럼 매핑용). */
function splitCells(row: string): string[] {
  const cells = row.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}
function isPositionCell(cell: string): boolean {
  return POS_WORDS.some((p) => cell.includes(p));
}

/** 전결사항 표 파싱: ○섹션 × (직위행 → 데이터행 ● 매핑). */
export function parseJeongyeol(fullText: string): JeongyeolRow[] {
  const rows: JeongyeolRow[] = [];
  // ○섹션 분할
  const secMatches = [...fullText.matchAll(/○\s*([^\n<|]+)/g)];
  for (let s = 0; s < secMatches.length; s++) {
    const section = secMatches[s][1].trim();
    const start = secMatches[s].index! + secMatches[s][0].length;
    const end = s + 1 < secMatches.length ? secMatches[s + 1].index! : fullText.length;
    const body = fullText.slice(start, end);
    const lines = body.split(/\n/).filter((l) => l.includes("|"));
    // 직위행: 구분선(---) 이후 첫 행 중 직위 어휘를 담은 행. 셀 배열을 위치 유지로 그대로 positions에.
    // (데이터행 markCells[i] ↔ positions[i] 정렬 — 빈 셀도 컬럼으로 유지해야 ● 매핑이 어긋나지 않음)
    let positions: string[] = [];
    for (const ln of lines) {
      const cells = splitCells(ln);
      if (cells.some((c) => /^-+$/.test(c))) continue; // 구분선
      if (cells.some(isPositionCell) && !/^\d+\./.test(cells[0] ?? "")) {
        positions = cells; // 예: ["본부장", "처장", "", ""] / ["본부장", "단장,처장"]
        break;
      }
    }
    // 데이터행: 업무 셀("N. ...")을 기준으로, 그 다음 컬럼들의 ● 위치 → positions index.
    // 소부서 rowspan 첫 행은 부서명이 셀0을 차지해 업무가 셀1로 밀리지만, 업무셀 인덱스를 findIndex로 잡아 자동 보정.
    let subsection = "";
    for (const ln of lines) {
      const cells = splitCells(ln);
      const dataIdx = cells.findIndex((c) => /^\d+\.\s*.+/.test(c));
      if (dataIdx < 0) continue;
      // 업무가 셀1로 밀렸고 셀0이 부서명(직위 아님)이면 소부서 시작(rowspan 헤더)
      if (dataIdx === 1 && cells[0] && !isPositionCell(cells[0])) subsection = cells[0];
      const m = cells[dataIdx].match(/^(\d+)\.\s*(.+)$/);
      if (!m) continue;
      const num = Number(m[1]);
      const text = m[2].trim();
      const markCells = cells.slice(dataIdx + 1); // filter 금지 — 빈 셀도 컬럼 위치로 유지
      const hit: string[] = [];
      markCells.forEach((cell, i) => {
        if (cell.includes("●") && positions[i]) {
          for (const p of positions[i].split(/[/,]/).map((x) => x.trim()).filter(Boolean)) {
            if (POS_WORDS.includes(p)) hit.push(p);
          }
        }
      });
      rows.push({ section, subsection, num, text, positions: [...new Set(hit)], limit: extractLimit(text), rowText: cells[dataIdx] });
    }
  }
  return rows;
}
