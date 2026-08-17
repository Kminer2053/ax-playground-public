/**
 * HWPX 표 셀 실측 크기 → 필드별 최대 입력 글자수(정밀 상한).
 *
 * kordoc fill dry-run 필드는 라벨·좌표(row·col)만 주고 셀 크기가 없어, 섹션 XML의
 * <hp:cellSz>를 직접 읽어 라벨 셀의 '값 셀'(우측 이웃 → 아래 → 자기 셀) 용량을 추정한다.
 * dry 필드 표↔XML 표 정합은 문서순 커서 + 좌표 적중률(≥0.7)로 잡고, 모호하면 그 표는
 * 건너뛴다(호출부가 역할 휴리스틱으로 폴백) — 과소 추정으로 입력을 막는 쪽이 더 나쁘다.
 * 중첩표 셀은 깊이 추적으로 제외(최상위 표만). 단위: HWPUNIT(1/7200inch), 100 = 1pt.
 */
import JSZip from "jszip";

type Cell = { w: number; h: number };
type XmlTable = Map<string, Cell>; // "row,col" → 크기

function collectTopTables(xml: string, out: XmlTable[]) {
  const re = /<hp:tbl\b|<\/hp:tbl>|<hp:cellAddr\b[^>]*\/?>|<hp:cellSz\b[^>]*\/?>/g;
  let depth = 0;
  let cur: XmlTable | null = null;
  let addr: { r: number; c: number } | null = null;
  for (const m of xml.matchAll(re)) {
    const t = m[0];
    if (t.startsWith("<hp:tbl")) { depth++; if (depth === 1) { cur = new Map(); out.push(cur); } addr = null; continue; }
    if (t.startsWith("</hp:tbl")) { depth = Math.max(0, depth - 1); if (depth === 0) cur = null; addr = null; continue; }
    if (depth !== 1 || !cur) continue;
    if (t.startsWith("<hp:cellAddr")) {
      const c = Number(/colAddr="(\d+)"/.exec(t)?.[1] ?? -1);
      const r = Number(/rowAddr="(\d+)"/.exec(t)?.[1] ?? -1);
      addr = r >= 0 && c >= 0 ? { r, c } : null;
    } else if (t.startsWith("<hp:cellSz") && addr) {
      const w = Number(/width="(\d+)"/.exec(t)?.[1] ?? 0);
      const h = Number(/height="(\d+)"/.exec(t)?.[1] ?? 0);
      if (w > 0) cur.set(`${addr.r},${addr.c}`, { w, h });
      addr = null;
    }
  }
}

/** 10pt 한글 전각 폭≈10pt·줄높이≈16pt 근사 + 셀 여백 보정. 셀이 커도 상한은 호출부의 역할 휴리스틱이 잡는다. */
function capOf(cell: Cell): number {
  const wPt = cell.w / 100, hPt = cell.h / 100;
  const cols = Math.max(1, Math.floor((wPt - 4) / 10));
  const rows = Math.max(1, Math.floor((hPt - 2) / 16));
  return cols * rows;
}

/** 라벨 셀의 값이 들어갈 셀: 같은 행 우측의 가장 가까운 셀 → 바로 아래 셀 → 자기 셀. */
function valueCell(tb: XmlTable, r: number, c: number): Cell | null {
  let best: { c: number; cell: Cell } | null = null;
  for (const [k, cell] of tb) {
    const [rr, cc] = k.split(",").map(Number);
    if (rr === r && cc > c && (!best || cc < best.c)) best = { c: cc, cell };
  }
  if (best) return best.cell;
  return tb.get(`${r + 1},${c}`) ?? tb.get(`${r},${c}`) ?? null;
}

export async function cellCapsByLabel(
  bytes: Uint8Array,
  fields: { label: string; row?: number; col?: number }[],
): Promise<Map<string, number>> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => /section\d*\.xml$/i.test(n)).sort();
  const tables: XmlTable[] = [];
  for (const n of names) collectTopTables(await zip.files[n].async("string"), tables);

  // dry 필드를 표 단위로 분할 — dropExampleTableFields와 동일한 row 리셋 규칙(문서순, row 감소 = 새 표)
  const seg: { label: string; r: number; c: number }[][] = [];
  let prev = -Infinity;
  let cur: { label: string; r: number; c: number }[] | null = null;
  for (const f of fields) {
    const r = typeof f.row === "number" ? f.row : 0;
    if (r === -1) continue; // 표 밖 메타
    if (cur === null || r < prev) { cur = []; seg.push(cur); }
    cur.push({ label: f.label, r, c: typeof f.col === "number" ? f.col : 0 });
    prev = r;
  }

  const caps = new Map<string, number>();
  let cursor = 0;
  for (const g of seg) {
    let hit = -1;
    for (let ti = cursor; ti < tables.length; ti++) {
      const n = g.filter((f) => tables[ti].has(`${f.r},${f.c}`)).length;
      if (n / g.length >= 0.7) { hit = ti; break; }
    }
    if (hit < 0) continue; // 정합 실패 — 이 표는 휴리스틱 폴백
    cursor = hit + 1;
    for (const f of g) {
      const vc = valueCell(tables[hit], f.r, f.c);
      if (!vc) continue;
      const cap = capOf(vc);
      const prevCap = caps.get(f.label);
      caps.set(f.label, prevCap === undefined ? cap : Math.min(prevCap, cap)); // 중복 라벨은 보수적으로 최소
    }
  }
  return caps;
}
